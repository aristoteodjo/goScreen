//! Live Android screen as MJPEG over 127.0.0.1.
//!
//! `adb exec-out screenrecord --output-format=h264 -` -> FFmpeg -> multipart
//! JPEG. An `<img>` can show that inside a device frame, where it rotates,
//! tilts and gets captured with the stage like any web page. Each HTTP
//! connection owns its pipeline: closing the image tears everything down.

use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use axum::{
    body::{Body, Bytes},
    extract::{Path as UrlPath, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::stream;
use tokio::sync::{mpsc, OnceCell};

use super::error::{AndroidError, ErrorCode};
use crate::modules::local_http;

const CHUNK: usize = 64 * 1024;
/// screenrecord stops after its time limit; it is restarted in place.
/// Quick successive deaths mean the device is gone.
const MAX_QUICK_RESTARTS: u32 = 3;

#[derive(Clone)]
struct Session {
    serial: String,
    adb: PathBuf,
    ffmpeg: PathBuf,
    // Flipped by android_stream_close; running pipelines notice and exit.
    closed: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct StreamState {
    port: OnceCell<u16>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl StreamState {
    async fn ensure_server(&self) -> Result<u16, AndroidError> {
        let sessions = self.sessions.clone();
        self.port
            .get_or_try_init(|| async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .map_err(|e| AndroidError::new(ErrorCode::Unknown, format!("bind: {e}")))?;
                let port = listener
                    .local_addr()
                    .map_err(|e| AndroidError::new(ErrorCode::Unknown, e.to_string()))?
                    .port();
                let app = Router::new()
                    .route("/stream/{id}", get(serve))
                    .with_state(sessions);
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = axum::serve(listener, app).await {
                        log::error!("android stream server stopped: {e}");
                    }
                });
                Ok(port)
            })
            .await
            .copied()
    }

    pub async fn open(&self, serial: String, adb: PathBuf, ffmpeg: PathBuf) -> Result<(String, String), AndroidError> {
        let port = self.ensure_server().await?;
        let id = local_http::token();
        let session = Session { serial, adb, ffmpeg, closed: Arc::new(AtomicBool::new(false)) };
        self.sessions
            .lock()
            .map_err(|_| AndroidError::new(ErrorCode::Unknown, "stream state poisoned"))?
            .insert(id.clone(), session);
        Ok((id.clone(), format!("http://127.0.0.1:{port}/stream/{id}")))
    }

    pub fn close(&self, id: &str) {
        if let Ok(mut map) = self.sessions.lock() {
            if let Some(s) = map.remove(id) {
                s.closed.store(true, Ordering::Relaxed);
            }
        }
    }
}

pub fn ffmpeg_args() -> Vec<&'static str> {
    vec![
        "-hide_banner", "-loglevel", "error",
        // Show each frame as soon as it arrives; screenrecord only emits on change.
        "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32", "-analyzeduration", "0",
        "-f", "h264", "-i", "pipe:0",
        "-an", "-f", "mpjpeg", "-q:v", "4", "pipe:1",
    ]
}

pub fn screenrecord_args(serial: &str) -> Vec<String> {
    ["-s", serial, "exec-out", "screenrecord", "--output-format=h264", "--bit-rate=8000000", "-"]
        .map(String::from)
        .to_vec()
}

struct Pipeline {
    adb: Mutex<Option<Child>>,
    ffmpeg: Mutex<Option<Child>>,
    stop: AtomicBool,
}

impl Pipeline {
    fn kill_all(&self) {
        self.stop.store(true, Ordering::Relaxed);
        for slot in [&self.adb, &self.ffmpeg] {
            if let Ok(mut c) = slot.lock() {
                if let Some(mut child) = c.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

async fn serve(
    State(sessions): State<Arc<Mutex<HashMap<String, Session>>>>,
    UrlPath(id): UrlPath<String>,
    headers: HeaderMap,
) -> Response {
    // The <img> sends no Origin; any page that does is not the studio.
    if local_http::allowed_origin(&headers).is_err() {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::empty())
            .expect("static response builds");
    }
    let session = sessions.lock().ok().and_then(|m| m.get(&id).cloned());
    let Some(session) = session else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("unknown stream"))
            .expect("static response builds");
    };

    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(8);
    let pipeline = Arc::new(Pipeline { adb: Mutex::new(None), ffmpeg: Mutex::new(None), stop: AtomicBool::new(false) });

    match spawn_pipeline(&session, pipeline.clone(), tx.clone()) {
        Ok(()) => {}
        Err(e) => {
            log::warn!("android stream {id}: {e}");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(e.detail))
                .expect("static response builds");
        }
    }

    // The <img> went away (view switch, device removed): stop adb and ffmpeg
    // even if the screen is static and no frame would reveal it.
    let watcher = pipeline.clone();
    let closed = session.closed.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = tx.closed() => break,
                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    if closed.load(Ordering::Relaxed) || watcher.stop.load(Ordering::Relaxed) { break; }
                }
            }
        }
        watcher.kill_all();
    });

    let body = Body::from_stream(stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|item| (item, rx)) }));
    Response::builder()
        .header(header::CONTENT_TYPE, "multipart/x-mixed-replace;boundary=ffmpeg")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("stream response builds")
}

fn spawn_pipeline(
    session: &Session,
    pipeline: Arc<Pipeline>,
    tx: mpsc::Sender<Result<Bytes, std::io::Error>>,
) -> Result<(), AndroidError> {
    let mut ffmpeg = Command::new(&session.ffmpeg)
        .args(ffmpeg_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AndroidError::new(ErrorCode::FfmpegMissing, format!("spawn ffmpeg: {e}")))?;
    let mut ff_in = ffmpeg.stdin.take().ok_or_else(|| AndroidError::new(ErrorCode::Unknown, "ffmpeg stdin"))?;
    let mut ff_out = ffmpeg.stdout.take().ok_or_else(|| AndroidError::new(ErrorCode::Unknown, "ffmpeg stdout"))?;
    if let Ok(mut slot) = pipeline.ffmpeg.lock() {
        *slot = Some(ffmpeg);
    }

    // JPEG parts -> HTTP body.
    let reader = pipeline.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; CHUNK];
        loop {
            match ff_out.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.blocking_send(Ok(Bytes::copy_from_slice(&buf[..n]))).is_err() {
                        break;
                    }
                }
            }
        }
        reader.kill_all();
    });

    // H.264 from the device -> FFmpeg, restarting screenrecord at its limit.
    let feeder = pipeline.clone();
    let session = session.clone();
    std::thread::spawn(move || {
        let mut quick_deaths = 0;
        let mut buf = vec![0u8; CHUNK];
        while !feeder.stop.load(Ordering::Relaxed) && !session.closed.load(Ordering::Relaxed) {
            let started = Instant::now();
            let child = Command::new(&session.adb)
                .args(screenrecord_args(&session.serial))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn();
            let Ok(mut child) = child else { break };
            let Some(mut out) = child.stdout.take() else { break };
            if let Ok(mut slot) = feeder.adb.lock() {
                *slot = Some(child);
            }
            loop {
                match out.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if ff_in.write_all(&buf[..n]).is_err() {
                            feeder.kill_all();
                            return;
                        }
                    }
                }
            }
            if let Ok(mut slot) = feeder.adb.lock() {
                if let Some(mut c) = slot.take() {
                    let _ = c.wait();
                }
            }
            quick_deaths = if started.elapsed() < Duration::from_secs(3) { quick_deaths + 1 } else { 0 };
            if quick_deaths >= MAX_QUICK_RESTARTS {
                log::warn!("android stream {}: screenrecord keeps exiting, giving up", session.serial);
                break;
            }
        }
        feeder.kill_all();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_args_are_fixed_argv() {
        let args = screenrecord_args("emulator-5554");
        assert_eq!(&args[..4], ["-s", "emulator-5554", "exec-out", "screenrecord"]);
        assert!(ffmpeg_args().join(" ").contains("-f mpjpeg"));
    }
}

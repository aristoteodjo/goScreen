//! Recordings for the editor: a local media server plus the sidecar files
//! (interactions, edits) stored next to each MP4.
//!
//! The video is served over 127.0.0.1 with CORS so the editor can draw it
//! into a canvas without tainting it: preview and export share one renderer.

use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use axum::{
    body::{Body, Bytes},
    extract::{Path as UrlPath, State as AxumState},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::stream;
use serde::Serialize;
use tauri::State;
use tokio::sync::{mpsc, OnceCell};

use super::local_http;

const CHUNK: usize = 256 * 1024;

type Files = Arc<Mutex<HashMap<String, PathBuf>>>;

#[derive(Default)]
pub struct MediaState {
    port: OnceCell<u16>,
    files: Files,
}

/// `Range: bytes=a-b` against a file of `len` bytes -> inclusive (start, end).
/// None means "not satisfiable"; a missing header is handled by the caller.
pub fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = value.trim().strip_prefix("bytes=")?;
    // Multi-range requests are answered with their first range.
    let first = spec.split(',').next()?.trim();
    let (a, b) = first.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            if n == 0 {
                return None;
            }
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => (s.parse().ok()?, len - 1),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("m4a") => "audio/mp4",
        _ => "application/octet-stream",
    }
}

/// Streams [start, end] from disk on a thread; nothing is held in memory.
fn file_body(path: PathBuf, start: u64, end: u64) -> Body {
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(4);
    std::thread::spawn(move || {
        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.blocking_send(Err(e));
                return;
            }
        };
        if let Err(e) = file.seek(SeekFrom::Start(start)) {
            let _ = tx.blocking_send(Err(e));
            return;
        }
        let mut left = end - start + 1;
        let mut buf = vec![0u8; CHUNK];
        while left > 0 {
            let want = (left as usize).min(CHUNK);
            match file.read(&mut buf[..want]) {
                Ok(0) => break,
                Ok(n) => {
                    left -= n as u64;
                    if tx.blocking_send(Ok(Bytes::copy_from_slice(&buf[..n]))).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }
    });
    Body::from_stream(stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|item| (item, rx)) }))
}

async fn serve(AxumState(files): AxumState<Files>, UrlPath(token): UrlPath<String>, headers: HeaderMap) -> Response {
    let path = files.lock().ok().and_then(|m| m.get(&token).cloned());
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .expect("static response builds")
    };
    let Ok(cors) = local_http::allowed_origin(&headers) else {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::empty())
            .expect("static response builds");
    };
    let Some(path) = path else { return not_found() };
    let Ok(len) = std::fs::metadata(&path).map(|m| m.len()) else { return not_found() };

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime_for(&path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::VARY, "Origin");
    if let Some(origin) = cors {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let response = match range {
        None => builder
            .header(header::CONTENT_LENGTH, len)
            .body(if len == 0 { Body::empty() } else { file_body(path, 0, len - 1) }),
        Some(value) => match parse_range(value, len) {
            Some((start, end)) => builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(header::CONTENT_LENGTH, end - start + 1)
                .body(file_body(path, start, end)),
            None => builder
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Body::empty()),
        },
    };
    response.expect("media response builds")
}

impl MediaState {
    async fn ensure_server(&self) -> Result<u16, String> {
        let files = self.files.clone();
        self.port
            .get_or_try_init(|| async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .map_err(|e| format!("media server bind: {e}"))?;
                let port = listener.local_addr().map_err(|e| e.to_string())?.port();
                let app = Router::new().route("/media/{token}", get(serve)).with_state(files);
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = axum::serve(listener, app).await {
                        log::error!("media server stopped: {e}");
                    }
                });
                Ok(port)
            })
            .await
            .copied()
    }

    async fn publish(&self, path: PathBuf) -> Result<String, String> {
        let port = self.ensure_server().await?;
        let token = local_http::token();
        self.files
            .lock()
            .map_err(|_| "media state poisoned".to_string())?
            .insert(token.clone(), path);
        Ok(format!("http://127.0.0.1:{port}/media/{token}"))
    }
}

/// Only recordings (video files that exist) may be opened or annotated.
pub fn recording_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    let is_video = matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("mp4") | Some("mov") | Some("m4v")
    );
    if !is_video {
        return Err("Only MP4 or MOV recordings can be opened.".into());
    }
    if !path.is_file() {
        return Err(format!("{} no longer exists.", path.display()));
    }
    Ok(path)
}

/// `video.mp4` -> `video.<suffix>` next to it.
pub fn sidecar(video: &Path, suffix: &str) -> PathBuf {
    video.with_extension(suffix)
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRecording {
    video_path: String,
    video_url: String,
    name: String,
    interactions: Option<serde_json::Value>,
    edit: Option<serde_json::Value>,
    camera_url: Option<String>,
    mic_url: Option<String>,
}

/// A companion file named in the interactions sidecar: a bare file name in
/// the recording's folder, never a path that could point elsewhere.
pub fn companion_file(video: &Path, name: Option<&str>) -> Option<PathBuf> {
    let name = name?;
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return None;
    }
    let path = video.parent()?.join(name);
    path.is_file().then_some(path)
}

#[tauri::command]
pub async fn recording_open(state: State<'_, MediaState>, video_path: String) -> Result<OpenedRecording, String> {
    let path = recording_path(&video_path)?;
    let video_url = state.publish(path.clone()).await?;
    let interactions = read_json(&sidecar(&path, "interactions.json"));
    let media = |key: &str| {
        interactions
            .as_ref()
            .and_then(|i| i.get("media"))
            .and_then(|m| m.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_owned)
    };
    let camera_url = match companion_file(&path, media("camera").as_deref()) {
        Some(p) => Some(state.publish(p).await?),
        None => None,
    };
    let mic_url = match companion_file(&path, media("mic").as_deref()) {
        Some(p) => Some(state.publish(p).await?),
        None => None,
    };
    Ok(OpenedRecording {
        name: path.file_stem().and_then(|s| s.to_str()).unwrap_or("Recording").to_string(),
        camera_url,
        mic_url,
        interactions,
        edit: read_json(&sidecar(&path, "edit.json")),
        video_path: path.to_string_lossy().into_owned(),
        video_url,
    })
}

/// Saves the non-destructive edit next to the recording. The MP4 is never touched.
#[tauri::command(async)]
pub fn edit_save(video_path: String, edit: serde_json::Value) -> Result<(), String> {
    let path = recording_path(&video_path)?;
    let json = serde_json::to_vec_pretty(&edit).map_err(|e| e.to_string())?;
    let target = sidecar(&path, "edit.json");
    let tmp = sidecar(&path, "edit.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("save {}: {e}", target.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEntry {
    path: String,
    name: String,
    modified_ms: u64,
    has_interactions: bool,
}

/// Raw captures, newest first. Exports and temp files are not recordings.
pub fn is_raw_recording(name: &str) -> bool {
    name.starts_with("goscreen-") && name.ends_with(".mp4") && !name.contains("-export-") && !name.ends_with(".video.mp4")
}

#[tauri::command(async)]
pub fn recordings_list() -> Result<Vec<RecordingEntry>, String> {
    let Some(dir) = dirs::video_dir().or_else(dirs::home_dir).map(|d| d.join("goScreen")) else {
        return Ok(Vec::new());
    };
    let Ok(read) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut out: Vec<RecordingEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_raw_recording(&name) {
                return None;
            }
            let path = entry.path();
            let modified_ms = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or_default();
            Some(RecordingEntry {
                has_interactions: sidecar(&path, "interactions.json").is_file(),
                name: path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string(),
                path: path.to_string_lossy().into_owned(),
                modified_ms,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out.truncate(50);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_raw_recordings() {
        assert!(is_raw_recording("goscreen-1759.mp4"));
        assert!(!is_raw_recording("goscreen-1759-export-1760.mp4"));
        assert!(!is_raw_recording("goscreen-1759-export-1760.video.mp4"));
        assert!(!is_raw_recording("goscreen-1759.interactions.json"));
        assert!(!is_raw_recording("holiday.mp4"));
    }

    #[test]
    fn parses_byte_ranges() {
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=0-1", 1000), Some((0, 1)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=10-20, 30-40", 1000), Some((10, 20)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-2", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn companion_files_stay_in_the_recording_folder() {
        let video = Path::new("/tmp/rec.mp4");
        assert_eq!(companion_file(video, Some("../etc/passwd")), None);
        assert_eq!(companion_file(video, Some("/etc/passwd")), None);
        assert_eq!(companion_file(video, Some(".hidden")), None);
        assert_eq!(companion_file(video, None), None);
    }

    #[test]
    fn only_opens_video_files() {
        assert!(recording_path("/etc/passwd").is_err());
        assert!(recording_path("/nope/missing.mp4").is_err());
        assert_eq!(sidecar(Path::new("/a/rec.mp4"), "edit.json"), PathBuf::from("/a/rec.edit.json"));
    }
}

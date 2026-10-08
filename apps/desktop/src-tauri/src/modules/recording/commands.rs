use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use super::capture::{encode_args, PixelRect, ScreenCaptureProvider};
use super::ffmpeg;

const STDERR_TAIL: usize = 40;

struct Session {
    child: Child,
    video: PathBuf,
    started: Instant,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Default)]
pub struct RecordingState(Mutex<Option<Session>>);

#[derive(Deserialize, Clone, Copy)]
pub struct CaptureRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    video_path: String,
    interactions_path: String,
    duration_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    available: bool,
    path: Option<String>,
}

#[tauri::command]
pub fn ffmpeg_status() -> FfmpegStatus {
    let path = ffmpeg::locate();
    FfmpegStatus {
        available: path.is_some(),
        path: path.map(|p| p.display().to_string()),
    }
}

fn ffmpeg_bin() -> Result<PathBuf, String> {
    ffmpeg::locate().ok_or_else(|| "FFmpeg was not found. Install it (brew install ffmpeg) and retry.".into())
}

fn pixel_rect(window: &WebviewWindow, region: CaptureRegion) -> Result<PixelRect, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    if cfg!(target_os = "macos") {
        let monitor = window.current_monitor().map_err(|e| e.to_string())?;
        if monitor.map(|m| (m.position().x, m.position().y)) != Some((0, 0)) {
            return Err("Move the goScreen window to the main display to record.".into());
        }
    }
    if region.width < 2.0 || region.height < 2.0 {
        return Err("Capture region is empty.".into());
    }
    Ok(PixelRect {
        x: origin.x + (region.x * scale).round() as i32,
        y: origin.y + (region.y * scale).round() as i32,
        width: (region.width * scale).round() as u32,
        height: (region.height * scale).round() as u32,
    }
    .even())
}

#[cfg(target_os = "macos")]
fn provider(bin: &Path) -> Result<Box<dyn ScreenCaptureProvider>, String> {
    use super::capture::{parse_avfoundation_screen, AvFoundation};
    let out = Command::new(bin)
        .args(["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let listing = String::from_utf8_lossy(&out.stderr);
    let screen_index = parse_avfoundation_screen(&listing)
        .ok_or("No capturable screen found. Grant Screen Recording permission in System Settings.")?;
    Ok(Box::new(AvFoundation { screen_index }))
}

#[cfg(target_os = "windows")]
fn provider(_bin: &Path) -> Result<Box<dyn ScreenCaptureProvider>, String> {
    Ok(Box::new(super::capture::GdiGrab))
}

#[cfg(target_os = "linux")]
fn provider(_bin: &Path) -> Result<Box<dyn ScreenCaptureProvider>, String> {
    Ok(Box::new(super::capture::X11Grab))
}

fn output_path(base: Option<PathBuf>, ext: &str) -> Result<PathBuf, String> {
    let dir = base
        .or_else(dirs::home_dir)
        .ok_or("No home directory")?
        .join("goScreen");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    Ok(dir.join(format!("goscreen-{stamp}.{ext}")))
}

fn tail(lines: &Arc<Mutex<VecDeque<String>>>) -> String {
    lines
        .lock()
        .map(|l| l.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

// Blocking work (ffmpeg probing, graceful stop) must stay off the main thread.
#[tauri::command(async)]
pub fn recording_start(
    window: WebviewWindow,
    state: State<'_, RecordingState>,
    region: CaptureRegion,
    fps: Option<u32>,
) -> Result<String, String> {
    let mut slot = state.0.lock().map_err(|_| "recording state poisoned")?;
    if slot.is_some() {
        return Err("A recording is already running.".into());
    }
    let bin = ffmpeg_bin()?;
    let rect = pixel_rect(&window, region)?;
    let video = output_path(dirs::video_dir(), "mp4")?;
    let input = provider(&bin)?.input(rect, fps.unwrap_or(60).clamp(15, 60), false);
    let args = encode_args(input, &video.to_string_lossy(), false);

    let mut child = Command::new(&bin)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start ffmpeg: {e}"))?;

    // FFmpeg blocks once its stderr pipe fills, so it must always be drained.
    let stderr = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL)));
    if let Some(pipe) = child.stderr.take() {
        let sink = stderr.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if let Ok(mut buf) = sink.lock() {
                    if buf.len() == STDERR_TAIL {
                        buf.pop_front();
                    }
                    buf.push_back(line);
                }
            }
        });
    }

    std::thread::sleep(Duration::from_millis(400));
    if let Ok(Some(status)) = child.try_wait() {
        return Err(format!("ffmpeg exited early ({status}):\n{}", tail(&stderr)));
    }

    log::info!("recording started -> {}", video.display());
    let path = video.to_string_lossy().to_string();
    *slot = Some(Session {
        child,
        video,
        started: Instant::now(),
        stderr,
    });
    Ok(path)
}

// Blocking work (ffmpeg probing, graceful stop) must stay off the main thread.
#[tauri::command(async)]
pub fn recording_stop(
    state: State<'_, RecordingState>,
    interactions: serde_json::Value,
) -> Result<RecordingResult, String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "recording state poisoned")?
        .take()
        .ok_or("No recording is running.")?;
    let duration_ms = session.started.elapsed().as_millis() as u64;

    if let Some(stdin) = session.child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match session.child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = session.child.kill();
                let _ = session.child.wait();
                break;
            }
        }
    }

    let size = std::fs::metadata(&session.video).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Err(format!("Recording produced no video:\n{}", tail(&session.stderr)));
    }

    let sidecar = session.video.with_extension("interactions.json");
    let json = serde_json::to_vec_pretty(&interactions).map_err(|e| e.to_string())?;
    std::fs::write(&sidecar, json).map_err(|e| format!("write {}: {e}", sidecar.display()))?;

    Ok(RecordingResult {
        video_path: session.video.to_string_lossy().to_string(),
        interactions_path: sidecar.to_string_lossy().to_string(),
        duration_ms,
    })
}

#[tauri::command]
pub async fn screenshot_capture(window: WebviewWindow, region: CaptureRegion) -> Result<String, String> {
    let bin = ffmpeg_bin()?;
    let rect = pixel_rect(&window, region)?;
    let out = output_path(dirs::picture_dir(), "png")?;
    let input = provider(&bin)?.input(rect, 30, false);
    let args = encode_args(input, &out.to_string_lossy(), true);
    let result = tauri::async_runtime::spawn_blocking(move || Command::new(bin).args(&args).output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("ffmpeg: {e}"))?;
    if !result.status.success() || !out.exists() {
        return Err(format!("Screenshot failed:\n{}", String::from_utf8_lossy(&result.stderr)));
    }
    Ok(out.to_string_lossy().to_string())
}

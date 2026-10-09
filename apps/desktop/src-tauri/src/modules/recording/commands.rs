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

use super::capture::{encode_args, window_crop, PixelRect, ScreenCaptureProvider, WindowCrop};
use super::companion::{self, CaptureDevices};
use super::ffmpeg;
use super::permissions;

const STDERR_TAIL: usize = 40;

/// What records the screen pixels.
enum Screen {
    /// FFmpeg grabbing a screen region (Windows, Linux, older macOS).
    Ffmpeg(Child),
    /// ScreenCaptureKit recording the goScreen window alone.
    #[cfg(target_os = "macos")]
    Window(super::sck::Recording),
}

impl Screen {
    fn finish(self) -> Result<(), String> {
        match self {
            Screen::Ffmpeg(mut child) => {
                finish(&mut child);
                Ok(())
            }
            #[cfg(target_os = "macos")]
            Screen::Window(recording) => recording.finish(),
        }
    }
}

struct Session {
    screen: Screen,
    video: PathBuf,
    started: Instant,
    stderr: Arc<Mutex<VecDeque<String>>>,
    companion: Option<Companion>,
}

/// Camera and/or microphone process and where its files land.
struct Companion {
    child: Child,
    camera: Option<PathBuf>,
    mic: Option<PathBuf>,
    /// First companion output relative to the first screen frame.
    offset_ms: f64,
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
    camera_path: Option<String>,
    mic_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStarted {
    video_path: String,
    // Set when the camera/microphone could not start; the screen still records.
    companion_warning: Option<String>,
    // Time from the command call to the ffmpeg spawn. The frontend adds it to
    // its own call time to align interaction timestamps with frame 0.
    spawn_offset_ms: f64,
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

/// The region in the window's own points, for a window capture.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn window_rect(window: &WebviewWindow, region: CaptureRegion) -> Result<WindowCrop, String> {
    if region.width < 2.0 || region.height < 2.0 {
        return Err("Capture region is empty.".into());
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_position().map_err(|e| e.to_string())?;
    let outer = window.outer_position().map_err(|e| e.to_string())?;
    let offset = (f64::from(inner.x - outer.x) / scale, f64::from(inner.y - outer.y) / scale);
    Ok(window_crop((region.x, region.y, region.width, region.height), offset, scale))
}

/// Whether the screen is recorded through ScreenCaptureKit (window only).
fn window_capture() -> bool {
    #[cfg(target_os = "macos")]
    return super::sck::available();
    #[cfg(not(target_os = "macos"))]
    false
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

fn avfoundation_listing(bin: &Path) -> String {
    Command::new(bin)
        .args(["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stderr).into_owned())
        .unwrap_or_default()
}

/// Cameras and microphones the recorder can use alongside the screen.
#[tauri::command(async)]
pub fn capture_devices() -> Result<CaptureDevices, String> {
    if !cfg!(target_os = "macos") {
        return Ok(CaptureDevices::default());
    }
    let bin = ffmpeg_bin()?;
    Ok(companion::parse_avfoundation_devices(&avfoundation_listing(&bin)))
}

/// Starts the camera/mic FFmpeg and waits for its first output. A failure
/// here never blocks the screen recording: it comes back as a warning.
fn start_companion(bin: &Path, video: &Path, camera: Option<u32>, mic: Option<u32>, screen_zero: Instant) -> Result<Option<Companion>, String> {
    let Some((args, outputs)) = companion::companion_args(camera, mic, video) else { return Ok(None) };
    if !cfg!(target_os = "macos") {
        return Err("Camera and microphone capture are only available on macOS for now.".into());
    }
    let spawned = Instant::now();
    let mut child = companion::spawn(bin, &args).map_err(|e| format!("camera/mic: {e}"))?;
    orphan::remember(child.id());
    let first = loop {
        let ready = outputs.camera.iter().chain(outputs.mic.iter()).any(|p| p.exists());
        if ready {
            break Instant::now();
        }
        let exited = matches!(child.try_wait(), Ok(Some(_)));
        if exited || spawned.elapsed() > FIRST_FRAME_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(permissions::companion_message());
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let offset_ms = if first >= screen_zero {
        first.duration_since(screen_zero).as_secs_f64() * 1000.0
    } else {
        -(screen_zero.duration_since(first).as_secs_f64() * 1000.0)
    };
    Ok(Some(Companion { child, camera: outputs.camera, mic: outputs.mic, offset_ms }))
}

/// Region grab through FFmpeg. Returns once the first frame is on disk.
fn start_ffmpeg(
    bin: &Path,
    rect: PixelRect,
    fps: u32,
    video: &Path,
    stderr: &Arc<Mutex<VecDeque<String>>>,
) -> Result<(Child, Instant), String> {
    let input = provider(bin)?.input(rect, fps, false);
    let args = encode_args(input, &video.to_string_lossy(), false);

    let spawned = Instant::now();
    let mut child = Command::new(bin)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start ffmpeg: {e}"))?;

    // FFmpeg blocks once its stderr pipe fills, so it must always be drained.
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

    orphan::remember(child.id());

    // FFmpeg only creates the output once the screen delivers a first frame.
    // Without the Screen Recording permission it never does and would hang
    // forever, so a missing file is a failure, not a slow start.
    let first_frame = loop {
        if let Ok(Some(status)) = child.try_wait() {
            orphan::forget();
            return Err(format!("ffmpeg exited early ({status}):\n{}", tail(stderr)));
        }
        if video.exists() {
            break Instant::now();
        }
        if spawned.elapsed() > FIRST_FRAME_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            orphan::forget();
            let _ = std::fs::remove_file(video);
            return Err(permissions::no_frames_message());
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    Ok((child, first_frame))
}

#[cfg(target_os = "macos")]
fn start_window(window: &WebviewWindow, region: CaptureRegion, fps: u32, video: &Path) -> Result<(Screen, Instant), String> {
    let crop = window_rect(window, region)?;
    let (recording, first) = super::sck::start(&crop, fps, video)?;
    Ok((Screen::Window(recording), first))
}

#[cfg(not(target_os = "macos"))]
fn start_window(_: &WebviewWindow, _: CaptureRegion, _: u32, _: &Path) -> Result<(Screen, Instant), String> {
    Err("Window capture is only available on macOS.".into())
}

// Blocking work (ffmpeg probing, graceful stop) must stay off the main thread.
#[tauri::command(async)]
pub fn recording_start(
    window: WebviewWindow,
    state: State<'_, RecordingState>,
    region: CaptureRegion,
    fps: Option<u32>,
    camera: Option<u32>,
    microphone: Option<u32>,
) -> Result<RecordingStarted, String> {
    let called = Instant::now();
    let mut slot = state.0.lock().map_err(|_| "recording state poisoned")?;
    if slot.is_some() {
        return Err("A recording is already running.".into());
    }
    let bin = ffmpeg_bin()?;
    let video = output_path(dirs::video_dir(), "mp4")?;
    let fps = fps.unwrap_or(60).clamp(15, 60);
    let stderr = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL)));
    let (screen, first_frame) = if window_capture() {
        start_window(&window, region, fps, &video)?
    } else {
        let rect = pixel_rect(&window, region)?;
        let (child, first) = start_ffmpeg(&bin, rect, fps, &video, &stderr)?;
        (Screen::Ffmpeg(child), first)
    };

    let (companion, companion_warning) = match start_companion(&bin, &video, camera, microphone, first_frame) {
        Ok(c) => (c, None),
        Err(e) => (None, Some(e)),
    };

    log::info!("recording started -> {}", video.display());
    let path = video.to_string_lossy().to_string();
    *slot = Some(Session {
        screen,
        video,
        started: first_frame,
        stderr,
        companion,
    });
    Ok(RecordingStarted {
        video_path: path,
        companion_warning,
        // Interaction time zero is the first captured frame, not the spawn.
        spawn_offset_ms: first_frame.duration_since(called).as_secs_f64() * 1000.0,
    })
}

const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(6);


/// Asks FFmpeg to finish the file: `q` on stdin, then SIGINT, then kill.
/// Each step gets a few seconds so the MP4 index (moov) is written.
fn finish(child: &mut Child) {
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    if wait_for(child, Duration::from_secs(4)) {
        return;
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill").args(["-INT", &child.id().to_string()]).status();
        if wait_for(child, Duration::from_secs(4)) {
            return;
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn wait_for(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => return false,
            Err(_) => return true,
        }
    }
}

/// Stops a running capture when the app quits normally.
pub fn shutdown(state: &RecordingState) {
    if let Some(mut session) = state.0.lock().ok().and_then(|mut s| s.take()) {
        if let Some(c) = session.companion.as_mut() {
            finish(&mut c.child);
        }
        let _ = session.screen.finish();
        orphan::forget();
    }
}

/// A capture FFmpeg outlives an app that was killed (crash, dev rebuild).
/// Its pid is kept on disk so the next launch can stop it.
pub mod orphan {
    use std::path::PathBuf;

    fn file() -> Option<PathBuf> {
        dirs::cache_dir().map(|d| d.join("goScreen").join("recording.pid"))
    }

    pub fn remember(pid: u32) {
        if let Some(f) = file() {
            if let Some(dir) = f.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let mut pids = std::fs::read_to_string(&f).unwrap_or_default();
            pids.push_str(&format!("{pid}\n"));
            let _ = std::fs::write(f, pids);
        }
    }

    pub fn forget() {
        if let Some(f) = file() {
            let _ = std::fs::remove_file(f);
        }
    }

    /// Kills the remembered process only if it is still an ffmpeg.
    pub fn reap() {
        let Some(f) = file() else { return };
        let pids: Vec<u32> = std::fs::read_to_string(&f)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect();
        for pid in pids {
            reap_one(pid);
        }
        let _ = std::fs::remove_file(f);
    }

    fn reap_one(pid: u32) {
        #[cfg(unix)]
        {
            use std::process::Command;
            let comm = Command::new("ps")
                .args(["-p", &pid.to_string(), "-o", "comm="])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default();
            if comm.trim().ends_with("ffmpeg") {
                log::warn!("stopping orphaned capture ffmpeg {pid}");
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
            }
        }
        #[cfg(not(unix))]
        let _ = pid;
    }
}

// Blocking work (ffmpeg probing, graceful stop) must stay off the main thread.
#[tauri::command(async)]
pub fn recording_stop(
    state: State<'_, RecordingState>,
    mut interactions: serde_json::Value,
) -> Result<RecordingResult, String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "recording state poisoned")?
        .take()
        .ok_or("No recording is running.")?;
    let duration_ms = session.started.elapsed().as_millis() as u64;

    let screen = session.screen.finish();
    let companion = session.companion.take().map(|mut c| {
        finish(&mut c.child);
        c
    });
    orphan::forget();

    let size = std::fs::metadata(&session.video).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        let reason = screen.err().unwrap_or_else(|| tail(&session.stderr));
        return Err(format!("Recording produced no video:\n{reason}"));
    }

    // Companion files are referenced by name: the folder can move as a whole.
    let existing = |p: &Option<PathBuf>| p.as_ref().filter(|p| p.is_file()).cloned();
    let camera = companion.as_ref().and_then(|c| existing(&c.camera));
    let mic = companion.as_ref().and_then(|c| existing(&c.mic));
    let file_name = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().into_owned());
    if let Some(obj) = interactions.as_object_mut() {
        obj.insert(
            "media".into(),
            serde_json::json!({
                "camera": camera.as_ref().and_then(file_name),
                "mic": mic.as_ref().and_then(file_name),
                "offsetMs": companion.as_ref().map(|c| c.offset_ms).unwrap_or(0.0),
            }),
        );
    }

    let sidecar = session.video.with_extension("interactions.json");
    let json = serde_json::to_vec_pretty(&interactions).map_err(|e| e.to_string())?;
    std::fs::write(&sidecar, json).map_err(|e| format!("write {}: {e}", sidecar.display()))?;

    Ok(RecordingResult {
        video_path: session.video.to_string_lossy().to_string(),
        interactions_path: sidecar.to_string_lossy().to_string(),
        duration_ms,
        camera_path: camera.map(|p| p.to_string_lossy().into_owned()),
        mic_path: mic.map(|p| p.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn screenshot_capture(window: WebviewWindow, region: CaptureRegion) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    if window_capture() {
        let crop = window_rect(&window, region)?;
        let out = output_path(dirs::picture_dir(), "png")?;
        let target = out.clone();
        tauri::async_runtime::spawn_blocking(move || super::sck::screenshot(&crop, &target))
            .await
            .map_err(|e| e.to_string())??;
        return Ok(out.to_string_lossy().to_string());
    }
    let bin = ffmpeg_bin()?;
    let rect = pixel_rect(&window, region)?;
    let out = output_path(dirs::picture_dir(), "png")?;
    let input = provider(&bin)?.input(rect, 30, false);
    let args = encode_args(input, &out.to_string_lossy(), true);
    let target = out.clone();
    // Same hang as recording without permission: bounded, never forever.
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new(bin)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg: {e}"))?;
        if !wait_for(&mut child, FIRST_FRAME_TIMEOUT) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(permissions::no_frames_message());
        }
        let mut stderr = String::new();
        if let Some(mut pipe) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut pipe, &mut stderr);
        }
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        if !ok || !target.exists() {
            return Err(format!("Screenshot failed:\n{stderr}"));
        }
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

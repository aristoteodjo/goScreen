//! MP4 export. The editor renders each frame in a canvas (the same renderer
//! as the preview) and streams JPEGs here; FFmpeg encodes them, then mixes
//! tap sounds in a second, video-copy pass.

mod audio;

use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{ipc::InvokeBody, State};

use crate::modules::recording::ffmpeg;

const STDERR_TAIL: usize = 30;

struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    video: PathBuf,
    output: PathBuf,
    frames: u64,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Default)]
pub struct ExportState(Mutex<Option<Session>>);

pub fn encode_args(fps: u32, output: &str) -> Vec<String> {
    let fps = fps.clamp(15, 60).to_string();
    [
        "-hide_banner", "-y", "-f", "image2pipe", "-framerate", &fps, "-c:v", "mjpeg", "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", &fps,
        "-movflags", "+faststart", output,
    ]
    .map(String::from)
    .to_vec()
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
        .take(80)
        .collect();
    if cleaned.trim_matches('-').is_empty() {
        "goscreen".into()
    } else {
        cleaned
    }
}

fn export_paths(name: &str) -> Result<(PathBuf, PathBuf), String> {
    let dir = dirs::video_dir()
        .or_else(dirs::home_dir)
        .ok_or("No home directory")?
        .join("goScreen");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let base = format!("{}-export-{stamp}", sanitize(name));
    Ok((dir.join(format!("{base}.video.mp4")), dir.join(format!("{base}.mp4"))))
}

fn tail(lines: &Arc<Mutex<VecDeque<String>>>) -> String {
    lines
        .lock()
        .map(|l| l.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

fn kill(mut session: Session) {
    drop(session.stdin.take());
    let _ = session.child.kill();
    let _ = session.child.wait();
    let _ = std::fs::remove_file(&session.video);
}

#[tauri::command(async)]
pub fn export_begin(state: State<'_, ExportState>, name: String, fps: u32) -> Result<String, String> {
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg) and retry.")?;
    let mut slot = state.0.lock().map_err(|_| "export state poisoned")?;
    if let Some(previous) = slot.take() {
        kill(previous);
    }
    let (video, output) = export_paths(&name)?;
    let mut child = Command::new(bin)
        .args(encode_args(fps, &video.to_string_lossy()))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start ffmpeg: {e}"))?;
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
    let stdin = child.stdin.take();
    *slot = Some(Session { child, stdin, video, output: output.clone(), frames: 0, stderr });
    Ok(output.to_string_lossy().into_owned())
}

/// One JPEG frame as the raw invoke body (no JSON/base64 round trip).
#[tauri::command(async)]
pub fn export_frame(state: State<'_, ExportState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("export_frame expects raw JPEG bytes".into());
    };
    let mut slot = state.0.lock().map_err(|_| "export state poisoned")?;
    let session = slot.as_mut().ok_or("No export is running.")?;
    let stdin = session.stdin.as_mut().ok_or("Export input is closed.")?;
    if let Err(e) = stdin.write_all(bytes) {
        let detail = tail(&session.stderr);
        if let Some(s) = slot.take() {
            kill(s);
        }
        return Err(format!("FFmpeg stopped accepting frames ({e}):\n{detail}"));
    }
    session.frames += 1;
    Ok(())
}

/// Microphone of the exported recording, resolved from its sidecar.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicRequest {
    video_path: String,
    trim_start_ms: f64,
    volume: f64,
}

fn resolve_mic(req: &MicRequest) -> Option<(PathBuf, f64)> {
    let video = crate::modules::media::recording_path(&req.video_path).ok()?;
    let json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(video.with_extension("interactions.json")).ok()?).ok()?;
    let media = json.get("media")?;
    let file = crate::modules::media::companion_file(&video, media.get("mic")?.as_str())?;
    Some((file, media.get("offsetMs").and_then(|v| v.as_f64()).unwrap_or(0.0)))
}

#[tauri::command(async)]
pub fn export_finish(
    state: State<'_, ExportState>,
    clicks: Vec<f64>,
    volume: f64,
    mic: Option<MicRequest>,
) -> Result<String, String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "export state poisoned")?
        .take()
        .ok_or("No export is running.")?;
    drop(session.stdin.take());
    let status = session.child.wait().map_err(|e| e.to_string())?;
    if !status.success() || session.frames == 0 {
        let detail = tail(&session.stderr);
        let _ = std::fs::remove_file(&session.video);
        return Err(format!("Encoding failed:\n{detail}"));
    }

    let clicks_ms: Vec<u64> = clicks
        .iter()
        .filter(|t| t.is_finite() && **t >= 0.0)
        .map(|t| (t * 1000.0).round() as u64)
        .collect();
    let mic = mic.as_ref().and_then(|m| resolve_mic(m).map(|(path, offset)| (path, offset, m)));
    let mic_mix = mic.as_ref().map(|(_, offset, m)| audio::MicMix {
        input: if clicks_ms.is_empty() { 1 } else { 2 },
        offset_ms: *offset,
        trim_start_ms: m.trim_start_ms,
        volume: m.volume,
    });
    let Some(filter) = audio::mix_filter(&clicks_ms, volume, mic_mix.as_ref()) else {
        std::fs::rename(&session.video, &session.output).map_err(|e| e.to_string())?;
        return Ok(session.output.to_string_lossy().into_owned());
    };

    let bin = ffmpeg::locate().ok_or("FFmpeg disappeared during export.")?;
    let click = session.video.with_extension("click.wav");
    let mut cmd = Command::new(bin);
    cmd.args(["-hide_banner", "-y", "-i"]).arg(&session.video);
    if !clicks_ms.is_empty() {
        std::fs::write(&click, audio::wav(&audio::click_samples())).map_err(|e| e.to_string())?;
        cmd.arg("-i").arg(&click);
    }
    if let Some((path, _, _)) = &mic {
        cmd.arg("-i").arg(path);
    }
    let out = cmd
        .args(["-filter_complex", &filter, "-map", "0:v", "-map", "[aout]"])
        .args(["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart"])
        .arg(&session.output)
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let _ = std::fs::remove_file(&click);
    if !out.status.success() {
        // Keep the silent video rather than lose the export.
        std::fs::rename(&session.video, &session.output).map_err(|e| e.to_string())?;
        log::warn!("audio mix failed: {}", String::from_utf8_lossy(&out.stderr));
        return Ok(session.output.to_string_lossy().into_owned());
    }
    let _ = std::fs::remove_file(&session.video);
    Ok(session.output.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn export_cancel(state: State<'_, ExportState>) -> Result<(), String> {
    if let Some(session) = state.0.lock().map_err(|_| "export state poisoned")?.take() {
        kill(session);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_piped_jpegs_to_h264() {
        let args = encode_args(240, "out.mp4").join(" ");
        assert!(args.contains("-f image2pipe -framerate 60 -c:v mjpeg -i pipe:0"));
        assert!(args.ends_with("+faststart out.mp4"));
    }

    #[test]
    fn export_names_are_safe_file_names() {
        assert_eq!(sanitize("goscreen-123"), "goscreen-123");
        assert_eq!(sanitize("../../etc"), "------etc");
        assert_eq!(sanitize("///"), "goscreen");
    }
}

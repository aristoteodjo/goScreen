//! MP4 export. The editor renders each frame in a canvas (the same renderer
//! as the preview) and streams JPEGs here; FFmpeg encodes them, then mixes
//! tap sounds in a second, video-copy pass. The same frame pipe serves the
//! cached chunks of an incremental export and the small drafts the AI asks
//! for (`chunks.rs`).

pub mod audio;
pub mod chunks;

use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{ipc::InvokeBody, State};

use crate::modules::recording::ffmpeg;

const STDERR_TAIL: usize = 30;

pub(super) struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    /// The file FFmpeg writes (silent video, or a part file).
    pub(super) video: PathBuf,
    /// Where the finished file goes.
    pub(super) output: PathBuf,
    frames: u64,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Default)]
pub struct ExportState(pub(super) Mutex<Option<Session>>);

/// How the piped JPEGs are encoded: the final quality, or a fast draft.
#[derive(Clone, Copy)]
pub enum Quality {
    Final,
    Draft,
}

pub fn encode_args(fps: u32, output: &str) -> Vec<String> {
    encode_args_for(Quality::Final, fps, output)
}

pub fn encode_args_for(quality: Quality, fps: u32, output: &str) -> Vec<String> {
    let fps = fps.clamp(5, 60).to_string();
    let (preset, crf) = match quality {
        Quality::Final => ("slow", "15"),
        Quality::Draft => ("veryfast", "24"),
    };
    [
        "-hide_banner", "-y", "-f", "image2pipe", "-framerate", &fps, "-c:v", "mjpeg", "-i", "pipe:0",
        // Browser JPEGs are full-range BT.601; tag and convert to BT.709 TV
        // range so players do not wash out or shift colors.
        "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos",
        "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-r", &fps,
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

pub(super) fn export_paths(name: &str) -> Result<(PathBuf, PathBuf), String> {
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

pub(super) fn kill(mut session: Session) {
    drop(session.stdin.take());
    let _ = session.child.kill();
    let _ = session.child.wait();
    let _ = std::fs::remove_file(&session.video);
}

/// Starts FFmpeg on `video` (the file it writes) for a session that ends in
/// `output`; a session already running is killed first.
pub(super) fn begin(
    state: &ExportState,
    quality: Quality,
    fps: u32,
    video: PathBuf,
    output: PathBuf,
) -> Result<(), String> {
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg) and retry.")?;
    let mut slot = state.0.lock().map_err(|_| "export state poisoned")?;
    if let Some(previous) = slot.take() {
        kill(previous);
    }
    let mut child = Command::new(bin)
        .args(encode_args_for(quality, fps, &video.to_string_lossy()))
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
    *slot = Some(Session { child, stdin, video, output, frames: 0, stderr });
    Ok(())
}

/// Takes the running session and waits for FFmpeg to finish its file.
pub(super) fn finish(state: &ExportState) -> Result<Session, String> {
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
    Ok(session)
}

#[tauri::command(async)]
pub fn export_begin(state: State<'_, ExportState>, name: String, fps: u32) -> Result<String, String> {
    let (video, output) = export_paths(&name)?;
    begin(&state, Quality::Final, fps, video, output.clone())?;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AudioSource {
    /// The recording's microphone; times are source times.
    Mic,
    /// A file of the recording's assets folder; times are file times.
    Asset { file: String },
}

/// One stretch of sound on the export timeline (see `audio::Piece`).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceRequest {
    source: AudioSource,
    from: f64,
    duration: f64,
    /// Timeline seconds.
    at: f64,
    speed: f64,
    volume: f64,
    fade_in: f64,
    fade_out: f64,
    /// Gain under the voice: points (seconds from the piece's start, gain).
    #[serde(default)]
    duck: Vec<DuckPoint>,
}

#[derive(serde::Deserialize, Clone, Copy)]
pub struct DuckPoint {
    at: f64,
    gain: f64,
}

/// What an export ends with: the file, and the loudness of its master
/// when it has a soundtrack.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutput {
    pub file: String,
    pub loudness: Option<audio::Loudness>,
}

/// The integrated loudness and true peak of a file's sound (`ebur128`).
pub(crate) fn measure_loudness(bin: &Path, file: &Path) -> Option<audio::Loudness> {
    let out = Command::new(bin)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(file)
        .args(["-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .output()
        .ok()?;
    audio::parse_ebur128(&String::from_utf8_lossy(&out.stderr))
}

/// Two-pass `loudnorm` to -14 LUFS / -1 dBTP on `file`'s sound (video
/// copied); the file is replaced in place. A failure leaves it untouched.
fn normalize_master(bin: &Path, file: &Path) -> Result<(), String> {
    let measure = Command::new(bin)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(file)
        .args(["-vn", "-af", &audio::loudnorm_measure_filter(), "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let measured = audio::parse_loudnorm(&String::from_utf8_lossy(&measure.stderr))
        .ok_or("loudnorm did not report its measurements")?;
    let part = file.with_extension("loud.mp4");
    let out = Command::new(bin)
        .args(["-hide_banner", "-y", "-i"])
        .arg(file)
        .args(["-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", &audio::loudnorm_apply_filter(&measured)])
        .args(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"])
        .arg(&part)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    if !out.status.success() {
        let _ = std::fs::remove_file(&part);
        return Err(String::from_utf8_lossy(&out.stderr).lines().rev().take(5).collect::<Vec<_>>().join("\n"));
    }
    std::fs::rename(&part, file).map_err(|e| e.to_string())
}

/// The microphone file and its offset (seconds) from the first screen frame.
fn resolve_mic(video: &Path) -> Option<(PathBuf, f64)> {
    let json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(video.with_extension("interactions.json")).ok()?).ok()?;
    let media = json.get("media")?;
    let file = crate::modules::media::companion_file(video, media.get("mic")?.as_str())?;
    Some((file, media.get("offsetMs").and_then(|v| v.as_f64()).unwrap_or(0.0) / 1000.0))
}

/// A video without a sound track would fail the whole mix.
fn has_audio(bin: &Path, file: &Path) -> bool {
    Command::new(bin)
        .args(["-hide_banner", "-i"])
        .arg(file)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stderr).contains("Audio:"))
        .unwrap_or(false)
}

#[tauri::command(async)]
pub fn export_finish(
    state: State<'_, ExportState>,
    video_path: String,
    clicks: Vec<f64>,
    volume: f64,
    pieces: Vec<PieceRequest>,
    normalize: Option<bool>,
) -> Result<ExportOutput, String> {
    let session = finish(&state)?;
    mix(&session.video, &session.output, &video_path, &clicks, volume, &pieces, normalize.unwrap_or(true))
}

/// Mixes the soundtrack under the silent `video` into `output` (which then
/// owns the file; `video` is removed), or just moves it when there is no sound.
/// With `normalize`, the master is brought to -14 LUFS / -1 dBTP; its
/// loudness is measured either way.
pub(super) fn mix(
    video: &Path,
    output: &Path,
    video_path: &str,
    clicks: &[f64],
    volume: f64,
    pieces: &[PieceRequest],
    normalize: bool,
) -> Result<ExportOutput, String> {
    let bin = ffmpeg::locate().ok_or("FFmpeg disappeared during export.")?;

    let clicks_ms: Vec<u64> = clicks
        .iter()
        .filter(|t| t.is_finite() && **t >= 0.0)
        .map(|t| (t * 1000.0).round() as u64)
        .collect();
    let recording = crate::modules::media::recording_path(video_path).ok();
    let mic = recording.as_deref().and_then(resolve_mic);

    // Inputs: 0 = the silent video, 1 = the click (if any), then one per piece.
    let mut files: Vec<PathBuf> = Vec::new();
    let mut placed: Vec<audio::Piece> = Vec::new();
    let first = if clicks_ms.is_empty() { 1 } else { 2 };
    for p in pieces {
        if !(p.duration.is_finite() && p.from.is_finite() && p.at.is_finite()) || p.duration <= 0.0 {
            continue;
        }
        let (file, offset) = match &p.source {
            AudioSource::Mic => match &mic {
                Some((file, offset)) => (file.clone(), *offset),
                None => continue,
            },
            AudioSource::Asset { file } => {
                let Some(path) = recording.as_deref().and_then(|v| crate::modules::media::asset_file(v, file)) else {
                    continue;
                };
                if !has_audio(&bin, &path) {
                    continue;
                }
                (path, 0.0)
            }
        };
        let Some((from, duration, at)) = audio::on_file(p.from, p.duration, p.at.max(0.0), p.speed, offset) else {
            continue;
        };
        placed.push(audio::Piece {
            input: first + files.len(),
            from,
            duration,
            at_ms: (at * 1000.0).round() as u64,
            speed: p.speed,
            volume: p.volume,
            fade_in: p.fade_in,
            fade_out: p.fade_out,
            duck: p.duck.iter().map(|d| (d.at, d.gain)).collect(),
        });
        files.push(file);
    }

    let Some(filter) = audio::mix_filter(&clicks_ms, volume, &placed) else {
        std::fs::rename(video, output).map_err(|e| e.to_string())?;
        return Ok(ExportOutput { file: output.to_string_lossy().into_owned(), loudness: None });
    };

    let click = video.with_extension("click.wav");
    let mut cmd = Command::new(&bin);
    cmd.args(["-hide_banner", "-y", "-i"]).arg(video);
    if !clicks_ms.is_empty() {
        std::fs::write(&click, audio::wav(&audio::click_samples())).map_err(|e| e.to_string())?;
        cmd.arg("-i").arg(&click);
    }
    for file in &files {
        cmd.arg("-i").arg(file);
    }
    let out = cmd
        .args(["-filter_complex", &filter, "-map", "0:v", "-map", "[aout]"])
        .args(["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart"])
        .arg(output)
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let _ = std::fs::remove_file(&click);
    if !out.status.success() {
        // Keep the silent video rather than lose the export.
        std::fs::rename(video, output).map_err(|e| e.to_string())?;
        log::warn!("audio mix failed: {}", String::from_utf8_lossy(&out.stderr));
        return Ok(ExportOutput { file: output.to_string_lossy().into_owned(), loudness: None });
    }
    let _ = std::fs::remove_file(video);
    if normalize {
        if let Err(e) = normalize_master(&bin, output) {
            log::warn!("loudness normalisation skipped: {e}");
        }
    }
    let loudness = measure_loudness(&bin, output);
    Ok(ExportOutput { file: output.to_string_lossy().into_owned(), loudness })
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
    fn drafts_encode_fast_and_accept_slow_frame_rates() {
        let args = encode_args_for(Quality::Draft, 10, "d.mp4").join(" ");
        assert!(args.contains("-framerate 10 "));
        assert!(args.contains("-preset veryfast -crf 24"));
    }

    #[test]
    fn export_names_are_safe_file_names() {
        assert_eq!(sanitize("goscreen-123"), "goscreen-123");
        assert_eq!(sanitize("../../etc"), "------etc");
        assert_eq!(sanitize("///"), "goscreen");
    }
}

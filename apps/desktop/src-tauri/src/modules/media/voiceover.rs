//! Voice-over recorded in the editor, Premiere style: the mic records while
//! the timeline plays, and the take lands in the recording's assets as an
//! audio file, cleaned like a studio take's voice.

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};

use serde::Serialize;
use tauri::State;

use super::{assets_dir, recording_path, ImportedAsset, MediaState};
use crate::modules::recording::{ffmpeg, voice};

const START_TIMEOUT: Duration = Duration::from_secs(6);

struct Take {
    child: Child,
    video: PathBuf,
    id: String,
    raw: PathBuf,
}

#[derive(Default)]
pub struct VoiceOverState {
    take: Mutex<Option<Take>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOverStarted {
    /// Seconds of sound already in the file when the mic was confirmed live:
    /// the editor skips them so the voice lines up with the playhead.
    lead: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOverTake {
    asset: ImportedAsset,
    silent: bool,
}

pub fn capture_args(mic: u32, out: &Path) -> Vec<String> {
    let mut args: Vec<String> =
        ["-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1", "-stats_period", "0.05"]
            .map(String::from)
            .to_vec();
    args.extend(["-thread_queue_size", "4096", "-f", "avfoundation", "-i"].map(String::from));
    args.push(format!("none:{mic}"));
    args.extend(["-af", "aresample=async=1:first_pts=0", "-c:a", "aac", "-b:a", "160k", "-y"].map(String::from));
    args.push(out.to_string_lossy().into_owned());
    args
}

/// `out_time_us=1234` lines of `-progress`, in seconds.
pub fn progress_seconds(line: &str) -> Option<f64> {
    let us: i64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
    (us > 0).then_some(us as f64 / 1_000_000.0)
}

/// Starts the mic; returns once sound is being written.
#[tauri::command(async)]
pub fn voiceover_start(state: State<'_, VoiceOverState>, video_path: String, microphone: u32) -> Result<VoiceOverStarted, String> {
    let video = recording_path(&video_path)?;
    let mut slot = state.take.lock().map_err(|_| "voice-over state poisoned")?;
    if slot.is_some() {
        return Err("A voice-over is already recording.".into());
    }
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    let dir = assets_dir(&video);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let raw = dir.join(format!("{id}.raw.m4a"));
    let mut child = Command::new(bin)
        .args(capture_args(microphone, &raw))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("start the microphone: {e}"))?;

    // Progress is read on its own thread for the whole take: a full pipe
    // would stall FFmpeg.
    let (tx, rx) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if !sent {
                    if let Some(s) = progress_seconds(&line) {
                        sent = tx.send(s).is_ok();
                    }
                }
            }
        });
    }
    match rx.recv_timeout(START_TIMEOUT) {
        Ok(lead) => {
            *slot = Some(Take { child, video, id, raw });
            Ok(VoiceOverStarted { lead })
        }
        Err(_) => {
            let _ = child.kill();
            let out = child.wait_with_output().ok();
            let _ = std::fs::remove_file(&raw);
            let detail = out.map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string()).unwrap_or_default();
            Err(if detail.is_empty() {
                "The microphone did not start. Check it in System Settings, Privacy, Microphone.".into()
            } else {
                format!("The microphone did not start: {detail}")
            })
        }
    }
}

fn finish(take: &mut Take) {
    // `q` lets FFmpeg write a playable file; kill only if it does not listen.
    let asked = take.child.stdin.as_mut().map(|s| s.write_all(b"q").and_then(|_| s.flush()).is_ok()).unwrap_or(false);
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while asked && std::time::Instant::now() < deadline {
        if let Ok(Some(_)) = take.child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = take.child.kill();
    let _ = take.child.wait();
}

/// Stops the mic, cleans the voice and adds it to the recording's assets.
#[tauri::command]
pub async fn voiceover_stop(
    state: State<'_, VoiceOverState>,
    media: State<'_, MediaState>,
) -> Result<VoiceOverTake, String> {
    let take = state.take.lock().map_err(|_| "voice-over state poisoned")?.take();
    let mut take = take.ok_or("No voice-over is recording.")?;
    let (file, path, silent) = tauri::async_runtime::spawn_blocking(move || -> Result<(String, PathBuf, bool), String> {
        finish(&mut take);
        if !take.raw.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let _ = std::fs::remove_file(&take.raw);
            return Err("The microphone recorded nothing.".into());
        }
        let file = format!("{}.m4a", take.id);
        let out = assets_dir(&take.video).join(&file);
        let bin = ffmpeg::locate().ok_or("FFmpeg was not found.")?;
        let cleaned = Command::new(bin)
            .args(voice::enhance_args(&take.raw, &out))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if cleaned {
            let _ = std::fs::remove_file(&take.raw);
        } else {
            std::fs::rename(&take.raw, &out).map_err(|e| format!("keep the voice-over: {e}"))?;
        }
        let silent = voice::is_silent(&out);
        Ok((file, out, silent))
    })
    .await
    .map_err(|e| e.to_string())??;
    let url = media.publish(path).await?;
    let id = file.trim_end_matches(".m4a").to_string();
    Ok(VoiceOverTake {
        asset: ImportedAsset { id, name: "Voice-over".into(), kind: "audio", file, url },
        silent,
    })
}

/// Drops the take in progress, file included.
#[tauri::command]
pub fn voiceover_cancel(state: State<'_, VoiceOverState>) {
    let take = state.take.lock().ok().and_then(|mut t| t.take());
    if let Some(mut take) = take {
        let _ = take.child.kill();
        let _ = take.child.wait();
        let _ = std::fs::remove_file(&take.raw);
    }
}

/// The app quits: no mic left running.
pub fn shutdown(state: &VoiceOverState) {
    if let Ok(mut t) = state.take.lock() {
        if let Some(mut take) = t.take() {
            let _ = take.child.kill();
            let _ = take.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_the_chosen_mic_with_progress() {
        let args = capture_args(2, Path::new("/m/rec.assets/x.raw.m4a")).join(" ");
        assert!(args.contains("-progress pipe:1"));
        assert!(args.contains("-f avfoundation -i none:2"));
        assert!(args.ends_with("-y /m/rec.assets/x.raw.m4a"));
    }

    #[test]
    fn reads_progress_time() {
        assert_eq!(progress_seconds("out_time_us=250000"), Some(0.25));
        assert_eq!(progress_seconds("out_time_us=0"), None);
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("total_size=12"), None);
    }
}

//! Voice-over recorded in the editor, Premiere style: the mic records while
//! the timeline plays, and the take lands in the recording's assets as an
//! audio file, cleaned like a studio take's voice.

use std::{
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::State;

use super::mic::{self, MicCapture};
use super::{assets_dir, recording_path, ImportedAsset, MediaState};
use crate::modules::recording::{ffmpeg, voice};

const START_TIMEOUT: Duration = Duration::from_secs(6);

struct Take {
    capture: MicCapture,
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

/// Starts the mic (by device name; empty for the system default); returns
/// once sound is being written.
#[tauri::command(async)]
pub fn voiceover_start(state: State<'_, VoiceOverState>, video_path: String, microphone: String) -> Result<VoiceOverStarted, String> {
    let video = recording_path(&video_path)?;
    let mut slot = state.take.lock().map_err(|_| "voice-over state poisoned")?;
    if slot.is_some() {
        return Err("A voice-over is already recording.".into());
    }
    let dir = assets_dir(&video);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let raw = dir.join(format!("{id}.raw.wav"));
    let capture = match mic::start(Some(&microphone), &raw, START_TIMEOUT) {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&raw);
            return Err(e);
        }
    };
    let lead = capture.seconds();
    *slot = Some(Take { capture, video, id, raw });
    Ok(VoiceOverStarted { lead })
}

/// Loudest level a microphone hears in a short listen, in dB.
#[tauri::command(async)]
pub fn microphone_level(microphone: String) -> Result<f64, String> {
    mic::level(Some(&microphone), Duration::from_millis(700))
}

/// Stops the mic, cleans the voice and adds it to the recording's assets.
#[tauri::command]
pub async fn voiceover_stop(
    state: State<'_, VoiceOverState>,
    media: State<'_, MediaState>,
) -> Result<VoiceOverTake, String> {
    let take = state.take.lock().map_err(|_| "voice-over state poisoned")?.take();
    let take = take.ok_or("No voice-over is recording.")?;
    let (file, path, silent) = tauri::async_runtime::spawn_blocking(move || -> Result<(String, PathBuf, bool), String> {
        take.capture.finish()?;
        // A WAV header alone is 44 bytes.
        if !take.raw.metadata().map(|m| m.len() > 44).unwrap_or(false) {
            let _ = std::fs::remove_file(&take.raw);
            return Err("The microphone recorded nothing.".into());
        }
        let file = format!("{}.m4a", take.id);
        let out = assets_dir(&take.video).join(&file);
        let bin = ffmpeg::locate().ok_or("FFmpeg was not found.")?;
        let cleaned = Command::new(&bin)
            .args(voice::enhance_args(&take.raw, &out))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !cleaned {
            // Kept as AAC all the same, untouched, so the take is never lost.
            let plain = Command::new(bin)
                .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
                .arg(&take.raw)
                .args(["-ac", "1", "-c:a", "aac", "-b:a", "192k"])
                .arg(&out)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !plain {
                return Err("The voice-over could not be saved.".into());
            }
        }
        let _ = std::fs::remove_file(&take.raw);
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
    if let Some(take) = take {
        let _ = take.capture.finish();
        let _ = std::fs::remove_file(&take.raw);
    }
}

/// The app quits: no mic left running.
pub fn shutdown(state: &VoiceOverState) {
    if let Ok(mut t) = state.take.lock() {
        if let Some(take) = t.take() {
            let _ = take.capture.finish();
        }
    }
}

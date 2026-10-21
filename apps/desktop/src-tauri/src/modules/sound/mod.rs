//! Generated sound: music beds and effects synthesised by `@goscreen/music`
//! (Node, pure code, no rights to clear) into the recording's assets, and
//! the loudness of a finished file. The studio sends a style, a seed and a
//! length, never a path; files are named by their inputs, so the same bed
//! is rendered once.

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::modules::{
    export::{audio::Loudness, measure_loudness},
    media::{assets_dir, recording_path, ImportedAsset, MediaState},
    scenario::{locate_node, progress_line, runner_path, write_private},
};

pub const STYLES: [&str; 6] = ["calm", "warm", "pulse", "rise", "focus", "bright"];
pub const SFX: [&str; 5] = ["tap", "pop", "thud", "tick", "riser"];
const MAX_SECONDS: f64 = 1800.0;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SoundJob {
    /// A bed of `duration` seconds; with `payoff`, its full section lands there.
    Music { style: String, seed: u32, duration: f64, payoff: Option<f64> },
    Sfx { sfx: String },
}

/// The asset file a job renders to: its inputs spelled out, nothing else.
pub fn asset_name(job: &SoundJob) -> Result<String, String> {
    match job {
        SoundJob::Music { style, seed, duration, payoff } => {
            if !STYLES.contains(&style.as_str()) {
                return Err(format!("Unknown music style {style:?} (one of {}).", STYLES.join(", ")));
            }
            if !(duration.is_finite() && *duration > 0.0 && *duration <= MAX_SECONDS) {
                return Err("Music length must be between 0 and 1800 s.".into());
            }
            let seconds = duration.ceil() as u64;
            match payoff.filter(|p| p.is_finite() && *p > 0.0) {
                Some(p) => Ok(format!("music-{style}-{seed}-{seconds}s-p{}.wav", (p * 10.0).round() as u64)),
                None => Ok(format!("music-{style}-{seed}-{seconds}s.wav")),
            }
        }
        SoundJob::Sfx { sfx } => {
            if !SFX.contains(&sfx.as_str()) {
                return Err(format!("Unknown sound effect {sfx:?} (one of {}).", SFX.join(", ")));
            }
            Ok(format!("sfx-{sfx}.wav"))
        }
    }
}

/// What the renderer reads: the job with its length rounded as the name was.
fn job_json(job: &SoundJob) -> Value {
    match job {
        SoundJob::Music { style, seed, duration, payoff } => serde_json::json!({
            "kind": "music", "style": style, "seed": seed, "duration": duration.ceil(),
            "payoff": payoff.filter(|p| p.is_finite() && *p > 0.0),
        }),
        SoundJob::Sfx { sfx } => serde_json::json!({ "kind": "sfx", "sfx": sfx }),
    }
}

/// `GOSCREEN_MUSIC_RENDERER`, else `packages/music/render.mjs` next to the scenario runner.
fn renderer_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("GOSCREEN_MUSIC_RENDERER") {
        let path = PathBuf::from(path);
        return if path.is_file() { Ok(path) } else { Err(format!("Music renderer not found at {}.", path.display())) };
    }
    let runner = runner_path()?;
    let path = runner.parent().and_then(Path::parent).map(|p| p.join("music").join("render.mjs")).unwrap_or_default();
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("Music renderer not found at {}. Set GOSCREEN_MUSIC_RENDERER to packages/music/render.mjs.", path.display()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedSound {
    pub asset: ImportedAsset,
    /// Plan seconds the bed starts from (its full section lands on the payoff).
    pub offset: f64,
    pub seconds: f64,
}

/// Runs the renderer on a job; the WAV is written to `out`.
fn render(job: &SoundJob, out: &Path) -> Result<(f64, f64), String> {
    let node = locate_node().ok_or("Node.js 22.6 or later is required to generate music.")?;
    let script = renderer_path()?;
    let job_file = std::env::temp_dir().join(format!("goscreen-sound-{}.json", uuid::Uuid::new_v4()));
    write_private(&job_file, job_json(job).to_string().as_bytes()).map_err(|e| e.to_string())?;
    let part = out.with_extension("part.wav");
    let output = Command::new(&node)
        .arg("--experimental-strip-types")
        .arg(&script)
        .arg(&job_file)
        .arg(&part)
        .current_dir(script.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .output();
    let _ = std::fs::remove_file(&job_file);
    let output = output.map_err(|e| format!("start {}: {e}", node.display()))?;
    let last = String::from_utf8_lossy(&output.stdout).lines().filter_map(progress_line).last();
    let number = |key: &str| last.as_ref().and_then(|e| e.get(key)).and_then(Value::as_f64).unwrap_or(0.0);
    match last.as_ref().and_then(|e| e.get("type")).and_then(Value::as_str) {
        Some("done") if part.is_file() => {
            std::fs::rename(&part, out).map_err(|e| format!("keep {}: {e}", out.display()))?;
            Ok((number("offset"), number("seconds")))
        }
        _ => {
            let _ = std::fs::remove_file(&part);
            Err(last
                .and_then(|e| e.get("message").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| String::from_utf8_lossy(&output.stderr).trim().chars().take(400).collect()))
        }
    }
}

/// Renders a bed or an effect into `<stem>.assets/` and serves it to the
/// editor, like `asset_import`. A file already rendered is reused.
#[tauri::command]
pub async fn sound_render(state: State<'_, MediaState>, video_path: String, job: SoundJob) -> Result<RenderedSound, String> {
    let video = recording_path(&video_path)?;
    let file = asset_name(&job)?;
    let dir = assets_dir(&video);
    let target = dir.join(&file);
    let meta = target.with_extension("json");
    let job_for_render = job.clone();
    let (offset, seconds) = tauri::async_runtime::spawn_blocking(move || -> Result<(f64, f64), String> {
        std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        if target.is_file() {
            if let Some(v) = std::fs::read(&meta).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                let n = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
                return Ok((n("offset"), n("seconds")));
            }
        }
        let r = render(&job_for_render, &target)?;
        let _ = std::fs::write(&meta, serde_json::json!({ "offset": r.0, "seconds": r.1 }).to_string());
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())??;
    let url = state.publish(assets_dir(&video).join(&file)).await?;
    let (name, kind) = match &job {
        SoundJob::Music { style, .. } => (format!("Music ({style})"), "audio"),
        SoundJob::Sfx { sfx } => (format!("SFX {sfx}"), "audio"),
    };
    Ok(RenderedSound {
        asset: ImportedAsset { id: file.trim_end_matches(".wav").replace('.', "-"), name, kind, file, url },
        offset,
        seconds,
    })
}

/// Integrated loudness and true peak of a video or audio file (an export,
/// a voice take): what `ebur128` hears.
#[tauri::command(async)]
pub fn audio_loudness(path: String) -> Result<Loudness, String> {
    let file = PathBuf::from(&path);
    let ok = matches!(
        file.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("mp4" | "mov" | "m4v" | "wav" | "m4a" | "mp3" | "aac" | "ogg" | "webm")
    );
    if !ok || !file.is_file() {
        return Err("Only an existing video or audio file can be measured.".into());
    }
    let bin = crate::modules::recording::ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    measure_loudness(&bin, &file).ok_or_else(|| "This file has no sound to measure.".into())
}

/// The take's transcription (`<stem>.words.json`), as written; null when
/// nothing was transcribed yet. The studio validates it.
#[tauri::command(async)]
pub fn words_read(video_path: String) -> Result<Option<Value>, String> {
    let video = recording_path(&video_path)?;
    let path = video.with_extension("words.json");
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(serde_json::from_slice(&bytes).ok())
}

/// Writes the take's subtitles next to it (`<stem>.srt`); returns the path.
#[tauri::command(async)]
pub fn srt_write(video_path: String, text: String) -> Result<String, String> {
    let video = recording_path(&video_path)?;
    if text.len() > 4_000_000 {
        return Err("Subtitles are too long.".into());
    }
    let path = video.with_extension("srt");
    std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_assets_after_their_inputs() {
        let bed = SoundJob::Music { style: "pulse".into(), seed: 3, duration: 31.2, payoff: Some(4.26) };
        assert_eq!(asset_name(&bed).unwrap(), "music-pulse-3-32s-p43.wav");
        let plain = SoundJob::Music { style: "calm".into(), seed: 0, duration: 10.0, payoff: None };
        assert_eq!(asset_name(&plain).unwrap(), "music-calm-0-10s.wav");
        assert_eq!(asset_name(&SoundJob::Sfx { sfx: "pop".into() }).unwrap(), "sfx-pop.wav");
        assert!(asset_name(&SoundJob::Sfx { sfx: "../x".into() }).is_err());
        assert!(asset_name(&SoundJob::Music { style: "metal".into(), seed: 0, duration: 10.0, payoff: None }).is_err());
        assert!(asset_name(&SoundJob::Music { style: "calm".into(), seed: 0, duration: 0.0, payoff: None }).is_err());
    }

    #[test]
    fn job_rounds_the_length_as_the_name_does() {
        let bed = SoundJob::Music { style: "rise".into(), seed: 1, duration: 9.1, payoff: Some(-1.0) };
        let json = job_json(&bed);
        assert_eq!(json["duration"], 10.0);
        assert!(json["payoff"].is_null());
    }
}

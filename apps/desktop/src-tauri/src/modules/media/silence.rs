//! Sound checks for the editor: whether a microphone hears anything before a
//! take, and where an audio file is silent so pauses can be cut.

use std::process::{Command, Stdio};

use serde::Serialize;

use super::{asset_file, recording_path};
use crate::modules::recording::{ffmpeg, voice};

/// A stretch of silence, in seconds of the file. `end` is `None` when the
/// silence runs to the end of the file.
#[derive(Debug, PartialEq, Serialize)]
pub struct Silence {
    pub start: f64,
    pub end: Option<f64>,
}

/// `silencedetect` lines: `silence_start: 1.2` then `silence_end: 2.5 | ...`.
pub fn parse_silences(stderr: &str) -> Vec<Silence> {
    let mut out: Vec<Silence> = Vec::new();
    let number = |line: &str, key: &str| -> Option<f64> {
        let rest = line.split(key).nth(1)?;
        rest.split_whitespace().next()?.trim_end_matches('|').parse().ok()
    };
    for line in stderr.lines() {
        if let Some(start) = number(line, "silence_start:") {
            out.push(Silence { start: start.max(0.0), end: None });
        } else if let Some(end) = number(line, "silence_end:") {
            if let Some(last) = out.last_mut().filter(|s| s.end.is_none()) {
                last.end = Some(end);
            }
        }
    }
    out
}

pub fn silence_args(input: &str, threshold_db: f64, min_silence: f64) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-i".into(),
        input.into(),
        "-af".into(),
        format!("silencedetect=noise={threshold_db}dB:d={min_silence}"),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
}

/// The recording's own mic is asked for by this name; other sounds by their
/// file in the assets folder.
pub const MIC_FILE: &str = ":mic";

/// Where a sound of the recording is silent.
#[tauri::command(async)]
pub fn audio_silences(video_path: String, file: String, threshold_db: f64, min_silence: f64) -> Result<Vec<Silence>, String> {
    let video = recording_path(&video_path)?;
    let path = if file == MIC_FILE {
        Some(video.with_extension("mic.m4a")).filter(|p| p.is_file())
    } else {
        asset_file(&video, &file)
    }
    .ok_or("This sound is not in the recording's assets.")?;
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    let threshold = threshold_db.clamp(-80.0, -10.0);
    let min = min_silence.clamp(0.05, 10.0);
    let out = Command::new(bin)
        .args(silence_args(&path.to_string_lossy(), threshold, min))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("read the sound: {e}"))?;
    if !out.status.success() {
        return Err("The sound could not be read.".into());
    }
    Ok(parse_silences(&String::from_utf8_lossy(&out.stderr)))
}

/// Loudest level a microphone hears in a short listen, in dB. A device that
/// is listed but not live (a meeting app's virtual mic, an iPhone out of
/// reach) gives pure digital silence, around -91 dB.
#[tauri::command(async)]
pub fn microphone_level(microphone: u32) -> Result<f64, String> {
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    let mut child = Command::new(bin)
        .args(["-hide_banner", "-nostats", "-f", "avfoundation", "-i"])
        .arg(format!("none:{microphone}"))
        .args(["-t", "0.8", "-af", "volumedetect", "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("start the microphone: {e}"))?;
    // A device that never delivers a sample would hang FFmpeg.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while std::time::Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    if matches!(child.try_wait(), Ok(None)) {
        let _ = child.kill();
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(voice::peak_db(&String::from_utf8_lossy(&out.stderr)).unwrap_or(-91.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_silences_with_an_open_end() {
        let log = "[silencedetect @ 0x1] silence_start: -0.01\n\
[silencedetect @ 0x1] silence_end: 1.25 | silence_duration: 1.26\n\
size=N/A time=00:00:03.00\n\
[silencedetect @ 0x1] silence_start: 4.5\n\
[silencedetect @ 0x1] silence_end: 5.75 | silence_duration: 1.25\n\
[silencedetect @ 0x1] silence_start: 8.1\n";
        assert_eq!(
            parse_silences(log),
            vec![
                Silence { start: 0.0, end: Some(1.25) },
                Silence { start: 4.5, end: Some(5.75) },
                Silence { start: 8.1, end: None },
            ]
        );
        assert!(parse_silences("no silence here").is_empty());
    }

    #[test]
    fn asks_ffmpeg_for_the_chosen_threshold() {
        let args = silence_args("/a.m4a", -40.0, 0.4).join(" ");
        assert!(args.contains("silencedetect=noise=-40dB:d=0.4"));
    }
}

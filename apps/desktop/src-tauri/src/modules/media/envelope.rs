//! Loudness envelope of a take's voice: one RMS value every 10 ms, read from
//! PCM decoded by FFmpeg. Saved as `<stem>.envelope.json` (`{ dt, rms }`),
//! it lets the studio snap each word onto the attack of its sound.

use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};

use super::{recording_path, sidecar, transcribe::audio_source};
use crate::modules::recording::ffmpeg;

pub const SAMPLE_RATE: u32 = 16_000;
/// Seconds per envelope value.
pub const DT: f64 = 0.01;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Envelope {
    pub dt: f64,
    pub rms: Vec<f32>,
}

pub fn pcm_args(input: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-i"].map(String::from).to_vec();
    args.push(input.to_string_lossy().into_owned());
    args.extend(
        ["-vn", "-ac", "1", "-ar", &SAMPLE_RATE.to_string(), "-f", "s16le", "-c:a", "pcm_s16le", "-"].map(String::from),
    );
    args
}

/// RMS of each window of `window` samples, 0..1 (full scale = 1). The last,
/// shorter window counts too.
pub fn rms_envelope(samples: &[i16], window: usize) -> Vec<f32> {
    if window == 0 {
        return Vec::new();
    }
    samples
        .chunks(window)
        .map(|chunk| {
            let sum: f64 = chunk.iter().map(|&s| (s as f64 / 32768.0).powi(2)).sum();
            ((sum / chunk.len() as f64).sqrt() as f32 * 10_000.0).round() / 10_000.0
        })
        .collect()
}

pub fn samples_of(bytes: &[u8]) -> Vec<i16> {
    bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
}

pub fn envelope_of(bytes: &[u8]) -> Envelope {
    let window = (SAMPLE_RATE as f64 * DT).round() as usize;
    Envelope { dt: DT, rms: rms_envelope(&samples_of(bytes), window) }
}

pub fn envelope_path(video: &Path) -> std::path::PathBuf {
    sidecar(video, "envelope.json")
}

/// Measures the take's voice and saves the envelope next to it.
#[tauri::command(async)]
pub fn media_envelope(video_path: String) -> Result<Envelope, String> {
    let video = recording_path(&video_path)?;
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    let mut child = Command::new(bin)
        .args(pcm_args(&audio_source(&video)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("read the sound: {e}"))?;
    let mut bytes = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        out.read_to_end(&mut bytes).map_err(|e| format!("read the sound: {e}"))?;
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() || bytes.is_empty() {
        return Err("The sound could not be read.".into());
    }
    let envelope = envelope_of(&bytes);
    let json = serde_json::to_vec(&envelope).map_err(|e| e.to_string())?;
    let target = envelope_path(&video);
    std::fs::write(&target, json).map_err(|e| format!("write {}: {e}", target.display()))?;
    Ok(envelope)
}

/// The saved envelope of a take, or null when it was never measured.
#[tauri::command(async)]
pub fn media_envelope_load(video_path: String) -> Result<Option<Envelope>, String> {
    let video = recording_path(&video_path)?;
    let path = envelope_path(&video);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("{} is not an envelope: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_each_window() {
        // 160 samples at full scale, then 160 at half, then 80 silent.
        let mut samples = vec![i16::MAX; 160];
        samples.extend(vec![16384i16; 160]);
        samples.extend(vec![0i16; 80]);
        let rms = rms_envelope(&samples, 160);
        assert_eq!(rms.len(), 3);
        assert!((rms[0] - 1.0).abs() < 0.001);
        assert!((rms[1] - 0.5).abs() < 0.001);
        assert_eq!(rms[2], 0.0);
        assert!(rms_envelope(&samples, 0).is_empty());
    }

    #[test]
    fn decodes_little_endian_pcm_into_ten_millisecond_windows() {
        let mut bytes = Vec::new();
        for _ in 0..320 {
            bytes.extend_from_slice(&16384i16.to_le_bytes());
        }
        let env = envelope_of(&bytes);
        assert_eq!(env.dt, 0.01);
        assert_eq!(env.rms.len(), 2);
        assert!((env.rms[0] - 0.5).abs() < 0.001);
        assert!(pcm_args(Path::new("/v.m4a")).join(" ").contains("-ar 16000 -f s16le"));
    }
}

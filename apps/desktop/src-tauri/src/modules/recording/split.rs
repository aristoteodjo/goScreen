use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;

use super::ffmpeg;

// One take, one file per device: each device glass is cropped out of the
// capture into `<stem>-<suffix>.mp4`, with its own journal next to it, so it
// opens in the editor as a single-device recording (frame, touches, zooms).

/// A rectangle normalized to the captured video (0..1).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct NormRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
pub struct SplitPart {
    /// File name suffix, e.g. `dev1-iphone-17-pro`.
    pub suffix: String,
    pub rect: NormRect,
    /// The journal written as `<stem>-<suffix>.interactions.json`.
    pub journal: serde_json::Value,
}

/// Crop in video pixels: inside the frame, even sizes (H.264 4:2:0 needs them).
pub fn crop_px(rect: NormRect, width: u32, height: u32) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = (f64::from(width), f64::from(height));
    let x0 = (rect.x * w).round().clamp(0.0, w);
    let y0 = (rect.y * h).round().clamp(0.0, h);
    let x1 = ((rect.x + rect.width) * w).round().clamp(0.0, w);
    let y1 = ((rect.y + rect.height) * h).round().clamp(0.0, h);
    let cw = ((x1 - x0) as u32) & !1;
    let ch = ((y1 - y0) as u32) & !1;
    (cw >= 16 && ch >= 16).then_some((x0 as u32, y0 as u32, cw, ch))
}

/// `1580x1690` from ffmpeg's stream line (`Video: h264 (...), yuv420p, 1580x1690, ...`).
pub fn parse_video_size(stderr: &str) -> Option<(u32, u32)> {
    let line = stderr.lines().find(|l| l.contains("Video:"))?;
    line.split(|c: char| c == ',' || c.is_whitespace()).find_map(|tok| {
        let (a, b) = tok.split_once('x')?;
        let (w, h) = (a.parse::<u32>().ok()?, b.parse::<u32>().ok()?);
        (w >= 16 && h >= 16).then_some((w, h))
    })
}

/// Suffixes become file names: lowercase letters, digits and dashes only.
pub fn valid_suffix(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn video_size(bin: &Path, video: &Path) -> Result<(u32, u32), String> {
    let out = Command::new(bin)
        .args(["-hide_banner", "-i"])
        .arg(video)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    parse_video_size(&String::from_utf8_lossy(&out.stderr)).ok_or_else(|| "Could not read the video size.".into())
}

fn sibling(video: &Path, suffix: &str, ext: &str) -> Option<PathBuf> {
    let stem = video.file_stem()?.to_str()?;
    Some(video.with_file_name(format!("{stem}-{suffix}.{ext}")))
}

// Blocking ffmpeg work stays off the main thread.
#[tauri::command(async)]
pub fn recording_split(video_path: String, parts: Vec<SplitPart>) -> Result<Vec<String>, String> {
    let video = PathBuf::from(&video_path);
    if !video.is_file() {
        return Err("The recording file is missing.".into());
    }
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found.")?;
    let (width, height) = video_size(&bin, &video)?;
    // Camera and mic belong to the whole take: every part points at them.
    let media = std::fs::read(video.with_extension("interactions.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|j| j.get("media").cloned());
    let mut out = Vec::new();
    for mut part in parts {
        if !valid_suffix(&part.suffix) {
            return Err(format!("Invalid file suffix: {}", part.suffix));
        }
        let Some((x, y, w, h)) = crop_px(part.rect, width, height) else { continue };
        let (Some(target), Some(sidecar)) = (sibling(&video, &part.suffix, "mp4"), sibling(&video, &part.suffix, "interactions.json"))
        else {
            continue;
        };
        let status = Command::new(&bin)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&video)
            .args([
                "-vf",
                &format!("crop={w}:{h}:{x}:{y}"),
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "16",
                "-pix_fmt",
                "yuv420p",
                "-force_key_frames",
                super::capture::KEYFRAME_EVERY_SECOND,
                "-an",
                "-movflags",
                "+faststart",
            ])
            .arg(&target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("ffmpeg: {e}"))?;
        if !status.status.success() {
            return Err(format!("Splitting {} failed: {}", part.suffix, String::from_utf8_lossy(&status.stderr).trim()));
        }
        if let (Some(obj), Some(media)) = (part.journal.as_object_mut(), media.as_ref()) {
            obj.entry("media").or_insert_with(|| media.clone());
        }
        let json = serde_json::to_vec_pretty(&part.journal).map_err(|e| e.to_string())?;
        std::fs::write(&sidecar, json).map_err(|e| format!("write {}: {e}", sidecar.display()))?;
        out.push(target.to_string_lossy().into_owned());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crops_inside_the_frame_with_even_sizes() {
        let r = NormRect { x: 0.1, y: 0.2, width: 0.3001, height: 0.5 };
        let (x, y, w, h) = crop_px(r, 1000, 1001).unwrap();
        assert_eq!((x, y), (100, 200));
        assert_eq!(w % 2, 0);
        assert_eq!(h % 2, 0);
        assert!(x + w <= 1000 && y + h <= 1001);
    }

    #[test]
    fn clamps_rects_that_spill_out_and_drops_tiny_ones() {
        let spill = NormRect { x: 0.9, y: -0.1, width: 0.5, height: 0.5 };
        let (x, y, w, h) = crop_px(spill, 1000, 1000).unwrap();
        assert_eq!((x, y, w, h), (900, 0, 100, 400));
        assert!(crop_px(NormRect { x: 0.5, y: 0.5, width: 0.001, height: 0.5 }, 1000, 1000).is_none());
    }

    #[test]
    fn reads_the_size_from_ffmpeg_output() {
        let err = "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1580x1690 [SAR 1:1 DAR 158:169], 9013 kb/s, 60 fps";
        assert_eq!(parse_video_size(err), Some((1580, 1690)));
        assert_eq!(parse_video_size("no video here"), None);
    }

    #[test]
    fn suffixes_cannot_escape_the_folder() {
        assert!(valid_suffix("dev1-iphone-17-pro"));
        assert!(!valid_suffix("../x"));
        assert!(!valid_suffix("a/b"));
        assert!(!valid_suffix(""));
    }
}

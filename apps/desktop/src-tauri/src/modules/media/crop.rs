//! A rectangle of the recording at one instant, cut out as a PNG asset: the
//! editor pops it out of the screen as a floating layer. FFmpeg extracts the
//! frame shown at `t` and crops it in one pass; the file lands in
//! `<stem>.assets/` next to the recording, like any imported media.

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;
use tauri::State;

use super::{assets_dir, recording_path, ImportedAsset, MediaState};
use crate::modules::recording::ffmpeg;

/// A rectangle of the frame, in fractions of its width and height.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct FrameRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The smallest cut-out worth a layer: 1 % of a side.
const MIN_SIDE: f64 = 0.01;

/// A rectangle inside the frame, at least a sliver wide and tall.
pub fn check_rect(r: FrameRect) -> Result<FrameRect, String> {
    let ok = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
    if !(ok(r.x) && ok(r.y) && ok(r.w) && ok(r.h)) {
        return Err("The rectangle must be given in fractions of the frame (0 to 1).".into());
    }
    if r.w < MIN_SIDE || r.h < MIN_SIDE {
        return Err("The rectangle is too small to pop out.".into());
    }
    if r.x + r.w > 1.0 + 1e-6 || r.y + r.h > 1.0 + 1e-6 {
        return Err("The rectangle goes outside the frame.".into());
    }
    Ok(r)
}

/// `pop-<t in ms>-<n>.png`: the first `n` that is not taken yet.
pub fn pop_name(dir: &Path, t: f64, taken: impl Fn(&Path) -> bool) -> String {
    let ms = (t.max(0.0) * 1000.0).round() as u64;
    let mut n = 1;
    loop {
        let name = format!("pop-{ms}-{n}.png");
        if !taken(&dir.join(&name)) {
            return name;
        }
        n += 1;
    }
}

/// The frame shown at `t` (`fps=30:round=up`, like every other extraction,
/// so it is never the next one), cropped to `rect` in source pixels, one PNG.
pub fn crop_args(video: &Path, t: f64, rect: FrameRect, out: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-ss"].map(String::from).to_vec();
    args.push(format!("{:.3}", t.max(0.0)));
    args.push("-i".into());
    args.push(video.to_string_lossy().into_owned());
    args.extend(["-frames:v", "1", "-vf"].map(String::from));
    // Even sizes keep the PNG free of a half-pixel edge; `floor` on both
    // the offset and the size keeps the crop inside the frame.
    args.push(format!(
        "fps=30:round=up,crop=floor(iw*{w:.6}/2)*2:floor(ih*{h:.6}/2)*2:floor(iw*{x:.6}):floor(ih*{y:.6})",
        w = rect.w,
        h = rect.h,
        x = rect.x,
        y = rect.y
    ));
    args.push(out.to_string_lossy().into_owned());
    args
}

/// Cuts `rect` out of the frame at source time `t` into the recording's
/// assets folder and serves it: an image asset, ready for a layer.
#[tauri::command]
pub async fn recording_crop(
    state: State<'_, MediaState>,
    video_path: String,
    t: f64,
    rect: FrameRect,
) -> Result<ImportedAsset, String> {
    let video = recording_path(&video_path)?;
    let rect = check_rect(rect)?;
    if !t.is_finite() || t < 0.0 {
        return Err("The time must be a positive number of seconds.".into());
    }
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    let dir = assets_dir(&video);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let file = pop_name(&dir, t, |p| p.exists());
    let target = dir.join(&file);
    let args = crop_args(&video, t, rect, &target);
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(bin).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("run FFmpeg: {e}"))?;
    if !output.status.success() || !target.is_file() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg could not cut the frame out: {}", err.trim()));
    }
    let url = state.publish(target).await?;
    Ok(ImportedAsset {
        name: file.trim_end_matches(".png").to_string(),
        id: uuid::Uuid::new_v4().simple().to_string(),
        kind: "image",
        file,
        url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_rectangle_inside_the_frame() {
        assert!(check_rect(FrameRect { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }).is_ok());
        assert!(check_rect(FrameRect { x: 0.9, y: 0.0, w: 0.3, h: 0.4 }).is_err());
        assert!(check_rect(FrameRect { x: -0.1, y: 0.0, w: 0.3, h: 0.4 }).is_err());
        assert!(check_rect(FrameRect { x: 0.1, y: 0.0, w: 0.001, h: 0.4 }).is_err());
        assert!(check_rect(FrameRect { x: f64::NAN, y: 0.0, w: 0.3, h: 0.4 }).is_err());
    }

    #[test]
    fn asks_ffmpeg_for_the_frame_at_t_and_an_even_crop() {
        let args = crop_args(
            Path::new("/v.mp4"),
            2.5,
            FrameRect { x: 0.25, y: 0.5, w: 0.5, h: 0.25 },
            Path::new("/out.png"),
        )
        .join(" ");
        assert!(args.contains("-ss 2.500 -i /v.mp4 -frames:v 1 -vf fps=30:round=up,crop=floor(iw*0.500000/2)*2:floor(ih*0.250000/2)*2:floor(iw*0.250000):floor(ih*0.500000) /out.png"), "{args}");
    }

    #[test]
    fn names_the_file_after_its_time_without_overwriting() {
        let dir = Path::new("/assets");
        assert_eq!(pop_name(dir, 1.2345, |_| false), "pop-1235-1.png");
        let taken = |p: &Path| p.ends_with("pop-1235-1.png") || p.ends_with("pop-1235-2.png");
        assert_eq!(pop_name(dir, 1.2345, taken), "pop-1235-3.png");
    }
}

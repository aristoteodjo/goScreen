//! Where the face is in a camera take: for a list of source times, a frame
//! is extracted by FFmpeg and the eyes are found by the system's face
//! detector (Core Image on macOS), returned as fractions of the frame.
//!
//! Elsewhere the command fails with a clear message (MediaPipe later).

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Serialize;

use super::recording_path;
use crate::modules::recording::ffmpeg;

/// Frames are scaled to this width before detection: enough for eyes, fast.
const DETECT_WIDTH: u32 = 640;
/// At most this many times per call (one FFmpeg run each).
const MAX_TIMES: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Fraction {
    pub u: f64,
    pub v: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct FaceBox {
    pub u: f64,
    pub v: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceSample {
    pub t: f64,
    /// Midpoint of the eyes (or the upper third of the face box without eyes).
    pub eyes: Option<Fraction>,
    pub face: Option<FaceBox>,
}

/// A face found in an image, in pixels with the origin at the bottom left
/// (Core Image's convention).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Detected {
    pub width: f64,
    pub height: f64,
    pub bounds: (f64, f64, f64, f64),
    pub left_eye: Option<(f64, f64)>,
    pub right_eye: Option<(f64, f64)>,
}

/// The face is on the camera companion when there is one, else on the video.
pub fn face_source(video: &Path) -> PathBuf {
    let camera = video.with_extension("camera.mp4");
    if camera.is_file() {
        camera
    } else {
        video.to_path_buf()
    }
}

pub fn frame_args(video: &Path, t: f64, out: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-ss"].map(String::from).to_vec();
    args.push(format!("{:.3}", t.max(0.0)));
    args.push("-i".into());
    args.push(video.to_string_lossy().into_owned());
    args.extend(["-frames:v", "1", "-vf", &format!("scale={DETECT_WIDTH}:-2")].map(String::from));
    args.push(out.to_string_lossy().into_owned());
    args
}

/// Bottom-left pixel coordinates to top-left fractions of the frame.
pub fn to_fraction(x: f64, y: f64, width: f64, height: f64) -> Fraction {
    Fraction { u: (x / width).clamp(0.0, 1.0), v: (1.0 - y / height).clamp(0.0, 1.0) }
}

/// What the studio needs from a detection: eyes midpoint and face box.
pub fn sample_of(t: f64, found: Option<Detected>) -> FaceSample {
    let Some(d) = found else { return FaceSample { t, eyes: None, face: None } };
    let (x, y, w, h) = d.bounds;
    let top_left = to_fraction(x, y + h, d.width, d.height);
    let face = FaceBox {
        u: top_left.u,
        v: top_left.v,
        w: (w / d.width).clamp(0.0, 1.0),
        h: (h / d.height).clamp(0.0, 1.0),
    };
    let eyes = match (d.left_eye, d.right_eye) {
        (Some(a), Some(b)) => to_fraction((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0, d.width, d.height),
        (Some(a), None) | (None, Some(a)) => to_fraction(a.0, a.1, d.width, d.height),
        // Eyes sit about a third down the face box.
        (None, None) => Fraction { u: face.u + face.w / 2.0, v: face.v + face.h * 0.35 },
    };
    FaceSample { t, eyes: Some(eyes), face: Some(face) }
}

#[cfg(target_os = "macos")]
pub fn detect(image: &Path) -> Result<Option<Detected>, String> {
    use objc2_core_image::{
        CIDetector, CIDetectorAccuracy, CIDetectorAccuracyHigh, CIDetectorTypeFace, CIFaceFeature, CIImage,
    };
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSString, NSURL};

    let path = NSString::from_str(&image.to_string_lossy());
    let url = NSURL::fileURLWithPath(&path);
    // SAFETY: the Core Image calls take owned or static objects and return
    // retained ones; nothing outlives this function.
    unsafe {
        let Some(ci_image) = CIImage::imageWithContentsOfURL(&url) else {
            return Err(format!("{} could not be read as an image.", image.display()));
        };
        let extent = ci_image.extent();
        let (width, height) = (extent.size.width, extent.size.height);
        if width <= 0.0 || height <= 0.0 {
            return Err("The frame is empty.".into());
        }
        let accuracy: &AnyObject = CIDetectorAccuracyHigh;
        let options = NSDictionary::<NSString, AnyObject>::from_slices(&[CIDetectorAccuracy], &[accuracy]);
        let Some(detector) = CIDetector::detectorOfType_context_options(CIDetectorTypeFace, None, Some(&*options)) else {
            return Err("The face detector is not available.".into());
        };
        let features = detector.featuresInImage(&ci_image);
        // Sorted by confidence: the first face is the surest.
        let found: Vec<_> = features.iter().collect();
        let Some(face) = found.iter().find_map(|f| f.downcast_ref::<CIFaceFeature>()) else {
            return Ok(None);
        };
        let b = face.bounds();
        let eye = |has: bool, p: objc2_core_foundation::CGPoint| has.then_some((p.x, p.y));
        Ok(Some(Detected {
            width,
            height,
            bounds: (b.origin.x, b.origin.y, b.size.width, b.size.height),
            left_eye: eye(face.hasLeftEyePosition(), face.leftEyePosition()),
            right_eye: eye(face.hasRightEyePosition(), face.rightEyePosition()),
        }))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn detect(_image: &Path) -> Result<Option<Detected>, String> {
    Err("Face detection needs macOS (the system's face detector). MediaPipe is planned for other systems.".into())
}

/// Eyes and face box at each time, in fractions of the camera frame.
#[tauri::command(async)]
pub fn media_face_eyes(video_path: String, times: Vec<f64>) -> Result<Vec<FaceSample>, String> {
    let video = recording_path(&video_path)?;
    if times.len() > MAX_TIMES {
        return Err(format!("At most {MAX_TIMES} times per call."));
    }
    if !cfg!(target_os = "macos") {
        return Err("Face detection needs macOS (the system's face detector). MediaPipe is planned for other systems.".into());
    }
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg).")?;
    let source = face_source(&video);
    let dir = std::env::temp_dir().join(format!("goscreen-face-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let mut out = Vec::with_capacity(times.len());
    for (i, t) in times.iter().enumerate() {
        let frame = dir.join(format!("frame-{i}.png"));
        let status = Command::new(&bin)
            .args(frame_args(&source, *t, &frame))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("extract a frame: {e}"))?;
        let found = if status.success() && frame.is_file() { detect(&frame)? } else { None };
        out.push(sample_of(*t, found));
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_core_image_coordinates_to_top_left_fractions() {
        // A 640x360 frame, face box 200 px wide from x=220, 200 px tall from y=80 (bottom-left).
        let d = Detected {
            width: 640.0,
            height: 360.0,
            bounds: (220.0, 80.0, 200.0, 200.0),
            left_eye: Some((280.0, 220.0)),
            right_eye: Some((360.0, 220.0)),
        };
        let s = sample_of(2.5, Some(d));
        assert_eq!(s.t, 2.5);
        let eyes = s.eyes.unwrap();
        assert!((eyes.u - 0.5).abs() < 1e-9);
        assert!((eyes.v - (1.0 - 220.0 / 360.0)).abs() < 1e-9);
        let face = s.face.unwrap();
        assert!((face.u - 220.0 / 640.0).abs() < 1e-9);
        assert!((face.v - (1.0 - 280.0 / 360.0)).abs() < 1e-9);
        assert!((face.w - 200.0 / 640.0).abs() < 1e-9);
        assert!((face.h - 200.0 / 360.0).abs() < 1e-9);
    }

    #[test]
    fn guesses_the_eyes_from_the_box_when_they_are_not_seen() {
        let d = Detected { width: 100.0, height: 100.0, bounds: (40.0, 40.0, 20.0, 20.0), left_eye: None, right_eye: None };
        let eyes = sample_of(0.0, Some(d)).eyes.unwrap();
        assert!((eyes.u - 0.5).abs() < 1e-9);
        assert!((eyes.v - (0.4 + 0.2 * 0.35)).abs() < 1e-9);
        assert_eq!(sample_of(1.0, None), FaceSample { t: 1.0, eyes: None, face: None });
    }

    /// Needs FFmpeg and macOS: the system detector runs on a plain image and sees no face.
    #[test]
    #[ignore]
    fn the_detector_runs_on_a_frame_without_a_face() {
        let dir = std::env::temp_dir().join(format!("goscreen-face-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let frame = dir.join("gray.png");
        let bin = ffmpeg::locate().expect("ffmpeg");
        let ok = Command::new(bin)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x240", "-frames:v", "1"])
            .arg(&frame)
            .status()
            .unwrap()
            .success();
        assert!(ok);
        assert_eq!(detect(&frame).unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn asks_ffmpeg_for_one_small_frame() {
        let args = frame_args(Path::new("/v.mp4"), 3.14159, Path::new("/f.png")).join(" ");
        assert!(args.contains("-ss 3.142 -i /v.mp4 -frames:v 1 -vf scale=640:-2 /f.png"));
        assert_eq!(face_source(Path::new("/nope/take.mp4")), PathBuf::from("/nope/take.mp4"));
    }
}

//! Webcam and microphone, recorded by a second FFmpeg next to the screen
//! capture. They stay separate files so the editor can place, resize or
//! hide the camera and mix the voice after the fact.

use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CaptureDevice {
    pub index: u32,
    pub name: String,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct CaptureDevices {
    pub cameras: Vec<CaptureDevice>,
    pub microphones: Vec<CaptureDevice>,
}

/// `ffmpeg -f avfoundation -list_devices true -i ""`: cameras are the video
/// devices that are not screens.
pub fn parse_avfoundation_devices(listing: &str) -> CaptureDevices {
    let mut out = CaptureDevices::default();
    let mut audio = false;
    for line in listing.lines() {
        if line.contains("AVFoundation audio devices") {
            audio = true;
            continue;
        }
        if line.contains("AVFoundation video devices") {
            audio = false;
            continue;
        }
        // "[AVFoundation indev @ 0x1] [0] FaceTime HD Camera"
        let Some((_, rest)) = line.split_once("] ") else { continue };
        let Some((idx, name)) = rest.strip_prefix('[').and_then(|r| r.split_once(']')) else { continue };
        let Ok(index) = idx.trim().parse() else { continue };
        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        if audio {
            out.microphones.push(CaptureDevice { index, name });
        } else if !name.starts_with("Capture screen") {
            out.cameras.push(CaptureDevice { index, name });
        }
    }
    out
}

pub struct Outputs {
    pub camera: Option<PathBuf>,
    pub mic: Option<PathBuf>,
}

/// Camera and microphone, recorded to `<stem>.camera.mp4` and `<stem>.mic.m4a`.
///
/// Each gets its own avfoundation input with a deep queue: sharing one input,
/// a slow camera encode made avfoundation drop audio packets (~13% of the
/// voice lost, drifting out of sync). The audio is also re-timed on its
/// capture timestamps, so any gap that still happens becomes silence instead
/// of shifting everything after it.
///
/// The studio now records the mic natively (`media::mic`): avfoundation lost
/// samples even on its own input. Only the camera still goes through here.
pub fn companion_args(camera: Option<u32>, mic: Option<u32>, video: &Path) -> Option<(Vec<String>, Outputs)> {
    if camera.is_none() && mic.is_none() {
        return None;
    }
    let cam_out = camera.map(|_| video.with_extension("camera.mp4"));
    let mic_out = mic.map(|_| video.with_extension("mic.m4a"));
    let mut args: Vec<String> = ["-hide_banner", "-y"].map(String::from).to_vec();
    if let Some(c) = camera {
        args.extend(["-thread_queue_size", "1024", "-f", "avfoundation", "-framerate", "30", "-i"].map(String::from));
        args.push(format!("{c}:none"));
    }
    if let Some(m) = mic {
        args.extend(["-thread_queue_size", "4096", "-f", "avfoundation", "-i"].map(String::from));
        args.push(format!("none:{m}"));
    }
    if let Some(out) = &cam_out {
        args.extend(
            ["-map", "0:v", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-force_key_frames", super::capture::KEYFRAME_EVERY_SECOND, "-movflags", "+faststart"]
                .map(String::from),
        );
        args.push(out.to_string_lossy().into_owned());
    }
    if let Some(out) = &mic_out {
        let input = if camera.is_some() { "1:a" } else { "0:a" };
        args.extend(["-map", input, "-af", "aresample=async=1:first_pts=0", "-c:a", "aac", "-b:a", "160k"].map(String::from));
        args.push(out.to_string_lossy().into_owned());
    }
    Some((args, Outputs { camera: cam_out, mic: mic_out }))
}

pub fn spawn(bin: &Path, args: &[String]) -> std::io::Result<Child> {
    Command::new(bin)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = "[AVFoundation indev @ 0x1] AVFoundation video devices:\n\
        [AVFoundation indev @ 0x1] [0] FaceTime HD Camera\n\
        [AVFoundation indev @ 0x1] [4] Capture screen 0\n\
        [AVFoundation indev @ 0x1] AVFoundation audio devices:\n\
        [AVFoundation indev @ 0x1] [2] MacBook Pro Microphone\n\
        [in#0 @ 0x2] Error opening input: Input/output error\n";

    #[test]
    fn lists_cameras_and_microphones_without_screens() {
        let d = parse_avfoundation_devices(LISTING);
        assert_eq!(d.cameras, vec![CaptureDevice { index: 0, name: "FaceTime HD Camera".into() }]);
        assert_eq!(d.microphones, vec![CaptureDevice { index: 2, name: "MacBook Pro Microphone".into() }]);
    }

    #[test]
    fn records_camera_and_mic_on_separate_inputs() {
        let (args, out) = companion_args(Some(0), Some(2), Path::new("/m/rec.mp4")).unwrap();
        let joined = args.join(" ");
        assert!(joined.contains("-framerate 30 -i 0:none"));
        assert!(joined.contains("-thread_queue_size 4096 -f avfoundation -i none:2"));
        assert!(joined.contains("-map 0:v") && joined.contains("/m/rec.camera.mp4"));
        assert!(joined.ends_with("-map 1:a -af aresample=async=1:first_pts=0 -c:a aac -b:a 160k /m/rec.mic.m4a"));
        assert_eq!(out.mic, Some(PathBuf::from("/m/rec.mic.m4a")));

        let (mic_only, out) = companion_args(None, Some(2), Path::new("/m/rec.mp4")).unwrap();
        assert!(mic_only.join(" ").contains("-i none:2"));
        assert!(mic_only.join(" ").contains("-map 0:a"));
        assert!(!mic_only.contains(&"-framerate".to_string()));
        assert!(out.camera.is_none());
        assert!(companion_args(None, None, Path::new("/m/rec.mp4")).is_none());
    }
}

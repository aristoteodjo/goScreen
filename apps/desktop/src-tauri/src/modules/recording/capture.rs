//! Per-OS screen capture inputs for FFmpeg. Everything here is pure so the
//! argument building is testable without a display.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl PixelRect {
    /// H.264 with yuv420p needs even dimensions.
    pub fn even(self) -> Self {
        Self {
            width: self.width & !1,
            height: self.height & !1,
            ..self
        }
    }
}

/// Part of a window to record: points in the window's own space, plus the
/// output size in pixels (even, for yuv420p).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub pixel_width: u32,
    pub pixel_height: u32,
}

/// `region` is in webview CSS px; `content_offset` is where the webview
/// starts inside the window frame, in points (a title bar, if any).
pub fn window_crop(region: (f64, f64, f64, f64), content_offset: (f64, f64), scale: f64) -> WindowCrop {
    let (x, y, width, height) = region;
    let even = |v: f64| ((v * scale).round() as u32 & !1).max(2);
    WindowCrop {
        x: x + content_offset.0,
        y: y + content_offset.1,
        width,
        height,
        pixel_width: even(width),
        pixel_height: even(height),
    }
}

pub trait ScreenCaptureProvider {
    /// FFmpeg input arguments plus an optional crop filter when the device
    /// can only grab whole screens.
    fn input(&self, rect: PixelRect, fps: u32, show_cursor: bool) -> (Vec<String>, Option<String>);
}

#[cfg(any(target_os = "macos", test))]
pub struct AvFoundation {
    pub screen_index: u32,
}

#[cfg(any(target_os = "macos", test))]
impl ScreenCaptureProvider for AvFoundation {
    fn input(&self, rect: PixelRect, fps: u32, show_cursor: bool) -> (Vec<String>, Option<String>) {
        let args = vec![
            "-f".into(),
            "avfoundation".into(),
            "-framerate".into(),
            fps.to_string(),
            "-capture_cursor".into(),
            if show_cursor { "1" } else { "0" }.into(),
            "-i".into(),
            format!("{}:none", self.screen_index),
        ];
        let crop = format!("crop={}:{}:{}:{}", rect.width, rect.height, rect.x, rect.y);
        (args, Some(crop))
    }
}

#[cfg(any(target_os = "windows", test))]
pub struct GdiGrab;

#[cfg(any(target_os = "windows", test))]
impl ScreenCaptureProvider for GdiGrab {
    fn input(&self, rect: PixelRect, fps: u32, show_cursor: bool) -> (Vec<String>, Option<String>) {
        let args = vec![
            "-f".into(),
            "gdigrab".into(),
            "-framerate".into(),
            fps.to_string(),
            "-draw_mouse".into(),
            if show_cursor { "1" } else { "0" }.into(),
            "-offset_x".into(),
            rect.x.to_string(),
            "-offset_y".into(),
            rect.y.to_string(),
            "-video_size".into(),
            format!("{}x{}", rect.width, rect.height),
            "-i".into(),
            "desktop".into(),
        ];
        (args, None)
    }
}

#[cfg(target_os = "linux")]
pub struct X11Grab;

#[cfg(target_os = "linux")]
impl ScreenCaptureProvider for X11Grab {
    fn input(&self, rect: PixelRect, fps: u32, show_cursor: bool) -> (Vec<String>, Option<String>) {
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
        let args = vec![
            "-f".into(),
            "x11grab".into(),
            "-framerate".into(),
            fps.to_string(),
            "-draw_mouse".into(),
            if show_cursor { "1" } else { "0" }.into(),
            "-video_size".into(),
            format!("{}x{}", rect.width, rect.height),
            "-i".into(),
            format!("{display}+{},{}", rect.x, rect.y),
        ];
        (args, None)
    }
}

#[cfg(any(target_os = "macos", test))]
/// Finds the avfoundation index of "Capture screen 0" in
/// `ffmpeg -f avfoundation -list_devices true -i ""` output.
pub fn parse_avfoundation_screen(listing: &str) -> Option<u32> {
    listing.lines().find_map(|line| {
        let idx = line.find("Capture screen 0")?;
        let head = &line[..idx];
        let open = head.rfind('[')?;
        let close = head[open..].find(']')? + open;
        head[open + 1..close].trim().parse().ok()
    })
}

pub fn encode_args(
    input: (Vec<String>, Option<String>),
    output: &str,
    still: bool,
) -> Vec<String> {
    let (mut args, crop) = input;
    args.splice(0..0, ["-hide_banner".to_string(), "-y".to_string()]);
    if let Some(filter) = crop {
        args.push("-vf".into());
        args.push(filter);
    }
    if still {
        args.extend(["-frames:v", "1"].map(String::from));
    } else {
        args.extend(
            [
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
            ]
            .map(String::from),
        );
    }
    args.push(output.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_rounds_down_to_even() {
        let r = PixelRect { x: 1, y: 2, width: 801, height: 599 }.even();
        assert_eq!((r.width, r.height), (800, 598));
    }

    #[test]
    fn window_crop_offsets_and_scales() {
        let c = window_crop((10.0, 20.0, 300.5, 201.0), (0.0, 28.0), 2.0);
        assert_eq!((c.x, c.y, c.width, c.height), (10.0, 48.0, 300.5, 201.0));
        assert_eq!((c.pixel_width, c.pixel_height), (600, 402));
        let tiny = window_crop((0.0, 0.0, 0.2, 0.2), (0.0, 0.0), 1.0);
        assert_eq!((tiny.pixel_width, tiny.pixel_height), (2, 2));
    }

    #[test]
    fn finds_screen_index() {
        let listing = "[AVFoundation indev @ 0x1] AVFoundation video devices:\n\
                       [AVFoundation indev @ 0x1] [0] FaceTime HD Camera\n\
                       [AVFoundation indev @ 0x1] [2] Capture screen 0\n";
        assert_eq!(parse_avfoundation_screen(listing), Some(2));
        assert_eq!(parse_avfoundation_screen("nothing"), None);
    }

    #[test]
    fn avfoundation_crops_and_encodes() {
        let rect = PixelRect { x: 10, y: 20, width: 100, height: 50 };
        let args = encode_args(AvFoundation { screen_index: 1 }.input(rect, 60, false), "out.mp4", false);
        let joined = args.join(" ");
        assert!(joined.contains("-i 1:none"));
        assert!(joined.contains("-vf crop=100:50:10:20"));
        assert!(joined.ends_with("+faststart out.mp4"));
    }

    #[test]
    fn still_capture_takes_one_frame() {
        let rect = PixelRect { x: 0, y: 0, width: 10, height: 10 };
        let args = encode_args(GdiGrab.input(rect, 30, true), "shot.png", true);
        assert!(args.join(" ").contains("-frames:v 1 shot.png"));
        assert!(!args.contains(&"libx264".to_string()));
    }
}

mod capture;
mod companion;
pub mod commands;
pub(crate) mod ffmpeg;

pub use commands::{capture_devices, orphan, shutdown, ffmpeg_status, recording_start, recording_stop, screenshot_capture, RecordingState};

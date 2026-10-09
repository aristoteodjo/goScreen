//! ScreenCaptureKit capture of the goScreen window alone (macOS 15+).
//!
//! Unlike a screen grab, a window filter records the window's own pixels:
//! another app, a notification or a menu over goScreen never reaches the
//! video, and the window may sit on any display. Frames are encoded by the
//! system (VideoToolbox) straight into the MP4.

use std::{
    path::Path,
    sync::mpsc,
    time::{Duration, Instant},
};

use screencapturekit::prelude::*;
use screencapturekit::recording_output::{
    RecordingCallbacks, SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputFileType,
};
use screencapturekit::screenshot_manager::SCScreenshotManager;
use screencapturekit::stream::configuration::SCCaptureResolutionType;

use super::capture::WindowCrop;
use super::permissions;

const START_TIMEOUT: Duration = Duration::from_secs(6);
const FINISH_TIMEOUT: Duration = Duration::from_secs(8);

pub fn available() -> bool {
    SCRecordingOutput::is_available()
}

/// The main window of this process: the largest normal-layer window it owns.
fn own_window() -> Result<SCWindow, String> {
    let content = SCShareableContent::get().map_err(|_| permissions::no_frames_message())?;
    let pid = std::process::id() as i32;
    content
        .windows()
        .into_iter()
        .filter(|w| w.window_layer() == 0 && w.owning_application().is_some_and(|a| a.process_id() == pid))
        .max_by(|a, b| {
            let area = |w: &SCWindow| w.frame().size.width * w.frame().size.height;
            area(a).total_cmp(&area(b))
        })
        .ok_or_else(|| "The goScreen window is not available for capture.".into())
}

fn configuration(crop: &WindowCrop, fps: u32) -> SCStreamConfiguration {
    SCStreamConfiguration::new()
        .with_width(crop.pixel_width)
        .with_height(crop.pixel_height)
        .with_source_rect(CGRect::new(crop.x, crop.y, crop.width, crop.height))
        .with_shows_cursor(false)
        .with_ignores_shadows_single_window(true)
        .with_capture_resolution_type(SCCaptureResolutionType::Best)
        .with_minimum_frame_interval(&CMTime::new(1, fps as i32))
}

pub struct Recording {
    stream: SCStream,
    output: SCRecordingOutput,
    finished: mpsc::Receiver<Result<(), String>>,
}

/// Starts recording `crop` of the goScreen window into `path`. Returns once
/// the first frame is written, with that instant (time zero of the video).
pub fn start(crop: &WindowCrop, fps: u32, path: &Path) -> Result<(Recording, Instant), String> {
    let window = own_window()?;
    let filter = SCContentFilter::create().with_window(&window).build();
    let stream = SCStream::new(&filter, &configuration(crop, fps));

    let (started_tx, started) = mpsc::channel::<Result<Instant, String>>();
    let (finished_tx, finished) = mpsc::channel::<Result<(), String>>();
    let fail_start = started_tx.clone();
    let fail_finish = finished_tx.clone();
    let callbacks = RecordingCallbacks::new()
        .on_start(move || {
            let _ = started_tx.send(Ok(Instant::now()));
        })
        .on_fail(move |error| {
            let _ = fail_start.send(Err(error.clone()));
            let _ = fail_finish.send(Err(error));
        })
        .on_finish(move || {
            let _ = finished_tx.send(Ok(()));
        });

    let config = SCRecordingOutputConfiguration::new()
        .with_output_url(path)
        .with_video_codec(SCRecordingOutputCodec::H264)
        .with_output_file_type(SCRecordingOutputFileType::MP4);
    let output = SCRecordingOutput::new_with_delegate(&config, callbacks)
        .ok_or("Window recording is unavailable on this macOS version.")?;

    stream.add_recording_output(&output).map_err(|e| format!("capture: {e}"))?;
    stream.start_capture().map_err(|_| permissions::no_frames_message())?;

    match started.recv_timeout(START_TIMEOUT) {
        Ok(Ok(at)) => Ok((Recording { stream, output, finished }, at)),
        Ok(Err(e)) => {
            let _ = stream.stop_capture();
            Err(format!("Recording failed to start: {e}"))
        }
        Err(_) => {
            let _ = stream.stop_capture();
            Err(permissions::no_frames_message())
        }
    }
}

impl Recording {
    /// Stops the stream and waits until the MP4 is finalized.
    pub fn finish(self) -> Result<(), String> {
        // Removing the only output stops the capture and flushes the file.
        let _ = self.stream.remove_recording_output(&self.output);
        let _ = self.stream.stop_capture();
        match self.finished.recv_timeout(FINISH_TIMEOUT) {
            Ok(result) => result,
            Err(_) => Err("The recording did not finish writing in time.".into()),
        }
    }
}

/// One PNG of `crop`, from the window alone.
pub fn screenshot(crop: &WindowCrop, path: &Path) -> Result<(), String> {
    let window = own_window()?;
    let filter = SCContentFilter::create().with_window(&window).build();
    let image = SCScreenshotManager::capture_image(&filter, &configuration(crop, 30))
        .map_err(|_| permissions::no_frames_message())?;
    image.save_png(path).map_err(|e| format!("Screenshot failed: {e}"))
}

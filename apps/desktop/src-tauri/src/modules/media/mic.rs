//! Native microphone capture (CoreAudio through cpal). FFmpeg's avfoundation
//! input loses about a tenth of the samples on some Macs, which makes a voice
//! choppy and hard to follow; here every sample reaches a WAV file.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub struct MicCapture {
    stop: Arc<AtomicBool>,
    written: Arc<AtomicU64>,
    rate: u32,
    thread: Option<JoinHandle<Result<(), String>>>,
}

impl MicCapture {
    /// Seconds of sound written so far.
    pub fn seconds(&self) -> f64 {
        self.written.load(Ordering::SeqCst) as f64 / self.rate.max(1) as f64
    }

    /// Stops the mic and closes the file.
    pub fn finish(mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::SeqCst);
        match self.thread.take().map(|t| t.join()) {
            Some(Ok(result)) => result,
            Some(Err(_)) => Err("The microphone stopped unexpectedly.".into()),
            None => Ok(()),
        }
    }
}

impl Drop for MicCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// The input device with this name, else the system's default input.
fn device(name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(name) = name.filter(|n| !n.is_empty()) {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(d) = devices.find(|d| d.name().map(|n| n == name).unwrap_or(false)) {
                return Ok(d);
            }
        }
    }
    host.default_input_device().ok_or_else(|| "No microphone is connected.".to_string())
}

/// Average of the channels of each frame, as f32.
pub fn downmix<T: Copy>(data: &[T], channels: usize, to_f32: impl Fn(T) -> f32) -> Vec<f32> {
    let channels = channels.max(1);
    data.chunks(channels)
        .map(|frame| frame.iter().map(|&s| to_f32(s)).sum::<f32>() / frame.len() as f32)
        .collect()
}

fn build_stream(device: &cpal::Device, config: &cpal::SupportedStreamConfig, tx: mpsc::Sender<Vec<f32>>) -> Result<cpal::Stream, String> {
    let channels = config.channels() as usize;
    let stream_config: cpal::StreamConfig = config.clone().into();
    let err = |e| log::warn!("microphone stream: {e}");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(downmix(data, channels, |s| s));
            },
            err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(downmix(data, channels, |s| s as f32 / 32768.0));
            },
            err,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            &stream_config,
            move |data: &[i32], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(downmix(data, channels, |s| s as f32 / 2_147_483_648.0));
            },
            err,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(downmix(data, channels, |s| (s as f32 - 32768.0) / 32768.0));
            },
            err,
            None,
        ),
        other => return Err(format!("Unsupported microphone format: {other:?}")),
    };
    stream.map_err(|e| format!("open the microphone: {e}"))
}

/// Starts recording to a mono 32-bit float WAV; returns once the first
/// samples are written.
pub fn start(name: Option<&str>, out: &Path, timeout: Duration) -> Result<MicCapture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let written = Arc::new(AtomicU64::new(0));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    let name = name.map(str::to_string);
    let out = out.to_path_buf();
    let (stop_t, written_t) = (stop.clone(), written.clone());

    // The stream lives on its own thread: it is not Send on every platform.
    let thread = std::thread::spawn(move || -> Result<(), String> {
        let setup = (|| {
            let device = device(name.as_deref())?;
            let config = device.default_input_config().map_err(|e| format!("read the microphone: {e}"))?;
            let rate = config.sample_rate().0;
            let (tx, rx) = mpsc::channel::<Vec<f32>>();
            let stream = build_stream(&device, &config, tx)?;
            stream.play().map_err(|e| format!("start the microphone: {e}"))?;
            let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
            let writer = hound::WavWriter::create(&out, spec).map_err(|e| format!("create {}: {e}", out.display()))?;
            Ok::<_, String>((stream, rx, writer, rate))
        })();
        let (stream, rx, mut writer, rate) = match setup {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(e.clone()));
                return Err(e);
            }
        };
        let mut announced = false;
        let mut write = |buf: Vec<f32>| -> Result<(), String> {
            for s in &buf {
                writer.write_sample(*s).map_err(|e| e.to_string())?;
            }
            written_t.fetch_add(buf.len() as u64, Ordering::SeqCst);
            Ok(())
        };
        while !stop_t.load(Ordering::SeqCst) {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(buf) => {
                    write(buf)?;
                    if !announced {
                        let _ = ready_tx.send(Ok(rate));
                        announced = true;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        drop(stream);
        for buf in rx.try_iter() {
            write(buf)?;
        }
        writer.finalize().map_err(|e| e.to_string())
    });

    match ready_rx.recv_timeout(timeout) {
        Ok(Ok(rate)) => Ok(MicCapture { stop, written, rate, thread: Some(thread) }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            let _ = thread.join();
            Err("The microphone sent no sound. Check System Settings, Privacy & Security, Microphone.".into())
        }
    }
}

/// Loudest level the microphone hears over a short listen, in dB (-91 for
/// pure digital silence, as a virtual or withheld device gives).
pub fn level(name: Option<&str>, listen: Duration) -> Result<f64, String> {
    let device = device(name)?;
    let config = device.default_input_config().map_err(|e| format!("read the microphone: {e}"))?;
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let stream = build_stream(&device, &config, tx)?;
    stream.play().map_err(|e| format!("start the microphone: {e}"))?;
    let end = Instant::now() + listen;
    let mut peak = 0f32;
    while Instant::now() < end {
        if let Ok(buf) = rx.recv_timeout(Duration::from_millis(50)) {
            peak = buf.iter().fold(peak, |p, s| p.max(s.abs()));
        }
    }
    drop(stream);
    Ok(peak_db(peak))
}

pub fn peak_db(peak: f32) -> f64 {
    if peak <= 0.0 {
        -91.0
    } else {
        (20.0 * (peak as f64).log10()).max(-91.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixes_channels_down_to_mono() {
        assert_eq!(downmix(&[0.5f32, -0.5, 1.0, 0.0], 2, |s| s), vec![0.0, 0.5]);
        assert_eq!(downmix(&[16384i16, -16384], 1, |s| s as f32 / 32768.0), vec![0.5, -0.5]);
    }

    /// Needs a live microphone: `cargo test -- --ignored keeps_every_sample`.
    #[test]
    #[ignore]
    fn keeps_every_sample() {
        let out = std::env::temp_dir().join("goscreen-mic-test.wav");
        let capture = start(Some("MacBook Pro Microphone"), &out, Duration::from_secs(6)).unwrap();
        let began = Instant::now() - Duration::from_secs_f64(capture.seconds());
        std::process::Command::new("say").args(["-v", "Thomas", "Un, deux, trois, quatre, cinq, six, sept, huit"]).status().ok();
        std::thread::sleep(Duration::from_millis(500));
        let wall = began.elapsed().as_secs_f64();
        capture.finish().unwrap();
        let reader = hound::WavReader::open(&out).unwrap();
        let secs = reader.duration() as f64 / reader.spec().sample_rate as f64;
        println!("wall {wall:.3}s, recorded {secs:.3}s");
        assert!((wall - secs).abs() < 0.1, "lost sound: wall {wall:.3}, recorded {secs:.3}");
    }

    #[test]
    fn reads_levels_in_decibels() {
        assert_eq!(peak_db(0.0), -91.0);
        assert!((peak_db(1.0)).abs() < 1e-9);
        assert!((peak_db(0.1) + 20.0).abs() < 1e-6);
    }
}

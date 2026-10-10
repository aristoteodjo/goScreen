use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::ffmpeg;

// A laptop mic records narration far too quietly (around -35 dB mean) with
// room hum. Every take's voice is cleaned once into `<stem>.mic.m4a`; the
// untouched capture stays next to it as `<stem>.mic.raw.m4a`.

/// Re-time on capture timestamps (dropped packets become silence, not drift),
/// cut rumble, light denoise, even out, then loudness to -16 LUFS (web video).
pub const VOICE_CHAIN: &str = "aresample=async=1:first_pts=0,highpass=f=80,afftdn=nf=-30:tn=1,\
acompressor=threshold=-24dB:ratio=3:attack=5:release=120:makeup=4,\
loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000";

pub fn raw_path(mic: &Path) -> PathBuf {
    let name = mic.file_name().map(|n| n.to_string_lossy().replace(".mic.m4a", ".mic.raw.m4a"));
    mic.with_file_name(name.unwrap_or_else(|| "mic.raw.m4a".into()))
}

pub fn enhance_args(raw: &Path, out: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-i"].map(String::from).to_vec();
    args.push(raw.to_string_lossy().into_owned());
    args.extend(["-af", VOICE_CHAIN, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(String::from));
    args.push(out.to_string_lossy().into_owned());
    args
}

/// Cleans the voice of a take once. Does nothing if it was already done or
/// there is no mic; on failure the original stays in place.
pub fn ensure_enhanced(mic: &Path) -> Result<(), String> {
    let raw = raw_path(mic);
    if !mic.is_file() || raw.is_file() {
        return Ok(());
    }
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found.")?;
    std::fs::rename(mic, &raw).map_err(|e| format!("keep raw voice: {e}"))?;
    let out = Command::new(bin)
        .args(enhance_args(&raw, mic))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    let ok = matches!(&out, Ok(o) if o.status.success()) && mic.metadata().map(|m| m.len() > 0).unwrap_or(false);
    if !ok {
        let _ = std::fs::remove_file(mic);
        let _ = std::fs::rename(&raw, mic);
        let detail = out.map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string()).unwrap_or_else(|e| e.to_string());
        return Err(format!("Voice cleanup failed: {detail}"));
    }
    Ok(())
}

/// Loudest sample of `volumedetect` output, in dB.
pub fn peak_db(stderr: &str) -> Option<f64> {
    let line = stderr.lines().find(|l| l.contains("max_volume:"))?;
    line.split("max_volume:").nth(1)?.trim().trim_end_matches("dB").trim().parse().ok()
}

/// A mic that is listed but not live (an iPhone through Continuity, a virtual
/// meeting device) records pure digital silence: -91 dB, the AAC floor. A
/// quiet room is still around -60 dB, so -85 never flags a real take.
pub const SILENT_DB: f64 = -85.0;

/// True when the capture holds no sound at all; false if it cannot be read.
pub fn is_silent(mic: &Path) -> bool {
    let Some(bin) = ffmpeg::locate() else { return false };
    let raw = raw_path(mic);
    let input = if raw.is_file() { raw } else { mic.to_path_buf() };
    let out = Command::new(bin)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(&input)
        .args(["-af", "volumedetect", "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    let Ok(out) = out else { return false };
    peak_db(&String::from_utf8_lossy(&out.stderr)).is_some_and(|db| db <= SILENT_DB)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_peak_of_volumedetect() {
        let log = "[Parsed_volumedetect_0 @ 0x1] mean_volume: -91.0 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -91.0 dB\n";
        assert_eq!(peak_db(log), Some(-91.0));
        assert!(peak_db(log).unwrap() <= SILENT_DB);
        assert!(peak_db("max_volume: -31.8 dB").unwrap() > SILENT_DB);
        assert_eq!(peak_db("no stats"), None);
    }

    #[test]
    fn keeps_the_raw_capture_next_to_the_take() {
        assert_eq!(raw_path(Path::new("/m/goscreen-1.mic.m4a")), PathBuf::from("/m/goscreen-1.mic.raw.m4a"));
    }

    #[test]
    fn retimes_before_anything_else() {
        let args = enhance_args(Path::new("/m/a.mic.raw.m4a"), Path::new("/m/a.mic.m4a"));
        let chain = &args[args.iter().position(|a| a == "-af").unwrap() + 1];
        assert!(chain.starts_with("aresample=async=1"));
        assert!(chain.contains("loudnorm=I=-16"));
        assert_eq!(args.last().unwrap(), "/m/a.mic.m4a");
    }
}

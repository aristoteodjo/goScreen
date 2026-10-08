//! Tap sound effects, synthesized so no audio asset ships with the app.

pub const SAMPLE_RATE: u32 = 48_000;

/// A short, soft click: a decaying 2.2 kHz tick over a breath of noise.
pub fn click_samples() -> Vec<i16> {
    let len = (SAMPLE_RATE as f32 * 0.06) as usize;
    let mut seed: u32 = 0x2545_F491;
    (0..len)
        .map(|i| {
            let t = i as f32 / SAMPLE_RATE as f32;
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = (seed >> 9) as f32 / (1u32 << 23) as f32 * 2.0 - 1.0;
            let tick = (t * 2200.0 * std::f32::consts::TAU).sin() * (-t * 90.0).exp();
            let breath = noise * (-t * 160.0).exp() * 0.35;
            ((tick + breath) * 0.8 * i16::MAX as f32) as i16
        })
        .collect()
}

/// 16-bit mono PCM WAV file bytes.
pub fn wav(samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// Microphone track placement in the export.
pub struct MicMix {
    /// Input index of the mic file in the FFmpeg command.
    pub input: usize,
    /// Mic start relative to the first screen frame (can be negative).
    pub offset_ms: f64,
    /// Trim start of the export, in source milliseconds.
    pub trim_start_ms: f64,
    pub volume: f64,
}

/// filter_complex for the export soundtrack: one click (input 1) at each
/// tap time and/or the microphone aligned on the trimmed video, padded with
/// silence so `-shortest` lets the video decide the length.
pub fn mix_filter(clicks_ms: &[u64], volume: f64, mic: Option<&MicMix>) -> Option<String> {
    let volume = volume.clamp(0.0, 1.0);
    let mut parts: Vec<String> = Vec::new();
    let mut labels: Vec<&str> = Vec::new();

    match clicks_ms {
        [] => {}
        [one] => {
            parts.push(format!("[1:a]adelay={one}|{one},volume={volume:.3}[clk]"));
            labels.push("[clk]");
        }
        many => {
            let n = many.len();
            let split: String = (0..n).map(|i| format!("[s{i}]")).collect();
            let mut f = format!("[1:a]asplit={n}{split}");
            for (i, ms) in many.iter().enumerate() {
                f.push_str(&format!(";[s{i}]adelay={ms}|{ms}[d{i}]"));
            }
            let delayed: String = (0..n).map(|i| format!("[d{i}]")).collect();
            f.push_str(&format!(
                ";{delayed}amix=inputs={n}:normalize=0:dropout_transition=0,volume={volume:.3}[clk]"
            ));
            parts.push(f);
            labels.push("[clk]");
        }
    }

    if let Some(m) = mic {
        // Where the mic sits on the exported timeline.
        let shift = m.offset_ms - m.trim_start_ms;
        let (skip, delay) = if shift >= 0.0 { (0.0, shift.round() as u64) } else { (-shift / 1000.0, 0) };
        parts.push(format!(
            "[{}:a]atrim=start={skip:.3},asetpts=PTS-STARTPTS,adelay={delay}|{delay},volume={:.3}[mic]",
            m.input,
            m.volume.clamp(0.0, 2.0)
        ));
        labels.push("[mic]");
    }

    match labels.len() {
        0 => None,
        1 => {
            let label = labels[0];
            Some(format!("{};{label}apad[aout]", parts.join(";")))
        }
        n => Some(format!(
            "{};{}amix=inputs={n}:normalize=0:dropout_transition=0,apad[aout]",
            parts.join(";"),
            labels.concat()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_valid_wav_header() {
        let samples = click_samples();
        let bytes = wav(&samples);
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(bytes.len(), 44 + samples.len() * 2);
        assert!(samples.iter().any(|s| s.unsigned_abs() > 10_000));
    }

    #[test]
    fn mixes_clicks_at_their_times() {
        assert_eq!(mix_filter(&[], 1.0, None), None);
        assert_eq!(
            mix_filter(&[1500], 0.5, None).unwrap(),
            "[1:a]adelay=1500|1500,volume=0.500[clk];[clk]apad[aout]"
        );
        let f = mix_filter(&[0, 2000], 2.0, None).unwrap();
        assert!(f.starts_with("[1:a]asplit=2[s0][s1];[s0]adelay=0|0[d0];[s1]adelay=2000|2000[d1]"));
        assert!(f.ends_with("volume=1.000[clk];[clk]apad[aout]"));
    }

    #[test]
    fn aligns_the_microphone_on_the_trimmed_video() {
        let late = MicMix { input: 1, offset_ms: 120.0, trim_start_ms: 0.0, volume: 1.0 };
        assert_eq!(
            mix_filter(&[], 1.0, Some(&late)).unwrap(),
            "[1:a]atrim=start=0.000,asetpts=PTS-STARTPTS,adelay=120|120,volume=1.000[mic];[mic]apad[aout]"
        );
        let trimmed = MicMix { input: 2, offset_ms: 100.0, trim_start_ms: 2100.0, volume: 0.5 };
        let f = mix_filter(&[500], 1.0, Some(&trimmed)).unwrap();
        assert!(f.contains("[2:a]atrim=start=2.000,asetpts=PTS-STARTPTS,adelay=0|0,volume=0.500[mic]"));
        assert!(f.ends_with("[clk][mic]amix=inputs=2:normalize=0:dropout_transition=0,apad[aout]"));
    }
}

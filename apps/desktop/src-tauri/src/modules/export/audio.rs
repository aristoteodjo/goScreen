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

/// One stretch of an audio file placed on the export timeline: a cut of
/// the microphone under a recording clip, a music clip, a video's sound.
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    /// Input index of the file in the FFmpeg command.
    pub input: usize,
    /// Start and length inside the file, in seconds.
    pub from: f64,
    pub duration: f64,
    /// Where it starts in the export, in milliseconds.
    pub at_ms: u64,
    pub speed: f64,
    pub volume: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

/// A stretch requested in source time, moved onto a file that starts
/// `offset` seconds after the source (the mic starts a little late or early).
/// Whatever falls before the file's start is dropped, shifting `at` along.
pub fn on_file(from: f64, duration: f64, at: f64, speed: f64, offset: f64) -> Option<(f64, f64, f64)> {
    let local = from - offset;
    let (skip, local) = if local < 0.0 { (-local, 0.0) } else { (0.0, local) };
    let left = duration - skip;
    (left > 0.001).then(|| (local, left, at + skip / speed.max(0.01)))
}

/// atempo only takes 0.5..2 per stage on older FFmpeg: chain stages.
fn tempo_chain(speed: f64) -> String {
    let mut speed = speed.clamp(0.0625, 16.0);
    let mut out = String::new();
    while speed > 2.0 + 1e-9 {
        out.push_str(",atempo=2");
        speed /= 2.0;
    }
    while speed < 0.5 - 1e-9 {
        out.push_str(",atempo=0.5");
        speed /= 0.5;
    }
    if (speed - 1.0).abs() > 1e-6 {
        out.push_str(&format!(",atempo={speed:.4}"));
    }
    out
}

fn piece_filter(p: &Piece, label: &str) -> String {
    let length = p.duration / p.speed.max(0.01);
    let mut f = format!(
        "[{}:a]atrim=start={:.3}:duration={:.3},asetpts=PTS-STARTPTS{}",
        p.input,
        p.from.max(0.0),
        p.duration,
        tempo_chain(p.speed)
    );
    if p.fade_in > 0.0 {
        f.push_str(&format!(",afade=t=in:st=0:d={:.3}", p.fade_in.min(length)));
    }
    if p.fade_out > 0.0 {
        let d = p.fade_out.min(length);
        f.push_str(&format!(",afade=t=out:st={:.3}:d={d:.3}", (length - d).max(0.0)));
    }
    let at = p.at_ms;
    f.push_str(&format!(",volume={:.3},adelay={at}|{at}{label}", p.volume.clamp(0.0, 2.0)));
    f
}

/// filter_complex for the export soundtrack: one click (input 1, when there
/// are clicks) at each tap time, plus every audio piece, padded with silence
/// so `-shortest` lets the video decide the length.
pub fn mix_filter(clicks_ms: &[u64], volume: f64, pieces: &[Piece]) -> Option<String> {
    let volume = volume.clamp(0.0, 1.0);
    let mut parts: Vec<String> = Vec::new();
    let mut labels: Vec<String> = Vec::new();

    match clicks_ms {
        [] => {}
        [one] => {
            parts.push(format!("[1:a]adelay={one}|{one},volume={volume:.3}[clk]"));
            labels.push("[clk]".into());
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
            labels.push("[clk]".into());
        }
    }

    for (i, p) in pieces.iter().enumerate() {
        let label = format!("[p{i}]");
        parts.push(piece_filter(p, &label));
        labels.push(label);
    }

    match labels.len() {
        0 => None,
        1 => Some(format!("{};{}apad[aout]", parts.join(";"), labels[0])),
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
        assert_eq!(mix_filter(&[], 1.0, &[]), None);
        assert_eq!(
            mix_filter(&[1500], 0.5, &[]).unwrap(),
            "[1:a]adelay=1500|1500,volume=0.500[clk];[clk]apad[aout]"
        );
        let f = mix_filter(&[0, 2000], 2.0, &[]).unwrap();
        assert!(f.starts_with("[1:a]asplit=2[s0][s1];[s0]adelay=0|0[d0];[s1]adelay=2000|2000[d1]"));
        assert!(f.ends_with("volume=1.000[clk];[clk]apad[aout]"));
    }

    #[test]
    fn places_pieces_with_speed_fades_and_delay() {
        let mic = Piece { input: 1, from: 2.0, duration: 3.0, at_ms: 500, speed: 1.0, volume: 1.0, fade_in: 0.0, fade_out: 0.0 };
        assert_eq!(
            mix_filter(&[], 1.0, &[mic]).unwrap(),
            "[1:a]atrim=start=2.000:duration=3.000,asetpts=PTS-STARTPTS,volume=1.000,adelay=500|500[p0];[p0]apad[aout]"
        );
        let fast = Piece { input: 2, from: 0.0, duration: 4.0, at_ms: 0, speed: 4.0, volume: 0.5, fade_in: 0.2, fade_out: 0.5 };
        let f = mix_filter(&[100], 1.0, &[fast]).unwrap();
        assert!(f.contains("asetpts=PTS-STARTPTS,atempo=2,atempo=2.0000,afade=t=in:st=0:d=0.200,afade=t=out:st=0.500:d=0.500"));
        assert!(f.ends_with("[clk][p0]amix=inputs=2:normalize=0:dropout_transition=0,apad[aout]"));
    }

    #[test]
    fn chains_tempo_stages() {
        assert_eq!(tempo_chain(1.0), "");
        assert_eq!(tempo_chain(1.5), ",atempo=1.5000");
        assert_eq!(tempo_chain(0.25), ",atempo=0.5,atempo=0.5000");
        assert_eq!(tempo_chain(3.0), ",atempo=2,atempo=1.5000");
    }

    #[test]
    fn moves_source_time_onto_a_late_file() {
        // The mic starts 0.5s after the screen: source 0.2..2.2 is 0..1.7 on file, 0.3s later.
        let (from, duration, at) = on_file(0.2, 2.0, 1.0, 1.0, 0.5).unwrap();
        assert!((from - 0.0).abs() < 1e-9 && (duration - 1.7).abs() < 1e-9 && (at - 1.3).abs() < 1e-9);
        assert_eq!(on_file(1.0, 2.0, 0.0, 1.0, -0.5), Some((1.5, 2.0, 0.0)));
        assert_eq!(on_file(0.0, 0.2, 0.0, 1.0, 1.0), None);
    }
}

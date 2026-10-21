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
    /// Gain under the voice, piecewise linear from the piece's start
    /// (seconds, gain): empty when nothing ducks it.
    pub duck: Vec<(f64, f64)>,
}

/// The `volume` filter expression of a piecewise-linear gain curve in `t`
/// (seconds from the piece's start): nested `if`s, one per segment, so
/// FFmpeg evaluates it frame by frame. Commas are escaped for the graph.
pub fn volume_expr(points: &[(f64, f64)]) -> String {
    let points: Vec<(f64, f64)> = points
        .iter()
        .filter(|(t, g)| t.is_finite() && g.is_finite())
        .map(|(t, g)| (t.max(0.0), g.clamp(0.0, 1.0)))
        .collect();
    match points.as_slice() {
        [] => "1".into(),
        [(_, g)] => format!("{g:.4}"),
        all => {
            let mut expr = format!("{:.4}", all[all.len() - 1].1);
            for w in all.windows(2).rev() {
                let (t0, g0) = w[0];
                let (t1, g1) = w[1];
                let seg = if t1 - t0 < 1e-6 || (g1 - g0).abs() < 1e-6 {
                    format!("{g0:.4}")
                } else {
                    format!("({g0:.4}+{:.4}*(t-{t0:.3}))", (g1 - g0) / (t1 - t0))
                };
                expr = format!("if(lt(t\\,{t1:.3})\\,{seg}\\,{expr})");
            }
            expr
        }
    }
}

/// The master's loudness as `ebur128` measures it.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    /// Integrated loudness, LUFS.
    pub integrated: f64,
    /// True peak, dBTP.
    pub true_peak: f64,
}

/// The summary `ebur128=peak=true` prints at the end: `I: -17.0 LUFS`
/// and `Peak: -3.1 dBFS` (the last ones: the summary follows the log).
pub fn parse_ebur128(stderr: &str) -> Option<Loudness> {
    let mut integrated = None;
    let mut peak = None;
    for line in stderr.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("I:") {
            integrated = rest.split_whitespace().next().and_then(|v| v.parse::<f64>().ok()).or(integrated);
        } else if let Some(rest) = line.strip_prefix("Peak:") {
            peak = rest.split_whitespace().next().and_then(|v| v.parse::<f64>().ok()).or(peak);
        }
    }
    Some(Loudness { integrated: integrated?, true_peak: peak? })
}

/// Targets of the master: -14 LUFS integrated, -1 dBTP (streaming platforms).
pub const MASTER_I: f64 = -14.0;
pub const MASTER_TP: f64 = -1.0;
pub const MASTER_LRA: f64 = 11.0;

/// What `loudnorm` measured in its first pass (`print_format=json`).
#[derive(Debug, Clone, PartialEq)]
pub struct Measured {
    pub input_i: f64,
    pub input_tp: f64,
    pub input_lra: f64,
    pub input_thresh: f64,
    pub target_offset: f64,
}

/// The JSON block loudnorm prints at the end of its measuring pass.
pub fn parse_loudnorm(stderr: &str) -> Option<Measured> {
    let start = stderr.rfind('{')?;
    let end = stderr[start..].find('}')? + start;
    let json: serde_json::Value = serde_json::from_str(&stderr[start..=end]).ok()?;
    let num = |key: &str| json.get(key)?.as_str()?.parse::<f64>().ok().filter(|v| v.is_finite());
    Some(Measured {
        input_i: num("input_i")?,
        input_tp: num("input_tp")?,
        input_lra: num("input_lra")?,
        input_thresh: num("input_thresh")?,
        target_offset: num("target_offset")?,
    })
}

/// First pass: measure only.
pub fn loudnorm_measure_filter() -> String {
    format!("loudnorm=I={MASTER_I}:TP={MASTER_TP}:LRA={MASTER_LRA}:print_format=json")
}

/// Second pass: linear normalisation from the measurements (the whole mix
/// moves by one gain, peaks limited), back at 48 kHz (loudnorm works at 192 kHz).
pub fn loudnorm_apply_filter(m: &Measured) -> String {
    format!(
        "loudnorm=I={MASTER_I}:TP={MASTER_TP}:LRA={MASTER_LRA}:measured_I={:.2}:measured_TP={:.2}:measured_LRA={:.2}:measured_thresh={:.2}:offset={:.2}:linear=true,aresample=48000",
        m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset
    )
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
    let volume = p.volume.clamp(0.0, 2.0);
    if p.duck.is_empty() {
        f.push_str(&format!(",volume={volume:.3}"));
    } else {
        f.push_str(&format!(",volume='{volume:.3}*{}':eval=frame", volume_expr(&p.duck)));
    }
    f.push_str(&format!(",adelay={at}|{at}{label}"));
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
        let mic = Piece { input: 1, from: 2.0, duration: 3.0, at_ms: 500, speed: 1.0, volume: 1.0, fade_in: 0.0, fade_out: 0.0, duck: vec![] };
        assert_eq!(
            mix_filter(&[], 1.0, &[mic]).unwrap(),
            "[1:a]atrim=start=2.000:duration=3.000,asetpts=PTS-STARTPTS,volume=1.000,adelay=500|500[p0];[p0]apad[aout]"
        );
        let fast = Piece { input: 2, from: 0.0, duration: 4.0, at_ms: 0, speed: 4.0, volume: 0.5, fade_in: 0.2, fade_out: 0.5, duck: vec![] };
        let f = mix_filter(&[100], 1.0, &[fast]).unwrap();
        assert!(f.contains("asetpts=PTS-STARTPTS,atempo=2,atempo=2.0000,afade=t=in:st=0:d=0.200,afade=t=out:st=0.500:d=0.500"));
        assert!(f.ends_with("[clk][p0]amix=inputs=2:normalize=0:dropout_transition=0,apad[aout]"));
    }

    #[test]
    fn ducks_with_a_frame_evaluated_volume_expression() {
        assert_eq!(volume_expr(&[]), "1");
        assert_eq!(volume_expr(&[(0.0, 0.5)]), "0.5000");
        let expr = volume_expr(&[(0.0, 1.0), (1.0, 1.0), (1.08, 0.1), (2.0, 0.1), (2.6, 1.0)]);
        assert_eq!(
            expr,
            "if(lt(t\\,1.000)\\,1.0000\\,if(lt(t\\,1.080)\\,(1.0000+-11.2500*(t-1.000))\\,if(lt(t\\,2.000)\\,0.1000\\,if(lt(t\\,2.600)\\,(0.1000+1.5000*(t-2.000))\\,1.0000))))"
        );
        let bed = Piece { input: 2, from: 0.0, duration: 4.0, at_ms: 0, speed: 1.0, volume: 0.3, fade_in: 0.0, fade_out: 0.0, duck: vec![(0.0, 1.0), (2.0, 0.1)] };
        let f = mix_filter(&[], 1.0, &[bed]).unwrap();
        assert!(f.contains(",volume='0.300*if(lt(t\\,2.000)\\,(1.0000+-0.4500*(t-0.000))\\,0.1000)':eval=frame,adelay=0|0[p0]"), "{f}");
    }

    #[test]
    fn reads_the_loudness_summary_and_the_measuring_pass() {
        let log = "[Parsed_ebur128_0 @ 0x1] t: 1.0  TARGET:-23 LUFS    M: -20.1 S: -21.0     I: -19.0 LUFS       LRA:   0.0 LU\n\
  Integrated loudness:\n    I:         -17.0 LUFS\n    Threshold: -27.8 LUFS\n\n  Loudness range:\n    LRA:         3.6 LU\n\n  True peak:\n    Peak:       -3.1 dBFS\n";
        assert_eq!(parse_ebur128(log), Some(Loudness { integrated: -17.0, true_peak: -3.1 }));
        assert_eq!(parse_ebur128("nothing"), None);
        let json = "size=N/A\n[Parsed_loudnorm_0 @ 0x1]\n{\n\t\"input_i\" : \"-19.50\",\n\t\"input_tp\" : \"-2.10\",\n\t\"input_lra\" : \"6.30\",\n\t\"input_thresh\" : \"-29.80\",\n\t\"output_i\" : \"-14.02\",\n\t\"target_offset\" : \"0.12\"\n}\n";
        let m = parse_loudnorm(json).unwrap();
        assert_eq!(m.input_i, -19.5);
        assert_eq!(m.target_offset, 0.12);
        let f = loudnorm_apply_filter(&m);
        assert!(f.starts_with("loudnorm=I=-14:TP=-1:LRA=11:measured_I=-19.50:measured_TP=-2.10:measured_LRA=6.30:measured_thresh=-29.80:offset=0.12:linear=true,aresample=48000"), "{f}");
        assert_eq!(loudnorm_measure_filter(), "loudnorm=I=-14:TP=-1:LRA=11:print_format=json");
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

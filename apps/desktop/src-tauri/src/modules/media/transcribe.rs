//! Words of a take, by whisper.cpp in a child process.
//!
//! The voice is extracted by FFmpeg as a 16 kHz mono WAV, `whisper-cli`
//! writes a JSON with one segment per word and a confidence per token, and
//! that JSON is turned into the words contract (`<stem>.words.json`:
//! `{ language, source, words: [{ text, start, end, p }] }`, source seconds).

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::AtomicBool,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::{recording_path, sidecar};
use crate::modules::{local_ai, recording::ffmpeg};

pub const PROGRESS_EVENT: &str = "speech-progress";

/// Whisper models, downloaded once into `<data>/goScreen/models/whisper/`.
pub const WHISPER_MODELS: &[(&str, &str)] = &[
    ("base", "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"),
    ("small", "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"),
];

/// A model file is at least this big; a short error page never passes as one.
const MIN_MODEL_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub p: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WordsFile {
    pub language: String,
    pub source: String,
    pub words: Vec<Word>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechError {
    pub code: &'static str,
    pub detail: String,
}

impl SpeechError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl From<String> for SpeechError {
    fn from(detail: String) -> Self {
        Self::new("failed", detail)
    }
}

/// `whisper-cli`: `GOSCREEN_WHISPER`, then the PATH and Homebrew (older
/// bottles named the binary `whisper-cpp`).
pub fn locate_whisper() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("GOSCREEN_WHISPER") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    ffmpeg::locate_tool("whisper-cli").or_else(|| ffmpeg::locate_tool("whisper-cpp"))
}

pub fn model_url(id: &str) -> Result<&'static str, SpeechError> {
    WHISPER_MODELS
        .iter()
        .find(|(m, _)| *m == id)
        .map(|(_, url)| *url)
        .ok_or_else(|| SpeechError::new("unknown-model", format!("Unknown whisper model {id} (base or small).")))
}

pub fn model_path(id: &str) -> Result<PathBuf, SpeechError> {
    Ok(local_ai::models_dir()?.join("whisper").join(format!("ggml-{id}.bin")))
}

/// The voice to transcribe: the take's cleaned mic when there is one, else
/// the video's own sound (an imported camera take).
pub fn audio_source(video: &Path) -> PathBuf {
    let mic = video.with_extension("mic.m4a");
    if mic.is_file() {
        mic
    } else {
        video.to_path_buf()
    }
}

pub fn wav_args(input: &Path, wav: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-i"].map(String::from).to_vec();
    args.push(input.to_string_lossy().into_owned());
    args.extend(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav"].map(String::from));
    args.push(wav.to_string_lossy().into_owned());
    args
}

/// One segment per word (`-ml 1 -sow`), full JSON with token confidences.
pub fn whisper_args(model: &Path, wav: &Path, out_stem: &Path, language: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    args.extend(["-m".into(), model.to_string_lossy().into_owned()]);
    args.extend(["-f".into(), wav.to_string_lossy().into_owned()]);
    args.extend(["-l".into(), language.unwrap_or("auto").into()]);
    args.extend(["-ml", "1", "-sow", "-ojf", "-np", "-of"].map(String::from));
    args.push(out_stem.to_string_lossy().into_owned());
    args
}

fn is_marker(text: &str) -> bool {
    let t = text.trim();
    t.is_empty()
        || t.starts_with("[_")
        || t.starts_with("<|")
        || (t.starts_with('[') && t.ends_with(']'))
        || (t.starts_with('(') && t.ends_with(')'))
        || !t.chars().any(|c| c.is_alphanumeric())
}

fn offset(v: &Value, key: &str) -> Option<f64> {
    v.get("offsets")?.get(key)?.as_f64().map(|ms| (ms / 1000.0 * 1000.0).round() / 1000.0)
}

/// Words from a segment's tokens: a token that starts with a space (or is
/// the first) opens a word, the others continue it; p is the lowest of its tokens.
fn words_of_tokens(tokens: &[Value]) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    for token in tokens {
        let Some(text) = token.get("text").and_then(Value::as_str) else { continue };
        if text.trim().is_empty() || text.starts_with("[_") || text.starts_with("<|") {
            continue;
        }
        let (Some(start), Some(end)) = (offset(token, "from"), offset(token, "to")) else { continue };
        let p = token.get("p").and_then(Value::as_f64).unwrap_or(1.0).clamp(0.0, 1.0);
        let opens = text.starts_with(' ') || out.is_empty();
        match out.last_mut() {
            Some(last) if !opens => {
                last.text.push_str(text.trim());
                last.end = last.end.max(end);
                last.p = last.p.min(p);
            }
            _ => out.push(Word { text: text.trim().to_string(), start, end: end.max(start), p }),
        }
    }
    out
}

/// whisper.cpp's JSON (`-ojf`) to the words contract.
pub fn words_from_json(json: &Value) -> Result<WordsFile, SpeechError> {
    let segments = json
        .get("transcription")
        .and_then(Value::as_array)
        .ok_or_else(|| SpeechError::new("bad-output", "whisper wrote no transcription."))?;
    let language = json
        .get("result")
        .and_then(|r| r.get("language"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut words: Vec<Word> = Vec::new();
    for segment in segments {
        let text = segment.get("text").and_then(Value::as_str).unwrap_or("");
        if is_marker(text) {
            continue;
        }
        let from_tokens = segment.get("tokens").and_then(Value::as_array).map(|t| words_of_tokens(t)).unwrap_or_default();
        let found: Vec<Word> = if from_tokens.is_empty() {
            let (Some(start), Some(end)) = (offset(segment, "from"), offset(segment, "to")) else { continue };
            let pieces: Vec<&str> = text.split_whitespace().collect();
            let step = if pieces.is_empty() { 0.0 } else { (end - start) / pieces.len() as f64 };
            pieces
                .iter()
                .enumerate()
                .map(|(i, piece)| Word {
                    text: piece.to_string(),
                    start: start + step * i as f64,
                    end: start + step * (i + 1) as f64,
                    p: 1.0,
                })
                .collect()
        } else {
            from_tokens
        };
        words.extend(found.into_iter().filter(|w| !is_marker(&w.text)));
    }
    // Whisper never overlaps words; a token timestamp sometimes does.
    let mut previous_end = 0.0f64;
    for w in &mut words {
        if w.start < previous_end {
            w.start = previous_end;
        }
        if w.end <= w.start {
            w.end = w.start + 0.02;
        }
        previous_end = w.end;
    }
    Ok(WordsFile { language, source: "whisper".into(), words })
}

/// Where the take's words live.
pub fn words_path(video: &Path) -> PathBuf {
    sidecar(video, "words.json")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcribed {
    pub language: String,
    pub words: Vec<Word>,
    pub audio: String,
}

async fn ensure_model(app: &AppHandle, id: &str) -> Result<PathBuf, SpeechError> {
    let path = model_path(id)?;
    if std::fs::metadata(&path).map(|m| m.len() >= MIN_MODEL_BYTES).unwrap_or(false) {
        return Ok(path);
    }
    let url = model_url(id)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    let client = local_ai::download_client()?;
    let cancel = AtomicBool::new(false);
    let size = local_ai::fetch_file(&client, url, &path, None, &cancel, |done| {
        let _ = app.emit(PROGRESS_EVENT, serde_json::json!({ "type": "download", "model": id, "done": done }));
    })
    .await
    .map_err(|e| SpeechError::new("download", e))?;
    if size < MIN_MODEL_BYTES {
        let _ = std::fs::remove_file(&path);
        return Err(SpeechError::new("download", format!("{url} did not return a model file.")));
    }
    Ok(path)
}

/// Transcribes the take's voice word by word. The words are returned raw
/// (the studio snaps them to the sound's attacks and saves them).
#[tauri::command]
pub async fn media_transcribe(
    app: AppHandle,
    video_path: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<Transcribed, SpeechError> {
    let video = recording_path(&video_path)?;
    let whisper = locate_whisper().ok_or_else(|| {
        SpeechError::new(
            "whisper-missing",
            "whisper.cpp was not found. Install it (brew install whisper-cpp) or set GOSCREEN_WHISPER to whisper-cli.",
        )
    })?;
    let ffmpeg_bin = ffmpeg::locate()
        .ok_or_else(|| SpeechError::new("ffmpeg-missing", "FFmpeg was not found. Install it (brew install ffmpeg)."))?;
    let model_file = ensure_model(&app, model.as_deref().unwrap_or("base")).await?;
    let audio = audio_source(&video);
    let _ = app.emit(PROGRESS_EVENT, serde_json::json!({ "type": "transcribe", "stage": "audio" }));
    let language = language.filter(|l| l.chars().all(|c| c.is_ascii_alphabetic()) && l.len() <= 5);
    tauri::async_runtime::spawn_blocking(move || -> Result<Transcribed, SpeechError> {
        let dir = std::env::temp_dir().join(format!("goscreen-speech-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let result = (|| {
            let wav = dir.join("voice.wav");
            let out = Command::new(&ffmpeg_bin)
                .args(wav_args(&audio, &wav))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| SpeechError::new("ffmpeg", format!("extract the voice: {e}")))?;
            if !out.status.success() || !wav.is_file() {
                return Err(SpeechError::new(
                    "ffmpeg",
                    format!("The voice could not be extracted: {}", String::from_utf8_lossy(&out.stderr).trim()),
                ));
            }
            let stem = dir.join("words");
            let out = Command::new(&whisper)
                .args(whisper_args(&model_file, &wav, &stem, language.as_deref()))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| SpeechError::new("whisper", format!("run whisper: {e}")))?;
            let json_path = dir.join("words.json");
            if !out.status.success() || !json_path.is_file() {
                return Err(SpeechError::new(
                    "whisper",
                    format!("whisper failed: {}", String::from_utf8_lossy(&out.stderr).trim()),
                ));
            }
            let bytes = std::fs::read(&json_path).map_err(|e| format!("read whisper output: {e}"))?;
            let json: Value =
                serde_json::from_slice(&bytes).map_err(|e| SpeechError::new("bad-output", format!("whisper JSON: {e}")))?;
            let file = words_from_json(&json)?;
            Ok(Transcribed { language: file.language, words: file.words, audio: audio.to_string_lossy().into_owned() })
        })();
        let _ = std::fs::remove_dir_all(&dir);
        result
    })
    .await
    .map_err(|e| SpeechError::new("failed", e.to_string()))?
}

/// Saves the words next to the take (after the studio snapped them).
#[tauri::command(async)]
pub fn media_words_save(video_path: String, words: WordsFile) -> Result<(), String> {
    let video = recording_path(&video_path)?;
    if words.source != "whisper" && words.source != "manual" {
        return Err("source must be whisper or manual.".into());
    }
    let json = serde_json::to_vec_pretty(&words).map_err(|e| e.to_string())?;
    let target = words_path(&video);
    let tmp = sidecar(&video, "words.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("save {}: {e}", target.display()))
}

/// The saved words of a take, or null.
#[tauri::command(async)]
pub fn media_words_load(video_path: String) -> Result<Option<WordsFile>, String> {
    let video = recording_path(&video_path)?;
    let path = words_path(&video);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("{} is not a words file: {e}", path.display()))
}

/// Writes a text file next to the take (`takes.md`, a report).
#[tauri::command(async)]
pub fn media_sidecar_write(video_path: String, suffix: String, content: String) -> Result<String, String> {
    let video = recording_path(&video_path)?;
    if !matches!(suffix.as_str(), "takes.md" | "qc.md") {
        return Err("Only takes.md or qc.md can be written here.".into());
    }
    let target = sidecar(&video, &suffix);
    std::fs::write(&target, content).map_err(|e| format!("write {}: {e}", target.display()))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "result": { "language": "fr" },
      "transcription": [
        { "timestamps": {"from": "00:00:00,000", "to": "00:00:00,500"}, "offsets": {"from": 0, "to": 500},
          "text": " Bonjour",
          "tokens": [
            { "text": "[_BEG_]", "offsets": {"from": 0, "to": 0}, "p": 1.0 },
            { "text": " Bon", "offsets": {"from": 120, "to": 300}, "p": 0.9 },
            { "text": "jour", "offsets": {"from": 300, "to": 500}, "p": 0.7 }
          ] },
        { "offsets": {"from": 500, "to": 900}, "text": " [BLANK_AUDIO]", "tokens": [] },
        { "offsets": {"from": 900, "to": 1500}, "text": " je vous" },
        { "offsets": {"from": 1400, "to": 1800}, "text": " présente.",
          "tokens": [ { "text": " présente", "offsets": {"from": 1400, "to": 1800}, "p": 0.95 },
                      { "text": ".", "offsets": {"from": 1800, "to": 1800}, "p": 0.99 } ] }
      ]
    }"#;

    #[test]
    fn converts_whisper_tokens_into_words() {
        let json: Value = serde_json::from_str(SAMPLE).unwrap();
        let file = words_from_json(&json).unwrap();
        assert_eq!(file.language, "fr");
        assert_eq!(file.source, "whisper");
        let texts: Vec<&str> = file.words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, vec!["Bonjour", "je", "vous", "présente."]);
        assert_eq!(file.words[0].start, 0.12);
        assert_eq!(file.words[0].end, 0.5);
        assert_eq!(file.words[0].p, 0.7);
        // A segment without tokens shares its time between its words.
        assert_eq!(file.words[1].start, 0.9);
        assert_eq!(file.words[1].end, 1.2);
        assert_eq!(file.words[2].end, 1.5);
        // An overlap with the previous word is pushed after it.
        assert_eq!(file.words[3].start, 1.5);
        assert_eq!(file.words[3].end, 1.8);
    }

    #[test]
    fn refuses_output_without_transcription() {
        let json: Value = serde_json::from_str(r#"{"result": {}}"#).unwrap();
        assert_eq!(words_from_json(&json).unwrap_err().code, "bad-output");
    }

    #[test]
    fn asks_whisper_for_one_word_per_segment_with_confidences() {
        let args = whisper_args(Path::new("/m.bin"), Path::new("/v.wav"), Path::new("/out/words"), None).join(" ");
        assert!(args.contains("-ml 1 -sow -ojf"));
        assert!(args.contains("-l auto"));
        assert!(args.ends_with("-of /out/words"));
        let wav = wav_args(Path::new("/a.m4a"), Path::new("/v.wav")).join(" ");
        assert!(wav.contains("-ac 1 -ar 16000 -c:a pcm_s16le"));
    }

    #[test]
    fn knows_its_models() {
        assert!(model_url("base").is_ok());
        assert_eq!(model_url("huge").unwrap_err().code, "unknown-model");
        assert!(model_path("base").unwrap().ends_with("whisper/ggml-base.bin"));
        assert_eq!(words_path(Path::new("/a/take.mp4")), PathBuf::from("/a/take.words.json"));
    }
}

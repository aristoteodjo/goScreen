//! What the local model learns from: examples a teacher (Claude through MCP,
//! or a person) answered, kept in `<data>/goScreen/training/examples/` as
//! `<id>.json` + `<id>.jpg`. The studio picks some as few-shot context and
//! exports them all (`train.jsonl`) for a LoRA fine-tune.

use std::path::PathBuf;

use base64::Engine;
use serde_json::Value;

pub fn training_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir().ok_or("No data directory")?.join("goScreen").join("training"))
}

fn examples_dir() -> Result<PathBuf, String> {
    Ok(training_dir()?.join("examples"))
}

const JPEG_PREFIX: &str = "data:image/jpeg;base64,";

/// The JPEG bytes of a data URL; anything else is refused.
pub fn jpeg_bytes(data_url: &str) -> Result<Vec<u8>, String> {
    let b64 = data_url.strip_prefix(JPEG_PREFIX).ok_or("The image must be a JPEG data URL.")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| "Invalid image data.")?;
    if bytes.len() < 4 || bytes[..2] != [0xFF, 0xD8] {
        return Err("The image is not a JPEG.".into());
    }
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("The image is too large (4 MB at most).".into());
    }
    Ok(bytes)
}

/// Keeps an example and its frame; returns its id. The studio checked its
/// shape; the id and the image name are set here.
#[tauri::command]
pub fn training_add(example: Value, image: String) -> Result<String, String> {
    let Value::Object(mut example) = example else { return Err("Invalid example.".into()) };
    let bytes = jpeg_bytes(&image)?;
    let dir = examples_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    example.insert("id".into(), Value::from(id.clone()));
    example.insert("image".into(), Value::from(format!("{id}.jpg")));
    std::fs::write(dir.join(format!("{id}.jpg")), bytes).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}.json")), Value::Object(example).to_string()).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Every example, newest first (by `created`); with its frame as a data URL
/// (`imageData`) when asked, for few-shot questions.
#[tauri::command(async)]
pub fn training_list(with_images: Option<bool>) -> Result<Vec<Value>, String> {
    let Ok(entries) = std::fs::read_dir(examples_dir()?) else { return Ok(vec![]) };
    let mut list: Vec<Value> = entries
        .filter_map(|e| {
            let path = e.ok()?.path();
            if path.extension()? != "json" {
                return None;
            }
            let mut v: Value = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
            if with_images.unwrap_or(false) {
                let jpg = std::fs::read(path.with_extension("jpg")).ok()?;
                v["imageData"] =
                    Value::from(format!("{JPEG_PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(jpg)));
            }
            Some(v)
        })
        .collect();
    list.sort_by(|a, b| {
        let t = |v: &Value| v.get("created").and_then(Value::as_f64).unwrap_or(0.0);
        t(b).total_cmp(&t(a))
    });
    Ok(list)
}

#[tauri::command]
pub fn training_remove(id: String) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid example id.".into());
    }
    let dir = examples_dir()?;
    for ext in ["json", "jpg"] {
        let _ = std::fs::remove_file(dir.join(format!("{id}.{ext}")));
    }
    Ok(())
}

/// Writes the fine-tuning dataset (built by the studio) as `train.jsonl`
/// next to the examples; returns the training folder.
#[tauri::command]
pub fn training_export(jsonl: String) -> Result<String, String> {
    for line in jsonl.lines() {
        serde_json::from_str::<Value>(line).map_err(|e| format!("Invalid dataset line: {e}"))?;
    }
    let dir = training_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("train.jsonl"), jsonl).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_jpeg_data_urls_are_kept() {
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 1, 2]);
        assert!(jpeg_bytes(&format!("{JPEG_PREFIX}{jpeg}")).is_ok());
        let png = base64::engine::general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G']);
        assert!(jpeg_bytes(&format!("{JPEG_PREFIX}{png}")).is_err());
        assert!(jpeg_bytes("data:image/png;base64,AAAA").is_err());
        assert!(jpeg_bytes("/etc/passwd").is_err());
    }
}

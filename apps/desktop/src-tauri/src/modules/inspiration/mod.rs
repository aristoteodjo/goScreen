//! The inspiration library: the community list of videos made as code, with
//! their prompts. Downloaded on request (never at launch) and kept in
//! `<data>/goScreen/inspiration/videos.json`; reading it needs no network.

use std::path::PathBuf;
use std::time::Duration;

/// `data/videos.json` of github.com/yihui-dev/awesome-opus5-5-videos (MIT).
pub const LIBRARY_URL: &str =
    "https://raw.githubusercontent.com/yihui-dev/awesome-opus5-5-videos/main/data/videos.json";
const MAX_BYTES: usize = 32 * 1024 * 1024;

fn library_path() -> Result<PathBuf, String> {
    Ok(dirs::data_dir().ok_or("No data directory")?.join("goScreen").join("inspiration").join("videos.json"))
}

/// A list of entries, each with a slug and a prompt; returns how many. The
/// studio checks each entry again, this only refuses what is not the list.
pub fn check_library(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() > MAX_BYTES {
        return Err("The inspiration library is too large.".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "The inspiration library is not valid JSON.".to_string())?;
    let entries = value.as_array().ok_or("The inspiration library is not a list.")?;
    let usable = entries
        .iter()
        .filter(|e| e.get("slug").and_then(|s| s.as_str()).is_some() && e.get("prompt").and_then(|s| s.as_str()).is_some())
        .count();
    if usable == 0 {
        return Err("The inspiration library has no prompts.".into());
    }
    Ok(usable)
}

/// Downloads the latest list; the previous copy stays until the new one is checked.
#[tauri::command]
pub async fn inspiration_sync() -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(LIBRARY_URL).send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Download failed: the library answered {}.", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| format!("Download interrupted: {e}"))?;
    let count = check_library(&bytes)?;
    let path = library_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    let part = path.with_extension("json.part");
    std::fs::write(&part, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(count)
}

/// The downloaded list as JSON text, or `None` before the first download.
#[tauri::command(async)]
pub fn inspiration_library() -> Result<Option<String>, String> {
    let path = library_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| format!("read the library: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_list_of_prompts_only() {
        let ok = br#"[{"slug":"a-1","prompt":"p"},{"slug":"b-2"},{"slug":"c-3","prompt":"q"}]"#;
        assert_eq!(check_library(ok), Ok(2));
        assert!(check_library(b"{}").is_err());
        assert!(check_library(b"[]").is_err());
        assert!(check_library(b"<html>").is_err());
        assert!(check_library(&vec![b' '; MAX_BYTES + 1]).is_err());
    }
}

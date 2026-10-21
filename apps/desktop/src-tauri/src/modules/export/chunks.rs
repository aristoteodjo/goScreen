//! Incremental export and drafts.
//!
//! The editor cuts the timeline into chunks and fingerprints each one
//! (`chunkPlan`, render-engine). A rendered chunk lives in
//! `<stem>.render-cache/<hash>.mp4`; an export only encodes the chunks that
//! are missing, then `export_assemble` concatenates them (same codec and
//! parameters, so a stream copy) and mixes the soundtrack in one pass as
//! before. Drafts (`preview_*`) are small, fast MP4s in `<stem>.previews/`.
//! The studio sends recording paths and hashes only, never cache paths.

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::State;

use super::{begin, export_paths, finish, mix, ExportState, PieceRequest, Quality};
use crate::modules::{media::montage_path, recording::ffmpeg};

/// The cache never grows past this many chunks or this many bytes.
pub const MAX_CHUNKS: usize = 200;
pub const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// `rec.mp4` -> `rec.render-cache/`.
pub fn cache_dir(video: &Path) -> PathBuf {
    crate::modules::media::sidecar(video, "render-cache")
}

/// `rec.mp4` -> `rec.previews/`.
pub fn previews_dir(video: &Path) -> PathBuf {
    crate::modules::media::sidecar(video, "previews")
}

/// A chunk hash is 16 lowercase hex characters (FNV-1a 64), nothing else.
pub fn is_hash(hash: &str) -> bool {
    hash.len() == 16 && hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn chunk_file(video: &Path, hash: &str) -> Option<PathBuf> {
    is_hash(hash).then(|| cache_dir(video).join(format!("{hash}.mp4")))
}

/// The hashes of the chunks already rendered for this recording.
pub fn cached_hashes(dir: &Path) -> Vec<String> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let hash = name.strip_suffix(".mp4")?;
            (is_hash(hash) && e.path().is_file()).then(|| hash.to_string())
        })
        .collect();
    out.sort();
    out
}

/// One cached chunk as seen by the pruner.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub bytes: u64,
    /// Seconds since the epoch of the last use.
    pub used: u64,
}

/// Which chunks to delete so that at most `max_files` and `max_bytes`
/// remain: the least recently used go first.
pub fn prune_plan(entries: &[Entry], max_files: usize, max_bytes: u64) -> Vec<String> {
    let mut kept: Vec<&Entry> = entries.iter().collect();
    // Most recent first; ties keep a stable order by name.
    kept.sort_by(|a, b| b.used.cmp(&a.used).then_with(|| a.name.cmp(&b.name)));
    let mut total = 0u64;
    let mut drop = Vec::new();
    for (i, e) in kept.iter().enumerate() {
        total = total.saturating_add(e.bytes);
        if i >= max_files || total > max_bytes {
            drop.push(e.name.clone());
        }
    }
    drop
}

fn prune(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let entries: Vec<Entry> = read
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = e.metadata().ok()?;
            if !meta.is_file() || !name.ends_with(".mp4") {
                return None;
            }
            let used = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Some(Entry { name, bytes: meta.len(), used })
        })
        .collect();
    for name in prune_plan(&entries, MAX_CHUNKS, MAX_BYTES) {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

/// The text of an FFmpeg concat list (`-f concat -safe 0`).
pub fn concat_list(files: &[PathBuf]) -> String {
    files
        .iter()
        .map(|f| format!("file '{}'\n", f.to_string_lossy().replace('\'', "'\\''")))
        .collect()
}

/// File name of a draft, so the same request overwrites the same file.
pub fn preview_name(from: f64, to: f64, fps: u32, long_side: u32) -> String {
    format!("preview-{:.2}-{:.2}-{fps}fps-{long_side}.mp4", from.max(0.0), to.max(0.0))
}

#[tauri::command(async)]
pub fn render_cache_list(video_path: String) -> Result<Vec<String>, String> {
    let video = montage_path(&video_path)?;
    Ok(cached_hashes(&cache_dir(&video)))
}

/// Starts encoding one chunk; frames come through `export_frame`.
#[tauri::command(async)]
pub fn chunk_begin(state: State<'_, ExportState>, video_path: String, hash: String, fps: u32) -> Result<(), String> {
    let video = montage_path(&video_path)?;
    let output = chunk_file(&video, &hash).ok_or("Bad chunk hash.")?;
    let dir = cache_dir(&video);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let part = dir.join(format!("{hash}.part.mp4"));
    begin(&state, Quality::Final, fps, part, output)
}

/// Ends the chunk: the part file becomes `<hash>.mp4`.
#[tauri::command(async)]
pub fn chunk_finish(state: State<'_, ExportState>) -> Result<(), String> {
    let session = finish(&state)?;
    std::fs::rename(&session.video, &session.output).map_err(|e| e.to_string())
}

/// Concatenates the chunks in order into the export file and mixes the
/// soundtrack. Every chunk must exist; the cache is then trimmed.
#[tauri::command(async)]
pub fn export_assemble(
    video_path: String,
    name: String,
    hashes: Vec<String>,
    clicks: Vec<f64>,
    volume: f64,
    pieces: Vec<PieceRequest>,
) -> Result<String, String> {
    let video = montage_path(&video_path)?;
    let bin = ffmpeg::locate().ok_or("FFmpeg was not found. Install it (brew install ffmpeg) and retry.")?;
    let mut files = Vec::with_capacity(hashes.len());
    let now = SystemTime::now();
    for hash in &hashes {
        let file = chunk_file(&video, hash).ok_or("Bad chunk hash.")?;
        if !file.is_file() {
            return Err(format!("Chunk {hash} is missing from the render cache."));
        }
        // A used chunk is recent again, so the pruner keeps it.
        if let Ok(f) = std::fs::File::options().write(true).open(&file) {
            let _ = f.set_modified(now);
        }
        files.push(file);
    }
    if files.is_empty() {
        return Err("No chunks to assemble.".into());
    }
    let (silent, output) = export_paths(&name)?;
    let list = silent.with_extension("concat.txt");
    std::fs::write(&list, concat_list(&files)).map_err(|e| e.to_string())?;
    let out = Command::new(bin)
        .args(["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&silent)
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    let _ = std::fs::remove_file(&list);
    if !out.status.success() {
        let _ = std::fs::remove_file(&silent);
        let detail = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = detail.lines().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(format!("Joining the chunks failed:\n{}", tail.join("\n")));
    }
    let result = mix(&silent, &output, &video_path, &clicks, volume, &pieces);
    prune(&cache_dir(&video));
    result
}

/// Starts a draft of `from..to` at `fps`; returns the file it will write.
#[tauri::command(async)]
pub fn preview_begin(
    state: State<'_, ExportState>,
    video_path: String,
    from: f64,
    to: f64,
    fps: u32,
    long_side: u32,
) -> Result<String, String> {
    let video = montage_path(&video_path)?;
    if !(from.is_finite() && to.is_finite()) || to <= from {
        return Err("The draft needs from < to.".into());
    }
    let dir = previews_dir(&video);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let output = dir.join(preview_name(from, to, fps, long_side));
    let part = output.with_extension("part.mp4");
    begin(&state, Quality::Draft, fps, part, output.clone())?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn preview_finish(state: State<'_, ExportState>) -> Result<String, String> {
    let session = finish(&state)?;
    std::fs::rename(&session.video, &session.output).map_err(|e| e.to_string())?;
    Ok(session.output.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_sixteen_lowercase_hex_characters() {
        assert!(is_hash("0123456789abcdef"));
        assert!(!is_hash("0123456789ABCDEF"));
        assert!(!is_hash("../../etc/passwd"));
        assert!(!is_hash("0123456789abcde"));
        assert_eq!(chunk_file(Path::new("/v/rec.mp4"), "../x"), None);
        assert_eq!(
            chunk_file(Path::new("/v/rec.mp4"), "0123456789abcdef"),
            Some(PathBuf::from("/v/rec.render-cache/0123456789abcdef.mp4"))
        );
    }

    #[test]
    fn cache_and_previews_sit_next_to_the_recording() {
        assert_eq!(cache_dir(Path::new("/v/rec.mp4")), PathBuf::from("/v/rec.render-cache"));
        assert_eq!(previews_dir(Path::new("/v/rec.mp4")), PathBuf::from("/v/rec.previews"));
        assert_eq!(preview_name(1.5, 4.0, 12, 480), "preview-1.50-4.00-12fps-480.mp4");
    }

    #[test]
    fn concat_lists_quote_paths() {
        let text = concat_list(&[PathBuf::from("/a/b.mp4"), PathBuf::from("/a/it's.mp4")]);
        assert_eq!(text, "file '/a/b.mp4'\nfile '/a/it'\\''s.mp4'\n");
    }

    #[test]
    fn pruning_drops_the_least_recently_used_first() {
        let e = |name: &str, bytes: u64, used: u64| Entry { name: name.into(), bytes, used };
        let entries = [e("old", 10, 1), e("mid", 10, 2), e("new", 10, 3)];
        assert_eq!(prune_plan(&entries, 2, 1000), vec!["old".to_string()]);
        assert_eq!(prune_plan(&entries, 10, 25), vec!["old".to_string()]);
        assert_eq!(prune_plan(&entries, 10, 15), vec!["mid".to_string(), "old".to_string()]);
        assert!(prune_plan(&entries, 10, 1000).is_empty());
    }

    #[test]
    fn lists_only_well_named_chunks() {
        let dir = std::env::temp_dir().join(format!("goscreen-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("0123456789abcdef.mp4"), b"x").unwrap();
        std::fs::write(dir.join("0123456789abcdef.part.mp4"), b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        assert_eq!(cached_hashes(&dir), vec!["0123456789abcdef".to_string()]);
        assert!(cached_hashes(&dir.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

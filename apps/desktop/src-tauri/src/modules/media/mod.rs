//! Recordings for the editor: a local media server plus the sidecar files
//! (interactions, edits) stored next to each MP4.
//!
//! The video is served over 127.0.0.1 with CORS so the editor can draw it
//! into a canvas without tainting it: preview and export share one renderer.

use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use axum::{
    body::{Body, Bytes},
    extract::{Path as UrlPath, State as AxumState},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::stream;
use serde::Serialize;
use tauri::State;
use tokio::sync::{mpsc, OnceCell};

use super::local_http;

pub mod mic;
pub mod silence;
pub mod versions;
pub mod voiceover;

const CHUNK: usize = 256 * 1024;

type Files = Arc<Mutex<HashMap<String, PathBuf>>>;

#[derive(Default)]
pub struct MediaState {
    port: OnceCell<u16>,
    files: Files,
}

/// `Range: bytes=a-b` against a file of `len` bytes -> inclusive (start, end).
/// None means "not satisfiable"; a missing header is handled by the caller.
pub fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = value.trim().strip_prefix("bytes=")?;
    // Multi-range requests are answered with their first range.
    let first = spec.split(',').next()?.trim();
    let (a, b) = first.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            if n == 0 {
                return None;
            }
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => (s.parse().ok()?, len - 1),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Streams [start, end] from disk on a thread; nothing is held in memory.
fn file_body(path: PathBuf, start: u64, end: u64) -> Body {
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(4);
    std::thread::spawn(move || {
        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.blocking_send(Err(e));
                return;
            }
        };
        if let Err(e) = file.seek(SeekFrom::Start(start)) {
            let _ = tx.blocking_send(Err(e));
            return;
        }
        let mut left = end - start + 1;
        let mut buf = vec![0u8; CHUNK];
        while left > 0 {
            let want = (left as usize).min(CHUNK);
            match file.read(&mut buf[..want]) {
                Ok(0) => break,
                Ok(n) => {
                    left -= n as u64;
                    if tx.blocking_send(Ok(Bytes::copy_from_slice(&buf[..n]))).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }
    });
    Body::from_stream(stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|item| (item, rx)) }))
}

async fn serve(AxumState(files): AxumState<Files>, UrlPath(token): UrlPath<String>, headers: HeaderMap) -> Response {
    let path = files.lock().ok().and_then(|m| m.get(&token).cloned());
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .expect("static response builds")
    };
    let Ok(cors) = local_http::allowed_origin(&headers) else {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Body::empty())
            .expect("static response builds");
    };
    let Some(path) = path else { return not_found() };
    let Ok(len) = std::fs::metadata(&path).map(|m| m.len()) else { return not_found() };

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime_for(&path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::VARY, "Origin");
    if let Some(origin) = cors {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let response = match range {
        None => builder
            .header(header::CONTENT_LENGTH, len)
            .body(if len == 0 { Body::empty() } else { file_body(path, 0, len - 1) }),
        Some(value) => match parse_range(value, len) {
            Some((start, end)) => builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(header::CONTENT_LENGTH, end - start + 1)
                .body(file_body(path, start, end)),
            None => builder
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Body::empty()),
        },
    };
    response.expect("media response builds")
}

impl MediaState {
    async fn ensure_server(&self) -> Result<u16, String> {
        let files = self.files.clone();
        self.port
            .get_or_try_init(|| async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .map_err(|e| format!("media server bind: {e}"))?;
                let port = listener.local_addr().map_err(|e| e.to_string())?.port();
                let app = Router::new().route("/media/{token}", get(serve)).with_state(files);
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = axum::serve(listener, app).await {
                        log::error!("media server stopped: {e}");
                    }
                });
                Ok(port)
            })
            .await
            .copied()
    }

    pub(crate) async fn publish(&self, path: PathBuf) -> Result<String, String> {
        let port = self.ensure_server().await?;
        let token = local_http::token();
        self.files
            .lock()
            .map_err(|_| "media state poisoned".to_string())?
            .insert(token.clone(), path);
        Ok(format!("http://127.0.0.1:{port}/media/{token}"))
    }
}

/// The file of a montage without a recording: `<stem>.edit.json` with no
/// `<stem>.mp4` next to it. Every sidecar still derives from the stem.
pub const BLANK_SUFFIX: &str = ".edit.json";

fn is_video_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("mp4") | Some("mov") | Some("m4v")
    )
}

/// A montage file is either a recording or a blank montage's `.edit.json`.
pub fn is_blank_montage(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(BLANK_SUFFIX) && n.len() > BLANK_SUFFIX.len())
}

/// Only recordings (video files that exist) may be opened or annotated.
pub fn recording_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !is_video_file(&path) {
        return Err("Only MP4 or MOV recordings can be opened.".into());
    }
    if !path.is_file() {
        return Err(format!("{} no longer exists.", path.display()));
    }
    Ok(path)
}

/// A recording, or a montage without one (`<stem>.edit.json`): what every
/// edit command accepts. Both must exist.
pub fn montage_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !is_video_file(&path) && !is_blank_montage(&path) {
        return Err("Only MP4 or MOV recordings, or .edit.json montages, can be opened.".into());
    }
    if !path.is_file() {
        return Err(format!("{} no longer exists.", path.display()));
    }
    Ok(path)
}

/// `rec.mp4` and `rec.edit.json` -> `rec`: what every sidecar is named after.
pub fn stem_name(video: &Path) -> &str {
    let name = video.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    match name.strip_suffix(BLANK_SUFFIX) {
        Some(stem) if is_blank_montage(video) => stem,
        _ => video.file_stem().and_then(|s| s.to_str()).unwrap_or_default(),
    }
}

/// `video.mp4` -> `video.<suffix>` next to it (also from `video.edit.json`).
pub fn sidecar(video: &Path, suffix: &str) -> PathBuf {
    let name = format!("{}.{suffix}", stem_name(video));
    match video.parent() {
        Some(dir) => dir.join(name),
        None => PathBuf::from(name),
    }
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRecording {
    video_path: String,
    /// None: a montage without a recording (nothing to serve).
    video_url: Option<String>,
    name: String,
    interactions: Option<serde_json::Value>,
    edit: Option<serde_json::Value>,
    camera_url: Option<String>,
    mic_url: Option<String>,
    /// Files added in the editor, by file name inside the assets folder.
    assets: HashMap<String, String>,
}

/// What an imported file is, from its extension. None: not importable.
pub fn asset_kind(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg") => Some("image"),
        Some("mp4" | "mov" | "m4v" | "webm") => Some("video"),
        Some("mp3" | "m4a" | "aac" | "wav" | "ogg") => Some("audio"),
        _ => None,
    }
}

/// `rec.mp4` -> `rec.assets/`: media added in the editor travel with the recording.
pub fn assets_dir(video: &Path) -> PathBuf {
    sidecar(video, "assets")
}

/// A file of the assets folder, by bare name only.
pub fn asset_file(video: &Path, name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return None;
    }
    let path = assets_dir(video).join(name);
    path.is_file().then_some(path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    id: String,
    name: String,
    kind: &'static str,
    file: String,
    url: String,
}

/// Copies a picked file next to the recording, so the edit never depends on
/// where the original lives, and serves it to the editor.
#[tauri::command]
pub async fn asset_import(state: State<'_, MediaState>, video_path: String, source: String) -> Result<ImportedAsset, String> {
    let video = montage_path(&video_path)?;
    let source = PathBuf::from(source);
    let kind = asset_kind(&source).ok_or("This file type cannot be added. Use an image, a video or an audio file.")?;
    if !source.is_file() {
        return Err(format!("{} no longer exists.", source.display()));
    }
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    let id = uuid::Uuid::new_v4().simple().to_string();
    let file = format!("{id}.{ext}");
    let dir = assets_dir(&video);
    let target = dir.join(&file);
    let copy_from = source.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        std::fs::copy(&copy_from, &target).map(|_| ()).map_err(|e| format!("copy: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    let url = state.publish(assets_dir(&video).join(&file)).await?;
    Ok(ImportedAsset {
        name: source.file_stem().and_then(|s| s.to_str()).unwrap_or("Media").to_string(),
        id,
        kind,
        file,
        url,
    })
}

/// A companion file named in the interactions sidecar: a bare file name in
/// the recording's folder, never a path that could point elsewhere.
pub fn companion_file(video: &Path, name: Option<&str>) -> Option<PathBuf> {
    let name = name?;
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return None;
    }
    let path = video.parent()?.join(name);
    path.is_file().then_some(path)
}

#[tauri::command]
pub async fn recording_open(state: State<'_, MediaState>, video_path: String) -> Result<OpenedRecording, String> {
    let path = montage_path(&video_path)?;
    // A blank montage has no video to serve, and no journal, camera or mic.
    let video_url = if is_blank_montage(&path) { None } else { Some(state.publish(path.clone()).await?) };
    let interactions = if video_url.is_some() { read_json(&sidecar(&path, "interactions.json")) } else { None };
    let media = |key: &str| {
        interactions
            .as_ref()
            .and_then(|i| i.get("media"))
            .and_then(|m| m.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_owned)
    };
    let camera_url = match companion_file(&path, media("camera").as_deref()) {
        Some(p) => Some(state.publish(p).await?),
        None => None,
    };
    let mic_url = match companion_file(&path, media("mic").as_deref()) {
        Some(p) => {
            // Takes recorded before voice cleanup existed get it once, here.
            let mic = p.clone();
            let cleaned = tauri::async_runtime::spawn_blocking(move || crate::modules::recording::voice::ensure_enhanced(&mic)).await;
            if let Ok(Err(e)) = cleaned {
                log::warn!("{e}");
            }
            Some(state.publish(p).await?)
        }
        None => None,
    };
    let mut assets = HashMap::new();
    if let Ok(read) = std::fs::read_dir(assets_dir(&path)) {
        for entry in read.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(file) = asset_file(&path, &name) {
                assets.insert(name, state.publish(file).await?);
            }
        }
    }
    Ok(OpenedRecording {
        name: Some(stem_name(&path)).filter(|s| !s.is_empty()).unwrap_or("Recording").to_string(),
        camera_url,
        mic_url,
        assets,
        interactions,
        edit: read_json(&sidecar(&path, "edit.json")),
        video_path: path.to_string_lossy().into_owned(),
        video_url,
    })
}

/// Saves the non-destructive edit next to the recording. The MP4 is never touched.
#[tauri::command(async)]
pub fn edit_save(video_path: String, edit: serde_json::Value) -> Result<(), String> {
    let path = montage_path(&video_path)?;
    let json = serde_json::to_vec_pretty(&edit).map_err(|e| e.to_string())?;
    let target = sidecar(&path, "edit.json");
    let tmp = sidecar(&path, "edit.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("save {}: {e}", target.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEntry {
    path: String,
    name: String,
    modified_ms: u64,
    has_interactions: bool,
}

/// Raw captures, newest first. Exports and temp files are not recordings.
pub fn is_raw_recording(name: &str) -> bool {
    // Webcam companions are part of a take, not takes of their own.
    name.starts_with("goscreen-")
        && name.ends_with(".mp4")
        && !name.contains("-export-")
        && !name.ends_with(".video.mp4")
        && !name.ends_with(".camera.mp4")
}

#[tauri::command(async)]
pub fn recordings_list() -> Result<Vec<RecordingEntry>, String> {
    let Some(dir) = dirs::video_dir().or_else(dirs::home_dir).map(|d| d.join("goScreen")) else {
        return Ok(Vec::new());
    };
    let Ok(read) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut out: Vec<RecordingEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_raw_recording(&name) {
                return None;
            }
            let path = entry.path();
            let modified_ms = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or_default();
            Some(RecordingEntry {
                has_interactions: sidecar(&path, "interactions.json").is_file(),
                name: path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string(),
                path: path.to_string_lossy().into_owned(),
                modified_ms,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out.truncate(50);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_raw_recordings() {
        assert!(is_raw_recording("goscreen-1759.mp4"));
        assert!(!is_raw_recording("goscreen-1759-export-1760.mp4"));
        assert!(!is_raw_recording("goscreen-1759-export-1760.video.mp4"));
        assert!(!is_raw_recording("goscreen-1759.interactions.json"));
        assert!(!is_raw_recording("goscreen-1759.camera.mp4"));
        assert!(!is_raw_recording("holiday.mp4"));
    }

    #[test]
    fn parses_byte_ranges() {
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=0-1", 1000), Some((0, 1)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=10-20, 30-40", 1000), Some((10, 20)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-2", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn companion_files_stay_in_the_recording_folder() {
        let video = Path::new("/tmp/rec.mp4");
        assert_eq!(companion_file(video, Some("../etc/passwd")), None);
        assert_eq!(companion_file(video, Some("/etc/passwd")), None);
        assert_eq!(companion_file(video, Some(".hidden")), None);
        assert_eq!(companion_file(video, None), None);
    }

    #[test]
    fn assets_stay_in_their_folder_and_are_typed() {
        let video = Path::new("/tmp/rec.mp4");
        assert_eq!(assets_dir(video), PathBuf::from("/tmp/rec.assets"));
        assert_eq!(asset_file(video, "../rec.mp4"), None);
        assert_eq!(asset_file(video, ".DS_Store"), None);
        assert_eq!(asset_kind(Path::new("logo.PNG")), Some("image"));
        assert_eq!(asset_kind(Path::new("clip.mov")), Some("video"));
        assert_eq!(asset_kind(Path::new("song.mp3")), Some("audio"));
        assert_eq!(asset_kind(Path::new("notes.txt")), None);
    }

    #[test]
    fn only_opens_video_files() {
        assert!(recording_path("/etc/passwd").is_err());
        assert!(recording_path("/nope/missing.mp4").is_err());
        assert_eq!(sidecar(Path::new("/a/rec.mp4"), "edit.json"), PathBuf::from("/a/rec.edit.json"));
    }

    #[test]
    fn a_blank_montage_shares_the_sidecar_layout_of_a_recording() {
        let blank = Path::new("/a/launch.edit.json");
        assert!(is_blank_montage(blank));
        assert!(!is_blank_montage(Path::new("/a/.edit.json")));
        assert!(!is_blank_montage(Path::new("/a/rec.mp4")));
        assert_eq!(stem_name(blank), "launch");
        assert_eq!(stem_name(Path::new("/a/rec.mp4")), "rec");
        assert_eq!(sidecar(blank, "edit.json"), PathBuf::from("/a/launch.edit.json"));
        assert_eq!(sidecar(blank, "versions"), PathBuf::from("/a/launch.versions"));
        assert_eq!(assets_dir(blank), PathBuf::from("/a/launch.assets"));
        // A stem with a dot keeps it whole.
        assert_eq!(sidecar(Path::new("/a/v1.2.mp4"), "assets"), PathBuf::from("/a/v1.2.assets"));
        assert!(montage_path("/etc/passwd").is_err());
        assert!(montage_path("/nope/missing.edit.json").is_err());
        let dir = std::env::temp_dir().join(format!("goscreen-blank-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("launch.edit.json");
        std::fs::write(&file, b"{}").unwrap();
        assert!(montage_path(&file.to_string_lossy()).is_ok());
        assert!(recording_path(&file.to_string_lossy()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

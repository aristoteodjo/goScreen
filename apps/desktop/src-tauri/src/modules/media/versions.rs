//! Durable versions of a montage, next to it: `<stem>.versions/<id>.json`
//! holds one full version (author, command, message, state) and
//! `index.json` lists them without their states. Every write is atomic.
//! Paths derive from the opened recording, never from the caller.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::recording_path;

const INDEX: &str = "index.json";

/// `rec.mp4` -> `rec.versions/`.
pub fn versions_dir(video: &Path) -> PathBuf {
    video.with_extension("versions")
}

/// Ids are written by the studio: short, lowercase, no path characters.
pub fn valid_version_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn version_file(video: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_version_id(id) {
        return Err(format!("Bad version id {id:?}."));
    }
    Ok(versions_dir(video).join(format!("{id}.json")))
}

/// Writes through a temporary file in the same folder, then renames.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let Some(dir) = path.parent() else {
        return Err("No folder to write in.".into());
    };
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("save {}: {e}", path.display()))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct VersionMeta {
    pub id: String,
    pub at: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    versions: Vec<VersionMeta>,
}

/// The metadata of a version document; the state must be an object.
pub fn meta_of(version: &serde_json::Value) -> Result<VersionMeta, String> {
    let meta: VersionMeta = serde_json::from_value(version.clone()).map_err(|e| format!("Bad version: {e}"))?;
    if !valid_version_id(&meta.id) {
        return Err(format!("Bad version id {:?}.", meta.id));
    }
    if meta.author != "person" && meta.author != "ai" {
        return Err(format!("Bad version author {:?}.", meta.author));
    }
    if !version.get("state").is_some_and(serde_json::Value::is_object) {
        return Err("A version needs a state.".into());
    }
    Ok(meta)
}

fn read_index(video: &Path) -> Option<Vec<VersionMeta>> {
    let bytes = std::fs::read(versions_dir(video).join(INDEX)).ok()?;
    serde_json::from_slice::<Index>(&bytes).ok().map(|i| i.versions)
}

/// Without an index (or a broken one), the files themselves are the truth.
fn scan_versions(video: &Path) -> Vec<VersionMeta> {
    let Ok(read) = std::fs::read_dir(versions_dir(video)) else {
        return Vec::new();
    };
    read.filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json") && p.file_name().and_then(|n| n.to_str()) != Some(INDEX))
        .filter_map(|p| {
            let bytes = std::fs::read(&p).ok()?;
            let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
            meta_of(&value).ok()
        })
        .collect()
}

fn write_index(video: &Path, mut versions: Vec<VersionMeta>) -> Result<(), String> {
    versions.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
    let json = serde_json::to_vec(&Index { versions }).map_err(|e| e.to_string())?;
    write_atomic(&versions_dir(video).join(INDEX), &json)
}

/// Every version, oldest first.
pub fn list_versions(video: &Path) -> Vec<VersionMeta> {
    let mut versions = read_index(video).unwrap_or_else(|| scan_versions(video));
    versions.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
    versions
}

pub fn write_version(video: &Path, version: &serde_json::Value) -> Result<VersionMeta, String> {
    let meta = meta_of(version)?;
    let json = serde_json::to_vec(version).map_err(|e| e.to_string())?;
    write_atomic(&version_file(video, &meta.id)?, &json)?;
    let mut versions: Vec<VersionMeta> = list_versions(video).into_iter().filter(|v| v.id != meta.id).collect();
    versions.push(meta.clone());
    write_index(video, versions)?;
    Ok(meta)
}

pub fn get_version(video: &Path, id: &str) -> Result<serde_json::Value, String> {
    let path = version_file(video, id)?;
    let bytes = std::fs::read(&path).map_err(|_| format!("Version {id} does not exist."))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Version {id} cannot be read: {e}"))
}

pub fn delete_version(video: &Path, id: &str) -> Result<(), String> {
    let path = version_file(video, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("delete {}: {e}", path.display())),
    }
    let versions: Vec<VersionMeta> = list_versions(video).into_iter().filter(|v| v.id != id).collect();
    write_index(video, versions)
}

/// A hard link when the file system allows it (the same bytes, no copy), else a copy.
fn link_or_copy(src: &Path, dst: &Path) -> Result<(), String> {
    if std::fs::hard_link(src, dst).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dst).map(|_| ()).map_err(|e| format!("copy {}: {e}", src.display()))
}

fn clone_tree(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| format!("create {}: {e}", dst.display()))?;
        for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.filter_map(Result::ok) {
            let name = entry.file_name();
            if name.to_string_lossy().ends_with(".tmp") {
                continue;
            }
            clone_tree(&entry.path(), &dst.join(name))?;
        }
        Ok(())
    } else {
        link_or_copy(src, dst)
    }
}

/// `"Variante B"` -> `"variante-b"`; empty -> `"copy"`.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "copy".into()
    } else {
        out.chars().take(40).collect::<String>().trim_matches('-').to_string()
    }
}

/// `goscreen-1.mp4` + "copy" -> `goscreen-1-copy.mp4`, numbered if taken.
pub fn free_stem(dir: &Path, stem: &str, suffix: &str) -> String {
    let base = format!("{stem}-{suffix}");
    if !dir.join(format!("{base}.mp4")).exists() {
        return base;
    }
    (2..1000)
        .map(|n| format!("{base}-{n}"))
        .find(|s| !dir.join(format!("{s}.mp4")).exists())
        .unwrap_or_else(|| format!("{base}-{}", uuid::Uuid::new_v4().simple()))
}

/// Companion names inside a journal (`media.camera`) follow the new stem.
pub fn rename_media(interactions: &mut serde_json::Value, stem: &str, new_stem: &str) {
    let Some(media) = interactions.get_mut("media").and_then(serde_json::Value::as_object_mut) else {
        return;
    };
    for value in media.values_mut() {
        if let Some(rest) = value.as_str().and_then(|s| s.strip_prefix(&format!("{stem}."))) {
            *value = serde_json::Value::String(format!("{new_stem}.{rest}"));
        }
    }
}

/// A new montage from this one: the video (linked), every sidecar and the
/// versions, under a new stem in the same folder. Returns the new video path.
pub fn duplicate(video: &Path, name: Option<&str>) -> Result<PathBuf, String> {
    let dir = video.parent().ok_or("The video has no folder.")?;
    let stem = video.file_stem().and_then(|s| s.to_str()).ok_or("The video has no name.")?;
    let ext = video.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    let new_stem = free_stem(dir, stem, &slug(name.unwrap_or("")));
    let target = dir.join(format!("{new_stem}.{ext}"));
    link_or_copy(video, &target)?;
    let prefix = format!("{stem}.");
    let entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p != video)
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&prefix) && !n.ends_with(".tmp")))
        .collect();
    for src in entries {
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        let dst = dir.join(format!("{new_stem}.{}", &name[prefix.len()..]));
        if name == format!("{stem}.interactions.json") {
            let bytes = std::fs::read(&src).map_err(|e| e.to_string())?;
            match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(mut journal) => {
                    rename_media(&mut journal, stem, &new_stem);
                    let json = serde_json::to_vec(&journal).map_err(|e| e.to_string())?;
                    std::fs::write(&dst, json).map_err(|e| format!("write {}: {e}", dst.display()))?;
                }
                Err(_) => link_or_copy(&src, &dst)?,
            }
        } else {
            clone_tree(&src, &dst)?;
        }
    }
    Ok(target)
}

#[tauri::command(async)]
pub fn edit_versions_list(video_path: String) -> Result<Vec<VersionMeta>, String> {
    let video = recording_path(&video_path)?;
    Ok(list_versions(&video))
}

#[tauri::command(async)]
pub fn edit_version_get(video_path: String, id: String) -> Result<serde_json::Value, String> {
    let video = recording_path(&video_path)?;
    get_version(&video, &id)
}

#[tauri::command(async)]
pub fn edit_version_write(video_path: String, version: serde_json::Value) -> Result<VersionMeta, String> {
    let video = recording_path(&video_path)?;
    write_version(&video, &version)
}

#[tauri::command(async)]
pub fn edit_version_delete(video_path: String, id: String) -> Result<(), String> {
    let video = recording_path(&video_path)?;
    delete_version(&video, &id)
}

/// Returns the new video's path, to open in the editor.
#[tauri::command(async)]
pub fn edit_duplicate(video_path: String, name: Option<String>) -> Result<String, String> {
    let video = recording_path(&video_path)?;
    duplicate(&video, name.as_deref()).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_video(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("goscreen-versions-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("goscreen-1.mp4");
        std::fs::write(&video, b"not really a video").unwrap();
        video
    }

    fn version(id: &str, at: &str, author: &str, command: Option<&str>) -> serde_json::Value {
        let mut v = json!({ "id": id, "at": at, "author": author, "state": { "version": 2, "clips": [] } });
        if let Some(c) = command {
            v["command"] = json!(c);
        }
        v
    }

    #[test]
    fn ids_never_carry_a_path() {
        assert!(valid_version_id("m2x9k-ab12"));
        for bad in ["", "..", "a/b", "a\\b", "A", "a.json", "é"] {
            assert!(!valid_version_id(bad), "{bad}");
        }
        assert!(version_file(Path::new("/m/rec.mp4"), "../x").is_err());
        assert_eq!(version_file(Path::new("/m/rec.mp4"), "abc").unwrap(), PathBuf::from("/m/rec.versions/abc.json"));
    }

    #[test]
    fn versions_are_written_listed_read_and_deleted() {
        let video = temp_video("crud");
        write_version(&video, &version("b", "2026-10-21T10:00:00Z", "ai", Some("edit.setFilm"))).unwrap();
        write_version(&video, &version("a", "2026-10-21T09:00:00Z", "person", None)).unwrap();
        assert!(write_version(&video, &json!({ "id": "c", "at": "x", "author": "robot", "state": {} })).is_err());
        assert!(write_version(&video, &json!({ "id": "c", "at": "x", "author": "ai" })).is_err());

        let listed = list_versions(&video);
        assert_eq!(listed.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(listed[1].command.as_deref(), Some("edit.setFilm"));
        assert!(!std::fs::read_to_string(versions_dir(&video).join(INDEX)).unwrap().contains("clips"));

        let got = get_version(&video, "b").unwrap();
        assert_eq!(got["state"]["version"], 2);
        assert!(get_version(&video, "zzz").is_err());

        delete_version(&video, "a").unwrap();
        assert_eq!(list_versions(&video).len(), 1);
        assert!(!versions_dir(&video).join("a.json").exists());
        // Deleting twice is fine.
        delete_version(&video, "a").unwrap();
        std::fs::remove_dir_all(video.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_lost_index_is_rebuilt_from_the_files() {
        let video = temp_video("scan");
        write_version(&video, &version("a", "2026-10-21T09:00:00Z", "person", None)).unwrap();
        write_version(&video, &version("b", "2026-10-21T10:00:00Z", "person", Some("save"))).unwrap();
        std::fs::remove_file(versions_dir(&video).join(INDEX)).unwrap();
        std::fs::write(versions_dir(&video).join("junk.json"), b"{").unwrap();
        let listed = list_versions(&video);
        assert_eq!(listed.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        std::fs::remove_dir_all(video.parent().unwrap()).unwrap();
    }

    #[test]
    fn duplicate_carries_the_sidecars_under_a_new_stem() {
        let video = temp_video("dup");
        let dir = video.parent().unwrap().to_path_buf();
        std::fs::write(dir.join("goscreen-1.edit.json"), b"{\"version\":2}").unwrap();
        std::fs::write(
            dir.join("goscreen-1.interactions.json"),
            serde_json::to_vec(&json!({ "version": 3, "media": { "camera": "goscreen-1.camera.mp4", "offsetMs": 12 } })).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.join("goscreen-1.camera.mp4"), b"cam").unwrap();
        std::fs::write(dir.join("goscreen-1.edit.json.tmp"), b"junk").unwrap();
        std::fs::create_dir_all(dir.join("goscreen-1.assets")).unwrap();
        std::fs::write(dir.join("goscreen-1.assets/logo.png"), b"png").unwrap();
        write_version(&video, &version("a", "2026-10-21T09:00:00Z", "person", None)).unwrap();
        // Another take whose name merely starts the same must not come along.
        std::fs::write(dir.join("goscreen-10.edit.json"), b"{}").unwrap();

        let copy = duplicate(&video, Some("Variante B")).unwrap();
        assert_eq!(copy, dir.join("goscreen-1-variante-b.mp4"));
        assert!(copy.is_file());
        assert!(dir.join("goscreen-1-variante-b.edit.json").is_file());
        assert!(!dir.join("goscreen-1-variante-b.edit.json.tmp").exists());
        assert!(dir.join("goscreen-1-variante-b.camera.mp4").is_file());
        assert!(dir.join("goscreen-1-variante-b.assets/logo.png").is_file());
        assert_eq!(list_versions(&copy).len(), 1);
        assert!(!dir.join("goscreen-1-variante-b0.edit.json").exists());
        let journal: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("goscreen-1-variante-b.interactions.json")).unwrap()).unwrap();
        assert_eq!(journal["media"]["camera"], "goscreen-1-variante-b.camera.mp4");
        assert_eq!(journal["media"]["offsetMs"], 12);

        // The second copy with the same name gets a number.
        let again = duplicate(&video, Some("Variante B")).unwrap();
        assert_eq!(again, dir.join("goscreen-1-variante-b-2.mp4"));
        assert_eq!(duplicate(&video, None).unwrap(), dir.join("goscreen-1-copy.mp4"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn slugs_are_short_and_safe() {
        assert_eq!(slug("Variante B"), "variante-b");
        assert_eq!(slug("  ../étrange/ "), "trange");
        assert_eq!(slug(""), "copy");
        assert_eq!(slug("---"), "copy");
    }
}

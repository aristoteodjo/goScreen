//! Compositions: HTML pages (written by an AI or a person) rendered as video
//! layers. Those of a montage live in `<stem>.assets/compositions/<id>.json`;
//! a project's library in `<project>/compositions/<id>.json`, shared by every
//! video of the project. The studio sends a video path (as everywhere in the
//! editor) and ids, never a file path to a composition.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use super::{media, projects::valid_id};

const DIR: &str = "compositions";

fn check_id(id: &str) -> Result<(), String> {
    if valid_id(id) { Ok(()) } else { Err(format!("Invalid composition id \"{id}\" (lowercase letters, digits and dashes).")) }
}

/// The compositions of a montage: next to its other assets.
pub fn video_dir(video: &Path) -> PathBuf {
    media::assets_dir(video).join(DIR)
}

/// The project library, when the video sits in a project folder.
pub fn library_dir(video: &Path) -> Option<PathBuf> {
    let parent = video.parent()?;
    parent.join("project.json").is_file().then(|| parent.join(DIR))
}

fn read_all(dir: &Path) -> Vec<Value> {
    let Ok(read) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = read
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .filter(|p| p.file_stem().and_then(|s| s.to_str()).is_some_and(valid_id))
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|p| serde_json::from_slice::<Value>(&std::fs::read(p).ok()?).ok())
        .filter(|v| v.is_object())
        .collect()
}

/// Atomic write: a crash never leaves half a file.
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let dir = path.parent().ok_or("No folder")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("save {}: {e}", path.display()))
}

#[derive(Serialize)]
pub struct Compositions {
    /// Those of the montage.
    video: Vec<Value>,
    /// Those of the project library (empty outside a project).
    library: Vec<Value>,
    /// Whether the video belongs to a project (so a library exists).
    project: bool,
}

pub fn list(video: &Path) -> Compositions {
    let library = library_dir(video);
    Compositions {
        video: read_all(&video_dir(video)),
        library: library.as_deref().map(read_all).unwrap_or_default(),
        project: library.is_some(),
    }
}

/// Where a composition is kept: the montage's folder, or the project library.
fn file_of(video: &Path, id: &str, library: bool) -> Result<PathBuf, String> {
    check_id(id)?;
    let dir = if library {
        library_dir(video).ok_or("This video is not in a project, so it has no library.")?
    } else {
        video_dir(video)
    };
    Ok(dir.join(format!("{id}.json")))
}

pub fn load(video: &Path, id: &str) -> Result<Value, String> {
    check_id(id)?;
    let candidates = [Some(video_dir(video)), library_dir(video)];
    for dir in candidates.into_iter().flatten() {
        let path = dir.join(format!("{id}.json"));
        if path.is_file() {
            let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            return serde_json::from_slice(&bytes).map_err(|e| format!("{} is not valid JSON: {e}", path.display()));
        }
    }
    Err(format!("No composition \"{id}\" in this video or its project."))
}

pub fn save(video: &Path, id: &str, doc: &Value, library: bool) -> Result<(), String> {
    if !doc.is_object() {
        return Err("A composition is a JSON object.".into());
    }
    if doc.get("id").and_then(Value::as_str) != Some(id) {
        return Err("The composition's id must match.".into());
    }
    write_json(&file_of(video, id, library)?, doc)
}

pub fn delete(video: &Path, id: &str, library: bool) -> Result<(), String> {
    let path = file_of(video, id, library)?;
    if !path.is_file() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))
}

#[tauri::command(async)]
pub fn composition_list(video_path: String) -> Result<Compositions, String> {
    Ok(list(&media::montage_path(&video_path)?))
}

#[tauri::command(async)]
pub fn composition_load(video_path: String, id: String) -> Result<Value, String> {
    load(&media::montage_path(&video_path)?, &id)
}

/// Saves a composition with the montage, or (`library`) in the project library.
#[tauri::command(async)]
pub fn composition_save(video_path: String, id: String, doc: Value, library: bool) -> Result<(), String> {
    save(&media::montage_path(&video_path)?, &id, &doc, library)
}

#[tauri::command(async)]
pub fn composition_delete(video_path: String, id: String, library: bool) -> Result<(), String> {
    delete(&media::montage_path(&video_path)?, &id, library)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder in the temp dir, removed when dropped.
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn sandbox(project: bool) -> (Sandbox, PathBuf) {
        let dir = Sandbox(std::env::temp_dir().join(format!("goscreen-compositions-{}", uuid::Uuid::new_v4())));
        std::fs::create_dir_all(dir.path()).unwrap();
        if project {
            std::fs::write(dir.path().join("project.json"), b"{\"name\":\"p\"}").unwrap();
        }
        let video = dir.path().join("take.mp4");
        std::fs::write(&video, b"").unwrap();
        (dir, video)
    }

    fn doc(id: &str) -> Value {
        serde_json::json!({ "id": id, "label": id, "html": "<p>" })
    }

    #[test]
    fn compositions_live_next_to_the_assets_and_in_the_project_library() {
        let (dir, video) = sandbox(true);
        save(&video, "orbit", &doc("orbit"), false).unwrap();
        save(&video, "brand", &doc("brand"), true).unwrap();
        assert!(dir.path().join("take.assets/compositions/orbit.json").is_file());
        assert!(dir.path().join("compositions/brand.json").is_file());
        let all = list(&video);
        assert!(all.project);
        assert_eq!(all.video.len(), 1);
        assert_eq!(all.library[0]["id"], "brand");
        assert_eq!(load(&video, "brand").unwrap()["label"], "brand");
        delete(&video, "orbit", false).unwrap();
        assert!(list(&video).video.is_empty());
        assert!(load(&video, "orbit").is_err());
    }

    #[test]
    fn outside_a_project_there_is_no_library() {
        let (_dir, video) = sandbox(false);
        assert!(library_dir(&video).is_none());
        assert!(save(&video, "x", &doc("x"), true).is_err());
        assert!(!list(&video).project);
    }

    #[test]
    fn ids_are_checked_and_must_match_the_document() {
        let (_dir, video) = sandbox(false);
        assert!(save(&video, "../x", &doc("../x"), false).is_err());
        assert!(save(&video, "Bad", &doc("Bad"), false).is_err());
        assert!(save(&video, "ok", &doc("other"), false).is_err());
        assert!(save(&video, "ok", &Value::Null, false).is_err());
        assert!(load(&video, "a/b").is_err());
    }

    #[test]
    fn broken_files_are_skipped_in_a_listing() {
        let (_dir, video) = sandbox(false);
        save(&video, "fine", &doc("fine"), false).unwrap();
        std::fs::write(video_dir(&video).join("broken.json"), b"{").unwrap();
        std::fs::write(video_dir(&video).join("Not-An-Id.json"), b"{}").unwrap();
        assert_eq!(list(&video).video.len(), 1);
    }
}

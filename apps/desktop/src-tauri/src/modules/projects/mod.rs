//! Projects: one folder per project under `<Videos>/goScreen/Projects`, holding
//! its VSLs (`vsls/<id>.flow.json`, scene flows) and the takes recorded from
//! them. The studio only ever sends ids, never paths; deleting moves to the
//! system trash.

use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;

use super::{media, scenario::slug};

const PROJECT_FILE: &str = "project.json";
const VSL_DIR: &str = "vsls";
const VSL_EXT: &str = ".flow.json";

/// An id the studio may send: lowercase slug, no path separators or dots.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn check_id(id: &str) -> Result<(), String> {
    if valid_id(id) { Ok(()) } else { Err(format!("Invalid id \"{id}\".")) }
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give it a name.".into());
    }
    if name.chars().count() > 80 {
        return Err("Names stay under 80 characters.".into());
    }
    Ok(name.to_string())
}

/// A free id from a name: `slug`, then `slug-2`, `slug-3`...
pub fn unique_id(name: &str, taken: impl Fn(&str) -> bool) -> String {
    let base = slug(name);
    if !taken(&base) {
        return base;
    }
    (2..).map(|n| format!("{base}-{n}")).find(|id| !taken(id)).expect("an id is always free")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

pub fn root() -> Result<PathBuf, String> {
    let dir = dirs::video_dir().or_else(dirs::home_dir).ok_or("No home directory")?.join("goScreen").join("Projects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// The folder of an existing project.
pub fn project_dir(id: &str) -> Result<PathBuf, String> {
    check_id(id)?;
    let dir = root()?.join(id);
    if dir.join(PROJECT_FILE).is_file() { Ok(dir) } else { Err("This project no longer exists.".into()) }
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Atomic write: a crash never leaves half a file.
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("save {}: {e}", path.display()))
}

fn name_of(json: Option<Value>, fallback: &str) -> String {
    json.and_then(|v| v.get("name").and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| fallback.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    id: String,
    name: String,
    created_ms: u64,
    modified_ms: u64,
    vsls: usize,
    videos: usize,
}

fn vsl_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir.join(VSL_DIR)) else { return Vec::new() };
    read.filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(VSL_EXT)))
        .collect()
}

fn video_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else { return Vec::new() };
    read.filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| media::is_raw_recording(n) || is_export(n)))
        .collect()
}

fn is_export(name: &str) -> bool {
    name.starts_with("goscreen-") && name.contains("-export-") && name.ends_with(".mp4")
}

#[tauri::command(async)]
pub fn projects_list() -> Result<Vec<ProjectEntry>, String> {
    let root = root()?;
    let mut out: Vec<ProjectEntry> = std::fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            let dir = entry.path();
            let meta = dir.join(PROJECT_FILE);
            if !valid_id(&id) || !meta.is_file() {
                return None;
            }
            let json = read_json(&meta);
            let created_ms = json.as_ref().and_then(|v| v.get("createdMs")).and_then(Value::as_u64).unwrap_or_default();
            let vsls = vsl_files(&dir);
            let videos = video_files(&dir);
            let latest = vsls.iter().chain(videos.iter()).map(|p| modified_ms(p)).max().unwrap_or_default();
            Some(ProjectEntry {
                name: name_of(json, &id),
                created_ms,
                modified_ms: latest.max(modified_ms(&meta)),
                vsls: vsls.len(),
                videos: videos
                    .iter()
                    .filter(|p| !p.file_name().and_then(|n| n.to_str()).is_some_and(is_export))
                    .count(),
                id,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

#[tauri::command(async)]
pub fn project_create(name: String) -> Result<String, String> {
    let name = clean_name(&name)?;
    let root = root()?;
    let id = unique_id(&name, |id| root.join(id).exists());
    let dir = root.join(&id);
    std::fs::create_dir_all(dir.join(VSL_DIR)).map_err(|e| format!("create {}: {e}", dir.display()))?;
    write_json(&dir.join(PROJECT_FILE), &serde_json::json!({ "version": 1, "name": name, "createdMs": now_ms() }))?;
    Ok(id)
}

#[tauri::command(async)]
pub fn project_rename(id: String, name: String) -> Result<(), String> {
    let name = clean_name(&name)?;
    let meta = project_dir(&id)?.join(PROJECT_FILE);
    let mut json = read_json(&meta).unwrap_or_else(|| serde_json::json!({ "version": 1 }));
    json["name"] = Value::String(name);
    write_json(&meta, &json)
}

/// Copies the project's VSLs (not its videos) into a new project.
#[tauri::command(async)]
pub fn project_duplicate(id: String) -> Result<String, String> {
    let dir = project_dir(&id)?;
    let name = format!("{} (copy)", name_of(read_json(&dir.join(PROJECT_FILE)), &id));
    let copy = project_create(name)?;
    let target = project_dir(&copy)?.join(VSL_DIR);
    for file in vsl_files(&dir) {
        if let Some(name) = file.file_name() {
            std::fs::copy(&file, target.join(name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(copy)
}

/// Moves the whole folder (videos included) to the system trash.
#[tauri::command(async)]
pub fn project_delete(id: String) -> Result<(), String> {
    let dir = project_dir(&id)?;
    trash::delete(&dir).map_err(|e| format!("Could not move to the trash: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VslEntry {
    id: String,
    name: String,
    modified_ms: u64,
}

fn vsl_path(project: &str, vsl: &str) -> Result<PathBuf, String> {
    check_id(vsl)?;
    Ok(project_dir(project)?.join(VSL_DIR).join(format!("{vsl}{VSL_EXT}")))
}

#[tauri::command(async)]
pub fn vsl_list(project: String) -> Result<Vec<VslEntry>, String> {
    let dir = project_dir(&project)?;
    let mut out: Vec<VslEntry> = vsl_files(&dir)
        .into_iter()
        .filter_map(|p| {
            let id = p.file_name()?.to_str()?.strip_suffix(VSL_EXT)?.to_string();
            valid_id(&id).then(|| VslEntry { name: name_of(read_json(&p), &id), modified_ms: modified_ms(&p), id })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Creates a VSL from a flow document; its `name` is set from `name`.
#[tauri::command(async)]
pub fn vsl_create(project: String, name: String, doc: Value) -> Result<String, String> {
    let name = clean_name(&name)?;
    let dir = project_dir(&project)?.join(VSL_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = unique_id(&name, |id| dir.join(format!("{id}{VSL_EXT}")).exists());
    let mut doc = doc;
    if !doc.is_object() {
        return Err("Invalid flow.".into());
    }
    doc["name"] = Value::String(name);
    write_json(&dir.join(format!("{id}{VSL_EXT}")), &doc)?;
    Ok(id)
}

#[tauri::command(async)]
pub fn vsl_load(project: String, vsl: String) -> Result<Value, String> {
    let path = vsl_path(&project, &vsl)?;
    read_json(&path).ok_or_else(|| "This VSL no longer exists or cannot be read.".into())
}

#[tauri::command(async)]
pub fn vsl_save(project: String, vsl: String, doc: Value) -> Result<(), String> {
    let path = vsl_path(&project, &vsl)?;
    if !path.is_file() {
        return Err("This VSL no longer exists.".into());
    }
    if !doc.is_object() {
        return Err("Invalid flow.".into());
    }
    write_json(&path, &doc)
}

#[tauri::command(async)]
pub fn vsl_rename(project: String, vsl: String, name: String) -> Result<(), String> {
    let name = clean_name(&name)?;
    let path = vsl_path(&project, &vsl)?;
    let mut doc = read_json(&path).ok_or("This VSL no longer exists.")?;
    doc["name"] = Value::String(name);
    write_json(&path, &doc)
}

#[tauri::command(async)]
pub fn vsl_duplicate(project: String, vsl: String) -> Result<String, String> {
    let doc = vsl_load(project.clone(), vsl.clone())?;
    let name = format!("{} (copy)", name_of(Some(doc.clone()), &vsl));
    vsl_create(project, name, doc)
}

#[tauri::command(async)]
pub fn vsl_delete(project: String, vsl: String) -> Result<(), String> {
    let path = vsl_path(&project, &vsl)?;
    trash::delete(&path).map_err(|e| format!("Could not move to the trash: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEntry {
    path: String,
    name: String,
    modified_ms: u64,
    export: bool,
}

#[tauri::command(async)]
pub fn project_videos(project: String) -> Result<Vec<VideoEntry>, String> {
    let dir = project_dir(&project)?;
    let mut out: Vec<VideoEntry> = video_files(&dir)
        .into_iter()
        .map(|p| VideoEntry {
            name: p.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string(),
            modified_ms: modified_ms(&p),
            export: is_export(&p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string()),
            path: p.to_string_lossy().into_owned(),
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Moves a take (and its sidecars) to the trash; only inside a project.
#[tauri::command(async)]
pub fn project_video_delete(project: String, path: String) -> Result<(), String> {
    let dir = project_dir(&project)?;
    let video = media::recording_path(&path)?;
    if video.parent() != Some(dir.as_path()) {
        return Err("This video is not in the project.".into());
    }
    let stem = video.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
    let sidecars: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&format!("{stem}.")) && n != format!("{stem}.mp4"))
        })
        .collect();
    trash::delete_all(std::iter::once(&video).chain(sidecars.iter())).map_err(|e| format!("Could not move to the trash: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_never_carry_a_path() {
        assert!(valid_id("lancement-2026"));
        for bad in ["", "..", "a/b", "a\\b", "A", "a.b", "é"] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(!valid_id(&"a".repeat(65)));
    }

    #[test]
    fn ids_are_unique() {
        let taken = ["vsl-acheteur", "vsl-acheteur-2"];
        assert_eq!(unique_id("VSL acheteur", |id| taken.contains(&id)), "vsl-acheteur-3");
        assert_eq!(unique_id("Neuf", |id| taken.contains(&id)), "neuf");
    }

    #[test]
    fn names_are_required_and_short() {
        assert!(clean_name("   ").is_err());
        assert!(clean_name(&"x".repeat(81)).is_err());
        assert_eq!(clean_name("  Lancement ").unwrap(), "Lancement");
    }

    #[test]
    fn exports_are_told_apart() {
        assert!(is_export("goscreen-1-export-2.mp4"));
        assert!(!is_export("goscreen-scenario-a-1.mp4"));
    }
}

//! Reference videos to rebuild: each one gets a folder in
//! `<Videos>/goScreen/References/<id>/` with `reference.json` (the source),
//! the analyser's measurements (`*.observations.json`), the motion spec the
//! studio or an AI writes (`spec.json`) and its renderings (`render-N.mp4`).
//! Node runs the analyser and the renderer (`packages/scenario-runner`); their
//! progress becomes `motion-progress` events. The studio sends ids and file
//! names, never paths, except for the reference video it picked.

use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, State};

use super::{local_ai, recording::ffmpeg, scenario};

pub const PROGRESS_EVENT: &str = "motion-progress";

/// One analysis or rendering at a time (they use every core).
#[derive(Default)]
pub struct MotionState {
    pid: Mutex<Option<u32>>,
}

pub fn references_dir() -> Result<PathBuf, String> {
    Ok(dirs::video_dir()
        .or_else(dirs::home_dir)
        .ok_or("No home directory")?
        .join("goScreen")
        .join("References"))
}

/// Ids and file names the studio may use: no separators, no `..`.
pub fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok { Ok(name) } else { Err(format!("Invalid name: {name}")) }
}

fn reference_dir(id: &str) -> Result<PathBuf, String> {
    let dir = references_dir()?.join(safe_name(id)?);
    if dir.is_dir() { Ok(dir) } else { Err(format!("No reference {id}.")) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    id: String,
    name: String,
    video: String,
    created: u64,
    files: Vec<String>,
}

fn read_reference(dir: &Path) -> Option<Reference> {
    let meta: Value = serde_json::from_slice(&std::fs::read(dir.join("reference.json")).ok()?).ok()?;
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n != "reference.json" && !n.starts_with('.'))
        .collect();
    files.sort();
    Some(Reference {
        id: dir.file_name()?.to_string_lossy().into_owned(),
        name: meta.get("name")?.as_str()?.to_string(),
        video: meta.get("video")?.as_str()?.to_string(),
        created: meta.get("created").and_then(Value::as_u64).unwrap_or(0),
        files,
    })
}

/// Every reference, newest first.
#[tauri::command]
pub fn motion_references() -> Result<Vec<Reference>, String> {
    let root = references_dir()?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Ok(vec![]) };
    let mut list: Vec<Reference> = entries.filter_map(|e| read_reference(&e.ok()?.path())).collect();
    list.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(list)
}

/// Starts a reference from a video the person picked.
#[tauri::command]
pub fn motion_reference_create(video: String) -> Result<Reference, String> {
    let src = PathBuf::from(&video);
    if !src.is_file() {
        return Err(format!("{video} is not a file."));
    }
    let name = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "reference".into());
    let created = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default();
    let dir = references_dir()?.join(format!("{}-{created}", scenario::slug(&name)));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let meta = json!({ "name": name, "video": video, "created": created });
    std::fs::write(dir.join("reference.json"), meta.to_string()).map_err(|e| e.to_string())?;
    read_reference(&dir).ok_or_else(|| "The reference could not be created.".into())
}

#[tauri::command]
pub fn motion_reference_delete(id: String) -> Result<(), String> {
    trash::delete(reference_dir(&id)?).map_err(|e| format!("Could not move to the trash: {e}"))
}

#[tauri::command]
pub fn motion_read(id: String, file: String) -> Result<String, String> {
    let path = reference_dir(&id)?.join(safe_name(&file)?);
    std::fs::read_to_string(&path).map_err(|e| format!("read {file}: {e}"))
}

/// Writes a JSON file of a reference (the spec, notes); never `reference.json`.
#[tauri::command]
pub fn motion_write(id: String, file: String, content: String) -> Result<(), String> {
    let name = safe_name(&file)?;
    if name == "reference.json" || !name.ends_with(".json") {
        return Err("Only .json files can be written.".into());
    }
    serde_json::from_str::<Value>(&content).map_err(|e| format!("Not JSON: {e}"))?;
    std::fs::write(reference_dir(&id)?.join(name), content).map_err(|e| e.to_string())
}

/// The path of a file of a reference (to play a rendering), if it exists.
#[tauri::command]
pub fn motion_file_path(id: String, file: String) -> Result<String, String> {
    let path = reference_dir(&id)?.join(safe_name(&file)?);
    if path.is_file() { Ok(path.to_string_lossy().into_owned()) } else { Err(format!("No {file}.")) }
}

/// A local URL that plays a video of the reference (served with Range, like
/// the editor's), for the side-by-side comparison.
#[tauri::command]
pub async fn motion_video_url(media: State<'_, super::media::MediaState>, id: String, video: String) -> Result<String, String> {
    let dir = reference_dir(&id)?;
    let reference = read_reference(&dir).ok_or("Unreadable reference.")?;
    media.publish(video_of(&dir, &reference, &video)?).await
}

/// The video a file name stands for: the reference itself, or a rendering.
fn video_of(dir: &Path, reference: &Reference, which: &str) -> Result<PathBuf, String> {
    if which == "reference" {
        return Ok(PathBuf::from(&reference.video));
    }
    let path = dir.join(safe_name(which)?);
    if path.extension().is_some_and(|e| e == "mp4") && path.is_file() {
        Ok(path)
    } else {
        Err(format!("No video {which}."))
    }
}

/// A frame of the reference (or of a rendering) as a JPEG data URL: what the
/// vision model looks at, and the studio's thumbnails.
#[tauri::command(async)]
pub fn motion_frame(id: String, video: String, time: f64, width: Option<u32>) -> Result<String, String> {
    let dir = reference_dir(&id)?;
    let reference = read_reference(&dir).ok_or("Unreadable reference.")?;
    let src = video_of(&dir, &reference, &video)?;
    let ffmpeg = ffmpeg::locate().ok_or("FFmpeg not found. Install it (brew install ffmpeg).")?;
    let width = width.unwrap_or(768).clamp(64, 1920);
    let out = Command::new(ffmpeg)
        .args(["-v", "error", "-ss", &format!("{:.3}", time.max(0.0)), "-i"])
        .arg(&src)
        .args(["-frames:v", "1", "-vf", &format!("scale={width}:-2"), "-q:v", "4", "-f", "mjpeg", "-"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err(format!("No frame at {time:.2} s."));
    }
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.stdout)))
}

/// Runs a script of the runner with a job; relays progress, returns the
/// last `done` event or the error.
fn run_script(app: &AppHandle, state: &MotionState, script: &str, job: Value) -> Result<Map<String, Value>, String> {
    let node = scenario::locate_node().ok_or("Node.js is required (install Node 22 or later).")?;
    let path = scenario::runner_path()?.with_file_name(script);
    if !path.is_file() {
        return Err(format!("{} not found.", path.display()));
    }
    {
        let mut pid = state.pid.lock().map_err(|_| "state poisoned")?;
        if pid.is_some() {
            return Err("An analysis or a rendering is already running.".into());
        }
        *pid = Some(0);
    }
    let release = || {
        if let Ok(mut pid) = state.pid.lock() {
            *pid = None;
        }
    };
    let job_file = std::env::temp_dir().join(format!("goscreen-motion-{}.json", uuid::Uuid::new_v4()));
    if let Err(e) = scenario::write_private(&job_file, job.to_string().as_bytes()) {
        release();
        return Err(e.to_string());
    }
    let child = Command::new(&node)
        .arg(&path)
        .arg(&job_file)
        .current_dir(path.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            release();
            let _ = std::fs::remove_file(&job_file);
            return Err(format!("start {}: {e}", node.display()));
        }
    };
    if let Ok(mut pid) = state.pid.lock() {
        *pid = Some(child.id());
    }
    let mut stderr = child.stderr.take();
    let tail = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_string(&mut buf);
        }
        buf.lines().rev().find(|l| !l.trim().is_empty() && !l.contains("ExperimentalWarning")).unwrap_or("").to_string()
    });
    let mut last = None;
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let Some(mut event) = scenario::progress_line(&line) else { continue };
            event.insert("script".into(), Value::from(script));
            let _ = app.emit(PROGRESS_EVENT, Value::Object(event.clone()));
            if matches!(event.get("type").and_then(Value::as_str), Some("done" | "error")) {
                last = Some(event);
            }
        }
    }
    let _ = child.wait();
    let log = tail.join().unwrap_or_default();
    release();
    let _ = std::fs::remove_file(&job_file);
    match last {
        Some(e) if e.get("type").and_then(Value::as_str) == Some("done") => Ok(e),
        Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("Failed.").to_string()),
        None => Err(if log.is_empty() { "Stopped without a result.".into() } else { log }),
    }
}

/// Measures a video of a reference (`reference` or a rendering's file name)
/// into `<name>.observations.json`; returns that file name.
#[tauri::command(async)]
pub fn motion_analyze(app: AppHandle, state: State<'_, MotionState>, id: String, video: String) -> Result<String, String> {
    let dir = reference_dir(&id)?;
    let reference = read_reference(&dir).ok_or("Unreadable reference.")?;
    let src = video_of(&dir, &reference, &video)?;
    let ffmpeg = ffmpeg::locate().ok_or("FFmpeg not found. Install it (brew install ffmpeg).")?;
    let tesseract = ffmpeg::locate_tool("tesseract").ok_or("Tesseract not found. Install it (brew install tesseract).")?;
    let stem = video.trim_end_matches(".mp4");
    let file = format!("{stem}.observations.json");
    let mut job = json!({
        "video": src.to_string_lossy(),
        "ffmpeg": ffmpeg.to_string_lossy(),
        "tesseract": tesseract.to_string_lossy(),
        "out": dir.join(&file).to_string_lossy(),
    });
    // French and English when the reading pack is installed (accents).
    if let Some(data) = local_ai::tessdata() {
        job["tessdata"] = Value::from(data.to_string_lossy().into_owned());
        job["lang"] = Value::from("fra+eng");
    }
    run_script(&app, &state, "analyze.mjs", job)?;
    Ok(file)
}

/// Renders a spec (its HTML, built by the studio) to the next
/// `render-N.mp4` of the reference; returns that file name.
#[tauri::command(async)]
pub fn motion_render(
    app: AppHandle,
    state: State<'_, MotionState>,
    id: String,
    html: String,
    width: u32,
    height: u32,
    fps: u32,
    duration: f64,
) -> Result<String, String> {
    if !(2..=3840).contains(&width) || !(2..=2160).contains(&height) {
        return Err("Size out of range.".into());
    }
    if !(0.1..=300.0).contains(&duration) || !(1..=60).contains(&fps) {
        return Err("Length or frame rate out of range.".into());
    }
    let dir = reference_dir(&id)?;
    let ffmpeg = ffmpeg::locate().ok_or("FFmpeg not found. Install it (brew install ffmpeg).")?;
    let n = (1..).find(|n| !dir.join(format!("render-{n}.mp4")).exists()).unwrap_or(1);
    let file = format!("render-{n}.mp4");
    let job = json!({
        "html": html,
        "width": width / 2 * 2,
        "height": height / 2 * 2,
        "fps": fps,
        "duration": duration,
        "transparent": false,
        "out": dir.join(&file).to_string_lossy(),
        "ffmpeg": ffmpeg.to_string_lossy(),
    });
    run_script(&app, &state, "compose.mjs", job)?;
    Ok(file)
}

#[tauri::command]
pub fn motion_cancel(state: State<'_, MotionState>) {
    if let Some(pid) = state.pid.lock().ok().and_then(|p| *p).filter(|p| *p > 0) {
        scenario::kill(pid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_leave_the_folder() {
        assert!(safe_name("spec.json").is_ok());
        assert!(safe_name("render-2.observations.json").is_ok());
        for bad in ["", "../x", "a/b", ".hidden", "a\\b", "x y"] {
            assert!(safe_name(bad).is_err(), "{bad}");
        }
    }
}

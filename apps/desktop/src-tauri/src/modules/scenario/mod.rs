//! Scenario takes: a scripted browser (Playwright, `packages/scenario-runner`)
//! plays the steps and writes the MP4 and its journal next to the other
//! recordings. Node runs the runner; its progress (JSON lines) is relayed to
//! the studio as `scenario-progress` events.

use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    io::Write,
    process::{ChildStdin, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State};

use super::recording::ffmpeg;

pub const PROGRESS_EVENT: &str = "scenario-progress";
const STDERR_TAIL: usize = 4000;

pub const LIVE_EVENT: &str = "scenario-live";

/// One runner process at a time per slot: background takes and the live
/// editor each have theirs, so editing never waits for a recording.
#[derive(Default)]
pub struct Slot {
    pid: Mutex<Option<u32>>,
    stdin: Mutex<Option<ChildStdin>>,
}

#[derive(Default)]
pub struct ScenarioState {
    run: Slot,
    live: Slot,
    inspect: Slot,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Record,
    Dry,
    Live,
    Inspect,
}

#[derive(Serialize)]
// Variant names and their fields both go camelCase: `rename_all` alone
// renames only the variants, and the studio would miss `videoPath`.
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "status")]
pub enum ScenarioOutcome {
    Done {
        video_path: String,
        interactions_path: String,
        duration_ms: u64,
    },
    /// Inspect mode: the page described for an AI.
    Inspected {
        page: Value,
    },
    /// A dry run (no video): every step played.
    Simulated {
        duration_ms: u64,
    },
    Failed {
        index: Option<u64>,
        message: String,
        shot: Option<String>,
    },
}

/// A file-name-safe slug of the scenario name.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 40 {
            break;
        }
    }
    let trimmed = out.trim_end_matches('-').to_string();
    if trimmed.is_empty() { "take".into() } else { trimmed }
}

/// One line of runner output: a JSON object with a `type`, else None.
pub fn progress_line(line: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Value>(line.trim()).ok()? {
        Value::Object(map) if map.get("type").is_some_and(Value::is_string) => Some(map),
        _ => None,
    }
}

/// Versioned installs, newest first: `<root>/<version>/<suffix>`.
fn versioned(root: &Path, suffix: &str) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(root) else { return Vec::new() };
    let mut dirs: Vec<PathBuf> = read.filter_map(Result::ok).map(|e| e.path()).collect();
    dirs.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
    dirs.into_iter().map(|d| d.join(suffix)).collect()
}

fn version_key(path: &Path) -> Vec<u64> {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .trim_start_matches('v')
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

/// Where Node may be. GUI apps on macOS start with a bare PATH, and version
/// managers (asdf, nvm, volta) keep the real binary out of it.
pub fn node_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("GOSCREEN_NODE") {
        out.push(PathBuf::from(p));
    }
    if let Ok(p) = which::which("node") {
        out.push(p);
    }
    if let Some(home) = home {
        out.extend(versioned(&home.join(".asdf/installs/nodejs"), "bin/node"));
        out.extend(versioned(&home.join(".nvm/versions/node"), "bin/node"));
        out.extend(versioned(&home.join(".local/share/fnm/node-versions"), "installation/bin/node"));
        out.push(home.join(".volta/bin/node"));
    }
    out.extend(["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].map(PathBuf::from));
    out
}

pub(crate) fn locate_node() -> Option<PathBuf> {
    node_candidates(dirs::home_dir().as_deref()).into_iter().find(|p| p.is_file())
}

/// The runner script: `GOSCREEN_SCENARIO_RUNNER`, else the one in this repo.
pub(crate) fn runner_path() -> Result<PathBuf, String> {
    let path = std::env::var("GOSCREEN_SCENARIO_RUNNER").map(PathBuf::from).unwrap_or_else(|_| {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/scenario-runner/run.mjs")
    });
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "Scenario runner not found at {}. Set GOSCREEN_SCENARIO_RUNNER to packages/scenario-runner/run.mjs, then run `pnpm install`.",
            path.display()
        ))
    }
}

/// Writes a file only the current user can read (the temp dir is shared).
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)
}

pub(crate) fn kill(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    #[cfg(windows)]
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T"]).status();
}

/// Plays a scenario. `job` carries the resolved scenario and the device; the
/// output paths, FFmpeg and the frame rate are added here. Takes go to the
/// project's folder when one is given; `dry` plays without recording.
#[tauri::command(async)]
pub fn scenario_run(
    app: AppHandle,
    state: State<'_, ScenarioState>,
    job: Value,
    project: Option<String>,
    dry: Option<bool>,
) -> Result<ScenarioOutcome, String> {
    let mode = if dry.unwrap_or(false) { Mode::Dry } else { Mode::Record };
    run_runner(&app, &state.run, job, project, mode)
}

/// Plays `job`'s steps (often none), then describes the page: outline, text,
/// every actionable element with a checked target, and a screenshot.
#[tauri::command(async)]
pub fn site_inspect(app: AppHandle, state: State<'_, ScenarioState>, job: Value) -> Result<ScenarioOutcome, String> {
    run_runner(&app, &state.inspect, job, None, Mode::Inspect)
}

/// Replays `job`'s steps, then streams the page to the studio and takes its
/// commands (`scenario_live_send`) until `scenario_live_stop`.
#[tauri::command(async)]
pub fn scenario_live(
    app: AppHandle,
    state: State<'_, ScenarioState>,
    job: Value,
    project: Option<String>,
) -> Result<ScenarioOutcome, String> {
    run_runner(&app, &state.live, job, project, Mode::Live)
}

/// One command for the live runner (`tap`, `type`, `inspect`...), as JSON.
#[tauri::command]
pub fn scenario_live_send(state: State<'_, ScenarioState>, command: Value) -> Result<(), String> {
    if !command.is_object() {
        return Err("Invalid command.".into());
    }
    let mut stdin = state.live.stdin.lock().map_err(|_| "live state poisoned")?;
    let pipe = stdin.as_mut().ok_or("The live page is closed.")?;
    let mut line = serde_json::to_vec(&command).map_err(|e| e.to_string())?;
    line.push(b'\n');
    pipe.write_all(&line).and_then(|_| pipe.flush()).map_err(|e| format!("The live page stopped: {e}"))
}

/// Asks the live runner to finish; kills it if it no longer listens.
#[tauri::command]
pub fn scenario_live_stop(state: State<'_, ScenarioState>) {
    let sent = scenario_live_send(state.clone(), serde_json::json!({ "cmd": "stop" })).is_ok();
    if !sent {
        stop_slot(&state.live);
    }
}

fn stop_slot(slot: &Slot) {
    if let Ok(pid) = slot.pid.lock() {
        if let Some(pid) = *pid {
            if pid != 0 {
                kill(pid);
            }
        }
    }
}

fn run_runner(
    app: &AppHandle,
    slot: &Slot,
    job: Value,
    project: Option<String>,
    mode: Mode,
) -> Result<ScenarioOutcome, String> {
    let live = mode == Mode::Live;
    let dry = mode != Mode::Record;
    // Inspections are quiet: their progress would look like a task's.
    let event_name = match mode {
        Mode::Live => Some(LIVE_EVENT),
        Mode::Inspect => None,
        _ => Some(PROGRESS_EVENT),
    };
    let Value::Object(mut job) = job else { return Err("Invalid scenario job.".into()) };
    let name = job
        .get("scenario")
        .and_then(|s| s.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("take")
        .to_string();
    let node = locate_node().ok_or("Node.js is required to play scenarios (install Node 20 or later).")?;
    let runner = runner_path()?;
    let ffmpeg = ffmpeg::locate().ok_or("FFmpeg not found. Install it (brew install ffmpeg).")?;

    let dir = match project.as_deref() {
        Some(id) => super::projects::project_dir(id)?,
        None => dirs::video_dir().or_else(dirs::home_dir).ok_or("No home directory")?.join("goScreen"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default();
    let stem = format!("goscreen-scenario-{}-{stamp}", slug(&name));
    let video = dir.join(format!("{stem}.mp4"));
    let interactions = dir.join(format!("{stem}.interactions.json"));
    let shot = dir.join(format!("{stem}.failed.png"));
    let path = |p: &Path| Value::String(p.to_string_lossy().into_owned());
    job.insert("video".into(), path(&video));
    job.insert("interactions".into(), path(&interactions));
    job.insert("failShot".into(), path(&shot));
    job.insert("ffmpeg".into(), path(&ffmpeg));
    job.insert("fps".into(), Value::from(30));
    job.insert("dry".into(), Value::Bool(dry));
    job.insert("live".into(), Value::Bool(live));
    job.insert("inspect".into(), Value::Bool(mode == Mode::Inspect));

    {
        let mut pid = slot.pid.lock().map_err(|_| "scenario state poisoned")?;
        if pid.is_some() {
            return Err(match mode {
                Mode::Live => "The live page is already open.".into(),
                Mode::Inspect => "A page is already being inspected.".into(),
                _ => "A scenario is already running.".into(),
            });
        }
        // Holds the slot until the child is known.
        *pid = Some(0);
    }
    let release = || {
        if let Ok(mut pid) = slot.pid.lock() {
            *pid = None;
        }
        if let Ok(mut stdin) = slot.stdin.lock() {
            *stdin = None;
        }
    };

    // The job holds the user's values (phone numbers...): a private temp file,
    // removed as soon as the run ends.
    let job_file = std::env::temp_dir().join(format!("goscreen-scenario-{}.json", uuid::Uuid::new_v4()));
    if let Err(e) = write_private(&job_file, &serde_json::to_vec(&Value::Object(job)).unwrap_or_default()) {
        release();
        return Err(format!("write {}: {e}", job_file.display()));
    }
    let child = Command::new(&node)
        .arg(&runner)
        .arg(&job_file)
        .current_dir(runner.parent().unwrap_or(Path::new(".")))
        .stdin(if live { Stdio::piped() } else { Stdio::null() })
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
    if let Ok(mut pid) = slot.pid.lock() {
        *pid = Some(child.id());
    }
    if let Ok(mut stdin) = slot.stdin.lock() {
        *stdin = child.stdin.take();
    }

    let mut stderr = child.stderr.take();
    let tail = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_string(&mut buf);
        }
        let mut start = buf.len().saturating_sub(STDERR_TAIL);
        while !buf.is_char_boundary(start) {
            start += 1;
        }
        buf[start..].trim().to_string()
    });

    let mut last: Option<Map<String, Value>> = None;
    let mut inspected: Option<Value> = None;
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let Some(event) = progress_line(&line) else { continue };
            if event.get("type").and_then(Value::as_str) == Some("inspected") {
                inspected = event.get("page").cloned();
                continue;
            }
            if let Some(name) = event_name {
                let _ = app.emit(name, Value::Object(event.clone()));
            }
            if matches!(event.get("type").and_then(Value::as_str), Some("done" | "error")) {
                last = Some(event);
            }
        }
    }
    let _ = child.wait();
    let log = tail.join().unwrap_or_default();
    release();
    let _ = std::fs::remove_file(&job_file);

    let kind = last.as_ref().and_then(|e| e.get("type")).and_then(Value::as_str);
    match (kind, last.as_ref()) {
        (Some("done"), Some(_)) if mode == Mode::Inspect => match inspected {
            Some(page) => Ok(ScenarioOutcome::Inspected { page }),
            None => Err("The page could not be described.".into()),
        },
        (Some("done"), Some(e)) if dry => Ok(ScenarioOutcome::Simulated {
            duration_ms: (e.get("duration").and_then(Value::as_f64).unwrap_or(0.0) * 1000.0) as u64,
        }),
        (Some("done"), Some(e)) if video.is_file() && interactions.is_file() => Ok(ScenarioOutcome::Done {
            video_path: video.to_string_lossy().into_owned(),
            interactions_path: interactions.to_string_lossy().into_owned(),
            duration_ms: (e.get("duration").and_then(Value::as_f64).unwrap_or(0.0) * 1000.0) as u64,
        }),
        (Some("error"), Some(e)) => Ok(ScenarioOutcome::Failed {
            index: e.get("index").and_then(Value::as_u64),
            message: e.get("message").and_then(Value::as_str).unwrap_or("Failed.").to_string(),
            shot: e.get("shot").and_then(Value::as_str).map(str::to_string),
        }),
        _ => Ok(ScenarioOutcome::Failed {
            index: None,
            message: if log.is_empty() { "The runner stopped without a result.".into() } else { log },
            shot: None,
        }),
    }
}

/// The compose script next to the runner.
fn compose_path() -> Result<PathBuf, String> {
    let runner = runner_path()?;
    let path = runner.with_file_name("compose.mjs");
    if path.is_file() { Ok(path) } else { Err(format!("Block renderer not found at {}.", path.display())) }
}

/// The file type a block video gets: alpha needs HEVC (.mov) on macOS
/// (what WebKit plays with transparency), VP9 (.webm) elsewhere.
pub fn block_ext(transparent: bool) -> &'static str {
    if !transparent {
        "mp4"
    } else if cfg!(target_os = "macos") {
        "mov"
    } else {
        "webm"
    }
}

/// A render's fingerprint (FNV-1a, 64 bits): the same page at the same
/// size, length, rate and alpha gives the same file, so it is rendered once.
pub fn render_key(html: &str, width: u32, height: u32, fps: u32, duration: f64, transparent: bool) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    let key = format!("{width}x{height}@{fps}/{duration}/{}\n{html}", if transparent { "a" } else { "o" });
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Where rendered blocks are kept between sessions, by fingerprint.
fn block_cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("goScreen").join("blocks")
}

/// Runs the composer on a job and returns once `out` exists.
fn compose(job: serde_json::Value, out: &Path) -> Result<(), String> {
    let node = locate_node().ok_or("Node.js is required to render blocks.")?;
    let script = compose_path()?;
    let job_file = std::env::temp_dir().join(format!("goscreen-block-{}.json", uuid::Uuid::new_v4()));
    write_private(&job_file, job.to_string().as_bytes()).map_err(|e| e.to_string())?;
    let output = Command::new(&node)
        .arg(&script)
        .arg(&job_file)
        .current_dir(script.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .output();
    let _ = std::fs::remove_file(&job_file);
    let output = output.map_err(|e| format!("start {}: {e}", node.display()))?;
    let last = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(progress_line)
        .last();
    match last.as_ref().and_then(|e| e.get("type")).and_then(Value::as_str) {
        Some("done") if out.is_file() => Ok(()),
        _ => Err(last
            .and_then(|e| e.get("message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| String::from_utf8_lossy(&output.stderr).trim().chars().take(400).collect())),
    }
}

fn check_block_size(width: u32, height: u32) -> Result<(), String> {
    if !(2..=4096).contains(&width) || !(2..=4096).contains(&height) {
        return Err("Block size out of range.".into());
    }
    Ok(())
}

/// Renders a block (HTML composition) to a video, frame by frame in headless
/// Chrome; returns its path, ready for `asset_import`. The file is kept in
/// the cache by fingerprint: the same input is never rendered twice.
#[tauri::command(async)]
pub fn block_render(
    html: String,
    width: u32,
    height: u32,
    fps: u32,
    duration: f64,
    transparent: bool,
) -> Result<String, String> {
    check_block_size(width, height)?;
    if !(0.1..=60.0).contains(&duration) || !(1..=60).contains(&fps) {
        return Err("Block length or frame rate out of range.".into());
    }
    let (width, height) = (width / 2 * 2, height / 2 * 2);
    let ffmpeg = ffmpeg::locate().ok_or("FFmpeg not found. Install it (brew install ffmpeg).")?;
    let dir = block_cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let key = render_key(&html, width, height, fps, duration, transparent);
    let ext = block_ext(transparent);
    let out = dir.join(format!("{key}.{ext}"));
    if out.is_file() {
        return Ok(out.to_string_lossy().into_owned());
    }
    let part = dir.join(format!("{key}.{}.part.{ext}", uuid::Uuid::new_v4().simple()));
    let job = serde_json::json!({
        "html": html,
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "transparent": transparent,
        "out": part.to_string_lossy(),
        "ffmpeg": ffmpeg.to_string_lossy(),
    });
    compose(job, &part)?;
    std::fs::rename(&part, &out).map_err(|e| format!("keep {}: {e}", out.display()))?;
    Ok(out.to_string_lossy().into_owned())
}

/// One still of a block (HTML composition) at `t` seconds, as a base64 JPEG:
/// a look at a composition without rendering it.
#[tauri::command(async)]
pub fn block_frame(html: String, width: u32, height: u32, t: f64, transparent: bool) -> Result<String, String> {
    use base64::Engine;
    check_block_size(width, height)?;
    if !(0.0..=60.0).contains(&t) {
        return Err("Time out of range.".into());
    }
    let out = std::env::temp_dir().join(format!("goscreen-block-{}.jpg", uuid::Uuid::new_v4()));
    let job = serde_json::json!({
        "html": html,
        "width": width / 2 * 2,
        "height": height / 2 * 2,
        "fps": 30,
        "duration": t.max(0.1),
        "transparent": transparent,
        "frame": t,
        "out": out.to_string_lossy(),
        "ffmpeg": "",
    });
    let result = compose(job, &out).and_then(|()| std::fs::read(&out).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&out);
    Ok(base64::engine::general_purpose::STANDARD.encode(result?))
}

/// Stops the running scenario; the runner removes its partial video.
#[tauri::command]
pub fn scenario_cancel(state: State<'_, ScenarioState>) {
    stop_slot(&state.run);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn job_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("goscreen-job-{}.json", uuid::Uuid::new_v4()));
        write_private(&path, b"{}").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(write_private(&path, b"{}").is_err(), "never reuses an existing file");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn outcomes_reach_the_studio_in_camel_case() {
        let done = serde_json::to_value(ScenarioOutcome::Done {
            video_path: "/m/a.mp4".into(),
            interactions_path: "/m/a.interactions.json".into(),
            duration_ms: 1200,
        })
        .unwrap();
        assert_eq!(
            done,
            serde_json::json!({"status": "done", "videoPath": "/m/a.mp4", "interactionsPath": "/m/a.interactions.json", "durationMs": 1200})
        );
    }

    #[test]
    fn render_keys_follow_every_input() {
        let a = render_key("<p>", 100, 100, 30, 2.0, true);
        assert_eq!(a.len(), 16);
        assert_eq!(a, render_key("<p>", 100, 100, 30, 2.0, true));
        assert_ne!(a, render_key("<b>", 100, 100, 30, 2.0, true));
        assert_ne!(a, render_key("<p>", 100, 100, 25, 2.0, true));
        assert_ne!(a, render_key("<p>", 100, 100, 30, 2.0, false));
    }

    #[test]
    fn slugs_are_file_safe() {
        assert_eq!(slug("Parcours acheteur : 10 plateaux"), "parcours-acheteur-10-plateaux");
        assert_eq!(slug("  ***  "), "take");
        assert_eq!(slug("Œufs d'or"), "ufs-d-or");
        assert!(slug(&"a".repeat(100)).len() <= 40);
    }

    #[test]
    fn reads_progress_lines_only() {
        assert!(progress_line(r#"{"type":"step","index":1}"#).is_some());
        assert!(progress_line("plain log").is_none());
        assert!(progress_line(r#"{"index":1}"#).is_none());
        assert!(progress_line("[1,2]").is_none());
    }

    #[test]
    fn newest_node_versions_first() {
        let root = std::env::temp_dir().join(format!("goscreen-node-{}", uuid::Uuid::new_v4()));
        for v in ["v9.1.0", "v20.11.1", "v18.0.0"] {
            std::fs::create_dir_all(root.join(v)).unwrap();
        }
        let found = versioned(&root, "bin/node");
        assert_eq!(found[0], root.join("v20.11.1/bin/node"));
        assert_eq!(found[2], root.join("v9.1.0/bin/node"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn version_managers_are_searched() {
        let home = Path::new("/h");
        let c = node_candidates(Some(home));
        assert!(c.contains(&home.join(".volta/bin/node")));
        assert!(c.contains(&PathBuf::from("/opt/homebrew/bin/node")));
    }
}

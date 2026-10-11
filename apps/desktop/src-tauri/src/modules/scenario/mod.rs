//! Scenario takes: a scripted browser (Playwright, `packages/scenario-runner`)
//! plays the steps and writes the MP4 and its journal next to the other
//! recordings. Node runs the runner; its progress (JSON lines) is relayed to
//! the studio as `scenario-progress` events.

use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State};

use super::recording::ffmpeg;

pub const PROGRESS_EVENT: &str = "scenario-progress";
const STDERR_TAIL: usize = 4000;

#[derive(Default)]
pub struct ScenarioState {
    pid: Mutex<Option<u32>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ScenarioOutcome {
    Done {
        video_path: String,
        interactions_path: String,
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

fn locate_node() -> Option<PathBuf> {
    node_candidates(dirs::home_dir().as_deref()).into_iter().find(|p| p.is_file())
}

/// The runner script: `GOSCREEN_SCENARIO_RUNNER`, else the one in this repo.
fn runner_path() -> Result<PathBuf, String> {
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

fn kill(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    #[cfg(windows)]
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T"]).status();
}

/// Plays a scenario. `job` carries the resolved scenario and the device; the
/// output paths, FFmpeg and the frame rate are added here.
#[tauri::command(async)]
pub fn scenario_run(app: AppHandle, state: State<'_, ScenarioState>, job: Value) -> Result<ScenarioOutcome, String> {
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

    let dir = dirs::video_dir().or_else(dirs::home_dir).ok_or("No home directory")?.join("goScreen");
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

    {
        let mut pid = state.pid.lock().map_err(|_| "scenario state poisoned")?;
        if pid.is_some() {
            return Err("A scenario is already running.".into());
        }
        // Holds the slot until the child is known.
        *pid = Some(0);
    }
    let release = || {
        if let Ok(mut pid) = state.pid.lock() {
            *pid = None;
        }
    };

    // The job holds the user's values (phone numbers...): a private temp file,
    // removed as soon as the run ends.
    let job_file = std::env::temp_dir().join(format!("goscreen-scenario-{}.json", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::write(&job_file, serde_json::to_vec(&Value::Object(job)).unwrap_or_default()) {
        release();
        return Err(format!("write {}: {e}", job_file.display()));
    }
    let child = Command::new(&node)
        .arg(&runner)
        .arg(&job_file)
        .current_dir(runner.parent().unwrap_or(Path::new(".")))
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
        let mut start = buf.len().saturating_sub(STDERR_TAIL);
        while !buf.is_char_boundary(start) {
            start += 1;
        }
        buf[start..].trim().to_string()
    });

    let mut last: Option<Map<String, Value>> = None;
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let Some(event) = progress_line(&line) else { continue };
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

    let kind = last.as_ref().and_then(|e| e.get("type")).and_then(Value::as_str);
    match (kind, last.as_ref()) {
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

/// Stops the running scenario; the runner removes its partial video.
#[tauri::command]
pub fn scenario_cancel(state: State<'_, ScenarioState>) {
    if let Ok(pid) = state.pid.lock() {
        if let Some(pid) = *pid {
            if pid != 0 {
                kill(pid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

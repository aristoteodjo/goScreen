//! A vision model that runs on this computer, inside goScreen: llama.cpp's
//! `llama-server` (OpenAI-style API) with a Qwen3-VL model downloaded once
//! into `<data>/goScreen/models/`. Nothing leaves the machine: the server
//! listens on 127.0.0.1 only, on a free port, and answers only requests that
//! carry its random key (any local page or process without it is refused).
//! The studio talks to it through `local_ai_chat`, never directly.

use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use super::recording::ffmpeg;

pub mod training;

pub const PROGRESS_EVENT: &str = "local-ai-progress";

/// A file of a model, from Hugging Face (or GitHub for OCR data).
pub struct ModelFile {
    pub url: &'static str,
    pub name: &'static str,
    /// Expected size in bytes: a download of another size is refused.
    pub size: u64,
}

pub struct Model {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// `vision` runs in llama-server; `ocr` is Tesseract data.
    pub kind: &'static str,
    pub files: &'static [ModelFile],
}

pub const MODELS: &[Model] = &[
    Model {
        id: "qwen3-vl-4b",
        label: "Qwen3-VL 4B",
        description: "Recommended. Reads frames and text well; about 4 GB of memory while it runs.",
        kind: "vision",
        files: &[
            ModelFile {
                url: "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf",
                name: "model.gguf",
                size: 2_497_281_664,
            },
            ModelFile {
                url: "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf",
                name: "mmproj.gguf",
                size: 453_974_304,
            },
        ],
    },
    Model {
        id: "qwen3-vl-2b",
        label: "Qwen3-VL 2B",
        description: "Lighter and faster, less precise. For machines with 8 GB of memory.",
        kind: "vision",
        files: &[
            ModelFile {
                url: "https://huggingface.co/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3-VL-2B-Instruct-Q8_0.gguf",
                name: "model.gguf",
                size: 1_834_427_296,
            },
            ModelFile {
                url: "https://huggingface.co/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf",
                name: "mmproj.gguf",
                size: 445_053_056,
            },
        ],
    },
    Model {
        id: "qwen3-vl-8b",
        label: "Qwen3-VL 8B",
        description: "The most precise; needs 16 GB of memory and runs slower.",
        kind: "vision",
        files: &[
            ModelFile {
                url: "https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/Qwen3VL-8B-Instruct-Q4_K_M.gguf",
                name: "model.gguf",
                size: 5_027_784_800,
            },
            ModelFile {
                url: "https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf",
                name: "mmproj.gguf",
                size: 752_289_728,
            },
        ],
    },
    Model {
        id: "ocr-fr-en",
        label: "Text reading (French + English)",
        description: "Lets the video analysis read accents (é, è, à, ç…).",
        kind: "ocr",
        files: &[
            ModelFile {
                url: "https://github.com/tesseract-ocr/tessdata_fast/raw/main/fra.traineddata",
                name: "fra.traineddata",
                size: 1_130_365,
            },
            ModelFile {
                url: "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata",
                name: "eng.traineddata",
                size: 4_113_088,
            },
        ],
    },
];

pub fn model(id: &str) -> Result<&'static Model, String> {
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("Unknown model {id}."))
}

pub fn models_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir().ok_or("No data directory")?.join("goScreen").join("models"))
}

pub fn model_dir(m: &Model) -> Result<PathBuf, String> {
    Ok(models_dir()?.join(m.id))
}

/// Every file is there with its expected size.
pub fn installed_in(dir: &Path, m: &Model) -> bool {
    m.files.iter().all(|f| std::fs::metadata(dir.join(f.name)).map(|md| md.len() == f.size).unwrap_or(false))
}

pub fn installed(m: &Model) -> bool {
    model_dir(m).map(|d| installed_in(&d, m)).unwrap_or(false)
}

/// The Tesseract data folder when the French pack is installed.
pub fn tessdata() -> Option<PathBuf> {
    let m = model("ocr-fr-en").ok()?;
    if installed(m) { model_dir(m).ok() } else { None }
}

/// `llama-server`: `GOSCREEN_LLAMA_SERVER`, the PATH, then Homebrew.
pub fn locate_server() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("GOSCREEN_LLAMA_SERVER") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    ffmpeg::locate_tool("llama-server")
}

struct Running {
    child: Child,
    model: &'static str,
    port: u16,
    key: String,
}

#[derive(Default)]
pub struct LocalAiState {
    server: Mutex<Option<Running>>,
    downloading: Mutex<Option<&'static str>>,
    cancel: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    kind: &'static str,
    size: u64,
    installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    /// Where llama-server is, if found.
    server: Option<String>,
    models: Vec<ModelStatus>,
    /// The model the server is running, if any.
    running: Option<&'static str>,
    downloading: Option<&'static str>,
}

#[tauri::command]
pub fn local_ai_status(state: State<'_, LocalAiState>) -> LocalAiStatus {
    let running = state.server.lock().ok().and_then(|mut s| {
        // A server that died (crash, killed) is forgotten.
        let alive = s.as_mut().map(|r| matches!(r.child.try_wait(), Ok(None))).unwrap_or(false);
        if !alive {
            *s = None;
        }
        s.as_ref().map(|r| r.model)
    });
    LocalAiStatus {
        server: locate_server().map(|p| p.to_string_lossy().into_owned()),
        models: MODELS
            .iter()
            .map(|m| ModelStatus {
                id: m.id,
                label: m.label,
                description: m.description,
                kind: m.kind,
                size: m.files.iter().map(|f| f.size).sum(),
                installed: installed(m),
            })
            .collect(),
        running,
        downloading: state.downloading.lock().ok().and_then(|d| *d),
    }
}

/// Downloads a model's files (once), with `local-ai-progress` events.
/// Each file goes to `<name>.part`, renamed only when its size is right.
#[tauri::command]
pub async fn local_ai_install(app: AppHandle, state: State<'_, LocalAiState>, id: String) -> Result<(), String> {
    let m = model(&id)?;
    {
        let mut d = state.downloading.lock().map_err(|_| "state poisoned")?;
        if let Some(other) = *d {
            return Err(format!("{other} is already downloading."));
        }
        *d = Some(m.id);
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = download(&app, &state.cancel, m).await;
    if let Ok(mut d) = state.downloading.lock() {
        *d = None;
    }
    let _ = app.emit(
        PROGRESS_EVENT,
        serde_json::json!({ "model": m.id, "type": if result.is_ok() { "done" } else { "error" }, "message": result.as_ref().err() }),
    );
    result
}

async fn download(app: &AppHandle, cancel: &AtomicBool, m: &'static Model) -> Result<(), String> {
    let dir = model_dir(m)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let total: u64 = m.files.iter().map(|f| f.size).sum();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut before = 0u64;
    for f in m.files {
        let target = dir.join(f.name);
        if std::fs::metadata(&target).map(|md| md.len() == f.size).unwrap_or(false) {
            before += f.size;
            continue;
        }
        let part = dir.join(format!("{}.part", f.name));
        let mut res = client.get(f.url).send().await.map_err(|e| format!("Download failed: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("Download failed: {} answered {}.", f.url, res.status()));
        }
        let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut done = 0u64;
        let mut last_emit = 0u64;
        while let Some(chunk) = res.chunk().await.map_err(|e| format!("Download interrupted: {e}"))? {
            if cancel.load(Ordering::SeqCst) {
                drop(out);
                let _ = std::fs::remove_file(&part);
                return Err("Download cancelled.".into());
            }
            std::io::Write::write_all(&mut out, &chunk).map_err(|e| e.to_string())?;
            done += chunk.len() as u64;
            if done - last_emit > 8 * 1024 * 1024 || done == f.size {
                last_emit = done;
                let _ = app.emit(
                    PROGRESS_EVENT,
                    serde_json::json!({ "model": m.id, "type": "progress", "done": before + done, "total": total }),
                );
            }
        }
        drop(out);
        if done != f.size {
            let _ = std::fs::remove_file(&part);
            return Err(format!("{} arrived incomplete ({done} of {} bytes).", f.name, f.size));
        }
        std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
        before += f.size;
    }
    Ok(())
}

#[tauri::command]
pub fn local_ai_cancel_install(state: State<'_, LocalAiState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Removes a downloaded model (stopping it first if it runs).
#[tauri::command]
pub fn local_ai_remove(state: State<'_, LocalAiState>, id: String) -> Result<(), String> {
    let m = model(&id)?;
    if state.server.lock().ok().and_then(|s| s.as_ref().map(|r| r.model)) == Some(m.id) {
        shutdown(&state);
    }
    let dir = model_dir(m)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    }
    Ok(())
}

/// The arguments of llama-server for a model.
pub fn server_args(dir: &Path, port: u16, key: &str) -> Vec<String> {
    let p = |name: &str| dir.join(name).to_string_lossy().into_owned();
    [
        "-m", &p("model.gguf"),
        "--mmproj", &p("mmproj.gguf"),
        "--host", "127.0.0.1",
        "--port", &port.to_string(),
        "--api-key", key,
        // Room for a few frames and a long spec; all layers on the GPU.
        "-c", "16384",
        "-ngl", "99",
        "--jinja",
        "--no-webui",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

/// Starts the model (stopping another one); returns once it answers.
#[tauri::command]
pub async fn local_ai_start(state: State<'_, LocalAiState>, id: String) -> Result<(), String> {
    let m = model(&id)?;
    if m.kind != "vision" {
        return Err(format!("{} is not a model to run.", m.label));
    }
    if !installed(m) {
        return Err(format!("{} is not downloaded yet.", m.label));
    }
    let server = locate_server().ok_or("llama-server not found. Install llama.cpp (brew install llama.cpp).")?;
    if state.server.lock().ok().and_then(|s| s.as_ref().map(|r| r.model)) == Some(m.id) {
        return Ok(());
    }
    shutdown(&state);
    let port = free_port()?;
    let key = uuid::Uuid::new_v4().simple().to_string();
    let child = Command::new(&server)
        .args(server_args(&model_dir(m)?, port, &key))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("start {}: {e}", server.display()))?;
    *state.server.lock().map_err(|_| "state poisoned")? = Some(Running { child, model: m.id, port, key });

    // Loading the weights takes a few seconds; /health answers 200 when ready.
    let client = reqwest::Client::new();
    for _ in 0..240 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let exited = state
            .server
            .lock()
            .ok()
            .and_then(|mut s| s.as_mut().map(|r| !matches!(r.child.try_wait(), Ok(None))))
            .unwrap_or(true);
        if exited {
            shutdown(&state);
            return Err(format!("{} stopped while loading (not enough memory?).", m.label));
        }
        let ok = client
            .get(format!("http://127.0.0.1:{port}/health"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
    }
    shutdown(&state);
    Err(format!("{} did not start within two minutes.", m.label))
}

#[tauri::command]
pub fn local_ai_stop(state: State<'_, LocalAiState>) {
    shutdown(&state);
}

pub fn shutdown(state: &LocalAiState) {
    if let Ok(mut s) = state.server.lock() {
        if let Some(mut r) = s.take() {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

/// One chat completion (OpenAI format: messages with text and image parts,
/// `response_format` for JSON constrained by a schema). Returns the reply.
#[tauri::command]
pub async fn local_ai_chat(state: State<'_, LocalAiState>, request: Value) -> Result<Value, String> {
    let (port, key) = state
        .server
        .lock()
        .map_err(|_| "state poisoned")?
        .as_ref()
        .map(|r| (r.port, r.key.clone()))
        .ok_or("The local model is not running. Start it first.")?;
    let res = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .bearer_auth(key)
        .timeout(Duration::from_secs(600))
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&request).map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|e| format!("The local model did not answer: {e}"))?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| format!("Unreadable answer: {e}"))?;
    let body: Value = serde_json::from_slice(&bytes).map_err(|e| format!("Unreadable answer: {e}"))?;
    if !status.is_success() {
        let msg = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("error");
        return Err(format!("The local model refused the request: {msg}"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_model_has_its_files_named_once() {
        for m in MODELS {
            let mut names: Vec<_> = m.files.iter().map(|f| f.name).collect();
            names.sort();
            names.dedup();
            assert_eq!(names.len(), m.files.len(), "{}", m.id);
            assert!(m.files.iter().all(|f| f.url.starts_with("https://huggingface.co/") || f.url.starts_with("https://github.com/")));
            if m.kind == "vision" {
                assert!(names.contains(&"model.gguf") && names.contains(&"mmproj.gguf"), "{}", m.id);
            }
        }
    }

    #[test]
    fn a_model_counts_as_installed_only_at_full_size() {
        let dir = std::env::temp_dir().join(format!("goscreen-ai-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let m = model("ocr-fr-en").unwrap();
        assert!(!installed_in(&dir, m));
        std::fs::write(dir.join("fra.traineddata"), vec![0u8; 1_130_365]).unwrap();
        std::fs::write(dir.join("eng.traineddata"), vec![0u8; 10]).unwrap();
        assert!(!installed_in(&dir, m));
        std::fs::write(dir.join("eng.traineddata"), vec![0u8; 4_113_088]).unwrap();
        assert!(installed_in(&dir, m));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_server_listens_locally_behind_a_key() {
        let args = server_args(Path::new("/m"), 4242, "k");
        let after = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].as_str());
        assert_eq!(after("--host"), Some("127.0.0.1"));
        assert_eq!(after("--api-key"), Some("k"));
        assert_eq!(after("--mmproj"), Some("/m/mmproj.gguf"));
    }
}

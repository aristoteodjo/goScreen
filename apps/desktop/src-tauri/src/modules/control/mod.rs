//! Control server: lets an AI (MCP server, CLI) drive goScreen with the same
//! commands as the studio. It listens on 127.0.0.1 only, with a random port
//! and a 128-bit token written to a file only this user can read
//! (`<config>/goScreen/control.json`). A request carrying an `Origin` header
//! comes from a web page and is refused: browsers cannot reach it.
//!
//! The commands themselves live in the studio (webview), where the app state
//! is: a request becomes a `control-request` event, the studio runs it and
//! answers with `control_reply`.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use super::local_http;

pub const REQUEST_EVENT: &str = "control-request";
/// Long commands (waiting for a recording) answer within this.
const MAX_WAIT: Duration = Duration::from_secs(30 * 60);
const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct ControlState {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    info: Mutex<Option<ControlInfo>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlInfo {
    port: u16,
    file: String,
    /// The MCP server and the CLI to point an AI client at.
    mcp_server: String,
    cli: String,
    skill: String,
}

/// `packages/mcp-server` and `skills/goscreen` of this checkout.
fn repo_path(rel: &str) -> String {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(rel)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[derive(Clone)]
struct Server {
    app: AppHandle,
    token: String,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
}

/// Only our own clients: no browser (`Origin`), the right bearer token.
pub fn authorized(headers: &HeaderMap, token: &str) -> Result<(), StatusCode> {
    if headers.contains_key(header::ORIGIN) {
        return Err(StatusCode::FORBIDDEN);
    }
    let sent = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match sent {
        Some(t) if constant_eq(t.as_bytes(), token.as_bytes()) => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `{ "command": "projects.list", "input": {...} }` -> (command, input).
pub fn parse_request(body: &[u8]) -> Result<(String, Value), String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("invalid JSON: {e}"))?;
    let command = v
        .get("command")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty() && c.len() <= 64 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_'))
        .ok_or("missing or invalid \"command\"")?
        .to_string();
    let input = v.get("input").cloned().unwrap_or(json!({}));
    Ok((command, input))
}

pub fn control_file() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("goScreen").join("control.json"))
}

fn write_control_file(path: &PathBuf, port: u16, token: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let body = json!({
        "version": 1,
        "url": format!("http://127.0.0.1:{port}"),
        "token": token,
        "pid": std::process::id(),
    });
    options.open(&tmp)?.write_all(body.to_string().as_bytes())?;
    std::fs::rename(&tmp, path)
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

async fn ask_studio(server: &Server, command: String, input: Value) -> Response {
    let id = local_http::token();
    let (tx, rx) = oneshot::channel();
    if let Ok(mut pending) = server.pending.lock() {
        pending.insert(id.clone(), tx);
    }
    if server.app.emit(REQUEST_EVENT, json!({ "id": id, "command": command, "input": input })).is_err() {
        server.pending.lock().ok().map(|mut p| p.remove(&id));
        return reply(StatusCode::SERVICE_UNAVAILABLE, json!({ "ok": false, "error": "The studio is not ready." }));
    }
    match tokio::time::timeout(MAX_WAIT, rx).await {
        Ok(Ok(answer)) => reply(StatusCode::OK, answer),
        _ => {
            server.pending.lock().ok().map(|mut p| p.remove(&id));
            reply(StatusCode::GATEWAY_TIMEOUT, json!({ "ok": false, "error": "The studio did not answer." }))
        }
    }
}

async fn run(AxumState(server): AxumState<Server>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(code) = authorized(&headers, &server.token) {
        return reply(code, json!({ "ok": false, "error": "Not allowed." }));
    }
    if body.len() > MAX_BODY {
        return reply(StatusCode::PAYLOAD_TOO_LARGE, json!({ "ok": false, "error": "Request too large." }));
    }
    match parse_request(&body) {
        Ok((command, input)) => ask_studio(&server, command, input).await,
        Err(e) => reply(StatusCode::BAD_REQUEST, json!({ "ok": false, "error": e })),
    }
}

async fn catalog(AxumState(server): AxumState<Server>, headers: HeaderMap) -> Response {
    if let Err(code) = authorized(&headers, &server.token) {
        return reply(code, json!({ "ok": false, "error": "Not allowed." }));
    }
    ask_studio(&server, "control.catalog".into(), json!({})).await
}

/// Starts the server and writes the connection file. Failure only disables
/// AI control; the studio keeps working.
pub fn start(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let token = local_http::token();
        let state = handle.state::<ControlState>();
        let server = Server { app: handle.clone(), token: token.clone(), pending: state.pending.clone() };
        let router = Router::new()
            .route("/v1/run", post(run))
            .route("/v1/commands", get(catalog))
            .with_state(server);
        let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await else {
            log::warn!("control server: could not bind");
            return;
        };
        let Ok(port) = listener.local_addr().map(|a| a.port()) else { return };
        let file = control_file();
        if let Some(path) = &file {
            if let Err(e) = write_control_file(path, port, &token) {
                log::warn!("control server: could not write {}: {e}", path.display());
            }
        }
        if let Ok(mut info) = state.info.lock() {
            *info = Some(ControlInfo {
                port,
                file: file.map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
                mcp_server: repo_path("packages/mcp-server/server.mjs"),
                cli: repo_path("packages/mcp-server/cli.mjs"),
                skill: repo_path("skills/goscreen"),
            });
        }
        let _ = axum::serve(listener, router).await;
    });
}

/// The studio's answer to a `control-request`.
#[tauri::command]
pub fn control_reply(state: State<'_, ControlState>, id: String, answer: Value) {
    if let Some(tx) = state.pending.lock().ok().and_then(|mut p| p.remove(&id)) {
        let _ = tx.send(answer);
    }
}

/// Where AI clients find the server (shown in the studio's "Connect an AI").
#[tauri::command]
pub fn control_info(state: State<'_, ControlState>) -> Option<ControlInfo> {
    state.info.lock().ok().and_then(|i| i.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(header::HeaderName, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(k.clone(), HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn only_bearers_of_the_token_get_in() {
        assert_eq!(authorized(&headers(&[]), "abc"), Err(StatusCode::UNAUTHORIZED));
        assert_eq!(authorized(&headers(&[(header::AUTHORIZATION, "Bearer abd")]), "abc"), Err(StatusCode::UNAUTHORIZED));
        assert_eq!(authorized(&headers(&[(header::AUTHORIZATION, "Bearer abc")]), "abc"), Ok(()));
    }

    #[test]
    fn web_pages_are_refused_even_with_the_token() {
        let h = headers(&[(header::AUTHORIZATION, "Bearer abc"), (header::ORIGIN, "https://evil.example")]);
        assert_eq!(authorized(&h, "abc"), Err(StatusCode::FORBIDDEN));
    }

    #[test]
    fn requests_name_a_plain_command() {
        let (c, i) = parse_request(br#"{"command":"projects.list"}"#).unwrap();
        assert_eq!(c, "projects.list");
        assert_eq!(i, json!({}));
        assert!(parse_request(br#"{"command":"../x"}"#).is_err());
        assert!(parse_request(br#"{"input":{}}"#).is_err());
        assert!(parse_request(b"nope").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_connection_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("goscreen-control-{}", uuid::Uuid::new_v4())).join("control.json");
        write_control_file(&path, 4242, "secret").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let v: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(v["url"], "http://127.0.0.1:4242");
        write_control_file(&path, 4243, "again").unwrap();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

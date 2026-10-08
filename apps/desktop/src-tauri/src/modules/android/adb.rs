//! Locating and running `adb`. Arguments always go through argv: nothing a
//! project, URL or device reports is ever handed to a host shell.

use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use super::error::{AndroidError, ErrorCode};
use super::parse::classify;

const EXE: &str = if cfg!(windows) { "adb.exe" } else { "adb" };

/// Where SDKs usually live. `adb` is never assumed to be at a fixed place:
/// the user's setting wins, then the SDK env vars, then PATH, then defaults.
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(dir) = std::env::var_os(var) {
            out.push(PathBuf::from(dir).join("platform-tools").join(EXE));
        }
    }
    if let Ok(p) = which::which("adb") {
        out.push(p);
    }
    if let Some(home) = dirs::home_dir() {
        out.push(home.join("Library/Android/sdk/platform-tools").join(EXE));
        out.push(home.join("Android/Sdk/platform-tools").join(EXE));
        out.push(home.join("AppData/Local/Android/Sdk/platform-tools").join(EXE));
    }
    // Homebrew's android-platform-tools cask; GUI apps on macOS miss it in PATH.
    out.push(PathBuf::from("/opt/homebrew/bin/adb"));
    out.push(PathBuf::from("/usr/local/bin/adb"));
    out
}

pub fn locate(custom: Option<&str>) -> Result<PathBuf, AndroidError> {
    if let Some(raw) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        let path = match raw.strip_prefix("~/") {
            Some(rest) => dirs::home_dir().map(|h| h.join(rest)).unwrap_or_else(|| PathBuf::from(raw)),
            None => PathBuf::from(raw),
        };
        let named_adb = path.file_stem().is_some_and(|s| s == "adb");
        return if named_adb && path.is_file() {
            Ok(path)
        } else {
            Err(AndroidError::new(ErrorCode::AdbInvalidPath, raw.to_string()))
        };
    }
    candidates()
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| AndroidError::new(ErrorCode::AdbMissing, "adb not found"))
}

pub fn serial_args<'a>(serial: Option<&'a str>, args: &[&'a str]) -> Vec<&'a str> {
    let mut out = Vec::with_capacity(args.len() + 2);
    if let Some(s) = serial {
        out.push("-s");
        out.push(s);
    }
    out.extend_from_slice(args);
    out
}

/// Runs adb to completion. A hung adb (busy device, stuck daemon) is killed
/// at the deadline instead of blocking the caller forever.
pub fn run(bin: &Path, serial: Option<&str>, args: &[&str], timeout: Duration) -> Result<String, AndroidError> {
    let mut child = Command::new(bin)
        .args(serial_args(serial, args))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AndroidError::new(ErrorCode::AdbMissing, format!("spawn adb: {e}")))?;

    // Pipes are drained on threads so a chatty dumpsys cannot fill them.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(15)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AndroidError::new(ErrorCode::Timeout, format!("adb {}", args.join(" "))));
            }
            Err(e) => return Err(AndroidError::new(ErrorCode::Unknown, e.to_string())),
        }
    };
    let out = stdout.join().unwrap_or_default();
    let err = stderr.join().unwrap_or_default();
    if status.success() {
        Ok(out)
    } else {
        let text = if err.trim().is_empty() { out } else { err };
        Err(AndroidError::new(classify(&text), text.trim().to_string()))
    }
}

/// `adb version` first line, e.g. "Android Debug Bridge version 1.0.41".
pub fn version(bin: &Path) -> Option<String> {
    run(bin, None, &["version"], Duration::from_secs(5))
        .ok()
        .and_then(|o| o.lines().next().map(str::to_string))
}

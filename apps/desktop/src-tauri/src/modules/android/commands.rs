use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::adb;
use super::error::{AndroidError, ErrorCode};
use super::parse::{self, ListedDevice};
use super::stream::StreamState;
use crate::modules::recording::ffmpeg;

const QUICK: Duration = Duration::from_secs(5);
const SLOW: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct AndroidState {
    stream: StreamState,
    // getprop rarely changes; cached per serial to keep polling cheap.
    props: Mutex<HashMap<String, HashMap<String, String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbStatus {
    available: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Serialize)]
pub struct Resolution {
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDevice {
    id: String,
    serial: String,
    name: String,
    model: Option<String>,
    manufacturer: Option<String>,
    platform: &'static str,
    android_version: Option<String>,
    state: &'static str,
    resolution: Option<Resolution>,
    density: Option<u32>,
    orientation: &'static str,
    connected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSession {
    session_id: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AndroidKey {
    Back,
    Home,
    Recents,
}

/// Coordinates are native pixels; serde rejects negatives and fractions.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AndroidInput {
    Tap { x: u32, y: u32 },
    Swipe {
        x1: u32,
        y1: u32,
        x2: u32,
        y2: u32,
        #[serde(rename = "durationMs")]
        duration_ms: u32,
    },
    Key { key: AndroidKey },
}

const MAX_COORD: u32 = 20_000;

/// argv for `adb shell input ...`. Only validated integers and fixed
/// keywords reach the device shell.
pub fn input_args(action: &AndroidInput) -> Result<Vec<String>, AndroidError> {
    let bad = || AndroidError::new(ErrorCode::InvalidInput, "coordinates out of range");
    let mut args: Vec<String> = vec!["shell".into(), "input".into()];
    match action {
        AndroidInput::Tap { x, y } => {
            if *x > MAX_COORD || *y > MAX_COORD {
                return Err(bad());
            }
            args.extend(["tap".into(), x.to_string(), y.to_string()]);
        }
        AndroidInput::Swipe { x1, y1, x2, y2, duration_ms } => {
            if [*x1, *y1, *x2, *y2].iter().any(|v| *v > MAX_COORD) || *duration_ms > 10_000 {
                return Err(bad());
            }
            args.push("swipe".into());
            args.extend([x1, y1, x2, y2, duration_ms].map(|v| v.to_string()));
        }
        AndroidInput::Key { key } => {
            let code = match key {
                AndroidKey::Back => "KEYCODE_BACK",
                AndroidKey::Home => "KEYCODE_HOME",
                AndroidKey::Recents => "KEYCODE_APP_SWITCH",
            };
            args.extend(["keyevent".into(), code.into()]);
        }
    }
    Ok(args)
}

fn checked_serial(serial: &str) -> Result<(), AndroidError> {
    if parse::valid_serial(serial) {
        Ok(())
    } else {
        Err(AndroidError::new(ErrorCode::InvalidInput, "invalid serial"))
    }
}

fn state_of(raw: &str) -> &'static str {
    match raw {
        "device" => "device",
        "unauthorized" => "unauthorized",
        "offline" => "offline",
        _ => "unknown",
    }
}

fn props_for(state: &AndroidState, bin: &PathBuf, serial: &str) -> HashMap<String, String> {
    if let Some(p) = state.props.lock().ok().and_then(|m| m.get(serial).cloned()) {
        return p;
    }
    let props = adb::run(bin, Some(serial), &["shell", "getprop"], SLOW)
        .map(|o| parse::parse_getprop(&o))
        .unwrap_or_default();
    if !props.is_empty() {
        if let Ok(mut m) = state.props.lock() {
            m.insert(serial.to_string(), props.clone());
        }
    }
    props
}

fn describe(state: &AndroidState, bin: &PathBuf, listed: &ListedDevice, live: bool) -> AndroidDevice {
    let ready = listed.state == "device";
    let props = if ready { props_for(state, bin, &listed.serial) } else { HashMap::new() };
    let (resolution, density, orientation) = if ready && live {
        let natural = adb::run(bin, Some(&listed.serial), &["shell", "wm", "size"], QUICK)
            .ok()
            .and_then(|o| parse::parse_wm_size(&o));
        let density = adb::run(bin, Some(&listed.serial), &["shell", "wm", "density"], QUICK)
            .ok()
            .and_then(|o| parse::parse_wm_density(&o));
        let rotation = adb::run(bin, Some(&listed.serial), &["shell", "dumpsys", "input"], SLOW)
            .ok()
            .and_then(|o| parse::parse_rotation(&o))
            .unwrap_or(0);
        let size = natural.map(|n| parse::current_size(n, rotation));
        (
            size.map(|(width, height)| Resolution { width, height }),
            density,
            size.map(parse::orientation_of).unwrap_or("portrait"),
        )
    } else {
        (None, None, "portrait")
    };
    AndroidDevice {
        id: listed.serial.clone(),
        serial: listed.serial.clone(),
        name: parse::display_name(listed, &props),
        model: props.get("ro.product.model").cloned().or_else(|| listed.model.clone()),
        manufacturer: props.get("ro.product.manufacturer").cloned(),
        platform: if parse::is_emulator(&listed.serial, &props) { "emulator" } else { "physical" },
        android_version: props.get("ro.build.version.release").cloned(),
        state: state_of(&listed.state),
        resolution,
        density,
        orientation,
        connected: ready,
    }
}

fn list(bin: &PathBuf) -> Result<Vec<ListedDevice>, AndroidError> {
    adb::run(bin, None, &["devices", "-l"], SLOW).map(|o| parse::parse_devices(&o))
}

#[tauri::command(async)]
pub fn android_status(adb_path: Option<String>) -> Result<AdbStatus, AndroidError> {
    match adb::locate(adb_path.as_deref()) {
        Ok(bin) => Ok(AdbStatus {
            available: true,
            version: adb::version(&bin),
            path: Some(bin.display().to_string()),
        }),
        Err(e) if e.code == ErrorCode::AdbMissing => Ok(AdbStatus { available: false, path: None, version: None }),
        Err(e) => Err(e),
    }
}

/// Every attached device, with resolution for the ready ones. Never connects
/// or records anything by itself.
#[tauri::command(async)]
pub fn android_devices(state: State<'_, AndroidState>, adb_path: Option<String>) -> Result<Vec<AndroidDevice>, AndroidError> {
    let bin = adb::locate(adb_path.as_deref())?;
    let listed = list(&bin)?;
    if let Ok(mut cache) = state.props.lock() {
        cache.retain(|serial, _| listed.iter().any(|d| &d.serial == serial));
    }
    Ok(listed.iter().map(|d| describe(&state, &bin, d, true)).collect())
}

#[tauri::command(async)]
pub fn android_device_info(
    state: State<'_, AndroidState>,
    adb_path: Option<String>,
    serial: String,
) -> Result<AndroidDevice, AndroidError> {
    checked_serial(&serial)?;
    let bin = adb::locate(adb_path.as_deref())?;
    let listed = list(&bin)?
        .into_iter()
        .find(|d| d.serial == serial)
        .ok_or_else(|| AndroidError::new(ErrorCode::Disconnected, format!("{serial} is gone")))?;
    match listed.state.as_str() {
        "device" => Ok(describe(&state, &bin, &listed, true)),
        other => Err(AndroidError::new(parse::classify(other), other.to_string())),
    }
}

#[tauri::command]
pub async fn android_stream_open(
    state: State<'_, AndroidState>,
    adb_path: Option<String>,
    serial: String,
) -> Result<CaptureSession, AndroidError> {
    checked_serial(&serial)?;
    let bin = adb::locate(adb_path.as_deref())?;
    let ffmpeg = ffmpeg::locate().ok_or_else(|| AndroidError::new(ErrorCode::FfmpegMissing, "ffmpeg not found"))?;
    let (session_id, url) = state.stream.open(serial, bin, ffmpeg).await?;
    Ok(CaptureSession { session_id, url })
}

#[tauri::command]
pub fn android_stream_close(state: State<'_, AndroidState>, session_id: String) -> Result<(), AndroidError> {
    state.stream.close(&session_id);
    Ok(())
}

#[tauri::command(async)]
pub fn android_input(adb_path: Option<String>, serial: String, action: AndroidInput) -> Result<(), AndroidError> {
    checked_serial(&serial)?;
    let args = input_args(&action)?;
    let bin = adb::locate(adb_path.as_deref())?;
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    adb::run(&bin, Some(&serial), &refs, SLOW).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_input_argv_from_typed_actions() {
        let tap: AndroidInput = serde_json::from_str(r#"{"kind":"tap","x":540,"y":1200}"#).unwrap();
        assert_eq!(input_args(&tap).unwrap(), ["shell", "input", "tap", "540", "1200"]);
        let key: AndroidInput = serde_json::from_str(r#"{"kind":"key","key":"recents"}"#).unwrap();
        assert_eq!(input_args(&key).unwrap().last().unwrap(), "KEYCODE_APP_SWITCH");
        let swipe: AndroidInput =
            serde_json::from_str(r#"{"kind":"swipe","x1":1,"y1":2,"x2":3,"y2":4,"durationMs":300}"#).unwrap();
        assert_eq!(input_args(&swipe).unwrap()[2..], ["swipe", "1", "2", "3", "4", "300"]);
    }

    #[test]
    fn rejects_injection_and_out_of_range_input() {
        assert!(serde_json::from_str::<AndroidInput>(r#"{"kind":"tap","x":"1; reboot","y":2}"#).is_err());
        assert!(serde_json::from_str::<AndroidInput>(r#"{"kind":"tap","x":-1,"y":2}"#).is_err());
        assert!(serde_json::from_str::<AndroidInput>(r#"{"kind":"key","key":"power"}"#).is_err());
        let far: AndroidInput = serde_json::from_str(r#"{"kind":"tap","x":999999,"y":2}"#).unwrap();
        assert!(input_args(&far).is_err());
        assert!(checked_serial("emulator-5554").is_ok());
        assert!(checked_serial("$(reboot)").is_err());
    }
}

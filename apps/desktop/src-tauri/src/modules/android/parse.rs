//! Pure parsing of ADB output. Nothing here runs a process, so every format
//! quirk is pinned by a test.

use std::collections::HashMap;

use super::error::ErrorCode;

#[derive(Debug, Clone, PartialEq)]
pub struct ListedDevice {
    pub serial: String,
    pub state: String,
    pub model: Option<String>,
}

/// `adb devices -l`
pub fn parse_devices(out: &str) -> Vec<ListedDevice> {
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("List of devices") && !l.starts_with('*'))
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = parts.next()?.to_string();
            let model = parts
                .find_map(|p| p.strip_prefix("model:"))
                .map(|m| m.replace('_', " "));
            valid_serial(&serial).then_some(ListedDevice { serial, state, model })
        })
        .collect()
}

/// Serials go into argv, never a shell, but are still held to a strict shape.
pub fn valid_serial(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// `adb shell getprop` -> `[key]: [value]` lines.
pub fn parse_getprop(out: &str) -> HashMap<String, String> {
    out.lines()
        .filter_map(|line| {
            let (k, v) = line.split_once("]: [")?;
            let key = k.trim().strip_prefix('[')?;
            let value = v.trim().strip_suffix(']')?;
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn parse_dims(s: &str) -> Option<(u32, u32)> {
    let (w, h) = s.trim().split_once('x')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

/// `adb shell wm size`. An override (set with `wm size WxH`) wins.
pub fn parse_wm_size(out: &str) -> Option<(u32, u32)> {
    let find = |prefix: &str| {
        out.lines()
            .find_map(|l| l.trim().strip_prefix(prefix).and_then(parse_dims))
    };
    find("Override size:").or_else(|| find("Physical size:"))
}

/// `adb shell wm density`.
pub fn parse_wm_density(out: &str) -> Option<u32> {
    let find = |prefix: &str| {
        out.lines()
            .find_map(|l| l.trim().strip_prefix(prefix).and_then(|v| v.trim().parse().ok()))
    };
    find("Override density:").or_else(|| find("Physical density:"))
}

/// Display rotation (0..=3) from `dumpsys input` or `dumpsys window`.
pub fn parse_rotation(out: &str) -> Option<u8> {
    for line in out.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("SurfaceOrientation:") {
            if let Ok(r) = v.trim().parse::<u8>() {
                return Some(r % 4);
            }
        }
        if let Some(idx) = line.find("mCurrentRotation=ROTATION_") {
            let deg: String = line[idx + "mCurrentRotation=ROTATION_".len()..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            if let Ok(d) = deg.parse::<u16>() {
                return Some(((d / 90) % 4) as u8);
            }
        }
    }
    for line in out.lines().map(str::trim) {
        if line.starts_with("Viewport INTERNAL") {
            if let Some(idx) = line.find("orientation=") {
                let n: String = line[idx + "orientation=".len()..]
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect();
                if let Ok(r) = n.parse::<u8>() {
                    return Some(r % 4);
                }
            }
        }
    }
    None
}

/// Current on-screen size: `wm size` reports the natural orientation, a
/// quarter turn swaps it.
pub fn current_size(natural: (u32, u32), rotation: u8) -> (u32, u32) {
    if rotation % 2 == 1 {
        (natural.1, natural.0)
    } else {
        natural
    }
}

pub fn orientation_of(size: (u32, u32)) -> &'static str {
    if size.0 > size.1 {
        "landscape"
    } else {
        "portrait"
    }
}

pub fn is_emulator(serial: &str, props: &HashMap<String, String>) -> bool {
    serial.starts_with("emulator-")
        || props.get("ro.kernel.qemu").map(String::as_str) == Some("1")
        || props.get("ro.boot.qemu").map(String::as_str) == Some("1")
        || props.contains_key("ro.boot.qemu.avd_name")
}

/// Human name: AVD name for emulators ("Pixel_10_API_36" -> "Pixel 10 API 36").
pub fn display_name(listed: &ListedDevice, props: &HashMap<String, String>) -> String {
    let avd = props
        .get("ro.boot.qemu.avd_name")
        .or_else(|| props.get("ro.kernel.qemu.avd_name"))
        .filter(|v| !v.is_empty());
    if let Some(name) = avd {
        return name.replace('_', " ");
    }
    props
        .get("ro.product.model")
        .cloned()
        .or_else(|| listed.model.clone())
        .unwrap_or_else(|| listed.serial.clone())
}

/// Maps an ADB state or stderr text to an error the user can act on.
pub fn classify(text: &str) -> ErrorCode {
    let t = text.to_ascii_lowercase();
    if t.contains("unauthorized") {
        ErrorCode::Unauthorized
    } else if t.contains("offline") {
        ErrorCode::Offline
    } else if t.contains("not found") || t.contains("no devices") || t.contains("device '") {
        ErrorCode::Disconnected
    } else if t.contains("unknown option") || t.contains("output-format") {
        ErrorCode::Unsupported
    } else {
        ErrorCode::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_emulators_and_physical_devices() {
        let out = "* daemon not running; starting now at tcp:5037\n\
                   * daemon started successfully\n\
                   List of devices attached\n\
                   emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n\
                   R5CT1234567            unauthorized usb:1-1 transport_id:2\n\
                   bad;serial             device\n\n";
        let devices = parse_devices(out);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "emulator-5554");
        assert_eq!(devices[0].model.as_deref(), Some("sdk gphone64 arm64"));
        assert_eq!(devices[1].state, "unauthorized");
    }

    #[test]
    fn rejects_shell_metacharacters_in_serials() {
        assert!(valid_serial("192.168.1.20:5555"));
        assert!(!valid_serial("a b"));
        assert!(!valid_serial("x;reboot"));
        assert!(!valid_serial(""));
    }

    #[test]
    fn reads_props_sizes_and_density() {
        let props = parse_getprop("[ro.product.model]: [Pixel 10]\n[ro.boot.qemu.avd_name]: [Pixel_10_API_36]\n");
        assert_eq!(props["ro.product.model"], "Pixel 10");
        assert_eq!(parse_wm_size("Physical size: 1080x2424\n"), Some((1080, 2424)));
        assert_eq!(
            parse_wm_size("Physical size: 1080x2424\nOverride size: 720x1616\n"),
            Some((720, 1616))
        );
        assert_eq!(parse_wm_density("Physical density: 420\n"), Some(420));
        let listed = ListedDevice { serial: "emulator-5554".into(), state: "device".into(), model: None };
        assert_eq!(display_name(&listed, &props), "Pixel 10 API 36");
        assert!(is_emulator("emulator-5554", &HashMap::new()));
    }

    #[test]
    fn reads_rotation_from_several_dumps() {
        assert_eq!(parse_rotation("  SurfaceOrientation: 1\n"), Some(1));
        assert_eq!(parse_rotation("mCurrentRotation=ROTATION_270 mLastOrientation=0"), Some(3));
        assert_eq!(
            parse_rotation("Viewport INTERNAL: displayId=0, uniqueId=local:0, port=0, orientation=2, x=0"),
            Some(2)
        );
        assert_eq!(parse_rotation("nothing"), None);
        assert_eq!(current_size((1080, 2424), 1), (2424, 1080));
        assert_eq!(orientation_of(current_size((1080, 2424), 1)), "landscape");
    }

    #[test]
    fn classifies_adb_failures() {
        assert_eq!(classify("error: device unauthorized."), ErrorCode::Unauthorized);
        assert_eq!(classify("error: device offline"), ErrorCode::Offline);
        assert_eq!(classify("error: device 'emulator-5556' not found"), ErrorCode::Disconnected);
        assert_eq!(classify("boom"), ErrorCode::Unknown);
    }
}

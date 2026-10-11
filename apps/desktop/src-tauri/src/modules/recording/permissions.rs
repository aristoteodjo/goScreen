//! macOS privacy permissions: which app the system asks about, and a
//! shortcut to the right System Settings pane.

/// App name from an executable path inside a bundle:
/// "/Applications/Portly.app/Contents/MacOS/Portly" -> "Portly".
pub fn bundle_name(path: &str) -> Option<String> {
    let idx = path.find(".app/Contents/MacOS/")?;
    let head = &path[..idx];
    let name = head.rsplit('/').next()?;
    (!name.is_empty()).then(|| name.to_string())
}

/// The app macOS holds responsible for this process: the outermost .app
/// bundle among its ancestors (Portly or a terminal in dev, goScreen once bundled).
pub fn responsible_app() -> String {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let mut pid = std::process::id();
        let mut found: Option<String> = None;
        for _ in 0..32 {
            let out = Command::new("ps").args(["-o", "ppid=,comm=", "-p", &pid.to_string()]).output();
            let Ok(out) = out else { break };
            let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let Some((ppid, comm)) = line.split_once(char::is_whitespace) else { break };
            if let Some(name) = bundle_name(comm.trim()) {
                found = Some(name);
            }
            match ppid.trim().parse::<u32>() {
                Ok(p) if p > 1 => pid = p,
                _ => break,
            }
        }
        if let Some(name) = found {
            return name;
        }
    }
    "goScreen".into()
}

pub fn no_frames_message() -> String {
    format!(
        "The screen sent no image. Allow \"{}\" in System Settings > Privacy & Security > Screen Recording, \
         then quit and reopen it.",
        responsible_app()
    )
}

pub fn companion_message() -> String {
    format!(
        "The camera or microphone did not start. Allow \"{}\" in System Settings > Privacy & Security > \
         Camera and Microphone, then quit and reopen it.",
        responsible_app()
    )
}

/// The app to allow in System Settings for this process's permissions.
#[tauri::command(async)]
pub fn responsible_app_name() -> String {
    responsible_app()
}

/// Opens System Settings on one privacy pane. The pane is a closed list.
#[tauri::command]
pub fn open_privacy_settings(pane: String) -> Result<(), String> {
    let anchor = match pane.as_str() {
        "screen" => "Privacy_ScreenCapture",
        "camera" => "Privacy_Camera",
        "microphone" => "Privacy_Microphone",
        _ => return Err("unknown settings pane".into()),
    };
    if !cfg!(target_os = "macos") {
        return Err("Only available on macOS.".into());
    }
    std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"))
        .status()
        .map_err(|e| e.to_string())
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_bundle_of_an_executable() {
        assert_eq!(bundle_name("/Applications/Portly.app/Contents/MacOS/Portly").as_deref(), Some("Portly"));
        assert_eq!(
            bundle_name("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal").as_deref(),
            Some("Terminal")
        );
        assert_eq!(bundle_name("target/debug/goscreen"), None);
    }
}

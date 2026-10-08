use std::path::PathBuf;

// GUI apps on macOS launch with a bare PATH, so Homebrew installs are
// invisible to `which` unless we probe their prefixes explicitly.
const FALLBACK_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

pub fn locate() -> Option<PathBuf> {
    if let Ok(p) = which::which("ffmpeg") {
        return Some(p);
    }
    FALLBACK_DIRS
        .iter()
        .map(|d| PathBuf::from(d).join("ffmpeg"))
        .find(|p| p.is_file())
}

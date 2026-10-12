use std::path::PathBuf;

// GUI apps on macOS launch with a bare PATH, so Homebrew installs are
// invisible to `which` unless we probe their prefixes explicitly.
const FALLBACK_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

pub fn locate() -> Option<PathBuf> {
    locate_tool("ffmpeg")
}

/// A command-line tool: the PATH, then Homebrew's and the system's folders
/// (a GUI app on macOS gets a minimal PATH).
pub fn locate_tool(name: &str) -> Option<PathBuf> {
    if let Ok(p) = which::which(name) {
        return Some(p);
    }
    FALLBACK_DIRS
        .iter()
        .map(|d| PathBuf::from(d).join(name))
        .find(|p| p.is_file())
}

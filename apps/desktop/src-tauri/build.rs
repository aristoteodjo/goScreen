use std::path::PathBuf;
use std::process::Command;

/// Where the active Apple toolchain keeps its static Swift libraries
/// (`libswiftCompatibility56.a`…): Xcode's toolchain, or the Command Line
/// Tools when Xcode is not installed. Some crates' Swift bridges hardcode the
/// Xcode path, so the real one is added as a search path.
fn swift_static_lib_dir() -> Option<PathBuf> {
    let out = Command::new("xcode-select").arg("-p").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let dev = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    [
        dev.join("Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"),
        dev.join("usr/lib/swift/macosx"),
    ]
    .into_iter()
    .find(|d| d.join("libswiftCompatibility56.a").is_file())
}

fn main() {
    // ScreenCaptureKit's Swift bridge links the system Swift runtime, which
    // lives in the dyld cache under /usr/lib/swift.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        if let Some(dir) = swift_static_lib_dir() {
            println!("cargo:rustc-link-search=native={}", dir.display());
        }
    }
    tauri_build::build()
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    goscreen_lib::dev_privacy::relaunch();
    goscreen_lib::run()
}

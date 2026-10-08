pub mod modules;

use modules::{proxy, recording};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(proxy::ProxyState::default())
        .manage(recording::RecordingState::default())
        .invoke_handler(tauri::generate_handler![
            proxy::server::proxy_open,
            recording::commands::ffmpeg_status,
            recording::commands::recording_start,
            recording::commands::recording_stop,
            recording::commands::screenshot_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running goScreen");
}

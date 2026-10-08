pub mod modules;

use modules::{android, export, media, proxy, recording};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(proxy::ProxyState::default())
        .manage(recording::RecordingState::default())
        .manage(android::AndroidState::default())
        .manage(media::MediaState::default())
        .manage(export::ExportState::default())
        .invoke_handler(tauri::generate_handler![
            proxy::server::proxy_open,
            recording::commands::ffmpeg_status,
            recording::commands::recording_start,
            recording::commands::recording_stop,
            recording::commands::screenshot_capture,
            recording::commands::capture_devices,
            android::commands::android_status,
            android::commands::android_devices,
            android::commands::android_device_info,
            android::commands::android_stream_open,
            android::commands::android_stream_close,
            android::commands::android_input,
            media::recording_open,
            media::edit_save,
            media::recordings_list,
            export::export_begin,
            export::export_frame,
            export::export_finish,
            export::export_cancel,
        ])
        .setup(|_| {
            recording::orphan::reap();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building goScreen")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                recording::shutdown(&app.state::<recording::RecordingState>());
            }
        });
}

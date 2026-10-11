pub mod modules;

use modules::{android, export, media, projects, proxy, recording, scenario};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(proxy::ProxyState::default())
        .manage(recording::RecordingState::default())
        .manage(android::AndroidState::default())
        .manage(media::MediaState::default())
        .manage(export::ExportState::default())
        .manage(scenario::ScenarioState::default())
        .invoke_handler(tauri::generate_handler![
            proxy::server::proxy_open,
            recording::commands::ffmpeg_status,
            recording::commands::recording_start,
            recording::commands::recording_stop,
            recording::split::recording_split,
            recording::commands::screenshot_capture,
            recording::commands::capture_devices,
            recording::permissions::open_privacy_settings,
            android::commands::android_status,
            android::commands::android_devices,
            android::commands::android_device_info,
            android::commands::android_stream_open,
            android::commands::android_stream_close,
            android::commands::android_input,
            media::recording_open,
            media::asset_import,
            media::edit_save,
            media::recordings_list,
            modules::site::site_pages,
            modules::site::brand::site_brand,
            modules::site::brand::site_sections,
            export::export_begin,
            export::export_frame,
            export::export_finish,
            export::export_cancel,
            scenario::scenario_run,
            scenario::scenario_cancel,
            projects::projects_list,
            projects::project_create,
            projects::project_rename,
            projects::project_duplicate,
            projects::project_delete,
            projects::project_videos,
            projects::project_video_delete,
            projects::vsl_list,
            projects::vsl_create,
            projects::vsl_load,
            projects::vsl_save,
            projects::vsl_rename,
            projects::vsl_duplicate,
            projects::vsl_delete,
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

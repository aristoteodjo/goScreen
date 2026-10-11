#[cfg(all(debug_assertions, target_os = "macos"))]
pub mod dev_privacy;
pub mod modules;

use modules::{android, control, export, media, projects, proxy, recording, scenario};
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
        .manage(media::voiceover::VoiceOverState::default())
        .manage(export::ExportState::default())
        .manage(scenario::ScenarioState::default())
        .manage(control::ControlState::default())
        .invoke_handler(tauri::generate_handler![
            proxy::server::proxy_open,
            recording::commands::ffmpeg_status,
            recording::commands::recording_start,
            recording::commands::recording_stop,
            recording::split::recording_split,
            recording::commands::screenshot_capture,
            recording::commands::capture_devices,
            recording::permissions::open_privacy_settings,
            recording::permissions::responsible_app_name,
            android::commands::android_status,
            android::commands::android_devices,
            android::commands::android_device_info,
            android::commands::android_stream_open,
            android::commands::android_stream_close,
            android::commands::android_input,
            media::recording_open,
            media::asset_import,
            media::silence::audio_silences,
            media::voiceover::microphone_level,
            media::voiceover::voiceover_start,
            media::voiceover::voiceover_stop,
            media::voiceover::voiceover_cancel,
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
            control::control_reply,
            control::control_info,
            scenario::scenario_live,
            scenario::site_inspect,
            scenario::block_render,
            scenario::scenario_live_send,
            scenario::scenario_live_stop,
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
        .setup(|app| {
            recording::orphan::reap();
            control::start(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building goScreen")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                recording::shutdown(&app.state::<recording::RecordingState>());
                media::voiceover::shutdown(&app.state::<media::voiceover::VoiceOverState>());
            }
        });
}

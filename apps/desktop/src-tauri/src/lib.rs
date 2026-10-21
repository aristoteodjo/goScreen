#[cfg(all(debug_assertions, target_os = "macos"))]
pub mod dev_privacy;
pub mod modules;

use modules::{android, control, export, inspiration, local_ai, media, motion, projects, proxy, recording, scenario};
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
        .manage(local_ai::LocalAiState::default())
        .manage(motion::MotionState::default())
        .invoke_handler(tauri::generate_handler![
            proxy::server::proxy_open,
            inspiration::inspiration_sync,
            inspiration::inspiration_library,
            local_ai::local_ai_status,
            local_ai::local_ai_install,
            local_ai::local_ai_cancel_install,
            local_ai::local_ai_remove,
            local_ai::local_ai_start,
            local_ai::local_ai_stop,
            local_ai::local_ai_chat,
            local_ai::training::training_add,
            local_ai::training::training_list,
            local_ai::training::training_remove,
            local_ai::training::training_export,
            motion::motion_references,
            motion::motion_reference_create,
            motion::motion_reference_delete,
            motion::motion_read,
            motion::motion_write,
            motion::motion_file_path,
            motion::motion_frame,
            motion::motion_analyze,
            motion::motion_render,
            motion::motion_cancel,
            motion::motion_video_url,
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
            export::chunks::render_cache_list,
            export::chunks::chunk_begin,
            export::chunks::chunk_finish,
            export::chunks::export_assemble,
            export::chunks::preview_begin,
            export::chunks::preview_finish,
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
                local_ai::shutdown(&app.state::<local_ai::LocalAiState>());
            }
        });
}

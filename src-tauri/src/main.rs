#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Tauri-макросы команд (генерируют __cmd__*) опираются на unit never-type
// fallback — rustc 1.98 сделал это ошибкой (`rust_2024_compatibility`).
// Lint отключён до исправления макроса в tauri: поведение не меняется.
#![allow(dependency_on_unit_never_type_fallback)]

mod crypto;
mod vault;
#[cfg(target_os = "windows")]
mod auto_type;
#[cfg(not(target_os = "windows"))]
#[path = "auto_type_fallback.rs"]
mod auto_type;
use auto_type::{auto_type_credentials, auto_type_text, get_foreground_window};
mod commands;
mod api;
mod favicon;
mod clipboard;
mod ipc;
mod logging;
mod memprotect;
mod native_host_reg;
mod ratelimit;
mod hotkey;
#[cfg(target_os = "windows")]
mod biometry;
#[cfg(not(target_os = "windows"))]
#[path = "biometry_fallback.rs"]
mod biometry;
use tauri::{Emitter, Manager};

use commands::{
    vault_create, vault_unlock, vault_lock, check_vault_unlocked, list_vault_files,
    vault_get_entries, vault_save_entries, vault_change_password, vault_delete, vault_export,
    vault_backup, vault_set_decoy_password, vault_remove_decoy, save_png_file,
    vault_hw_key_status, vault_decoy_status, vault_enable_hw_key, vault_disable_hw_key,
    secure_copy, secure_paste, secure_copy_available,
    get_api_token, get_device_key, set_lock_on_hide, set_app_language, rotate_api_token,
    set_autolock_minutes, AppState,
};
use clipboard::{clipboard_history_set_enabled, clipboard_set_secure};
use favicon::fetch_favicon;
use hotkey::{tray_hotkey_get, tray_hotkey_pause, tray_hotkey_set};
use biometry::{
    biometry_disable, biometry_enable, biometry_is_available, biometry_is_enabled,
    vault_unlock_biometry,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    // Защита памяти — максимально рано: запрет дампов, SeLockMemoryPrivilege
    memprotect::init();

    let app_state = AppState::new();
    let api_state = app_state.clone_inner();
    let ipc_state = app_state.clone_inner();
    let hide_state = app_state.clone_inner();
    let exit_state = app_state.clone_inner();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Raise the window from the tray (locked vault shows its lock screen).
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // Файловый лог (P2-13): уровни + ротация в app_data_dir/logs.
            if let Ok(data_dir) = app.path().app_data_dir() {
                logging::init(data_dir.join("logs"));
            }

            // Натив-хост для расширения: саморегистрация при каждом запуске
            // (self-heal). Манифест + HKCU-ключи браузеров — без прав админа.
            native_host_reg::ensure_registration();

            // AppHandle нужен IPC-потоку, чтобы показывать pairing-диалог.
            *app.state::<AppState>().inner.app_handle.lock().unwrap() = Some(app.handle().clone());

            let api_state = api_state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = api::run_api_server(api_state).await {
                    crate::log_error!("API server error: {e}");
                }
            });

            let ipc_state = ipc_state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ipc::run_ipc_server(ipc_state).await {
                    crate::log_error!("IPC server error: {e}");
                }
            });

            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = tauri::menu::MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Mynx")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Global hotkey that raises the window from the tray (persisted in settings.json).
            if let Some(shortcut) = hotkey::effective_shortcut() {
                if let Err(e) = hotkey::register_shortcut(app.handle(), &shortcut) {
                    crate::log_warn!("tray hotkey registration failed: {e}");
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                        // Сворачивание в трей: затираем секреты в RAM,
                        // чтобы пароли не остались в памяти/свопе
                        if *hide_state.lock_on_hide.lock().unwrap() {
                            commands::wipe_secrets(&hide_state);
                            crate::clipboard::clear_clipboard(window_clone.app_handle(), &hide_state);
                            memprotect::trim_working_set();
                            let _ = window_clone.emit("vault-locked", ());
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            vault_create,
            vault_unlock,
            vault_lock,
            check_vault_unlocked,
            list_vault_files,
            vault_get_entries,
            vault_save_entries,
            vault_change_password,
            vault_delete,
            vault_export,
            vault_backup,
            vault_set_decoy_password,
            vault_remove_decoy,
            vault_hw_key_status,
            vault_decoy_status,
            vault_enable_hw_key,
            vault_disable_hw_key,
            secure_copy,
            secure_paste,
            secure_copy_available,
            clipboard_set_secure,
            clipboard_history_set_enabled,
            save_png_file,
            get_api_token,
            rotate_api_token,
            get_device_key,
            set_lock_on_hide,
            set_autolock_minutes,
            set_app_language,
            auto_type_credentials,
            auto_type_text,
            get_foreground_window,
            tray_hotkey_get,
            tray_hotkey_pause,
            tray_hotkey_set,
            fetch_favicon,
            biometry_is_available,
            biometry_is_enabled,
            biometry_enable,
            biometry_disable,
            vault_unlock_biometry,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app, event| {
            // Завершение приложения: затираем секреты и вытесняем
            // рабочий набор из RAM до выхода процесса
            if let tauri::RunEvent::Exit = event {
                commands::wipe_secrets(&exit_state);
                crate::clipboard::clear_clipboard(app, &exit_state);
                memprotect::trim_working_set();
            }
            let _ = app;
        });
}

//! Global hotkey that raises the main window from the tray.
//!
//! The chosen shortcut is persisted in `settings.json` next to the
//! executable (the same folder scheme as the hw-key registry). The field
//! is absent until the user changes it (default applies) and is an empty
//! string when the user explicitly disables the hotkey.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+M";

#[derive(Serialize, Deserialize, Default)]
struct AppSettings {
    /// Persisted tray hotkey; "" means explicitly disabled.
    #[serde(default)]
    tray_hotkey: Option<String>,
}

fn settings_file() -> Result<PathBuf, String> {
    Ok(std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .join("settings.json"))
}

fn load_settings() -> AppSettings {
    let Ok(path) = settings_file() else {
        return AppSettings::default();
    };
    std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_file()?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Effective hotkey from the persisted value: default until the user
/// changes it, None when explicitly disabled ("").
fn resolve(saved: Option<&str>) -> Option<String> {
    match saved {
        None => Some(DEFAULT_SHORTCUT.to_string()),
        Some("") => None,
        Some(s) => Some(s.to_string()),
    }
}

/// Currently effective hotkey (settings file + default fallback).
pub fn effective_shortcut() -> Option<String> {
    resolve(load_settings().tray_hotkey.as_deref())
}

/// Register a shortcut string ("Ctrl+Shift+M") with the global-shortcut plugin.
pub fn register_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    let parsed: Shortcut = shortcut.parse().map_err(|_| "invalid_shortcut".to_string())?;
    app.global_shortcut()
        .register(parsed)
        .map_err(|e| e.to_string())
}

/// Effective tray hotkey (None = disabled). Frontend settings screen.
#[tauri::command]
pub async fn tray_hotkey_get() -> Result<Option<String>, String> {
    Ok(effective_shortcut())
}

/// Temporarily unregister or re-register the effective tray hotkey without
/// changing persisted settings. Used by the settings screen while capturing a
/// new shortcut so the backend handler does not intercept the key event.
#[tauri::command]
pub async fn tray_hotkey_pause(
    paused: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let gs = app.global_shortcut();
    if paused {
        // Unregister all global shortcuts so the user can press the desired
        // combination without the backend or frontend handlers consuming it.
        // Frontend hotkeys are restored via bumpHotkeysEpoch after recording.
        gs.unregister_all().map_err(|e| e.to_string())
    } else {
        // Re-register the persisted tray hotkey, if any.
        if let Some(s) = effective_shortcut() {
            register_shortcut(&app, &s)?;
        }
        Ok(())
    }
}

/// Re-register the tray hotkey; None / "" disables it. Persisted.
#[tauri::command]
pub async fn tray_hotkey_set(
    shortcut: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let shortcut = shortcut.filter(|s| !s.trim().is_empty());
    // Validate first so a bad string never wipes the working registration.
    if let Some(s) = shortcut.as_deref() {
        s.parse::<Shortcut>().map_err(|_| "invalid_shortcut".to_string())?;
    }

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    if let Some(s) = shortcut.as_deref() {
        register_shortcut(&app, s)?;
    }

    let mut settings = load_settings();
    settings.tray_hotkey = Some(shortcut.unwrap_or_default());
    save_settings(&settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_parses() {
        assert!(DEFAULT_SHORTCUT.parse::<Shortcut>().is_ok());
    }

    #[test]
    fn resolve_falls_back_to_default() {
        assert_eq!(resolve(None), Some(DEFAULT_SHORTCUT.to_string()));
    }

    #[test]
    fn resolve_honours_disable_and_custom() {
        assert_eq!(resolve(Some("")), None);
        assert_eq!(resolve(Some("Ctrl+Shift+Q")), Some("Ctrl+Shift+Q".to_string()));
    }

    #[test]
    fn settings_roundtrip() {
        let settings = AppSettings {
            tray_hotkey: Some("Ctrl+Shift+Q".to_string()),
        };
        let bytes = serde_json::to_vec(&settings).unwrap();
        let back: AppSettings = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back.tray_hotkey.as_deref(), Some("Ctrl+Shift+Q"));
        // Missing field must deserialize as "not set" (default applies).
        let empty: AppSettings = serde_json::from_slice(b"{}").unwrap();
        assert_eq!(empty.tray_hotkey, None);
    }
}

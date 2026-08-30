//! Clipboard handling that must survive the webview: timed clearing and
//! clearing on lock/exit. The frontend's own `setTimeout` cleanup is kept
//! as a first line, these commands are the reliable second line.

use serde::Deserialize;
use tauri::State;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::commands::AppState;

#[derive(Deserialize)]
pub struct ClipboardSetSecureRequest {
    pub text: String,
    /// Seconds after which the clipboard is cleared (0 = no timer).
    #[serde(default)]
    pub clear_after_secs: u64,
}

/// Put text into the system clipboard and schedule its clearing after
/// `clear_after_secs`. The clear only happens when the clipboard still
/// holds exactly this text (the user may have copied something else since).
/// A newer call supersedes the previous timer via a generation counter.
#[tauri::command]
pub async fn clipboard_set_secure(
    request: ClipboardSetSecureRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    app.clipboard()
        .write_text(request.text.clone())
        .map_err(|e| e.to_string())?;

    if request.clear_after_secs == 0 {
        return Ok(());
    }

    let generation = {
        let mut gen = state.inner.clipboard_generation.lock().unwrap();
        *gen = gen.wrapping_add(1);
        *gen
    };

    let inner = state.inner.clone();
    let expected = request.text;
    let delay = std::time::Duration::from_secs(request.clear_after_secs);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        // Superseded by a newer clipboard_set_secure call: the new timer owns
        // the clipboard now, this one must not touch it.
        if *inner.clipboard_generation.lock().unwrap() != generation {
            return;
        }
        let current = app.clipboard().read_text().unwrap_or_default();
        if current == expected {
            let _ = app.clipboard().write_text("");
        }
    });

    Ok(())
}

/// Best-effort clipboard wipe, used on vault lock and application exit.
/// The generation is bumped so any pending clear timer becomes a no-op.
pub fn clear_clipboard(app: &tauri::AppHandle, inner: &crate::commands::AppStateInner) {
    {
        let mut gen = inner.clipboard_generation.lock().unwrap();
        *gen = gen.wrapping_add(1);
    }
    let _ = app.clipboard().write_text("");
}

/// Enable or disable Windows Clipboard History (Win+V) for the current user.
/// No-op on other platforms.
#[tauri::command]
pub async fn clipboard_history_set_enabled(enabled: bool) -> Result<(), String> {
    set_clipboard_history(enabled)
}

#[cfg(target_os = "windows")]
fn set_clipboard_history(enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Clipboard")
        .map_err(|e| e.to_string())?;
    key.set_value("EnableClipboardHistory", &(enabled as u32))
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn set_clipboard_history(_enabled: bool) -> Result<(), String> {
    Ok(())
}

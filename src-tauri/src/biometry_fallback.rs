//! Non-Windows stub for the biometry module: Windows Hello does not exist
//! here, so every command reports "not supported" and the frontend keeps
//! the plain password form.

use tauri::State;

use crate::commands::{AppState, VaultIdRequest, VaultUnlockResponse};

const NOT_SUPPORTED: &str = "biometry_not_supported";

/// No-op counterpart of the Windows keychain refresh.
pub fn refresh_stored_key(_vault_id: &str, _enc_key: &[u8; 32]) {}

#[tauri::command]
pub async fn biometry_is_available() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn biometry_is_enabled(_request: VaultIdRequest) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn biometry_enable(
    _request: VaultIdRequest,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err(NOT_SUPPORTED.to_string())
}

#[tauri::command]
pub async fn biometry_disable(_request: VaultIdRequest) -> Result<(), String> {
    Err(NOT_SUPPORTED.to_string())
}

#[tauri::command]
pub async fn vault_unlock_biometry(
    _request: VaultIdRequest,
    _state: State<'_, AppState>,
) -> Result<VaultUnlockResponse, String> {
    Err(NOT_SUPPORTED.to_string())
}

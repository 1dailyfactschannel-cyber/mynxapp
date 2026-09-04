use std::path::Path;

use tauri::State;

use crate::vault::operations::{load_vault_file, remove_decoy, save_vault_file, set_decoy_password, x_decrypt_v2_or_legacy, AAD_HEADER_V2};
use crate::vault::types::VaultInnerHeader;

use super::app_state::AppState;
use super::device_key::{cached_hw_secret, load_device_key, session_keys};
use super::types::*;

/// Включить или сменить ложный пароль (plausible deniability).
/// Требует настоящий мастер-пароль: из ложной сессии слоем управлять нельзя.
#[tauri::command]
pub async fn vault_set_decoy_password(
    request: SetDecoyPasswordRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (_enc_key, _payload_key, is_decoy) = session_keys(&state, &request.vault_id)?;
    if is_decoy {
        return Err("wrong_password".to_string());
    }
    super::validate_master_password(&request.decoy_password)?;

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }

    let device_key = load_device_key(vault_path)?;
    let mut vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    set_decoy_password(
        &mut vault,
        &request.master_password,
        &device_key,
        cached_hw_secret(&state).as_ref(),
        &request.decoy_password,
        request.old_decoy_password.as_deref(),
    )
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("decoy password must differ") {
            "decoy_equals_master".to_string()
        } else {
            "wrong_password".to_string()
        }
    })?;

    save_vault_file(vault_path, &vault).map_err(|e| e.to_string())
}

/// Отключить ложный слой: слот заменяется на "спящий".
#[tauri::command]
pub async fn vault_remove_decoy(
    request: RemoveDecoyRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (_enc_key, _payload_key, is_decoy) = session_keys(&state, &request.vault_id)?;
    if is_decoy {
        return Err("wrong_password".to_string());
    }

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }

    let device_key = load_device_key(vault_path)?;
    let mut vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    remove_decoy(
        &mut vault,
        &request.master_password,
        &device_key,
        cached_hw_secret(&state).as_ref(),
    )
    .map_err(|_| "wrong_password".to_string())?;

    save_vault_file(vault_path, &vault).map_err(|e| e.to_string())
}

/// Статус ложного слоя (читается из зашифрованного реального заголовка).
/// Из ложной сессии возвращает true — сам факт разблокировки ложным паролем
/// означает, что слой включён.
#[tauri::command]
pub async fn vault_decoy_status(
    request: VaultIdRequest,
    state: State<'_, AppState>,
) -> Result<DecoyStatusResponse, String> {
    let (enc_key, _payload_key, is_decoy) = session_keys(&state, &request.vault_id)?;
    if is_decoy {
        return Ok(DecoyStatusResponse { enabled: true });
    }

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }
    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;
    let decrypted =
        x_decrypt_v2_or_legacy(&enc_key, &vault.header.encrypted_header, AAD_HEADER_V2)
            .map_err(|e| e.to_string())?;
    let inner: VaultInnerHeader = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;
    Ok(DecoyStatusResponse {
        enabled: inner.decoy_enabled,
    })
}

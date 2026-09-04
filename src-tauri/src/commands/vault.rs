use std::path::Path;

use tauri::State;
use zeroize::Zeroize;

use crate::crypto::{derive_encryption_key_hw, derive_key, CryptoModule, KdfParams, XChaCha20Aead};
use crate::vault::operations::{
    active_payload, build_export, create_vault, decrypt_entries, load_vault_file,
    migrate_kdf_if_needed, open_vault, open_vault_any, save_entries_to_vault, save_vault_file,
    x_decrypt_v2_or_legacy, AAD_HEADER_V2,
};
use crate::vault::types::{KdfParamsSerializable, VaultInnerHeader};

use super::app_state::AppState;
use super::device_key::{
    cached_hw_secret, count_entries, hex_encode, load_device_key, session_keys,
    store_device_key,
};
use super::types::*;
use super::validate_master_password;

use super::hw_key::{hw_registry_forget, hw_registry_remember, resolve_hw_keyfile};
use crate::vault::operations::{read_hw_keyfile};

#[tauri::command]
pub async fn vault_create(
    request: VaultCreateRequest,
    state: State<'_, AppState>,
) -> Result<VaultCreateResponse, String> {
    // SECURITY: минимальная длина и базовая структурная проверка
    // мастер-пароля. UI тоже валидирует, но бэкенд не должен доверять фронту.
    validate_master_password(&request.master_password)?;

    // Generate device key
    let device_key = {
        let dk = CryptoModule::generate_device_key()
            .map_err(|e| e.to_string())?;
        let mut state_dk = state.inner.device_key.lock().unwrap();
        *state_dk = Some(dk);
        dk
    };

    // Resolve absolute path next to .exe
    let base_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .to_path_buf();
    let vaults_dir = base_dir.join(&request.path);

    let vault = create_vault(
        &vaults_dir,
        &request.master_password,
        &device_key,
    )
    .map_err(|e| e.to_string())?;

    // Ensure directory exists
    std::fs::create_dir_all(&vaults_dir).map_err(|e| e.to_string())?;

    // Save vault to file
    let vault_path = vaults_dir.join(format!("{}.safepass", request.name));
    let vault_bytes = serde_json::to_vec(&vault).map_err(|e| e.to_string())?;
    std::fs::write(&vault_path, &vault_bytes).map_err(|e| e.to_string())?;

    // Save device key: в keyring (основной путь) + файл-fallback
    #[cfg(target_os = "windows")]
    store_device_key(&vault_path, &device_key);
    let dk_path = vault_path.with_extension("safepass.dk");
    std::fs::write(&dk_path, device_key).map_err(|e| e.to_string())?;

    let vault_id = vault_path.to_string_lossy().to_string();

    // Open a live session so the new vault is usable right away
    let mut session = open_vault(&vault, &request.master_password, &device_key, None)
        .map_err(|e| e.to_string())?;
    session.vault_id = vault_id.clone();
    {
        let mut s = state.inner.vault_session.lock().unwrap();
        *s = Some(session);
        let mut hw = state.inner.hw_key_secret.lock().unwrap();
        *hw = None;
    }

    Ok(VaultCreateResponse {
        vault_id,
        success: true,
    })
}

#[tauri::command]
pub async fn vault_unlock(
    request: VaultUnlockRequest,
    state: State<'_, AppState>,
) -> Result<VaultUnlockResponse, String> {
    // Brute-force guard: exponential backoff after repeated failures.
    if let Some(wait) = state.inner.unlock_attempts.retry_after(&request.vault_id) {
        return Err(format!(
            "Too many attempts. Retry in {} seconds",
            wait.as_secs().max(1)
        ));
    }

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }

    let device_key = load_device_key(vault_path)?;

    // Cache device key in state
    {
        let mut dk = state.inner.device_key.lock().unwrap();
        *dk = Some(device_key);
    }

    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    // Аппаратный ключ: если включён, ищем keyfile (явный путь → реестр → скан дисков)
    let hw_secret = match vault.header.hw_key.as_ref() {
        Some(info) => {
            let kf_path = resolve_hw_keyfile(&info.keyfile_id, request.keyfile_path.as_deref())?;
            let secret = read_hw_keyfile(&kf_path, &info.keyfile_id, &device_key)
                .map_err(|_| "hw_key_invalid".to_string())?;
            // Запоминаем путь, чтобы не искать в следующий раз
            hw_registry_remember(&info.keyfile_id, &kf_path);
            Some(secret)
        }
        None => None,
    };

    // Пароль может открыть настоящий слой или ложный — пробуем оба
    let mut session = match open_vault_any(
        &vault,
        &request.master_password,
        &device_key,
        hw_secret.as_ref(),
    ) {
        Ok(session) => session,
        Err(_) => {
            state.inner.unlock_attempts.record_failure(&request.vault_id);
            return Err("wrong_password".to_string());
        }
    };

    // Successful unlock clears the failure counter.
    state.inner.unlock_attempts.reset(&request.vault_id);

    session.vault_id = request.vault_id.clone();

    let entries_json = decrypt_entries(
        &session.payload_key,
        active_payload(&vault, session.is_decoy),
    )
    .map_err(|e| e.to_string())?;
    let entry_count = count_entries(&entries_json);
    let is_decoy = session.is_decoy;

    // SECURITY: KDF-миграция. Если файл создан на старой версии с
    // параметрами ниже текущего KdfParams::default() (16 MB / 3 iter),
    // перешифровываем заголовок с актуальными параметрами + новой солью.
    // Только для настоящего (не decoy) слоя: ложный слот мигрирует отдельно
    // при следующей явной переустановке decoy-пароля пользователем.
    if !is_decoy {
        let mut writable = vault.clone();
        match migrate_kdf_if_needed(
            &mut writable,
            &request.master_password,
            &device_key,
            hw_secret.as_ref(),
        ) {
            Ok(true) => {
                if let Err(e) = save_vault_file(vault_path, &writable) {
                    crate::log_warn!("KDF migration: failed to persist new params: {e}");
                } else {
                    // Подтягиваем свежий enc_key в сессию.
                    if let Ok(fresh) = open_vault(
                        &writable,
                        &request.master_password,
                        &device_key,
                        hw_secret.as_ref(),
                    ) {
                        session.encryption_key = fresh.encryption_key;
                    }
                }
            }
            Ok(false) => {} // уже актуальные
            Err(e) => {
                // Не критично: продолжаем с открытой сессией. Лог для диагностики.
                crate::log_warn!("KDF migration error: {e}");
            }
        }
    }

    {
        let mut s = state.inner.vault_session.lock().unwrap();
        *s = Some(session);
        let mut hw = state.inner.hw_key_secret.lock().unwrap();
        *hw = hw_secret;
    }

    // Baseline для бэкенд-автоблокировки: отсчёт простоя начинается с разблокировки
    state.inner.touch_activity();

    Ok(VaultUnlockResponse {
        success: true,
        entry_count,
        entries_json,
        is_decoy,
    })
}

#[tauri::command]
pub async fn vault_lock(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    super::wipe_secrets(&state.inner);
    crate::clipboard::clear_clipboard(&app, &state.inner);
    Ok(())
}

#[tauri::command]
pub async fn check_vault_unlocked(state: State<'_, AppState>) -> Result<bool, String> {
    let session = state.inner.vault_session.lock().unwrap();
    Ok(session.is_some())
}

#[tauri::command]
pub async fn list_vault_files() -> Result<Vec<String>, String> {
    let base_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .to_path_buf();
    let vaults_dir = base_dir.join("vaults");

    if !vaults_dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    match std::fs::read_dir(&vaults_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("safepass") {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        }
        Err(e) => return Err(e.to_string()),
    }

    Ok(files)
}

/// Decrypt and return the entries of the unlocked vault
#[tauri::command]
pub async fn vault_get_entries(
    request: VaultIdRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.inner.enforce_autolock()?;
    let (_enc_key, payload_key, is_decoy) = session_keys(&state, &request.vault_id)?;
    let vault = load_vault_file(Path::new(&request.vault_id)).map_err(|e| e.to_string())?;
    decrypt_entries(&payload_key, active_payload(&vault, is_decoy)).map_err(|e| e.to_string())
}

/// Encrypt and persist the entries of the unlocked vault (atomic write).
/// Записи уходят в тот слой, который открыт в текущей сессии.
#[tauri::command]
pub async fn vault_save_entries(
    request: SaveEntriesRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.inner.enforce_autolock()?;
    let (enc_key, payload_key, is_decoy) = session_keys(&state, &request.vault_id)?;

    save_entries_to_vault(
        Path::new(&request.vault_id),
        &enc_key,
        &payload_key,
        is_decoy,
        &request.entries_json,
    )
    .map_err(|e| e.to_string())
}

/// Change the master password: verify the old one, then re-encrypt the vault
/// header with a fresh salt. The payload key stays the same, so the encrypted
/// entries do not need to be touched.
#[tauri::command]
pub async fn vault_change_password(
    request: ChangePasswordRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    validate_master_password(&request.new_password)?;

    session_keys(&state, &request.vault_id).and_then(|(_, _, is_decoy)| {
        if is_decoy {
            Err("wrong_password".to_string())
        } else {
            Ok(())
        }
    })?;

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }

    let device_key = load_device_key(vault_path)?;
    let mut vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    // Verify current password (also recovers the old encryption key)
    let old_session = open_vault(
        &vault,
        &request.old_password,
        &device_key,
        cached_hw_secret(&state).as_ref(),
    )
    .map_err(|_| "wrong_password".to_string())?;

    // Fresh salt → new primary key → new encryption key (same device key)
    let new_salt = CryptoModule::generate_salt().map_err(|e| e.to_string())?;
    let kdf_params = KdfParams::default();
    let new_primary = derive_key(
        request.new_password.as_bytes(),
        &new_salt,
        &kdf_params,
    )
    .map_err(|e| e.to_string())?;
    let new_enc_key = derive_encryption_key_hw(
        &new_primary,
        &device_key,
        cached_hw_secret(&state).as_ref(),
        b"safepass-v1-enc-key",
    )
    .map_err(|e| e.to_string())?;

    // Re-encrypt the inner header with the new key
    let decrypted_header = x_decrypt_v2_or_legacy(
        &old_session.encryption_key,
        &vault.header.encrypted_header,
        AAD_HEADER_V2,
    )
    .map_err(|e| e.to_string())?;
    let mut inner: VaultInnerHeader =
        serde_json::from_slice(&decrypted_header).map_err(|e| e.to_string())?;
    inner.modified_at = chrono::Utc::now().timestamp();
    let header_bytes = serde_json::to_vec(&inner).map_err(|e| e.to_string())?;
    vault.header.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(&new_enc_key, &header_bytes, AAD_HEADER_V2)
            .map_err(|e| e.to_string())?;
    vault.header.salt = new_salt;
    vault.header.kdf_params = KdfParamsSerializable::from(&kdf_params);

    save_vault_file(vault_path, &vault).map_err(|e| e.to_string())?;

    // Keep the user unlocked with the new encryption key
    {
        let mut session = state.inner.vault_session.lock().unwrap();
        if let Some(s) = session.as_mut() {
            if s.vault_id == request.vault_id {
                s.encryption_key = new_enc_key;
            }
        }
    }

    // Password change rotates the encryption key: keep the Windows Hello
    // keychain entry (if enabled) in sync so biometry unlock keeps working.
    crate::biometry::refresh_stored_key(&request.vault_id, &new_enc_key);

    // SECURITY: смена мастер-пароля — хороший повод ротировать api_token.
    // Если токен утекал ранее (через логи, screen-share, process listing),
    // старая сессия перестаёт работать сразу после смены пароля.
    {
        let mut slot = state.inner.api_token.lock().unwrap();
        *slot = Zeroizing::new(super::generate_api_token_internal());
    }

    Ok(())
}

/// Permanently delete the vault file and its device key
#[tauri::command]
pub async fn vault_delete(
    request: VaultIdRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    session_keys(&state, &request.vault_id)?;

    let vault_path = Path::new(&request.vault_id);

    // Drop the live session first (it belongs to the vault being deleted)
    {
        let mut session = state.inner.vault_session.lock().unwrap();
        *session = None;
    }

    // Если был включён hw-ключ — забываем путь keyfile из реестра
    if let Ok(vault) = load_vault_file(vault_path) {
        if let Some(info) = vault.header.hw_key.as_ref() {
            hw_registry_forget(&info.keyfile_id);
        }
    }

    for path in [
        vault_path.to_path_buf(),
        vault_path.with_extension("safepass.dk"),
    ] {
        match std::fs::remove_file(&path) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(())
}

/// Export the decrypted entries into a portable encrypted backup file.
/// The backup key derives from the master password only (no device key),
/// so it can be restored on another machine.
#[tauri::command]
pub async fn vault_export(
    request: ExportRequest,
    state: State<'_, AppState>,
) -> Result<ExportResponse, String> {
    session_keys(&state, &request.vault_id)?;

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }

    let device_key = load_device_key(vault_path)?;
    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    // Verify master password
    let export_session = open_vault(
        &vault,
        &request.master_password,
        &device_key,
        cached_hw_secret(&state).as_ref(),
    )
    .map_err(|_| "wrong_password".to_string())?;

    let entries_json = decrypt_entries(&export_session.payload_key, &vault.payload)
        .map_err(|e| e.to_string())?;
    let export_bytes = build_export(&entries_json, &request.master_password)
        .map_err(|e| e.to_string())?;

    let default_name = format!(
        "mynx-backup-{}.spbackup",
        chrono::Utc::now().format("%Y-%m-%d")
    );

    let Some(target_path) = super::pick_save_path(
        &default_name,
        "Mynx - Export encrypted backup",
        "Mynx Backup",
        "spbackup",
    ) else {
        return Ok(ExportResponse {
            path: String::new(),
            cancelled: true,
        });
    };

    std::fs::write(&target_path, &export_bytes).map_err(|e| e.to_string())?;

    Ok(ExportResponse {
        path: target_path.to_string_lossy().to_string(),
        cancelled: false,
    })
}

/// Return the device key (hex) of the currently unlocked vault.
/// The Emergency Kit QR embeds it: vault file + device key + master
/// password is the recovery path, so it is exposed only while unlocked.
#[tauri::command]
pub async fn get_device_key(
    request: VaultIdRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    session_keys(&state, &request.vault_id)?;
    let device_key = load_device_key(Path::new(&request.vault_id))?;
    Ok(hex_encode(&device_key))
}

//! Windows Hello unlock for the vault.
//!
//! After a successful password unlock the user can opt into Windows Hello:
//! the session encryption key is stored in the Windows Credential Manager
//! (via the `keyring` crate) under "mynx/vault/<vault_id>". The next unlock
//! verifies the user with UserConsentVerifier (Hello face/fingerprint/PIN)
//! and rebuilds the session from the stored key — no password prompt.
//!
//! The master password itself is NEVER stored: only the derived encryption
//! key, and only inside the OS credential locker. Failed Hello verifications
//! feed the same per-vault rate-limit tracker as password failures, so the
//! backoff cannot be dodged by switching methods.

use std::path::Path;
use tauri::State;
use zeroize::Zeroize;

use crate::commands::{
    count_entries, load_device_key, AppState, VaultIdRequest, VaultUnlockResponse,
};
use crate::crypto::XChaCha20Aead;
use crate::vault::operations::{active_payload, decrypt_entries, load_vault_file};
use crate::vault::types::{VaultInnerHeader, VaultSession};

const KEYRING_SERVICE: &str = "mynx";

fn entry(vault_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("vault/{}", vault_id))
        .map_err(|e| e.to_string())
}

fn key_to_hex(key: &[u8; 32]) -> String {
    key.iter().map(|b| format!("{:02x}", b)).collect()
}

fn key_from_hex(hex: &str) -> Result<[u8; 32], String> {
    if hex.len() != 64 {
        return Err("biometry_key_invalid".to_string());
    }
    let mut key = [0u8; 32];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        let s = std::str::from_utf8(chunk).map_err(|_| "biometry_key_invalid".to_string())?;
        key[i] = u8::from_str_radix(s, 16).map_err(|_| "biometry_key_invalid".to_string())?;
    }
    Ok(key)
}

fn hello_available() -> bool {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    UserConsentVerifier::CheckAvailabilityAsync()
        .and_then(|op| op.get())
        .map(|a| a == UserConsentVerifierAvailability::Available)
        .unwrap_or(false)
}

/// Show the Windows Hello prompt; Ok only on a verified user.
fn hello_verify(message: &str) -> Result<(), String> {
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};
    let result = UserConsentVerifier::RequestVerificationAsync(&windows::core::HSTRING::from(message))
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    match result {
        UserConsentVerificationResult::Verified => Ok(()),
        UserConsentVerificationResult::Canceled => Err("biometry_cancelled".to_string()),
        _ => Err("biometry_failed".to_string()),
    }
}

/// Refresh the stored key after a master password change. No-op when
/// Hello unlock is not enabled for this vault.
pub fn refresh_stored_key(vault_id: &str, enc_key: &[u8; 32]) {
    if let Ok(e) = entry(vault_id) {
        if e.get_password().is_ok() {
            let _ = e.set_password(&key_to_hex(enc_key));
        }
    }
}

/// Windows Hello available on this machine (face/fingerprint/PIN set up).
#[tauri::command]
pub async fn biometry_is_available() -> Result<bool, String> {
    Ok(hello_available())
}

/// Hello unlock enabled for this vault (key present in the OS locker).
#[tauri::command]
pub async fn biometry_is_enabled(request: VaultIdRequest) -> Result<bool, String> {
    Ok(entry(&request.vault_id)?.get_password().is_ok())
}

/// Enable Hello unlock for the currently unlocked vault.
/// Requires a real (non-decoy) session and one Hello verification.
#[tauri::command]
pub async fn biometry_enable(
    request: VaultIdRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !hello_available() {
        return Err("biometry_not_available".to_string());
    }
    let (enc_key, _payload_key, is_decoy) =
        crate::commands::session_keys(&state, &request.vault_id)?;
    if is_decoy {
        return Err("biometry_requires_real_vault".to_string());
    }
    hello_verify("Mynx: enable Windows Hello unlock")?;
    entry(&request.vault_id)?
        .set_password(&key_to_hex(&enc_key))
        .map_err(|e| e.to_string())
}

/// Disable Hello unlock: drop the stored key. Never errors when the
/// entry is already gone.
#[tauri::command]
pub async fn biometry_disable(request: VaultIdRequest) -> Result<(), String> {
    match entry(&request.vault_id)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Unlock the vault via Windows Hello instead of the master password.
/// Same response shape as vault_unlock; the frontend falls back to the
/// password form on any error.
#[tauri::command]
pub async fn vault_unlock_biometry(
    request: VaultIdRequest,
    state: State<'_, AppState>,
) -> Result<VaultUnlockResponse, String> {
    // Shared brute-force guard with the password path (same per-vault key).
    if let Some(wait) = state.inner.unlock_attempts.retry_after(&request.vault_id) {
        return Err(format!(
            "Too many attempts. Retry in {} seconds",
            wait.as_secs().max(1)
        ));
    }

    if !hello_available() {
        return Err("biometry_not_available".to_string());
    }
    if let Err(e) = hello_verify("Mynx: unlock vault") {
        state.inner.unlock_attempts.record_failure(&request.vault_id);
        return Err(e);
    }

    let mut hex = entry(&request.vault_id)?
        .get_password()
        .map_err(|_| "biometry_not_enabled".to_string())?;
    let enc_key = key_from_hex(&hex);
    hex.zeroize();
    let mut enc_key = enc_key.map_err(|e| {
        state.inner.unlock_attempts.record_failure(&request.vault_id);
        e
    })?;

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }
    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    // Rebuild the session from the stored encryption key (no password).
    let decrypted = XChaCha20Aead::decrypt(&enc_key, &vault.header.encrypted_header).map_err(|_| {
        state.inner.unlock_attempts.record_failure(&request.vault_id);
        enc_key.zeroize();
        "biometry_key_invalid".to_string()
    })?;
    let inner: VaultInnerHeader = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;

    // Successful unlock clears the failure counter.
    state.inner.unlock_attempts.reset(&request.vault_id);

    let session = VaultSession::new(request.vault_id.clone(), enc_key, inner.payload_key);
    let entries_json = decrypt_entries(&session.payload_key, active_payload(&vault, false))
        .map_err(|e| e.to_string())?;
    let entry_count = count_entries(&entries_json);

    // Keep the device key cached like the password path does.
    let device_key = load_device_key(vault_path).ok();
    {
        let mut s = state.inner.vault_session.lock().unwrap();
        *s = Some(session);
        let mut hw = state.inner.hw_key_secret.lock().unwrap();
        *hw = None;
        let mut dk = state.inner.device_key.lock().unwrap();
        *dk = device_key;
    }

    Ok(VaultUnlockResponse {
        success: true,
        entry_count,
        entries_json,
        is_decoy: false,
    })
}

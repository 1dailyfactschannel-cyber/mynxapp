//! Windows Hello unlock for the vault.
//!
//! After a successful password unlock the user can opt into Windows Hello:
//! the session encryption key is stored in the Windows Credential Manager
//! (via the `keyring` crate) under "mynx/vault/<vault_id>". The next unlock
//! verifies the user with UserConsentVerifier (Hello face/fingerprint/PIN)
//! and rebuilds the session from the stored key — no password prompt.
//!
//! P1-12: when Microsoft Passport is available the stored key is WRAPPED —
//! encrypted with a key derived from a KeyCredential signature, so reading
//! the Credential Manager entry directly (any process of the same user)
//! yields an unusable blob; unwrapping always shows the Hello prompt.
//! Legacy entries (plain hex) are still accepted and migrated on next save.
//!
//! The master password itself is NEVER stored: only the derived encryption
//! key, and only inside the OS credential locker. Failed Hello verifications
//! feed the same per-vault rate-limit tracker as password failures, so the
//! backoff cannot be dodged by switching methods.

use std::path::Path;
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

use crate::commands::{
    count_entries, load_device_key, AppState, VaultIdRequest, VaultUnlockResponse,
};
use crate::crypto::Aes256GcmAead;
use crate::vault::operations::{active_payload, decrypt_entries, load_vault_file};
use crate::vault::types::{VaultInnerHeader, VaultSession};

const KEYRING_SERVICE: &str = "mynx";

/* ------------------------------------------------------------------ */
/* Microsoft Passport: Hello-обёртка ключа сессии (P1-12)               */
/* ------------------------------------------------------------------ */

// Раньше ключ сессии лежал в Credential Manager открытым hex-ом: любой
// процесс того же пользователя мог вычитать его через CredRead БЕЗ
// биометрии. Теперь при включении Hello ключ шифруется AES-256-GCM
// ключом, выведенным из подписи Microsoft Passport (KeyCredential):
// подпись фиксированного challenge детерминирована (RSA-PKCS1), а
// RequestSignAsync всегда показывает Hello-промпт — без лица/отпечатка/
// PIN обёртку не открыть даже с прямым доступом к Credential Manager.
// Старые записи (открытый hex) продолжают читаться — legacy-путь ниже.

const PASSPORT_BLOB_PREFIX: &str = "mynx-passport-v1:";
const PASSPORT_SALT: &[u8] = b"mynx-passport-wrap-v1";
const PASSPORT_AAD: &[u8] = b"mynx:v2:passport-wrap";

fn entry(vault_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("vault/{}", vault_id))
        .map_err(|e| e.to_string())
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

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || s.len() < 2 {
        return None;
    }
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok())
        .collect()
}

fn passport_credential_name(vault_id: &str) -> String {
    // В имени credential допустимы только буквы/цифры/точка/дефис.
    let safe: String = vault_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("mynx.wrap.{safe}")
}

fn passport_challenge(vault_id: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(vault_id.as_bytes());
    hasher.update(b"mynx-passport-challenge-v1");
    hasher.finalize().into()
}

fn passport_supported() -> bool {
    use windows::Security::Credentials::KeyCredentialManager;
    KeyCredentialManager::IsSupportedAsync()
        .and_then(|op| op.get())
        .unwrap_or(false)
}

/// Подписать фиксированный challenge ключом Microsoft Passport.
/// Показывает Hello-промпт (при создании — enrollment).
/// create=true создаёт credential при отсутствии (ReplaceExisting);
/// create=false только открывает существующий (NotFound → биометрия не включена).
fn passport_sign(credential_name: &str, create: bool, challenge: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Security::Credentials::{
        KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
    };
    use windows::Security::Cryptography::CryptographicBuffer;
    use windows::core::Array;

    let name = windows::core::HSTRING::from(credential_name);
    let retrieval = if create {
        KeyCredentialManager::RequestCreateAsync(
            &name,
            KeyCredentialCreationOption::ReplaceExisting,
        )
        .map_err(|e| format!("biometry_passport_create: {e}"))?
        .get()
        .map_err(|e| format!("biometry_passport_create: {e}"))?
    } else {
        KeyCredentialManager::OpenAsync(&name)
            .map_err(|e| format!("biometry_passport_open: {e}"))?
            .get()
            .map_err(|e| format!("biometry_passport_open: {e}"))?
    };

    let status = retrieval.Status().map_err(|e| e.to_string())?;
    if status != KeyCredentialStatus::Success {
        return Err(match status {
            KeyCredentialStatus::UserCanceled => "biometry_cancelled".to_string(),
            KeyCredentialStatus::NotFound => "biometry_not_enabled".to_string(),
            _ => "biometry_passport_failed".to_string(),
        });
    }
    let credential = retrieval.Credential().map_err(|e| e.to_string())?;

    let input = CryptographicBuffer::CreateFromByteArray(challenge)
        .map_err(|e| e.to_string())?;
    let signature = credential
        .RequestSignAsync(&input)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    // KeyCredentialOperationResult.Result() -> IBuffer: именно буфер
    // передаётся в CopyToByteArray (сам result буфером не является).
    let sig_buffer = signature.Result().map_err(|e| e.to_string())?;

    let mut sig_bytes = Array::<u8>::new();
    CryptographicBuffer::CopyToByteArray(&sig_buffer, &mut sig_bytes)
        .map_err(|e| e.to_string())?;
    Ok(sig_bytes.to_vec())
}

/// Ключ обёртки: HKDF-SHA256 от детерминированной подписи паспорта.
/// (salt = PASSPORT_SALT, ikm = подпись, info = vault_id, L = 32)
fn passport_wrap_key(vault_id: &str, signature: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let okm = crate::crypto::derive_hkdf_key(PASSPORT_SALT, signature, vault_id.as_bytes(), 32)
        .map_err(|e| e.to_string())?;
    Ok(Zeroizing::new(okm))
}

/// Зашифровать ключ сессии под Hello-обёртку. Возвращает blob для keyring.
fn passport_seal(vault_id: &str, enc_key: &[u8; 32], create: bool) -> Result<String, String> {
    let signature = passport_sign(
        &passport_credential_name(vault_id),
        create,
        &passport_challenge(vault_id),
    )?;
    let wrap = passport_wrap_key(vault_id, &signature)?;
    let key: &[u8; 32] = wrap
        .as_slice()
        .try_into()
        .map_err(|_| "biometry_key_invalid".to_string())?;
    let blob = Aes256GcmAead::encrypt_with_aad(key, enc_key, PASSPORT_AAD)
        .map_err(|e| e.to_string())?;
    Ok(format!("{PASSPORT_BLOB_PREFIX}{}", bytes_to_hex(&blob)))
}

/// Расшифровать ключ сессии из blob-обёртки. Показывает Hello-промпт.
fn passport_unwrap(vault_id: &str, blob_hex: &str) -> Result<[u8; 32], String> {
    let blob = hex_decode(blob_hex).ok_or("biometry_blob_invalid".to_string())?;
    if blob.len() < 12 + 16 {
        return Err("biometry_blob_invalid".to_string());
    }
    let signature = passport_sign(
        &passport_credential_name(vault_id),
        false,
        &passport_challenge(vault_id),
    )?;
    let wrap = passport_wrap_key(vault_id, &signature)?;
    let key: &[u8; 32] = wrap
        .as_slice()
        .try_into()
        .map_err(|_| "biometry_key_invalid".to_string())?;
    let plain = Aes256GcmAead::decrypt_with_aad(key, &blob, PASSPORT_AAD)
        .map_err(|_| "biometry_key_invalid".to_string())?;
    plain.try_into().map_err(|_| "biometry_key_invalid".to_string())
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
    let Ok(e) = entry(vault_id) else { return };
    let Ok(stored) = e.get_password() else { return };

    let new_value: String = if stored.starts_with(PASSPORT_BLOB_PREFIX) {
        // Перезаворачиваем новый ключ той же Passport-обёрткой (create=false:
        // credential уже существует, один Hello-промпт). Если промпт отклонён
        // или Passport недоступен — откатываемся на legacy-hex, чтобы смена
        // мастер-пароля не сломала разблокировку; Hello можно перевключить.
        passport_seal(vault_id, enc_key, false).unwrap_or_else(|_| bytes_to_hex(enc_key))
    } else {
        bytes_to_hex(enc_key)
    };
    let _ = e.set_password(&new_value);
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
    let (enc_key, _payload_key, is_decoy) =
        crate::commands::session_keys(&state, &request.vault_id)?;
    if is_decoy {
        return Err("biometry_requires_real_vault".to_string());
    }

    // P1-12: стараемся завернуть ключ сессии в Passport-обёртку — RequestCreate
    // показывает Hello-промпт, ключ в Credential Manager лежит зашифрованным.
    // Если пользователь отклонил enrollment или Passport упал — не роняем
    // включение целиком, пробуем legacy-путь ниже.
    if passport_supported() {
        if let Ok(blob) = passport_seal(&request.vault_id, &enc_key, true) {
            return entry(&request.vault_id)?
                .set_password(&blob)
                .map_err(|e| e.to_string());
        }
    }

    if !hello_available() {
        return Err("biometry_not_available".to_string());
    }
    hello_verify("Mynx: enable Windows Hello unlock")?;
    entry(&request.vault_id)?
        .set_password(&bytes_to_hex(&enc_key))
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

    let mut stored = entry(&request.vault_id)?
        .get_password()
        .map_err(|_| "biometry_not_enabled".to_string())?;

    // P1-12: passport-blob (hex после префикса) → Hello-промпт показывается
    // внутри passport_unwrap (RequestSignAsync). Legacy-запись (открытый hex)
    // — сначала явная проверка Hello, как раньше.
    let is_legacy_hex = !stored.starts_with(PASSPORT_BLOB_PREFIX);
    let enc_key_result: Result<[u8; 32], String> =
        if let Some(blob) = stored.strip_prefix(PASSPORT_BLOB_PREFIX) {
            passport_unwrap(&request.vault_id, blob)
        } else {
            if !hello_available() {
                stored.zeroize();
                return Err("biometry_not_available".to_string());
            }
            match hello_verify("Mynx: unlock vault") {
                Ok(()) => key_from_hex(&stored),
                Err(e) => Err(e),
            }
        };
    stored.zeroize();

    let mut enc_key = match enc_key_result {
        Ok(key) => key,
        Err(e) => {
            state.inner.unlock_attempts.record_failure(&request.vault_id);
            return Err(e);
        }
    };

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }
    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

    // Rebuild the session from the stored encryption key (no password).
    // AAD v2 with legacy fallback: the vault may predate the AAD binding.
    let decrypted = crate::vault::operations::x_decrypt_v2_or_legacy(
        &enc_key,
        &vault.header.encrypted_header,
        crate::vault::operations::AAD_HEADER_V2,
    )
    .map_err(|_| {
        state.inner.unlock_attempts.record_failure(&request.vault_id);
        enc_key.zeroize();
        "biometry_key_invalid".to_string()
    })?;
    let inner: VaultInnerHeader = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;

    // Successful unlock clears the failure counter.
    state.inner.unlock_attempts.reset(&request.vault_id);

    // SECURITY (P1-12 followup): legacy-запись в keyring (открытый hex)
    // даёт любому процессу того же пользователя прочитать ключ сессии
    // через CredRead без Hello-проверки. Здесь, сразу после успешной
    // Hello-аутентификации, прозрачно перезаворачиваем ключ в
    // Passport-обёртку и сохраняем обратно в keyring. Если Passport
    // недоступен (legacy-путь), не трогаем запись — пользователь сам
    // выберет, отключить ли Hello или мигрировать вручную.
    if is_legacy_hex && passport_supported() {
        if let Ok(blob) = passport_seal(&request.vault_id, &enc_key, false) {
            if let Ok(e) = entry(&request.vault_id) {
                let _ = e.set_password(&blob);
            }
        }
    }

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

    // Baseline для бэкенд-автоблокировки
    state.inner.touch_activity();

    Ok(VaultUnlockResponse {
        success: true,
        entry_count,
        entries_json,
        is_decoy: false,
    })
}

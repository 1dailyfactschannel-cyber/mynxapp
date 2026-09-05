use std::path::Path;

use crate::vault::types::VaultSession;

/// Load the 16-byte device key.
///
/// SECURITY: device key — второй фактор («привязка к машине»), и его
/// компрометация вместе с vault-файлом позволяет офлайн-перебор пароля.
/// Раньше device key лежал открытым текстом рядом с vault (`.safepass.dk`).
/// Теперь основной путь — Windows Credential Manager через keyring crate
/// (тот же keyring, что и для biometry): запись в `HKCU` под `mynx` с
/// DACL, недоступным другим пользователям. Файл `.safepass.dk` остаётся
/// как fallback для portable-сценариев (если keyring недоступен —
/// например, на Linux/macOS или при сбое Credential Manager).
pub fn load_device_key(vault_path: &Path) -> Result<[u8; 16], String> {
    // Keyring — основной путь. Имя записи привязано к абсолютному пути
    // vault-файла: один keyring-неймспейс `mynx`, аккаунт — `dk/<path-hash>`.
    if let Ok(arr) = load_device_key_from_keyring(vault_path) {
        return Ok(arr);
    }
    // Fallback: открытый файл. НЕ ошибка — на portable-сборках keyring
    // может быть недоступен.
    load_device_key_from_file(vault_path)
}

#[cfg(target_os = "windows")]
fn keyring_account_for_vault(vault_path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // Хеш пути вместо самого пути: keyring-аккаунты не должны содержать
    // длинные пути с обратными слэшами, плюс хеш ограничивает утечку
    // информации о расположении vault в дампах Credential Manager.
    let mut hasher = DefaultHasher::new();
    vault_path.hash(&mut hasher);
    format!("dk/{:016x}", hasher.finish())
}

#[cfg(target_os = "windows")]
fn load_device_key_from_keyring(vault_path: &Path) -> Result<[u8; 16], String> {
    let account = keyring_account_for_vault(vault_path);
    let entry = keyring::Entry::new("mynx", &account).map_err(|e| e.to_string())?;
    let stored = entry.get_password().map_err(|e| e.to_string())?;
    let dk_bytes = hex_decode(&stored).map_err(|_| "Device keyring value invalid".to_string())?;
    if dk_bytes.len() != 16 {
        return Err("Device keyring value wrong size".to_string());
    }
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&dk_bytes);
    Ok(arr)
}

#[cfg(not(target_os = "windows"))]
fn load_device_key_from_keyring(_vault_path: &Path) -> Result<[u8; 16], String> {
    Err("keyring not available on this platform".to_string())
}

fn load_device_key_from_file(vault_path: &Path) -> Result<[u8; 16], String> {
    let dk_path = vault_path.with_extension("safepass.dk");
    if !dk_path.exists() {
        return Err("Device key not found. Create vault first.".to_string());
    }
    let dk_bytes = std::fs::read(&dk_path).map_err(|e| e.to_string())?;
    if dk_bytes.len() != 16 {
        return Err("Invalid device key file".to_string());
    }
    let mut arr = [0u8; 16];
    arr.copy_from_slice(&dk_bytes);
    Ok(arr)
}

pub(crate) fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) {
        return Err("bad hex".to_string());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let h = (hex_nibble(bytes[i])? << 4) | hex_nibble(bytes[i + 1])?;
        out.push(h);
        i += 2;
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Result<u8, String> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err("bad hex".to_string()),
    }
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(target_os = "windows")]
pub(crate) fn store_device_key(vault_path: &Path, dk: &[u8; 16]) {
    if let Ok(entry) = keyring::Entry::new("mynx", &keyring_account_for_vault(vault_path)) {
        let _ = entry.set_password(&hex_encode(dk));
    }
}

/// Copy (encryption_key, payload_key, is_decoy) of the live session if it belongs to this vault
pub fn session_keys(
    state: &super::AppState,
    vault_id: &str,
) -> Result<([u8; 32], [u8; 32], bool), String> {
    let session = state.inner.vault_session.lock().unwrap();
    match session.as_ref() {
        Some(s) if s.vault_id == vault_id => Ok((s.encryption_key, s.payload_key, s.is_decoy)),
        Some(_) => Err("Another vault is unlocked".to_string()),
        None => Err("Vault is locked".to_string()),
    }
}

/// Кэшированный секрет аппаратного ключа текущей сессии (None — ключ не используется)
pub(crate) fn cached_hw_secret(state: &super::AppState) -> Option<[u8; 32]> {
    *state.inner.hw_key_secret.lock().unwrap()
}

pub fn count_entries(entries_json: &str) -> u32 {
    serde_json::from_str::<serde_json::Value>(entries_json)
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len() as u32))
        .unwrap_or(0)
}

/// Re-export VaultSession, чтобы доменные модули не лазили в vault::types напрямую.
pub(crate) type Session = VaultSession;

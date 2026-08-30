use tauri::State;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use zeroize::Zeroize;

use crate::crypto::{
    Aes256GcmAead, CryptoModule, KdfParams, XChaCha20Aead, derive_encryption_key_hw, derive_key,
};
use crate::vault::operations::{
    active_payload, build_export, create_vault, decrypt_entries,
    disable_hw_key_with_secret, enable_hw_key, find_hw_keyfile, load_vault_file,
    open_vault,
    open_vault_any, read_hw_keyfile, remove_decoy, save_entries_to_vault, save_vault_file,
    set_decoy_password,
};
use crate::vault::types::{KdfParamsSerializable, VaultInnerHeader, VaultSession};

pub struct AppState {
    pub inner: Arc<AppStateInner>,
}

pub struct AppStateInner {
    pub vault_session: Mutex<Option<VaultSession>>,
    pub device_key: Mutex<Option<[u8; 16]>>,
    /// Секрет аппаратного ключа (флешка), кэшируется на время сессии
    pub hw_key_secret: Mutex<Option<[u8; 32]>>,
    pub api_token: Mutex<String>,
    /// Ключ защищённого буфера: генерируется на запуск приложения,
    /// живёт только в памяти процесса.
    pub secure_clip_key: [u8; 32],
    /// Зашифрованное содержимое защищённого буфера (слепое копирование).
    /// В глобальный буфер обмена секрет не попадает никогда.
    pub secure_clipboard: Mutex<Option<Vec<u8>>>,
    /// Блокировать хранилище и затирать RAM при сворачивании окна в трей.
    pub lock_on_hide: Mutex<bool>,
    /// AppHandle для нативного pairing-диалога из IPC-потока.
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Ключи доверенных IPC-клиентов. Только в памяти: сброс при рестарте
    /// приложения или смене хранилища.
    pub ipc_pair_keys: Mutex<std::collections::HashSet<String>>,
    /// Идёт pairing-диалог (максимум один одновременно).
    pub pairing_active: Mutex<bool>,
    /// Язык UI ("en"/"ru") — фронт синхронизирует для нативных диалогов.
    pub language: Mutex<String>,
    /// Счётчики неудачных попыток разблокировки (per vault, только в памяти).
    pub unlock_attempts: crate::ratelimit::AttemptTrackerMap,
    /// Счётчик неудачной аутентификации на локальном HTTP API.
    pub api_attempts: crate::ratelimit::AttemptTrackerMap,
    /// Поколение таймера очистки буфера: новый clipboard_set_secure
    /// отменяет предыдущий таймер, увеличивая счётчик.
    pub clipboard_generation: Mutex<u64>,
}

impl AppState {
    pub fn new() -> Self {
        let mut secure_clip_key = [0u8; 32];
        getrandom::getrandom(&mut secure_clip_key).expect("random");
        Self {
            inner: Arc::new(AppStateInner {
                vault_session: Mutex::new(None),
                device_key: Mutex::new(None),
                hw_key_secret: Mutex::new(None),
                api_token: Mutex::new(generate_api_token()),
                secure_clip_key,
                secure_clipboard: Mutex::new(None),
                lock_on_hide: Mutex::new(true),
                app_handle: Mutex::new(None),
                ipc_pair_keys: Mutex::new(std::collections::HashSet::new()),
                pairing_active: Mutex::new(false),
                language: Mutex::new("en".to_string()),
                unlock_attempts: crate::ratelimit::AttemptTrackerMap::new(),
                api_attempts: crate::ratelimit::AttemptTrackerMap::new(),
                clipboard_generation: Mutex::new(0),
            }),
        }
    }

    pub fn clone_inner(&self) -> Arc<AppStateInner> {
        self.inner.clone()
    }
}

fn generate_api_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("random");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/* ------------------------------------------------------------------ */
/* Реестр путей keyfile (hw-ключ на любом пути: флешка или ПК)          */
/* ------------------------------------------------------------------ */

fn hw_registry_file() -> Result<std::path::PathBuf, String> {
    let base = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .to_path_buf();
    Ok(base.join("vaults").join("hwkeys.json"))
}

fn hw_registry_load() -> std::collections::HashMap<String, String> {
    let Ok(path) = hw_registry_file() else {
        return std::collections::HashMap::new();
    };
    std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn hw_registry_save(map: &std::collections::HashMap<String, String>) {
    if let Ok(path) = hw_registry_file() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(map) {
            let _ = std::fs::write(&path, bytes);
        }
    }
}

/// Поиск keyfile: явный путь → реестр → скан корней дисков.
fn resolve_hw_keyfile(
    keyfile_id: &str,
    explicit: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    if let Some(p) = explicit {
        let path = std::path::PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
        return Err("hw_key_not_found".to_string());
    }

    let registry = hw_registry_load();
    if let Some(p) = registry.get(keyfile_id) {
        let path = std::path::PathBuf::from(p);
        if path.is_file() {
            return Ok(path);
        }
    }

    find_hw_keyfile(keyfile_id).map_err(|_| "hw_key_not_found".to_string())
}

fn hw_registry_remember(keyfile_id: &str, path: &Path) {
    let mut reg = hw_registry_load();
    reg.insert(
        keyfile_id.to_string(),
        path.to_string_lossy().to_string(),
    );
    hw_registry_save(&reg);
}

fn hw_registry_forget(keyfile_id: &str) {
    let mut reg = hw_registry_load();
    if reg.remove(keyfile_id).is_some() {
        hw_registry_save(&reg);
    }
}

#[derive(Serialize, Deserialize)]
pub struct VaultCreateRequest {
    pub name: String,
    pub path: String,
    pub master_password: String,
}

#[derive(Serialize, Deserialize)]
pub struct VaultUnlockRequest {
    pub vault_id: String,
    pub master_password: String,
    /// Необязательный явный путь к keyfile (если реестр и скан дисков не нашли)
    #[serde(default)]
    pub keyfile_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct VaultIdRequest {
    pub vault_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct SaveEntriesRequest {
    pub vault_id: String,
    pub entries_json: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChangePasswordRequest {
    pub vault_id: String,
    pub old_password: String,
    pub new_password: String,
}

#[derive(Serialize, Deserialize)]
pub struct ExportRequest {
    pub vault_id: String,
    pub master_password: String,
}

#[derive(Serialize, Deserialize)]
pub struct VaultCreateResponse {
    pub vault_id: String,
    pub success: bool,
}

#[derive(Serialize, Deserialize)]
pub struct VaultUnlockResponse {
    pub success: bool,
    pub entry_count: u32,
    pub entries_json: String,
    /// true — открыт ложный слой (введён ложный пароль)
    pub is_decoy: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SetDecoyPasswordRequest {
    pub vault_id: String,
    pub master_password: String,
    pub decoy_password: String,
    pub old_decoy_password: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct RemoveDecoyRequest {
    pub vault_id: String,
    pub master_password: String,
}

#[derive(Serialize, Deserialize)]
pub struct EnableHwKeyRequest {
    pub vault_id: String,
    pub master_password: String,
    /// Папка на флешке, куда записать keyfile
    pub directory: String,
    /// Ложный пароль — чтобы сохранить приманку при перепривязке к hw-ключу
    pub decoy_password: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct DisableHwKeyRequest {
    pub vault_id: String,
    pub master_password: String,
    pub decoy_password: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct EnableHwKeyResponse {
    pub keyfile_path: String,
}

#[derive(Serialize, Deserialize)]
pub struct HwKeyStatusResponse {
    pub enabled: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ExportResponse {
    pub path: String,
    pub cancelled: bool,
}

/// Load the 16-byte device key stored next to the vault file
pub(crate) fn load_device_key(vault_path: &Path) -> Result<[u8; 16], String> {
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

/// Copy (encryption_key, payload_key, is_decoy) of the live session if it belongs to this vault
pub(crate) fn session_keys(state: &AppState, vault_id: &str) -> Result<([u8; 32], [u8; 32], bool), String> {
    let session = state.inner.vault_session.lock().unwrap();
    match session.as_ref() {
        Some(s) if s.vault_id == vault_id => Ok((s.encryption_key, s.payload_key, s.is_decoy)),
        Some(_) => Err("Another vault is unlocked".to_string()),
        None => Err("Vault is locked".to_string()),
    }
}

/// Кэшированный секрет аппаратного ключа текущей сессии (None — ключ не используется)
fn cached_hw_secret(state: &AppState) -> Option<[u8; 32]> {
    *state.inner.hw_key_secret.lock().unwrap()
}

pub(crate) fn count_entries(entries_json: &str) -> u32 {
    serde_json::from_str::<serde_json::Value>(entries_json)
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len() as u32))
        .unwrap_or(0)
}

#[tauri::command]
pub async fn vault_create(
    request: VaultCreateRequest,
    state: State<'_, AppState>,
) -> Result<VaultCreateResponse, String> {
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
    ).map_err(|e| e.to_string())?;

    // Ensure directory exists
    std::fs::create_dir_all(&vaults_dir).map_err(|e| e.to_string())?;

    // Save vault to file
    let vault_path = vaults_dir.join(format!("{}.safepass", request.name));
    let vault_bytes = serde_json::to_vec(&vault).map_err(|e| e.to_string())?;
    std::fs::write(&vault_path, &vault_bytes).map_err(|e| e.to_string())?;

    // Save device key next to vault file
    let dk_path = vault_path.with_extension("safepass.dk");
    std::fs::write(&dk_path, &device_key).map_err(|e| e.to_string())?;

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

    let vault_path = std::path::Path::new(&request.vault_id);
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
            let kf_path = resolve_hw_keyfile(
                &info.keyfile_id,
                request.keyfile_path.as_deref(),
            )?;
            let secret = read_hw_keyfile(&kf_path, &info.keyfile_id, &device_key)
                .map_err(|_| "hw_key_invalid".to_string())?;
            // Запоминаем путь, чтобы не искать в следующий раз
            hw_registry_remember(&info.keyfile_id, &kf_path);
            Some(secret)
        }
        None => None,
    };

    // Пароль может открыть настоящий слой или ложный — пробуем оба
    let mut session = match open_vault_any(&vault,
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
    ).map_err(|e| e.to_string())?;
    let entry_count = count_entries(&entries_json);
    let is_decoy = session.is_decoy;

    {
        let mut s = state.inner.vault_session.lock().unwrap();
        *s = Some(session);
        let mut hw = state.inner.hw_key_secret.lock().unwrap();
        *hw = hw_secret;
    }

    Ok(VaultUnlockResponse {
        success: true,
        entry_count,
        entries_json,
        is_decoy,
    })
}

/// Мгновенная очистка всех секретов из памяти процесса:
/// ключи сессии затираются на месте, защищённый буфер и кэш
/// hw-ключа — тоже. Используется при блокировке, сворачивании
/// окна в трей и завершении приложения.
pub fn wipe_secrets(inner: &AppStateInner) {
    let mut session = inner.vault_session.lock().unwrap();
    if let Some(s) = session.as_mut() {
        s.encryption_key.zeroize();
        s.payload_key.zeroize();
    }
    *session = None;

    let mut clip = inner.secure_clipboard.lock().unwrap();
    if let Some(c) = clip.as_mut() {
        c.zeroize();
    }
    *clip = None;

    let mut hw = inner.hw_key_secret.lock().unwrap();
    if let Some(k) = hw.as_mut() {
        k.zeroize();
    }
    *hw = None;
}

#[tauri::command]
pub async fn vault_lock(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    wipe_secrets(&state.inner);
    crate::clipboard::clear_clipboard(&app, &state.inner);
    Ok(())
}

/// Переключатель «блокировать при сворачивании в трей» (настройки UI).
#[tauri::command]
pub async fn set_lock_on_hide(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    *state.inner.lock_on_hide.lock().unwrap() = enabled;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Слепое копирование: защищённый буфер внутри приложения              */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
pub struct SecureCopyRequest {
    pub text: String,
}

/// Положить секрет в защищённый буфер: шифруется AES-256-GCM ключом,
/// который живёт только в памяти процесса. Глобальный буфер обмена
/// не используется вообще.
#[tauri::command]
pub async fn secure_copy(
    request: SecureCopyRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ciphertext = Aes256GcmAead::encrypt(&state.inner.secure_clip_key, request.text.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut clip = state.inner.secure_clipboard.lock().unwrap();
    *clip = Some(ciphertext);
    Ok(())
}

/// Вставка из защищённого буфера: расшифровка в памяти и прямой ввод
/// через SendInput, минуя глобальный буфер. Буфер одноразовый —
/// после вставки очищается.
#[tauri::command]
pub async fn secure_paste(state: State<'_, AppState>) -> Result<(), String> {
    let ciphertext = {
        let mut clip = state.inner.secure_clipboard.lock().unwrap();
        clip.take()
    };
    let Some(ciphertext) = ciphertext else {
        return Err("secure_buffer_empty".to_string());
    };

    let plaintext = Aes256GcmAead::decrypt(&state.inner.secure_clip_key, &ciphertext)
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8(plaintext).map_err(|e| e.to_string())?;

    crate::auto_type::wait_for_modifiers_released();
    std::thread::sleep(std::time::Duration::from_millis(500));
    crate::auto_type::type_text(&text)
}

/// Есть ли что вставлять (для UI-индикатора)
#[tauri::command]
pub async fn secure_copy_available(state: State<'_, AppState>) -> Result<bool, String> {
    let clip = state.inner.secure_clipboard.lock().unwrap();
    Ok(clip.is_some())
}

#[tauri::command]
pub async fn check_vault_unlocked(state: State<'_, AppState>) -> Result<bool, String> {
    let session = state.inner.vault_session.lock().unwrap();
    Ok(session.is_some())
}

#[tauri::command]
pub async fn get_api_token(state: State<'_, AppState>) -> Result<String, String> {
    let token = state.inner.api_token.lock().unwrap();
    Ok(token.clone())
}

/// Язык UI для нативных диалогов (pairing), вызывается фронтом при смене языка.
#[tauri::command]
pub async fn set_app_language(lang: String, state: State<'_, AppState>) -> Result<(), String> {
    let normalized = if lang == "ru" { "ru" } else { "en" };
    *state.inner.language.lock().unwrap() = normalized.to_string();
    Ok(())
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
    Ok(device_key.iter().map(|b| format!("{:02x}", b)).collect())
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
    if request.new_password.len() < 8 {
        return Err("password_too_short".to_string());
    }

    session_keys(&state, &request.vault_id)
        .and_then(|(_, _, is_decoy)| {
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
    let old_session = open_vault(&vault, &request.old_password, &device_key, cached_hw_secret(&state).as_ref())
        .map_err(|_| "wrong_password".to_string())?;

    // Fresh salt → new primary key → new encryption key (same device key)
    let new_salt = CryptoModule::generate_salt().map_err(|e| e.to_string())?;
    let kdf_params = KdfParams::default();
    let new_primary = derive_key(
        request.new_password.as_bytes(),
        &new_salt,
        &kdf_params,
    ).map_err(|e| e.to_string())?;
    let new_enc_key = derive_encryption_key_hw(
        &new_primary,
        &device_key,
        cached_hw_secret(&state).as_ref(),
        b"safepass-v1-enc-key",
    ).map_err(|e| e.to_string())?;

    // Re-encrypt the inner header with the new key
    let decrypted_header = XChaCha20Aead::decrypt(
        &old_session.encryption_key,
        &vault.header.encrypted_header,
    ).map_err(|e| e.to_string())?;
    let mut inner: VaultInnerHeader = serde_json::from_slice(&decrypted_header)
        .map_err(|e| e.to_string())?;
    inner.modified_at = chrono::Utc::now().timestamp();
    let header_bytes = serde_json::to_vec(&inner).map_err(|e| e.to_string())?;
    vault.header.encrypted_header = XChaCha20Aead::encrypt(&new_enc_key, &header_bytes)
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

    Ok(())
}

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
    if request.decoy_password.len() < 8 {
        return Err("password_too_short".to_string());
    }

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

    remove_decoy(&mut vault, &request.master_password, &device_key, cached_hw_secret(&state).as_ref())
        .map_err(|_| "wrong_password".to_string())?;

    save_vault_file(vault_path, &vault).map_err(|e| e.to_string())
}


/* ------------------------------------------------------------------ */
/* Аппаратный ключ (флешка)                                             */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
pub struct DecoyStatusResponse {
    pub enabled: bool,
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
    let decrypted = XChaCha20Aead::decrypt(&enc_key, &vault.header.encrypted_header)
        .map_err(|e| e.to_string())?;
    let inner: VaultInnerHeader = serde_json::from_slice(&decrypted).map_err(|e| e.to_string())?;
    Ok(DecoyStatusResponse {
        enabled: inner.decoy_enabled,
    })
}

/// Включён ли аппаратный ключ у vault (по открытым метаданным заголовка)
#[tauri::command]
pub async fn vault_hw_key_status(request: VaultIdRequest) -> Result<HwKeyStatusResponse, String> {
    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }
    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;
    Ok(HwKeyStatusResponse {
        enabled: vault.header.hw_key.is_some(),
    })
}

/// Включить аппаратный ключ: записывает keyfile на флешку и
/// перепривязывает vault к паролю + флешке.
#[tauri::command]
pub async fn vault_enable_hw_key(
    request: EnableHwKeyRequest,
    state: State<'_, AppState>,
) -> Result<EnableHwKeyResponse, String> {
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

    let key_dir = Path::new(&request.directory);
    let kf_path = enable_hw_key(
        &mut vault,
        &request.master_password,
        &device_key,
        key_dir,
        request.decoy_password.as_deref(),
    )
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("hw_key_already_enabled") {
            "hw_key_already_enabled".to_string()
        } else {
            "wrong_password".to_string()
        }
    })?;

    save_vault_file(vault_path, &vault).map_err(|e| e.to_string())?;

    // Текущая сессия продолжает жить: кэшируем свежий hw-секрет
    // и запоминаем путь к keyfile (любая папка: флешка или ПК)
    let info = vault.header.hw_key.as_ref().unwrap();
    if let Ok(secret) = read_hw_keyfile(&kf_path, &info.keyfile_id, &device_key) {
        let mut hw = state.inner.hw_key_secret.lock().unwrap();
        *hw = Some(secret);
    }
    hw_registry_remember(&info.keyfile_id, &kf_path);

    Ok(EnableHwKeyResponse {
        keyfile_path: kf_path.to_string_lossy().to_string(),
    })
}

/// Отключить аппаратный ключ (нужны мастер-пароль и вставленная флешка).
#[tauri::command]
pub async fn vault_disable_hw_key(
    request: DisableHwKeyRequest,
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

    // Секрет читаем из keyfile (реестр/скан дисков), затем отвязываем vault
    let info = vault
        .header
        .hw_key
        .clone()
        .ok_or("hw_key_not_enabled".to_string())?;
    let kf_path = resolve_hw_keyfile(&info.keyfile_id, None)?;
    let secret = read_hw_keyfile(&kf_path, &info.keyfile_id, &device_key)
        .map_err(|_| "hw_key_invalid".to_string())?;

    disable_hw_key_with_secret(
        &mut vault,
        &request.master_password,
        &device_key,
        &secret,
        request.decoy_password.as_deref(),
    )
    .map_err(|_| "wrong_password".to_string())?;

    save_vault_file(vault_path, &vault).map_err(|e| e.to_string())?;

    hw_registry_forget(&info.keyfile_id);
    let mut hw = state.inner.hw_key_secret.lock().unwrap();
    *hw = None;
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
    let export_session = open_vault(&vault, &request.master_password, &device_key, cached_hw_secret(&state).as_ref())
        .map_err(|_| "wrong_password".to_string())?;

    let entries_json = decrypt_entries(&export_session.payload_key, &vault.payload)
        .map_err(|e| e.to_string())?;
    let export_bytes = build_export(&entries_json, &request.master_password)
        .map_err(|e| e.to_string())?;

    let default_name = format!(
        "mynx-backup-{}.spbackup",
        chrono::Utc::now().format("%Y-%m-%d")
    );

    let Some(target_path) = pick_save_path(
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

#[derive(Deserialize)]
pub struct BackupRequest {
    pub vault_id: String,
    pub backup_path: String,
    pub keep_count: usize,
}

/// Copy the vault file and its device key to the backup folder.
/// No master password needed: we back up the already-encrypted files.
#[tauri::command]
pub async fn vault_backup(request: BackupRequest, state: State<'_, AppState>) -> Result<(), String> {
    session_keys(&state, &request.vault_id)?;

    let vault_path = Path::new(&request.vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }

    let backup_dir = Path::new(&request.backup_path);
    std::fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;

    let vault_name = vault_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("vault");
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");

    let backup_vault_path = backup_dir.join(format!("{}-{}.safepass", vault_name, timestamp));
    let backup_dk_path = backup_dir.join(format!("{}-{}.safepass.dk", vault_name, timestamp));

    std::fs::copy(vault_path, &backup_vault_path).map_err(|e| e.to_string())?;

    let dk_path = vault_path.with_extension("safepass.dk");
    if dk_path.exists() {
        std::fs::copy(&dk_path, &backup_dk_path).map_err(|e| e.to_string())?;
    }

    // Удаляем старые бэкапы сверх keep_count
    let mut backups: Vec<_> = std::fs::read_dir(backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|e| e.to_str()) == Some("safepass") {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    backups.sort_by(|a, b| {
        let a_time = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let b_time = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });

    for old in backups.iter().skip(request.keep_count) {
        let _ = std::fs::remove_file(old);
        let _ = std::fs::remove_file(old.with_extension("safepass.dk"));
    }

    Ok(())
}

#[derive(Deserialize)]
pub struct SavePngRequest {
    pub default_name: String,
    pub bytes: Vec<u8>,
}

/// Save bytes to a user-picked location via the native Save dialog.
/// Used for files generated in the webview (QR-code PNG): the embedded
/// WebView2 does not process <a download> clicks, so saving goes through Rust.
#[tauri::command]
pub async fn save_png_file(request: SavePngRequest) -> Result<ExportResponse, String> {
    let Some(target_path) = pick_save_path(
        &request.default_name,
        "Mynx - Save PNG",
        "PNG Image",
        "png",
    ) else {
        return Ok(ExportResponse {
            path: String::new(),
            cancelled: true,
        });
    };

    std::fs::write(&target_path, &request.bytes).map_err(|e| e.to_string())?;

    Ok(ExportResponse {
        path: target_path.to_string_lossy().to_string(),
        cancelled: false,
    })
}

/// Native Windows "Save as" dialog. Returns None when the user cancels.
#[cfg(target_os = "windows")]
fn pick_save_path(
    default_name: &str,
    title: &str,
    filter_label: &str,
    filter_ext: &str,
) -> Option<std::path::PathBuf> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Controls::Dialogs::{
        GetSaveFileNameW, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    let mut file_buf = vec![0u16; 1024];
    let default_wide: Vec<u16> = default_name.encode_utf16().collect();
    file_buf[..default_wide.len()].copy_from_slice(&default_wide);

    let filter_wide: Vec<u16> = format!(
        "{} (*.{})\0*.{}\0All Files (*.*)\0*.*\0\0",
        filter_label, filter_ext, filter_ext
    )
    .encode_utf16()
    .collect();
    let title_wide: Vec<u16> = format!("{}\0", title).encode_utf16().collect();
    let def_ext: Vec<u16> = format!("{}\0", filter_ext).encode_utf16().collect();

    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: PCWSTR(filter_wide.as_ptr()),
        lpstrFile: PWSTR(file_buf.as_mut_ptr()),
        nMaxFile: file_buf.len() as u32,
        lpstrTitle: PCWSTR(title_wide.as_ptr()),
        lpstrDefExt: PCWSTR(def_ext.as_ptr()),
        Flags: OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        ..Default::default()
    };

    let ok = unsafe { GetSaveFileNameW(&mut ofn) };
    if !ok.as_bool() {
        return None; // user cancelled
    }

    let len = file_buf
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(file_buf.len());
    Some(std::path::PathBuf::from(String::from_utf16_lossy(
        &file_buf[..len],
    )))
}

/// Non-Windows fallback: save next to the executable without a dialog.
#[cfg(not(target_os = "windows"))]
fn pick_save_path(
    default_name: &str,
    _title: &str,
    _filter_label: &str,
    _filter_ext: &str,
) -> Option<std::path::PathBuf> {
    let base = std::env::current_exe().ok()?.parent()?.to_path_buf();
    Some(base.join(default_name))
}

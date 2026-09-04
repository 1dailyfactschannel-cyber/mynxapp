use crate::crypto::{
    KdfParams, derive_key, Aes256GcmAead, XChaCha20Aead, CryptoModule,
    derive_encryption_key, derive_encryption_key_hw,
};
use crate::vault::types::*;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

/* ------------------------------------------------------------------ */
/* AAD-привязка (v2)                                                    */
/* ------------------------------------------------------------------ */

/// AAD v2: каждый шифротекст привязан к своей роли в формате файла, поэтому
/// блок нельзя пересадить между заголовком, payload, ложным слотом и
/// keyfile — AEAD-проверка не пройдёт. Файлы, записанные до этого изменения,
/// использовали пустой AAD: расшифровка сначала пробует v2, затем падает
/// обратно на legacy-блок без AAD (обратная совместимость).
pub const AAD_HEADER_V2: &[u8] = b"mynx:v2:header";
pub const AAD_PAYLOAD_V2: &[u8] = b"mynx:v2:payload";
pub const AAD_DECOY_HEADER_V2: &[u8] = b"mynx:v2:decoy-header";
pub const AAD_EXPORT_V2: &[u8] = b"mynx:v2:export";
pub const AAD_HW_KEYFILE_V2: &[u8] = b"mynx:v2:hw-keyfile";

/// Расшифровка XChaCha-блока: сначала новый формат (AAD v2), затем legacy.
pub(crate) fn x_decrypt_v2_or_legacy(key: &[u8; 32], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    XChaCha20Aead::decrypt_with_aad(key, ciphertext, aad)
        .or_else(|_| XChaCha20Aead::decrypt(key, ciphertext))
}

/// Расшифровка AES-256-GCM блока: сначала новый формат (AAD v2), затем legacy.
pub(crate) fn aes_decrypt_v2_or_legacy(key: &[u8; 32], ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    Aes256GcmAead::decrypt_with_aad(key, ciphertext, aad)
        .or_else(|_| Aes256GcmAead::decrypt(key, ciphertext))
}

/* ------------------------------------------------------------------ */
/* Сериализация записи vault-файла                                      */
/* ------------------------------------------------------------------ */

/// Сериализует ВСЕ записи vault-файла в процессе: последовательность
/// load → modify → save не должна перемешиваться между HTTP API, IPC и
/// потоками UI, иначе одно сохранение молча затирает записи другого.
pub static VAULT_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Create a new vault file
pub fn create_vault(
    _path: &Path,
    master_password: &str,
    device_key: &[u8; 16],
) -> Result<VaultFile> {
    // 1. Generate salt
    let salt = CryptoModule::generate_salt()?;

    // 2. Derive primary key from password + salt
    let kdf_params = KdfParams::default();
    let primary_key = derive_key(
        master_password.as_bytes(),
        &salt,
        &kdf_params,
    )?;

    // 3. Derive encryption key: primary_key + device_key → HKDF
    let enc_key = derive_encryption_key(
        &primary_key,
        device_key,
        b"safepass-v1-enc-key",
    )?;

    // 4. Generate payload key (random, encrypted with enc_key)
    let payload_key = CryptoModule::generate_random_bytes(32)?;
    let payload_key_arr: [u8; 32] = payload_key.try_into()
        .map_err(|_| anyhow::anyhow!("payload key wrong size"))?;

    // 5. Create inner header
    let now = chrono::Utc::now().timestamp();
    let inner_header = VaultInnerHeader {
        created_at: now,
        modified_at: now,
        entry_count: 0,
        payload_key: payload_key_arr,
        decoy_enabled: false,
    };

    // 6. Serialize and encrypt inner header with XChaCha20-Poly1305 (outer layer)
    let inner_header_bytes = serde_json::to_vec(&inner_header)?;
    let encrypted_header = XChaCha20Aead::encrypt_with_aad(&enc_key,
        &inner_header_bytes,
        AAD_HEADER_V2,
    )?;

    // 7. Empty entries array encrypted with AES-256-GCM (inner layer, fast)
    let empty_payload = b"[]".to_vec(); // Empty entries JSON array
    let encrypted_payload = Aes256GcmAead::encrypt_with_aad(
        &payload_key_arr,
        &empty_payload,
        AAD_PAYLOAD_V2,
    )?;

    // 8. Build vault file
    let mut vault = VaultFile::new(
        salt,
        KdfParamsSerializable::from(&kdf_params),
        encrypted_header,
        encrypted_payload,
    );

    // 9. Каждый vault сразу получает "спящий" ложный слот, зашифрованный
    // случайным ключом: снаружи он неотличим от включённого ложного слоя,
    // поэтому наличие deniability-слоя не палится по файлу.
    let (decoy_slot, decoy_payload) = build_dormant_decoy()?;
    vault.header.decoy = Some(decoy_slot);
    vault.decoy_payload = Some(decoy_payload);

    Ok(vault)
}

/// Open (unlock) a vault file.
/// `hw_key` — секрет аппаратного ключа (флешка); обязателен, если у vault
/// включён hw-ключ, иначе должен быть None.
pub fn open_vault(
    vault: &VaultFile,
    master_password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
) -> Result<VaultSession> {
    if !vault.verify() {
        return Err(anyhow::anyhow!("invalid vault file"));
    }
    if vault.header.hw_key.is_some() && hw_key.is_none() {
        return Err(anyhow::anyhow!("hw_key_required"));
    }

    // 1. Derive primary key from password + salt
    let kdf_params: KdfParams = vault.header.kdf_params.clone().into();
    let primary_key = derive_key(
        master_password.as_bytes(),
        &vault.header.salt,
        &kdf_params,
    )?;

    // 2. Derive encryption key
    let enc_key = derive_encryption_key_hw(
        &primary_key,
        device_key,
        hw_key,
        b"safepass-v1-enc-key",
    )?;

    // 3. Decrypt inner header with XChaCha20
    let decrypted_header = x_decrypt_v2_or_legacy(
        &enc_key,
        &vault.header.encrypted_header,
        AAD_HEADER_V2,
    )?;
    let inner_header: VaultInnerHeader = serde_json::from_slice(&decrypted_header)?;

    // 4. Create session
    let session = VaultSession::new(
        "vault-1".to_string(),
        enc_key,
        inner_header.payload_key,
    );

    Ok(session)
}

/// SECURITY: KDF-миграция при unlock. Если у открытого vault параметры
/// слабее текущего `KdfParams::default()` (например, файл создан на старой
/// версии с 16 MB / 3 iter), после успешной проверки пароля перешифровываем
/// заголовок со свежей солью и актуальными параметрами.
///
/// Это НЕ меняет мастер-пароль — только salt и Argon2-параметры.
/// Заголовок расшифровывается старым ключом, шифруется заново
/// производным от нового KDF; payload остаётся нетронутым (его ключ
/// лежит внутри зашифрованного inner header и не зависит от KDF).
///
/// Возвращает `Ok(true)` если миграция выполнена (вызывающий должен
/// атомарно записать vault на диск), `Ok(false)` если параметры уже
/// актуальны.
pub fn migrate_kdf_if_needed(
    vault: &mut VaultFile,
    master_password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
) -> Result<bool> {
    let current: KdfParamsSerializable = (&KdfParams::default()).into();
    let stored: KdfParamsSerializable = vault.header.kdf_params.clone();
    if stored.memory_kb >= current.memory_kb
        && stored.iterations >= current.iterations
        && stored.parallelism >= current.parallelism
    {
        return Ok(false); // уже актуальные (>=) — миграция не нужна
    }

    // Перешифруем с новой солью и новыми параметрами.
    let new_salt = CryptoModule::generate_salt()?;
    let new_params = KdfParams::default();
    let new_primary = derive_key(master_password.as_bytes(), &new_salt, &new_params)?;
    let new_enc = derive_encryption_key_hw(
        &new_primary,
        device_key,
        hw_key,
        b"safepass-v1-enc-key",
    )?;

    // Расшифровываем inner header старым ключом (уже проверенным паролем).
    let old_session = open_vault(vault, master_password, device_key, hw_key)?;
    let decrypted = x_decrypt_v2_or_legacy(
        &old_session.encryption_key,
        &vault.header.encrypted_header,
        AAD_HEADER_V2,
    )?;
    let mut inner: VaultInnerHeader = serde_json::from_slice(&decrypted)?;
    inner.modified_at = chrono::Utc::now().timestamp();

    vault.header.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(&new_enc, &serde_json::to_vec(&inner)?, AAD_HEADER_V2)?;
    vault.header.salt = new_salt;
    vault.header.kdf_params = KdfParamsSerializable::from(&new_params);

    // Ложный слот: при наличии известного decoy-пароля перепривязываем
    // под новый KDF; иначе сбрасываем в "спящий". У нас нет decoy-пароля
    // в этом контексте — консервативно ставим "спящий" слот.
    let (slot, payload) = build_dormant_decoy()?;
    vault.header.decoy = Some(slot);
    vault.decoy_payload = Some(payload);

    Ok(true)
}

/// Try to open the decoy slot with the given password.
fn open_decoy(
    vault: &VaultFile,
    password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
) -> Result<VaultSession> {
    let slot = vault
        .header
        .decoy
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no decoy slot"))?;

    let kdf_params: KdfParams = slot.kdf_params.clone().into();
    let primary_key = derive_key(password.as_bytes(), &slot.salt, &kdf_params)?;
    let enc_key = derive_encryption_key_hw(&primary_key, device_key, hw_key, b"safepass-v1-decoy-key")?;

    let decrypted_header =
        x_decrypt_v2_or_legacy(&enc_key, &slot.encrypted_header, AAD_DECOY_HEADER_V2)?;
    let inner_header: VaultInnerHeader = serde_json::from_slice(&decrypted_header)?;

    let mut session = VaultSession::new("vault-1".to_string(), enc_key, inner_header.payload_key);
    session.is_decoy = true;
    Ok(session)
}

/// Unlock with any password: real slot first, decoy slot second.
/// Returns the session; `session.is_decoy` tells which layer was opened.
pub fn open_vault_any(
    vault: &VaultFile,
    password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
) -> Result<VaultSession> {
    if let Ok(session) = open_vault(vault, password, device_key, hw_key) {
        return Ok(session);
    }
    open_decoy(vault, password, device_key, hw_key)
}

/// The payload that belongs to the active session layer.
pub fn active_payload(vault: &VaultFile, is_decoy: bool) -> &[u8] {
    if is_decoy {
        if let Some(p) = vault.decoy_payload.as_ref() {
            return p;
        }
    }
    &vault.payload
}

/// "Спящий" ложный слот: валидная структура, зашифрованная случайным
/// ключом. Открыть её нельзя ни одним паролем, но по размеру и виду она
/// неотличима от включённого ложного слоя.
pub fn build_dormant_decoy() -> Result<(DecoySlot, Vec<u8>)> {
    let random_key: [u8; 32] = CryptoModule::generate_random_bytes(32)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("random key wrong size"))?;
    build_decoy_slot_with_key(&random_key, &generate_fake_entries())
}

/// Ложный слот, открываемый конкретным паролем.
pub fn build_decoy_slot(
    password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
    entries_json: &str,
) -> Result<(DecoySlot, Vec<u8>)> {
    let salt = CryptoModule::generate_salt()?;
    let kdf_params = KdfParams::default();
    let primary_key = derive_key(password.as_bytes(), &salt, &kdf_params)?;
    let enc_key = derive_encryption_key_hw(&primary_key, device_key, hw_key, b"safepass-v1-decoy-key")?;

    let (mut slot, payload) = build_decoy_slot_with_key(&enc_key, entries_json)?;
    slot.salt = salt;
    slot.kdf_params = KdfParamsSerializable::from(&kdf_params);
    Ok((slot, payload))
}

/// Общая сборка ложного слота: свежий payload key, заголовок и записи,
/// зашифрованные переданным ключом.
fn build_decoy_slot_with_key(enc_key: &[u8; 32], entries_json: &str) -> Result<(DecoySlot, Vec<u8>)> {
    let payload_key: [u8; 32] = CryptoModule::generate_random_bytes(32)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("payload key wrong size"))?;

    let now = chrono::Utc::now().timestamp();
    let inner_header = VaultInnerHeader {
        created_at: now,
        modified_at: now,
        entry_count: count_json_array(entries_json),
        payload_key,
        decoy_enabled: false,
    };
    let encrypted_header =
        XChaCha20Aead::encrypt_with_aad(enc_key, &serde_json::to_vec(&inner_header)?, AAD_DECOY_HEADER_V2)?;
    let encrypted_payload = encrypt_entries(&payload_key, entries_json)?;

    Ok((
        DecoySlot {
            salt: CryptoModule::generate_salt()?,
            kdf_params: KdfParamsSerializable::from(&KdfParams::default()),
            encrypted_header,
        },
        encrypted_payload,
    ))
}

/// Включить/переустановить ложный слой. `master_password` обязан быть
/// настоящим — управлять ложным слоем из ложной сессии нельзя.
/// Если задан `old_decoy_password` и он открывает текущий слот, ложные
/// записи сохраняются; иначе генерируется свежий правдоподобный набор.
pub fn set_decoy_password(
    vault: &mut VaultFile,
    master_password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
    decoy_password: &str,
    old_decoy_password: Option<&str>,
) -> Result<()> {
    // Только настоящий пароль даёт право менять ложный слой
    let session = open_vault(vault, master_password, device_key, hw_key)?;

    if master_password == decoy_password {
        return Err(anyhow::anyhow!("decoy password must differ from master password"));
    }

    let entries_json = old_decoy_password
        .and_then(|old| open_decoy(vault, old, device_key, hw_key).ok())
        .and_then(|s| decrypt_entries(&s.payload_key, active_payload(vault, true)).ok())
        .unwrap_or_else(generate_fake_entries);

    let (slot, payload) = build_decoy_slot(decoy_password, device_key, hw_key, &entries_json)?;
    vault.header.decoy = Some(slot);
    vault.decoy_payload = Some(payload);

    // Сохраняем флаг в зашифрованном реальном заголовке — видно только при разблокировке
    update_decoy_enabled(vault, &session.encryption_key, true)?;

    Ok(())
}

/// Отключить ложный слой: слот заменяется на "спящий" (случайный ключ).
pub fn remove_decoy(
    vault: &mut VaultFile,
    master_password: &str,
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
) -> Result<()> {
    let session = open_vault(vault, master_password, device_key, hw_key)?;
    let (slot, payload) = build_dormant_decoy()?;
    vault.header.decoy = Some(slot);
    vault.decoy_payload = Some(payload);

    update_decoy_enabled(vault, &session.encryption_key, false)?;
    Ok(())
}

/// Обновить флаг decoy_enabled внутри реального зашифрованного заголовка.
fn update_decoy_enabled(
    vault: &mut VaultFile,
    enc_key: &[u8; 32],
    enabled: bool,
) -> Result<()> {
    let decrypted = x_decrypt_v2_or_legacy(enc_key, &vault.header.encrypted_header, AAD_HEADER_V2)?;
    let mut inner: VaultInnerHeader = serde_json::from_slice(&decrypted)?;
    inner.decoy_enabled = enabled;
    inner.modified_at = chrono::Utc::now().timestamp();
    vault.header.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(enc_key, &serde_json::to_vec(&inner)?, AAD_HEADER_V2)?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Аппаратный ключ (флешка с keyfile)                                   */
/* ------------------------------------------------------------------ */

pub const HW_KEYFILE_MAGIC: &str = "MYNX-HWKEY";

#[derive(Serialize, Deserialize)]
struct HwKeyFile {
    magic: String,
    id: String,
    /// LEGACY: открытый hex-секрет (читаем старые keyfile, больше не пишем)
    #[serde(default)]
    secret: Option<String>,
    /// Зашифрованный секрет: hex(XChaCha20-Poly1305(wrap_key, secret))
    #[serde(default)]
    wrapped: Option<String>,
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return Err(anyhow::anyhow!("bad hex"));
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| anyhow::anyhow!(e.to_string()))
        })
        .collect()
}

/// Ключ обёртки keyfile: HKDF(device_key, salt=keyfile_id).
/// Украденная флешка без device key с ПК секрет не раскрывает.
fn hw_wrap_key(device_key: &[u8; 16], id: &str) -> Result<[u8; 32]> {
    let okm = crate::crypto::derive_hkdf_key(
        id.as_bytes(),
        device_key,
        b"mynx-hwkey-wrap-v1",
        32,
    )?;
    okm.as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("wrap key wrong size"))
}

/// Пометить keyfile скрытым (Windows: hidden+system). Best-effort.
fn hide_file(path: &Path) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::{
            SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
        };
        let name = HSTRING::from(path.as_os_str());
        let _ = SetFileAttributesW(&name, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
}

/// Записать keyfile (зашифрованный, скрытый) в выбранную пользователем папку —
/// флешка или любой путь на ПК.
pub fn write_hw_keyfile(
    dir: &Path,
    id: &str,
    secret: &[u8; 32],
    device_key: &[u8; 16],
) -> Result<std::path::PathBuf> {
    std::fs::create_dir_all(dir)?;
    let wrap_key = hw_wrap_key(device_key, id)?;
    let wrapped = XChaCha20Aead::encrypt_with_aad(&wrap_key, secret, AAD_HW_KEYFILE_V2)?;
    let kf = HwKeyFile {
        magic: HW_KEYFILE_MAGIC.to_string(),
        id: id.to_string(),
        secret: None,
        wrapped: Some(hex_encode(&wrapped)),
    };
    let path = dir.join(format!("mynx-hwkey-{}.key", id));
    std::fs::write(&path, serde_json::to_string_pretty(&kf)?)?;
    hide_file(&path);
    Ok(path)
}

/// Прочитать и проверить keyfile (новый зашифрованный или старый открытый формат)
pub fn read_hw_keyfile(
    path: &Path,
    expected_id: &str,
    device_key: &[u8; 16],
) -> Result<[u8; 32]> {
    let bytes = std::fs::read(path)?;
    let kf: HwKeyFile = serde_json::from_slice(&bytes)?;
    if kf.magic != HW_KEYFILE_MAGIC || kf.id != expected_id {
        return Err(anyhow::anyhow!("invalid keyfile"));
    }

    // Новый формат: секрет зашифрован ключом от device_key
    if let Some(wrapped_hex) = kf.wrapped.as_deref() {
        let wrap_key = hw_wrap_key(device_key, expected_id)?;
        let blob = hex_decode(wrapped_hex)?;
        let secret = x_decrypt_v2_or_legacy(&wrap_key, &blob, AAD_HW_KEYFILE_V2)?;
        return secret
            .as_slice()
            .try_into()
            .map_err(|_| anyhow::anyhow!("keyfile secret wrong size"));
    }

    // LEGACY: открытый hex
    if let Some(secret_hex) = kf.secret.as_deref() {
        let raw = hex_decode(secret_hex)?;
        return raw
            .as_slice()
            .try_into()
            .map_err(|_| anyhow::anyhow!("keyfile secret wrong size"));
    }

    Err(anyhow::anyhow!("invalid keyfile"))
}

/// Поиск keyfile по всем дискам: корень каждой буквы + подпапка mynx-keys.
/// Буква флешки может меняться между подключениями, поэтому сканируем все.
///
/// SECURITY: каждое `is_file()` на отсутствующем/сетевом диске может
/// блокироваться на десятки мс (autorun, AV-скан, сетевой таймаут).
/// 26 букв × 2 пути = 52 синхронных syscall'а. На медленных носителях
/// или заблокированных шарах это легко превращается в секунды ожидания
/// в UI-потоке. Обёртка в `spawn_blocking` + общий таймаут (по умолчанию
/// 3 с) гарантирует, что медленный носитель не подвесит разблокировку.
pub fn find_hw_keyfile(expected_id: &str) -> Result<std::path::PathBuf> {
    find_hw_keyfile_with_timeout(expected_id, std::time::Duration::from_secs(3))
}

pub fn find_hw_keyfile_with_timeout(
    expected_id: &str,
    timeout: std::time::Duration,
) -> Result<std::path::PathBuf> {
    let (tx, rx) = std::sync::mpsc::channel();
    let id = expected_id.to_string();
    std::thread::spawn(move || {
        let result = scan_all_drives(&id);
        let _ = tx.send(result);
    });
    rx.recv_timeout(timeout)
        .unwrap_or(Err(anyhow::anyhow!("hw_key_scan_timeout")))
}

fn scan_all_drives(expected_id: &str) -> Result<std::path::PathBuf> {
    let name = format!("mynx-hwkey-{}.key", expected_id);
    for letter in b'A'..=b'Z' {
        let root = std::path::PathBuf::from(format!("{}:\\", letter as char));
        for candidate in [root.join(&name), root.join("mynx-keys").join(&name)] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(anyhow::anyhow!("hw_key_not_found"))
}

/// Включить аппаратный ключ: генерирует keyfile на флешке и перешифровывает
/// заголовок vault ключом, выведенным из пароля + device key + секрета флешки.
/// Если задан `decoy_password` и он открывает ложный слот — приманка
/// сохраняется и тоже перепривязывается к hw-ключу; иначе слот сбрасывается.
pub fn enable_hw_key(
    vault: &mut VaultFile,
    master_password: &str,
    device_key: &[u8; 16],
    key_dir: &Path,
    decoy_password: Option<&str>,
) -> Result<std::path::PathBuf> {
    if vault.header.hw_key.is_some() {
        return Err(anyhow::anyhow!("hw_key_already_enabled"));
    }
    let session = open_vault(vault, master_password, device_key, None)?;

    let id_bytes = CryptoModule::generate_random_bytes(8)?;
    let keyfile_id = hex_encode(&id_bytes);
    let secret: [u8; 32] = CryptoModule::generate_random_bytes(32)?
        .try_into()
        .map_err(|_| anyhow::anyhow!("hw secret wrong size"))?;

    // Перешифровка реального заголовка с hw-секретом
    let kdf_params: KdfParams = vault.header.kdf_params.clone().into();
    let primary = derive_key(master_password.as_bytes(), &vault.header.salt, &kdf_params)?;
    let new_enc = derive_encryption_key_hw(&primary, device_key, Some(&secret), b"safepass-v1-enc-key")?;
    let decrypted =
        x_decrypt_v2_or_legacy(&session.encryption_key, &vault.header.encrypted_header, AAD_HEADER_V2)?;
    vault.header.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(&new_enc, &decrypted, AAD_HEADER_V2)?;
    vault.header.hw_key = Some(HwKeyInfo {
        keyfile_id: keyfile_id.clone(),
    });

    // Ложный слот: сохранить, если известен ложный пароль, иначе сбросить
    let decoy_entries = decoy_password
        .and_then(|dp| open_decoy(vault, dp, device_key, None).ok())
        .and_then(|s| decrypt_entries(&s.payload_key, active_payload(vault, true)).ok());
    let (slot, payload) = match (decoy_password, decoy_entries) {
        (Some(dp), Some(entries)) => build_decoy_slot(dp, device_key, Some(&secret), &entries)?,
        _ => build_dormant_decoy()?,
    };
    vault.header.decoy = Some(slot);
    vault.decoy_payload = Some(payload);

    write_hw_keyfile(key_dir, &keyfile_id, &secret, device_key)
}

/// Отключить аппаратный ключ. Требует оба фактора: мастер-пароль и
/// вставленную флешку с keyfile.
/// Отключение hw-ключа с уже прочитанным секретом (вынесено для тестов).
pub fn disable_hw_key_with_secret(
    vault: &mut VaultFile,
    master_password: &str,
    device_key: &[u8; 16],
    secret: &[u8; 32],
    decoy_password: Option<&str>,
) -> Result<()> {
    let session = open_vault(vault, master_password, device_key, Some(secret))?;

    // Перешифровка реального заголовка без hw-секрета
    let kdf_params: KdfParams = vault.header.kdf_params.clone().into();
    let primary = derive_key(master_password.as_bytes(), &vault.header.salt, &kdf_params)?;
    let new_enc = derive_encryption_key(&primary, device_key, b"safepass-v1-enc-key")?;
    let decrypted =
        x_decrypt_v2_or_legacy(&session.encryption_key, &vault.header.encrypted_header, AAD_HEADER_V2)?;
    vault.header.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(&new_enc, &decrypted, AAD_HEADER_V2)?;
    vault.header.hw_key = None;

    // Ложный слот: сохранить, если известен ложный пароль, иначе сбросить
    let decoy_entries = decoy_password
        .and_then(|dp| open_decoy(vault, dp, device_key, Some(secret)).ok())
        .and_then(|s| decrypt_entries(&s.payload_key, active_payload(vault, true)).ok());
    let (slot, payload) = match (decoy_password, decoy_entries) {
        (Some(dp), Some(entries)) => build_decoy_slot(dp, device_key, None, &entries)?,
        _ => build_dormant_decoy()?,
    };
    vault.header.decoy = Some(slot);
    vault.decoy_payload = Some(payload);

    Ok(())
}

/// Update decoy inner header (entry_count, modified_at), re-encrypting it
/// with the decoy encryption key. Saturate на разумный предел.
pub fn update_decoy_inner_header(
    vault: &mut VaultFile,
    enc_key: &[u8; 32],
    entry_count: u32,
) -> Result<()> {
    let slot = vault
        .header
        .decoy
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("no decoy slot"))?;
    let decrypted = x_decrypt_v2_or_legacy(enc_key, &slot.encrypted_header, AAD_DECOY_HEADER_V2)?;
    let mut inner: VaultInnerHeader = serde_json::from_slice(&decrypted)?;
    inner.entry_count = entry_count.min(MAX_REASONABLE_ENTRIES);
    inner.modified_at = chrono::Utc::now().timestamp();
    slot.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(enc_key, &serde_json::to_vec(&inner)?, AAD_DECOY_HEADER_V2)?;
    Ok(())
}

fn count_json_array(json: &str) -> u32 {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len() as u32))
        .unwrap_or(0)
}

/* ------------------------------------------------------------------ */
/* Генератор правдоподобных ложных записей                              */
/* ------------------------------------------------------------------ */

/// Минимальный xorshift-ГПСЧ, seeded от getrandom — без лишних зависимостей.
struct XorShift(u64);

impl XorShift {
    fn seeded() -> Result<Self> {
        let bytes = CryptoModule::generate_random_bytes(8)?;
        let arr: [u8; 8] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("seed wrong size"))?;
        let seed = u64::from_le_bytes(arr) | 1;
        Ok(Self(seed))
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Правдоподобный набор "малоценных" аккаунтов для ложного слоя.
pub fn generate_fake_entries() -> String {
    let mut rng = match XorShift::seeded() {
        Ok(r) => r,
        Err(_) => return "[]".to_string(),
    };

    const SERVICES: &[(&str, &str, &str)] = &[
        ("Reddit", "https://reddit.com", "📱"),
        ("Spotify", "https://spotify.com", "🎵"),
        ("Netflix", "https://netflix.com", "🎬"),
        ("Amazon", "https://amazon.com", "📦"),
        ("eBay", "https://ebay.com", "🛒"),
        ("Medium", "https://medium.com", "📰"),
        ("Stack Overflow", "https://stackoverflow.com", "💻"),
        ("Dropbox", "https://dropbox.com", "☁️"),
        ("LinkedIn", "https://linkedin.com", "💼"),
        ("Pinterest", "https://pinterest.com", "📌"),
        ("Coursera", "https://coursera.org", "🎓"),
        ("Duolingo", "https://duolingo.com", "🦉"),
        ("AliExpress", "https://aliexpress.com", "🛍️"),
        ("Booking.com", "https://booking.com", "✈️"),
        ("Steam", "https://store.steampowered.com", "🎮"),
        ("Twitch", "https://twitch.tv", "📺"),
    ];
    const USERNAMES: &[&str] = &[
        "matt.k", "matt.k@outlook.com", "mattdev92", "k.matthew", "matt.kasper",
        "mkasper", "matt_ka", "matthew.k@gmail.com", "mk_dev", "mattk1992",
    ];
    const TAGS: &[&[&str]] = &[
        &[], &[], &[], &["personal"], &["shopping"], &["newsletters"],
        &["old"], &["family"], &["hobby"], &["trial"],
    ];
    const PW_CHARS: &[u8] = b"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";

    let mut services: Vec<_> = SERVICES.to_vec();
    // Перемешиваем (Fisher–Yates) и берём 8–12 сервисов
    for i in (1..services.len()).rev() {
        let j = rng.below(i + 1);
        services.swap(i, j);
    }
    let count = 8 + rng.below(5);
    services.truncate(count);

    let now_ms = chrono::Utc::now().timestamp_millis();
    let day_ms = 24 * 3600 * 1000i64;

    let entries: Vec<serde_json::Value> = services
        .iter()
        .map(|(title, url, icon)| {
            let username = USERNAMES[rng.below(USERNAMES.len())];
            let pw_len = 10 + rng.below(7);
            let password: String = (0..pw_len)
                .map(|_| PW_CHARS[rng.below(PW_CHARS.len())] as char)
                .collect();
            let created = now_ms - (30 + rng.below(900)) as i64 * day_ms;
            let updated = created + rng.below(((now_ms - created) / day_ms) as usize) as i64 * day_ms;
            let tags: Vec<&str> = TAGS[rng.below(TAGS.len())].to_vec();
            serde_json::json!({
                "id": format!("{:x}", rng.next()),
                "title": title,
                "username": username,
                "password": password,
                "url": url,
                "category": "",
                "tags": tags,
                "favorite": rng.below(10) < 2,
                "strength": 20 + rng.below(65),
                "icon": icon,
                "createdAt": created,
                "updatedAt": updated,
            })
        })
        .collect();

    serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string())
}

/// Load and verify a vault file from disk
pub fn load_vault_file(path: &Path) -> Result<VaultFile> {
    let bytes = std::fs::read(path)?;
    let vault: VaultFile = serde_json::from_slice(&bytes)?;
    if !vault.verify() {
        return Err(anyhow::anyhow!("invalid vault file"));
    }
    Ok(vault)
}

/// Serialize and atomically write a vault file:
/// tmp → fsync → keep a .bak of the previous copy → rename.
/// The write is serialised with VAULT_WRITE_LOCK (see save_entries_to_vault).
pub fn save_vault_file(path: &Path, vault: &VaultFile) -> Result<()> {
    let guard = VAULT_WRITE_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("vault write lock poisoned"))?;
    let result = save_vault_file_locked(path, vault);
    drop(guard);
    result
}

/// save_vault_file without taking VAULT_WRITE_LOCK — for callers that
/// already hold it (e.g. save_entries_to_vault wraps load→modify→save).
fn save_vault_file_locked(path: &Path, vault: &VaultFile) -> Result<()> {
    let bytes = serde_json::to_vec(vault)?;
    let tmp_path = path.with_extension("safepass.tmp");
    {
        let mut f = std::fs::File::create(&tmp_path)?;
        f.write_all(&bytes)?;
        // fsync: данные и метаданные реально на диске до rename —
        // при сбое питания/диска не остаёмся с «пустым» сейвом.
        f.sync_all()?;
    }
    // .bak: предыдущая заведомо целая копия — страховка от сбоя записи.
    let bak_path = path.with_extension("safepass.bak");
    if path.exists() {
        let _ = std::fs::copy(path, &bak_path);
    }
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Normalize a decrypted payload into an entries JSON array string.
/// Legacy/empty payloads ("{}" etc.) become "[]".
pub fn normalize_entries_json(decrypted: &[u8]) -> String {
    match serde_json::from_slice::<serde_json::Value>(decrypted) {
        Ok(serde_json::Value::Array(arr)) => {
            serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
        }
        _ => "[]".to_string(),
    }
}

/// Decrypt the vault payload with the payload key → entries JSON
pub fn decrypt_entries(payload_key: &[u8; 32], encrypted_payload: &[u8]) -> Result<String> {
    let decrypted = aes_decrypt_v2_or_legacy(payload_key, encrypted_payload, AAD_PAYLOAD_V2)?;
    Ok(normalize_entries_json(&decrypted))
}

/// Validate and encrypt an entries JSON array with the payload key
pub fn encrypt_entries(payload_key: &[u8; 32], entries_json: &str) -> Result<Vec<u8>> {
    let value: serde_json::Value = serde_json::from_str(entries_json)?;
    if !value.is_array() {
        return Err(anyhow::anyhow!("entries payload must be a JSON array"));
    }
    Aes256GcmAead::encrypt_with_aad(payload_key, entries_json.as_bytes(), AAD_PAYLOAD_V2)
}

/// Update inner header fields (entry_count, modified_at), re-encrypting it
/// with the vault encryption key.
///
/// SECURITY: entry_count приходит из пользовательского ввода через save_entries
/// (или из подделанного vault-файла при наличии master-пароля). Saturate на
/// разумный предел: больше 1 млн записей — мусор, и UI не должен резервировать
/// под это массивы при чтении заголовка.
pub fn update_inner_header(
    vault: &mut VaultFile,
    enc_key: &[u8; 32],
    entry_count: u32,
) -> Result<()> {
    let decrypted = x_decrypt_v2_or_legacy(enc_key, &vault.header.encrypted_header, AAD_HEADER_V2)?;
    let mut inner: VaultInnerHeader = serde_json::from_slice(&decrypted)?;
    inner.entry_count = entry_count.min(MAX_REASONABLE_ENTRIES);
    inner.modified_at = chrono::Utc::now().timestamp();
    vault.header.encrypted_header =
        XChaCha20Aead::encrypt_with_aad(enc_key, &serde_json::to_vec(&inner)?, AAD_HEADER_V2)?;
    Ok(())
}

/// Верхняя граница для entry_count: 1 млн — заведомо больше, чем любой
/// реальный кейс, и достаточно мало, чтобы UI не ушёл в OOM при попытке
/// отрендерить счётчик/прогресс.
pub const MAX_REASONABLE_ENTRIES: u32 = 1_000_000;

/// Старые vault-файлы без ложного слота догоняем до текущего формата:
/// прикрепляем "спящий" слот при первом сохранении.
pub fn ensure_decoy_slot(vault: &mut VaultFile) -> Result<()> {
    if vault.header.decoy.is_none() || vault.decoy_payload.is_none() {
        let (slot, payload) = build_dormant_decoy()?;
        vault.header.decoy = Some(slot);
        vault.decoy_payload = Some(payload);
    }
    Ok(())
}

/// Зашифровать entries JSON и записать в активный слой сессии (реальный
/// или ложный) с атомарным сохранением файла сейва.
pub fn save_entries_to_vault(
    vault_path: &Path,
    enc_key: &[u8; 32],
    payload_key: &[u8; 32],
    is_decoy: bool,
    entries_json: &str,
) -> Result<()> {
    // Load → modify → save под общим замком: иначе одновременные сохранения
    // из HTTP API, IPC и UI читают один и тот же файл и последнее записи
    // другого канала затирает (потеря данных).
    let guard = VAULT_WRITE_LOCK
        .lock()
        .map_err(|_| anyhow::anyhow!("vault write lock poisoned"))?;

    let encrypted_payload = encrypt_entries(payload_key, entries_json)?;
    let entry_count = count_json_array(entries_json);

    let mut vault = load_vault_file(vault_path)?;
    ensure_decoy_slot(&mut vault)?;

    if is_decoy {
        update_decoy_inner_header(&mut vault, enc_key, entry_count)?;
        vault.decoy_payload = Some(encrypted_payload);
    } else {
        update_inner_header(&mut vault, enc_key, entry_count)?;
        vault.payload = encrypted_payload;
    }

    let result = save_vault_file_locked(vault_path, &vault);
    drop(guard);
    result
}

/// Build a portable encrypted export file.
/// The export key derives from the master password only (no device key),
/// so the backup is restorable on any machine.
pub fn build_export(entries_json: &str, master_password: &str) -> Result<Vec<u8>> {
    let salt = CryptoModule::generate_salt()?;
    let kdf_params = KdfParams::default();
    let export_key = derive_key(master_password.as_bytes(), &salt, &kdf_params)?;
    let payload = XChaCha20Aead::encrypt_with_aad(&export_key, entries_json.as_bytes(), AAD_EXPORT_V2)?;
    let export = ExportFile::new(
        salt,
        KdfParamsSerializable::from(&kdf_params),
        payload,
    );
    Ok(serde_json::to_vec(&export)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_legacy_empty_aad_still_opens() {
        // Vault-файлы, созданные до введения AAD v2, обязаны открываться:
        // шифруем «по-старому» (пустой AAD) и расшифровываем через
        // v2-or-legacy хелпер.
        let key = [0x11u8; 32];
        let legacy_header = XChaCha20Aead::encrypt(&key, b"old-inner-header").unwrap();
        let dec = x_decrypt_v2_or_legacy(&key, &legacy_header, AAD_HEADER_V2).unwrap();
        assert_eq!(dec, b"old-inner-header".to_vec());

        let legacy_payload = Aes256GcmAead::encrypt(&key, b"[{}").unwrap();
        let dec2 = aes_decrypt_v2_or_legacy(&key, &legacy_payload, AAD_PAYLOAD_V2).unwrap();
        assert_eq!(dec2, b"[{}".to_vec());
    }

    #[test]
    fn test_create_and_open_vault() {
        let device_key = [0x42u8; 16];
        let vault = create_vault(
            std::path::Path::new("test"),
            "test_password",
            &device_key,
        ).unwrap();

        assert!(vault.verify());
        assert_eq!(vault.header.magic, *b"SAFEPASS");
        assert_eq!(vault.header.version, 1);

        let session = open_vault(&vault, "test_password", &device_key, None).unwrap();
        assert_eq!(session.vault_id, "vault-1");
    }

    #[test]
    fn test_open_wrong_password() {
        let device_key = [0x42u8; 16];
        let vault = create_vault(
            std::path::Path::new("test"),
            "correct_password",
            &device_key,
        ).unwrap();

        let result = open_vault(&vault, "wrong_password", &device_key, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_entries_roundtrip() {
        let payload_key = [0x24u8; 32];
        let entries = r#"[{"id":"1","title":"Google"}]"#;

        let encrypted = encrypt_entries(&payload_key, entries).unwrap();
        let decrypted = decrypt_entries(&payload_key, &encrypted).unwrap();
        assert_eq!(decrypted, entries);

        // Legacy "{}" payload normalizes to empty array
        let legacy = encrypt_entries_raw(&payload_key, b"{}");
        assert_eq!(decrypt_entries(&payload_key, &legacy).unwrap(), "[]");

        // Non-array payload is rejected on save
        assert!(encrypt_entries(&payload_key, "{}").is_err());
    }

    #[test]
    fn test_update_inner_header() {
        let device_key = [0x42u8; 16];
        let mut vault = create_vault(
            std::path::Path::new("test"),
            "pw",
            &device_key,
        ).unwrap();

        // Recover enc_key the same way open_vault does
        let primary = derive_key(b"pw", &vault.header.salt, &KdfParams::default()).unwrap();
        let enc_key = derive_encryption_key(&primary, &device_key, b"safepass-v1-enc-key").unwrap();

        update_inner_header(&mut vault, &enc_key, 7).unwrap();

        // Header still decrypts and carries the new count
        let session = open_vault(&vault, "pw", &device_key, None).unwrap();
        // update_inner_header шифрует заголовок с AAD v2 — расшифровываем
        // так же, как это делает open-путь (x_decrypt_v2_or_legacy)
        let dec = XChaCha20Aead::decrypt_with_aad(
            &session.encryption_key,
            &vault.header.encrypted_header,
            AAD_HEADER_V2,
        )
        .unwrap();
        let inner: VaultInnerHeader = serde_json::from_slice(&dec).unwrap();
        assert_eq!(inner.entry_count, 7);
    }

    /// Helper: encrypt raw bytes without array validation (legacy payloads)
    fn encrypt_entries_raw(payload_key: &[u8; 32], raw: &[u8]) -> Vec<u8> {
        Aes256GcmAead::encrypt(payload_key, raw).unwrap()
    }

    #[test]
    fn test_decoy_roundtrip() {
        let device_key = [0x42u8; 16];
        let mut vault = create_vault(std::path::Path::new("test"), "real_pw", &device_key).unwrap();

        // Спящий слот не открывается никаким паролем
        assert!(open_vault_any(&vault, "decoy_pw", &device_key, None).is_err());

        // Включаем ложный слой
        set_decoy_password(&mut vault, "real_pw", &device_key, None, "decoy_pw", None).unwrap();

        // Настоящий пароль открывает настоящий слой
        let real = open_vault_any(&vault, "real_pw", &device_key, None).unwrap();
        assert!(!real.is_decoy);

        // Ложный пароль открывает ложный слой с правдоподобными записями
        let decoy = open_vault_any(&vault, "decoy_pw", &device_key, None).unwrap();
        assert!(decoy.is_decoy);
        let entries = decrypt_entries(&decoy.payload_key, active_payload(&vault, true)).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&entries).unwrap();
        assert!(parsed.as_array().unwrap().len() >= 8);

        // Настоящий слой при этом пуст
        let real_entries = decrypt_entries(&real.payload_key, active_payload(&vault, false)).unwrap();
        assert_eq!(real_entries, "[]");

        // Чужой пароль не открывает ничего
        assert!(open_vault_any(&vault, "wrong_pw", &device_key, None).is_err());

        // Управлять ложным слоем ложным паролем нельзя
        assert!(set_decoy_password(&mut vault, "decoy_pw", &device_key, None, "x", None).is_err());
        assert!(remove_decoy(&mut vault, "decoy_pw", &device_key, None).is_err());

        // Смена ложного пароля сохраняет ложные записи
        set_decoy_password(&mut vault, "real_pw", &device_key, None, "decoy_pw2", Some("decoy_pw")).unwrap();
        let decoy2 = open_vault_any(&vault, "decoy_pw2", &device_key, None).unwrap();
        assert!(decoy2.is_decoy);
        let entries2 = decrypt_entries(&decoy2.payload_key, active_payload(&vault, true)).unwrap();
        assert_eq!(entries2, entries);
        assert!(open_vault_any(&vault, "decoy_pw", &device_key, None).is_err());

        // Отключение возвращает спящий слот
        remove_decoy(&mut vault, "real_pw", &device_key, None).unwrap();
        assert!(open_vault_any(&vault, "decoy_pw2", &device_key, None).is_err());
        // Настоящий пароль по-прежнему работает
        assert!(open_vault_any(&vault, "real_pw", &device_key, None).is_ok());
    }

    #[test]
    fn test_fake_entries_plausible() {
        let json = generate_fake_entries();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let arr = parsed.as_array().unwrap();
        assert!(arr.len() >= 8 && arr.len() <= 12);
        for e in arr {
            assert!(e["title"].is_string());
            assert!(e["username"].is_string());
            assert!(e["password"].as_str().unwrap().len() >= 10);
            assert!(e["createdAt"].is_number());
        }
    }

    #[test]
    fn test_hw_key_roundtrip() {
        let device_key = [0x42u8; 16];
        let mut vault = create_vault(std::path::Path::new("test"), "real_pw", &device_key).unwrap();
        let dir = std::env::temp_dir().join(format!("mynx-hwtest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // Включаем hw-ключ: keyfile пишется в папку (флешку)
        let kf_path = enable_hw_key(&mut vault, "real_pw", &device_key, &dir, None).unwrap();
        assert!(kf_path.is_file());
        let keyfile_id = vault.header.hw_key.as_ref().unwrap().keyfile_id.clone();

        // Без секрета флешки vault не открывается — даже с верным паролем
        assert!(open_vault(&vault, "real_pw", &device_key, None).is_err());

        // С keyfile открывается
        let secret = read_hw_keyfile(&kf_path, &keyfile_id, &device_key).unwrap();
        assert!(open_vault(&vault, "real_pw", &device_key, Some(&secret)).is_ok());

        // Чужой/битый keyfile не подходит
        assert!(read_hw_keyfile(&kf_path, "deadbeef", &device_key).is_err());
        // Keyfile, зашифрованный под другой device key, не расшифровывается
        assert!(read_hw_keyfile(&kf_path, &keyfile_id, &[0x77u8; 16]).is_err());
        assert!(open_vault(&vault, "real_pw", &device_key, Some(&[0x99u8; 32])).is_err());

        // Повторное включение запрещено
        assert!(enable_hw_key(&mut vault, "real_pw", &device_key, &dir, None).is_err());

        // Отключение (секрет уже прочитан с "флешки" выше)
        disable_hw_key_with_secret(&mut vault, "real_pw", &device_key, &secret, None).unwrap();
        assert!(vault.header.hw_key.is_none());

        // После отключения открывается одним паролем
        assert!(open_vault(&vault, "real_pw", &device_key, None).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

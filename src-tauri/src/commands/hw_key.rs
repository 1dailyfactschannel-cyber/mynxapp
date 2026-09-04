use std::path::Path;

use tauri::State;

use crate::vault::operations::{
    disable_hw_key_with_secret, enable_hw_key, load_vault_file, read_hw_keyfile, save_vault_file,
};

use super::app_state::AppState;
use super::device_key::{cached_hw_secret, load_device_key, session_keys};
use super::types::*;

/* ------------------------------------------------------------------ */
/* Реестр путей keyfile (hw-ключ на любом пути: флешка или ПК)          */
/* ------------------------------------------------------------------ */

/// P2-12: файл лежит рядом с exe и хранит ТОЛЬКО пары имя → путь к keyfile
/// (не секреты и не содержимое ключей). Компрометация реестра не даёт
/// доступа к хранилищам: нужен ещё сам keyfile и мастер-пароль. Плейнтекст —
/// осознанное решение; шифрование возможно по запросу (см. docs/architecture.md).
pub(crate) fn hw_registry_file() -> Result<std::path::PathBuf, String> {
    let base = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get exe directory")?
        .to_path_buf();
    Ok(base.join("vaults").join("hwkeys.json"))
}

pub(crate) fn hw_registry_load() -> std::collections::HashMap<String, String> {
    let Ok(path) = hw_registry_file() else {
        return std::collections::HashMap::new();
    };
    std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub(crate) fn hw_registry_save(map: &std::collections::HashMap<String, String>) {
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
pub(crate) fn resolve_hw_keyfile(
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

    crate::vault::operations::find_hw_keyfile(keyfile_id).map_err(|_| "hw_key_not_found".to_string())
}

pub(crate) fn hw_registry_remember(keyfile_id: &str, path: &Path) {
    let mut reg = hw_registry_load();
    reg.insert(
        keyfile_id.to_string(),
        path.to_string_lossy().to_string(),
    );
    hw_registry_save(&reg);
}

pub(crate) fn hw_registry_forget(keyfile_id: &str) {
    let mut reg = hw_registry_load();
    if reg.remove(keyfile_id).is_some() {
        hw_registry_save(&reg);
    }
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

/// SECURITY: валидация пути для записи keyfile. Разрешаем только
/// съёмные диски (флешки) и пути внутри профиля пользователя
/// (`%USERPROFILE%`). Это Defence in Depth: даже если фронт будет
/// скомпрометирован, бэкенд не позволит записать keyfile в
/// `%WINDIR%`, `%APPDATA%` других приложений или сетевые папки.
fn validate_hw_keyfile_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err("hw_key_dir_not_absolute".to_string());
    }
    // Создаём канонический путь без .. и симлинков.
    let canonical = std::fs::canonicalize(dir).map_err(|_| "hw_key_dir_invalid".to_string())?;

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Storage::FileSystem::GetDriveTypeW;
        // 2 = DRIVE_REMOVABLE, 3 = DRIVE_FIXED. Разрешаем съёмные и фиксированные
        // диски, но путь должен лежать в user-profile.
        let root = canonical
            .components()
            .next()
            .ok_or("hw_key_dir_invalid")?;
        let root_str = root.as_os_str().to_string_lossy().to_string();
        let wide: Vec<u16> = root_str.encode_utf16().collect();
        let drive_type = unsafe { GetDriveTypeW(windows::core::PCWSTR(wide.as_ptr())) };
        // DRIVE_REMOVABLE = 2, DRIVE_FIXED = 3. Сетевые (4) и RAM-диски (6) запрещены.
        if drive_type != 2 && drive_type != 3 {
            return Err("hw_key_dir_drive_type".to_string());
        }

        // Проверяем, что путь лежит в %USERPROFILE% или в корне съёмного диска.
        let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
        if !userprofile.is_empty() {
            let userprofile_path = std::path::PathBuf::from(&userprofile);
            if let Ok(userprofile_canonical) = std::fs::canonicalize(&userprofile_path) {
                if canonical.starts_with(&userprofile_canonical) {
                    return Ok(()); // в профиле — ОК
                }
            }
        }
        // Корень съёмного диска (например, `E:\`) тоже допустим.
        if let Some(parent) = canonical.parent() {
            if parent.as_os_str().is_empty() {
                return Ok(()); // X:\ без подпапок
            }
        }
        return Err("hw_key_dir_outside_userprofile".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        // На других ОС — разрешаем только $HOME.
        if let Ok(home) = std::env::var("HOME") {
            if canonical.starts_with(home) {
                return Ok(());
            }
        }
        Err("hw_key_dir_outside_home".to_string())
    }
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

    // SECURITY: валидируем путь ДО чтения vault / device_key, чтобы
    // скомпрометированный фронт не мог заставить нас делать лишнюю
    // работу перед ошибкой.
    let key_dir = Path::new(&request.directory);
    validate_hw_keyfile_dir(key_dir)?;

    let device_key = load_device_key(vault_path)?;
    let mut vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;

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

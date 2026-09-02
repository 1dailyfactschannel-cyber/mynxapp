//! Автоматическая регистрация натив-хоста для браузерного расширения.
//!
//! Вызывается при каждом запуске приложения (self-heal): перезаписывает
//! манифест натив-хоста (`%LOCALAPPDATA%\Mynx\native-host\com.matt.mynx.native.json`)
//! и HKCU-ключи реестра для Chrome / Edge / Chromium / Brave / Canary.
//! Прав администратора не требуется. Дополняет NSIS-хук инсталлятора
//! (`src-tauri/windows/installer-hooks.nsh`), который прописывает те же
//! ключи реестра сразу при установке; манифест генерируется здесь, потому
//! что содержит абсолютный путь к `mynx-native-host.exe`.

/// Имя натив-хоста — должно совпадать с NATIVE_HOST_NAME в
/// extension/background.js.
pub const HOST_NAME: &str = "com.matt.mynx.native";

/// Стабильный ID расширения — производный от публичного ключа в
/// extension/manifest.json ("key"): одинаков для unpacked- и store-сборок,
/// поэтому в allowed_origins достаточно одного значения.
pub const STABLE_EXTENSION_ID: &str = "falikbndiimjeolnkclmifhgobmghhfe";

#[cfg(windows)]
mod imp {
    use super::{HOST_NAME, STABLE_EXTENSION_ID};
    use std::fs;
    use std::path::PathBuf;

    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    /// HKCU-корни браузеров: каждый Chromium-браузер читает ветку своего вендора.
    const REGISTRY_ROOTS: &[&str] = &[
        r"Software\Google\Chrome\NativeMessagingHosts",
        r"Software\Google\Chrome SxS\NativeMessagingHosts", // Canary
        r"Software\Microsoft\Edge\NativeMessagingHosts",
        r"Software\Chromium\NativeMessagingHosts",
        r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    ];

    pub fn ensure_registration() {
        if let Err(e) = try_register() {
            // Не критично: расширение покажет «Mynx desktop is not running»,
            // а PS1-скрипт остаётся ручным резервом. Приложение продолжит работу.
            crate::log_warn!("native host auto-registration skipped: {e}");
        }
    }

    fn try_register() -> Result<(), String> {
        // 1. mynx-native-host.exe должен стоять рядом с mynx.exe (sidecar).
        let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
        let host_exe = exe
            .parent()
            .ok_or_else(|| "app exe has no parent dir".to_string())?
            .join("mynx-native-host.exe");
        if !host_exe.exists() {
            return Err(format!("sidecar {} not found", host_exe.display()));
        }

        // 2. Манифест хоста (UTF-8): путь к sidecar + стабильный ID расширения.
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "LOCALAPPDATA is not set".to_string())?;
        let manifest_dir = local.join("Mynx").join("native-host");
        fs::create_dir_all(&manifest_dir).map_err(|e| format!("create_dir_all: {e}"))?;
        let manifest_path = manifest_dir.join(format!("{HOST_NAME}.json"));

        let manifest = serde_json::json!({
            "name": HOST_NAME,
            "description": "Mynx Native Messaging Host",
            "path": host_exe.display().to_string(),
            "type": "stdio",
            "allowed_origins": [format!("chrome-extension://{STABLE_EXTENSION_ID}/")],
        });
        fs::write(&manifest_path, manifest.to_string())
            .map_err(|e| format!("write manifest: {e}"))?;

        // 3. HKCU-ключи: значение по умолчанию = полный путь к манифесту.
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let manifest_str = manifest_path.display().to_string();
        for root in REGISTRY_ROOTS {
            let key_path = format!(r"{root}\{HOST_NAME}");
            let (key, _) = hkcu
                .create_subkey(&key_path)
                .map_err(|e| format!("create_subkey {key_path}: {e}"))?;
            key.set_value("", &manifest_str)
                .map_err(|e| format!("set_value {key_path}: {e}"))?;
        }

        crate::log_info!("native host registered: {}", manifest_str);
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{HOST_NAME, STABLE_EXTENSION_ID};

    pub fn ensure_registration() {
        // Нативный месседжинг и его регистрация существуют только на Windows.
        // Ссылки на константы держат их «живыми» для clippy на не-Windows CI.
        debug_assert!(!HOST_NAME.is_empty());
        debug_assert!(!STABLE_EXTENSION_ID.is_empty());
    }
}

pub use imp::ensure_registration;

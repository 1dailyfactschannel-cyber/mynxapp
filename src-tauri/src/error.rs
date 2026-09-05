use serde::Serialize;
use thiserror::Error;

/// Единый тип ошибок для всех Tauri-команд и IPC-ответов.
///
/// Фронт получает JSON в форме `{ "kind": "...", "message": "..." }`
/// (см. `src/lib/errors.ts`). Стабильный `kind` — контракт между
/// процессами, `message` — человекопонятное описание для логов и UI.
///
/// Добавлять новый вариант = дополнить enum + ветку в `kind()`.
/// НЕ МЕНЯТЬ строковые идентификаторы `kind()` без синхронизации с TS.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum CommandError {
    // ---- Аутентификация и пароли ----
    #[error("Master password is too short")]
    PasswordTooShort,
    #[error("Master password is too weak")]
    PasswordTooWeak,
    #[error("Wrong master password")]
    WrongPassword,
    #[error("Too many unlock attempts. Retry in {0} seconds")]
    TooManyAttempts(u64),
    #[error("Vault is locked")]
    VaultLocked,

    // ---- Файлы и vault ----
    #[error("Vault file not found")]
    VaultNotFound,
    #[error("Cannot read or parse vault file: {0}")]
    VaultCorrupted(String),
    #[error("Cannot write vault file: {0}")]
    VaultWriteFailed(String),
    #[error("Vault file is locked by another session")]
    VaultLockedOther,

    // ---- Decoy (plausible deniability) ----
    #[error("Decoy password must differ from the master password")]
    DecoyEqualsMaster,
    #[error("Operation not allowed from a decoy session")]
    DecoySessionForbidden,

    // ---- Аппаратный ключ (hw-key) ----
    #[error("Hardware key (USB) not found")]
    HwKeyNotFound,
    #[error("Hardware key file is invalid or corrupted")]
    HwKeyInvalid,
    #[error("Hardware key is already enabled for this vault")]
    HwKeyAlreadyEnabled,
    #[error("Hardware key is not enabled for this vault")]
    HwKeyNotEnabled,
    #[error("Keyfile path is not absolute")]
    HwKeyDirNotAbsolute,
    #[error("Keyfile path is invalid or inaccessible")]
    HwKeyDirInvalid,
    #[error("Keyfile path is on a disallowed drive type (network/RAM)")]
    HwKeyDirDriveType,
    #[error("Keyfile path must be inside the user profile or on a removable drive root")]
    HwKeyDirOutsideUserProfile,

    // ---- Clipboard ----
    #[error("Secure clipboard buffer is empty")]
    SecureBufferEmpty,
    #[error("Clipboard operation failed: {0}")]
    ClipboardFailed(String),

    // ---- Настройки и прочее ----
    #[error("Lock-on-hide cannot be weakened in an active session")]
    LockOnHideWeakeningForbidden,
    #[error("Backup path is empty")]
    BackupPathEmpty,
    #[error("Backup failed: {0}")]
    BackupFailed(String),
    #[error("Save cancelled by user")]
    SaveCancelled,
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    // ---- I/O и системные ----
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Path error: {0}")]
    Path(String),
    #[error("Serialization error: {0}")]
    Serde(String),

    // ---- Общий fallback ----
    #[error("{0}")]
    Other(String),
}

impl CommandError {
    /// Строковый идентификатор для фронта. Стабильный контракт.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::PasswordTooShort => "password_too_short",
            Self::PasswordTooWeak => "password_too_weak",
            Self::WrongPassword => "wrong_password",
            Self::TooManyAttempts(_) => "too_many_attempts",
            Self::VaultLocked => "vault_locked",
            Self::VaultNotFound => "vault_not_found",
            Self::VaultCorrupted(_) => "vault_corrupted",
            Self::VaultWriteFailed(_) => "vault_write_failed",
            Self::VaultLockedOther => "vault_locked_other",
            Self::DecoyEqualsMaster => "decoy_equals_master",
            Self::DecoySessionForbidden => "decoy_session_forbidden",
            Self::HwKeyNotFound => "hw_key_not_found",
            Self::HwKeyInvalid => "hw_key_invalid",
            Self::HwKeyAlreadyEnabled => "hw_key_already_enabled",
            Self::HwKeyNotEnabled => "hw_key_not_enabled",
            Self::HwKeyDirNotAbsolute => "hw_key_dir_not_absolute",
            Self::HwKeyDirInvalid => "hw_key_dir_invalid",
            Self::HwKeyDirDriveType => "hw_key_dir_drive_type",
            Self::HwKeyDirOutsideUserProfile => "hw_key_dir_outside_userprofile",
            Self::SecureBufferEmpty => "secure_buffer_empty",
            Self::ClipboardFailed(_) => "clipboard_failed",
            Self::LockOnHideWeakeningForbidden => "lock_on_hide_weakening_forbidden",
            Self::BackupPathEmpty => "backup_path_empty",
            Self::BackupFailed(_) => "backup_failed",
            Self::SaveCancelled => "save_cancelled",
            Self::InvalidInput(_) => "invalid_input",
            Self::Io(_) => "io_error",
            Self::Path(_) => "path_error",
            Self::Serde(_) => "serde_error",
            Self::Other(_) => "other",
        }
    }
}

/// `Result` с типизированной ошибкой для Tauri-команд.
pub type CommandResult<T> = std::result::Result<T, CommandError>;

// ---- Конверсии из стандартных ошибок ----

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => Self::Path(format!("not found: {e}")),
            _ => Self::Io(e.to_string()),
        }
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serde(e.to_string())
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e.to_string())
    }
}

/// Конверсия из `String` — для замены старых `Err(e.to_string())`.
/// ВАЖНО: при рефакторе вызовов `map_err(|e| e.to_string())` заменяйте
/// на `map_err(CommandError::from)` или специализированные варианты
/// (например, `map_err(|_| CommandError::WrongPassword)`).
impl From<String> for CommandError {
    fn from(s: String) -> Self {
        // Пытаемся распознать «старые» строки из прежнего кода и
        // преобразовать в типизированный вариант. Это позволяет менять
        // команды постепенно, без обратной несовместимости с UI.
        match s.as_str() {
            "wrong_password" => Self::WrongPassword,
            "vault_locked" => Self::VaultLocked,
            "Vault file not found" => Self::VaultNotFound,
            "secure_buffer_empty" => Self::SecureBufferEmpty,
            "Backup path is empty" => Self::BackupPathEmpty,
            "hw_key_invalid" => Self::HwKeyInvalid,
            "hw_key_not_found" => Self::HwKeyNotFound,
            "hw_key_already_enabled" => Self::HwKeyAlreadyEnabled,
            "hw_key_not_enabled" => Self::HwKeyNotEnabled,
            "hw_key_dir_not_absolute" => Self::HwKeyDirNotAbsolute,
            "hw_key_dir_invalid" => Self::HwKeyDirInvalid,
            "hw_key_dir_drive_type" => Self::HwKeyDirDriveType,
            "hw_key_dir_outside_userprofile" => Self::HwKeyDirOutsideUserProfile,
            "lock_on_hide_weakening_forbidden" => Self::LockOnHideWeakeningForbidden,
            "decoy_equals_master" => Self::DecoyEqualsMaster,
            _ => Self::Other(s),
        }
    }
}

impl From<&str> for CommandError {
    fn from(s: &str) -> Self {
        Self::from(s.to_string())
    }
}

/// Старое API: `Result<T, String>` для совместимости с Tauri.
///
/// Tauri требует `serde::Serialize` на ошибке — `CommandError` уже
/// сериализуется через `#[serde(tag = "kind", content = "message")]`.
///
/// Используйте `into_string()` если вам нужно сохранить обратную
/// совместимость с фронтом, который ещё не мигрировал на typed-errors.
impl CommandError {
    /// Сериализовать в старый строковый формат для бэк-совместимости.
    /// Используется ТОЛЬКО при постепенной миграции, не в новом коде.
    pub fn to_legacy_string(&self) -> String {
        // Большинство старых строк совпадают с kind(); отличия —
        // для них отдельные ветки.
        match self {
            Self::TooManyAttempts(s) => format!("Too many attempts. Retry in {} seconds", s),
            _ => self.kind().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrong_password_conversion_keeps_kind() {
        let e: CommandError = "wrong_password".to_string().into();
        assert_eq!(e.kind(), "wrong_password");
    }

    #[test]
    fn unknown_string_falls_back_to_other() {
        let e: CommandError = "garbled".to_string().into();
        assert_eq!(e.kind(), "other");
    }

    #[test]
    fn too_many_attempts_legacy_round_trip() {
        let e = CommandError::TooManyAttempts(42);
        let s = e.to_legacy_string();
        assert!(s.contains("42"));
    }

    #[test]
    fn serializes_with_kind_tag() {
        let e = CommandError::WrongPassword;
        let j = serde_json::to_string(&e).unwrap();
        assert!(j.contains("\"kind\":\"wrong_password\""));
    }
}

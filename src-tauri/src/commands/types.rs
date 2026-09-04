use serde::{Deserialize, Serialize};

/// SECURITY: минимальные требования к мастер-паролю.
///
/// 12 символов — нижняя граница: меньше 12 даже с нашим KDF (64 MB / 4 iter)
/// реально ломается офлайн за разумное время. Дополнительно запрещаем
/// самые очевидные «123456…» шаблоны и требования, чтобы у пользователя
/// не было ложного ощущения безопасности при `qwerty12345`.
///
/// Это НЕ заменяет zxcvbn — мы даём пользователю право выбрать и короткий
/// пароль, если он сознательно подтвердит через UI. Серверная проверка
/// отсекает только совсем негодные значения.
pub const MIN_MASTER_PASSWORD_LEN: usize = 12;

/// Возвращает Ok(()) если пароль соответствует минимальным требованиям,
/// иначе Err с reason: `too_short` или `too_weak` (без утечки самих правил).
pub fn validate_master_password(pw: &str) -> Result<(), String> {
    let len = pw.chars().count();
    if len < MIN_MASTER_PASSWORD_LEN {
        return Err("password_too_short".to_string());
    }
    // Минимальная структурная проверка: должны быть символы минимум из
    // двух разных «классов» (буквы / цифры / прочие). Это не заменяет
    // полноценную энтропийную метрику, но отсекает тривиальные шаблоны.
    let has_alpha = pw.chars().any(|c| c.is_alphabetic());
    let has_digit = pw.chars().any(|c| c.is_ascii_digit());
    let has_other = pw.chars().any(|c| !c.is_alphanumeric());
    let class_count = has_alpha as u8 + has_digit as u8 + has_other as u8;
    if class_count < 2 {
        return Err("password_too_weak".to_string());
    }
    Ok(())
}

// ---- DTO-структуры для запросов/ответов Tauri-команд ----

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

#[derive(Serialize)]
pub struct DecoyStatusResponse {
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct SecureCopyRequest {
    pub text: String,
}

#[derive(Deserialize)]
pub struct BackupRequest {
    pub vault_id: String,
    pub backup_path: String,
    pub keep_count: usize,
}

#[derive(Deserialize)]
pub struct SavePngRequest {
    pub default_name: String,
    pub bytes: Vec<u8>,
}

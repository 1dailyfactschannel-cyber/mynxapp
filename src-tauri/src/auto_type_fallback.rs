//! Заглушка авто-ввода для не-Windows платформ.
//! SendInput/GetForegroundWindow — Win32-only; на Linux команды
//! возвращают понятную ошибку, чтобы фронт мог её показать.

use serde::Serialize;

#[derive(Serialize)]
pub struct ForegroundInfo {
    pub title: String,
    /// true — активное окно принадлежит нашему процессу
    pub is_self: bool,
}

#[tauri::command]
pub fn auto_type_credentials(_username: String, _password: String) -> Result<(), String> {
    Err("auto_type_not_supported_on_this_platform".to_string())
}

#[tauri::command]
pub fn auto_type_text(_text: String) -> Result<(), String> {
    Err("auto_type_not_supported_on_this_platform".to_string())
}

/// На Windows ждёт отпускания модификаторов хоткея; здесь нечего ждать.
pub(crate) fn wait_for_modifiers_released() {}

/// Прямой ввод текста недоступен без Win32 SendInput.
pub fn type_text(_text: &str) -> Result<(), String> {
    Err("auto_type_not_supported_on_this_platform".to_string())
}

#[tauri::command]
pub fn get_foreground_window() -> ForegroundInfo {
    ForegroundInfo {
        title: String::new(),
        is_self: false,
    }
}

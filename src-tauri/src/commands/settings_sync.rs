use tauri::State;

use super::app_state::AppState;

/// Таймаут автоблокировки из настроек UI → бэкенд (минуты, 0 = выключено).
/// Бэкенд держит свою копию и сам гасит сессию по простою —
/// см. AppStateInner::enforce_autolock.
#[tauri::command]
pub async fn set_autolock_minutes(minutes: u64, state: State<'_, AppState>) -> Result<(), String> {
    *state.inner.autolock_minutes.lock().unwrap() = minutes;
    Ok(())
}

/// Переключатель «блокировать при сворачивании в трей» (настройка UI).
///
/// SECURITY: разрешаем только ужесточение (true → true или false → true).
/// Ослабление (true → false) в активной сессии запрещено: скомпрометированный
/// фронт не должен мочь отключить защиту от вредоносного скрытия окна.
/// Изменить false → true можно в любой момент (защита усиливается).
#[tauri::command]
pub async fn set_lock_on_hide(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let mut slot = state.inner.lock_on_hide.lock().unwrap();
    if *slot && !enabled {
        return Err("lock_on_hide_weakening_forbidden".to_string());
    }
    *slot = enabled;
    Ok(())
}

/// Язык UI для нативных диалогов (pairing), вызывается фронтом при смене языка.
#[tauri::command]
pub async fn set_app_language(lang: String, state: State<'_, AppState>) -> Result<(), String> {
    let normalized = if lang == "ru" { "ru" } else { "en" };
    *state.inner.language.lock().unwrap() = normalized.to_string();
    Ok(())
}

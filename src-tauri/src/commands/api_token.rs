use tauri::State;
use zeroize::Zeroizing;

use super::app_state::{generate_api_token_internal, AppState};

#[tauri::command]
pub async fn get_api_token(state: State<'_, AppState>) -> Result<String, String> {
    let token = state.inner.api_token.lock().unwrap();
    Ok(token.to_string())
}

/// Ротация токена локального API (P2-11). Старое значение затирается
/// (Zeroize on drop), фронт получает новый токен и переавторизуется.
#[tauri::command]
pub async fn rotate_api_token(state: State<'_, AppState>) -> Result<String, String> {
    let mut slot = state.inner.api_token.lock().unwrap();
    *slot = Zeroizing::new(generate_api_token_internal());
    Ok(slot.to_string())
}

use tauri::State;

use super::app_state::AppState;

/// SECURITY: пользователь может отозвать ранее выданный IPC pair-ключ
/// (например, после удаления расширения или потери устройства). Все
/// текущие ключи удаляются — расширение должно будет запросить новый
/// pair через UI-диалог.
#[tauri::command]
pub fn revoke_ipc_pair(state: State<'_, AppState>) -> Result<(), String> {
    state.inner.ipc_pair_keys.lock().unwrap().clear();
    Ok(())
}

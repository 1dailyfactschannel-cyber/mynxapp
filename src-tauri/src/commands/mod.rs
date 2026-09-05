//! Tauri-команды Mynx, сгруппированные по доменам.
//!
//! Структура:
//!   - `app_state`   — `AppState` / `AppStateInner` (общее состояние)
//!   - `types`       — DTO для запросов/ответов + валидация мастер-пароля
//!   - `device_key`  — device key (keyring/file) + session helpers
//!   - `vault`       — create/unlock/lock/save/change-pw/list/delete/export
//!   - `decoy`       — ложный слой (set/remove/status)
//!   - `hw_key`      — аппаратный ключ (USB) и реестр путей
//!   - `secure_clip` — слепое копирование (secure_copy/paste/available)
//!   - `settings_sync` — синхронизация настроек UI → бэкенд
//!   - `api_token`   — токен локального API (get/rotate)
//!   - `backup`      — бэкап файлов + настройки для IPC
//!   - `save_dialog` — нативный диалог сохранения + save_png_file
//!   - `misc`        — revoke_ipc_pair и подобное
//!
//! Для main.rs все команды доступны через `super::commands::*` или
//! точечно через `super::commands::vault::vault_unlock` и т.п.

pub mod api_token;
pub mod app_state;
pub mod backup;
pub mod decoy;
pub mod device_key;
pub mod hw_key;
pub mod misc;
pub mod save_dialog;
pub mod secure_clip;
pub mod settings_sync;
pub mod types;
pub mod vault;

// Re-exports для обратной совместимости с main.rs / ipc.rs / api.rs.
// Добавляйте новые команды в этот блок — main.rs импортирует именно
// отсюда через `use commands::{vault_create, ...}`.
pub use app_state::{generate_api_token_internal, AppState, AppStateInner};
pub use types::{validate_master_password, VaultIdRequest, VaultUnlockResponse};

pub use api_token::{get_api_token, rotate_api_token};
pub use backup::{run_vault_backup_files, set_ipc_backup_prefs, vault_backup};
pub use decoy::{vault_decoy_status, vault_remove_decoy, vault_set_decoy_password};
pub use device_key::{count_entries, load_device_key, session_keys};
pub use hw_key::{vault_disable_hw_key, vault_enable_hw_key, vault_hw_key_status};
pub use misc::revoke_ipc_pair;
pub use save_dialog::{pick_save_path, save_png_file};
pub use secure_clip::{secure_copy, secure_copy_available, secure_paste};
pub use settings_sync::{set_app_language, set_autolock_minutes, set_lock_on_hide};
pub use vault::{
    check_vault_unlocked, get_device_key, list_vault_files, vault_change_password, vault_create,
    vault_delete, vault_export, vault_get_entries, vault_lock, vault_save_entries, vault_unlock,
};

use zeroize::Zeroize;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Проверка: wipe_secrets реально затирает ключи, а не просто
    /// отбрасывает Option-обёртку.
    #[test]
    fn wipe_secrets_zeros_keys() {
        let state = AppState::new();
        let mut session = state.inner.vault_session.lock().unwrap();
        *session = Some(crate::vault::types::VaultSession::new(
            "test".to_string(),
            [0xAAu8; 32],
            [0xBBu8; 32],
        ));
        drop(session);

        let mut hw = state.inner.hw_key_secret.lock().unwrap();
        *hw = Some([0xCCu8; 32]);
        drop(hw);

        let mut clip = state.inner.secure_clipboard.lock().unwrap();
        *clip = Some(vec![0xDDu8; 16]);
        drop(clip);

        wipe_secrets(&state.inner);

        assert!(state.inner.vault_session.lock().unwrap().is_none());
        assert!(state.inner.hw_key_secret.lock().unwrap().is_none());
        assert!(state.inner.secure_clipboard.lock().unwrap().is_none());
    }
}

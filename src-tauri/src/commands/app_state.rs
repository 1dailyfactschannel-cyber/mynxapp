use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

use crate::vault::types::VaultSession;

/// Параметры бэкапа для IPC-клиентов (см. ipc.rs, действие "backup").
#[derive(Debug, Clone)]
pub struct IpcBackupPrefs {
    pub backup_path: String,
    pub keep_count: usize,
}

/// Корневое состояние приложения, инжектится в Tauri через `manage`.
pub struct AppState {
    pub inner: Arc<AppStateInner>,
}

pub struct AppStateInner {
    pub vault_session: Mutex<Option<VaultSession>>,
    pub device_key: Mutex<Option<[u8; 16]>>,
    /// Секрет аппаратного ключа (флешка), кэшируется на время сессии
    pub hw_key_secret: Mutex<Option<[u8; 32]>>,
    /// Токен локального HTTP API (P2-11): Zeroizing затирает старое значение
    /// при ротации, чтобы копия токена не оставалась в памяти/свопе.
    pub api_token: Mutex<Zeroizing<String>>,
    /// Ключ защищённого буфера: генерируется на запуск приложения,
    /// живёт только в памяти процесса.
    pub secure_clip_key: [u8; 32],
    /// Зашифрованное содержимое защищённого буфера (слепое копирование).
    /// В глобальный буфер обмена секрет не попадает никогда.
    pub secure_clipboard: Mutex<Option<Vec<u8>>>,
    /// Блокировать хранилище и затирать RAM при сворачивании окна в трей.
    pub lock_on_hide: Mutex<bool>,
    /// AppHandle для нативного pairing-диалога из IPC-потока.
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Ключи доверенных IPC-клиентов. Только в памяти: сброс при рестарте
    /// приложения или смене хранилища.
    pub ipc_pair_keys: Mutex<std::collections::HashSet<String>>,
    /// Идёт pairing-диалог (максимум один одновременно).
    pub pairing_active: Mutex<bool>,
    /// Язык UI ("en"/"ru") — фронт синхронизирует для нативных диалогов.
    pub language: Mutex<String>,
    /// Счётчики неудачных попыток разблокировки (per vault, только в памяти).
    pub unlock_attempts: crate::ratelimit::AttemptTrackerMap,
    /// Счётчик неудачной аутентификации на локальном HTTP API.
    pub api_attempts: crate::ratelimit::AttemptTrackerMap,
    /// Поколение таймера очистки буфера: новый clipboard_set_secure
    /// отменяет предыдущий таймер, увеличивая счётчик.
    pub clipboard_generation: Mutex<u64>,
    /// Backend-enforced autolock: момент последней активности, touches
    /// каждым секрет-возвращающим вызовом. None — активность ещё не была.
    pub last_activity: Mutex<Option<std::time::Instant>>,
    /// Таймаут автоблокировки в минутах (0 = выключена), синхронизируется
    /// командой set_autolock_minutes из настроек UI. Дублирует фронтовый
    /// таймер, но НЕ зависит от него: вебвью можно заморозить или подменить,
    /// бэкенд-проверка остаётся.
    pub autolock_minutes: Mutex<u64>,
    /// Настройки бэкапа, синхронизируемые командой set_ipc_backup_prefs:
    /// доверенный IPC-клиент (расширение по chrome.alarms) запускает бэкап
    /// активного хранилища с теми же параметрами, что и фронтовый шедулер.
    /// Только в памяти: после рестарта фронт синхронизирует заново.
    pub ipc_backup_prefs: Mutex<Option<IpcBackupPrefs>>,
}

impl AppState {
    pub fn new() -> Self {
        let mut secure_clip_key = [0u8; 32];
        getrandom::getrandom(&mut secure_clip_key).expect("random");
        Self {
            inner: Arc::new(AppStateInner {
                vault_session: Mutex::new(None),
                device_key: Mutex::new(None),
                hw_key_secret: Mutex::new(None),
                api_token: Mutex::new(Zeroizing::new(generate_api_token())),
                secure_clip_key,
                secure_clipboard: Mutex::new(None),
                lock_on_hide: Mutex::new(true),
                app_handle: Mutex::new(None),
                ipc_pair_keys: Mutex::new(std::collections::HashSet::new()),
                pairing_active: Mutex::new(false),
                language: Mutex::new("en".to_string()),
                unlock_attempts: crate::ratelimit::AttemptTrackerMap::new(),
                api_attempts: crate::ratelimit::AttemptTrackerMap::new(),
                clipboard_generation: Mutex::new(0),
                last_activity: Mutex::new(None),
                autolock_minutes: Mutex::new(5),
                ipc_backup_prefs: Mutex::new(None),
            }),
        }
    }

    pub fn clone_inner(&self) -> Arc<AppStateInner> {
        self.inner.clone()
    }
}

impl AppStateInner {
    /// Отметка активности сессии: вызывается секрет-возвращающими командами.
    pub fn touch_activity(&self) {
        *self.last_activity.lock().unwrap() = Some(std::time::Instant::now());
    }

    /// Backend-enforced autolock: если сессия разблокирована и простаивает
    /// дольше autolock_minutes — секреты затираются немедленно, вызов
    /// получает "vault_locked". Фронтовый таймер остаётся для UX, но
    /// фактическое удаление секретов от него больше не зависит:
    /// useAutoLock жил только в вебвью и обходился сном системы,
    /// заморозкой окна или подменой фронта.
    pub fn enforce_autolock(&self) -> Result<(), String> {
        let session_active = self.vault_session.lock().unwrap().is_some();
        if !session_active {
            return Ok(());
        }
        let minutes = *self.autolock_minutes.lock().unwrap();
        if minutes == 0 {
            return Ok(()); // автоблокировка выключена в настройках
        }
        let expired = match *self.last_activity.lock().unwrap() {
            Some(t) => t.elapsed() >= std::time::Duration::from_secs(minutes * 60),
            None => false,
        };
        if expired {
            super::wipe_secrets(self);
            return Err("vault_locked".to_string());
        }
        self.touch_activity();
        Ok(())
    }
}

fn generate_api_token() -> String {
    super::generate_api_token_internal()
}

/// Внутренний генератор: используется и для начального заполнения,
/// и для ротации при смене мастер-пароля.
pub fn generate_api_token_internal() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("random");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

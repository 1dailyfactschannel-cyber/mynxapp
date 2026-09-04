use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::api::{domain_score, normalize_domain};
use crate::commands::{run_vault_backup_files, AppStateInner};
use crate::crypto::CryptoModule;
use crate::vault::operations::{
    active_payload, decrypt_entries, load_vault_file, save_entries_to_vault,
};
use crate::vault::types::VaultSession;

#[derive(Debug, Serialize, Deserialize)]
pub struct IpcRequest {
    /// Действие: get / list / search / save / status / pair /
    /// list-all / update-entry / health / import-entries / backup.
    /// Пустое значение — старый формат (только domain), трактуется как "get".
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub entry: Option<serde_json::Value>,
    /// Массовые операции (import-entries): массив черновиков записей.
    #[serde(default)]
    pub entries: Option<Vec<serde_json::Value>>,
    /// Ключ доверенного клиента, выдаётся после подтверждения в UI (pair).
    #[serde(default)]
    pub key: Option<String>,
    /// Имя клиента для диалога подтверждения.
    #[serde(default)]
    pub client: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpcResponse {
    pub success: bool,
    pub username: Option<String>,
    pub password: Option<String>,
    pub totp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<serde_json::Value>>,
    /// Произвольные данные новых действий (health-отчёт, сводка импорта).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unlocked: Option<bool>,
    /// Ключ сессии, выдаётся один раз при успешном pair.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub error: Option<String>,
}

impl IpcResponse {
    fn error(message: &str) -> Self {
        Self {
            success: false,
            username: None,
            password: None,
            totp: None,
            entries: None,
            data: None,
            unlocked: None,
            key: None,
            error: Some(message.to_string()),
        }
    }

    fn ok() -> Self {
        Self {
            success: true,
            username: None,
            password: None,
            totp: None,
            entries: None,
            data: None,
            unlocked: None,
            key: None,
            error: None,
        }
    }
}

#[cfg(target_os = "windows")]
pub async fn run_ipc_server(state: Arc<AppStateInner>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::net::windows::named_pipe::{PipeMode, ServerOptions};

    loop {
        // tokio ServerOptions не принимает SECURITY_ATTRIBUTES, а прав на
        // смену DACL готового хендла не хватает — создаём пайп сами.
        let pipe = match create_secure_pipe() {
            Ok(p) => p,
            Err(e) => {
                crate::log_warn!("IPC secure pipe failed (default ACL): {e}");
                ServerOptions::new()
                    .first_pipe_instance(true)
                    .pipe_mode(PipeMode::Message)
                    .create("\\\\.\\pipe\\mynx")?
            }
        };

        // Ждём подключения клиента ДО создания следующего экземпляра pipe.
        // Без этого цикл крутится без await: плодит тысячи pipe'ов и задач
        // в секунду — 100% CPU и утечка памяти/дескрипторов вешают систему.
        if let Err(e) = pipe.connect().await {
            crate::log_error!("IPC accept error: {e}");
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        }

        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(pipe, state).await {
                crate::log_warn!("IPC connection error: {e}");
            }
        });
    }
}

/// Создать серверный конец пайпа с явным DACL: только текущий пользователь
/// (+ SYSTEM и админы), наследование запрещено. tokio ServerOptions не
/// принимает SECURITY_ATTRIBUTES, поэтому CreateNamedPipeW делаем сами,
/// а готовый хендл отдаём tokio (он сам регистрирует его в IOCP).
#[cfg(target_os = "windows")]
fn create_secure_pipe() -> Result<tokio::net::windows::named_pipe::NamedPipeServer, String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
    };
    use windows::Win32::Security::{
        GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
        TOKEN_USER,
    };
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_OVERLAPPED, PIPE_ACCESS_DUPLEX,
    };
    use windows::Win32::System::Pipes::{
        CreateNamedPipeW, PIPE_READMODE_MESSAGE, PIPE_TYPE_MESSAGE, PIPE_UNLIMITED_INSTANCES,
        PIPE_WAIT,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // RAII-закрытие токена процесса на всех путях выхода.
    struct TokenGuard(HANDLE);
    impl Drop for TokenGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    unsafe {
        // SID текущего пользователя
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|e| format!("OpenProcessToken: {}", e))?;
        let _token_guard = TokenGuard(token);

        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        if len == 0 {
            return Err("GetTokenInformation size query failed".to_string());
        }
        let mut buf = vec![0u8; len as usize];
        GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), len, &mut len)
            .map_err(|e| format!("GetTokenInformation: {}", e))?;
        let sid = (*(buf.as_ptr() as *const TOKEN_USER)).User.Sid;

        let mut sid_pwstr = PWSTR::null();
        ConvertSidToStringSidW(sid, &mut sid_pwstr)
            .map_err(|e| format!("ConvertSidToStringSidW: {}", e))?;
        let sid_string = sid_pwstr.to_string().unwrap_or_default();
        let _ = LocalFree(HLOCAL(sid_pwstr.0 as *mut _));
        if sid_string.is_empty() {
            return Err("empty user SID".to_string());
        }

        // Protected DACL: пользователь, SYSTEM, админы — полный доступ; наследование запрещено.
        let sddl: Vec<u16> = format!("D:P(A;;GA;;;{})(A;;GA;;;SY)(A;;GA;;;BA)", sid_string)
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut psd = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            1, // SDDL_REVISION_1
            &mut psd,
            None,
        )
        .map_err(|e| format!("ConvertSDDL: {}", e))?;

        let name: Vec<u16> = "\\\\.\\pipe\\mynx".encode_utf16().chain(std::iter::once(0)).collect();
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: psd.0,
            bInheritHandle: BOOL(0),
        };
        // Защита от squatting: имя \\.\pipe\mynx резервируется за нашим
        // процессом через DACL (текущий пользователь + SYSTEM + Admins).
        // FILE_FLAG_FIRST_PIPE_INSTANCE здесь НЕ используется: цикл
        // run_ipc_server обрабатывает соединения в spawned-задачах и должен
        // создавать следующий экземпляр пайпа, пока клиент держит
        // предыдущий. С FIRST_PIPE_INSTANCE CreateNamedPipeW возвращает
        // ERROR_ACCESS_DENIED на втором витке, и IPC-сервер умирает после
        // первого запроса. DACL в SECURITY_ATTRIBUTES ужесточает доступ
        // и без этого флага.
        let open_mode = FILE_FLAGS_AND_ATTRIBUTES(
            PIPE_ACCESS_DUPLEX.0 | FILE_FLAG_OVERLAPPED.0,
        );
        let raw = CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            open_mode,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            65536,
            65536,
            0,
            Some(&sa),
        );
        let _ = LocalFree(HLOCAL(psd.0));
        if raw.is_invalid() {
            return Err(format!(
                "CreateNamedPipeW: {:?}",
                windows::core::Error::from_win32()
            ));
        }

        tokio::net::windows::named_pipe::NamedPipeServer::from_raw_handle(raw.0)
            .map_err(|e| format!("from_raw_handle: {}", e))
    }
}

/// Unix-сокет в $XDG_RUNTIME_DIR (иначе /tmp), привязанный к UID —
/// аналог named pipe \\.\pipe\mynx для Linux.
#[cfg(not(target_os = "windows"))]
fn ipc_socket_path() -> String {
    let dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    // SAFETY: getuid не имеет предусловий и всегда успешен
    format!("{}/mynx-{}.sock", dir, unsafe { libc::getuid() })
}

#[cfg(not(target_os = "windows"))]
pub async fn run_ipc_server(state: Arc<AppStateInner>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;

    let path = ipc_socket_path();
    // Старый сокет от прошлого запуска мог остаться
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    // Только владелец: в сокет ходят пароли из хранилища
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, state).await {
                        crate::log_warn!("IPC connection error: {e}");
                    }
                });
            }
            Err(e) => {
                crate::log_error!("IPC accept error: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
}

/// Обработка уже подключённого клиента (connect/accept делается в цикле сервера).
async fn handle_connection<S>(
    mut pipe: S,
    state: Arc<AppStateInner>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    // Таймауты на чтение: зависший/злонамеренный клиент не должен
    // удерживать задачу и дескриптор пайпа бесконечно.
    const IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
    let timeout_err =
        || std::io::Error::new(std::io::ErrorKind::TimedOut, "IPC read timeout");

    let mut len_buf = [0u8; 4];
    tokio::time::timeout(IO_TIMEOUT, pipe.read_exact(&mut len_buf))
        .await
        .map_err(|_| timeout_err())??;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > 1024 * 1024 {
        return Err("Message too large".into());
    }

    let mut buf = vec![0u8; len];
    tokio::time::timeout(IO_TIMEOUT, pipe.read_exact(&mut buf))
        .await
        .map_err(|_| timeout_err())??;

    let request: IpcRequest = serde_json::from_slice(&buf)?;
    // Диалог pairing ждёт действия пользователя — на обработку свой таймаут.
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        process_request(state, request),
    )
    .await
    .map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::TimedOut, "IPC request timeout")
    })?;

    let response_json = serde_json::to_vec(&response)?;
    let len = response_json.len() as u32;
    pipe.write_all(&len.to_le_bytes()).await?;
    pipe.write_all(&response_json).await?;
    pipe.flush().await?;

    Ok(())
}

async fn process_request(state: Arc<AppStateInner>, request: IpcRequest) -> IpcResponse {
    // Обратная совместимость: старый native host шлёт только domain,
    // пустой action при наличии domain считаем "get".
    let action = if request.action.is_empty() && request.domain.is_some() {
        "get"
    } else {
        request.action.as_str()
    };

    // status не читает файл сейва — только факт разблокировки. Открыт всем:
    // по нему расширение рисует Offline/Locked до pairing.
    if action == "status" {
        let unlocked = state.vault_session.lock().unwrap().is_some();
        let mut resp = IpcResponse::ok();
        resp.unlocked = Some(unlocked);
        return resp;
    }

    // Подтверждение клиента пользователем; ключ живёт до рестарта приложения.
    if action == "pair" {
        return pair_client(&state, request.client).await;
    }

    // Всё, что читает/пишет хранилище, требует доверенный ключ.
    let key_ok = request
        .key
        .as_deref()
        .is_some_and(|k| state.ipc_pair_keys.lock().unwrap().contains(k));
    if !key_ok {
        return IpcResponse::error("pairing_required");
    }

    let session = {
        let guard = state.vault_session.lock().unwrap();
        guard.clone()
    };

    let Some(session) = session else {
        return IpcResponse::error("vault_locked");
    };

    // Backend-enforced autolock: доверенный IPC-клиент тоже не получает
    // секреты из простоявшей сессии (та же проверка, что и на HTTP API).
    if state.enforce_autolock().is_err() {
        return IpcResponse::error("vault_locked");
    }

    match action {
        "get" => {
            let Some(domain) = request.domain.as_deref() else {
                return IpcResponse::error("domain required");
            };
            let entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };
            // Записи из корзины расширению не отдаём.
            let entries: Vec<serde_json::Value> = entries.into_iter().filter(is_active).collect();

            let domain = normalize_domain(domain);
            let mut best: Option<&serde_json::Value> = None;
            let mut best_score = 0;

            for entry in &entries {
                let Some(entry_url) = entry.get("url").and_then(|v| v.as_str()) else {
                    continue;
                };
                let entry_domain = normalize_domain(entry_url);
                if entry_domain.is_empty() {
                    continue;
                }

                let score = domain_score(&domain, &entry_domain);
                if score > best_score {
                    best_score = score;
                    best = Some(entry);
                }
            }

            let Some(entry) = best else {
                return IpcResponse::error("no_match");
            };

            let mut resp = IpcResponse::ok();
            resp.username = entry
                .get("username")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            resp.password = entry
                .get("password")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            resp.totp = entry
                .get("totpSecret")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            resp
        }
        "list" => {
            let Some(domain) = request.domain.as_deref() else {
                return IpcResponse::error("domain required");
            };
            let entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };
            // Записи из корзины расширению не отдаём.
            let entries: Vec<serde_json::Value> = entries.into_iter().filter(is_active).collect();

            let domain = normalize_domain(domain);
            let mut matched: Vec<(usize, &serde_json::Value)> = Vec::new();

            for entry in &entries {
                let Some(entry_url) = entry.get("url").and_then(|v| v.as_str()) else {
                    continue;
                };
                let entry_domain = normalize_domain(entry_url);
                if entry_domain.is_empty() {
                    continue;
                }

                let score = domain_score(&domain, &entry_domain);
                if score > 0 {
                    matched.push((score, entry));
                }
            }

            // Сначала наиболее точные совпадения
            matched.sort_by_key(|(score, _)| std::cmp::Reverse(*score));

            let list: Vec<serde_json::Value> = matched
                .into_iter()
                .map(|(_, entry)| pick_fields(entry, &[("title", "title"), ("username", "username"), ("password", "password"), ("totp", "totpSecret"), ("url", "url")]))
                .collect();

            let mut resp = IpcResponse::ok();
            resp.entries = Some(list);
            resp
        }
        "search" => {
            let entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };
            // Записи из корзины расширению не отдаём.
            let entries: Vec<serde_json::Value> = entries.into_iter().filter(is_active).collect();

            // Без паролей: только то, что нужно для выбора записи в расширении
            let list: Vec<serde_json::Value> = entries
                .iter()
                .map(|entry| pick_fields(entry, &[("title", "title"), ("username", "username"), ("url", "url")]))
                .collect();

            let mut resp = IpcResponse::ok();
            resp.entries = Some(list);
            resp
        }
        "save" => {
            let Some(entry) = request.entry else {
                return IpcResponse::error("entry required");
            };
            let mut entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };

            let field = |name: &str| entry.get(name).cloned().unwrap_or(serde_json::Value::Null);
            let now = chrono::Utc::now().timestamp_millis();
            let pw_str = entry.get("password").and_then(|v| v.as_str()).unwrap_or("");
            // Формат записи совпадает с тем, что создаёт фронт (QuickAdd)
            let mut new_entry = serde_json::json!({
                "id": new_entry_id(),
                "title": field("title"),
                "username": field("username"),
                "password": field("password"),
                "url": field("url"),
                "category": "",
                "tags": [],
                "favorite": false,
                "strength": estimate_strength(pw_str),
                "createdAt": now,
                "updatedAt": now,
            });
            if let Some(notes) = entry
                .get("notes")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                new_entry["notes"] = serde_json::Value::String(notes.to_string());
            }
            entries.push(new_entry);

            let entries_json = match serde_json::to_string(&entries) {
                Ok(j) => j,
                Err(e) => return IpcResponse::error(&e.to_string()),
            };

            let vault_path = std::path::Path::new(&session.vault_id);
            match save_entries_to_vault(
                vault_path,
                &session.encryption_key,
                &session.payload_key,
                session.is_decoy,
                &entries_json,
            ) {
                Ok(()) => IpcResponse::ok(),
                Err(e) => IpcResponse::error(&e.to_string()),
            }
        }
        "list-all" => {
            // Полный список активных записей БЕЗ паролей: идентификаторы и
            // организация (категория/избранное) для DnD-сортировки в попапе.
            let entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };
            let list: Vec<serde_json::Value> = entries
                .iter()
                .filter(|e| is_active(e))
                .map(|entry| {
                    pick_fields(
                        entry,
                        &[
                            ("id", "id"),
                            ("title", "title"),
                            ("username", "username"),
                            ("url", "url"),
                            ("category", "category"),
                            ("favorite", "favorite"),
                            ("updatedAt", "updatedAt"),
                        ],
                    )
                })
                .collect();

            let mut resp = IpcResponse::ok();
            resp.entries = Some(list);
            resp
        }
        "update-entry" => {
            // Точечная правка организации записи (категория/избранное) —
            // используется drag&drop в расширении. Пароль не трогаем.
            let Some(patch) = request.entry else {
                return IpcResponse::error("entry required");
            };
            let Some(id) = patch.get("id").and_then(|v| v.as_str()) else {
                return IpcResponse::error("entry id required");
            };
            let mut entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };

            let Some(entry) = entries
                .iter_mut()
                .find(|e| is_active(e) && e.get("id").and_then(|v| v.as_str()) == Some(id))
            else {
                return IpcResponse::error("no_match");
            };

            if let Some(category) = patch.get("category").and_then(|v| v.as_str()) {
                entry["category"] = serde_json::Value::String(category.to_string());
            }
            if let Some(favorite) = patch.get("favorite").and_then(|v| v.as_bool()) {
                entry["favorite"] = serde_json::Value::Bool(favorite);
            }
            entry["updatedAt"] = serde_json::json!(chrono::Utc::now().timestamp_millis());

            let entries_json = match serde_json::to_string(&entries) {
                Ok(j) => j,
                Err(e) => return IpcResponse::error(&e.to_string()),
            };
            let vault_path = std::path::Path::new(&session.vault_id);
            match save_entries_to_vault(
                vault_path,
                &session.encryption_key,
                &session.payload_key,
                session.is_decoy,
                &entries_json,
            ) {
                Ok(()) => IpcResponse::ok(),
                Err(e) => IpcResponse::error(&e.to_string()),
            }
        }
        "health" => {
            // Health-отчёт считается здесь, где живут пароли: наружу уходят
            // ТОЛЬКО агрегаты и метаданные — ни одного пароля в ответе.
            let entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };
            let active: Vec<&serde_json::Value> = entries.iter().filter(|e| is_active(e)).collect();
            let total = active.len();

            let threshold_days = request
                .entry
                .as_ref()
                .and_then(|e| e.get("thresholdDays"))
                .and_then(|v| v.as_u64())
                .unwrap_or(180);

            let now_ms = chrono::Utc::now().timestamp_millis();

            let strength_of = |e: &serde_json::Value| -> u64 {
                e.get("strength")
                    .and_then(|v| v.as_u64())
                    .unwrap_or_else(|| {
                        estimate_strength(e.get("password").and_then(|v| v.as_str()).unwrap_or(""))
                    })
            };

            // Возраст пароля: passwordHistory[0].changedAt → createdAt → updatedAt
            let changed_at = |e: &serde_json::Value| -> Option<i64> {
                if let Some(hist) = e.get("passwordHistory").and_then(|v| v.as_array()) {
                    if let Some(at) = hist
                        .first()
                        .and_then(|h| h.get("changedAt"))
                        .and_then(|v| v.as_i64())
                    {
                        return Some(at);
                    }
                }
                if let Some(at) = e.get("createdAt").and_then(|v| v.as_i64()) {
                    return Some(at);
                }
                e.get("updatedAt").and_then(|v| v.as_i64())
            };
            let age_days = |e: &serde_json::Value| -> Option<i64> {
                changed_at(e).map(|at| (now_ms - at).max(0) / (24 * 3600 * 1000))
            };

            // Повторы: одинаковый непустой пароль у разных записей
            let mut pw_counts: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();
            for e in &active {
                if let Some(pw) = e.get("password").and_then(|v| v.as_str()) {
                    if !pw.is_empty() {
                        *pw_counts.entry(pw.to_string()).or_default() += 1;
                    }
                }
            }
            let is_reused = |e: &serde_json::Value| -> bool {
                e.get("password")
                    .and_then(|v| v.as_str())
                    .and_then(|pw| pw_counts.get(pw).map(|c| *c > 1))
                    .unwrap_or(false)
            };

            let mut weak = Vec::new();
            let mut reused = Vec::new();
            let mut rotation_due = Vec::new();
            let mut no2fa = Vec::new();
            let mut ages: Vec<i64> = Vec::new();
            let mut strength_sum: u64 = 0;

            for e in &active {
                let strength = strength_of(e);
                strength_sum += strength;
                let age = age_days(e);
                if let Some(a) = age {
                    ages.push(a);
                }
                let meta = entry_meta(e, strength, age);
                if strength < 50 {
                    weak.push(meta.clone());
                }
                if is_reused(e) {
                    reused.push(meta);
                }
                if threshold_days > 0 {
                    if let Some(a) = age {
                        if a > threshold_days as i64 {
                            rotation_due.push(entry_meta(e, strength, age));
                        }
                    }
                }
                let has_totp = e
                    .get("totpSecret")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty());
                let tagged = e
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .is_some_and(|tags| tags.iter().any(|t| t.as_str() == Some("2fa")));
                if !has_totp && !tagged {
                    no2fa.push(entry_meta(e, strength, age));
                }
            }

            let base_strength = if total > 0 {
                (strength_sum / total as u64) as i64
            } else {
                0
            };
            let avg_age = if ages.is_empty() {
                None
            } else {
                Some((ages.iter().sum::<i64>() / ages.len() as i64) as u64)
            };

            // Штрафы, зеркально health.ts: повторы до −20, просрочка до −15
            let reuse_share = if total > 0 { reused.len() as f64 / total as f64 } else { 0.0 };
            let rotation_share =
                if total > 0 { rotation_due.len() as f64 / total as f64 } else { 0.0 };
            let penalty = (reuse_share * 40.0).round().min(20.0) as i64
                + (rotation_share * 30.0).round().min(15.0) as i64;
            let score = if total == 0 {
                0
            } else {
                (base_strength - penalty).clamp(0, 100)
            };

            let mut resp = IpcResponse::ok();
            resp.data = Some(serde_json::json!({
                "total": total,
                "score": score,
                "baseStrength": base_strength.clamp(0, 100) as u64,
                "avgPasswordAgeDays": avg_age,
                "thresholdDays": threshold_days,
                "weak": weak,
                "reused": reused,
                "rotationDue": rotation_due,
                "no2fa": no2fa,
            }));
            resp
        }
        "import-entries" => {
            // Массовый импорт CSV (Chrome/Bitwarden) из попапа с дедупликацией:
            // скипаем черновики, у которых совпадает нормализованный домен и
            // имя пользователя с уже существующей активной записью.
            let Some(drafts) = request.entries else {
                return IpcResponse::error("entries required");
            };
            let mut entries = match load_entries(&session) {
                Ok(e) => e,
                Err(e) => return IpcResponse::error(&e),
            };

            let mut existing_keys: std::collections::HashSet<String> = entries
                .iter()
                .filter(|e| is_active(e))
                .map(import_key)
                .collect();

            let now = chrono::Utc::now().timestamp_millis();
            let mut imported: usize = 0;
            let mut skipped: usize = 0;
            for draft in drafts {
                let field = |name: &str| {
                    draft
                        .get(name)
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default()
                };
                let (title, username, password, url) =
                    (field("title"), field("username"), field("password"), field("url"));
                // Пустые и неполные строки CSV пропускаем
                if username.is_empty() || password.is_empty() {
                    skipped += 1;
                    continue;
                }
                let key = import_key(&serde_json::json!({ "url": url, "username": username }));
                if existing_keys.contains(&key) {
                    skipped += 1;
                    continue;
                }
                existing_keys.insert(key);
                entries.push(serde_json::json!({
                    "id": new_entry_id(),
                    "title": if title.is_empty() { url_or_domain(&url, &username) } else { title },
                    "username": username,
                    "password": password,
                    "url": url,
                    "category": "",
                    "tags": [],
                    "favorite": false,
                    "strength": estimate_strength(&password),
                    "createdAt": now,
                    "updatedAt": now,
                }));
                imported += 1;
            }

            if imported > 0 {
                let entries_json = match serde_json::to_string(&entries) {
                    Ok(j) => j,
                    Err(e) => return IpcResponse::error(&e.to_string()),
                };
                let vault_path = std::path::Path::new(&session.vault_id);
                if let Err(e) = save_entries_to_vault(
                    vault_path,
                    &session.encryption_key,
                    &session.payload_key,
                    session.is_decoy,
                    &entries_json,
                ) {
                    return IpcResponse::error(&e.to_string());
                }
            }

            let mut resp = IpcResponse::ok();
            resp.data = Some(serde_json::json!({ "imported": imported, "skipped": skipped }));
            resp
        }
        "backup" => {
            // Бэкап активного хранилища по запросу доверенного клиента
            // (расширение, chrome.alarms). Параметры синхронизирует фронт
            // командой set_ipc_backup_prefs — расширение путь не выбирает.
            let prefs = state.ipc_backup_prefs.lock().unwrap().clone();
            let Some(prefs) = prefs else {
                return IpcResponse::error("backup_not_configured");
            };
            match run_vault_backup_files(&session.vault_id, &prefs.backup_path, prefs.keep_count) {
                Ok(()) => {
                    let mut resp = IpcResponse::ok();
                    resp.data = Some(serde_json::json!({
                        "backedUp": true,
                        "at": chrono::Utc::now().timestamp_millis(),
                    }));
                    resp
                }
                Err(e) => IpcResponse::error(&e),
            }
        }
        _ => IpcResponse::error("unknown_action"),
    }
}

/// Pairing: нативный системный диалог (виден даже при свёрнутом окне),
/// по подтверждению выдаётся одноразовый ключ сессии. Ключи живут
/// в памяти до рестарта приложения.
async fn pair_client(state: &Arc<AppStateInner>, client: Option<String>) -> IpcResponse {
    use tauri::Manager;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let client = client
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    {
        let mut active = state.pairing_active.lock().unwrap();
        if *active {
            return IpcResponse::error("pairing_busy");
        }
        *active = true;
    }
    // Сброс флага на любом пути выхода.
    struct ResetOnDrop(Arc<AppStateInner>);
    impl Drop for ResetOnDrop {
        fn drop(&mut self) {
            *self.0.pairing_active.lock().unwrap() = false;
        }
    }
    let _guard = ResetOnDrop(state.clone());

    let app = state.app_handle.lock().unwrap().clone();
    let Some(app) = app else {
        return IpcResponse::error("no_ui");
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
    }

    // blocking_show — модальный системный диалог; выполняем вне async-рантайма.
    let lang = state.language.lock().unwrap().clone();
    let (title, message, allow, deny) = if lang == "ru" {
        (
            "Mynx — Запрос доступа",
            format!(
                "«{}» запрашивает доступ к данным хранилища.\n\nДоступ действует до перезапуска приложения.",
                client
            ),
            "Разрешить",
            "Отклонить",
        )
    } else {
        (
            "Mynx — Access request",
            format!(
                "\"{}\" requests access to your vault data.\n\nAccess stays valid until the app restarts.",
                client
            ),
            "Allow",
            "Deny",
        )
    };
    let approved = tokio::task::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                allow.to_string(),
                deny.to_string(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);

    if !approved {
        return IpcResponse::error("pairing_denied");
    }

    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("random");
    let key: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    state.ipc_pair_keys.lock().unwrap().insert(key.clone());

    let mut resp = IpcResponse::ok();
    resp.key = Some(key);
    resp
}

/// Прочитать файл сейва и расшифровать записи активного слоя сессии.
fn load_entries(session: &VaultSession) -> Result<Vec<serde_json::Value>, String> {
    let vault_path = std::path::Path::new(&session.vault_id);
    let vault = load_vault_file(vault_path).map_err(|e| e.to_string())?;
    let entries_json = decrypt_entries(&session.payload_key, active_payload(&vault, session.is_decoy))
        .map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&entries_json).unwrap_or_default())
}

/// Запись не в корзине (корзина помечается полем deletedAt, см. src/stores/vault.ts).
fn is_active(entry: &serde_json::Value) -> bool {
    entry.get("deletedAt").is_none_or(|v| v.is_null())
}

/// Собрать объект из выбранных полей записи: (ключ в ответе, ключ в записи).
fn pick_fields(entry: &serde_json::Value, fields: &[(&str, &str)]) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    for (out_key, entry_key) in fields {
        obj.insert(
            out_key.to_string(),
            entry.get(*entry_key).cloned().unwrap_or(serde_json::Value::Null),
        );
    }
    serde_json::Value::Object(obj)
}

/// Метаданные записи для health-отчёта: БЕЗ пароля — только заголовок,
/// логин, URL, сила и возраст пароля.
fn entry_meta(
    entry: &serde_json::Value,
    strength: u64,
    age_days: Option<i64>,
) -> serde_json::Value {
    serde_json::json!({
        "id": entry.get("id").cloned().unwrap_or(serde_json::Value::Null),
        "title": entry.get("title").cloned().unwrap_or(serde_json::Value::Null),
        "username": entry.get("username").cloned().unwrap_or(serde_json::Value::Null),
        "url": entry.get("url").cloned().unwrap_or(serde_json::Value::Null),
        "strength": strength,
        "ageDays": age_days,
    })
}

/// Порт calculateStrength (src/stores/vault.ts): одинаковые баллы,
/// чтобы health-данные были согласованы между фронтом и IPC.
fn estimate_strength(pw: &str) -> u64 {
    if pw.is_empty() {
        return 0;
    }
    let mut s: u64 = 0;
    let len = pw.chars().count();
    if len >= 12 {
        s += 25;
    }
    if len >= 16 {
        s += 15;
    }
    if pw.chars().any(|c| c.is_ascii_lowercase()) {
        s += 15;
    }
    if pw.chars().any(|c| c.is_ascii_uppercase()) {
        s += 15;
    }
    if pw.chars().any(|c| c.is_ascii_digit()) {
        s += 15;
    }
    if pw.chars().any(|c| !c.is_ascii_alphanumeric()) {
        s += 15;
    }
    s.min(100)
}

/// Ключ дедупликации импорта: нормализованный домен + username
/// (та же логика приоритетов, что и в dedupe.ts фронтенда).
fn import_key(entry: &serde_json::Value) -> String {
    let url = entry.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let username = entry
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    format!("{}|{}", normalize_domain(url), username)
}

/// Заголовок по умолчанию для записи без названия: домен из URL, иначе логин.
fn url_or_domain(url: &str, username: &str) -> String {
    let domain = normalize_domain(url);
    if !domain.is_empty() {
        return domain.to_string();
    }
    username.to_string()
}

/// UUID v4 — тот же формат id, что выдаёт фронт через crypto.randomUUID().
fn new_entry_id() -> String {
    let bytes = CryptoModule::generate_random_bytes(16).expect("random");
    let mut b: [u8; 16] = bytes.try_into().expect("16 bytes");
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

// normalize_domain / domain_score переехали в api.rs как единый источник
// правды: строгий скоринг eTLD+1 (exact host → 1000, тот же регистрируемый
// домен → 500, всё остальное → 0). Дубль здесь исторически расходился
// с api.rs и содержал уязвимый contains()-матчинг.
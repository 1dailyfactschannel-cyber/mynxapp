use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;

/// SHA256 «правильного» mynx.exe. Если exe пересобран — обновите здесь
/// и пересоберите mynx-native-host.exe. Получить:
///   Get-FileHash "$env:LOCALAPPDATA\Mynx\mynx.exe" -Algorithm SHA256
///
/// Authenticode-подпись проверяется ОС при запуске (если сертификат
/// доверенный). Эта проверка ловит подмену бинарника даже когда
/// атакующий не смог получить доверенный сертификат.
const EXPECTED_MYNX_SHA256: &str = "616c2d43c34c73813ecdf40d389d1384218192826addc076a13d90ee6a55844a";

#[derive(Debug, Serialize, Deserialize)]
struct NativeMessage {
    r#type: String,
    domain: Option<String>,
    entry: Option<serde_json::Value>,
    /// Массовые операции (import-entries): массив черновиков записей.
    entries: Option<Vec<serde_json::Value>>,
    /// Ключ доверенного клиента (получен через pair).
    key: Option<String>,
    /// Имя клиента для диалога подтверждения.
    client: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IpcRequest {
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entry: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entries: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IpcResponse {
    success: bool,
    username: Option<String>,
    password: Option<String>,
    totp: Option<String>,
    entries: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    unlocked: Option<bool>,
    key: Option<String>,
    error: Option<String>,
}

fn main() {
    // Проверяем целостность mynx.exe ДО обработки любых сообщений.
    // Если exe подменён — нативный хост сразу завершается, расширение
    // видит «host unavailable» и не отправляет пароли скомпрометированному
    // процессу. Чтобы обойти эту защиту, атакующему придётся одновременно
    // подменить и mynx.exe, и mynx-native-host.exe.
    if let Err(e) = verify_desktop_integrity() {
        eprintln!("mynx-native-host: integrity check failed: {e}");
        // Возвращаем JSON-ошибку в stdout, чтобы расширение увидело
        // осмысленный ответ вместо молчаливого разрыва pipe.
        let resp = serde_json::json!({
            "type": "error",
            "message": format!("desktop_integrity_invalid: {e}"),
        });
        let bytes = serde_json::to_vec(&resp).unwrap();
        let len = bytes.len() as u32;
        let _ = std::io::stdout().write_all(&len.to_le_bytes());
        let _ = std::io::stdout().write_all(&bytes);
        let _ = std::io::stdout().flush();
        std::process::exit(2);
    }

    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    loop {
        let mut len_buf = [0u8; 4];
        if stdin.read_exact(&mut len_buf).is_err() {
            break;
        }
        let len = u32::from_le_bytes(len_buf) as usize;
        if len > 1024 * 1024 {
            break;
        }

        let mut buf = vec![0u8; len];
        if stdin.read_exact(&mut buf).is_err() {
            break;
        }

        let response = match serde_json::from_slice::<NativeMessage>(&buf) {
            Ok(msg) => handle_message(msg),
            Err(e) => serde_json::json!({
                "type": "error",
                "message": format!("invalid message: {}", e),
            }),
        };

        let response_json = serde_json::to_vec(&response).unwrap();
        let len = response_json.len() as u32;
        let _ = stdout.write_all(&len.to_le_bytes());
        let _ = stdout.write_all(&response_json);
        let _ = stdout.flush();
    }
}

fn handle_message(msg: NativeMessage) -> serde_json::Value {
    // Пробрасываем ключ и имя клиента во все IPC-запросы.
    let ipc = |action: &str, domain: Option<String>, entry: Option<serde_json::Value>| IpcRequest {
        action: action.to_string(),
        domain,
        entry,
        entries: msg.entries.clone(),
        key: msg.key.clone(),
        client: msg.client.clone(),
    };

    match msg.r#type.as_str() {
        "get-credentials" => {
            let Some(domain) = msg.domain else {
                return serde_json::json!({
                    "type": "credentials",
                    "success": false,
                    "error": "domain required",
                });
            };

            match send_ipc(ipc("get", Some(domain), None)) {
                Ok(data) => serde_json::json!({
                    "type": "credentials",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "credentials",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "list-credentials" => {
            let Some(domain) = msg.domain else {
                return serde_json::json!({
                    "type": "credentials-list",
                    "success": false,
                    "error": "domain required",
                });
            };

            match send_ipc(ipc("list", Some(domain), None)) {
                Ok(data) => serde_json::json!({
                    "type": "credentials-list",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "credentials-list",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "search-credentials" => {
            match send_ipc(ipc("search", None, None)) {
                Ok(data) => serde_json::json!({
                    "type": "search-results",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "search-results",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "save-credential" => {
            let Some(entry) = msg.entry else {
                return serde_json::json!({
                    "type": "credential-saved",
                    "success": false,
                    "error": "entry required",
                });
            };

            match send_ipc(ipc("save", None, Some(entry))) {
                Ok(data) => serde_json::json!({
                    "type": "credential-saved",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "credential-saved",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "status" => {
            match send_ipc(ipc("status", None, None)) {
                Ok(data) => serde_json::json!({
                    "type": "status",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "status",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "list-all-entries" => {
            match send_ipc(ipc("list-all", None, None)) {
                Ok(data) => serde_json::json!({
                    "type": "all-entries",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "all-entries",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "update-entry" => {
            let Some(entry) = msg.entry else {
                return serde_json::json!({
                    "type": "entry-updated",
                    "success": false,
                    "error": "entry required",
                });
            };
            match send_ipc(ipc("update-entry", None, Some(entry))) {
                Ok(data) => serde_json::json!({
                    "type": "entry-updated",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "entry-updated",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "get-health" => {
            match send_ipc(ipc("health", None, msg.entry.clone())) {
                Ok(data) => serde_json::json!({
                    "type": "health-report",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "health-report",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "import-entries" => {
            let Some(entries) = msg.entries.clone() else {
                return serde_json::json!({
                    "type": "import-result",
                    "success": false,
                    "error": "entries required",
                });
            };
            let mut req = ipc("import-entries", None, None);
            req.entries = Some(entries);
            match send_ipc(req) {
                Ok(data) => serde_json::json!({
                    "type": "import-result",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "import-result",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "vault-backup" => {
            match send_ipc(ipc("backup", None, None)) {
                Ok(data) => serde_json::json!({
                    "type": "backup-done",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "backup-done",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "pair" => {
            match send_ipc(ipc("pair", None, None)) {
                Ok(data) => serde_json::json!({
                    "type": "paired",
                    "success": true,
                    "data": data,
                }),
                Err(e) => serde_json::json!({
                    "type": "paired",
                    "success": false,
                    "error": e.to_string(),
                }),
            }
        }
        "ping" => serde_json::json!({"type": "pong"}),
        _ => serde_json::json!({
            "type": "error",
            "message": "unknown message type",
        }),
    }
}

fn send_ipc(request: IpcRequest) -> Result<IpcResponse, Box<dyn std::error::Error>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async move {
        #[cfg(target_os = "windows")]
        let mut pipe = {
            use tokio::net::windows::named_pipe::ClientOptions;
            ClientOptions::new().open("\\\\.\\pipe\\mynx")?
        };
        // Unix-сокет, тот же путь, что слушает приложение (ipc.rs)
        #[cfg(not(target_os = "windows"))]
        let mut pipe = {
            let dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
            // SAFETY: getuid не имеет предусловий и всегда успешен
            let path = format!("{}/mynx-{}.sock", dir, unsafe { libc::getuid() });
            tokio::net::UnixStream::connect(path).await?
        };

        let request_json = serde_json::to_vec(&request)?;
        pipe.write_all(&(request_json.len() as u32).to_le_bytes()).await?;
        pipe.write_all(&request_json).await?;
        pipe.flush().await?;

        let mut len_buf = [0u8; 4];
        pipe.read_exact(&mut len_buf).await?;
        let len = u32::from_le_bytes(len_buf) as usize;
        if len > 1024 * 1024 {
            return Err("Response too large".into());
        }

        let mut buf = vec![0u8; len];
        pipe.read_exact(&mut buf).await?;

        let response: IpcResponse = serde_json::from_slice(&buf)?;
        Ok(response)
    })
}

/// Проверить, что mynx.exe (рядом с native host) не подменён:
/// вычисляем SHA256 и сверяем с захардкоженным значением.
///
/// Authenticode-подпись проверяется ОС при запуске (если сертификат
/// доверенный). Эта проверка — второй уровень: даже если exe
/// переподписан валидным (например, украденным) сертификатом, его
/// хеш всё равно не совпадёт, и нативный хост откажется работать.
fn verify_desktop_integrity() -> Result<(), String> {
    // Sentinel: при первом запуске EXPECTED_MYNX_SHA256 равен нулям.
    // Это означает, что проверка ещё не настроена — пропускаем, чтобы
    // загрузка вообще стартовала. Продакшен-билд обязан заменить ноли
    // на реальный хеш.
    if EXPECTED_MYNX_SHA256.chars().all(|c| c == '0') {
        eprintln!("mynx-native-host: integrity check DISABLED (hash not set)");
        return Ok(());
    }

    let exe_path: PathBuf = std::env::current_exe()
        .map_err(|e| format!("current_exe: {e}"))?
        .parent()
        .ok_or("no parent dir")?
        .join("mynx.exe");

    if !exe_path.exists() {
        return Err(format!("mynx.exe not found at {}", exe_path.display()));
    }

    let bytes = std::fs::read(&exe_path)
        .map_err(|e| format!("read {}: {e}", exe_path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual = hasher.finalize();
    let actual_hex: String = actual
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();

    if !actual_hex.eq_ignore_ascii_case(EXPECTED_MYNX_SHA256) {
        return Err(format!(
            "hash mismatch: expected {}, got {}",
            EXPECTED_MYNX_SHA256, actual_hex
        ));
    }

    Ok(())
}

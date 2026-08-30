use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Serialize, Deserialize)]
struct NativeMessage {
    r#type: String,
    domain: Option<String>,
    entry: Option<serde_json::Value>,
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
    unlocked: Option<bool>,
    key: Option<String>,
    error: Option<String>,
}

fn main() {
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

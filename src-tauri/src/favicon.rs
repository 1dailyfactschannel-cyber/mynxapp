//! Favicon fetcher для записей хранилища.
//!
//! CSP webview запрещает внешние запросы (connect-src 'self'), поэтому
//! иконки сайтов качает нативный слой и отдаёт фронтенду байтами.
//! Двухшаговый фолбэк (DuckDuckGo → Google s2), кэш в памяти на сутки,
//! ограничение размера, таймаут. Никаких секретов в запросах.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_BYTES: usize = 300 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Serialize, Clone)]
pub struct FaviconData {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

type Cache = HashMap<String, Option<(FaviconData, Instant)>>;

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .user_agent("Mynx-Favicon/1.3")
                .build()
                .expect("failed to build reqwest client")
        })
        .clone()
}

/// Домен из произвольной строки URL: "https://api.github.com/x" →
/// "api.github.com"; "github.com:443" → "github.com"; пусто → None.
fn host_of(raw: &str) -> Option<String> {
    let s = raw.trim();
    let s = if let Some(idx) = s.find("://") {
        &s[idx + 3..]
    } else {
        s
    };
    let s = s.split(['/', '?', '#']).next()?;
    let s = s.rsplit('@').next()?; // userinfo: user:pass@host
    let host = s.split(':').next()?; // порт
    if host.is_empty() {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

/// Сетевой фетч: два публичных сервиса иконок по очереди.
async fn fetch_favicon_net(host: &str) -> Result<FaviconData, String> {
    let cl = client();
    let candidates = [
        format!("https://icons.duckduckgo.com/ip3/{host}.ico"),
        format!("https://www.google.com/s2/favicons?domain={host}&sz=64"),
    ];

    for url in candidates {
        let Ok(resp) = cl.get(&url).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let raw_ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let ct = raw_ct.split(';').next().unwrap_or("").trim().to_string();
        if !ct.starts_with("image/") && ct != "application/octet-stream" {
            continue;
        }
        let Ok(body) = resp.bytes().await else {
            continue;
        };
        if body.is_empty() || body.len() > MAX_BYTES {
            continue;
        }
        return Ok(FaviconData {
            content_type: if ct.is_empty() { "image/png".into() } else { ct },
            bytes: body.to_vec(),
        });
    }

    Err("favicon_not_found".to_string())
}

/// Иконка сайта для записи. Возвращает content-type и байты изображения
/// (PNG/ICO/JPEG — фронтенд сам собирает data: URL).
#[tauri::command]
pub async fn fetch_favicon(url: String) -> Result<FaviconData, String> {
    let host = host_of(&url).ok_or_else(|| "invalid_url".to_string())?;

    // Кэш: положительный — на сутки, отрицательный — не кэшируем
    let cached = cache().lock().unwrap().get(&host).cloned();
    if let Some(Some((data, at))) = cached {
        if at.elapsed() < CACHE_TTL {
            return Ok(data);
        }
    }

    let data = fetch_favicon_net(&host).await?;
    cache()
        .lock()
        .unwrap()
        .insert(host, Some((data.clone(), Instant::now())));
    Ok(data)
}

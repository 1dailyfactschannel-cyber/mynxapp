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
///
/// SECURITY: хост подставляется в путь к публичному сервису иконок
/// (duckduckgo.com/ip3/<host>.ico). Без строгой валидации
/// Unicode-homoglyphs / path-traversal (`..`, слеши) уйдут в чужой
/// сервис и могут вызвать там SSRF или резолв странных имён.
/// Принимаем только ASCII LDH (буквы/цифры/дефис) + точки, минимум
/// один разделитель, длина ≤ 253, каждый label ≤ 63 (RFC 1035).
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

    // Только ASCII LDH + точки. Юникод-гомоглифы и спец-символы
    // (newlines, control bytes, %xx) — отбрасываем.
    if !host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-') {
        return None;
    }
    if host.len() > 253 {
        return None;
    }
    if !host.contains('.') {
        return None; // нужен хотя бы один label-разделитель
    }
    // Каждый label: непустой, ≤ 63 символа, не начинается/кончается дефисом.
    if host.split('.').any(|label| {
        label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-')
    }) {
        return None;
    }
    // Валидный TLD: ≥ 2 алфавитных символа в последнем label.
    if let Some(tld) = host.rsplit('.').next() {
        if tld.len() < 2 || !tld.bytes().all(|b| b.is_ascii_alphabetic()) {
            return None;
        }
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

#[cfg(test)]
mod tests {
    use super::host_of;

    #[test]
    fn host_of_accepts_plain() {
        assert_eq!(host_of("https://github.com"), Some("github.com".into()));
        assert_eq!(host_of("github.com"), Some("github.com".into()));
        assert_eq!(host_of("https://API.GitHub.com/path?x=1#f"), Some("api.github.com".into()));
        assert_eq!(host_of("user:pass@github.com:443"), Some("github.com".into()));
        assert_eq!(host_of("  https://github.com  "), Some("github.com".into()));
    }

    #[test]
    fn host_of_rejects_path_traversal_and_specials() {
        // Path traversal: наша функция извлекает только host-часть, поэтому
        // `github.com/../x` корректно сводится к `github.com` — это безопасно,
        // мы используем host как параметр пути к публичному сервису иконок.
        assert_eq!(host_of("https://github.com/../x"), Some("github.com".into()));
        // Но хост-часть сама по себе не должна быть `..` или содержать слэши.
        assert_eq!(host_of("https://../etc/passwd"), None);
        // Невалидные схемы и data-URI — отбрасываем целиком.
        assert_eq!(host_of("javascript:alert(1)"), None);
        assert_eq!(host_of("data:text/html,<x>"), None);
        assert_eq!(host_of(""), None);
        assert_eq!(host_of("   "), None);
        // Без точки — слишком общо, отбрасываем
        assert_eq!(host_of("localhost"), None);
        assert_eq!(host_of("github"), None);
    }

    #[test]
    fn host_of_rejects_unicode_and_control() {
        // Unicode homoglyphs (Cyrillic 'а' вместо ASCII 'a') — отбрасываем
        assert_eq!(host_of("https://gith\u{0443}b.com"), None);
        // Control bytes, newlines
        assert_eq!(host_of("github\n.com"), None);
        assert_eq!(host_of("github\r.com"), None);
    }

    #[test]
    fn host_of_rejects_label_violations() {
        // Слишком длинный общий хост (>253)
        let too_long = format!("{}.com", "a".repeat(250));
        assert_eq!(host_of(&too_long), None);
        // Слишком длинный label (>63)
        let bad_label = format!("{}.com", "a".repeat(64));
        assert_eq!(host_of(&bad_label), None);
        // Пустой label
        assert_eq!(host_of("foo..bar.com"), None);
        // Старт/конец с дефиса
        assert_eq!(host_of("-foo.com"), None);
        assert_eq!(host_of("foo-.com"), None);
    }
}

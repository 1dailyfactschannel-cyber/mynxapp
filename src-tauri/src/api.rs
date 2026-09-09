use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::commands::AppStateInner;
use crate::vault::operations::{active_payload, decrypt_entries, load_vault_file};

#[derive(Clone)]
pub struct ApiState {
    pub app_state: Arc<AppStateInner>,
}

#[derive(Serialize)]
struct StatusResponse {
    unlocked: bool,
    version: String,
}

#[derive(Deserialize)]
struct CredentialsRequest {
    domain: String,
}

#[derive(Serialize)]
struct CredentialsResponse {
    username: String,
    password: String,
    totp: Option<String>,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

/// DNS-rebinding / cross-site guard applied to every route:
/// - the Host header must name a loopback address — a request arriving with
///   any other Host (e.g. attacker.com re-bound to 127.0.0.1) is rejected;
/// - a browser Origin is only accepted from a browser extension
///   (chrome-extension://, moz-extension://, safari-web-extension://).
///   Plain web pages and non-browser tools without Origin are unaffected:
///   the former get rejected, the latter still need the Bearer token.
async fn host_origin_guard(
    headers: axum::http::HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let host_ok = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|h| {
            let h = h.trim();
            let name = match h.strip_prefix('[') {
                Some(rest) => rest.split(']').next().unwrap_or(""),
                None => h.split(':').next().unwrap_or(""),
            };
            name.eq_ignore_ascii_case("localhost") || name == "127.0.0.1" || name == "::1"
        });
    if !host_ok {
        return (StatusCode::FORBIDDEN, "forbidden_host").into_response();
    }

    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let allowed = origin.starts_with("chrome-extension://")
            || origin.starts_with("moz-extension://")
            || origin.starts_with("safari-web-extension://");
        if !allowed {
            return (StatusCode::FORBIDDEN, "forbidden_origin").into_response();
        }
    }

    next.run(request).await
}

async fn status(State(state): State<ApiState>) -> impl IntoResponse {
    let unlocked = state.app_state.vault_session.lock().unwrap().is_some();
    Json(StatusResponse {
        unlocked,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn credentials(
    State(state): State<ApiState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<CredentialsRequest>,
) -> Result<Json<CredentialsResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Rate limit failed-token guessing (shared in-memory backoff).
    if let Some(wait) = state.app_state.api_attempts.retry_after("api_token") {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse {
                error: format!("too_many_attempts: retry in {} seconds", wait.as_secs().max(1)),
            }),
        ));
    }

    // Check auth token
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "));
    let expected = state.app_state.api_token.lock().unwrap().clone();
    if auth != Some(expected.as_str()) {
        state.app_state.api_attempts.record_failure("api_token");
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "invalid_token".to_string(),
            }),
        ));
    }
    state.app_state.api_attempts.reset("api_token");

    // Backend-enforced autolock: idle session is wiped even if the UI timer
    // was bypassed (webview suspended, tampered frontend, direct API calls).
    if state.app_state.enforce_autolock().is_err() {
        return Err((
            StatusCode::LOCKED,
            Json(ErrorResponse {
                error: "vault_locked".to_string(),
            }),
        ));
    }

    // Check unlocked
    let session = {
        let guard = state.app_state.vault_session.lock().unwrap();
        guard.clone()
    };
    let Some(session) = session else {
        return Err((
            StatusCode::LOCKED,
            Json(ErrorResponse {
                error: "vault_locked".to_string(),
            }),
        ));
    };

    // Load entries
    let vault_path = std::path::Path::new(&session.vault_id);
    let vault = load_vault_file(vault_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e.to_string() }),
        )
    })?;
    let entries_json = decrypt_entries(&session.payload_key, active_payload(&vault, session.is_decoy)).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e.to_string() }),
        )
    })?;

    let entries: Vec<serde_json::Value> =
        serde_json::from_str(&entries_json).unwrap_or_default();

    // Find best matching entry by domain
    let domain = normalize_domain(&req.domain);
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
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "no_match".to_string(),
            }),
        ));
    };

    Ok(Json(CredentialsResponse {
        username: entry
            .get("username")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        password: entry
            .get("password")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        totp: entry
            .get("totpSecret")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }))
}

pub(crate) fn normalize_domain(url: &str) -> String {
    let url = url.trim().to_lowercase();
    let url = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .unwrap_or(&url);
    let host = url.split('/').next().unwrap_or_default();
    host.strip_prefix("www.")
        .unwrap_or(host)
        .to_string()
}

/// Approximate registrable domain (eTLD+1) without a full Public Suffix
/// List: the last two labels, except for known two-label public suffixes
/// where three labels are taken.
///
/// LIMITATION: this is a curated list, not the real Public Suffix List
/// (no suitable crate is vendored and the build must stay offline-friendly).
/// Besides country-code second levels (co.uk, com.au, ...) it covers the
/// well-known shared-hosting suffixes (github.io, web.app, herokuapp.com,
/// ...) so that credentials saved for one tenant's subdomain are never
/// offered on another tenant's subdomain of the same hosting platform.
/// Suffixes missing from this list fall back to last-two-labels matching.
///
/// PUBLIC_SUFFIXES is sorted; lookup uses binary search.
fn registrable_domain(host: &str) -> String {
    // Lowercase and drop a trailing dot so "EXAMPLE.com." == "example.com";
    // empty labels (double dots) are filtered out below. Punycode/IDN ASCII
    // hosts pass through unchanged; no panics on any input.
    let host = host.trim_end_matches('.').to_lowercase();
    let labels: Vec<&str> = host.split('.').filter(|l| !l.is_empty()).collect();
    if labels.len() <= 2 {
        return labels.join(".");
    }
    // Sorted ascending — keep it that way, binary_search depends on it.
    const PUBLIC_SUFFIXES: &[&str] = &[
        "ac.uk", "amazonaws.com", "azurewebsites.net", "blogspot.com",
        "cloudfront.net", "co.il", "co.in", "co.jp", "co.nz", "co.uk", "co.za",
        "com.au", "com.br", "com.cn", "com.mx", "com.tr", "com.ua", "eu.org",
        "firebaseapp.com", "fly.dev", "github.io", "gitlab.io", "glitch.me",
        "gov.uk", "herokuapp.com", "me.uk", "myshopify.com", "ne.jp",
        "neocities.org", "net.au", "netlify.app", "or.jp", "org.au", "org.uk",
        "pages.dev", "railway.app", "render.com", "repl.co", "squarespace.com",
        "surge.sh", "tumblr.com", "vercel.app", "web.app", "wixsite.com",
        "wordpress.com", "workers.dev",
    ];
    let last_two = labels[labels.len() - 2..].join(".");
    if PUBLIC_SUFFIXES.binary_search(&last_two.as_str()).is_ok() {
        labels[labels.len() - 3..].join(".")
    } else {
        last_two
    }
}

/// SECURITY: the old scorer used bidirectional `contains()`, so a lookalike
/// domain like "evil-paypal.com" or "paypal.com.evil.io" matched a saved
/// "paypal.com" entry and received the stored password. Matching is now
/// strict: exact host, or the same registrable domain (subdomains of the
/// same site). Anything else scores 0 — no credentials are returned.
pub(crate) fn domain_score(request: &str, candidate: &str) -> usize {
    if request == candidate {
        return 1000; // exact host match
    }
    let req_registrable = registrable_domain(request);
    let cand_registrable = registrable_domain(candidate);
    if !req_registrable.is_empty() && req_registrable == cand_registrable {
        return 500; // same site: subdomain / www variants
    }
    0 // lookalike or unrelated domain — never match
}

pub fn build_router(app_state: Arc<AppStateInner>) -> Router {
    let state = ApiState { app_state };
    Router::new()
        .route("/api/status", get(status))
        .route("/api/credentials", post(credentials))
        .layer(middleware::from_fn(host_origin_guard))
        .with_state(state)
}

pub async fn run_api_server(app_state: Arc<AppStateInner>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let router = build_router(app_state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:5149").await?;
    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_host_match() {
        assert_eq!(domain_score("paypal.com", "paypal.com"), 1000);
    }

    #[test]
    fn test_same_registrable_domain() {
        assert_eq!(domain_score("secure.paypal.com", "paypal.com"), 500);
        assert_eq!(domain_score("paypal.com", "www.paypal.com"), 500);
        assert_eq!(domain_score("a.b.example.co.uk", "example.co.uk"), 500);
    }

    #[test]
    fn test_lookalike_domains_never_match() {
        // The vulnerabilities that made the old `contains()` scorer dangerous:
        assert_eq!(domain_score("evil-paypal.com", "paypal.com"), 0);
        assert_eq!(domain_score("paypal.com.evil.io", "paypal.com"), 0);
        assert_eq!(domain_score("notpaypal.com", "paypal.com"), 0);
        assert_eq!(domain_score("paypal.com", "myevil-paypal.com"), 0);
        assert_eq!(domain_score("paypa1.com", "paypal.com"), 0);
    }

    #[test]
    fn test_registrable_domain_extraction() {
        assert_eq!(registrable_domain("paypal.com"), "paypal.com");
        assert_eq!(registrable_domain("secure.paypal.com"), "paypal.com");
        assert_eq!(registrable_domain("a.b.example.co.uk"), "example.co.uk");
        assert_eq!(registrable_domain("evil.io"), "evil.io");
        // Shared-hosting public suffixes: the tenant label is part of the
        // registrable domain.
        assert_eq!(registrable_domain("victim.github.io"), "victim.github.io");
        assert_eq!(registrable_domain("app.pages.dev"), "app.pages.dev");
        assert_eq!(registrable_domain("site.herokuapp.com"), "site.herokuapp.com");
        // Case and trailing-dot normalization.
        assert_eq!(registrable_domain("WWW.Example.COM."), "example.com");
        assert_eq!(registrable_domain(""), "");
    }

    #[test]
    fn test_cross_tenant_shared_hosting_never_matches() {
        // Different tenants of the same hosting platform must not share
        // credentials even though the last two labels are identical.
        assert_eq!(domain_score("attacker.github.io", "victim.github.io"), 0);
        assert_eq!(domain_score("a.web.app", "b.web.app"), 0);
        assert_eq!(domain_score("foo.vercel.app", "bar.vercel.app"), 0);
        // The same tenant's subdomains still match.
        assert_eq!(domain_score("www.victim.github.io", "victim.github.io"), 500);
        assert_eq!(domain_score("victim.github.io", "victim.github.io"), 1000);
    }
}

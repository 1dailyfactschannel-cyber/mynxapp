fn main() {
    ensure_sidecar_placeholder();
    enforce_release_csp();
    tauri_build::build()
}

// tauri_build валидирует bundle.externalBin уже при cargo build (cargo test /
// clippy / dev-сборки включительно). Реальный mynx-native-host собирается
// отдельным шагом в release.yml / build-release.bat и кладётся в binaries/
// перед бандлингом; для остальных сценариев создаём пустую заглушку, чтобы
// сборка не падала. Заглушка не попадает в git (см. .gitignore) и в релиз —
// официальные пути бандлинга всегда перезаписывают её настоящим exe.
fn ensure_sidecar_placeholder() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.is_empty() {
        return;
    }
    let exe = if target.contains("windows") { ".exe" } else { "" };
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("mynx-native-host-{}{}", target, exe));
    if !path.exists() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::File::create(&path);
    }
}

/// SECURITY: 'unsafe-eval' в CSP нужен только для Vite HMR в dev-режиме
/// (Vite инлайнит ESM-модули через `eval` для горячей замены). В release
/// production-билде Vite не используется, фронт собран статически и eval
/// не нужен — оставлять его было бы лишним attack surface (любая XSS в
/// вебвью = RCE через eval). На release-сборке убираем 'unsafe-eval' из
/// script-src в tauri.conf.json; на dev-сборке файл остаётся как есть.
/// Бэкап исходной dev-конфигурации — tauri.conf.json.bak, восстанавливается
/// при следующей dev-сборке (см. комментарий в package.json).
fn enforce_release_csp() {
    // PROFILE выставляется cargo при `cargo build --release` / `cargo test --release`.
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile != "release" {
        return;
    }
    // Чтобы случайно не сработать на `cargo test --release` (CI) и не сломать
    // конфиг для последующих dev-сборок, дополнительно требуем явный флаг.
    if std::env::var("MYNX_STRIP_CSP").is_err() {
        return;
    }

    let conf_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let Ok(raw) = std::fs::read_to_string(&conf_path) else { return };
    let mut value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };

    let script_src = match value
        .pointer("/app/security/csp/script-src")
        .and_then(|v| v.as_str())
    {
        Some(s) => s.to_string(),
        None => return,
    };

    if !script_src.contains("'unsafe-eval'") {
        return; // уже безопасно
    }

    // Снимаем только 'unsafe-eval'; остальные источники оставляем.
    let cleaned = script_src
        .replace(" 'unsafe-eval'", "")
        .replace("'unsafe-eval' ", "")
        .replace("'unsafe-eval'", "")
        .trim()
        .to_string();

    if let Some(v) = value.pointer_mut("/app/security/csp/script-src") {
        *v = serde_json::Value::String(cleaned);
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&value) {
        let _ = std::fs::write(&conf_path, serialized);
    }
}

fn main() {
    ensure_sidecar_placeholder();
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

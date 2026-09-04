use std::path::Path;

use tauri::State;

use super::app_state::{AppState, IpcBackupPrefs};
use super::device_key::session_keys;
use super::types::BackupRequest;

/// Верхняя граница keep_count: больше 100 бэкапов одного vault
/// — мусор, и при сортировке/фильтрации легко словить намёк на DoS.
pub const MAX_KEEP_COUNT: usize = 100;

/// Copy the vault file and its device key to the backup folder.
/// No master password needed: we back up the already-encrypted files.
#[tauri::command]
pub async fn vault_backup(request: BackupRequest, state: State<'_, AppState>) -> Result<(), String> {
    session_keys(&state, &request.vault_id)?;
    let keep_count = request.keep_count.min(MAX_KEEP_COUNT);
    run_vault_backup_files(&request.vault_id, &request.backup_path, keep_count)
}

/// Общая рутина бэкапа: используется и Tauri-командой vault_backup,
/// и IPC-действием "backup" (расширение по расписанию chrome.alarms).
pub fn run_vault_backup_files(
    vault_id: &str,
    backup_path: &str,
    keep_count: usize,
) -> Result<(), String> {
    let vault_path = Path::new(vault_id);
    if !vault_path.exists() {
        return Err("Vault file not found".to_string());
    }
    let keep_count = keep_count.min(MAX_KEEP_COUNT);

    let backup_dir = Path::new(backup_path);
    std::fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;

    let vault_name = vault_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("vault");
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");

    let backup_vault_path = backup_dir.join(format!("{}-{}.safepass", vault_name, timestamp));
    let backup_dk_path = backup_dir.join(format!("{}-{}.safepass.dk", vault_name, timestamp));

    std::fs::copy(vault_path, &backup_vault_path).map_err(|e| e.to_string())?;

    let dk_path = vault_path.with_extension("safepass.dk");
    if dk_path.exists() {
        std::fs::copy(&dk_path, &backup_dk_path).map_err(|e| e.to_string())?;
    }

    // Удаляем старые бэкапы сверх keep_count
    let mut backups: Vec<_> = std::fs::read_dir(backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|e| e.to_str()) == Some("safepass") {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    backups.sort_by(|a, b| {
        let a_time = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let b_time = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });

    for old in backups.iter().skip(keep_count) {
        let _ = std::fs::remove_file(old);
        let _ = std::fs::remove_file(old.with_extension("safepass.dk"));
    }

    Ok(())
}

/// Синхронизация настроек бэкапа из фронта: после этого доверенные
/// IPC-клиенты могут запускать бэкап тех же файлов (ipc.rs, "backup").
#[tauri::command]
pub fn set_ipc_backup_prefs(
    backup_path: String,
    keep_count: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if backup_path.trim().is_empty() {
        return Err("Backup path is empty".to_string());
    }
    let keep_count = keep_count.min(MAX_KEEP_COUNT);
    *state.inner.ipc_backup_prefs.lock().unwrap() = Some(IpcBackupPrefs {
        backup_path,
        keep_count,
    });
    Ok(())
}

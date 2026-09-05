use super::types::ExportResponse;

/// Save bytes to a user-picked location via the native Save dialog.
/// Used for files generated in the webview (QR-code PNG): the embedded
/// WebView2 does not process <a download> clicks, so saving goes through Rust.
#[tauri::command]
pub async fn save_png_file(request: super::types::SavePngRequest) -> Result<ExportResponse, String> {
    let Some(target_path) = pick_save_path(
        &request.default_name,
        "Mynx - Save PNG",
        "PNG Image",
        "png",
    ) else {
        return Ok(ExportResponse {
            path: String::new(),
            cancelled: true,
        });
    };

    std::fs::write(&target_path, &request.bytes).map_err(|e| e.to_string())?;

    Ok(ExportResponse {
        path: target_path.to_string_lossy().to_string(),
        cancelled: false,
    })
}

/// Native Windows "Save as" dialog. Returns None when the user cancels.
#[cfg(target_os = "windows")]
pub fn pick_save_path(
    default_name: &str,
    title: &str,
    filter_label: &str,
    filter_ext: &str,
) -> Option<std::path::PathBuf> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Controls::Dialogs::{
        GetSaveFileNameW, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    let mut file_buf = vec![0u16; 1024];
    let default_wide: Vec<u16> = default_name.encode_utf16().collect();
    file_buf[..default_wide.len()].copy_from_slice(&default_wide);

    let filter_wide: Vec<u16> = format!(
        "{} (*.{})\0*.{}\0All Files (*.*)\0*.*\0\0",
        filter_label, filter_ext, filter_ext
    )
    .encode_utf16()
    .collect();
    let title_wide: Vec<u16> = format!("{}\0", title).encode_utf16().collect();
    let def_ext: Vec<u16> = format!("{}\0", filter_ext).encode_utf16().collect();

    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: PCWSTR(filter_wide.as_ptr()),
        lpstrFile: PWSTR(file_buf.as_mut_ptr()),
        nMaxFile: file_buf.len() as u32,
        lpstrTitle: PCWSTR(title_wide.as_ptr()),
        lpstrDefExt: PCWSTR(def_ext.as_ptr()),
        Flags: OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        ..Default::default()
    };

    let ok = unsafe { GetSaveFileNameW(&mut ofn) };
    if !ok.as_bool() {
        return None; // user cancelled
    }

    let len = file_buf
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(file_buf.len());
    Some(std::path::PathBuf::from(String::from_utf16_lossy(
        &file_buf[..len],
    )))
}

/// Non-Windows fallback: save next to the executable without a dialog.
#[cfg(not(target_os = "windows"))]
pub fn pick_save_path(
    default_name: &str,
    _title: &str,
    _filter_label: &str,
    _filter_ext: &str,
) -> Option<std::path::PathBuf> {
    let base = std::env::current_exe().ok()?.parent()?.to_path_buf();
    Some(base.join(default_name))
}

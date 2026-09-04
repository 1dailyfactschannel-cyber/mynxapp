use tauri::State;

use crate::crypto::Aes256GcmAead;

use super::app_state::AppState;
use super::types::SecureCopyRequest;

/// Положить секрет в защищённый буфер: шифруется AES-256-GCM ключом,
/// который живёт только в памяти процесса. Глобальный буфер обмена
/// не используется вообще.
#[tauri::command]
pub async fn secure_copy(
    request: SecureCopyRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.inner.enforce_autolock()?;
    let ciphertext = Aes256GcmAead::encrypt_with_aad(
        &state.inner.secure_clip_key,
        request.text.as_bytes(),
        b"mynx:clipboard",
    )
    .map_err(|e| e.to_string())?;
    let mut clip = state.inner.secure_clipboard.lock().unwrap();
    *clip = Some(ciphertext);
    Ok(())
}

/// Вставка из защищённого буфера: расшифровка в памяти и прямой ввод
/// через SendInput, минуя глобальный буфер. Буфер одноразовый —
/// после вставки очищается.
#[tauri::command]
pub async fn secure_paste(state: State<'_, AppState>) -> Result<(), String> {
    let ciphertext = {
        let mut clip = state.inner.secure_clipboard.lock().unwrap();
        clip.take()
    };
    let Some(ciphertext) = ciphertext else {
        return Err("secure_buffer_empty".to_string());
    };

    let plaintext =
        Aes256GcmAead::decrypt_with_aad(&state.inner.secure_clip_key, &ciphertext, b"mynx:clipboard")
            .map_err(|e| e.to_string())?;
    let text = String::from_utf8(plaintext).map_err(|e| e.to_string())?;

    crate::auto_type::wait_for_modifiers_released();
    std::thread::sleep(std::time::Duration::from_millis(500));
    crate::auto_type::type_text(&text)
}

/// Есть ли что вставлять (для UI-индикатора)
#[tauri::command]
pub async fn secure_copy_available(state: State<'_, AppState>) -> Result<bool, String> {
    let clip = state.inner.secure_clipboard.lock().unwrap();
    Ok(clip.is_some())
}

# Mynx — Смена мастер-пароля (Master Password Change)

## Общий принцип

Смена мастер-пароля = **полное ре-шифрование vault** с новым salt и новым ключом. Старый мастер-пароль сразу становится невалидным. Это атомарная операция: либо всё прошло успешно, либо остаётся старый vault.

```
User Input (Old MP) ──→ Verify ──→ User Input (New MP) ──→ Re-encrypt ──→ Done
                               │                              │
                               ▼                              ▼
                         [Old Salt]                      [New Salt]
                         [Old Argon2id]                  [New Argon2id]
                         [Old Key]                       [New Key]
```

---

## Flow смены (UX)

### Экран 1: Подтверждение личности
```
+----------------------------------------------------------+
|  Change Master Password                                  |
+----------------------------------------------------------+
|                                                          |
|  ⚠️  This will re-encrypt your entire vault.            |
|      Make sure you remember the new password.           |
|                                                          |
|  Current password:                                       |
|  [••••••••••••••]  [👁]                                 |
|                                                          |
|  [Continue]  [Cancel]                                    |
+----------------------------------------------------------+
```
- **Обязательно**: ввод текущего мастер-пароля для верификации
- Если неверно: shake анимация + "Incorrect password. Vault remains locked."
- **Нельзя** сменить пароль без знания текущего (нет backdoor recovery)

### Экран 2: Новый пароль
```
+----------------------------------------------------------+
|  Set New Master Password                                 |
+----------------------------------------------------------+
|                                                          |
|  New password:                                           |
|  [••••••••••••••]  [👁]                                 |
|  Strength: [██████░░░░] Fair (54/100)                  |
|  ⚠️  Consider using a longer password or passphrase.     |
|                                                          |
|  Confirm password:                                       |
|  [••••••••••••••]  [👁]                                 |
|  ❌ Passwords do not match                               |
|                                                          |
|  ┌────────────────────────────────────────────────────┐  |
|  │  💡 Tip: Use a memorable phrase like:               │  |
|  │     "correct-horse-battery-staple!47"              │  |
|  │     Easy to remember, hard to crack.               │  |
|  └────────────────────────────────────────────────────┘  |
|                                                          |
|  [Change Password]  [Cancel]                             |
+----------------------------------------------------------+
```
- **Проверка силы**: zxcvbn (Dropbox), показываем entropy и feedback
- **Минимальные требования** (configurable, default):
  - Длина ≥ 12 символов
  - Хотя бы 1 заглавная, 1 строчная, 1 цифра, 1 символ
  - Или passphrase ≥ 4 слова (diceware)
- **Match check**: если New ≠ Confirm → кнопка disabled + красный текст
- **Генератор**: кнопка "Generate strong passphrase" рядом с полем

### Экран 3: Предупреждение + Emergency Kit
```
+----------------------------------------------------------+
|  ⚠️  Important: Update Your Emergency Kit                 |
+----------------------------------------------------------+
|                                                          |
|  Your vault has been re-encrypted with the new password. |
|  Your old Emergency Kit is now INVALID.                 |
|                                                          |
|  ┌────────────────────────────────────────────────────┐  |
|  │  ❗ Action required:                                │  |
|  │     1. Print or save the new Emergency Kit        │  |
|  │     2. Destroy the old one (shred / delete)       │  │
|  │     3. Store it somewhere safe (offline)            │  │
|  └────────────────────────────────────────────────────┘  |
|                                                          |
|  [📄 Generate New Emergency Kit]                         |
|  [🔒 Lock Vault Now]                                    |
|  [Remind me later (not recommended)]                     |
+----------------------------------------------------------+
```
- **После смены**: mandatory modal, нельзя закрыть без explicit action
- Emergency Kit содержит новый salt, device key (QR), и новую ключевую фразу
- Если пользователь нажимает "Remind me later" → показываем предупреждение: "Your old Emergency Kit will not work. If you forget the new password, your data is lost."

---

## Технический процесс (Backend)

### Шаг 1: Верификация
```rust
fn verify_current_password(vault: &Vault, master_password: &str) -> Result<bool> {
    let salt = vault.header.salt;
    let params = vault.header.kdf_params; // Argon2id m=64MB, t=3, p=4
    let device_key = keychain_get_device_key()?;
    
    // Derive old key
    let old_primary = argon2id_hash(master_password, &salt, &params)?;
    let old_enc_key = hkdf_sha256(&old_primary, &device_key, b"safepass-v1-enc-key", 32)?;
    
    // Try decrypt header
    match vault.header.decrypt_verify(&old_enc_key) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false), // Wrong password, but don't leak timing
    }
}
```
- **Timing-safe comparison**: не используем `==` для ключей, используем `subtle::ConstantTimeEq`
- **Rate limiting**: после 3 неудачных попыток → 30 секундная задержка (exponential backoff)

### Шаг 2: Авто-бэкап (before change)
```rust
fn auto_backup_before_change(vault: &Vault) -> Result<PathBuf> {
    let backup_path = get_backup_dir()?.join(format!("vault-pre-change-{}.safepass", timestamp()));
    fs::copy(&vault.path, &backup_path)?;
    // Limit backup count: keep only last 10 auto-backups
    rotate_backups(get_backup_dir()?, 10)?;
    Ok(backup_path)
}
```
- **Обязательно**: создаём backup текущего vault перед любой модификацией
- Если re-encrypt ломается → restore из backup

### Шаг 3: Ре-шифрование
```rust
fn change_master_password(
    vault: &mut Vault,
    old_password: &str,
    new_password: &str,
) -> Result<()> {
    // 1. Verify old password
    if !verify_current_password(vault, old_password)? {
        return Err(Error::WrongPassword);
    }
    
    // 2. Auto-backup
    let backup_path = auto_backup_before_change(vault)?;
    
    // 3. Generate NEW salt (CRITICAL: never reuse old salt)
    let new_salt = generate_random_bytes(16)?; // 128-bit
    
    // 4. Derive NEW primary key with new salt
    let new_primary = argon2id_hash(new_password, &new_salt, &vault.header.kdf_params)?;
    let device_key = keychain_get_device_key()?; // Device key stays the same
    let new_enc_key = hkdf_sha256(&new_primary, &device_key, b"safepass-v1-enc-key", 32)?;
    
    // 5. Decrypt payload with OLD key
    let old_primary = argon2id_hash(old_password, &vault.header.salt, &vault.header.kdf_params)?;
    let old_enc_key = hkdf_sha256(&old_primary, &device_key, b"safepass-v1-enc-key", 32)?;
    let plaintext_payload = vault.decrypt_payload(&old_enc_key)?;
    
    // 6. Re-encrypt payload with NEW key
    let new_encrypted_payload = encrypt_payload(&plaintext_payload, &new_enc_key)?;
    
    // 7. Atomic write: write to temp file → rename → replace
    let temp_path = vault.path.with_extension("tmp");
    let new_vault = VaultFile {
        header: VaultHeader {
            magic: b"SAFEPASS",
            version: 1,
            salt: new_salt, // NEW
            kdf_params: vault.header.kdf_params.clone(),
            encrypted_header: encrypt_header(&vault.header.inner, &new_enc_key)?,
        },
        payload: new_encrypted_payload,
    };
    new_vault.write_to_file(&temp_path)?;
    fs::rename(&temp_path, &vault.path)?; // Atomic on POSIX
    
    // 8. Sync to disk (flush)
    #[cfg(unix)]
    std::fs::File::open(&vault.path)?.sync_all()?;
    
    // 9. Zeroize ALL sensitive data
    old_primary.zeroize();
    old_enc_key.zeroize();
    new_primary.zeroize();
    new_enc_key.zeroize();
    plaintext_payload.zeroize();
    
    // 10. Update vault state in memory
    vault.header.salt = new_salt;
    vault.encryption_key = new_enc_key; // This one stays in locked memory for session
    
    Ok(())
}
```

### Ключевые моменты безопасности

| Момент | Защита |
|--------|--------|
| **Salt reuse** | ❌ Запрещено. Новый salt при каждой смене. |
| **Old key в памяти** | Zeroize сразу после использования. |
| **Plaintext payload** | Держится в памяти минимальное время, zeroize после. |
| **Atomic write** | Temp file → rename. Не оставляем corrupted state. |
| **Backup** | Создаём перед изменением, храним 10 штук. |
| **Device key** | Не меняется. Остаётся в OS Keychain. |
| **Rate limiting** | 3 попытки → 30s delay, 5 → 5 min, 10 → 1 hour. |

---

## Emergency Kit Update Flow

После смены пароля Emergency Kit **обязательно** обновляется, потому что он содержит:
1. Salt (изменился)
2. Key derivation parameters
3. Device Key (QR-код) — не изменился, но старый Kit уже неверен из-за salt

### Новый Emergency Kit содержит:
```
+----------------------------------------------------------+
|  Mynx Emergency Kit                                  |
|  ────────────────────────────────────────────────────    |
|  Generated: 2026-07-19 14:30:05                           |
|  THIS IS THE ONLY WAY TO RECOVER YOUR VAULT             |
|  Store it offline, in a safe, or a bank deposit box.     |
|  ────────────────────────────────────────────────────    |
|                                                          |
|  Vault ID: mynx-abc123-def456-ghi789                |
|  Salt (hex): a3f7e2d9c1b8a5f4e3d2c1b0a9f8e7d6          |
|  KDF: Argon2id (m=64MB, t=3, p=4)                      |
|  ────────────────────────────────────────────────────    |
|  [QR CODE: Device Key]                                   |
|  [QR CODE: Salt + Vault ID]                              |
|  ────────────────────────────────────────────────────    |
|  IMPORTANT:                                              |
|  • This Kit is linked to THIS vault file.               |
|  • If you forget your master password, you need this    |
|    Kit + your memory of the password to recover.        |
|  • Without this Kit and the password, data is LOST.     |
|  • Print this page. Do not store it digitally.          |
+----------------------------------------------------------+
```

---

## Edge Cases

### Забыл старый пароль
- ❌ **Нельзя сменить**. Нет recovery, нет backdoor.
- Опция: если есть Emergency Kit → можно создать новый vault и импортировать (если был экспорт)
- Или: brute-force невозможен при сильном пароле (Argon2id)

### Смена пароля прервалась на середине (crash, power loss)
- **Atomic write**: если temp файл не переименован → старый vault остаётся нетронутым
- При следующем запуске: Mynx проверяет temp файл → удаляет его → использует старый vault
- Backup остаётся в `backups/` — можно restore вручную

### Слабый новый пароль
- zxcvbn показывает score < 3 → предупреждение: "This password is weak. Your vault will be vulnerable to brute-force attacks. Consider a passphrase."
- Не блокируем, но **warning** + требуем подтверждение: "I understand the risk"

### Длительность операции
- Argon2id (64MB, t=3, p=4) ~ 300-500ms на современном CPU
- Re-encrypt vault: для 1000 записей ~ 50-100ms
- **Total**: ~1 секунда. Показываем spinner + "Re-encrypting vault..."

---

## API Commands

```rust
#[tauri::command]
async fn verify_master_password(
    password: String,
    state: State<'_, AppState>
) -> Result<bool, String> {
    // Returns true/false, rate limited
}

#[tauri::command]
async fn change_master_password(
    old_password: String,
    new_password: String,
    state: State<'_, AppState>
) -> Result<PasswordChangeResult, String> {
    // 1. Verify old
    // 2. Validate new (strength, length)
    // 3. Auto-backup
    // 4. Re-encrypt with new salt + new key
    // 5. Return result with emergency_kit_required flag
}

#[tauri::command]
async fn generate_emergency_kit(
    state: State<'_, AppState>
) -> Result<PdfData, String> {
    // Generate PDF with current salt, device key QR, vault metadata
}
```

---

## Сводка

| Аспект | Реализация |
|--------|-----------|
| **Требование старого пароля** | ✅ Обязательно. Без исключений. |
| **Новый salt** | ✅ Генерируется каждый раз. Никогда не reuse. |
| **Atomic write** | ✅ Temp → rename. Нет corrupted state. |
| **Auto-backup** | ✅ Перед сменой. Ротация 10 штук. |
| **Zeroize** | ✅ Все старые ключи и plaintext. |
| **Rate limit** | ✅ Exponential backoff на verify. |
| **Emergency Kit** | ✅ Mandatory update. Нельзя пропустить. |
| **Strength check** | ✅ zxcvbn + warning при слабом пароле. |
| **Время** | ~1 секунда для vault < 1000 записей. |

**Это в плане (TODO.md):** Фаза 4 — `vault_change_password`, Фаза 5 — Emergency Kit PDF. Реализация — 2 дня (Rust backend + UI + тесты).

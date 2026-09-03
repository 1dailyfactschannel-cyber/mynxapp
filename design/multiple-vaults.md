# Mynx — Множественные Vaults (Switch Account)

## Концепция

Пользователь может иметь **несколько независимых хранилищ** (vaults). Каждый vault — это отдельный зашифрованный файл `.safepass` со своим мастер-паролем, salt, device key и набором записей. Vaults полностью изолированы друг от друга.

**Сценарии использования:**
- Личный vault + Рабочий vault (разные пароли, разные политики)
- Семейный vault (общий, но защищённый family passphrase)
- Тестовый vault (для импорта/экспериментов)
- Архивный vault (старые пароли, редко нужные)

---

## Архитектура

### Структура vaults

```
~/.mynx/                    (или %APPDATA%\Mynx\)
├── vaults/
│   ├── personal.safepass       ← Личный (default)
│   ├── work.safepass           ← Рабочий
│   ├── family.safepass         ← Семейный
│   └── archive.safepass        ← Архив
├── config.json                 ← Глобальные настройки (не sensitive)
│   {
│     "vaults": [
│       { "id": "abc123", "name": "Personal", "path": "vaults/personal.safepass", "is_default": true },
│       { "id": "def456", "name": "Work", "path": "vaults/work.safepass" },
│       { "id": "ghi789", "name": "Family", "path": "vaults/family.safepass" }
│     ],
│     "last_active_vault": "abc123",
│     "theme": "dark",
│     "language": "ru"
│   }
├── backups/                    ← Бэкапы всех vaults (по имени)
│   ├── personal/
│   │   ├── vault-20260718-143000.safepass
│   │   └── vault-20260719-090000.safepass
│   └── work/
│       └── vault-20260718-160000.safepass
└── logs/                       ← Audit logs (не sensitive, только мета)
    └── audit-2026-07.log
```

**Ключевые правила:**
- Каждый vault — **отдельный файл**, отдельное шифрование, отдельный salt
- `config.json` — **не содержит** sensitive данных. Только список vaults, пути, настройки UI
- Пароль от vault A **не открывает** vault B (даже если одинаковый — разные salts)
- Между переключениями vaults — **полная очистка памяти** (zeroize keys, clear SQLite cache)

---

## UX Flow

### Экран приветствия (Vault Selector)

При запуске Mynx (если vault не открыт):
```
+----------------------------------------------------------+
|                                                          |
|                    [App Icon: 64px]                      |
|                    Mynx                              |
|                                                          |
|  +--------------------------------------------------+  |
|  |  [🔒] Personal          Last: 2 hours ago          |  |
|  |      47 entries | Banking, Social, Work            |  |
|  +--------------------------------------------------+  |
|  |  [🔒] Work              Last: 5 days ago           |  |
|  |      12 entries | Corporate accounts              |  |
|  +--------------------------------------------------+  |
|  |  [🔒] Family            Last: 2 weeks ago          |  |
|  |      8 entries  | Shared subscriptions             |  |
|  +--------------------------------------------------+  |
|                                                          |
|  [+ Create New Vault]    [📂 Open Vault File]           |
+----------------------------------------------------------+
```

- Каждый vault — **glass card** с именем, статистикой, последней активностью
- Клик по vault → открывается Lock Screen (ввод мастер-пароля)
- **Контекстное меню** (правый клик):
  - Rename
  - Set as default (открывать при старте)
  - Backup now
  - Show in folder
  - Delete (c подтверждением + ввод пароля)
- `+ Create New Vault` — wizard создания
- `📂 Open Vault File` — открыть внешний .safepass (например, с флешки)

### Быстрое переключение (внутри приложения)

Если vault уже открыт, в шапке появляется переключатель:
```
+----------------------------------------------------------+
|  🔐 Mynx    [Personal ▼]    [🔍] [⚙] [🔒]           |
+----------------------------------------------------------+
```

Клик по `[Personal ▼]`:
```
+----------------------------------------------------------+
|  🔐 Mynx    [Personal ▼]    [🔍] [⚙] [🔒]           |
+----------------------------------------------------------+
|                ┌────────────────────┐                    |
|                │  [Personal] ✓      │                    |
|                │  [Work]            │                    |
|                │  [Family]          │                    |
|                │  ───────────────── │                    |
|                │  [+ Create New]   │                    |
|                │  [Manage Vaults...]│                    |
|                └────────────────────┘                    |
+----------------------------------------------------------+
```

**При переключении:**
1. **Lock текущего vault** (zeroize keys, очистить SQLite cache, очистить search index)
2. Открыть Lock Screen для нового vault
3. После ввода пароля — открыть новый vault
4. **Горячая клавиша**: `Ctrl+Shift+Tab` → Cycle между vaults (lock + switch)

### Создание нового Vault

```
+----------------------------------------------------------+
|  Create New Vault                                        |
+----------------------------------------------------------+
|                                                          |
|  Vault name:                                             |
|  [My Work Accounts                       ]               |
|                                                          |
|  Location:                                               |
|  [C:\Users\Matt\AppData\Roaming\Mynx\vaults\]        |
|  [📂 Browse...]                                         |
|                                                          |
|  Set as default: [✓]                                    |
|                                                          |
|  [Continue]  [Cancel]                                    |
+----------------------------------------------------------+
```

Продолжение — стандартный wizard (master password, Emergency Kit, etc.) как при первом запуске.

### Manage Vaults (экран настроек)
```
+----------------------------------------------------------+
|  Manage Vaults                                   [✕]     |
+----------------------------------------------------------+
|                                                          |
|  +--------------------------------------------------+  |
|  |  [🔒] Personal  (default)                          |  |
|  |      47 entries | 2.3 MB | Last: 2h ago             |  |
|  |      [Rename] [Backup] [Show in folder] [Delete]   |  |
|  +--------------------------------------------------+  |
|  |  [🔒] Work                                         |  |
|  |      12 entries | 890 KB | Last: 5d ago            |  |
|  |      [Rename] [Backup] [Show in folder] [Delete]   |  |
|  +--------------------------------------------------+  |
|  |  [🔒] Family                                       |  |
|  |      8 entries | 512 KB | Last: 14d ago           |  |
|  |      [Rename] [Backup] [Show in folder] [Delete]   |  |
|  +--------------------------------------------------+  |
|                                                          |
|  [+ Create New Vault]  [📂 Open External Vault]          |
+----------------------------------------------------------+
```

**Действия:**
- **Rename** — меняет имя в config.json, не трогает файл
- **Backup** — немедленный бэкап этого vault
- **Show in folder** — открывает Explorer/Finder с файлом
- **Delete** — перемещает в `~/.mynx/trash/` (30 дней), потом permanent delete. Требует ввод пароля.
- **Change password** — per-vault, как в `master-password-change.md`

---

## Техническая реализация (Rust)

### Vault Manager

```rust
struct VaultManager {
    config: VaultConfig,           // config.json
    active_vault: Option<VaultSession>, // Текущий открытый vault
    vaults: HashMap<String, VaultInfo>, // Все известные vaults
}

struct VaultInfo {
    id: String,                  // UUID
    name: String,
    path: PathBuf,
    created_at: DateTime,
    last_accessed: Option<DateTime>,
    entry_count: Option<usize>, // Кэш, обновляется при открытии
    is_default: bool,
}

struct VaultSession {
    vault_id: String,
    encryption_key: SecretVec<u8>, // Zeroized, locked memory
    db: SqliteConnection,          // Encrypted SQLite
    opened_at: Instant,
    lock_timer: Option<Timer>,
}

impl VaultManager {
    /// Список всех vaults (из config.json)
    fn list_vaults(&self) -> Vec<&VaultInfo> {
        self.vaults.values().collect()
    }
    
    /// Создать новый vault
    fn create_vault(&mut self, name: &str, path: &Path, master_password: &str) -> Result<VaultInfo> {
        // 1. Generate new salt, device key
        // 2. Argon2id + XChaCha20 encryption
        // 3. Create SQLite schema
        // 4. Add to config.json
        // 5. Return VaultInfo
    }
    
    /// Открыть vault (из Lock Screen)
    fn open_vault(&mut self, vault_id: &str, master_password: &str) -> Result<&VaultSession> {
        // 1. Если active_vault существует — СНАЧАЛА lock_and_clear()
        self.lock_active_vault()?;
        
        // 2. Load vault file
        let vault_info = self.vaults.get(vault_id).ok_or(Error::VaultNotFound)?;
        let vault_file = VaultFile::load(&vault_info.path)?;
        
        // 3. Derive key from password + salt + device key
        let enc_key = vault_file.derive_key(master_password, &self.get_device_key()?)?;
        
        // 4. Decrypt and verify
        let plaintext = vault_file.decrypt(&enc_key)?;
        
        // 5. Open SQLite (in-memory or temp)
        let db = init_encrypted_sqlite(&plaintext)?;
        
        // 6. Create session
        self.active_vault = Some(VaultSession {
            vault_id: vault_id.to_string(),
            encryption_key: SecretVec::new(enc_key), // Zeroized on drop
            db,
            opened_at: Instant::now(),
            lock_timer: Some(self.start_auto_lock_timer()),
        });
        
        // 7. Update last_accessed
        self.vaults.get_mut(vault_id).unwrap().last_accessed = Some(Utc::now());
        self.save_config()?;
        
        Ok(self.active_vault.as_ref().unwrap())
    }
    
    /// Закрыть текущий vault + полная очистка памяти
    fn lock_active_vault(&mut self) -> Result<()> {
        if let Some(mut session) = self.active_vault.take() {
            // 1. Zeroize encryption key
            session.encryption_key.zeroize();
            
            // 2. Close SQLite (clear all caches)
            session.db.close()?;
            
            // 3. Drop in-memory search index
            // 4. Clear any cached passwords
            // 5. Force garbage collection hint
        }
        
        // 6. OS-level: advise to drop pages if possible
        #[cfg(target_os = "linux")]
        unsafe { libc::malloc_trim(0); }
        
        Ok(())
    }
    
    /// Переключить vault (lock current + open new)
    fn switch_vault(&mut self, vault_id: &str, master_password: &str) -> Result<&VaultSession> {
        self.lock_active_vault()?;
        self.open_vault(vault_id, master_password)
    }
    
    /// Переименовать vault (только в config, файл не меняется)
    fn rename_vault(&mut self, vault_id: &str, new_name: &str) -> Result<()> {
        if let Some(vault) = self.vaults.get_mut(vault_id) {
            vault.name = new_name.to_string();
            self.save_config()?;
        }
        Ok(())
    }
    
    /// Удалить vault (move to trash, require password)
    fn delete_vault(&mut self, vault_id: &str, master_password: &str) -> Result<()> {
        // 1. Verify password by opening vault
        let temp_session = self.open_vault(vault_id, master_password)?;
        self.lock_active_vault()?; // Immediately close
        
        // 2. Move file to trash folder
        let vault_info = self.vaults.get(vault_id).ok_or(Error::VaultNotFound)?;
        let trash_dir = get_trash_dir()?;
        fs::create_dir_all(&trash_dir)?;
        let trash_path = trash_dir.join(format!("{}-{}", vault_id, vault_info.name));
        fs::rename(&vault_info.path, &trash_path)?;
        
        // 3. Remove from config
        self.vaults.remove(vault_id);
        self.save_config()?;
        
        Ok(())
    }
    
    /// Импортировать внешний vault (например, с флешки)
    fn import_external_vault(&mut self, external_path: &Path, name: &str
    ) -> Result<VaultInfo> {
        // 1. Verify it's a valid .safepass file (check magic header)
        // 2. Copy to vaults/ directory
        let internal_path = get_vaults_dir()?.join(format!("{}.safepass", sanitize(name)));
        fs::copy(external_path, &internal_path)?;
        
        // 3. Add to config
        let info = VaultInfo {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            path: internal_path,
            created_at: Utc::now(),
            last_accessed: None,
            entry_count: None,
            is_default: false,
        };
        self.vaults.insert(info.id.clone(), info.clone());
        self.save_config()?;
        
        Ok(info)
    }
    
    fn save_config(&self) -> Result<()> {
        let config = VaultConfig {
            vaults: self.vaults.values().cloned().collect(),
            last_active_vault: self.active_vault.as_ref().map(|s| s.vault_id.clone()),
            theme: self.config.theme.clone(),
            language: self.config.language.clone(),
        };
        let json = serde_json::to_string_pretty(&config)?;
        fs::write(get_config_path()?, json)?;
        Ok(())
    }
}
```

---

## Security при переключении

### Что происходит при `switch_vault()`

1. **Zeroize** encryption key текущего vault
2. **Close** SQLite connection (все prepared statements, caches)
3. **Clear** React state (frontend): все entries, search results, TOTP codes
4. **Clear** clipboard (если там был пароль из старого vault)
5. **Lock** OS-level: VirtualUnlock / drop locked pages
6. **Open** новый vault — свежий derive, свежий SQLite

### Что НЕ хранится между vaults

- ❌ Encryption keys
- ❌ Decrypted entries
- ❌ Search indexes
- ❌ Clipboard (если там был пароль)
- ❌ TOTP secrets
- ❌ Autofill history

### Что хранится (глобальные настройки)

- ✅ Theme (dark/light)
- ✅ Language
- ✅ Global hotkeys (Ctrl+Shift+A)
- ✅ Auto-lock timeout preference
- ✅ Backup directory preference
- ✅ List of vaults (names, paths, metadata — но **не** passwords)

---

## UX Edge Cases

### Первый запуск (нет vaults)
```
+----------------------------------------------------------+
|                                                          |
|  Welcome to Mynx                                     |
|  You don't have any vaults yet.                          |
|                                                          |
|  [+ Create Your First Vault]                             |
|  [📂 Open Existing Vault]                                |
|                                                          |
+----------------------------------------------------------+
```

### Vault файл не найден (удалён/переименован)
```
+----------------------------------------------------------+
|  ⚠️  Vault "Work" not found                              |
|  Expected: D:\Mynx\vaults\work.safepass             |
|                                                          |
|  [Locate File]  [Remove from list]  [Restore from backup]|
+----------------------------------------------------------+
```

### Два vault с одинаковым именем
- config.json: `name` — display name, может дублироваться
- `id` (UUID) — уникальный идентификатор
- Файл: `{sanitized_name}-{uuid_short}.safepass` — уникальный

### Перенос vault на другой компьютер
- Просто копируешь `.safepass` файл
- Открываешь через "Open Vault File" или копируешь в `vaults/`
- **Device Key** — если vault создан на другой машине, при первом открытии генерируется новый Device Key для этой машины (или требуется Emergency Kit для переноса)
- **Поведение**: при открытии vault с другого устройства → "This vault was created on another device. To open it, you need your Emergency Kit or the original Device Key." → либо импорт DK, либо пересоздание с новым DK (что требует перешифрования — но это допустимо при переносе)

### Максимальное количество vaults
- **Soft limit**: 50 vaults (предупреждение)
- **Hard limit**: 1000 vaults (файловая система ограничение)
- **Performance**: config.json < 100KB даже при 100 vaults

---

## API Commands (дополнить к существующим)

```rust
#[tauri::command]
async fn list_vaults(state: State<'_, AppState>) -> Result<Vec<VaultInfoDto>, String> {
    // Return list of vaults (names, paths, metadata, entry counts)
    // No sensitive data
}

#[tauri::command]
async fn create_vault(
    name: String,
    path: Option<String>, // default: vaults/
    master_password: String,
    state: State<'_, AppState>
) -> Result<VaultInfoDto, String> {
    // Create new vault file, add to config
}

#[tauri::command]
async fn switch_vault(
    vault_id: String,
    master_password: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    // 1. Lock current vault (zeroize everything)
    // 2. Open new vault
    // 3. Return success (frontend will reload)
}

#[tauri::command]
async fn rename_vault(
    vault_id: String,
    new_name: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    // Only config.json update
}

#[tauri::command]
async fn delete_vault(
    vault_id: String,
    master_password: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    // Verify password, move to trash, remove from config
}

#[tauri::command]
async fn import_external_vault(
    external_path: String,
    name: String,
    state: State<'_, AppState>
) -> Result<VaultInfoDto, String> {
    // Copy file, verify magic, add to config
}

#[tauri::command]
async fn set_default_vault(
    vault_id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    // Set is_default flag in config
}

#[tauri::command]
async fn get_vault_stats(
    vault_id: String,
    state: State<'_, AppState>
) -> Result<VaultStats, String> {
    // entry count, size, last backup, categories breakdown
}
```

---

## Frontend Integration (React)

### Zustand Store — Vault State

```typescript
interface VaultState {
  activeVault: VaultInfo | null;
  vaultList: VaultInfo[];
  isLocked: boolean;
  
  // Actions
  setActiveVault: (vault: VaultInfo) => void;
  refreshVaultList: () => Promise<void>;
  switchVault: (vaultId: string, password: string) => Promise<void>;
  lockCurrentVault: () => Promise<void>;
}

// При switch: clear ALL React state
// - entries: []
// - searchQuery: ""
// - selectedEntry: null
// - totpCodes: {}
// - clipboard: cleared
// - any cached decrypted data
```

### UI Components

- `VaultSelector` — экран приветствия / переключения
- `VaultSwitcher` — dropdown в шапке (только когда vault открыт)
- `VaultManager` — настройки (rename, delete, backup, import)
- `CreateVaultWizard` — пошаговое создание
- `ExternalVaultImporter` — drag-drop .safepass файл

---

## Сводка

| Возможность | Реализация | Срок |
|-------------|-----------|------|
| Список vaults | config.json + glass card UI | 1 день |
| Создание vault | wizard (как onboarding) | 1 день |
| Переключение vault | lock + zeroize + open new | 1 день |
| Переименование | config.json only | 0.5 дня |
| Удаление | trash + password verify | 0.5 дня |
| Импорт внешнего | copy + verify + add to config | 0.5 дня |
| Default vault | config.json flag | 0.25 дня |
| Перенос на другой ПК | open file + Device Key migration | 1 день |
| **Всего** | | **5-6 дней** |

---

## Связь с другими документами

- `architecture.md` — криптография per-vault (salt, key derivation)
- `master-password-change.md` — смена пароля для **конкретного** vault
- `capture-spec.md` — Quick Add сохраняет в **active vault**
- `ui-spec.md` — Vault Selector / Vault Switcher UI

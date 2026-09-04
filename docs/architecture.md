# Mynx — Архитектура шифрования и приложения

> Документ актуализирован по состоянию **Mynx 1.3.1+** (после security-аудита v1.2.2 и архитектурного рефакторинга v1.3.1: typed errors, разбивка команд и UI-модулей, AAD v2, fsync + `.bak`, бэкенд-автоблокировка, Hello-passport-обёртка, AAD-привязка). Соответствует коду в `src-tauri/src/crypto/`, `src-tauri/src/vault/`, `src-tauri/src/commands/`, `src/stores/`. При изменении кода обновлять оба файла.

## 0. Текущая кодовая база (v1.3.1+)

| Слой | LoC | Файлов | Заметки |
|---|---|---|---|
| Rust (src-tauri) | ~3 700 | ~30 | Команды разнесены по доменам в `commands/{vault,decoy,hw_key,secure_clip,backup,settings_sync,api_token,save_dialog,misc}.rs`. |
| Frontend (src) | ~5 800 | ~70 | Сторы разнесены: `session` / `vaultOps` / `decoy` / `hwKey` + фасад `useAppStore` для обратной совместимости. |
| Тесты | 74 vitest + 63 cargo | 7 + 9 | Паритет i18n, typed errors, secureStorage, crypto-формат. |

## 1. Обзор

Mynx использует **Zero-Knowledge** архитектуру. Все данные шифруются на клиенте. Мастер-пароль никогда не покидает память приложения в открытом виде, не сохраняется на диск и не восстанавливается.

```
Master Password (вводит пользователь)
        ↓
   [Argon2id]  salt из заголовка vault, m=64 MB, t=4, p=2
        ↓
   Primary Key (32 bytes)
        ↓
   [HKDF-SHA256]   IKM = primary_key ‖ device_key ‖ (hw_secret, если включён)
        ↓
   Encryption Key (32 bytes)
        ↓
   [XChaCha20-Poly1305]  → расшифровывает заголовок vault
        ↓
   Payload Key (случайный, 32 bytes, из заголовка)
        ↓
   [AES-256-GCM]  → расшифровывает записи (JSON)
```

> **Примечание:** параметры KDF подняты до **64 MB / 4 iter** в v1.3.1. Старые vault-файлы с 16 MB / 3 iter прозрачно мигрируют на новые параметры при первом unlock через `migrate_kdf_if_needed` (см. `src-tauri/src/vault/operations.rs`).


---

## 2. Ключевая схема

### 2.1 Master Password (MP)
- Вводится пользователем при unlock; также поддерживается **decoy-пароль** (открывает ложный слой, см. §4).
- Никогда не сохраняется на диск и не логируется.
- Буферы пароля затираются через `zeroize` после derive; неудачные попытки ограничиваются rate-limit-трекером (общий с API-токеном и Windows Hello).

### 2.2 Device Key (DK)
- 128 бит (16 байт), генерируется CSPRNG ОС при создании хранилища.
- Хранится в **файле `<vault>.safepass.dk`** рядом с vault-файлом (переносимая схема, NOT OS Keychain).
- Для расшифровки необходим одновременно с мастер-паролем: украденный vault-файл сам по себе бесполезен.
- При включённом **Windows Hello** ключ сессии сохраняется в Credential Manager (`keyring`, сервис `mynx`, запись `vault/<vault_id>`) **в зашифрованном виде** (passport-blob `mynx-passport-v1:*`): обёртка — AES-256-GCM на ключе из детерминированной подписи KeyCredential (`RequestSignAsync` всегда показывает Hello-промпт), AAD `mynx:v2:passport-wrap`. Вычитка записи другим процессом того же пользователя даёт бесполезный блоб без биометрии; разблокировка — `UserConsentVerifier` (лицо/отпечаток/PIN). Legacy-записи (открытый hex) читаются и мигрируются при первой перезаписи. Сам мастер-пароль нигде не хранится.

### 2.3 Salt
- 128 бит (16 байт) случайный salt на каждое KDF-преобразование.
- Основной — в открытом виде в заголовке vault; decoy-слот имеет собственный salt.
- Перегенерируется при смене мастер-пароля (перешифровка заголовка).

### 2.4 Derivation (фактический код)

```rust
// crypto/kdf.rs
pub const ARGON2_MEMORY_KB: u32 = 16384;   // 16 MB
pub const ARGON2_ITERATIONS: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 2;

// Primary Key = Argon2id(MP, Salt, m=16MB, t=3, p=2, out=32)
let primary_key = derive_key(password, &salt, &params)?;

// Encryption Key = HKDF-SHA256(
//     salt = b"",
//     ikm  = primary_key[32] ‖ device_key[16] [‖ hw_secret[32]],
//     info = b"safepass-v1-enc-key", out = 32)
let enc_key = derive_encryption_key_hw(&primary_key, &device_key, hw_key, b"safepass-v1-enc-key")?;
```

- Для decoy-слоя используется info-строка `safepass-v1-decoy-key` — тот же механизм, другой домен вывода.
- `hw_secret` (32 байта) выводится из keyfile на USB-флешке и ID в `vaults/hwkeys.json`; без него (при включённом hw-ключе) ключ шифрования не выводится вообще.

> **Почему `hwkeys.json` лежит открытым текстом (осознанное решение):** файл хранит только пары «имя → путь к keyfile» — ни секретов, ни содержимого ключей. Компрометация реестра не даёт доступа к хранилищам: злоумышленнику нужны ещё и сам keyfile, и мастер-пароль. Шифрование реестра возможно по запросу, но не меняет модель угроз.

### 2.5 Argon2id Parameters (фактические, `crypto/kdf.rs`, v1.3.1+)
```
Memory:       64 MB (65536 KB)
Iterations:   4
Parallelism:  2
Output length: 32 bytes
```

Подняты с 16 MB / 3 iter до 64 MB / 4 iter в v1.3.1. Старые vault-файлы открываются со старыми параметрами и прозрачно мигрируют на новые при первом успешном unlock через `migrate_kdf_if_needed` (см. `src-tauri/src/vault/operations.rs`). На обычном железе unlock укладывается в <1 секунды.
Параметры сериализуются в заголовок vault (`KdfParamsSerializable`) — их можно ужесточить в будущем без ломки совместимости. Параметры, прочитанные из файла, валидируются: `to_argon2_params() -> Result<Params>` — поддельный/повреждённый заголовок возвращает ошибку вызывателю, а не роняет процесс (паники на пути расшифровки исключены).

---

## 3. Формат Vault-файла

```
+---------------------------------------------------------------+
|                     Vault File (.safepass)                     |
+---------------------------------------------------------------+
| Magic (8 bytes)      | "SAFEPASS"                              |
| Version (1 byte)     | 0x01                                    |
| Salt (16 bytes)      | Random                                  |
| KDF Params           | memory_kb, iterations, parallelism      |
| Encrypted Header     | XChaCha20-Poly1305(enc_key, JSON)       |
|   ├── created_at / modified_at / entry_count                 |
|   ├── payload_key   | случайный 32-байтный ключ записей       |
|   └── decoy_enabled | флаг ложного слоя                       |
| Encrypted Payload    | AES-256-GCM(payload_key, JSON-записи)   |
| Decoy Slot (всегда)  | salt + kdf_params + encrypted_header    |
| Decoy Payload        | AES-256-GCM(записи ложного слоя)        |
| HW Key Info          | Option<keyfile_id> — только ID, не секрет|
+---------------------------------------------------------------+
```

Детали:

- **Payload — JSON** (`Vec<Entry>`), не Protobuf и не SQLite: проще, компактнее кода, формат заморожен расширением `.safepass`.
- **Decoy-слот присутствует всегда**: при создании vault создаётся «спящий» слот со случайным ключом. Снаружи включённый и выключенный ложный слой неотличимы — наличие deniability не выдаёт сам файл. `decoy_enabled` спрятан внутри зашифрованного заголовка.
- **Экспорт**: отдельный формат `SAFEPASS-EXP` (`.spbackup`), ключ выводится только из мастер-пароля — перенос между машинами. Имя файла `mynx-backup-*`.
- **Атомарная запись с сохранением предыдущей версии**: tmp → `sync_all()` (fsync — данные переживают сбой питания) → копия предыдущего файла в `<vault>.safepass.bak` → rename. Все записи сериализованы глобальным `VAULT_WRITE_LOCK` (устранена гонка «load → modify → save» при параллельных вызовах из UI, HTTP API и IPC — потеря данных при одновременной записи больше невозможна).
- **AAD-привязка (v2)**: каждый AEAD-блок аутентифицируется с ролью в AAD — `mynx:v2:header`, `mynx:v2:payload`, `mynx:v2:decoy-header`, `mynx:v2:export`, `mynx:v2:hw-keyfile`, `mynx:v2:clipboard`, `mynx:v2:passport-wrap`. Трансплантация шифроблоков между сейфами/слоями/ролями делает расшифровку невозможной (AAA проверяется `ring`/`chacha20poly1305` на этапе decrypt). Совместимость: чтение пробует v2, затем legacy-блоки без AAD — старые сейфы открываются; после первого сохранения файл обновляется до v2.

### 3.1 Зачем двойное шифрование?
- **Внешний слой** (XChaCha20-Poly1305): защищает заголовок, в котором лежит `payload_key`. Смена мастер-пароля перешифровывает только заголовок — мгновенно и без перестройки записей.
- **Внутренний слой** (AES-256-GCM, `ring`): защищает сами записи; независимый алгоритм — уязвимость одного слоя не компрометирует данные.

---

## 4. Слой-обманка (Decoy)

- В настройках задаётся **второй пароль**, отличный от мастер-пароля, открывающий правдоподобное фиктивное хранилище (собственный payload).
- Ввод decoy-пароля на экране блокировки открывает обманку и не раскрывает существования настоящих данных (в т.ч. API и IPC-клиентам — сессия помечается `is_decoy`, расширение видит только записи обманки).
- Удаление decoy — `vault_remove_decoy`, статус — `vault_decoy_status`.

---

## 5. Структура данных (Entry, JSON)

```jsonc
{
  "id": "uuid",                 // идентификатор записи
  "title": "GitHub",
  "username": "user@example.com",
  "password": "…",
  "url": "https://github.com",
  "category": "work",           // Banking/Social/Work/… + пользовательские
  "tags": ["dev"],
  "favorite": false,
  "strength": 0-100,            // кэш оценки стойкости
  "icon": "опционально",
  "totpSecret": "base32",       // TOTP (RFC 4226/6238), 6 цифр / 30 с
  "createdAt": 1719000000000,   // unix-ms
  "updatedAt": 1719000000000,
  "notes": "markdown",
  "customFields": [ { "type": "text|hidden|email|url|number|date", … } ],
  "passwordHistory": [ { "password": "…", "changedAt": … } ],
  "deletedAt": null             // не-null = запись в корзине
}
```

Корзина: `deletedAt` ≠ null; срок автоочистки `trashRetentionDays` (настройка, по умолчанию 30 дней); записи из корзины не отдаются расширению.

---

## 6. Память и безопасность в рантайме

### 6.1 Zeroize
Ключевые структуры (`VaultSession`) реализуют `Drop` → `zeroize`: ключи сессии затираются при блокировке, закрытии окна в трей и выходе.

### 6.2 Locked Memory (Windows)
- `VirtualLock` для страниц с ключами; при старте процесс запрашивает `SeLockMemoryPrivilege` (без неё квота ~128 КБ).
- `memprotect.rs`: `SetErrorMode` + unhandled-exception-фильтр с мгновенным `TerminateProcess` — Windows Error Reporting не успевает снять crash-dump; после очистки секретов — вытеснение рабочего набора (`SetProcessWorkingSetSize`).

### 6.3 Auto-Lock триггеры (фактические)
1. Таймаут бездействия — `mousemove/keydown/click/scroll` (`src/hooks/useAutoLock.ts`, по умолчанию 5 минут, настраивается; предупреждение за 30 с).
2. Сворачивание окна в трей — `lock_on_hide` (по умолчанию включено, отключается командой `set_lock_on_hide`).
3. Вручную — глобальный хоткей `Ctrl+Shift+L` (переназначается).

Таймаут **продублирован в бэкенде**: `last_activity`/`autolock_minutes` в `AppStateInner`, `enforce_autolock()` на каждом секрет-вызове (Tauri-команды, HTTP API, IPC) — при простое дольше лимита сессия затирается и возвращается `vault_locked`. Обход фронтенд-таймера (сон системы, заморозка вебвью) секреты не сохраняет. Синхронизация значения — команда `set_autolock_minutes`.

### 6.4 Логирование
`logging.rs`: уровни INFO/WARN/ERROR, файл `<app_data_dir>/logs/mynx.log`, ротация при 5 МБ → `mynx.old.log`; WARN/ERROR дублируются в stderr. Секреты и пароли в логи не пишутся.

### 6.5 Clipboard Protection
- **Основной режим (Tauri, Windows)** — «слепое копирование»: секрет шифруется AES-256-GCM и хранится только в памяти процесса (`secure_copy`); вставка — `secure_paste` прямым вводом через `SendInput`, минуя системный буфер. Буфер одноразовый: после вставки очищается.
- **Fallback** — системный буфер: запись через `clipboard_set_secure` с таймером очистки (очистка только если буфер всё ещё содержит наш текст, supersede через счётчик поколений); опциональное отключение истории Win+V (`clipboard_history_set_enabled`); принудительная очистка при блокировке/выходе.

---

## 7. Внешние интерфейсы

### 7.1 HTTP API (`api.rs`, axum, 127.0.0.1:5149)
- `GET /api/status` — `{ unlocked, version }`.
- `POST /api/credentials` `{ domain }` → `{ username, password, totp }` — Bearer-токен (`get_api_token`), rate-limit неудачных попыток. Токен хранится как `Mutex<Zeroizing<String>>` (затирание при ротации/drop, команда `rotate_api_token`).
- Перед выдачей секретов — `enforce_autolock()` (см. §6.3).
- Middleware: Host — только loopback; Origin — только расширения (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`). Защита от DNS-rebinding и обращений из веб-страниц.

### 7.2 IPC расширения (`ipc.rs`)
- Windows: named pipe `\\.\pipe\mynx` (DACL — только текущий пользователь; создание с `FILE_FLAG_FIRST_PIPE_INSTANCE` — чужой процесс не может предварительно занять имя pipe и перехватить трафик, squatting исключён); Linux: unix-сокет `$XDG_RUNTIME_DIR/mynx-<uid>.sock`.
- Действия: `get` / `list` / `search` / `save` / `status` / `pair`. Протокол кадра: 4 байта LE длины + JSON.
- **Pairing**: `status` открыт всем (индикатор Offline/Locked); остальные действия требуют ключ, выданный после подтверждения пользователем в диалоге десктоп-приложения. Ключ живёт до перезапуска Mynx.
- Поиск по домену — строгий eTLD+1-скоринг (единый `domain_score` в `api.rs`): точный хост = 1000, тот же регистрируемый домен (поддомен/www) = 500, всё остальное = **0**. Двусторонние `contains`-совпадения убраны: lookalike-домены (`evil-paypal.com`, `paypal.com.evil.io`) пароль не получают. Учёт двухуровневых публичных суффиксов (`co.uk` и пр.).

---

## 8. Threat Model (фактические митигации)

| Угроза | Вероятность | Влияние | Митигация |
|--------|------------|---------|-----------|
| Brute-force MP | Средняя | Высокое | Argon2id (16MB, t=3, p=2) + rate-limit неудачных попыток |
| Кража vault-файла | Средняя | Высокое | MP + Device Key (два фактора), аутентифицированное шифрование |
| Memory dump | Низкая (Win) | Высокое | Запрет WER-дампов, VirtualLock, zeroize, trim working set |
| Keylogger | Средняя | Высокое | Windows Hello (нет ввода пароля), auto-type мимо менеджера (Win) |
| Clipboard history / сканеры | Высокая | Среднее | Слепое копирование (секрет не покидает процесс), одноразовый буфер, опц. автоочистка и отключение Win+V |
| Backup tampering | Низкая | Высокое | AEAD + AAD v2: подмена и трансплантация блоков = ошибка расшифровки; fsync + атомарный rename с `.safepass.bak` |
| Squatting `\\.\pipe\mynx` | Низкая | Высокое | `FILE_FLAG_FIRST_PIPE_INSTANCE` — создание pipe падает, если имя занято |
| Lookalike-домены (фишинг) | Средняя | Высокое | eTLD+1-скоринг: чужой регистрируемый домен получает 0 — автозаполнение молчит |
| Обход автоблокировки (сон/заморозка UI) | Средняя | Высокое | Бэкенд-`enforce_autolock` на всех секрет-вызовах — таймер нельзя обойти со стороны фронтенда |
| Кража вложений из localStorage | Средняя | Среднее | Снапшот zustand-персиста шифруется AES-256-GCM; ключ — неэкспортируемый CryptoKey в IndexedDB |
| Поддельный KDF-заголовок (DoS) | Низкая | Среднее | Параметры KDF валидируются, ошибка вместо паники |
| Shoulder surfing | Высокая | Среднее | Маскирование паролей, авто-скрытие по таймауту, auto-lock |
| Evil maid | Низкая | Высокое | MP нигде не хранится; опциональный hw-ключ (флешка) |
| Скрытый доступ программ | Низкая | Высокое | Pairing-диалог для IPC-клиентов, ключ до перезапуска; host/origin guard + bearer + rate-limit для HTTP |
| Принуждение к открытию | Низкая | Высокое | Decoy-хранилище, неотличимое по файлу от обычного |
| Side-channel | Низкая | Высокое | Constant-time crypto (`ring`, `subtle`) |

## 9. Криптографические библиотеки (фактические)

| Задача | Crate | Версия | Примечание |
|--------|-------|--------|------------|
| Argon2id | `argon2` (RustCrypto) | 0.5 | Победитель PHC |
| XChaCha20-Poly1305 | `chacha20poly1305` | 0.10 | Внешний слой |
| AES-256-GCM | `ring` | 0.17 | Внутренний слой, BoringSSL-код |
| HKDF-SHA256 | `hkdf` + `sha2` | 0.12 / 0.10 | RFC 5869 |
| CSPRNG | `getrandom`, `rand_core`, `ring::rand` | 0.2 / 0.6 | OS CSPRNG |
| Zeroize | `zeroize` | 1.7 | derive + Drop; API-токен — `Zeroizing` |
| Constant-time | `subtle` | 2.6 | timing-safe compare |
| OS keystore | `keyring` | 3 | Windows Credential Manager (биометрия) |

## 9. Типизированные ошибки (v1.3.1+)

Все Tauri-команды и IPC-ответы возвращают `CommandError` (`src-tauri/src/error.rs`) с сериализацией `{kind, message}`. На фронте `src/lib/errors.ts` парсит строку и предоставляет узкоспециализированные хелперы (`isWrongPassword`, `isHwKeyInvalid`, …).

**Категории:**

| Категория | Примеры |
|---|---|
| Аутентификация | `wrong_password`, `password_too_short`, `too_many_attempts`, `vault_locked` |
| Vault | `vault_not_found`, `vault_corrupted`, `vault_write_failed` |
| Decoy | `decoy_equals_master`, `decoy_session_forbidden` |
| Hardware key | `hw_key_not_found`, `hw_key_invalid`, `hw_key_already_enabled`, `hw_key_dir_*` |
| Clipboard | `secure_buffer_empty`, `clipboard_failed` |
| Настройки | `lock_on_hide_weakening_forbidden`, `invalid_shortcut`, `hotkey_conflict` |
| Системные | `io_error`, `serde_error`, `other` |

Добавление новой ошибки = один вариант в `CommandError` (Rust) + один в `ErrorKind` (TS) + хелпер. Старый код (`String(e).includes("...")`) заменён типизированными проверками.

## 10. Архитектура команд (v1.3.1+)

`src-tauri/src/commands/` разнесён по доменам:

```
commands/
  mod.rs          # AppState, wipe_secrets, re-exports
  app_state.rs    # AppState/AppStateInner, IpcBackupPrefs
  types.rs        # DTO + validate_master_password
  device_key.rs   # session_keys, hw_registry helpers
  vault.rs        # create/unlock/lock/save/change-pw/list/delete/export
  decoy.rs        # set/remove/status
  hw_key.rs       # enable/disable/status + path validation
  secure_clip.rs  # secure_copy/paste/available
  settings_sync.rs # autolock/lock_on_hide/language
  api_token.rs    # get/rotate
  backup.rs       # backup + ipc_prefs
  save_dialog.rs  # native save dialog + save_png_file
  misc.rs         # revoke_ipc_pair
```

`main.rs` импортирует все команды через `commands::*` (через re-exports). Новая Tauri-команда = новый файл + re-export + регистрация в `invoke_handler`.

## 11. Сторы фронта (v1.3.1+)

`src/stores/` разнесён по ответственности:

```
stores/
  session.ts    # screen, isLocked, isUnlocked, activeVault, error, isLoading
  vaultOps.ts   # unlock/lock/createVault/loadVaults/changeMasterPassword/...
  decoy.ts      # isDecoySession, decoyEnabled, setDecoyPassword/removeDecoy
  hwKey.ts      # hwKeyEnabled, enable/disable/status
  vault.ts      # entries + CRUD (бизнес-данные)
  app.ts        # ФАСАД: useAppStore для обратной совместимости
  settings.ts   # persist, синхронизация в бэкенд через lib/backendSync.ts
  attachments.ts # persist (encrypted)
  passkeys.ts   # persist (encrypted)
  categories.ts # persist
  clipboard.ts  # transient (secure copy)
```

`useAppStore` — фасад, делегирующий в 4 новых стора. Старый код компонентов работает без правок; новый код предпочитает импортировать конкретный стор.

`useSessionStore.getState()` читает состояние синхронно; подписки на изменения — `useSessionStore.subscribe()`.

## 12. Backend sync (v1.3.1+)

Вся коммуникация фронт↔бэкенд по настройкам инкапсулирована в `src/lib/backendSync.ts`:

- `initBackendSync()` — идемпотентная подписка, вызывается из `App.tsx` один раз;
- Подписки на `useSettingsStore` детектят изменения полей и шлют нужные команды (autolock, lock_on_hide, clipboard_history, ipc_backup_prefs);
- Шедулер автобэкапа пересоздаёт таймеры при изменении любого из 4 полей;
- Подписка на событие `vault-locked` от Rust синхронизирует UI-стор при сворачивании в трей.

Раньше в `App.tsx` было 7 отдельных `useEffect`, каждый слушал одно поле и слал одну команду. Теперь — один вызов, 7 полей покрыты.

## 13. i18n (v1.3.1+)

Словари вынесены в отдельные файлы:

- `src/i18n/en.ts` — английский словарь (~13 KB)
- `src/i18n/ru.ts` — русский словарь (~19 KB)
- `src/i18n.tsx` — Provider + `useI18n` хук + `entriesCountLabel` (плюрализация)

Добавление нового языка = новый файл `src/i18n/<lang>.ts` + регистрация в `translations` (одна строка) + тип `Lang`.

Паритет наборов ключей проверяется тестом `i18n.test.ts`.

## 14. Modal stack & global shortcuts (v1.3.1+)

`VaultScreen.tsx` использует:

- `useModalStack<K>()` — стек модалок вместо 10 булевых useState; один активный модал, `Escape` закрывает верхний, конфликты видимости невозможны.
- `useGlobalShortcuts(handlers)` — хук регистрации глобальных хоткеев через `tauri-plugin-global-shortcut`. Обработчик AutoType выделен в отдельный хук; picker показывается через custom event `mynx:auto-type-pick`.

`Settings.tsx` (54 KB, 1125 строк, было 94 KB / 2471) использует:
- `components/settings/ui/` — `ActionModal`, `PasswordField`, `FieldLabel`, `Toggle`
- `components/settings/modals/` — `ExportModal`, `ImportModal`, `ChangePasswordModal`, `DeleteDataModal`, `DecoySetModal`, `DecoyRemoveModal`, `HwKeyEnableModal`, `HwKeyDisableModal`

Каждая модалка в своём файле, использует типизированные хелперы ошибок, тестируется отдельно.

## 15. ErrorBoundary (v1.3.1+)

`src/components/ErrorBoundary.tsx` оборачивает `<App />` в `main.tsx`. При падении рендера:

1. `vault_lock` шлётся в Rust (best-effort);
2. `entries` чистятся из vault-стора;
3. `isLocked = true`, `screen = "lock"` в session-сторе;
4. UI показывает экран восстановления с кнопкой "Перезагрузить".

`scope="panel"` вариант используется для локальных границ вокруг модалок (Settings, EntryDetail, Health).

## 16. Будущие улучшения

- **Post-quantum KEM** — ML-KEM (Kyber) для ключевого обмена (если появится sync).
- **Hardware-backed device key** — перенос `.safepass.dk` в TPM / Secure Enclave (сейчас — файл рядом с vault; Credential Manager используется только для ключа Windows Hello).
- **Per-entry key derivation** — каждая запись зашифрована своим ключом (двойной слой формата уже это допускает).
- **Расширение Argon2-параметров** — поле `KdfParams` в заголовке позволяет ужесточить KDF без миграции формата.
- **Расширение на TypeScript** — `extension/*.js` пока без TS, миграция под вопросом (Chrome Web Store ограничивает build-step).
- **Crash reporting** — плагин Sentry/GlitchTip в Tauri 2, opt-in.

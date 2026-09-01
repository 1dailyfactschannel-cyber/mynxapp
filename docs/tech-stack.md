# Mynx — Стек и технологии

Документ описывает **фактическое** состояние кодовой базы (по манифестам и исходникам), а не проектные планы. Актуализирован по состоянию **Mynx 1.2.2** (расширение 1.0.3). Дизайн-документы в `design/` могут забегать вперёд — при расхождениях верен этот файл.

## 1. Состав проекта

| Компонент | Расположение | Технологии |
|-----------|--------------|------------|
| Десктопное приложение | `src/` + `src-tauri/` | Tauri 2 (Rust) + React 18 (TypeScript) |
| Браузерное расширение | `extension/` | Manifest V3, ванильный JS без сборки |
| Native Messaging Host | `src-tauri/src/native_host.rs` | Rust (второй бинарник того же crate) |

```
Браузер (Chrome/Edge)
  └── Расширение (content.js / background.js / popup)
        └── Native Messaging (stdio, length-prefixed JSON)
              └── mynx-native-host (exe / бинарник)
                    └── Windows: Named Pipe \\.\pipe\mynx
                        Linux:    Unix-сокет $XDG_RUNTIME_DIR/mynx-<uid>.sock
                          └── Mynx Desktop (Rust core)

Mynx Desktop
  ├── WebView (React UI) ⇄ Tauri commands (Rust, ~40 команд)
  ├── HTTP API 127.0.0.1:5149 (axum, Bearer token, только loopback)
  └── Vault-файлы .safepass (папка vaults/ рядом с исполняемым файлом)
```

## 2. Десктопное приложение

### 2.1 Фронтенд (`src/`)

| Технология | Версия | Назначение |
|------------|--------|------------|
| React | 18.3 | UI, функциональные компоненты + хуки |
| TypeScript | 5.5 | Строгая типизация (`tsconfig.json`) |
| Vite | 5.3 | Сборка и dev-сервер (порт 1420, `strictPort`) |
| Tailwind CSS | 3.4 | Стили; дизайн-токены через CSS-переменные (`src/globals.css`), `darkMode: "class"` |
| tailwindcss-animate | 1.0 | Анимации |
| Radix UI | 1.x/2.x | Headless-примитивы: dialog, dropdown-menu, select, slider, slot, switch, tabs, toast, tooltip, progress |
| class-variance-authority + clsx + tailwind-merge | — | Композиция классов (паттерн shadcn/ui, но без отдельных `ui/`-обёрток) |
| framer-motion | 11 | Анимации интерфейса |
| lucide-react | 0.408 | Иконки |
| next-themes | 0.3 | Переключение темы (light/dark/system) |
| zustand | 4.5 | Стейт-менеджмент; `persist` в localStorage для настроек/категорий/вложений |
| qrcode | 1.5 | QR-код Emergency Kit (canvas → dataURL) |
| jspdf | 4.2 | Задекларирован, в коде не используется (зарезервирован) |
| @tauri-apps/api | 2.0 (devDeps) | Вызов Rust-команд из JS (`invoke`) |
| @tauri-apps/plugin-dialog | 2.0 | Системные диалоги выбора/сохранения файлов |
| @tauri-apps/plugin-global-shortcut | 2.3 | Регистрация глобальных хоткеев из JS |
| @tauri-apps/plugin-shell | 2.3 | Открытие ссылок/файлов |

Ключевые решения:

- **State**: шесть zustand-сторов — `app.ts` (экран, активный vault, unlock, персист записей), `vault.ts` (записи, генератор паролей, `calculateStrength`), `settings.ts`, `categories.ts`, `attachments.ts` (вложения и папки, base64), `clipboard.ts` (централизованный буфер обмена). Persist-ключи: `mynx-settings`, `mynx-categories`, `mynx-attachments`; язык — `mynx-lang`.
- **Модель записи** (`vault.ts`, JSON): `id, title, username, password, url, category, tags[], favorite, strength, icon?, totpSecret?, createdAt?, updatedAt?, notes?, customFields?, passwordHistory?, deletedAt?` (корзина — записи с `deletedAt`).
- **i18n**: собственный контекст-провайдер `src/i18n.tsx`, словари en/ru в одном файле, автоопределение языка по `navigator.language` при первом запуске.
- **TOTP**: собственная реализация `src/lib/totp.ts` — Base32 (RFC 4648), SHA-1 (RFC 3174) и HOTP/TOTP (RFC 4226/6238) без внешних зависимостей.
- **Импорт**: `src/lib/import.ts` — Bitwarden (JSON/CSV), 1Password (CSV), KeePass/KeePassXC (CSV), Chrome/универсальный CSV; автоопределение формата; собственный CSV-парсер по RFC 4180 (кавычки, многострочные поля, автоопределение разделителя).
- **Встроенный tutorial**: `src/lib/guide.ts` импортирует `docs/USER-GUIDE.md` как `?raw` и разбивает по заголовкам `## ` — компонент `Tutorial` показывает руководство прямо в приложении. **Структура заголовков USER-GUIDE.md — часть UI, менять аккуратно.**
- **Двойной режим**: фронтенд работает и в обычном браузере (демо-режим с мок-данными, проверка `isTauri` по `__TAURI_INTERNALS__`), и внутри Tauri.
- **Персист записей**: дебаунс 600 мс → `vault_save_entries` через `invoke`, с защитой от лишних записей по сравнению JSON.

### 2.2 Бэкенд (`src-tauri/`, Rust)

| Crate | Назначение |
|-------|------------|
| tauri 2.0 | Ядро приложения (feature `tray-icon`) |
| tauri-plugin-shell | Открытие ссылок/файлов |
| tauri-plugin-os | Информация о платформе |
| tauri-plugin-clipboard-manager | Запись/чтение системного буфера |
| tauri-plugin-dialog | Нативные диалоги выбора файлов (open) |
| tauri-plugin-global-shortcut | Глобальные горячие клавиши |
| tokio (full) | Async-рантайм: named pipe / unix socket, TCP |
| axum 0.7 | Локальный HTTP API `127.0.0.1:5149` |
| serde / serde_json | (Де)сериализация; payload vault — JSON |
| windows 0.58 | Win32 API: `SendInput`, `VirtualLock`, named pipe security, Windows Hello (WinRT `Security.Credentials.UI`) |
| winreg 0.52 | Реестр (настройки tray-хоткея в HKCU) |
| keyring 3 (windows-native) | Windows Credential Manager — ключ биометрии |
| libc 0.2 (unix) | `getuid` для пути unix-сокета |
| anyhow / thiserror | Ошибки |
| chrono | Временные метки |
| Криптография | см. раздел 3 |

Модули Rust (`src-tauri/src/`):

- `main.rs` — точка входа: `memprotect::init()` до всего остального, регистрация плагинов и команд, трей-меню (Show/Quit), закрытие окна в трей с опциональной блокировкой vault (`lock_on_hide`, по умолчанию включена), запуск API- и IPC-серверов в `tauri::async_runtime`, затирание секретов при выходе.
- `commands/mod.rs` — Tauri-команды (см. таблицу ниже). Состояние — `AppState`/`AppStateInner` (сессия vault, API-токен, device key, ключи pairing IPC, защищённый буфер, счётчики rate-limit) за `Mutex`.
- `api.rs` — HTTP API для внешних клиентов: `GET /api/status`, `POST /api/credentials` (Bearer-токен, выдаётся через `get_api_token`). Только loopback + middleware-гвард `host_origin_guard`: Host обязателен loopback, Origin — только `chrome-extension://` / `moz-extension://` / `safari-web-extension://` (защита от DNS-rebinding и кросс-сайтовых запросов).
- `ratelimit.rs` — общий in-memory backoff-трекер: неудачные попытки подбора API-токена, мастер-пароля и подтверждений Windows Hello делят один счётчик на vault (`429 too_many_attempts` с задержкой).
- `ipc.rs` — локальный IPC-сервер расширения: Windows — named pipe `\\.\pipe\mynx` (tokio, message mode, DACL только для текущего пользователя), Linux — unix-сокет `$XDG_RUNTIME_DIR/mynx-<uid>.sock`. Протокол: 4 байта LE length + JSON. Действия (`action`): `get` / `list` / `search` / `save` / `status` / `pair`. `status` открыт всем (индикатор Offline/Locked), всё остальное требует ключ доверенного клиента, выданного через `pair` после подтверждения пользователем в диалоге. Поиск записи по домену со скорингом (точное совпадение 1000 / поддомен 500 / contains 100 / обратный contains 50).
- `native_host.rs` — отдельный бинарник `mynx-native-host`: мост Native Messaging (stdio) → pipe/unix-сокет.
- `auto_type.rs` — авто-ввод логина/пароля через Win32 `SendInput` (`KEYEVENTF_UNICODE`), ожидание отпускания модификаторов, Tab/Enter между полями. `auto_type_fallback.rs` — заглушка для не-Windows: команды возвращают ошибку `auto_type_not_supported_on_this_platform`.
- `clipboard.rs` — серверная часть буфера: `clipboard_set_secure` (запись + отложенная очистка по таймеру; очистка только если в буфере всё ещё наш текст, supersede через счётчик поколений), `clipboard_history_set_enabled` (отключение системной истории Win+V), очистка при блокировке/выходе.
- `hotkey.rs` — «tray-хоткей» (глобальная клавиша показать окно): хранится в реестре/`settings.json`, команды `tray_hotkey_get/set/pause`, регистрация при старте.
- `biometry.rs` — Windows Hello: после успешного пароль-unlock ключ сессии шифруется и сохраняется в Windows Credential Manager (`keyring`, сервис `mynx`, запись `vault/<vault_id>`); разблокировка — `UserConsentVerifier` (лицо/отпечаток/PIN), мастер-пароль не хранится. Провал верификации питает общий rate-limit. `biometry_fallback.rs` — заглушка на остальных платформах.
- `memprotect.rs` — защита памяти процесса (Windows): запрет crash-дампов (`SetErrorMode`, unhandled-exception-фильтр с мгновенным `TerminateProcess` — WER не успевает снять дамп), получение `SeLockMemoryPrivilege`, вытеснение рабочего набора (`SetProcessWorkingSetSize`) после очистки секретов.
- `crypto/` — `kdf.rs` (Argon2id), `hkdf.rs` (в т.ч. вариант с примесью секрета аппаратного ключа), `aead.rs` (AES-256-GCM через `ring`), `xchacha20.rs` (XChaCha20-Poly1305 через `chacha20poly1305`).
- `vault/` — `types.rs` (заголовок с decoy-слотом и hw-key, magic `SAFEPASS`, export-формат `SAFEPASS-EXP`, `VaultSession` с `Drop`→`zeroize`), `operations.rs` (load/save, атомарная запись через `safepass.tmp`, двухслойное шифрование, decoy-слой, смена пароля, экспорт).

Зарегистрированные Tauri-команды (38 + `greet`):

| Группа | Команды |
|--------|---------|
| Vault | `vault_create`, `vault_unlock`, `vault_lock`, `check_vault_unlocked`, `list_vault_files`, `vault_get_entries`, `vault_save_entries`, `vault_change_password`, `vault_delete`, `vault_export`, `vault_backup` |
| Decoy / HW-key | `vault_set_decoy_password`, `vault_remove_decoy`, `vault_decoy_status`, `vault_hw_key_status`, `vault_enable_hw_key`, `vault_disable_hw_key` |
| Защищённый буфер | `secure_copy`, `secure_paste`, `secure_copy_available`, `clipboard_set_secure`, `clipboard_history_set_enabled` |
| Auto-Type | `auto_type_credentials`, `auto_type_text`, `get_foreground_window` |
| Хоткеи | `tray_hotkey_get`, `tray_hotkey_pause`, `tray_hotkey_set` |
| Биометрия | `biometry_is_available`, `biometry_is_enabled`, `biometry_enable`, `biometry_disable`, `vault_unlock_biometry` |
| Служебные | `save_png_file`, `get_api_token`, `get_device_key`, `set_lock_on_hide`, `set_app_language` |

### 2.3 Конфигурация окна и безопасности (`tauri.conf.json`)

- Окно 1200×800 (min 800×600), кастомный TitleBar: `decorations: false`, `transparent: true`.
- Трей-иконка с tooltip, identifier `com.matt.mynx`.
- CSP: `default-src 'self' asset:`, `connect-src 'self'`, `unsafe-eval` для скриптов, `img-src` c `data:`.
- Capabilities Tauri 2: `core:default`, `shell:allow-open`, `os:allow-platform`, `clipboard-manager:allow-write-text`, `dialog:allow-open`, `global-shortcut:allow-register/unregister/is-registered`, управление окном (minimize/close/start-dragging/hide/show/unminimize/set-focus).
- Бандлер: NSIS-инсталлятор (currentUser, языки English/Russian с селектором, кастомные header/sidebar bmp, installer.ico).

## 3. Криптография

| Задача | Crate / реализация |
|--------|--------------------|
| KDF мастер-пароля | `argon2` 0.5 — Argon2id, **16 MB / t=3 / p=2** (`crypto/kdf.rs`) |
| Деривация ключа шифрования | `hkdf` 0.12 + `sha2` 0.10, info-строка `safepass-v1-enc-key` (для decoy-слоя — `safepass-v1-decoy-key`) |
| Внешний слой шифрования (заголовок) | `chacha20poly1305` 0.10 — XChaCha20-Poly1305 |
| Внутренний слой (payload записей) | `ring` 0.17 — AES-256-GCM |
| Constant-time | `subtle` 2.6 (timing-safe compare) |
| CSPRNG | `getrandom` 0.2, `rand_core` 0.6, `ring::rand::SystemRandom` |
| Обнуление памяти | `zeroize` 1.7 (derive + `Drop` для `VaultSession`), `VirtualLock` для ключевых буферов |
| Device key | 16 байт, файл `*.safepass.dk` рядом с vault |
| Секрет аппаратного ключа | 32 байта, выводится из keyfile на USB-флешке + device key; примешивается в IKM при HKDF |

Цепочка вывода ключа (`crypto/hkdf.rs::derive_encryption_key_hw`): HKDF-SHA256 с пустым salt, IKM = `primary_key[32] ‖ device_key[16] [‖ hw_secret[32]]`, info = `safepass-v1-enc-key`, выход 32 байта. Без аппаратного ключа (или при отключённом) — вариант без примеси.

Формат файла: magic `SAFEPASS` (8 байт) + версия + salt + KDF-параметры (открыто, сериализуемы) + зашифрованный заголовок XChaCha20-Poly1305 (внутри: created/modified, entry_count, случайный `payload_key`, флаг decoy) + payload, зашифрованный AES-256-GCM ключом `payload_key`. В заголовке также всегда присутствует **decoy-слот** (собственные salt/KDF/заголовок; если ложный пароль не задан — зашифрован случайным ключом и неотличим от включённого) и опциональный `hw_key` (только ID keyfile, не секрет). Расширение `.safepass`, magic и HKDF-строки — **заморожены для обратной совместимости** (ребрендинг в Mynx их не затронул).

Экспорт: отдельный формат `SAFEPASS-EXP` (`.spbackup`), имя файла `mynx-backup-*`; ключ экспорта выводится только из мастер-пароля (без device key) — переносится на другую машину.

## 4. Браузерное расширение (`extension/`)

- **Manifest V3, версия 1.0.3**, чистый JS без сборки и без npm-зависимостей.
- Permissions: `activeTab`, `storage`, `nativeMessaging`, `notifications`. Полей `host_permissions` нет — доступ к страницам даёт content script с `matches: <all_urls>` и `run_at: document_end`.
- `content.js` — content script: ищет поля логина/пароля/OTP по селекторам (включая `autocomplete`, `name*`, `id*`), рисует **инлайн-иконку Mynx внутри полей** и выпадающий список учёток, заполняет поля напрямую (никаких скриптовых инъекций — иконка и DOM-обработчики), перехватывает сабмиты форм для автосохранения логина.
- `background.js` — service worker: `chrome.runtime.sendNativeMessage("com.matt.mynx.native", ...)` с таймаутами (обычные 5 с, pairing 65 с), кэш статуса на 10 с, ключ pairing хранится в `chrome.storage.session` (умирает с сессией браузера).
- `popup.html`/`popup.js` — четыре вкладки: **Site** (учётки текущего сайта, Fill, копирование, «+ Add login»), **All** (все записи с поиском), **Generator** (генератор паролей), **Saved** (перехваченные при входе логины → «Save to vault»); индикатор Offline/Locked/Unlocked.
- Регистрация хоста: `extension/native-host/register.reg` — ключи реестра `NativeMessagingHosts\com.matt.mynx.native` для Chrome и Edge (HKCU, без прав администратора); `com.matt.mynx.native.json` — манифест хоста.

Поток автозаполнения: content script → background → native host → pipe/unix-сокет → IPC-сервер (`action: get`, проверка pairing-ключа, поиск по домену) → ответ с username/password/TOTP. Первое обращение требует pairing: диалог поверх всех окон в десктоп-приложении, ключ живёт до перезапуска Mynx.

## 5. Сборка и инструменты

| Инструмент | Назначение |
|------------|------------|
| npm scripts | `dev` (vite), `build`, `tauri-dev`, `tauri-build`, `lint`, `format` |
| @tauri-apps/cli 2.0 | `npm run tauri-dev` / `tauri-build` |
| ESLint 8 + eslint-plugin-react-hooks | Линт (`--max-warnings 0`) |
| Prettier 3 | Форматирование `src/**/*.{ts,tsx,css,json}` |
| PostCSS + autoprefixer | Обработка Tailwind |
| `build-release.bat` | Release-сборка под Windows |
| `tools/gen_installer_assets.py` | Генерация NSIS-ассетов (header/sidebar bmp, иконки) |
| `extension/pack.bat` | Упаковка расширения в ZIP для Chrome Web Store |
| `extension/store/` | Материалы витрины: описание, privacy policy, промо-графика, mock-скриншоты (`mock/build-harness.py`) |
| Cargo | Два бинарника: `mynx` (приложение), `mynx-native-host` |

Пайплайн: `npm run build` → фронтенд в `dist/` → `cargo build --release` (Tauri забирает `dist` через `frontendDist`) → NSIS-инсталлятор.

## 6. Хранение данных

| Данные | Где |
|--------|-----|
| Vault-файлы | `vaults/*.safepass` рядом с исполняемым файлом (переносимые; `current_exe().parent()/vaults`) |
| Device key | `<vault>.safepass.dk` рядом с vault |
| Реестр аппаратных ключей | `vaults/hwkeys.json` (ID keyfile → salt) |
| Ключ биометрии | Windows Credential Manager, сервис `mynx`, запись `vault/<vault_id>` (только при включённом Hello) |
| Настройки UI / категории / вложения | localStorage (`mynx-settings`, `mynx-categories`, `mynx-attachments`, `mynx-lang`) |
| Tray-хоткей | HKCU-реестр/`settings.json` (Rust-сторона) |
| Ключ pairing расширения | В памяти Rust-процесса до перезапуска; в браузере — `chrome.storage.session` |
| Защищённый буфер | Только в памяти процесса, AES-256-GCM-шифрованный, одноразовый |
| Сессия (ключи) | Только в памяти Rust-процесса (`Mutex<Option<VaultSession>>`), auto-lock по таймауту (`src/hooks/useAutoLock.ts`) и при сворачивании в трей |

## 7. Платформы, ограничения, тесты

- **Windows — полная функциональность**: auto-type (`SendInput`), Windows Hello, защита памяти (`memprotect`), named pipe, NSIS-инсталлятор.
- **Linux — базовый режим**: ядро (крипто, vault, UI) кроссплатформенно (`libc` для unix); IPC расширения работает через unix-сокет; **нет** auto-type (заглушка возвращает ошибку), биометрии и запрета дампов памяти. Сборка — `npm run tauri build` (таргет бандла в конфиге один — NSIS, т.е. «из коробки» пакуется только Windows; Linux — из исходников).
- Тесты: unit-тесты в `src-tauri/src/crypto/` (`kdf.rs`, `hkdf.rs` и др.) и `vault/operations.rs` (`cargo test`); фронтенд-тестов нет.
- `src/components/ui/` не существует — скаффолдинг shadcn удалён, примитивы Radix используются напрямую.

---

## 8. Как защищены ваши данные (подробно, для клиента)

Этот раздел написан простым языком и отвечает на главный вопрос: **что происходит с вашими паролями и почему их нельзя украсть**.

### 8.1 Главный принцип: данные никогда не покидают компьютер

- У Mynx **нет сервера, облака, аккаунтов и телеметрии**. Приложение работает полностью офлайн.
- Это зафиксировано не только архитектурно, но и технически: политика безопасности контента (CSP) запрещает приложению любые исходящие сетевые соединения (`connect-src 'self'`).
- Встроенный HTTP-интерфейс (для браузерного расширения) слушает только адрес `127.0.0.1` — то есть доступен исключительно с этого же компьютера; запросы с посторонним Host или Origin отклоняются, а полезные вызовы дополнительно защищены личным токеном доступа и ограничением частоты попыток.
- Ваши пароли физически не могут «утечь на сервер», потому что сервера не существует.

### 8.2 Хранилище: один зашифрованный файл

Все записи живут в одном файле-хранилище (`*.safepass`) в папке `vaults` рядом с приложением. Файл можно свободно копировать на флешку или в резервную копию — без ключей это просто бессмысленный набор байт.

Открыть файл без правильной комбинации ключей невозможно: любая модификация файла (даже одного байта) обнаруживается автоматически благодаря аутентифицированному шифрованию.

### 8.3 Ключи, которые охраняют хранилище

Для расшифровки данных нужны **одновременно три вещи**:

| Ключ | Что это | Где хранится |
|------|---------|--------------|
| Мастер-пароль | Придумываете вы | Только в вашей голове; в памяти программы — лишь на время работы, затем надёжно затирается |
| Ключ устройства (Device Key) | Случайные 128 бит, создаются при первом запуске | Отдельный файл `*.safepass.dk` рядом с хранилищем |
| Случайная «соль» (Salt) | Уникальна для каждого хранилища | В открытом виде внутри файла-хранилища |

Дополнительно (по желанию, включается в настройках):

- **Аппаратный ключ (флешка)** — файл-ключ на USB-носнике: без него ключ шифрования не выводится даже с правильным паролем. Секрет примешивается в HKDF, поэтому хранилище без флешки математически не открывается.
- **Windows Hello** — биометрическая разблокировка: ключ сессии хранится в Windows Credential Manager и выдаётся только после успешной проверки лица/отпечатка/PIN. Сам мастер-пароль при этом нигде не записывается.

Следствия:

- **Зная только пароль, данные не расшифровать** — нужен ещё файл ключа устройства.
- **Украв только файл хранилища** (например, с флешки или из бэкапа), злоумышленник не получит ничего: у него нет ни пароля, ни ключа устройства.
- **Украв компьютер целиком**, злоумышленник упирается в мастер-пароль, который нигде не записан.

### 8.4 Цепочка шифрования (что происходит при вводе пароля)

```
Мастер-пароль
      ↓  Argon2id (16 МБ памяти, 3 итерации, 2 потока)
Первичный ключ
      ↓  HKDF-SHA256 вместе с ключом устройства (+ секрет флешки, если включена)
Ключ шифрования хранилища
      ↓  XChaCha20-Poly1305 (внешний слой — защищает заголовок)
Скрытый ключ данных (случайный, 256 бит)
      ↓  AES-256-GCM (внутренний слой — защищает записи)
Ваши записи
```

По слоям:

1. **Argon2id** — победитель конкурса Password Hashing Competition, стандарт OWASP. Алгоритм намеренно «дорогой»: требует 16 МБ оперативной памяти на каждую попытку подбора, что делает перебор паролей на видеокартах практически бессмысленным. Подбор одного пароля занимает заметное время даже на мощном железе.
2. **HKDF-SHA256** «сшивает» ваш пароль с ключом устройства (и секретом флешки, если включена) в единый ключ шифрования.
3. **XChaCha20-Poly1305** — современный шифр с аутентификацией; защищает служебный заголовок, в котором спрятан отдельный ключ данных.
4. **AES-256-GCM** — тот же стандарт, что используется банками и госструктурами; им зашифрованы сами записи.

### 8.5 Зачем шифрование двухслойное

- Ключ данных (payload key) генерируется случайно и хранится внутри зашифрованного заголовка.
- **Смена мастер-пароля происходит мгновенно**: перешифровывается только крошечный заголовок, а не весь массив данных — при этом старый пароль перестаёт работать сразу и полностью.
- Два независимых алгоритма означают, что гипотетическая уязвимость одного из них не скомпрометирует данные.

### 8.6 Защита в процессе работы

| Угроза | Как закрыта |
|--------|-------------|
| Оставленный без присмотра компьютер | Автоблокировка по таймауту (по умолчанию 5 минут бездействия, настраивается), при сворачивании в трей и вручную |
| Пароль в буфере обмена | «Слепое копирование»: секрет шифруется и живёт только в памяти приложения, системный буфер не используется; вставка — глобальным хоткеем имитацией клавиатуры, буфер одноразовый. Опционально — обычный буфер с автоочисткой по таймеру и отключением истории Win+V |
| Дамп памяти | Ключи затираются нулями после использования (zeroize), страницы памяти с ключами запрещены к выгрузке на диск (VirtualLock); Windows: запрет crash-дампов на уровне процесса, вытеснение рабочего набора при блокировке/выходе |
| Подбор пароля | Единый ограничитель частоты: неудачные попытки пароля, API-токена и Windows Hello делят общий счётчик с растущей задержкой |
| Подмена/повреждение файла | Аутентифицированное шифрование: любое изменение файла = ошибка расшифровки |
| Сбой при сохранении | Атомарная запись: сначала временный файл, потом мгновенная подмена — хранилище не «побьётся» на половине записи |
| Подглядывание | Пароли маскируются точками, показ — только по явному действию, авто-скрытие по таймауту из настроек |
| Кейлоггеры при входе на сайты | Авто-ввод (auto-type) эмулирует клавиатуру на уровне ОС, минуя поля ввода пароля менеджера (Windows) |
| Скрытый доступ программ к паролям | Расширение получает доступ только после явного подтверждения в диалоге приложения; ключ живёт до перезапуска Mynx |
| Принуждение открыть хранилище | Decoy-пароль: правдоподобное фиктивное хранилище; по файлу невозможно определить, есть ли у него ложный слой |

### 8.7 Резервные копии и аварийный доступ

- **Автобэкапы**: по расписанию (интервал, папка, глубина ротации) — зашифрованные копии хранилища и ключа устройства.
- **Зашифрованный экспорт** (`.spbackup`): отдельный формат, где ключ выводится **только из мастер-пароля** (без привязки к устройству) — такую копию можно восстановить на другом компьютере, зная пароль. Файл остаётся полностью зашифрованным.
- **Emergency Kit** — печатная форма (браузерный Print → PDF) и PNG с QR-кодом, содержащим ключ устройства. Это «запасной ключ от сейфа»: храните его распечатанным в надёжном месте. Кто получил QR — получил половину доступа (вторую половину даёт пароль).

### 8.8 Честные ограничения (важно знать)

- **Пароль не восстанавливается.** Нет сервера — некому его «сбросить». Забытый мастер-пароль + утерянный ключ устройства = данные потеряны безвозвратно. Это плата за настоящую zero-knowledge модель.
- Ключ устройства хранится файлом рядом с хранилищем — важно не раздавать вместе и хранилище, и `.safepass.dk`. При включённом Windows Hello ключ сессии дополнительно прячется в Credential Manager, но `.safepass.dk` продолжает существовать.
- Аппаратный ключ (флешка) — двухсторонняя защита: потерянная флешка без резервной копии keyfile делает хранилище недоступным. Храните копию keyfile отдельно.
- Функциональность зависит от ОС: auto-type и биометрия — только Windows; на Linux приложение и расширение работают, но auto-ввод недоступен.
- Безопасность мастер-пароля — ваша зона ответственности: встроенный генератор, индикатор стойкости и панель Health помогают выбрать и поддерживать надёжные пароли.

### 8.9 Криптографические библиотеки (фактически используемые)

| Задача | Библиотека | Статус |
|--------|-----------|--------|
| Argon2id | `argon2` (RustCrypto) | Эталонная реализация победителя PHC |
| XChaCha20-Poly1305 | `chacha20poly1305` (RustCrypto) | Широко аудируемая |
| AES-256-GCM | `ring` | Код из BoringSSL/Google, многократные аудиты |
| HKDF-SHA256 | `hkdf` + `sha2` (RustCrypto) | Стандарт RFC 5869 |
| Генератор случайных чисел | `getrandom`, `ring::rand` | Использует криптографический ГСЧ операционной системы |
| Затирание памяти | `zeroize` | Гарантированное обнуление буферов |
| Сравнение без утечек по времени | `subtle` | Constant-time операции |
| Хранилище секретов ОС | `keyring` (windows-native) | Windows Credential Manager |

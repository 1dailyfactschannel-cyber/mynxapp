# Mynx — Secure Entry Capture: Спецификация интеграций

## Цель
Максимально быстро и безопасно добавлять новые логин+пароль в Mynx, не ломая security model.

---

## Подходы (от самого безопасного к самому удобному)

### 1. 🛡️ Ручной ввод (Manual Entry) — Baseline
**Безопасность: ★★★★★ | Удобство: ★★☆☆☆**

Пользователь открывает Mynx, нажимает `Ctrl+N`, заполняет форму.

**Оптимизация скорости:**
- `Ctrl+N` → мгновенно открывает Quick Add overlay (не модал — inline overlay поверх vault)
- Автофокус на поле Title
- `Tab` → Username → `Tab` → Password → `Tab` → URL → `Tab` → `Enter` = Save
- Title авто-определяется по URL (fetch favicon + site name)
- Password авто-генерируется (если поле пустое → предложить strong password)
- Category авто-определяется по URL (google.com → Social, chase.com → Banking)
- **Всего 3-4 поля + Enter = запись создана**

**Форма Quick Add:**
```
+----------------------------------------------------------+
|  Quick Add Entry                                 [✕]     |
+----------------------------------------------------------+
|                                                          |
|  Title:     [Google Account                    ]         |
|  Username:  [my.email@gmail.com                ]         |
|  Password:  [••••••••••••••••] [👁] [🔄 Generate]      |
|  URL:       [https://accounts.google.com       ]         |
|  Category:  [Social ▾]                                   |
|                                                          |
|  [Advanced ▾]  → TOTP, Notes, Custom Fields (hidden)     |
|                                                          |
|  [     💾 Save (Ctrl+Enter)     ]   [Cancel]           |
+----------------------------------------------------------+
```
- **Hotkey: `Ctrl+N` — открыть, `Ctrl+Enter` — сохранить, `Esc` — закрыть**
- Поле Password: если пустое, при фокусе показывает "Generate strong password?" suggestion
- Авто-определение: при вставке URL → fetch title из `<title>` тега (HEAD request, no JS)
- После сохранения: тост "Saved to Google Account" + auto-lock через 5 сек если неактивно

---

### 2. 🔐 Browser Companion (Native Messaging) — Рекомендуемый
**Безопасность: ★★★★☆ | Удобство: ★★★★★**

Браузерное расширение + Native Messaging API = расширение говорит напрямую с Mynx десктопным приложением через защищённый IPC-канал. **Данные не идут через сеть, не висят в clipboard.**

**Архитектура:**
```
Browser Extension
    ↓ (Native Messaging API — stdin/stdout)
Native Host (Rust binary, signed, bundled with Mynx)
    ↓ (Tauri IPC / named pipe / local socket)
Mynx Desktop App
    ↓ (in-memory, zeroized)
Vault (SQLite + XChaCha20)
```

**Как работает:**
1. Пользователь логинится на сайте (google.com)
2. Mynx Extension детектит `<form>` с `type="password"` на submit
3. Показывает небольшой toast: "🔐 Save to Mynx? [Yes] [No] [Always]"
4. Если Yes → расширение отправляет JSON через Native Messaging:
   ```json
   {
     "action": "save_entry",
     "title": "Google Account",
     "username": "my.email@gmail.com",
     "password": "***encrypted***",
     "url": "https://accounts.google.com",
     "timestamp": 1691234567
   }
   ```
5. Native Host (Rust) валидирует origin, подпись, и передаёт в Mynx
6. Mynx показывает Preview: "Добавить Google Account?" → подтверждение
7. После подтверждения → сохраняется в vault

**Security measures:**
- Native Host binary подписан тем же сертификатом что и Mynx (anti-tampering)
- Расширение проверяет origin (`chrome-extension://` или `moz-extension://`) — whitelist
- Все данные zeroized в памяти после обработки
- Extension **не имеет доступа к vault** — только к add-entry API
- Extension **не хранит** никаких данных — stateless
- Communication через OS-protected pipe (Windows: named pipe, macOS: Unix socket, Linux: Unix socket)

**Горячая клавиша расширения:** `Ctrl+Shift+S` → "Save current login to Mynx"

**Расширение (Chromium / Firefox / Safari):**
- Минимальный footprint (~50KB)
- Только content script + background script + native messaging host
- Никакого UI кроме toast notification
- Open source (репозиторий `mynx-extension`)

---

### 3. 📋 Clipboard Capture (Secure Paste) — Временный
**Безопасность: ★★★☆☆ | Удобство: ★★★★☆**

Если пользователь скопировал пароль из email/телеграма/где-то ещё — можно быстро вставить в Quick Add форму.

**Реализация:**
- `Ctrl+V` в поле Password → вставка работает как обычно
- **Но**: Mynx никогда не читает clipboard в background
- **Clipboard Watcher (опционально, отключен по умолчанию):**
  - Если включен: Mynx мониторит clipboard на появление URL-логина-пароля паттернов
  - При обнаружении: показывает toast "Detected credentials. Add to Mynx?"
  - **Предупреждение при включении**: "Clipboard monitoring reduces security. Any app can read clipboard."
  - Auto-disable через 5 минут бездействия

**Secure clipboard flow:**
```
1. User copies password from somewhere
2. Opens Mynx (Ctrl+Shift+A — global hotkey)
3. Quick Add auto-detects clipboard content:
   - If URL in clipboard → auto-fills URL field
   - If password-like string → auto-fills Password field + suggests generate new
4. User fills остальные поля → Save
5. Mynx auto-clears clipboard after paste (опционально)
```

**Clipboard auto-clear:**
- После `Ctrl+V` в Password field → 30-секундный таймер на очистку clipboard
- Если пользователь копирует что-то другое → таймер сбрасывается
- Windows: также очищается Windows Clipboard History (`SetClipboardData` + empty)

---

### 4. ⚡ Global Hotkey (Quick Capture) — Для быстрых сценариев
**Безопасность: ★★★★☆ | Удобство: ★★★★☆**

Глобальная горячая клавиша работает из любого приложения.

**Настройка:**
```
Default: Ctrl+Shift+A (Add)
Fallback: Ctrl+Shift+S (Save) — если конфликт
```

**Поведение:**
1. Пользователь на сайте, заполнил форму, но ещё не сабмитнул
2. Нажимает `Ctrl+Shift+A`
3. Mynx открывает **мини-overlay** (не полное окно):
   ```
   +----------------------------------+
   |  🔐 Mynx Quick Add             |
   |  --------------------------------  |
   |  Site:   [accounts.google.com]   |
   |  User:   [my.email@gmail.com]    |
   |  Pass:   [••••••••••••••]        |
   |                                    |
   |  [💾 Save]  [🔄 Generate] [✕]    |
   +----------------------------------+
   ```
   - Mynx **не читает** данные из браузера автоматически
   - Пользователь вручную копирует username/password (Ctrl+C → Ctrl+V) или вводит
   - Это **ручной** процесс, но окно всегда под рукой
   - Overlay можно перетаскивать, оно stays on top
   - `Ctrl+Shift+A` повторно → скрыть/показать overlay

**Вариация — "Capture Mode":**
- Нажимаешь `Ctrl+Shift+A` → открывается overlay с инструкцией:
  "1. Скопируй username, 2. Скопируй password, 3. Нажми Save"
- Mynx слушает clipboard (только в режиме Capture, только вручную активировано):
  - Первый clipboard paste → Username field
  - Второй clipboard paste → Password field
  - URL берётся из активного окна (window title → URL extraction)
- После Save → clipboard clear, режим выключается

---

### 5. 📱 QR Code Scan (для TOTP / перенос)
**Безопасность: ★★★★★ | Удобство: ★★★☆☆**

Для миграции с телефона или добавления TOTP.

**Реализация:**
- В Entry Detail → "Scan QR Code" → открывает камеру (если есть) или позволяет загрузить скриншот
- Декодирует QR → извлекает `otpauth://` URI → автозаполняет TOTP поля
- Для паролей: пользователь может сгенерировать QR на другом устройстве и отсканировать
- **Одноразовый**: QR не хранится, данные сразу в encrypted vault

---

### 6. 📥 Import (Batch) — Одноразовый
**Безопасность: ★★★★☆ | Удобство: ★★★☆☆**

Уже описано в architecture.md — импорт из 1Password, Bitwarden, KeePass, Chrome, CSV.

**Улучшение:**
- Drag-and-drop .csv / .json файла на Mynx окно → auto-detect формат → preview → import
- Smart duplicate detection: "47 entries, 3 duplicates found — merge or skip?"
- Progress bar для больших импортов (>1000 entries)

---

## 🔐 Security Matrix

| Метод | Данные в clipboard | Данные в сети | Автоматизация | Риски | Рекомендация |
|-------|-------------------|---------------|---------------|-------|-------------|
| Manual Entry | Нет | Нет | Низкая | Keylogger | ✅ Baseline |
| Browser Extension | Нет | Нет | Высокая | Rogue extension, XSS | ✅ **Рекомендуется** |
| Clipboard Paste | Да (кратковременно) | Нет | Средняя | Clipboard history, malware | ⚠️ Осторожно |
| Clipboard Watcher | Да | Нет | Высокая | Clipboard history, malware | ❌ Не рекомендуется (off by default) |
| Global Hotkey | Опционально | Нет | Средняя | Overlay interception | ✅ Безопасно (manual paste) |
| QR Scan | Нет | Нет | Низкая | Camera access, QR spoofing | ✅ Безопасно |
| Import | Нет | Нет | Высокая | Malformed file | ✅ Безопасно (sandboxed parsing) |

---

## 🏆 Рекомендуемый Primary Flow

**Browser Extension + Native Messaging** — это золотая середина. Но так как мы строим offline-only приложение с нуля, первым этапом будет **Global Hotkey + Manual Paste**, а Extension — на фазе 6 (после релиза).

### Фаза 4 (M4): Global Hotkey + Quick Add
- `Ctrl+Shift+A` → always-on-top overlay
- `Ctrl+N` → Quick Add внутри приложения
- Manual clipboard paste с auto-clear
- Title/Category auto-detect по URL
- Auto-generate password suggestion

### Фаза 6 (M6+): Browser Extension
- Расширение для Chrome/Firefox/Edge
- Native Messaging host (Rust)
- Auto-detect login forms → toast → one-click save
- `Ctrl+Shift+S` → save current form

---

## 📋 API Commands для Capture

```rust
// Tauri Commands (добавить к существующим)

#[tauri::command]
async fn quick_add_capture(
    title: String,
    username: String,
    password: String,
    url: Option<String>,
    category: Option<String>,
    app: AppHandle
) -> Result<String, String> {
    // Validate inputs (length, format)
    // Encrypt password
    // Save to vault
    // Return entry ID
}

#[tauri::command]
async fn detect_clipboard_entry(app: AppHandle) -> Result<Option<ClipboardEntry>, String> {
    // Read clipboard (only when explicitly called, not background)
    // Detect URL/username/password patterns
    // Return parsed entry or None
    // DOES NOT store anything — only returns for preview
}

#[tauri::command]
async fn clear_clipboard(app: AppHandle) -> Result<(), String> {
    // Clear OS clipboard
    // Clear Windows clipboard history
    // Zeroize any cached data
}

#[tauri::command]
async fn auto_detect_site_info(url: String) -> Result<SiteInfo, String> {
    // HEAD request to URL
    // Extract <title>, favicon
    // Guess category from domain (google.com → social, chase.com → banking)
    // Return title + icon_url + category
}
```

---

## 🎨 UI/UX для Quick Add Overlay

```
+----------------------------------------------------------+
|  🔐 Mynx Quick Add         [—] [□] [✕]              |
+----------------------------------------------------------+
|                                                          |
|  [🔗] Site URL:   [https://accounts.google.com  ]         |
|  [👤] Username:   [my.email@gmail.com           ]         |
|  [🔑] Password:   [••••••••••••••] [👁] [🔄 Gen]        |
|  [🏷] Title:      [Google Account               ]         |
|  [📁] Category:   [Social ▾]                              |
|                                                          |
|  [Advanced ▾] — TOTP, Notes, Custom Fields (collapsed)   |
|                                                          |
|  Strength: [████████████░░] Strong (92/100)             |
|                                                          |
|  [      💾 Save Entry (Ctrl+Enter)      ]  [Cancel]     |
+----------------------------------------------------------+
|  ℹ️  Clipboard will be cleared in 30 seconds             |
+----------------------------------------------------------+
```

**Hotkeys:**
- `Ctrl+Shift+A` — Toggle overlay (global)
- `Ctrl+Enter` — Save
- `Esc` — Cancel + close
- `Tab` — Navigate fields
- `Ctrl+G` — Generate new password
- `Ctrl+H` — Show/hide password

**Auto-behaviors:**
- При открытии: если в clipboard есть URL → auto-fill URL
- При открытии: если в clipboard есть password-like string → auto-fill Password (с предупреждением)
- При вводе URL → auto-fetch title (1s debounce) + category
- При клике "Generate" → генерирует strong password, копирует в clipboard (для вставки на сайте), показывает тост
- После Save → очистка формы, тост "Saved to [Title]", auto-clear clipboard

---

## 📝 Реализация Global Hotkey в Tauri

```rust
// tauri-plugin-global-shortcut
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::init()
                .with_handler(|app, shortcut, event| {
                    if shortcut == Shortcut::new("Ctrl+Shift+A") {
                        // Show/hide Quick Add overlay
                        let window = app.get_window("quick-add").unwrap();
                        if window.is_visible().unwrap() {
                            window.hide().unwrap();
                        } else {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                            // Pre-fill from clipboard if possible
                        }
                    }
                })
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Overlay window config:**
```json
{
  "windows": [
    {
      "label": "quick-add",
      "url": "quick-add.html",
      "width": 480,
      "height": 400,
      "alwaysOnTop": true,
      "resizable": false,
      "maximizable": false,
      "minimizable": false,
      "title": "Mynx Quick Add",
      "visible": false,
      "transparent": true,
      "decorations": false
    }
  ]
}
```

---

## ✅ Сводка

| Метод | Приоритет | Фаза | Усилие |
|-------|-----------|------|--------|
| **Quick Add (Ctrl+N)** | P0 | Фаза 3 | 1 день |
| **Global Hotkey + Overlay** | P0 | Фаза 4 | 2 дня |
| **Clipboard Paste + Auto-clear** | P1 | Фаза 4 | 0.5 дня |
| **Site Auto-detect (HEAD request)** | P1 | Фаза 4 | 1 день |
| **Import (drag-drop)** | P1 | Фаза 4 | 2 дня |
| **QR Code (TOTP)** | P2 | Фаза 5 | 1 день |
| **Browser Extension** | P3 | Фаза 6+ | 1-2 недели |
| **Clipboard Watcher** | P4 | Не реализовывать | — |

**Первый релиз (M5):** Quick Add + Global Hotkey + Clipboard Paste + Auto-detect + Import. Без Extension — это отдельный проект.

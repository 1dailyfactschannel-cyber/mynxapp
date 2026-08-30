# Mynx — Differentiating Features

Фичи, которые делают Mynx лучше 1Password, Bitwarden, KeePassXC — без облака и подписки.

---

## 1. 🔑 Auto-Type (Global Hotkey — Killer Feature)

**Что это:** Глобальная горячая клавиша вставляет логин/пароль в **любое** приложение — не только браузер, но и игры, Steam, RDP, терминал, VPN-клиент.

**Как работает:**
1. Пользователь стоит на поле username в Steam / RDP / VPN
2. Нажимает `Ctrl+Shift+A` (настраиваемый)
3. Mynx показывает overlay: "Which entry? [Search...]"
4. Выбирает "Steam Account"
5. SafePress имитирует **клавиатурный ввод** (не clipboard!):
   ```
   [Type username] → Tab → [Type password] → Enter
   ```
6. **Никакого clipboard** — keylogger не видит, malware не сканирует.

**Почему это killer:**
- 1Password / Bitwarden: только browser autofill
- KeePass: умеет, но UI из 2000-х, настройка сложная
- Mynx: **современный UX**, match by window title, preview before type, configurable sequence

**Sequence editor:**
```
Entry: Steam Account
  Auto-Type sequence: {USERNAME}{TAB}{PASSWORD}{ENTER}
  Custom: {USERNAME}{DELAY 100}{TAB}{DELAY 100}{PASSWORD}{ENTER}
  Match window: "Steam" (regex supported)
```
- `{USERNAME}`, `{PASSWORD}`, `{TOTP}`, `{TAB}`, `{ENTER}`, `{DELAY N}`, `{CLEARFIELD}`
- Match by window title / process name
- Preview: "Will type: myuser[TAB]••••••[ENTER] into Steam.exe"

---

## 2. 🛡️ Duress Password + Hidden Vault (Plausible Deniability)

**Что это:** Если вас заставляют открыть vault — вводите **duress password**. Открывается **fake vault** с фейковыми данными. Реальный vault остаётся скрытым.

**Как работает:**
- При создании vault: опционально "Enable Duress Mode"
- Запрашивается **duress password** (отличается от мастер-пароля)
- Запрашивается **fake vault content** (импорт пустого / dummy CSV)
- При вводе duress password: открывается fake vault с "похожими" данными
- **Real vault** остаётся зашифрованным на месте, невидимым
- При вводе мастер-пароля: открывается real vault

**Advanced — Hidden Vault:**
- Внутри vault-файла есть **скрытый контейнер** (TrueCrypt-style)
- Два пароля: outer (decoy) → fake data, inner (real) → real data
- Файл размер одинаковый — невозможно доказать наличие hidden vault
- Реализуется через nested encryption: один и тот же файл, два разных ключа

**Security:**
- Нет метаданных о наличии hidden vault (file size = max(outer, inner) + padding)
- Padding до фиксированного размера (например, 10MB) чтобы не было видно разницы
- Для тоталитарных режимов / границы / ограблений — must-have

**У кого есть:** VeraCrypt (disk encryption), KeePassXC (плагин), но **ни один менеджер паролей** не делает это из коробки с современным UX.

---

## 3. 📄 Templates (Rich Entry Types)

**Не только логин-пароль.** Как у 1Password, но больше типов.

**Builtin Templates:**

| Template | Поля | Auto-Type |
|----------|------|-----------|
| **Login** | Username, Password, URL, TOTP | `{USERNAME}{TAB}{PASSWORD}{ENTER}` |
| **Credit Card** | Card number, Expiry, CVV, PIN, Billing zip | `{CARDNUMBER}{TAB}{CVV}{ENTER}` |
| **Bank Account** | Bank, Account, Routing, SWIFT, IBAN | Manual |
| **Identity** | Name, DOB, SSN, Passport, Nationality, Address | `{FULLNAME}{TAB}{DOB}{TAB}{SSN}` |
| **Passport** | Country, Number, Issue Date, Expiry, Photo | Manual |
| **Driver License** | Number, Class, Expiry, State | Manual |
| **WiFi** | SSID, Password, Security type, QR code | Manual (share QR) |
| **SSH Key** | Private key, Public key, Passphrase, Algorithm | `{PASSPHRASE}` |
| **API Key** | Key, Secret, Endpoint, Environment | Manual |
| **Software License** | Key, Vendor, Seats, Expiry, Invoice | Manual |
| **Secure Note** | Title, Body (rich text), Attachments | Manual |
| **Crypto Wallet** | Address, Seed phrase, Private key, Network | Manual (NEVER auto-type) |

**UI для Template:**
- `+ New Entry` → выбор Template (иконки, красивый grid)
- Поля валидируются (Credit Card: Luhn check, Expiry: future date)
- **Custom Templates**: пользователь создаёт свои ("Car Insurance" → Company, Policy#, VIN, Expiry)
- **Field types**: Text, Password, URL, Date, Number, Email, Phone, Address, File, Boolean, Dropdown

---

## 4. 📎 Secure Attachments (Encrypted Files)

**Хранить файлы прямо в vault:**
- Сканы паспортов, водительских, страховок
- Копии криптоключей (GPG, SSH)
- PDF с важными документами
- Фото QR-кодов (backup 2FA)

**Technical:**
- Файл шифруется той же XChaCha20 ключом, что и vault
- Хранится внутри vault-файла (inline) или sidecar `.safepass-attachments/` (для файлов > 1MB)
- **Лимит**: 10MB per file, 100MB total per vault (настраиваемо)
- **Preview**: thumbnails для картинок, icon для PDF/DOC
- **Drag & drop**: перетаскивание файла на запись

**Конкуренты:**
- KeePass: attachments есть, но UI ужасный (binary blob, no preview)
- 1Password: 1GB limit (но облако, подписка)
- Mynx: **локально, без лимитов кроме диска**, с preview

---

## 5. 📊 Password Health Dashboard (Local Watchtower)

**Анализ безопасности vault без облака.**

```
+----------------------------------------------------------+
|  🔐 Security Score: 87/100                               |
|  [████████████████████░░░░░░░░]                           |
+----------------------------------------------------------+
|                                                          |
|  ┌────────────────────────────────────────────────────┐  |
|  │  ⚠️  Weak Passwords              3    [Fix]       │  |
|  │  🔁 Reused Passwords             2    [Fix]       │  |
|  │  🕐 Old Passwords (>1 year)    5    [Fix]       │  |
|  │  🌐 Breached Sites               1    [Fix]       │  |
|  │  📱 No 2FA Available            12   [View]       │  |
|  │  🔓 Empty Passwords              0    ✅        │  |
|  └────────────────────────────────────────────────────┘  |
|                                                          |
|  [Run Full Audit]  [Generate Report]                      |
+----------------------------------------------------------+
```

**Checks (all local):**
1. **Weak passwords** — zxcvbn score < 3
2. **Reused passwords** — одинаковый hash в разных записях
3. **Old passwords** — age > 90 / 180 / 365 дней (настраиваемо)
4. **Breached sites** — локальная база HIBP (Have I Been Pwned), скачивается раз в месяц, offline check
5. **Missing 2FA** — домен известен поддерживать 2FA, но TOTP не настроен
6. **Empty passwords** — записи без пароля
7. **Unsecure URLs** — HTTP вместо HTTPS
8. **Duplicate entries** — одинаковый URL + username

**HIBP Offline:**
- Скачиваем `pwned-passwords-sha1-ordered-by-hash-v8.txt` (20GB, раз в месяц)
- Или bloom filter компактный (500MB) — fast probabilistic check
- Всё локально, никаких API запросов, никаких паролей не покидают машину

**Fix workflow:**
- Click "Fix" → открывает entry detail → Generator → заменить → Save
- Bulk fix: "Fix all weak passwords" → generate new for each → preview → confirm

---

## 6. 🔐 BIP39 Mnemonic (Seed Phrase as Master Password)

**Вместо сложного пароля — 12-24 английских слова.**

**Почему это лучше:**
- 12 words = 128-bit entropy (не взломать)
- 24 words = 256-bit entropy (перебор невозможен)
- Легко записать, легко запомнить, легко воспроизвести
- Стандарт Bitcoin, проверен десятилетиями
- Можно хранить в metal backup (fireproof)

**Реализация:**
```
Master Password Setup:
  [Enter password] OR [Generate seed phrase]

Seed phrase: "abandon ability able about above absent absorb abstract absurd abuse access"
  [🔄 Regenerate]  [Copy]  [Show as QR]  [🔊 Speak (TTS)]

  ⚠️  Write this down on paper. Never store digitally.
     Store in a fireproof safe or safety deposit box.
```
- BIP39 wordlist (2048 слов, русская версия опционально)
- При вводе: autocomplete по словам (type "ab" → "abandon", "ability", "able"...)
- Применяем PBKDF2-HMAC-SHA512(seed, "mnemonic") как BIP39 standard
- Дальше как обычно: Argon2id(seed-derived-key, salt)

**Совместимость:**
- Seed phrase можно использовать в любом кошельке (Ledger, Trezor, MetaMask)
- Это **master password**, а не крипто seed — но можно использовать тот же seed для обоих (если пользователь хочет)

---

## 7. 🔌 Portable Mode (USB Vault)

**Запуск Mynx с USB флешки без установки.**

```
E:\Mynx\
├── Mynx.exe          (single executable, ~15MB)
├── mynx-data\         (vault + config + backups)
│   ├── vaults\
│   │   └── personal.safepass
│   └── config.json
└── README.txt
```
- **No installation** — копируешь на флешку, запускаешь на любом Windows/macOS/Linux
- **No registry** — не оставляет следов на хост-машине
- **Auto-lock on USB removal** — если выдернули флешку → немедленный lock
- **Read-only mode** — опционально, для киберкафе / чужих компьютеров
- Сохраняет `mynx-data` рядом с exe (relative path)

**Конкуренты:**
- KeePass: portable mode есть ( classic )
- 1Password / Bitwarden: нет, требуют установки / облака

---

## 8. ⌨️ Virtual Keyboard (Anti-Keylogger)

**Ввод мастер-пароля через виртуальную клавиатуру.**

```
+----------------------------------------------------------+
|  Enter Master Password                                   |
|  [••••••••••••••]                                        |
|                                                          |
|  ┌────────────────────────────────────────────────────┐  |
|  │  ` 1 2 3 4 5 6 7 8 9 0 - =                         │  |
|  │  Q W E R T Y U I O P [ ] \                         │  |
|  │  A S D F G H J K L ; '                             │  |
|  │  Z X C V B N M , . /                             │  |
|  │  [Shift] [Space] [Backspace] [Enter]               │  |
|  │  [Randomize layout] [Scramble keys]                │  |
|  └────────────────────────────────────────────────────┘  |
|                                                          |
|  [Use Physical Keyboard]  [Virtual Keyboard Only]        |
+----------------------------------------------------------+
```
- **Randomized layout**: каждый раз разная раскладка, keylogger бесполезен
- **Scramble**: буквы перемешиваются (Q, A, Z не там где ожидается)
- **Click only**: пароль вводится только мышкой, никаких keyboard events
- **Screen recording protection**: overlay полупрозрачный, не читается

**Use case:**
- Публичные компьютеры
- Подозрение в keylogger
- Air-gapped systems (настройка)

---

## 9. 📤 Encrypted Sharing (LAN / QR / File)

**Поделиться паролем безопасно, без облака.**

**Методы:**

### A. QR Code (One-time)
```
Share "Google Account" password:
  [Generate QR Code] → QR valid for 5 minutes, one scan
  [Set expiry: 5 min / 1 hour / 1 day]
  [Require recipient password: yes/no]
```
- Данные шифруются с одноразовым ключом, встроенным в QR
- Сканируешь → автоматически расшифровывается
- После срока / скана — ключ уничтожается

### B. Encrypted File
```
Export entry as .safepass-share:
  - Encrypted with recipient's public key (или shared passphrase)
  - Передаёшь через email / Telegram / USB
  - Recipient открывает в Mynx с passphrase
```

### C. LAN Transfer (Local Network)
```
Share via LAN:
  Mynx A: [Share entry] → generates temporary AES key + local IP
  Mynx B: [Receive] → scan QR / enter PIN
  Direct peer-to-peer, encrypted, no internet
```
- Работает только в локальной сети (WiFi)
- Закрытые порты, UPnP не требуется
- Auto-discover через mDNS (Bonjour)
- После передачи — ключ уничтожается

**Конкуренты:**
- 1Password: Send (share link, но через их серверы)
- Bitwarden: Send (через их облако)
- Mynx: **полностью offline**, LAN или QR, никаких серверов

---

## 10. ⚡ Quick Actions (Workflow Automation)

**Предопределённые сценарии для частых задач.**

```
Quick Actions:
  [🔐 New Login]          → Ctrl+Shift+N
  [🔄 Change Password]    → Generator + auto-update entry
  [📋 Copy TOTP]          → быстрое копирование 2FA кода
  [🔗 Open URL + Copy]    → открывает сайт, копирует пароль в clipboard
  [🔑 Fill Form]          → Auto-Type для текущего окна
  [🗑  Delete Old]        → показывает записи старше 1 года
  [📊 Security Audit]     → открывает Dashboard
```

**Custom Workflows:**
- Пользователь создаёт свои: "Banking Routine" → открывает Chase, копирует username, ждёт 2 сек, копирует password
- Похоже на macOS Shortcuts / Automator, но для паролей
- Можно назначить global hotkey per workflow

---

## 11. 🎯 Integration with OS Keychain

**Import / Export из OS password managers:**
- Windows: Credential Manager (import credentials)
- macOS: Keychain (import/export Keychain items)
- Linux: Secret Service / libsecret (import)
- Браузеры: Chrome, Firefox, Edge, Safari (import passwords)
- One-time при миграции — не постоянная sync

---

## 12. 🎮 Game Mode / Presentation Mode

**Когда открыт vault, но нужно показать экран:**
- **Game Mode**: overlay без entry details, только titles + search, пароли скрыты
- **Presentation Mode**: все sensitive fields замаскированы, для скринкастов / стримов
- **Stream Protection**: авто-обнаружение OBS / Discord stream → включает presentation mode

---

## 13. 📅 Password Expiration + Reminders

**Настраиваемые политики для категорий:**
```
Banking passwords:   expire every 90 days
Work passwords:      expire every 180 days
Social passwords:    expire every 365 days
Crypto:              never expire (seed phrase is forever)
```
- При expiration: уведомление в status bar + badge count
- "Security Audit" показывает expired записи
- Можно игнорировать per-entry ("< never remind")

---

## 14. 🔑 Passkey Support (Local / FIDO2)

**Хранить Passkeys локально.**

- Mynx acts as **local authenticator** (как YubiKey, но софт)
- FIDO2 / WebAuthn credentials хранятся в vault
- При логине на сайт: Mynx показывает prompt "Use stored Passkey for [site]?"
- Подпись происходит в Rust backend, private key не покидает vault
- **No cloud** — passkeys синхронизируются только через Export/Import или LAN share

**Ограничение:** Passkeys работают только через Browser Extension (Phase 6+). Но vault уже готов к хранению credential IDs и private keys.

---

## 15. 🧠 Smart Assistant (AI, но локальный)

**Никаких облачных AI.** Только локальная модель (например, `llama.cpp` или `ollama` на машине пользователя).

```
Ask Mynx Assistant:
  "Which passwords should I change after the LastPass breach?"
  → Searches local entries with URL matching LastPass breach
  → Shows: "3 entries affected: Netflix, Spotify, GitHub"
  → "Generate new passwords?"

  "What's my weakest password?"
  → "Netflix: 23/100. Suggest: generate strong?"

  "When did I last change my banking password?"
  → "Chase: 87 days ago. Policy: 90 days. Change soon?"
```
- **Полностью опционально** — не требует интернета, не отправляет данные
- Модель работает с metadata (titles, categories, strength scores), **не** с паролями
- Если пользователь не установил локальную LLM — assistant не активен

---

## Приоритетизация (что в релиз, что потом)

| # | Фича | Приоритет | Фаза | Критерий "лучше всех" |
|---|------|-----------|------|----------------------|
| 1 | **Auto-Type** | P0 | Фаза 4 | ✅ KeePass умеет, но с ужасным UX. Мы делаем современный. |
| 2 | **Templates** | P0 | Фаза 3 | ✅ 1Password есть, но облачный. Мы локально, больше типов. |
| 3 | **Password Health** | P1 | Фаза 4 | ✅ 1Password Watchtower облачный. Мы локально, bloom filter. |
| 4 | **Duress Password** | P1 | Фаза 5 | ✅ Ни у кого из менеджеров паролей из коробки. |
| 5 | **BIP39 Mnemonic** | P1 | Фаза 4 | ✅ Bitwarden тоже не делает. Крипто-совместимость. |
| 6 | **Secure Attachments** | P1 | Фаза 4 | ✅ 1Password облачный, KeePass убогий UI. |
| 7 | **Portable Mode** | P1 | Фаза 5 | ✅ KeePass умеет, но мы современнее. |
| 8 | **Virtual Keyboard** | P2 | Фаза 5 | ✅ KeePass plugin, нигде больше. |
| 9 | **Encrypted Sharing** | P2 | Фаза 5 | ✅ 1Password Send облачный. Мы LAN/QR. |
| 10 | **Quick Actions** | P2 | Фаза 5 | ✅ Нигде нет как системы. |
| 11 | **OS Keychain Import** | P2 | Фаза 4 | ✅ Помогает миграции. |
| 12 | **Game/Presentation Mode** | P3 | Фаза 5 | ✅ Нишевое, но круто для стримеров. |
| 13 | **Passkey Support** | P3 | Фаза 6 | ✅ Будущее, но требует Extension. |
| 14 | **Local AI Assistant** | P4 | Фаза 7+ | ✅ Эксперимент, но впечатляет. |

---

## Сводка: "Что делает Mynx лучше всех"

| Конкурент | Их сильная сторона | Наша превосходящая фича |
|-----------|-------------------|------------------------|
| **1Password** | UI, Watchtower, Templates | Мы делаем то же локально, без подписки, с Auto-Type и Duress |
| **Bitwarden** | Open-source, self-host | Мы легче, быстрее, без Docker, с Duress и BIP39 |
| **KeePassXC** | Offline, бесплатный, portable | Мы современный UI, Templates, Health Dashboard, Auto-Type UX |
| **NordPass** | XChaCha20, цена | Мы офлайн, без облака, с Hidden Vault и Duress |
| **Dashlane** | Dark web monitoring | Мы HIBP offline, без облака, без подписки |
| **Keeper** | Enterprise, корпоративный | Мы для индивидуалов, быстрее, дешевле (free), prettier |

**Наша уникальность:**
- 🏠 **Только офлайн** — никаких серверов, никаких подписок
- 🔐 **Duress + Hidden Vault** — защита от принуждения (unique)
- 🔑 **Auto-Type** — в любое приложение, не только браузер (best UX)
- 📊 **Local Health Dashboard** — анализ без интернета (unique)
- 📝 **Rich Templates** — не только пароли, всё что угодно (comprehensive)
- 🌱 **BIP39** — seed phrase как master password (crypto-native)
- 💾 **Portable** — с флешки, без установки (freedom)

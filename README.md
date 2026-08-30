# Mynx — План разработки

## 📌 Концепция

Mynx — **только офлайн** десктопный менеджер паролей. Ни облака, ни синхронизации, ни подписок. Современный дорогой интерфейс, максимальная безопасность, мгновенная скорость.

---

## 🔍 Анализ конкурентов

| Продукт | Шифрование | KDF | UI | Офлайн | Проблемы |
|---------|-----------|-----|----|--------|----------|
| **1Password** | AES-256-GCM | PBKDF2 + Secret Key | Премиум | ❌ | Дорого ($2.99/мес), требует облако, нет полного офлайн-режима |
| **Bitwarden** | AES-256-CBC | PBKDF2 / Argon2id | Скучный | ⚠️ (self-host) | UI "функциональный", не выглядит дорого, self-host требует Docker |
| **KeePassXC** | AES-256 / Twofish | Argon2 | Устаревший | ✅ | UI из 2000-х, нет современных анимаций, неудобен для обычных юзеров |
| **Keeper** | AES-256 | PBKDF2 | Корпоративный | ❌ | Перегружен enterprise-фичами, дорогой, облачный |
| **Dashlane** | AES-256 | Argon2d | Чистый | ❌ | **Убрали десктопные приложения** — теперь только браузер! |
| **NordPass** | XChaCha20 | Argon2id | Модерн | ❌ | Облачный, подписка, нет полного контроля |

### Чего не хватает у всех

1. **Полностью офлайн + современный UI** — KeePass офлайн, но выглядит как Excel. Остальные — облачные.
2. **Красивый интерфейс "из коробки"** — ни один open-source не выглядит как 1Password.
3. **Локальный emergency access** — 1Password требует облако для аварийного доступа. Нужен офлайн-аналог.
4. **Мгновенный старт** — Electron-приложения жрут 300MB RAM и стартуют 3 секунды.
5. **Визуальная энтропия паролей** — ни у кого нет красивого, понятного генератора с графикой энтропии.
6. **Авто-ротация локальных бэкапов** — KeePass ручной, остальные — облачные.
7. **Biometric unlock без облака** — Windows Hello / Touch ID прямо на десктопе, без сервера.
8. **Гибрид glassmorphism + neumorphism** — ни один менеджер паролей не использует современные UI-тренды.

---

## 🎯 Уникальные фичи Mynx

### Безопасность
- **XChaCha20-Poly1305** — современный AEAD-шифр, быстрее AES на CPU без AES-NI, устойчив к nonce reuse (192-bit nonce).
- **Argon2id** — лучший KDF на 2025 год, memory-hard, защита от GPU-атак.
- **Двухфакторная ключевая схема** — Master Password + локальный 128-bit Device Key (как у 1Password, но без облака).
- **Память-защищённый пул** — чувствительные данные в locked memory (Rust `mlock`/`VirtualLock`).
- **Auto-lock** — по таймауту, по смене фокуса, по приближению лицу (Windows Hello).
- **Secure clipboard** — 30-секундный таймер, автоочистка.

### UX / UI
- **Glassmorphism + Fluent Design** — frosted glass, мягкие тени, живые градиенты. Выглядит как macOS Big Sur + Windows 11.
- **Command Palette** — Cmd/Ctrl+K для мгновенного поиска по всем записям (как в VS Code).
- **TOTP внутри** — встроенный генератор 2FA-кодов, без отдельного приложения.
- **Визуальный генератор** — энтропия в real-time, анимированный strength-meter.
- **Smart categories** — авто-группировка по доменам (Banking, Social, Work, Dev).
- **Dark / Light / System** — три темы с автопереключением.

### Офлайн-фичи
- **Локальный vault** — один зашифрованный файл `.safepass`.
- **Авто-бэкапы** — ротация 10 последних версий в локальной папке.
- **Импорт** — из 1Password, Bitwarden, KeePass, Chrome, Firefox, CSV.
- **Экспорт** — encrypted backup, printable emergency sheet.
- **Emergency Kit** — PDF с QR-кодом ключевой фразы для аварийного восстановления.

---

## 🛠️ Стек технологий

### Бэкенд (ядро безопасности)
| Компонент | Технология | Зачем |
|-----------|-----------|-------|
| Фреймворк | **Tauri v2** | Rust + WebView, 2.5MB бинарник, 30-40MB RAM, security-first |
| Шифрование | **Rust `ring`** | XChaCha20-Poly1305, AES-256-GCM, проверенная Google |
| KDF | **Argon2id** | Через `argon2` crate, OWASP-рекомендации |
| RNG | **OS CSPRNG** | `/dev/urandom`, `CryptGenRandom`, `getrandom` crate |
| База | **SQLite** (encrypted) | `sqlcipher` или `rusqlite` + AES-256 |
| Файл vault | **Protobuf / FlatBuffers** | Быстрый бинарный формат, компактный |
| IPC | **Tauri Commands** | Rust ↔ Frontend, изолированный API |

### Фронтенд (интерфейс)
| Компонент | Технология | Зачем |
|-----------|-----------|-------|
| Framework | **React 19 + TypeScript** | Strict typing, современный |
| Стили | **Tailwind CSS v4** | Utility-first, быстрая разработка |
| Компоненты | **shadcn/ui** | Красивые доступные компоненты |
| Анимации | **Framer Motion** | Плавные переходы, glassmorphism-анимации |
| Иконки | **Lucide React** | Современные, консистентные |
| Шрифты | **Inter** + **JetBrains Mono** | Чистый UI + моноширинный для паролей |
| Темы | **CSS Variables + next-themes** | Dark/Light/System |

### Дополнительно
| Компонент | Технология | Зачем |
|-----------|-----------|-------|
| Биометрия | **Windows Hello / Touch ID** | `tauri-plugin-biometric` или WebAuthn |
| QR-коды | `qrcode` crate | TOTP, Emergency Kit |
| Импорт | `csv`, `serde_json`, `quick-xml` | Парсинг экспортов конкурентов |
| Тесты | `cargo test`, Vitest | Unit + integration |

---

## 📁 Структура проекта

```
Safepass/
├── docs/
│   ├── architecture.md       # Архитектура шифрования
│   ├── threat-model.md       # Модель угроз
│   ├── ui-spec.md            # Спецификация интерфейса
│   └── api-reference.md      # API фронт ↔ бэк
├── design/
│   ├── figma/                # Figma-файлы (или Excalidraw)
│   ├── colors.md             # Палитра
│   ├── components.md         # UI-компоненты
│   └── animations.md         # Motion-спецификация
├── src/
│   ├── tauri/                # Rust backend
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── crypto/       # Шифрование, KDF, RNG
│   │   │   ├── vault/        # Логика хранилища
│   │   │   ├── commands/     # Tauri IPC commands
│   │   │   └── biometrics/   # Windows Hello / Touch ID
│   │   └── tauri.conf.json
│   ├── frontend/             # React frontend
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/   # UI-компоненты
│   │   │   ├── screens/      # Экраны (Vault, Settings, Generator)
│   │   │   ├── hooks/        # React hooks
│   │   │   ├── stores/       # Zustand state management
│   │   │   └── lib/          # Утилиты, API-клиент
│   │   └── tailwind.config.ts
│   └── shared/               # Shared types (TypeScript + Rust)
├── assets/
│   ├── icons/                # App icons (ICO, ICNS, PNG)
│   ├── fonts/                # Inter, JetBrains Mono
│   └── screenshots/          # Для README
├── tests/
│   ├── e2e/                  # Playwright tests
│   └── crypto/               # Криптографические тесты (Rust)
├── Cargo.toml                # Workspace root
├── package.json              # Root package
└── README.md
```

---

## 📅 План разработки (8-10 недель)

### Фаза 1: Архитектура и скелет (Неделя 1-2)
- [ ] Инициализация Tauri v2 + React + Tailwind проекта
- [ ] Настройка dev-окружения (hot reload, linting, formatting)
- [ ] Настройка workspace (Cargo workspace, npm workspaces)
- [ ] Создание архитектурного документа (threat model, crypto design)
- [ ] Настройка CI/CD (GitHub Actions: build, test, clippy, audit)

### Фаза 2: Ядро безопасности (Неделя 2-4)
- [ ] Реализация Argon2id KDF (Rust, `argon2` crate)
- [ ] Реализация XChaCha20-Poly1305 (Rust, `ring` crate)
- [ ] Генерация CSPRNG (random salt, random nonce, device key)
- [ ] Двухфакторная ключевая схема (Master Password + Device Key)
- [ ] Vault file format (Protobuf/FlatBuffers, encrypted blob)
- [ ] SQLite encrypted schema (entries, categories, metadata)
- [ ] Memory-safe handling (zeroize, locked memory)
- [ ] Unit tests для всей криптографии (100% coverage crypto модулей)

### Фаза 3: UI / UX скелет (Неделя 3-5)
- [ ] Design system (цвета, типографика, spacing, glassmorphism CSS)
- [ ] Компоненты: Button, Input, Card, Modal, Sidebar, Command Palette
- [ ] Экран Unlock (ввод мастер-пароля, биометрия)
- [ ] Экран Vault (список записей, поиск, фильтры, категории)
- [ ] Экран Entry Detail (просмотр/редактирование записи)
- [ ] Экран Password Generator (визуальная энтропия, настройки)
- [ ] Темы: Dark / Light / System (с glassmorphism)
- [ ] Framer Motion анимации (page transitions, micro-interactions)

### Фаза 4: Интеграция и фичи (Неделя 5-7)
- [ ] IPC Commands (Tauri ↔ React): unlock, lock, CRUD entries, search
- [ ] Biometric unlock (Windows Hello, macOS Touch ID)
- [ ] Auto-lock (таймер, потеря фокуса, сон)
- [ ] Secure clipboard (copy password + auto-clear)
- [ ] TOTP generator (внутри записи, авто-обновление каждые 30с)
- [ ] Password generator ( memorable, random, passphrase, pin )
- [ ] Smart categories (авто-группировка по URL/домену)
- [ ] Favorites / Recent / Search (full-text search по vault)
- [ ] Импорт (1Password .1pif, Bitwarden .json, KeePass .kdbx, CSV)
- [ ] Экспорт (encrypted JSON, printable emergency sheet)

### Фаза 5: Полировка и релиз (Неделя 7-10)
- [ ] Emergency Kit (PDF + QR-code генерация)
- [ ] Auto-backup (ротация 10 версий vault)
- [ ] Settings (security, appearance, backup, import/export)
- [ ] Keyboard shortcuts (Cmd/Ctrl+K, Cmd/Ctrl+L, Esc)
- [ ] Performance оптимизация (lazy loading, virtualized lists)
- [ ] Accessibility (WCAG 2.1 AA, screen readers, keyboard nav)
- [ ] Security audit (cargo audit, rust-audit, ручной review)
- [ ] E2E тесты (Playwright: critical user flows)
- [ ] Сборка инсталляторов (Windows .msi, macOS .dmg, Linux .AppImage)
- [ ] README, docs, branding, иконки

---

## 🎨 Дизайн-концепция

### Визуальный стиль: **"Secure Glass"**
- Фон: глубокие градиенты (тёмно-синий → фиолетовый, или светло-серый → белый)
- Панели: frosted glass (`backdrop-filter: blur(20px)` + полупрозрачность)
- Текст: высокий контраст (Inter, 14-16px для читаемости)
- Акценты: изумрудный/бирюзовый для success, коралловый для danger
- Кнопки: subtle glassmorphism с hover-эффектом свечения
- Состояния: мягкие тени, плавные transitions (200-300ms)

### Экраны (wireframe-концепция)
```
+--------------------------------------------------+
|  🔐 Mynx                              [🔍] [⚙] |
+--------------------------------------------------+
|  Sidebar |  Main Content Area (Glass Card)        |
|  ─────────|                                       |
|  [All]   |  [Search...]                          |
|  [Bank]  |  ─────────────────────────────────   |
|  [Social]|  | Google        | ************ | 🔑|  |
|  [Work]  |  | GitHub        | ************ | 🔑|  |
|  [Dev]   |  | Bank of Amer. | ************ | 🔑|  |
|  [Fav]   |  | Netflix       | ************ | 🔑|  |
+--------------------------------------------------+
|  Status: Locked | Last backup: 2 hours ago        |
+--------------------------------------------------+
```

---

## 🔐 Модель угроз (кратко)

1. **Атака: Кража vault-файла** → Защита: Argon2id + XChaCha20-Poly1305, брутфорс невозможен при сильном мастер-пароле.
2. **Атака: Memory dump** → Защита: locked memory, zeroize после использования, auto-lock.
3. **Атака: Keylogger** → Защита: биометрическая разблокировка (не требует ввода пароля каждый раз).
4. **Атака: Clipboard history** → Защита: 30-секундный таймер, очистка clipboard.
5. **Атака: shoulder surfing** → Защита: маскирование паролей, auto-lock при отходе.
6. **Атака: Backup tampering** → Защита: signed backups, ротация, offline storage.

---

## ✅ Следующие шаги

1. **Подтвердить стек** — согласен ли ты с Tauri + React + XChaCha20?
2. **Начать с Фазы 1** — инициализировать проект и dev-окружение?
3. **Проапгрейдить** что-то в плане?

Начинаем?

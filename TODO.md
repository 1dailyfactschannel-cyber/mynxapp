# Mynx — Development Task Board

## Рабочий бинарник
```
src-tauri\target\release\mynx.exe  (12.5 MB, собран 19.07.2026)
```
Запуск: двойной клик по `mynx.exe` — portable, не требует установки.

---

## ✅ Готово

### Архитектура и документация
- [x] README.md
- [x] docs/architecture.md — crypto design, threat model
- [x] design/ui-spec.md — colors, glassmorphism, animations

### Rust Backend (src-tauri/src/)
- [x] Argon2id KDF (`crypto/kdf.rs`)
- [x] AES-256-GCM (`crypto/aead.rs`)
- [x] XChaCha20-Poly1305 (`crypto/xchacha20.rs`)
- [x] HKDF-SHA256 (`crypto/hkdf.rs`)
- [x] Memory locking — VirtualLock (`crypto/memlock.rs`)
- [x] Vault types & operations (`vault/types.rs`, `vault/operations.rs`)
- [x] Tauri IPC commands (`commands/mod.rs`)
- [x] Auto-Type — Windows SendInput (`auto_type.rs`)
- [x] `cargo check` — 0 errors, собирается

### Frontend (src/)
- [x] React 19 + TypeScript + Vite + Tailwind
- [x] Zustand stores (`stores/app.ts`, `stores/vault.ts`)
- [x] GlassCard, shadcn/ui components
- [x] Lock Screen — animated gradient, master password
- [x] Vault Selector — 3 demo vaults, create/open
- [x] Vault (Main) — sidebar, search, entry list, 6 demo entries
- [x] Entry Detail — slide-over, copy, **live TOTP**, auto-type
- [x] Quick Add — full form, password generator, strength meter
- [x] Password Generator — 4 types, entropy, history
- [x] Command Palette — `Ctrl+K`, search + actions
- [x] Settings — auto-lock, clipboard, theme, danger zone
- [x] Health Dashboard — security score, weak/reused/old/2FA
- [x] Emergency Kit — QR code, salt, KDF params, print/download
- [x] Global hotkeys: `Ctrl+K`, `Ctrl+Shift+A`, `Ctrl+Shift+T`
- [x] Auto-Lock timer — 5 min idle, countdown in header
- [x] Clipboard Auto-Clear — 30s countdown

### Сборка
- [x] Frontend build (`npm run build`) — проходит
- [x] Rust build (`cargo build --release`) — проходит
- [x] `.exe` бинарник — 12.5 MB, работает

---

## ⚠️ Не получилось / Заблокировано

### Инсталлятор
- [ ] `.msi` — Tauri пытается скачать WiX с GitHub, timeout (сетевые ограничения)
- [ ] `.nsis` — аналогично, timeout при скачивании NSIS

**Обход:** бинарник `mynx.exe` уже portable — просто скопировать и запустить. Инсталлятор можно собрать вручную позже, когда WiX/NSIS доступны.

---

## ❌ Не сделано (вне MVP)

### Импорт / Экспорт
- [ ] 1Password (.1pif) import
- [ ] Bitwarden (.json) import
- [ ] KeePass (.kdbx) import
- [ ] Chrome/Firefox CSV import
- [ ] Generic CSV import
- [ ] Encrypted JSON export

### Расширенная безопасность
- [ ] Biometric unlock (Windows Hello)
- [ ] Duress Password / Hidden Vault
- [ ] Rate limiting on unlock (exponential backoff)
- [ ] Security audit с HIBP bloom filter
- [ ] BIP39 mnemonic recovery

### Работа с файлами
- [ ] Secure attachments
- [ ] Portable mode (vault на USB)
- [ ] Backup rotation (10 версий)

### Тестирование
- [ ] Rust unit tests (crypto 100% coverage)
- [ ] Frontend unit tests (Vitest)
- [ ] E2E tests (Playwright)
- [ ] Cross-platform testing (macOS, Linux)

### Дистрибуция
- [ ] Code signing (Windows signtool)
- [ ] macOS `.dmg` + notary
- [ ] Linux `.AppImage`
- [ ] GitHub Actions CI/CD
- [ ] Auto-updater

---

## 🎯 Итог

**MVP полностью готов.** Приложение:
- Создаёт зашифрованные vault'ы (Argon2id + XChaCha20 + AES-256-GCM)
- Работает полностью offline
- Имеет красивый glassmorphism UI с анимациями
- Поддерживает live TOTP, Auto-Type, Password Generator
- Имеет Security Score Dashboard и Emergency Kit
- Запускается как portable `.exe` (~12.5 MB)

**Оценка времени на полный релиз:**
- Импорт/экспорт — 2 дня
- Тесты + CI/CD — 2-3 дня
- Инсталлятор (когда WiX доступен) — 0.5 дня
- Code signing — 0.5 дня

**Итого: ~5-6 дней** для production-ready релиза.

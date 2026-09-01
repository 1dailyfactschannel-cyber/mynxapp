# Mynx

**Mynx** — полностью офлайн-менеджер паролей для Windows (на Linux — базовый режим). Никакого облака, синхронизации, аккаунтов и подписок: хранилище — один зашифрованный файл на вашем компьютере.

Текущая версия: **1.2.2** (браузерное расширение **1.0.3**).

## Ключевые возможности

- **Zero-Knowledge шифрование** — Argon2id (16 MB / t=3 / p=2) + HKDF-SHA256 + двухслойное шифрование XChaCha20-Poly1305 / AES-256-GCM. Для расшифровки нужны одновременно мастер-пароль и 128-битный ключ устройства.
- **Несколько хранилищ** — изолированные `.safepass`-файлы с собственными паролями.
- **Decoy-хранилище** — второй пароль открывает правдоподобную обманку; по файлу наличие ложного слоя определить невозможно.
- **Аппаратный ключ** — опциональная привязка хранилища к keyfile на USB-флешке.
- **Windows Hello** — биометрическая разблокировка (ключ сессии в Windows Credential Manager).
- **Записи**: категории, теги, избранное, заметки (markdown), кастомные поля, история паролей, вложения с папками (до 300 МБ), TOTP-коды, корзина с автоочисткой.
- **Аудит паролей (Health)** — слабые, повторяющиеся, старые пароли и записи без 2FA.
- **Импорт** — Bitwarden (JSON/CSV), 1Password (CSV), KeePass/KeePassXC (CSV), Chrome (CSV).
- **Автобэкапы** — по расписанию, с ротацией; зашифрованный экспорт `.spbackup` (переносится между машинами).
- **Emergency Kit** — печатная форма с QR-кодом ключа устройства.
- **Auto-Type (Windows)** — ввод логина/пароля имитацией клавиатуры в любое приложение, минуя буфер обмена.
- **Слепой защищённый буфер** — секрет живёт только в памяти приложения, вставка глобальным хоткеем.
- **Браузерное расширение** (Chrome/Edge, Manifest V3) — автозаполнение, автосохранение логинов, генератор; pairing-подтверждение доступа в десктоп-приложении.

## Архитектура

```
Tauri 2 (Rust) + React 18 (TypeScript) + Vite + Tailwind CSS
├── src/            React-интерфейс (zustand-сторы, i18n en/ru, демо-режим в браузере)
├── src-tauri/      Ядро Rust:
│   ├── crypto/     Argon2id, HKDF, XChaCha20-Poly1305, AES-256-GCM
│   ├── vault/      Формат .safepass, атомарная запись, decoy, экспорт
│   ├── commands/   ~40 Tauri-команд
│   ├── api.rs      HTTP API 127.0.0.1:5149 (Bearer, loopback, rate-limit)
│   ├── ipc.rs      Named pipe / unix-сокет для расширения (pairing)
│   ├── biometry.rs Windows Hello
│   ├── memprotect.rs  Запрет дампов памяти, VirtualLock
│   └── native_host.rs Бинарник mynx-native-host (Native Messaging)
└── extension/      Manifest V3-расширение (ванильный JS, без сборки)
```

Подробности: [`docs/tech-stack.md`](docs/tech-stack.md) — фактический стек, [`docs/architecture.md`](docs/architecture.md) — архитектура шифрования, [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) — руководство пользователя (оно же встроено в приложение).

## Разработка

Требования: **Node.js 18+**, **Rust** (stable, с MSVC-тулчейном на Windows).

```bash
npm install
npm run tauri-dev     # запуск приложения в dev-режиме (порт 1420)
npm run tauri-build   # релиз-сборка: NSIS-инсталлятор (Windows)
cargo test            # unit-тесты криптографии и vault (из src-tauri/)
npm run lint          # ESLint, --max-warnings 0
```

Release-сборка Windows — `build-release.bat`; генерация NSIS-ассетов — `tools/gen_installer_assets.py`.

## Расширение для браузера

1. Соберите ZIP: `extension/pack.bat` (или загрузите папку как unpacked в `chrome://extensions`).
2. Зарегистрируйте native-хост: запустите `extension/native-host/register.reg` (HKCU, права администратора не нужны).
3. Запустите десктопное приложение Mynx — расширение определит его автоматически (индикатор Offline/Locked/Unlocked в popup).

Материалы для Chrome Web Store (описание, privacy policy, промо-графика) — в `extension/store/`.

## Формат хранилища

Vault — файл `.safepass` в папке `vaults/` рядом с исполняемым файлом: magic `SAFEPASS` + версия + salt + KDF-параметры + заголовок, зашифрованный XChaCha20-Poly1305 (внутри — случайный ключ записей) + записи, зашифрованные AES-256-GCM. Расширение, magic и HKDF-строки заморожены для обратной совместимости. Экспорт — `.spbackup` (ключ только из мастер-пароля).

## Безопасность

Нет сервера и телеметрии; CSP запрещает исходящие соединения; ключи затираются в памяти (zeroize) и блокируются от выгрузки (VirtualLock); дампы памяти запрещены на уровне процесса; неудачные попытки пароля/токена/Hello ограничиваются общим rate-limit; сохранение атомарное. Честный разбор модели угроз — [`docs/tech-stack.md`, раздел 8](docs/tech-stack.md) и [`docs/architecture.md`](docs/architecture.md).

## Лицензия

MIT.

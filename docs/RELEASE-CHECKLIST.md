# RELEASE-CHECKLIST — выпуск подписанной сборки Mynx

Закрывает подготовительную часть P1-13 (кодовая подпись + автообновление).
Финальные шаги требуют покупки сертификата и выполняются владельцем проекта.

## 1. Кодовая подпись (signtool)

Каркас уже в коде: `build-release.bat` ищет signtool и подписывает exe,
`tauri.conf.json` содержит поле `certificateThumbprint`.

1. Купить сертификат подписи кода:
   - **OV (Organization Validation)** — ~$100–400/год (Sectigo, SSL.com,
     Certum). Убирает «Unknown publisher», SmartScreen набирает репутацию
     за 2–4 недели дистрибуции.
   - **EV (Extended Validation)** — ~$250–500/год (SSL.com, Certum).
     SmartScreen-репутация сразу. С 2023 года EV тоже выдаётся на USB-токене
     или в облачном HSM (FIPS) — приватный ключ не экспортируется.
2. Установить сертификат/токен, найти отпечаток:
   ```powershell
   Get-ChildItem Cert:\CurrentUser\My   # или Cert:\LocalMachine\My
   ```
3. Вписать отпечаток в `tauri.conf.json` → `bundle.windows.certificateThumbprint`
   и в переменную окружения `TAURI_SIGNING_PRIVATE_KEY`-сценарий (см. ниже).
4. Подписать и проверить:
   ```powershell
   signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 mynx.exe
   signtool verify /pa /v mynx.exe
   ```
5. Подписывать ВСЕ артефакты: `mynx.exe`, инсталлятор (MSI/NSIS) и
   `mynx-native-host.exe` (его подгружает браузер — неподписанный вызовет
   вопросы Chrome/Edge).

## 2. Автообновление (Tauri Updater)

1. Сгенерировать ключ подписи обновлений (один раз, хранить ОФФЛАЙН):
   ```powershell
   npx @tauri-apps/cli signer generate -w ~/.tauri/mynx.key
   ```
   Публичный ключ — в `tauri.conf.json` → `plugins.updater.pubkey`.
   Приватный ключ уже исключён из git (`.gitignore`: `.tauri/`, `*.key`).
2. Добавить плагин:
   ```bash
   cd src-tauri && cargo add tauri-plugin-updater
   npm i @tauri-apps/plugin-updater
   ```
3. В `tauri.conf.json` (внутри `plugins`):
   ```json
   "updater": {
     "active": true,
     "dialog": true,
     "endpoints": ["https://<хост-релизов>/{{target}}/{{arch}}/{{current_version}}"],
     "pubkey": "<содержимое mynx.key.pub>"
   }
   ```
   Для офлайн-проекта endpoint может указывать на GitHub Releases
   (latest.json генерируется `tauri build` при наличии `createUpdaterArtifacts`).
4. В `main.rs` зарегистрировать плагин: `.plugin(tauri_plugin_updater::Builder::new().build())`.
5. Проверить сценарий: собрать v1.2.3 → поднять версию → собрать v1.2.4 →
   убедиться, что v1.2.3 находит и применяет обновление.

## 3. Чек-лист самого релиза

- [ ] `cargo test` и `cargo clippy --all-targets -- -D warnings` зелёные (CI)
- [ ] `npm ci && npx tsc --noEmit && npm test && npm run build` зелёные
- [ ] Версии подняты синхронно: `tauri.conf.json`, `Cargo.toml`, `package.json`,
      `extension/manifest.json` (свой шаг `ext-v*`), `README.md`
- [ ] `CHANGELOG.md` — секция новой версии заполнена
- [ ] Сборка: `build-release.bat` (Windows) — exe, MSI, native-host
- [ ] Подпись всех артефактов + `signtool verify /pa /v` на каждом
- [ ] Свежий `latest.json` (updater-артефакт) рядом с релизом
- [ ] Релизные заметки: что изменилось; SHA256 артефактов
- [ ] smoke-тест: установка на чистой Windows 10/11, Hello, Auto-Type, расширение

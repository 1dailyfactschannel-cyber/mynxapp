# FIXPLAN — план устранения находок аудита Mynx 1.2.2

План закрывает все 29 находок аудита (P0 × 2, P1 × 13, P2 × 14).
Итог: **27 закрыто, 2 закрыты частично (P1-13, P2-6), 0 отложено.**
Статусы: ✅ ИСПРАВЛЕНО · 🔄 ЧАСТИЧНО (указан остаток).

Верификация изменений: `cargo test` (юнит-тесты криптографии и формата сейфа —
включая AAD-привязку, legacy-совместимость, доменный скоринг),
`cargo clippy --all-targets -- -D warnings`, `npm run build` / `npx tsc --noEmit`
и `npm test` (vitest: 15 тестов — safeExternalUrl, шифрование вложений,
паритет i18n) — джобы `security.yml` и `frontend-tests.yml`. Windows-специфичные
правки (named pipe, Hello/Passport) требуют smoke-теста на Windows 10/11.

---

## P0 — критично (2/2 исправлено)

| ID | Находка | Статус | Что сделано |
|----|---------|--------|-------------|
| P0-1 | CI `security.yml` не запускает тесты и сборку; clippy с `continue-on-error: true` | ✅ | Переписан workflow: `cargo test`, `cargo clippy --all-targets -- -D warnings` (без continue-on-error), добавлен `npm audit --omit=dev --audit-level=high` |
| P0-2 | Нет LICENSE — юридический статус проекта не определён | ✅ | Добавлен LICENSE (MIT, как заявлено в README) |

## P1 — высокий приоритет (12/13 исправлено, 1 — частично)

| ID | Находка | Статус | Что сделано |
|----|---------|--------|-------------|
| P1-1 | `kdf.rs` `.expect()` на параметрах KDF из заголовка сейфа: подделанный файл роняет процесс (DoS) | ✅ | `to_argon2_params() -> Result<Params>`; ошибка возвращается вызывателю вместо паники |
| P1-2 | AEAD без AAD: шифротексты заголовка/payload/декоя/keyfile взаимозаменяемы (трансплантация блоков) | ✅ | AAD v2-привязка ролей (`mynx:v2:header/payload/decoy-header/export/hw-keyfile/clipboard`); чтение с fallback на legacy-блоки без AAD — старые сейфы открываются |
| P1-3 | Гонка сохранения `save_entries_to_vault` (load → modify → save без блокировки): параллельные записи из UI/HTTP API/IPC теряют данные | ✅ | `VAULT_WRITE_LOCK` — все записи сейфа сериализованы; `save_vault_file_locked` без повторного захвата (нет дедлока) |
| P1-4 | Нет fsync и резервной копии: сбой питания/диска между записями = потерянный сейф | ✅ | tmp → `sync_all()` (fsync) → копия предыдущей версии в `*.safepass.bak` → rename |
| P1-5 | Windows named pipe без `FILE_FLAG_FIRST_PIPE_INSTANCE`: squatting-перехват `\\.\pipe\mynx` чужим процессом | ✅ | Флаг добавлен в `CreateNamedPipeW` и в fallback `ServerOptions::first_pipe_instance(true)` |
| P1-6 | `domain_score` с двусторонним `contains()`: lookalike-домены (`evil-paypal.com`, `paypal.com.evil.io`) получают сохранённый пароль | ✅ | Строгий eTLD+1-скоринг: точный хост = 1000, тот же регистрируемый домен = 500, остальное = 0; список двухуровневых публичных суффиксов; 4 юнит-теста; дубликат скоринга в `ipc.rs` удалён (единый источник в `api.rs`) |
| P1-7 | Вложения в `localStorage` открытым текстом (zustand persist `mynx-attachments`) | ✅ | `src/lib/secureStorage.ts`: весь снимок состояния шифруется AES-256-GCM; ключ — неэкспортируемый CryptoKey в IndexedDB; миграция со старого plaintext при первом чтении |
| P1-8 | `EntryDetail.tsx`: `href={entry.url}` без фильтра схемы — `javascript:`-URL в вебвью | ✅ | `safeExternalUrl()` в `src/lib/utils.ts`: только http/https, домены без схемы → https, остальное → null (кнопка скрыта) |
| P1-9 | Автоблокировка только во фронтенде (useAutoLock): сон системы/заморозка вебвью её обходят | ✅ | Бэкенд: `last_activity` + `autolock_minutes` в `AppStateInner`, `enforce_autolock()` (wipe секретов + `vault_locked`) на HTTP API, IPC и секрет-командах; команда `set_autolock_minutes` + стартовая и onchange-синхронизация из `settings.ts` |
| P1-10 | `build-release.bat`: захардкоженные пути `C:\Users\Matt\…`, `D:\Kimi проекты\Safepass` | ✅ | Пути от `%~dp0`, vcvars ищется в стандарных местах, без персональных PATH |
| P1-11 | `npm audit` не выполняется вообще | ✅ | Джоба `npm-audit` в security.yml (prod-зависимости, уровень high) |
| P1-12 | Windows Hello: ключ разблокировки читается из Credential Manager без повторной биометрии | ✅ | Passport-обёртка (biometry.rs): ключ сессии шифруется AES-256-GCM ключом из детерминированной подписи KeyCredential (RequestSignAsync всегда показывает Hello); чтение Credential Manager напрямую даёт бесполезный blob. Legacy-записи читаются, мигрируются при перезаписи. Остаток: smoke-тест на Windows-стенде |
| P1-13 | Нет кодовой подписи и апдейтера: SmartScreen-предупреждения, обновления вручную | 🔄 | Готов полный чек-лист: docs/RELEASE-CHECKLIST.md (выбор OV/EV-сертификата, signtool, tauri-updater с ключами, шаги релиза). Каркас в коде уже был (signtool-шаг, certificateThumbprint). Остаток: покупка сертификата владельцем |

## P2 — средний приоритет (13/14 исправлено, 1 — частично)

| ID | Находка | Статус | Действие |
|----|---------|--------|----------|
| P2-1 | Нет SECURITY.md (политика репортинга уязвимостей) | ✅ | Создан: приватный репортинг, scope, SLA, security-дизайн |
| P2-2 | Нет CONTRIBUTING.md (правила для контрибьюторов) | ✅ | Создан: тесты для crypto/vault обязательны, CI green, формат сейфа под RFC |
| P2-3 | Нет автоматического обновления зависимостей | ✅ | `.github/dependabot.yml`: npm + cargo (weekly), actions (monthly) |
| P2-4 | CHANGELOG.md не содержит записей 1.2.x (последняя — 1.1.0) | ✅ | Добавлены: сводная запись 1.2.0–1.2.2 (восстановлена по коду, история релизов не велась) + Unreleased со списком security-фиксов |
| P2-5 | Ноль юнит-тестов фронтенда (0 файлов *.test.*) | ✅ | vitest + vitest.config.ts; 15 тестов: safeExternalUrl (P1-8), encryptedAttachmentsStorage roundtrip/миграция/потеря-ключа (P1-7), паритет i18n. Джоба frontend-tests.yml (tsc + vitest) |
| P2-6 | README без бейджей/скриншотов/линка на LICENSE | 🔄 | Добавлены: бейджи Security CI / Frontend tests / License: MIT, ссылка на LICENSE. Остаток: скриншоты UI (нужны реальные снимки с машины владельца) |
| P2-7 | TODO.md — внутренняя доска с путями конкретной машины | ✅ | Убран из репозитория (`git rm --cached` + .gitignore); локально файл остаётся, содержимое переносится в GitHub Projects |
| P2-8 | Dev-зависимости не сканируются (npm audit только prod) | ✅ | Джоба `npm-audit-dev` (report-only, continue-on-error) с политикой в комментарии: dev-зависимости не попадают в сборку |
| P2-9 | Расширение: pack/версионирование вручную (pack.bat) | ✅ | Workflow extension-pack.yml: zip из manifest.json по тегу `ext-v*`, артефакт для Chrome Web Store |
| P2-10 | i18n: неполный охват строк en/ru | ✅ | Тест i18n.test.ts: идентичность наборов ключей, отсутствие пустых/ключе-подобных значений, совпадение плейсхолдеров {0}. Фактические словари уже в паритете — теперь это гарантировано |
| P2-11 | `api_token` в Mutex\<String\> без zeroize при ротации | ✅ | `Mutex<Zeroizing<String>>` (затирание при подмене/drop) + команда `rotate_api_token` |
| P2-12 | Реестр путей hw-keyfile (`hwkeys.json`) в открытом виде | ✅ | Задокументировано (код + docs/architecture.md): файл хранит только пути, не секреты; шифрование не меняет модель угроз |
| P2-13 | Логи `eprintln!` без уровней/ротации | ✅ | logging.rs: INFO/WARN/ERROR, файл app_data_dir/logs/mynx.log, ротация 5 МБ → .old; WARN/ERROR дублируются в stderr; все 8 вызовов переведены |
| P2-14 | Доки: tech-stack.docx пересобирается вручную | ✅ | Workflow docs-build.yml: pandoc (gfm→docx, lang=ru-RU) при изменении docs/*.md, артефакт |

---

## Порядок сборки и проверки исправленного

```bash
cd src-tauri && cargo test          # юнит-тесты ядра (в т.ч. новые AAD/скоринг)
cargo clippy --all-targets -- -D warnings
cd .. && npm ci && npx tsc --noEmit # типы фронтенда
npm test                            # vitest: 15 тестов (P2-5/P2-10)
npm run build
```

## Совместимость

- **Старые сейфы открываются**: чтение пробует AAD v2, затем legacy-блоки без AAD.
- **После первого сохранения** файл обновляется до v2 (AAD-привязка) и получает
  `*.safepass.bak` — откат на предыдущую версию приложения возможен, но новый
  файл старой версией читается без гарантии AAD-проверок.
- Экспорт-файлы (`build_export`) новой версии содержат AAD `mynx:v2:export` —
  будущий импорт должен использовать тот же AAD (см. `AAD_EXPORT_V2`).
- **Старые Hello-записи (открытый hex) читаются**; после включения/перезаписи
  ключ хранится в Credential Manager уже зашифрованным (passport-blob).
  Windows-версия со старым кодом НЕ расшифрует passport-blob — заранее
  отключите Hello перед откатом версии.

## Критерии приёмки

- P0-1: workflow падает на красном тесте/clippy/audit (нет continue-on-error).
- P1-2: юнит-тест `test_xchacha20_aad_binding` / `test_aes_gcm_aad_binding` — чужой AAD не открывает блок; `test_legacy_empty_aad_still_opens` — старые сейфы читаются.
- P1-6: `domain_score("evil-paypal.com", "paypal.com") == 0`; подпапки того же сайта — 500.
- P1-9: после N минут без секрет-вызовов любой запрос секретов возвращает `vault_locked`, RAM чистая.
- P1-7: в localStorage строка `mynx-attachments` начинается с `{"mynx-enc-v1":true` — plaintext недоступен.
- P1-12: на Windows-стенде — включить Hello: в Credential Manager лежит blob `mynx-passport-v1:*`, а не открытый hex; разблокировка просит Hello; другой процесс того же пользователя, вычитав blob, ключ не восстанавливает.
- P2-5/P2-10: `npm test` — 15 тестов зелёные (safeExternalUrl, шифрование вложений, паритет i18n).
- P2-11: после `rotate_api_token` старый токен не читается из дампа памяти (zeroize on drop).
- P2-13: в app_data_dir/logs/mynx.log появляются строки уровней INFO/WARN/ERROR; при переполнении 5 МБ файл уезжает в mynx.old.log.

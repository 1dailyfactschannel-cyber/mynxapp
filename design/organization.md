# Mynx — Организация данных: Tags, Collections, Categories

## Проблема плоских списков

С 1000+ записей плоский список не работает. KeePass использует дерево папок — удобно, но устаревший UI. 1Password использует Collections + Tags — современнее, но гибче.

**Наш подход: Tags + Collections + Categories**. Три уровня организации без rigid tree.

---

## 1. Categories (Категории) — Авто + Ручные

Каждая запись имеет **одну** категорию. Категории — это структурные типы, не кастомные теги.

**Builtin categories:**
```
All (все записи)
Favorites (★, ручная отметка)
Banking (банки, кредитки, PayPal, crypto)
Social (соцсети, мессенджеры, почта)
Work (корпоративные, Slack, Jira, GitHub work)
Development (GitHub personal, API keys, SSH, домены, хостинг)
Shopping (Amazon, eBay, Etsy, доставки)
Entertainment (Netflix, Spotify, Steam, игры)
Travel (авиакомпании, бронирование, Airbnb)
Identity (паспорт, SSN, водительские, insurance)
Medical (больницы, страховки, аптеки)
Education (универы, курсы, сертификации)
Other (всё остальное)
```

**Auto-detection по URL:**
```rust
fn detect_category(url: &str) -> Category {
    match domain {
        "chase.com" | "bankofamerica.com" | "paypal.com" | "wise.com" | "binance.com" => Category::Banking,
        "github.com" | "gitlab.com" | "bitbucket.org" => Category::Development,
        "gmail.com" | "outlook.com" | "proton.me" => Category::Social, // email как social/communication
        "amazon.com" | "ebay.com" | "aliexpress.com" => Category::Shopping,
        "netflix.com" | "spotify.com" | "steamcommunity.com" => Category::Entertainment,
        _ => Category::Other,
    }
}
```
- Пользователь может **переопределить** авто-detected категорию
- Категории используются в **Sidebar** — быстрый фильтр одним кликом

---

## 2. Tags (Теги) — Множественные, кастомные

Каждая запись может иметь **0-N тегов**. Теги — свободные метки, создаются пользователем.

**Примеры использования:**
```
Entry: GitHub Personal Account
  Category: Development
  Tags: ["critical", "2fa", "personal", "opensource"]

Entry: AWS Root Account
  Category: Development
  Tags: ["critical", "2fa", "work", "billing", "shared-with-team"]

Entry: Chase Bank
  Category: Banking
  Tags: ["critical", "autopay", "joint-account"]
```

**UI для тегов:**
- В Entry Detail: поле Tags с autocomplete + создание новых (`#tagname`)
- Теги отображаются как small chips (color-coded)
- В Vault: фильтр по тегу через Command Palette (`tag:critical`) или tag cloud
- **Tag cloud** в sidebar (если включено в настройках): показывает top 10 тегов по частоте

**Системные теги (auto-applied):**
- `weak-password` — если strength < 50
- `duplicate` — если пароль повторяется в другой записи
- `old` — если не менялся > 1 года
- `no-2fa` — если нет TOTP и URL известен поддерживать 2FA
- `breached` — если домен был в known breach (проверка через локальную базу Have I Been Pwned)

---

## 3. Collections (Коллекции) — Smart Folders

Collections — это **сохранённые фильтры**, которые живут в sidebar как быстрый доступ. Это не копии записей — это views.

**Builtin Collections:**
```
⭐ Favorites          (entries.favorite = true)
🔑 Recently Used    (last_accessed > now - 7 days)
⚠️  Security Alerts   (system-tag:weak OR system-tag:duplicate OR system-tag:breached)
🕐 Expiring Soon     (TOTP entries or password_age > 90 days)
📥 Imported          (entries.created_from_import = true, last 30 days)
🗑  Trash            (entries.deleted = true, 30 days до permanent)
```

**User-defined Collections:**
```
"Critical Work Stuff" → category:Work AND tag:critical
"Personal Banking"    → category:Banking AND tag:personal
"Shared Accounts"     → tag:shared-with-family OR tag:shared-with-team
"Needs 2FA"           → system-tag:no-2fa AND NOT category:Entertainment
```

**UI:**
- Collections в Sidebar под категориями (разделитель)
- `+ New Collection` → query builder (GUI, не SQL):
  ```
  Category: [Work ▾] AND Tag: [critical ▾] AND NOT Tag: [archived ▾]
  ```
- Collection показывает count badge (динамически обновляется)
- Drag-and-drop не работает (это не folders, это фильтры)

---

## 4. Favorites (Избранное) — Простой флаг

Каждая запись имеет `favorite: boolean`.
- Переключается звёздочкой на Entry Card и в Detail
- `⭐ Favorites` — builtin collection
- Отображается в sidebar как быстрый доступ
- Можно сортировать по частоте использования (auto-favorites): часто используемые поднимаются в top

---

## 5. Search + Filter — Полный текст

### Search
```
Поиск по: title, username, URL, notes, custom fields, tags

query: "github"
→ matches: GitHub (title), github.com (URL), "my github token" (notes)

query: "tag:critical"
→ только записи с тегом critical

query: "category:banking aws"
→ category:Banking AND (title OR notes содержит "aws")

query: "weak:yes"
→ системный тег weak-password

query: "url:github.com"
→ точное совпадение домена
```

### Filters ( persistent)
- Category filter (sidebar click)
- Tag filter (click tag chip)
- Collection filter (sidebar click)
- Favorites only (toggle)
- Sort by: Title / Last Used / Created / Modified / Strength (asc/desc)

---

## 6. UI: Sidebar Structure

```
+--------------------------------------------------+
|  Sidebar                                         |
+--------------------------------------------------+
|  🔍 [Search all...]                             |
|  ──────────────────────────────────────────────── |
|  [⭐] Favorites              8                    |
|  [🔑] Recently Used        12                    |
|  [⚠️] Security Alerts       3                    |
|  [🕐] Expiring Soon         1                    |
|  ──────────────────────────────────────────────── |
|  COLLECTIONS                                       |
|  [💼] Critical Work        5                    |
|  [🏦] Personal Banking     4                    |
|  [+ New Collection]                               |
|  ──────────────────────────────────────────────── |
|  CATEGORIES                                        |
|  [●] All                   247                    |
|  [🏦] Banking              12                    |
|  [💬] Social               34                    |
|  [💼] Work                 18                    |
|  [💻] Development          45                    |
|  [🛒] Shopping             23                    |
|  [🎬] Entertainment        19                    |
|  [✈️] Travel                8                    |
|  [🆔] Identity              6                    |
|  [🏥] Medical               4                    |
|  [📚] Education             3                    |
|  [❓] Other                75                    |
|  ──────────────────────────────────────────────── |
|  TAGS (Top 10)                                     |
|  [critical]  18  [2fa] 42  [personal] 67        |
|  [work] 23  [shared] 8  [autopay] 5             |
|  [Show all tags...]                                |
+--------------------------------------------------+
```

**Клик поведение:**
- Категория → фильтр по категории (сбрасывает остальные фильтры)
- Collection → применяет saved query
- Tag → фильтр по тегу (можно накопить: click tag1 + Ctrl+click tag2 = AND)
- Search → полнотекстовый, ищет по всем полям
- Favorites / Recently Used → builtin collections

---

## 7. Data Model (дополнение к Protobuf)

```protobuf
message Entry {
  string id = 1;
  string title = 2;
  string username = 3;
  bytes password = 4;
  string url = 5;
  string notes = 6;
  Category category = 7;     // enum, один
  repeated string tags = 8;    // множественные, кастомные
  repeated TOTP totp = 9;
  repeated CustomField custom = 10;
  int64 created_at = 11;
  int64 modified_at = 12;
  int64 last_accessed = 13;   // для Recently Used
  bool favorite = 14;
  int32 strength = 15;
  bool deleted = 16;          // soft delete
  int64 deleted_at = 17;      // для trash auto-purge
  Source source = 18;         // manual, import, capture, generated
  string import_source = 19;  // "1password", "bitwarden", etc.
}

enum Category {
  ALL = 0;
  BANKING = 1;
  SOCIAL = 2;
  WORK = 3;
  DEVELOPMENT = 4;
  SHOPPING = 5;
  ENTERTAINMENT = 6;
  TRAVEL = 7;
  IDENTITY = 8;
  MEDICAL = 9;
  EDUCATION = 10;
  OTHER = 11;
}

message Collection {
  string id = 1;
  string name = 2;
  string query = 3;           // внутреннее представление фильтра
  string icon = 4;              // emoji или lucide icon name
  int64 created_at = 5;
  bool builtin = 6;           // системная или пользовательская
}

message Tag {
  string name = 1;
  string color = 2;           // hex color, auto-assigned
  int32 usage_count = 3;       // кэш для tag cloud
}
```

---

## 8. Зачем не классические Folders?

| Подход | Плюсы | Минусы | Наш выбор |
|--------|-------|--------|-----------|
| **Folders (KeePass)** | Знакомо, иерархия | Rigid tree, запись может быть только в одной папке, UI clutter | ❌ |
| **Tags (Bitwarden)** | Гибкость, множественные | Нет визуальной иерархии, сложнее сканировать | ✅ |
| **Categories + Tags** | Структура + гибкость | Чуть сложнее для новичков | ✅ |
| **Collections** | Smart views, сохранённые фильтры | Не интуитивно для всех | ✅ (опционально) |
| **Categories + Folders** | Лучшее из двух | Сложнее в UI, дублирование | ❌ |

**Мы выбираем Categories + Tags + Collections** — это современный стандарт (Notion, Things, Bear, 1Password 8).

---

## 9. Migration с KeePass

KeePass использует дерево папок. При импорте:
```
KeePass folder path: "Work/Clients/Acme Corp"
→ Category: Work (auto-detect по folder name)
→ Tag: "clients" (auto-created)
→ Tag: "acme-corp" (auto-created)
→ Title: "Acme Corp — Login"
```
- Глубокие папки разворачиваются в tags
- Пользователь может потом создать Collection "Acme Clients" → tag:acme-corp OR tag:clients
- Это **не потеря** — это **трансформация** в более гибкую модель

---

## 10. Implementation Plan

| Компонент | Фаза | Срок |
|-----------|------|------|
| Category enum + auto-detect | Фаза 2 (Vault) | 0.5 дня |
| Tags field + CRUD | Фаза 4 | 0.5 дня |
| Tag autocomplete / chips | Фаза 3 | 0.5 дня |
| Sidebar: Categories list | Фаза 3 | 0.5 дня |
| Sidebar: Collections | Фаза 4 | 1 день |
| Sidebar: Tag cloud | Фаза 4 | 0.5 дня |
| System tags (auto-applied) | Фаза 4 | 1 день |
| Collection query builder | Фаза 5 | 1.5 дня |
| Full-text search (SQLite FTS5) | Фаза 2 | 1 день |
| Search syntax (tag:, category:, weak:yes) | Фаза 4 | 1 день |

---

## Сводка: организация данных

| Уровень | Что это | Пример | UI |
|---------|---------|--------|----|
| **Categories** | Структурный тип (1 на запись) | Banking, Work, Development | Sidebar sections |
| **Tags** | Свободные метки (0-N на запись) | critical, 2fa, shared, autopay | Chips, Tag cloud, filter |
| **Collections** | Saved filters / smart views | "Critical Work", "Needs 2FA" | Sidebar under separator |
| **Favorites** | Quick flag | ⭐ | Sidebar, star button |
| **Search** | Full-text по всем полям | "github tag:critical" | Search bar, Command Palette |

**Это гибче папок**, но не теряет структуру. Запись может быть в одной категории, но иметь множество тегов, и появляться во многих collections.

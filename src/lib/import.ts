import type { CustomField } from "@/stores/vault";

/* ================================================================== */
/* Импорт паролей из сторонних менеджеров (Bitwarden, 1Password,      */
/* KeePass/KeePassXC, Chrome/Generic CSV). Парсинг полностью локальный. */
/* ================================================================== */

export type ImportFormat =
  | "auto"
  | "bitwarden-json"
  | "bitwarden-csv"
  | "onepassword-csv"
  | "onepassword-json"
  | "keepass-csv"
  | "keepassxc-json"
  | "lastpass-csv"
  | "dashlane-csv"
  | "protonpass-csv"
  | "firefox-csv"
  | "chrome-csv";

/** Черновик записи до превращения в Entry (id/strength добавляет импортёр) */
export interface ImportDraft {
  title: string;
  username: string;
  password: string;
  url: string;
  /** Имя папки/группы из исходного файла ("" — без папки) */
  category: string;
  favorite: boolean;
  notes?: string;
  totpSecret?: string;
  customFields?: CustomField[];
}

export interface ImportResult {
  drafts: ImportDraft[];
  /** Уникальные имена папок, встреченные в файле */
  folders: string[];
  /** Строки/элементы, которые не удалось смаппить (не логины, пустые строки) */
  skipped: number;
}

/* ------------------------------------------------------------------ */
/* CSV-парсер (RFC 4180): кавычки, "" -экранирование, многострочные    */
/* поля, CRLF/LF/CR, автоопределение разделителя (, ; TAB)             */
/* ------------------------------------------------------------------ */

function detectDelimiter(headerLine: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    const count = headerLine.split(d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const delim = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Строки CSV → объекты по заголовку (ключи — в нижнем регистре) */
function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? "";
    });
    out.push(obj);
  }
  return out;
}

function get(obj: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* TOTP: принимает otpauth:// URI или «голый» base32-секрет            */
/* ------------------------------------------------------------------ */

export function extractTotpSecret(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (v.toLowerCase().startsWith("otpauth://")) {
    try {
      const secret = new URL(v).searchParams.get("secret");
      if (secret) return secret.replace(/\s+/g, "").toUpperCase();
    } catch {
      /* не URI — пробуем как секрет */
    }
    return undefined;
  }
  const cleaned = v.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z2-7]+=*$/.test(cleaned) ? cleaned : undefined;
}

/* ------------------------------------------------------------------ */
/* Автоопределение формата по содержимому                              */
/* ------------------------------------------------------------------ */

export function detectFormat(text: string): Exclude<ImportFormat, "auto"> {
  const t = text.replace(/^﻿/, "").trimStart();
  if (t.startsWith("{")) {
    try {
      const data = JSON.parse(t) as Record<string, unknown>;
      if (Array.isArray(data.items)) return "bitwarden-json";
      if (Array.isArray(data.entries) || (data.database && typeof data.database === "object")) {
        return "keepassxc-json";
      }
      if (Array.isArray(data)) return "onepassword-json";
    } catch {
      /* битый JSON — дальше по заголовкам не имеет смысла */
      return "bitwarden-json";
    }
    return "bitwarden-json";
  }
  const header = (t.split(/\r\n|\r|\n/, 1)[0] || "").toLowerCase();
  if (header.includes("login_uri") || header.includes("reprompt")) return "bitwarden-csv";
  if (header.includes("timecreated") || header.includes("httprealm")) return "firefox-csv";
  if (header.includes("grouping")) return "lastpass-csv";
  if (header.includes("otpurl") || header.includes("username2")) return "dashlane-csv";
  if (header.includes("otpauth")) return "onepassword-csv";
  if (header.startsWith("group") || header.includes("totp")) return "keepass-csv";
  return "chrome-csv";
}

/* ------------------------------------------------------------------ */
/* Bitwarden JSON (unencrypted export)                                 */
/* ------------------------------------------------------------------ */

interface BwItem {
  type?: number;
  name?: string;
  notes?: string;
  favorite?: boolean;
  folderId?: string | null;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[];
  } | null;
  fields?: { name?: string | null; value?: unknown; type?: number }[] | null;
}

function parseBitwardenJson(text: string): ImportResult {
  const data = JSON.parse(text) as {
    items?: BwItem[];
    folders?: { id?: string; name?: string }[];
  };
  const folderNames = new Map<string, string>();
  for (const f of data.folders ?? []) {
    if (f.id && f.name) folderNames.set(f.id, f.name);
  }

  const drafts: ImportDraft[] = [];
  const folders = new Set<string>();
  let skipped = 0;

  for (const item of data.items ?? []) {
    // type 1 = login; остальные (заметки, карты, identity) пропускаем
    if (item.type !== 1 || !item.login) {
      skipped++;
      continue;
    }
    const folder = (item.folderId && folderNames.get(item.folderId)) || "";
    if (folder) folders.add(folder);
    const customFields: CustomField[] = (item.fields ?? [])
      .filter((f) => f.name)
      .map((f) => ({
        id: crypto.randomUUID(),
        label: String(f.name),
        value: typeof f.value === "string" ? f.value : String(f.value ?? ""),
        type: f.type === 1 ? "hidden" : "text",
      }));
    drafts.push({
      title: item.name || "",
      username: item.login.username || "",
      password: item.login.password || "",
      url: item.login.uris?.find((u) => u.uri)?.uri || "",
      category: folder,
      favorite: !!item.favorite,
      notes: item.notes || undefined,
      totpSecret: extractTotpSecret(item.login.totp ?? undefined),
      customFields: customFields.length > 0 ? customFields : undefined,
    });
  }
  return { drafts, folders: [...folders], skipped };
}

/* ------------------------------------------------------------------ */
/* CSV-форматы                                                         */
/* ------------------------------------------------------------------ */

function finalize(
  drafts: ImportDraft[],
  skipped: number
): ImportResult {
  const folders = new Set<string>();
  const kept: ImportDraft[] = [];
  let skip = skipped;
  for (const d of drafts) {
    // Совсем пустые строки не импортируем
    if (!d.title && !d.username && !d.password && !d.url && !d.notes) {
      skip++;
      continue;
    }
    if (d.category) folders.add(d.category);
    kept.push(d);
  }
  return { drafts: kept, folders: [...folders], skipped: skip };
}

/** Bitwarden CSV: кастомные поля в колонке fields — "Name: value" по строкам */
function parseBwFieldsColumn(raw: string): CustomField[] | undefined {
  if (!raw.trim()) return undefined;
  const fields: CustomField[] = [];
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    fields.push({
      id: crypto.randomUUID(),
      label: line.slice(0, idx).trim(),
      value: line.slice(idx + 1).trim(),
      type: "text",
    });
  }
  return fields.length > 0 ? fields : undefined;
}

function parseBitwardenCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts: ImportDraft[] = [];
  let skipped = 0;
  for (const o of objs) {
    if (get(o, "type") && get(o, "type") !== "login") {
      skipped++;
      continue;
    }
    drafts.push({
      title: get(o, "name"),
      username: get(o, "login_username"),
      password: get(o, "login_password"),
      url: get(o, "login_uri"),
      category: get(o, "folder"),
      favorite: get(o, "favorite") === "1" || get(o, "favorite").toLowerCase() === "true",
      notes: get(o, "notes") || undefined,
      totpSecret: extractTotpSecret(get(o, "login_totp")),
      customFields: parseBwFieldsColumn(get(o, "fields")),
    });
  }
  return finalize(drafts, skipped);
}

function parseOnePasswordCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: get(o, "title"),
    username: get(o, "username"),
    password: get(o, "password"),
    url: get(o, "website", "url"),
    category: get(o, "vault", "folder"),
    favorite: get(o, "favorite") === "1" || get(o, "favorite").toLowerCase() === "true",
    notes: get(o, "notes") || undefined,
    totpSecret: extractTotpSecret(get(o, "otpauth")),
  }));
  return finalize(drafts, 0);
}

function parseKeePassCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: get(o, "title"),
    username: get(o, "username"),
    password: get(o, "password"),
    url: get(o, "url", "website"),
    // KeePassXC: группы вида "Root/Email" — убираем корневой префикс
    category: get(o, "group").replace(/^Root\/?/i, ""),
    favorite: false,
    notes: get(o, "notes") || undefined,
    totpSecret: extractTotpSecret(get(o, "totp")),
  }));
  return finalize(drafts, 0);
}

function parseChromeCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: get(o, "name", "title"),
    username: get(o, "username"),
    password: get(o, "password"),
    url: get(o, "url", "website"),
    category: "",
    favorite: false,
    notes: get(o, "note", "notes") || undefined,
  }));
  return finalize(drafts, 0);
}

/* ------------------------------------------------------------------ */
/* Дополнительные форматы (KeePassXC JSON, 1P JSON, LastPass,          */
/* Dashlane, Proton Pass, Firefox)                                     */
/* ------------------------------------------------------------------ */

interface KpxEntry {
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totp?: string;
  group?: string;
  attributes?: Record<string, string> | null;
}

function parseKeePassXcJson(text: string): ImportResult {
  const data = JSON.parse(text) as {
    entries?: KpxEntry[];
    database?: { entries?: KpxEntry[] };
  };
  const raw = data.entries ?? data.database?.entries ?? [];
  const drafts: ImportDraft[] = raw.map((e) => ({
    title: e.title || "",
    username: e.username || "",
    password: e.password || "",
    url: e.url || "",
    // Группа вида "Root/Email" — как в CSV-варианте
    category: (e.group || "").replace(/^Root\/?/i, ""),
    favorite: false,
    notes: e.notes || undefined,
    totpSecret: extractTotpSecret(e.totp ?? undefined),
  }));
  return finalize(drafts, 0);
}

interface OpField {
  value?: unknown;
  purpose?: string;
  label?: string;
  id?: string;
}

interface OpItem {
  title?: string;
  category?: string;
  favorite?: boolean;
  notes?: string;
  trashed?: boolean;
  urls?: { href?: string }[] | null;
  fields?: OpField[] | null;
  login?: { username?: string; password?: string; totp?: string };
}

function opFieldValue(item: OpItem, names: string[]): string {
  for (const f of item.fields ?? []) {
    const match =
      (f.purpose && names.includes(f.purpose)) ||
      (f.label && names.includes(f.label.toLowerCase())) ||
      (f.id && names.includes(f.id.toLowerCase()));
    if (match && f.value !== undefined && f.value !== null) {
      return String(f.value);
    }
  }
  return "";
}

function parseOnePasswordJson(text: string): ImportResult {
  const data = JSON.parse(text) as OpItem[] | { items?: OpItem[] };
  const items = Array.isArray(data) ? data : (data.items ?? []);
  const drafts: ImportDraft[] = [];
  let skipped = 0;
  for (const item of items) {
    if (item.trashed) {
      skipped++;
      continue;
    }
    // Логины: category "LOGIN" (v8) или наличие password-поля
    const isLogin =
      (item.category && item.category.toUpperCase().includes("LOGIN")) ||
      opFieldValue(item, ["password"]) !== "";
    if (!isLogin) {
      skipped++;
      continue;
    }
    const username = item.login?.username || opFieldValue(item, ["username", "email"]);
    const password = item.login?.password || opFieldValue(item, ["password"]);
    const totp = item.login?.totp || opFieldValue(item, ["totp"]);
    drafts.push({
      title: item.title || "",
      username,
      password,
      url: item.urls?.find((u) => u.href)?.href || "",
      category: "",
      favorite: !!item.favorite,
      notes: item.notes || undefined,
      totpSecret: extractTotpSecret(totp || undefined),
    });
  }
  return finalize(drafts, skipped);
}

function parseLastPassCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: get(o, "name"),
    username: get(o, "username"),
    password: get(o, "password"),
    url: get(o, "url"),
    // grouping вида "Work/Dev" — корневой префикс не убираем, это папка
    category: get(o, "grouping"),
    favorite: get(o, "fav") === "1" || get(o, "fav").toLowerCase() === "true",
    notes: get(o, "extra") || undefined,
  }));
  return finalize(drafts, 0);
}

function parseDashlaneCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: get(o, "title"),
    username: get(o, "username", "username2"),
    password: get(o, "password"),
    url: get(o, "url"),
    category: get(o, "category"),
    favorite: false,
    notes: get(o, "note", "notes") || undefined,
    totpSecret: extractTotpSecret(get(o, "otpurl", "otpauth") || undefined),
  }));
  return finalize(drafts, 0);
}

function parseProtonPassCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: get(o, "name", "title"),
    username: get(o, "username"),
    password: get(o, "password"),
    url: get(o, "url"),
    category: get(o, "folder"),
    favorite: false,
    notes: get(o, "note", "notes") || undefined,
    totpSecret: extractTotpSecret(get(o, "totp", "totpuri") || undefined),
  }));
  return finalize(drafts, 0);
}

function parseFirefoxCsv(text: string): ImportResult {
  const objs = rowsToObjects(parseCsv(text));
  const drafts = objs.map((o) => ({
    title: hostOf(get(o, "url")) || "Firefox login",
    username: get(o, "username"),
    password: get(o, "password"),
    url: get(o, "url"),
    category: "",
    favorite: false,
  }));
  return finalize(drafts, 0);
}

/** Домен из URL для заголовка Firefox-логина */
function hostOf(url: string): string {
  const s = url.trim();
  if (!s) return "";
  const noScheme = s.includes("://") ? s.slice(s.indexOf("://") + 3) : s;
  const host = noScheme.split(/[/?#]/)[0] || "";
  return host.split("@").pop()?.split(":")[0] || "";
}

/* ------------------------------------------------------------------ */
/* Точка входа                                                         */
/* ------------------------------------------------------------------ */

export function parseImport(format: ImportFormat, text: string): ImportResult {
  const fmt = format === "auto" ? detectFormat(text) : format;
  switch (fmt) {
    case "bitwarden-json":
      return parseBitwardenJson(text);
    case "bitwarden-csv":
      return parseBitwardenCsv(text);
    case "onepassword-csv":
      return parseOnePasswordCsv(text);
    case "onepassword-json":
      return parseOnePasswordJson(text);
    case "keepass-csv":
      return parseKeePassCsv(text);
    case "keepassxc-json":
      return parseKeePassXcJson(text);
    case "lastpass-csv":
      return parseLastPassCsv(text);
    case "dashlane-csv":
      return parseDashlaneCsv(text);
    case "protonpass-csv":
      return parseProtonPassCsv(text);
    case "firefox-csv":
      return parseFirefoxCsv(text);
    case "chrome-csv":
      return parseChromeCsv(text);
  }
}

/** Best-effort очистка секретов из памяти после импорта/отмены */
export function wipeImportResult(result: ImportResult): void {
  for (const d of result.drafts) {
    d.password = "";
    d.totpSecret = undefined;
    d.customFields?.forEach((f) => {
      f.value = "";
    });
  }
  result.drafts.length = 0;
  result.folders.length = 0;
}

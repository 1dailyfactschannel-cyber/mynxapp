/* ================================================================== */
/* Дедупликация при импорте: поиск дублей и слияние черновика          */
/* с существующей записью. Совпадение: (host+username) →               */
/* (title+username) → (host+title). Пароль при слиянии — более сильный. */
/* ================================================================== */

import type { Entry, CustomField } from "@/stores/vault";
import { calculateStrength } from "@/stores/vault";
import type { ImportDraft } from "@/lib/import";

export type MergeStrategy = "skip" | "merge" | "duplicate";

/** Нормализация URL до ключа сравнения: host без www и порта, в нижнем регистре */
export function normalizeUrlKey(url: string): string {
  const s = url.trim();
  if (!s) return "";
  const noScheme = s.includes("://") ? s.slice(s.indexOf("://") + 3) : s;
  const host = noScheme.split(/[/?#]/)[0] || "";
  const clean = (host.split("@").pop() ?? "").split(":")[0];
  return clean.toLowerCase().replace(/^www\./, "");
}

/** Почему черновик считается дублем записи */
export type DupReason = "url+username" | "title+username" | "url+title";

export interface DuplicateMatch {
  entry: Entry;
  reason: DupReason;
}

/**
 * Найти существующую запись, совпадающую с черновиком.
 * Приоритет: url+username > title+username > url+title.
 */
export function findDuplicate(
  existing: Entry[],
  draft: ImportDraft
): DuplicateMatch | null {
  const host = normalizeUrlKey(draft.url);
  const uname = draft.username.trim().toLowerCase();
  const title = draft.title.trim().toLowerCase();

  const candidates: { entry: Entry; reason: DupReason; rank: number }[] = [];

  for (const e of existing) {
    if (e.deletedAt) continue;
    const eHost = normalizeUrlKey(e.url);
    const eUname = e.username.trim().toLowerCase();
    const eTitle = e.title.trim().toLowerCase();

    if (host && eHost && host === eHost && uname && eUname && uname === eUname) {
      candidates.push({ entry: e, reason: "url+username", rank: 0 });
    } else if (title && eTitle && title === eTitle && uname && eUname && uname === eUname) {
      candidates.push({ entry: e, reason: "title+username", rank: 1 });
    } else if (host && eHost && host === eHost && title && eTitle && title === eTitle) {
      candidates.push({ entry: e, reason: "url+title", rank: 2 });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.rank - b.rank);
  return { entry: candidates[0].entry, reason: candidates[0].reason };
}

/** Объединение кастомных полей (по метке) */
function mergeCustomFields(
  existing: CustomField[],
  incoming: CustomField[]
): CustomField[] | undefined {
  const byLabel = new Map(existing.map((f) => [f.label.toLowerCase(), f]));
  const merged = [...existing];
  for (const f of incoming) {
    const key = f.label.trim().toLowerCase();
    if (key && !byLabel.has(key)) {
      merged.push({ ...f, id: crypto.randomUUID() });
    }
  }
  return merged.length > existing.length ? merged : undefined;
}

/**
 * Патч для слияния черновика в существующую запись:
 * пустые поля заполняются, пароль берётся более сильный,
 * кастомные поля объединяются.
 */
export function mergeDraftIntoEntry(entry: Entry, draft: ImportDraft): Partial<Entry> {
  const patch: Partial<Entry> = {};

  if (!entry.title && draft.title) patch.title = draft.title;
  if (!entry.username && draft.username) patch.username = draft.username;
  if (!entry.url && draft.url) patch.url = draft.url;

  if (draft.password) {
    const newStrength = calculateStrength(draft.password);
    const oldStrength = entry.password ? calculateStrength(entry.password) : -1;
    if (!entry.password || newStrength > oldStrength) {
      patch.password = draft.password;
      patch.strength = newStrength;
    }
  }

  if (draft.customFields && draft.customFields.length > 0) {
    const fields = mergeCustomFields(entry.customFields ?? [], draft.customFields);
    if (fields) patch.customFields = fields;
  }

  if (!entry.notes && draft.notes) patch.notes = draft.notes;
  if (!entry.totpSecret && draft.totpSecret) patch.totpSecret = draft.totpSecret;
  if (draft.favorite && !entry.favorite) patch.favorite = true;

  return patch;
}

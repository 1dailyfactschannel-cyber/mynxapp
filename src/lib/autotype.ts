import type { Entry } from "@/stores/vault";

/** Извлекает хост из URL записи (допускает URL без схемы), срезает "www." */
function extractHost(url: string): string | null {
  if (!url) return null;
  for (const candidate of [url, `https://${url}`]) {
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      return host.startsWith("www.") ? host.slice(4) : host;
    } catch {
      // пробуем следующий вариант
    }
  }
  return null;
}

/**
 * Подбор записей под заголовок активного окна (для авто-ввода).
 * Совпадение по title (score = длина title) или по хосту из url
 * (score = длина хоста); сортировка по убыванию score.
 */
export function matchEntries(entries: Entry[], windowTitle: string): Entry[] {
  const haystack = windowTitle.trim().toLowerCase();
  if (!haystack) return [];

  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of entries) {
    const title = entry.title.trim().toLowerCase();
    if (title.length >= 3 && haystack.includes(title)) {
      scored.push({ entry, score: title.length });
      continue;
    }
    const host = extractHost(entry.url);
    if (host && host.length >= 4 && haystack.includes(host)) {
      scored.push({ entry, score: host.length });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}

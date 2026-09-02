/* ================================================================== */
/* Favicon-автозаполнение. Сеть — только через Rust-команду            */
/* fetch_favicon (CSP webview не пускает наружу). Кэш в памяти +       */
/* поле Entry.favicon (data: URL) персистится в vault-файле.           */
/* ================================================================== */

import { isTauri } from "@/stores/app";

const memCache = new Map<string, string>(); // host → data URL
const inflight = new Map<string, Promise<string | null>>();

/** Домен из произвольного URL (без порта и пути); null — не разобрали */
export function hostFromUrl(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  const noScheme = s.includes("://") ? s.slice(s.indexOf("://") + 3) : s;
  const host = noScheme.split(/[/?#]/)[0];
  const clean = host.split("@").pop()?.split(":")[0].toLowerCase().trim();
  return clean ? clean : null;
}

/** Data URL иконки для записи или null (нет сети/нет иконки/не Tauri) */
export async function fetchFaviconDataUrl(url: string): Promise<string | null> {
  if (!isTauri) return null; // браузерный предпросмотр — без сети
  const host = hostFromUrl(url);
  if (!host) return null;

  const cached = memCache.get(host);
  if (cached) return cached;

  const pending = inflight.get(host);
  if (pending) return pending;

  const task = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ content_type: string; bytes: number[] }>(
        "fetch_favicon",
        { url }
      );
      const bin = new Uint8Array(res.bytes);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bin.length; i += CHUNK) {
        binary += String.fromCharCode(...bin.subarray(i, i + CHUNK));
      }
      const dataUrl = `data:${
        res.content_type || "image/png"
      };base64,${btoa(binary)}`;
      memCache.set(host, dataUrl);
      return dataUrl;
    } catch {
      return null; // favicon_not_found / сеть недоступна — молча
    } finally {
      inflight.delete(host);
    }
  })();

  inflight.set(host, task);
  return task;
}

/** Очистка кэша (для тестов) */
export function clearFaviconCache(): void {
  memCache.clear();
  inflight.clear();
}

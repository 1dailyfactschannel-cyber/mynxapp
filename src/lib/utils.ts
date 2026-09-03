import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Проверяет URL перед открытием наружу.
 *
 * SECURITY: entry.url приходит из пользовательских данных; раньше он попадал
 * прямо в href="" — запись с url="javascript:alert(document.cookie)"
 * выполняла произвольный код в контексте вебвью при клике на иконку ссылки.
 * Разрешаем только http(s); "example.com/path" без схемы считаем https.
 * Возвращает null, если URL небезопасен или не похож на ссылку.
 */
export function safeExternalUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    // Домен/хост без схемы — считаем https; всё остальное (текст, javascript:, data:) — не ссылка
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(value)) return null;
    value = "https://" + value;
  }

  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

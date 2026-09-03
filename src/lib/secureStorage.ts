/**
 * Зашифрованный persist-слой для zustand (вложения).
 *
 * SECURITY: store `mynx-attachments` раньше писал в localStorage base64
 * вложений КАК ЕСТЬ — любой XSS, вредоносный скрипт в вебвью или дамп
 * профиля браузера читал содержимое вложений напрямую. Теперь весь
 * персист шифруется AES-256-GCM; ключ — неэкспортируемый CryptoKey
 * (extractable: false), сгенерированный при первом запуске и хранящийся
 * в IndexedDB: из JS его нельзя вытащить, только использовать.
 *
 * Формат localStorage: {"mynx-enc-v1":true,"iv":"<b64>","ct":"<b64>"}
 * Миграция: старый plaintext распознаётся отсутствием MAGIC и
 * возвращается как есть — zustand сразу же перезапишет его шифротекстом.
 */
import type { PersistStorage, StorageValue } from "zustand/middleware";
import type { AttachmentsState } from "@/stores/attachments";

const MAGIC = "mynx-enc-v1";
const DB_NAME = "mynx-secure";
const KEY_STORE = "keys";
const KEY_ID = "attachments-v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KEY_STORE)) {
        req.result.createObjectStore(KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Ключ хранится в IndexedDB как неэкспортируемый CryptoKey. */
async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const req = tx.objectStore(KEY_STORE).get(KEY_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // extractable: false — ключ нельзя выгрузить из вебвью
    ["encrypt", "decrypt"],
  );
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return key;
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

interface EncryptedEnvelope {
  iv: string;
  ct: string;
}

async function encryptJson(value: unknown): Promise<string> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const envelope: EncryptedEnvelope = { iv: bufToB64(iv), ct: bufToB64(ct) };
  return JSON.stringify({ [MAGIC]: true, ...envelope });
}

type DecryptResult<T> =
  | { kind: "plaintext"; value: T }   // legacy-запись без шифрования
  | { kind: "encrypted"; value: T }   // успешно расшифрована
  | { kind: "lost" }                  // наш формат, но ключ недоступен
  | { kind: "empty" };                // данных нет

async function decryptJson<T>(raw: string): Promise<DecryptResult<T>> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "empty" };
  }
  if (!parsed || parsed[MAGIC] !== true) {
    return { kind: "plaintext", value: parsed as T };
  }
  try {
    const env = parsed as unknown as EncryptedEnvelope;
    const key = await getOrCreateKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(env.iv) },
      key,
      b64ToBuf(env.ct),
    );
    return { kind: "encrypted", value: JSON.parse(new TextDecoder().decode(pt)) as T };
  } catch {
    // Ключ потерян (IndexedDB очищена) — расшифровать нельзя.
    return { kind: "lost" };
  }
}

/**
 * PersistStorage для zustand: шифрует весь снимок состояния перед записью.
 */
export const encryptedAttachmentsStorage: PersistStorage<AttachmentsState> = {
  getItem: async (name): Promise<StorageValue<AttachmentsState> | null> => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    const result = await decryptJson<StorageValue<AttachmentsState>>(raw);
    switch (result.kind) {
      case "plaintext":
      case "encrypted":
        return result.value;
      case "lost":
        // Не отдаём мусор: вложения недоступны, но и повреждённых
        // состояний в UI не попадёт. Данные затрутся при следующей записи.
        console.error("[mynx] attachments: encryption key lost, stored data unreadable");
        return null;
      default:
        return null;
    }
  },
  setItem: async (name, value): Promise<void> => {
    localStorage.setItem(name, await encryptJson(value));
  },
  removeItem: async (name): Promise<void> => {
    localStorage.removeItem(name);
  },
};

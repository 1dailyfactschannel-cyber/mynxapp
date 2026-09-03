// @vitest-environment jsdom
// IndexedDB отсутствует в jsdom — подключаем in-memory реализацию.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { encryptedAttachmentsStorage } from "./secureStorage";

// Тест не зависит от реального типа AttachmentsState — важен только
// контракт PersistStorage: zustand сам оборачивает T в { state, version }.
type TestState = Record<string, unknown>;
const storage = encryptedAttachmentsStorage as unknown as PersistStorage<TestState>;

const NAME = "mynx-attachments";
const sample: StorageValue<TestState> = {
  state: { entries: [{ id: "1", name: "secret.bin", data: "AAECAw==" }] },
  version: 0,
};

describe("encryptedAttachmentsStorage (P1-7 регресс)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("setItem шифрует: в localStorage нет plaintext и есть MAGIC", async () => {
    await storage.setItem(NAME, sample);
    const raw = localStorage.getItem(NAME);
    expect(raw).not.toBeNull();
    expect(raw!.startsWith('{"mynx-enc-v1":true')).toBe(true);
    expect(raw).not.toContain("secret.bin");
    expect(raw).not.toContain("AAECAw==");
  });

  it("getItem возвращает исходное значение (roundtrip)", async () => {
    await storage.setItem(NAME, sample);
    const back = await storage.getItem(NAME);
    expect(back).toEqual(sample);
  });

  it("каждая запись использует новый IV", async () => {
    await storage.setItem(NAME, sample);
    const first = localStorage.getItem(NAME);
    await storage.setItem(NAME, sample);
    const second = localStorage.getItem(NAME);
    expect(first).not.toEqual(second);
  });

  it("legacy plaintext распознаётся и отдаётся как есть (миграция)", async () => {
    const legacy = JSON.stringify(sample);
    localStorage.setItem(NAME, legacy);
    const back = await storage.getItem(NAME);
    expect(back).toEqual(sample);
  });

  it("битый шифротекст (ключ потерян) -> null, а не мусор", async () => {
    // Валидный конверт, но не тот ключ/IV — дешифровка не удастся.
    const garbage = JSON.stringify({
      "mynx-enc-v1": true,
      iv: btoa("0123456789ab"),
      ct: btoa("not-a-real-ciphertext"),
    });
    localStorage.setItem(NAME, garbage);
    expect(await storage.getItem(NAME)).toBeNull();
  });

  it("нет данных -> null; removeItem очищает", async () => {
    expect(await storage.getItem(NAME)).toBeNull();
    await storage.setItem(NAME, sample);
    await storage.removeItem(NAME);
    expect(localStorage.getItem(NAME)).toBeNull();
    expect(await storage.getItem(NAME)).toBeNull();
  });
});

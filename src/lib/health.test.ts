// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  passwordChangedAt,
  passwordAgeDays,
  analyzeHealth,
  loadHealthHistory,
  recordHealthSnapshot,
  trendDelta,
  buildHealthCsv,
  type HealthSnapshot,
} from "./health";
import type { Entry } from "@/stores/vault";

const DAY = 24 * 3600 * 1000;

function makeEntry(over: Partial<Entry> = {}): Entry {
  return {
    id: crypto.randomUUID(),
    title: "Example",
    username: "user",
    password: "Xk9#mPv$2nQ!wL7s",
    url: "https://example.com",
    category: "",
    tags: [],
    favorite: false,
    strength: 80,
    createdAt: Date.now() - 10 * DAY,
    updatedAt: Date.now() - 10 * DAY,
    ...over,
  };
}

describe("passwordChangedAt / passwordAgeDays", () => {
  it("берёт дату из passwordHistory, если она есть", () => {
    const at = Date.now() - 5 * DAY;
    const e = makeEntry({ createdAt: Date.now() - 100 * DAY, passwordHistory: [{ password: "old", changedAt: at }] });
    expect(passwordChangedAt(e)).toBe(at);
    expect(passwordAgeDays(e)).toBe(5);
  });

  it("фолбэк на createdAt, затем updatedAt", () => {
    const e = makeEntry({ createdAt: Date.now() - 3 * DAY, updatedAt: Date.now() - 1 * DAY });
    expect(passwordAgeDays(e)).toBe(3);
  });

  it("null, когда дат нет вовсе", () => {
    const e = makeEntry({ createdAt: undefined, updatedAt: undefined });
    expect(passwordChangedAt(e)).toBeNull();
    expect(passwordAgeDays(e)).toBeNull();
  });
});

describe("analyzeHealth", () => {
  const now = Date.now();

  it("считает слабые, повторные, просроченные и без 2FA", () => {
    const entries = [
      makeEntry({ id: "a", strength: 90, password: "AAAA0000!qqqq", tags: ["2fa"], createdAt: now - 5 * DAY }),
      makeEntry({ id: "b", strength: 20, password: "AAAA0000!qqqq", createdAt: now - 400 * DAY }),
      makeEntry({ id: "c", strength: 30, password: "BBBB1111@wwww", createdAt: now - 400 * DAY }),
    ];
    const a = analyzeHealth(entries, 180, now);
    expect(a.total).toBe(3);
    expect(a.weak.map((e) => e.id).sort()).toEqual(["b", "c"]);
    expect(a.reused.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(a.rotationDue.map((e) => e.id).sort()).toEqual(["b", "c"]);
    expect(a.rotationAges["b"]).toBe(400);
    expect(a.no2fa.map((e) => e.id).sort()).toEqual(["b", "c"]);
  });

  it("записи в корзине не участвуют", () => {
    const entries = [makeEntry({ deletedAt: now - DAY, strength: 5 })];
    expect(analyzeHealth(entries, 180, now).total).toBe(0);
  });

  it("штрафы снижают балл относительно средней силы", () => {
    const strong = makeEntry({ id: "s", strength: 100, password: "unique1!Q", tags: ["2fa"], createdAt: now - DAY });
    const dup = makeEntry({ id: "d", strength: 100, password: "unique1!Q", createdAt: now - DAY });
    const noIssue = analyzeHealth([strong], 180, now);
    const withIssues = analyzeHealth([strong, dup], 180, now);
    expect(withIssues.totalScore).toBeLessThan(noIssue.totalScore);
  });
});

describe("история снапшотов", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("сохраняет и загружает; один снапшот в день обновляется", () => {
    const now = Date.now();
    const entries = [makeEntry({ strength: 50 })];
    recordHealthSnapshot(entries, 180, now);
    recordHealthSnapshot([...entries, makeEntry({ strength: 90 })], 180, now + 1000);
    const history = loadHealthHistory();
    expect(history.length).toBe(1);
    expect(history[0].weak).toBe(0); // пересчитано вторым вызовом
  });

  it("trendDelta считает разницу с давней точки", () => {
    const now = Date.now();
    const snaps: HealthSnapshot[] = [
      { at: now - 8 * DAY, score: 50, weak: 1, reused: 0, rotationDue: 0, total: 2 },
      { at: now - 1 * DAY, score: 65, weak: 0, reused: 0, rotationDue: 0, total: 2 },
    ];
    expect(trendDelta(snaps, 7, now)).toBe(15);
  });

  it("trendDelta возвращает null, когда истории мало", () => {
    expect(trendDelta([], 7)).toBeNull();
    expect(
      trendDelta([{ at: Date.now(), score: 40, weak: 0, reused: 0, rotationDue: 0, total: 1 }], 7)
    ).toBeNull();
  });
});

describe("buildHealthCsv", () => {
  it("содержит BOM, заголовок и не содержит паролей", () => {
    const now = Date.now();
    const entries = [
      makeEntry({ id: "a", title: "Sber;bank", strength: 20, password: "SUPER_SECRET_1", createdAt: now - 400 * DAY }),
    ];
    const a = analyzeHealth(entries, 180, now);
    const csv = buildHealthCsv(a, entries, 180, now);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Mynx Health Report");
    expect(csv).toContain("rotation_due");
    expect(csv).toContain('"Sber;bank"');
    expect(csv).not.toContain("SUPER_SECRET_1");
  });
});

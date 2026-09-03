import { describe, it, expect } from "vitest";
import { findDuplicate, mergeDraftIntoEntry, normalizeUrlKey } from "./dedupe";
import type { Entry } from "@/stores/vault";
import type { ImportDraft } from "./import";

function makeEntry(over: Partial<Entry> = {}): Entry {
  return {
    id: crypto.randomUUID(),
    title: "GitHub",
    username: "matt",
    password: "Xk9#mPv$2nQ!wL7s",
    url: "https://github.com/login",
    category: "",
    tags: [],
    favorite: false,
    strength: 85,
    ...over,
  };
}

function makeDraft(over: Partial<ImportDraft> = {}): ImportDraft {
  return {
    title: "GitHub",
    username: "matt",
    password: "weakpass",
    url: "https://github.com",
    category: "",
    favorite: false,
    ...over,
  };
}

describe("normalizeUrlKey", () => {
  it("убирает схему, www, порт, путь и регистр", () => {
    expect(normalizeUrlKey("https://www.GitHub.com:443/login?x=1")).toBe("github.com");
    expect(normalizeUrlKey("http://YAHOO.COM")).toBe("yahoo.com");
  });

  it("пустой URL → пустой ключ", () => {
    expect(normalizeUrlKey("")).toBe("");
    expect(normalizeUrlKey("   ")).toBe("");
  });
});

describe("findDuplicate", () => {
  it("находит по host+username, включая www-варианты", () => {
    const existing = [makeEntry()];
    const dup = findDuplicate(existing, makeDraft({ url: "https://www.github.com/x" }));
    expect(dup).not.toBeNull();
    expect(dup!.reason).toBe("url+username");
    expect(dup!.entry.username).toBe("matt");
  });

  it("находит по title+username, когда URL не совпал", () => {
    const existing = [makeEntry({ url: "https://other.example.com" })];
    const dup = findDuplicate(existing, makeDraft());
    expect(dup?.reason).toBe("title+username");
  });

  it("не считает дублем запись с другим пользователем и без совпадений", () => {
    const existing = [makeEntry({ username: "another", title: "GitLab", url: "https://gitlab.com" })];
    expect(findDuplicate(existing, makeDraft())).toBeNull();
  });

  it("игнорирует записи в корзине", () => {
    const existing = [makeEntry({ deletedAt: Date.now() })];
    expect(findDuplicate(existing, makeDraft())).toBeNull();
  });
});

describe("mergeDraftIntoEntry", () => {
  it("заполняет пустые поля и оставляет более сильный пароль", () => {
    const entry = makeEntry({ password: "", strength: 0, url: "" });
    const patch = mergeDraftIntoEntry(entry, makeDraft({ password: "Xk9#mPv$2nQ!wL7s" }));
    expect(patch.password).toBe("Xk9#mPv$2nQ!wL7s");
    expect(patch.url).toBe("https://github.com");
    expect(patch.strength).toBeGreaterThan(0);
  });

  it("не трогает существующий более сильный пароль", () => {
    const entry = makeEntry({ password: "Xk9#mPv$2nQ!wL7s", strength: 85 });
    const patch = mergeDraftIntoEntry(entry, makeDraft({ password: "weakpass" }));
    expect(patch.password).toBeUndefined();
  });

  it("заменяет слабый пароль сильным", () => {
    const entry = makeEntry({ password: "123", strength: 10 });
    const patch = mergeDraftIntoEntry(entry, makeDraft({ password: "Xk9#mPv$2nQ!wL7s" }));
    expect(patch.password).toBe("Xk9#mPv$2nQ!wL7s");
  });

  it("заполняет TOTP и заметки только при отсутствии", () => {
    const entry = makeEntry({ notes: "keep me", totpSecret: "JBSWY3DPEHPK3PXP" });
    const patch = mergeDraftIntoEntry(
      entry,
      makeDraft({ notes: "draft note", totpSecret: "ABCDEFGHIJKLMNOP" })
    );
    expect(patch.notes).toBeUndefined();
    expect(patch.totpSecret).toBeUndefined();
  });
});

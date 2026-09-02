import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "./utils";

/**
 * P1-8 регресс: href в EntryDetail раньше получал entry.url как есть,
 * включая javascript:/data:-URL. safeExternalUrl должен пропускать
 * только http(s), домены без схемы поднимать до https, остальное — null.
 */
describe("safeExternalUrl", () => {
  it("пропускает валидные http/https URL", () => {
    expect(safeExternalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeExternalUrl("http://example.com")).toMatch(/^http:\/\/example\.com\/?$/);
  });

  it("поднимает домен без схемы до https", () => {
    expect(safeExternalUrl("example.com")).toBe("https://example.com/");
    expect(safeExternalUrl("sub.example.com/a?b=1")).toBe("https://sub.example.com/a?b=1");
  });

  it("обрезает пробелы", () => {
    expect(safeExternalUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  it("блокирует опасные схемы", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("ftp://files.example.com")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox")).toBeNull();
  });

  it("блокирует protocol-relative и мусор", () => {
    expect(safeExternalUrl("//evil.com")).toBeNull();
    expect(safeExternalUrl("не ссылка, просто текст")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
  });

  it("выживает на битом вводе", () => {
    expect(safeExternalUrl("https://")).toBeNull();
    expect(safeExternalUrl("http:// example.com")).toBeNull();
  });
});

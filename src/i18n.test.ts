// @vitest-environment jsdom
// i18n.tsx импортирует React — top-level без рендера, node тоже подошёл бы,
// но jsdom даёт document/localStorage, которые трогает I18nProvider.
import { describe, it, expect } from "vitest";
import { translations } from "./i18n";

const PLACEHOLDER = /\{\d+\}/g;

function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
}

/**
 * P2-10: строки en/ru разъезжались — в одном языке ключ есть, в другом нет,
 * UI молча показывал ключ вместо текста. Тест держит словари в паритете.
 */
describe("i18n en/ru parity", () => {
  const en = translations.en;
  const ru = translations.ru;

  it("наборы ключей en и ru идентичны", () => {
    const missingInRu = Object.keys(en).filter((k) => !(k in ru));
    const missingInEn = Object.keys(ru).filter((k) => !(k in en));
    expect(missingInRu, `нет в ru: ${missingInRu.join(", ")}`).toEqual([]);
    expect(missingInEn, `нет в en: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("нет пустых и ключе-подобных значений", () => {
    for (const [lang, dict] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value.trim(), `${lang}.${key}`).not.toBe("");
        expect(value, `${lang}.${key} === свой ключ`).not.toBe(key);
      }
    }
  });

  it("плейсхолдеры {0},{1},... совпадают в en и ru", () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(ru[key]), `${key}: плейсхолдеры не совпали`).toEqual(
        placeholders(en[key])
      );
    }
  });
});

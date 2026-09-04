import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import { en } from "@/i18n/en";
import { ru } from "@/i18n/ru";

/**
 * Тип словаря: ключ → строка. Строки могут содержать плейсхолдеры
 * вида {0}, {1}, …, заменяемые аргументами `t(key, ...args)`.
 */
export type Dictionary = Record<string, string>;

/**
 * Контракт локали: импорт нового языка = добавить файл `src/i18n/<lang>.ts`,
 * зарегистрировать его в `translations` ниже и в `Lang` (если ввёл новый
 * язык). Паритет наборов ключей проверяется тестом `i18n.test.ts`.
 */
export type Lang = "en" | "ru";

export const translations: Record<Lang, Dictionary> = {
  en,
  ru,
};

/**
 * Плюрализация «N записей» / «N entries». Берёт ключи из словаря,
 * чтобы каждая локаль сама решала, как согласовать.
 */
export function entriesCountLabel(lang: Lang, n: number): string {
  const dict = translations[lang];
  // Простая плюрализация: ru использует несколько форм, en — одну.
  if (lang === "ru") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return dict.entriesCountOne || `${n} записей`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
      return dict.entriesCountFew || `${n} записи`;
    return dict.entriesCountMany || `${n} записей`;
  }
  return n === 1 ? dict.entriesCountOne || "1 entry" : `${n} ${dict.entries || "entries"}`;
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /**
   * Получить локализованную строку по ключу. Если ключа нет — возврат
   * английского варианта, а в крайнем случае — самого ключа (легче
   * отлавливать опечатки). Плейсхолдеры `{0}` заменяются аргументами.
   */
  t: (key: string, ...args: (string | number)[]) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  // Инициализируем из localStorage; при первом запуске определяем язык системы
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem("mynx-lang");
      if (saved === "ru" || saved === "en") return saved;
      // Первый запуск: берём системную локаль (ru* → русский, иначе английский)
      const systemLang = typeof navigator !== "undefined" ? navigator.language : "en";
      return systemLang.toLowerCase().startsWith("ru") ? "ru" : "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("mynx-lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
  }, []);

  const t = useCallback(
    (key: string, ...args: (string | number)[]) => {
      let text = translations[lang][key] ?? translations.en[key] ?? key;
      args.forEach((arg, i) => {
        text = text.replace(`{${i}}`, String(arg));
      });
      return text;
    },
    [lang]
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

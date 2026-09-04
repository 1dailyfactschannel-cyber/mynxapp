import { useCallback, useState } from "react";

/**
 * Стек модалок: вместо 10 булевых useState ("quickAddOpen", "settingsOpen"...)
 * один стек с одним активным элементом.
 *
 * Преимущества:
 *  - Декларативно: компонент сам регистрирует свои модалки;
 *  - Только один модал активен одновременно (нет конфликтов видимости);
 *  - Escape на верхнем уровне закрывает именно верхний;
 *  - TypeScript знает, какие модалки бывают — нельзя открыть несуществующую.
 *
 * Использование:
 *   const modal = useModalStack<"quickAdd" | "settings" | "generator">();
 *   modal.open("quickAdd");
 *   modal.close("quickAdd");
 *   modal.toggle("settings");
 *   {modal.current === "settings" && <SettingsModal onClose={modal.close} />}
 */
export function useModalStack<K extends string>(initial: K | null = null) {
  const [current, setCurrent] = useState<K | null>(initial);

  const open = useCallback((key: K) => setCurrent(key), []);
  const close = useCallback((_key?: K) => setCurrent(null), []);
  const toggle = useCallback((key: K) => setCurrent((c) => (c === key ? null : key)), []);
  const isOpen = useCallback((key: K) => current === key, [current]);

  return {
    current,
    open,
    close,
    toggle,
    isOpen,
  };
}

export type ModalStack<K extends string> = ReturnType<typeof useModalStack<K>>;

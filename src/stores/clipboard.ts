import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/stores/app";

/**
 * Централизованный буфер обмена.
 *
 * Tauri-режим — «слепое копирование»: секрет шифруется и живёт только в
 * памяти приложения (secure_copy), в глобальный буфер не попадает.
 * Вставка — глобальным хоткеем (secure_paste), ввод напрямую через
 * SendInput. Таймер автоочистки не нужен: буфер одноразовый.
 *
 * Браузерный демо-режим — обычный буфер с автоочисткой:
 * текст попадает в буфер, а через N секунд буфер очищается
 * (только если там всё ещё наш текст — не трогаем чужие данные).
 */

interface ClipboardState {
  timeLeft: number;
  isActive: boolean;
  /** Скопировать текст и запустить таймер автоочистки */
  copy: (text: string, clearAfterSeconds: number, enabled: boolean) => Promise<void>;
  cancel: () => void;
}

let timeoutRef: ReturnType<typeof setTimeout> | null = null;
let intervalRef: ReturnType<typeof setInterval> | null = null;
let lastCopied: string | null = null;

function clearTimers() {
  if (timeoutRef) clearTimeout(timeoutRef);
  if (intervalRef) clearInterval(intervalRef);
  timeoutRef = null;
  intervalRef = null;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  timeLeft: 0,
  isActive: false,

  copy: async (text, clearAfterSeconds, enabled) => {
    // Слепое копирование: защищённый буфер внутри приложения,
    // глобальный буфер обмена не трогаем
    if (isTauri) {
      await invoke("secure_copy", { request: { text } });
      clearTimers();
      lastCopied = null;
      set({ isActive: false, timeLeft: 0 });
      return;
    }

    await navigator.clipboard.writeText(text);

    clearTimers();
    lastCopied = text;

    if (!enabled || clearAfterSeconds <= 0) {
      set({ isActive: false, timeLeft: 0 });
      return;
    }

    set({ isActive: true, timeLeft: clearAfterSeconds });

    intervalRef = setInterval(() => {
      set((state) => {
        const next = Math.max(0, state.timeLeft - 1);
        return { timeLeft: next };
      });
    }, 1000);

    timeoutRef = setTimeout(async () => {
      clearTimers();
      // Очищаем только если в буфере всё ещё наш текст
      try {
        const current = await navigator.clipboard.readText().catch(() => lastCopied);
        if (current === lastCopied || current === null) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        await navigator.clipboard.writeText("").catch(() => {});
      }
      lastCopied = null;
      set({ isActive: false, timeLeft: 0 });
    }, clearAfterSeconds * 1000);
  },

  cancel: () => {
    clearTimers();
    lastCopied = null;
    set({ isActive: false, timeLeft: 0 });
  },
}));

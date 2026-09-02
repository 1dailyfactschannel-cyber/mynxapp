import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

interface SettingsState {
  /** Автоблокировка, минуты бездействия */
  autoLockMinutes: number;
  /** Очистка буфера обмена, секунды */
  clipboardClearSeconds: number;
  /** Автоочистка буфера включена */
  clipboardClearEnabled: boolean;
  /** Отключить системную историю буфера Windows (Win+V) */
  clipboardHistoryDisabled: boolean;
  /** Плотность стекла 0–100 */
  glassIntensity: number;
  /** Хоткей «показать окно + Quick Add» (accelerator, напр. "Ctrl+Shift+A") */
  hotkeyQuickAdd: string;
  /** Хоткей авто-ввода логина/пароля */
  hotkeyAutoType: string;
  /** Хоткей генератора паролей */
  hotkeyGenerator: string;
  /** Хоткей быстрой блокировки */
  hotkeyLock: string;
  /** Хоткей вставки из защищённого буфера (слепое копирование) */
  hotkeySecurePaste: string;
  /** Блокировать хранилище при сворачивании окна в трей */
  lockOnMinimize: boolean;
  /** Счётчик принудительной перерегистрации хоткеев (rollback при конфликте) */
  hotkeysEpoch: number;

  /** Включён автобэкап */
  backupEnabled: boolean;
  /** Интервал автобэкапа, минуты */
  backupIntervalMinutes: number;
  /** Путь для автобэкапов */
  backupPath: string;
  /** Сколько копий хранить */
  backupKeepCount: number;

  /** Срок хранения в корзине, дней (0 = вечно) */
  trashRetentionDays: number;

  /** Авто-скрытие паролей, секунды */
  passwordHideSeconds: number;
  /** Путь для скачивания вложений */
  downloadPath: string;

  setAutoLockMinutes: (v: number) => void;
  setClipboardClearSeconds: (v: number) => void;
  setClipboardClearEnabled: (v: boolean) => void;
  setClipboardHistoryDisabled: (v: boolean) => void;
  setGlassIntensity: (v: number) => void;
  setHotkeyQuickAdd: (v: string) => void;
  setHotkeyAutoType: (v: string) => void;
  setHotkeyGenerator: (v: string) => void;
  setHotkeyLock: (v: string) => void;
  setHotkeySecurePaste: (v: string) => void;
  setLockOnMinimize: (v: boolean) => void;
  bumpHotkeysEpoch: () => void;

  setBackupEnabled: (v: boolean) => void;
  setBackupIntervalMinutes: (v: number) => void;
  setBackupPath: (v: string) => void;
  setBackupKeepCount: (v: number) => void;
  setTrashRetentionDays: (v: number) => void;
  setPasswordHideSeconds: (v: number) => void;
  setDownloadPath: (v: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoLockMinutes: 5,
      clipboardClearSeconds: 30,
      clipboardClearEnabled: true,
      clipboardHistoryDisabled: false,
      glassIntensity: 70,
      hotkeyQuickAdd: "Ctrl+Shift+A",
      hotkeyAutoType: "Ctrl+Alt+A",
      hotkeyGenerator: "Ctrl+Shift+G",
      hotkeyLock: "Ctrl+Shift+L",
      hotkeySecurePaste: "Ctrl+Shift+V",
      lockOnMinimize: true,
      hotkeysEpoch: 0,

      backupEnabled: false,
      backupIntervalMinutes: 60,
      backupPath: "backups",
      backupKeepCount: 10,

      trashRetentionDays: 30,

      passwordHideSeconds: 60,
      downloadPath: "Downloads",

      setAutoLockMinutes: (v) => set({ autoLockMinutes: v }),
      setClipboardClearSeconds: (v) => set({ clipboardClearSeconds: v }),
      setClipboardClearEnabled: (v) => set({ clipboardClearEnabled: v }),
      setClipboardHistoryDisabled: (v) => set({ clipboardHistoryDisabled: v }),
      setGlassIntensity: (v) => set({ glassIntensity: v }),
      setHotkeyQuickAdd: (v) => set({ hotkeyQuickAdd: v }),
      setHotkeyAutoType: (v) => set({ hotkeyAutoType: v }),
      setHotkeyGenerator: (v) => set({ hotkeyGenerator: v }),
      setHotkeyLock: (v) => set({ hotkeyLock: v }),
      setHotkeySecurePaste: (v) => set({ hotkeySecurePaste: v }),
      setLockOnMinimize: (v) => set({ lockOnMinimize: v }),
      bumpHotkeysEpoch: () => set((s) => ({ hotkeysEpoch: s.hotkeysEpoch + 1 })),

      setBackupEnabled: (v) => set({ backupEnabled: v }),
      setBackupIntervalMinutes: (v) => set({ backupIntervalMinutes: v }),
      setBackupPath: (v) => set({ backupPath: v }),
      setBackupKeepCount: (v) => set({ backupKeepCount: v }),
      setTrashRetentionDays: (v) => set({ trashRetentionDays: v }),
      setPasswordHideSeconds: (v) => set({ passwordHideSeconds: v }),
      setDownloadPath: (v) => set({ downloadPath: v }),
    }),
    {
      name: "mynx-settings",
      version: 1,
    }
  )
);

/** Применяет плотность стекла к CSS-переменной (диапазон зависит от темы) */
export function applyGlassIntensity(value: number, isDark: boolean) {
  const v = Math.min(100, Math.max(0, value)) / 100;
  // Тёмная тема: стекло едва заметное (как в оригинале ~3–8%),
  // светлая: плотное «молочное» стекло
  const alpha = isDark ? 0.01 + v * 0.06 : 0.35 + v * 0.6;
  document.documentElement.style.setProperty("--glass-alpha", alpha.toFixed(3));
}

/* ------------------------------------------------------------------ */
/* Синхронизация безопасных настроек в бэкенд                           */
/* ------------------------------------------------------------------ */

function pushAutolock(minutes: number) {
  invoke("set_autolock_minutes", { minutes: Math.max(0, Math.round(minutes)) }).catch(() => {
    /* нет бэкенда (тесты/статика) — молча игнорируем */
  });
}

function pushLockOnHide(enabled: boolean) {
  invoke("set_lock_on_hide", { enabled }).catch(() => {
    /* нет бэкенда — молча игнорируем */
  });
}

// Бэкенд держит свою копию таймаута автоблокировки (AppStateInner::
// enforce_autolock) и сам гасит сессию по простою: фронтовый таймер
// в вебвью обходится сном системы или подменой фронта.
useSettingsStore.subscribe((state, prev) => {
  if (state.autoLockMinutes !== prev.autoLockMinutes) pushAutolock(state.autoLockMinutes);
  if (state.lockOnMinimize !== prev.lockOnMinimize) pushLockOnHide(state.lockOnMinimize);
});

// Стартовая синхронизация: сохранённые настройки могут отличаться
// от дефолтов бэкенда после рестарта приложения.
pushAutolock(useSettingsStore.getState().autoLockMinutes);
pushLockOnHide(useSettingsStore.getState().lockOnMinimize);

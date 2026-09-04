import { create } from "zustand";

export type Screen = "lock" | "vault-selector" | "vault" | "settings" | "generator";

/** true, если приложение запущено внутри Tauri (а не в обычном браузере) */
export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

/**
 * Сессия: текущий экран, состояние блокировки, активный vault, ошибка.
 * Изменения — часто на каждый unlock/lock/navigation; другие подсистемы
 * подписываются на отдельные сторы, чтобы не ре-рендериться на каждое
 * поле.
 */
export interface SessionState {
  screen: Screen;
  isLocked: boolean;
  isUnlocked: boolean;
  activeVault: string | null;
  isLoading: boolean;
  error: string | null;
  hasCompletedOnboarding: boolean;

  setScreen: (screen: Screen) => void;
  setLoading: (loading: boolean) => void;
  setError: (msg: string | null) => void;
  setActiveVault: (id: string | null) => void;
  setUnlocked: (unlocked: boolean) => void;
  setLocked: (locked: boolean) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  /** Полный сброс сессии (для lock/delete) */
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  screen: "lock",
  isLocked: true,
  isUnlocked: false,
  activeVault: null,
  isLoading: false,
  error: null,
  hasCompletedOnboarding: false,

  setScreen: (screen) => set({ screen }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setActiveVault: (activeVault) => set({ activeVault }),
  setUnlocked: (isUnlocked) => set({ isUnlocked }),
  setLocked: (isLocked) => set({ isLocked }),
  setHasCompletedOnboarding: (value) => set({ hasCompletedOnboarding: value }),
  resetSession: () =>
    set({
      isLocked: true,
      isUnlocked: false,
      activeVault: null,
      screen: "lock",
      hasCompletedOnboarding: false,
    }),
}));

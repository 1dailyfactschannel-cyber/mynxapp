/**
 * useAppStore — ОБРАТНАЯ СОВМЕСТИМОСТЬ.
 *
 * Реальные данные хранятся в 4 отдельных сторах:
 *   - useSessionStore  — экран, locked/unlocked, activeVault, error, isLoading
 *   - useDecoyStore    — isDecoySession, decoyEnabled
 *   - useHwKeyStore    — hwKeyEnabled + операции
 *   - useVaultOpsStore — unlock/lock/createVault/loadVaults/changeMasterPassword/...
 *
 * Этот фасад:
 *   1. Экспортирует те же `useAppStore((s) => s.field)` селекторы,
 *      что и раньше — компоненты не переписываются.
 *   2. Делегирует запись в 4 стора.
 *   3. Реализует подписку `persistEntriesDebounced` (не относится
 *      ни к одному из 4 сторов, поэтому живёт здесь).
 *
 * Новый код предпочитает импортировать конкретный стор напрямую.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import { useSessionStore, isTauri, type Screen } from "@/stores/session";
import { useDecoyStore } from "@/stores/decoy";
import { useHwKeyStore } from "@/stores/hwKey";
import { useVaultOpsStore } from "@/stores/vaultOps";
import { useVaultStore } from "@/stores/vault";

export { isTauri };
export type { Screen };

/* ------------------------------------------------------------------ */
/* Персист записей в зашифрованный vault-файл (только Tauri-режим)     */
/* ------------------------------------------------------------------ */

/** JSON последнего сохранённого состояния — защита от лишних записей на диск */
let lastPersistedJson = "[]";
let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function persistEntriesNow(): Promise<void> {
  if (!isTauri) return;
  const { activeVault, isUnlocked } = useSessionStore.getState();
  if (!activeVault || !isUnlocked) return;

  const json = JSON.stringify(useVaultStore.getState().entries);
  if (json === lastPersistedJson) return;

  try {
    await invoke("vault_save_entries", {
      request: { vault_id: activeVault, entries_json: json },
    });
    lastPersistedJson = json;
  } catch (e) {
    console.error("Persist entries failed:", e);
  }
}

/** Дебаунс-сохранение записей; вызывается подпиской на изменения стора */
export function persistEntriesDebounced(): void {
  if (!isTauri) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistEntriesNow();
  }, 600);
}

/** Сбросить кэш персиста (вызывается из backendSync при lock и т.п.) */
export function resetPersistedJsonCache(): void {
  lastPersistedJson = "[]";
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Фасад useAppStore                                                   */
/* ------------------------------------------------------------------ */

/**
 * Полный интерфейс, который видят компоненты. Реализуется через
 * `useAppFacade` ниже — он подписывается на 4 стора и собирает view.
 */
export interface AppState {
  // session
  screen: Screen;
  isLocked: boolean;
  isUnlocked: boolean;
  activeVault: string | null;
  isLoading: boolean;
  error: string | null;
  hasCompletedOnboarding: boolean;
  // decoy
  isDecoySession: boolean;
  decoyEnabled: boolean;
  // hw-key (cached status only; operations go via store)
  hwKeyEnabled: boolean | null;
  // операции
  setScreen: (screen: Screen) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  unlock: (vaultId: string, password: string, keyfilePath?: string) => Promise<void>;
  unlockBiometry: (vaultId: string) => Promise<void>;
  lock: () => Promise<void>;
  createVault: (name: string, path: string, password: string) => Promise<void>;
  loadVaults: () => Promise<void>;
  checkStatus: () => Promise<void>;
  refreshDecoyStatus: () => Promise<void>;
  changeMasterPassword: (oldPassword: string, newPassword: string) => Promise<void>;
  setDecoyPassword: (masterPassword: string, decoyPassword: string, oldDecoyPassword?: string) => Promise<void>;
  removeDecoy: (masterPassword: string) => Promise<void>;
  hwKeyStatus: () => Promise<boolean>;
  enableHwKey: (masterPassword: string, directory: string, decoyPassword?: string) => Promise<string>;
  disableHwKey: (masterPassword: string, decoyPassword?: string) => Promise<void>;
  deleteAllData: () => Promise<void>;
  exportVault: (masterPassword: string) => Promise<string>;
}

export const useAppStore = create<AppState>((_set, _get) => {
  // Заполняем начальный snapshot из 4 сторов.
  const initial = () => ({
    ...useSessionStore.getState(),
    isDecoySession: useDecoyStore.getState().isDecoySession,
    decoyEnabled: useDecoyStore.getState().decoyEnabled,
    hwKeyEnabled: useHwKeyStore.getState().hwKeyEnabled,
  });

  // Подписки на 4 стора: при любом изменении обновляем фасад
  const refresh = () => {
    useAppStore.setState(initial() as any);
  };
  useSessionStore.subscribe(refresh);
  useDecoyStore.subscribe(refresh);
  useHwKeyStore.subscribe(refresh);

  return {
    ...initial() as any,

    setScreen: (screen) => useSessionStore.getState().setScreen(screen),
    setHasCompletedOnboarding: (value) =>
      useSessionStore.getState().setHasCompletedOnboarding(value),

    unlock: (...args) => useVaultOpsStore.getState().unlock(...args),
    unlockBiometry: (...args) => useVaultOpsStore.getState().unlockBiometry(...args),
    lock: () => useVaultOpsStore.getState().lock(),
    createVault: (...args) => useVaultOpsStore.getState().createVault(...args),
    loadVaults: () => useVaultOpsStore.getState().loadVaults(),
    checkStatus: () => useVaultOpsStore.getState().checkStatus(),
    changeMasterPassword: (...args) => useVaultOpsStore.getState().changeMasterPassword(...args),
    deleteAllData: () => useVaultOpsStore.getState().deleteAllData(),
    exportVault: (...args) => useVaultOpsStore.getState().exportVault(...args),

    refreshDecoyStatus: () => useDecoyStore.getState().refreshDecoyStatus(),
    setDecoyPassword: (...args) => useDecoyStore.getState().setDecoyPassword(...args),
    removeDecoy: (...args) => useDecoyStore.getState().removeDecoy(...args),

    hwKeyStatus: () => useHwKeyStore.getState().hwKeyStatus(),
    enableHwKey: (...args) => useHwKeyStore.getState().enableHwKey(...args),
    disableHwKey: (...args) => useHwKeyStore.getState().disableHwKey(...args),
  } as AppState;
});

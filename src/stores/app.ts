import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useVaultStore, DEMO_ENTRIES, type Entry } from "@/stores/vault";

export type Screen = "lock" | "vault-selector" | "vault" | "settings" | "generator";

/** true, если приложение запущено внутри Tauri (а не в обычном браузере) */
export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const DEMO_VAULT = "demo/Personal.safepass";

/* ------------------------------------------------------------------ */
/* Персист записей в зашифрованный vault-файл (только Tauri-режим)     */
/* ------------------------------------------------------------------ */

/** JSON последнего сохранённого состояния — защита от лишних записей на диск */
let lastPersistedJson = "[]";
let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function persistEntriesNow(): Promise<void> {
  if (!isTauri) return;
  const { activeVault, isUnlocked } = useAppStore.getState();
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

function parseEntriesJson(entriesJson: string | undefined): Entry[] {
  try {
    const parsed = JSON.parse(entriesJson || "[]");
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */

interface AppState {
  screen: Screen;
  isLocked: boolean;
  isUnlocked: boolean;
  activeVault: string | null;
  /** true — текущая сессия открыта ложным паролем (слой обмана) */
  isDecoySession: boolean;
  /** Включён ли ложный слой у активного vault (известно только при разблокировке) */
  decoyEnabled: boolean;
  isLoading: boolean;
  error: string | null;
  hasCompletedOnboarding: boolean;

  setScreen: (screen: Screen) => void;
  unlock: (vaultId: string, password: string, keyfilePath?: string) => Promise<void>;
  /** Разблокировка через Windows Hello (ответ тот же, что у vault_unlock) */
  unlockBiometry: (vaultId: string) => Promise<void>;
  lock: () => Promise<void>;
  createVault: (name: string, path: string, password: string) => Promise<void>;
  loadVaults: () => Promise<void>;
  checkStatus: () => Promise<void>;
  setHasCompletedOnboarding: (value: boolean) => void;
  refreshDecoyStatus: () => Promise<void>;
  changeMasterPassword: (oldPassword: string, newPassword: string) => Promise<void>;
  setDecoyPassword: (masterPassword: string, decoyPassword: string, oldDecoyPassword?: string) => Promise<void>;
  removeDecoy: (masterPassword: string) => Promise<void>;
  /** Включён ли аппаратный ключ у активного vault */
  hwKeyStatus: () => Promise<boolean>;
  /** Включить аппаратный ключ: вернёт путь записанного keyfile */
  enableHwKey: (masterPassword: string, directory: string, decoyPassword?: string) => Promise<string>;
  disableHwKey: (masterPassword: string, decoyPassword?: string) => Promise<void>;
  deleteAllData: () => Promise<void>;
  /** Возвращает путь сохранённого файла, "" — отмена, "download" — браузерный режим */
  exportVault: (masterPassword: string) => Promise<string>;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: "lock",
  isLocked: true,
  isUnlocked: false,
  activeVault: null,
  isDecoySession: false,
  decoyEnabled: false,
  isLoading: false,
  error: null,
  hasCompletedOnboarding: false,

  setScreen: (screen) => set({ screen }),
  setHasCompletedOnboarding: (value) => set({ hasCompletedOnboarding: value }),

  refreshDecoyStatus: async () => {
    if (!isTauri) return;
    const { activeVault, isUnlocked, isDecoySession } = get();
    if (!activeVault || !isUnlocked) return;
    if (isDecoySession) {
      set({ decoyEnabled: true });
      return;
    }
    try {
      const res = await invoke<{ enabled: boolean }>("vault_decoy_status", {
        request: { vault_id: activeVault },
      });
      set({ decoyEnabled: res.enabled });
    } catch (e) {
      console.error("Decoy status check failed:", e);
    }
  },

  unlock: async (vaultId, password, keyfilePath) => {
    set({ isLoading: true, error: null });
    try {
      if (!isTauri) {
        // Браузерный демо-режим: без бэкенда, наполняем демо-данными
        if (useVaultStore.getState().entries.length === 0) {
          useVaultStore.getState().setEntries(DEMO_ENTRIES);
        }
        set({
          isLocked: false,
          isUnlocked: true,
          screen: "vault",
          activeVault: vaultId,
          isLoading: false,
        });
        return;
      }

      const result = await invoke<{
        success: boolean;
        entry_count: number;
        entries_json: string;
        is_decoy: boolean;
      }>("vault_unlock", {
        request: {
          vault_id: vaultId,
          master_password: password,
          keyfile_path: keyfilePath || null,
        },
      });

      if (result.success) {
        const entries = parseEntriesJson(result.entries_json);
        useVaultStore.getState().setEntries(entries);
        lastPersistedJson = JSON.stringify(entries);
        set({
          isLocked: false,
          isUnlocked: true,
          isDecoySession: !!result.is_decoy,
          decoyEnabled: !!result.is_decoy,
          screen: "vault",
          activeVault: vaultId,
          isLoading: false,
        });
        if (!result.is_decoy) {
          void get().refreshDecoyStatus();
        }
      } else {
        set({ error: "Unlock failed", isLoading: false });
        throw new Error("Unlock failed");
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  unlockBiometry: async (vaultId) => {
    if (!isTauri) throw new Error("biometry_not_available");
    set({ isLoading: true, error: null });
    try {
      const result = await invoke<{
        success: boolean;
        entry_count: number;
        entries_json: string;
        is_decoy: boolean;
      }>("vault_unlock_biometry", {
        request: { vault_id: vaultId },
      });

      if (result.success) {
        const entries = parseEntriesJson(result.entries_json);
        useVaultStore.getState().setEntries(entries);
        lastPersistedJson = JSON.stringify(entries);
        set({
          isLocked: false,
          isUnlocked: true,
          isDecoySession: !!result.is_decoy,
          decoyEnabled: !!result.is_decoy,
          screen: "vault",
          activeVault: vaultId,
          isLoading: false,
        });
        if (!result.is_decoy) {
          void get().refreshDecoyStatus();
        }
      } else {
        set({ error: "Unlock failed", isLoading: false });
        throw new Error("Unlock failed");
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  lock: async () => {
    // Команда бэкенда — best-effort: даже если она упадёт или зависнет,
    // UI обязан заблокироваться (кнопка «Заблокировать» не должна молчать)
    try {
      if (isTauri) await invoke("vault_lock");
    } catch (e) {
      console.error("Lock command failed:", e);
    }
    // Очищаем записи из памяти при блокировке
    useVaultStore.getState().setEntries([]);
    useVaultStore.getState().setSelectedEntry(null);
    lastPersistedJson = "[]";
    set({
      isLocked: true,
      isUnlocked: false,
      isDecoySession: false,
      decoyEnabled: false,
      screen: "lock",
    });
  },

  createVault: async (name, path, password) => {
    set({ isLoading: true, error: null });
    try {
      if (!isTauri) {
        // Браузерный демо-режим
        if (useVaultStore.getState().entries.length === 0) {
          useVaultStore.getState().setEntries(DEMO_ENTRIES);
        }
        set({
          activeVault: `demo/${name}.safepass`,
          screen: "vault",
          isLocked: false,
          isUnlocked: true,
          hasCompletedOnboarding: true,
          isLoading: false,
        });
        return;
      }

      const result = await invoke<{ vault_id: string; success: boolean }>("vault_create", {
        request: { name, path, master_password: password },
      });
      if (result.success) {
        useVaultStore.getState().setEntries([]);
        lastPersistedJson = "[]";
        set({
          activeVault: result.vault_id,
          screen: "vault",
          isLocked: false,
          isUnlocked: true,
          isDecoySession: false,
          decoyEnabled: false,
          hasCompletedOnboarding: true,
          isLoading: false,
        });
      } else {
        set({ error: "Failed to create vault", isLoading: false });
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  checkStatus: async () => {
    if (!isTauri) return;
    try {
      const unlocked = await invoke<boolean>("check_vault_unlocked");
      if (!unlocked) {
        set({ isLocked: true, screen: "lock", decoyEnabled: false });
      }
    } catch (e) {
      console.error("Status check failed:", e);
    }
  },

  loadVaults: async () => {
    if (!isTauri) {
      // Браузерный демо-режим: одно демо-хранилище
      set({
        activeVault: DEMO_VAULT,
        hasCompletedOnboarding: true,
        screen: "lock",
      });
      return;
    }

    try {
      const files = await invoke<string[]>("list_vault_files");
      if (files.length === 0) {
        // Нет vault файлов — показываем Onboarding
        set({
          hasCompletedOnboarding: false,
          activeVault: null,
          screen: "lock",
        });
      } else if (files.length === 1) {
        set({
          activeVault: files[0],
          hasCompletedOnboarding: true,
          screen: "lock",
        });
      } else {
        set({
          hasCompletedOnboarding: true,
          screen: "vault-selector",
        });
      }
    } catch (e) {
      console.error("Load vaults failed:", e);
      set({ hasCompletedOnboarding: false });
    }
  },

  changeMasterPassword: async (oldPassword, newPassword) => {
    if (!isTauri) {
      // Браузерный демо-режим: считаем успешным
      return;
    }
    const { activeVault } = get();
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_change_password", {
      request: {
        vault_id: activeVault,
        old_password: oldPassword,
        new_password: newPassword,
      },
    });
  },

  setDecoyPassword: async (masterPassword, decoyPassword, oldDecoyPassword) => {
    if (!isTauri) return; // браузерный демо-режим: считаем успешным
    const { activeVault } = get();
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_set_decoy_password", {
      request: {
        vault_id: activeVault,
        master_password: masterPassword,
        decoy_password: decoyPassword,
        old_decoy_password: oldDecoyPassword || null,
      },
    });
    set({ decoyEnabled: true });
  },

  removeDecoy: async (masterPassword) => {
    if (!isTauri) return;
    const { activeVault } = get();
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_remove_decoy", {
      request: { vault_id: activeVault, master_password: masterPassword },
    });
    set({ decoyEnabled: false });
  },

  hwKeyStatus: async () => {
    if (!isTauri) return false;
    const { activeVault } = get();
    if (!activeVault) return false;
    const res = await invoke<{ enabled: boolean }>("vault_hw_key_status", {
      request: { vault_id: activeVault },
    });
    return res.enabled;
  },

  enableHwKey: async (masterPassword, directory, decoyPassword) => {
    if (!isTauri) return ""; // браузерный демо-режим
    const { activeVault } = get();
    if (!activeVault) throw new Error("No active vault");
    const res = await invoke<{ keyfile_path: string }>("vault_enable_hw_key", {
      request: {
        vault_id: activeVault,
        master_password: masterPassword,
        directory,
        decoy_password: decoyPassword || null,
      },
    });
    return res.keyfile_path;
  },

  disableHwKey: async (masterPassword, decoyPassword) => {
    if (!isTauri) return;
    const { activeVault } = get();
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_disable_hw_key", {
      request: {
        vault_id: activeVault,
        master_password: masterPassword,
        decoy_password: decoyPassword || null,
      },
    });
  },

  deleteAllData: async () => {
    const { activeVault } = get();
    if (isTauri && activeVault) {
      await invoke("vault_delete", {
        request: { vault_id: activeVault },
      });
    }
    useVaultStore.getState().setEntries([]);
    useVaultStore.getState().setSelectedEntry(null);
    lastPersistedJson = "[]";
    set({
      isLocked: true,
      isUnlocked: false,
      isDecoySession: false,
      decoyEnabled: false,
      activeVault: null,
      screen: "lock",
      hasCompletedOnboarding: false,
    });
  },

  exportVault: async (masterPassword) => {
    if (!isTauri) {
      // Браузерный демо-режим: скачиваем JSON-файл
      const data = JSON.stringify(
        {
          app: "Mynx",
          kind: "demo-export",
          exportedAt: new Date().toISOString(),
          entries: useVaultStore.getState().entries,
        },
        null,
        2
      );
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mynx-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return "download";
    }

    const { activeVault } = get();
    if (!activeVault) throw new Error("No active vault");
    const res = await invoke<{ path: string; cancelled: boolean }>("vault_export", {
      request: { vault_id: activeVault, master_password: masterPassword },
    });
    return res.cancelled ? "" : res.path;
  },
}));

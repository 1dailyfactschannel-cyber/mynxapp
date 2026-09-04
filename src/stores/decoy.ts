import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/stores/session";
import { parseError } from "@/lib/errors";

/**
 * Ложный слой (plausible deniability). Изолирован, потому что
 * используется в 1-2 местах и редко меняется.
 */
export interface DecoyState {
  /** true — текущая сессия открыта ложным паролем (слой обмана) */
  isDecoySession: boolean;
  /** Включён ли ложный слой у активного vault (известно после unlock) */
  decoyEnabled: boolean;

  /** Установить флаг isDecoySession (вызывается из vaultOps при unlock) */
  setIsDecoySession: (isDecoy: boolean) => void;
  /** Установить/сменить ложный пароль */
  setDecoyPassword: (
    masterPassword: string,
    decoyPassword: string,
    oldDecoyPassword?: string
  ) => Promise<void>;
  /** Отключить ложный слой (слот заменяется на «спящий») */
  removeDecoy: (masterPassword: string) => Promise<void>;
  /** Обновить статус decoy_enabled из зашифрованного заголовка */
  refreshDecoyStatus: () => Promise<void>;
  /** Сброс при lock/delete (decoySession = false) */
  resetDecoy: () => void;
}

export const useDecoyStore = create<DecoyState>((set, get) => ({
  isDecoySession: false,
  decoyEnabled: false,

  setIsDecoySession: (isDecoySession) => set({ isDecoySession }),

  setDecoyPassword: async (masterPassword, decoyPassword, oldDecoyPassword) => {
    if (!isTauri) return;
    const { activeVault } = await import("@/stores/session").then((m) => m.useSessionStore.getState());
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
    const { activeVault } = await import("@/stores/session").then((m) => m.useSessionStore.getState());
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_remove_decoy", {
      request: { vault_id: activeVault, master_password: masterPassword },
    });
    set({ decoyEnabled: false });
  },

  refreshDecoyStatus: async () => {
    if (!isTauri) return;
    const { useSessionStore } = await import("@/stores/session");
    const { activeVault, isUnlocked } = useSessionStore.getState();
    const isDecoySession = get().isDecoySession;
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
      console.error("Decoy status check failed:", parseError(e).message);
    }
  },

  resetDecoy: () => set({ isDecoySession: false, decoyEnabled: false }),
}));

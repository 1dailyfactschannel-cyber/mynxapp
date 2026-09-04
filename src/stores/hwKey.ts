import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/stores/session";

/**
 * Аппаратный ключ (USB-флешка с keyfile). Изолирован от основной сессии:
 *  - включается/выключается редко;
 *  - статус "enabled" — единственное публичное состояние для UI.
 */
export interface HwKeyState {
  /** Включён ли hw-ключ у активного vault (null = ещё не запрашивали) */
  hwKeyEnabled: boolean | null;

  /** Включён ли hw-ключ у активного vault */
  hwKeyStatus: () => Promise<boolean>;
  /** Включить hw-ключ: вернёт путь записанного keyfile */
  enableHwKey: (
    masterPassword: string,
    directory: string,
    decoyPassword?: string
  ) => Promise<string>;
  /** Отключить hw-ключ (нужны мастер-пароль и вставленная флешка) */
  disableHwKey: (masterPassword: string, decoyPassword?: string) => Promise<void>;
  /** Сбросить кэш (при lock/delete) */
  resetHwKey: () => void;
}

export const useHwKeyStore = create<HwKeyState>((set) => ({
  hwKeyEnabled: null,

  hwKeyStatus: async () => {
    if (!isTauri) return false;
    const { activeVault } = await import("@/stores/session").then((m) =>
      m.useSessionStore.getState()
    );
    if (!activeVault) return false;
    const res = await invoke<{ enabled: boolean }>("vault_hw_key_status", {
      request: { vault_id: activeVault },
    });
    set({ hwKeyEnabled: res.enabled });
    return res.enabled;
  },

  enableHwKey: async (masterPassword, directory, decoyPassword) => {
    if (!isTauri) return "";
    const { activeVault } = await import("@/stores/session").then((m) =>
      m.useSessionStore.getState()
    );
    if (!activeVault) throw new Error("No active vault");
    const res = await invoke<{ keyfile_path: string }>("vault_enable_hw_key", {
      request: {
        vault_id: activeVault,
        master_password: masterPassword,
        directory,
        decoy_password: decoyPassword || null,
      },
    });
    set({ hwKeyEnabled: true });
    return res.keyfile_path;
  },

  disableHwKey: async (masterPassword, decoyPassword) => {
    if (!isTauri) return;
    const { activeVault } = await import("@/stores/session").then((m) =>
      m.useSessionStore.getState()
    );
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_disable_hw_key", {
      request: {
        vault_id: activeVault,
        master_password: masterPassword,
        decoy_password: decoyPassword || null,
      },
    });
    set({ hwKeyEnabled: false });
  },

  resetHwKey: () => set({ hwKeyEnabled: null }),
}));

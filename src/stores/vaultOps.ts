import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import { useVaultStore, DEMO_ENTRIES, type Entry } from "@/stores/vault";
import { useSessionStore, isTauri } from "@/stores/session";
import { parseError, userMessage } from "@/lib/errors";

/**
 * Операции над vault: unlock, lock, create, list, change password,
 * export, delete. Каждая операция — async с типизированной ошибкой.
 *
 * Этот стор координирует session + vault + decoy + hwKey при unlock:
 *  - читает session для activeVault;
 *  - пишет session (isLocked=false, screen=vault);
 *  - читает/пишет vault.entries;
 *  - шлёт refreshDecoyStatus после успешного unlock.
 */
export interface VaultOpsState {
  unlock: (vaultId: string, password: string, keyfilePath?: string) => Promise<void>;
  /** Разблокировка через Windows Hello */
  unlockBiometry: (vaultId: string) => Promise<void>;
  lock: () => Promise<void>;
  createVault: (name: string, path: string, password: string) => Promise<void>;
  loadVaults: () => Promise<void>;
  changeMasterPassword: (oldPassword: string, newPassword: string) => Promise<void>;
  deleteAllData: () => Promise<void>;
  /**
   * Возвращает путь сохранённого файла, "" — отмена, "download" — браузерный режим.
   */
  exportVault: (masterPassword: string) => Promise<string>;
  checkStatus: () => Promise<void>;
}

function parseEntriesJson(entriesJson: string | undefined): Entry[] {
  try {
    const parsed = JSON.parse(entriesJson || "[]");
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

export const useVaultOpsStore = create<VaultOpsState>(() => ({
  /**
   * Разблокировка: либо в Tauri (вызов backend), либо в браузере
   * (демо-режим с заранее заданными записями).
   */
  unlock: async (vaultId, password, keyfilePath) => {
    const session = useSessionStore.getState();
    session.setLoading(true);
    session.setError(null);
    try {
      if (!isTauri) {
        // Браузерный демо
        if (useVaultStore.getState().entries.length === 0) {
          useVaultStore.getState().setEntries(DEMO_ENTRIES);
        }
        useSessionStore.setState({
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
        // Обновляем lastPersistedJson (модульная переменная в app.ts — оставлена,
        // но мы её не используем здесь, debounce делается в persistEntriesDebounced)
        useSessionStore.setState({
          isLocked: false,
          isUnlocked: true,
          screen: "vault",
          activeVault: vaultId,
          isLoading: false,
        } as any);
        const { useDecoyStore } = await import("@/stores/decoy");
        useDecoyStore.getState().setIsDecoySession(result.is_decoy);
        // Подтянем флаг decoy_enabled асинхронно (не блокируем unlock)
        if (!result.is_decoy) {
          void useDecoyStore.getState().refreshDecoyStatus();
        }
      } else {
        useSessionStore.setState({ error: "Unlock failed", isLoading: false });
        throw new Error("Unlock failed");
      }
    } catch (e) {
      const err = parseError(e);
      useSessionStore.setState({ error: err.message, isLoading: false });
      throw e;
    }
  },

  unlockBiometry: async (vaultId) => {
    if (!isTauri) throw new Error("biometry_not_available");
    const session = useSessionStore.getState();
    session.setLoading(true);
    session.setError(null);
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
        useSessionStore.setState({
          isLocked: false,
          isUnlocked: true,
          screen: "vault",
          activeVault: vaultId,
          isLoading: false,
        } as any);
        const { useDecoyStore } = await import("@/stores/decoy");
        useDecoyStore.getState().setIsDecoySession(result.is_decoy);
        if (!result.is_decoy) {
          void useDecoyStore.getState().refreshDecoyStatus();
        }
      } else {
        useSessionStore.setState({ error: "Unlock failed", isLoading: false });
        throw new Error("Unlock failed");
      }
    } catch (e) {
      useSessionStore.setState({ error: parseError(e).message, isLoading: false });
      throw e;
    }
  },

  /**
   * Блокировка: best-effort — даже если backend не ответил, UI обязан
   * уйти в lock. Стирает записи из памяти, забывает сессию.
   */
  lock: async () => {
    try {
      if (isTauri) await invoke("vault_lock");
    } catch (e) {
      console.error("Lock command failed:", parseError(e).message);
    }
    useVaultStore.getState().setEntries([]);
    useVaultStore.getState().setSelectedEntry(null);
    const { useDecoyStore } = await import("@/stores/decoy");
    useDecoyStore.getState().resetDecoy();
    useSessionStore.setState({
      isLocked: true,
      isUnlocked: false,
      screen: "lock",
    });
  },

  createVault: async (name, path, password) => {
    const session = useSessionStore.getState();
    session.setLoading(true);
    session.setError(null);
    try {
      if (!isTauri) {
        if (useVaultStore.getState().entries.length === 0) {
          useVaultStore.getState().setEntries(DEMO_ENTRIES);
        }
        useSessionStore.setState({
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
        useSessionStore.setState({
          activeVault: result.vault_id,
          screen: "vault",
          isLocked: false,
          isUnlocked: true,
          hasCompletedOnboarding: true,
          isLoading: false,
        });
      } else {
        session.setError("Failed to create vault");
        session.setLoading(false);
      }
    } catch (e) {
      session.setError(userMessage(e, "Failed to create vault"));
      session.setLoading(false);
    }
  },

  loadVaults: async () => {
    if (!isTauri) {
      useSessionStore.setState({
        activeVault: "demo/Personal.safepass",
        hasCompletedOnboarding: true,
        screen: "lock",
      });
      return;
    }

    try {
      const files = await invoke<string[]>("list_vault_files");
      if (files.length === 0) {
        useSessionStore.setState({
          hasCompletedOnboarding: false,
          activeVault: null,
          screen: "lock",
        });
      } else if (files.length === 1) {
        useSessionStore.setState({
          activeVault: files[0],
          hasCompletedOnboarding: true,
          screen: "lock",
        });
      } else {
        useSessionStore.setState({
          hasCompletedOnboarding: true,
          screen: "vault-selector",
        });
      }
    } catch (e) {
      console.error("Load vaults failed:", parseError(e).message);
      useSessionStore.setState({ hasCompletedOnboarding: false });
    }
  },

  changeMasterPassword: async (oldPassword, newPassword) => {
    if (!isTauri) return;
    const { activeVault } = useSessionStore.getState();
    if (!activeVault) throw new Error("No active vault");
    await invoke("vault_change_password", {
      request: {
        vault_id: activeVault,
        old_password: oldPassword,
        new_password: newPassword,
      },
    });
  },

  deleteAllData: async () => {
    const { activeVault } = useSessionStore.getState();
    if (isTauri && activeVault) {
      await invoke("vault_delete", {
        request: { vault_id: activeVault },
      });
    }
    useVaultStore.getState().setEntries([]);
    useVaultStore.getState().setSelectedEntry(null);
    const { useDecoyStore } = await import("@/stores/decoy");
    useDecoyStore.getState().resetDecoy();
    const { useHwKeyStore } = await import("@/stores/hwKey");
    useHwKeyStore.getState().resetHwKey();
    useSessionStore.getState().resetSession();
  },

  exportVault: async (masterPassword) => {
    if (!isTauri) {
      // Браузерный демо: скачиваем JSON
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

    const { activeVault } = useSessionStore.getState();
    if (!activeVault) throw new Error("No active vault");
    const res = await invoke<{ path: string; cancelled: boolean }>("vault_export", {
      request: { vault_id: activeVault, master_password: masterPassword },
    });
    return res.cancelled ? "" : res.path;
  },

  checkStatus: async () => {
    if (!isTauri) return;
    try {
      const unlocked = await invoke<boolean>("check_vault_unlocked");
      if (!unlocked) {
        useSessionStore.setState({ isLocked: true, screen: "lock" });
      }
    } catch (e) {
      console.error("Status check failed:", parseError(e).message);
    }
  },
}));

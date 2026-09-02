import { create } from "zustand";
import { persist } from "zustand/middleware";
import { encryptedAttachmentsStorage } from "@/lib/secureStorage";
import type { PasskeyItem, PasskeyExport } from "@/lib/passkey";
import { buildExport } from "@/lib/passkey";

/* ================================================================== */
/* Стор passkeys. Персист через то же шифрованное хранилище, что и     */
/* вложения (AES-256-GCM, secureStorage.ts). Доступен только в        */
/* разблокированной сессии — модуль открывается из VaultScreen.        */
/* ================================================================== */

interface PasskeysState {
  passkeys: PasskeyItem[];

  addPasskey: (item: PasskeyItem) => void;
  removePasskey: (id: string) => void;
  /** Отметить использование (self-test / будущий auth-флоу) */
  touchPasskey: (id: string) => void;
  exportPayload: () => PasskeyExport;
  importPasskeys: (items: PasskeyItem[]) => number;
}

export const usePasskeysStore = create<PasskeysState>()(
  persist(
    (set, get) => ({
      passkeys: [],

      addPasskey: (item) =>
        set((state) => ({ passkeys: [...state.passkeys, item] })),

      removePasskey: (id) =>
        set((state) => ({ passkeys: state.passkeys.filter((p) => p.id !== id) })),

      touchPasskey: (id) =>
        set((state) => ({
          passkeys: state.passkeys.map((p) =>
            p.id === id ? { ...p, lastUsedAt: Date.now() } : p
          ),
        })),

      exportPayload: () => buildExport(get().passkeys),

      importPasskeys: (items) => {
        // Дедупликация по credentialId — повторный импорт не плодит копии
        const seen = new Set(get().passkeys.map((p) => p.credentialId));
        const fresh = items.filter((p) => !seen.has(p.credentialId));
        if (fresh.length > 0) {
          set((state) => ({ passkeys: [...state.passkeys, ...fresh] }));
        }
        return fresh.length;
      },
    }),
    {
      name: "mynx-passkeys",
      version: 1,
      // SECURITY: приватные ключи не лежат в localStorage открытым текстом
      storage: encryptedAttachmentsStorage,
    }
  )
);

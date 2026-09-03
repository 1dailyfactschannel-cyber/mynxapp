import { create } from "zustand";
import { persist } from "zustand/middleware";
import { encryptedAttachmentsStorage } from "@/lib/secureStorage";

export interface Attachment {
  id: string;
  name: string;
  folderId: string | null;
  data: string; // base64
  size: number;
  mimeType: string;
  createdAt: number;
  updatedAt: number;
  /** Ручной порядок сортировки внутри папки (persist) */
  order?: number;
}

export interface AttachmentFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  /** Порядок в списке папок (persist) */
  order?: number;
}

export interface AttachmentsState {
  attachments: Attachment[];
  folders: AttachmentFolder[];
  selectedFolderId: string | null;

  setSelectedFolderId: (id: string | null) => void;

  addFolder: (name: string, parentId?: string | null) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;

  addAttachment: (name: string, folderId: string | null, data: string, mimeType: string, size: number) => void;
  renameAttachment: (id: string, name: string) => void;
  deleteAttachment: (id: string) => void;
  moveAttachment: (id: string, folderId: string | null) => void;
  /** Ручная перестановка вложений внутри одной папки */
  reorderAttachments: (fromId: string, toId: string) => void;
  /** Перестановка папок одного уровня */
  reorderFolders: (fromId: string, toId: string) => void;
}

export const useAttachmentsStore = create<AttachmentsState>()(
  persist(
    (set) => ({
      attachments: [],
      folders: [],
      selectedFolderId: null,

      setSelectedFolderId: (id) => set({ selectedFolderId: id }),

      addFolder: (name, parentId = null) =>
        set((state) => ({
          folders: [
            ...state.folders,
            { id: crypto.randomUUID(), name, parentId, createdAt: Date.now() },
          ],
        })),

      renameFolder: (id, name) =>
        set((state) => ({
          folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((state) => {
          // Удаляем папку и все вложенные папки
          const toDelete = new Set<string>([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const f of state.folders) {
              if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
                toDelete.add(f.id);
                changed = true;
              }
            }
          }
          return {
            folders: state.folders.filter((f) => !toDelete.has(f.id)),
            attachments: state.attachments.filter((a) => !toDelete.has(a.folderId || "")),
          };
        }),

      addAttachment: (name, folderId, data, mimeType, size) =>
        set((state) => {
          const maxOrder = state.attachments
            .filter((a) => a.folderId === folderId)
            .reduce((m, a) => Math.max(m, a.order ?? 0), 0);
          return {
            attachments: [
              ...state.attachments,
              {
                id: crypto.randomUUID(),
                name,
                folderId,
                data,
                size,
                mimeType,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                order: maxOrder + 1,
              },
            ],
          };
        }),

      renameAttachment: (id, name) =>
        set((state) => ({
          attachments: state.attachments.map((a) => (a.id === id ? { ...a, name, updatedAt: Date.now() } : a)),
        })),

      deleteAttachment: (id) =>
        set((state) => ({
          attachments: state.attachments.filter((a) => a.id !== id),
        })),

      moveAttachment: (id, folderId) =>
        set((state) => {
          // В новой папке кладём в конец списка
          const maxOrder = state.attachments
            .filter((a) => a.folderId === folderId && a.id !== id)
            .reduce((m, a) => Math.max(m, a.order ?? 0), 0);
          return {
            attachments: state.attachments.map((a) =>
              a.id === id ? { ...a, folderId, order: maxOrder + 1, updatedAt: Date.now() } : a
            ),
          };
        }),

      reorderAttachments: (fromId, toId) => {
        if (fromId === toId) return;
        set((state) => {
          const from = state.attachments.find((a) => a.id === fromId);
          const to = state.attachments.find((a) => a.id === toId);
          if (!from || !to || from.folderId !== to.folderId) return {};
          const siblings = state.attachments
            .filter((a) => a.folderId === from.folderId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const fromIdx = siblings.findIndex((a) => a.id === fromId);
          const toIdx = siblings.findIndex((a) => a.id === toId);
          if (fromIdx < 0 || toIdx < 0) return {};
          const [moved] = siblings.splice(fromIdx, 1);
          siblings.splice(toIdx, 0, moved);
          const orderById = new Map(siblings.map((a, i) => [a.id, i + 1]));
          return {
            attachments: state.attachments.map((a) =>
              orderById.has(a.id) ? { ...a, order: orderById.get(a.id) } : a
            ),
          };
        });
      },

      reorderFolders: (fromId, toId) => {
        if (fromId === toId) return;
        set((state) => {
          const from = state.folders.find((f) => f.id === fromId);
          const to = state.folders.find((f) => f.id === toId);
          if (!from || !to || from.parentId !== to.parentId) return {};
          const siblings = state.folders
            .filter((f) => f.parentId === from.parentId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const fromIdx = siblings.findIndex((f) => f.id === fromId);
          const toIdx = siblings.findIndex((f) => f.id === toId);
          if (fromIdx < 0 || toIdx < 0) return {};
          const [moved] = siblings.splice(fromIdx, 1);
          siblings.splice(toIdx, 0, moved);
          const orderById = new Map(siblings.map((f, i) => [f.id, i + 1]));
          return {
            folders: state.folders.map((f) =>
              orderById.has(f.id) ? { ...f, order: orderById.get(f.id) } : f
            ),
          };
        });
      },
    }),
    {
      name: "mynx-attachments",
      version: 1,
      // SECURITY: вложения больше не лежат в localStorage открытым текстом —
      // снимок состояния шифруется AES-256-GCM (см. secureStorage.ts).
      storage: encryptedAttachmentsStorage,
    }
  )
);

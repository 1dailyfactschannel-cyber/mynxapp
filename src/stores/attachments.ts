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
}

export interface AttachmentFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
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
        set((state) => ({
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
            },
          ],
        })),

      renameAttachment: (id, name) =>
        set((state) => ({
          attachments: state.attachments.map((a) => (a.id === id ? { ...a, name, updatedAt: Date.now() } : a)),
        })),

      deleteAttachment: (id) =>
        set((state) => ({
          attachments: state.attachments.filter((a) => a.id !== id),
        })),

      moveAttachment: (id, folderId) =>
        set((state) => ({
          attachments: state.attachments.map((a) => (a.id === id ? { ...a, folderId, updatedAt: Date.now() } : a)),
        })),
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

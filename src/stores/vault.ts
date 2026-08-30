import { create } from "zustand";

export interface CustomField {
  id: string;
  label: string;
  value: string;
  type: "text" | "hidden" | "email" | "url" | "number" | "date";
}

export interface PasswordHistoryItem {
  password: string;
  changedAt: number;
}

export interface Entry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  category: string;
  tags: string[];
  favorite: boolean;
  strength: number;
  icon?: string;
  totpSecret?: string;
  createdAt?: number;
  updatedAt?: number;
  notes?: string;
  customFields?: CustomField[];
  passwordHistory?: PasswordHistoryItem[];
  deletedAt?: number;
}

interface VaultState {
  entries: Entry[];
  searchQuery: string;
  selectedCategory: string;
  selectedEntry: string | null;

  setEntries: (entries: Entry[]) => void;
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: string) => void;
  setSelectedEntry: (id: string | null) => void;
  addEntry: (entry: Entry) => void;
  updateEntry: (id: string, patch: Partial<Omit<Entry, "id">>) => void;
  toggleFavorite: (id: string) => void;
  deleteEntry: (id: string) => void;
  restoreEntry: (id: string) => void;
  purgeTrash: (retentionDays: number) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  entries: [],
  searchQuery: "",
  selectedCategory: "All",
  selectedEntry: null,

  setEntries: (entries) => set({ entries }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (category) => set({ selectedCategory: category }),
  setSelectedEntry: (id) => set({ selectedEntry: id }),
  addEntry: (entry) =>
    set((state) => ({
      entries: [{ ...entry, createdAt: entry.createdAt ?? Date.now(), updatedAt: Date.now() }, ...state.entries],
    })),
  updateEntry: (id, patch) =>
    set((state) => ({
      entries: state.entries.map((e) => {
        if (e.id !== id) return e;

        // Сохраняем историю паролей (макс. 10 последних)
        let passwordHistory = e.passwordHistory || [];
        if (patch.password !== undefined && patch.password !== e.password) {
          passwordHistory = [
            { password: e.password, changedAt: Date.now() },
            ...passwordHistory,
          ].slice(0, 10);
        }

        return { ...e, ...patch, id: e.id, updatedAt: Date.now(), passwordHistory };
      }),
    })),
  toggleFavorite: (id) =>
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e)),
    })),
  deleteEntry: (id) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, deletedAt: Date.now() } : e
      ),
      selectedEntry: state.selectedEntry === id ? null : state.selectedEntry,
    })),
  restoreEntry: (id) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, deletedAt: undefined } : e
      ),
    })),
  purgeTrash: (retentionDays) => {
    if (retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
    set((state) => ({
      entries: state.entries.filter((e) => !e.deletedAt || e.deletedAt > cutoff),
    }));
  },
}));

/** Оценка надёжности пароля 0–100 */
export function calculateStrength(pwd: string): number {
  if (!pwd) return 0;
  let s = 0;
  if (pwd.length >= 12) s += 25;
  if (pwd.length >= 16) s += 15;
  if (/[a-z]/.test(pwd)) s += 15;
  if (/[A-Z]/.test(pwd)) s += 15;
  if (/[0-9]/.test(pwd)) s += 15;
  if (/[^a-zA-Z0-9]/.test(pwd)) s += 15;
  return Math.min(100, s);
}

/** Генерация криптостойкого случайного пароля */
export function generateRandomPassword(length = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/** Демо-записи для браузерного предпросмотра (когда нет Tauri-бэкенда) */
export const DEMO_ENTRIES: Entry[] = [
  {
    id: "demo-1",
    title: "Google",
    username: "matt@gmail.com",
    password: "Xk9#mPv$2nQ!wL7s",
    url: "https://accounts.google.com",
    category: "Social",
    tags: ["email", "2fa"],
    favorite: true,
    strength: 85,
    icon: "🔍",
    totpSecret: "JBSWY3DPEHPK3PXP",
    createdAt: Date.now() - 400 * 24 * 3600 * 1000,
    updatedAt: Date.now() - 3 * 24 * 3600 * 1000,
  },
  {
    id: "demo-2",
    title: "GitHub",
    username: "matt-dev",
    password: "gh_R7t!kM2#vX9pQw",
    url: "https://github.com",
    category: "Development",
    tags: ["work", "2fa"],
    favorite: true,
    strength: 90,
    icon: "🐙",
    createdAt: Date.now() - 200 * 24 * 3600 * 1000,
    updatedAt: Date.now() - 10 * 24 * 3600 * 1000,
  },
  {
    id: "demo-3",
    title: "Sberbank",
    username: "matt.k",
    password: "pass123",
    url: "https://online.sberbank.ru",
    category: "Banking",
    tags: ["critical"],
    favorite: false,
    strength: 20,
    icon: "🏦",
    createdAt: Date.now() - 900 * 24 * 3600 * 1000,
    updatedAt: Date.now() - 500 * 24 * 3600 * 1000,
  },
  {
    id: "demo-4",
    title: "Netflix",
    username: "matt@gmail.com",
    password: "pass123",
    url: "https://netflix.com",
    category: "Entertainment",
    tags: ["family"],
    favorite: false,
    strength: 20,
    icon: "🎬",
    createdAt: Date.now() - 150 * 24 * 3600 * 1000,
    updatedAt: Date.now() - 30 * 24 * 3600 * 1000,
  },
  {
    id: "demo-5",
    title: "AWS Console",
    username: "matt-admin",
    password: "Aws#2024!kL9mN4$p",
    url: "https://console.aws.amazon.com",
    category: "Work",
    tags: ["infra", "critical"],
    favorite: false,
    strength: 85,
    icon: "☁️",
    createdAt: Date.now() - 60 * 24 * 3600 * 1000,
    updatedAt: Date.now() - 5 * 24 * 3600 * 1000,
  },
  {
    id: "demo-6",
    title: "Booking.com",
    username: "matt.k@outlook.com",
    password: "hotel2020",
    url: "https://booking.com",
    category: "Travel",
    tags: [],
    favorite: false,
    strength: 25,
    icon: "✈️",
    createdAt: Date.now() - 800 * 24 * 3600 * 1000,
    updatedAt: Date.now() - 365 * 24 * 3600 * 1000,
  },
];

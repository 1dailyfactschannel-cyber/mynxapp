import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Category {
  id: string;
  label: string;
  icon: string;
  system?: boolean;
}

interface CategoryState {
  categories: Category[];
  addCategory: (label: string, icon?: string) => Category | null;
  updateCategory: (id: string, patch: Partial<Omit<Category, "id">>) => void;
  deleteCategory: (id: string) => void;
  resetToDefaults: () => void;
}

export const DEFAULT_CATEGORY_ICONS = [
  "Banknote",
  "MessageCircle",
  "Briefcase",
  "Code",
  "ShoppingCart",
  "Film",
  "Plane",
  "HelpCircle",
  "Shield",
  "Star",
  "Lock",
  "Key",
  "Mail",
  "Globe",
  "Smartphone",
  "CreditCard",
  "Heart",
  "Music",
  "Gamepad2",
  "BookOpen",
  "Coffee",
  "Car",
  "Home",
  "User",
  "Bell",
  "Calendar",
  "Clock",
  "Cloud",
  "Database",
  "FileText",
  "Flag",
  "Image",
  "Map",
  "Phone",
  "Server",
  "Settings",
  "Trash2",
  "Video",
  "Zap",
];

export const DEFAULT_CATEGORIES: Category[] = [];

export function getCategoryLabel(category: Category, t: (key: string) => string): string {
  if (category.system && !category.label) {
    return t(`cat.${category.id}`) || category.id;
  }
  if (category.system) {
    return t(`cat.${category.id}`) || category.label;
  }
  return category.label;
}

export function getFallbackIconName(): string {
  return "HelpCircle";
}

export const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      categories: DEFAULT_CATEGORIES,

      addCategory: (label, icon = "HelpCircle") => {
        const trimmed = label.trim();
        if (!trimmed) return null;
        const slug = trimmed
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\p{L}\p{N}-]/gu, "");
        const id = slug || crypto.randomUUID();
        if (get().categories.some((c) => c.id === id)) return null;
        const category: Category = { id, label: trimmed, icon, system: false };
        set((state) => ({ categories: [...state.categories, category] }));
        return category;
      },

      updateCategory: (id, patch) =>
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === id ? { ...c, ...patch, system: c.system && !patch.label } : c
          ),
        })),

      deleteCategory: (id) =>
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
        })),

      resetToDefaults: () => set({ categories: DEFAULT_CATEGORIES }),
    }),
    {
      name: "mynx-categories",
      version: 2,
      // v2: убраны категории по умолчанию — начинаем с пустого списка
      migrate: () => ({ categories: [] }),
    }
  )
);

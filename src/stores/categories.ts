import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Category {
  id: string;
  label: string;
  icon: string;
  system?: boolean;
  /** Позиция в сайдбаре (persist); категории без order идут в конец */
  order?: number;
}

interface CategoryState {
  categories: Category[];
  addCategory: (label: string, icon?: string) => Category | null;
  updateCategory: (id: string, patch: Partial<Omit<Category, "id">>) => void;
  deleteCategory: (id: string) => void;
  /** Перестановка: категория fromId встаёт на текущую позицию toId */
  reorderCategories: (fromId: string, toId: string) => void;
  /** Сдвиг на одну позицию (клавиатурная альтернатива drag&drop) */
  moveCategory: (id: string, dir: -1 | 1) => void;
  resetToDefaults: () => void;
}

/** Пользовательские категории в порядке отображения в сайдбаре */
export function orderedCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => {
    const oa = a.order ?? Number.MAX_SAFE_INTEGER;
    const ob = b.order ?? Number.MAX_SAFE_INTEGER;
    return oa - ob;
  });
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
        const maxOrder = get().categories.reduce(
          (m, c) => Math.max(m, c.order ?? 0),
          0
        );
        const category: Category = {
          id,
          label: trimmed,
          icon,
          system: false,
          order: maxOrder + 1,
        };
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

      reorderCategories: (fromId, toId) => {
        if (fromId === toId) return;
        set((state) => {
          const ordered = orderedCategories(state.categories);
          const fromIdx = ordered.findIndex((c) => c.id === fromId);
          const toIdx = ordered.findIndex((c) => c.id === toId);
          if (fromIdx < 0 || toIdx < 0) return {};
          const [moved] = ordered.splice(fromIdx, 1);
          ordered.splice(toIdx, 0, moved);
          const orderById = new Map(ordered.map((c, i) => [c.id, i + 1]));
          return {
            categories: state.categories.map((c) =>
              orderById.has(c.id) ? { ...c, order: orderById.get(c.id) } : c
            ),
          };
        });
      },

      moveCategory: (id, dir) => {
        set((state) => {
          const ordered = orderedCategories(state.categories);
          const idx = ordered.findIndex((c) => c.id === id);
          const target = idx + dir;
          if (idx < 0 || target < 0 || target >= ordered.length) return {};
          const orderById = new Map(ordered.map((c, i) => [c.id, i + 1]));
          orderById.set(id, target + 1);
          orderById.set(ordered[target].id, idx + 1);
          return {
            categories: state.categories.map((c) =>
              orderById.has(c.id) ? { ...c, order: orderById.get(c.id) } : c
            ),
          };
        });
      },

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

import { Search, Plus, Shield, Settings2 } from "lucide-react";
import { motion } from "framer-motion";
import { useI18n, entriesCountLabel } from "@/i18n";
import type { Entry } from "@/stores/vault";
import { useMemo, useState } from "react";
import { useCategoryStore, getCategoryLabel } from "@/stores/categories";
import { useAttachmentsStore } from "@/stores/attachments";
import { getIconComponent } from "@/lib/icons";
import { CategoryManager } from "@/components/CategoryManager";

interface SidebarProps {
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  entries: Entry[];
  onNewEntry?: () => void;
}

export function Sidebar({
  selectedCategory,
  onSelectCategory,
  onSearch,
  searchQuery,
  entries,
  onNewEntry,
}: SidebarProps) {
  const { t, lang } = useI18n();
  const categories = useCategoryStore((s) => s.categories);
  const attachmentsCount = useAttachmentsStore((s) => s.attachments.length);
  const [managerOpen, setManagerOpen] = useState(false);

  // Живые счётчики по категориям
  const counts = useMemo(() => {
    const active = entries.filter((e) => !e.deletedAt);
    const trashed = entries.filter((e) => e.deletedAt);
    const map: Record<string, number> = { All: active.length };
    map.Favorites = active.filter((e) => e.favorite).length;
    for (const e of active) {
      map[e.category] = (map[e.category] || 0) + 1;
    }
    map.Trash = trashed.length;
    map.Attachments = attachmentsCount;
    return map;
  }, [entries, attachmentsCount]);

  const allCategories = [
    { id: "All", icon: "Shield", system: true },
    { id: "Favorites", icon: "Star", system: true },
    ...categories,
    { id: "Trash", icon: "Trash2", system: true },
    { id: "Attachments", icon: "File", system: true },
  ];

  return (
    <>
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="w-64 h-full flex flex-col"
        style={{
          borderRight: "1px solid var(--divider)",
          background: "var(--chrome-sidebar-bg)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
        }}
      >
        <div className="p-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="icon-badge w-8 h-8 rounded-lg">
              <Shield className="w-4 h-4" />
            </div>
            <span className="font-semibold t1">{t("appName")}</span>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 t3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="field rounded-xl pl-10 pr-3 py-2 text-sm"
            />
          </div>

          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={onNewEntry}
            className="btn-primary w-full px-3 py-2.5 text-sm mb-4"
          >
            <Plus className="w-4 h-4" />
            {t("newEntry")}
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="flex items-center justify-between px-3 mb-2">
            <p className="section-title">{t("categories")}</p>
            <button
              onClick={() => setManagerOpen(true)}
              className="icon-btn"
              title={t("manageCategories")}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            {allCategories.map((cat) => {
              const Icon = getIconComponent(cat.icon);
              const isActive = selectedCategory === cat.id;
              const count = counts[cat.id] || 0;
              const label =
                cat.id === "All" || cat.id === "Favorites" || cat.id === "Trash"
                  ? cat.id === "Trash"
                    ? t("trashTitle")
                    : t(`cat.${cat.id}`)
                  : cat.id === "Attachments"
                    ? t("attachmentsTitle")
                    : getCategoryLabel(cat as any, t);
              return (
                <motion.button
                  key={cat.id}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectCategory(cat.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all border ${
                    isActive ? "soft-accent" : "border-transparent t2 hover:[background:var(--btn-ghost-bg)] hover:t1"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1 text-left">{label}</span>
                  <span className="text-xs t3">{count}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="p-4" style={{ borderTop: "1px solid var(--divider)" }}>
          <div className="flex items-center justify-between text-xs t3">
            <span>{entriesCountLabel(lang, entries.length)}</span>
          </div>
        </div>
      </motion.div>

      <CategoryManager isOpen={managerOpen} onClose={() => setManagerOpen(false)} />
    </>
  );
}

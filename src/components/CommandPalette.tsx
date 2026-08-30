import { useState, useMemo, Fragment } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Settings, Dice5, LogOut, Key, X, CornerDownLeft, ArrowUp, ArrowDown } from "lucide-react";
import { useVaultStore } from "@/stores/vault";
import { useCategoryStore, getCategoryLabel } from "@/stores/categories";
import { useAppStore } from "@/stores/app";
import { useI18n } from "@/i18n";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenGenerator: () => void;
  onOpenSettings: () => void;
  onOpenQuickAdd: () => void;
  onSelectEntry: (id: string) => void;
}

interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  action: () => void;
  type: "entry" | "action";
}

export function CommandPalette({
  isOpen,
  onClose,
  onOpenGenerator,
  onOpenSettings,
  onOpenQuickAdd,
  onSelectEntry,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const entries = useVaultStore((s) => s.entries);
  const categories = useCategoryStore((s) => s.categories);
  const lock = useAppStore((s) => s.lock);
  const { t } = useI18n();

  const commands = useMemo(() => {
    const items: CommandItem[] = [];

    items.push(
      {
        id: "action-new",
        title: t("paletteNewEntry"),
        subtitle: t("paletteNewEntryDesc"),
        icon: Plus,
        action: () => {
          onClose();
          onOpenQuickAdd();
        },
        type: "action",
      },
      {
        id: "action-generator",
        title: t("paletteGenerator"),
        subtitle: t("paletteGeneratorDesc"),
        icon: Dice5,
        action: () => {
          onClose();
          onOpenGenerator();
        },
        type: "action",
      },
      {
        id: "action-settings",
        title: t("paletteSettings"),
        subtitle: t("paletteSettingsDesc"),
        icon: Settings,
        action: () => {
          onClose();
          onOpenSettings();
        },
        type: "action",
      },
      {
        id: "action-lock",
        title: t("paletteLock"),
        subtitle: t("paletteLockDesc"),
        icon: LogOut,
        action: () => {
          onClose();
          lock();
        },
        type: "action",
      }
    );

    entries.forEach((entry) => {
      const category = categories.find((c) => c.id === entry.category);
      items.push({
        id: `entry-${entry.id}`,
        title: entry.title,
        subtitle: `${entry.username} • ${category ? getCategoryLabel(category, t) : entry.category}`,
        icon: Key,
        action: () => {
          onClose();
          onSelectEntry(entry.id);
        },
        type: "entry",
      });
    });

    return items;
  }, [entries, onClose, onOpenGenerator, onOpenSettings, onOpenQuickAdd, lock, onSelectEntry, t]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.title.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q)
    );
  }, [commands, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selectedIndex]?.action();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="absolute top-24 left-1/2 -translate-x-1/2 w-full max-w-xl z-50 px-4"
      >
            <div className="panel rounded-2xl overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--divider)" }}
              >
                <Search className="w-5 h-5 t3" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t("palettePlaceholder")}
                  autoFocus
                  className="flex-1 bg-transparent t1 focus:outline-none text-sm"
                  style={{ caretColor: "var(--accent)" }}
                />
                {query && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setSelectedIndex(0);
                    }}
                    className="icon-btn !p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <span className="kbd">ESC</span>
              </div>

              <div className="max-h-[400px] overflow-y-auto py-2">
                {filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center t3">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>{t("paletteEmpty")}</p>
                    <p className="text-xs mt-1">{t("paletteEmptyHint")}</p>
                  </div>
                ) : (
                  <>
                    {filtered[0]?.type === "action" && (
                      <div className="px-3 py-1 section-title">{t("paletteActions")}</div>
                    )}
                    {filtered.map((item, index) => {
                      const Icon = item.icon;
                      const isSelected = index === selectedIndex;
                      const showDivider =
                        index > 0 &&
                        filtered[index - 1].type === "action" &&
                        item.type === "entry";

                      return (
                        <Fragment key={item.id}>
                          {showDivider && (
                            <div className="px-3 py-1 section-title mt-1">
                              {t("paletteEntries")}
                            </div>
                          )}
                          <button
                            onClick={item.action}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                            style={
                              isSelected
                                ? { background: "var(--accent-soft-bg)", color: "var(--t1)" }
                                : { color: "var(--t2)" }
                            }
                          >
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={
                                isSelected && item.type === "action"
                                  ? {
                                      background: "var(--accent-soft-bg)",
                                      color: "var(--accent-soft-text)",
                                      border: "1px solid var(--accent-soft-border)",
                                    }
                                  : {
                                      background: "var(--btn-ghost-bg)",
                                      border: "1px solid var(--btn-ghost-border)",
                                      color: "var(--t3)",
                                    }
                              }
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate t1">{item.title}</div>
                              <div className="text-xs t3 truncate">{item.subtitle}</div>
                            </div>
                            {isSelected && (
                              <motion.div
                                layoutId="command-selected"
                                className="w-1 h-6 rounded-full"
                                style={{ background: "var(--accent)" }}
                              />
                            )}
                          </button>
                        </Fragment>
                      );
                    })}
                  </>
                )}
              </div>

              <div
                className="px-4 py-2 flex items-center gap-4 text-xs t3"
                style={{ borderTop: "1px solid var(--divider)" }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="kbd">
                    <ArrowUp className="w-3 h-3" />
                  </span>
                  <span className="kbd">
                    <ArrowDown className="w-3 h-3" />
                  </span>
                  {t("paletteNavigate")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="kbd">
                    <CornerDownLeft className="w-3 h-3" />
                  </span>
                  {t("paletteSelect")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="kbd">ESC</span>
                  {t("paletteClose")}
                </span>
              </div>
            </div>
      </motion.div>
    </motion.div>
  );
}

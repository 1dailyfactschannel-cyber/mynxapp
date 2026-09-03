import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, X, Key } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useVaultStore, type Entry } from "@/stores/vault";
import { useI18n } from "@/i18n";

interface AutoTypePickerProps {
  /** Заголовок окна, под которое ищем запись */
  windowTitle: string;
  /** Предложенные совпадения (может быть пусто) */
  matches: Entry[];
  onClose: () => void;
}

export function AutoTypePicker({ windowTitle, matches, onClose }: AutoTypePickerProps) {
  const [query, setQuery] = useState("");
  const entries = useVaultStore((s) => s.entries);
  const { t } = useI18n();

  // Базовый список: совпадения, а если их нет — сразу все записи;
  // поиск всегда фильтрует полный список записей
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.username.toLowerCase().includes(q) ||
          e.url.toLowerCase().includes(q)
      );
    }
    return matches.length > 0 ? matches : entries;
  }, [query, matches, entries]);

  const handlePick = async (entry: Entry) => {
    // Скрываем окно, чтобы фокус вернулся в целевое приложение
    await getCurrentWindow().hide();
    try {
      await invoke("auto_type_credentials", {
        username: entry.username,
        password: entry.password,
      });
    } catch (e) {
      console.error("Auto-type failed:", e);
    }
    onClose();
  };

  // Escape — закрыть (Enter обрабатывается в инпуте)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50">
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="absolute top-24 left-1/2 -translate-x-1/2 w-full max-w-xl z-50 px-4"
      >
        <div className="panel rounded-2xl overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--divider)" }}
          >
            <div className="min-w-0">
              <h2 className="text-sm font-semibold t1">{t("autoTypePickTitle")}</h2>
              <p className="text-xs t3 truncate">{windowTitle}</p>
            </div>
            <button onClick={onClose} className="icon-btn">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--divider)" }}
          >
            <Search className="w-5 h-5 t3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = list[0];
                  if (first) void handlePick(first);
                }
              }}
              placeholder={t("autoTypeSearchPlaceholder")}
              autoFocus
              className="flex-1 bg-transparent t1 focus:outline-none text-sm"
              style={{ caretColor: "var(--accent)" }}
            />
            <span className="kbd">ESC</span>
          </div>

          <div className="max-h-[400px] overflow-y-auto py-2">
            {matches.length === 0 && !query && (
              <div className="px-4 py-2 text-xs t3">{t("autoTypeNoMatches")}</div>
            )}
            {list.length === 0 ? (
              <div className="px-4 py-8 text-center t3">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>{t("noEntriesFound")}</p>
              </div>
            ) : (
              list.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => void handlePick(entry)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--btn-ghost-bg)]"
                  style={{ color: "var(--t2)" }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "var(--btn-ghost-bg)",
                      border: "1px solid var(--btn-ghost-border)",
                      color: "var(--t3)",
                    }}
                  >
                    <Key className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate t1">{entry.title}</div>
                    <div className="text-xs t3 truncate">
                      {entry.username}
                      {entry.url ? ` • ${entry.url}` : ""}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Shield, Dice5, Settings as SettingsIcon, Command, HeartPulse, Clock, GraduationCap, RotateCcw, Trash2 } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import type { ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { Sidebar } from "@/components/Sidebar";
import { EntryCard } from "@/components/EntryCard";
import { EntryDetail } from "@/components/EntryDetail";
import { PasswordGenerator } from "@/components/PasswordGenerator";
import { Settings } from "@/components/Settings";
import { QuickAdd } from "@/components/QuickAdd";
import { CommandPalette } from "@/components/CommandPalette";
import { HealthDashboard } from "@/components/HealthDashboard";
import { Tutorial } from "@/components/Tutorial";
import { AttachmentsView } from "@/components/AttachmentsView";
import { AutoTypePicker } from "@/components/AutoTypePicker";
import { matchEntries } from "@/lib/autotype";
import { useAppStore, isTauri } from "@/stores/app";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useVaultStore, type Entry } from "@/stores/vault";
import { useSettingsStore } from "@/stores/settings";
import { useClipboardStore } from "@/stores/clipboard";
import { useI18n } from "@/i18n";

export function VaultScreen() {
  const lock = useAppStore((s) => s.lock);
  const entries = useVaultStore((s) => s.entries);
  const searchQuery = useVaultStore((s) => s.searchQuery);
  const selectedCategory = useVaultStore((s) => s.selectedCategory);
  const selectedEntryId = useVaultStore((s) => s.selectedEntry);
  const setSearchQuery = useVaultStore((s) => s.setSearchQuery);
  const setSelectedCategory = useVaultStore((s) => s.setSelectedCategory);
  const setSelectedEntry = useVaultStore((s) => s.setSelectedEntry);
  const deleteEntry = useVaultStore((s) => s.deleteEntry);
  const toggleFavorite = useVaultStore((s) => s.toggleFavorite);

  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const clipboardSeconds = useSettingsStore((s) => s.clipboardClearSeconds);
  const clipboardEnabled = useSettingsStore((s) => s.clipboardClearEnabled);
  const clipTimeLeft = useClipboardStore((s) => s.timeLeft);
  const clipActive = useClipboardStore((s) => s.isActive);
  const clipboardCopy = useClipboardStore((s) => s.copy);

  const [detailOpen, setDetailOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [autoTypePick, setAutoTypePick] = useState<{ windowTitle: string; matches: Entry[] } | null>(null);

  const { t } = useI18n();

  const { formattedTime, isIdle } = useAutoLock({
    timeoutMinutes: autoLockMinutes,
    onLock: lock,
    isEnabled: true,
  });

  const hotkeyQuickAdd = useSettingsStore((s) => s.hotkeyQuickAdd);
  const hotkeyAutoType = useSettingsStore((s) => s.hotkeyAutoType);
  const hotkeyGenerator = useSettingsStore((s) => s.hotkeyGenerator);
  const hotkeyLock = useSettingsStore((s) => s.hotkeyLock);
  const hotkeySecurePaste = useSettingsStore((s) => s.hotkeySecurePaste);
  const hotkeysEpoch = useSettingsStore((s) => s.hotkeysEpoch);

  // Глобальные шорткаты — только внутри Tauri; перерегистрация при смене
  // сочетаний в настройках (hotkeysEpoch форсирует откат после конфликта)
  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;
    const shortcuts: string[] = [];

    const registerShortcuts = async () => {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");

      // Каждое сочетание — независимо: конфликт одного не роняет второе
      const tryRegister = async (accelerator: string, handler: (event: ShortcutEvent) => void) => {
        try {
          await register(accelerator, handler);
          shortcuts.push(accelerator);
        } catch (e) {
          console.error(`Failed to register global shortcut ${accelerator}:`, e);
        }
      };

      await tryRegister(hotkeyQuickAdd, (event) => {
        if (event.state !== "Pressed") return;
        // Сначала показать окно (может быть свёрнуто в трей), потом Quick Add
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          void win
            .show()
            .then(() => win.unminimize())
            .then(() => win.setFocus())
            .catch(() => {});
        });
        setQuickAddOpen((prev) => !prev);
      });

      await tryRegister(hotkeyAutoType, (event) => {
        if (event.state !== "Pressed") return;

        // Старое поведение: печать выбранной в списке записи
        const typeSelected = () => {
          const currentEntry = useVaultStore.getState().selectedEntry;
          if (!currentEntry) {
            console.warn("Auto-type: no entry selected");
            return;
          }
          const entry = useVaultStore.getState().entries.find((e) => e.id === currentEntry);
          if (entry) {
            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("auto_type_credentials", {
                username: entry.username,
                password: entry.password,
              }).catch(console.error);
            });
          } else {
            console.warn("Auto-type: selected entry not found");
          }
        };

        void (async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();

          // Хранилище закрыто — просто показываем окно для разблокировки
          if (!useAppStore.getState().isUnlocked) {
            void win.show().then(() => win.unminimize()).then(() => win.setFocus()).catch(() => {});
            return;
          }

          const fg = await invoke<{ title: string; is_self: boolean }>("get_foreground_window");

          // Фокус на самом Mynx или заголовок не получен — печатаем выбранную запись
          if (fg.is_self || !fg.title) {
            typeSelected();
            return;
          }

          const matches = matchEntries(useVaultStore.getState().entries, fg.title);
          if (matches.length === 1) {
            // Единственное совпадение — скрываем окно и печатаем сразу
            const entry = matches[0];
            await win.hide();
            invoke("auto_type_credentials", {
              username: entry.username,
              password: entry.password,
            }).catch(console.error);
          } else {
            // 0 или несколько совпадений — показываем окно с пикером
            void win.show().then(() => win.unminimize()).then(() => win.setFocus()).catch(() => {});
            setAutoTypePick({ windowTitle: fg.title, matches });
          }
        })().catch((e) => console.error("Auto-type failed:", e));
      });

      await tryRegister(hotkeyGenerator, (event) => {
        if (event.state !== "Pressed") return;
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          void win
            .show()
            .then(() => win.unminimize())
            .then(() => win.setFocus())
            .catch(() => {});
        });
        setGeneratorOpen(true);
      });

      await tryRegister(hotkeyLock, (event) => {
        if (event.state !== "Pressed") return;
        lock();
      });

      // Вставка из защищённого буфера (слепое копирование)
      await tryRegister(hotkeySecurePaste, (event) => {
        if (event.state !== "Pressed") return;
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("secure_paste").catch((e) => {
            if (!String(e).includes("secure_buffer_empty")) console.error(e);
          });
        });
      });

      if (cancelled) {
        for (const s of shortcuts) await unregister(s).catch(() => {});
      }
    };

    registerShortcuts().catch((e) => console.error("Failed to register global shortcuts:", e));

    return () => {
      cancelled = true;
      import("@tauri-apps/plugin-global-shortcut")
        .then(({ unregister }) => shortcuts.forEach((s) => unregister(s).catch(() => {})))
        .catch(() => {});
    };
  }, [hotkeyQuickAdd, hotkeyAutoType, hotkeyGenerator, hotkeyLock, hotkeySecurePaste, hotkeysEpoch, lock]);

  // Ctrl+K — локальный во всех режимах (глобальный перехват крадёт
  // сочетание у других приложений). Ctrl+Shift+A локально — только
  // в браузерном предпросмотре; в Tauri он глобальный.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (!isTauri && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setQuickAddOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) || null,
    [entries, selectedEntryId]
  );

  const handleSelectEntry = (id: string) => {
    setSelectedEntry(id);
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedEntry(null);
  };

  const handleCopyPassword = (password: string) => {
    clipboardCopy(password, clipboardSeconds, clipboardEnabled);
  };

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (selectedCategory === "Trash") {
      result = result.filter((e) => e.deletedAt);
    } else {
      result = result.filter((e) => !e.deletedAt);

      if (selectedCategory !== "All") {
        if (selectedCategory === "Favorites") {
          result = result.filter((e) => e.favorite);
        } else {
          result = result.filter((e) => e.category === selectedCategory);
        }
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) => {
        const inBasic =
          e.title.toLowerCase().includes(q) ||
          e.username.toLowerCase().includes(q) ||
          e.url.toLowerCase().includes(q) ||
          e.tags.some((tag) => tag.toLowerCase().includes(q));

        const inNotes = e.notes?.toLowerCase().includes(q) ?? false;
        const inCustom = (e.customFields ?? []).some(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            f.value.toLowerCase().includes(q)
        );

        return inBasic || inNotes || inCustom;
      });
    }

    return result;
  }, [entries, selectedCategory, searchQuery]);

  return (
    <div className="h-full flex overflow-hidden">
      <Sidebar
        selectedCategory={selectedCategory}
        onSelectCategory={(id) => {
          if (id === "Attachments") {
            setAttachmentsOpen(true);
          } else {
            setSelectedCategory(id);
          }
        }}
        onSearch={setSearchQuery}
        searchQuery={searchQuery}
        entries={entries}
        onNewEntry={() => setQuickAddOpen(true)}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header
          className="h-16 flex items-center justify-between px-6"
          style={{
            borderBottom: "1px solid var(--divider)",
            background: "var(--chrome-header-bg)",
            backdropFilter: "var(--glass-blur)",
            WebkitBackdropFilter: "var(--glass-blur)",
          }}
        >
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold t1">
              {selectedCategory === "All" ? t("allEntries") : t(`cat.${selectedCategory}`)}
            </h2>
            <span className="chip">{filteredEntries.length}</span>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setCommandPaletteOpen(true)}
              className="btn-ghost px-3 py-1.5 text-sm"
            >
              <Command className="w-4 h-4" />
              <span className="kbd">Ctrl+K</span>
            </motion.button>

            {clipActive && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="soft-info flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border"
                title={t("clipboardClearIn", clipTimeLeft)}
              >
                <Clock className="w-4 h-4" />
                {clipTimeLeft}s
              </motion.div>
            )}

            {isIdle && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="soft-warn px-3 py-1.5 rounded-lg text-sm border"
              >
                {t("lockIn", formattedTime)}
              </motion.div>
            )}

            <button
              onClick={() => setTutorialOpen(true)}
              className="icon-btn"
              type="button"
              title={t("tutOpen")}
            >
              <GraduationCap className="w-4 h-4" />
            </button>

            <button
              onClick={() => setHealthOpen(true)}
              className="icon-btn"
              type="button"
              title={t("healthOpen")}
            >
              <HeartPulse className="w-4 h-4" />
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              className="icon-btn"
              type="button"
              title={t("settings")}
            >
              <SettingsIcon className="w-4 h-4" />
            </button>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setGeneratorOpen(true)}
              className="btn-ghost px-3 py-1.5 text-sm"
            >
              <Dice5 className="w-4 h-4" />
              {t("generator")}
            </motion.button>

            <div className="soft-accent flex items-center gap-2 px-3 py-1.5 rounded-lg border">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: "var(--accent)" }}
              />
              <span className="text-xs">{t("unlocked")}</span>
            </div>

            <button
              onClick={lock}
              className="icon-btn danger"
              title={t("lockVaultTitle")}
            >
              <Lock className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="popLayout">
            {filteredEntries.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-64 t3"
              >
                <Shield className="w-12 h-12 mb-4 opacity-30" />
                <p>{t("noEntriesFound")}</p>
                <p className="text-sm mt-1">{t("tryDifferent")}</p>
              </motion.div>
            ) : (
              <div className="grid gap-3 max-w-2xl">
                {filteredEntries.map((entry) =>
                  selectedCategory === "Trash" ? (
                    <TrashEntryCard
                      key={entry.id}
                      entry={entry}
                      onRestore={() => useVaultStore.getState().restoreEntry(entry.id)}
                      onDeleteForever={() =>
                        useVaultStore.setState((state) => ({
                          entries: state.entries.filter((e) => e.id !== entry.id),
                          selectedEntry:
                            state.selectedEntry === entry.id ? null : state.selectedEntry,
                        }))
                      }
                    />
                  ) : (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      onSelect={handleSelectEntry}
                      onCopyPassword={handleCopyPassword}
                      onToggleFavorite={toggleFavorite}
                    />
                  )
                )}
              </div>
            )}
          </AnimatePresence>
        </div>

        <EntryDetail
          entry={selectedEntry}
          isOpen={detailOpen}
          onClose={handleCloseDetail}
          onDelete={deleteEntry}
          onToggleFavorite={toggleFavorite}
          onCopy={handleCopyPassword}
        />

        <PasswordGenerator isOpen={generatorOpen} onClose={() => setGeneratorOpen(false)} />

        <Settings
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />

        <QuickAdd isOpen={quickAddOpen} onClose={() => setQuickAddOpen(false)} />

        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          onOpenGenerator={() => setGeneratorOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenQuickAdd={() => setQuickAddOpen(true)}
          onSelectEntry={handleSelectEntry}
        />

        <HealthDashboard
          isOpen={healthOpen}
          onClose={() => setHealthOpen(false)}
          onSelectEntry={handleSelectEntry}
        />

        <Tutorial isOpen={tutorialOpen} onClose={() => setTutorialOpen(false)} />

        <AttachmentsView isOpen={attachmentsOpen} onClose={() => setAttachmentsOpen(false)} />

        {autoTypePick && (
          <AutoTypePicker
            windowTitle={autoTypePick.windowTitle}
            matches={autoTypePick.matches}
            onClose={() => setAutoTypePick(null)}
          />
        )}
      </div>
    </div>
  );
}

interface TrashEntryCardProps {
  entry: Entry;
  onRestore: () => void;
  onDeleteForever: () => void;
}

function TrashEntryCard({ entry, onRestore, onDeleteForever }: TrashEntryCardProps) {
  const { t } = useI18n();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <GlassCard className="p-4">
        <div className="flex items-center gap-4">
          <div className="icon-tile w-10 h-10 rounded-xl flex items-center justify-center text-lg">
            {entry.icon || "🔐"}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-medium t1 text-sm truncate">{entry.title}</h3>
            <p className="t3 text-xs truncate">{entry.username}</p>
            {entry.deletedAt && (
              <p className="text-xs t3 mt-1">
                {t("deletedAt")}: {new Date(entry.deletedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={onRestore} className="btn-ghost px-3 py-1.5 text-sm" title={t("trashRestore")}>
              <RotateCcw className="w-4 h-4" />
              {t("trashRestore")}
            </button>
            <button
              onClick={onDeleteForever}
              className="btn-ghost px-3 py-1.5 text-sm"
              style={{ color: "var(--danger)" }}
              title={t("trashDeleteForever")}
            >
              <Trash2 className="w-4 h-4" />
              {t("trashDeleteForever")}
            </button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Dice5, Settings as SettingsIcon, Command, HeartPulse, Clock, GraduationCap, RotateCcw, Trash2 } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
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
import { PasskeysView } from "@/components/PasskeysView";
import { EmptyState } from "@/components/EmptyState";
import { AutoTypePicker } from "@/components/AutoTypePicker";
import { useAppStore, isTauri } from "@/stores/app";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useModalStack } from "@/hooks/useModalStack";
import { useVaultStore, type Entry } from "@/stores/vault";
import { useSettingsStore } from "@/stores/settings";
import { useClipboardStore } from "@/stores/clipboard";
import { useI18n } from "@/i18n";

type ModalKey =
  | "generator"
  | "settings"
  | "quickAdd"
  | "commandPalette"
  | "health"
  | "tutorial"
  | "attachments"
  | "passkeys";

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
  const density = useSettingsStore((s) => s.density);
  const clipTimeLeft = useClipboardStore((s) => s.timeLeft);
  const clipActive = useClipboardStore((s) => s.isActive);
  const clipboardCopy = useClipboardStore((s) => s.copy);

  /** Панель деталей — отдельный флаг, потому что связан с selectedEntry. */
  const [detailOpen, setDetailOpen] = useState(false);

  /** Стек модалок: один активный элемент, конфликты видимости невозможны. */
  const modal = useModalStack<ModalKey>();

  /** AutoTypePicker с payload (несколько совпадений). */
  const [autoTypePick, setAutoTypePick] = useState<{
    windowTitle: string;
    matches: Entry[];
  } | null>(null);

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

  // Глобальные шорткаты — регистрация/снятие инкапсулированы в useGlobalShortcuts.
  // Прокидываем коллбэки на конкретные действия VaultScreen (открыть модалку и т.д.).
  useGlobalShortcuts({
    hotkeyQuickAdd,
    hotkeyAutoType,
    hotkeyGenerator,
    hotkeyLock,
    hotkeySecurePaste,
    toggleQuickAdd: () => modal.toggle("quickAdd"),
    openGenerator: () => modal.open("generator"),
    lock,
  });

  // hotkeysEpoch: форсирует перерегистрацию хоткеев (см. Settings — при конфликте)
  useEffect(() => {
    /* no-op: deps в useGlobalShortcuts включают epoch, ре-эффект пройдёт сам */
  }, [hotkeysEpoch]);

  // Ctrl+K — локальный во всех режимах (глобальный перехват крадёт
  // сочетание у других приложений). Ctrl+Shift+A локально — только
  // в браузерном предпросмотре; в Tauri он глобальный.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        modal.toggle("commandPalette");
      }
      if (!isTauri && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        modal.toggle("quickAdd");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal]);

  // Событие от useGlobalShortcuts: при нескольких совпадениях AutoType
  // нужно показать picker.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        windowTitle: string;
        matches: Entry[];
      };
      setAutoTypePick(detail);
    };
    window.addEventListener("mynx:auto-type-pick", handler);
    return () => window.removeEventListener("mynx:auto-type-pick", handler);
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

  /* Клавиатурная навигация по списку записей: стрелки, Home/End, Enter/Space.
     Карточки несут data-entry-id и tabIndex=0; фокус перемещается контейнером. */
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.currentTarget.querySelector("[data-entry-id]")) return;
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-entry-id]")
    );
    if (items.length === 0) return;
    const activeIdx = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = activeIdx < 0 ? 0 : Math.min(items.length - 1, activeIdx + 1);
    else if (e.key === "ArrowUp") next = activeIdx < 0 ? items.length - 1 : Math.max(0, activeIdx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if ((e.key === "Enter" || e.key === " ") && activeIdx >= 0) {
      // Enter обрабатывает сама карточка; Space — здесь, чтобы не скроллить
      if (e.key === " ") {
        e.preventDefault();
        (items[activeIdx] as HTMLElement).click();
      }
      return;
    } else return;

    e.preventDefault();
    if (next >= 0) items[next]?.focus();
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
            modal.open("attachments");
          } else if (id === "Passkeys") {
            modal.open("passkeys");
          } else {
            setSelectedCategory(id);
          }
        }}
        onSearch={setSearchQuery}
        searchQuery={searchQuery}
        entries={entries}
        onNewEntry={() => modal.open("quickAdd")}
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
              onClick={() => modal.open("commandPalette")}
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
              onClick={() => modal.open("tutorial")}
              className="icon-btn"
              type="button"
              title={t("tutOpen")}
            >
              <GraduationCap className="w-4 h-4" />
            </button>

            <button
              onClick={() => modal.open("health")}
              className="icon-btn"
              type="button"
              title={t("healthOpen")}
            >
              <HeartPulse className="w-4 h-4" />
            </button>

            <button
              onClick={() => modal.open("settings")}
              className="icon-btn"
              type="button"
              title={t("settings")}
            >
              <SettingsIcon className="w-4 h-4" />
            </button>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => modal.open("generator")}
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
              <EmptyState
                variant={
                  selectedCategory === "Trash"
                    ? "trash"
                    : searchQuery
                    ? "search"
                    : "category"
                }
                title={
                  selectedCategory === "Trash"
                    ? t("trashEmptyTitle")
                    : searchQuery
                    ? t("noEntriesFound")
                    : t("categoryEmptyTitle")
                }
                hint={searchQuery ? t("tryDifferent") : t("emptyCategoryHint")}
                action={
                  !searchQuery && selectedCategory !== "Trash" ? (
                    <button onClick={() => modal.open("quickAdd")} className="btn-primary px-4 py-2 text-sm">
                      {t("newEntry")}
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div
                className={`entry-list density-${density} grid gap-3 max-w-2xl`}
                onKeyDown={handleListKeyDown}
                role="list"
              >
                {filteredEntries.map((entry, idx) =>
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
                      appearDelay={Math.min(idx * 0.03, 0.3)}
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

        <PasswordGenerator isOpen={modal.isOpen("generator")} onClose={modal.close} />
        <Settings isOpen={modal.isOpen("settings")} onClose={modal.close} />
        <QuickAdd isOpen={modal.isOpen("quickAdd")} onClose={modal.close} />

        <CommandPalette
          isOpen={modal.isOpen("commandPalette")}
          onClose={modal.close}
          onOpenGenerator={() => modal.open("generator")}
          onOpenSettings={() => modal.open("settings")}
          onOpenQuickAdd={() => modal.open("quickAdd")}
          onSelectEntry={handleSelectEntry}
        />

        <HealthDashboard
          isOpen={modal.isOpen("health")}
          onClose={modal.close}
          onSelectEntry={handleSelectEntry}
        />

        <Tutorial isOpen={modal.isOpen("tutorial")} onClose={modal.close} />
        <AttachmentsView isOpen={modal.isOpen("attachments")} onClose={modal.close} />
        <PasskeysView isOpen={modal.isOpen("passkeys")} onClose={modal.close} />

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

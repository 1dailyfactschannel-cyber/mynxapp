import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, Folder, GitMerge } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  parseImport,
  wipeImportResult,
  type ImportFormat,
  type ImportResult,
} from "@/lib/import";
import {
  findDuplicate,
  mergeDraftIntoEntry,
  type DuplicateMatch,
  type MergeStrategy,
} from "@/lib/dedupe";
import { useVaultStore, calculateStrength } from "@/stores/vault";
import { useCategoryStore } from "@/stores/categories";
import { ActionModal } from "../ui/ActionModal";
import { FieldLabel } from "../ui/FieldLabel";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const IMPORT_FORMATS: { id: ImportFormat; labelKey: string }[] = [
  { id: "auto", labelKey: "importFormatAuto" },
  { id: "bitwarden-json", labelKey: "importFmtBitwardenJson" },
  { id: "bitwarden-csv", labelKey: "importFmtBitwardenCsv" },
  { id: "onepassword-json", labelKey: "importFmt1PasswordJson" },
  { id: "onepassword-csv", labelKey: "importFmt1Password" },
  { id: "keepass-csv", labelKey: "importFmtKeePass" },
  { id: "keepassxc-json", labelKey: "importFmtKeePassXcJson" },
  { id: "lastpass-csv", labelKey: "importFmtLastPass" },
  { id: "dashlane-csv", labelKey: "importFmtDashlane" },
  { id: "protonpass-csv", labelKey: "importFmtProtonPass" },
  { id: "firefox-csv", labelKey: "importFmtFirefox" },
  { id: "chrome-csv", labelKey: "importFmtChrome" },
];

/**
 * Импорт паролей из сторонних менеджеров.
 * Парсинг идёт локально (`src/lib/import.ts`), секреты живут только
 * в `parsedRef` и затираются через `wipeImportResult` после импорта/закрытия.
 */
export function ImportModal({ isOpen, onClose }: ImportModalProps) {
  const { t } = useI18n();
  const addEntry = useVaultStore((s) => s.addEntry);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Зеркало parsed в ref, чтобы сброс при закрытии не тащил parsed в deps эффекта
  const parsedRef = useRef<ImportResult | null>(null);

  const [format, setFormat] = useState<ImportFormat>("auto");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Что делать с дублями: пропустить / слить / создать копию */
  const [strategy, setStrategy] = useState<MergeStrategy>("merge");
  const [done, setDone] = useState<{
    imported: number;
    skipped: number;
    errors: number;
    merged: number;
    dupSkipped: number;
  } | null>(null);

  const wipeParsed = () => {
    if (parsedRef.current) {
      wipeImportResult(parsedRef.current);
      parsedRef.current = null;
    }
    setParsed(null);
  };

  // Сброс состояния и очистка секретов из памяти при закрытии
  useEffect(() => {
    if (isOpen) return;
    if (parsedRef.current) {
      wipeImportResult(parsedRef.current);
      parsedRef.current = null;
    }
    setFormat("auto");
    setFile(null);
    setParsed(null);
    setParseError(null);
    setBusy(false);
    setStrategy("merge");
    setDone(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [isOpen]);

  const close = () => {
    wipeParsed();
    onClose();
  };

  const parseFile = async (f: File, fmt: ImportFormat) => {
    setBusy(true);
    setParseError(null);
    setDone(null);
    wipeParsed();
    try {
      const text = await f.text();
      const result = parseImport(fmt, text);
      // Сырая строка text больше не нужна: секреты живут только в result
      // и затираются wipeImportResult после импорта/закрытия
      parsedRef.current = result;
      setParsed(result);
    } catch (e) {
      setParseError(`${t("importFailed")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Предпросмотр дублей: считаем на каждый разобранный файл
  const duplicates = useMemo(() => {
    if (!parsed) return [] as (DuplicateMatch | null)[];
    const existing = useVaultStore.getState().entries;
    return parsed.drafts.map((d) => findDuplicate(existing, d));
  }, [parsed]);
  const dupCount = duplicates.filter(Boolean).length;

  const runImport = () => {
    if (!parsed || busy) return;
    setBusy(true);
    let imported = 0;
    let errors = 0;
    let merged = 0;
    let dupSkipped = 0;
    try {
      // Папки исходного файла → категории vault
      const catStore = useCategoryStore.getState();
      const folderToCategory = new Map<string, string>();
      for (const folder of parsed.folders) {
        const existing = catStore.categories.find(
          (c) => c.id === folder || c.label.toLowerCase() === folder.toLowerCase()
        );
        if (existing) {
          folderToCategory.set(folder, existing.id);
        } else {
          const created = catStore.addCategory(folder);
          folderToCategory.set(folder, created ? created.id : folder);
        }
      }

      const resolveCategory = (draftCat: string) =>
        draftCat ? (folderToCategory.get(draftCat) ?? draftCat) : "";

      parsed.drafts.forEach((draft, i) => {
        try {
          const dup = duplicates[i];
          if (dup) {
            if (strategy === "skip") {
              dupSkipped++;
              return;
            }
            if (strategy === "merge") {
              const patch = mergeDraftIntoEntry(dup.entry, draft);
              const cat = resolveCategory(draft.category);
              if (cat && !dup.entry.category) patch.category = cat;
              if (Object.keys(patch).length > 0) {
                useVaultStore.getState().updateEntry(dup.entry.id, patch);
              }
              merged++;
              return;
            }
            // strategy === "duplicate" — падаем ниже и создаём копию
          }
          addEntry({
            id: crypto.randomUUID(),
            title: draft.title,
            username: draft.username,
            password: draft.password,
            url: draft.url,
            category: resolveCategory(draft.category),
            tags: [],
            favorite: draft.favorite,
            strength: calculateStrength(draft.password),
            icon: draft.title.charAt(0).toUpperCase() || "🔑",
            notes: draft.notes,
            totpSecret: draft.totpSecret,
            customFields: draft.customFields,
          });
          imported++;
        } catch {
          errors++;
        }
      });
      setDone({ imported, skipped: parsed.skipped, errors, merged, dupSkipped });
    } finally {
      wipeParsed();
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("importModalTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Download className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {done ? (
        <>
          <div className="flex items-start gap-2 text-sm" style={{ color: "var(--accent)" }}>
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t("importDone", done.imported, done.skipped, done.errors)}</span>
          </div>
          {(done.merged > 0 || done.dupSkipped > 0) && (
            <div className="flex items-start gap-2 text-sm t2">
              <GitMerge className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--info)" }} />
              <span>{t("importDedup", done.merged, done.dupSkipped)}</span>
            </div>
          )}
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("importModalDesc")}</p>
          <div>
            <FieldLabel>{t("importFormatLabel")}</FieldLabel>
            <select
              value={format}
              onChange={(e) => {
                const fmt = e.target.value as ImportFormat;
                setFormat(fmt);
                if (file) void parseFile(file, fmt);
              }}
              className="field rounded-xl px-3.5 py-2.5 text-sm w-full"
            >
              {IMPORT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  void parseFile(f, format);
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-ghost w-full justify-start p-3 text-sm"
            >
              <Folder className="w-4 h-4 t3" />
              <span className="flex-1 text-left truncate">
                {file ? file.name : t("importChooseFile")}
              </span>
            </button>
          </div>
          {parseError && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {parseError}
            </p>
          )}
          {parsed &&
            !parseError &&
            (parsed.drafts.length > 0 ? (
              <div className="text-sm t2 space-y-1">
                <p>{t("importPreview", parsed.drafts.length, parsed.folders.length)}</p>
                {parsed.skipped > 0 && (
                  <p className="text-xs t3">{t("importPreviewSkipped", parsed.skipped)}</p>
                )}
                {dupCount > 0 && (
                  <div className="pt-2 space-y-2">
                    <p className="flex items-center gap-2 text-xs" style={{ color: "var(--warn)" }}>
                      <GitMerge className="w-3.5 h-3.5" />
                      {t("importDuplicatesFound", dupCount)}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["merge", t("importStrategyMerge")],
                          ["skip", t("importStrategySkip")],
                          ["duplicate", t("importStrategyDuplicate")],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setStrategy(id)}
                          className={`segment ${strategy === id ? "active" : ""} !text-xs`}
                          title={
                            id === "merge"
                              ? t("importStrategyMergeHint")
                              : id === "skip"
                              ? t("importStrategySkipHint")
                              : t("importStrategyDuplicateHint")
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--warn)" }}>
                {t("importNoEntries")}
              </p>
            ))}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={runImport}
              disabled={!parsed || parsed.drafts.length === 0 || busy}
              className="btn-primary flex-1 py-2.5 text-sm"
            >
              {busy ? t("working") : t("importSubmit")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
import {
  X,
  Copy,
  Eye,
  EyeOff,
  Edit,
  Trash2,
  Star,
  ExternalLink,
  Save,
  Tag,
  Folder,
  Calendar,
  Shield,
  Keyboard,
  Plus,
  History,
} from "lucide-react";
import { motion } from "framer-motion";
import { TOTPGenerator } from "@/components/TOTPGenerator";
import { GlassCard } from "@/components/GlassCard";
import { useI18n } from "@/i18n";
import { isTauri } from "@/stores/app";
import { useVaultStore, generateRandomPassword, calculateStrength, type Entry, type CustomField } from "@/stores/vault";
import { useCategoryStore, getCategoryLabel } from "@/stores/categories";
import { useSettingsStore } from "@/stores/settings";

interface EntryDetailProps {
  entry: Entry | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCopy: (text: string) => void;
}

export function EntryDetail({ entry, isOpen, onClose, onDelete, onToggleFavorite, onCopy }: EntryDetailProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showUsername, setShowUsername] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showFieldMenu, setShowFieldMenu] = useState(false);
  const [visibleCustomFields, setVisibleCustomFields] = useState<Set<string>>(new Set());

  // Локальный черновик для редактирования
  const [draft, setDraft] = useState<Entry | null>(null);

  const updateEntry = useVaultStore((s) => s.updateEntry);
  const categories = useCategoryStore((s) => s.categories);
  const { t, lang } = useI18n();

  // При открытии другой записи — сбрасываем режим редактирования
  useEffect(() => {
    setIsEditing(false);
    setDraft(null);
    setShowPassword(false);
    setShowUsername(false);
    setAddingTag(false);
    setNewTag("");
    setHistoryOpen(false);
    setShowFieldMenu(false);
    setVisibleCustomFields(new Set());
  }, [entry?.id, isOpen]);

  // Авто-скрытие паролей по таймеру из настроек
  const passwordHideSeconds = useSettingsStore((s) => s.passwordHideSeconds);
  useEffect(() => {
    if (!isOpen) return;

    const hideAll = () => {
      setShowPassword(false);
      setShowUsername(false);
      setVisibleCustomFields(new Set());
    };

    const timer = setTimeout(hideAll, passwordHideSeconds * 1000);

    // При любой активности внутри панели сбрасываем таймер
    const panel = document.querySelector('[data-entry-panel="true"]');
    const reset = () => {
      clearTimeout(timer);
      setTimeout(hideAll, passwordHideSeconds * 1000);
    };

    const events: (keyof HTMLElementEventMap)[] = ["mousemove", "keydown", "click"];
    events.forEach((ev) => panel?.addEventListener(ev, reset, { passive: true }));

    return () => {
      clearTimeout(timer);
      events.forEach((ev) => panel?.removeEventListener(ev, reset));
    };
  }, [isOpen, passwordHideSeconds]);

  if (!entry) return null;

  const startEdit = () => {
    setDraft({
      ...entry,
      tags: [...entry.tags],
      notes: entry.notes || "",
      customFields: entry.customFields || [],
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft(null);
  };

  const saveEdit = () => {
    if (!draft) return;
    updateEntry(entry.id, {
      title: draft.title,
      username: draft.username,
      password: draft.password,
      url: draft.url,
      category: draft.category,
      tags: draft.tags,
      totpSecret: draft.totpSecret,
      notes: draft.notes,
      customFields: draft.customFields,
      strength: calculateStrength(draft.password),
    });
    setIsEditing(false);
    setDraft(null);
  };

  const shown = isEditing && draft ? draft : entry;

  const handleCopy = (text: string, field: string) => {
    onCopy(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleAutoType = async () => {
    if (!isTauri) return;
    try {
      await invoke("auto_type_credentials", {
        username: entry.username,
        password: entry.password,
      });
    } catch (e) {
      console.error("Auto-type failed:", e);
    }
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag || !draft) return;
    if (!draft.tags.includes(tag)) {
      setDraft({ ...draft, tags: [...draft.tags, tag] });
    }
    setNewTag("");
    setAddingTag(false);
  };

  const removeTag = (tag: string) => {
    if (!draft) return;
    setDraft({ ...draft, tags: draft.tags.filter((x) => x !== tag) });
  };

  const addCustomField = (type: CustomField["type"]) => {
    if (!draft) return;
    const field: CustomField = {
      id: crypto.randomUUID(),
      label: "",
      value: "",
      type,
    };
    setDraft({ ...draft, customFields: [...(draft.customFields || []), field] });
    setShowFieldMenu(false);
  };

  const updateCustomField = (id: string, patch: Partial<Omit<CustomField, "id">>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      customFields: (draft.customFields || []).map((f) =>
        f.id === id ? { ...f, ...patch } : f
      ),
    });
  };

  const removeCustomField = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      customFields: (draft.customFields || []).filter((f) => f.id !== id),
    });
  };

  const toggleCustomFieldVisibility = (id: string) => {
    setVisibleCustomFields((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const strength = shown.strength;
  const strengthTextClass =
    strength >= 80 ? "c-strong" : strength >= 50 ? "c-good" : strength >= 30 ? "c-fair" : "c-weak";
  const strengthBgClass =
    strength >= 80 ? "bg-strong" : strength >= 50 ? "bg-good" : strength >= 30 ? "bg-fair" : "bg-weak";
  const strengthLabel =
    strength >= 80
      ? t("strengthStrong")
      : strength >= 50
      ? t("strengthGood")
      : strength >= 30
      ? t("strengthFair")
      : t("strengthWeak");

  const fmtDate = (ts?: number) =>
    ts
      ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(new Date(ts))
      : "—";

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="absolute right-0 top-10 bottom-0 w-[480px] panel z-50 overflow-y-auto"
        style={{ borderLeft: "1px solid var(--panel-border)", borderRadius: 0 }}
        data-entry-panel="true"
      >
        <div
          className="sticky top-0 z-10 p-4 flex items-center justify-between"
          style={{
            background: "var(--panel-bg)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderBottom: "1px solid var(--divider)",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="icon-tile w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
              {entry.icon || "🔐"}
            </div>
            <div className="min-w-0">
              {isEditing && draft ? (
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="field rounded-lg px-2 py-1 text-sm font-semibold"
                />
              ) : (
                <h2 className="font-semibold t1 truncate">{entry.title}</h2>
              )}
              <p className="text-xs t3">
                {categories.find((c) => c.id === shown.category)
                  ? getCategoryLabel(categories.find((c) => c.id === shown.category)!, t)
                  : shown.category}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onToggleFavorite(entry.id)}
              className="icon-btn"
              title={t("favoriteToggle")}
            >
              <Star
                className="w-4 h-4"
                style={
                  entry.favorite ? { color: "var(--warn)", fill: "var(--warn)" } : undefined
                }
              />
            </button>
            <button
              onClick={() => (isEditing ? cancelEdit() : startEdit())}
              className="icon-btn"
              title={t("editEntry")}
            >
              {isEditing ? <X className="w-4 h-4" /> : <Edit className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                onDelete(entry.id);
                onClose();
              }}
              className="icon-btn danger"
              title={t("deleteEntry")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="icon-btn" title={t("close")}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <GlassCard className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className={`w-5 h-5 ${strengthTextClass}`} />
                <span className={`font-medium ${strengthTextClass}`}>{strengthLabel}</span>
              </div>
              <span className={`text-2xl font-bold ${strengthTextClass}`}>{strength}</span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: "var(--kbd-bg)" }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${strength}%` }}
                transition={{ duration: 0.5 }}
                className={`h-full rounded-full ${strengthBgClass}`}
              />
            </div>
          </GlassCard>

          {/* Username */}
          <div className="space-y-2">
            <label className="section-title">{t("usernameLabel")}</label>
            <div className="flex items-center gap-2">
              <input
                type={showUsername ? "text" : "password"}
                value={shown.username}
                readOnly={!isEditing}
                onChange={
                  isEditing && draft
                    ? (e) => setDraft({ ...draft, username: e.target.value })
                    : undefined
                }
                className="field flex-1 rounded-xl px-4 py-3 text-sm font-mono"
              />
              <button onClick={() => setShowUsername(!showUsername)} className="icon-btn">
                {showUsername ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={() => handleCopy(entry.username, "username")}
                className="icon-btn relative"
              >
                <Copy className="w-4 h-4" />
                {copiedField === "username" && <CopiedBadge text={t("copied")} />}
              </button>
            </div>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="section-title">{t("passwordLabel")}</label>
              {isEditing && draft && (
                <button
                  className="text-xs transition-colors"
                  style={{ color: "var(--accent-soft-text)" }}
                  onClick={() => {
                    const pwd = generateRandomPassword(16);
                    setDraft({ ...draft, password: pwd, strength: calculateStrength(pwd) });
                  }}
                >
                  {t("generateNew")}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type={showPassword ? "text" : "password"}
                value={shown.password}
                readOnly={!isEditing}
                onChange={
                  isEditing && draft
                    ? (e) => {
                        const pwd = e.target.value;
                        setDraft({ ...draft, password: pwd, strength: calculateStrength(pwd) });
                      }
                    : undefined
                }
                className="field flex-1 rounded-xl px-4 py-3 text-sm font-mono"
              />
              <button onClick={() => setShowPassword(!showPassword)} className="icon-btn">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={() => handleCopy(entry.password, "password")}
                className="icon-btn relative"
              >
                <Copy className="w-4 h-4" />
                {copiedField === "password" && <CopiedBadge text={t("copied")} />}
              </button>
              <button
                onClick={() => setHistoryOpen(true)}
                className="icon-btn"
                title={t("passwordHistoryTitle")}
              >
                <History className="w-4 h-4" />
              </button>
              {isTauri && (
                <button onClick={handleAutoType} className="icon-btn" title={t("autoTypeTitle")}>
                  <Keyboard className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Website */}
          <div className="space-y-2">
            <label className="section-title">{t("websiteLabel")}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shown.url}
                readOnly={!isEditing}
                onChange={
                  isEditing && draft
                    ? (e) => setDraft({ ...draft, url: e.target.value })
                    : undefined
                }
                className="field flex-1 rounded-xl px-4 py-3 text-sm"
              />
              {entry.url && (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="icon-btn"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 t3" />
              <label className="section-title">{t("tagsLabel")}</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {shown.tags.map((tag) => (
                <span key={tag} className="chip !px-3 !py-1.5 !text-sm">
                  {tag}
                  {isEditing && (
                    <button
                      onClick={() => removeTag(tag)}
                      className="ml-1 -mr-1 opacity-60 hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
              {isEditing &&
                (addingTag ? (
                  <input
                    autoFocus
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTag();
                      if (e.key === "Escape") setAddingTag(false);
                    }}
                    onBlur={addTag}
                    placeholder={t("addTagPlaceholder")}
                    className="field rounded-lg px-3 py-1.5 text-sm w-32"
                  />
                ) : (
                  <button onClick={() => setAddingTag(true)} className="btn-ghost px-3 py-1.5 text-sm">
                    <Plus className="w-3 h-3" />
                    {t("addTag")}
                  </button>
                ))}
            </div>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 t3" />
              <label className="section-title">{t("categoryLabel")}</label>
            </div>
            {isEditing && draft ? (
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="field rounded-xl px-4 py-3 text-sm"
              >
                <option value="">{t("noCategory")}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {getCategoryLabel(cat, t)}
                  </option>
                ))}
                {draft.category && !categories.some((c) => c.id === draft.category) && (
                  <option value={draft.category}>{draft.category}</option>
                )}
              </select>
            ) : (
              <input
                type="text"
                disabled
                value={
                  categories.find((c) => c.id === shown.category)
                    ? getCategoryLabel(categories.find((c) => c.id === shown.category)!, t)
                    : shown.category || t("noCategory")
                }
                className="field rounded-xl px-4 py-3 text-sm disabled:opacity-70"
              />
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="section-title">{t("notesLabel")}</label>
            <textarea
              value={shown.notes || ""}
              readOnly={!isEditing}
              onChange={
                isEditing && draft
                  ? (e) => setDraft({ ...draft, notes: e.target.value })
                  : undefined
              }
              rows={3}
              className="field rounded-xl px-4 py-3 text-sm resize-y"
            />
          </div>

          {/* Custom fields */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="section-title">{t("customFieldsLabel")}</label>
              {isEditing && (
                <div className="relative">
                  <button
                    onClick={() => setShowFieldMenu(!showFieldMenu)}
                    className="icon-btn"
                    title={t("addField")}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {showFieldMenu && (
                    <div
                      className="absolute right-0 top-8 z-20 panel rounded-lg p-1 min-w-32"
                      style={{ border: "1px solid var(--panel-border)" }}
                    >
                      {(
                        [
                          ["text", t("fieldTypeText")],
                          ["hidden", t("fieldTypeHidden")],
                          ["email", t("fieldTypeEmail")],
                          ["url", t("fieldTypeUrl")],
                          ["number", t("fieldTypeNumber")],
                          ["date", t("fieldTypeDate")],
                        ] as const
                      ).map(([type, label]) => (
                        <button
                          key={type}
                          onClick={() => addCustomField(type)}
                          className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-[var(--btn-ghost-bg)]"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {shown.customFields && shown.customFields.length > 0 ? (
              <div className="space-y-2">
                {shown.customFields.map((field) => (
                  <div key={field.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs t3">{field.label || t("fieldLabel")}</span>
                      {isEditing && (
                        <button
                          onClick={() => removeCustomField(field.id)}
                          className="icon-btn !p-1"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateCustomField(field.id, { label: e.target.value })}
                          placeholder={t("fieldLabel")}
                          className="field rounded-lg px-3 py-2 text-sm flex-1"
                        />
                        <input
                          type={field.type === "hidden" ? "password" : field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
                          value={field.value}
                          onChange={(e) => updateCustomField(field.id, { value: e.target.value })}
                          placeholder={t("fieldValue")}
                          className="field rounded-lg px-3 py-2 text-sm flex-1 font-mono"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type={field.type === "hidden" && !visibleCustomFields.has(field.id) ? "password" : "text"}
                          value={field.value}
                          readOnly
                          className="field flex-1 rounded-lg px-3 py-2 text-sm font-mono"
                        />
                        {field.type === "hidden" && (
                          <button
                            onClick={() => toggleCustomFieldVisibility(field.id)}
                            className="icon-btn"
                          >
                            {visibleCustomFields.has(field.id) ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopy(field.value, field.id)}
                          className="icon-btn"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs t3">{t("customFieldsLabel")}</p>
            )}
          </div>

          {/* TOTP secret (только в редактировании) или живой генератор */}
          {isEditing && draft ? (
            <div className="space-y-2">
              <label className="section-title">{t("totpSecretLabel")}</label>
              <input
                type="text"
                value={draft.totpSecret || ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    totpSecret: e.target.value.replace(/\s/g, "").toUpperCase() || undefined,
                  })
                }
                placeholder={t("totpSecretPlaceholder")}
                className="field rounded-xl px-4 py-3 text-sm font-mono"
              />
            </div>
          ) : (
            entry.totpSecret && <TOTPGenerator secret={entry.totpSecret} />
          )}

          {/* Даты */}
          <div className="space-y-2 text-xs t3">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              <span>
                {t("createdLabel")}: {fmtDate(entry.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3" />
              <span>
                {t("modifiedLabel")}: {fmtDate(entry.updatedAt)}
              </span>
            </div>
          </div>

          {isEditing && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              onClick={saveEdit}
              className="btn-primary w-full py-3"
            >
              <Save className="w-4 h-4" />
              {t("saveChanges")}
            </motion.button>
          )}
        </div>
      </motion.div>

      <PasswordHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={entry.passwordHistory || []}
        onCopy={(text) => handleCopy(text, "history")}
      />
    </motion.div>
  );
}

function CopiedBadge({ text }: { text: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs rounded-lg whitespace-nowrap"
      style={{ background: "var(--accent)", color: "#fff" }}
    >
      {text}
    </motion.span>
  );
}

function PasswordHistoryModal({
  isOpen,
  onClose,
  history,
  onCopy,
}: {
  isOpen: boolean;
  onClose: () => void;
  history: { password: string; changedAt: number }[];
  onCopy: (text: string) => void;
}) {
  const { t, lang } = useI18n();
  const [visibleIndex, setVisibleIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) setVisibleIndex(null);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-[60] p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-md pointer-events-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="icon-badge w-9 h-9">
                  <History className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold t1">{t("passwordHistoryTitle")}</h3>
              </div>
              <button onClick={onClose} className="icon-btn">
                <X className="w-4 h-4" />
              </button>
            </div>

            {history.length === 0 ? (
              <p className="text-sm t3 py-4 text-center">{t("passwordHistoryEmpty")}</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {history.map((item, idx) => (
                  <div
                    key={`${item.changedAt}-${idx}`}
                    className="flex items-center gap-2 p-2 rounded-lg"
                    style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs t3">
                        {t("passwordHistoryChangedAt")}:{" "}
                        {new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(item.changedAt))}
                      </p>
                      <p className="font-mono text-sm t1 truncate">
                        {visibleIndex === idx ? item.password : "••••••••••"}
                      </p>
                    </div>
                    <button
                      onClick={() => setVisibleIndex(visibleIndex === idx ? null : idx)}
                      className="icon-btn"
                    >
                      {visibleIndex === idx ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => onCopy(item.password)}
                      className="icon-btn"
                      title={t("copyPasswordTitle")}
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Plus, Eye, EyeOff, Save, Link, Tag, Folder, Dice5, FileText, Trash2 } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useVaultStore, calculateStrength, generateRandomPassword, type CustomField } from "@/stores/vault";
import { useCategoryStore, getCategoryLabel } from "@/stores/categories";
import { useI18n } from "@/i18n";
import { useSettingsStore } from "@/stores/settings";
import { fetchFaviconDataUrl } from "@/lib/favicons";

interface QuickAddProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickAdd({ isOpen, onClose }: QuickAddProps) {
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [showFieldMenu, setShowFieldMenu] = useState(false);

  const addEntry = useVaultStore((s) => s.addEntry);
  const categories = useCategoryStore((s) => s.categories);
  const { t } = useI18n();

  const strength = calculateStrength(password);

  // Ctrl+Enter — сохранить
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Сброс формы при закрытии
  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  const handlePasswordChange = (val: string) => {
    setPassword(val);
  };

  const handleSave = () => {
    if (!title || !password) return;

    const id = crypto.randomUUID();
    addEntry({
      id,
      title,
      username,
      password,
      url,
      category,
      tags: tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      favorite: false,
      strength,
      icon: title.charAt(0).toUpperCase(),
      notes: notes || undefined,
      customFields: customFields.length > 0 ? customFields : undefined,
    });

    // Favicon-автозаполнение: тянем иконку сайта в фоне, если включено
    const { faviconAutoFetch } = useSettingsStore.getState();
    if (faviconAutoFetch && url) {
      void fetchFaviconDataUrl(url).then((dataUrl) => {
        if (dataUrl) useVaultStore.getState().updateEntry(id, { favicon: dataUrl });
      });
    }

    onClose();
  };

  const resetForm = () => {
    setTitle("");
    setUsername("");
    setPassword("");
    setUrl("");
    setCategory("");
    setTags("");
    setShowPassword(false);
    setNotes("");
    setCustomFields([]);
    setShowFieldMenu(false);
  };

  const strengthTextClass =
    strength >= 80 ? "c-strong" : strength >= 50 ? "c-good" : strength >= 30 ? "c-fair" : "c-weak";
  const strengthBgClass =
    strength >= 80 ? "bg-strong" : strength >= 50 ? "bg-good" : strength >= 30 ? "bg-fair" : "bg-weak";

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
        className="absolute inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-md max-h-[90vh] overflow-y-auto pointer-events-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="icon-badge w-10 h-10">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold t1">{t("quickAddTitle")}</h2>
                  <p className="text-xs t3">{t("quickAddDesc")}</p>
                </div>
              </div>
              <button onClick={onClose} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="section-title">{t("titleLabel")}</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("titlePlaceholder")}
                  autoFocus
                  className="field rounded-xl px-4 py-3"
                />
              </div>

              <div className="space-y-2">
                <label className="section-title">{t("usernameLabel")}</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("usernamePlaceholder")}
                  className="field rounded-xl px-4 py-3 font-mono"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="section-title">{t("passwordLabel")}</label>
                  <button
                    onClick={() => handlePasswordChange(generateRandomPassword(16))}
                    className="text-xs flex items-center gap-1 transition-colors"
                    style={{ color: "var(--accent-soft-text)" }}
                  >
                    <Dice5 className="w-3 h-3" />
                    {t("generate")}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                    placeholder={t("passwordPlaceholder")}
                    className="field flex-1 rounded-xl px-4 py-3 font-mono"
                  />
                  <button onClick={() => setShowPassword(!showPassword)} className="icon-btn">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && (
                  <div className="mt-2">
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--kbd-bg)" }}
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${strength}%` }}
                        className={`h-full rounded-full ${strengthBgClass}`}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-xs ${strengthTextClass}`}>
                        {strength >= 80
                          ? t("strengthStrong")
                          : strength >= 50
                          ? t("strengthGood")
                          : strength >= 30
                          ? t("strengthFair")
                          : t("strengthWeak")}
                      </span>
                      <span className="text-xs t3">{strength}/100</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Link className="w-4 h-4 t3" />
                  <label className="section-title">{t("websiteLabel")}</label>
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("websitePlaceholder")}
                  className="field rounded-xl px-4 py-3"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 t3" />
                    <label className="section-title">{t("categoryLabel")}</label>
                  </div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="field rounded-xl px-4 py-3 text-sm"
                  >
                    <option value="">{t("noCategory")}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {getCategoryLabel(cat, t)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 t3" />
                    <label className="section-title">{t("tagsLabel")}</label>
                  </div>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder={t("tagsPlaceholder")}
                    className="field rounded-xl px-4 py-3 text-sm"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 t3" />
                  <label className="section-title">{t("notesLabel")}</label>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="field rounded-xl px-4 py-3 text-sm resize-y"
                />
              </div>

              {/* Custom fields */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="section-title">{t("customFieldsLabel")}</label>
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
                            onClick={() => {
                              setCustomFields((prev) => [
                                ...prev,
                                { id: crypto.randomUUID(), label: "", value: "", type },
                              ]);
                              setShowFieldMenu(false);
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-[var(--btn-ghost-bg)]"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {customFields.length > 0 && (
                  <div className="space-y-2">
                    {customFields.map((field) => (
                      <div key={field.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) =>
                            setCustomFields((prev) =>
                              prev.map((f) =>
                                f.id === field.id ? { ...f, label: e.target.value } : f
                              )
                            )
                          }
                          placeholder={t("fieldLabel")}
                          className="field rounded-lg px-3 py-2 text-sm flex-1"
                        />
                        <input
                          type={field.type === "hidden" ? "password" : field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
                          value={field.value}
                          onChange={(e) =>
                            setCustomFields((prev) =>
                              prev.map((f) =>
                                f.id === field.id ? { ...f, value: e.target.value } : f
                              )
                            )
                          }
                          placeholder={t("fieldValue")}
                          className="field rounded-lg px-3 py-2 text-sm flex-1 font-mono"
                        />
                        <button
                          onClick={() =>
                            setCustomFields((prev) => prev.filter((f) => f.id !== field.id))
                          }
                          className="icon-btn"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={handleSave}
                disabled={!title || !password}
                className="btn-primary flex-1 py-3"
              >
                <Save className="w-4 h-4" />
                {t("saveEntry")}
                <span className="kbd !bg-white/20 !border-white/30 !text-white">Ctrl+Enter</span>
              </motion.button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

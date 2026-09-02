import { useState } from "react";
import { motion } from "framer-motion";
import { X, Plus, Pencil, Trash2, Check, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useI18n } from "@/i18n";
import {
  useCategoryStore,
  type Category,
  getCategoryLabel,
  orderedCategories,
} from "@/stores/categories";
import { getIconComponent } from "@/lib/icons";
import { useVaultStore } from "@/stores/vault";

interface CategoryManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CategoryManager({ isOpen, onClose }: CategoryManagerProps) {
  const { t } = useI18n();
  const categories = useCategoryStore((s) => s.categories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const updateCategory = useCategoryStore((s) => s.updateCategory);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);
  const moveCategory = useCategoryStore((s) => s.moveCategory);
  const updateEntries = useVaultStore((s) => s.updateEntry);
  const entries = useVaultStore((s) => s.entries);

  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reset = () => {
    setNewLabel("");
    setEditingId(null);
    setEditLabel("");
    setDeleteId(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const result = addCategory(newLabel);
    if (result) {
      setNewLabel("");
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditLabel(getCategoryLabel(cat, t));
  };

  const saveEdit = () => {
    if (!editingId) return;
    const trimmed = editLabel.trim();
    if (!trimmed) return;
    updateCategory(editingId, { label: trimmed });
    setEditingId(null);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    deleteCategory(deleteId);
    entries.forEach((entry) => {
      if (entry.category === deleteId) {
        updateEntries(entry.id, { category: "" });
      }
    });
    setDeleteId(null);
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50"
    >
      <div className="overlay absolute inset-0" onClick={close} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-md max-h-[90vh] overflow-y-auto pointer-events-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold t1">{t("manageCategories")}</h2>
              <button onClick={close} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="flex gap-2 mb-6">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t("newCategoryName")}
                className="field rounded-xl px-4 py-3 text-sm flex-1"
              />
              <button
                type="submit"
                disabled={!newLabel.trim()}
                className="btn-primary px-4 py-3"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            <div className="space-y-2">
              {orderedCategories(categories).map((cat, idx, arr) => {
                const Icon = getIconComponent(cat.icon);
                const isEditing = editingId === cat.id;
                const isDeleting = deleteId === cat.id;
                const displayLabel = getCategoryLabel(cat, t);

                return (
                  <div
                    key={cat.id}
                    className="flex items-center gap-2 p-2 rounded-xl border"
                    style={{ borderColor: "var(--divider)" }}
                  >
                    <Icon className="w-4 h-4 t3 flex-shrink-0" />

                    {isEditing ? (
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        autoFocus
                        className="field rounded-xl px-3 py-2 text-sm flex-1"
                      />
                    ) : (
                      <span className="flex-1 text-sm t1 truncate">{displayLabel}</span>
                    )}

                    {isEditing ? (
                      <button onClick={saveEdit} className="icon-btn" title={t("save")}>
                        <Check className="w-4 h-4" />
                      </button>
                    ) : (
                      <>
                        {/* Клавиатурная альтернатива drag&drop-сортировке */}
                        <button
                          onClick={() => moveCategory(cat.id, -1)}
                          className="icon-btn"
                          title={t("moveUp")}
                          disabled={idx === 0}
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveCategory(cat.id, 1)}
                          className="icon-btn"
                          title={t("moveDown")}
                          disabled={idx === arr.length - 1}
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => startEdit(cat)}
                          className="icon-btn"
                          title={t("edit")}
                          disabled={cat.id === "Other"}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(cat.id)}
                          className="icon-btn danger"
                          title={t("delete")}
                          disabled={cat.id === "Other"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}

                    {isDeleting && (
                      <div
                        className="flex items-center gap-2 text-xs"
                        style={{ color: "var(--danger)" }}
                      >
                        <AlertTriangle className="w-4 h-4" />
                        {t("confirmDeleteCategory")}
                        <button onClick={confirmDelete} className="icon-btn danger">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(null)} className="icon-btn">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

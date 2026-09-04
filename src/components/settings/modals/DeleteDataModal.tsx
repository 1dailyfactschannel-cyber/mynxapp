import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { ActionModal } from "../ui/ActionModal";
import { FieldLabel } from "../ui/FieldLabel";

interface DeleteDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Полное удаление данных: vault-файл, device key, lock-сессия.
 * Требует ввести «DELETE» или «УДАЛИТЬ» для подтверждения — защита
 * от случайного клика.
 */
export function DeleteDataModal({ isOpen, onClose, onDeleted }: DeleteDataModalProps) {
  const { t } = useI18n();
  const deleteAllData = useAppStore((s) => s.deleteAllData);

  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirmText("");
    setBusy(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const word = confirmText.trim().toUpperCase();
  const canDelete = (word === "DELETE" || word === "УДАЛИТЬ") && !busy;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAllData();
      reset();
      onDeleted(); // закрывает и настройки — приложение вернётся к онбордингу
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("deleteModalTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Trash2 className="w-4 h-4" style={{ color: "var(--danger)" }} />
        </div>
      }
      onClose={close}
    >
      <div
        className="flex items-start gap-2 text-sm"
        style={{ color: "var(--danger-soft-text)" }}
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <p>{t("deleteModalDesc")}</p>
      </div>
      <div>
        <FieldLabel>{t("deleteTypeHint", t("deleteWord"))}</FieldLabel>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("deleteWord")}
          autoFocus
          className="field rounded-xl px-3.5 py-2.5 text-sm font-mono"
        />
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
          {t("cancel")}
        </button>
        <button
          onClick={submit}
          disabled={!canDelete}
          className="btn-primary flex-1 py-2.5 text-sm"
          style={{ background: "var(--danger)", boxShadow: "none" }}
        >
          {busy ? t("working") : t("deleteSubmit")}
        </button>
      </div>
    </ActionModal>
  );
}

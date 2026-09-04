import { useState } from "react";
import { CheckCircle2, Lock } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { isWrongPassword } from "@/lib/errors";
import { ActionModal } from "../ui/ActionModal";
import { PasswordField } from "../ui/PasswordField";
import { FieldLabel } from "../ui/FieldLabel";

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Смена мастер-пароля. После успеха — api_token ротируется
 * автоматически (см. backend vault_change_password).
 */
export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const { t } = useI18n();
  const changeMasterPassword = useAppStore((s) => s.changeMasterPassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setBusy(false);
    setError(null);
    setDone(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    if (next.length < 8) {
      setError(t("pwTooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("passwordsMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeMasterPassword(current, next);
      setDone(true);
    } catch (e) {
      setError(isWrongPassword(e) ? t("wrongCurrentPassword") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = current.length > 0 && next.length > 0 && confirm.length > 0 && !busy;

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("changePwTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Lock className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {done ? (
        <>
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {t("changePwSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("changePwDesc")}</p>
          <div>
            <FieldLabel>{t("currentPassword")}</FieldLabel>
            <PasswordField
              value={current}
              onChange={setCurrent}
              placeholder={t("currentPassword")}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>{t("newPassword")}</FieldLabel>
            <PasswordField
              value={next}
              onChange={setNext}
              placeholder={t("newPassword")}
            />
          </div>
          <div>
            <FieldLabel>{t("confirmPasswordLabel")}</FieldLabel>
            <PasswordField
              value={confirm}
              onChange={setConfirm}
              placeholder={t("confirmPasswordLabel")}
              onEnter={submit}
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
              disabled={!canSubmit}
              className="btn-primary flex-1 py-2.5 text-sm"
            >
              {busy ? t("working") : t("changePwSubmit")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

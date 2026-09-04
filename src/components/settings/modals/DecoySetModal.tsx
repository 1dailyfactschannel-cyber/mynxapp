import { useState } from "react";
import { CheckCircle2, EyeOff } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import {
  isDecoyEqualsMaster,
  isPasswordTooShort,
  isWrongPassword,
} from "@/lib/errors";
import { ActionModal } from "../ui/ActionModal";
import { PasswordField } from "../ui/PasswordField";
import { FieldLabel } from "../ui/FieldLabel";

interface DecoySetModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Установка/смена ложного пароля (plausible deniability).
 * Валидация на бэкенде: мастер и decoy должны различаться,
 * decoy проходит ту же минимальную проверку длины, что и мастер.
 */
export function DecoySetModal({ isOpen, onClose }: DecoySetModalProps) {
  const { t } = useI18n();
  const setDecoyPassword = useAppStore((s) => s.setDecoyPassword);

  const [master, setMaster] = useState("");
  const [decoy, setDecoy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [oldDecoy, setOldDecoy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setMaster("");
    setDecoy("");
    setConfirm("");
    setOldDecoy("");
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
    if (decoy.length < 8) {
      setError(t("pwTooShort"));
      return;
    }
    if (decoy !== confirm) {
      setError(t("passwordsMismatch"));
      return;
    }
    if (decoy === master) {
      setError(t("decoyEqualsMaster"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setDecoyPassword(master, decoy, oldDecoy || undefined);
      setDone(true);
    } catch (e) {
      setError(
        isDecoyEqualsMaster(e)
          ? t("decoyEqualsMaster")
          : isPasswordTooShort(e)
          ? t("pwTooShort")
          : isWrongPassword(e)
          ? t("wrongCurrentPassword")
          : String(e)
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = master.length > 0 && decoy.length > 0 && confirm.length > 0 && !busy;

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("decoySetTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <EyeOff className="w-4 h-4" />
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
            {t("decoySetSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("decoySetDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={master}
              onChange={setMaster}
              placeholder={t("masterPasswordLabel")}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>{t("decoyPasswordLabel")}</FieldLabel>
            <PasswordField
              value={decoy}
              onChange={setDecoy}
              placeholder={t("decoyPasswordLabel")}
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
          <div>
            <FieldLabel>{t("decoyOldPasswordLabel")}</FieldLabel>
            <PasswordField
              value={oldDecoy}
              onChange={setOldDecoy}
              placeholder={t("decoyPasswordLabel")}
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
              {busy ? t("working") : t("save")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

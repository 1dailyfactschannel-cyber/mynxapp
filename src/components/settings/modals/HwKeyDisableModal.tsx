import { useState } from "react";
import { CheckCircle2, Usb } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { isHwKeyNotFound, isWrongPassword } from "@/lib/errors";
import { ActionModal } from "../ui/ActionModal";
import { PasswordField } from "../ui/PasswordField";
import { FieldLabel } from "../ui/FieldLabel";

interface HwKeyDisableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged: (enabled: boolean) => void;
}

/**
 * Отключение аппаратного ключа. Требует мастер-пароль + вставленную
 * флешку с keyfile (бэкенд читает секрет для отвязки).
 */
export function HwKeyDisableModal({ isOpen, onClose, onChanged }: HwKeyDisableModalProps) {
  const { t } = useI18n();
  const disableHwKey = useAppStore((s) => s.disableHwKey);

  const [master, setMaster] = useState("");
  const [decoy, setDecoy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setMaster("");
    setDecoy("");
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
    setBusy(true);
    setError(null);
    try {
      await disableHwKey(master, decoy || undefined);
      setDone(true);
      onChanged(false);
    } catch (e) {
      const msg = String(e);
      setError(
        isHwKeyNotFound(e)
          ? t("hwKeyNotFound")
          : isWrongPassword(e)
          ? t("wrongCurrentPassword")
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("hwKeyDisableTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Usb className="w-4 h-4" />
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
            {t("hwKeyDisableSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("hwKeyDisableDesc")}</p>
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
            <FieldLabel>{t("hwKeyDecoyLabel")}</FieldLabel>
            <PasswordField
              value={decoy}
              onChange={setDecoy}
              placeholder={t("decoyPasswordLabel")}
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
              disabled={!master || busy}
              className="btn-primary flex-1 py-2.5 text-sm"
              style={{ background: "var(--danger)", boxShadow: "none" }}
            >
              {busy ? t("working") : t("hwKeyDisable")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

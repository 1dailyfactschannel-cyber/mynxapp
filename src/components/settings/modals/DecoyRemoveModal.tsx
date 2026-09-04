import { useState } from "react";
import { CheckCircle2, EyeOff } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { isWrongPassword } from "@/lib/errors";
import { ActionModal } from "../ui/ActionModal";
import { PasswordField } from "../ui/PasswordField";
import { FieldLabel } from "../ui/FieldLabel";

interface DecoyRemoveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Отключение ложного слоя. Слот заменяется на "спящий" (зашифрованный
 * случайным ключом), так что снаружи нельзя отличить «отключённый слой»
 * от «никогда не было».
 */
export function DecoyRemoveModal({ isOpen, onClose }: DecoyRemoveModalProps) {
  const { t } = useI18n();
  const removeDecoy = useAppStore((s) => s.removeDecoy);

  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setMaster("");
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
      await removeDecoy(master);
      setDone(true);
    } catch (e) {
      const msg = String(e);
      setError(isWrongPassword(e) ? t("wrongCurrentPassword") : msg);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("decoyRemoveTitle")}
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
            {t("decoyRemoveSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("decoyRemoveDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={master}
              onChange={setMaster}
              placeholder={t("masterPasswordLabel")}
              onEnter={submit}
              autoFocus
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
              {busy ? t("working") : t("decoyRemove")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

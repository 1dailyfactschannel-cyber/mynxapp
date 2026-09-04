import { useState } from "react";
import { CheckCircle2, Usb, Folder } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { isHwKeyAlreadyEnabled, isWrongPassword } from "@/lib/errors";
import { ActionModal } from "../ui/ActionModal";
import { PasswordField } from "../ui/PasswordField";
import { FieldLabel } from "../ui/FieldLabel";

interface HwKeyEnableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged: (enabled: boolean) => void;
}

/**
 * Включение аппаратного ключа (USB с keyfile). Бэкенд валидирует путь
 * (только съёмный диск или %USERPROFILE%) — Defence in Depth против
 * скомпрометированного фронта.
 */
export function HwKeyEnableModal({ isOpen, onClose, onChanged }: HwKeyEnableModalProps) {
  const { t } = useI18n();
  const enableHwKey = useAppStore((s) => s.enableHwKey);

  const [master, setMaster] = useState("");
  const [decoy, setDecoy] = useState("");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyfilePath, setKeyfilePath] = useState<string | null>(null);

  const reset = () => {
    setMaster("");
    setDecoy("");
    setDirectory("");
    setBusy(false);
    setError(null);
    setKeyfilePath(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const pickFolder = async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setDirectory(dir);
    } catch (e) {
      console.error(e);
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = await enableHwKey(master, directory, decoy || undefined);
      setKeyfilePath(path);
      onChanged(true);
    } catch (e) {
      const msg = String(e);
      setError(
        isHwKeyAlreadyEnabled(e)
          ? t("hwKeyStatusOn")
          : isWrongPassword(e)
          ? t("wrongCurrentPassword")
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = master.length > 0 && directory.length > 0 && !busy;

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("hwKeyEnableTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Usb className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {keyfilePath ? (
        <>
          <div
            className="flex items-start gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-all">
              {t("hwKeyEnableSuccess")} {keyfilePath}
            </span>
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("hwKeyEnableDesc")}</p>
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
            />
          </div>
          <div>
            <FieldLabel>{t("hwKeyPickFolder")}</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={directory}
                readOnly
                placeholder="E:\\"
                className="field flex-1 rounded-xl px-3.5 py-2.5 text-sm font-mono"
              />
              <button onClick={pickFolder} className="icon-btn" title={t("hwKeyPickFolder")}>
                <Folder className="w-4 h-4" />
              </button>
            </div>
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
              {busy ? t("working") : t("hwKeyEnable")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

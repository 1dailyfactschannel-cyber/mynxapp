import { useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { isWrongPassword } from "@/lib/errors";
import { ActionModal } from "../ui/ActionModal";
import { PasswordField } from "../ui/PasswordField";
import { FieldLabel } from "../ui/FieldLabel";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Экспорт зашифрованной копии vault. Создаёт .spbackup-файл рядом
 * с exe (Tauri) или скачивает JSON в браузере (демо-режим).
 *
 * Проверка мастер-пароля через типизированные ошибки вместо
 * `String(e).includes("wrong_password")`.
 */
export function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const { t } = useI18n();
  const exportVault = useAppStore((s) => s.exportVault);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);

  const reset = () => {
    setPassword("");
    setBusy(false);
    setError(null);
    setSavedPath(null);
    setDownloadStarted(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await exportVault(password);
      if (result === "") {
        // Пользователь отменил диалог сохранения
        close();
        return;
      }
      if (result === "download") setDownloadStarted(true);
      else setSavedPath(result);
    } catch (e) {
      setError(
        isWrongPassword(e)
          ? t("wrongCurrentPassword")
          : `${t("exportFailed")}: ${String(e)}`
      );
    } finally {
      setBusy(false);
    }
  };

  const finished = savedPath !== null || downloadStarted;

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("exportModalTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Upload className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {finished ? (
        <>
          <div
            className="flex items-start gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            {downloadStarted ? (
              <span>{t("exportDownloadStarted")}</span>
            ) : (
              <span className="break-all">
                {t("exportSuccess")} {savedPath}
              </span>
            )}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("exportModalDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={password}
              onChange={setPassword}
              placeholder={t("masterPassword")}
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
              disabled={!password || busy}
              className="btn-primary flex-1 py-2.5 text-sm"
            >
              {busy ? t("working") : t("exportSubmit")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

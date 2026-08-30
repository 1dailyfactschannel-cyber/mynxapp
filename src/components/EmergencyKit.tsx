import { useState } from "react";
import { motion } from "framer-motion";
import { X, Download, Printer, AlertTriangle, Shield, QrCode } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useAppStore, isTauri } from "@/stores/app";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n";
import QRCode from "qrcode";

interface EmergencyKitProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EmergencyKit({ isOpen, onClose }: EmergencyKitProps) {
  const [generating, setGenerating] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const activeVault = useAppStore((s) => s.activeVault);
  const { t } = useI18n();

  const vaultName = activeVault
    ? activeVault.split(/[\\/]/).pop()?.replace(".safepass", "") || "Vault"
    : "Vault";
  const vaultId = activeVault || "—";

  const generateQR = async () => {
    setGenerating(true);
    try {
      // Ключ устройства доступен только в Tauri-режиме у разблокированного хранилища
      let deviceKey: string | null = null;
      if (isTauri && activeVault) {
        deviceKey = await invoke<string>("get_device_key", {
          request: { vault_id: activeVault },
        });
      }
      const data = JSON.stringify({
        type: "mynx-emergency",
        version: 1,
        vaultId,
        vaultName,
        deviceKey,
        kdf: "Argon2id (m=16MB, t=3, p=2)",
        createdAt: new Date().toISOString(),
      });
      const url = await QRCode.toDataURL(data, {
        width: 240,
        margin: 2,
        color: { dark: "#0e1626", light: "#ffffff" },
      });
      setQrDataUrl(url);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    if (!qrDataUrl) return;
    const fileName = `mynx-emergency-${vaultName}.png`;

    if (!isTauri) {
      // Браузерный предпросмотр: обычное скачивание через <a download>
      const link = document.createElement("a");
      link.href = qrDataUrl;
      link.download = fileName;
      link.click();
      return;
    }

    // В Tauri WebView2 не обрабатывает <a download> —
    // сохраняем через нативный диалог на стороне Rust
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const base64 = qrDataUrl.split(",")[1] || "";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      await invoke("save_png_file", {
        request: { default_name: fileName, bytes: Array.from(bytes) },
      });
    } catch (e) {
      console.error("Save QR failed:", e);
    }
  };

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
        <GlassCard className="w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="icon-badge warn-badge w-10 h-10">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold t1">{t("ekTitle")}</h2>
                  <p className="text-xs t3">{t("ekDesc")}</p>
                </div>
              </div>
              <button onClick={onClose} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="soft-warn rounded-2xl border p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium mb-1">{t("ekWarningTitle")}</p>
                    <p className="opacity-80">{t("ekWarningText")}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="section-title">{t("ekVaultId")}</label>
                  <div className="field rounded-xl p-3 font-mono text-xs break-all">
                    {vaultId}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="section-title">{t("ekVaultName")}</label>
                  <div className="field rounded-xl p-3 font-mono text-sm">{vaultName}</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="section-title">{t("ekKdf")}</label>
                <div className="field rounded-xl p-3 font-mono text-sm">
                  Argon2id (memory=16MB, iterations=3, parallelism=2)
                </div>
              </div>

              <div className="space-y-2">
                <label className="section-title">{t("ekQr")}</label>
                <div
                  className="flex justify-center p-4 rounded-xl"
                  style={{
                    background: "var(--field-bg)",
                    border: "1px solid var(--field-border)",
                  }}
                >
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Emergency QR"
                      className="w-48 h-48 rounded-lg"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center t3">
                      <button
                        onClick={generateQR}
                        disabled={generating}
                        className="flex flex-col items-center gap-2 text-sm t3-hover"
                      >
                        <QrCode className="w-8 h-8" />
                        {generating ? t("ekGenerating") : t("ekGenerateQr")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={handlePrint}
                className="btn-ghost flex-1 py-3"
              >
                <Printer className="w-4 h-4" />
                {t("ekPrint")}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={handleDownload}
                disabled={!qrDataUrl}
                className="btn-primary flex-1 py-3"
              >
                <Download className="w-4 h-4" />
                {t("ekDownload")}
              </motion.button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

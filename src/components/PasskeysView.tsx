import { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  X,
  KeyRound,
  Plus,
  Trash2,
  Download,
  Upload,
  ShieldCheck,
  Fingerprint,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/i18n";
import { usePasskeysStore } from "@/stores/passkeys";
import { useVaultStore } from "@/stores/vault";
import { createPasskey, selfTestCredential } from "@/lib/passkey";
import { hostFromUrl } from "@/lib/favicons";

interface PasskeysViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PasskeysView({ isOpen, onClose }: PasskeysViewProps) {
  const { t } = useI18n();
  const passkeys = usePasskeysStore((s) => s.passkeys);
  const addPasskey = usePasskeysStore((s) => s.addPasskey);
  const removePasskey = usePasskeysStore((s) => s.removePasskey);
  const touchPasskey = usePasskeysStore((s) => s.touchPasskey);
  const exportPayload = usePasskeysStore((s) => s.exportPayload);
  const importPasskeys = usePasskeysStore((s) => s.importPasskeys);
  const entries = useVaultStore((s) => s.entries);

  const [creating, setCreating] = useState(false);
  const [rpId, setRpId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, boolean>>({});
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const linkedTitles = useMemo(() => {
    // rpId → заголовок записи, чей URL-хост совпадает
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.deletedAt || !e.url) continue;
      const host = hostFromUrl(e.url);
      if (host && !map.has(host)) map.set(host, e.title);
    }
    return map;
  }, [entries]);

  const handleCreate = async () => {
    if (!rpId.trim() || !username.trim() || busy) return;
    setBusy(true);
    try {
      const item = await createPasskey(rpId, username, displayName);
      addPasskey(item);
      setRpId("");
      setUsername("");
      setDisplayName("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSelfTest = async (id: string) => {
    const item = passkeys.find((p) => p.id === id);
    if (!item) return;
    setBusy(true);
    try {
      const ok = await selfTestCredential(item);
      setTestResult((prev) => ({ ...prev, [id]: ok }));
      if (ok) touchPasskey(id);
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mynx-passkeys-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (f: File) => {
    setImportInfo(null);
    try {
      const text = await f.text();
      const { parseImport } = await import("@/lib/passkey");
      const items = parseImport(text);
      const added = importPasskeys(items);
      setImportInfo(t("passkeysImported", added, items.length - added));
    } catch {
      setImportInfo(t("passkeysImportFailed"));
    }
  };

  if (!isOpen) return null;

  const fmtDate = (ts?: number) =>
    ts ? new Date(ts).toLocaleDateString() : "—";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50">
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="icon-badge w-10 h-10">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold t1">{t("passkeysTitle")}</h2>
                  <p className="text-xs t3">{t("passkeysDesc")}</p>
                </div>
              </div>
              <button onClick={onClose} className="icon-btn" aria-label={t("close")}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2 my-4">
              <button onClick={() => setCreating(!creating)} className="btn-primary flex-1 py-2.5 text-sm justify-center">
                <Plus className="w-4 h-4" />
                {t("passkeysCreate")}
              </button>
              <button onClick={handleExport} disabled={passkeys.length === 0} className="btn-ghost px-3 py-2.5 text-sm" title={t("passkeysExport")}>
                <Download className="w-4 h-4" />
              </button>
              <button onClick={() => fileRef.current?.click()} className="btn-ghost px-3 py-2.5 text-sm" title={t("passkeysImport")}>
                <Upload className="w-4 h-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImport(f);
                  e.target.value = "";
                }}
              />
            </div>
            {importInfo && <p className="text-xs t3 mb-3">{importInfo}</p>}

            {creating && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-4 space-y-2 overflow-hidden">
                <input
                  type="text"
                  value={rpId}
                  onChange={(e) => setRpId(e.target.value)}
                  placeholder={t("passkeysRpId")}
                  autoFocus
                  className="field rounded-xl px-4 py-2.5 text-sm w-full"
                />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("usernamePlaceholder")}
                  className="field rounded-xl px-4 py-2.5 text-sm w-full"
                />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("passkeysDisplayName")}
                  className="field rounded-xl px-4 py-2.5 text-sm w-full"
                />
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={!rpId.trim() || !username.trim() || busy} className="btn-primary flex-1 py-2.5 text-sm justify-center">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    {t("passkeysGenerate")}
                  </button>
                  <button onClick={() => setCreating(false)} className="btn-ghost px-4 py-2.5 text-sm">
                    {t("cancel")}
                  </button>
                </div>
              </motion.div>
            )}

            {passkeys.length === 0 ? (
              <EmptyState variant="passkeys" title={t("passkeysEmpty")} hint={t("passkeysEmptyHint")} />
            ) : (
              <div className="space-y-2">
                {passkeys.map((p) => (
                  <GlassCard key={p.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="icon-tile w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm t1 font-medium truncate">
                          {p.rpId}
                          {linkedTitles.get(p.rpId) && (
                            <span className="t3 font-normal"> · {linkedTitles.get(p.rpId)}</span>
                          )}
                        </p>
                        <p className="text-xs t3 truncate">
                          {p.username} · {t("passkeysCreated")} {fmtDate(p.createdAt)}
                          {p.lastUsedAt ? ` · ${t("passkeysLastUsed")} ${fmtDate(p.lastUsedAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {testResult[p.id] === true && (
                          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--c-strong)" }} />
                        )}
                        {testResult[p.id] === false && (
                          <XCircle className="w-4 h-4" style={{ color: "var(--danger)" }} />
                        )}
                        <button
                          onClick={() => handleSelfTest(p.id)}
                          className="icon-btn"
                          title={t("passkeysSelfTest")}
                          disabled={busy}
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                        <button onClick={() => removePasskey(p.id)} className="icon-btn danger" title={t("delete")}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}

            <p className="text-xs t3 mt-4 flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {t("passkeysSecurityNote")}
            </p>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

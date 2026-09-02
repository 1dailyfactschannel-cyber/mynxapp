import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
  Search,
  FileDown,
  Printer,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { EmptyState } from "@/components/EmptyState";
import { useVaultStore, type Entry } from "@/stores/vault";
import { useSettingsStore } from "@/stores/settings";
import { useI18n } from "@/i18n";
import {
  analyzeHealth,
  passwordAgeDays,
  recordHealthSnapshot,
  trendDelta,
  buildHealthCsv,
  type HealthSnapshot,
  type HealthAnalysis,
} from "@/lib/health";
import { printHtmlReport, escapeHtml } from "@/lib/report";

interface HealthDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntry: (id: string) => void;
}

const ROTATION_OPTIONS = [90, 180, 365];

/* ------------------------------------------------------------------ */
/* Спарклайн тренда балла                                              */
/* ------------------------------------------------------------------ */

function Sparkline({ history, color }: { history: HealthSnapshot[]; color: string }) {
  const points = history.slice(-30);
  if (points.length < 2) return null;

  const w = 260;
  const h = 56;
  const pad = 4;
  const scores = points.map((p) => p.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;

  return (
    <svg width={w} height={h} className="mt-1" aria-hidden="true">
      <path d={area} fill={color} opacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].score)} r="3" fill={color} />
    </svg>
  );
}

export function HealthDashboard({ isOpen, onClose, onSelectEntry }: HealthDashboardProps) {
  const entries = useVaultStore((s) => s.entries);
  const { t } = useI18n();

  const rotationThresholdDays = useSettingsStore((s) => s.rotationThresholdDays);
  const setRotationThresholdDays = useSettingsStore((s) => s.setRotationThresholdDays);

  const [auditing, setAuditing] = useState(false);
  const [history, setHistory] = useState<HealthSnapshot[]>([]);

  // Снапшот при каждом открытии панели: так собирается тренд
  useEffect(() => {
    if (!isOpen) return;
    const { rotationThresholdDays: threshold } = useSettingsStore.getState();
    setHistory(recordHealthSnapshot(useVaultStore.getState().entries, threshold));
  }, [isOpen]);

  // Пересчёт при смене порога тоже фиксируем, чтобы тренд был честным
  useEffect(() => {
    if (!isOpen) return;
    setHistory((prev) => {
      const fresh = recordHealthSnapshot(useVaultStore.getState().entries, rotationThresholdDays);
      return prev.length === 0 ? prev : fresh;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationThresholdDays]);

  const analysis: HealthAnalysis = useMemo(
    () => analyzeHealth(entries, rotationThresholdDays),
    [entries, rotationThresholdDays]
  );

  const delta = useMemo(() => trendDelta(history, 7), [history]);

  const handleAudit = () => {
    setAuditing(true);
    setTimeout(() => {
      setHistory(recordHealthSnapshot(useVaultStore.getState().entries, rotationThresholdDays));
      setAuditing(false);
    }, 900);
  };

  const scoreColorClass =
    analysis.totalScore >= 80
      ? "c-strong"
      : analysis.totalScore >= 60
      ? "c-good"
      : analysis.totalScore >= 40
      ? "c-fair"
      : "c-weak";

  const scoreLabel =
    entries.length === 0
      ? t("healthEmpty")
      : analysis.totalScore >= 80
      ? t("healthExcellent")
      : analysis.totalScore >= 60
      ? t("healthGood")
      : analysis.totalScore >= 40
      ? t("healthFair")
      : t("healthPoor");

  const ringColor =
    analysis.totalScore >= 80
      ? "var(--c-strong)"
      : analysis.totalScore >= 60
      ? "var(--c-good)"
      : analysis.totalScore >= 40
      ? "var(--c-fair)"
      : "var(--c-weak)";

  const exportCsv = () => {
    const csv = buildHealthCsv(analysis, entries, rotationThresholdDays);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mynx-health-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const rows = (list: Entry[], ageOf = false) =>
      list.length === 0
        ? `<tr><td class="muted" colspan="3">—</td></tr>`
        : list
            .map((e) => {
              const age = passwordAgeDays(e);
              return `<tr><td>${escapeHtml(e.title)}</td><td class="muted">${escapeHtml(e.username)}</td><td>${
                ageOf && age !== null ? t("healthAgeDays", age) : e.strength
              }</td></tr>`;
            })
            .join("");

    const body = `
      <h1>Mynx — ${escapeHtml(t("healthTitle"))}</h1>
      <div class="meta">${new Date().toLocaleString()}</div>
      <div class="badges">
        <div class="badge"><b>${analysis.totalScore}</b><span>${escapeHtml(t("healthScore"))}</span></div>
        <div class="badge"><b>${analysis.total}</b><span>${escapeHtml(t("totalEntries", analysis.total))}</span></div>
        <div class="badge"><b>${analysis.avgPasswordAgeDays ?? "—"}</b><span>${escapeHtml(t("healthAvgAge"))}</span></div>
        <div class="badge"><b>${analysis.rotationDue.length}</b><span>${escapeHtml(t("healthRotationDue"))}</span></div>
      </div>
      <h2>${escapeHtml(t("healthRotationDue"))} (${escapeHtml(t("healthThreshold"))}: ${rotationThresholdDays})</h2>
      <table><tr><th>${escapeHtml(t("titleLabel"))}</th><th>${escapeHtml(t("usernameLabel"))}</th><th>${escapeHtml(t("healthAgeCol"))}</th></tr>${rows(analysis.rotationDue, true)}</table>
      <h2>${escapeHtml(t("weakPasswords"))}</h2>
      <table><tr><th>${escapeHtml(t("titleLabel"))}</th><th>${escapeHtml(t("usernameLabel"))}</th><th>${escapeHtml(t("strengthOf"))}</th></tr>${rows(analysis.weak)}</table>
      <h2>${escapeHtml(t("reusedPasswords"))}</h2>
      <table><tr><th>${escapeHtml(t("titleLabel"))}</th><th>${escapeHtml(t("usernameLabel"))}</th><th>${escapeHtml(t("strengthOf"))}</th></tr>${rows(analysis.reused)}</table>
      <h2>${escapeHtml(t("missing2fa"))}</h2>
      <table><tr><th>${escapeHtml(t("titleLabel"))}</th><th>${escapeHtml(t("usernameLabel"))}</th><th></th></tr>${rows(analysis.no2fa)}</table>
    `;
    printHtmlReport(`Mynx Health Report ${new Date().toISOString().slice(0, 10)}`, body);
  };

  if (!isOpen) return null;

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
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="icon-badge w-10 h-10">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold t1">{t("healthTitle")}</h2>
                  <p className="text-xs t3">{t("healthDesc")}</p>
                </div>
              </div>
              <button onClick={onClose} className="icon-btn" aria-label={t("close")}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {analysis.total === 0 ? (
              <EmptyState variant="generic" title={t("healthEmpty")} hint={t("healthEmptyHint")} />
            ) : (
              <>
                <GlassCard className="p-6 mb-4 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 20 }}
                    className="relative inline-flex items-center justify-center w-24 h-24 rounded-full border-4 mb-4"
                    style={{ borderColor: ringColor }}
                  >
                    <span className={`text-3xl font-bold ${scoreColorClass}`}>{analysis.totalScore}</span>
                  </motion.div>
                  <p className={`text-lg font-medium ${scoreColorClass}`}>{scoreLabel}</p>
                  <p className="text-sm t3 mt-1">{t("totalEntries", analysis.total)}</p>

                  {/* Тренд балла */}
                  {history.length >= 2 && (
                    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--divider)" }}>
                      <div className="flex items-center justify-center gap-2 text-xs t2">
                        {delta === null || delta === 0 ? (
                          <>
                            <Minus className="w-3.5 h-3.5" />
                            {t("healthTrendFlat")}
                          </>
                        ) : delta > 0 ? (
                          <>
                            <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--c-strong)" }} />
                            {t("healthTrendUp", delta)}
                          </>
                        ) : (
                          <>
                            <TrendingDown className="w-3.5 h-3.5" style={{ color: "var(--danger)" }} />
                            {t("healthTrendDown", Math.abs(delta))}
                          </>
                        )}
                      </div>
                      <div className="flex justify-center">
                        <Sparkline history={history} color={ringColor} />
                      </div>
                    </div>
                  )}
                </GlassCard>

                {/* Возраст паролей и порог ротации */}
                <GlassCard className="p-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 t3" />
                      <span className="text-sm t1">{t("healthAvgAge")}</span>
                    </div>
                    <span className="text-sm t2 font-mono">
                      {analysis.avgPasswordAgeDays !== null
                        ? t("healthAgeDays", analysis.avgPasswordAgeDays)
                        : "—"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs t3">{t("healthThreshold")}</span>
                      <span className="text-xs t2 font-mono">
                        {t("healthAgeDays", rotationThresholdDays)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {ROTATION_OPTIONS.map((d) => (
                        <button
                          key={d}
                          onClick={() => setRotationThresholdDays(d)}
                          className={`segment ${rotationThresholdDays === d ? "active" : ""}`}
                        >
                          {t("healthAgeDays", d)}
                        </button>
                      ))}
                    </div>
                  </div>
                </GlassCard>

                <div className="space-y-3 mb-6">
                  <IssueCard
                    title={t("healthRotationDue")}
                    count={analysis.rotationDue.length}
                    icon={Clock}
                    tone="danger"
                    entries={analysis.rotationDue}
                    ages={analysis.rotationAges}
                    onSelect={onSelectEntry}
                    detailLabel={t("healthAgeCol")}
                  />
                  <IssueCard
                    title={t("weakPasswords")}
                    count={analysis.weak.length}
                    icon={AlertTriangle}
                    tone="warn"
                    entries={analysis.weak}
                    onSelect={onSelectEntry}
                    detailLabel={t("strengthOf")}
                  />
                  <IssueCard
                    title={t("reusedPasswords")}
                    count={analysis.reused.length}
                    icon={AlertCircle}
                    tone="warn"
                    entries={analysis.reused}
                    onSelect={onSelectEntry}
                    detailLabel={t("strengthOf")}
                  />
                  <IssueCard
                    title={t("missing2fa")}
                    count={analysis.no2fa.length}
                    icon={CheckCircle2}
                    tone="accent"
                    entries={analysis.no2fa}
                    onSelect={onSelectEntry}
                    detailLabel={t("strengthOf")}
                  />
                </div>

                {/* Экспорт отчёта */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button onClick={exportCsv} className="btn-ghost py-2.5 text-sm justify-center">
                    <FileDown className="w-4 h-4" />
                    {t("healthExportCsv")}
                  </button>
                  <button onClick={exportPdf} className="btn-ghost py-2.5 text-sm justify-center">
                    <Printer className="w-4 h-4" />
                    {t("healthExportPdf")}
                  </button>
                </div>

                <motion.button
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={handleAudit}
                  disabled={auditing}
                  className="btn-primary w-full py-3"
                >
                  {auditing ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                    >
                      <Search className="w-4 h-4" />
                    </motion.div>
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {t("runAudit")}
                </motion.button>
              </>
            )}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

function IssueCard({
  title,
  count,
  icon: Icon,
  tone,
  entries,
  ages,
  onSelect,
  detailLabel,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  tone: "danger" | "warn" | "info" | "accent";
  entries: Entry[];
  /** Возраст по id (для «пора ротировать») */
  ages?: Record<string, number>;
  onSelect: (id: string) => void;
  detailLabel: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const toneClass =
    tone === "danger"
      ? "soft-danger"
      : tone === "warn"
      ? "soft-warn"
      : tone === "info"
      ? "soft-info"
      : "soft-accent";

  return (
    <GlassCard className={`p-4 border ${toneClass}`}>
      <button
        onClick={() => count > 0 && setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5" />
          <span className="font-medium t1">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{count}</span>
          {count > 0 && (
            <ChevronRight
              className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && count > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 space-y-2" style={{ borderTop: "1px solid var(--divider)" }}>
              {entries.map((entry) => {
                const age = ages?.[entry.id];
                return (
                  <button
                    key={entry.id}
                    onClick={() => onSelect(entry.id)}
                    className="btn-ghost w-full justify-between p-2 text-left"
                  >
                    <span className="text-sm t1">{entry.title}</span>
                    <span className="text-xs t3">
                      {age !== undefined ? t("healthAgeDays", age) : detailLabel.replace("{0}", String(entry.strength))}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

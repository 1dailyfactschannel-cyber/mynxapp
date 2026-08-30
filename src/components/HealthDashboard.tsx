import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  RefreshCw,
  ChevronRight,
  Search,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useVaultStore, type Entry } from "@/stores/vault";
import { useI18n } from "@/i18n";

interface HealthDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntry: (id: string) => void;
}

/** Пароль старше 180 дней считается «старым» — детерминированно, по дате изменения */
const OLD_THRESHOLD_MS = 180 * 24 * 3600 * 1000;

export function HealthDashboard({ isOpen, onClose, onSelectEntry }: HealthDashboardProps) {
  const entries = useVaultStore((s) => s.entries);
  const [auditing, setAuditing] = useState(false);
  const { t } = useI18n();

  const analysis = useMemo(() => {
    const now = Date.now();
    const weak = entries.filter((e) => e.strength < 50);
    const reused = entries.filter((e, i, arr) =>
      arr.some((other, j) => i !== j && other.password === e.password)
    );
    // Детерминированно: по реальной дате изменения записи
    const old = entries.filter((e) =>
      e.updatedAt ? now - e.updatedAt > OLD_THRESHOLD_MS : false
    );
    const no2fa = entries.filter((e) => !e.totpSecret && !e.tags.includes("2fa"));
    const totalScore =
      entries.length > 0
        ? Math.round(entries.reduce((sum, e) => sum + e.strength, 0) / entries.length)
        : 0;

    return { weak, reused, old, no2fa, totalScore };
  }, [entries]);

  const handleAudit = () => {
    setAuditing(true);
    setTimeout(() => setAuditing(false), 1200);
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
              <button onClick={onClose} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <GlassCard className="p-6 mb-6 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 20 }}
                className="relative inline-flex items-center justify-center w-24 h-24 rounded-full border-4 mb-4"
                style={{ borderColor: entries.length === 0 ? "var(--kbd-border)" : ringColor }}
              >
                <span className={`text-3xl font-bold ${scoreColorClass}`}>
                  {entries.length === 0 ? "—" : analysis.totalScore}
                </span>
              </motion.div>
              <p className={`text-lg font-medium ${scoreColorClass}`}>{scoreLabel}</p>
              <p className="text-sm t3 mt-1">
                {entries.length === 0 ? t("healthEmptyHint") : t("totalEntries", entries.length)}
              </p>
            </GlassCard>

            <div className="space-y-3 mb-6">
              <IssueCard
                title={t("weakPasswords")}
                count={analysis.weak.length}
                icon={AlertTriangle}
                tone="danger"
                entries={analysis.weak}
                onSelect={onSelectEntry}
                strengthLabel={t("strengthOf")}
              />
              <IssueCard
                title={t("reusedPasswords")}
                count={analysis.reused.length}
                icon={AlertCircle}
                tone="warn"
                entries={analysis.reused}
                onSelect={onSelectEntry}
                strengthLabel={t("strengthOf")}
              />
              <IssueCard
                title={t("oldPasswords")}
                count={analysis.old.length}
                icon={Lock}
                tone="info"
                entries={analysis.old}
                onSelect={onSelectEntry}
                strengthLabel={t("strengthOf")}
              />
              <IssueCard
                title={t("missing2fa")}
                count={analysis.no2fa.length}
                icon={CheckCircle2}
                tone="accent"
                entries={analysis.no2fa}
                onSelect={onSelectEntry}
                strengthLabel={t("strengthOf")}
              />
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
  onSelect,
  strengthLabel,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  tone: "danger" | "warn" | "info" | "accent";
  entries: Entry[];
  onSelect: (id: string) => void;
  strengthLabel: string;
}) {
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
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onSelect(entry.id)}
                  className="btn-ghost w-full justify-between p-2 text-left"
                >
                  <span className="text-sm t1">{entry.title}</span>
                  <span className="text-xs t3">
                    {strengthLabel.replace("{0}", String(entry.strength))}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Timer, Copy, Check } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useI18n } from "@/i18n";
import { useSettingsStore } from "@/stores/settings";
import { useClipboardStore } from "@/stores/clipboard";
import { generateTOTP } from "@/lib/totp";

interface TOTPGeneratorProps {
  secret: string;
}

export function TOTPGenerator({ secret }: TOTPGeneratorProps) {
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(30);
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const clipboardSeconds = useSettingsStore((s) => s.clipboardClearSeconds);
  const clipboardEnabled = useSettingsStore((s) => s.clipboardClearEnabled);
  const clipboardCopy = useClipboardStore((s) => s.copy);

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setTimeLeft(30 - (now % 30));
      setCode(generateTOTP(secret));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [secret]);

  const handleCopy = () => {
    clipboardCopy(code, clipboardSeconds, clipboardEnabled);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const progress = (timeLeft / 30) * 100;
  const isLow = timeLeft <= 5;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Timer className="w-5 h-5" style={{ color: "var(--accent)" }} />
          <span className="font-medium t1">{t("twoFactor")}</span>
        </div>
        <div className="relative w-8 h-8">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--kbd-border)" strokeWidth="2" />
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="none"
              stroke={isLow ? "var(--danger)" : "var(--accent)"}
              strokeWidth="2"
              strokeDasharray={`${2 * Math.PI * 14 * (progress / 100)} ${2 * Math.PI * 14}`}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>
          <span
            className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
            style={{ color: isLow ? "var(--danger)" : "var(--accent)" }}
          >
            {timeLeft}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <motion.span
          key={code}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-mono font-bold t1 tracking-widest"
        >
          {code.slice(0, 3)} {code.slice(3, 6)}
        </motion.span>
        <button onClick={handleCopy} className="icon-btn relative">
          {copied ? (
            <Check className="w-4 h-4" style={{ color: "var(--accent)" }} />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          {copied && (
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs rounded-lg whitespace-nowrap"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {t("copied")}
            </motion.span>
          )}
        </button>
      </div>

      <p className="text-xs t3 mt-2">{t("totpRefreshes", timeLeft)}</p>
    </GlassCard>
  );
}

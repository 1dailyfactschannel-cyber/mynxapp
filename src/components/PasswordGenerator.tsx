import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  X,
  Copy,
  RefreshCw,
  Shield,
  Check,
  Dice5,
  Type,
  Hash,
  KeyRound,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useI18n } from "@/i18n";
import { useSettingsStore } from "@/stores/settings";
import { useClipboardStore } from "@/stores/clipboard";

interface PasswordGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  onUsePassword?: (password: string) => void;
}

type GeneratorType = "random" | "memorable" | "passphrase" | "pin";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const AMBIGUOUS = /[0O1lI|`'"]/g;

// Небольшой встроенный список слов для passphrase (частотные англ. слова)
const WORDS = (
  "apple bridge candle dragon eagle forest garden harbor island jungle kettle lemon magnet needle ocean " +
  "piano quartz river sunset tiger umbrella valley window yellow zebra anchor breeze castle diamond ember " +
  "falcon glacier hammer ivory jacket knight ladder marble north orbit pepper quartz rocket silver thunder " +
  "velvet wander xenon yogurt zephyr autumn beacon copper dagger emerald frost gravel horizon ink jasper " +
  "kingdom lantern meadow noble opal prairie quill raven sapphire timber unity violet whisper crystal birch " +
  "cloud dancer engine feather globe harvest iris jewel karma lagoon mirror nectar oasis pearl quest ridge " +
  "spirit temple urban voyage willow cedar comet drift echo flame grove heather inlet juniper krill lotus"
).split(" ");

function secureRandom(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

function pickChars(set: string, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += set[secureRandom(set.length)];
  return out;
}

export function PasswordGenerator({ isOpen, onClose, onUsePassword }: PasswordGeneratorProps) {
  const [type, setType] = useState<GeneratorType>("random");
  const [length, setLength] = useState(16);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [includeUpper, setIncludeUpper] = useState(true);
  const [includeLower, setIncludeLower] = useState(true);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [easyToSay, setEasyToSay] = useState(false);

  const { t } = useI18n();
  const clipboardSeconds = useSettingsStore((s) => s.clipboardClearSeconds);
  const clipboardEnabled = useSettingsStore((s) => s.clipboardClearEnabled);
  const clipboardCopy = useClipboardStore((s) => s.copy);

  const generate = () => {
    if (type === "pin") {
      setPassword(pickChars(DIGITS, Math.max(4, Math.min(12, length))));
      return;
    }

    if (type === "passphrase") {
      const count = Math.max(3, Math.min(6, Math.round(length / 8)));
      const words: string[] = [];
      for (let i = 0; i < count; i++) {
        let w = WORDS[secureRandom(WORDS.length)];
        if (includeUpper) w = w.charAt(0).toUpperCase() + w.slice(1);
        words.push(w);
      }
      let phrase = words.join("-");
      if (includeNumbers) phrase += `-${secureRandom(90) + 10}`;
      setPassword(phrase);
      return;
    }

    if (type === "memorable") {
      // Чередуем согласные/гласные — пароль легко произнести
      const vowels = "aeiou";
      const consonants = "bcdfghjklmnpqrstvwxyz";
      const len = Math.max(6, Math.min(24, length));
      let out = "";
      for (let i = 0; i < len; i++) {
        const set = i % 2 === 0 ? consonants : vowels;
        let ch = set[secureRandom(set.length)];
        if (includeUpper && i === 0) ch = ch.toUpperCase();
        out += ch;
      }
      if (includeNumbers) out += String(secureRandom(90) + 10);
      if (includeSymbols && !easyToSay) out += SYMBOLS.replace(AMBIGUOUS, "")[secureRandom(SYMBOLS.replace(AMBIGUOUS, "").length)];
      setPassword(out);
      return;
    }

    // random
    let chars = "";
    if (includeLower) chars += LOWER;
    if (includeUpper) chars += UPPER;
    if (includeNumbers) chars += DIGITS;
    if (includeSymbols && !easyToSay) chars += SYMBOLS;
    if (excludeAmbiguous) chars = chars.replace(AMBIGUOUS, "");
    if (!chars) return;
    setPassword(pickChars(chars, length));
  };

  // Генерируем при открытии
  useEffect(() => {
    if (isOpen && !password) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Честная энтропия: log2(размер_алфавита ^ длина)
  const entropy = useMemo(() => {
    if (!password) return 0;
    let pool = 0;
    if (/[a-z]/.test(password)) pool += 26;
    if (/[A-Z]/.test(password)) pool += 26;
    if (/[0-9]/.test(password)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(password)) pool += 32;
    if (type === "passphrase") {
      const words = password.split("-").filter((w) => /[a-zA-Z]/.test(w)).length;
      return Math.round(words * Math.log2(WORDS.length) + (includeNumbers ? 6.5 : 0));
    }
    return Math.round(password.length * Math.log2(Math.max(pool, 2)));
  }, [password, type, includeNumbers]);

  const strength = Math.min(100, Math.round((entropy / 100) * 100));

  const strengthLabel =
    strength >= 80
      ? t("strengthStrong")
      : strength >= 50
      ? t("strengthGood")
      : strength >= 30
      ? t("strengthFair")
      : t("strengthWeak");
  const strengthTextClass =
    strength >= 80 ? "c-strong" : strength >= 50 ? "c-good" : strength >= 30 ? "c-fair" : "c-weak";
  const strengthBgClass =
    strength >= 80 ? "bg-strong" : strength >= 50 ? "bg-good" : strength >= 30 ? "bg-fair" : "bg-weak";

  const handleCopy = () => {
    if (!password) return;
    clipboardCopy(password, clipboardSeconds, clipboardEnabled);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUse = () => {
    if (onUsePassword) onUsePassword(password);
    onClose();
  };

  const typeOptions = [
    { id: "random" as GeneratorType, label: t("genRandom"), icon: Dice5 },
    { id: "memorable" as GeneratorType, label: t("genMemorable"), icon: Type },
    { id: "passphrase" as GeneratorType, label: t("genPassphrase"), icon: KeyRound },
    { id: "pin" as GeneratorType, label: t("genPin"), icon: Hash },
  ];

  const charOptions =
    type === "random"
      ? [
          { label: t("optUpper"), checked: includeUpper, set: setIncludeUpper },
          { label: t("optLower"), checked: includeLower, set: setIncludeLower },
          { label: t("optNumbers"), checked: includeNumbers, set: setIncludeNumbers },
          { label: t("optSymbols"), checked: includeSymbols, set: setIncludeSymbols, disabled: easyToSay },
          { label: t("optExcludeAmbiguous"), checked: excludeAmbiguous, set: setExcludeAmbiguous },
          { label: t("optEasyToSay"), checked: easyToSay, set: setEasyToSay },
        ]
      : [
          { label: t("optUpper"), checked: includeUpper, set: setIncludeUpper },
          { label: t("optNumbers"), checked: includeNumbers, set: setIncludeNumbers },
          ...(type === "memorable"
            ? [{ label: t("optSymbols"), checked: includeSymbols, set: setIncludeSymbols, disabled: easyToSay }]
            : []),
        ];

  const lengthRange =
    type === "pin" ? { min: 4, max: 12 } : type === "passphrase" ? { min: 16, max: 48 } : type === "memorable" ? { min: 6, max: 24 } : { min: 4, max: 64 };

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
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="absolute inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
            <GlassCard className="w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="icon-badge w-10 h-10">
                      <Dice5 className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold t1">{t("generatorTitle")}</h2>
                      <p className="text-xs t3">{t("generatorDesc")}</p>
                    </div>
                  </div>
                  <button onClick={onClose} className="icon-btn">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <GlassCard className="p-4 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 font-mono text-lg t1 break-all">
                      {password || t("generatorEmpty")}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={handleCopy} disabled={!password} className="icon-btn">
                        {copied ? (
                          <Check className="w-4 h-4" style={{ color: "var(--accent)" }} />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      <button onClick={generate} className="icon-btn">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {password && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-medium ${strengthTextClass}`}>
                          {strengthLabel}
                        </span>
                        <span className={`text-sm font-bold ${strengthTextClass}`}>
                          {strength}/100
                        </span>
                      </div>
                      <div
                        className="h-2 rounded-full overflow-hidden"
                        style={{ background: "var(--kbd-bg)" }}
                      >
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${strength}%` }}
                          transition={{ duration: 0.4 }}
                          className={`h-full rounded-full ${strengthBgClass}`}
                        />
                      </div>
                      <p className="text-xs t3 mt-2">{t("entropyLabel", entropy)}</p>
                    </div>
                  )}
                </GlassCard>

                <div className="grid grid-cols-4 gap-2 mb-6">
                  {typeOptions.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setType(opt.id)}
                        className={`segment ${type === opt.id ? "active" : ""}`}
                      >
                        <Icon className="w-4 h-4" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center justify-between">
                    <label className="text-sm t2">{t("lengthLabel")}</label>
                    <span className="text-sm font-mono font-bold t1">{length}</span>
                  </div>
                  <input
                    type="range"
                    min={lengthRange.min}
                    max={lengthRange.max}
                    value={Math.min(length, lengthRange.max)}
                    onChange={(e) => setLength(Number(e.target.value))}
                    className="range"
                  />
                </div>

                <div className="space-y-2 mb-6">
                  {charOptions.map((opt) => (
                    <label
                      key={opt.label}
                      className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                        opt.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                      }`}
                      style={{
                        background: "var(--btn-ghost-bg)",
                        border: "1px solid var(--btn-ghost-border)",
                      }}
                    >
                      <span className="text-sm t2">{opt.label}</span>
                      <div
                        className={`toggle-track ${opt.checked ? "on" : ""} ${opt.disabled ? "disabled" : ""}`}
                        onClick={(e) => {
                          e.preventDefault();
                          if (!opt.disabled) opt.set(!opt.checked);
                        }}
                      >
                        <motion.div
                          animate={{ x: opt.checked ? 20 : 2 }}
                          transition={{ type: "spring", stiffness: 300, damping: 20 }}
                          className="toggle-thumb"
                        />
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={generate}
                    className="btn-primary flex-1 py-3"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t("generate")}
                  </motion.button>
                  {onUsePassword && (
                    <motion.button
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.985 }}
                      onClick={handleUse}
                      disabled={!password}
                      className="btn-ghost flex-1 py-3"
                    >
                      <Shield className="w-4 h-4" />
                      {t("useThisPassword")}
                    </motion.button>
                  )}
                </div>
              </div>
            </GlassCard>
      </motion.div>
    </motion.div>
  );
}

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  Key,
  Lock,
  Save,
} from "lucide-react";
import { useAppStore } from "@/stores/app";
import { calculateStrength } from "@/stores/vault";
import { useI18n } from "@/i18n";

interface OnboardingProps {
  onComplete: () => void;
  onCancel?: () => void;
}

export function Onboarding({ onComplete, onCancel }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [vaultName, setVaultName] = useState("Personal");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const createVault = useAppStore((s) => s.createVault);
  const { t } = useI18n();

  const strength = calculateStrength(password);

  const strengthClass =
    strength >= 80 ? "c-strong" : strength >= 50 ? "c-good" : "c-fair";
  const strengthBgClass =
    strength >= 80 ? "bg-strong" : strength >= 50 ? "bg-good" : "bg-fair";

  const handleCreate = async () => {
    if (password !== confirmPassword || password.length < 8) return;
    setIsLoading(true);
    try {
      await createVault(vaultName, "vaults", password);
      onComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const steps = [
    {
      title: t("welcomeTitle"),
      description: t("welcomeDesc"),
      content: (
        <div className="text-center space-y-6">
          <motion.div
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(16,185,129,0)",
                "0 0 60px 20px var(--accent-shadow)",
                "0 0 0 0 rgba(16,185,129,0)",
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="icon-badge w-24 h-24 rounded-3xl inline-flex mx-auto"
          >
            <Shield className="w-12 h-12" />
          </motion.div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold t1">{t("appName")}</h2>
            <p className="t2 max-w-sm mx-auto">{t("welcomeText")}</p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { icon: Lock, label: t("featOffline") },
              { icon: Key, label: t("featEncrypted") },
              { icon: Shield, label: t("featSecure") },
            ].map((f) => (
              <div key={f.label} className="glass-card p-3">
                <f.icon className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--accent)" }} />
                <span className="text-xs t2">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: t("createVaultTitle"),
      description: t("createVaultDesc"),
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm t2">{t("vaultName")}</label>
            <input
              type="text"
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              className="field rounded-xl px-4 py-3"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm t2">{t("masterPasswordLabel")}</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("masterPasswordHint")}
                className="field rounded-xl px-4 py-3 pr-12 font-mono"
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 t3-hover"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm t2">{t("confirmPasswordLabel")}</label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="field rounded-xl px-4 py-3 font-mono"
              style={
                confirmPassword && password !== confirmPassword
                  ? { borderColor: "var(--danger)" }
                  : undefined
              }
            />
            {confirmPassword && password !== confirmPassword && (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {t("passwordsMismatch")}
              </p>
            )}
          </div>

          {password && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm t2">{t("strengthLabel")}</span>
                <span className={`text-sm font-bold ${strengthClass}`}>{strength}/100</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--kbd-bg)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${strength}%` }}
                  className={`h-full rounded-full ${strengthBgClass}`}
                />
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  const currentStep = steps[step];

  return (
    <div className="h-full flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="glass-card p-8">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full transition-colors"
                  style={{
                    background: i === step ? "var(--accent)" : "var(--kbd-border)",
                  }}
                />
              ))}
            </div>
            <h2 className="text-xl font-bold t1 mb-2">{currentStep.title}</h2>
            <p className="text-sm t2">{currentStep.description}</p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {currentStep.content}
            </motion.div>
          </AnimatePresence>

          <div className="flex gap-3 mt-8">
            {step > 0 && (
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => setStep(step - 1)}
                className="btn-ghost px-4 py-3"
              >
                <ArrowLeft className="w-4 h-4" />
                {t("back")}
              </motion.button>
            )}

            {step < steps.length - 1 ? (
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => setStep(step + 1)}
                className="btn-primary flex-1 py-3"
              >
                {t("continue")}
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={handleCreate}
                disabled={isLoading || password !== confirmPassword || password.length < 8}
                className="btn-primary flex-1 py-3"
              >
                {isLoading ? (
                  t("creating")
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {t("createVault")}
                  </>
                )}
              </motion.button>
            )}
          </div>

          {onCancel && (
            <button
              onClick={onCancel}
              className="btn-ghost w-full mt-3 py-2 text-sm"
              type="button"
            >
              {t("cancel")}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

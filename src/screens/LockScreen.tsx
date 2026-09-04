import { useState, useEffect } from "react";
import { Shield, Eye, EyeOff, AlertCircle, FolderOpen, Plus, KeyRound, Fingerprint } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore, isTauri } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { useI18n } from "@/i18n";
import { isHwKeyInvalid, isHwKeyNotFound, isTooManyAttempts, isVaultLocked, isWrongPassword, parseError, userMessage } from "@/lib/errors";

export function LockScreen() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [keyfilePath, setKeyfilePath] = useState<string | null>(null);
  const [keyfileNeeded, setKeyfileNeeded] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const unlock = useAppStore((s) => s.unlock);
  const unlockBiometry = useAppStore((s) => s.unlockBiometry);
  const activeVault = useAppStore((s) => s.activeVault);
  const setScreen = useAppStore((s) => s.setScreen);
  const setHasCompletedOnboarding = useAppStore((s) => s.setHasCompletedOnboarding);
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const { t } = useI18n();

  const vaultName = activeVault
    ? activeVault.split(/[\\/]/).pop()?.replace(".safepass", "") || "Vault"
    : null;

  // Windows Hello: кнопку показываем, только если функция доступна на
  // устройстве и включена для выбранного vault
  useEffect(() => {
    setBioReady(false);
    if (!isTauri || !activeVault) return;
    void (async () => {
      try {
        const [available, enabled] = await Promise.all([
          invoke<boolean>("biometry_is_available"),
          invoke<boolean>("biometry_is_enabled", {
            request: { vault_id: activeVault },
          }),
        ]);
        setBioReady(available && enabled);
      } catch {
        setBioReady(false);
      }
    })();
  }, [activeVault]);

  const handleBiometry = async () => {
    if (!activeVault) return;
    setIsLoading(true);
    setErrorMsg("");
    try {
      await unlockBiometry(activeVault);
    } catch (e: any) {
      const raw = String(e?.message ?? e ?? "");
      // Пользователь отменил системный диалог — это не ошибка
      if (raw.includes("biometry_cancelled")) {
        return;
      }
      if (raw.includes("biometry_key_invalid") || raw.includes("biometry_not_enabled")) {
        // Сохранённый ключ протух — дальше только мастер-пароль
        setBioReady(false);
        setError(true);
        setErrorMsg(t("biometryUsePassword"));
        setTimeout(() => setError(false), 600);
      } else {
        // В т.ч. общий backoff «Too many attempts. Retry in N seconds» — как есть
        setError(true);
        setErrorMsg(raw || t("wrongPassword"));
        setTimeout(() => setError(false), 600);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnlock = async () => {
    if (password.length < 1 || !activeVault) {
      setError(true);
      setErrorMsg(!activeVault ? t("noVaultSelected") : t("enterPasswordShort"));
      setTimeout(() => setError(false), 600);
      return;
    }

    setIsLoading(true);
    setErrorMsg("");
    try {
      await unlock(activeVault, password, keyfilePath || undefined);
    } catch (e: any) {
      setError(true);
      const err = parseError(e);
      const notFound = isHwKeyNotFound(e);
      setKeyfileNeeded(notFound);
      // Порядок важен: специфичные ошибки сначала.
      setErrorMsg(
        isTooManyAttempts(e)
          ? `Too many attempts. Retry in ${err.retryAfter ?? 30}s`
          : notFound
          ? t("hwKeyNotFound")
          : isHwKeyInvalid(e)
          ? t("hwKeyInvalid")
          : isWrongPassword(e) || isVaultLocked(e)
          ? t("wrongPassword")
          : userMessage(e, t("wrongPassword"))
      );
      setTimeout(() => setError(false), 600);
    } finally {
      setIsLoading(false);
    }
  };

  /** Ручной выбор keyfile, если он лежит в нестандартном месте */
  const pickKeyfile = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Mynx keyfile", extensions: ["key"] }],
      });
      if (typeof path === "string") {
        setKeyfilePath(path);
        setErrorMsg("");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleUnlock();
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-10">
          <motion.div
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(16,185,129,0)",
                "0 0 44px 10px var(--accent-shadow)",
                "0 0 0 0 rgba(16,185,129,0)",
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="icon-badge w-20 h-20 rounded-2xl inline-flex mb-6"
          >
            <Shield className="w-10 h-10" />
          </motion.div>

          <h1 className="text-3xl font-bold t1 mb-2">{t("appName")}</h1>
          <p className="t2 text-sm">{t("enterPassword")}</p>
        </div>

        {vaultName && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mb-4">
            <span className="chip soft-accent !px-3 !py-1.5 text-sm">
              <FolderOpen size={14} />
              {vaultName}
            </span>
          </motion.div>
        )}

        <motion.div
          animate={error ? { x: [0, -10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="glass-card p-6 mb-4"
        >
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("masterPassword")}
              autoFocus
              className="field field-lock rounded-xl px-4 py-3 pr-12 font-mono text-sm"
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 t3-hover"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </motion.div>

        <motion.button
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.985 }}
          onClick={handleUnlock}
          disabled={isLoading}
          className="btn-primary w-full py-3"
        >
          {isLoading ? t("unlocking") : t("unlock")}
        </motion.button>

        {/* Windows Hello — если доступно и включено для этого vault */}
        {bioReady && (
          <motion.button
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={handleBiometry}
            disabled={isLoading}
            className="btn-ghost w-full py-2.5 mt-3 text-sm"
          >
            <Fingerprint size={16} />
            {t("helloUnlock")}
          </motion.button>
        )}

        {/* Аппаратный ключ не найден автоматически — можно указать keyfile вручную */}
        {isTauri && (keyfileNeeded || keyfilePath) && (
          <motion.button
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={pickKeyfile}
            className="btn-ghost w-full py-2.5 mt-3 text-sm"
          >
            <KeyRound size={16} />
            {keyfilePath
              ? keyfilePath.split(/[\\/]/).pop()
              : t("hwKeyPickKeyfile")}
          </motion.button>
        )}

        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center gap-2 mt-4 text-sm"
              style={{ color: "var(--danger)" }}
            >
              <AlertCircle size={16} />
              {errorMsg}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-3 mt-6">
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => setScreen("vault-selector")}
            className="btn-ghost flex-1 py-2.5 text-sm"
          >
            <FolderOpen size={16} />
            {t("switchVault")}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={() => setHasCompletedOnboarding(false)}
            className="btn-ghost flex-1 py-2.5 text-sm"
          >
            <Plus size={16} />
            {t("newVault")}
          </motion.button>
        </div>

        <div className="text-center mt-6">
          <p className="t3 text-xs">{t("autoLockHint", autoLockMinutes)}</p>
        </div>
      </motion.div>
    </div>
  );
}

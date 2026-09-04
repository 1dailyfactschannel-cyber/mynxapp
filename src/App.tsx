import { motion } from "framer-motion";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppStore, isTauri } from "@/stores/app";
import { useSettingsStore, applyGlassIntensity } from "@/stores/settings";
import { useI18n } from "@/i18n";
import { initBackendSync, syncAppLanguage } from "@/lib/backendSync";
import { TitleBar } from "@/components/TitleBar";
import { LockScreen } from "@/screens/LockScreen";
import { VaultScreen } from "@/screens/VaultScreen";
import { Onboarding } from "@/screens/Onboarding";
import { VaultSelector } from "@/components/VaultSelector";
import { useVaultStore } from "@/stores/vault";

function App() {
  const screen = useAppStore((s) => s.screen);
  const isLocked = useAppStore((s) => s.isLocked);
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);
  const setHasCompletedOnboarding = useAppStore((s) => s.setHasCompletedOnboarding);
  const setScreen = useAppStore((s) => s.setScreen);
  const loadVaults = useAppStore((s) => s.loadVaults);
  const glassIntensity = useSettingsStore((s) => s.glassIntensity);
  const { resolvedTheme } = useTheme();
  const { lang } = useI18n();

  // ----- Одноразовые подписки: всё общение с бэкендом через initBackendSync -----
  useEffect(() => {
    if (!isTauri) return;
    return initBackendSync();
  }, []);

  // Язык → бэкенд: проброс через i18n-context нельзя делать в подписке,
  // потому что i18n живёт в React-Context. Дёргаем явным вызовом при изменении.
  useEffect(() => {
    syncAppLanguage(lang);
  }, [lang]);

  // Glass intensity зависит от темы — применяем на каждом ререндере App
  // (тема и настройка — оба триггеры)
  useEffect(() => {
    applyGlassIntensity(glassIntensity, resolvedTheme === "dark");
  }, [glassIntensity, resolvedTheme]);

  // Очистка корзины при старте по настройкам
  const trashRetentionDays = useSettingsStore((s) => s.trashRetentionDays);
  useEffect(() => {
    if (trashRetentionDays > 0) {
      useVaultStore.getState().purgeTrash(trashRetentionDays);
    }
  }, [trashRetentionDays]);

  return (
    <div className="app-shell h-screen flex flex-col overflow-hidden">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        {!hasCompletedOnboarding ? (
          <motion.div
            key="onboarding"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Onboarding
              onComplete={() => setHasCompletedOnboarding(true)}
              onCancel={() => {
                void loadVaults();
              }}
            />
          </motion.div>
        ) : screen === "vault-selector" ? (
          <motion.div
            key="selector"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <VaultSelector
              onSelectVault={() => setScreen("lock")}
              onCreateVault={() => setHasCompletedOnboarding(false)}
            />
          </motion.div>
        ) : isLocked ? (
          <motion.div
            key="lock"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <LockScreen />
          </motion.div>
        ) : (
          <motion.div
            key="vault"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <VaultScreen />
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default App;

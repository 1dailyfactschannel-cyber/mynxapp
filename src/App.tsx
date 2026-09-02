import { motion } from "framer-motion";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore, persistEntriesDebounced, isTauri } from "@/stores/app";
import { useVaultStore } from "@/stores/vault";
import { useSettingsStore, applyGlassIntensity, applyAccessibility } from "@/stores/settings";
import { useI18n } from "@/i18n";
import { TitleBar } from "@/components/TitleBar";
import { LockScreen } from "@/screens/LockScreen";
import { VaultScreen } from "@/screens/VaultScreen";
import { Onboarding } from "@/screens/Onboarding";
import { VaultSelector } from "@/components/VaultSelector";

function App() {
  const screen = useAppStore((s) => s.screen);
  const isLocked = useAppStore((s) => s.isLocked);
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);
  const setHasCompletedOnboarding = useAppStore((s) => s.setHasCompletedOnboarding);
  const setScreen = useAppStore((s) => s.setScreen);
  const loadVaults = useAppStore((s) => s.loadVaults);
  const glassIntensity = useSettingsStore((s) => s.glassIntensity);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  // Очистка корзины при старте по настройкам
  const trashRetentionDays = useSettingsStore((s) => s.trashRetentionDays);
  useEffect(() => {
    if (trashRetentionDays > 0) {
      useVaultStore.getState().purgeTrash(trashRetentionDays);
    }
  }, [trashRetentionDays]);

  // Автобэкап по расписанию
  const backupEnabled = useSettingsStore((s) => s.backupEnabled);
  const backupIntervalMinutes = useSettingsStore((s) => s.backupIntervalMinutes);
  const backupPath = useSettingsStore((s) => s.backupPath);
  const backupKeepCount = useSettingsStore((s) => s.backupKeepCount);
  useEffect(() => {
    if (!isTauri || !backupEnabled) return;

    const doBackup = async () => {
      const { activeVault, isUnlocked } = useAppStore.getState();
      if (!activeVault || !isUnlocked) return;

      try {
        await invoke("vault_backup", {
          request: {
            vault_id: activeVault,
            backup_path: backupPath,
            keep_count: backupKeepCount,
          },
        });
        useSettingsStore.getState().setLastBackup(Date.now(), true);
      } catch (e) {
        console.error("Auto-backup failed:", e);
        useSettingsStore.getState().setLastBackup(Date.now(), false);
      }
    };

    // Первый бэкап через минуту, потом по расписанию
    const initialTimer = setTimeout(doBackup, 60 * 1000);
    const intervalTimer = setInterval(doBackup, backupIntervalMinutes * 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [backupEnabled, backupIntervalMinutes, backupPath, backupKeepCount]);

  // Автосохранение записей в зашифрованный файл (Tauri-режим, дебаунс)
  useEffect(() => {
    const unsubscribe = useVaultStore.subscribe((state, prev) => {
      if (state.entries !== prev.entries) persistEntriesDebounced();
    });
    return unsubscribe;
  }, []);

  // Плотность стекла применяется глобально и живо, с учётом активной темы
  useEffect(() => {
    applyGlassIntensity(glassIntensity, resolvedTheme === "dark");
  }, [glassIntensity, resolvedTheme]);

  // Бэкенд сам затирает сессию при сворачивании в трей (lock_on_hide) —
  // синхронизируем UI по событию
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen("vault-locked", () => {
      void useAppStore.getState().lock();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Пробрасываем настройку блокировки при сворачивании в бэкенд
  const lockOnMinimize = useSettingsStore((s) => s.lockOnMinimize);
  useEffect(() => {
    if (!isTauri) return;
    invoke("set_lock_on_hide", { enabled: lockOnMinimize }).catch((e) =>
      console.error("set_lock_on_hide failed:", e)
    );
  }, [lockOnMinimize]);

  // Отключение системной истории буфера Windows (Win+V) — применяем
  // при старте и при каждом изменении тумблера (на не-Windows no-op)
  const clipboardHistoryDisabled = useSettingsStore((s) => s.clipboardHistoryDisabled);
  useEffect(() => {
    if (!isTauri) return;
    invoke("clipboard_history_set_enabled", {
      enabled: !clipboardHistoryDisabled,
    }).catch((e) => console.error("clipboard_history_set_enabled failed:", e));
  }, [clipboardHistoryDisabled]);

  // Язык UI — в бэкенд, чтобы нативные диалоги (pairing) были на нём же
  const { lang } = useI18n();
  useEffect(() => {
    if (!isTauri) return;
    invoke("set_app_language", { lang }).catch((e) =>
      console.error("set_app_language failed:", e)
    );
  }, [lang]);

  // A11y: масштаб шрифта / контрастность / reduced-motion применяются глобально
  const uiScale = useSettingsStore((s) => s.uiScale);
  const highContrast = useSettingsStore((s) => s.highContrast);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  useEffect(() => {
    applyAccessibility(uiScale, highContrast, reduceMotion);
  }, [uiScale, highContrast, reduceMotion]);

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

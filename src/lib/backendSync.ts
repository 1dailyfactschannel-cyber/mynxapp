/**
 * Единый модуль синхронизации настроек стора с Rust-бэкендом.
 *
 * Раньше в App.tsx было 7 отдельных useEffect, каждый слушал одно поле
 * стора и слал одну invoke-команду. С добавлением новых настроек это
 * превращалось в лавину: правишь App.tsx + стора. Здесь всё в одном
 * месте, App.tsx вызывает `initBackendSync()` один раз при маунте.
 *
 * Архитектура:
 *  - Подписка на `useSettingsStore` детектит изменения и шлёт команды.
 *  - Подписка на `useVaultStore` дебаунсит и персистит записи.
 *  - Подписка на событие `vault-locked` от Rust синхронизирует UI-стор.
 *  - Шедулер автобэкапа живёт здесь же (завязан на 4 поля + состояние сессии).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { useSettingsStore, applyAccessibility } from "@/stores/settings";
import { useAppStore, isTauri, persistEntriesDebounced } from "@/stores/app";
import { useVaultStore } from "@/stores/vault";

let initialised = false;

/**
 * Запустить фоновую синхронизацию настроек ↔ бэкенд.
 * Идемпотентно: повторный вызов — no-op.
 */
export function initBackendSync(): () => void {
  if (initialised) return () => {};
  initialised = true;

  const unsubs: Array<() => void> = [];

  // 1. Настройки, которые уходят в бэкенд.
  //    Подписка сравнивает prev/curr и шлёт только при изменении.
  const settingsUnsub = useSettingsStore.subscribe((state, prev) => {
    // a11y: применяется к DOM, не к Rust
    if (
      state.uiScale !== prev.uiScale ||
      state.highContrast !== prev.highContrast ||
      state.reduceMotion !== prev.reduceMotion
    ) {
      applyAccessibility(state.uiScale, state.highContrast, state.reduceMotion);
    }

    // Всё остальное — только в Tauri-режиме
    if (!isTauri) return;

    if (state.autoLockMinutes !== prev.autoLockMinutes) {
      pushAutolock(state.autoLockMinutes);
    }
    if (state.lockOnMinimize !== prev.lockOnMinimize) {
      pushLockOnHide(state.lockOnMinimize);
    }
    if (state.clipboardHistoryDisabled !== prev.clipboardHistoryDisabled) {
      pushClipboardHistory(!state.clipboardHistoryDisabled);
    }
    if (state.backupPath !== prev.backupPath || state.backupKeepCount !== prev.backupKeepCount) {
      pushIpcBackupPrefs(state.backupPath, state.backupKeepCount);
    }
  });
  unsubs.push(settingsUnsub);

  // 2. Язык UI — отдельная подписка (источник: i18n-context, не стор)
  if (isTauri) {
    // Стартовая синхронизация: сохранённый язык → бэкенд
    pushAppLanguage(useI18nLangSnapshot());
  }

  // 3. Стартовая синхронизация значений, которые не меняются в boot
  if (isTauri) {
    const initial = useSettingsStore.getState();
    pushAutolock(initial.autoLockMinutes);
    pushLockOnHide(initial.lockOnMinimize);
    pushClipboardHistory(!initial.clipboardHistoryDisabled);
    pushIpcBackupPrefs(initial.backupPath, initial.backupKeepCount);
  }

  // 4. Glass intensity зависит от темы, поэтому реагируем на resolvedTheme.
  //    next-themes сам дёргает useTheme() — здесь просто применяем на старте
  //    и при изменениях стора. Theme-изменения не дёргаем через subscribe, потому
  //    что App.tsx и так ре-рендерится при смене темы и зовёт эффект.
  //    (см. App.tsx — `applyGlassIntensity` остаётся там.)
  if (isTauri) {
    // glass — no-op на бэкенд, оставляем в App.tsx
  }

  // 5. Автобэкап по расписанию — отдельный watcher, потому что завязан
  //    на 4 поля одновременно + состояние сессии.
  const backupUnsub = useSettingsStore.subscribe((state, prev) => {
    if (
      state.backupEnabled !== prev.backupEnabled ||
      state.backupIntervalMinutes !== prev.backupIntervalMinutes ||
      state.backupPath !== prev.backupPath ||
      state.backupKeepCount !== prev.backupKeepCount
    ) {
      restartAutoBackup();
    }
  });
  unsubs.push(backupUnsub);

  // 6. Автосохранение записей при изменении entries
  const vaultUnsub = useVaultStore.subscribe((state, prev) => {
    if (state.entries !== prev.entries) persistEntriesDebounced();
  });
  unsubs.push(vaultUnsub);

  // 7. Backend шлёт «vault-locked» при сворачивании в трей (lock_on_hide)
  if (isTauri) {
    const unlistenPromise = listen("vault-locked", () => {
      void useAppStore.getState().lock();
    });
    unsubs.push(() => {
      unlistenPromise.then((f) => f());
    });
  }

  // Первичный запуск бэкапа
  restartAutoBackup();

  return () => {
    initialised = false;
    for (const u of unsubs) u();
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function pushAutolock(minutes: number) {
  invoke("set_autolock_minutes", { minutes: Math.max(0, Math.round(minutes)) }).catch(
    () => {
      /* нет бэкенда — молча */
    }
  );
}

function pushLockOnHide(enabled: boolean) {
  invoke("set_lock_on_hide", { enabled }).catch(() => {});
}

function pushClipboardHistory(enabled: boolean) {
  invoke("clipboard_history_set_enabled", { enabled }).catch(() => {});
}

function pushIpcBackupPrefs(backupPath: string, keepCount: number) {
  invoke("set_ipc_backup_prefs", { backupPath, keepCount }).catch(() => {});
}

function pushAppLanguage(lang: string) {
  invoke("set_app_language", { lang }).catch(() => {});
}

let autoBackupTimer: ReturnType<typeof setTimeout> | null = null;
let autoBackupInterval: ReturnType<typeof setInterval> | null = null;

function clearAutoBackupTimers() {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }
  if (autoBackupInterval) {
    clearInterval(autoBackupInterval);
    autoBackupInterval = null;
  }
}

/**
 * Шедулер автобэкапа. Рестарт при изменении любого из 4 полей.
 * Если бэкап выключен — таймеры чистятся.
 */
function restartAutoBackup() {
  if (!isTauri) return;
  clearAutoBackupTimers();

  const { backupEnabled, backupPath, backupKeepCount, backupIntervalMinutes } =
    useSettingsStore.getState();

  // Путь и лимит копий всегда актуальны на бэкенде — нужны и для IPC-клиента
  pushIpcBackupPrefs(backupPath, backupKeepCount);

  if (!backupEnabled) return;

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
  autoBackupTimer = setTimeout(doBackup, 60 * 1000);
  autoBackupInterval = setInterval(doBackup, Math.max(1, backupIntervalMinutes) * 60 * 1000);
}

/**
 * Снимок текущего языка из i18n-context.
 * Сложность в том, что i18n использует React Context, и просто так
 * прочитать значение вне компонента нельзя. Поэтому:
 *  - App.tsx (где есть доступ к useI18n) вызывает `useEffectBridgeToBackend`
 *    с текущим `lang`;
 *  - здесь же, в init-фазе, читаем дефолт из i18n-state, если модуль
 *    экспортирует геттер.
 *
 * Реализация: App.tsx вызывает `syncAppLanguage(lang)` на каждом изменении.
 */
let lastSyncedLanguage: string | null = null;
function useI18nLangSnapshot(): string {
  return lastSyncedLanguage ?? "en";
}

export function syncAppLanguage(lang: string) {
  if (lang === lastSyncedLanguage) return;
  lastSyncedLanguage = lang;
  if (isTauri) pushAppLanguage(lang);
}

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  X,
  Moon,
  Sun,
  Monitor,
  Clock,
  Shield,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  Lock,
  Globe,
  FileKey2,
  ClipboardList,
  Fingerprint,
  CheckCircle2,
  EyeOff,
  Copy,
  Keyboard,
  Zap,
  Dice5,
  Folder,
  Usb,
  Info,
  ExternalLink,
  RefreshCw,
  Rows3,
  ALargeSmall,
  Contrast,
  Sparkles,
  ImageIcon,
  HardDriveDownload,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useTheme } from "next-themes";
import { useI18n } from "@/i18n";
import { isInvalidShortcut } from "@/lib/errors";
import { useSettingsStore } from "@/stores/settings";
import { useAppStore, isTauri } from "@/stores/app";
import { EmergencyKit } from "@/components/EmergencyKit";
import { HotkeyInput } from "@/components/HotkeyInput";
import { Toggle } from "@/components/settings/ui/Toggle";
import {
  ExportModal,
  ImportModal,
  ChangePasswordModal,
  DeleteDataModal,
  DecoySetModal,
  DecoyRemoveModal,
  HwKeyEnableModal,
  HwKeyDisableModal,
} from "@/components/settings/modals";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const SECTIONS = [
  { id: "security", icon: Shield },
  { id: "hotkeys", icon: Keyboard },
  { id: "appearance", icon: Monitor },
  { id: "data", icon: FileKey2 },
  { id: "extension", icon: Globe },
  { id: "about", icon: Info },
  { id: "danger", icon: AlertTriangle },
] as const;

/** РћС„РёС†РёР°Р»СЊРЅРѕРµ СЂР°СЃС€РёСЂРµРЅРёРµ Mynx РІ Chrome Web Store */
const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/mynx/kjgmcffggjpmghjmhkhdiandaoefkmpb";

/** Р”РµС„РѕР»С‚РЅС‹Р№ С…РѕС‚РєРµР№ В«СЂР°Р·РІРµСЂРЅСѓС‚СЊ РёР· С‚СЂРµСЏВ» (СЃРѕРІРїР°РґР°РµС‚ СЃ Р±СЌРєРµРЅРґРѕРј) */
const TRAY_HOTKEY_DEFAULT = "Ctrl+Shift+M";

export function Settings({ isOpen, onClose }: SettingsProps) {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();

  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const clipboardClearSeconds = useSettingsStore((s) => s.clipboardClearSeconds);
  const clipboardClearEnabled = useSettingsStore((s) => s.clipboardClearEnabled);
  const glassIntensity = useSettingsStore((s) => s.glassIntensity);
  const setAutoLockMinutes = useSettingsStore((s) => s.setAutoLockMinutes);
  const setClipboardClearSeconds = useSettingsStore((s) => s.setClipboardClearSeconds);
  const setClipboardClearEnabled = useSettingsStore((s) => s.setClipboardClearEnabled);
  const lockOnMinimize = useSettingsStore((s) => s.lockOnMinimize);
  const setLockOnMinimize = useSettingsStore((s) => s.setLockOnMinimize);
  const decoyEnabled = useAppStore((s) => s.decoyEnabled);
  const setGlassIntensity = useSettingsStore((s) => s.setGlassIntensity);
  const hotkeyQuickAdd = useSettingsStore((s) => s.hotkeyQuickAdd);
  const hotkeyAutoType = useSettingsStore((s) => s.hotkeyAutoType);
  const setHotkeyQuickAdd = useSettingsStore((s) => s.setHotkeyQuickAdd);
  const setHotkeyAutoType = useSettingsStore((s) => s.setHotkeyAutoType);
  const hotkeyGenerator = useSettingsStore((s) => s.hotkeyGenerator);
  const setHotkeyGenerator = useSettingsStore((s) => s.setHotkeyGenerator);
  const hotkeyLock = useSettingsStore((s) => s.hotkeyLock);
  const setHotkeyLock = useSettingsStore((s) => s.setHotkeyLock);
  const hotkeySecurePaste = useSettingsStore((s) => s.hotkeySecurePaste);
  const setHotkeySecurePaste = useSettingsStore((s) => s.setHotkeySecurePaste);
  const downloadPath = useSettingsStore((s) => s.downloadPath);
  const setDownloadPath = useSettingsStore((s) => s.setDownloadPath);
  const trashRetentionDays = useSettingsStore((s) => s.trashRetentionDays);
  const setTrashRetentionDays = useSettingsStore((s) => s.setTrashRetentionDays);
  const backupEnabled = useSettingsStore((s) => s.backupEnabled);
  const backupIntervalMinutes = useSettingsStore((s) => s.backupIntervalMinutes);
  const backupPath = useSettingsStore((s) => s.backupPath);
  const backupKeepCount = useSettingsStore((s) => s.backupKeepCount);
  const setBackupEnabled = useSettingsStore((s) => s.setBackupEnabled);
  const setBackupIntervalMinutes = useSettingsStore((s) => s.setBackupIntervalMinutes);
  const setBackupPath = useSettingsStore((s) => s.setBackupPath);
  const setBackupKeepCount = useSettingsStore((s) => s.setBackupKeepCount);
  const passwordHideSeconds = useSettingsStore((s) => s.passwordHideSeconds);
  const setPasswordHideSeconds = useSettingsStore((s) => s.setPasswordHideSeconds);
  const clipboardHistoryDisabled = useSettingsStore((s) => s.clipboardHistoryDisabled);
  const setClipboardHistoryDisabled = useSettingsStore((s) => s.setClipboardHistoryDisabled);
  const activeVault = useAppStore((s) => s.activeVault);

  // Р’РЅРµС€РЅРёР№ РІРёРґ / a11y
  const density = useSettingsStore((s) => s.density);
  const setDensity = useSettingsStore((s) => s.setDensity);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const highContrast = useSettingsStore((s) => s.highContrast);
  const setHighContrast = useSettingsStore((s) => s.setHighContrast);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const setReduceMotion = useSettingsStore((s) => s.setReduceMotion);
  const faviconAutoFetch = useSettingsStore((s) => s.faviconAutoFetch);
  const setFaviconAutoFetch = useSettingsStore((s) => s.setFaviconAutoFetch);

  // РЎС‚Р°С‚СѓСЃ Р°РІС‚РѕР±СЌРєР°РїР°
  const lastBackupAt = useSettingsStore((s) => s.lastBackupAt);
  const lastBackupOk = useSettingsStore((s) => s.lastBackupOk);
  const setLastBackup = useSettingsStore((s) => s.setLastBackup);
  const [backupRunning, setBackupRunning] = useState(false);

  const [activeSection, setActiveSection] = useState<string>("security");
  const [showDanger, setShowDanger] = useState(false);
  const [emergencyKitOpen, setEmergencyKitOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [decoySetOpen, setDecoySetOpen] = useState(false);
  const [decoyRemoveOpen, setDecoyRemoveOpen] = useState(false);
  const [hwEnableOpen, setHwEnableOpen] = useState(false);
  const [hwDisableOpen, setHwDisableOpen] = useState(false);
  const [hwEnabled, setHwEnabled] = useState<boolean | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);

  // Windows Hello
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioError, setBioError] = useState("");

  // РҐРѕС‚РєРµР№ В«СЂР°Р·РІРµСЂРЅСѓС‚СЊ РёР· С‚СЂРµСЏВ» (С…СЂР°РЅРёС‚СЃСЏ Рё РїСЂРёРјРµРЅСЏРµС‚СЃСЏ РЅР° Р±СЌРєРµРЅРґРµ)
  const [trayHotkey, setTrayHotkey] = useState("");
  const [trayHotkeyError, setTrayHotkeyError] = useState("");
  const trayHotkeyApplied = useRef<string | null>(null);

  // РђРІС‚РѕРѕР±РЅРѕРІР»РµРЅРёСЏ
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    invoke<string>("get_api_token")
      .then(setApiToken)
      .catch(() => setApiToken(""));
    if (isTauri) {
      useAppStore
        .getState()
        .hwKeyStatus()
        .then(setHwEnabled)
        .catch(() => setHwEnabled(null));
      useAppStore
        .getState()
        .refreshDecoyStatus()
        .catch(() => {});

      // Windows Hello: РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ РЅР° СѓСЃС‚СЂРѕР№СЃС‚РІРµ Рё СЃС‚Р°С‚СѓСЃ РґР»СЏ Р°РєС‚РёРІРЅРѕРіРѕ vault
      setBioError("");
      invoke<boolean>("biometry_is_available")
        .then(async (available) => {
          setBioAvailable(available);
          if (!available || !activeVault) {
            setBioEnabled(false);
            return;
          }
          const enabled = await invoke<boolean>("biometry_is_enabled", {
            request: { vault_id: activeVault },
          });
          setBioEnabled(enabled);
        })
        .catch(() => {
          setBioAvailable(null);
          setBioEnabled(false);
        });

      // РўРµРєСѓС‰РёР№ С…РѕС‚РєРµР№ С‚СЂРµСЏ (null = РѕС‚РєР»СЋС‡С‘РЅ)
      invoke<string | null>("tray_hotkey_get")
        .then((s) => {
          setTrayHotkey(s ?? "");
          trayHotkeyApplied.current = s ?? "";
        })
        .catch(() => {});

      getVersion()
        .then(setAppVersion)
        .catch(() => setAppVersion(""));
    }
  }, [isOpen, activeVault]);

  const copyToken = async () => {
    if (!apiToken) return;
    await navigator.clipboard.writeText(apiToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  /** Р СѓС‡РЅРѕР№ Р±СЌРєР°Рї С‚РѕР№ Р¶Рµ РєРѕРјР°РЅРґРѕР№, С‡С‚Рѕ Рё С€РµРґСѓР»РµСЂ */
  const runBackupNow = async () => {
    if (!isTauri || !activeVault || backupRunning) return;
    setBackupRunning(true);
    try {
      await invoke("vault_backup", {
        request: {
          vault_id: activeVault,
          backup_path: backupPath,
          keep_count: backupKeepCount,
        },
      });
      setLastBackup(Date.now(), true);
    } catch (e) {
      console.error("Manual backup failed:", e);
      setLastBackup(Date.now(), false);
    } finally {
      setBackupRunning(false);
    }
  };

  /** Р’РєР»СЋС‡РµРЅРёРµ/РІС‹РєР»СЋС‡РµРЅРёРµ Windows Hello РґР»СЏ Р°РєС‚РёРІРЅРѕРіРѕ vault (vault СЂР°Р·Р±Р»РѕРєРёСЂРѕРІР°РЅ) */
  const toggleBiometry = async (v: boolean) => {
    if (!isTauri || !activeVault) return;
    setBioError("");
    try {
      if (v) {
        await invoke("biometry_enable", { request: { vault_id: activeVault } });
        setBioEnabled(true);
      } else {
        await invoke("biometry_disable", { request: { vault_id: activeVault } });
        setBioEnabled(false);
      }
    } catch (e) {
      const raw = String(e ?? "");
      // РћС‚РјРµРЅР° СЃРёСЃС‚РµРјРЅРѕРіРѕ РґРёР°Р»РѕРіР° вЂ” РЅРµ РѕС€РёР±РєР°, РїСЂРѕСЃС‚Рѕ РЅРµ РјРµРЅСЏРµРј СЃРѕСЃС‚РѕСЏРЅРёРµ
      if (raw.includes("biometry_cancelled")) return;
      setBioError(
        raw.includes("biometry_requires_real_vault")
          ? t("biometryDecoyError")
          : t("biometryToggleError")
      );
    }
  };

  /** РџСЂРёРјРµРЅРёС‚СЊ С…РѕС‚РєРµР№ С‚СЂРµСЏ: РїСѓСЃС‚Р°СЏ СЃС‚СЂРѕРєР° = РѕС‚РєР»СЋС‡РёС‚СЊ. Р‘СЌРєРµРЅРґ РїСЂРё СЃРјРµРЅРµ
   *  РїРµСЂРµСЂРµРіРёСЃС‚СЂРёСЂСѓРµС‚ РІСЃРµ РіР»РѕР±Р°Р»СЊРЅС‹Рµ С€РѕСЂС‚РєР°С‚С‹ вЂ” РїРѕРґРЅРёРјР°РµРј epoch, С‡С‚РѕР±С‹
   *  VaultScreen РїРµСЂРµРІРµСЃРёР» СЃРІРѕРё РѕР±СЂР°Р±РѕС‚С‡РёРєРё. */
  const applyTrayHotkey = async (value: string) => {
    if (!isTauri) return;
    const shortcut = value.trim();
    // РќРµ РґС‘СЂРіР°РµРј Р±СЌРєРµРЅРґ, РµСЃР»Рё РЅРёС‡РµРіРѕ РЅРµ РёР·РјРµРЅРёР»РѕСЃСЊ (blur Р±РµР· РїСЂР°РІРѕРє)
    if (trayHotkeyApplied.current !== null && shortcut === trayHotkeyApplied.current) {
      setTrayHotkeyError("");
      return;
    }
    try {
      await invoke("tray_hotkey_set", { shortcut: shortcut || null });
      setTrayHotkey(shortcut);
      trayHotkeyApplied.current = shortcut;
      setTrayHotkeyError("");
      useSettingsStore.getState().bumpHotkeysEpoch();
    } catch (e) {
      setTrayHotkeyError(
        isInvalidShortcut(e)
          ? t("hotkeyInvalid")
          : String(e ?? "")
      );
    }
  };

  const sectionTitle = (id: string) => {
    switch (id) {
      case "security":
        return t("settingsSecurity");
      case "hotkeys":
        return t("settingsHotkeys");
      case "appearance":
        return t("settingsAppearance");
      case "data":
        return t("settingsData");
      case "extension":
        return t("settingsBrowserExtension");
      case "about":
        return t("settingsAbout");
      case "danger":
        return t("settingsDanger");
      default:
        return id;
    }
  };

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
            <GlassCard className="w-full max-w-4xl max-h-[90vh] flex flex-col pointer-events-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: "var(--divider)" }}>
                <div className="flex items-center gap-3">
                  <div className="icon-badge neutral w-10 h-10">
                    <Shield className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-semibold t1">{t("settingsTitle")}</h2>
                </div>
                <button onClick={onClose} className="icon-btn">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="w-48 flex-shrink-0 border-r overflow-y-auto p-3 space-y-1" style={{ borderColor: "var(--divider)" }}>
                  {SECTIONS.map((s) => {
                    const Icon = s.icon;
                    const isActive = activeSection === s.id;
                    if (s.id === "hotkeys" && !isTauri) return null;
                    if (s.id === "about" && !isTauri) return null;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveSection(s.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          isActive
                            ? "soft-accent"
                            : "t2 hover:bg-[var(--btn-ghost-bg)] hover:t1"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{sectionTitle(s.id)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {activeSection === "security" && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("autoLock")}</span>
                          </div>
                          <span className="text-sm t2 font-mono">
                            {t("autoLockMin", autoLockMinutes)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={60}
                          value={autoLockMinutes}
                          onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                          className="range"
                        />
                      </div>

                      {!isTauri && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <ClipboardList className="w-4 h-4 t3" />
                              <span className="text-sm t1">{t("clipboardClear")}</span>
                            </div>
                            <span className="text-sm t2 font-mono">
                              {t("clipboardClearSec", clipboardClearSeconds)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={5}
                            max={120}
                            step={5}
                            value={clipboardClearSeconds}
                            onChange={(e) => setClipboardClearSeconds(Number(e.target.value))}
                            className="range"
                            disabled={!clipboardClearEnabled}
                          />
                          <Toggle
                            label={t("clipboardClear")}
                            checked={clipboardClearEnabled}
                            onChange={setClipboardClearEnabled}
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm t1">{t("autoHidePasswords")}</span>
                          <span className="text-sm t2 font-mono">{t("autoHideSeconds", passwordHideSeconds)}</span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={300}
                          step={5}
                          value={passwordHideSeconds}
                          onChange={(e) => setPasswordHideSeconds(Number(e.target.value))}
                          className="range"
                        />
                      </div>

                      {isTauri && (
                        <div className="space-y-1">
                          <Toggle
                            label={t("lockOnMinimize")}
                            checked={lockOnMinimize}
                            onChange={setLockOnMinimize}
                          />
                          <p className="text-xs t3">{t("lockOnMinimizeHint")}</p>
                        </div>
                      )}

                      <Toggle
                        label={t("clipboardHistory")}
                        checked={clipboardHistoryDisabled}
                        onChange={setClipboardHistoryDisabled}
                      />
                      {isTauri && bioAvailable !== null && (
                        <div className="space-y-1">
                          <Toggle
                            label={t("biometric")}
                            checked={bioEnabled}
                            onChange={(v) => void toggleBiometry(v)}
                            disabled={!bioAvailable}
                            icon={<Fingerprint className="w-4 h-4 t3" />}
                          />
                          {!bioAvailable && (
                            <p className="text-xs t3">{t("biometryNotAvailable")}</p>
                          )}
                          {bioError && (
                            <p className="text-xs" style={{ color: "var(--danger)" }}>
                              {bioError}
                            </p>
                          )}
                        </div>
                      )}

                      {isTauri && (
                        <div
                          className="space-y-2 pt-4"
                          style={{ borderTop: "1px solid var(--divider)" }}
                        >
                          <div className="flex items-center gap-2">
                            <EyeOff className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("decoyLayer")}</span>
                            <span
                              className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                                decoyEnabled ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {decoyEnabled ? t("decoyStatusEnabled") : t("decoyStatusDisabled")}
                            </span>
                          </div>
                          <p className="text-xs t3">{t("decoyLayerDesc")}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDecoySetOpen(true)}
                              className="btn-ghost flex-1 p-2.5 text-sm"
                            >
                              {decoyEnabled ? t("decoyChange") : t("decoySet")}
                            </button>
                            <button
                              onClick={() => setDecoyRemoveOpen(true)}
                              className="btn-ghost flex-1 p-2.5 text-sm"
                              disabled={!decoyEnabled}
                            >
                              {t("decoyRemove")}
                            </button>
                          </div>
                        </div>
                      )}

                      {isTauri && (
                        <div
                          className="space-y-2 pt-4"
                          style={{ borderTop: "1px solid var(--divider)" }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Usb className="w-4 h-4 t3" />
                              <span className="text-sm t1">{t("hwKey")}</span>
                            </div>
                            <span className="text-xs t3">
                              {hwEnabled ? t("hwKeyStatusOn") : t("hwKeyStatusOff")}
                            </span>
                          </div>
                          <p className="text-xs t3">{t("hwKeyDesc")}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setHwEnableOpen(true)}
                              disabled={hwEnabled !== false}
                              className="btn-ghost flex-1 p-2.5 text-sm"
                            >
                              {t("hwKeyEnable")}
                            </button>
                            <button
                              onClick={() => setHwDisableOpen(true)}
                              disabled={hwEnabled !== true}
                              className="btn-ghost flex-1 p-2.5 text-sm"
                            >
                              {t("hwKeyDisable")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeSection === "hotkeys" && isTauri && (
                    <div className="space-y-6">
                      <HotkeyInput
                        label={t("hotkeyQuickAdd")}
                        icon={<Zap className="w-4 h-4 t3" />}
                        value={hotkeyQuickAdd}
                        onChange={setHotkeyQuickAdd}
                      />
                      <HotkeyInput
                        label={t("hotkeyAutoType")}
                        icon={<Keyboard className="w-4 h-4 t3" />}
                        value={hotkeyAutoType}
                        onChange={setHotkeyAutoType}
                      />
                      <HotkeyInput
                        label={t("hotkeyGenerator")}
                        icon={<Dice5 className="w-4 h-4 t3" />}
                        value={hotkeyGenerator}
                        onChange={setHotkeyGenerator}
                      />
                      <HotkeyInput
                        label={t("hotkeyLock")}
                        icon={<Lock className="w-4 h-4 t3" />}
                        value={hotkeyLock}
                        onChange={setHotkeyLock}
                      />
                      <HotkeyInput
                        label={t("hotkeySecurePaste")}
                        icon={<ClipboardList className="w-4 h-4 t3" />}
                        value={hotkeySecurePaste}
                        onChange={setHotkeySecurePaste}
                      />
                      <p className="text-xs t3">{t("hotkeySecurePasteHint")}</p>

                      <div className="space-y-1.5 pt-4 divider border-t">
                        <HotkeyInput
                          label={t("hotkeyTray")}
                          icon={<Monitor className="w-4 h-4 t3" />}
                          value={trayHotkey}
                          placeholder={t("hotkeyTrayDisabled")}
                          backendManaged
                          onRecordingChange={(recording) => {
                            if (!isTauri) return;
                            void invoke("tray_hotkey_pause", { paused: recording }).then(() => {
                              if (!recording) useSettingsStore.getState().bumpHotkeysEpoch();
                            });
                          }}
                          onChange={(next) => void applyTrayHotkey(next)}
                        />
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => void applyTrayHotkey(TRAY_HOTKEY_DEFAULT)}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            title={t("hotkeyTrayReset")}
                          >
                            {t("hotkeyTrayReset")}
                          </button>
                          <button
                            onClick={() => void applyTrayHotkey("")}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            disabled={!trayHotkey.trim()}
                            title={t("hotkeyTrayClear")}
                          >
                            {t("hotkeyTrayClear")}
                          </button>
                        </div>
                        {trayHotkeyError ? (
                          <p className="text-xs" style={{ color: "var(--danger)" }}>
                            {trayHotkeyError}
                          </p>
                        ) : (
                          <p className="text-xs t3">{t("hotkeyTrayHint")}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {activeSection === "appearance" && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: "dark", label: t("themeDark"), icon: Moon },
                          { id: "light", label: t("themeLight"), icon: Sun },
                          { id: "system", label: t("themeSystem"), icon: Monitor },
                        ].map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.id}
                              onClick={() => setTheme(item.id)}
                              className={`segment ${theme === item.id ? "active" : ""}`}
                            >
                              <Icon className="w-4 h-4" />
                              {item.label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm t1">{t("glassIntensity")}</span>
                          <span className="text-sm t2 font-mono">{glassIntensity}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={glassIntensity}
                          onChange={(e) => setGlassIntensity(Number(e.target.value))}
                          className="range"
                        />
                      </div>

                      {/* РџР»РѕС‚РЅРѕСЃС‚СЊ РёРЅС‚РµСЂС„РµР№СЃР° */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Rows3 className="w-4 h-4 t3" />
                          <span className="text-sm t1">{t("densityLabel")}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            ["compact", t("densityCompact")],
                            ["cozy", t("densityCozy")],
                            ["spacious", t("densitySpacious")],
                          ] as const).map(([id, label]) => (
                            <button
                              key={id}
                              onClick={() => setDensity(id)}
                              className={`segment ${density === id ? "active" : ""}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* РњР°СЃС€С‚Р°Р± С€СЂРёС„С‚Р° (a11y) */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ALargeSmall className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("uiScaleLabel")}</span>
                          </div>
                          <span className="text-sm t2 font-mono">{uiScale}%</span>
                        </div>
                        <input
                          type="range"
                          min={85}
                          max={130}
                          step={5}
                          value={uiScale}
                          onChange={(e) => setUiScale(Number(e.target.value))}
                          className="range"
                        />
                      </div>

                      {/* РљРѕРЅС‚СЂР°СЃС‚РЅРѕСЃС‚СЊ Рё Р°РЅРёРјР°С†РёСЏ (a11y) */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Contrast className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("highContrastLabel")}</span>
                          </div>
                          <Toggle label="" checked={highContrast} onChange={setHighContrast} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("reduceMotionLabel")}</span>
                            <span className="text-xs t3">{t("reduceMotionHint")}</span>
                          </div>
                          <Toggle label="" checked={reduceMotion} onChange={setReduceMotion} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ImageIcon className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("faviconAutoFetchLabel")}</span>
                          </div>
                          <Toggle label="" checked={faviconAutoFetch} onChange={setFaviconAutoFetch} />
                        </div>
                      </div>

                      <div className="space-y-2 pt-4 divider border-t">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 t3" />
                          <span className="text-sm t1">{t("language")}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: "en", label: "English" },
                            { id: "ru", label: "Р СѓСЃСЃРєРёР№" },
                          ].map((l) => (
                            <button
                              key={l.id}
                              onClick={() => setLang(l.id as "en" | "ru")}
                              className={`segment !flex-row !py-2.5 ${lang === l.id ? "active" : ""}`}
                            >
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSection === "data" && (
                    <div className="space-y-6">
                      <button
                        onClick={() => setEmergencyKitOpen(true)}
                        className="btn-ghost w-full justify-start p-3 text-sm"
                      >
                        <FileKey2 className="w-4 h-4" style={{ color: "var(--warn)" }} />
                        <span className="flex-1 text-left">
                          {t("emergencyKitBtn")}
                          <span className="block text-xs t3">{t("emergencyKitDesc")}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setImportOpen(true)}
                        className="btn-ghost w-full justify-start p-3 text-sm"
                      >
                        <Download className="w-4 h-4" style={{ color: "var(--accent)" }} />
                        <span className="flex-1 text-left">{t("importBtn")}</span>
                      </button>
                      <button
                        onClick={() => setExportOpen(true)}
                        className="btn-ghost w-full justify-start p-3 text-sm"
                      >
                        <Upload className="w-4 h-4" style={{ color: "var(--info)" }} />
                        <span className="flex-1 text-left">{t("exportBtn")}</span>
                      </button>

                      <div className="space-y-2 pt-4 divider border-t">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Trash2 className="w-4 h-4 t3" />
                            <span className="text-sm t1">{t("trashRetention")}</span>
                          </div>
                          <span className="text-sm t2 font-mono">
                            {trashRetentionDays === 0
                              ? t("trashRetentionForever")
                              : t("trashRetentionDays", trashRetentionDays)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={365}
                          step={1}
                          value={trashRetentionDays}
                          onChange={(e) => setTrashRetentionDays(Number(e.target.value))}
                          className="range"
                        />
                      </div>

                      <div className="space-y-2 pt-4 divider border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-sm t1">{t("backupTitle")}</span>
                          <Toggle
                            label=""
                            checked={backupEnabled}
                            onChange={setBackupEnabled}
                          />
                        </div>
                        {backupEnabled && (
                          <>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs t3">{t("backupInterval")}</span>
                                <span className="text-xs t2 font-mono">{t("backupIntervalMin", backupIntervalMinutes)}</span>
                              </div>
                              {/* РџСЂРµСЃРµС‚С‹ СЂР°СЃРїРёСЃР°РЅРёСЏ */}
                              <div className="grid grid-cols-5 gap-1.5">
                                {[15, 60, 360, 1440, 10080].map((m) => (
                                  <button
                                    key={m}
                                    onClick={() => setBackupIntervalMinutes(m)}
                                    className={`segment !text-xs ${backupIntervalMinutes === m ? "active" : ""}`}
                                    title={t("backupIntervalMin", m)}
                                  >
                                    {m < 60 ? `${m}m` : m < 1440 ? `${m / 60}h` : `${m / 1440}d`}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="range"
                                min={5}
                                max={720}
                                step={5}
                                value={backupIntervalMinutes}
                                onChange={(e) => setBackupIntervalMinutes(Number(e.target.value))}
                                className="range"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs t3">{t("backupPath")}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={backupPath}
                                  onChange={(e) => setBackupPath(e.target.value)}
                                  placeholder={t("backupPath")}
                                  className="field flex-1 rounded-lg px-3 py-2 text-sm font-mono"
                                />
                                <button
                                  onClick={async () => {
                                    if (!isTauri) return;
                                    const path = await open({ directory: true });
                                    if (path) setBackupPath(path);
                                  }}
                                  className="icon-btn"
                                  title={t("browse")}
                                  type="button"
                                >
                                  <Folder className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs t3">{t("backupKeepCount")}</span>
                                <span className="text-xs t2 font-mono">{backupKeepCount}</span>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={50}
                                step={1}
                                value={backupKeepCount}
                                onChange={(e) => setBackupKeepCount(Number(e.target.value))}
                                className="range"
                              />
                            </div>

                            {/* РЎС‚Р°С‚СѓСЃ РїРѕСЃР»РµРґРЅРµРіРѕ Р±СЌРєР°РїР° + СЂСѓС‡РЅРѕР№ Р·Р°РїСѓСЃРє */}
                            <div
                              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5"
                              style={{
                                background: "var(--field-bg)",
                                border: "1px solid var(--field-border)",
                              }}
                            >
                              <div className="min-w-0">
                                <p className="text-xs t2 truncate">
                                  {lastBackupAt === null
                                    ? t("backupNever")
                                    : `${t("backupLast")}: ${new Date(lastBackupAt).toLocaleString()}`}
                                </p>
                                <p
                                  className="text-xs flex items-center gap-1"
                                  style={{
                                    color:
                                      lastBackupAt === null
                                        ? "var(--t3, var(--divider))"
                                        : lastBackupOk
                                        ? "var(--c-strong)"
                                        : "var(--danger)",
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full inline-block"
                                    style={{
                                      background:
                                        lastBackupAt === null
                                          ? "var(--divider)"
                                          : lastBackupOk
                                          ? "var(--c-strong)"
                                          : "var(--danger)",
                                    }}
                                  />
                                  {lastBackupAt === null
                                    ? t("backupStatusIdle")
                                    : lastBackupOk
                                    ? t("backupStatusOk")
                                    : t("backupStatusFail")}
                                </p>
                              </div>
                              <button
                                onClick={runBackupNow}
                                disabled={backupRunning || !activeVault}
                                className="btn-ghost px-3 py-1.5 text-xs shrink-0"
                              >
                                {backupRunning ? (
                                  <motion.span
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                                    className="inline-flex"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </motion.span>
                                ) : (
                                  <HardDriveDownload className="w-3.5 h-3.5" />
                                )}
                                {t("backupNow")}
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="space-y-2 pt-4 divider border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-sm t1">{t("downloadPath")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={downloadPath}
                            onChange={(e) => setDownloadPath(e.target.value)}
                            placeholder={t("downloadPath")}
                            className="field flex-1 rounded-lg px-3 py-2 text-sm font-mono"
                          />
                          <button
                            onClick={async () => {
                              if (!isTauri) return;
                              const path = await open({ directory: true });
                              if (path) setDownloadPath(path);
                            }}
                            className="icon-btn"
                            title={t("browse")}
                            type="button"
                          >
                            <Folder className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSection === "extension" && (
                    <div className="space-y-6">
                      <p className="text-sm t2">{t("browserExtensionDesc")}</p>

                      <button
                        onClick={() => {
                          if (isTauri) {
                            void openUrl(EXTENSION_STORE_URL);
                          } else {
                            window.open(EXTENSION_STORE_URL, "_blank");
                          }
                        }}
                        className="btn-primary w-full py-2.5 text-sm"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {t("browserExtensionInstall")}
                      </button>

                      <p className="text-xs t3">{t("browserExtensionPairingHint")}</p>

                      <p className="text-xs t3">{t("browserExtensionTokenHint")}</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={apiToken}
                          className="field rounded-xl px-3 py-2 text-sm font-mono flex-1"
                        />
                        <button
                          onClick={copyToken}
                          className="icon-btn"
                          title={t("browserExtensionCopyToken")}
                        >
                          {tokenCopied ? (
                            <CheckCircle2 className="w-4 h-4" style={{ color: "var(--accent)" }} />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {activeSection === "about" && isTauri && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <div className="icon-badge w-10 h-10">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold t1">{t("appName")}</p>
                          <p className="text-xs t3 font-mono">
                            {appVersion ? t("appVersion", appVersion) : "вЂ¦"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2 pt-4 divider border-t">
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 t3" />
                          <span className="text-sm t1">{t("updaterTitle")}</span>
                        </div>

                        <button
                          disabled
                          className="btn-ghost w-full py-2.5 text-sm opacity-50 cursor-not-allowed"
                        >
                          {t("updaterCheck")}
                        </button>
                        <p className="text-xs t3">{t("updaterSiteSoon")}</p>
                      </div>
                    </div>
                  )}

                  {activeSection === "danger" && (
                    <div className="space-y-6">
                      {!showDanger ? (
                        <button
                          onClick={() => setShowDanger(true)}
                          className="w-full py-2 text-sm transition-colors"
                          style={{ color: "var(--danger-soft-text)" }}
                        >
                          {t("showDanger")}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <button
                            onClick={() => setChangePwOpen(true)}
                            className="btn-ghost w-full justify-start p-3 text-sm"
                          >
                            <Lock className="w-4 h-4" style={{ color: "var(--danger)" }} />
                            <span className="flex-1 text-left">{t("changeMasterPassword")}</span>
                          </button>
                          <button
                            onClick={() => setDeleteOpen(true)}
                            className="btn-ghost w-full justify-start p-3 text-sm"
                          >
                            <Trash2 className="w-4 h-4" style={{ color: "var(--danger)" }} />
                            <span className="flex-1 text-left">{t("deleteAllData")}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-2 text-xs t3 pt-4 pb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                    {t("autoSaved")}
                  </div>
                </div>
              </div>

              <EmergencyKit
                isOpen={emergencyKitOpen}
                onClose={() => setEmergencyKitOpen(false)}
              />
            </GlassCard>
          </motion.div>

          <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} />
          <ImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} />
          <ChangePasswordModal isOpen={changePwOpen} onClose={() => setChangePwOpen(false)} />
          <DecoySetModal isOpen={decoySetOpen} onClose={() => setDecoySetOpen(false)} />
          <DecoyRemoveModal isOpen={decoyRemoveOpen} onClose={() => setDecoyRemoveOpen(false)} />
          <HwKeyEnableModal
            isOpen={hwEnableOpen}
            onClose={() => setHwEnableOpen(false)}
            onChanged={setHwEnabled}
          />
          <HwKeyDisableModal
            isOpen={hwDisableOpen}
            onClose={() => setHwDisableOpen(false)}
            onChanged={setHwEnabled}
          />
          <DeleteDataModal
            isOpen={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onDeleted={onClose}
          />
    </motion.div>
  );
}

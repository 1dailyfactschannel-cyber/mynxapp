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
  Eye,
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
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useTheme } from "next-themes";
import { useI18n } from "@/i18n";
import { useSettingsStore } from "@/stores/settings";
import { useAppStore, isTauri } from "@/stores/app";
import { EmergencyKit } from "@/components/EmergencyKit";
import { HotkeyInput } from "@/components/HotkeyInput";
import { useVaultStore, calculateStrength } from "@/stores/vault";
import { useCategoryStore } from "@/stores/categories";
import {
  parseImport,
  wipeImportResult,
  type ImportFormat,
  type ImportResult,
} from "@/lib/import";

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

/** Официальное расширение Mynx в Chrome Web Store */
const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/mynx/kjgmcffggjpmghjmhkhdiandaoefkmpb";

/** Дефолтный хоткей «развернуть из трея» (совпадает с бэкендом) */
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

  // Хоткей «развернуть из трея» (хранится и применяется на бэкенде)
  const [trayHotkey, setTrayHotkey] = useState("");
  const [trayHotkeyError, setTrayHotkeyError] = useState("");
  const trayHotkeyApplied = useRef<string | null>(null);

  // Автообновления
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

      // Windows Hello: доступность на устройстве и статус для активного vault
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

      // Текущий хоткей трея (null = отключён)
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

  /** Включение/выключение Windows Hello для активного vault (vault разблокирован) */
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
      // Отмена системного диалога — не ошибка, просто не меняем состояние
      if (raw.includes("biometry_cancelled")) return;
      setBioError(
        raw.includes("biometry_requires_real_vault")
          ? t("biometryDecoyError")
          : t("biometryToggleError")
      );
    }
  };

  /** Применить хоткей трея: пустая строка = отключить. Бэкенд при смене
   *  перерегистрирует все глобальные шорткаты — поднимаем epoch, чтобы
   *  VaultScreen перевесил свои обработчики. */
  const applyTrayHotkey = async (value: string) => {
    if (!isTauri) return;
    const shortcut = value.trim();
    // Не дёргаем бэкенд, если ничего не изменилось (blur без правок)
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
        String(e ?? "").includes("invalid_shortcut")
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

                      <div className="space-y-2 pt-4 divider border-t">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 t3" />
                          <span className="text-sm t1">{t("language")}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: "en", label: "English" },
                            { id: "ru", label: "Русский" },
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
                            {appVersion ? t("appVersion", appVersion) : "…"}
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

/* ================================================================== */
/* Общие элементы модалок действий                                     */
/* ================================================================== */

function ActionModal({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[55]"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-[60] p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-md pointer-events-auto">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {icon}
                <h3 className="text-base font-semibold t1">{title}</h3>
              </div>
              <button onClick={onClose} className="icon-btn">
                <X className="w-4 h-4" />
              </button>
            </div>
            {children}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

function PasswordField({
  value,
  onChange,
  placeholder,
  onEnter,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="field rounded-xl px-3.5 py-2.5 pr-10 text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 t3"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs t3 mb-1.5">{children}</span>;
}

/* ================================================================== */
/* Экспорт зашифрованной копии                                         */
/* ================================================================== */

function ExportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const exportVault = useAppStore((s) => s.exportVault);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);

  const reset = () => {
    setPassword("");
    setBusy(false);
    setError(null);
    setSavedPath(null);
    setDownloadStarted(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await exportVault(password);
      if (result === "") {
        // Пользователь отменил диалог сохранения
        close();
        return;
      }
      if (result === "download") setDownloadStarted(true);
      else setSavedPath(result);
    } catch (e) {
      setError(
        String(e).includes("wrong_password")
          ? t("wrongCurrentPassword")
          : `${t("exportFailed")}: ${String(e)}`
      );
    } finally {
      setBusy(false);
    }
  };

  const finished = savedPath !== null || downloadStarted;

  if (!isOpen) return null;


  return (
        <ActionModal
          title={t("exportModalTitle")}
          icon={
            <div className="icon-badge neutral w-9 h-9">
              <Upload className="w-4 h-4" />
            </div>
          }
          onClose={close}
        >
          {finished ? (
            <>
              <div
                className="flex items-start gap-2 text-sm"
                style={{ color: "var(--accent)" }}
              >
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                {downloadStarted ? (
                  <span>{t("exportDownloadStarted")}</span>
                ) : (
                  <span className="break-all">
                    {t("exportSuccess")} {savedPath}
                  </span>
                )}
              </div>
              <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
                {t("close")}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm t2">{t("exportModalDesc")}</p>
              <div>
                <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder={t("masterPassword")}
                  onEnter={submit}
                  autoFocus
                />
              </div>
              {error && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
                  {t("cancel")}
                </button>
                <button
                  onClick={submit}
                  disabled={!password || busy}
                  className="btn-primary flex-1 py-2.5 text-sm"
                >
                  {busy ? t("working") : t("exportSubmit")}
                </button>
              </div>
            </>
          )}
        </ActionModal>

  );
}

/* ================================================================== */
/* Импорт паролей из сторонних менеджеров                              */
/* ================================================================== */

const IMPORT_FORMATS: { id: ImportFormat; labelKey: string }[] = [
  { id: "auto", labelKey: "importFormatAuto" },
  { id: "bitwarden-json", labelKey: "importFmtBitwardenJson" },
  { id: "bitwarden-csv", labelKey: "importFmtBitwardenCsv" },
  { id: "onepassword-csv", labelKey: "importFmt1Password" },
  { id: "keepass-csv", labelKey: "importFmtKeePass" },
  { id: "chrome-csv", labelKey: "importFmtChrome" },
];

function ImportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const addEntry = useVaultStore((s) => s.addEntry);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Зеркало parsed в ref, чтобы сброс при закрытии не тащил parsed в deps эффекта
  const parsedRef = useRef<ImportResult | null>(null);

  const [format, setFormat] = useState<ImportFormat>("auto");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ imported: number; skipped: number; errors: number } | null>(
    null
  );

  const wipeParsed = () => {
    if (parsedRef.current) {
      wipeImportResult(parsedRef.current);
      parsedRef.current = null;
    }
    setParsed(null);
  };

  // Сброс состояния и очистка секретов из памяти при закрытии
  useEffect(() => {
    if (isOpen) return;
    if (parsedRef.current) {
      wipeImportResult(parsedRef.current);
      parsedRef.current = null;
    }
    setFormat("auto");
    setFile(null);
    setParsed(null);
    setParseError(null);
    setBusy(false);
    setDone(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [isOpen]);

  const close = () => {
    wipeParsed();
    onClose();
  };

  const parseFile = async (f: File, fmt: ImportFormat) => {
    setBusy(true);
    setParseError(null);
    setDone(null);
    wipeParsed();
    try {
      const text = await f.text();
      const result = parseImport(fmt, text);
      // Сырая строка text больше не нужна: секреты живут только в result
      // и затираются wipeImportResult после импорта/закрытия
      parsedRef.current = result;
      setParsed(result);
    } catch (e) {
      setParseError(`${t("importFailed")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const runImport = () => {
    if (!parsed || busy) return;
    setBusy(true);
    let imported = 0;
    let errors = 0;
    try {
      // Папки исходного файла → категории vault
      const catStore = useCategoryStore.getState();
      const folderToCategory = new Map<string, string>();
      for (const folder of parsed.folders) {
        const existing = catStore.categories.find(
          (c) => c.id === folder || c.label.toLowerCase() === folder.toLowerCase()
        );
        if (existing) {
          folderToCategory.set(folder, existing.id);
        } else {
          const created = catStore.addCategory(folder);
          folderToCategory.set(folder, created ? created.id : folder);
        }
      }

      for (const draft of parsed.drafts) {
        try {
          addEntry({
            id: crypto.randomUUID(),
            title: draft.title,
            username: draft.username,
            password: draft.password,
            url: draft.url,
            category: draft.category
              ? folderToCategory.get(draft.category) ?? draft.category
              : "",
            tags: [],
            favorite: draft.favorite,
            strength: calculateStrength(draft.password),
            icon: draft.title.charAt(0).toUpperCase() || "🔑",
            notes: draft.notes,
            totpSecret: draft.totpSecret,
            customFields: draft.customFields,
          });
          imported++;
        } catch {
          errors++;
        }
      }
      setDone({ imported, skipped: parsed.skipped, errors });
    } finally {
      wipeParsed();
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("importModalTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Download className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {done ? (
        <>
          <div className="flex items-start gap-2 text-sm" style={{ color: "var(--accent)" }}>
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t("importDone", done.imported, done.skipped, done.errors)}</span>
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("importModalDesc")}</p>
          <div>
            <FieldLabel>{t("importFormatLabel")}</FieldLabel>
            <select
              value={format}
              onChange={(e) => {
                const fmt = e.target.value as ImportFormat;
                setFormat(fmt);
                if (file) void parseFile(file, fmt);
              }}
              className="field rounded-xl px-3.5 py-2.5 text-sm w-full"
            >
              {IMPORT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  void parseFile(f, format);
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-ghost w-full justify-start p-3 text-sm"
            >
              <Folder className="w-4 h-4 t3" />
              <span className="flex-1 text-left truncate">
                {file ? file.name : t("importChooseFile")}
              </span>
            </button>
          </div>
          {parseError && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {parseError}
            </p>
          )}
          {parsed &&
            !parseError &&
            (parsed.drafts.length > 0 ? (
              <div className="text-sm t2 space-y-1">
                <p>{t("importPreview", parsed.drafts.length, parsed.folders.length)}</p>
                {parsed.skipped > 0 && (
                  <p className="text-xs t3">{t("importPreviewSkipped", parsed.skipped)}</p>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--warn)" }}>
                {t("importNoEntries")}
              </p>
            ))}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={runImport}
              disabled={!parsed || parsed.drafts.length === 0 || busy}
              className="btn-primary flex-1 py-2.5 text-sm"
            >
              {busy ? t("working") : t("importSubmit")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

/* ================================================================== */
/* Смена мастер-пароля                                                 */
/* ================================================================== */

function ChangePasswordModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const changeMasterPassword = useAppStore((s) => s.changeMasterPassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setBusy(false);
    setError(null);
    setDone(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    if (next.length < 8) {
      setError(t("pwTooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("passwordsMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeMasterPassword(current, next);
      setDone(true);
    } catch (e) {
      setError(
        String(e).includes("wrong_password")
          ? t("wrongCurrentPassword")
          : String(e)
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = current.length > 0 && next.length > 0 && confirm.length > 0 && !busy;

  if (!isOpen) return null;


  return (
        <ActionModal
          title={t("changePwTitle")}
          icon={
            <div className="icon-badge neutral w-9 h-9">
              <Lock className="w-4 h-4" />
            </div>
          }
          onClose={close}
        >
          {done ? (
            <>
              <div
                className="flex items-center gap-2 text-sm"
                style={{ color: "var(--accent)" }}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {t("changePwSuccess")}
              </div>
              <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
                {t("close")}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm t2">{t("changePwDesc")}</p>
              <div>
                <FieldLabel>{t("currentPassword")}</FieldLabel>
                <PasswordField
                  value={current}
                  onChange={setCurrent}
                  placeholder={t("currentPassword")}
                  autoFocus
                />
              </div>
              <div>
                <FieldLabel>{t("newPassword")}</FieldLabel>
                <PasswordField
                  value={next}
                  onChange={setNext}
                  placeholder={t("newPassword")}
                />
              </div>
              <div>
                <FieldLabel>{t("confirmPasswordLabel")}</FieldLabel>
                <PasswordField
                  value={confirm}
                  onChange={setConfirm}
                  placeholder={t("confirmPasswordLabel")}
                  onEnter={submit}
                />
              </div>
              {error && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
                  {t("cancel")}
                </button>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="btn-primary flex-1 py-2.5 text-sm"
                >
                  {busy ? t("working") : t("changePwSubmit")}
                </button>
              </div>
            </>
          )}
        </ActionModal>

  );
}

/* ================================================================== */
/* Удаление всех данных                                                */
/* ================================================================== */

function DeleteDataModal({
  isOpen,
  onClose,
  onDeleted,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const deleteAllData = useAppStore((s) => s.deleteAllData);

  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirmText("");
    setBusy(false);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const word = confirmText.trim().toUpperCase();
  const canDelete = (word === "DELETE" || word === "УДАЛИТЬ") && !busy;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAllData();
      reset();
      onDeleted(); // закрывает и настройки — приложение вернётся к онбордингу
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  if (!isOpen) return null;


  return (
        <ActionModal
          title={t("deleteModalTitle")}
          icon={
            <div className="icon-badge neutral w-9 h-9">
              <Trash2 className="w-4 h-4" style={{ color: "var(--danger)" }} />
            </div>
          }
          onClose={close}
        >
          <div
            className="flex items-start gap-2 text-sm"
            style={{ color: "var(--danger-soft-text)" }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{t("deleteModalDesc")}</p>
          </div>
          <div>
            <FieldLabel>{t("deleteTypeHint", t("deleteWord"))}</FieldLabel>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={t("deleteWord")}
              autoFocus
              className="field rounded-xl px-3.5 py-2.5 text-sm font-mono"
            />
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={submit}
              disabled={!canDelete}
              className="btn-primary flex-1 py-2.5 text-sm"
              style={{ background: "var(--danger)", boxShadow: "none" }}
            >
              {busy ? t("working") : t("deleteSubmit")}
            </button>
          </div>
        </ActionModal>

  );
}

/* ================================================================== */
/* Слой обмана: установка и отключение ложного пароля                  */
/* ================================================================== */

function DecoySetModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const setDecoyPassword = useAppStore((s) => s.setDecoyPassword);

  const [master, setMaster] = useState("");
  const [decoy, setDecoy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [oldDecoy, setOldDecoy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setMaster("");
    setDecoy("");
    setConfirm("");
    setOldDecoy("");
    setBusy(false);
    setError(null);
    setDone(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    if (decoy.length < 8) {
      setError(t("pwTooShort"));
      return;
    }
    if (decoy !== confirm) {
      setError(t("passwordsMismatch"));
      return;
    }
    if (decoy === master) {
      setError(t("decoyEqualsMaster"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setDecoyPassword(master, decoy, oldDecoy || undefined);
      setDone(true);
    } catch (e) {
      const msg = String(e);
      setError(
        msg.includes("decoy_equals_master")
          ? t("decoyEqualsMaster")
          : msg.includes("password_too_short")
          ? t("pwTooShort")
          : msg.includes("wrong_password")
          ? t("wrongCurrentPassword")
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = master.length > 0 && decoy.length > 0 && confirm.length > 0 && !busy;

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("decoySetTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <EyeOff className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {done ? (
        <>
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {t("decoySetSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("decoySetDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={master}
              onChange={setMaster}
              placeholder={t("masterPasswordLabel")}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>{t("decoyPasswordLabel")}</FieldLabel>
            <PasswordField
              value={decoy}
              onChange={setDecoy}
              placeholder={t("decoyPasswordLabel")}
            />
          </div>
          <div>
            <FieldLabel>{t("confirmPasswordLabel")}</FieldLabel>
            <PasswordField
              value={confirm}
              onChange={setConfirm}
              placeholder={t("confirmPasswordLabel")}
              onEnter={submit}
            />
          </div>
          <div>
            <FieldLabel>{t("decoyOldPasswordLabel")}</FieldLabel>
            <PasswordField
              value={oldDecoy}
              onChange={setOldDecoy}
              placeholder={t("decoyPasswordLabel")}
            />
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="btn-primary flex-1 py-2.5 text-sm"
            >
              {busy ? t("working") : t("save")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

function DecoyRemoveModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const removeDecoy = useAppStore((s) => s.removeDecoy);

  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setMaster("");
    setBusy(false);
    setError(null);
    setDone(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeDecoy(master);
      setDone(true);
    } catch (e) {
      const msg = String(e);
      setError(msg.includes("wrong_password") ? t("wrongCurrentPassword") : msg);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("decoyRemoveTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <EyeOff className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {done ? (
        <>
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {t("decoyRemoveSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("decoyRemoveDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={master}
              onChange={setMaster}
              placeholder={t("masterPasswordLabel")}
              onEnter={submit}
              autoFocus
            />
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={submit}
              disabled={!master || busy}
              className="btn-primary flex-1 py-2.5 text-sm"
              style={{ background: "var(--danger)", boxShadow: "none" }}
            >
              {busy ? t("working") : t("decoyRemove")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

/* ================================================================== */
/* Аппаратный ключ (флешка): включение и отключение                    */
/* ================================================================== */

function HwKeyEnableModal({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const enableHwKey = useAppStore((s) => s.enableHwKey);

  const [master, setMaster] = useState("");
  const [decoy, setDecoy] = useState("");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyfilePath, setKeyfilePath] = useState<string | null>(null);

  const reset = () => {
    setMaster("");
    setDecoy("");
    setDirectory("");
    setBusy(false);
    setError(null);
    setKeyfilePath(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const pickFolder = async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") setDirectory(dir);
    } catch (e) {
      console.error(e);
    }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = await enableHwKey(master, directory, decoy || undefined);
      setKeyfilePath(path);
      onChanged(true);
    } catch (e) {
      const msg = String(e);
      setError(
        msg.includes("hw_key_already_enabled")
          ? t("hwKeyStatusOn")
          : msg.includes("wrong_password")
          ? t("wrongCurrentPassword")
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = master.length > 0 && directory.length > 0 && !busy;

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("hwKeyEnableTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Usb className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {keyfilePath ? (
        <>
          <div
            className="flex items-start gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-all">
              {t("hwKeyEnableSuccess")} {keyfilePath}
            </span>
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("hwKeyEnableDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={master}
              onChange={setMaster}
              placeholder={t("masterPasswordLabel")}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>{t("hwKeyDecoyLabel")}</FieldLabel>
            <PasswordField
              value={decoy}
              onChange={setDecoy}
              placeholder={t("decoyPasswordLabel")}
            />
          </div>
          <div>
            <FieldLabel>{t("hwKeyPickFolder")}</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={directory}
                readOnly
                placeholder="E:\\"
                className="field flex-1 rounded-xl px-3.5 py-2.5 text-sm font-mono"
              />
              <button onClick={pickFolder} className="icon-btn" title={t("hwKeyPickFolder")}>
                <Folder className="w-4 h-4" />
              </button>
            </div>
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="btn-primary flex-1 py-2.5 text-sm"
            >
              {busy ? t("working") : t("hwKeyEnable")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

function HwKeyDisableModal({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const disableHwKey = useAppStore((s) => s.disableHwKey);

  const [master, setMaster] = useState("");
  const [decoy, setDecoy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setMaster("");
    setDecoy("");
    setBusy(false);
    setError(null);
    setDone(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disableHwKey(master, decoy || undefined);
      setDone(true);
      onChanged(false);
    } catch (e) {
      const msg = String(e);
      setError(
        msg.includes("hw_key_not_found")
          ? t("hwKeyNotFound")
          : msg.includes("wrong_password")
          ? t("wrongCurrentPassword")
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ActionModal
      title={t("hwKeyDisableTitle")}
      icon={
        <div className="icon-badge neutral w-9 h-9">
          <Usb className="w-4 h-4" />
        </div>
      }
      onClose={close}
    >
      {done ? (
        <>
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {t("hwKeyDisableSuccess")}
          </div>
          <button onClick={close} className="btn-primary w-full py-2.5 text-sm">
            {t("close")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm t2">{t("hwKeyDisableDesc")}</p>
          <div>
            <FieldLabel>{t("masterPasswordLabel")}</FieldLabel>
            <PasswordField
              value={master}
              onChange={setMaster}
              placeholder={t("masterPasswordLabel")}
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>{t("hwKeyDecoyLabel")}</FieldLabel>
            <PasswordField
              value={decoy}
              onChange={setDecoy}
              placeholder={t("decoyPasswordLabel")}
              onEnter={submit}
            />
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={close} className="btn-ghost flex-1 py-2.5 text-sm">
              {t("cancel")}
            </button>
            <button
              onClick={submit}
              disabled={!master || busy}
              className="btn-primary flex-1 py-2.5 text-sm"
              style={{ background: "var(--danger)", boxShadow: "none" }}
            >
              {busy ? t("working") : t("hwKeyDisable")}
            </button>
          </div>
        </>
      )}
    </ActionModal>
  );
}

/* ================================================================== */

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  soon,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  soon?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between ${disabled ? "opacity-60" : "cursor-pointer"}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="text-sm t1 flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="flex items-center gap-2">
        {soon && <span className="soon-badge">{soon}</span>}
        <div className={`toggle-track ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}>
          <motion.div
            animate={{ x: checked ? 20 : 2 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="toggle-thumb"
          />
        </div>
      </span>
    </div>
  );
}

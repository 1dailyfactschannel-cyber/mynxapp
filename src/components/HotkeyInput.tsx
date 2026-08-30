import { useEffect, useRef, useState } from "react";
import { isTauri } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { useI18n } from "@/i18n";

interface HotkeyInputProps {
  label: string;
  icon?: React.ReactNode;
  value: string;
  placeholder?: string;
  /** If true, the shortcut is managed by the backend; skip local availability check. */
  backendManaged?: boolean;
  /** Called when recording starts/ends. Useful to pause backend shortcuts while capturing. */
  onRecordingChange?: (recording: boolean) => void;
  onChange: (accelerator: string) => void;
}

type Capture =
  | { kind: "ok"; accelerator: string }
  | { kind: "modifier" } // нажат только модификатор — ждём дальше
  | { kind: "no-mod" } // клавиша без модификатора
  | { kind: "unsupported" };

/** Именованные клавиши, которые понимает парсер accelerator в tauri-plugin-global-shortcut */
const NAMED_KEYS = new Set([
  "Tab", "Enter", "Escape", "Backspace", "Delete", "Insert",
  "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

function captureEvent(e: KeyboardEvent): Capture {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return { kind: "modifier" };

  let keyName: string | null = null;
  if (key.length === 1 && /^[a-z0-9]$/i.test(key)) keyName = key.toUpperCase();
  else if (key === " ") keyName = "Space";
  else if (/^F([1-9]|1[0-2])$/.test(key)) keyName = key;
  else if (NAMED_KEYS.has(key)) keyName = key;

  if (!keyName) return { kind: "unsupported" };

  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  if (mods.length === 0) return { kind: "no-mod" };

  return { kind: "ok", accelerator: [...mods, keyName].join("+") };
}

export function HotkeyInput({
  label,
  icon,
  value,
  placeholder,
  backendManaged,
  onRecordingChange,
  onChange,
}: HotkeyInputProps) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRecordingChangeRef = useRef(onRecordingChange);
  onRecordingChangeRef.current = onRecordingChange;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!recording) return;

    onRecordingChangeRef.current?.(true);

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Голый Escape — отмена записи; с модификатором — валидное сочетание
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(false);
        setError("");
        return;
      }

      const result = captureEvent(e);
      if (result.kind === "modifier") return;
      if (result.kind === "no-mod" || result.kind === "unsupported") {
        setError(tRef.current("hotkeyNeedModifier"));
        return;
      }

      const next = result.accelerator;
      setRecording(false);
      if (next === value) {
        setError("");
        return;
      }

      if (backendManaged) {
        setError("");
        onChangeRef.current(next);
        return;
      }

      if (!isTauri) {
        onChangeRef.current(next);
        return;
      }

      // Проверяем доступность сочетания: временно освобождаем текущее (наше),
      // пробуем зарегистрировать новое и сразу отпускаем — реальные обработчики
      // повесит VaultScreen по изменению стора.
      void (async () => {
        try {
          const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
          await unregister(value).catch(() => {});
          try {
            await register(next, () => {});
            await unregister(next).catch(() => {});
            setError("");
            onChangeRef.current(next);
          } catch {
            setError(tRef.current("hotkeyConflict"));
            // Откат: заставляем VaultScreen перерегистрировать прежние сочетания
            useSettingsStore.getState().bumpHotkeysEpoch();
          }
        } catch {
          onChangeRef.current(next); // плагин недоступен — просто сохраняем
        }
      })();
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      window.removeEventListener("keydown", handler, { capture: true });
      onRecordingChangeRef.current?.(false);
    };
  }, [recording, value, backendManaged]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm t1">{label}</span>
        </div>
        <button
          onClick={() => {
            setRecording(true);
            setError("");
          }}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
            recording ? "animate-pulse" : ""
          }`}
          style={{
            borderColor: recording ? "var(--accent)" : "var(--border)",
            color: recording ? "var(--accent)" : "var(--foreground)",
          }}
        >
          {recording ? t("hotkeyPress") : value || placeholder || "—"}
        </button>
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

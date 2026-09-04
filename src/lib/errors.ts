/**
 * Контракт ошибок между Rust (src-tauri/src/error.rs) и фронтом.
 *
 * Сервер сериализует CommandError как `{ "kind": "wrong_password", "message": "..." }`
 * через `#[serde(tag = "kind", content = "message")]`.
 *
 * На фронте invoke() оборачивает это в Error с JSON-строкой в .message.
 * Парсим её в MynxError и используем узкоспециализированные хелперы
 * (`isWrongPassword(e)`, `isHwKeyInvalid(e)` и т.п.) вместо
 * `String(e).includes("...")`.
 *
 * Добавить новый вариант = дополнить ErrorKind + хелпер.
 */

/** Машиночитаемый тип ошибки. Совпадает с `CommandError::kind()` в Rust. */
export type ErrorKind =
  // Auth / password
  | "password_too_short"
  | "password_too_weak"
  | "wrong_password"
  | "too_many_attempts"
  | "vault_locked"
  // Vault files
  | "vault_not_found"
  | "vault_corrupted"
  | "vault_write_failed"
  | "vault_locked_other"
  // Decoy
  | "decoy_equals_master"
  | "decoy_session_forbidden"
  // Hardware key
  | "hw_key_not_found"
  | "hw_key_invalid"
  | "hw_key_already_enabled"
  | "hw_key_not_enabled"
  | "hw_key_dir_not_absolute"
  | "hw_key_dir_invalid"
  | "hw_key_dir_drive_type"
  | "hw_key_dir_outside_userprofile"
  // Clipboard
  | "secure_buffer_empty"
  | "clipboard_failed"
  // Settings / misc
  | "lock_on_hide_weakening_forbidden"
  | "backup_path_empty"
  | "backup_failed"
  | "save_cancelled"
  | "invalid_input"
  | "invalid_shortcut"
  | "hotkey_conflict"
  // System
  | "io_error"
  | "path_error"
  | "serde_error"
  // Fallback
  | "other"
  // Если сервер ещё не мигрировал — старая строка
  | "legacy_string";

/** Извлечённая из серверного ответа ошибка. */
export interface MynxError {
  kind: ErrorKind;
  message: string;
  /** Для "too_many_attempts" — секунды ожидания */
  retryAfter?: number;
}

/**
 * Извлечь kind/message из произвольного объекта ошибки.
 *
 * Поддерживает три источника:
 *  - новый формат Rust: Error с message = JSON-строка `{kind, message}`;
 *  - legacy: Error с message = обычная строка (`"wrong_password"` и т.п.);
 *  - уже распарсенный объект `{kind, message}`.
 */
export function parseError(e: unknown): MynxError {
  if (e === null || e === undefined) {
    return { kind: "other", message: "Unknown error" };
  }

  // Уже MynxError
  if (typeof e === "object" && "kind" in (e as object) && "message" in (e as object)) {
    const obj = e as { kind: ErrorKind; message: string; retryAfter?: number };
    return {
      kind: obj.kind,
      message: obj.message,
      retryAfter: obj.retryAfter,
    };
  }

  // Tauri Error: { message: string }
  let raw: string | undefined;
  if (typeof e === "string") {
    raw = e;
  } else if (typeof e === "object" && "message" in (e as object)) {
    raw = String((e as { message: unknown }).message);
  } else {
    return { kind: "other", message: String(e) };
  }

  if (!raw) return { kind: "other", message: "Empty error" };

  // Попытка распарсить как JSON — это новый формат
  try {
    const parsed = JSON.parse(raw) as { kind?: string; message?: string; content?: string };
    if (parsed && typeof parsed.kind === "string") {
      return {
        kind: parsed.kind as ErrorKind,
        message: parsed.message ?? parsed.content ?? raw,
      };
    }
  } catch {
    // не JSON — legacy строка
  }

  // Legacy: строка вида "wrong_password" / "Too many attempts. Retry in 30 seconds"
  if (raw === "wrong_password") {
    return { kind: "wrong_password", message: raw };
  }
  if (raw === "vault_locked") {
    return { kind: "vault_locked", message: raw };
  }
  if (raw === "secure_buffer_empty") {
    return { kind: "secure_buffer_empty", message: raw };
  }
  if (raw.startsWith("Too many attempts. Retry in ")) {
    const m = raw.match(/Retry in (\d+) seconds/);
    return {
      kind: "too_many_attempts",
      message: raw,
      retryAfter: m ? parseInt(m[1], 10) : undefined,
    };
  }
  if (raw === "Backup path is empty") return { kind: "backup_path_empty", message: raw };
  if (raw === "Vault file not found") return { kind: "vault_not_found", message: raw };
  if (raw === "lock_on_hide_weakening_forbidden") {
    return { kind: "lock_on_hide_weakening_forbidden", message: raw };
  }
  if (raw === "password_too_short") {
    return { kind: "password_too_short", message: raw };
  }
  if (raw === "password_too_weak") {
    return { kind: "password_too_weak", message: raw };
  }
  if (raw === "decoy_session_forbidden") {
    return { kind: "decoy_session_forbidden", message: raw };
  }
  if (raw === "invalid_shortcut") {
    return { kind: "invalid_shortcut", message: raw };
  }
  if (raw === "hotkey_conflict") {
    return { kind: "hotkey_conflict", message: raw };
  }
  if (raw === "secure_buffer_empty") {
    return { kind: "secure_buffer_empty", message: raw };
  }
  if (raw === "decoy_equals_master") {
    return { kind: "decoy_equals_master", message: raw };
  }
  if (raw === "hw_key_invalid") {
    return { kind: "hw_key_invalid", message: raw };
  }
  if (raw === "hw_key_already_enabled") {
    return { kind: "hw_key_already_enabled", message: raw };
  }
  if (raw === "hw_key_not_enabled") {
    return { kind: "hw_key_not_enabled", message: raw };
  }
  if (raw === "hw_key_not_found") {
    return { kind: "hw_key_not_found", message: raw };
  }
  if (raw === "hw_key_dir_not_absolute") {
    return { kind: "hw_key_dir_not_absolute", message: raw };
  }
  if (raw === "hw_key_dir_invalid") {
    return { kind: "hw_key_dir_invalid", message: raw };
  }
  if (raw === "hw_key_dir_drive_type") {
    return { kind: "hw_key_dir_drive_type", message: raw };
  }
  if (raw === "hw_key_dir_outside_userprofile") {
    return { kind: "hw_key_dir_outside_userprofile", message: raw };
  }
  if (raw === "lock_on_hide_weakening_forbidden") {
    return { kind: "lock_on_hide_weakening_forbidden", message: raw };
  }
  // …любые другие кодовые строки можно добавить сюда по мере миграции

  return { kind: "legacy_string", message: raw };
}

/* ------------------------------------------------------------------ */
/* Узкоспециализированные проверки — заменяют `String(e).includes(...)  */
/* ------------------------------------------------------------------ */

export const isWrongPassword = (e: unknown) => parseError(e).kind === "wrong_password";
export const isVaultLocked = (e: unknown) => parseError(e).kind === "vault_locked";
export const isPasswordTooShort = (e: unknown) =>
  parseError(e).kind === "password_too_short";
export const isPasswordTooWeak = (e: unknown) =>
  parseError(e).kind === "password_too_weak";
export const isTooManyAttempts = (e: unknown) =>
  parseError(e).kind === "too_many_attempts";
export const isDecoyEqualsMaster = (e: unknown) =>
  parseError(e).kind === "decoy_equals_master";
export const isHwKeyNotFound = (e: unknown) => parseError(e).kind === "hw_key_not_found";
export const isHwKeyInvalid = (e: unknown) => parseError(e).kind === "hw_key_invalid";
export const isHwKeyAlreadyEnabled = (e: unknown) =>
  parseError(e).kind === "hw_key_already_enabled";
export const isHwKeyNotEnabled = (e: unknown) =>
  parseError(e).kind === "hw_key_not_enabled";
export const isSecureBufferEmpty = (e: unknown) =>
  parseError(e).kind === "secure_buffer_empty";
export const isLockOnHideWeakeningForbidden = (e: unknown) =>
  parseError(e).kind === "lock_on_hide_weakening_forbidden";
export const isSaveCancelled = (e: unknown) => parseError(e).kind === "save_cancelled";
export const isInvalidShortcut = (e: unknown) => {
  const err = parseError(e);
  if (err.kind === "invalid_input" || err.kind === "invalid_shortcut") return true;
  // Legacy fallback: rust возвращал "invalid_shortcut" как plain-string
  return err.kind === "legacy_string" && err.message.includes("invalid_shortcut");
};
export const isHotkeyConflict = (e: unknown) => {
  const err = parseError(e);
  if (err.kind === "hotkey_conflict") return true;
  return err.kind === "legacy_string" && err.message.includes("hotkey_conflict");
};

/**
 * Проверка для Windows Hello / biometry. Сейчас там два кода:
 * "biometry_cancelled" и "biometry_requires_real_vault" — добавим
 * их в новый enum, если они тоже будут типизированы. До тех пор —
 * fallback на legacy-строки.
 */
export function isBiometryCancelled(e: unknown): boolean {
  const err = parseError(e);
  if (err.kind === "other" || err.kind === "legacy_string") {
    return err.message.includes("biometry_cancelled");
  }
  return false;
}

export function isBiometryRequiresReal(e: unknown): boolean {
  const err = parseError(e);
  if (err.kind === "other" || err.kind === "legacy_string") {
    return err.message.includes("biometry_requires_real_vault");
  }
  return false;
}

/** Получить из ошибки сообщение для пользователя (на текущем языке). */
export function userMessage(e: unknown, fallback = "Произошла ошибка"): string {
  const err = parseError(e);
  if (err.message && err.message !== err.kind) return err.message;
  return fallback;
}

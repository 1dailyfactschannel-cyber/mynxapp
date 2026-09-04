import { describe, it, expect } from "vitest";
import {
  parseError,
  isWrongPassword,
  isVaultLocked,
  isTooManyAttempts,
  isHwKeyInvalid,
  isHwKeyNotFound,
  isHwKeyAlreadyEnabled,
  isHwKeyNotEnabled,
  isSecureBufferEmpty,
  isBiometryCancelled,
  isBiometryRequiresReal,
  isInvalidShortcut,
  isHotkeyConflict,
  isLockOnHideWeakeningForbidden,
  isPasswordTooShort,
  userMessage,
  type MynxError,
} from "./errors";

describe("parseError", () => {
  it("распознаёт новый формат Rust (JSON-строка в message)", () => {
    // Tauri Error: { message: '{"kind":"wrong_password","message":"..."}' }
    const e = new Error(JSON.stringify({ kind: "wrong_password", message: "Wrong master password" }));
    const result = parseError(e);
    expect(result.kind).toBe("wrong_password");
    expect(result.message).toBe("Wrong master password");
  });

  it("распознаёт legacy-строку 'wrong_password'", () => {
    const e = new Error("wrong_password");
    const result = parseError(e);
    expect(result.kind).toBe("wrong_password");
  });

  it("распознаёт legacy-строку 'vault_locked'", () => {
    expect(parseError(new Error("vault_locked")).kind).toBe("vault_locked");
  });

  it("распознаёт legacy-строку 'secure_buffer_empty'", () => {
    expect(parseError(new Error("secure_buffer_empty")).kind).toBe("secure_buffer_empty");
  });

  it("парсит too_many_attempts с retryAfter", () => {
    const e = new Error("Too many attempts. Retry in 30 seconds");
    const result = parseError(e);
    expect(result.kind).toBe("too_many_attempts");
    expect(result.retryAfter).toBe(30);
  });

  it("парсит too_many_attempts с другим числом", () => {
    const e = new Error("Too many attempts. Retry in 7 seconds");
    expect(parseError(e).retryAfter).toBe(7);
  });

  it("распознаёт 'Vault file not found'", () => {
    expect(parseError(new Error("Vault file not found")).kind).toBe("vault_not_found");
  });

  it("распознаёт 'Backup path is empty'", () => {
    expect(parseError(new Error("Backup path is empty")).kind).toBe("backup_path_empty");
  });

  it("распознаёт 'lock_on_hide_weakening_forbidden'", () => {
    expect(parseError(new Error("lock_on_hide_weakening_forbidden")).kind).toBe(
      "lock_on_hide_weakening_forbidden"
    );
  });

  it("распознаёт 'decoy_equals_master'", () => {
    expect(parseError(new Error("decoy_equals_master")).kind).toBe("decoy_equals_master");
  });

  it("возвращает legacy_string для неизвестной строки", () => {
    const e = new Error("Some unexpected server message");
    const result = parseError(e);
    expect(result.kind).toBe("legacy_string");
    expect(result.message).toBe("Some unexpected server message");
  });

  it("обрабатывает null и undefined", () => {
    expect(parseError(null).kind).toBe("other");
    expect(parseError(undefined).kind).toBe("other");
  });

  it("обрабатывает plain string", () => {
    expect(parseError("plain error").kind).toBe("legacy_string");
  });

  it("обрабатывает plain object {kind, message}", () => {
    const obj: MynxError = { kind: "wrong_password", message: "x" };
    expect(parseError(obj).kind).toBe("wrong_password");
  });

  it("обрабатывает уже готовый MynxError с retryAfter", () => {
    const obj: MynxError = { kind: "too_many_attempts", message: "x", retryAfter: 99 };
    const result = parseError(obj);
    expect(result.kind).toBe("too_many_attempts");
    expect(result.retryAfter).toBe(99);
  });
});

describe("специализированные хелперы", () => {
  it("isWrongPassword", () => {
    expect(isWrongPassword(new Error("wrong_password"))).toBe(true);
    expect(isWrongPassword(new Error(JSON.stringify({ kind: "wrong_password" })))).toBe(true);
    expect(isWrongPassword(new Error("other"))).toBe(false);
  });

  it("isVaultLocked", () => {
    expect(isVaultLocked(new Error("vault_locked"))).toBe(true);
    expect(isVaultLocked(new Error("foo"))).toBe(false);
  });

  it("isTooManyAttempts читает retryAfter", () => {
    expect(isTooManyAttempts(new Error("Too many attempts. Retry in 60 seconds"))).toBe(true);
    expect(isTooManyAttempts(new Error("other"))).toBe(false);
  });

  it("isHwKeyInvalid", () => {
    expect(isHwKeyInvalid(new Error("hw_key_invalid"))).toBe(true);
    expect(isHwKeyInvalid(new Error("foo"))).toBe(false);
  });

  it("isHwKeyNotFound", () => {
    expect(isHwKeyNotFound(new Error("hw_key_not_found"))).toBe(true);
    expect(isHwKeyNotFound(new Error("foo"))).toBe(false);
  });

  it("isHwKeyAlreadyEnabled", () => {
    expect(isHwKeyAlreadyEnabled(new Error("hw_key_already_enabled"))).toBe(true);
    expect(isHwKeyAlreadyEnabled(new Error("foo"))).toBe(false);
  });

  it("isHwKeyNotEnabled", () => {
    expect(isHwKeyNotEnabled(new Error("hw_key_not_enabled"))).toBe(true);
    expect(isHwKeyNotEnabled(new Error("foo"))).toBe(false);
  });

  it("isLockOnHideWeakeningForbidden", () => {
    expect(isLockOnHideWeakeningForbidden(new Error("lock_on_hide_weakening_forbidden"))).toBe(true);
    expect(isLockOnHideWeakeningForbidden(new Error("foo"))).toBe(false);
  });

  it("isPasswordTooShort", () => {
    expect(isPasswordTooShort(new Error("password_too_short"))).toBe(true);
    expect(isPasswordTooShort(new Error("foo"))).toBe(false);
  });

  it("isInvalidShortcut — legacy 'invalid_shortcut' строка", () => {
    expect(isInvalidShortcut(new Error("invalid_shortcut"))).toBe(true);
    // Новый формат (пока в виде legacy_string)
    expect(isInvalidShortcut(new Error("foo"))).toBe(false);
  });

  it("isHotkeyConflict — legacy 'hotkey_conflict' строка", () => {
    expect(isHotkeyConflict(new Error("hotkey_conflict"))).toBe(true);
    expect(isHotkeyConflict(new Error("foo"))).toBe(false);
  });

  it("isSecureBufferEmpty", () => {
    expect(isSecureBufferEmpty(new Error("secure_buffer_empty"))).toBe(true);
    expect(isSecureBufferEmpty(new Error("foo"))).toBe(false);
  });

  it("isBiometryCancelled — fallback на legacy 'biometry_cancelled'", () => {
    expect(isBiometryCancelled(new Error("biometry_cancelled"))).toBe(true);
    expect(isBiometryCancelled(new Error("foo"))).toBe(false);
  });

  it("isBiometryRequiresReal — fallback на legacy 'biometry_requires_real_vault'", () => {
    expect(isBiometryRequiresReal(new Error("biometry_requires_real_vault"))).toBe(true);
    expect(isBiometryRequiresReal(new Error("foo"))).toBe(false);
  });
});

describe("userMessage", () => {
  it("возвращает message, если он отличается от kind", () => {
    const e = new Error(JSON.stringify({ kind: "wrong_password", message: "Wrong password" }));
    expect(userMessage(e)).toBe("Wrong password");
  });

  it("возвращает fallback, если message == kind (пустое сообщение)", () => {
    const e = new Error(JSON.stringify({ kind: "wrong_password", message: "wrong_password" }));
    expect(userMessage(e, "Ошибка")).toBe("Ошибка");
  });
});

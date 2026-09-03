// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  createPasskey,
  signChallenge,
  verifySignature,
  selfTestCredential,
  bytesToB64url,
  b64urlToBytes,
  buildExport,
  parseImport,
} from "./passkey";
import type { PasskeyItem } from "./passkey";

describe("base64url", () => {
  it("roundtrip", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 255, 62, 63]);
    const enc = bytesToB64url(bytes);
    expect(enc).not.toMatch(/[+/=]/);
    const dec = b64urlToBytes(enc);
    expect(Array.from(dec)).toEqual(Array.from(bytes));
  });
});

describe("passkey credential", () => {
  it("создаёт credential с ES256-ключами и 32-байтным credentialId", async () => {
    const item = await createPasskey("GitHub.com", "matt@example.com", "Matt");
    expect(item.rpId).toBe("github.com");
    expect(item.algorithm).toBe("ES256");
    expect(b64urlToBytes(item.credentialId).length).toBe(32);
    const priv = JSON.parse(item.privateKeyJwk);
    const pub = JSON.parse(item.publicKeyJwk);
    expect(priv.crv).toBe("P-256");
    expect(pub.crv).toBe("P-256");
    expect(priv.d).toBeDefined();
  });

  it("подпись проверяется публичным ключом того же credential", async () => {
    const item = await createPasskey("example.com", "u1");
    const challenge = new Uint8Array([1, 2, 3, 4, 5]);
    const sig = await signChallenge(item, challenge);
    expect(await verifySignature(item, challenge, sig)).toBe(true);
  });

  it("подпись не проходит с другим challenge", async () => {
    const item = await createPasskey("example.com", "u1");
    const sig = await signChallenge(item, new Uint8Array([9, 9, 9]));
    expect(await verifySignature(item, new Uint8Array([1, 1, 1]), sig)).toBe(false);
  });

  it("selfTestCredential возвращает true", async () => {
    const item = await createPasskey("example.com", "u1");
    expect(await selfTestCredential(item)).toBe(true);
  });
});

describe("экспорт/импорт", () => {
  it("roundtrip сохраняет credentials", async () => {
    const item = await createPasskey("example.com", "u1");
    const json = JSON.stringify(buildExport([item]));
    const parsed = parseImport(json);
    expect(parsed.length).toBe(1);
    expect(parsed[0].rpId).toBe("example.com");
    expect(parsed[0].credentialId).toBe(item.credentialId);
    expect(parsed[0].privateKeyJwk).toBe(item.privateKeyJwk);
  });

  it("отклоняет чужой формат", () => {
    expect(() => parseImport(JSON.stringify({ format: "other", credentials: [] }))).toThrow();
    expect(() => parseImport("not json at all")).toThrow();
  });

  it("пропускает повреждённые записи", async () => {
    const ok = await createPasskey("example.com", "u1");
    const broken: PasskeyItem = { ...ok, privateKeyJwk: undefined as unknown as string };
    const parsed = parseImport(JSON.stringify(buildExport([broken, ok])));
    expect(parsed.length).toBe(1);
  });
});

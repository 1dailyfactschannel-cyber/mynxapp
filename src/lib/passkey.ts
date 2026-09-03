/* ================================================================== */
/* Passkeys (FIDO2-совместимые учётные данные, ES256 / P-256).         */
/* Криптография — WebCrypto (ECDSA P-256 + SHA-256). Приватный ключ    */
/* хранится в зашифрованном сторе (как вложения). Формат экспорта —    */
/* собственный JSON v1 (не для кросс-сервисного переноса пока).        */
/* ================================================================== */

export interface PasskeyItem {
  id: string;
  /** Relying Party ID — домен сайта */
  rpId: string;
  username: string;
  displayName?: string;
  /** Credential ID (base64url, 32 случайных байта) */
  credentialId: string;
  /** Приватный ключ ECDSA P-256 в JWK (JSON-строка) */
  privateKeyJwk: string;
  /** Публичный ключ в JWK — для проверки без раскрытия приватного */
  publicKeyJwk: string;
  algorithm: "ES256";
  createdAt: number;
  lastUsedAt?: number;
  /** ID связанной записи хранилища (опционально) */
  linkedEntryId?: string;
}

export interface PasskeyExport {
  format: "mynx-passkeys";
  version: 1;
  exportedAt: number;
  credentials: PasskeyItem[];
}

/* ------------------------------------------------------------------ */
/* base64url helpers                                                   */
/* ------------------------------------------------------------------ */

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* COSE-подобные имена ключей JWK (FIDO2 uses COSE; JWK — эквивалент)  */
/* ------------------------------------------------------------------ */

interface EcJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d?: string;
}

/* ------------------------------------------------------------------ */
/* Создание credential                                                 */
/* ------------------------------------------------------------------ */

/** Сгенерировать новый passkey-credential для rpId/user */
export async function createPasskey(
  rpId: string,
  username: string,
  displayName?: string
): Promise<PasskeyItem> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable: ключ уходит в зашифрованный стор приложения
    ["sign", "verify"]
  );

  const privJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as EcJwk;
  const pubJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as EcJwk;

  const credId = new Uint8Array(32);
  crypto.getRandomValues(credId);

  const item: PasskeyItem = {
    id: crypto.randomUUID(),
    rpId: rpId.trim().toLowerCase(),
    username: username.trim(),
    displayName: displayName?.trim() || undefined,
    credentialId: bytesToB64url(credId),
    privateKeyJwk: JSON.stringify(privJwk),
    publicKeyJwk: JSON.stringify(pubJwk),
    algorithm: "ES256",
    createdAt: Date.now(),
  };
  return item;
}

/* ------------------------------------------------------------------ */
/* Подпись и проверка (self-test и демонстрация владения ключом)       */
/* ------------------------------------------------------------------ */

async function importPrivKey(jwk: EcJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function importPubKey(jwk: EcJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

/** Подписать challenge приватным ключом credential (base64url-подпись) */
export async function signChallenge(
  item: PasskeyItem,
  challenge: Uint8Array
): Promise<string> {
  const key = await importPrivKey(JSON.parse(item.privateKeyJwk) as EcJwk);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    challenge as unknown as BufferSource
  );
  return bytesToB64url(new Uint8Array(sig));
}

/** Проверить подпись публичным ключом credential */
export async function verifySignature(
  item: PasskeyItem,
  challenge: Uint8Array,
  signatureB64url: string
): Promise<boolean> {
  try {
    const key = await importPubKey(JSON.parse(item.publicKeyJwk) as EcJwk);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64urlToBytes(signatureB64url) as unknown as BufferSource,
      challenge as unknown as BufferSource
    );
  } catch {
    return false;
  }
}

/** Полный self-test: новая пара → подпись → проверка */
export async function selfTestCredential(item: PasskeyItem): Promise<boolean> {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const sig = await signChallenge(item, challenge);
  return verifySignature(item, challenge, sig);
}

/* ------------------------------------------------------------------ */
/* Экспорт / импорт                                                    */
/* ------------------------------------------------------------------ */

export function buildExport(credentials: PasskeyItem[]): PasskeyExport {
  return {
    format: "mynx-passkeys",
    version: 1,
    exportedAt: Date.now(),
    credentials,
  };
}

/** Импорт JSON-экспорта; бросает Error при неверном формате */
export function parseImport(text: string): PasskeyItem[] {
  const data = JSON.parse(text) as Partial<PasskeyExport>;
  if (data.format !== "mynx-passkeys" || !Array.isArray(data.credentials)) {
    throw new Error("bad_format");
  }
  const out: PasskeyItem[] = [];
  for (const c of data.credentials) {
    if (
      typeof c.rpId !== "string" ||
      typeof c.username !== "string" ||
      typeof c.credentialId !== "string" ||
      typeof c.privateKeyJwk !== "string" ||
      typeof c.publicKeyJwk !== "string"
    ) {
      continue;
    }
    out.push({
      id: c.id || crypto.randomUUID(),
      rpId: c.rpId,
      username: c.username,
      displayName: c.displayName,
      credentialId: c.credentialId,
      privateKeyJwk: c.privateKeyJwk,
      publicKeyJwk: c.publicKeyJwk,
      algorithm: "ES256",
      createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
      lastUsedAt: c.lastUsedAt,
      linkedEntryId: c.linkedEntryId,
    });
  }
  if (out.length === 0 && (data.credentials?.length ?? 0) > 0) {
    throw new Error("no_valid_credentials");
  }
  return out;
}

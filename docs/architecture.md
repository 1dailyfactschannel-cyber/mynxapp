# Mynx — Архитектура шифрования

## 1. Обзор

Mynx использует **Zero-Knowledge** архитектуру. Все данные шифруются на клиенте. Мастер-пароль никогда не покидает память приложения в открытом виде.

```
User Input (Master Password)
        ↓
   [Argon2id KDF]
        ↓
   Primary Key (32 bytes)
        ↓
   [HKDF-SHA256] ──────→ Device Key (stored in OS Keychain)
        ↓
   Encryption Key (32 bytes)
        ↓
   [XChaCha20-Poly1305] ──────→ Encrypted Vault File
```

---

## 2. Ключевая схема

### 2.1 Master Password (MP)
- Вводится пользователем при unlock
- Никогда не сохраняется на диск
- Обнуляется в памяти через `zeroize` после derive

### 2.2 Device Key (DK)
- 128-bit (16 bytes) случайный ключ
- Генерируется один раз при первом запуске
- Хранится в **OS Keychain**:
  - Windows → Windows Credential Manager / DPAPI
  - macOS → Keychain
  - Linux → Secret Service API / libsecret
- Не покидает secure storage без необходимости

### 2.3 Salt
- 128-bit (16 bytes) случайный salt
- Уникальный для каждого vault
- Хранится в открытом виде в заголовке vault-файла
- Перегенерируется при смене мастер-пароля

### 2.4 Derivation

```rust
// Primary Key = Argon2id(MP, Salt, m=64MB, t=3, p=4)
let primary_key = argon2id_hash(master_password, salt, params)?;

// Encryption Key = HKDF-SHA256(Primary Key, DK, "safepass-v1-enc-key")
let enc_key = hkdf_sha256(&primary_key, &device_key, b"safepass-v1-enc-key", 32)?;
```

### 2.5 Argon2id Parameters (OWASP 2025)
```
Memory: 64 MB
Iterations: 3
Parallelism: 4
Output length: 32 bytes
```

---

## 3. Формат Vault-файла

```
+---------------------------------------------------------------+
|                       Vault File (.safepass)                   |
+---------------------------------------------------------------+
| Magic Header (8 bytes)    | "SAFEPASS"                         |
| Version (1 byte)          | 0x01                               |
| Salt (16 bytes)           | Random                             |
| Encrypted Header          | XChaCha20-Poly1305                 |
|   ├── KDF Params          | Argon2id settings                  |
|   ├── Vault Metadata      | Created, Modified, Count           |
|   └── Encrypted Key       | AES-256-GCM key для payload        |
| Encrypted Payload         | AES-256-GCM (или XChaCha20)        |
|   └── Compressed Data     | Protobuf/FlatBuffers + zstd        |
+---------------------------------------------------------------+
```

### 3.1 Зачем двойное шифрование?
- **Внешний слой** (XChaCha20-Poly1305): защита от tampering, аутентификация.
- **Внутренний слой** (AES-256-GCM): быстрый доступ к отдельным записям без полной расшифровки vault.
- Это позволяет в будущем добавить **per-entry encryption** без изменения формата.

---

## 4. Структура данных

### 4.1 Entry (запись)
```protobuf
message Entry {
  string id = 1;              // UUID v4
  string title = 2;
  string username = 3;
  bytes password = 4;           // Зашифровано отдельно
  string url = 5;
  string notes = 6;
  string category = 7;            // auto-detected: banking, social, dev, etc.
  repeated TOTP totp = 8;       // Optional
  repeated CustomField custom = 9;
  int64 created_at = 10;
  int64 modified_at = 11;
  bool favorite = 12;
  int32 strength = 13;            // 0-100, cached
}
```

### 4.2 TOTP
```protobuf
message TOTP {
  string label = 1;
  bytes secret = 2;             // base32 encoded
  int32 digits = 3;               // Default 6
  int32 period = 4;               // Default 30
  string algorithm = 5;           // SHA1/SHA256/SHA512
}
```

---

## 5. Память и безопасность

### 5.1 Zeroize
Все чувствительные буферы обнуляются через `zeroize` crate:
```rust
use zeroize::Zeroize;

let mut password = String::from("secret");
// ... use ...
password.zeroize();  // Overwritten with zeros
```

### 5.2 Locked Memory
```rust
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::VirtualLock;

#[cfg(target_family = "unix")]
use libc::mlock;
```

Ключи держим в locked pages до auto-lock.

### 5.3 Auto-Lock триггеры
1. Таймаут (настраиваемый, default 5 минут)
2. Потеря фокуса окна (опционально)
3. Закрытие крышки ноутбука (system sleep)
4. Lock OS (Windows+L / Ctrl+Cmd+Q)
5. Смена пользователя / экрана блокировки

### 5.4 Clipboard Protection
- Пароль копируется в clipboard
- 30-секундный таймер на очистку
- Очистка происходит через `Clipboard::clear()` (Tauri API)
- Если пользователь копирует что-то другое — таймер сбрасывается

---

## 6. Threat Model

| Угроза | Вероятность | Влияние | Митигация |
|--------|------------|---------|-----------|
| Brute-force MP | Средняя | Высокое | Argon2id (64MB, t=3), strong password policy |
| Memory dump | Высокая | Высокое | Locked memory, zeroize, auto-lock |
| Keylogger | Средняя | Высокое | Biometric unlock, minimal typing |
| Clipboard history | Высокая | Среднее | Auto-clear 30s, disable Windows clipboard history |
| Backup tampering | Низкая | Высокое | Signed backups, checksums, read-only storage |
| Shoulder surfing | Высокая | Среднее | Password masking, auto-lock, screen dimming |
| Evil maid | Низкая | Высокое | Device Key в OS Keychain, TPM где доступно |
| Side-channel | Низкая | Высокое | Constant-time crypto (ring crate), timing-safe compare |

---

## 7. Криптографические библиотеки

| Задача | Crate | Лицензия | Аудит |
|--------|-------|---------|-------|
| XChaCha20-Poly1305 | `ring` | ISC/BSD | Google audit |
| AES-256-GCM | `ring` | ISC/BSD | Google audit |
| Argon2id | `argon2` | MIT/Apache | Password Hashing Competition winner |
| HKDF | `ring` | ISC/BSD | Google audit |
| SHA-256/512 | `ring` | ISC/BSD | Google audit |
| Random | `getrandom` | MIT/Apache | Uses OS CSPRNG |
| Zeroize | `zeroize` | MIT/Apache | ✓ |
| Password strength | `zxcvbn` | MIT | Dropbox |

---

## 8. Будущие улучшения

- **Post-quantum KEM** — ML-KEM (Kyber) для ключевого обмена (если добавим sync)
- **Hardware-backed keys** — TPM / Apple Secure Enclave / Windows Hello
- **Per-entry key derivation** — каждая запись зашифрована своим ключом
- **Secure enclave** — biometrics через WebAuthn / FIDO2

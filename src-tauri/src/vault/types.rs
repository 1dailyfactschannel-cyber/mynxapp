use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultHeader {
    pub magic: [u8; 8],        // "SAFEPASS"
    pub version: u8,           // 1
    pub salt: [u8; 16],        // Random salt
    pub kdf_params: KdfParamsSerializable,
    pub encrypted_header: Vec<u8>, // Encrypted inner header
    /// Слот ложного хранилища (plausible deniability).
    /// Присутствует всегда: если ложный пароль не задан, слот зашифрован
    /// случайным ключом и неотличим от включённого — по файлу нельзя
    /// определить, есть ли у хранилища ложный слой.
    #[serde(default)]
    pub decoy: Option<DecoySlot>,
    /// Аппаратный ключ (флешка с keyfile). Не секрет: только идентификатор
    /// keyfile'а, по которому приложение ищет файл на съёмных дисках.
    #[serde(default)]
    pub hw_key: Option<HwKeyInfo>,
}

/// Метаданные аппаратного ключа в заголовке vault
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HwKeyInfo {
    pub keyfile_id: String,
}

/// Слот ложного хранилища: собственные salt/KDF/заголовок,
/// расшифровывается только ложным паролем.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecoySlot {
    pub salt: [u8; 16],
    pub kdf_params: KdfParamsSerializable,
    pub encrypted_header: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParamsSerializable {
    pub memory_kb: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl From<&crate::crypto::KdfParams> for KdfParamsSerializable {
    fn from(params: &crate::crypto::KdfParams) -> Self {
        Self {
            memory_kb: params.memory_kb,
            iterations: params.iterations,
            parallelism: params.parallelism,
        }
    }
}

impl Into<crate::crypto::KdfParams> for KdfParamsSerializable {
    fn into(self) -> crate::crypto::KdfParams {
        crate::crypto::KdfParams {
            memory_kb: self.memory_kb,
            iterations: self.iterations,
            parallelism: self.parallelism,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInnerHeader {
    pub created_at: i64,
    pub modified_at: i64,
    pub entry_count: u32,
    pub payload_key: [u8; 32], // AES key for payload (encrypted with master key)
    /// Флаг включённости ложного слоя (хранится внутри зашифрованного
    /// реального заголовка, поэтому не палит наличие слоя стороннему наблюдателю).
    #[serde(default)]
    pub decoy_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFile {
    pub header: VaultHeader,
    pub payload: Vec<u8>, // Encrypted SQLite or Protobuf data
    /// Зашифрованные записи ложного хранилища (см. VaultHeader::decoy)
    #[serde(default)]
    pub decoy_payload: Option<Vec<u8>>,
}

impl VaultFile {
    pub const MAGIC: [u8; 8] = *b"SAFEPASS";
    pub const VERSION: u8 = 1;

    pub fn new(
        salt: [u8; 16],
        kdf_params: KdfParamsSerializable,
        encrypted_header: Vec<u8>,
        payload: Vec<u8>,
    ) -> Self {
        Self {
            header: VaultHeader {
                magic: Self::MAGIC,
                version: Self::VERSION,
                salt,
                kdf_params,
                encrypted_header,
                decoy: None,
                hw_key: None,
            },
            payload,
            decoy_payload: None,
        }
    }

    pub fn verify(&self) -> bool {
        self.header.magic == Self::MAGIC && self.header.version == Self::VERSION
    }
}

/// Portable encrypted export file.
/// Key is derived from the master password ONLY (no device key),
/// so the backup can be restored on another machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportFile {
    pub magic: [u8; 12],       // "SAFEPASS-EXP"
    pub version: u8,           // 1
    pub salt: [u8; 16],        // Random salt for export KDF
    pub kdf_params: KdfParamsSerializable,
    pub payload: Vec<u8>,      // XChaCha20-Poly1305(export_key, entries_json)
}

impl ExportFile {
    pub const MAGIC: [u8; 12] = *b"SAFEPASS-EXP";
    pub const VERSION: u8 = 1;

    pub fn new(
        salt: [u8; 16],
        kdf_params: KdfParamsSerializable,
        payload: Vec<u8>,
    ) -> Self {
        Self {
            magic: Self::MAGIC,
            version: Self::VERSION,
            salt,
            kdf_params,
            payload,
        }
    }
}

/// Vault in-memory state (after unlock)
#[derive(Clone)]
pub struct VaultSession {
    pub vault_id: String,
    pub encryption_key: [u8; 32], // Master encryption key (in memory)
    pub payload_key: [u8; 32],   // Payload encryption key
    /// true — открыт ложный слой (введён ложный пароль)
    pub is_decoy: bool,
}

impl VaultSession {
    pub fn new(vault_id: String, encryption_key: [u8; 32], payload_key: [u8; 32]) -> Self {
        Self {
            vault_id,
            encryption_key,
            payload_key,
            is_decoy: false,
        }
    }
}

impl Drop for VaultSession {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.encryption_key.zeroize();
        self.payload_key.zeroize();
    }
}

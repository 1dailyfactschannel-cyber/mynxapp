use hkdf::Hkdf;
use sha2::Sha256;

/// Derive a key using HKDF-SHA256.
pub fn derive_key(salt: &[u8], ikm: &[u8], info: &[u8], out_len: usize) -> anyhow::Result<Vec<u8>> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut okm = vec![0u8; out_len];
    hk.expand(info, &mut okm)
        .map_err(|_| anyhow::anyhow!("hkdf expand failed"))?;
    Ok(okm)
}

/// Two-step key derivation: Argon2id primary key + HKDF with device key
pub fn derive_encryption_key(
    primary_key: &[u8; 32],
    device_key: &[u8; 16],
    info: &[u8],
) -> anyhow::Result<[u8; 32]> {
    derive_encryption_key_hw(primary_key, device_key, None, info)
}

/// То же, но с необязательным секретом аппаратного ключа (флешка):
/// при включённом hw-ключе секрет mixing'ится в IKM, и без него
/// ключ шифрования не выводится.
pub fn derive_encryption_key_hw(
    primary_key: &[u8; 32],
    device_key: &[u8; 16],
    hw_key: Option<&[u8; 32]>,
    info: &[u8],
) -> anyhow::Result<[u8; 32]> {
    let hkdf_result = match hw_key {
        Some(hw) => {
            let mut full = [0u8; 80];
            full[..32].copy_from_slice(primary_key);
            full[32..48].copy_from_slice(device_key);
            full[48..].copy_from_slice(hw);
            derive_key(&[], &full, info, 32)?
        }
        None => {
            let mut full = [0u8; 48];
            full[..32].copy_from_slice(primary_key);
            full[32..].copy_from_slice(device_key);
            derive_key(&[], &full, info, 32)?
        }
    };
    let mut result = [0u8; 32];
    result.copy_from_slice(&hkdf_result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hkdf_deterministic() {
        let salt = b"test-salt";
        let ikm = b"test-ikm";
        let info = b"test-info";

        let key1 = derive_key(salt, ikm, info, 32).unwrap();
        let key2 = derive_key(salt, ikm, info, 32).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_hkdf_different_info() {
        let salt = b"";
        let ikm = b"same-ikm";

        let key1 = derive_key(salt, ikm, b"info1", 32).unwrap();
        let key2 = derive_key(salt, ikm, b"info2", 32).unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_derive_encryption_key() {
        let primary = [0xAAu8; 32];
        let device = [0xBBu8; 16];

        let key1 = derive_encryption_key(&primary, &device, b"safepass-v1-enc-key"
        ).unwrap();
        let key2 = derive_encryption_key(&primary, &device, b"safepass-v1-enc-key"
        ).unwrap();
        assert_eq!(key1, key2);
        assert_eq!(key1.len(), 32);
    }
}

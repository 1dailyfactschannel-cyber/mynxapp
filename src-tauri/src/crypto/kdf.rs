use argon2::{
    Argon2, PasswordHasher,
    password_hash::SaltString,
};

pub const ARGON2_MEMORY_KB: u32 = 16384; // 16 MB
pub const ARGON2_ITERATIONS: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 2;
pub const KEY_LENGTH: usize = 32;

#[derive(Debug, Clone)]
pub struct KdfParams {
    pub memory_kb: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            memory_kb: ARGON2_MEMORY_KB,
            iterations: ARGON2_ITERATIONS,
            parallelism: ARGON2_PARALLELISM,
        }
    }
}

impl KdfParams {
    /// Validate KDF parameters and build Argon2 params.
    ///
    /// SECURITY: this used to `.expect()` on invalid input. The parameters
    /// come from the (attacker-influencable) vault header, so a forged or
    /// corrupted header with absurd values (e.g. memory_kb = u32::MAX)
    /// crashed the whole process instead of failing the unlock. Now the
    /// error propagates and the caller returns "wrong_password"/"bad vault".
    pub fn to_argon2_params(&self) -> anyhow::Result<argon2::Params> {
        Ok(argon2::Params::new(
            self.memory_kb,
            self.iterations,
            self.parallelism,
            Some(KEY_LENGTH),
        )?)
    }
}

/// Derive a 32-byte key from password + salt using Argon2id
pub fn derive_key(password: &[u8], salt: &[u8], params: &KdfParams) -> anyhow::Result<[u8; KEY_LENGTH]> {
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        params.to_argon2_params()?,
    );

    let salt_str = SaltString::encode_b64(salt)
        .map_err(|e| anyhow::anyhow!("salt encoding failed: {}", e))?;

    let password_hash = argon2
        .hash_password(password, &salt_str)
        .map_err(|e| anyhow::anyhow!("argon2 hash failed: {}", e))?;

    let hash = password_hash.hash.ok_or_else(|| anyhow::anyhow!("no hash generated"))?;
    let mut key = [0u8; KEY_LENGTH];
    let hash_bytes = hash.as_bytes();
    if hash_bytes.len() < KEY_LENGTH {
        return Err(anyhow::anyhow!("hash too short"));
    }
    key.copy_from_slice(&hash_bytes[..KEY_LENGTH]);

    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use getrandom::getrandom;

    #[test]
    fn test_derive_key_deterministic() {
        let password = b"test_password_123";
        let mut salt = [0u8; 16];
        getrandom(&mut salt).unwrap();
        let params = KdfParams::default();

        let key1 = derive_key(password, &salt, &params).unwrap();
        let key2 = derive_key(password, &salt, &params).unwrap();
        assert_eq!(key1, key2);
        assert_eq!(key1.len(), KEY_LENGTH);
    }

    #[test]
    fn test_different_passwords_different_keys() {
        let mut salt = [0u8; 16];
        getrandom(&mut salt).unwrap();
        let params = KdfParams::default();

        let key1 = derive_key(b"password1", &salt, &params).unwrap();
        let key2 = derive_key(b"password2", &salt, &params).unwrap();
        assert_ne!(key1, key2);
    }
}

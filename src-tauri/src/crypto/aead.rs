use ring::aead::{
    Aad, BoundKey, Nonce, NonceSequence, UnboundKey, AES_256_GCM,
    OpeningKey, SealingKey,
};
use ring::rand::SecureRandom;
use ring::rand::SystemRandom;

const AES_GCM_NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

struct FixedNonceSequence {
    nonce: [u8; AES_GCM_NONCE_LEN],
    used: bool,
}

impl FixedNonceSequence {
    fn new(nonce: [u8; AES_GCM_NONCE_LEN]) -> Self {
        Self { nonce, used: false }
    }
}

impl NonceSequence for FixedNonceSequence {
    fn advance(&mut self) -> Result<Nonce, ring::error::Unspecified> {
        if self.used {
            return Err(ring::error::Unspecified);
        }
        self.used = true;
        Ok(Nonce::assume_unique_for_key(self.nonce))
    }
}

pub struct Aes256GcmAead;

impl Aes256GcmAead {
    /// Encrypt with AES-256-GCM.
    /// Returns: nonce (12 bytes) + ciphertext + tag (16 bytes)
    pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> anyhow::Result<Vec<u8>> {
        let rng = SystemRandom::new();
        let mut nonce_bytes = [0u8; AES_GCM_NONCE_LEN];
        rng.fill(&mut nonce_bytes)
            .map_err(|_| anyhow::anyhow!("rng failed"))?;

        let unbound_key = UnboundKey::new(&AES_256_GCM, key)
            .map_err(|_| anyhow::anyhow!("key init failed"))?;

        let mut sealing_key = SealingKey::new(unbound_key, FixedNonceSequence::new(nonce_bytes));

        let mut ciphertext = plaintext.to_vec();
        let tag = sealing_key
            .seal_in_place_separate_tag(Aad::empty(), &mut ciphertext)
            .map_err(|_| anyhow::anyhow!("seal failed"))?;

        let mut result = Vec::with_capacity(AES_GCM_NONCE_LEN + ciphertext.len() + TAG_LEN);
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&ciphertext);
        result.extend_from_slice(tag.as_ref());

        Ok(result)
    }

    /// Decrypt AES-256-GCM data.
    /// Input: nonce (12) || ciphertext || tag (16)
    pub fn decrypt(key: &[u8; 32], ciphertext: &[u8]) -> anyhow::Result<Vec<u8>> {
        if ciphertext.len() < AES_GCM_NONCE_LEN + TAG_LEN {
            return Err(anyhow::anyhow!("ciphertext too short"));
        }

        let nonce = &ciphertext[..AES_GCM_NONCE_LEN];
        let encrypted = &ciphertext[AES_GCM_NONCE_LEN..ciphertext.len() - TAG_LEN];
        let tag = &ciphertext[ciphertext.len() - TAG_LEN..];

        let mut plaintext = encrypted.to_vec();
        plaintext.extend_from_slice(tag);

        let unbound_key = UnboundKey::new(&AES_256_GCM, key)
            .map_err(|_| anyhow::anyhow!("key init failed"))?;

        let mut opening_key = OpeningKey::new(
            unbound_key,
            FixedNonceSequence::new(nonce.try_into()?),
        );

        let decrypted = opening_key
            .open_in_place(Aad::empty(), &mut plaintext)
            .map_err(|_| anyhow::anyhow!("decrypt failed"))?;

        Ok(decrypted.to_vec())
    }
}

pub struct CryptoModule;

impl CryptoModule {
    pub fn generate_random_bytes(len: usize) -> anyhow::Result<Vec<u8>> {
        let mut bytes = vec![0u8; len];
        SystemRandom::new().fill(&mut bytes)
            .map_err(|_| anyhow::anyhow!("rng failed"))?;
        Ok(bytes)
    }

    pub fn generate_salt() -> anyhow::Result<[u8; 16]> {
        let mut salt = [0u8; 16];
        SystemRandom::new().fill(&mut salt)
            .map_err(|_| anyhow::anyhow!("rng failed"))?;
        Ok(salt)
    }

    pub fn generate_device_key() -> anyhow::Result<[u8; 16]> {
        let mut key = [0u8; 16];
        SystemRandom::new().fill(&mut key)
            .map_err(|_| anyhow::anyhow!("rng failed"))?;
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = [0x42u8; 32];
        let plaintext = b"Hello, Mynx!";

        let encrypted = Aes256GcmAead::encrypt(&key, plaintext).unwrap();
        let decrypted = Aes256GcmAead::decrypt(&key, &encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_aes_gcm_wrong_key_fails() {
        let key = [0x42u8; 32];
        let wrong_key = [0x43u8; 32];
        let plaintext = b"secret data";

        let encrypted = Aes256GcmAead::encrypt(&key, plaintext).unwrap();
        let result = Aes256GcmAead::decrypt(&wrong_key, &encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn test_random_generation() {
        let bytes = CryptoModule::generate_random_bytes(32).unwrap();
        assert_eq!(bytes.len(), 32);
        assert!(bytes.iter().any(|b| *b != 0));
    }
}

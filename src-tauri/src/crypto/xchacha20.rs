use chacha20poly1305::{
    XChaCha20Poly1305, Key, XNonce, KeyInit,
};
use chacha20poly1305::aead::{Aead, AeadCore};
use rand_core::OsRng;

const KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 24;
const TAG_SIZE: usize = 16;

pub struct XChaCha20Aead;

impl XChaCha20Aead {
    /// Encrypt plaintext with XChaCha20-Poly1305.
    /// Returns: nonce (24 bytes) + ciphertext + tag concatenated.
    pub fn encrypt(key: &[u8; KEY_SIZE], plaintext: &[u8]) -> anyhow::Result<Vec<u8>> {
        let key = Key::from_slice(key);
        let cipher = XChaCha20Poly1305::new(key);

        let nonce = XChaCha20Poly1305::generate_nonce(OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, plaintext)
            .map_err(|e| anyhow::anyhow!("encryption failed: {}", e))?;

        let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    /// Decrypt data encrypted with encrypt().
    /// Input format: nonce (24 bytes) || ciphertext + tag
    pub fn decrypt(key: &[u8; KEY_SIZE], ciphertext: &[u8]) -> anyhow::Result<Vec<u8>> {
        if ciphertext.len() < NONCE_SIZE + TAG_SIZE {
            return Err(anyhow::anyhow!("ciphertext too short"));
        }

        let nonce = XNonce::from_slice(&ciphertext[..NONCE_SIZE]);
        let encrypted = &ciphertext[NONCE_SIZE..];

        let key = Key::from_slice(key);
        let cipher = XChaCha20Poly1305::new(key);

        let plaintext = cipher
            .decrypt(nonce, encrypted)
            .map_err(|e| anyhow::anyhow!("decryption failed: {}", e))?;

        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xchacha20_roundtrip() {
        let key = [0x42u8; KEY_SIZE];
        let plaintext = b"Hello, Mynx! XChaCha20 test.";

        let encrypted = XChaCha20Aead::encrypt(&key, plaintext).unwrap();
        assert!(encrypted.len() > NONCE_SIZE + plaintext.len());

        let decrypted = XChaCha20Aead::decrypt(&key, &encrypted).unwrap();
        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_xchacha20_different_nonces() {
        let key = [0x42u8; KEY_SIZE];
        let plaintext = b"same plaintext";

        let enc1 = XChaCha20Aead::encrypt(&key, plaintext).unwrap();
        let enc2 = XChaCha20Aead::encrypt(&key, plaintext).unwrap();

        // Different nonces → different ciphertexts
        assert_ne!(enc1, enc2);
    }

    #[test]
    fn test_xchacha20_wrong_key_fails() {
        let key = [0x42u8; KEY_SIZE];
        let wrong_key = [0x43u8; KEY_SIZE];
        let plaintext = b"secret data";

        let encrypted = XChaCha20Aead::encrypt(&key, plaintext).unwrap();
        let result = XChaCha20Aead::decrypt(&wrong_key, &encrypted);
        assert!(result.is_err());
    }
}

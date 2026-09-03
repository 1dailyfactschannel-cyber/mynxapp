use chacha20poly1305::{
    XChaCha20Poly1305, Key, XNonce, KeyInit,
};
use chacha20poly1305::aead::{Aead, AeadCore, Payload};
use rand_core::OsRng;

const KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 24;
const TAG_SIZE: usize = 16;

pub struct XChaCha20Aead;

impl XChaCha20Aead {
    /// Encrypt plaintext with XChaCha20-Poly1305 (no additional
    /// authenticated data). Returns: nonce (24 bytes) + ciphertext + tag.
    /// (production code always binds a role AAD; plain form kept for tests)
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn encrypt(key: &[u8; KEY_SIZE], plaintext: &[u8]) -> anyhow::Result<Vec<u8>> {
        Self::encrypt_with_aad(key, plaintext, b"")
    }

    /// Encrypt plaintext with XChaCha20-Poly1305, authenticating `aad`
    /// together with the plaintext. The header ciphertext can then only be
    /// verified under the same role binding, preventing ciphertext
    /// transplantation between header/payload/decoy/keyfile contexts.
    /// Returns: nonce (24 bytes) + ciphertext + tag concatenated.
    pub fn encrypt_with_aad(key: &[u8; KEY_SIZE], plaintext: &[u8], aad: &[u8]) -> anyhow::Result<Vec<u8>> {
        let key = Key::from_slice(key);
        let cipher = XChaCha20Poly1305::new(key);

        let nonce = XChaCha20Poly1305::generate_nonce(OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, Payload { msg: plaintext, aad })
            .map_err(|e| anyhow::anyhow!("encryption failed: {}", e))?;

        let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    /// Decrypt data encrypted with encrypt() (no additional authenticated
    /// data). Input format: nonce (24 bytes) || ciphertext + tag
    pub fn decrypt(key: &[u8; KEY_SIZE], ciphertext: &[u8]) -> anyhow::Result<Vec<u8>> {
        Self::decrypt_with_aad(key, ciphertext, b"")
    }

    /// Decrypt data encrypted with encrypt_with_aad().
    /// Input format: nonce (24 bytes) || ciphertext + tag
    pub fn decrypt_with_aad(key: &[u8; KEY_SIZE], ciphertext: &[u8], aad: &[u8]) -> anyhow::Result<Vec<u8>> {
        if ciphertext.len() < NONCE_SIZE + TAG_SIZE {
            return Err(anyhow::anyhow!("ciphertext too short"));
        }

        let nonce = XNonce::from_slice(&ciphertext[..NONCE_SIZE]);
        let encrypted = &ciphertext[NONCE_SIZE..];

        let key = Key::from_slice(key);
        let cipher = XChaCha20Poly1305::new(key);

        let plaintext = cipher
            .decrypt(nonce, Payload { msg: encrypted, aad })
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
    fn test_xchacha20_aad_binding() {
        let key = [0x42u8; KEY_SIZE];
        let plaintext = b"inner-header";

        let encrypted = XChaCha20Aead::encrypt_with_aad(&key, plaintext, b"mynx:v2:header").unwrap();
        // Wrong AAD → authentication must fail
        assert!(XChaCha20Aead::decrypt_with_aad(&key, &encrypted, b"mynx:v2:decoy-header").is_err());
        // Empty AAD (legacy path) must also fail
        assert!(XChaCha20Aead::decrypt(&key, &encrypted).is_err());
        // Correct AAD → roundtrip
        let dec = XChaCha20Aead::decrypt_with_aad(&key, &encrypted, b"mynx:v2:header").unwrap();
        assert_eq!(dec, plaintext.to_vec());
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

use stellar_sdk::crypto::KeyPair;
use sha2::{Sha256, Digest};
use std::env;

pub fn derive_keypair_from_seed(seed: &str, derivation_path: Option<&str>) -> KeyPair {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    
    if let Some(path) = derivation_path {
        hasher.update(path.as_bytes());
    }
    
    let result = hasher.finalize();
    let seed_bytes: [u8; 32] = result.into();
    KeyPair::from_seed(&seed_bytes)
}

pub fn get_master_seed() -> Result<String, String> {
    match env::var("MASTER_SEED") {
        Ok(seed) => {
            if seed.len() < 32 {
                return Err("MASTER_SEED must be at least 32 characters".to_string());
            }
            Ok(seed)
        }
        Err(_) => {
            match std::fs::read_to_string("/etc/seeds/master_seed.txt") {
                Ok(seed) => {
                    if seed.trim().len() < 32 {
                        return Err("Seed file must contain at least 32 characters".to_string());
                    }
                    Ok(seed.trim().to_string())
                }
                Err(_) => Err("MASTER_SEED not set and seed file not found".to_string()),
            }
        }
    }
}

pub fn derive_keypair_for_purpose(purpose: &str) -> Result<KeyPair, String> {
    let master_seed = get_master_seed()?;
    Ok(derive_keypair_from_seed(&master_seed, Some(purpose)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_derivation() {
        let seed = "test_seed_12345_secure_test_seed_12345";
        let keypair1 = derive_keypair_from_seed(seed, None);
        let keypair2 = derive_keypair_from_seed(seed, None);
        assert_eq!(keypair1.public_key(), keypair2.public_key());
    }

    #[test]
    fn test_different_purposes() {
        let seed = "test_seed_12345_secure_test_seed_12345";
        let keypair1 = derive_keypair_from_seed(seed, Some("payment"));
        let keypair2 = derive_keypair_from_seed(seed, Some("signing"));
        assert_ne!(keypair1.public_key(), keypair2.public_key());
    }
}

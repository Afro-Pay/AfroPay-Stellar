use stellar_sdk::crypto::KeyPair;
use sha2::{Sha256, Digest};
use std::env;
use std::fs;

// Load master seed from environment or file
fn get_master_seed() -> Result<String, String> {
    match env::var("MASTER_SEED") {
        Ok(seed) => {
            if seed.len() < 32 {
                return Err("MASTER_SEED must be at least 32 characters".to_string());
            }
            Ok(seed)
        }
        Err(_) => {
            match fs::read_to_string("/etc/seeds/master_seed.txt") {
                Ok(seed) => {
                    let trimmed = seed.trim();
                    if trimmed.len() < 32 {
                        return Err("Seed file must contain at least 32 characters".to_string());
                    }
                    Ok(trimmed.to_string())
                }
                Err(_) => Err("MASTER_SEED not set and seed file not found".to_string()),
            }
        }
    }
}

// Derive deterministic keypair from seed
fn derive_keypair(seed: &str, purpose: Option<&str>) -> KeyPair {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    if let Some(p) = purpose {
        hasher.update(p.as_bytes());
    }
    let result = hasher.finalize();
    let seed_bytes: [u8; 32] = result.into();
    KeyPair::from_seed(&seed_bytes)
}

fn main() {
    println!("🚀 Starting Rust Worker with Deterministic Keypairs");
    
    // Load the master seed
    match get_master_seed() {
        Ok(seed) => {
            println!("✅ Master seed loaded successfully");
            
            // Derive worker keypair
            let keypair = derive_keypair(&seed, Some("worker"));
            println!("✅ Worker keypair derived:");
            println!("   Public Key: {}", keypair.public_key());
            
            // Here you would start your actual worker logic
            println!("✅ Worker is ready to process jobs");
            
            // Keep the worker running
            loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
                println!("⏳ Worker is still running...");
            }
        }
        Err(e) => {
            eprintln!("❌ Failed to load master seed: {}", e);
            eprintln!("   Please set MASTER_SEED environment variable or create /etc/seeds/master_seed.txt");
            std::process::exit(1);
        }
    }
}

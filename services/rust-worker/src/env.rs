use std::process;

pub fn validate_env() {
    let required = [
        ("REDIS_URL", "Redis connection string (e.g. redis://localhost:6379)"),
        ("STELLAR_HORIZON_URL", "Stellar Horizon API URL (e.g. https://horizon-testnet.stellar.org)"),
    ];

    let mut missing: Vec<&str> = Vec::new();

    for (key, hint) in &required {
        if std::env::var(key).is_err() {
            eprintln!("  {} — {}", key, hint);
            missing.push(key);
        }
    }

    if !missing.is_empty() {
        eprintln!();
        eprintln!("[AfroPay] FATAL: Required environment variables are missing for Rust Worker.");
        eprintln!("Set them in your environment or .env file before starting the worker.");
        process::exit(1);
    }
}

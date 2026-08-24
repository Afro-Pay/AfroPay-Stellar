use std::process;

pub fn validate_env() {
    let required = [
        ("DATABASE_URL", "PostgreSQL connection string"),
        ("REDIS_URL", "Redis connection string"),
        ("HORIZON_URL", "Stellar Horizon API URL"),
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

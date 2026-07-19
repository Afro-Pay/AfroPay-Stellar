# Deterministic Keypair Derivation

## Overview
The Rust worker uses deterministic keypair derivation based on a secure master seed. This ensures that keys can be reliably recovered and eliminates random one-off key generation.

## How It Works

### Master Seed Loading
The master seed is loaded in the following order:
1. `MASTER_SEED` environment variable (preferred)
2. `/etc/seeds/master_seed.txt` (fallback for containerized environments)

### Key Derivation
Keys are derived using:
- SHA-256 hashing of the master seed
- Optional derivation path for different purposes
- 32-byte seed extraction for Stellar keypair generation

### Derivation Functions

#### `derive_keypair_from_seed(seed, derivation_path)`
Derives a keypair from a seed string with optional derivation path.

#### `derive_keypair_for_purpose(purpose)`
Derives a keypair for a specific purpose (e.g., "payment", "signing").

#### `derive_keypair_for_user(user_id, context)`
Derives a keypair for a specific user or context.

## Security Considerations

### Seed Storage
- Never commit the seed to version control
- Use environment variables or secure secret storage
- Rotate seeds periodically

### Seed Requirements
- Minimum 32 characters
- Use high entropy (random string)
- Store in secure location

## Recovery
To recover keys:
1. Set the same `MASTER_SEED` environment variable
2. The worker will derive the same keypair
3. All derived keys will be identical

## Configuration Examples

### Environment Variable
```bash
export MASTER_SEED="your_secure_32_character_seed_here"

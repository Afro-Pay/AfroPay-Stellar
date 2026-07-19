# Soroban Contracts

AfroPay Stellar Soroban workspace for on-chain remittance verification.

## Project Structure

```text
contracts/
├── contracts/payment_registry/   # Payment registry Soroban contract
├── scripts/
│   ├── deploy.sh                 # Compile + deploy to testnet/local
│   ├── test-harness.sh           # Local validation harness
│   └── lib/common.sh             # Shared network/deploy helpers
├── deployments/                  # Generated deployment records (gitignored)
├── Cargo.toml
└── README.md
```

## Prerequisites

- Rust toolchain (1.84+) via [rustup](https://rustup.rs/)
- `wasm32v1-none` target (scripts run `rustup target add wasm32v1-none` automatically)
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)

> **Note:** Soroban wasm builds require the rustup-managed toolchain. If you have a Homebrew `cargo`/`rustc` install, the scripts prefer rustup's binaries automatically.

## Quick Start

From the `contracts/` directory:

```bash
# 1. Run unit tests + wasm build validation
chmod +x scripts/*.sh scripts/lib/common.sh
./scripts/test-harness.sh

# 2. Deploy to testnet (funds deployer via friendbot)
./scripts/deploy.sh --network testnet --fund

# 3. Deploy to local network (requires local RPC)
docker run --rm -d -p 8000:8000 --name stellar stellar/quickstart:latest --local --enable-soroban-rpc
./scripts/deploy.sh --network local --fund

# 4. End-to-end harness against local RPC (if reachable)
./scripts/test-harness.sh --e2e-local --fund
```

## Deployment Scripts

`scripts/deploy.sh` will:

1. Configure the target network (`testnet` or `local`)
2. Create/fund the deployer account (optional `--fund`)
3. Build the `payment_registry` wasm via `stellar contract build`
4. Deploy the contract and save metadata to `deployments/<network>.json`
5. Invoke `version()` to validate the deployment

## Test Harness

`scripts/test-harness.sh` always runs:

- `cargo test` for contract unit tests
- `stellar contract build` to compile wasm

Optional flags:

- `--e2e-local` deploy + validate on local RPC when available
- `--e2e-testnet` deploy + validate on testnet
- `--fund` fund deployer before e2e deployment

## Contract: payment_registry

On-chain registry for remittance payment verification:

- `initialize(admin)` — set contract admin
- `register_payment(admin, payment_id, amount, recipient)` — register a payment
- `get_payment(payment_id)` — read stored payment metadata
- `is_registered(payment_id)` — check registration status
- `version()` — deployment validation helper

## Environment Overrides

| Variable | Description |
|---|---|
| `SOROBAN_RPC_URL` | Override RPC endpoint for selected network |
| `STELLAR_NETWORK` | Set by scripts during deploy/invoke |
| `STELLAR_RPC_URL` | Set by scripts during deploy/invoke |

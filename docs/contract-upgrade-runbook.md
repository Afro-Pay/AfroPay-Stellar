# Soroban Contract Upgrade Runbook

This runbook applies to `escrow`, `governor`, and `payment_registry`. Contract version 2 stores `StorageVersion` in instance storage. Every migration requires the contract admin's authorization.

## Preconditions

- Confirm the target contract ID, network, admin signing account, and current `version()`.
- Build and test the exact wasm artifact that will be upgraded.
- For `payment_registry`, prepare every legacy payment ID that must be migrated. Soroban persistent storage cannot be enumerated from a contract.
- Keep the previous wasm hash and deployment transaction available for rollback.

## Install

Install the new wasm and record the returned wasm hash:

```bash
stellar contract install \
  --wasm contracts/contracts/payment_registry/target/wasm32v1-none/release/payment_registry.wasm \
  --source-account afropay_deployer \
  --network testnet
```

The same command applies to the other contracts after changing the wasm path.

## Upgrade

Upgrade the existing contract to the installed wasm hash:

```bash
stellar contract upgrade \
  --id C... \
  --wasm-hash WASM_HASH \
  --source-account afropay_deployer \
  --network testnet
```

Use `./contracts/scripts/deploy.sh --upgrade --contract-id C... --payment-id legacy-id` for the payment registry, or `./scripts/deploy-contract.sh --upgrade --contract-id C...` for escrow.

## Migrate

The migration call must be sent by the stored admin and is deliberately separate from the upgrade transaction.

For `payment_registry`, pass all affected IDs in the migration batch:

```bash
stellar contract invoke \
  --id C... \
  --source-account afropay_deployer \
  --network testnet \
  -- migrate \
  --admin afropay_deployer \
  --payment-ids '["legacy-id-1", "legacy-id-2"]'
```

For `escrow` and `governor`, the v2 migration currently validates admin authorization and advances the instance version tag:

```bash
stellar contract invoke \
  --id C... \
  --source-account afropay_deployer \
  --network testnet \
  -- migrate \
  --admin afropay_deployer
```

Verify `version()` after migration and exercise read-only checks for existing records before resuming writes.

## Rollback

1. Stop application writes and record the failed upgrade and migration transaction hashes.
2. If migration has not run, install the previous wasm and upgrade the contract back to the saved previous wasm hash.
3. If migration has run, do not roll back blindly: the v2 layout may contain data that v1 cannot read. Restore the previous wasm only after a tested reverse migration or restore procedure exists.
4. Re-run `version()` and contract-specific read checks, then resume writes only after the storage layout is verified.

A contract upgrade does not automatically run `migrate()`. Treat the install, upgrade, migration, and verification calls as one change window.

# Trustline Management Utilities

Reusable utilities for detecting, creating, and validating Stellar trustlines
for non-native assets (USDC, NGN, etc.). Available in both the Rust worker and
the TypeScript API layer.

---

## TypeScript (`apps/api/src/anchor/trustline.utils.ts`)

### Key exports

| Export | Description |
|--------|-------------|
| `checkTrustline(horizonUrl, publicKey, asset)` | Returns the current `TrustlineStatus` for a single asset. Throws `TrustlineError` if the account doesn't exist. |
| `ensureTrustline(horizonUrl, keypair, asset, network?)` | Creates a trustline if missing. No-op if already present. Throws on auth/limit issues. |
| `checkTrustlinesBatch(horizonUrl, publicKey, assets[])` | Checks multiple assets. Individual failures don't block the rest. |
| `isTrustlineError(value)` | Type guard to distinguish `TrustlineStatus` from `TrustlineError` in batch results. |
| `KNOWN_ASSETS` | Pre-configured `{ USDC, NGN }` — override issuers via `USDC_ISSUER` / `NGN_ISSUER` env vars. |

### `TrustlineStatus`

```ts
{
  status: 'exists' | 'missing' | 'unauthorised' | 'zero_limit';
  balance?: string;   // present when status === 'exists'
  limit?: string;     // present when status === 'exists'
  asset: TrustlineAsset;
}
```

### `TrustlineError`

```ts
{
  code:
    | 'ACCOUNT_NOT_FOUND'
    | 'AUTHORISATION_REQUIRED'
    | 'ZERO_LIMIT'
    | 'INSUFFICIENT_RESERVE'
    | 'HORIZON_ERROR'
    | 'UNKNOWN';
  message: string;
  asset: TrustlineAsset;
  horizonStatus?: number;
}
```

### Usage example

```ts
import { ensureTrustline, checkTrustlinesBatch, KNOWN_ASSETS, isTrustlineError } from './trustline.utils';
import { Keypair, Networks } from 'stellar-sdk';

// Ensure a USDC trustline exists before sending
const keypair = Keypair.fromSecret(decryptedSecret);
const result = await ensureTrustline(horizonUrl, keypair, KNOWN_ASSETS.USDC);
if (result.created) {
  console.log(`Trustline created, tx: ${result.txHash}`);
}

// Batch check — useful for pre-flight validation
const results = await checkTrustlinesBatch(horizonUrl, publicKey, [
  KNOWN_ASSETS.USDC,
  KNOWN_ASSETS.NGN,
]);
for (const { asset, result } of results) {
  if (isTrustlineError(result)) {
    console.error(`${asset.code}: ${result.message}`);
  } else {
    console.log(`${asset.code}: ${result.status}`);
  }
}
```

### Error handling guidance

| Error code | Cause | Resolution |
|------------|-------|------------|
| `ACCOUNT_NOT_FOUND` | Account not yet funded on-chain | Fund the account with base reserve XLM first |
| `AUTHORISATION_REQUIRED` | Issuer uses `AUTH_REQUIRED` flag | User must request authorisation from the issuer |
| `ZERO_LIMIT` | Trustline limit set to 0 | Submit a new `ChangeTrust` with a non-zero limit |
| `INSUFFICIENT_RESERVE` | Not enough XLM for the 0.5 XLM reserve per trustline | Top up the account's XLM balance |
| `HORIZON_ERROR` | Horizon returned a non-2xx response | Inspect `horizonStatus` and retry if transient |

---

## Rust (`services/rust-worker/src/trustline.rs`)

### Key public items

| Item | Description |
|------|-------------|
| `check_trustline(horizon_url, public_key, asset)` | Async fn returning `TrustlineStatus` or `TrustlineError`. |
| `ensure_trustline(horizon_url, source_secret, asset)` | Creates trustline if missing. Returns `Ok(())` or a typed error. |
| `check_trustlines_batch(horizon_url, public_key, assets)` | Returns `Vec<(TrustlineAsset, Result<TrustlineStatus, TrustlineError>)>`. |
| `TrustlineStatus` | Enum: `Exists { balance, limit }`, `Missing`, `Unauthorised`, `ZeroLimit`. |
| `TrustlineError` | `thiserror`-derived enum covering all failure modes. |

### Usage example

```rust
use crate::trustline::{ensure_trustline, check_trustline, TrustlineAsset, TrustlineError};

let usdc = TrustlineAsset {
    code: "USDC".into(),
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN".into(),
};

match ensure_trustline(&horizon_url, &source_secret, &usdc).await {
    Ok(()) => tracing::info!("Trustline ready"),
    Err(TrustlineError::AuthorisationRequired(code)) =>
        tracing::error!("{code} requires issuer authorisation"),
    Err(TrustlineError::ZeroLimit(code)) =>
        tracing::error!("{code} trustline limit is zero"),
    Err(e) => return Err(e.into()),
}
```

### Error variants

| Variant | Meaning |
|---------|---------|
| `AccountNotFound(String)` | Account does not exist on Horizon |
| `AuthorisationRequired(String)` | Issuer has `AUTH_REQUIRED`; account not yet approved |
| `ZeroLimit(String)` | Trustline exists with a zero limit |
| `HorizonError { status, body }` | Non-success HTTP response from Horizon |
| `Network(reqwest::Error)` | Network-level failure |
| `Other(anyhow::Error)` | Any other unexpected error |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon endpoint |
| `USDC_ISSUER` | Testnet USDC issuer | Override for mainnet |
| `NGN_ISSUER` | Testnet NGN issuer | Override for mainnet |

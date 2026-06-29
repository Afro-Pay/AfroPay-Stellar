# Escrow Contract

A Soroban smart contract for holding funds conditionally on the Stellar network. This escrow contract enables time-locked payments where funds are held securely and released only when specified conditions are met.

## Features

- **Time-locked escrows**: Funds are held until a specified release timestamp
- **Conditional release**: Recipients can only access funds after the release timestamp
- **Depositor refunds**: Depositors can reclaim funds before the release timestamp
- **Multi-asset support**: Works with any Stellar asset (XLM or custom tokens)
- **Unique escrow IDs**: Each escrow is assigned a unique identifier for tracking

## Contract Functions

### `deposit(from, amount, asset, recipient, release_timestamp)`

Lock funds in the escrow contract.

**Parameters:**
- `from: Address` - The address depositing the funds (must authorize the transaction)
- `amount: i128` - The amount to deposit (must be positive)
- `asset: Address` - The asset contract address
- `recipient: Address` - The address that will receive the funds upon release
- `release_timestamp: u64` - Unix timestamp when funds can be released (must be in the future)

**Returns:** `U256` - The unique escrow ID

**Requirements:**
- `amount` must be greater than 0
- `release_timestamp` must be greater than the current ledger timestamp
- `from` must authorize the transaction
- Sufficient token balance must be available at `from` address

**Errors:**
- `"amount must be positive"` - if amount <= 0
- `"release_timestamp must be in the future"` - if timestamp <= current time

---

### `release(escrow_id)`

Release funds from escrow to the recipient.

**Parameters:**
- `escrow_id: U256` - The unique escrow ID returned by `deposit`

**Returns:** None

**Requirements:**
- The escrow must exist
- The release timestamp must have passed
- The escrow must not have been released already
- The escrow must not have been refunded

**Errors:**
- `"escrow not found"` - if escrow_id does not exist
- `"escrow already released"` - if funds were already released
- `"escrow already refunded"` - if funds were already refunded
- `"release timestamp not reached"` - if current time < release_timestamp

---

### `refund(escrow_id)`

Allow the depositor to reclaim funds if the escrow expires without release.

**Parameters:**
- `escrow_id: U256` - The unique escrow ID returned by `deposit`

**Returns:** None

**Requirements:**
- The escrow must exist
- The depositor must authorize the transaction
- The escrow must not have been released already
- The escrow must not have been refunded already
- The release timestamp must not have passed

**Errors:**
- `"escrow not found"` - if escrow_id does not exist
- `"escrow already released"` - if funds were already released
- `"escrow already refunded"` - if funds were already refunded
- `"cannot refund after release timestamp"` - if current time >= release_timestamp

---

### `get_escrow(escrow_id)`

Read-only query of escrow state.

**Parameters:**
- `escrow_id: U256` - The unique escrow ID returned by `deposit`

**Returns:** `Option<EscrowRecord>` - The escrow record if it exists, None otherwise

---

### `version()`

Contract version for deployment validation.

**Returns:** `u32` - The contract version number

## Data Types

### `EscrowRecord`

Struct representing an escrow's state.

**Fields:**
- `depositor: Address` - The address that deposited the funds
- `recipient: Address` - The address that will receive the funds
- `amount: i128` - The amount held in escrow
- `asset: Address` - The asset contract address
- `release_timestamp: u64` - Unix timestamp when funds can be released
- `created_at: u64` - Unix timestamp when the escrow was created
- `is_released: bool` - Whether funds have been released to recipient
- `is_refunded: bool` - Whether funds have been refunded to depositor

### `DataKey`

Internal storage keys for contract data.

**Variants:**
- `EscrowCounter` - Tracks the next available escrow ID
- `Escrow(U256)` - Maps escrow IDs to their records

## Storage Pattern

The contract uses instance storage with the following TTL strategy:
- Escrow records are stored with a 1-year TTL
- Storage is extended when escrows are created
- Each escrow is stored under a unique key derived from its ID

## Security Considerations

1. **Time-lock enforcement**: Funds cannot be released before the specified timestamp
2. **Depositor control**: Only the original depositor can request a refund
3. **State protection**: Once released or refunded, escrow state is immutable
4. **Authorization**: All state-changing operations require proper authorization
5. **Asset safety**: Tokens are transferred using the standard Soroban token interface

## Usage Example

```rust
// 1. Deposit funds into escrow
let escrow_id = contract.deposit(
    &depositor_address,
    &1000,  // amount
    &asset_address,  // XLM or custom token
    &recipient_address,
    &1735689600,  // release timestamp (Jan 1, 2025)
);

// 2. After release timestamp, recipient can claim funds
contract.release(&escrow_id);

// OR, before release timestamp, depositor can refund
contract.refund(&escrow_id);

// 3. Check escrow status
let record = contract.get_escrow(&escrow_id);
```

## Building

```bash
# Build the contract to WASM
make build

# Or using stellar contract directly
stellar contract build
```

## Testing

```bash
# Run unit tests
make test

# Or using cargo directly
cargo test
```

## Deployment

See the deployment script at `scripts/deploy-contract.sh` for deploying to Stellar testnet or local network.

## License

Part of the AfroPay-Stellar project.

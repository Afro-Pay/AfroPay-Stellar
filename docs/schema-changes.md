# Schema Changes — Data Integrity Improvements

## Migration: `add_wallet_fk_enum_indexes`

### What changed

#### `TransactionStatus` enum
- Replaced the raw `String` status field with a proper `TransactionStatus` enum: `PENDING | RETRYING | SUCCESS | FAILED`.
- Prevents invalid status values from ever reaching the database.

#### `Transaction` model
| Change | Reason |
|--------|--------|
| Added `walletId TEXT NOT NULL` | Enforces that every transaction is tied to a specific wallet, not just a user. Prevents orphaned transaction records. |
| FK `walletId → Wallet.id` (RESTRICT delete) | Blocks deletion of a wallet that still has transactions attached — protects audit history. |
| FK `userId → User.id` (CASCADE delete) | Removes a user's transactions when the user account is deleted. |
| `destination`, `amount`, `assetCode` are non-nullable | These fields are required for every transfer; the DB now enforces that constraint. |
| `stellarTxHash` → `@unique` | Two confirmed transactions can never share the same Stellar tx hash. |
| `status` → `TransactionStatus` enum | Type-safe status values enforced at the DB level. |
| `@@index([userId, createdAt DESC])` | Speeds up the `getHistory` query which orders by newest first. |
| `@@index([walletId, createdAt DESC])` | Supports per-wallet history queries. |

#### `Wallet` model
| Change | Reason |
|--------|--------|
| FK `userId → User.id` (CASCADE delete) | Removes the wallet when the user is deleted — no orphaned wallet rows. |
| Added back-relation `transactions Transaction[]` | Allows Prisma to navigate wallet → transactions. |

### Application changes
- `TransactionService.sendTransfer` now resolves the wallet for the user and populates `walletId` before inserting the transaction.
- `shared-types` `Transaction` interface gains `walletId: string` and uses the exported `TransactionStatus` type.

### Running the migration
```bash
# Apply to your database
npx prisma migrate deploy

# Or in development (also regenerates the client)
npx prisma migrate dev
```

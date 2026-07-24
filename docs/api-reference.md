# Backend API Reference

This document provides a comprehensive guide to the NestJS backend API. Each section covers the available endpoints, required Data Transfer Objects (DTOs), expected response shapes, and concise example payloads to help integrators call the API reliably.

All endpoints except `/auth/register` and `/auth/login` require an Authorization header with a valid JWT token:
`Authorization: Bearer <token>`

## Rate Limiting

Public-facing write and anchor endpoints are throttled per client bucket to
protect login, wallet creation, transaction submission, and anchor quote flows
from abuse. Limits can be configured through environment variables:

| Variable | Default | Applies to |
| --- | --- | --- |
| `RATE_LIMIT_MAX` | `60` | Global fallback limit per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Global fallback window in milliseconds. |
| `LOGIN_RATE_LIMIT_MAX` | `5` | `POST /auth/login`. |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `60000` | Login-specific window. |
| `PUBLIC_API_RATE_LIMIT_MAX` | `20` | `POST /wallet/create`, `POST /transactions/send`. |
| `PUBLIC_API_RATE_LIMIT_WINDOW_MS` | `60000` | Public API write window. |
| `ANCHOR_RATE_LIMIT_MAX` | `20` | `GET /anchor/deposit`, `GET /anchor/withdraw`, `GET /anchor/fx-rate`. |
| `ANCHOR_RATE_LIMIT_WINDOW_MS` | `60000` | Anchor endpoint window. |

When a client exceeds a limit, the API returns HTTP `429` with rate-limit
headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and
`Retry-After`) and a JSON body that clients can distinguish from validation or
authentication errors:

```json
{
  "code": "RATE_LIMITED",
  "message": "Too many requests. Please retry after the rate limit window resets.",
  "retryAfterSeconds": 30,
  "limit": 20,
  "windowMs": 60000
}
```

---

## 1. Authentication Endpoints

### 1.1 Register
Create a new user account.

**Endpoint:** `POST /auth/register`

**Request DTO:**
- `email` (string): Must be a valid email address.
- `password` (string): Must be at least 8 characters long.

**Example Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Example Response:**
```json
{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "accessToken": "eyJhbG..."
}
```

### 1.2 Login
Authenticate an existing user.

**Endpoint:** `POST /auth/login`

**Request DTO:**
- `email` (string): Must be a valid email address.
- `password` (string): Must be at least 8 characters long.

**Example Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Example Response:**
```json
{
  "accessToken": "eyJhbG..."
}
```

---

## 2. Wallet Endpoints

### 2.1 Create Wallet
Create a new Stellar wallet for the authenticated user.

**Endpoint:** `POST /wallet/create`

**Request Payload:** Empty Body

**Example Response:**
```json
{
  "publicKey": "GBX...XYZ",
  "message": "Wallet created successfully"
}
```

### 2.2 Get Balances
Retrieve the current balances for the user's wallet.

**Endpoint:** `GET /wallet/balances`

**Example Response:**
```json
[
  {
    "assetCode": "XLM",
    "balance": "150.00"
  },
  {
    "assetCode": "USDC",
    "balance": "50.00"
  }
]
```

### 2.3 Export Wallet
Export the user's wallet secret key (Requires re-authentication or specific permissions in a real app).

**Endpoint:** `GET /wallet/export`

**Example Response:**
```json
{
  "secretKey": "SAX...XYZ"
}
```

### 2.4 Import Wallet
Import an existing Stellar wallet using a secret key.

**Endpoint:** `POST /wallet/import`

**Request DTO:**
- `secretKey` (string): The Stellar secret key to import.

**Example Request:**
```json
{
  "secretKey": "SAX...XYZ"
}
```

**Example Response:**
```json
{
  "publicKey": "GBX...XYZ",
  "message": "Wallet imported successfully"
}
```

### 2.5 Reconcile Wallet
Compare the stored wallet record and recent application transaction activity with the current Stellar account state from Horizon.

**Endpoint:** `GET /wallet/reconcile`

**Example Response:**
```json
{
  "status": "drift_detected",
  "checkedAt": "2026-01-03T12:00:00.000Z",
  "wallet": {
    "id": "wallet-123",
    "publicKey": "GBX...XYZ"
  },
  "onChain": {
    "accountFound": true,
    "horizonUrl": "https://horizon-testnet.stellar.org",
    "sequence": "123456",
    "lastModifiedLedger": 1234,
    "lastModifiedTime": "2026-01-02T00:00:00Z",
    "balances": [
      {
        "asset": "XLM",
        "assetIssuer": null,
        "balance": "10.0000000",
        "trustline": false
      }
    ]
  },
  "application": {
    "trackedAssetCount": 1,
    "recentTransactionCount": 3,
    "expectedAssets": [
      {
        "asset": "USDC",
        "assetIssuer": "GISSUER...",
        "transactionCount": 2,
        "statuses": {
          "PENDING": 1,
          "SUCCESS": 1
        },
        "lastTransactionAt": "2026-01-03T00:00:00.000Z"
      }
    ]
  },
  "summary": {
    "discrepancyCount": 1,
    "criticalCount": 0,
    "missingTrustlineCount": 1
  },
  "discrepancies": [
    {
      "type": "MISSING_TRUSTLINE",
      "severity": "warning",
      "message": "Application activity references USDC, but the wallet has no matching on-chain trustline.",
      "asset": "USDC",
      "assetIssuer": "GISSUER..."
    }
  ]
}
```

**Discrepancy Types:**
- `ON_CHAIN_ACCOUNT_NOT_FOUND`: The stored wallet public key is not funded or cannot be found on Horizon.
- `MISSING_TRUSTLINE`: Recent application activity references a non-native asset that is absent from the wallet's on-chain trustlines.
- `STALE_LEDGER_STATE`: Application transaction state is newer than the last observed on-chain account modification time.

---

## 3. Transaction Endpoints

### 3.1 Send Transfer
Send a transaction to another Stellar public key.

**Endpoint:** `POST /transactions/send`

**Headers:**

| Header | Required | Description |
|---|---|---|
| `Idempotency-Key` | No | UUID identifying this logical transfer. Retrying with the same key returns the original response and never creates a second transfer. See [Idempotency](#idempotency) below. |

**Request DTO:**
- `destinationPublicKey` (string): The recipient's public key.
- `amount` (string): The amount to send.
- `assetCode` (string): The code of the asset (e.g., 'XLM', 'USDC').
- `assetIssuer` (string, optional): The issuer of the asset (if not XLM).
- `memo` (string, optional): A text memo to include with the transaction.

**Example Request:**
```json
{
  "destinationPublicKey": "GDX...ABC",
  "amount": "10.5",
  "assetCode": "XLM",
  "memo": "Payment for services"
}
```

**Example Response (`201 Created`):**
```json
{
  "txId": "9f8c1e2a-7d3b-4c1a-8e2f-2b7c9e0f1a23",
  "status": "PENDING"
}
```

The transfer is accepted and enqueued asynchronously; `status` is `PENDING` until the settlement worker updates it.

#### Idempotency

`POST /transactions/send` is **not safe to retry blindly** — without an idempotency key, a network retry or client re-POST creates a second transaction and enqueues a second settlement job, risking a double-spend of the same logical transfer.

To make a send safely retryable, supply an `Idempotency-Key` header:

```
Idempotency-Key: 3f6d1e2a-9c4b-4b2e-8a1d-2b7c9e0f1a23
```

| Aspect | Behaviour |
|---|---|
| **Format** | RFC 4122 UUID. A malformed value returns `400 Bad Request`. |
| **First request** | Processed normally; returns `201 Created` with `{ txId, status }`. |
| **Retry (same key, within 24h)** | Returns the **original** response with `200 OK`. No new transaction row, no new queue job. |
| **Different key** | Treated as a new transfer (`201 Created`, new `txId`). |
| **Scope** | Keys are scoped per user (`idempotency:{userId}:{key}`). The same key from two different users never collides. |
| **Retention** | Cached responses live for **24 hours**. After that the key is forgotten and a reuse is treated as a new transfer. |

**Guarantees.** Idempotency is enforced at three layers, so even concurrent retries cannot slip through:

1. A Redis response cache (`idempotency:{userId}:{key}`, 24h TTL) short-circuits completed duplicates.
2. A unique constraint on `(userId, idempotencyKey)` in the `Transaction` table rejects a concurrent duplicate at insert time — **before** any job is enqueued.
3. The settlement job is enqueued with a deterministic id derived from the key, so the queue collapses duplicate jobs into one.

**Scope note.** This covers the API layer (duplicate rows and duplicate enqueues). Deduplication inside the settlement worker is a separate concern and out of scope here.

**Example — retried request replays the original response:**
```
POST /transactions/send
Idempotency-Key: 3f6d1e2a-9c4b-4b2e-8a1d-2b7c9e0f1a23

→ 200 OK
{
  "txId": "9f8c1e2a-7d3b-4c1a-8e2f-2b7c9e0f1a23",
  "status": "PENDING"
}
```

### 3.2 Get Transaction History
Retrieve the paginated transaction history for the user's wallet. Uses cursor-based pagination so results stay stable as new transactions arrive.

**Endpoint:** `GET /transactions/history`

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | integer | No | `25` | Records per page. Must be between 1 and 100. Returns 400 if exceeded. |
| `cursor` | string | No | — | Opaque cursor from the previous response's `nextCursor`. Omit for the first page. |

**Example Request — first page:**
`GET /transactions/history?limit=25`

**Example Request — next page:**
`GET /transactions/history?limit=25&cursor=clx1abc2d3ef456789`

**Example Response:**
```json
{
  "data": [
    {
      "id": "clx1abc2d3ef456789",
      "type": "payment",
      "amount": "10.5",
      "assetCode": "XLM",
      "status": "SUCCESS",
      "createdAt": "2023-10-01T12:00:00Z"
    }
  ],
  "nextCursor": "clx9xyz8w7vu654321",
  "total": 120
}
```

**Pagination flow:**
1. Fetch the first page with `GET /transactions/history?limit=25`. Save `nextCursor`.
2. If `nextCursor` is non-null, fetch the next page: `GET /transactions/history?limit=25&cursor=<nextCursor>`.
3. Repeat until `nextCursor` is `null` — you have reached the last page.

**Error — limit exceeded:**
```json
{
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "limit must not exceed 100. Received: 200",
  "timestamp": "2023-10-01T12:00:00.000Z",
  "path": "/transactions/history"
}
```

### 3.3 Get Transaction by ID
Retrieve details of a specific transaction.

**Endpoint:** `GET /transactions/:id`

**Example Response:**
```json
{
  "id": "abc123def456...",
  "type": "payment",
  "source": "GBX...XYZ",
  "destination": "GDX...ABC",
  "amount": "10.5",
  "assetCode": "XLM",
  "status": "FAILED",
  "retryAttempts": 3,
  "lastFailureReason": "horizon transaction malformed",
  "failedAt": "2023-10-01T12:03:00Z"
}
```

---

## 4. Anchor Endpoints

### 4.1 Get Deposit Info
Get instructions for depositing fiat to receive a Stellar asset.

**Endpoint:** `GET /anchor/deposit`

**Query Parameters:**
- `asset` (string): The asset to deposit. Allowed values: `USDC`, `NGN`.
- `account` (string): The user's Stellar public key. Must be a valid Stellar public key (`G...`).

**Example Request:**
`GET /anchor/deposit?asset=USDC&account=GBX...XYZ`

**Example Response:**
```json
{
  "how": "Bank transfer to Account Number 123456789",
  "fee": "1.00",
  "minAmount": "10.00"
}
```

### 4.2 Get Withdraw Info
Get instructions for withdrawing a Stellar asset to fiat.

**Endpoint:** `GET /anchor/withdraw`

**Query Parameters:**
- `asset` (string): The asset to withdraw. Allowed values: `USDC`, `NGN`.
- `account` (string): The user's Stellar public key. Must be a valid Stellar public key (`G...`).
- `amount` (string): The amount to withdraw as a decimal string.

**Example Request:**
`GET /anchor/withdraw?asset=USDC&account=GBX...XYZ&amount=50.00`

**Example Response:**
```json
{
  "accountId": "GANC...XYZ",
  "memoType": "id",
  "memo": "987654321",
  "fee": "1.00"
}
```

### 4.3 Get FX Rate
Get the foreign exchange rate between two assets.

**Endpoint:** `GET /anchor/fx-rate`

**Query Parameters:**
- `from` (string): The source asset. Allowed values: `USD`, `NGN`, `XLM`.
- `to` (string): The target asset. Allowed values: `USD`, `NGN`, `XLM`.

**Example Request:**
`GET /anchor/fx-rate?from=USD&to=NGN`

**Example Response:**
```json
{
  "rate": "750.50",
  "timestamp": "2023-10-01T12:00:00Z"
}
```

---

## 5. Reconciliation Notes

Wallet reconciliation is exposed through `GET /wallet/reconcile`. It reports wallet drift directly for the authenticated user's stored wallet and does not mutate balances, transactions, or trustlines.

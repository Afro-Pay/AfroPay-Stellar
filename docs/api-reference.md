# Backend API Reference

This document provides a comprehensive guide to the NestJS backend API. Each section covers the available endpoints, required Data Transfer Objects (DTOs), expected response shapes, and concise example payloads to help integrators call the API reliably.

All endpoints except `/auth/register` and `/auth/login` require an Authorization header with a valid JWT token:
`Authorization: Bearer <token>`

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

**Example Response:**
```json
{
  "transactionId": "abc123def456...",
  "status": "success",
  "hash": "c4d5e..."
}
```

### 3.2 Get Transaction History
Retrieve the transaction history for the user's wallet.

**Endpoint:** `GET /transactions/history`

**Example Response:**
```json
[
  {
    "id": "abc123def456...",
    "type": "payment",
    "amount": "10.5",
    "assetCode": "XLM",
    "createdAt": "2023-10-01T12:00:00Z"
  }
]
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
  "status": "success"
}
```

---

## 4. Anchor Endpoints

### 4.1 Get Deposit Info
Get instructions for depositing fiat to receive a Stellar asset.

**Endpoint:** `GET /anchor/deposit`

**Query Parameters:**
- `asset` (string): The asset to deposit (e.g., 'USDC').
- `account` (string): The user's Stellar public key.

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
- `asset` (string): The asset to withdraw.
- `account` (string): The user's Stellar public key.
- `amount` (string): The amount to withdraw.

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
- `from` (string): The source asset.
- `to` (string): The target asset.

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

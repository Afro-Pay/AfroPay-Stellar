# API Reference

## Interactive Documentation

The AfroPay-Stellar API is fully documented using OpenAPI 3.1 with interactive Swagger UI.

### Access the API Documentation

**Development Environment:**
- **Swagger UI**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- **OpenAPI JSON**: [openapi.json](./openapi.json)

**Staging Environment:**
- **Swagger UI**: [https://api-staging.afropay.io/api/docs](https://api-staging.afropay.io/api/docs)

**Production Environment:**
- API documentation is disabled in production for security
- Refer to the exported `openapi.json` in this repository

## Quick Start

### Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

**Get a token:**
1. Register: `POST /api/auth/register`
2. Login: `POST /api/auth/login`
3. Use the returned `access_token` in subsequent requests

### Try It Out

Use the interactive Swagger UI to:
- **Browse all endpoints** organized by tags (auth, wallet, transaction, kyc, anchor)
- **View request/response schemas** with examples
- **Execute API calls** directly from the browser
- **Test authentication flows** with "Authorize" button

### Key Features

- **Auto-generated** from NestJS decorators and DTOs (always up-to-date)
- **Complete request/response examples** for all endpoints
- **Authentication support** with "Try it out" functionality
- **Response status codes** with detailed descriptions
- **DTO validation rules** documented inline

## API Endpoints Overview

### Authentication (`/api/auth`)
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login existing user
- `POST /auth/logout` - Logout user

### Wallet Management (`/api/wallet`)
- `POST /wallet/:id/enable-multisig` - Enable multi-signature wallet
- `GET /wallet/balances` - Get wallet balances

### Transactions (`/api/transactions`)
- `POST /transactions/send` - Send payment (supports idempotency)
- `GET /transactions` - Get filtered transaction history
- `GET /transactions/history` - Get paginated transaction history (cursor-based)
- `GET /transactions/:id` - Get transaction by ID
- `POST /transactions/:id/risk` - Update transaction risk score

### KYC Verification (`/api/kyc`)
- `POST /kyc/submit` - Submit KYC documentation
- `GET /kyc/status` - Get KYC verification status
- `POST /kyc/upload-url` - Generate presigned S3 upload URL
- `POST /kyc/confirm-upload` - Confirm document upload with hash verification

### Anchor Integration (`/api/anchor`)
- `GET /anchor/deposit` - Get deposit information from anchor
- `GET /anchor/withdraw` - Get withdrawal information from anchor
- `GET /anchor/fx-rate` - Get exchange rate from anchor

## OpenAPI Specification

The complete OpenAPI 3.1 specification is available at [openapi.json](./openapi.json).

### Updating the Spec

The OpenAPI spec is automatically generated when the API server starts in non-production mode:

```bash
cd apps/api
npm run start:dev
# OpenAPI spec exported to docs/openapi.json
```

### CI/CD Integration

The spec is regenerated and committed on every build to ensure it stays synchronized with code changes.

## Rate Limiting

Public-facing endpoints are rate-limited to prevent abuse:

| Endpoint Category | Default Limit | Window |
|------------------|---------------|--------|
| Login | 5 requests | 60 seconds |
| Public API (send, create wallet) | 20 requests | 60 seconds |
| Anchor endpoints | 20 requests | 60 seconds |

**Rate Limit Response (429):**
```json
{
  "code": "RATE_LIMITED",
  "message": "Too many requests. Please retry after the rate limit window resets.",
  "retryAfterSeconds": 30,
  "limit": 20,
  "windowMs": 60000
}
```

## Idempotency

`POST /transactions/send` supports idempotency via the `Idempotency-Key` header:

```
Idempotency-Key: <uuid>
```

- First request returns `201 Created`
- Retry with same key returns `200 OK` with original response
- Keys are scoped per user and cached for 24 hours

See Swagger UI for detailed examples.

## Support

- **Issues**: [GitHub Issues](https://github.com/El-Chapo-Npm/AfroPay-Stellar/issues)
- **Documentation**: [Project Documentation](../README.md)
- **API Changelog**: Check git history for `docs/openapi.json`

---

**Note**: This document replaces the hand-maintained API reference. All endpoint details are now auto-generated from the codebase and available in the interactive Swagger UI and OpenAPI spec.

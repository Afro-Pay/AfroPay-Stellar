# SEP-10 Stellar Authentication Implementation

## Overview
This document describes the implementation of SEP-10 wallet authentication for anchor endpoints.

## Current Implementation

### Stellar Address Validation
- Custom pipe `StellarAddressPipe` validates all Stellar addresses
- Checks format: starts with 'G', 56 characters, valid base32 characters
- Returns 400 for invalid addresses

### Ownership Verification
- All anchor endpoints check that the `account` query param matches the user's registered wallet
- Returns 403 if the account doesn't match
- Prevents users from accessing other users' wallet data

### SEP-10 Challenge Flow (Stretch Goal)
- GET `/anchor/auth/challenge` - Get challenge for wallet verification
- POST `/anchor/auth/token` - Exchange challenge for JWT token
- Future implementation will include proper signature verification

## Endpoints

### Protected Endpoints
| Endpoint | Method | Query Params | Ownership Check |
|----------|--------|--------------|-----------------|
| `/anchor/deposit` | GET | account, assetCode | ✅ |
| `/anchor/withdraw` | GET | account, assetCode | ✅ |
| `/anchor/fx-rate` | GET | account, type | ✅ |

### SEP-10 Endpoints (Stretch Goal)
| Endpoint | Method | Params | Status |
|----------|--------|--------|--------|
| `/anchor/auth/challenge` | GET | account | Implemented |
| `/anchor/auth/token` | POST | account, challenge, signature | Placeholder |

## Error Handling

| Status Code | Description | When |
|-------------|-------------|------|
| 400 | Bad Request | Invalid Stellar address format |
| 403 | Forbidden | Account doesn't match user wallet |
| 401 | Unauthorized | No JWT token provided |
| 404 | Not Found | Wallet not found |

## Testing

### Test Cases
1. Valid Stellar address format - should pass
2. Invalid Stellar address format - should return 400
3. Account matches user wallet - should succeed
4. Account doesn't match user wallet - should return 403
5. No account param - should return 400

## Audit Findings

### 1) JWT expiration (`exp`) checks
- Status: Correctly enforced in the token validation path.
- Evidence: `passport-jwt` rejects expired access tokens before the request reaches the controller, and the anchor service adds an explicit `exp` check when verifying SEP-10 JWT claims.
- Result: expired tokens return 401 and do not access protected anchor endpoints.

### 2) Challenge nonce single-use enforcement
- Status: Fixed and enforced.
- Implementation: challenge nonces are issued and stored in Redis with the same TTL as the challenge expiry, then transitioned to `used` on first successful validation. Reuse of a previously consumed nonce is rejected with 401.
- Result: replayed challenge reuse is blocked even if the same signed payload is replayed.

### 3) Anchor signing-key validation against `stellar.toml`
- Status: Fixed and enforced.
- Implementation: the server fetches the anchor `SIGNING_KEY` from `/.well-known/stellar.toml` on first use, caches it, and compares it to the configured runtime value before trusting the challenge flow.
- Result: mismatched signing keys are rejected with 401.

## Future Improvements

1. Full SEP-10 signature verification against the wallet's challenge payload
2. Configurable challenge expiry and stricter nonce rotation policies
3. Rate limiting for challenge requests
4. Audit logging for authentication attempts

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

## Future Improvements

1. Full SEP-10 signature verification
2. Configurable challenge expiry
3. Rate limiting for challenge requests
4. Audit logging for authentication attempts

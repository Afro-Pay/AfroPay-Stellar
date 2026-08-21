# AfroPay-Stellar Threat Model

## Introduction

This document provides a formal threat model for the AfroPay-Stellar remittance platform using the **STRIDE methodology** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).

**Purpose:** To identify, analyze, and document security threats across three critical system surfaces:
1. The remittance flow (API → Stellar settlement)
2. Wallet private key storage and decryption
3. Anchor deposit/withdrawal integration

**Threat Modeling Methodology:** STRIDE is a systematic approach to identifying threats in each category. This document categorizes threats by surface and STRIDE category, assigns severity levels, documents current mitigations, and identifies residual risks.

**Date Created:** August 2026

**Intended Review Cadence:** Every 6 months or after major architectural changes (e.g., Soroban smart contract integration, migration to new Stellar APIs, key rotation policy changes).

**Authors / Maintainers:** Backend Security Team, DevOps Team, Product Security Lead

---

## Scope

### In Scope

- **Remittance flow:** Complete flow from API submission through Stellar network settlement, including transaction validation, signing, and retry logic
- **Wallet private key storage and decryption:** All operations in `vault.service.ts` and `wallet.service.ts`, including HKDF key derivation, AES-256-GCM encryption, and decryption
- **Anchor integration:** SEP-6 deposit/withdraw flows, FX rate caching with circuit breaker, anchor response validation, and reconciliation
- **Authorization and authentication:** JWT-based access control, multi-signature wallet support, and permission checks
- **Database persistence:** Encrypted wallet storage, transaction audit logging, and data at rest
- **Fraud detection:** Integration with fraud scoring service, risk tiering policy (block/review/allow)

### Out of Scope

- Physical security of hosting infrastructure
- Employee access control and internal security policies
- Mobile app threat model (if applicable in future)
- Soroban smart contract security (future roadmap item)
- Frontend (Next.js) client-side security vulnerabilities
- Third-party Stellar network attacks (network-level DDoS, Horizon API compromises)

---

## System Overview

AfroPay-Stellar enables cross-border remittance by combining a NestJS API gateway, PostgreSQL database, Redis queue, and direct Stellar blockchain integration. The system handles three key flows:

### 1. Remittance Flow: API → Stellar Settlement

A user submits a payment request via the API. The `TransactionService` creates a database record and enqueues a BullMQ job. The `TransactionProcessor` asynchronously:
1. Loads the user's keypair by decrypting their wallet secret from the vault
2. Retrieves the current sequence number from Horizon
3. Builds and signs a `TransactionBuilder` payment operation
4. Submits the signed XDR to Horizon
5. Updates the database with the on-chain transaction hash or failure reason

Before on-chain submission, the fraud detection service scores the transaction risk (0.0 to 1.0). If the score ≥ 0.8, the transaction is blocked. If 0.5–0.8, it is held for manual review. Below 0.5, it proceeds to settlement.

### 2. Wallet Private Key Storage and Decryption

When a user creates a wallet, `Keypair.random()` generates a new Stellar secret key. The `WalletService` encrypts the secret using:
- **Key derivation:** HKDF-SHA256 over the master encryption key (`ENCRYPTION_KEY` env var) with the user ID as the context, producing a per-user key
- **Encryption:** AES-256-GCM with a random 12-byte IV, resulting in `iv:authTag:ciphertext` (hex-encoded)

The encrypted secret is stored in PostgreSQL. During transaction signing, `VaultService.getUserKeypair()` decrypts and returns the keypair; the secret is never logged or exposed.

### 3. Anchor Deposit/Withdrawal Integration

The `AnchorService` acts as an SEP-6 proxy to external anchor servers (USDC and NGN anchors). Deposit and withdrawal requests are forwarded; responses are validated against a DTO schema. If the anchor echoes back an account or amount that does not match the request, reconciliation fails and an error is returned.

FX rates are cached in Redis with a freshness bound (30s) and retention bound (300s). A per-pair circuit breaker opens after 3 consecutive failures, serving stale cached rates without requesting the anchor for 60s. This prevents cascading failures during anchor outages.

### Data Flow Diagram

```
┌─────────────┐
│   Frontend  │
│  (Next.js)  │
└──────┬──────┘
       │ POST /transactions/send
       ▼
┌─────────────────────────────────────────────────────┐
│           NestJS API Gateway (Port 3001)             │
│                                                      │
│  ┌──────────────────┐                                │
│  │ TransactionSvc   │─────┐                          │
│  │ (validate input) │     │ BullMQ.add()             │
│  └──────────────────┘     │                          │
│                           ▼                          │
│  ┌──────────────────────────────────┐                │
│  │ Redis BullMQ "transactions" Queue │                │
│  └──────────────────────────────────┘                │
│           ▲ LPOP                                     │
│           │ ┌────────────────────────────┐           │
│           └─┤ TransactionProcessor        │           │
│             │ (fraud check → on-chain)    │           │
│             └────────────────────────────┘           │
│             │                                        │
│             ├──► VaultService.getUserKeypair()       │
│             │    (decrypt wallet secret)             │
│             │                                        │
│             └──► FraudService.score()                │
│                  (risk assessment)                   │
└─────────────────────────────────────────────────────┘
       │
       ├──────────────────────┬──────────────────────┐
       ▼                      ▼                      ▼
┌────────────────┐   ┌──────────────────┐  ┌──────────────────┐
│  PostgreSQL    │   │   Horizon API    │  │  AnchorService   │
│  - Wallets     │   │   (Stellar)      │  │  - SEP-6 Proxy   │
│  - Transactions│   │                  │  │  - FX Rates      │
│  - Audit Logs  │   └──────────────────┘  └──────────────────┘
└────────────────┘           │                       │
                             ▼                       ▼
                    ┌──────────────────┐  ┌──────────────────┐
                    │ Stellar Testnet  │  │ External Anchors │
                    │ (Horizon RPC)    │  │ (SEP-6 Servers)  │
                    └──────────────────┘  └──────────────────┘
```

---

## STRIDE Threat Table

| Threat ID | Surface | STRIDE Category | Threat Description | Affected Component | Severity | Current Mitigation | Residual Risk |
|-----------|---------|-----------------|-------------------|-------------------|----------|-------------------|---------------|
| TM-001 | Remittance | Spoofing | Unauthenticated caller submits a remittance request by guessing a valid endpoint and bypassing JWT validation | TransactionController | High | `@UseGuards(JwtAuthGuard)` on all transaction endpoints; JWTs expire in 15 minutes | If JWT validation is accidentally removed or bypass logic exists, attacker can submit unbounded transfers |
| TM-002 | Remittance | Spoofing | Replay attack — attacker intercepts a valid signed transaction and resubmits it to Horizon to trigger duplicate settlement | TransactionProcessor | High | Stellar transactions include a sequence number; duplicate sequence rejects at Horizon layer; [VERIFY] idempotency key logic prevents duplicate API calls in cache, but Stellar nonce prevents double-spend | Horizon is authoritative; replay at application level is mitigated but operator must trust Horizon |
| TM-003 | Remittance | Tampering | Attacker modifies the destination address or amount between API validation and TransactionBuilder construction | TransactionProcessor | Critical | Destination and amount are loaded atomically from DB within the same transaction; no mutable state between validation and signing | If database connection is compromised or code is modified post-build, attacker can alter transaction target |
| TM-004 | Remittance | Tampering | Signed XDR transaction is modified in transit to Horizon before submission | TransactionProcessor | Critical | Horizon receives XDR over HTTPS (TLS 1.2+); XDR signature is cryptographic binding; Horizon rejects modified XDRs | [VERIFY] TLS configuration is enforced; if downgraded to HTTP, tampering is possible |
| TM-005 | Remittance | Repudiation | User denies initiating a remittance; no immutable audit trail of the original API request | TransactionService, AuditService | Medium | All transaction initiation events are logged to `audit_logs` table with user ID, timestamp, destination, and amount; logs are persisted and immutable (append-only) | Audit logs reside in same PostgreSQL database; if database is compromised, logs can be altered; separate audit log storage recommended |
| TM-006 | Remittance | Information Disclosure | Remittance amount, sender, and recipient exposed in API logs, error responses, or application memory dumps | TransactionService, Logger | High | VaultService explicitly avoids logging decrypted secrets; error messages mask sensitive details (e.g., `"Transaction failed"` instead of leaking amount); transaction details logged only with TX ID, not full PII | Logs are written to stdout and may be captured by container orchestration; if log aggregation (ELK, Datadog) is insufficiently access-controlled, PII exposure occurs |
| TM-007 | Remittance | Denial of Service | Attacker floods the API with remittance requests, exhausting Stellar sequence numbers or Horizon rate limits, blocking legitimate transactions | TransactionController, TransactionProcessor | Medium | Rate limiting is implemented per-user (RedisRateLimitGuard); Horizon has built-in rate limiting (429 responses); BullMQ retry logic with exponential backoff (2s, 4s, 8s) | Rate limit enforcement assumes correct `user_id` extraction from JWT; if user ID is spoofed, per-user limit is bypassed |
| TM-008 | Remittance | Elevation of Privilege | Low-privilege API role crafts a request that triggers a high-value settlement without authorization check | TransactionController | High | All transaction endpoints validate `@Req() user: JwtPayload` from JWT; destination address is user-provided (any Stellar account is valid); no allowlists or per-user spend limits exist | [VERIFY] Authorization layer allows any authenticated user to send to any address; no spend limits are enforced; fraud scoring is the only financial gate (configurable thresholds) |
| TM-009 | Key Storage | Spoofing | Attacker impersonates a legitimate service caller to trigger key decryption for a wallet they do not own | VaultService.getUserKeypair(), WalletService.getKeypair() | Critical | Keypair retrieval requires `userId` parameter; caller must provide valid JWT for that user; database query uses `WHERE userId = ?` | If JWT validation is bypassed or user ID is leaked, attacker can decrypt any wallet |
| TM-010 | Key Storage | Tampering | Encrypted key material at rest is modified (e.g., bits flipped in ciphertext), causing corrupted decryption output that is silently used for signing | VaultService.decrypt(), wallet.encryptedSecret | High | AES-256-GCM includes authentication tag; if ciphertext is modified, `decipher.final()` throws an error (`AuthTagMismatchError`); error is caught and transaction fails | [VERIFY] Error handling is correct; if modified ciphertext is used for signing, Keypair.fromSecret() will throw a parse error, halting the transaction |
| TM-011 | Key Storage | Repudiation | No audit log of which service or user triggered key decryption and when — cannot reconstruct access history after incident | VaultService, WalletService | Medium | Key decryption is logged at DEBUG level in VaultService; audit log entry is created for `WALLET_EXPORTED` and `WALLET_IMPORTED` operations | DEBUG logs are not persisted to audit_logs by default; decryption-on-demand (during transaction signing) is not audited; audit trail for key access is incomplete |
| TM-012 | Key Storage | Information Disclosure | Decrypted private key material is exposed in memory dumps, application logs, or error stack traces | VaultService, Logger | Critical | VaultService does not log decrypted secrets; keypair is returned as object and used transiently for signing; no logging of `secretKey` field | If process memory is dumped via debugger or crash dump, keypair object is readable; error stack traces from `Keypair.fromSecret()` failures do not expose the secret |
| TM-013 | Key Storage | Information Disclosure | ENCRYPTION_KEY (master key) is stored in same environment or process as encrypted wallet keys, collapsing defense in depth | VaultService.getMasterKey(), config | Critical | ENCRYPTION_KEY is an environment variable; it is never persisted to disk; at runtime, it is loaded once in process memory | Environment variable is readable by any process running on the same container host; if the host is compromised, both the key and all encrypted secrets are exposed |
| TM-014 | Key Storage | Denial of Service | Vault service is overwhelmed with decryption requests, blocking all transaction signing | VaultService, TransactionProcessor | Medium | Decryption is a fast in-process operation (~1ms per keypair); no rate limiting on vault access; BullMQ concurrency is tunable (default 10 workers) | If a compromised user account triggers many transactions in rapid succession, vault decryption queue could be saturated; no per-user vault rate limiting exists |
| TM-015 | Key Storage | Elevation of Privilege | Compromise of VaultService code (e.g., via dependency vulnerability or supply chain attack) grants access to ALL wallet keys across all users — blast radius is unbounded | VaultService class, dependency tree | Critical | VaultService is a singleton with no privilege isolation; all keys pass through it; compromised code can decrypt and exfiltrate all keys | No sandboxing or process isolation; if VaultService is compromised, all wallets are exposed |
| TM-016 | Anchor | Spoofing | Malicious actor spoofs an anchor callback (webhook) to falsely confirm a deposit that was never funded on-chain | [VERIFY] Anchor webhook handler | Critical | [VERIFY] Anchor webhooks are not yet implemented in the codebase; webhook signature validation would be required to authenticate callbacks | This is a future threat; when webhooks are added, caller must verify webhook signatures using anchor's public key |
| TM-017 | Anchor | Tampering | Deposit amount or asset type is tampered with in the anchor callback before AfroPay credits the user account | [VERIFY] Anchor webhook handler | High | [VERIFY] Webhook signature validation (if implemented) provides integrity binding; reconciliation logic checks if echoed amount matches request | Webhook tampering would be detected only if signatures are validated; if signature validation is skipped, attacker can modify callback data |
| TM-018 | Anchor | Repudiation | Anchor disputes a withdrawal claim; AfroPay has no signed proof of the anchor's confirmation | AnchorService | Medium | All anchor responses are logged (both request and response); audit trail includes timestamp and anchor URL | Logs are in AfroPay's database; anchor could deny receiving the request; no cryptographic binding (e.g., signed response) from anchor |
| TM-019 | Anchor | Information Disclosure | KYC data or banking details passed to anchor are exposed via insecure channel or logged by anchor integration handler | AnchorService | High | AnchorService forwards requests to anchor over HTTPS; query parameters (asset, account, amount) are non-sensitive | [VERIFY] KYC data is not passed through AnchorService; if future implementations send KYC via query params, exposure risk is High |
| TM-020 | Anchor | Denial of Service | Anchor becomes unavailable mid-flow, leaving user funds in a limbo state with no automated recovery | AnchorService, TransactionProcessor | Medium | Circuit breaker opens after 3 consecutive failures; FX rate requests timeout and fall back to cache; transaction flow is independent of anchor | If anchor is down during withdrawal initiation, the flow halts and transaction is held; user must retry manually; no automatic state machine recovery |
| TM-021 | Anchor | Elevation of Privilege | Compromised anchor API credentials (ANCHOR_USDC_URL, ANCHOR_NGN_URL URLs) allow attacker to initiate withdrawals on behalf of AfroPay users | AnchorService | Critical | Anchor URLs are environment variables, not hardcoded; credentials are not transmitted to anchors (SEP-6 does not use API keys for deposit/withdraw); however, attacker who controls DNS could redirect requests | [VERIFY] DNS resolution is trusted; if attacker can intercept DNS or compromise network routing, anchor requests are sent to attacker-controlled server |
| TM-022 | Key Storage | Tampering | Legacy AES-256-CBC encrypted wallets (2-part format: `iv:ciphertext`) are not migrated to the new AES-256-GCM format (3-part: `iv:authTag:ciphertext`), leaving them vulnerable to silent decryption failures | WalletService.decrypt() | Medium | Decrypt function auto-detects format (2-part vs. 3-part) and handles both; legacy wallets are transparently re-encrypted on first write | [VERIFY] Re-encryption is not automatic on read; legacy wallets are decryptable but not upgraded unless explicitly updated |
| TM-023 | Remittance | Tampering | Fraud scoring result is modified after evaluation but before transaction status update, causing a low-risk transaction to be mistakenly approved or vice versa | TransactionProcessor | Medium | Fraud score is computed, persisted to database, then decision logic (block/review/allow) is applied atomically within the same method | If database transaction isolation is not SERIALIZABLE, concurrent updates could cause race conditions |
| TM-024 | Remittance | Information Disclosure | Fraud scoring service receives payment details over HTTP (instead of HTTPS), exposing transaction metadata | TransactionProcessor, FraudService | High | FraudService endpoint is configured via environment variable (default not provided in codebase); [VERIFY] HTTPS is enforced by deployment | Configuration must ensure FRAUD_SERVICE_URL uses HTTPS; if HTTP is misconfigured, metadata is exposed |
| TM-025 | Key Storage | Information Disclosure | HKDF salt (empty salt `Buffer.alloc(16)`) is weak, reducing key derivation entropy | VaultService.deriveUserKey() | Low | HKDF uses user ID as context and SHA256 hash function; empty salt is acceptable per RFC 5869 when no random salt is needed; security depends on user ID entropy and master key strength | If master key is weak (e.g., 64 hex chars of low entropy), derived keys inherit the weakness |

---

## Open Risks

### Critical / High Severity, Unmitigated or Partially Mitigated

#### TM-003: Transaction Amount/Destination Tampering During Building

**Threat ID:** TM-003  
**Description:** Attacker modifies destination address or amount between database load and TransactionBuilder signing, causing funds to be sent to wrong address or in wrong amount.  
**Current Mitigation:** Atomic database load within TransactionProcessor; no mutable state between validation and signing.  
**Why Unmitigated:** If code is compromised (e.g., via dependency vulnerability or insider), attacker can inject tampering code at build time.  
**Proposed Mitigation:**  
1. Add post-build integrity check: compute HMAC-SHA256 of critical transaction fields (destination, amount) and verify before signing
2. Enable code signing and verification for production deployments
3. Conduct regular supply chain security audits (SBOM, dependency scanning)

**Suggested Owner:** Backend Security Team  
**Recommended Timeframe:** Immediate (High severity)

---

#### TM-008: No Per-User Spend Limits

**Threat ID:** TM-008  
**Description:** Authenticated attacker can submit unbounded high-value transactions without per-user or per-transaction spending limits.  
**Current Mitigation:** Fraud scoring service (thresholds configurable: 0.8 to block, 0.5–0.8 to review).  
**Why Unmitigated:** Fraud scoring is the only gate; if scoring rules are too permissive or attacker has legitimate user account, high-value transactions pass through.  
**Proposed Mitigation:**  
1. Add configurable daily spend limit per user (e.g., $5,000 USD equivalent)
2. Add per-transaction maximum (e.g., $50,000 USD equivalent)
3. Require manual approval for transactions above tier 2 threshold
4. Integrate with KYC data to set limits based on user verification level

**Suggested Owner:** Product Security Lead, Backend Team  
**Recommended Timeframe:** 30 days

---

#### TM-009: Wallet Decryption Without Owner Consent Audit

**Threat ID:** TM-009  
**Description:** If JWT validation is bypassed or user ID is leaked, attacker can request decryption of any wallet.  
**Current Mitigation:** JWT validation on all endpoints; `WHERE userId = ?` database query.  
**Why Unmitigated:** Single point of failure at JWT validation layer; no independent audit trail of decryption requests.  
**Proposed Mitigation:**  
1. Add HKDF-based rate limiting per user: max 1 decryption per 100ms per user ID
2. Audit all decryption events (INFO level) to separate audit log with secure write-once semantics
3. Add anomaly detection: alert if single user triggers >10 decryptions in 1 minute
4. Require confirmation prompt for manual key export via `/wallet/export`

**Suggested Owner:** Backend Security Team, DevOps  
**Recommended Timeframe:** 30 days

---

#### TM-012: Private Key Material in Memory Dumps

**Threat ID:** TM-012  
**Description:** If process is dumped (via debugger, crash dump, or container image compromise), private key object is readable in memory.  
**Current Mitigation:** No persistent logging of secrets; transient keypair object in VaultService.  
**Why Unmitigated:** Keypair object is held in memory during transaction signing; no memory encryption or zeroization.  
**Proposed Mitigation:**  
1. Enable `malloc()` hardening: link with tcmalloc or jemalloc with debug guard pages
2. Use OpenSSL's `OPENSSL_cleanse()` equivalent after signing to zero out sensitive memory
3. Run transaction processor in a separate container with restricted debugging (`ptrace` disabled, debugger disallowed)
4. Enable core dump disabling at runtime: `ulimit -c 0`

**Suggested Owner:** DevOps, Backend Team  
**Recommended Timeframe:** 90 days

---

#### TM-013: Master Key in Environment Variable

**Threat ID:** TM-013  
**Description:** ENCRYPTION_KEY is a shared environment variable; if host is compromised, attacker can read it and decrypt all wallets.  
**Current Mitigation:** Key is never persisted to disk; loaded once at runtime.  
**Why Unmitigated:** Environment variables are readable by all processes on the host; single point of failure.  
**Proposed Mitigation:**  
1. Migrate to AWS KMS or HashiCorp Vault for key storage (see `docs/security.md`)
2. Use per-wallet envelope encryption: store DEK encrypted with KMS, master key never in environment
3. Implement key versioning: rotate master key annually, keep old keys for decryption-only fallback
4. Restrict container host access: run in Kubernetes with RBAC, disable SSH to nodes

**Suggested Owner:** DevOps, Security Team  
**Recommended Timeframe:** 90 days

---

#### TM-015: VaultService is a Single Point of Compromise

**Threat ID:** TM-015  
**Description:** Compromise of VaultService (e.g., via dependency vulnerability) exposes all wallet keys across all users.  
**Current Mitigation:** Singleton service; no privilege isolation.  
**Why Unmitigated:** No sandboxing or process isolation; compromised code can exfiltrate all keys.  
**Proposed Mitigation:**  
1. Extract VaultService into a separate microservice with isolated credentials
2. Use sidecar architecture: each API pod has a local vault sidecar that holds the master key (never shared)
3. Implement role-based access control: vault only decrypts for authorized requesters
4. Enable mutual TLS (mTLS) between API and vault sidecar; require certificate pinning

**Suggested Owner:** Backend Security Team, DevOps, Architecture  
**Recommended Timeframe:** 90 days

---

#### TM-021: Compromised Anchor URLs Allow Attacker to Redirect Withdrawal Requests

**Threat ID:** TM-021  
**Description:** If attacker controls DNS or network routing, ANCHOR_USDC_URL and ANCHOR_NGN_URL are redirected to attacker-controlled server.  
**Current Mitigation:** Anchor URLs are environment variables; anchors do not require API keys.  
**Why Unmitigated:** No certificate pinning or domain validation beyond TLS; DNS is trusted path.  
**Proposed Mitigation:**  
1. Add certificate pinning: hardcode or securely store anchor server certificates; verify TLS certificate thumbprint
2. Implement DNSSEC validation at application level
3. Use separate network namespace for anchor requests (e.g., deny-list known malicious IPs)
4. Add rate limiting per anchor: if anchor returns errors >5 times, hold requests and alert

**Suggested Owner:** Backend Security Team, DevOps  
**Recommended Timeframe:** 30 days

---

#### TM-001, TM-002: JWT/Transaction Replay Attacks

**Threat ID:** TM-001, TM-002  
**Description:** If JWT validation is accidentally removed or weak transaction nonce handling, attacker can forge requests or replay transactions.  
**Current Mitigation:** `@UseGuards(JwtAuthGuard)` on endpoints; Stellar sequence numbers prevent replay at Horizon.  
**Why Unmitigated:** Single point of failure at JWT validation layer; Stellar nonce is authoritative but operator must trust network.  
**Proposed Mitigation:**  
1. Add integration tests for JWT validation on every transaction endpoint (ensure guard is always present)
2. Add code review checklist: every new endpoint must be decorated with `@UseGuards(JwtAuthGuard)`
3. Enable static analysis: flag any undecorated endpoint as a build error
4. Implement request signing: sign transaction requests with user's keypair before submission, not just at Stellar layer

**Suggested Owner:** Backend Team, Code Review Process  
**Recommended Timeframe:** Immediate (High severity, cheap to implement)

---

## References

- [docs/security.md](./security.md) — Vault architecture, KMS integration, key rotation
- [docs/secrets-management.md](./secrets-management.md) — Environment variable validation, safe defaults, production checklist
- [docs/integration.md](./integration.md) — System architecture, component interactions, Stellar integration, anchor integration
- [Stellar Documentation](https://developers.stellar.org/docs) — Horizon API, transaction semantics, sequence numbers
- [STRIDE Methodology](https://owasp.org/www-community/Threat_Modeling) — OWASP guide to STRIDE threat modeling
- SEP Protocols:
  - [SEP-6: Deposit and Withdrawal API](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0024.md)
  - [SEP-24: Hosted Deposit and Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0026.md)
  - [SEP-31: Cross-Border Payments API](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0031.md)

---

## Threat Severity Scale

| Severity | Definition | Examples |
|----------|-----------|----------|
| **Critical** | Direct loss of funds or private keys; attack has no practical mitigation and immediate impact | TM-003 (amount tampering), TM-009 (wallet decryption bypass), TM-012 (key in memory), TM-013 (master key exposure), TM-015 (VaultService compromise) |
| **High** | Likely fund loss or key exposure with partial mitigation; attack requires one condition to be true | TM-001 (spoofed requests), TM-004 (XDR tampering in transit), TM-006 (PII in logs), TM-008 (no spend limits), TM-021 (anchor redirect) |
| **Medium** | Significant impact requiring specific conditions or multiple failures to exploit; mitigated but residual risk remains | TM-005 (repudiation), TM-007 (DoS), TM-011 (key access audit), TM-014 (vault saturation), TM-018 (anchor dispute) |
| **Low** | Limited impact; requires multiple failures or unlikely conditions; low severity even if exploited | TM-025 (HKDF weak salt) |

---

## Recommendations for Ongoing Review

1. **Quarterly threat review:** Update threat table if new surfaces or architectures are added (e.g., Soroban integration)
2. **Annual security audit:** Engage external firm to validate mitigations and test for bypasses
3. **Dependency scanning:** Use `npm audit`, `cargo audit`, and `pip audit` in CI/CD to catch known vulnerabilities
4. **Incident response:** If any threat is exploited, update this document with new mitigations and conduct post-mortem
5. **Architect changes:** If transaction flow, vault design, or anchor integration changes, re-evaluate all threats in the affected surface

---

**Document Version:** 1.0  
**Last Updated:** August 2026  
**Next Review Date:** February 2027 (or sooner if architecture changes)

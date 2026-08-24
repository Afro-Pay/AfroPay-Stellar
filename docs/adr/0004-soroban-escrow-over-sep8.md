# ADR 0004: Soroban Escrow Over SEP-8 Regulated Assets

## Status

Accepted

## Context

AfroPay-Stellar must securely settle remittance payments across borders, ensuring funds reach the recipient only after verification (compliance, settlement confirmation). The Stellar network offers two main approaches for conditional asset transfer:

1. **SEP-8 Regulated Assets**: Asset issuers enforce authorization logic; transfers are approved/rejected by pre-arranged issuers.
2. **Soroban Smart Contracts**: Deterministic smart contracts execute custom settlement logic, holding and releasing funds based on contract-defined conditions.

Current architecture uses Soroban escrow contracts for all cross-border settlement, replacing an earlier consideration of SEP-8 regulated assets.

## Decision Drivers

1. **Trustlessness**: Settlement logic must be verifiable and enforceable without trusting a central issuer.
2. **Atomicity**: All-or-nothing guarantees: funds either reach recipient or return to sender; no stuck states.
3. **Customization**: Settlement rules must support dynamic fees, dispute resolution, timeout-based refunds, and multi-currency paths.
4. **Auditability**: Every transfer step must be cryptographically logged on-chain.
5. **Regulatory Compliance**: Supports AML/KYC hooks and compliance integration without off-chain orchestration.
6. **Interoperability**: Minimal dependency on issuer cooperation; works with any issuer following Stellar protocol.

## Considered Options

### Option 1: SEP-8 Regulated Assets (Rejected)

Use Stellar's SEP-8 standard: asset issuers control approval/rejection via a dedicated approval endpoint.

**Process**:

- Sender initiates transfer in Stellar.
- Transaction is rejected by issuer's approval service.
- Issuer's backend checks compliance rules (AML, KYC, amount limits).
- Issuer approves or rejects the transaction.
- Sender retries or fails based on issuer's decision.

**Pros**:

- Simpler initially; no smart contract logic to maintain
- Asset issuer (trusted party) fully controls transfer policy
- Familiar pattern in traditional finance (correspondent banking)
- Works with existing Stellar issuers (USDC anchors, etc.)

**Cons**:

- **Centralized control**: Issuer can arbitrarily block or delay transfers
- **Off-chain policy**: Approval logic lives outside the blockchain; not auditable on-chain
- **Performance bottleneck**: Every transfer requires issuer approval round-trip; adds 100–1000ms latency
- **Issuer dependency**: If issuer's approval service is down, transfers fail
- **Dispute resolution**: No on-chain escrow; if issuer misbehaves, only recourse is legal
- **No trustlessness**: Requires trusting issuer to enforce agreed-upon rules
- **Timeout handling**: Issuer decides timeouts; no self-enforcing expiration
- **Fee customization**: Issuer must coordinate fees in transfer; not flexible for marketplace dynamics

### Option 2: Soroban Smart Contracts (Chosen)

Implement escrow logic in Soroban (Stellar's smart contract layer). Contract holds funds and releases based on on-chain conditions.

**Process**:

1. Sender deposits funds into escrow contract.
2. Contract verifies conditions: expiration, recipient authorization, compliance hooks.
3. Upon verification, contract autonomously releases funds to recipient.
4. If conditions fail or timeout, funds automatically return to sender.

**Pros**:

- **Trustless**: Logic is on-chain and cryptographically enforced; no trusted intermediary needed
- **Atomicity**: All-or-nothing; no stuck states or partial transfers
- **Transparency**: All rules are verifiable on-chain; auditable for compliance
- **Self-enforcing**: Timeouts, release conditions, and fee splits are automatic
- **Customization**: Dynamic logic for different remittance types, compliance rules, marketplace fees
- **Dispute resolution**: Multi-sig or arbitration rules encoded in contract; disputes are deterministic
- **Performance**: Once escrowed, release is deterministic and fast (~5s Stellar consensus)
- **Interoperability**: Works with any Stellar issuer; doesn't require issuer cooperation
- **Immutability**: Cannot be arbitrarily changed mid-transaction; sender and recipient have certainty

**Cons**:

- Requires Soroban contract development and deployment
- Contract bugs can lock funds; requires careful auditing
- Gas/resource costs for contract execution (Stellar stroops)
- Contract upgrades require coordination; old contracts remain immutable
- Team must learn Soroban/Rust; additional development burden

## Decision Outcome

**Chosen: Soroban Smart Contracts**

AfroPay-Stellar implements escrow via Soroban contract in `contracts/escrow/`:

```rust
// contracts/escrow/src/lib.rs
#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deposit funds into escrow
    pub fn create_escrow(
        env: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        expiration_ledger: u32,
    ) -> Result<BytesN<32>, ContractError> {
        // Verify amounts
        // Transfer token from sender to contract
        // Store EscrowState in persistent storage
        // Return escrow ID
    }

    /// Release funds to recipient (requires sender signature)
    pub fn release_escrow(
        env: Env,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        // Load escrow state
        // Verify not expired
        // Verify sender or authorized release agent
        // Transfer amount to recipient, fees to platform
        // Update state to Completed
    }

    /// Refund to sender (after expiration)
    pub fn refund_escrow(
        env: Env,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        // Load escrow state
        // Verify expired
        // Transfer amount back to sender
        // Update state to Cancelled
    }

    /// Dispute mechanism (both parties or arbitrator can trigger)
    pub fn dispute_escrow(
        env: Env,
        escrow_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        // Freeze escrow state to Disputed
        // Can only be resolved by joint signature or arbitrator
    }
}
```

**API integration** in `apps/api/src/transaction/transaction.service.ts`:

```typescript
// When user initiates transfer
const escrowId = await this.sorobanService.createEscrow({
  sender: senderStellarAccount,
  recipient: recipientStellarAccount,
  token: usdcTokenAddress,
  amount: transferAmount,
  expirationLedger: currentLedger + 3600, // 1 hour
});

// Queue Rust worker to execute release (after compliance checks pass)
await this.settleQueue.add("release-escrow", {
  escrowId,
  transferId: transfer.id,
});

// Worker executes release after compliance verification
// If disputes arise, either party can trigger dispute resolution
```

## Consequences

### Positive

1. **Trustlessness**: No dependency on issuer or intermediary; settlement logic is immutable on-chain.
2. **Auditability**: Full transparency; all transfers and conditions logged on Stellar ledger.
3. **Atomicity**: All-or-nothing; no partial transfers or stuck states.
4. **Automation**: Timeouts and release conditions execute automatically without human intervention.
5. **Customization**: Support dynamic fees, multi-step settlement, and complex compliance rules.
6. **Regulatory Alignment**: Transparent, auditable trail for AML/KYC compliance and regulators.
7. **Resilience**: Works even if API or issuer services are temporarily unavailable (escrow state persists on-chain).

### Negative

1. **Development Complexity**: Soroban contract development requires Rust expertise and careful security review.
2. **Gas/Resource Costs**: Contract execution consumes stroops (Stellar fees); adds per-transfer cost.
3. **Deployment Overhead**: Contract must be deployed and verified; upgrade requires new contract instance.
4. **Bug Risk**: Contract bugs can lock funds permanently; requires thorough testing and audit.
5. **Learning Curve**: Team must learn Soroban/Rust for ongoing maintenance.
6. **Latency Trade-off**: Release requires Stellar consensus (~5s); not suitable for real-time (sub-second) settlement.
7. **Escrow Expiration**: Must align expiration logic with compliance and dispute timelines.

## Comparison Table

| Feature                  | SEP-8 Regulated Assets            | Soroban Escrow                    |
| ------------------------ | --------------------------------- | --------------------------------- |
| **Trustlessness**        | No (issuer decides)               | Yes (on-chain logic)              |
| **Atomicity**            | No (issuer approves step-by-step) | Yes (all-or-nothing)              |
| **On-chain Audit Trail** | No (approval is off-chain)        | Yes (all transfers logged)        |
| **Timeout-based Refund** | No (issuer decides)               | Yes (automatic at expiration)     |
| **Dispute Resolution**   | Off-chain legal recourse          | On-chain multi-sig or arbitration |
| **Interoperability**     | Requires issuer cooperation       | No cooperation needed             |
| **Customization**        | Limited by issuer policy          | Full contract control             |
| **Gas Cost**             | Minimal (standard transfer)       | Higher (contract execution)       |
| **Latency**              | High (approval round-trip)        | ~5s (Stellar consensus)           |

## Links

- Related: [ADR 0005: Deterministic Keypair Derivation](./0005-deterministic-keypair-derivation.md) — contract interactions use deterministic keys
- Reference: [Soroban Escrow Design](../soroban-escrow-design.md)
- Reference: [Stellar Soroban Docs](https://developers.stellar.org/learn/smart-contracts)
- Reference: [SEP-8 Specification](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0008.md)

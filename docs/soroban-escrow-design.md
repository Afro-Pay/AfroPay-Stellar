# Architectural Design: Soroban Escrow Contract for Cross-Border Transfers

## 1. Abstract
This document outlines the architectural blueprint for a Soroban-based smart contract tailored for secure, trustless cross-border asset escrow. The design ensures funds are securely locked in a decentralized ledger state until verified release metrics are fulfilled, incorporating timeout protection and dispute arbitration structures.

## 2. Structural Contract State & Ledger Footprint
The escrow configuration tracks multi-currency transaction metadata. To maximize structural space safety, data is mapped directly inside persistent instance storage:

### Data Schemas
- **EscrowStatus (Enumeration)**
  - `Locked`: Funds successfully captured and retained in the contract domain.
  - `Completed`: Funds released cleanly to the destination receiver.
  - `Cancelled`: Timeout exceeded; funds safely returned to the originator.
  - `Disputed`: Settlement frozen pending cryptographic multi-sig resolution or administrative arbitration.

- **EscrowState (Structure)**
  - `sender`: `Address` (The originating transaction account)
  - `recipient`: `Address` (The targeted destination receiver)
  - `token`: `Address` (Stellar Asset Contract - SAC identifier)
  - `amount`: `i128` (The primary remittance balance)
  - `source_fees`: `i128` (Platform platform maintenance deduction applied at setup)
  - `destination_fees`: `i128` (Settlement infrastructure deduction processed at execution)
  - `expiration`: `u64` (Unix timestamp threshold denoting contract lifetime limits)
  - `status`: `EscrowStatus` (Current active execution lifecycle state)

---

## 3. Core Operational Workflow Mechanics

### Flow A: Escrow Initialization (Locking Phase)
1. **Validation Assertions**:
   - Verify current sequence ledger time is strictly less than the provided `expiration`.
   - Assert `amount` is greater than zero.
2. **Asset Capture**:
   - Invoke `token.transfer(sender, contract_address, amount + source_fees)` to secure the underlying asset pool.
3. **State Persist**:
   - Commit the fully hydrated `EscrowState` ledger footprint to storage with a state value of `EscrowStatus::Locked`.

### Flow B: Escrow Release Execution (Settlement Phase)
1. **Authority Enforcement**: Validates that the transaction signature matches either the `sender` identity or an authorized intermediary gateway.
2. **State Gate**: Asserts that `status == EscrowStatus::Locked` and the expiration timestamp has not passed.
3. **Distribution Pipeline**:
   - Transfer `amount - destination_fees` directly to the `recipient` address via the token contract.
   - Transfer `destination_fees` directly to the centralized platform collection vault.
4. **Finalization**: Transition the `status` schema flag permanently to `EscrowStatus::Completed`.

### Flow C: Expiration & Refund Cancellation
1. **Chronological Condition**: Asserts that the active network ledger time signature is strictly greater than `expiration`.
2. **State Gate**: Asserts that `status == EscrowStatus::Locked`.
3. **Reversal Protocol**:
   - Liquidate the locked contract position and route the entire `amount` back to the `sender`.
   - Update lifecycle identifier status to `EscrowStatus::Cancelled`.

### Flow D: Dispute Arbitrage Framework
1. **Trigger Phase**: Either the `sender` or `recipient` account can flag an operational dispute prior to expiration, shifting state criteria to `EscrowStatus::Disputed`.
2. **Resolution Mechanics**: Chronological timeouts are entirely frozen. Funds remain locked until one of two cryptographic criteria is met:
   - A joint multi-sig execution authorization signed by *both* `sender` and `recipient`.
   - An explicit, administrative arbitration signature payload matching a predefined platform compliance key.

---

## 4. Fundamental Safety Assumptions & Guardrails

- **Storage Rent Management**: Persistent contract entries must automatically assert a storage lifecycle bump footprint during execution to prevent unexpected data truncation or eviction while funds are locked.
- **Strict Execution Ordering (Reentrancy Prevention)**: State parameters must be completely mutated and persisted to the blockchain state *before* invoking external token routing interfaces.
- **Over/Underflow Invariant Safety**: All internal accounting parameters must use signed 128-bit integer types (`i128`) paired with checked math operations to prevent overflow vulnerabilities.

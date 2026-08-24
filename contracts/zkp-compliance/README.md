# zkp-compliance — groth16 circuit for AML compliance

On-chain prover counterpart for
[AfroPay-Stellar issue #271](https://github.com/Afro-Pay/AfroPay-Stellar/issues/271):
*"Integrate Zero-Knowledge Proofs for Privacy-Preserving Compliance Auditing"*.

## What it proves

Given a public commitment `C = poseidon(amount, salt)` and a public AML limit
`max_limit`, the circuit produces a groth16 proof (over BLS12-381) that:

1. `poseidon(amount, salt) == C` — the prover knows the exact amount and salt
   behind the commitment, and
2. `amount <= max_limit` — the amount respects the compliance threshold.

Only `C` and `max_limit` are public inputs; `amount` and `salt` are private
witnesses, so a regulator can verify compliance without ever seeing the
transaction amount, sender, or receiver (zero leakage).

## Build & test

This is a standalone crate (it declares its own `[workspace]` to detach from the
parent Soroban workspace).  It requires a Rust toolchain (`cargo`/`rustc`):

```bash
cargo test --manifest-path contracts/zkp-compliance/Cargo.toml
```

Dependencies are pinned to the `arkworks` 0.4.x series.

> **Note on trusted setup:** `setup()` uses `generate_random_parameters`, which
> produces a *toxic-waste* key for testing only.  A production deployment must
> replace it with a public MPC ceremony (e.g. powers-of-tau + phase-2).

## Files

- `src/lib.rs` — circuit (`ComplianceCircuit`), `commit`/`prove`/`verify`,
  proof (de)serialization, and unit tests.

## Relationship to the rest of the stack

| Component | Location | Role |
|-----------|----------|------|
| Rust groth16 circuit | `contracts/zkp-compliance` (this crate) | On-chain prover (item 1) |
| Python reference prover/verifier | `services/python-analytics/app/zkp_compliance.py` | Backend proving module (item 3) |
| NestJS auditor interface | `apps/api/src/transaction/compliance.{service,controller}.ts` + `zkp-verify.ts` | Read-only verification endpoint (item 4) |

The on-chain *Soroban* verifier (item 2) — which would check a groth16 proof via
a BLS12-381 pairing inside a Soroban contract — is left out of this PR because
pairing-friendly verification on Soroban requires a dedicated pairing library
and careful gas budgeting; it is a follow-up on top of this circuit.

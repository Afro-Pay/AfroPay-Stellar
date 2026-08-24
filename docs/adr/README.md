# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for AfroPay-Stellar. ADRs document the significant architectural decisions that have shaped the system, including the rationale behind those decisions.

Each ADR follows the [MADR (Markdown Architecture Decision Records)](https://adr.github.io/madr/) format, which includes:

- **Context**: The issue or decision point
- **Decision Drivers**: Factors influencing the choice
- **Considered Options**: Alternative approaches evaluated
- **Decision Outcome**: The chosen solution
- **Consequences**: Positive and negative impacts

## ADRs

### [0001: BullMQ for Asynchronous Settlement](./0001-bullmq-async-settlement.md)

Why we use BullMQ over direct Stellar SDK calls for async job processing. Addresses reliability, decoupling, and observability.

### [0002: AES-256-GCM Envelope Encryption](./0002-aes256-gcm-envelope-encryption.md)

Why we use AES-256-GCM envelope encryption for wallet encryption instead of a pure KMS approach. Balances security, performance, and operational complexity.

### [0003: Python for Fraud Scoring](./0003-python-fraud-scoring.md)

Why Python powers our fraud detection microservice instead of Rust or TypeScript. Prioritizes data science flexibility and ecosystem.

### [0004: Soroban Escrow Over SEP-8 Regulated Assets](./0004-soroban-escrow-over-sep8.md)

Why we implement escrow via Soroban smart contracts rather than SEP-8 regulated assets. Enables trustless settlement and custom logic.

### [0005: Deterministic Keypair Derivation](./0005-deterministic-keypair-derivation.md)

Why we derive keypairs deterministically from a master seed. Ensures recovery and eliminates key-storage risk for non-custodial flows.

## How to Use These Records

1. **When Reviewing Code**: Check relevant ADRs to understand the "why" behind architectural patterns.
2. **When Proposing Changes**: If your change affects these decisions, create a new ADR or update the existing one.
3. **When Onboarding**: Newcomers should read these to understand core design rationale.

## Creating New ADRs

When proposing a significant architectural decision:

1. Copy the [MADR template](./template.md) (if available) or use an existing ADR as a reference.
2. Number your ADR sequentially (next would be `0006-...md`).
3. Fill out all sections: Context, Drivers, Options, Decision, Consequences.
4. Submit a PR with the new ADR and any updates to `docs/architecture.md`.
5. Reference the new ADR in any related documentation or code comments.

## Status Legend

- **Accepted**: The decision has been made and is currently in effect.
- **Proposed**: The decision is under consideration.
- **Deprecated**: The decision has been superseded by another.
- **Superseded by**: Points to the ADR that replaced this one.

## References

- [MADR specification](https://adr.github.io/madr/)
- [ADR GitHub](https://adr.github.io/)
- [Architecture Documentation](../architecture.md)

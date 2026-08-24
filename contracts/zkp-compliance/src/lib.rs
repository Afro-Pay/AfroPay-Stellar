//! zk-SNARK (groth16) compliance circuit — AfroPay issue #271.
//!
//! Proves, in zero knowledge, that a transaction obeys the AML limits:
//!
//!   1. `poseidon(amount, salt) == public_commitment`  (binding + hiding commitment)
//!   2. `amount <= max_limit`                          (range check)
//!
//! The only public inputs are the commitment and the limit; the amount and salt
//! are private witnesses and never appear in the proof.  This is the on-chain
//! prover counterpart of the Python reference verifier
//! (`services/python-analytics/app/zkp_compliance.py`).
//!
//! ## Build
//! This crate is standalone (detached workspace).  Requires a Rust toolchain:
//!
//! ```text
//! cargo test --manifest-path contracts/zkp-compliance/Cargo.toml
//! ```
//!
//! It targets the `arkworks` 0.4.x series and `groth16` over the BLS12-381
//! pairing curve.  The trusted-setup key generation below (`generate_random_parameters`)
//! is for testing only — production requires a public MPC ceremony.

use ark_bls12_381::{Bls12_381, Fr};
use ark_crypto_primitives::crh::{
    poseidon::{constraints::CRHGadget, PoseidonConfig, CRH},
    CRHScheme, CRHSchemeGadget,
};
use ark_ec::PairingEngine;
use ark_ff::PrimeField;
use ark_groth16::{
    create_random_proof, generate_random_parameters, prepare_verifying_key, verify_proof,
    Proof, ProvingKey, VerifyingKey,
};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_r1cs_std::prelude::*;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};

/// Scalar field of BLS12-381 — the field the circuit lives in.
pub type F = Fr;

/// The compliance circuit: `poseidon(amount, salt) == commitment` AND `amount <= max_limit`.
#[derive(Clone)]
pub struct ComplianceCircuit {
    /// Public input — Poseidon hash of (amount, salt).
    pub commitment: Option<F>,
    /// Public input — AML limit the amount must not exceed.
    pub max_limit: Option<F>,
    /// Private witness — transaction amount (minor units).
    pub amount: Option<F>,
    /// Private witness — blinding salt.
    pub salt: Option<F>,
}

impl ComplianceCircuit {
    /// Empty circuit used to allocate the constraint system during setup.
    pub fn empty() -> Self {
        Self {
            commitment: None,
            max_limit: None,
            amount: None,
            salt: None,
        }
    }
}

/// Deterministic Poseidon parameters shared by the circuit and the off-circuit
/// `commit()` helper so both hash the same way.
pub fn poseidon_params() -> PoseidonConfig<F> {
    CRH::<F>::setup(&mut ark_std::test_rng()).expect("poseidon setup failed")
}

/// Off-circuit Poseidon commitment: `poseidon(amount, salt)`.
pub fn commit(amount: u64, salt: F) -> F {
    let params = poseidon_params();
    CRH::<F>::evaluate(&params, &[F::from(amount), salt]).expect("poseidon evaluate failed")
}

impl ConstraintSynthesizer<F> for ComplianceCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        let commitment = FpVar::new_input(cs.clone(), || {
            self.commitment.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let max_limit = FpVar::new_input(cs.clone(), || {
            self.max_limit.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let amount = FpVar::new_witness(cs.clone(), || {
            self.amount.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let salt = FpVar::new_witness(cs.clone(), || {
            self.salt.ok_or(SynthesisError::AssignmentMissing)
        })?;

        // (1) commitment == poseidon(amount, salt)
        let params = poseidon_params();
        let committed = CRHGadget::<F>::evaluate(&params, &[amount.clone(), salt.clone()])?;
        commitment.enforce_equal(&committed)?;

        // (2) amount <= max_limit — lexicographic <= on big-endian bit vectors.
        let amount_bits = amount.to_bits_le()?;
        let limit_bits = max_limit.to_bits_le()?;
        let n = amount_bits.len();
        debug_assert_eq!(n, limit_bits.len());

        // le = "suffix from bit i.. is <= limit's suffix", processed MSB -> LSB.
        let mut le = Boolean::<F>::TRUE;
        for i in (0..n).rev() {
            let a_less = amount_bits[i].not().and(&limit_bits[i])?; // !a_i & b_i
            let eq = amount_bits[i].is_eq(&limit_bits[i])?; // a_i == b_i
            le = a_less.or(&eq.and(&le)?)?; // le = (a_i<b_i) | ((a_i==b_i) & le_prev)
        }
        le.enforce_equal(&Boolean::<F>::TRUE)?;

        Ok(())
    }
}

/// Generate a (testing-only) proving/verifying key pair.  Production must use an
/// MPC trusted setup.
pub fn setup() -> (ProvingKey<Bls12_381>, VerifyingKey<Bls12_381>) {
    let dummy = ComplianceCircuit {
        commitment: Some(F::zero()),
        max_limit: Some(F::zero()),
        amount: Some(F::zero()),
        salt: Some(F::zero()),
    };
    let pk = generate_random_parameters::<Bls12_381, _, _>(dummy, &mut ark_std::test_rng())
        .expect("setup failed");
    let vk = pk.vk.clone();
    (pk, vk)
}

/// Create a proof that `amount <= max_limit` and that `commit` is its commitment.
pub fn prove(
    pk: &ProvingKey<Bls12_381>,
    amount: u64,
    salt: F,
    max_limit: u64,
) -> (Proof<Bls12_381>, F) {
    assert!(amount <= max_limit, "amount exceeds the compliance limit");
    let commitment = commit(amount, salt);
    let circuit = ComplianceCircuit {
        commitment: Some(commitment),
        max_limit: Some(F::from(max_limit)),
        amount: Some(F::from(amount)),
        salt: Some(salt),
    };
    let proof = create_random_proof(circuit, pk, &mut ark_std::test_rng()).expect("proving failed");
    (proof, commitment)
}

/// Verify a proof against a commitment and limit (returns `Ok(true)` iff valid).
pub fn verify(
    vk: &VerifyingKey<Bls12_381>,
    commitment: F,
    max_limit: u64,
    proof: &Proof<Bls12_381>,
) -> bool {
    let pvk = prepare_verifying_key(vk);
    let public_inputs = [commitment, F::from(max_limit)];
    verify_proof(&pvk, proof, &public_inputs).expect("verification failed")
}

/// Serialize a proof to bytes (for off-chain storage / on-chain submission).
pub fn serialize_proof(proof: &Proof<Bls12_381>) -> Vec<u8> {
    let mut buf = Vec::new();
    proof.serialize_uncompressed(&mut buf).expect("serialize proof");
    buf
}

/// Deserialize a proof previously produced by [`serialize_proof`].
pub fn deserialize_proof(bytes: &[u8]) -> Result<Proof<Bls12_381>, ark_serialize::SerializationError> {
    Proof::deserialize_uncompressed(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn salt_from(v: u64) -> F {
        F::from(v)
    }

    #[test]
    fn valid_proof_verifies() {
        let (pk, vk) = setup();
        let (proof, commitment) = prove(&pk, 150_000, salt_from(42), 200_000);
        assert!(verify(&vk, commitment, 200_000, &proof));
    }

    #[test]
    fn boundary_amounts_verify() {
        let (pk, vk) = setup();
        for amount in [0u64, 1, 199_999, 200_000] {
            let (proof, commitment) = prove(&pk, amount, salt_from(amount), 200_000);
            assert!(verify(&vk, commitment, 200_000, &proof), "amount {amount} failed");
        }
    }

    #[test]
    fn wrong_commitment_fails() {
        let (pk, vk) = setup();
        let (proof, _) = prove(&pk, 150_000, salt_from(42), 200_000);
        // A different commitment (different amount) must not verify.
        let other = commit(150_001, salt_from(42));
        assert!(!verify(&vk, other, 200_000, &proof));
    }

    #[test]
    fn wrong_limit_fails() {
        let (pk, vk) = setup();
        let (proof, commitment) = prove(&pk, 150_000, salt_from(42), 200_000);
        assert!(!verify(&vk, commitment, 199_999, &proof));
    }

    #[test]
    fn proof_roundtrips_serialization() {
        let (pk, vk) = setup();
        let (proof, commitment) = prove(&pk, 150_000, salt_from(42), 200_000);
        let bytes = serialize_proof(&proof);
        let restored = deserialize_proof(&bytes).expect("deserialize");
        assert!(verify(&vk, commitment, 200_000, &restored));
    }
}

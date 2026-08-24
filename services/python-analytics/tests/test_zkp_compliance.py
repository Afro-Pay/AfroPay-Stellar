import pytest

from app.zkp_compliance import (
    P,
    Q,
    G,
    H,
    commit,
    prove_compliance,
    verify_compliance,
    DEFAULT_INDIVIDUAL_LIMIT,
    DEFAULT_DAILY_LIMIT,
)


def test_group_parameters_sane():
    # G and H are generators of the order-q subgroup.
    assert pow(G, Q, P) == 1
    assert pow(H, Q, P) == 1
    assert G != 1 and H != 1


def test_commitment_is_binding_and_hiding_form():
    # Deterministic given (amount, salt).
    assert commit(1234, 999) == commit(1234, 999)
    # Different salts -> (overwhelmingly) different commitments.
    assert commit(1234, 999) != commit(1234, 1000)


def test_valid_proof_verifies_individual_limit():
    amount = 150_000  # $1,500.00 <= $2,000.00
    proof = prove_compliance(amount, salt=42, max_limit=DEFAULT_INDIVIDUAL_LIMIT)
    assert verify_compliance(proof.commitment, DEFAULT_INDIVIDUAL_LIMIT, proof)


def test_valid_proof_verifies_daily_limit():
    amount = 999_999  # just under $10,000.00
    proof = prove_compliance(amount, salt=7, max_limit=DEFAULT_DAILY_LIMIT)
    assert verify_compliance(proof.commitment, DEFAULT_DAILY_LIMIT, proof)


def test_boundary_amounts_verify():
    for amount in (0, 1, DEFAULT_INDIVIDUAL_LIMIT - 1, DEFAULT_INDIVIDUAL_LIMIT):
        proof = prove_compliance(amount, salt=amount + 1,
                                 max_limit=DEFAULT_INDIVIDUAL_LIMIT)
        assert verify_compliance(proof.commitment, DEFAULT_INDIVIDUAL_LIMIT, proof)


def test_prover_refuses_over_limit_amount():
    with pytest.raises(ValueError):
        prove_compliance(DEFAULT_INDIVIDUAL_LIMIT + 1, salt=5,
                         max_limit=DEFAULT_INDIVIDUAL_LIMIT)


def test_tampered_commitment_rejected():
    proof = prove_compliance(1000, salt=11, max_limit=DEFAULT_INDIVIDUAL_LIMIT)
    assert not verify_compliance(commit(1001, 11), DEFAULT_INDIVIDUAL_LIMIT, proof)


def test_wrong_limit_rejected():
    proof = prove_compliance(1000, salt=11, max_limit=DEFAULT_INDIVIDUAL_LIMIT)
    assert not verify_compliance(proof.commitment, DEFAULT_DAILY_LIMIT, proof)


def test_tampered_proof_rejected():
    proof = prove_compliance(1000, salt=11, max_limit=DEFAULT_INDIVIDUAL_LIMIT)
    data = proof.to_dict()
    # Flip a bit in the first amount-range bit commitment.
    c0 = int(data["amount_range"]["bit_commitments"][0], 16)
    data["amount_range"]["bit_commitments"][0] = hex((c0 + 1) % P)
    from app.zkp_compliance import ComplianceProof
    tampered = ComplianceProof.from_dict(data)
    assert not verify_compliance(tampered.commitment, DEFAULT_INDIVIDUAL_LIMIT, tampered)


def test_proof_serialization_roundtrip():
    proof = prove_compliance(424242, salt=123456, max_limit=DEFAULT_DAILY_LIMIT)
    restored = type(proof).from_dict(proof.to_dict())
    assert verify_compliance(restored.commitment, DEFAULT_DAILY_LIMIT, restored)


def test_zero_leakage_public_transcript():
    # The serialized proof must not contain the raw amount or salt anywhere.
    amount = 987_654
    salt = 0xDEADBEEF
    proof = prove_compliance(amount, salt=salt, max_limit=DEFAULT_DAILY_LIMIT)
    transcript = repr(proof.to_dict())
    assert str(amount) not in transcript
    assert hex(amount) not in transcript
    assert str(salt) not in transcript
    assert hex(salt) not in transcript


def test_distinct_proofs_for_distinct_salts():
    # Same amount, different salt -> different commitment and transcript
    # (hiding + non-replayable).
    p1 = prove_compliance(500, salt=1, max_limit=DEFAULT_INDIVIDUAL_LIMIT)
    p2 = prove_compliance(500, salt=2, max_limit=DEFAULT_INDIVIDUAL_LIMIT)
    assert p1.commitment != p2.commitment
    assert p1.to_dict() != p2.to_dict()

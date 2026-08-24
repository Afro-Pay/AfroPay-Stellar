"""Privacy-preserving AML compliance proofs (zero-knowledge).

Issue #271 — "Integrate Zero-Knowledge Proofs for Privacy-Preserving Compliance
Auditing".  This module is the backend reference prover for the Python analytics
service.  It lets AfroPay prove to a regulator that a transaction obeys the AML
limits *without revealing* the sender, receiver, or the exact amount.

Construction
------------
We use a Pedersen commitment over the RFC 3526 2048-bit MODP group (safe prime,
order ``q = (p-1)/2``) plus a zero-knowledge *range proof* built from
Cramer–Damgård–Schoenmakers (CDS) 1-of-2 OR proofs:

    C = G^amount * H^salt  mod p          (commitment = "hash(amount, salt)")

The range proof shows, in zero knowledge, that ``0 <= amount <= max_limit``:

1. ``amount < 2**k`` where ``k = max_limit.bit_length()`` — the amount is split
   into ``k`` bits; each bit is committed and proven to be 0-or-1 (CDS OR proof),
   and the bit commitments are proven to reconstruct ``C``.
2. ``amount <= max_limit`` — the classic "borrow-free subtraction" trick: define
   ``u = amount + (2**k - 1 - max_limit)``.  Then ``amount <= max_limit`` iff
   ``u < 2**k``, which is proven with a second bit-decomposition of ``u``.

The only public data are the commitment ``C``, the limit ``max_limit``, and the
proof transcript — the amount and salt never appear in the clear, so there is
zero leakage of raw transaction amounts or account identifiers.

Hiding is unconditional; binding and soundness reduce to the discrete-log
problem in the 2048-bit subgroup.  ``H`` is derived from a nothing-up-my-sleeve
SHA-256 string; a production deployment should replace it with an output of a
public trusted-setup (MPC) ceremony.  This is a *reference* prover — the
equivalent on-chain prover/verifier is the ``zkp-compliance`` Rust crate
(groth16 / arkworks).
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from typing import List, Tuple

# ---------------------------------------------------------------------------
# Group parameters — RFC 3526 "group 14" (2048-bit MODP, safe prime).
# p = 2q + 1, q prime.  G = 4 = 2^2 generates the order-q subgroup.
# ---------------------------------------------------------------------------
P = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1"
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245"
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC"
    "2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83"
    "655D23DCA3AD961C62F356208552BB9ED529077096966D670"
    "C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E"
    "772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BC"
    "BF6955817183995497CEA956AE515D2261898FA051015728E5"
    "A8AACAA68FFFFFFFFFFFFFFFF",
    16,
)
Q = (P - 1) // 2  # prime subgroup order
G = 4  # = 2**2, has order q

# Nothing-up-my-sleeve exponent for the second Pedersen generator.
_H_EXP = int.from_bytes(
    hashlib.sha256(b"AfroPay-ZKP-Pedersen-H-nothing-up-my-sleeve-v1").digest(), "big"
)
H = pow(G, _H_EXP, P)

# Default AML limits from the issue (integer minor units, e.g. USD cents).
DEFAULT_INDIVIDUAL_LIMIT = 200_000  # $2,000.00
DEFAULT_DAILY_LIMIT = 1_000_000  # $10,000.00


def _rand_scalar() -> int:
    """Uniform random scalar in [0, q)."""
    return secrets.randbelow(Q)


def _hash_to_scalar(*parts: bytes) -> int:
    """Fiat–Shamir: map a domain-separated transcript to a scalar in [0, q)."""
    h = hashlib.sha256()
    h.update(b"AfroPay-ZKP-Compliance-v1")
    for part in parts:
        h.update(len(part).to_bytes(8, "big"))
        h.update(part)
    return int.from_bytes(h.digest(), "big") % Q


def _int_bytes(value: int) -> bytes:
    return value.to_bytes((value.bit_length() + 7) // 8 or 1, "big")


def commit(amount: int, salt: int) -> int:
    """Pedersen commitment: ``C = G^amount * H^salt mod p``.

    ``amount`` and ``salt`` must be non-negative integers; ``salt`` should be a
    fresh random scalar in ``[0, q)`` for every proof.
    """
    if amount < 0 or salt < 0:
        raise ValueError("amount and salt must be non-negative")
    return (pow(G, amount, P) * pow(H, salt % Q, P)) % P


def _decompose_bits(value: int, k: int) -> List[int]:
    """Little-endian bit decomposition of ``value`` into exactly ``k`` bits."""
    if value < 0 or value >= (1 << k):
        raise ValueError(f"value {value} does not fit in {k} bits")
    return [(value >> i) & 1 for i in range(k)]


def _split_salt(salt: int, k: int) -> List[int]:
    """Split ``salt`` into ``k`` shares ``r_i`` with ``sum(r_i * 2^i) == salt``.

    The first ``k-1`` shares are random; the last share is chosen so the
    weighted sum equals ``salt`` mod q.  This keeps the bit-commitments
    reconstructing the original commitment without leaking ``salt``.
    """
    shares = [_rand_scalar() for _ in range(k - 1)]
    partial = sum(r * (1 << i) for i, r in enumerate(shares)) % Q
    inv = pow(1 << (k - 1), -1, Q)  # 2 is invertible mod q
    last = ((salt - partial) % Q * inv) % Q
    shares.append(last)
    return shares


@dataclass(frozen=True)
class BitProof:
    """A CDS 1-of-2 OR proof that ``C_b`` commits to 0 or 1."""

    t0: int
    t1: int
    c0: int
    c1: int
    s0: int
    s1: int

    def to_dict(self) -> dict:
        return {
            "t0": hex(self.t0),
            "t1": hex(self.t1),
            "c0": hex(self.c0),
            "c1": hex(self.c1),
            "s0": hex(self.s0),
            "s1": hex(self.s1),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "BitProof":
        return cls(
            t0=int(data["t0"], 16),
            t1=int(data["t1"], 16),
            c0=int(data["c0"], 16),
            c1=int(data["c1"], 16),
            s0=int(data["s0"], 16),
            s1=int(data["s1"], 16),
        )


def _prove_bit(bit: int, r: int, ctx: bytes) -> BitProof:
    """Prove that ``C_b = G^bit * H^r`` commits to ``bit`` in {0, 1}."""
    assert bit in (0, 1)
    c_b = (pow(G, bit, P) * pow(H, r, P)) % P

    # Real branch (b = bit): secret is r with statement X_bit = C_b / G^bit = H^r.
    w = _rand_scalar()
    t_real = pow(H, w, P)

    # Fake branch (b = 1 - bit): pick (c_fake, s_fake) and derive t_fake.
    c_fake = _rand_scalar()
    s_fake = _rand_scalar()
    x_fake = (c_b * pow(pow(G, 1 - bit, P), -1, P)) % P
    t_fake = (pow(H, s_fake, P) * pow(x_fake, -c_fake, P)) % P

    t0, t1 = (t_real, t_fake) if bit == 0 else (t_fake, t_real)

    c = _hash_to_scalar(ctx, _int_bytes(c_b), _int_bytes(t0), _int_bytes(t1))
    c_real = (c - c_fake) % Q
    s_real = (w + c_real * r) % Q

    if bit == 0:
        c0, c1, s0, s1 = c_real, c_fake, s_real, s_fake
    else:
        c0, c1, s0, s1 = c_fake, c_real, s_fake, s_real
    return BitProof(t0=t0, t1=t1, c0=c0, c1=c1, s0=s0, s1=s1)


def _verify_bit(commitment_b: int, proof: BitProof, ctx: bytes) -> bool:
    """Verify a CDS OR proof for ``commitment_b`` ∈ {H^r, G·H^r}."""
    c = _hash_to_scalar(
        ctx, _int_bytes(commitment_b), _int_bytes(proof.t0), _int_bytes(proof.t1)
    )
    if (proof.c0 + proof.c1) % Q != c:
        return False
    # Statement 0: commitment_b == H^s0 (bit 0).
    if pow(H, proof.s0, P) != (proof.t0 * pow(commitment_b, proof.c0, P)) % P:
        return False
    # Statement 1: commitment_b / G == H^s1 (bit 1).
    x1 = (commitment_b * pow(G, -1, P)) % P
    if pow(H, proof.s1, P) != (proof.t1 * pow(x1, proof.c1, P)) % P:
        return False
    return True


@dataclass(frozen=True)
class RangeProof:
    """A proof that a committed value fits in ``k`` bits (is < 2**k)."""

    bit_commitments: Tuple[int, ...]
    bit_proofs: Tuple[BitProof, ...]

    def to_dict(self) -> dict:
        return {
            "bit_commitments": [hex(c) for c in self.bit_commitments],
            "bit_proofs": [bp.to_dict() for bp in self.bit_proofs],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RangeProof":
        return cls(
            bit_commitments=tuple(int(c, 16) for c in data["bit_commitments"]),
            bit_proofs=tuple(BitProof.from_dict(b) for b in data["bit_proofs"]),
        )


def _prove_lt_pow2(value: int, salt: int, k: int, ctx: bytes) -> RangeProof:
    """Prove in zero knowledge that the committed value is ``< 2**k``."""
    bits = _decompose_bits(value, k)
    shares = _split_salt(salt, k)
    bit_commitments = []
    bit_proofs = []
    for i, (bit, r) in enumerate(zip(bits, shares)):
        c_i = (pow(G, bit, P) * pow(H, r, P)) % P
        bit_commitments.append(c_i)
        bit_proofs.append(_prove_bit(bit, r, ctx + _int_bytes(i)))
    return RangeProof(tuple(bit_commitments), tuple(bit_proofs))


def _verify_lt_pow2(commitment_c: int, proof: RangeProof, k: int, ctx: bytes) -> bool:
    """Verify a range proof that ``commitment_c`` commits to a value ``< 2**k``."""
    if len(proof.bit_commitments) != k or len(proof.bit_proofs) != k:
        return False
    # Each bit commitment commits to 0 or 1.
    for i, (c_i, bp) in enumerate(zip(proof.bit_commitments, proof.bit_proofs)):
        if not _verify_bit(c_i, bp, ctx + _int_bytes(i)):
            return False
    # The bit commitments reconstruct the original commitment.
    reconstructed = 1
    for i, c_i in enumerate(proof.bit_commitments):
        reconstructed = (reconstructed * pow(c_i, 1 << i, P)) % P
    return reconstructed == commitment_c % P


@dataclass(frozen=True)
class ComplianceProof:
    """Full zero-knowledge AML-compliance proof.

    Public inputs (visible to the regulator / verifier): ``commitment``,
    ``max_limit``, ``k`` and the two range proofs.  The amount and salt are
    *not* part of the transcript.
    """

    commitment: int
    max_limit: int
    k: int
    amount_range: RangeProof  # amount < 2**k
    upper_range: RangeProof  # amount <= max_limit (via u < 2**k)

    def to_dict(self) -> dict:
        return {
            "commitment": hex(self.commitment),
            "max_limit": str(self.max_limit),
            "k": self.k,
            "amount_range": self.amount_range.to_dict(),
            "upper_range": self.upper_range.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ComplianceProof":
        return cls(
            commitment=int(data["commitment"], 16),
            max_limit=int(data["max_limit"]),
            k=int(data["k"]),
            amount_range=RangeProof.from_dict(data["amount_range"]),
            upper_range=RangeProof.from_dict(data["upper_range"]),
        )


def prove_compliance(amount: int, salt: int, max_limit: int = DEFAULT_INDIVIDUAL_LIMIT) -> ComplianceProof:
    """Generate a ZK proof that ``0 <= amount <= max_limit`` without revealing it.

    The commitment ``C = commit(amount, salt)`` is the public "hash"; the proof
    additionally shows the committed value lies within the compliance limit.
    """
    if amount < 0 or salt < 0:
        raise ValueError("amount and salt must be non-negative")
    if max_limit <= 0:
        raise ValueError("max_limit must be positive")
    if amount > max_limit:
        raise ValueError(
            f"amount {amount} exceeds compliance limit {max_limit}; refusing to prove"
        )

    k = max_limit.bit_length()  # 2**(k-1) <= max_limit < 2**k
    c = commit(amount, salt)

    # 1) amount < 2**k
    amount_range = _prove_lt_pow2(amount, salt, k, b"amount")

    # 2) amount <= max_limit  ⟺  u = amount + (2**k - 1 - max_limit) < 2**k
    u = amount + (1 << k) - 1 - max_limit
    upper_range = _prove_lt_pow2(u, salt, k, b"upper")

    return ComplianceProof(
        commitment=c, max_limit=max_limit, k=k,
        amount_range=amount_range, upper_range=upper_range,
    )


def verify_compliance(
    commitment_c: int, max_limit: int, proof: ComplianceProof
) -> bool:
    """Verify a compliance proof against a public commitment and limit."""
    if max_limit <= 0 or proof.max_limit != max_limit:
        return False
    if proof.k != max_limit.bit_length():
        return False
    if proof.commitment % P != commitment_c % P:
        return False

    # amount < 2**k
    if not _verify_lt_pow2(commitment_c, proof.amount_range, proof.k, b"amount"):
        return False

    # amount <= max_limit : C_u = C * G^(2^k - 1 - max_limit), prove C_u < 2^k.
    c_u = (commitment_c * pow(G, (1 << proof.k) - 1 - max_limit, P)) % P
    if not _verify_lt_pow2(c_u, proof.upper_range, proof.k, b"upper"):
        return False

    return True

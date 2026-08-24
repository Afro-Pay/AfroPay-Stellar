"""HTTP routes for privacy-preserving compliance proofs (issue #271).

Prover/verifier endpoints used by the backend to generate ZK proofs and by
auditors (or the NestJS auditor interface) to verify them.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.zkp_compliance import (
    DEFAULT_INDIVIDUAL_LIMIT,
    DEFAULT_DAILY_LIMIT,
    ComplianceProof,
    prove_compliance,
    verify_compliance,
)

router = APIRouter()


class ProveRequest(BaseModel):
    amount: int = Field(..., ge=0, description="Transaction amount in minor units (e.g. USD cents).")
    salt: int = Field(..., ge=0, description="Fresh random blinding scalar (nonce).")
    max_limit: int = Field(
        DEFAULT_INDIVIDUAL_LIMIT,
        gt=0,
        description="Compliance limit the amount must satisfy.",
    )


class VerifyRequest(BaseModel):
    commitment: str = Field(..., description="Pedersen commitment (hex, 0x-prefixed).")
    max_limit: int = Field(..., gt=0)
    proof: dict = Field(..., description="Serialized ComplianceProof.")


@router.post("/prove")
def prove(req: ProveRequest) -> dict:
    """Generate a ZK proof that ``amount <= max_limit`` without revealing amount."""
    try:
        proof = prove_compliance(req.amount, req.salt, req.max_limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return proof.to_dict()


@router.post("/verify")
def verify(req: VerifyRequest) -> dict:
    """Verify a compliance proof against a public commitment and limit."""
    try:
        commitment = int(req.commitment, 16)
        proof = ComplianceProof.from_dict(req.proof)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"malformed proof: {exc}")
    valid = verify_compliance(commitment, req.max_limit, proof)
    return {"valid": valid, "commitment": req.commitment, "max_limit": req.max_limit}


@router.get("/limits")
def limits() -> dict:
    """Read-only AML compliance thresholds configured for the platform."""
    return {
        "individual_transfer_limit_minor_units": DEFAULT_INDIVIDUAL_LIMIT,
        "daily_volume_limit_minor_units": DEFAULT_DAILY_LIMIT,
    }

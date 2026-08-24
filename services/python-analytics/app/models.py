from pydantic import BaseModel
from typing import Optional


class TransactionInput(BaseModel):
    tx_id: str
    user_id: str
    amount: float
    asset_code: str
    destination: str
    source_country: Optional[str] = None
    destination_country: Optional[str] = None


class FeatureContribution(BaseModel):
    """A single SHAP-derived feature contribution for human review."""
    feature: str            # machine name, e.g. "destination_country_risk"
    label: str              # human-readable label, e.g. "High-risk destination country"
    contribution: float     # SHAP value (log-odds of fraud risk)


class RiskResult(BaseModel):
    tx_id: str
    risk_score: float       # 0.0 (safe) to 1.0 (high risk) — fraud probability
    flagged: bool
    reasons: list[str]      # SHAP-derived explanations, not hardcoded strings
    feature_contributions: list[FeatureContribution] = []

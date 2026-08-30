"""Fraud scoring for the AfroPay Python analytics service.

Issue #202 replaces the original static heuristic thresholds with a trained
gradient-boosted tree classifier and SHAP-based feature explanations.

The serialised artefact (``app/fraud_model.pkl``) is produced by
``train_fraud_model.py`` and loaded once at import time (startup), never
per-request. If the artefact is absent (e.g. a fresh checkout before training),
the scorer falls back to a minimal cold-start heuristic and emits a warning so
the service still answers requests.
"""

from __future__ import annotations

import math
import warnings
from pathlib import Path

import joblib
import numpy as np

from app.models import FeatureContribution, RiskResult, TransactionInput

HIGH_RISK_COUNTRIES = {"KP", "IR", "SY"}
HIGH_RISK_ASSETS = {"NGN", "KES", "GHS", "XLM", "XRP"}
LARGE_AMOUNT_THRESHOLD = 10_000

# Feature names in the exact order produced by :func:`extract_feature_vector`
# and consumed by the trained model.
FEATURE_NAMES = [
    "log_amount",
    "is_large_amount",
    "is_round_number",
    "source_country_risk",
    "destination_country_risk",
    "asset_risk",
]

FEATURE_LABELS = {
    "log_amount": "Transaction amount (log)",
    "is_large_amount": "Large transaction amount",
    "is_round_number": "Round-number amount",
    "source_country_risk": "High-risk source country",
    "destination_country_risk": "High-risk destination country",
    "asset_risk": "High-risk asset",
}

MODEL_PATH = Path(__file__).parent / "fraud_model.pkl"
FRAUD_THRESHOLD = 0.5  # fraud probability above which a transaction is flagged


def extract_feature_vector(tx: TransactionInput) -> np.ndarray:
    """Convert a transaction into the fixed-size feature vector used by the model.

    Missing optional fields (``source_country`` / ``destination_country``) are
    treated as neutral (no country-risk contribution) rather than raising.
    """
    amount = float(tx.amount or 0.0)
    source = (tx.source_country or "").strip().upper()
    destination = (tx.destination_country or "").strip().upper()
    asset = (tx.asset_code or "").strip().upper()

    return np.array(
        [
            math.log1p(max(amount, 0.0)),
            1.0 if amount > float(LARGE_AMOUNT_THRESHOLD) else 0.0,
            1.0 if (amount > 0.0 and amount % 1000.0 == 0.0) else 0.0,
            1.0 if source in HIGH_RISK_COUNTRIES else 0.0,
            1.0 if destination in HIGH_RISK_COUNTRIES else 0.0,
            1.0 if asset in HIGH_RISK_ASSETS else 0.0,
        ],
        dtype=float,
    )


# ---------------------------------------------------------------------------
# Model loading (startup, not per-request)
# ---------------------------------------------------------------------------

_MODEL = None
_EXPLAINER = None


def _init_model() -> None:
    """Load the trained model and build its TreeExplainer exactly once."""
    global _MODEL, _EXPLAINER

    if not MODEL_PATH.exists():
        warnings.warn(
            f"Fraud model artefact not found at {MODEL_PATH}; "
            "falling back to cold-start heuristic scoring.",
            RuntimeWarning,
        )
        return

    try:
        import shap  # imported lazily so the module remains importable without it

        artefact = joblib.load(MODEL_PATH)
        model = artefact["model"]
        _MODEL = model
        _EXPLAINER = shap.TreeExplainer(model)
    except Exception as exc:  # pragma: no cover - defensive startup guard
        warnings.warn(
            f"Failed to load fraud model artefact ({exc}); "
            "falling back to cold-start heuristic scoring.",
            RuntimeWarning,
        )
        _MODEL = None
        _EXPLAINER = None


_init_model()


def _explain_single(explainer, x_2d: np.ndarray) -> tuple[float, np.ndarray]:
    """Return ``(base_value, per_feature_shap_values)`` for a single row.

    Handles the API differences across SHAP releases (``shap_values`` may return
    a list of per-class arrays or a single array for the positive class).
    """
    shap_values = explainer.shap_values(x_2d)

    if isinstance(shap_values, list):
        values = shap_values[1] if len(shap_values) > 1 else shap_values[0]
    else:
        values = shap_values
    values = np.asarray(values).reshape(-1)

    base = explainer.expected_value
    if isinstance(base, (list, tuple)):
        base = base[1] if len(base) > 1 else base[0]
    base = float(np.asarray(base).reshape(-1)[0])

    return base, values


def _build_reasons(contributions: dict[str, float]) -> list[str]:
    """Render SHAP contributions as human-readable reasons, most impactful first."""
    ranked = sorted(contributions.items(), key=lambda kv: abs(kv[1]), reverse=True)
    reasons = []
    for name, value in ranked:
        if abs(value) < 1e-4:
            continue
        label = FEATURE_LABELS.get(name, name)
        direction = "increased" if value > 0.0 else "reduced"
        reasons.append(f"{label} {direction} risk (SHAP {value:+.3f})")
    return reasons or ["No significant risk factors detected"]


def _score_ml(tx: TransactionInput, x: np.ndarray) -> RiskResult:
    x_2d = x.reshape(1, -1)
    proba = float(_MODEL.predict_proba(x_2d)[0, 1])

    _base, values = _explain_single(_EXPLAINER, x_2d)
    contributions = {name: float(values[i]) for i, name in enumerate(FEATURE_NAMES)}

    risk_score = round(proba, 4)
    # Derive `flagged` from the rounded score so the invariant
    # `flagged == (risk_score >= threshold)` holds exactly.
    flagged = risk_score >= FRAUD_THRESHOLD

    return RiskResult(
        tx_id=tx.tx_id,
        risk_score=risk_score,
        flagged=flagged,
        reasons=_build_reasons(contributions),
        feature_contributions=[
            FeatureContribution(
                feature=name,
                label=FEATURE_LABELS.get(name, name),
                contribution=round(float(contributions[name]), 4),
            )
            for name in FEATURE_NAMES
        ],
    )


def _score_heuristic(tx: TransactionInput, x: np.ndarray) -> RiskResult:
    """Minimal cold-start fallback used only when no model artefact is present."""
    amount = float(tx.amount or 0.0)
    source = (tx.source_country or "").strip().upper()
    destination = (tx.destination_country or "").strip().upper()

    score = 0.0
    reasons = []
    if amount > float(LARGE_AMOUNT_THRESHOLD):
        score += 0.4
        reasons.append("Large transaction amount")
    if destination in HIGH_RISK_COUNTRIES:
        score += 0.5
        reasons.append(f"High-risk destination country: {destination}")
    if source in HIGH_RISK_COUNTRIES:
        score += 0.3
        reasons.append(f"High-risk source country: {source}")
    if amount % 1000.0 == 0.0 and amount > 0.0:
        score += 0.1
        reasons.append("Round-number amount")

    score = min(score, 1.0)
    risk_score = round(score, 2)
    flagged = risk_score >= 0.5

    return RiskResult(
        tx_id=tx.tx_id,
        risk_score=risk_score,
        flagged=flagged,
        reasons=reasons,
        feature_contributions=[],
    )


def score_transaction(tx: TransactionInput) -> RiskResult:
    """Score a single transaction for fraud risk.

    Uses the trained model + SHAP explanations when the artefact is loaded
    (the normal path), falling back to the cold-start heuristic otherwise.
    """
    x = extract_feature_vector(tx)
    if _MODEL is not None and _EXPLAINER is not None:
        return _score_ml(tx, x)
    return _score_heuristic(tx, x)

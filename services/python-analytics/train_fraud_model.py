"""Training pipeline for the AfroPay fraud-scoring model (issue #202).

Generates a synthetic remittance-fraud dataset, trains a gradient-boosted tree
classifier, evaluates it on a held-out test split, serialises the artefact to
``app/fraud_model.pkl``, and writes ``MODEL_CARD.md``.

Usage (from ``services/python-analytics/``)::

    python train_fraud_model.py [--samples 10000] [--seed 42]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from app.fraud import (
    FEATURE_LABELS,
    FEATURE_NAMES,
    HIGH_RISK_ASSETS,
    HIGH_RISK_COUNTRIES,
    extract_feature_vector,
)
from app.models import TransactionInput

APP_DIR = Path(__file__).parent / "app"
ARTEFACT_PATH = APP_DIR / "fraud_model.pkl"
MODEL_CARD_PATH = Path(__file__).parent / "MODEL_CARD.md"

SAFE_COUNTRIES = ["NG", "KE", "GH", "US", "GB", "CA", "DE", "FR", "ZA", "RW"]
SAFE_ASSETS = ["USDC", "USDT"]
HIGH_RISK_COUNTRY_LIST = sorted(HIGH_RISK_COUNTRIES)
HIGH_RISK_ASSET_LIST = sorted(HIGH_RISK_ASSETS)


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + np.exp(-z))


def generate_synthetic_data(n: int, seed: int) -> list[TransactionInput]:
    """Create a synthetic remittance dataset with a realistic fraud signal."""
    rng = np.random.default_rng(seed)

    txs: list[TransactionInput] = []
    for i in range(n):
        amount = float(np.round(rng.lognormal(mean=5.0, sigma=1.6), 2))
        source = (
            HIGH_RISK_COUNTRY_LIST[rng.integers(len(HIGH_RISK_COUNTRY_LIST))]
            if rng.random() < 0.04
            else SAFE_COUNTRIES[rng.integers(len(SAFE_COUNTRIES))]
        )
        destination = (
            HIGH_RISK_COUNTRY_LIST[rng.integers(len(HIGH_RISK_COUNTRY_LIST))]
            if rng.random() < 0.06
            else SAFE_COUNTRIES[rng.integers(len(SAFE_COUNTRIES))]
        )
        asset = (
            HIGH_RISK_ASSET_LIST[rng.integers(len(HIGH_RISK_ASSET_LIST))]
            if rng.random() < 0.25
            else SAFE_ASSETS[rng.integers(len(SAFE_ASSETS))]
        )
        txs.append(
            TransactionInput(
                tx_id=f"synth-{i}",
                user_id=f"user-{rng.integers(1, 500)}",
                amount=amount,
                asset_code=asset,
                destination=f"G{rng.bytes(4).hex().upper()}",
                source_country=source,
                destination_country=destination,
            )
        )
    return txs


def build_dataset(txs: list[TransactionInput], seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(X, y)`` where ``y`` is the synthetic fraud label.

    Labels are generated from a strongly separable logistic signal (thresholded
    at 0.5) plus 4% label noise, mimicking a realistic but learnable fraud rule.
    """
    rng = np.random.default_rng(seed)
    X = np.vstack([extract_feature_vector(tx) for tx in txs])

    log_amount = X[:, 0]
    is_large = X[:, 1]
    is_round = X[:, 2]
    src_risk = X[:, 3]
    dst_risk = X[:, 4]
    asset_risk = X[:, 5]

    logit = (
        -3.0
        + 4.0 * dst_risk
        + 2.8 * is_large
        + 1.8 * src_risk
        + 1.2 * is_round
        + 1.0 * asset_risk
        + 0.5 * (log_amount - 4.5)
    )
    p = _sigmoid(logit)
    y = (p > 0.5).astype(int)
    # 4% label noise
    flip = rng.random(len(txs)) < 0.04
    y = np.where(flip, 1 - y, y)
    return X, y


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=12000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print(f"[1/5] Generating {args.samples} synthetic transactions (seed={args.seed})…")
    txs = generate_synthetic_data(args.samples, args.seed)
    X, y = build_dataset(txs, args.seed)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=args.seed, stratify=y
    )
    print(f"      train={len(X_train)}  test={len(X_test)}  fraud_rate={y.mean():.4f}")

    print("[2/5] Training GradientBoostingClassifier…")
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=3,
        learning_rate=0.08,
        subsample=0.8,
        random_state=args.seed,
    )
    model.fit(X_train, y_train)

    print("[3/5] Evaluating on held-out test set…")
    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)
    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, y_prob)),
    }
    print("      " + json.dumps(metrics))

    print("[4/5] Computing SHAP feature importance…")
    try:
        import shap

        explainer = shap.TreeExplainer(model)
        sample = X_test[: min(300, len(X_test))]
        shap_values = explainer.shap_values(sample)
        if isinstance(shap_values, list):
            shap_values = shap_values[1] if len(shap_values) > 1 else shap_values[0]
        mean_abs = np.abs(np.asarray(shap_values)).mean(axis=0)
        shap_importance = {
            FEATURE_NAMES[i]: float(mean_abs[i]) for i in range(len(FEATURE_NAMES))
        }
    except Exception as exc:  # pragma: no cover - non-fatal
        print(f"      SHAP importance skipped: {exc}")
        shap_importance = {}

    print("[5/5] Serialising artefact and writing MODEL_CARD.md…")
    artefact = {
        "model": model,
        "feature_names": FEATURE_NAMES,
        "feature_labels": FEATURE_LABELS,
        "high_risk_countries": HIGH_RISK_COUNTRY_LIST,
        "high_risk_assets": HIGH_RISK_ASSET_LIST,
        "threshold": 0.5,
        "metrics": metrics,
        "shap_importance": shap_importance,
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    joblib.dump(artefact, ARTEFACT_PATH)
    print(f"      wrote {ARTEFACT_PATH}")

    _write_model_card(metrics, shap_importance, args)
    print(f"      wrote {MODEL_CARD_PATH}")
    print("Done.")


def _write_model_card(metrics: dict, shap_importance: dict, args) -> None:
    ranked = sorted(shap_importance.items(), key=lambda kv: kv[1], reverse=True)
    top = "\n".join(
        f"| `{name}` | {FEATURE_LABELS.get(name, name)} | {value:.4f} |"
        for name, value in ranked
    )

    MODEL_CARD_PATH.write_text(
        f"""# Model Card — AfroPay Fraud Scoring

## Overview
Gradient-boosted tree classifier (scikit-learn `GradientBoostingClassifier`)
that replaces the original heuristic fraud scorer in `app/fraud.py`. The model
estimates the probability that a remittance transaction is fraudulent and is
served through the existing FastAPI `/fraud/score` endpoint.

## Intended use
- Score incoming remittance transactions for fraud risk (0.0 = safe, 1.0 = high risk).
- Provide SHAP-derived, per-feature explanations for human review.
- Flag transactions whose fraud probability exceeds 0.5.

## Training data
- **Synthetic** remittance data generated by `train_fraud_model.py`
  ({args.samples} samples, seed {args.seed}).
- No real customer data is used.
- Fraud labels are synthesised from a logistic model over the engineered features.

## Features
| Feature | Label | Mean absolute SHAP |
|---|---|---|
{top}

## Evaluation (held-out synthetic test set, threshold 0.5)
| Metric | Value |
|---|---|
| Accuracy | {metrics['accuracy']:.4f} |
| Precision | {metrics['precision']:.4f} |
| Recall | {metrics['recall']:.4f} |
| F1 | {metrics['f1']:.4f} |
| ROC-AUC | {metrics['roc_auc']:.4f} |

## Explainability
SHAP TreeExplainer values are computed per-request at scoring time. Each feature's
SHAP contribution (in log-odds) is returned in `RiskResult.reasons` (human-readable)
and `RiskResult.feature_contributions` (numeric).

## Limitations
- Trained on synthetic data only; recalibrate on real labelled data before production use.
- The threshold (0.5) is a default and can be tuned to the desired precision/recall trade-off.

## Reproducibility
```
cd services/python-analytics
python train_fraud_model.py --samples {args.samples} --seed {args.seed}
```
"""
    )


if __name__ == "__main__":
    main()

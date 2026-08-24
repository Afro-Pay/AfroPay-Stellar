import pytest
from hypothesis import given, strategies as st

from app.fraud import (
    FEATURE_NAMES,
    HIGH_RISK_COUNTRIES,
    extract_feature_vector,
    score_transaction,
)
from app.models import TransactionInput


def make_tx(**kwargs):
    defaults = dict(
        tx_id="tx1",
        user_id="u1",
        amount=100.0,
        asset_code="USDC",
        destination="GXXX",
        source_country="NG",
        destination_country="US",
    )
    return TransactionInput(**{**defaults, **kwargs})


# ---------------------------------------------------------------------------
# Acceptance criteria (issue #202)
# ---------------------------------------------------------------------------

def test_known_low_risk_input_not_flagged():
    result = score_transaction(make_tx())  # $100 USDC, safe corridor
    assert result.flagged is False
    assert result.risk_score < 0.5
    assert 0.0 <= result.risk_score <= 1.0


def test_known_high_risk_input_flagged():
    result = score_transaction(make_tx(amount=50_000.0, destination_country="KP"))
    assert result.flagged is True
    assert result.risk_score >= 0.5


def test_missing_optional_fields_handled_gracefully():
    result = score_transaction(make_tx(source_country=None, destination_country=None))
    assert isinstance(result.risk_score, float)
    assert 0.0 <= result.risk_score <= 1.0


# ---------------------------------------------------------------------------
# SHAP explanations
# ---------------------------------------------------------------------------

def test_reasons_are_shap_derived_not_hardcoded():
    result = score_transaction(make_tx(amount=50_000.0, destination_country="KP"))
    assert result.reasons  # non-empty
    # Reasons are SHAP-derived: they carry a numeric contribution rather than
    # the legacy static strings from the old heuristic scorer.
    assert all("SHAP" in r for r in result.reasons)


def test_feature_contributions_populated():
    result = score_transaction(make_tx(amount=50_000.0, destination_country="KP"))
    assert len(result.feature_contributions) == len(FEATURE_NAMES)
    assert {c.feature for c in result.feature_contributions} == set(FEATURE_NAMES)
    for c in result.feature_contributions:
        assert isinstance(c.contribution, float)
        assert c.label  # human-readable label present


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def test_extract_feature_vector_missing_countries_is_neutral():
    x = extract_feature_vector(make_tx(source_country=None, destination_country=None))
    assert x.shape == (len(FEATURE_NAMES),)
    assert x[3] == 0.0  # source_country_risk
    assert x[4] == 0.0  # destination_country_risk


def test_extract_feature_vector_detects_risk_signals():
    x = extract_feature_vector(
        make_tx(amount=20_000.0, destination_country="KP", asset_code="NGN")
    )
    assert x[1] == 1.0  # is_large_amount
    assert x[4] == 1.0  # destination_country_risk
    assert x[5] == 1.0  # asset_risk


# ---------------------------------------------------------------------------
# Property-based invariants (model-agnostic)
# ---------------------------------------------------------------------------

@given(
    amount=st.floats(
        min_value=0.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False
    ),
    source_country=st.one_of(
        st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])
    ),
    destination_country=st.one_of(
        st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])
    ),
)
def test_property_score_always_in_valid_range(amount, source_country, destination_country):
    """Property: risk_score must always be in [0.0, 1.0] for any valid input."""
    tx = make_tx(
        amount=amount,
        source_country=source_country,
        destination_country=destination_country,
    )
    result = score_transaction(tx)
    assert 0.0 <= result.risk_score <= 1.0


@given(
    amount=st.floats(
        min_value=0.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False
    ),
    source_country=st.one_of(
        st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])
    ),
    destination_country=st.one_of(
        st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])
    ),
)
def test_property_flagged_invariant(amount, source_country, destination_country):
    """Property: flagged must equal (risk_score >= 0.5) for all inputs."""
    tx = make_tx(
        amount=amount,
        source_country=source_country,
        destination_country=destination_country,
    )
    result = score_transaction(tx)
    assert result.flagged == (result.risk_score >= 0.5)

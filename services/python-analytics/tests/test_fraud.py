import pytest
from hypothesis import given, strategies as st
from app.fraud import score_transaction, HIGH_RISK_COUNTRIES, LARGE_AMOUNT_THRESHOLD
from app.models import TransactionInput

def make_tx(**kwargs):
    defaults = dict(tx_id="tx1", user_id="u1", amount=100.0, asset_code="USDC", destination="GXXX")
    return TransactionInput(**{**defaults, **kwargs})

def test_safe_transaction():
    result = score_transaction(make_tx())
    assert result.flagged is False
    assert result.risk_score < 0.5

def test_large_amount_flagged():
    result = score_transaction(make_tx(amount=15000.0))
    assert result.risk_score >= 0.4
    assert any("Large" in r for r in result.reasons)

def test_high_risk_country_flagged():
    result = score_transaction(make_tx(destination_country="KP"))
    assert result.flagged is True
    assert result.risk_score >= 0.5

def test_round_number_adds_score():
    result = score_transaction(make_tx(amount=5000.0))
    assert any("Round" in r for r in result.reasons)

def test_score_capped_at_1():
    result = score_transaction(make_tx(amount=20000.0, destination_country="IR", source_country="KP"))
    assert result.risk_score <= 1.0


# Property-based tests using hypothesis

@given(
    amount=st.floats(min_value=0.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
    source_country=st.one_of(st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])),
    destination_country=st.one_of(st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])),
)
def test_property_score_always_in_valid_range(amount, source_country, destination_country):
    """Property: risk_score must always be in [0.0, 1.0] for any valid input."""
    tx = make_tx(amount=amount, source_country=source_country, destination_country=destination_country)
    result = score_transaction(tx)
    assert 0.0 <= result.risk_score <= 1.0, f"Score {result.risk_score} out of range for {tx}"


@given(
    amount=st.floats(min_value=0.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
    source_country=st.one_of(st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])),
    destination_country=st.one_of(st.none(), st.sampled_from(list(HIGH_RISK_COUNTRIES) + ["US", "GB", "CA"])),
)
def test_property_flagged_invariant(amount, source_country, destination_country):
    """Property: flagged must equal (score >= 0.5) for all inputs."""
    tx = make_tx(amount=amount, source_country=source_country, destination_country=destination_country)
    result = score_transaction(tx)
    expected_flagged = result.risk_score >= 0.5
    assert result.flagged == expected_flagged, \
        f"Flagged={result.flagged} but score={result.risk_score} for {tx}"


def test_property_zero_risk_gives_zero_score():
    """Property: all-zero-risk input (no risk factors) gives score 0.0."""
    # Low amount, safe countries, non-round number
    tx = make_tx(amount=123.45, source_country="US", destination_country="GB")
    result = score_transaction(tx)
    assert result.risk_score == 0.0, f"Expected 0.0 for zero-risk input, got {result.risk_score}"
    assert result.flagged is False


def test_property_max_risk_gives_capped_score():
    """Property: all-max-risk input (all risk factors) gives score 1.0 (clamped)."""
    # Large round amount + both high-risk countries
    # Max possible before clamp: 0.4 (large) + 0.5 (dest) + 0.3 (source) + 0.1 (round) = 1.3
    tx = make_tx(amount=20_000.0, source_country="IR", destination_country="KP")
    result = score_transaction(tx)
    assert result.risk_score == 1.0, f"Expected 1.0 for max-risk input, got {result.risk_score}"
    assert result.flagged is True


# Boundary tests for thresholds

def test_boundary_large_amount_exactly_at_threshold():
    """Boundary: amount exactly at LARGE_AMOUNT_THRESHOLD should NOT trigger."""
    tx = make_tx(amount=LARGE_AMOUNT_THRESHOLD)
    result = score_transaction(tx)
    assert not any("Large" in r for r in result.reasons), \
        f"Amount {LARGE_AMOUNT_THRESHOLD} should not be flagged as large"


def test_boundary_large_amount_just_above_threshold():
    """Boundary: amount just above LARGE_AMOUNT_THRESHOLD should trigger."""
    tx = make_tx(amount=LARGE_AMOUNT_THRESHOLD + 0.01)
    result = score_transaction(tx)
    assert any("Large" in r for r in result.reasons), \
        f"Amount {LARGE_AMOUNT_THRESHOLD + 0.01} should be flagged as large"


def test_boundary_large_amount_just_below_threshold():
    """Boundary: amount just below LARGE_AMOUNT_THRESHOLD should NOT trigger."""
    tx = make_tx(amount=LARGE_AMOUNT_THRESHOLD - 0.01)
    result = score_transaction(tx)
    assert not any("Large" in r for r in result.reasons), \
        f"Amount {LARGE_AMOUNT_THRESHOLD - 0.01} should not be flagged as large"


def test_boundary_round_number_zero_amount():
    """Boundary: zero amount should NOT trigger round-number heuristic."""
    tx = make_tx(amount=0.0)
    result = score_transaction(tx)
    assert not any("Round" in r for r in result.reasons), \
        "Zero amount should not trigger round-number heuristic"


def test_boundary_round_number_positive_round():
    """Boundary: positive round number should trigger round-number heuristic."""
    tx = make_tx(amount=1000.0)
    result = score_transaction(tx)
    assert any("Round" in r for r in result.reasons), \
        "1000.0 should trigger round-number heuristic"


def test_boundary_score_exactly_at_flag_threshold():
    """Boundary: score exactly 0.5 should be flagged."""
    # High-risk destination gives exactly 0.5
    tx = make_tx(amount=100.0, destination_country="IR", source_country="US")
    result = score_transaction(tx)
    assert result.risk_score == 0.5
    assert result.flagged is True, "Score of exactly 0.5 should be flagged"


def test_boundary_score_just_below_flag_threshold():
    """Boundary: score just below 0.5 should NOT be flagged."""
    # Large amount gives 0.4, just below threshold
    tx = make_tx(amount=15_000.0, source_country="US", destination_country="CA")
    result = score_transaction(tx)
    assert result.risk_score < 0.5
    assert result.flagged is False, f"Score {result.risk_score} below 0.5 should not be flagged"


def test_boundary_all_high_risk_countries():
    """Boundary: verify all HIGH_RISK_COUNTRIES are recognized."""
    for country in HIGH_RISK_COUNTRIES:
        tx_dest = make_tx(destination_country=country)
        result_dest = score_transaction(tx_dest)
        assert any(country in r for r in result_dest.reasons), \
            f"Destination country {country} should be recognized as high-risk"
        
        tx_source = make_tx(source_country=country)
        result_source = score_transaction(tx_source)
        assert any(country in r for r in result_source.reasons), \
            f"Source country {country} should be recognized as high-risk"

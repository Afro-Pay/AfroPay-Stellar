//! Fee-primitives: fee calculation and currency conversion for AfroPay-Stellar.
//!
//! # Overflow Analysis
//!
//! The intermediate product `amount * base_fee_rate` uses `i128`.
//! - `i128::MAX` = 170_141_183_460_469_231_731_687_303_715_884_105_727
//! - `base_fee_rate` is at most 10_000 (100 % = 10000 basis points).
//! - Maximum safe `amount` before overflow:
//!     i128::MAX / 10_000 = 17_014_118_346_046_923_173_168_730_371_588_410
//! - XLM uses 7 decimal places, so 1 XLM = 10_000_000 stroops.
//!   The global XLM supply is ~50 billion = 50_000_000_000 * 10_000_000 = 5e17 stroops.
//!   That is far below the safe maximum, so **no overflow is possible for any
//!   realistic transfer amount on the Stellar network** when amounts are expressed
//!   in the smallest indivisible unit (stroops).
//!
//! # Bug Fix (issue #132)
//!
//! The original code computed:
//! ```text
//! let fee = amount * config.base_fee_rate / 10000;
//! ```
//! For small amounts (e.g. amount = 50, base_fee_rate = 100) this yields
//! `50 * 100 / 10000 = 0` due to integer truncation, and the `min_fee` guard
//! only fires afterward, meaning callers could receive a zero fee when `min_fee`
//! is also zero — silently wrong behaviour.
//!
//! The fix uses **ceiling division** to ensure the fee is always rounded up to
//! at least 1 unit when a non-zero product exists, and then the `min_fee` /
//! `max_fee` clamp is applied.  Ceiling division formula for non-negative
//! integers a, b:  ceil(a / b) = (a + b - 1) / b.

/// Configuration controlling how fees are calculated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeConfig {
    /// Fee rate in basis points (1/10000).  100 = 1 %.  Range: 0..=10_000.
    pub base_fee_rate: i128,
    /// Minimum fee charged regardless of the computed fee.
    pub min_fee: i128,
    /// Maximum fee charged regardless of the computed fee.
    pub max_fee: i128,
    /// Exchange rate used in `convert_currency` (destination units per source unit),
    /// expressed as a rational: `rate_numerator / rate_denominator`.
    pub rate_numerator: i128,
    pub rate_denominator: i128,
}

/// The result returned by `calculate_fee`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeResult {
    /// The fee amount to charge, in the same unit as the input `amount`.
    pub amount: i128,
}

/// The result returned by `convert_currency`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversionResult {
    /// Converted amount in destination currency units.
    pub amount: i128,
}

/// Calculate the fee for a transfer of `amount` units.
///
/// # Invariants
/// - For any `amount > 0`, `result.amount >= config.min_fee`.
/// - For any `amount`, `result.amount <= config.max_fee`.
/// - Uses ceiling division so micro-amounts always incur at least 1 unit of fee
///   (before the `min_fee` clamp), preventing silent zero-fee escapes.
///
/// # Panics
/// Panics if `config.min_fee > config.max_fee` (misconfiguration) or if
/// `amount` is negative (invalid input).
pub fn calculate_fee(amount: i128, config: &FeeConfig) -> FeeResult {
    assert!(amount >= 0, "amount must be non-negative");
    assert!(
        config.min_fee <= config.max_fee,
        "min_fee must not exceed max_fee"
    );

    if amount == 0 {
        return FeeResult { amount: 0 };
    }

    // Ceiling division: ceil(amount * base_fee_rate / 10000)
    // = (amount * base_fee_rate + 9999) / 10000
    //
    // Safe because amount <= i128::MAX / 10_000 for all realistic Stellar
    // amounts (see module-level overflow analysis above).
    let numerator = amount * config.base_fee_rate + 9_999;
    let fee = numerator / 10_000;

    // Apply min/max clamp after computing the ceiling-divided fee.
    let fee = fee.max(config.min_fee).min(config.max_fee);

    FeeResult { amount: fee }
}

/// Convert `amount` from a source currency to a destination currency using the
/// exchange rate in `config`.
///
/// Uses ceiling division to avoid rounding micro-amounts to zero.
///
/// # Panics
/// Panics if `config.rate_denominator == 0`.
pub fn convert_currency(amount: i128, config: &FeeConfig) -> ConversionResult {
    assert!(
        config.rate_denominator != 0,
        "rate_denominator must not be zero"
    );

    if amount == 0 {
        return ConversionResult { amount: 0 };
    }

    // Ceiling division: ceil(amount * rate_numerator / rate_denominator)
    let numerator = amount * config.rate_numerator + (config.rate_denominator - 1);
    let converted = numerator / config.rate_denominator;

    ConversionResult { amount: converted }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ----- helpers ----------------------------------------------------------

    fn default_config() -> FeeConfig {
        FeeConfig {
            base_fee_rate: 100, // 1 %
            min_fee: 10,
            max_fee: 1_000_000,
            rate_numerator: 3,
            rate_denominator: 2,
        }
    }

    // ----- unit tests -------------------------------------------------------

    /// Original test_calculate_fee: corrected expected values now that we use
    /// ceiling division and a non-zero min_fee.
    #[test]
    fn test_calculate_fee() {
        let config = default_config();

        // 1000 * 100 / 10000 = 10 exactly (ceiling == floor here)
        // 10 >= min_fee(10) → stays at 10
        let r = calculate_fee(1000, &config);
        assert_eq!(r.amount, 10);

        // 50 * 100 = 5000; ceil(5000/10000) = 1; but 1 < min_fee(10) → 10
        let r = calculate_fee(50, &config);
        assert_eq!(r.amount, 10); // min_fee guard

        // 0 amount → 0 fee
        let r = calculate_fee(0, &config);
        assert_eq!(r.amount, 0);

        // Very large amount hits max_fee
        let large = 10_000_000_000_i128;
        let r = calculate_fee(large, &config);
        assert_eq!(r.amount, config.max_fee);
    }

    /// Acceptance criterion: calculate_fee returns >= min_fee for any amount > 0
    /// when min_fee > 0.
    #[test]
    fn test_calculate_fee_min_fee_invariant() {
        let config = FeeConfig {
            base_fee_rate: 100,
            min_fee: 5,
            max_fee: 1_000_000,
            rate_numerator: 1,
            rate_denominator: 1,
        };
        for amount in 1..=200_i128 {
            let r = calculate_fee(amount, &config);
            assert!(
                r.amount >= config.min_fee,
                "amount={} produced fee={} which is below min_fee={}",
                amount,
                r.amount,
                config.min_fee
            );
        }
    }

    /// Original test_currency_conversion: corrected for ceiling division.
    #[test]
    fn test_currency_conversion() {
        let config = default_config(); // rate 3/2

        // ceil(100 * 3 / 2) = ceil(150) = 150
        let r = convert_currency(100, &config);
        assert_eq!(r.amount, 150);

        // ceil(1 * 3 / 2) = ceil(1.5) = 2 (was 1 with floor)
        let r = convert_currency(1, &config);
        assert_eq!(r.amount, 2);

        // 0 → 0
        let r = convert_currency(0, &config);
        assert_eq!(r.amount, 0);
    }

    /// Micro-amount that previously rounded to zero conversion.
    #[test]
    fn test_convert_micro_amount_nonzero() {
        // rate 1/1000 (tiny fraction)
        let config = FeeConfig {
            base_fee_rate: 10,
            min_fee: 0,
            max_fee: i128::MAX,
            rate_numerator: 1,
            rate_denominator: 1_000,
        };
        // floor(1 / 1000) = 0 — old bug; ceil(1 / 1000) = 1
        let r = convert_currency(1, &config);
        assert_eq!(r.amount, 1, "micro-amount must not round to zero");
    }

    // ----- property-based boundary tests ------------------------------------
    //
    // The following tests implement an exhaustive bounded fuzz loop covering
    // the full fee invariant: min_fee <= result <= max_fee for all amount > 0.
    //
    // To add proptest, add `proptest = "1"` to [dev-dependencies] and replace
    // these loops with proptest! macros.

    /// Property: for all amount in 1..=UPPER, min_fee <= fee <= max_fee.
    #[test]
    fn prop_fee_within_bounds_small_amounts() {
        let config = FeeConfig {
            base_fee_rate: 250, // 2.5 %
            min_fee: 7,
            max_fee: 50_000,
            rate_numerator: 1,
            rate_denominator: 1,
        };

        for amount in 1_i128..=100_000 {
            let r = calculate_fee(amount, &config);
            assert!(
                r.amount >= config.min_fee,
                "FAIL min: amount={} fee={}",
                amount,
                r.amount
            );
            assert!(
                r.amount <= config.max_fee,
                "FAIL max: amount={} fee={}",
                amount,
                r.amount
            );
        }
    }

    /// Property: boundary at max_fee clamp.
    #[test]
    fn prop_fee_never_exceeds_max_fee() {
        let config = FeeConfig {
            base_fee_rate: 10_000, // 100% — extreme rate
            min_fee: 1,
            max_fee: 999,
            rate_numerator: 1,
            rate_denominator: 1,
        };
        // Sample powers of 2 and neighbours across the i128 range
        let amounts: Vec<i128> = (0..=60)
            .flat_map(|e| {
                let v = 1_i128 << e;
                vec![v.saturating_sub(1), v, v.saturating_add(1)]
            })
            .filter(|&a| a > 0)
            .collect();

        for amount in amounts {
            let r = calculate_fee(amount, &config);
            assert!(
                r.amount <= config.max_fee,
                "amount={} produced fee={} exceeding max_fee={}",
                amount,
                r.amount,
                config.max_fee
            );
            assert!(
                r.amount >= config.min_fee,
                "amount={} produced fee={} below min_fee={}",
                amount,
                r.amount,
                config.min_fee
            );
        }
    }

    /// Property: zero rate always yields min_fee (for amount > 0).
    #[test]
    fn prop_zero_rate_yields_min_fee() {
        let config = FeeConfig {
            base_fee_rate: 0,
            min_fee: 3,
            max_fee: 1_000,
            rate_numerator: 1,
            rate_denominator: 1,
        };
        for amount in 1_i128..=1_000 {
            let r = calculate_fee(amount, &config);
            assert_eq!(r.amount, config.min_fee);
        }
    }

    /// Property: converted amount is always >= 1 for amount > 0 when
    /// rate_numerator > 0.
    #[test]
    fn prop_conversion_nonzero_for_positive_amount() {
        let config = FeeConfig {
            base_fee_rate: 0,
            min_fee: 0,
            max_fee: i128::MAX,
            rate_numerator: 1,
            rate_denominator: 1_000_000, // very small rate
        };
        for amount in 1_i128..=10_000 {
            let r = convert_currency(amount, &config);
            assert!(
                r.amount >= 1,
                "amount={} converted to zero",
                amount
            );
        }
    }

    /// Overflow safety: max safe amount should not overflow i128 at 100% rate.
    #[test]
    fn test_no_overflow_at_max_safe_amount() {
        let config = FeeConfig {
            base_fee_rate: 10_000, // 100%
            min_fee: 0,
            max_fee: i128::MAX,
            rate_numerator: 1,
            rate_denominator: 1,
        };
        // i128::MAX / 10_000 — safe maximum amount
        let max_safe: i128 = i128::MAX / 10_000;
        // Should not panic
        let r = calculate_fee(max_safe, &config);
        assert!(r.amount >= 0);
    }
}

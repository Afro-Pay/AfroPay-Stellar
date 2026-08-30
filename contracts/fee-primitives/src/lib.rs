#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

/// Denominator for basis-point (1/100th of a percent) calculations.
/// `10_000` basis points == 100%.
const BASIS_POINTS_DENOMINATOR: i128 = 10_000;

/// Configuration for fee calculation
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub base_fee_rate: i128,    // Basis points (e.g., 100 = 1%)
    pub min_fee: i128,          // Minimum fee in smallest unit
    pub max_fee: i128,          // Maximum fee in smallest unit
    pub fee_recipient: Address, // Address receiving fees
}

/// Currency conversion rate
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConversionRate {
    pub asset_a: String, // Source asset identifier
    pub asset_b: String, // Target asset identifier
    pub rate: i128,      // Conversion rate (basis points)
    pub updated_at: u64, // Timestamp
}

/// Fee calculation result
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeResult {
    pub amount: i128,                   // Fee amount in source asset
    pub rate_used: i128,                // Fee rate applied
    pub converted_amount: Option<i128>, // Converted amount if conversion applied
}

/// Computes the fee for `amount` under `config`.
///
/// ## Rounding convention (favors the protocol, not the payer)
/// The raw basis-point fee (`amount * base_fee_rate / BASIS_POINTS_DENOMINATOR`)
/// is rounded **up** (ceiling division) whenever there is a non-zero
/// remainder. Truncating (floor) division would silently under-charge by up
/// to one unit on every call, which over a large volume of transactions is a
/// systematic loss of protocol revenue. Rounding up guarantees the protocol
/// never collects less than the exact basis-point rate implies.
///
/// ## Overflow bound
/// `amount.checked_mul(config.base_fee_rate)` is `None` exactly when
/// `amount * base_fee_rate` would not fit in an `i128`
/// (i.e. `amount > i128::MAX / base_fee_rate` for `base_fee_rate > 0`).
/// Because `config.max_fee` already defines the maximum fee the protocol will
/// ever collect, an overflowing product can only mean the *true* fee is far
/// larger than `max_fee` — so on overflow we clamp straight to `max_fee`
/// instead of computing (or wrapping/panicking on) the unrepresentable exact
/// product.
///
/// ## Invariants enforced
/// - Fee is never negative (`amount`, `min_fee`, `max_fee`, `base_fee_rate`
///   are all validated to be non-negative, and `min_fee <= max_fee`).
/// - Fee never exceeds `amount`: even if `min_fee` is configured above
///   `amount`, the payer is never charged more than the principal itself.
/// - `base_fee_rate` cannot exceed `BASIS_POINTS_DENOMINATOR` (100%).
fn compute_fee(amount: i128, config: &FeeConfig) -> FeeResult {
    if amount < 0 {
        panic!("amount must be non-negative");
    }
    if config.base_fee_rate < 0 || config.base_fee_rate > BASIS_POINTS_DENOMINATOR {
        panic!("base_fee_rate must be between 0 and 10_000 basis points (0%-100%)");
    }
    if config.min_fee < 0 || config.max_fee < 0 {
        panic!("min_fee and max_fee must be non-negative");
    }
    if config.min_fee > config.max_fee {
        panic!("min_fee must not exceed max_fee");
    }

    // Overflow-safe multiplication; see doc comment above for the fallback rationale.
    let raw_fee = match amount.checked_mul(config.base_fee_rate) {
        Some(product) => {
            // Ceiling division: round the fee up in favor of the protocol.
            // Safe: `product >= 0` (amount >= 0 and base_fee_rate >= 0) and
            // `BASIS_POINTS_DENOMINATOR` is a non-zero constant, so this never
            // panics on division-by-zero or overflows (the quotient is <= product).
            let quotient = product / BASIS_POINTS_DENOMINATOR;
            let remainder = product % BASIS_POINTS_DENOMINATOR;
            if remainder > 0 {
                quotient + 1
            } else {
                quotient
            }
        }
        None => config.max_fee,
    };

    // Apply min/max boundaries.
    let clamped_fee = if raw_fee < config.min_fee {
        config.min_fee
    } else if raw_fee > config.max_fee {
        config.max_fee
    } else {
        raw_fee
    };

    // Never charge a fee larger than the amount it is levied against, even
    // if `min_fee` is configured above `amount` (protects the payer and
    // keeps the "fee cannot exceed principal" invariant unconditional).
    let final_fee = if clamped_fee > amount {
        amount
    } else {
        clamped_fee
    };

    FeeResult {
        amount: final_fee,
        rate_used: config.base_fee_rate,
        converted_amount: None,
    }
}

/// Converts `amount` from one asset to another using `rate`.
///
/// ## Rounding convention
/// Unlike [`compute_fee`], this is a value transformation rather than a
/// protocol charge, so it uses standard truncating (floor) division: the
/// payer never receives fractional-unit value manufactured by rounding up an
/// asset conversion. Any fee subsequently charged on the converted amount
/// (see [`calculate_fee_with_conversion`]) still rounds up in favor of the
/// protocol, so protocol revenue is unaffected by this choice.
///
/// ## Overflow bound
/// `amount.checked_mul(rate.rate)` is `None` exactly when
/// `amount * rate.rate` would not fit in an `i128`. Unlike fee calculation,
/// there is no configured ceiling to safely fall back to for a currency
/// conversion, so an overflow is a genuine error and panics rather than
/// silently wrapping or truncating.
fn apply_conversion(amount: i128, rate: &ConversionRate) -> i128 {
    if amount < 0 {
        panic!("amount must be non-negative");
    }
    if rate.rate < 0 {
        panic!("conversion rate must be non-negative");
    }

    let product = amount
        .checked_mul(rate.rate)
        .unwrap_or_else(|| panic!("currency conversion overflow: amount too large for given rate"));

    // Floor division: see rounding convention above.
    product / BASIS_POINTS_DENOMINATOR
}

#[contract]
pub struct FeePrimitives;

#[contractimpl]
impl FeePrimitives {
    /// Calculate fee based on amount and configuration
    pub fn calculate_fee(_env: &Env, amount: i128, config: FeeConfig) -> FeeResult {
        compute_fee(amount, &config)
    }

    /// Convert amount from one asset to another
    pub fn convert_currency(
        _env: &Env,
        amount: i128,
        from_asset: String,
        to_asset: String,
        rate: ConversionRate,
    ) -> i128 {
        // Ensure the rate matches the assets
        if rate.asset_a != from_asset || rate.asset_b != to_asset {
            panic!("Asset mismatch in conversion rate");
        }

        apply_conversion(amount, &rate)
    }

    /// Calculate fee with currency conversion
    pub fn calculate_fee_with_conversion(
        env: &Env,
        amount: i128,
        from_asset: String,
        to_asset: String,
        fee_config: FeeConfig,
        conversion_rate: ConversionRate,
    ) -> FeeResult {
        // First convert the amount
        let converted_amount =
            Self::convert_currency(env, amount, from_asset, to_asset, conversion_rate);

        // Calculate fee on the converted amount
        let mut fee_result = Self::calculate_fee(env, converted_amount, fee_config);

        // Add conversion info
        fee_result.converted_amount = Some(converted_amount);

        fee_result
    }

    /// Store a conversion rate
    pub fn set_conversion_rate(env: &Env, asset_a: String, asset_b: String, rate: i128) {
        let conversion_rate = ConversionRate {
            asset_a: asset_a.clone(),
            asset_b: asset_b.clone(),
            rate,
            updated_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&asset_a, &conversion_rate);
    }

    /// Get a conversion rate
    pub fn get_conversion_rate(env: &Env, asset_a: String) -> ConversionRate {
        env.storage()
            .persistent()
            .get(&asset_a)
            .unwrap_or_else(|| panic!("Conversion rate not found for asset"))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Env, String};

    fn addr(env: &Env) -> Address {
        Address::generate(env)
    }

    #[test]
    fn test_calculate_fee() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 100, // 1%
            min_fee: 0,
            max_fee: 1000,
            fee_recipient: addr(&env),
        };

        let result = FeePrimitives::calculate_fee(&env, 1000, fee_config);
        assert_eq!(result.amount, 10); // 1000 * 1% = 10
        assert_eq!(result.rate_used, 100);
    }

    #[test]
    fn test_currency_conversion() {
        let env = Env::default();
        let rate = ConversionRate {
            asset_a: String::from_str(&env, "USD"),
            asset_b: String::from_str(&env, "EUR"),
            rate: 8_500, // 1 USD = 0.85 EUR, expressed in basis points
            updated_at: 0,
        };

        let result = FeePrimitives::convert_currency(
            &env,
            100,
            String::from_str(&env, "USD"),
            String::from_str(&env, "EUR"),
            rate,
        );
        assert_eq!(result, 85);
    }

    #[test]
    fn test_fee_rounds_up_in_favor_of_protocol() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 1, // 0.01%
            min_fee: 0,
            max_fee: 1_000_000,
            fee_recipient: addr(&env),
        };

        // 999 * 1 / 10_000 = 0.0999 -> truncation would give 0, ceiling gives 1.
        let result = FeePrimitives::calculate_fee(&env, 999, fee_config);
        assert_eq!(result.amount, 1);
    }

    #[test]
    fn test_fee_of_zero_amount_is_zero() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 500,
            min_fee: 50, // even with a non-zero minimum...
            max_fee: 1000,
            fee_recipient: addr(&env),
        };

        // ...a zero-amount charge must never yield a positive fee.
        let result = FeePrimitives::calculate_fee(&env, 0, fee_config);
        assert_eq!(result.amount, 0);
    }

    #[test]
    fn test_fee_of_max_i128_does_not_overflow() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 100, // 1%
            min_fee: 0,
            max_fee: 1_000_000,
            fee_recipient: addr(&env),
        };

        // amount * base_fee_rate overflows i128; the fee must safely clamp
        // to max_fee instead of panicking on overflow or wrapping.
        let result = FeePrimitives::calculate_fee(&env, i128::MAX, fee_config);
        assert_eq!(result.amount, 1_000_000);
    }

    #[test]
    fn test_fee_never_exceeds_principal() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 500,
            min_fee: 100, // minimum fee exceeds the amount below
            max_fee: 1000,
            fee_recipient: addr(&env),
        };

        let result = FeePrimitives::calculate_fee(&env, 10, fee_config);
        assert!(result.amount <= 10);
        assert_eq!(result.amount, 10);
    }

    #[test]
    fn test_fee_plus_principal_matches_expected_total() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 250, // 2.5%
            min_fee: 0,
            max_fee: 10_000,
            fee_recipient: addr(&env),
        };

        let amount = 40_000;
        let result = FeePrimitives::calculate_fee(&env, amount, fee_config);
        assert_eq!(result.amount, 1000); // 40_000 * 2.5% = 1000 exactly
        assert_eq!(amount + result.amount, 41_000);
    }

    #[test]
    #[should_panic(expected = "base_fee_rate must be between 0 and 10_000 basis points")]
    fn test_base_fee_rate_over_100_percent_panics() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 10_001, // > 100%
            min_fee: 0,
            max_fee: 1000,
            fee_recipient: addr(&env),
        };

        FeePrimitives::calculate_fee(&env, 1000, fee_config);
    }

    #[test]
    #[should_panic(expected = "min_fee must not exceed max_fee")]
    fn test_min_fee_over_max_fee_panics() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 100,
            min_fee: 2000,
            max_fee: 1000,
            fee_recipient: addr(&env),
        };

        FeePrimitives::calculate_fee(&env, 1000, fee_config);
    }

    #[test]
    #[should_panic(expected = "currency conversion overflow")]
    fn test_currency_conversion_overflow_panics() {
        let env = Env::default();
        let rate = ConversionRate {
            asset_a: String::from_str(&env, "USD"),
            asset_b: String::from_str(&env, "EUR"),
            rate: i128::MAX,
            updated_at: 0,
        };

        FeePrimitives::convert_currency(
            &env,
            i128::MAX,
            String::from_str(&env, "USD"),
            String::from_str(&env, "EUR"),
            rate,
        );
    }

    #[test]
    fn test_calculate_fee_with_conversion() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 100, // 1%
            min_fee: 0,
            max_fee: 1_000_000,
            fee_recipient: addr(&env),
        };
        let rate = ConversionRate {
            asset_a: String::from_str(&env, "USD"),
            asset_b: String::from_str(&env, "EUR"),
            rate: 8_500, // 1 USD = 0.85 EUR
            updated_at: 0,
        };

        let result = FeePrimitives::calculate_fee_with_conversion(
            &env,
            1000,
            String::from_str(&env, "USD"),
            String::from_str(&env, "EUR"),
            fee_config,
            rate,
        );
        assert_eq!(result.converted_amount, Some(850)); // 1000 * 0.85
        assert_eq!(result.amount, 9); // ceil(850 * 1% ) = ceil(8.5) = 9
    }

    // -- Property-based tests -------------------------------------------------
    //
    // These use simple deterministic pseudo-random sampling (a linear
    // congruential generator) rather than pulling in the `proptest`/
    // `quickcheck` crates, since this workspace's Soroban contracts are
    // `#![no_std]` and those crates require `std`. Each test still checks the
    // required invariant across a broad, varied sample of inputs, generated
    // from a fixed seed for reproducibility.
    fn lcg_next(state: &mut u64) -> u64 {
        // Numerical Recipes LCG constants.
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *state
    }

    fn sample_amount(state: &mut u64) -> i128 {
        (lcg_next(state) % 1_000_000_000_000u64) as i128
    }

    #[test]
    fn prop_fee_of_zero_amount_is_always_zero() {
        let env = Env::default();
        let mut state = 42u64;
        for _ in 0..200 {
            let base_fee_rate = (lcg_next(&mut state) % 10_001) as i128;
            let min_fee = (lcg_next(&mut state) % 1_000_000) as i128;
            let max_fee = min_fee + (lcg_next(&mut state) % 1_000_000) as i128;
            let config = FeeConfig {
                base_fee_rate,
                min_fee,
                max_fee,
                fee_recipient: addr(&env),
            };
            let result = FeePrimitives::calculate_fee(&env, 0, config);
            assert_eq!(result.amount, 0);
        }
    }

    #[test]
    fn prop_fee_of_max_i128_never_overflows_and_is_clamped() {
        let env = Env::default();
        let mut state = 7u64;
        for _ in 0..200 {
            let base_fee_rate = 1 + (lcg_next(&mut state) % 10_000) as i128;
            let max_fee = (lcg_next(&mut state) % 1_000_000_000) as i128;
            let config = FeeConfig {
                base_fee_rate,
                min_fee: 0,
                max_fee,
                fee_recipient: addr(&env),
            };
            // Must not panic (would fail the test), and must clamp to max_fee.
            let result = FeePrimitives::calculate_fee(&env, i128::MAX, config);
            assert_eq!(result.amount, max_fee);
        }
    }

    #[test]
    fn prop_fee_plus_principal_never_overflows_for_bounded_amounts() {
        let env = Env::default();
        let mut state = 99u64;
        for _ in 0..200 {
            let amount = sample_amount(&mut state);
            let base_fee_rate = (lcg_next(&mut state) % 10_001) as i128;
            let max_fee = (lcg_next(&mut state) % 1_000_000_000) as i128;
            let config = FeeConfig {
                base_fee_rate,
                min_fee: 0,
                max_fee,
                fee_recipient: addr(&env),
            };
            let result = FeePrimitives::calculate_fee(&env, amount, config);
            // Fee never exceeds the principal...
            assert!(result.amount <= amount);
            // ...so amount + fee is always representable and well-formed.
            let total = amount + result.amount;
            assert!(total >= amount);
        }
    }

    #[test]
    fn prop_rounding_is_always_non_negative_and_favors_protocol() {
        let env = Env::default();
        let mut state = 1234u64;
        for _ in 0..200 {
            let amount = sample_amount(&mut state);
            let base_fee_rate = (lcg_next(&mut state) % 10_001) as i128;
            let max_fee = (lcg_next(&mut state) % 1_000_000_000) as i128;
            let config = FeeConfig {
                base_fee_rate,
                min_fee: 0,
                max_fee,
                fee_recipient: addr(&env),
            };
            let result = FeePrimitives::calculate_fee(&env, amount, config.clone());

            assert!(result.amount >= 0);

            // The fee must never be less than the exact (unrounded)
            // basis-point share, before min/max clamping is applied — i.e.
            // rounding never favors the payer over the protocol.
            if let Some(product) = amount.checked_mul(base_fee_rate) {
                let floor_fee = product / BASIS_POINTS_DENOMINATOR;
                let unclamped_ceiling_fee = if product % BASIS_POINTS_DENOMINATOR > 0 {
                    floor_fee + 1
                } else {
                    floor_fee
                };
                let expected = unclamped_ceiling_fee
                    .clamp(config.min_fee, config.max_fee)
                    .min(amount);
                assert_eq!(result.amount, expected);
                assert!(
                    result.amount >= floor_fee.min(amount).min(config.max_fee)
                        || result.amount == config.min_fee.min(amount)
                );
            }
        }
    }

    #[test]
    fn prop_fee_never_exceeds_principal() {
        let env = Env::default();
        let mut state = 555u64;
        for _ in 0..200 {
            let amount = sample_amount(&mut state);
            let base_fee_rate = (lcg_next(&mut state) % 10_001) as i128;
            let min_fee = (lcg_next(&mut state) % 1_000_000) as i128;
            let max_fee = min_fee + (lcg_next(&mut state) % 1_000_000) as i128;
            let config = FeeConfig {
                base_fee_rate,
                min_fee,
                max_fee,
                fee_recipient: addr(&env),
            };
            let result = FeePrimitives::calculate_fee(&env, amount, config);
            assert!(result.amount <= amount);
        }
    }
}

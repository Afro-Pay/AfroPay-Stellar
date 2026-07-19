#![no_std]
use soroban_sdk::{contract, contracttype, Address, Env, String};

/// Configuration for fee calculation
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub base_fee_rate: i128,        // Basis points (e.g., 100 = 1%)
    pub min_fee: i128,              // Minimum fee in smallest unit
    pub max_fee: i128,              // Maximum fee in smallest unit
    pub fee_recipient: Address,     // Address receiving fees
}

/// Currency conversion rate
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConversionRate {
    pub asset_a: String,            // Source asset identifier
    pub asset_b: String,            // Target asset identifier
    pub rate: i128,                 // Conversion rate (basis points)
    pub updated_at: u64,            // Timestamp
}

/// Fee calculation result
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeResult {
    pub amount: i128,               // Fee amount in source asset
    pub rate_used: i128,            // Fee rate applied
    pub converted_amount: Option<i128>, // Converted amount if conversion applied
}

#[contract]
pub struct FeePrimitives;

#[contractimpl]
impl FeePrimitives {
    /// Calculate fee based on amount and configuration
    pub fn calculate_fee(
        env: &Env,
        amount: i128,
        config: &FeeConfig,
    ) -> FeeResult {
        // Calculate fee using basis points
        let fee = amount * config.base_fee_rate / 10000;
        
        // Apply min/max boundaries
        let final_fee = if fee < config.min_fee {
            config.min_fee
        } else if fee > config.max_fee {
            config.max_fee
        } else {
            fee
        };
        
        FeeResult {
            amount: final_fee,
            rate_used: config.base_fee_rate,
            converted_amount: None,
        }
    }

    /// Convert amount from one asset to another
    pub fn convert_currency(
        env: &Env,
        amount: i128,
        from_asset: String,
        to_asset: String,
        rate: &ConversionRate,
    ) -> i128 {
        // Ensure the rate matches the assets
        if rate.asset_a != from_asset || rate.asset_b != to_asset {
            panic!("Asset mismatch in conversion rate");
        }
        
        // Apply conversion rate
        amount * rate.rate / 10000
    }

    /// Calculate fee with currency conversion
    pub fn calculate_fee_with_conversion(
        env: &Env,
        amount: i128,
        from_asset: String,
        to_asset: String,
        fee_config: &FeeConfig,
        conversion_rate: &ConversionRate,
    ) -> FeeResult {
        // First convert the amount
        let converted_amount = Self::convert_currency(
            env,
            amount,
            from_asset,
            to_asset,
            conversion_rate,
        );
        
        // Calculate fee on the converted amount
        let mut fee_result = Self::calculate_fee(env, converted_amount, fee_config);
        
        // Add conversion info
        fee_result.converted_amount = Some(converted_amount);
        
        fee_result
    }

    /// Store a conversion rate
    pub fn set_conversion_rate(
        env: &Env,
        asset_a: String,
        asset_b: String,
        rate: i128,
    ) {
        let conversion_rate = ConversionRate {
            asset_a: asset_a.clone(),
            asset_b: asset_b.clone(),
            rate,
            updated_at: env.ledger().timestamp(),
        };
        env.storage().set(&asset_a, &conversion_rate);
    }

    /// Get a conversion rate
    pub fn get_conversion_rate(
        env: &Env,
        asset_a: String,
    ) -> ConversionRate {
        env.storage().get(&asset_a).unwrap_or_else(|| {
            panic!("Conversion rate not found for asset")
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Env, String};

    #[test]
    fn test_calculate_fee() {
        let env = Env::default();
        let fee_config = FeeConfig {
            base_fee_rate: 100, // 1%
            min_fee: 0,
            max_fee: 1000,
            fee_recipient: Address::from_string(&String::from_str(&env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")),
        };

        let result = FeePrimitives::calculate_fee(&env, 1000, &fee_config);
        assert_eq!(result.amount, 10); // 1000 * 1% = 10
        assert_eq!(result.rate_used, 100);
    }

    #[test]
    fn test_currency_conversion() {
        let env = Env::default();
        let rate = ConversionRate {
            asset_a: String::from_str(&env, "USD"),
            asset_b: String::from_str(&env, "EUR"),
            rate: 85, // 1 USD = 0.85 EUR
            updated_at: 0,
        };

        let result = FeePrimitives::convert_currency(
            &env,
            100,
            String::from_str(&env, "USD"),
            String::from_str(&env, "EUR"),
            &rate,
        );
        assert_eq!(result, 85);
    }
}

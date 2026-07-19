#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, storage::Persistent as _},
    token, Address, Env, U256,
};

#[test]
fn version_returns_correct_version() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    
    assert_eq!(client.version(), VERSION);
}

#[test]
fn get_escrow_returns_none_for_nonexistent() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let non_existent_id = U256::from_u128(&env, 999);
    let result = client.get_escrow(&non_existent_id);
    assert!(result.is_none());
}

#[test]
fn deposit_rejects_non_positive_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let release_timestamp = 200;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.deposit(&depositor, &0, &asset, &recipient, &release_timestamp);
    }));
    assert!(result.is_err());
}

#[test]
fn deposit_rejects_past_release_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let release_timestamp = 50; // Past timestamp
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.deposit(&depositor, &1_000, &asset, &recipient, &release_timestamp);
    }));
    assert!(result.is_err());
}

#[test]
fn release_fails_for_nonexistent_escrow() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let non_existent_id = U256::from_u128(&env, 999);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.release(&non_existent_id);
    }));
    assert!(result.is_err());
}

#[test]
fn refund_fails_for_nonexistent_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let non_existent_id = U256::from_u128(&env, 999);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.refund(&non_existent_id);
    }));
    assert!(result.is_err());
}

#[test]
fn test_successful_deposit_and_release_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    // Register token contract
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = sac.address();
    let token_client = token::Client::new(&env, &token_id);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
    
    // Mint tokens to depositor
    token_admin_client.mint(&depositor, &1000);
    assert_eq!(token_client.balance(&depositor), 1000);

    // Register escrow contract
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let release_timestamp = 1000;
    
    // Deposit 400 tokens into escrow
    let escrow_id = client.deposit(&depositor, &400, &token_id, &recipient, &release_timestamp);
    
    // Verify balances
    assert_eq!(token_client.balance(&depositor), 600);
    assert_eq!(token_client.balance(&contract_id), 400);

    // Verify record state
    let record = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(record.depositor, depositor);
    assert_eq!(record.recipient, recipient);
    assert_eq!(record.amount, 400);
    assert_eq!(record.asset, token_id);
    assert_eq!(record.release_timestamp, release_timestamp);
    assert_eq!(record.is_released, false);
    assert_eq!(record.is_refunded, false);

    // Advance time past release_timestamp
    env.ledger().set_timestamp(1001);
    
    // Release
    client.release(&escrow_id);

    // Verify balances after release
    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Verify record is updated
    let updated_record = client.get_escrow(&escrow_id).unwrap();
    assert!(updated_record.is_released);
}

#[test]
fn test_successful_deposit_and_refund_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = sac.address();
    let token_client = token::Client::new(&env, &token_id);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
    
    token_admin_client.mint(&depositor, &1000);

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let release_timestamp = 1000;
    
    let escrow_id = client.deposit(&depositor, &400, &token_id, &recipient, &release_timestamp);
    
    // Refund (before release timestamp)
    client.refund(&escrow_id);

    // Verify balances restored
    assert_eq!(token_client.balance(&depositor), 1000);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Verify record is updated
    let updated_record = client.get_escrow(&escrow_id).unwrap();
    assert!(updated_record.is_refunded);
}

#[test]
fn test_persistent_storage_long_term_persistence() {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = sac.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id);
    
    token_admin_client.mint(&depositor, &1000);

    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    // Set initial ledger
    env.ledger().set_sequence_number(1);
    env.ledger().set_timestamp(1);

    let release_timestamp = 2_000_000; // far in the future
    let escrow_id = client.deposit(&depositor, &400, &token_id, &recipient, &release_timestamp);

    // Fetch initial TTL from persistent storage
    let initial_ttl = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Escrow(escrow_id.clone()))
    });

    // Verify it was set correctly (should be capped to max_entry_ttl, which is 6,312_000 in tests)
    assert!(initial_ttl > 6_000_000);

    // Advance time and sequence significantly (e.g. 500,000 ledgers / approx 1 month)
    let advance_ledgers = 500_000;
    env.ledger().set_sequence_number(1 + advance_ledgers);
    env.ledger().set_timestamp(1 + (advance_ledgers as u64) * 5); // 5 seconds per ledger

    // Escrow record should STILL exist and be accessible
    let record = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(record.amount, 400);

    // Retrieve TTL after sequence advancement
    let intermediate_ttl = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Escrow(escrow_id.clone()))
    });

    // TTL should have decreased by the advanced ledger count
    assert_eq!(intermediate_ttl, initial_ttl - advance_ledgers);

    // Advance timestamp beyond the release timestamp to perform a release
    env.ledger().set_timestamp(release_timestamp + 1);

    // Release the escrow, which should trigger an extend_ttl on the persistent key
    client.release(&escrow_id);

    // Retrieve final TTL after release
    let final_ttl = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Escrow(escrow_id.clone()))
    });

    // Verify the TTL was extended back to the full year (capped at 6,312_000 in tests)
    assert!(final_ttl > intermediate_ttl);
    assert!(final_ttl >= 6_300_000);
}

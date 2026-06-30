#![cfg(test)]

use super::*;
use soroban_sdk::{Address, Env, U256};

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

    env.ledger().set(100, 100, 100);

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

    env.ledger().set(100, 100, 100);

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

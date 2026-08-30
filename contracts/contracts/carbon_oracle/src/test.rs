#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env};

#[test]
fn price_update_requires_timelock_and_can_be_cancelled() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &100);
    let proposal_id = client.propose_price_update(&oracle, &125).unwrap();
    assert_eq!(client.get_price().unwrap(), 100);
    assert_eq!(client.get_pending_update().unwrap().executable_at, 1_000 + TIMELOCK_DELAY);

    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute_price_update(&proposal_id);
    }));
    assert!(early.is_err());
    assert_eq!(client.get_price().unwrap(), 100);

    client.emergency_cancel_proposed_update(&admin, &proposal_id);
    assert!(client.get_pending_update().is_none());
    assert_eq!(client.get_price().unwrap(), 100);
}

#[test]
fn price_update_takes_effect_after_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(10);

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &oracle, &100);
    let proposal_id = client.propose_price_update(&oracle, &150).unwrap();
    env.ledger().set_timestamp(10 + TIMELOCK_DELAY);
    assert_eq!(client.execute_price_update(&proposal_id).unwrap(), 150);
    assert_eq!(client.get_price().unwrap(), 150);
    assert!(client.get_pending_update().is_none());
}

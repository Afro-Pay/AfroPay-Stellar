#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn registers_and_reads_payment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin);
    assert_eq!(client.version(), VERSION);

    let payment_id = String::from_str(&env, "tx-abc-123");
    let registered = client.register_payment(&admin, &payment_id, &1_000_000, &recipient);
    assert!(registered);

    let record = client.get_payment(&payment_id).unwrap();
    assert_eq!(record.amount, 1_000_000);
    assert_eq!(record.recipient, recipient);
    assert!(record.registered);
    assert!(client.is_registered(&payment_id));
}

#[test]
fn rejects_duplicate_payment_id() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let payment_id = String::from_str(&env, "tx-dup");
    assert!(client.register_payment(&admin, &payment_id, &500, &recipient));
    assert!(!client.register_payment(&admin, &payment_id, &500, &recipient));
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn rejects_non_positive_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.register_payment(
        &admin,
        &String::from_str(&env, "tx-zero"),
        &0,
        &recipient,
    );
}

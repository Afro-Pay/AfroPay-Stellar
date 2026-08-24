#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

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
fn migrates_v1_payment_record_to_v2_layout() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let payment_id = String::from_str(&env, "legacy-payment");

    client.initialize(&admin);

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &1u32);
        env.storage().persistent().set(
            &DataKey::Payment(payment_id.clone()),
            &PaymentRecord {
                amount: 750,
                recipient: recipient.clone(),
                registered: true,
            },
        );
    });

    client.migrate(&admin, &Vec::from_array(&env, [payment_id.clone()]));

    let migrated = client.get_payment(&payment_id).unwrap();
    assert_eq!(migrated.amount, 750);
    assert_eq!(migrated.recipient, recipient);
    assert!(migrated.registered);
    assert!(env.as_contract(&contract_id, || {
        env.storage().persistent().has(&DataKey::PaymentV2(payment_id))
    }));
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

#[test]
fn stress_test_10000_payments() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Register 10,000 payments
    for i in 0..10000 {
        let payment_id = String::from_str(&env, &std::format!("payment-{}", i));
        let registered = client.register_payment(&admin, &payment_id, &(100_000 + i), &recipient);
        assert!(registered, "failed to register payment {}", i);

        if i % 1000 == 0 && i > 0 {
            // Periodically verify that earlier payments are still readable
            let earlier_id = String::from_str(&env, &std::format!("payment-{}", i - 500));
            let record = client.get_payment(&earlier_id).expect("earlier payment not found");
            assert_eq!(record.amount, 100_000 + (i - 500));
        }
    }

    // Verify all payments are readable
    for i in 0..10000 {
        let payment_id = String::from_str(&env, &std::format!("payment-{}", i));
        let record = client.get_payment(&payment_id).expect(&std::format!("payment {} not found", i));
        assert_eq!(record.amount, 100_000 + i);
        assert_eq!(record.recipient, recipient);
        assert!(record.registered);
        assert!(client.is_registered(&payment_id));
    }
}

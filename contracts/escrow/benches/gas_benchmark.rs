#![cfg(test)]
use soroban_sdk::{Env, Address, String, Vec, testutils::Address as _};
use escrow::contract::EscrowContract;

#[test]
fn benchmark_create_escrow() {
    let env = Env::default();
    let client = Address::random(&env);
    let agent = Address::random(&env);
    let arbitrator = Address::random(&env);
    let token = Address::random(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back((String::from_str(&env, "Milestone 1"), 1000));
    milestones.push_back((String::from_str(&env, "Milestone 2"), 2000));

    let start = env.ledger().sequence();
    let result = EscrowContract::create_escrow(
        env.clone(),
        client,
        agent,
        arbitrator,
        token,
        10000,
        milestones,
    );
    let end = env.ledger().sequence();

    println!("✅ create_escrow CPU instructions: {}", end - start);
    assert!(result.is_ok());
}

#[test]
fn benchmark_deposit_escrow() {
    let env = Env::default();
    let client = Address::random(&env);
    let agent = Address::random(&env);
    let arbitrator = Address::random(&env);
    let token = Address::random(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back((String::from_str(&env, "M1"), 1000));

    let escrow_id = EscrowContract::create_escrow(
        env.clone(),
        client.clone(),
        agent,
        arbitrator,
        token,
        10000,
        milestones,
    ).unwrap();

    let start = env.ledger().sequence();
    let result = EscrowContract::deposit_escrow(
        env.clone(),
        escrow_id,
        client,
        5000,
    );
    let end = env.ledger().sequence();

    println!("✅ deposit_escrow CPU instructions: {}", end - start);
    assert!(result.is_ok());
}

#[test]
fn benchmark_release_to_agent() {
    let env = Env::default();
    let client = Address::random(&env);
    let agent = Address::random(&env);
    let arbitrator = Address::random(&env);
    let token = Address::random(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back((String::from_str(&env, "M1"), 1000));

    let escrow_id = EscrowContract::create_escrow(
        env.clone(),
        client.clone(),
        agent.clone(),
        arbitrator,
        token,
        10000,
        milestones,
    ).unwrap();

    let start = env.ledger().sequence();
    let result = EscrowContract::release_to_agent(
        env.clone(),
        escrow_id,
        client,
    );
    let end = env.ledger().sequence();

    println!("✅ release_to_agent CPU instructions: {}", end - start);
    assert!(result.is_err());
}

#[test]
fn benchmark_claim_refund() {
    let env = Env::default();
    let client = Address::random(&env);
    let agent = Address::random(&env);
    let arbitrator = Address::random(&env);
    let token = Address::random(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back((String::from_str(&env, "M1"), 1000));

    let escrow_id = EscrowContract::create_escrow(
        env.clone(),
        client.clone(),
        agent,
        arbitrator,
        token,
        10000,
        milestones,
    ).unwrap();

    let start = env.ledger().sequence();
    let result = EscrowContract::claim_refund(
        env.clone(),
        escrow_id,
        client.clone(),
    );
    let end = env.ledger().sequence();

    println!("✅ claim_refund CPU instructions: {}", end - start);
    assert!(result.is_err());
}

#[test]
fn benchmark_get_escrow_info() {
    let env = Env::default();
    let client = Address::random(&env);
    let agent = Address::random(&env);
    let arbitrator = Address::random(&env);
    let token = Address::random(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back((String::from_str(&env, "M1"), 1000));

    let escrow_id = EscrowContract::create_escrow(
        env.clone(),
        client,
        agent,
        arbitrator,
        token,
        10000,
        milestones,
    ).unwrap();

    let start = env.ledger().sequence();
    let info = EscrowContract::get_escrow_info(env.clone(), escrow_id);
    let end = env.ledger().sequence();

    println!("✅ get_escrow_info CPU instructions: {}", end - start);
    assert!(info.is_some());
}

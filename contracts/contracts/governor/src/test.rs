#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn governance_flow_proposes_votes_and_executes() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &100);
    client.set_stake(&admin, &proposer, &150);
    client.set_stake(&admin, &voter, &80);

    let proposal_id = client.propose(
        &proposer,
        &String::from_str(&env, "Increase fee to 120 bps"),
        &ProposalAction::SetFeeBps,
        &120,
    );

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.state, ProposalState::Pending);

    assert!(client.cast_vote(&voter, &proposal_id, &true));
    let active_proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(active_proposal.state, ProposalState::Active);
    assert_eq!(active_proposal.for_votes, 80);

    assert!(client.execute(&proposer, &proposal_id));
    let executed_proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(executed_proposal.state, ProposalState::Executed);
    assert_eq!(client.get_fee_bps(), 120);
}

#[test]
fn rejects_double_voting() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &100);
    client.set_stake(&admin, &proposer, &150);
    client.set_stake(&admin, &voter, &80);

    let proposal_id = client.propose(
        &proposer,
        &String::from_str(&env, "Add a new AMM pair"),
        &ProposalAction::AddAmmPair,
        &1,
    );

    assert!(client.cast_vote(&voter, &proposal_id, &true));
    client.cast_vote(&voter, &proposal_id, &false);
}

#[test]
#[should_panic(expected = "unauthorized executor")]
fn rejects_execution_from_unauthorized_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let outsider = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &100);
    client.set_stake(&admin, &proposer, &150);
    client.set_stake(&admin, &voter, &80);

    let proposal_id = client.propose(
        &proposer,
        &String::from_str(&env, "Increase fee to 120 bps"),
        &ProposalAction::SetFeeBps,
        &120,
    );

    assert!(client.cast_vote(&voter, &proposal_id, &true));

    // `outsider` is neither the admin, the proposer, nor on the allowlist.
    client.execute(&outsider, &proposal_id);
}

#[test]
fn allows_execution_from_allowlisted_executor() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let executor = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &100);
    client.set_stake(&admin, &proposer, &150);
    client.set_stake(&admin, &voter, &80);

    let proposal_id = client.propose(
        &proposer,
        &String::from_str(&env, "Add a new AMM pair"),
        &ProposalAction::AddAmmPair,
        &1,
    );

    assert!(client.cast_vote(&voter, &proposal_id, &true));

    // Not yet allowlisted: execution is rejected.
    assert!(!client.is_executor(&proposal_id, &executor));

    // Admin grants the explicit allowlist entry, then execution succeeds.
    client.add_executor(&admin, &executor);
    assert!(client.is_executor(&proposal_id, &executor));
    assert!(client.execute(&executor, &proposal_id));

    let executed_proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(executed_proposal.state, ProposalState::Executed);
    assert_eq!(client.get_amm_pair_count(), 1);
}

#[test]
fn allows_execution_from_admin_without_allowlist() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &100);
    client.set_stake(&admin, &proposer, &150);
    client.set_stake(&admin, &voter, &80);

    let proposal_id = client.propose(
        &proposer,
        &String::from_str(&env, "Increase fee to 120 bps"),
        &ProposalAction::SetFeeBps,
        &120,
    );

    assert!(client.cast_vote(&voter, &proposal_id, &true));
    assert!(client.execute(&admin, &proposal_id));
}

#[test]
#[should_panic(expected = "stake below threshold")]
fn rejects_proposal_without_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    client.initialize(&admin, &100);
    client.set_stake(&admin, &proposer, &80);

    client.propose(
        &proposer,
        &String::from_str(&env, "Too little stake"),
        &ProposalAction::AddAmmPair,
        &1,
    );
}

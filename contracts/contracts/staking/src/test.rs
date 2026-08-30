#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String,
};

// ===========================================================================
// Mock SEP-41 Token
// ===========================================================================

#[contracttype]
#[derive(Clone)]
pub enum MockTokenDataKey {
    Admin,
    Balance(Address),
    Allowance(AllowanceKey),
    Decimals,
    Name,
    Symbol,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contract]
pub struct MockSep41Token;

#[contractimpl]
impl MockSep41Token {
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&MockTokenDataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&MockTokenDataKey::Admin, &admin);
        env.storage().instance().set(&MockTokenDataKey::Decimals, &decimal);
        env.storage().instance().set(&MockTokenDataKey::Name, &name);
        env.storage().instance().set(&MockTokenDataKey::Symbol, &symbol);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = MockTokenDataKey::Balance(to.clone());
        let current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current_balance + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        let key = MockTokenDataKey::Balance(id);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let from_key = MockTokenDataKey::Balance(from.clone());
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient balance");
        }
        env.storage().persistent().set(&from_key, &(from_bal - amount));

        let to_key = MockTokenDataKey::Balance(to.clone());
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage().persistent().set(&to_key, &(to_bal + amount));
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Decimals)
            .unwrap_or(7)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "Mock SEP-41 Token"))
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "MSEPT"))
    }
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/// Returns (env, contract_id, staking_client, token_id, token_client, admin, treasury, staker).
fn setup() -> (
    Env,
    soroban_sdk::Address,
    StakingContractClient<'static>,
    soroban_sdk::Address,
    token::Client<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let staker = Address::generate(&env);

    let token_id = env.register(MockSep41Token, ());
    let token_client = token::Client::new(&env, &token_id);
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    mock_client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "AfroPay USD"),
        &String::from_str(&env, "cUSD"),
    );

    mock_client.mint(&staker, &100_000_000);

    let contract_id = env.register(StakingContract, ());
    let staking_client = StakingContractClient::new(&env, &contract_id);

    staking_client.initialize(&admin);

    (
        env,
        contract_id,
        staking_client,
        token_id,
        token_client,
        admin,
        treasury,
        staker,
    )
}

fn create_default_pool(
    client: &StakingContractClient,
    admin: &Address,
    treasury: &Address,
    token_id: &Address,
    reward_rate: i128,
) -> u64 {
    client.create_pool(admin, token_id, treasury, &reward_rate)
}

fn two_stakers_setup() -> (
    Env,
    soroban_sdk::Address,
    StakingContractClient<'static>,
    soroban_sdk::Address,
    token::Client<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let staker1 = Address::generate(&env);
    let staker2 = Address::generate(&env);

    let token_id = env.register(MockSep41Token, ());
    let token_client = token::Client::new(&env, &token_id);
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    mock_client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "AfroPay USD"),
        &String::from_str(&env, "cUSD"),
    );

    mock_client.mint(&staker1, &100_000_000);
    mock_client.mint(&staker2, &100_000_000);

    let contract_id = env.register(StakingContract, ());
    let staking_client = StakingContractClient::new(&env, &contract_id);
    staking_client.initialize(&admin);

    (
        env,
        contract_id,
        staking_client,
        token_id,
        token_client,
        admin,
        treasury,
        staker1,
        staker2,
    )
}

// ===========================================================================
// Version
// ===========================================================================

#[test]
fn version_returns_correct_version() {
    let (_, _, client, _, _, _, _, _) = setup();
    assert_eq!(client.version(), VERSION);
}

// ===========================================================================
// Initialization
// ===========================================================================

#[test]
fn initialize_sets_admin() {
    let (_, _, client, _, _, _, _, _) = setup();
    assert_eq!(client.version(), VERSION);
}

#[test]
fn double_initialize_panics() {
    let (env, _, client, _, _, admin, _, _) = setup();
    let admin2 = Address::generate(&env);
    // setup() already called initialize; calling again should panic.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initialize(&admin2);
    }));
    assert!(result.is_err());
    let _ = admin;
}

// ===========================================================================
// Pool Creation
// ===========================================================================

#[test]
fn create_pool_returns_incrementing_ids() {
    let (env, _, client, token_id, _, admin, treasury, _) = setup();
    let id1 = create_default_pool(&client, &admin, &treasury, &token_id, 100);
    let id2 = create_default_pool(&client, &admin, &treasury, &token_id, 200);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    let _ = env;
}

#[test]
fn create_pool_stores_correct_info() {
    let (env, _, client, token_id, _, admin, treasury, _) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 500);
    let info = client.get_pool_info(&pool_id);
    assert_eq!(info.asset, token_id);
    assert_eq!(info.treasury, treasury);
    assert_eq!(info.reward_rate, 500);
    assert_eq!(info.total_staked, 0);
    assert_eq!(info.acc_reward_per_share, 0);
    assert!(info.is_active);
    let _ = env;
}

#[test]
fn create_pool_rejects_negative_reward_rate() {
    let (_, _, client, token_id, _, admin, treasury, _) = setup();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_pool(&admin, &token_id, &treasury, &-1);
    }));
    assert!(result.is_err());
}

#[test]
fn create_pool_rejects_non_admin() {
    let (_, _, client, token_id, _, _, treasury, staker) = setup();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_pool(&staker, &token_id, &treasury, &100);
    }));
    assert!(result.is_err());
}

#[test]
fn deactivate_pool_prevents_new_stakes() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 100);

    client.deactivate_pool(&admin, &pool_id);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let lock = MIN_LOCK_DURATION;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.stake(&staker, &pool_id, &1000, &lock);
    }));
    assert!(result.is_err());
}

#[test]
fn set_reward_rate_updates_rate() {
    let (env, _, client, token_id, _, admin, treasury, _) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 100);
    client.set_reward_rate(&admin, &pool_id, &999);
    let info = client.get_pool_info(&pool_id);
    assert_eq!(info.reward_rate, 999);
    let _ = env;
}

// ===========================================================================
// Staking
// ===========================================================================

#[test]
fn stake_transfers_tokens_to_contract() {
    let (env, contract_id, client, token_id, token_client, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let lock = MIN_LOCK_DURATION;
    client.stake(&staker, &pool_id, &5_000, &lock);

    assert_eq!(token_client.balance(&staker.clone()), 100_000_000 - 5_000);
    assert_eq!(token_client.balance(&contract_id), 5_000);

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.amount, 5_000);
    assert_eq!(view.lock_duration, lock);
    assert!(view.is_locked);
}

#[test]
fn stake_updates_pool_total_staked() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &10_000, &MIN_LOCK_DURATION);
    let info = client.get_pool_info(&pool_id);
    assert_eq!(info.total_staked, 10_000);
}

#[test]
fn stake_rejects_zero_amount() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);
    env.ledger().set_timestamp(100);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.stake(&staker, &pool_id, &0, &MIN_LOCK_DURATION);
    }));
    assert!(result.is_err());
}

#[test]
fn stake_rejects_too_short_lock() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);
    env.ledger().set_timestamp(100);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.stake(&staker, &pool_id, &1000, &60);
    }));
    assert!(result.is_err());
}

#[test]
fn stake_rejects_too_long_lock() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);
    env.ledger().set_timestamp(100);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.stake(&staker, &pool_id, &1000, &(MAX_LOCK_DURATION + 1));
    }));
    assert!(result.is_err());
}

#[test]
fn stake_adds_to_existing_position() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &3_000, &MIN_LOCK_DURATION);
    client.stake(&staker, &pool_id, &2_000, &MIN_LOCK_DURATION);

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.amount, 5_000);
}

// ===========================================================================
// Rewards
// ===========================================================================

#[test]
fn rewards_accrue_over_time() {
    let (env, contract_id, client, token_id, _, admin, treasury, staker) = setup();
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 1_000);

    // Fund the contract with reward tokens.
    mock_client.mint(&contract_id, &100_000_000);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    // Advance 100 seconds.
    env.ledger().set_timestamp(200);

    let pending = client.get_pending_rewards(&pool_id, &staker.clone());
    // reward = reward_rate * elapsed = 1_000 * 100 = 100_000
    assert_eq!(pending, 100_000);
}

#[test]
fn rewards_proportional_to_stake_share() {
    let (env, contract_id, client, token_id, _, admin, treasury, staker1, staker2) =
        two_stakers_setup();
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 1_000);

    mock_client.mint(&contract_id, &500_000_000);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    // staker1 stakes 30_000, staker2 stakes 10_000 → 75% / 25%
    client.stake(&staker1, &pool_id, &30_000, &(365 * 24 * 60 * 60));
    client.stake(&staker2, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    // Advance 100 seconds.
    env.ledger().set_timestamp(200);

    let p1 = client.get_pending_rewards(&pool_id, &staker1.clone());
    let p2 = client.get_pending_rewards(&pool_id, &staker2.clone());

    // 75% of 100_000 = 75_000, 25% = 25_000
    assert_eq!(p1, 75_000);
    assert_eq!(p2, 25_000);
}

#[test]
fn claim_rewards_transfers_and_resets_debt() {
    let (env, contract_id, client, token_id, token_client, admin, treasury, staker) = setup();
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 1_000);

    mock_client.mint(&contract_id, &100_000_000);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    env.ledger().set_timestamp(200);

    let balance_before = token_client.balance(&staker.clone());
    client.claim_rewards(&staker, &pool_id);
    let balance_after = token_client.balance(&staker.clone());

    assert_eq!(balance_after - balance_before, 100_000);

    // After claiming, pending should be 0.
    let pending = client.get_pending_rewards(&pool_id, &staker.clone());
    assert_eq!(pending, 0);
}

#[test]
fn claim_rewards_noop_when_no_pending() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    let pending = client.get_pending_rewards(&pool_id, &staker.clone());
    assert_eq!(pending, 0);
}

// ===========================================================================
// Withdrawal & Penalty
// ===========================================================================

#[test]
fn withdraw_after_lock_expires_no_penalty() {
    let (env, _contract_id, client, token_id, token_client, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let lock = 2 * MIN_LOCK_DURATION; // 2 days
    client.stake(&staker, &pool_id, &10_000, &lock);

    let balance_before = token_client.balance(&staker.clone());

    // Advance past the lock period.
    env.ledger().set_timestamp(100 + lock + 1);
    client.withdraw(&staker, &pool_id, &10_000);

    let balance_after = token_client.balance(&staker.clone());
    assert_eq!(balance_after - balance_before, 10_000);
}

#[test]
fn early_withdrawal_applies_10_percent_penalty() {
    let (env, _contract_id, client, token_id, token_client, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let lock = 365 * 24 * 60 * 60; // 1 year
    client.stake(&staker, &pool_id, &10_000, &lock);

    let staker_balance_before = token_client.balance(&staker.clone());
    let treasury_balance_before = token_client.balance(&treasury.clone());

    // Withdraw immediately (well before lock expires).
    env.ledger().set_timestamp(200);
    client.withdraw(&staker, &pool_id, &10_000);

    let staker_balance_after = token_client.balance(&staker.clone());
    let treasury_balance_after = token_client.balance(&treasury.clone());

    let expected_penalty = 1_000;
    let expected_net = 10_000 - expected_penalty;

    assert_eq!(staker_balance_after - staker_balance_before, expected_net);
    assert_eq!(treasury_balance_after - treasury_balance_before, expected_penalty);
}

#[test]
fn penalty_is_exactly_10_percent_for_various_amounts() {
    let test_cases: &[(i128, i128)] = &[
        (100, 10),
        (1_000, 100),
        (10_000, 1_000),
        (9_999, 1_000),
        (7, 1),
        (1, 1),
    ];

    for &(amount, expected_penalty) in test_cases {
        let penalty = super::StakingContract::calculate_penalty(amount);
        assert_eq!(
            penalty, expected_penalty,
            "penalty for amount {} should be {}, got {}",
            amount, expected_penalty, penalty
        );
    }
}

#[test]
fn withdraw_rejects_zero_amount() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &10_000, &MIN_LOCK_DURATION);

    let lock_end = 100 + MIN_LOCK_DURATION;
    env.ledger().set_timestamp(lock_end + 1);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.withdraw(&staker, &pool_id, &0);
    }));
    assert!(result.is_err());
}

#[test]
fn withdraw_rejects_over_withdrawal() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &10_000, &MIN_LOCK_DURATION);

    let lock_end = 100 + MIN_LOCK_DURATION;
    env.ledger().set_timestamp(lock_end + 1);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.withdraw(&staker, &pool_id, &20_000);
    }));
    assert!(result.is_err());
}

#[test]
fn partial_withdraw_reduces_stake() {
    let (env, _contract_id, client, token_id, _token_client, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    // Advance past lock.
    env.ledger().set_timestamp(100 + 365 * 24 * 60 * 60 + 1);

    client.withdraw(&staker, &pool_id, &4_000);

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.amount, 6_000);
}

#[test]
fn full_withdraw_removes_stake_entry() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    env.ledger().set_timestamp(100 + 365 * 24 * 60 * 60 + 1);
    client.withdraw(&staker, &pool_id, &10_000);

    let view = client.get_staker_info(&pool_id, &staker.clone());
    assert!(view.is_none());
}

#[test]
fn withdraw_claims_pending_rewards_automatically() {
    let (env, contract_id, client, token_id, token_client, admin, treasury, staker) = setup();
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 10);

    mock_client.mint(&contract_id, &100_000_000);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &10_000, &(MIN_LOCK_DURATION));

    // Advance past lock.
    env.ledger().set_timestamp(100 + MIN_LOCK_DURATION + 1);

    let balance_before = token_client.balance(&staker.clone());
    client.withdraw(&staker, &pool_id, &10_000);
    let balance_after = token_client.balance(&staker.clone());

    // Should receive at least the principal back (plus rewards).
    // reward = 10 * MIN_LOCK_DURATION = 864_000
    assert!(balance_after > balance_before);
}

// ===========================================================================
// Multi-Staker Full Lifecycle
// ===========================================================================

#[test]
fn multi_staker_full_lifecycle() {
    let (env, contract_id, client, token_id, token_client, admin, treasury, staker1, staker2) =
        two_stakers_setup();
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 1_000);

    mock_client.mint(&contract_id, &500_000_000);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker1, &pool_id, &30_000, &(365 * 24 * 60 * 60));
    client.stake(&staker2, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    // Advance 200 seconds.
    env.ledger().set_timestamp(300);

    let p1 = client.get_pending_rewards(&pool_id, &staker1.clone());
    let p2 = client.get_pending_rewards(&pool_id, &staker2.clone());
    assert_eq!(p1, 150_000);
    assert_eq!(p2, 50_000);

    // Claim staker1's rewards.
    let bal1_before = token_client.balance(&staker1.clone());
    client.claim_rewards(&staker1, &pool_id);
    let bal1_after = token_client.balance(&staker1.clone());
    assert_eq!(bal1_after - bal1_before, 150_000);

    // Pending is now 0.
    let p1_after_claim = client.get_pending_rewards(&pool_id, &staker1.clone());
    assert_eq!(p1_after_claim, 0);

    // Staker2 still has pending.
    let p2_still = client.get_pending_rewards(&pool_id, &staker2.clone());
    assert_eq!(p2_still, 50_000);
}

// ===========================================================================
// Fixed-Point Math Precision
// ===========================================================================

#[test]
fn fixed_point_precision_is_7_decimal_places() {
    assert_eq!(FIXED_POINT_PRECISION, 10_000_000);
}

#[test]
fn yield_calculation_precision_small_amounts() {
    let pending = super::StakingContract::calculate_pending_reward(1, 0, 30_000_000);
    assert_eq!(pending, 3);
}

#[test]
fn yield_calculation_precision_fractions() {
    let pending = super::StakingContract::calculate_pending_reward(3, 0, 10_000_003);
    assert_eq!(pending, 3);

    let pending2 = super::StakingContract::calculate_pending_reward(1000, 0, 10_000_000);
    assert_eq!(pending2, 1000);
}

#[test]
fn yield_calculation_large_numbers_no_overflow() {
    let amount: i128 = 1_000_000_000;
    let acc: i128 = 10_000_000 * 100;
    let debt: i128 = 0;
    let pending = super::StakingContract::calculate_pending_reward(amount, debt, acc);
    assert_eq!(pending, 100_000_000_000);
}

#[test]
fn yield_no_negative_pending() {
    let pending = super::StakingContract::calculate_pending_reward(100, 999, 100);
    assert_eq!(pending, 0);
}

// ===========================================================================
// View Functions
// ===========================================================================

#[test]
fn get_pool_info_rejects_nonexistent_pool() {
    let (_, _, client, _, _, _, _, _) = setup();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_pool_info(&999);
    }));
    assert!(result.is_err());
}

#[test]
fn get_staker_info_returns_none_for_nonexistent() {
    let (_, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);
    let result = client.get_staker_info(&pool_id, &staker.clone());
    assert!(result.is_none());
}

#[test]
fn staker_view_shows_lock_end_and_is_locked() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let lock = 86400;
    client.stake(&staker, &pool_id, &5_000, &lock);

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.lock_start, 100);
    assert_eq!(view.lock_duration, lock);
    assert_eq!(view.lock_end, 100 + lock);
    assert!(view.is_locked);

    env.ledger().set_timestamp(100 + lock + 1);
    let view2 = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert!(!view2.is_locked);
}

// ===========================================================================
// Edge Cases & Security
// ===========================================================================

#[test]
fn stake_on_empty_pool_has_zero_pending() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &1000, &MIN_LOCK_DURATION);

    let pending = client.get_pending_rewards(&pool_id, &staker.clone());
    assert_eq!(pending, 0);
}

#[test]
fn multiple_pools_are_independent() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();

    let pool1 = create_default_pool(&client, &admin, &treasury, &token_id, 100);
    let pool2 = create_default_pool(&client, &admin, &treasury, &token_id, 200);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool1, &10_000, &(365 * 24 * 60 * 60));
    client.stake(&staker, &pool2, &10_000, &(365 * 24 * 60 * 60));

    env.ledger().set_timestamp(200);

    let p1 = client.get_pending_rewards(&pool1, &staker.clone());
    let p2 = client.get_pending_rewards(&pool2, &staker.clone());

    assert_eq!(p1, 10_000);
    assert_eq!(p2, 20_000);
}

#[test]
fn stake_withdrawable_after_second_stake_lock_period() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    // First stake: 1 day lock.
    client.stake(&staker, &pool_id, &5_000, &MIN_LOCK_DURATION);

    // 12 hours later, add more with 7-day lock.
    env.ledger().set_timestamp(100 + MIN_LOCK_DURATION / 2);
    client.stake(&staker, &pool_id, &3_000, &(7 * MIN_LOCK_DURATION));

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.lock_duration, 7 * MIN_LOCK_DURATION);
    assert!(view.is_locked);
}

#[test]
fn get_pending_rewards_zero_for_unknown_staker() {
    let (env, _, client, token_id, _, admin, treasury, _) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 100);
    let unknown = Address::generate(&env);
    let pending = client.get_pending_rewards(&pool_id, &unknown);
    assert_eq!(pending, 0);
}

// ===========================================================================
// Re-entrancy Safety
// ===========================================================================

#[test]
fn re_entrancy_safety_stake_claim_withdraw_sequence() {
    let (env, contract_id, client, token_id, _, admin, treasury, staker) = setup();
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 10);

    mock_client.mint(&contract_id, &100_000_000);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    // Stake with a short lock.
    client.stake(&staker, &pool_id, &10_000, &(MIN_LOCK_DURATION));

    // Advance 200 seconds to accrue rewards.
    env.ledger().set_timestamp(300);

    // Claim rewards (10 * 200 = 2_000).
    client.claim_rewards(&staker, &pool_id);

    // Advance past lock.
    env.ledger().set_timestamp(100 + MIN_LOCK_DURATION + 1);

    // Withdraw all.
    client.withdraw(&staker, &pool_id, &10_000);

    // Verify no remaining stake.
    let view = client.get_staker_info(&pool_id, &staker.clone());
    assert!(view.is_none());
}

// ===========================================================================
// Min / Max Lock Durations
// ===========================================================================

#[test]
fn stake_with_exact_min_lock_duration() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &1000, &MIN_LOCK_DURATION);

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.lock_duration, MIN_LOCK_DURATION);
}

#[test]
fn stake_with_exact_max_lock_duration() {
    let (env, _, client, token_id, _, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_timestamp(100);
    client.stake(&staker, &pool_id, &1000, &MAX_LOCK_DURATION);

    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.lock_duration, MAX_LOCK_DURATION);
}

// ===========================================================================
// Early Withdrawal Partial Amount
// ===========================================================================

#[test]
fn early_withdrawal_partial_amount_penalty_applied() {
    let (env, _contract_id, client, token_id, token_client, admin, treasury, staker) = setup();
    let pool_id = create_default_pool(&client, &admin, &treasury, &token_id, 0);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    client.stake(&staker, &pool_id, &10_000, &(365 * 24 * 60 * 60));

    let staker_before = token_client.balance(&staker.clone());
    let treasury_before = token_client.balance(&treasury.clone());

    // Early withdrawal of half.
    env.ledger().set_timestamp(200);
    client.withdraw(&staker, &pool_id, &4_000);

    let staker_after = token_client.balance(&staker.clone());
    let treasury_after = token_client.balance(&treasury.clone());

    // 10% of 4_000 = 400 penalty
    let expected_penalty = 400;
    let expected_net = 4_000 - expected_penalty;

    assert_eq!(staker_after - staker_before, expected_net);
    assert_eq!(treasury_after - treasury_before, expected_penalty);

    // Remaining stake is 6_000.
    let view = client.get_staker_info(&pool_id, &staker.clone()).unwrap();
    assert_eq!(view.amount, 6_000);
}

// ===========================================================================
// Migration
// ===========================================================================

#[test]
fn migrate_updates_storage_version() {
    let (_, _, client, _, _, admin, _, _) = setup();
    assert_eq!(client.version(), VERSION);
    // Migrate should succeed for admin.
    client.migrate(&admin);
}

#[test]
fn migrate_rejects_non_admin() {
    let (_, _, client, _, _, _, _, staker) = setup();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.migrate(&staker);
    }));
    assert!(result.is_err());
}

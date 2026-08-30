#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, storage::Persistent as _},
    token, Address, Env, String, U256,
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

#[test]
fn test_boundary_condition_exact_timestamp_release_succeeds() {
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

    let release_timestamp = 200;
    let escrow_id = client.deposit(&depositor, &400, &token_id, &recipient, &release_timestamp);

    // Advance to exact release_timestamp boundary (timestamp == release_timestamp)
    env.ledger().set_sequence_number(200);
    env.ledger().set_timestamp(release_timestamp);

    // Verify release succeeds at exact timestamp boundary
    // The release check is: if current_ledger_time < release_timestamp, panic
    // So at current_ledger_time == release_timestamp, it should succeed
    client.release(&escrow_id);

    // Verify recipient received funds
    assert_eq!(token_client.balance(&recipient), 400);
    assert_eq!(token_client.balance(&contract_id), 0);

    // Verify record is marked as released
    let updated_record = client.get_escrow(&escrow_id).unwrap();
    assert!(updated_record.is_released);
}

#[test]
fn test_boundary_condition_exact_timestamp_refund_fails() {
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

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let release_timestamp = 200;
    let escrow_id = client.deposit(&depositor, &400, &token_id, &recipient, &release_timestamp);

    // Advance to exact release_timestamp boundary (timestamp == release_timestamp)
    env.ledger().set_sequence_number(200);
    env.ledger().set_timestamp(release_timestamp);

    // Verify refund fails at exact timestamp boundary
    // The refund check is: if current_ledger_time >= release_timestamp, panic
    // So at current_ledger_time == release_timestamp, it should panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.refund(&escrow_id);
    }));
    assert!(result.is_err(), "refund should panic at exact timestamp boundary");

    // Verify funds still in contract (not refunded)
    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&contract_id), 400);
}

// ===========================================================================
// SEP-41 Mock Token Contract Implementation
// Conforms to the full Soroban Token Interface Specification (SEP-41)
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
    /// Initialize token metadata and admin.
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

    /// Mint tokens to an account (test helper).
    pub fn mint(env: Env, to: Address, amount: i128) {
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let key = MockTokenDataKey::Balance(to.clone());
        let current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current_balance + amount));
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 1: allowance
    // -----------------------------------------------------------------------
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = MockTokenDataKey::Allowance(AllowanceKey { from, spender });
        let allowance_val: Option<AllowanceValue> = env.storage().persistent().get(&key);
        match allowance_val {
            Some(val) => {
                if env.ledger().sequence() <= val.live_until_ledger {
                    val.amount
                } else {
                    0
                }
            }
            None => 0,
        }
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 2: approve
    // -----------------------------------------------------------------------
    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let key = MockTokenDataKey::Allowance(AllowanceKey { from, spender });
        let val = AllowanceValue {
            amount,
            live_until_ledger: expiration_ledger,
        };
        env.storage().persistent().set(&key, &val);
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 3: balance
    // -----------------------------------------------------------------------
    pub fn balance(env: Env, id: Address) -> i128 {
        let key = MockTokenDataKey::Balance(id);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 4: transfer
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // SEP-41 Method 5: transfer_from
    // -----------------------------------------------------------------------
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let allow_key = MockTokenDataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let allowance_val: AllowanceValue = env
            .storage()
            .persistent()
            .get(&allow_key)
            .expect("no allowance");

        if env.ledger().sequence() > allowance_val.live_until_ledger {
            panic!("allowance expired");
        }
        if allowance_val.amount < amount {
            panic!("insufficient allowance");
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

        env.storage().persistent().set(
            &allow_key,
            &AllowanceValue {
                amount: allowance_val.amount - amount,
                live_until_ledger: allowance_val.live_until_ledger,
            },
        );
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 6: burn
    // -----------------------------------------------------------------------
    pub fn burn(env: Env, from: Address, amount: i128) {
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
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 7: burn_from
    // -----------------------------------------------------------------------
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let allow_key = MockTokenDataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let allowance_val: AllowanceValue = env
            .storage()
            .persistent()
            .get(&allow_key)
            .expect("no allowance");

        if env.ledger().sequence() > allowance_val.live_until_ledger {
            panic!("allowance expired");
        }
        if allowance_val.amount < amount {
            panic!("insufficient allowance");
        }

        let from_key = MockTokenDataKey::Balance(from.clone());
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient balance");
        }
        env.storage().persistent().set(&from_key, &(from_bal - amount));

        env.storage().persistent().set(
            &allow_key,
            &AllowanceValue {
                amount: allowance_val.amount - amount,
                live_until_ledger: allowance_val.live_until_ledger,
            },
        );
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 8: decimals
    // -----------------------------------------------------------------------
    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Decimals)
            .unwrap_or(7)
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 9: name
    // -----------------------------------------------------------------------
    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Name)
            .unwrap_or_else(|| String::from_str(&env, "Mock SEP-41 Token"))
    }

    // -----------------------------------------------------------------------
    // SEP-41 Method 10: symbol
    // -----------------------------------------------------------------------
    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Symbol)
            .unwrap_or_else(|| String::from_str(&env, "MSEPT"))
    }
}

// ===========================================================================
// SEP-41 Compliance Tests for Escrow Contract
// ===========================================================================

#[test]
fn test_escrow_deposit_and_release_with_mock_sep41_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Register Mock SEP-41 token
    let token_id = env.register(MockSep41Token, ());
    let mock_token_client = MockSep41TokenClient::new(&env, &token_id);
    let standard_token_client = token::Client::new(&env, &token_id);

    // Initialize mock token metadata
    mock_token_client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "AfroPay Mock USD"),
        &String::from_str(&env, "cUSD"),
    );

    // Verify metadata conforming to SEP-41
    assert_eq!(standard_token_client.decimals(), 7);
    assert_eq!(standard_token_client.name(), String::from_str(&env, "AfroPay Mock USD"));
    assert_eq!(standard_token_client.symbol(), String::from_str(&env, "cUSD"));

    // Mint tokens to depositor
    mock_token_client.mint(&depositor, &5_000);
    assert_eq!(standard_token_client.balance(&depositor), 5_000);

    // Register Escrow contract
    let escrow_contract_id = env.register(Contract, ());
    let escrow_client = ContractClient::new(&env, &escrow_contract_id);

    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(100);

    let release_timestamp = 500;
    let deposit_amount = 1_500;

    // Execute deposit into escrow using SEP-41 mock token
    let escrow_id = escrow_client.deposit(
        &depositor,
        &deposit_amount,
        &token_id,
        &recipient,
        &release_timestamp,
    );

    // Verify token balances post-deposit
    assert_eq!(standard_token_client.balance(&depositor), 3_500);
    assert_eq!(standard_token_client.balance(&escrow_contract_id), 1_500);

    // Verify escrow state
    let record = escrow_client.get_escrow(&escrow_id).unwrap();
    assert_eq!(record.depositor, depositor);
    assert_eq!(record.recipient, recipient);
    assert_eq!(record.amount, deposit_amount);
    assert_eq!(record.asset, token_id);
    assert_eq!(record.is_released, false);
    assert_eq!(record.is_refunded, false);

    // Advance time past release timestamp
    env.ledger().set_timestamp(release_timestamp + 1);

    // Release escrow
    escrow_client.release(&escrow_id);

    // Verify balances after release
    assert_eq!(standard_token_client.balance(&recipient), 1_500);
    assert_eq!(standard_token_client.balance(&escrow_contract_id), 0);

    // Verify record state
    let final_record = escrow_client.get_escrow(&escrow_id).unwrap();
    assert!(final_record.is_released);
    assert!(!final_record.is_refunded);
}

#[test]
fn test_escrow_deposit_and_refund_with_mock_sep41_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Register Mock SEP-41 token
    let token_id = env.register(MockSep41Token, ());
    let mock_token_client = MockSep41TokenClient::new(&env, &token_id);
    let standard_token_client = token::Client::new(&env, &token_id);

    mock_token_client.initialize(
        &admin,
        &6,
        &String::from_str(&env, "AfroPay Mock NGN"),
        &String::from_str(&env, "cNGN"),
    );

    mock_token_client.mint(&depositor, &10_000);
    assert_eq!(standard_token_client.balance(&depositor), 10_000);

    // Register Escrow contract
    let escrow_contract_id = env.register(Contract, ());
    let escrow_client = ContractClient::new(&env, &escrow_contract_id);

    env.ledger().set_sequence_number(200);
    env.ledger().set_timestamp(200);

    let release_timestamp = 800;
    let deposit_amount = 4_000;

    // Execute deposit
    let escrow_id = escrow_client.deposit(
        &depositor,
        &deposit_amount,
        &token_id,
        &recipient,
        &release_timestamp,
    );

    // Check balances
    assert_eq!(standard_token_client.balance(&depositor), 6_000);
    assert_eq!(standard_token_client.balance(&escrow_contract_id), 4_000);

    // Refund before release timestamp
    env.ledger().set_timestamp(500);
    escrow_client.refund(&escrow_id);

    // Verify balances restored to depositor
    assert_eq!(standard_token_client.balance(&depositor), 10_000);
    assert_eq!(standard_token_client.balance(&escrow_contract_id), 0);
    assert_eq!(standard_token_client.balance(&recipient), 0);

    // Verify record state
    let record = escrow_client.get_escrow(&escrow_id).unwrap();
    assert!(!record.is_released);
    assert!(record.is_refunded);
}

#[test]
fn test_sep41_mock_token_full_interface_conformance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let token_id = env.register(MockSep41Token, ());
    let mock_client = MockSep41TokenClient::new(&env, &token_id);
    let client = token::Client::new(&env, &token_id);

    // 1. initialize & metadata methods (decimals, name, symbol)
    mock_client.initialize(
        &admin,
        &18,
        &String::from_str(&env, "Full Conformance Token"),
        &String::from_str(&env, "FCT"),
    );
    assert_eq!(client.decimals(), 18);
    assert_eq!(client.name(), String::from_str(&env, "Full Conformance Token"));
    assert_eq!(client.symbol(), String::from_str(&env, "FCT"));

    // 2. mint & balance
    mock_client.mint(&owner, &1_000);
    assert_eq!(client.balance(&owner), 1_000);
    assert_eq!(client.balance(&receiver), 0);

    // 3. transfer
    client.transfer(&owner, &receiver, &300);
    assert_eq!(client.balance(&owner), 700);
    assert_eq!(client.balance(&receiver), 300);

    // 4. approve & allowance
    env.ledger().set_sequence_number(100);
    client.approve(&owner, &spender, &400, &200);
    assert_eq!(client.allowance(&owner, &spender), 400);

    // 5. transfer_from using allowance
    client.transfer_from(&spender, &owner, &receiver, &250);
    assert_eq!(client.balance(&owner), 450);
    assert_eq!(client.balance(&receiver), 550);
    assert_eq!(client.allowance(&owner, &spender), 150);

    // 6. burn
    client.burn(&receiver, &50);
    assert_eq!(client.balance(&receiver), 500);

    // 7. burn_from
    client.burn_from(&spender, &owner, &100);
    assert_eq!(client.balance(&owner), 350);
    assert_eq!(client.allowance(&owner, &spender), 50);

    // 8. allowance expiration
    env.ledger().set_sequence_number(201); // past expiration ledger 200
    assert_eq!(client.allowance(&owner, &spender), 0);
}


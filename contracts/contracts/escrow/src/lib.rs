#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, U256,
};

pub const VERSION: u32 = 2;
pub const STORAGE_VERSION: u32 = 2;
pub const MIN_TWAP_SAMPLES: u64 = 10;
pub const MAX_TWAP_DEVIATION_BPS: i128 = 500; // 5%
pub const MIN_LEDGER_GAP: u64 = 2;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceFeedState {
    pub last_price: i128,
    pub twap: i128,
    pub cumulative_price: i128,
    pub sample_count: u64,
    pub last_ledger: u64,
    pub is_suspended: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    EscrowCounter,
    Escrow(U256),
    Admin,
    StorageVersion,
    PriceFeed,
    UserActionLedger(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    pub depositor: Address,
    pub recipient: Address,
    pub amount: i128,
    pub asset: Address,
    pub release_timestamp: u64,
    pub created_at: u64,
    pub is_released: bool,
    pub is_refunded: bool,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    fn validate_price_guard(env: &Env) {
        let price_feed: Option<PriceFeedState> = env.storage().persistent().get(&DataKey::PriceFeed);

        if let Some(feed) = price_feed {
            if feed.is_suspended {
                panic!("price feed suspended: TWAP drift exceeds 5% threshold");
            }

            if feed.sample_count >= MIN_TWAP_SAMPLES && feed.twap > 0 {
                let deviation_bps = ((feed.last_price - feed.twap).abs() * 10_000) / feed.twap;
                if deviation_bps > MAX_TWAP_DEVIATION_BPS {
                    panic!("price feed deviates beyond slippage limits");
                }
            }
        }
    }

    fn enforce_user_block_delay(env: &Env, user: &Address) {
        let current_ledger = env.ledger().sequence();
        let last_action_ledger: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::UserActionLedger(user.clone()));

        if let Some(last_ledger) = last_action_ledger {
            if current_ledger <= last_ledger + MIN_LEDGER_GAP - 1 {
                panic!("flash-loan guard blocked: same-ledger or consecutive-ledger replay");
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::UserActionLedger(user.clone()), &current_ledger);
    }

    pub fn update_price(env: Env, spot_price: i128) -> i128 {
        if spot_price <= 0 {
            panic!("spot price must be positive");
        }

        let current_ledger = env.ledger().sequence();
        let mut feed: PriceFeedState = env
            .storage()
            .persistent()
            .get(&DataKey::PriceFeed)
            .unwrap_or(PriceFeedState {
                last_price: spot_price,
                twap: spot_price,
                cumulative_price: spot_price,
                sample_count: 0,
                last_ledger: 0,
                is_suspended: false,
            });

        if feed.last_ledger != 0 && current_ledger <= feed.last_ledger {
            panic!("price update attempted in the same ledger block");
        }

        feed.cumulative_price += spot_price;
        feed.sample_count += 1;
        feed.last_price = spot_price;

        if feed.sample_count >= MIN_TWAP_SAMPLES as u64 {
            let samples = feed.sample_count as i128;
            feed.twap = feed.cumulative_price / samples;
            let deviation_bps = ((feed.last_price - feed.twap).abs() * 10_000) / feed.twap;
            if deviation_bps > MAX_TWAP_DEVIATION_BPS {
                feed.is_suspended = true;
            }
        } else {
            feed.twap = feed.cumulative_price / feed.sample_count as i128;
        }

        feed.last_ledger = current_ledger;
        env.storage().persistent().set(&DataKey::PriceFeed, &feed);
        feed.twap
    }

    pub fn update_price_feed(env: Env, spot_price: i128) -> i128 {
        Self::update_price(env, spot_price)
    }

    pub fn record_price(env: Env, spot_price: i128) -> i128 {
        Self::update_price(env, spot_price)
    }

    pub fn price_guard_status(env: Env) -> bool {
        let feed: Option<PriceFeedState> = env.storage().persistent().get(&DataKey::PriceFeed);
        match feed {
            Some(feed) => !feed.is_suspended,
            None => true,
        }
    }

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("contract already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION);
    }

    pub fn migrate(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized");
        if admin != stored_admin {
            panic!("unauthorized admin");
        }

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(1);
        if current_version > STORAGE_VERSION {
            panic!("storage version is newer than this contract");
        }
        if current_version < STORAGE_VERSION {
            env.storage()
                .instance()
                .set(&DataKey::StorageVersion, &STORAGE_VERSION);
        }
    }

    /// Deposit funds into escrow.
    /// 
    /// # Arguments
    /// * `from` - The address depositing the funds
    /// * `amount` - The amount to deposit (must be positive)
    /// * `asset` - The asset contract address
    /// * `recipient` - The address that will receive the funds upon release
    /// * `release_timestamp` - The Unix timestamp when funds can be released
    /// 
    /// # Returns
    /// The unique escrow ID
    pub fn deposit(
        env: Env,
        from: Address,
        amount: i128,
        asset: Address,
        recipient: Address,
        release_timestamp: u64,
    ) -> U256 {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        Self::validate_price_guard(&env);
        Self::enforce_user_block_delay(&env, &from);

        let current_ledger_time = env.ledger().timestamp();
        if release_timestamp <= current_ledger_time {
            panic!("release_timestamp must be in the future");
        }

        // Transfer tokens from depositor to contract
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Generate escrow ID
        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::EscrowCounter, &counter);

        let escrow_id = U256::from_u128(&env, counter as u128);

        // Create escrow record
        let record = EscrowRecord {
            depositor: from.clone(),
            recipient: recipient.clone(),
            amount,
            asset: asset.clone(),
            release_timestamp,
            created_at: current_ledger_time,
            is_released: false,
            is_refunded: false,
        };

        let escrow_key = DataKey::Escrow(escrow_id.clone());

        // Store escrow record in persistent storage
        env.storage()
            .persistent()
            .set(&escrow_key, &record);

        // Set storage TTL to 1 year
        let one_year_ledgers = 31_536_000; // Approximate seconds in a year

        // Extend persistent key TTL
        env.storage()
            .persistent()
            .extend_ttl(&escrow_key, one_year_ledgers, one_year_ledgers);

        // Extend instance TTL
        env.storage()
            .instance()
            .extend_ttl(one_year_ledgers, one_year_ledgers);

        escrow_id
    }

    /// Release funds from escrow to the recipient.
    /// 
    /// # Arguments
    /// * `escrow_id` - The unique escrow ID
    /// 
    /// # Requirements
    /// * The release_timestamp must have passed
    /// * The escrow must not have been released or refunded already
    pub fn release(env: Env, escrow_id: U256) {
        let escrow_key = DataKey::Escrow(escrow_id.clone());
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .expect("escrow not found");

        if record.is_released {
            panic!("escrow already released");
        }

        if record.is_refunded {
            panic!("escrow already refunded");
        }

        Self::validate_price_guard(&env);
        Self::enforce_user_block_delay(&env, &record.depositor);

        let current_ledger_time = env.ledger().timestamp();
        if current_ledger_time < record.release_timestamp {
            panic!("release timestamp not reached");
        }

        // Transfer tokens from contract to recipient
        let token_client = token::Client::new(&env, &record.asset);
        token_client.transfer(
            &env.current_contract_address(),
            &record.recipient,
            &record.amount,
        );

        // Update record
        record.is_released = true;

        // Extend persistent key TTL before update
        let one_year_ledgers = 31_536_000;
        env.storage()
            .persistent()
            .extend_ttl(&escrow_key, one_year_ledgers, one_year_ledgers);

        env.storage().persistent().set(&escrow_key, &record);
    }

    /// Refund funds from escrow back to the depositor.
    /// 
    /// # Arguments
    /// * `escrow_id` - The unique escrow ID
    /// 
    /// # Requirements
    /// * Only the depositor can request a refund
    /// * The escrow must not have been released or refunded already
    /// * The release_timestamp must not have passed (or be within a reasonable grace period)
    pub fn refund(env: Env, escrow_id: U256) {
        let escrow_key = DataKey::Escrow(escrow_id.clone());
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .expect("escrow not found");

        record.depositor.require_auth();

        if record.is_released {
            panic!("escrow already released");
        }

        if record.is_refunded {
            panic!("escrow already refunded");
        }

        // Allow refund only if release timestamp hasn't passed
        let current_ledger_time = env.ledger().timestamp();
        if current_ledger_time >= record.release_timestamp {
            panic!("cannot refund after release timestamp");
        }

        // Transfer tokens from contract back to depositor
        let token_client = token::Client::new(&env, &record.asset);
        token_client.transfer(
            &env.current_contract_address(),
            &record.depositor,
            &record.amount,
        );

        // Update record
        record.is_refunded = true;

        // Extend persistent key TTL before update
        let one_year_ledgers = 31_536_000;
        env.storage()
            .persistent()
            .extend_ttl(&escrow_key, one_year_ledgers, one_year_ledgers);

        env.storage().persistent().set(&escrow_key, &record);
    }

    /// Get the escrow record by ID.
    /// 
    /// # Arguments
    /// * `escrow_id` - The unique escrow ID
    /// 
    /// # Returns
    /// The escrow record if it exists, None otherwise
    pub fn get_escrow(env: Env, escrow_id: U256) -> Option<EscrowRecord> {
        env.storage().persistent().get(&DataKey::Escrow(escrow_id))
    }

    /// Contract version for deployment validation.
    pub fn version() -> u32 {
        VERSION
    }
}

mod test;

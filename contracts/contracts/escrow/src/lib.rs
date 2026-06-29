#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, U256,
};

pub const VERSION: u32 = 1;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    EscrowCounter,
    Escrow(U256),
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

        // Store escrow record with lifetime
        env.storage()
            .instance()
            .set(&DataKey::Escrow(escrow_id.clone()), &record);

        // Set storage TTL to 1 year
        let one_year_ledgers = 31_536_000; // Approximate seconds in a year
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
        let mut record: EscrowRecord = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(escrow_id.clone()))
            .expect("escrow not found");

        if record.is_released {
            panic!("escrow already released");
        }

        if record.is_refunded {
            panic!("escrow already refunded");
        }

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
        env.storage().instance().set(&DataKey::Escrow(escrow_id), &record);
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
        let mut record: EscrowRecord = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(escrow_id.clone()))
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
        env.storage().instance().set(&DataKey::Escrow(escrow_id), &record);
    }

    /// Get the escrow record by ID.
    /// 
    /// # Arguments
    /// * `escrow_id` - The unique escrow ID
    /// 
    /// # Returns
    /// The escrow record if it exists, None otherwise
    pub fn get_escrow(env: Env, escrow_id: U256) -> Option<EscrowRecord> {
        env.storage().instance().get(&DataKey::Escrow(escrow_id))
    }

    /// Contract version for deployment validation.
    pub fn version() -> u32 {
        VERSION
    }
}

mod test;

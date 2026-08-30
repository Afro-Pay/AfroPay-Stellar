#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

pub const VERSION: u32 = 2;
pub const STORAGE_VERSION: u32 = 2;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Payment(String),
    StorageVersion,
    PaymentV2(String),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRecord {
    pub amount: i128,
    pub recipient: Address,
    pub registered: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRecordV2 {
    pub amount: i128,
    pub recipient: Address,
    pub registered: bool,
    pub memo: String,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    /// Initialize the registry with an admin account.
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

    /// Migrate v1 payment records to the v2 storage layout.
    pub fn migrate(env: Env, admin: Address, payment_ids: Vec<String>) {
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
        if current_version == STORAGE_VERSION {
            return;
        }

        for payment_id in payment_ids.iter() {
            let old_key = DataKey::Payment(payment_id.clone());
            if let Some(record) = env.storage().persistent().get::<_, PaymentRecord>(&old_key) {
                let new_key = DataKey::PaymentV2(payment_id);
                let migrated = PaymentRecordV2 {
                    amount: record.amount,
                    recipient: record.recipient,
                    registered: record.registered,
                    memo: String::from_str(&env, ""),
                };
                env.storage().persistent().set(&new_key, &migrated);
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION);
    }

    /// Register a remittance payment on-chain for verification.
    pub fn register_payment(
        env: Env,
        admin: Address,
        payment_id: String,
        amount: i128,
        recipient: Address,
    ) -> bool {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized");

        if admin != stored_admin {
            panic!("unauthorized admin");
        }

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let key = DataKey::PaymentV2(payment_id.clone());

        if env.storage().persistent().has(&key) {
            return false;
        }

        let record = PaymentRecord {
            amount,
            recipient,
            registered: true,
        };

        let record = PaymentRecordV2 {
            amount: record.amount,
            recipient: record.recipient,
            registered: record.registered,
            memo: String::from_str(&env, ""),
        };

        env.storage().persistent().set(&key, &record);
        true
    }

    /// Return the stored payment record, if present.
    pub fn get_payment(env: Env, payment_id: String) -> Option<PaymentRecord> {
        let key = DataKey::PaymentV2(payment_id);
        env.storage()
            .persistent()
            .get::<_, PaymentRecordV2>(&key)
            .map(|record| PaymentRecord {
                amount: record.amount,
                recipient: record.recipient,
                registered: record.registered,
            })
    }

    /// Check whether a payment id has been registered.
    pub fn is_registered(env: Env, payment_id: String) -> bool {
        Self::get_payment(env, payment_id)
            .map(|record| record.registered)
            .unwrap_or(false)
    }

    /// Contract version for deployment validation.
    pub fn version() -> u32 {
        VERSION
    }
}

mod test;

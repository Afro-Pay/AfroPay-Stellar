#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

pub const VERSION: u32 = 1;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Payment(String),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRecord {
    pub amount: i128,
    pub recipient: Address,
    pub registered: bool,
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

        let key = DataKey::Payment(payment_id.clone());

        if env.storage().persistent().has(&key) {
            return false;
        }

        let record = PaymentRecord {
            amount,
            recipient,
            registered: true,
        };

        env.storage().persistent().set(&key, &record);
        true
    }

    /// Return the stored payment record, if present.
    pub fn get_payment(env: Env, payment_id: String) -> Option<PaymentRecord> {
        let key = DataKey::Payment(payment_id);
        env.storage().persistent().get(&key)
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

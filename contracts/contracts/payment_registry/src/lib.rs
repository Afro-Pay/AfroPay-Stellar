#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String};

pub const VERSION: u32 = 1;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Payments,
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
        env.storage()
            .instance()
            .set(&DataKey::Payments, &Map::<String, PaymentRecord>::new(&env));
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

        let mut payments: Map<String, PaymentRecord> = env
            .storage()
            .instance()
            .get(&DataKey::Payments)
            .unwrap_or_else(|| Map::new(&env));

        if payments.contains_key(payment_id.clone()) {
            return false;
        }

        payments.set(
            payment_id,
            PaymentRecord {
                amount,
                recipient,
                registered: true,
            },
        );

        env.storage().instance().set(&DataKey::Payments, &payments);
        true
    }

    /// Return the stored payment record, if present.
    pub fn get_payment(env: Env, payment_id: String) -> Option<PaymentRecord> {
        let payments: Map<String, PaymentRecord> = env.storage().instance().get(&DataKey::Payments)?;
        payments.get(payment_id)
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

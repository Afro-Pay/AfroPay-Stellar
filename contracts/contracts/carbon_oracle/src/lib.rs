#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

pub const VERSION: u32 = 1;
pub const TIMELOCK_DELAY: u64 = 86_400;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CarbonError {
    NotInitialized = 1,
    Unauthorized = 2,
    PriceNotSet = 3,
    NoPendingUpdate = 4,
    InvalidPrice = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Oracle,
    Price,
    Proposal,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceProposal {
    pub id: u64,
    pub price: i128,
    pub executable_at: u64,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn initialize(env: Env, admin: Address, oracle: Address, price: i128) -> Result<(), CarbonError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CarbonError::NotInitialized);
        }
        if price <= 0 {
            return Err(CarbonError::InvalidPrice);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::Price, &price);
        Ok(())
    }

    pub fn version(_env: Env) -> u32 {
        VERSION
    }

    pub fn get_price(env: Env) -> Result<i128, CarbonError> {
        env.storage()
            .instance()
            .get(&DataKey::Price)
            .ok_or(CarbonError::PriceNotSet)
    }

    pub fn get_pending_update(env: Env) -> Option<PriceProposal> {
        env.storage().instance().get(&DataKey::Proposal)
    }

    pub fn propose_price_update(env: Env, oracle: Address, price: i128) -> Result<u64, CarbonError> {
        if price <= 0 {
            return Err(CarbonError::InvalidPrice);
        }
        let stored_oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .ok_or(CarbonError::NotInitialized)?;
        if oracle != stored_oracle {
            return Err(CarbonError::Unauthorized);
        }
        oracle.require_auth();

        let id = env
            .storage()
            .instance()
            .get::<DataKey, PriceProposal>(&DataKey::Proposal)
            .map(|proposal| proposal.id + 1)
            .unwrap_or(1);
        let proposal = PriceProposal {
            id,
            price,
            executable_at: env.ledger().timestamp() + TIMELOCK_DELAY,
        };
        env.storage().instance().set(&DataKey::Proposal, &proposal);
        env.events().publish(("price_update_proposed", id), (price, proposal.executable_at));
        Ok(id)
    }

    pub fn execute_price_update(env: Env, proposal_id: u64) -> Result<i128, CarbonError> {
        let proposal: PriceProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal)
            .ok_or(CarbonError::PriceNotSet)?;
        if proposal.id != proposal_id || env.ledger().timestamp() < proposal.executable_at {
            return Err(CarbonError::PriceNotSet);
        }
        env.storage().instance().set(&DataKey::Price, &proposal.price);
        env.storage().instance().remove(&DataKey::Proposal);
        env.events().publish(("price_update_executed", proposal.id), proposal.price);
        Ok(proposal.price)
    }

    pub fn emergency_cancel_proposed_update(
        env: Env,
        admin: Address,
        proposal_id: u64,
    ) -> Result<(), CarbonError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CarbonError::NotInitialized)?;
        if admin != stored_admin {
            return Err(CarbonError::Unauthorized);
        }
        let proposal: PriceProposal = env
            .storage()
            .instance()
            .get(&DataKey::Proposal)
            .ok_or(CarbonError::NoPendingUpdate)?;
        if proposal.id != proposal_id {
            return Err(CarbonError::NoPendingUpdate);
        }
        env.storage().instance().remove(&DataKey::Proposal);
        env.events().publish(("price_update_cancelled", proposal_id), ());
        Ok(())
    }
}

#[cfg(test)]
mod test;

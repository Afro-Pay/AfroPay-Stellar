use soroban_sdk::{contracttype, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OptimizedEscrow {
    pub id: u64,
    pub client: Address,
    pub agent: Address,
    pub arbitrator: Address,
    pub token: Address,
    pub amount: i128,
    pub state: u8,
    pub created_at: u64,
    pub updated_at: u64,
    pub released_at: u64,
    pub refunded_at: u64,
    pub milestone_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OptimizedMilestone {
    pub index: u32,
    pub title: String,
    pub amount: i128,
    pub status: u8,
    pub submitted_at: u64,
    pub proof: String,
}

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    Escrow(u64),
    Milestone(u64, u32),
    EscrowCounter,
    EscrowCount,
}

pub struct StorageHelper;

impl StorageHelper {
    pub fn store_escrow(env: &Env, escrow: &OptimizedEscrow) {
        let key = StorageKey::Escrow(escrow.id);
        env.storage().set(&key, escrow);
    }

    pub fn load_escrow(env: &Env, id: u64) -> Option<OptimizedEscrow> {
        let key = StorageKey::Escrow(id);
        env.storage().get(&key)
    }

    pub fn store_milestone(env: &Env, escrow_id: u64, milestone: &OptimizedMilestone) {
        let key = StorageKey::Milestone(escrow_id, milestone.index);
        env.storage().set(&key, milestone);
    }

    pub fn load_milestone(env: &Env, escrow_id: u64, index: u32) -> Option<OptimizedMilestone> {
        let key = StorageKey::Milestone(escrow_id, index);
        env.storage().get(&key)
    }

    pub fn load_milestones_batch(env: &Env, escrow_id: u64, count: u32) -> Vec<OptimizedMilestone> {
        let mut milestones = Vec::new(env);
        for i in 0..count {
            if let Some(milestone) = Self::load_milestone(env, escrow_id, i) {
                milestones.push_back(milestone);
            }
        }
        milestones
    }

    pub fn get_next_escrow_id(env: &Env) -> u64 {
        let key = StorageKey::EscrowCounter;
        let current: u64 = env.storage().get(&key).unwrap_or(0);
        let next = current + 1;
        env.storage().set(&key, &next);
        next
    }

    pub fn increment_escrow_count(env: &Env) -> u64 {
        let key = StorageKey::EscrowCount;
        let current: u64 = env.storage().get(&key).unwrap_or(0);
        let next = current + 1;
        env.storage().set(&key, &next);
        next
    }

    pub fn get_escrow_count(env: &Env) -> u64 {
        let key = StorageKey::EscrowCount;
        env.storage().get(&key).unwrap_or(0)
    }
}

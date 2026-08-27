use soroban_sdk::{contract, contracttype, Address, Env, Vec};
use crate::storage::{OptimizedEscrow, OptimizedMilestone, StorageHelper};
use crate::errors::EscrowError;

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn create_escrow(
        env: Env,
        client: Address,
        agent: Address,
        arbitrator: Address,
        token: Address,
        amount: i128,
        milestones: Vec<(String, i128)>,
    ) -> Result<u64, EscrowError> {
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if milestones.is_empty() {
            return Err(EscrowError::NoMilestones);
        }

        let escrow_id = StorageHelper::get_next_escrow_id(&env);

        let escrow = OptimizedEscrow {
            id: escrow_id,
            client: client.clone(),
            agent: agent.clone(),
            arbitrator: arbitrator.clone(),
            token: token.clone(),
            amount,
            state: 0,
            created_at: env.ledger().timestamp(),
            updated_at: env.ledger().timestamp(),
            released_at: 0,
            refunded_at: 0,
            milestone_count: milestones.len() as u32,
        };

        StorageHelper::store_escrow(&env, &escrow);

        for (index, (title, amount)) in milestones.iter().enumerate() {
            let milestone = OptimizedMilestone {
                index: index as u32,
                title: title.clone(),
                amount: *amount,
                status: 0,
                submitted_at: 0,
                proof: String::from_str(&env, ""),
            };
            StorageHelper::store_milestone(&env, escrow_id, &milestone);
        }

        StorageHelper::increment_escrow_count(&env);

        env.events().publish(
            ("escrow_created", "v1"),
            (escrow_id, client, agent, amount),
        );

        Ok(escrow_id)
    }

    pub fn release_to_agent(
        env: Env,
        escrow_id: u64,
        caller: Address,
    ) -> Result<(), EscrowError> {
        let mut escrow = StorageHelper::load_escrow(&env, escrow_id)
            .ok_or(EscrowError::EscrowNotFound)?;

        if escrow.client != caller && escrow.arbitrator != caller {
            return Err(EscrowError::Unauthorized);
        }

        if escrow.state != 0 {
            return Err(EscrowError::InvalidState);
        }

        let milestones = StorageHelper::load_milestones_batch(
            &env,
            escrow_id,
            escrow.milestone_count,
        );

        let all_approved = milestones.iter().all(|m| m.status == 2);
        if !all_approved {
            return Err(EscrowError::MilestonesNotApproved);
        }

        escrow.state = 1;
        escrow.released_at = env.ledger().timestamp();
        escrow.updated_at = env.ledger().timestamp();

        StorageHelper::store_escrow(&env, &escrow);

        env.events().publish(
            ("escrow_released", "v1"),
            (escrow_id, escrow.client, escrow.agent),
        );

        Ok(())
    }

    pub fn claim_refund(
        env: Env,
        escrow_id: u64,
        caller: Address,
    ) -> Result<(), EscrowError> {
        let mut escrow = StorageHelper::load_escrow(&env, escrow_id)
            .ok_or(EscrowError::EscrowNotFound)?;

        if escrow.client != caller && escrow.arbitrator != caller {
            return Err(EscrowError::Unauthorized);
        }

        if escrow.state != 0 {
            return Err(EscrowError::InvalidState);
        }

        let deadline = escrow.created_at + 30 * 24 * 60 * 60;
        if env.ledger().timestamp() < deadline {
            return Err(EscrowError::DeadlineNotPassed);
        }

        escrow.state = 2;
        escrow.refunded_at = env.ledger().timestamp();
        escrow.updated_at = env.ledger().timestamp();

        StorageHelper::store_escrow(&env, &escrow);

        env.events().publish(
            ("escrow_refunded", "v1"),
            (escrow_id, escrow.client),
        );

        Ok(())
    }

    pub fn deposit_escrow(
        env: Env,
        escrow_id: u64,
        caller: Address,
        amount: i128,
    ) -> Result<(), EscrowError> {
        let mut escrow = StorageHelper::load_escrow(&env, escrow_id)
            .ok_or(EscrowError::EscrowNotFound)?;

        if escrow.client != caller {
            return Err(EscrowError::Unauthorized);
        }

        if escrow.state != 0 {
            return Err(EscrowError::InvalidState);
        }

        escrow.amount += amount;
        escrow.updated_at = env.ledger().timestamp();

        StorageHelper::store_escrow(&env, &escrow);

        env.events().publish(
            ("escrow_deposited", "v1"),
            (escrow_id, caller, amount),
        );

        Ok(())
    }

    pub fn get_escrow_info(
        env: Env,
        escrow_id: u64,
    ) -> Option<OptimizedEscrow> {
        StorageHelper::load_escrow(&env, escrow_id)
    }

    pub fn get_milestones(
        env: Env,
        escrow_id: u64,
    ) -> Vec<OptimizedMilestone> {
        let escrow = StorageHelper::load_escrow(&env, escrow_id);
        if let Some(escrow) = escrow {
            StorageHelper::load_milestones_batch(&env, escrow_id, escrow.milestone_count)
        } else {
            Vec::new(&env)
        }
    }

    pub fn get_escrow_count(env: Env) -> u64 {
        StorageHelper::get_escrow_count(&env)
    }
}

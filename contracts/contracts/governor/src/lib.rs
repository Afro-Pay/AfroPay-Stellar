#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String};

const DEFAULT_FEE_BPS: u32 = 100;
pub const VERSION: u32 = 2;
pub const STORAGE_VERSION: u32 = 2;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Threshold,
    ProposalCount,
    Proposals,
    Stakes,
    Votes,
    FeeBps,
    AmmPairCount,
    StorageVersion,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalState {
    Pending,
    Active,
    Defeated,
    Succeeded,
    Executed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    SetFeeBps,
    AddAmmPair,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub description: String,
    pub action: ProposalAction,
    pub value: u32,
    pub state: ProposalState,
    pub for_votes: i128,
    pub against_votes: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VoteStatus {
    NotVoted,
    For,
    Against,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn initialize(env: Env, admin: Address, threshold: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("contract already initialized");
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        env.storage().instance().set(&DataKey::Proposals, &Map::<u64, Proposal>::new(&env));
        env.storage().instance().set(&DataKey::Stakes, &Map::<Address, i128>::new(&env));
        env.storage().instance().set(&DataKey::Votes, &Map::<(u64, Address), VoteStatus>::new(&env));
        env.storage().instance().set(&DataKey::FeeBps, &DEFAULT_FEE_BPS);
        env.storage().instance().set(&DataKey::AmmPairCount, &0u32);
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

    pub fn set_stake(env: Env, admin: Address, voter: Address, amount: i128) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized");

        if admin != stored_admin {
            panic!("unauthorized admin");
        }

        if amount < 0 {
            panic!("stake must be non-negative");
        }

        let mut stakes: Map<Address, i128> = env.storage().instance().get(&DataKey::Stakes).unwrap_or_else(|| Map::new(&env));
        stakes.set(voter, amount);
        env.storage().instance().set(&DataKey::Stakes, &stakes);
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        description: String,
        action: ProposalAction,
        value: u32,
    ) -> u64 {
        proposer.require_auth();

        let threshold: i128 = env.storage().instance().get(&DataKey::Threshold).unwrap_or(0);
        let stake = Self::get_stake(env.clone(), proposer.clone());
        if stake < threshold {
            panic!("stake below threshold");
        }

        let mut proposal_count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        proposal_count += 1;

        let proposal = Proposal {
            id: proposal_count,
            proposer: proposer.clone(),
            description: description.clone(),
            action: action.clone(),
            value,
            state: ProposalState::Pending,
            for_votes: 0,
            against_votes: 0,
        };

        let mut proposals: Map<u64, Proposal> = env.storage().instance().get(&DataKey::Proposals).unwrap_or_else(|| Map::new(&env));
        proposals.set(proposal_count, proposal);

        env.storage().instance().set(&DataKey::ProposalCount, &proposal_count);
        env.storage().instance().set(&DataKey::Proposals, &proposals);
        proposal_count
    }

    pub fn cast_vote(env: Env, voter: Address, proposal_id: u64, support: bool) -> bool {
        voter.require_auth();

        let mut proposals: Map<u64, Proposal> = env.storage().instance().get(&DataKey::Proposals).unwrap_or_else(|| Map::new(&env));
        let mut proposal = proposals.get(proposal_id).unwrap_or_else(|| panic!("proposal not found"));
        if proposal.state != ProposalState::Pending && proposal.state != ProposalState::Active {
            return false;
        }

        let mut votes: Map<(u64, Address), VoteStatus> = env.storage().instance().get(&DataKey::Votes).unwrap_or_else(|| Map::new(&env));
        let vote_key = (proposal_id, voter.clone());
        if votes.contains_key(vote_key.clone()) {
            return false;
        }

        let stake = Self::get_stake(env.clone(), voter.clone());
        if stake <= 0 {
            return false;
        }

        if support {
            proposal.for_votes += stake;
        } else {
            proposal.against_votes += stake;
        }

        if proposal.state == ProposalState::Pending {
            proposal.state = ProposalState::Active;
        }
        votes.set(vote_key, if support { VoteStatus::For } else { VoteStatus::Against });
        proposals.set(proposal_id, proposal.clone());

        env.storage().instance().set(&DataKey::Proposals, &proposals);
        env.storage().instance().set(&DataKey::Votes, &votes);
        true
    }

    pub fn execute(env: Env, caller: Address, proposal_id: u64) -> bool {
        caller.require_auth();

        let mut proposals: Map<u64, Proposal> = env.storage().instance().get(&DataKey::Proposals).unwrap_or_else(|| Map::new(&env));
        let mut proposal = proposals.get(proposal_id).unwrap_or_else(|| panic!("proposal not found"));
        if proposal.state != ProposalState::Active {
            return false;
        }

        if proposal.for_votes <= proposal.against_votes {
            proposal.state = ProposalState::Defeated;
            proposals.set(proposal_id, proposal.clone());
            env.storage().instance().set(&DataKey::Proposals, &proposals);
            return false;
        }

        proposal.state = ProposalState::Succeeded;

        match proposal.action {
            ProposalAction::SetFeeBps => {
                env.storage().instance().set(&DataKey::FeeBps, &proposal.value);
            }
            ProposalAction::AddAmmPair => {
                let mut count: u32 = env.storage().instance().get(&DataKey::AmmPairCount).unwrap_or(0);
                count += 1;
                env.storage().instance().set(&DataKey::AmmPairCount, &count);
            }
        }

        proposal.state = ProposalState::Executed;
        proposals.set(proposal_id, proposal);
        env.storage().instance().set(&DataKey::Proposals, &proposals);
        true
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        let proposals: Map<u64, Proposal> = env.storage().instance().get(&DataKey::Proposals)?;
        proposals.get(proposal_id)
    }

    pub fn get_stake(env: Env, voter: Address) -> i128 {
        let stakes: Map<Address, i128> = env.storage().instance().get(&DataKey::Stakes).unwrap_or_else(|| Map::new(&env));
        stakes.get(voter).unwrap_or(0)
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(100)
    }

    pub fn get_amm_pair_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::AmmPairCount).unwrap_or(0)
    }

    pub fn version() -> u32 {
        VERSION
    }
}

mod test;

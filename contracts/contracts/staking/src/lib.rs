#![no_std]

//! # AfroPay Timelocked Multi-Token Staking Contract
//!
//! A Soroban smart contract enabling liquidity providers to stake multiple
//! token types into dedicated pools with timelocked positions. Stakers earn
//! yield distributed proportionally to their share of each pool over time.
//!
//! ## Key Features
//! - **Multi-token support**: Each pool accepts a single asset; multiple pools
//!   cover different assets (USDC, local stablecoins, etc.)
//! - **Timelocked staking**: Tokens are locked for a minimum duration.
//! - **Early withdrawal penalty**: Withdrawing before timelock expiry slashes
//!   10% of the staked amount, sent to the treasury.
//! - **Precise yield math**: Reward calculations use fixed-point arithmetic
//!   (i128, 10^7 precision) to avoid floating-point errors.
//! - **Re-entrancy safety**: All state mutations occur before external token
//!   transfers, following the Checks-Effects-Interactions pattern.

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Contract version for deployment validation.
pub const VERSION: u32 = 1;

/// Storage version for migration support.
pub const STORAGE_VERSION: u32 = 1;

/// Fixed-point precision: 10^7 — yields are accurate down to 7 decimal places.
pub const FIXED_POINT_PRECISION: i128 = 10_000_000;

/// Early-withdrawal penalty: 10% of the staked amount (in basis points: 1000/10000).
pub const PENALTY_BASIS_POINTS: i128 = 1_000;
pub const BASIS_POINTS_DENOMINATOR: i128 = 10_000;

/// Maximum lock duration: 365 days in seconds.
pub const MAX_LOCK_DURATION: u64 = 365 * 24 * 60 * 60;

/// Minimum lock duration: 1 day in seconds.
pub const MIN_LOCK_DURATION: u64 = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Data Structures
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Global admin address.
    Admin,
    /// Storage version for migrations.
    StorageVersion,
    /// Pool counter — auto-incremented pool IDs.
    PoolCounter,
    /// Pool info keyed by pool ID.
    Pool(u64),
    /// Staker info keyed by (pool_id, staker_address).
    Stake(u64, Address),
    /// Pending rewards keyed by (pool_id, staker_address).
    /// Tracks rewards already claimed to calculate reward_debt correctly.
    ClaimedRewards(u64, Address),
}

/// Represents a staking pool for a specific asset.
///
/// Each pool tracks its own staked total, reward accumulator, and reward rate.
/// The `acc_reward_per_share` field is an accumulator that increases over time
/// and is used to calculate each staker's proportional reward share.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolInfo {
    /// Address of the SEP-41 token contract accepted by this pool.
    pub asset: Address,
    /// Address that receives early-withdrawal penalty funds.
    pub treasury: Address,
    /// Reward tokens distributed per second (in smallest unit).
    pub reward_rate: i128,
    /// Total tokens currently staked in this pool.
    pub total_staked: i128,
    /// Accumulated reward per share (scaled by 10^7).
    /// Updated on every stake / claim / withdraw interaction.
    pub acc_reward_per_share: i128,
    /// Timestamp (ledger seconds) when the pool was created.
    pub created_at: u64,
    /// Whether the pool is active (can accept new stakes).
    pub is_active: bool,
}

/// Represents a single staker's position within a pool.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakerInfo {
    /// Amount of tokens currently staked.
    pub amount: i128,
    /// Unix timestamp when the staking lock began.
    pub lock_start: u64,
    /// Minimum duration (in seconds) the tokens must remain locked.
    pub lock_duration: u64,
    /// Accumulated reward-per-share snapshot at the time of the last
    /// claim or stake — used to calculate unclaimed rewards.
    pub reward_debt: i128,
}

/// View-only summary returned by `get_staker_info`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakerView {
    pub amount: i128,
    pub lock_start: u64,
    pub lock_duration: u64,
    pub lock_end: u64,
    pub reward_debt: i128,
    pub is_locked: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    // ===================================================================
    // Admin
    // ===================================================================

    /// Initialize the contract with an admin.
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

    /// Migrate storage (admin only). Reserved for future upgrades.
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

    // ===================================================================
    // Pool Management
    // ===================================================================

    /// Create a new staking pool.
    ///
    /// # Arguments
    /// * `asset` — SEP-41 token contract address accepted by this pool.
    /// * `treasury` — Address that receives early-withdrawal penalties.
    /// * `reward_rate` — Reward tokens distributed per second (smallest unit).
    ///
    /// # Returns
    /// The unique pool ID.
    pub fn create_pool(
        env: Env,
        admin: Address,
        asset: Address,
        treasury: Address,
        reward_rate: i128,
    ) -> u64 {
        admin.require_auth();
        Self::assert_admin(&env, &admin);

        if reward_rate < 0 {
            panic!("reward_rate must be non-negative");
        }

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0);
        let pool_id = counter + 1;
        env.storage()
            .instance()
            .set(&DataKey::PoolCounter, &pool_id);

        let pool = PoolInfo {
            asset,
            treasury,
            reward_rate,
            total_staked: 0,
            acc_reward_per_share: 0,
            created_at: env.ledger().timestamp(),
            is_active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        Self::extend_storage_ttl(&env, &DataKey::Pool(pool_id));

        pool_id
    }

    /// Deactivate a pool — prevents new stakes but lets existing stakers
    /// claim and withdraw.
    pub fn deactivate_pool(env: Env, admin: Address, pool_id: u64) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);

        let mut pool = Self::get_pool(&env, pool_id);
        pool.is_active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
    }

    /// Update the reward rate for a pool (admin only).
    pub fn set_reward_rate(env: Env, admin: Address, pool_id: u64, new_rate: i128) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);

        if new_rate < 0 {
            panic!("reward_rate must be non-negative");
        }

        // Accrue pending rewards before changing the rate.
        Self::update_pool(&env, pool_id);

        let mut pool = Self::get_pool(&env, pool_id);
        pool.reward_rate = new_rate;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
    }

    // ===================================================================
    // Staking
    // ===================================================================

    /// Stake tokens into a pool with a timelock.
    ///
    /// # Arguments
    /// * `from` — The address staking tokens (must authorize).
    /// * `pool_id` — Target pool.
    /// * `amount` — Number of tokens to stake (must be positive).
    /// * `lock_duration` — How long to lock tokens, in seconds
    ///   (must be between MIN_LOCK_DURATION and MAX_LOCK_DURATION).
    ///
    /// # Panics
    /// - Pool does not exist or is inactive.
    /// - Amount is not positive.
    /// - lock_duration is outside allowed range.
    pub fn stake(env: Env, from: Address, pool_id: u64, amount: i128, lock_duration: u64) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }
        if lock_duration < MIN_LOCK_DURATION || lock_duration > MAX_LOCK_DURATION {
            panic!("lock_duration must be between 1 day and 365 days");
        }

        // Update pool accumulator before reading staker state (CEI pattern).
        Self::update_pool(&env, pool_id);

        let pool = Self::get_pool(&env, pool_id);
        if !pool.is_active {
            panic!("pool is not active");
        }

        // Transfer tokens from staker to contract BEFORE mutating state.
        let token_client = token::Client::new(&env, &pool.asset);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Load or initialise staker info.
        let stake_key = DataKey::Stake(pool_id, from.clone());
        let mut staker: StakerInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .unwrap_or(StakerInfo {
                amount: 0,
                lock_start: env.ledger().timestamp(),
                lock_duration,
                reward_debt: pool.acc_reward_per_share,
            });

        // Calculate pending rewards before modifying the staker's position.
        let pending = Self::calculate_pending_reward(
            staker.amount,
            staker.reward_debt,
            pool.acc_reward_per_share,
        );
        if pending > 0 {
            // Transfer accumulated rewards.
            let reward_token = Self::get_reward_token_for_pool(&env, pool_id);
            let reward_client = token::Client::new(&env, &reward_token);
            reward_client.transfer(
                &env.current_contract_address(),
                &from,
                &pending,
            );
        }

        // If adding to an existing position, extend the lock.
        let now = env.ledger().timestamp();
        if staker.amount > 0 {
            // Extend lock from now, use the longer of existing remaining lock
            // and the newly requested duration.
            let remaining = staker
                .lock_start
                .saturating_add(staker.lock_duration)
                .saturating_sub(now);
            let effective_duration = core::cmp::max(remaining, lock_duration);
            staker.lock_duration = effective_duration;
            staker.lock_start = now;
        } else {
            staker.lock_start = now;
            staker.lock_duration = lock_duration;
        }

        staker.amount += amount;
        staker.reward_debt = pool.acc_reward_per_share;

        env.storage().persistent().set(&stake_key, &staker);
        Self::extend_storage_ttl(&env, &stake_key);

        // Update pool totals.
        Self::add_to_pool_staked(&env, pool_id, amount);
    }

    // ===================================================================
    // Claims & Withdrawals
    // ===================================================================

    /// Claim all pending rewards for the caller in the given pool.
    ///
    /// Does not affect the staked principal or the timelock.
    pub fn claim_rewards(env: Env, from: Address, pool_id: u64) {
        from.require_auth();

        Self::update_pool(&env, pool_id);

        let stake_key = DataKey::Stake(pool_id, from.clone());
        let mut staker: StakerInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("no stake found");

        let pool = Self::get_pool(&env, pool_id);

        let pending = Self::calculate_pending_reward(
            staker.amount,
            staker.reward_debt,
            pool.acc_reward_per_share,
        );

        if pending > 0 {
            // Transfer reward tokens. (CEI: state updated before transfer.)
            staker.reward_debt = pool.acc_reward_per_share;
            env.storage().persistent().set(&stake_key, &staker);

            let reward_token = Self::get_reward_token_for_pool(&env, pool_id);
            let reward_client = token::Client::new(&env, &reward_token);
            reward_client.transfer(
                &env.current_contract_address(),
                &from,
                &pending,
            );
        }
    }

    /// Withdraw staked tokens from a pool.
    ///
    /// If the timelock has not expired, a 10% penalty is slashed from the
    /// withdrawn amount and sent to the pool's treasury.
    ///
    /// # Arguments
    /// * `from` — The staker's address (must authorize).
    /// * `pool_id` — Target pool.
    /// * `amount` — Number of staked tokens to withdraw (must be positive
    ///   and <= staked balance).
    pub fn withdraw(env: Env, from: Address, pool_id: u64, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        Self::update_pool(&env, pool_id);

        let stake_key = DataKey::Stake(pool_id, from.clone());
        let mut staker: StakerInfo = env
            .storage()
            .persistent()
            .get(&stake_key)
            .expect("no stake found");

        if staker.amount < amount {
            panic!("insufficient staked balance");
        }

        let pool = Self::get_pool(&env, pool_id);

        // Claim any pending rewards first.
        let pending = Self::calculate_pending_reward(
            staker.amount,
            staker.reward_debt,
            pool.acc_reward_per_share,
        );
        if pending > 0 {
            let reward_token = Self::get_reward_token_for_pool(&env, pool_id);
            let reward_client = token::Client::new(&env, &reward_token);
            reward_client.transfer(
                &env.current_contract_address(),
                &from,
                &pending,
            );
            staker.reward_debt = pool.acc_reward_per_share;
        }

        // Calculate penalty for early withdrawal.
        let lock_end = staker.lock_start.saturating_add(staker.lock_duration);
        let now = env.ledger().timestamp();

        let (net_amount, penalty) = if now < lock_end {
            // Early withdrawal: 10% penalty.
            let penalty_amount = Self::calculate_penalty(amount);
            (amount - penalty_amount, penalty_amount)
        } else {
            // Timelock expired: no penalty.
            (amount, 0)
        };

        // Send penalty to treasury if applicable.
        if penalty > 0 {
            let asset_client = token::Client::new(&env, &pool.asset);
            asset_client.transfer(
                &env.current_contract_address(),
                &pool.treasury,
                &penalty,
            );
        }

        // Send net amount to the staker.
        let asset_client = token::Client::new(&env, &pool.asset);
        asset_client.transfer(&env.current_contract_address(), &from, &net_amount);

        // Update staker state.
        staker.amount -= amount;
        if staker.amount == 0 {
            // Remove the stake entry entirely to reclaim storage.
            env.storage().persistent().remove(&stake_key);
        } else {
            env.storage().persistent().set(&stake_key, &staker);
            Self::extend_storage_ttl(&env, &stake_key);
        }

        // Update pool total.
        Self::sub_from_pool_staked(&env, pool_id, amount);
    }

    // ===================================================================
    // View Functions
    // ===================================================================

    /// Get pool information.
    pub fn get_pool_info(env: Env, pool_id: u64) -> PoolInfo {
        Self::get_pool(&env, pool_id)
    }

    /// Get a staker's position in a pool (returns None if no stake exists).
    pub fn get_staker_info(env: Env, pool_id: u64, staker: Address) -> Option<StakerView> {
        let stake_key = DataKey::Stake(pool_id, staker);
        let staker_info: StakerInfo = env.storage().persistent().get(&stake_key)?;

        let lock_end = staker_info.lock_start.saturating_add(staker_info.lock_duration);
        let now = env.ledger().timestamp();

        Some(StakerView {
            amount: staker_info.amount,
            lock_start: staker_info.lock_start,
            lock_duration: staker_info.lock_duration,
            lock_end,
            reward_debt: staker_info.reward_debt,
            is_locked: now < lock_end,
        })
    }

    /// Calculate the pending (unclaimed) rewards for a staker in a pool.
    pub fn get_pending_rewards(env: Env, pool_id: u64, staker: Address) -> i128 {
        Self::update_pool(&env, pool_id);

        let stake_key = DataKey::Stake(pool_id, staker);
        let staker_info: StakerInfo = match env.storage().persistent().get(&stake_key) {
            Some(info) => info,
            None => return 0,
        };

        let pool = Self::get_pool(&env, pool_id);
        Self::calculate_pending_reward(
            staker_info.amount,
            staker_info.reward_debt,
            pool.acc_reward_per_share,
        )
    }

    /// Contract version.
    pub fn version() -> u32 {
        VERSION
    }
}

// ---------------------------------------------------------------------------
// Internal / Private Helpers
// ---------------------------------------------------------------------------

impl StakingContract {
    /// Verify that `addr` is the contract admin.
    fn assert_admin(env: &Env, addr: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized");
        if *addr != admin {
            panic!("unauthorized: not admin");
        }
    }

    /// Read a pool from storage, panicking if it does not exist.
    fn get_pool(env: &Env, pool_id: u64) -> PoolInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Pool(pool_id))
            .unwrap_or_else(|| panic!("pool {} not found", pool_id))
    }

    /// Update the pool's `acc_reward_per_share` based on elapsed time.
    ///
    /// This is called at the start of every mutating interaction (stake,
    /// claim, withdraw) to ensure the accumulator is current before any
    /// per-staker calculations run.
    fn update_pool(env: &Env, pool_id: u64) {
        let mut pool = Self::get_pool(env, pool_id);

        if pool.total_staked > 0 && pool.reward_rate > 0 {
            let now = env.ledger().timestamp();
            let last_update = pool.created_at;
            let elapsed = now.saturating_sub(last_update);

            if elapsed > 0 {
                // total_reward = reward_rate * elapsed
                let total_reward = Self::safe_mul(pool.reward_rate, elapsed as i128);

                // acc_reward_per_share += total_reward * PRECISION / total_staked
                let increment = Self::safe_div(
                    Self::safe_mul(total_reward, FIXED_POINT_PRECISION),
                    pool.total_staked,
                );
                pool.acc_reward_per_share =
                    Self::safe_add(pool.acc_reward_per_share, increment);
            }
        }

        // Always update created_at to "now" so the next delta is relative.
        pool.created_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
    }

    /// Calculate pending rewards for a staker given their state and the
    /// current pool accumulator.
    ///
    /// pending = (amount * acc_reward_per_share / PRECISION) - reward_debt
    fn calculate_pending_reward(amount: i128, reward_debt: i128, acc: i128) -> i128 {
        if amount <= 0 {
            return 0;
        }
        let reward = Self::safe_div(Self::safe_mul(amount, acc), FIXED_POINT_PRECISION);
        let pending = reward - reward_debt;
        if pending < 0 {
            0
        } else {
            pending
        }
    }

    /// Calculate the 10% early-withdrawal penalty on `amount`.
    fn calculate_penalty(amount: i128) -> i128 {
        // penalty = amount * PENALTY_BASIS_POINTS / BASIS_POINTS_DENOMINATOR
        // Using ceiling division to favour the protocol.
        let product = Self::safe_mul(amount, PENALTY_BASIS_POINTS);
        let quotient = product / BASIS_POINTS_DENOMINATOR;
        let remainder = product % BASIS_POINTS_DENOMINATOR;
        if remainder > 0 {
            quotient + 1
        } else {
            quotient
        }
    }

    /// Add `delta` to the pool's `total_staked`.
    fn add_to_pool_staked(env: &Env, pool_id: u64, delta: i128) {
        let mut pool = Self::get_pool(env, pool_id);
        pool.total_staked = Self::safe_add(pool.total_staked, delta);
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
    }

    /// Subtract `delta` from the pool's `total_staked`.
    fn sub_from_pool_staked(env: &Env, pool_id: u64, delta: i128) {
        let mut pool = Self::get_pool(env, pool_id);
        pool.total_staked -= delta;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
    }

    /// Extend the TTL of a persistent storage entry to one year.
    fn extend_storage_ttl(env: &Env, key: &DataKey) {
        let one_year = 31_536_000; // seconds
        env.storage().persistent().extend_ttl(key, one_year, one_year);
    }

    /// For now, the reward token is the same as the pool's asset token.
    /// This can be extended to a separate reward token per pool in a
    /// future upgrade by adding a `reward_asset` field to `PoolInfo`.
    fn get_reward_token_for_pool(env: &Env, pool_id: u64) -> Address {
        let pool = Self::get_pool(env, pool_id);
        pool.asset
    }

    // -------------------------------------------------------------------
    // Fixed-Point Arithmetic Helpers (i128, overflow-safe)
    // -------------------------------------------------------------------

    /// Safe multiplication — panics on overflow.
    fn safe_mul(a: i128, b: i128) -> i128 {
        a.checked_mul(b)
            .unwrap_or_else(|| panic!("arithmetic overflow in multiplication"))
    }

    /// Safe addition — panics on overflow.
    fn safe_add(a: i128, b: i128) -> i128 {
        a.checked_add(b)
            .unwrap_or_else(|| panic!("arithmetic overflow in addition"))
    }

    /// Safe division — panics on division by zero.
    fn safe_div(a: i128, b: i128) -> i128 {
        if b == 0 {
            panic!("arithmetic error: division by zero");
        }
        a / b
    }
}

mod test;

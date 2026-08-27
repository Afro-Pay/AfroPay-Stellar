use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowError {
    InvalidAmount = 1,
    NoMilestones = 2,
    EscrowNotFound = 3,
    Unauthorized = 4,
    InvalidState = 5,
    MilestonesNotApproved = 6,
    DeadlineNotPassed = 7,
    InsufficientFunds = 8,
}

# Governor: Execution Authorization Model

## Problem

`execute()` on the governor contract previously accepted any authenticated
`caller: Address` and only verified `caller.require_auth()`. That call
proves the caller signed the transaction, not that the caller is entitled to
execute the proposal. Because proposal state (votes, thresholds, outcome) is
all readable on-chain, any address could watch for a proposal crossing into
`Active` with `for_votes > against_votes` and execute it themselves,
front-running whichever party the community expected to trigger execution.

## Model

Execution of a proposal via `execute(caller, proposal_id)` is now restricted
to one of three roles:

1. **Admin** — the address stored under `DataKey::Admin` at
   `initialize`/`migrate` time. Always permitted to execute any proposal.
2. **Proposer** — the address that created the specific proposal being
   executed (`proposal.proposer`). A proposer can always execute their own
   passing proposal.
3. **Explicit allowlist** — additional addresses the admin grants via
   `add_executor(admin, executor)` and revokes via
   `remove_executor(admin, executor)`. This supports delegating execution to
   a relayer, multisig signer, or automation address without granting full
   admin rights. The allowlist is stored under `DataKey::Executors` as a
   `Map<Address, bool>`.

Any other caller causes `execute` to panic with `"unauthorized executor"`
before any proposal state is mutated.

`is_executor(proposal_id, executor) -> bool` is exposed as a read-only
helper so callers (UIs, relayers) can check eligibility before submitting a
transaction, without needing to reconstruct the authorization logic
off-chain.

## Why this model (not a single fixed role)

- Restricting to **admin only** would recreate a single point of failure and
  require the admin to babysit every passing proposal.
- Restricting to **proposer only** would strand a proposal if the proposer
  goes offline after the vote succeeds.
- The **admin + proposer + allowlist** combination keeps the common cases
  (admin operations, proposers finishing what they started) permissionless
  from an extra-grant standpoint, while still letting governance delegate
  execution broadly (e.g., to a keeper bot) when desired — all changes to
  the allowlist require admin authorization and are enforced on-chain.

## Out of scope

- Off-chain relayer design (how a keeper/relayer service selects which
  passing proposals to submit) is not addressed here — this issue only
  gates who is *authorized* to call `execute` on-chain.
- Time-locked executors (e.g., allowlist entries that expire or activate
  after a delay) are not implemented.
- Cross-contract execution / arbitrary calldata execution is unchanged;
  `execute` continues to only perform the two built-in `ProposalAction`
  variants.

## Compatibility

- `propose()`, `cast_vote()`, and `get_proposal()` signatures and behavior
  are unchanged.
- `execute(caller, proposal_id)` keeps its existing signature; the added
  restriction only narrows which `caller` values succeed.
- `migrate()` backfills an empty `Executors` map for contracts deployed
  before this change, and `STORAGE_VERSION`/`VERSION` were bumped to `3` to
  reflect the new storage key.

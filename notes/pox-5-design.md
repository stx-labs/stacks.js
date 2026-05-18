# PoX-5 Design

PoX-5 is the bootstrap phase of Bitcoin Staking on Stacks. Participants commit
BTC and STX together as a "protocol bond" to earn BTC-denominated yield, with
self-custody of BTC throughout. STX-only staking remains supported on standard
signer cycles. This document is the steady-state protocol reference: the BTC
locking-script layout, bonding/cycle mechanics, signer-manager model,
watchdog/early-exit roles, contract data structures, and key constants.

References used: Waterfall White Paper §3.1, §3.2, §3.4, §4; Launch Scope §2,
§3, §4; `pox-5-docs/contract` data-structure.

---

## Time units and constants

| Constant | Value | Notes |
| --- | --- | --- |
| `BOND_LENGTH_CYCLES` | 12 | Bond covers 12 signer cycles (25,200 blocks, ~6 months). |
| `BOND_GAP_CYCLES` | 2 | New bond opens every 2 signer cycles (4,200 blocks, ~monthly). |
| `MAX_NUM_CYCLES` | 96 | STX-only stake cap. |
| `SIGNER_SET_MIN_USTX` | 50,000 STX | Signer-set inclusion threshold; also the solo STX-only minimum. |
| `RESERVE_RATIO` | 1500 bps (15%) | Share of cycle excess routed to reserve. |
| `PRECISION` | 1e18 | Reward-per-share fixed-point base. |

Derived cadence:

- Signer cycle = 2,100 burn blocks (~14 days). Existing PoX unit; signer set
  updates and STX-only enrollment ride this cadence.
- Bonding period = 25,200 burn blocks (~6 months) = 12 signer cycles. Six bond
  periods run concurrently, each opening every 2 cycles (~monthly).
- Reward distribution = 1,050 burn blocks (~1 week), i.e. twice per signer
  cycle. 24 distributions per bond.
- L1 timelock expires at D172 (~10 days before L2 STX unlock at D182), giving
  participants a renewal window.

---

## L1 locking script

Locks are a P2WSH locking script that encodes the staker's Stacks principal,
the locking duration via `OP_CHECKLOCKTIMEVERIFY`, and an arbitrary unlock
script (which carries the early-exit branch when enabled).

Unlock-script layout (per White Paper §3.1):

```
# first, the stacks address (24 total bytes)
OP_PUSH_22                                   # 0x16
05${addrVersion}${addrHashBytes}             # 22 bytes
OP_DROP                                      # 0x75

# next, the lock (6 total bytes)
OP_PUSH3                                     # 0x03
${unlockHeight}                              # 3 bytes, little-endian
OP_CHECKLOCKTIMEVERIFY                       # 0xB1
OP_DROP                                      # 0x75

# finally, the unlock script
# arbitrary, up to 255 bytes
```

Notes:

- The above layout assumes the `CScriptNum` height is encoded as exactly 3
  bytes. On mainnet, `unlockHeight` will always be 3 bytes for the next
  ~100 years. On testnets it is often shorter.
- The unlock script tail is where early-exit-enabled bonds bake in the
  pre-authorized early-exit branch (see "Early exit" below). Default unlock
  is `<pubkey> CHECKSIG`.
- The on-chain Stacks node monitors L1 for P2WSH outputs matching registered
  L2 commitments to determine eligibility and reward allocation.

### Why the L1 unlock height sits halfway through the last cycle

We balance two requirements:

- The user needs a window to re-lock their BTC without missing a cycle.
- We do not want a "free rider" who barely locks BTC at all.

Without the offset, a user could lock at block N-1 of one cycle and unlock at
block N+1 of the next, locking BTC for ~102 of ~2,100 blocks. Setting unlock
to halfway through the last cycle closes that gap.

---

## Bonding period mechanics

Each bonding period follows the same sequence:

1. **~7 days before opening:** capacity, ratio, and target APY are published
   on-chain by the Endowment via `setup-bond`. The whitelist (Stacks
   principals + max sats) is seeded.
2. **Auction / allocation clears.** In PoX-5 the Endowment allocates capacity
   to whitelisted partners directly; ~10% of Tranche 1 capacity is reserved
   for community pools.
3. **Day 0 (D0):** all paired BTC + STX must be locked by this height to be
   eligible.
4. **Day 172:** L1 BTC timelock expires. ~10-day re-lock window opens.
5. **Day 182:** STX lock expires on L2.

Six bond periods run in parallel, each opening every 2 signer cycles. STX-only
staking ignores bond periods and follows standard signer cycles.

### Ratio requirement

During PoX-5 the STX:BTC ratio is static, set per period by the Endowment
(working value 5%). The required STX is computed at lock time using a
trailing-average STX/BTC exchange rate derived from on-chain miner bid data.
The contract enforces `stxLocked / btcLocked >= ratio` at registration.

### Waterfall yield distribution

1. **Tranche 1** — paired BTC at or above ratio earns the target APY for the
   period. ~10% of T1 capacity is reserved for community pools.
2. **Tranche 2** — cycle excess is split: 15% (`RESERVE_RATIO`) to the
   reserve fund, 85% to T3.
3. **Tranche 3** — STX-only stakers receive the remainder pro rata.

Drawdown priority within T1: positions with the highest STX market price at
lock time absorb shortfalls first. Price reference is the trailing-average
implied STX/BTC rate from miner bids at L2 commitment time.

The reserve fund is held in two sleeves (BTC + USD); contributions are split
at deposit. BTC sleeve drawn first; USD is the last line of defense. PoX-5
reserve is **accrual-only** — no consensus-external draw path.

---

## Early exit

Bonds may include a pre-authorized early-exit branch in the L1 timelock,
co-signed by a 1-of-N AWS multisig (the Early Exit signer set). A coordinator
service routes exit requests; a manual-fallback runbook backs the AWS path.

Forfeiture rules:

- Participant forfeits all remaining BTC yield for the bond period.
- Paired STX **stays locked** for the full bond term and earns no yield (does
  not convert to a T3 STX-only position).

Reference: White Paper §3.2, Launch Scope §2, D20.

---

## Andon Cord (payout pause)

A 3-of-5 multisig can pause a scheduled weekly payout within a 250-block
window. Payout at burn height X uses snapshot data from X−250; automation
fires at X+1, giving the multisig 250 blocks to pause if anything looks
wrong. Pause cannot redirect — only halt. Restoring a paused payout may
require a hard fork.

Reference: White Paper §4.4, Launch Scope D19.

---

## Watchdog (L1 lock-status monitor)

Anyone can post a Bitcoin proof that a tracked L1 UTXO has been spent
before its timelock expired. The first valid proof receives compensation.
Watchdog state is honored at each T1 payout — a position with a spent UTXO
is removed from T1 eligibility. Reference: Launch Scope D21.

---

## Signer-manager model

Signers are represented by a **signer-manager** contract, not a raw signer
principal. The manager contract decides who is allowed to stake against its
signer key by implementing the `signer-manager-trait`:

```clarity
(define-trait signer-manager-trait (
  (validate-stake!
    ;; caller, amount-ustx, num-cycles, signer-calldata
    (principal uint uint (optional (buff 256)))
    (response bool uint)
  )
))
```

PoX-5 calls `validate-stake!` on the signer-manager during `stake`,
`stake-update`, and `register-for-bond`. The manager contract may approve
public participation, gate on a whitelist, charge fees, or otherwise
constrain access. This **replaces the per-tx SIP-018 signer authorization**
used in earlier PoX versions for the common path. One-off SIP-018
authorizations remain in the codebase but are not invoked by the standard
contract calls.

### Signer-key grants

A signer key is bound to its signer-manager via `grant-signer-key`. Grants
are keyed on `(signer-key, signer-manager)` — not `(signer-key, staker)`.
The grant message signed by the signer key is:

```
{
    topic: "grant-authorization",
    signer-manager: principal,
    auth-id: uint,
}
```

There is no `pox-address` field — pool reward addresses are tracked
separately by the signer-manager / pool operator, not by the grant.

`revoke-signer-grant` takes the same `(signer-manager, signer-key)` pair.

`register-signer(signer-manager, signer-key)` — the signer-manager contract
registers itself with PoX-5; gated by an existing
`(signer-key, signer-manager)` grant.

---

## Public functions

| Function | Purpose |
| --- | --- |
| `set-bond-admin(new-admin)` | Rotates the `bond-admin` data-var. Only the current `bond-admin` may call (`contract-caller == bond-admin`). |
| `setup-bond(bond-index, target-rate, stx-value-ratio, min-ustx-ratio, early-unlock-signers, allowlist)` | Admin-only. Configures a bond period and seeds its `(staker, max-sats)` allowlist. `early-unlock-signers` is a 683-byte buffer carrying the multisig descriptor used in the L1 early-exit branch. |
| `register-for-bond(bond-index, signer-manager, amount-ustx, btc-lockup, signer-calldata)` | Enters a paired bond. `btc-lockup` is `(response {outputs, unlock-bytes} sats-amount)`: `ok` ⇒ L1-paired (BTC), `err` ⇒ sBTC-paired. Caller must already be on the bond's allowlist. Authorization runs through the signer-manager's `validate-stake!`. `ok` returns `{ signer, staker, amount-ustx, bond-index, first-reward-cycle, unlock-burn-height, unlock-cycle }` — the enrollment receipt. |
| `register-signer(signer-manager, signer-key)` | Signer-manager registers itself; requires a prior `grant-signer-key`. |
| `stake(signer-manager, amount-ustx, num-cycles, start-burn-ht, signer-calldata)` | STX-only entry. No `pox-address`, no per-tx signer signature, no `max-amount`, no `auth-id`, no `unlock-bytes`. Authorization runs through `validate-stake!`. `start-burn-ht` prevents replay across cycles, as in prior PoX versions. |
| `stake-update(signer-manager, cycles-to-extend, amount-increase, signer-calldata)` | Unified extend + increase + re-signer for STX-only positions. Replaces the older `stake-extend` / `stake-update` / `stake-extend-pooled` / `stake-update-pooled` family. |
| `unstake()` | Sets STX to unlock at the end of the current cycle. Disallowed during the prepare phase. |
| `calculate-rewards(bond-periods)` | Per-distribution-cycle bookkeeping. Iterates active bonds in descending `stx-value-ratio` order (drawdown priority), pays each up to its target APY from accrued sBTC, routes 15% of the cycle excess to reserve, distributes the remainder pro rata to STX-only stakers. Anyone can call. |
| `claim-rewards(bond-periods, reward-cycle)` | Called by the contract-caller (typically the signer-manager); pulls accumulated sBTC for the caller's signer share. |
| `grant-signer-key(signer-key, signer-manager, auth-id, signer-sig)` | See "Signer-key grants" above. |
| `revoke-signer-grant(signer-manager, signer-key)` | Revokes a grant. |
| `allow-contract-caller` / `disallow-contract-caller` | Contract-caller allowlist for delegated calls; supports optional expiry burn height. |

### Pooled participation

There is no separate `stake-pooled` / `stake-extend-pooled` / `stake-update-pooled`
family in PoX-5. Pool participation is expressed by passing a pool-managed
signer-manager to `stake` / `stake-update` / `register-for-bond`. The
pool's `validate-stake!` decides whether to admit the caller. Pool reward
address and signer key are managed inside the signer-manager / pool contract,
so members do not need to update individual records when those rotate.

For paired bonds inside a community pool, **sBTC is held inside the pool
contract** for the bond period and is not composable during the bond.

### Reward-asset election

Default reward delivery is sBTC via auto-bridge. L1 BTC delivery is opt-out,
routed through the sBTC signer set off-chain. Election is mutable per
position, changeable before the next prepare phase with no skipped cycle
(same cadence as reward-address and signer-key changes).

---

## Read-only functions

The contract exposes the bond-period and reward-accounting reads partner
SDKs need:

- `get-pox-info` — pox parameters, including `min-amount-ustx = SIGNER_SET_MIN_USTX`.
- `bond-period-to-burn-height(bond-index)` / `bond-period-to-reward-cycle(bond-index)`.
- `burn-height-to-reward-cycle(height)` / `reward-cycle-to-burn-height(cycle)`.
- `reward-cycle-to-unlock-height(cycle)` — halfway through the cycle.
- `current-pox-reward-cycle()`.
- `burn-height-to-distribution-index(height)` / `current-distribution-cycle()` /
  `distribution-cycle-to-burn-height(cycle)` — distributions are twice per
  cycle (every `pox-reward-cycle-length / 2` blocks ≈ 1,050).
- `is-in-prepare-phase(cycle)`.
- `is-bond-active-at-height(bond-index, calculation-height)`.
- `get-bond-allowance(bond-index, staker)` — partner allocation.
- `get-bond-membership(staker)` — paired-bond position.
- `get-staker-info(staker)` — STX-only position.
- `get-claimable-rewards(signer, index, is-bond)`.
- `get-rewards()` / `get-new-rewards()` — total / unaccounted sBTC in the
  contract.
- `get-reserve-balance()`.
- `get-total-sats-staked()` / `get-total-sats-staked-for-bond(bond-index)`.
- `get-rewards-per-token-for-cycle({index, is-bond})`,
  `get-total-shares-staked-for-cycle({index, is-bond})`,
  `get-signer-shares-staked-for-cycle({index, is-bond, signer})`,
  `get-signer-rewards-paid-for-cycle({index, is-bond, signer})`.
- `min-ustx-for-sats-amount(sats, stx-value-ratio, min-ustx-ratio)` — the
  on-chain ratio quoting helper. Use this rather than re-implementing the
  STX-for-BTC quote client-side.

---

## Data structures

### Data vars

- `bond-admin` — principal allowed to call `setup-bond`. Initialized at
  deploy to a mainnet burn placeholder (`'SP000000000000000000002Q6VF78`);
  the role is expected to be transferred to a multisig via
  `set-bond-admin` before any `setup-bond` call. On non-mainnet networks
  the node rewrites the literal at deploy.
- `pox-prepare-cycle-length` / `pox-reward-cycle-length` — cycle lengths.
- `first-burnchain-block-height` — anchor for burn-height ↔ cycle conversion.
- `configured` — one-time burnchain parameter setup flag.
- `first-pox-5-reward-cycle` — configured PoX-5 start cycle.
- `first-bond-period-cycle` — anchor for bond index ↔ reward cycle conversion.
- `last-accounted-rewards-only` / `last-reward-compute-height` — reward-loop
  cursors.
- `reserve-balance` — accumulated reserve sBTC; excluded from `get-rewards`.
- `total-sats-staked` — lifetime sBTC locked via `lock-sbtc`.

### Protocol-bond maps

- `protocol-bonds` — per-bond configuration written by `setup-bond`.
- `protocol-bond-allowances` — per-staker max sats per bond.
- `protocol-bond-memberships` — active membership and reward snapshot.
- `protocol-bonds-total-staked` — total sats per bond index.

### Signer maps

- `signers` — signer-manager principal → active signer key.
- `signer-keys` — staker / signer principal → signer key.
- `signer-key-grants` — grant records keyed on `(signer-key, signer-manager)`.
- `used-signer-key-grants` — grant-signature replay protection.
- `used-signer-key-authorizations` — one-off authorization replay protection.

### Staker / cycle membership

- `staker-info` — STX-only staker amount, first reward cycle, num cycles.
- `staker-signer-cycle-memberships` — staker's signer + amount per cycle.
- `signer-delegated-per-cycle` — total uSTX delegated to a signer per cycle.
- `signer-pending-staked-ustx-per-cycle` — STX-only pending delegation
  before signer-set threshold filtering.
- `ustx-delegated-per-cycle` — total uSTX delegated across all signers per
  cycle.

### Reward accounting

- `rewards-per-token-for-cycle` — cumulative rewards-per-share per
  `(index, is-bond)`.
- `total-shares-staked-for-cycle` — sats for bonds, uSTX for STX-only cycles.
- `signer-shares-staked-for-cycle` — per-signer share count.
- `signer-rewards-paid-for-cycle` — per-signer paid amount.

### Caller allowance

- `allowance-contract-callers` — delegated caller permissions, optionally
  expiring at a burn height.

### Per-cycle staker linked list

A doubly linked list per cycle gives the contract and indexers an ordered,
traversable set of stakers without storing an unbounded list in a single
value.

```
cycle
  first -> staker A <-> staker B <-> staker C <- last
```

- `staker-set-ll-first-for-cycle[cycle]` — first staker.
- `staker-set-ll-last-for-cycle[cycle]` — last staker.
- `staker-set-ll-for-cycle[{cycle, staker}]` — `{ prev, next }` node.

Insert appends to the tail and updates the cycle's last pointer; remove
rewires neighbors and updates first/last when the removed staker was at an
end. Indexers should drive off events rather than walk the list at read
time.

---

## STX-only staking improvements (carried forward)

- Cooldown removed: signer-key and reward-address changes take effect at
  the next prepare phase, no skipped cycle.
- Solo minimum is `SIGNER_SET_MIN_USTX` (50,000 STX); pooled participation
  has no minimum.
- Pool delegation no longer requires a per-cycle operator commit (the
  PoX-4 `stack-aggregation-commit` cadence is gone).
- T3 yield is routed pro rata to STX-only stakers via `calculate-rewards`.

---

## Incremental reward-set caching

The introduction of L1 lockups creates per-user state (BTC amount, BTC
script) that cannot be reconstructed in Clarity at reward-set computation
time. The Stacks node maintains a fork-aware table keyed on
`[rewardCycle, stxAddress]` with `stxAmount`, `btcAmount`, `btcLockupScript`.
Each new sortition handler:

- Processes L2 transactions (`pox-5` calls) that insert/update stakers,
  retroactively backfilling `btcAmount` from prior L1 lockups.
- Processes L1 transactions: when a P2WSH output matches a registered
  unlock script, the row's `btcAmount` is updated.

This complements the existing PoX-5 incremental work for STX:BTC ratio
caching and P2WSH output tracking.

---

## PoX-4 → PoX-5 transition

PoX-4 → PoX-5 is **non-parallel**: at the hard fork, all PoX-4 locks
release and participants must re-enroll under PoX-5. Hard-fork activation
is gated on a minimum committed STX amount specified in the SIP. Cooldown
removal and streamlined pool commitments carry forward into PoX-6.

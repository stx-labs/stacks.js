# PoX-5 User Flows — Bitcoin Staking (Waterfall Model)

How each stakeholder interacts with PoX-5, written as SDK-level pseudocode.
Function names follow the `@stacks/bitcoin-staking` `build*` / `fetch*`
convention. For contract internals see `pox-5-design.md`; for package layout
see `staking-package-design.md`. The source of truth for flows and parameters
is `staking-design/latest/`.

## Constants

- `BOND_LENGTH_CYCLES = 12` — paired-BTC bond is 12 reward cycles (~6 months).
- `BOND_GAP_CYCLES = 2` — gap between back-to-back bond periods.
- `MAX_NUM_CYCLES = 96` — hard cap on STX-only `numCycles`.
- `SIGNER_SET_MIN_USTX = 50_000 STX` — minimum signer-managed amount.

## Annotation legend

- `// [OK]` — works against the current SDK + contract.
- `// [MISSING]` — proposed builder/fetcher; not yet shipped.
- `// [UNCLEAR]` — pending design decision.
- `// [UPSTREAM]` — adjacent system (payout contract, partner API, early-exit
  signer service); listed for completeness.

## Surface model (cheat sheet)

The PoX-5 contract exposes two enrollment paths:

1. **`register-for-bond`** — paired-BTC (or sBTC-locked) participation in a
   protocol bond. Enrollment is allowlisted. Requires a registered
   signer-manager contract that implements `validate-stake!`. Wrapped by
   `buildRegisterForBond`.
2. **`stake`** — STX-only participation, 1 cycle to `MAX_NUM_CYCLES`. Also
   requires a registered signer-manager. Wrapped by `buildStake`.

Both paths flow through a **signer-manager** contract: a Clarity contract
that implements `signer-manager-trait` and is registered via `register-signer`
(after a `grant-signer-key` from the signer key holder). A solo staker runs
their own minimal signer-manager; a pool operator runs a signer-manager that
admits multiple members. There is no separate `register-pool` — pools *are*
signer-managers.

`stake-update` is unified: it changes signer, extends the lock, and/or
increases the locked amount in a single call. There are no separate
`stake-extend` / `stake-update-pooled` / `stake-extend-pooled` entry points.

Per-tx SIP-018 signer authorization (`Pox5SignatureTopic`,
`signPox5Authorization`) is gone. The signer-manager's `validate-stake!`
callback gates each enrollment / update. The SDK still wraps any signing the
manager contract requires — solo signers typically pre-authorize via
`grant-signer-key`, after which no per-tx signature is needed.

## Conventions

- `NET = 'mainnet'` — swap for `'testnet'` / `'devnet'` as needed.
- Every flow assumes the unsigned tx is signed with `TransactionSigner` and
  broadcast with `broadcastTransaction` from `@stacks/transactions`. Omitted
  for brevity after the first example.
- "Bond period" = `BOND_LENGTH_CYCLES` (12) reward cycles, ~6 months.

## Dramatis personae

- `alice` — solo whitelisted partner; runs her own signer-manager; 25 BTC allocation.
- `bob` — retail user joining a whitelisted BTC-capacity pool.
- `carla` — exchange/custodian onboarding clients 1:1.
- `dana` — sBTC holder participating via an sBTC pool.
- `eve` — pool operator running a whitelisted BTC-capacity pool (signer-manager contract).
- `faythe` — STX-only staker (Tranche 3).
- `ops` — Stacks Labs / Endowment operations (pause key, watchdog poster).

---

## Prerequisites

A staker needs:

- A Stacks wallet (STX address + private key).
- A Bitcoin wallet able to send L1 timelocked transactions (paired-BTC paths
  only).
- STX to lock at the bond's static ratio.
- BTC to lock on L1 *or* sBTC to lock in the contract (paired paths only).
- A signer-manager contract — own contract for solo, pool's contract for
  pooled.

---

## Journey 1 — Solo Staker (Alice, paired BTC)

### 1a. Pre-bond-period lookahead (T−7 days)

Acceptance: views upcoming bond-period parameters (capacity, target APY,
static ratio) ~7 days before open; draws from pre-negotiated allocation.

```ts
import {
  fetchPoxInfo,
  // [MISSING] fetchBondPeriod,
  // [MISSING] fetchPartnerAllocation,
} from '@stacks/bitcoin-staking';

async function aliceLookahead() {
  const network = 'mainnet';

  const pox = await fetchPoxInfo({ network });                              // [OK]

  // [MISSING] capacity, ratio (e.g. 5%), target APY, enrollment window,
  // status: 'announced' | 'enrolling' | 'active' | 'closed'.
  const upcoming = await fetchBondPeriod({ network, cycleOffset: +1 });

  // [MISSING] partner allowlist + per-address BTC allocation
  // (configured by Endowment via setup-bond).
  const allocation = await fetchPartnerAllocation({
    network, partner: alice.stxAddress, bondPeriodId: upcoming.id,
  });

  return {
    bondPeriodId: upcoming.id,
    openBurnHeight: upcoming.openBurnHeight,
    capacityBtc: upcoming.capacityBtc,
    ratioBps: upcoming.ratioBps,
    targetApyBps: upcoming.targetApyBps,
    allocatedSats: allocation.allocatedSats,
    status: upcoming.status,
  };
}
```

### 1b. Register signer-manager (one-time setup)

Before her first bond, Alice deploys a minimal signer-manager contract (one
that admits only her), grants it permission to use her signer key, and
registers it with PoX-5.

```ts
import {
  buildGrantSignerKey,
  buildRegisterSigner,
  signSignerKeyGrant,
} from '@stacks/bitcoin-staking';

async function aliceRegisterSigner() {
  const network = 'mainnet';

  // 1. Signer key holder authorizes the signer-manager contract.
  const grantSig = signSignerKeyGrant({                                     // [OK]
    signerManager: alice.signerManagerContract,  // her deployed manager
    authId: 1n,
    network,
    privateKey: alice.signerPrivateKey,
  });

  // 2. Record the grant on-chain.
  const unsignedGrant = await buildGrantSignerKey({                         // [OK]
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 0, network,
    signerKey: alice.signerPubKey,
    signerManager: alice.signerManagerContract,
    signerSignature: grantSig,
    authId: 1n,
  });

  // 3. The signer-manager contract calls `register-signer` itself
  //    (must be tx-sender = signer-manager principal).
  const unsignedRegister = await buildRegisterSigner({                      // [OK]
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 1, network,
    signerKey: alice.signerPubKey,
    signerManager: alice.signerManagerContract,
  });

  return { unsignedGrant, unsignedRegister };
}
```

Note: `grant-signer-key` is keyed on `(signerKey, signerManager, authId)` —
the grant authorizes a *contract*, not a specific staker.

### 1c. Enroll (paired-BTC: register-for-bond + L1 lock)

Acceptance: lock STX at static ratio + broadcast timelocked UTXO before D0.

```ts
import {
  buildDefaultUnlockScript,
  buildLockingBitcoinAddress,
  buildRegisterForBond,
  computeUnlockHeight,
  fetchPoxInfo,
  // [MISSING] fetchBondPeriod,
  // [MISSING] quoteStxForBtc,        // wraps `min-ustx-for-sats-amount`
  // [MISSING] buildElectRewardAsset,
} from '@stacks/bitcoin-staking';

async function aliceEnroll() {
  const network = 'mainnet';
  const pox = await fetchPoxInfo({ network });                              // [OK]
  const bond = await fetchBondPeriod({ network, cycleOffset: +1 });         // [MISSING]

  // Paired BTC commitment is fixed at one bond period.
  const numCycles = BOND_LENGTH_CYCLES;  // 12

  // Client-side ratio pre-check; mirrors `min-ustx-for-sats-amount`.
  const requiredUstx = await quoteStxForBtc({                               // [MISSING]
    network,
    btcSats: 25n * 100_000_000n,
    bondPeriodId: bond.id,
  });

  // --- L1 construction ---------------------------------------------------
  const unlockBytes = buildDefaultUnlockScript(alice.btcPubKey);            // [OK]
  const unlockHeight = computeUnlockHeight({                                // [OK]
    firstBurnchainBlockHeight: pox.firstBurnchainBlockHeight,
    rewardCycleLength: pox.rewardCycleLength,
    firstRewardCycle: bond.firstRewardCycle,
    numCycles,
  });
  const lockingAddress = buildLockingBitcoinAddress({                       // [OK]
    stxAddress: alice.stxAddress,
    unlockHeight,
    unlockBytes,
    network,
  });
  // Alice now sends 25 BTC to `lockingAddress` from her BTC wallet.

  // --- L2 register-for-bond ---------------------------------------------
  // No per-tx SIP-018 sig: validate-stake! on her signer-manager runs
  // server-side as part of the contract call.
  const unsignedRegister = await buildRegisterForBond({                     // [OK]
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 2, network,
    bondPeriodId: bond.id,
    amountUstx: requiredUstx,
    poxAddress: alice.rewardBtcAddress,
    signerManager: alice.signerManagerContract,
    bondPeriod: BOND_LENGTH_CYCLES,
    unlockBytes,
    btcLockTxid: undefined,        // node verifies the L1 UTXO post-broadcast
    sbtcSats: 0n,                  // paired-BTC path (not sBTC-locked)
    callData: new Uint8Array(0),   // passed to validate-stake!
  });

  // [MISSING] Per-position reward-asset election. Default is sBTC; opt-out
  // to L1 BTC.
  const unsignedElect = await buildElectRewardAsset({
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 3, network,
    asset: 'sbtc',
  });

  return { lockingAddress, unsignedRegister, unsignedElect };
}
```

### 1d. Change signer mid-bond (no cooldown before prepare phase)

Acceptance: change signer before any cycle's prepare phase, no cooldown. For
paired bonds the staker is bound to her signer-manager for the bond period;
this flow applies to STX-only stakers (see Journey 5). For paired bonds, key
rotation happens by re-pointing the signer-manager's stored signer key —
that is a manager-internal concern, not a PoX-5 call.

### 1e. Weekly reward claim (sBTC-denominated)

Acceptance: receive weekly rewards through the reward contract.

`calculate-rewards` is called once per distribution cycle (anyone can call,
gated by a 250-block delay — see Andon cord below). `claim-rewards` is
called by the **signer** for a list of bond periods + reward cycles, and
transfers sBTC to the caller. End-user claim flows depend on the
signer-manager's distribution policy (sBTC pull vs. push, BTC bridging).

```ts
import {
  buildClaimRewards,
  buildCalculateRewards,
  fetchClaimableRewards,
  fetchNewRewards,
  fetchPoxInfo,
  currentDistributionCycle,
} from '@stacks/bitcoin-staking';

async function signerClaimWeekly() {
  const network = 'mainnet';

  const poxInfo = await fetchPoxInfo({ network });                          // [OK]
  const distCycle = currentDistributionCycle(poxInfo);                      // [OK]
  const newRewards = await fetchNewRewards({ network });                    // [OK]

  // Trigger the per-cycle reward calculation if not yet done.
  // Anyone can call. Gated by `current-distribution-cycle` >= X+250.
  const unsignedCalc = await buildCalculateRewards({                        // [OK]
    publicKey: ops.stxPublicKey,
    fee: 1000, nonce: 0, network,
    activeBondPeriodIds: newRewards.activeBondPeriodIds,
  });

  const claimable = await fetchClaimableRewards({                           // [OK]
    network,
    signer: alice.signerPubKey,
    rewardCycle: distCycle - 1,
    bondPeriodIds: alice.activeBondPeriodIds,
  });
  if (claimable.sats === 0n) return null;

  const unsignedClaim = await buildClaimRewards({                           // [OK]
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 1, network,
    rewardCycle: distCycle - 1,
    bondPeriodIds: alice.activeBondPeriodIds,
  });

  // Onward distribution to the staker (sBTC transfer, optional BTC bridge)
  // is the signer-manager's responsibility.
  return { unsignedCalc, unsignedClaim };
}
```

End-user reads:

```ts
// [MISSING] Per-staker payout history view (computed off-chain from claim
// events). Useful for the Partner Dashboard "reconcile expected vs received"
// criterion.
fetchPayoutHistory({ network, staker })
```

### 1f. Renewal (two transactions)

Acceptance: extend into the next bond period during the final reward cycles
(L1 expiry is ~10 days before bond-period end). Renewal is a fresh
`register-for-bond` for the next period; there is no `stake-extend` for
paired bonds.

```ts
async function aliceRenew() {
  const network = 'mainnet';
  const pox = await fetchPoxInfo({ network });                              // [OK]
  const next = await fetchBondPeriod({ network, cycleOffset: +1 });         // [MISSING]

  const numCycles = BOND_LENGTH_CYCLES;
  const unlockBytes = buildDefaultUnlockScript(alice.btcPubKey);            // [OK]
  const unlockHeight = computeUnlockHeight({                                // [OK]
    firstBurnchainBlockHeight: pox.firstBurnchainBlockHeight,
    rewardCycleLength: pox.rewardCycleLength,
    firstRewardCycle: next.firstRewardCycle,
    numCycles,
  });
  const newLockingAddress = buildLockingBitcoinAddress({                    // [OK]
    stxAddress: alice.stxAddress, unlockHeight, unlockBytes, network,
  });
  // Alice spends her unlocked BTC into newLockingAddress.

  const unsignedRegister = await buildRegisterForBond({                     // [OK]
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 9, network,
    bondPeriodId: next.id,
    amountUstx: alice.lockedUstx,    // can adjust
    poxAddress: alice.rewardBtcAddress,
    signerManager: alice.signerManagerContract,
    bondPeriod: BOND_LENGTH_CYCLES,
    unlockBytes,
    sbtcSats: 0n,
    callData: new Uint8Array(0),
  });

  return { newLockingAddress, unsignedRegister };
}
```

Note: between bond periods there is a `BOND_GAP_CYCLES = 2` cycle gap.

### 1g. Early exit (forfeit remaining BTC yield; STX stays locked)

Acceptance: exit early via co-signed BTC transaction; remaining BTC yield is
forfeited; paired STX stays locked and earns nothing for the rest of the
bond. Co-signer is a 1-of-N multisig run by the early-exit signer service.

The L1 unlock script is chosen at enroll time:

```ts
async function aliceEnrollWithEarlyExitEnabled() {
  // [MISSING] script with two branches:
  //   IF <user pubkey> CHECKSIG ELSE <signer-set multisig + hashlock> ENDIF
  // [UNCLEAR] exact script encoding.
  const unlockBytes = buildEarlyExitUnlockScript({
    userPubKey: alice.btcPubKey,
    signerSetDescriptor: bond.earlyExitSignerDescriptor,
    spendHash: alice.preapprovedSpendHash,
  });
  // ...feed unlockBytes into buildLockingBitcoinAddress + buildRegisterForBond
  // exactly as in 1c.
}

async function aliceEarlyExit() {
  const network = 'mainnet';

  // 1. L2 request — flags the position for forfeit.
  const unsignedRequest = await buildEarlyExitRequest({                     // [MISSING]
    publicKey: alice.stxPublicKey,
    fee: 1000, nonce: 11, network,
  });

  // 2. Signer service observes the event; assembles the co-signed BTC tx.
  const status = await fetchEarlyExitStatus({                               // [MISSING]
    network, staker: alice.stxAddress,
  });
  const btcTx = await earlyExitSignerClient.fetchCosignedSpend({            // [UPSTREAM]
    staker: alice.stxAddress,
  });

  // 3. Alice broadcasts the BTC tx (or the service does).
  // Paired STX remains locked until natural unlock; weekly payouts stop.
  return { unsignedRequest, btcTx };
}
```

Missing surface: `buildEarlyExitUnlockScript`, `buildEarlyExitRequest`,
`fetchEarlyExitStatus`, plus an upstream `earlyExitSignerClient`.

---

## Journey 2 — BTC-Capacity Pool Member (Bob)

Bob joins a whitelisted pool. The pool is a signer-manager contract that
admits members and aggregates their BTC + STX into the bond.

```ts
import {
  buildDefaultUnlockScript,
  buildLockingBitcoinAddress,
  buildRegisterForBond,
  computeUnlockHeight,
  fetchPoxInfo,
  // [MISSING] fetchPool,
  // [MISSING] fetchPoolMembership,
} from '@stacks/bitcoin-staking';

async function bobEnrollInPool() {
  const network = 'mainnet';
  const pox = await fetchPoxInfo({ network });                              // [OK]

  // [MISSING] pool's signer-manager contract, shared PoX reward address,
  // remaining envelope, current per-user clearing ratio, bond timing.
  const pool = await fetchPool({ network, name: 'xyz-pool' });

  // [MISSING] is Bob admitted by the operator?
  const ok = await fetchPoolMembership({
    network, signerManager: pool.signerManagerContract, member: bob.stxAddress,
  });
  if (!ok.admitted) throw new Error('not admitted to pool');

  const numCycles = BOND_LENGTH_CYCLES;
  const unlockBytes = buildDefaultUnlockScript(bob.btcPubKey);              // [OK]
  const unlockHeight = computeUnlockHeight({                                // [OK]
    firstBurnchainBlockHeight: pox.firstBurnchainBlockHeight,
    rewardCycleLength: pox.rewardCycleLength,
    firstRewardCycle: pool.bondFirstRewardCycle,
    numCycles,
  });

  // L1 unlock script encodes Bob's stxAddress (per-member indexing); the
  // *reward* PoX address is the pool's shared address, set inside the pool
  // contract — it does not appear in this builder call.
  const lockingAddress = buildLockingBitcoinAddress({                       // [OK]
    stxAddress: bob.stxAddress, unlockHeight, unlockBytes, network,
  });
  // Bob sends his BTC to lockingAddress.

  // Pooled enrollment is the same `register-for-bond`, with the pool's
  // signer-manager. validate-stake! enforces operator admit + ratio.
  const unsigned = await buildRegisterForBond({                             // [OK]
    publicKey: bob.stxPublicKey,
    fee: 1000, nonce: 0, network,
    bondPeriodId: pool.bondPeriodId,
    amountUstx: bob.stxUstx,
    poxAddress: pool.sharedPoxAddress,
    signerManager: pool.signerManagerContract,
    bondPeriod: BOND_LENGTH_CYCLES,
    unlockBytes,
    sbtcSats: 0n,
    callData: pool.encodeMemberCallData(bob.stxAddress),  // pool-defined
  });

  return { lockingAddress, unsigned };
}
```

Missing: `fetchPool`, `fetchPoolMembership`. `buildRegisterForBond` is the
same builder used for solo — there is no `buildStakePooled`.

---

## Journey 3 — STX-Only Pool Member (Faythe, Tranche 3)

Effectively the PoX-4 pool model with a new reward source. 1-cycle minimum,
no L1 lock, signing rights unchanged. Members call `stake` (not
`register-for-bond`) through the pool's signer-manager.

```ts
import {
  buildStake,
  fetchPoxInfo,
  // [MISSING] fetchPool,
} from '@stacks/bitcoin-staking';

async function faytheStxOnlyPool() {
  const network = 'mainnet';
  const pox = await fetchPoxInfo({ network });                              // [OK]
  const pool = await fetchPool({ network, name: 'stx-only-pool' });         // [MISSING]

  const unsigned = await buildStake({                                       // [OK]
    publicKey: faythe.stxPublicKey,
    fee: 1000, nonce: 0, network,
    amountUstx: faythe.stxUstx,
    numCycles: 1,                          // 1..MAX_NUM_CYCLES (96)
    signerManager: pool.signerManagerContract,
    startBurnHt: pox.currentBurnchainBlockHeight,
    callData: pool.encodeMemberCallData(faythe.stxAddress),
  });
  return unsigned;
}
```

Solo STX-only is identical, with the staker's own signer-manager.

### Updates / extension / signer rotation (STX-only)

A single unified `stake-update` call handles signer rotation, lock extension,
and amount increase:

```ts
import { buildStakeUpdate } from '@stacks/bitcoin-staking';

async function faytheUpdate() {
  const unsigned = await buildStakeUpdate({                                 // [OK]
    publicKey: faythe.stxPublicKey,
    fee: 1000, nonce: 5, network: 'mainnet',
    amountUstxIncrease: 0n,                // optional increase
    extendCycles: 4,                       // optional extension
    signerManager: newSignerManagerContract, // optional rotation
    callData: new Uint8Array(0),
  });
  return unsigned;
}
```

No cooldown before prepare phase per the §9.7.3 STX-only improvements.

---

## Journey 4 — Pool Operator (Eve)

Acceptance: register PoX reward address (allowlist approved off-chain),
enroll members via the signer-manager, monitor commitments, distribute cycle
rewards, alert members ahead of L1 expiry.

```ts
import {
  buildGrantSignerKey,
  buildRegisterSigner,
  signSignerKeyGrant,
  // [MISSING] fetchPoolBondBook,
  // [MISSING] fetchPoolMembers,
  // [MISSING] buildPoolDistribute,
} from '@stacks/bitcoin-staking';

async function eveOnboardPool() {
  const network = 'mainnet';

  // 1. Eve deploys her pool signer-manager contract (out-of-band).
  // 2. Signer key holder grants the manager permission.
  const grantSig = signSignerKeyGrant({                                     // [OK]
    signerManager: eve.poolSignerManagerContract,
    authId: 1n,
    network,
    privateKey: eve.signerPrivateKey,
  });
  const unsignedGrant = await buildGrantSignerKey({                         // [OK]
    publicKey: eve.stxPublicKey,
    fee: 1000, nonce: 0, network,
    signerKey: eve.signerPubKey,
    signerManager: eve.poolSignerManagerContract,
    signerSignature: grantSig,
    authId: 1n,
  });
  // 3. The pool manager registers itself.
  const unsignedRegister = await buildRegisterSigner({                      // [OK]
    publicKey: eve.stxPublicKey,
    fee: 1000, nonce: 1, network,
    signerKey: eve.signerPubKey,
    signerManager: eve.poolSignerManagerContract,
  });
  // 4. Endowment whitelists her contract for `setup-bond` allocation
  //    (off-chain process; result is reflected in a future setup-bond call).

  return { unsignedGrant, unsignedRegister };
}

async function eveMonitorBook(bondPeriodId: number) {
  // [MISSING] operator dashboard read.
  return fetchPoolBondBook({
    network: 'mainnet',
    signerManager: eve.poolSignerManagerContract,
    bondPeriodId,
  });
}

async function eveDistribute(rewardCycle: number) {
  // Pool collected sBTC via signer's claim-rewards (see 1e). Eve distributes
  // pro-rata. Implementation is pool-defined: off-chain BTC sends or an
  // on-chain sBTC payout contract.
  return buildPoolDistribute({                                              // [MISSING]
    publicKey: eve.stxPublicKey,
    fee: 1000, nonce: 5, network: 'mainnet',
    rewardCycle,
    memberPayouts: /* computed from fetchPoolBondBook */ [],
  });
}
```

Missing: `fetchPoolBondBook`, `fetchPoolMembers`, `buildPoolDistribute`.
Pre-expiry alerting is a UI/server concern; the SDK should provide a
`fetchBondPeriod`-derived "10 days before bond end" burn-height helper.

---

## Journey 5 — Institutional Custodian (Carla)

Acceptance: construct + broadcast timelocked UTXOs for clients, 1:1 wallet
pairing, lock client STX at set ratio, surface bond timing + per-bond
reward-asset election to each client, partner API exposes bond params,
per-client positions, lifecycle events, coverage band, reserve balance.

Custodial aggregation is allowed (white paper §7.3) but synthetic ratio
inflation is not.

```ts
async function carlaEnrollClient(client: Client) {
  const network = 'mainnet';
  const pox = await fetchPoxInfo({ network });                              // [OK]
  const bond = await fetchBondPeriod({ network, cycleOffset: +1 });         // [MISSING]

  const allocation = await fetchPartnerAllocation({                         // [MISSING]
    network, partner: carla.partnerStxAddress, bondPeriodId: bond.id,
  });

  // L1: one per client, encoded with the client's stxAddress.
  const unlockBytes = buildDefaultUnlockScript(client.btcPubKey);           // [OK]
  const unlockHeight = computeUnlockHeight({                                // [OK]
    firstBurnchainBlockHeight: pox.firstBurnchainBlockHeight,
    rewardCycleLength: pox.rewardCycleLength,
    firstRewardCycle: bond.firstRewardCycle,
    numCycles: BOND_LENGTH_CYCLES,
  });
  const lockingAddress = buildLockingBitcoinAddress({                       // [OK]
    stxAddress: client.stxAddress, unlockHeight, unlockBytes, network,
  });
  // Carla's BTC custody signs + broadcasts the L1 transfer.

  // L2: one register-for-bond per client. Carla's shared signer-manager
  // contract validates each enrollment.
  const unsignedRegister = await buildRegisterForBond({                     // [OK]
    publicKey: client.stxPublicKey,
    fee: 1000, nonce: client.nonce, network,
    bondPeriodId: bond.id,
    amountUstx: client.requiredUstx,
    poxAddress: client.rewardBtcAddress,
    signerManager: carla.signerManagerContract,
    bondPeriod: BOND_LENGTH_CYCLES,
    unlockBytes,
    sbtcSats: 0n,
    callData: carla.encodeClientCallData(client),
  });

  const unsignedElect = await buildElectRewardAsset({                       // [MISSING]
    publicKey: client.stxPublicKey,
    fee: 1000, nonce: client.nonce + 1, network,
    asset: client.preference,  // 'sbtc' | 'btc'
  });

  return { lockingAddress, unsignedRegister, unsignedElect };
}

async function carlaPartnerDashboard() {
  const network = 'mainnet';

  const [bond, alloc, coverage, reserve] = await Promise.all([
    fetchBondPeriod({ network, cycleOffset: 0 }),                           // [MISSING]
    fetchPartnerAllocation({ network, partner: carla.partnerStxAddress, bondPeriodId: 0 }), // [MISSING]
    fetchCoverage({ network }),                                             // [MISSING]
    fetchReserve({ network }),                                              // [MISSING]
  ]);

  const positions = await Promise.all(
    carla.clients.map(c => fetchStakerInfo({ address: c.stxAddress, network })) // [OK]
  );

  return { bond, alloc, coverage, reserve, positions };
}
```

Custodian early exit per client mirrors 1g, orchestrated by Carla's UI.

---

## Journey 6 — sBTC Holder via Pool (Dana)

Direct protocol-level sBTC participation is not in V1. Dana enrolls via an
sBTC pool that holds an allocation on her behalf. The pool's signer-manager
calls `register-for-bond` with `sbtcSats > 0` and `unlockBytes` empty (the
contract calls `lock-sbtc` instead of verifying L1 lockups).

Open: sBTC custody mode (locked in pool contract vs. composable / dual-stack
allowance held in Dana's wallet). The SDK shape changes with the answer.

```ts
async function danaEnrollViaSbtcPool() {
  const network = 'mainnet';

  const pool = await fetchSbtcPool({ network, name: 'sbtc-pool-1' });       // [MISSING]
  const ok = await fetchSbtcPoolMembership({                                // [MISSING]
    network, signerManager: pool.signerManagerContract, member: dana.stxAddress,
  });
  if (!ok.admitted) throw new Error('not admitted');

  // No L1 lock. sBTC is locked into the pool's signer-manager (locked mode)
  // or the manager pulls a permissioned allowance (composable mode).
  const unsigned = await buildSbtcPoolStake({                               // [MISSING]
    publicKey: dana.stxPublicKey,
    fee: 1000, nonce: 0, network,
    bondPeriodId: pool.bondPeriodId,
    amountStxUstx: dana.stxUstx,
    amountSbtcSats: dana.sbtcSats,
    bondPeriod: BOND_LENGTH_CYCLES,
    signerManager: pool.signerManagerContract,
  });

  return unsigned;
}
```

Missing: `fetchSbtcPool`, `fetchSbtcPoolMembership`, `buildSbtcPoolStake`
(plus extend/update variants once the custody mode is decided).

---

## Journey 7 — Watchdog Reporter

Anyone can post a transaction proving an investor's L1 UTXO has been spent;
this halts further payouts to that position. Compensated mechanism (open
item 12.7, resolved).

```ts
import {
  // [MISSING] buildReportUtxoSpent,
  // [MISSING] collectSpendProof,
  // [MISSING] fetchLockStatus,
} from '@stacks/bitcoin-staking';

async function watchdogReportSpend(target: { staker: string; lockTxid: string; lockVout: number }) {
  const network = 'mainnet';

  const proof = await collectSpendProof({                                   // [MISSING]
    btcNode: 'https://...',
    lockTxid: target.lockTxid,
    lockVout: target.lockVout,
  });

  const unsigned = await buildReportUtxoSpent({                             // [MISSING]
    publicKey: ops.stxPublicKey,
    fee: 1000, nonce: 0, network,
    staker: target.staker,
    spendTxid: proof.spendTxid,
    spendBlock: proof.block,
    merkleBranch: proof.merkleBranch,
  });

  return unsigned;
}

async function userCheckLockStatus(staker: string) {
  return fetchLockStatus({ network: 'mainnet', staker });                   // [MISSING]
  // 'locked' | 'spent-reported' | 'expired'
}
```

Design depends on the watchdog function signature in `pox-5.clar` (not yet
exposed in the contract index — likely posted as an admin/permissionless
report path in a future revision).

---

## Journey 8 — Andon Cord (Operations Pause)

`calculate-rewards` for distribution cycle X requires height ≥ X+250, giving
ops a 250-block window to pause if anomalies surface (open item 12.3,
resolved).

```ts
async function opsMaybePause(reason: string) {
  const network = 'mainnet';
  const window = await fetchPayoutWindow({ network });                      // [MISSING]
  if (!window.canPause) return;

  const unsigned = await buildPausePayout({                                 // [MISSING]
    publicKey: ops.stxPublicKey,
    fee: 1000, nonce: 0, network,
    distributionCycle: window.distCycle,
    reason,
  });
  return unsigned;
}
```

End users likely also want `fetchPayoutWindow` to display "payout queued /
confirmed / paused".

---

## Dashboard / explorer reads

Per Launch Scope Appendix A.2, the Explorer surfaces:

```ts
// All [MISSING] today.
fetchBondCalendar({ network })           // current + upcoming + past bond params
fetchCoverage({ network })               // live coverage ratio per cycle
fetchReserve({ network })                // BTC + USD sleeve balances
fetchRealizedApy({ network, tranche })   // prior-period realized APY by tranche
fetchProgramRoster({ network })          // participating partners + pool allocations
```

Internal-tooling items from Appendix A.3 — parameter calculator, L1 lock
verifier, waterfall engine, early-exit coordinator — are largely out of
scope for `@stacks/bitcoin-staking` as a client SDK, except for the **L1
lock verifier**:

```ts
import { buildLockingBitcoinAddress } from '@stacks/bitcoin-staking';       // [OK]
// [MISSING] one-shot helper:
//   verifyClientLock({ stxAddress, unlockHeight, unlockBytes, network, observedUtxo })
```

---

## Consolidated "what's missing" index

**Bond-period metadata:** `fetchBondPeriod`, `fetchBondCalendar`,
`fetchPartnerAllocation`, `fetchCoverage`, `fetchReserve`,
`fetchRealizedApy`, `fetchProgramRoster`, `quoteStxForBtc`.

**Reward distribution (end-user side):** `fetchPayoutHistory`,
`fetchPayoutWindow`, `buildElectRewardAsset`, `buildPausePayout`. The
contract-level `claim-rewards`, `calculate-rewards`,
`get-claimable-rewards`, `get-new-rewards`, `current-distribution-cycle` are
present; SDK wrappers map directly.

**Early exit:** `buildEarlyExitUnlockScript`, `buildEarlyExitRequest`,
`fetchEarlyExitStatus`, plus an upstream early-exit signer client.

**L1 watchdog:** `buildReportUtxoSpent`, `collectSpendProof`,
`fetchLockStatus`, plus an explorer-facing `verifyClientLock`.

**Pools (BTC-capacity):** `fetchPool`, `fetchPoolMembership`,
`fetchPoolBondBook`, `fetchPoolMembers`, `buildPoolDistribute`.

**Pools (sBTC):** `fetchSbtcPool`, `fetchSbtcPoolMembership`,
`buildSbtcPoolStake` (+ extend/update variants once mode is decided).

**Client-side helpers (no contract dependency):** `quoteStxForBtc`,
`verifyClientLock`, pre-expiry burn-height derivation.

## What works today

Solo and pooled enrollment via `buildRegisterForBond` (paired BTC) and
`buildStake` (STX-only), unified updates via `buildStakeUpdate`,
signer-manager registration via `buildGrantSignerKey` +
`buildRegisterSigner`, and reward calculation/claiming via
`buildCalculateRewards` + `buildClaimRewards` are all expressible against
the current contract surface. L1 script construction
(`buildDefaultUnlockScript`, `buildLockingBitcoinAddress`,
`computeUnlockHeight`) is unchanged from PoX-4.

The remaining surface — bond-period metadata reads, reward-asset election,
early exit, watchdog, andon cord, sBTC pools, and the program-wide
dashboard helpers — is net-new and tracked above.

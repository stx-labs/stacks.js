import type { IntegerType } from '@stacks/common';
import {
  Cl,
  type ClarityValue,
  type StacksTransactionWire,
  makeUnsignedContractCall,
} from '@stacks/transactions';
import { POX5_CONTRACT_NAME } from './constants';
import type {
  BondLockup,
  BuildAllowContractCallerArgs,
  BuildDisallowContractCallerArgs,
  BuildGrantSignerKeyTxArgs,
  BuildRevokeSignerKeyTxArgs,
  BuildSetBondAdminArgs,
  TxParams,
} from './types';
import { networkFrom } from '@stacks/network';

/** @ignore */
function clBufferFrom(value: Uint8Array | string) {
  return typeof value === 'string' ? Cl.bufferFromHex(value) : Cl.buffer(value);
}

/** @ignore */
function clOptionalBufferFrom(value: Uint8Array | string | undefined) {
  if (value === undefined) return Cl.none();
  return Cl.some(clBufferFrom(value));
}

/** @ignore @internal */
async function callPox5(
  functionName: string,
  functionArgs: ClarityValue[],
  tx: TxParams
): Promise<StacksTransactionWire> {
  const network = networkFrom(tx.network);
  return makeUnsignedContractCall({
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName,
    functionArgs,
    publicKey: tx.publicKey,
    fee: tx.fee,
    nonce: tx.nonce,
    network: tx.network,
  });
}

// ---------------------------------------------------------------------------
// Bond setup (admin)
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `set-bond-admin` transaction.
 *
 * Rotates the `bond-admin` data-var to a new principal. Authorization rule:
 * `contract-caller == current bond-admin` (reverts with `ERR_UNAUTHORIZED`
 * otherwise). Mainnet deploys initialize `bond-admin` to a burn placeholder
 * (`'SP000000000000000000002Q6VF78`); the role is expected to be transferred
 * to a multisig before any `setup-bond` call. On non-mainnet networks the
 * node rewrites the literal at deploy.
 */
export async function buildSetBondAdmin(
  args: BuildSetBondAdminArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('set-bond-admin', [Cl.address(args.newAdmin)], args);
}

/**
 * Build an unsigned `setup-bond` transaction (admin / Endowment).
 *
 * Restricted to the bond admin (`bond-admin` data-var). Must be called within
 * `BOND_GAP_CYCLES` of the bond's start and before its open height.
 *
 * Each allowlist entry caps a staker by `max-sats`. The contract enforces this
 * cap at `register-for-bond` time; the required uSTX side is derived from
 * `min-ustx-for-sats-amount(max-sats, stx-value-ratio, min-ustx-ratio)`.
 */
export async function buildSetupBond(
  args: {
    bondIndex: number;
    targetRateBps: IntegerType;
    stxValueRatio: IntegerType;
    minUstxRatioBps: IntegerType;
    earlyUnlockSigners: Uint8Array | string;
    /** Stacks principal authorized to call `announce-l1-early-exit` for this bond. */
    earlyUnlockAdmin: string;
    allowlist: { staker: string; maxSats: IntegerType }[];
  } & TxParams
): Promise<StacksTransactionWire> {
  const allowlistCV = Cl.list(
    args.allowlist.map(entry =>
      Cl.tuple({
        staker: Cl.address(entry.staker),
        'max-sats': Cl.uint(entry.maxSats),
      })
    )
  );

  return callPox5(
    'setup-bond',
    [
      Cl.uint(args.bondIndex),
      Cl.uint(args.targetRateBps),
      Cl.uint(args.stxValueRatio),
      Cl.uint(args.minUstxRatioBps),
      clBufferFrom(args.earlyUnlockSigners),
      Cl.address(args.earlyUnlockAdmin),
      allowlistCV,
    ],
    args
  );
}

// ---------------------------------------------------------------------------
// Paired-BTC bond enrollment
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `register-for-bond` transaction.
 *
 * Two `lockup` shapes:
 * - `kind: 'btc'`  — caller has funded one or more L1 (BTC) timelocked outputs whose
 *   redeem script is the locking script returned by {@link buildLockingScript}.
 *   Each output is accompanied by a full SPV proof (block header, merkle path,
 *   tx-index/tx-count, raw tx bytes); the contract reconstructs and verifies
 *   each P2WSH output against the bitcoin chainstate.
 * - `kind: 'sbtc'` — no L1 (BTC) lockup; the contract pulls `sbtcSats` from the caller
 *   via `lock-sbtc`. On the wire this is encoded as `(err uint)` — the contract
 *   reuses the response's error branch to carry the sBTC amount.
 *
 * On success the contract returns an enrollment receipt tuple
 * `{ signer, staker, amount-ustx, bond-index, first-reward-cycle,
 * unlock-burn-height, unlock-cycle }` — useful for surfacing the unlock
 * schedule client-side without re-deriving it.
 */
export function buildRegisterForBond(
  args: {
    bondIndex: number;
    signerManager: string;
    amountUstx: IntegerType;
    lockup: BondLockup;
    signerCalldata?: Uint8Array | string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'register-for-bond',
    [
      Cl.uint(args.bondIndex),
      Cl.address(args.signerManager),
      Cl.uint(args.amountUstx),
      lockupToCV(args.lockup),
      clOptionalBufferFrom(args.signerCalldata),
    ],
    args
  );
}

/** @ignore */
function lockupToCV(lockup: BondLockup): ClarityValue {
  if (lockup.kind === 'sbtc') return Cl.error(Cl.uint(lockup.sbtcSats));
  return Cl.ok(
    Cl.tuple({
      outputs: Cl.list(
        lockup.outputs.map(o =>
          Cl.tuple({
            height: Cl.uint(o.height),
            tx: clBufferFrom(o.tx),
            'output-index': Cl.uint(o.outputIndex),
            header: clBufferFrom(o.header),
            'leaf-hashes': Cl.list(o.leafHashes.map(h => clBufferFrom(h))),
            'tx-count': Cl.uint(o.txCount),
            'tx-index': Cl.uint(o.txIndex),
            amount: Cl.uint(o.amount),
          })
        )
      ),
      'unlock-bytes': clBufferFrom(lockup.unlockBytes),
    })
  );
}

/**
 * Build an unsigned `update-bond-registration` transaction.
 *
 * Rotates the signer-manager bound to the caller's existing bond membership.
 * `oldSignerManager` must equal the current signer recorded on the membership
 * (the contract enforces this — `ERR_INVALID_OLD_SIGNER_MANAGER`). The new
 * signer-manager must be different (`ERR_UPDATE_BOND_SAME_SIGNER`) and must
 * already be registered. The contract calls `validate-stake!` on the new
 * manager and `checkpoint-staker` on the old one (errors from the latter are
 * swallowed). Takes effect from the next reward cycle, or from the bond's
 * start cycle if the bond hasn't begun yet.
 */
export async function buildUpdateBondRegistration(
  args: {
    /** Contract address of the new signer-manager. */
    signerManager: string;
    /** Contract address of the signer-manager currently bound to the membership. */
    oldSignerManager: string;
    /** Opaque calldata forwarded to the new `validate-stake!`. */
    signerCalldata?: Uint8Array | string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'update-bond-registration',
    [
      Cl.address(args.signerManager),
      Cl.address(args.oldSignerManager),
      clOptionalBufferFrom(args.signerCalldata),
    ],
    args
  );
}

/**
 * Build an unsigned `announce-l1-early-exit` transaction.
 *
 * Triggers the L1 early-unlock path for a bond participant. Only callable by
 * the bond's `early-unlock-admin` (`ERR_UNAUTHORIZED` otherwise), and only
 * when the membership has `is-l1-lock = true`
 * (`ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK`). `oldSignerManager` must match the
 * staker's currently bound signer (`ERR_INVALID_OLD_SIGNER_MANAGER`). On
 * success the staker's bond shares are zeroed and the signer's totals
 * decremented.
 */
export async function buildAnnounceL1EarlyExit(
  args: {
    /** Staker principal whose L1 early-exit is being announced. */
    staker: string;
    /** Contract address of the signer-manager currently bound to the staker. */
    oldSignerManager: string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'announce-l1-early-exit',
    [Cl.address(args.staker), Cl.address(args.oldSignerManager)],
    args
  );
}

/**
 * Build an unsigned `unstake-sbtc` transaction.
 *
 * Withdraws a portion (or all) of a bond participant's locked sBTC. Only
 * valid when the membership is sBTC-backed (`is-l1-lock = false`,
 * `ERR_CANNOT_UNSTAKE_SBTC`). The `signerManager` arg must match the
 * staker's current signer (`ERR_INVALID_OLD_SIGNER_MANAGER`).
 * `amountToWithdrawSats` must be ≤ the staker's current sBTC shares
 * (`ERR_INVALID_UNSTAKE_SBTC_AMOUNT`). The sBTC is transferred to the staker
 * via `sbtc-token.transfer` from the contract.
 */
export async function buildUnstakeSbtc(
  args: {
    /** Contract address of the signer-manager currently bound to the staker. */
    signerManager: string;
    /** sBTC sats to withdraw. Must be ≤ the staker's current sBTC shares. */
    amountToWithdrawSats: IntegerType;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'unstake-sbtc',
    [Cl.address(args.signerManager), Cl.uint(args.amountToWithdrawSats)],
    args
  );
}

// ---------------------------------------------------------------------------
// Solo staking
// ---------------------------------------------------------------------------

/**
 * Build an unsigned PoX-5 `stake` transaction (STX-only entry).
 *
 * Authorization is delegated to the signer-manager contract via
 * `validate-stake!`. The paired-BTC entry is `register-for-bond`.
 *
 * Note: post-patch the signer-manager trait gained a new method
 * `checkpoint-staker`, which pox-5 calls on the *previous* signer-manager
 * during rotation / unstake flows (`stake-update`, `unstake`,
 * `unstake-sbtc`, `update-bond-registration`, `announce-l1-early-exit`).
 * Any signer-manager implementation must implement it; pox-5 ignores its
 * return value.
 */
export async function buildStake(
  args: {
    /** Contract address of the signer-manager implementing `signer-manager-trait`. */
    signerManager: string;
    amountUstx: IntegerType;
    numCycles: number;
    /** Burn-block height that anchors the cycle to enroll in (replay guard). */
    startBurnHt: number;
    /** Opaque calldata forwarded to `validate-stake!`. */
    signerCalldata?: Uint8Array | string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake',
    [
      Cl.address(args.signerManager),
      Cl.uint(args.amountUstx),
      Cl.uint(args.numCycles),
      Cl.uint(args.startBurnHt),
      clOptionalBufferFrom(args.signerCalldata),
    ],
    args
  );
}

/**
 * Build an unsigned PoX-5 `stake-update` transaction (STX-only).
 *
 * A single call can extend the lock by N cycles, top up the locked amount,
 * and rotate the signer-manager. Pass `0` / `0n` to skip a dimension. The
 * caller's *current* signer-manager must be passed as `oldSignerManager`
 * — the contract asserts it matches the recorded signer
 * (`ERR_INVALID_OLD_SIGNER_MANAGER`) and calls `checkpoint-staker` on it
 * before applying the update (errors from `checkpoint-staker` are
 * swallowed).
 *
 * unsure: todo: the API takes `cyclesToExtend`/`amountIncrease` with `0` meaning
 * "skip". The contract's own min-num-cycles guard (`check-pox-lock-period`)
 * is computed against `(unlock-cycle - current-cycle - 1)`, so a pure rotate
 * (both zeros, already-extended position) only succeeds if the existing tail
 * still satisfies the bound. No client-side guard added.
 */
export async function buildStakeUpdate(
  args: {
    /** Contract address of the (possibly new) signer-manager. */
    signerManager: string;
    /** Contract address of the signer-manager currently recorded for the staker. */
    oldSignerManager: string;
    /** Number of cycles to extend the lock by. Defaults to `0` (no extension). */
    cyclesToExtend?: number;
    /** Additional uSTX to lock on top of the current `amount-ustx`. Defaults to `0n` (no top-up). */
    amountIncrease?: IntegerType;
    /** Opaque calldata forwarded to `validate-stake!`. */
    signerCalldata?: Uint8Array | string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-update',
    [
      Cl.address(args.signerManager),
      Cl.address(args.oldSignerManager),
      Cl.uint(args.cyclesToExtend ?? 0),
      Cl.uint(args.amountIncrease ?? 0n),
      clOptionalBufferFrom(args.signerCalldata),
    ],
    args
  );
}

/**
 * Build an unsigned PoX-5 `unstake` transaction (STX-only).
 *
 * Sets the caller's STX-only position to unlock at the end of the current
 * reward cycle (i.e. `num-cycles` is rewritten so `first-reward-cycle +
 * num-cycles = current-cycle + 1`). The contract reverts with
 * `ERR_UNSTAKE_IN_PREPARE_PHASE` if invoked during the prepare phase, so
 * callers should gate on {@link isInPreparePhase} first.
 *
 * `oldSignerManager` must match the staker's currently recorded signer
 * (`ERR_INVALID_OLD_SIGNER_MANAGER`) — pox-5 calls `checkpoint-staker` on it
 * before zeroing the position.
 */
export async function buildUnstake(
  args: {
    /** Contract address of the signer-manager currently recorded for the staker. */
    oldSignerManager: string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('unstake', [Cl.address(args.oldSignerManager)], args);
}

// ---------------------------------------------------------------------------
// Contract-caller authorization
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `allow-contract-caller` transaction.
 *
 * Authorizes another address (typically a helper / batching contract) to
 * make PoX-5 calls on behalf of the sending account. An optional
 * `untilBurnHeight` caps the authorization at a given burn-block height; omit
 * for no expiry.
 */
export async function buildAllowContractCaller(
  args: BuildAllowContractCallerArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'allow-contract-caller',
    [
      Cl.address(args.contractCaller),
      args.untilBurnHeight !== undefined ? Cl.some(Cl.uint(args.untilBurnHeight)) : Cl.none(),
    ],
    args
  );
}

/**
 * Build an unsigned `disallow-contract-caller` transaction. Revokes a
 * previously granted contract-caller authorization for the sending account.
 */
export async function buildDisallowContractCaller(
  args: BuildDisallowContractCallerArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('disallow-contract-caller', [Cl.address(args.contractCaller)], args);
}

// ---------------------------------------------------------------------------
// Reward distribution (signer side)
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `calculate-rewards` transaction.
 *
 * Anyone can call. Settles the current distribution cycle's waterfall:
 * iterates `bondPeriods` in descending `stx-value-ratio` order (drawdown
 * priority — caller is responsible for the ordering, contract enforces it
 * via `ERR_INVALID_BOND_PERIOD_ORDERING`), pays each up to its target APY
 * out of accrued sBTC, routes 15% (`RESERVE_RATIO`) of the cycle excess to
 * the reserve, and distributes the remainder pro rata to STX-only stakers.
 * Gated by `current-distribution-cycle ≥ X+250` via the
 * `ERR_DISTRIBUTION_ALREADY_COMPUTED` check on `last-reward-compute-height`.
 *
 * The `bondPeriods` list must include every active bond at
 * `calculation-height` (`assert-all-active-bonds-included`); pass the full
 * `activeBondIndices` set the dashboard surfaces, not a filtered subset.
 *
 * unsure: todo: whether to expose a client-side ordering helper. Today the caller
 * must pre-sort by descending `stx-value-ratio` (older bond index breaks
 * ties). Could wrap once a fetch helper surfaces per-bond `stx-value-ratio`
 * in a single call.
 */
export async function buildCalculateRewards(
  args: {
    /** Active bond period indices, sorted by descending `stx-value-ratio`. */
    bondIndices: number[];
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('calculate-rewards', [Cl.list(args.bondIndices.map(i => Cl.uint(i)))], args);
}

/**
 * Build an unsigned `claim-rewards` transaction.
 *
 * Pulls accumulated sBTC for the contract-caller's signer share across the
 * STX-only leg keyed by `rewardCycle` plus one leg per `bondIndices` entry.
 * Returns a tuple
 * `{ stx-rewards, bond-rewards (list), bond-totals, total-rewards }` and
 * mirrors that shape in the `print` event so callers can break the payout
 * down per bond. Each `bond-rewards` entry has shape
 * `{ earned, bond-index, rewards-per-token }` — see {@link BondRewardsLeg}.
 * Reverts with `ERR_NO_CLAIMABLE_REWARDS` if every leg is empty — gate on
 * {@link fetchClaimableRewards} first.
 *
 * `tx-sender` should be the signer-manager (the contract uses
 * `contract-caller` as the signer address).
 *
 * unsure: todo: `rewardCycle` semantics. Common usage passes
 * `currentDistributionCycle - 1` (claim the cycle the caller just settled
 * via `calculate-rewards`). Surfaced as a plain arg here — callers decide.
 */
export async function buildClaimRewards(
  args: {
    /** STX-only reward cycle whose leg should be claimed. */
    rewardCycle: number;
    /** Bond period indices whose paired legs should be claimed. */
    bondIndices: number[];
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'claim-rewards',
    [Cl.list(args.bondIndices.map(i => Cl.uint(i))), Cl.uint(args.rewardCycle)],
    args
  );
}

// ---------------------------------------------------------------------------
// Signer-key grant (SIP-018) builders
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `grant-signer-key` transaction.
 *
 * Records a SIP-018 grant that authorizes `signerManager` to register
 * `signerKey` via `register-signer`. The contract:
 *
 *  1. Asserts the `(signer-key, signer-manager, auth-id)` triple has not
 *     previously been consumed (`used-signer-key-grants`) — replay guard.
 *  2. Recovers the public key from `signerSignature` over the SIP-018
 *     message hash built by {@link signerKeyGrantMessage}, and asserts it
 *     equals `signerKey`.
 *  3. Marks the auth-id used and writes `signer-key-grants[signer-key,
 *     signer-manager] = true`.
 *
 * The signature is generated off-chain by the signer-key holder via
 * {@link signSignerKeyGrant}.
 *
 * On-chain arg order: `(signer-key, signer-manager, auth-id, signer-sig)`.
 */
export async function buildGrantSignerKey(
  args: BuildGrantSignerKeyTxArgs
): Promise<StacksTransactionWire> {
  return callPox5(
    'grant-signer-key',
    [
      clBufferFrom(args.signerKey),
      Cl.address(args.signerManager),
      Cl.uint(args.authId),
      clBufferFrom(args.signerSignature),
    ],
    args
  );
}

/**
 * Build an unsigned `revoke-signer-grant` transaction.
 *
 * Deletes a previously granted `signer-key-grants[signer-key,
 * signer-manager]` entry. `tx-sender` must be the Stacks principal derived
 * from `signerKey` (hash160 of the compressed pubkey, network-versioned) —
 * the contract enforces this and returns `ERR_UNAUTHORIZED` otherwise.
 *
 * On-chain arg order: `(signer-manager, signer-key)`.
 */
export async function buildRevokeSignerGrant(
  args: BuildRevokeSignerKeyTxArgs
): Promise<StacksTransactionWire> {
  return callPox5(
    'revoke-signer-grant',
    [Cl.address(args.signerManager), clBufferFrom(args.signerKey)],
    args
  );
}

// todo: flow 14 (watchdog spent-report) — `buildReportUtxoSpent`.
// todo: flow 15 (andon cord) — `buildPausePayout`.

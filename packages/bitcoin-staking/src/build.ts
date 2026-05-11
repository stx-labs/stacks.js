import type { IntegerType } from '@stacks/common';
import {
  Cl,
  type ClarityValue,
  type StacksTransactionWire,
  makeUnsignedContractCall,
} from '@stacks/transactions';
import { POX5_CONTRACT_NAME } from './constants';
import type {
  BuildAllowContractCallerArgs,
  BuildDisallowContractCallerArgs,
  BuildGrantSignerKeyTxArgs,
  BuildRevokeSignerKeyTxArgs,
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
// Bond setup (admin) — flow 4
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `setup-bond` transaction (admin / Endowment — flow 4).
 *
 * Per `staking-design/pox-5.clar` (2026-05-04):
 *   (setup-bond (bond-index uint)
 *               (target-rate uint)
 *               (stx-value-ratio uint)
 *               (min-ustx-ratio uint)
 *               (early-unlock-signers (buff 683))
 *               (allowlist (list 1000 { staker: principal, max-sats: uint })))
 *
 * Restricted to the bond admin (`bond-admin` data-var). Must be called within
 * `BOND_GAP_CYCLES` of the bond's start and before its open height.
 *
 * unsure: the 683-byte `earlyUnlockSigners` descriptor format is open
 * (notes/status.md tier-2 §14, design open-question 2). Currently passed
 * through as opaque bytes; the helper in `locking.ts`
 * (`buildEarlyExitUnlockScript`) emits a placeholder M-of-N tail.
 */
export async function buildSetupBond(
  args: {
    bondIndex: number;
    targetRateBps: IntegerType;
    stxValueRatio: IntegerType;
    minUstxRatioBps: IntegerType;
    earlyUnlockSigners: Uint8Array | string;
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
 *   The contract reconstructs and verifies each P2WSH output.
 * - `kind: 'sbtc'` — no L1 (BTC) lockup; the contract pulls `sbtcSats` from the caller
 *   via `lock-sbtc`.
 */
export function buildRegisterForBond(
  args: {
    bondIndex: number;
    signerManager: string;
    amountUstx: IntegerType;
    lockup:
      | {
          kind: 'btc';
          outputs: {
            amountSats: IntegerType;
            txid: Uint8Array | string;
            outputIndex: number;
          }[];
          unlockBytes: Uint8Array | string;
        }
      | { kind: 'sbtc'; sbtcSats: IntegerType };
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
function lockupToCV(
  lockup:
    | {
        kind: 'btc';
        outputs: { amountSats: IntegerType; txid: Uint8Array | string; outputIndex: number }[];
        unlockBytes: Uint8Array | string;
      }
    | { kind: 'sbtc'; sbtcSats: IntegerType }
): ClarityValue {
  if (lockup.kind === 'sbtc') return Cl.error(Cl.uint(lockup.sbtcSats));
  return Cl.ok(
    Cl.tuple({
      outputs: Cl.list(
        lockup.outputs.map(o =>
          Cl.tuple({
            amount: Cl.uint(o.amountSats),
            txid: clBufferFrom(o.txid),
            'output-index': Cl.uint(o.outputIndex),
          })
        )
      ),
      'unlock-bytes': clBufferFrom(lockup.unlockBytes),
    })
  );
}

// ---------------------------------------------------------------------------
// Solo staking
// ---------------------------------------------------------------------------

/**
 * Build an unsigned PoX-5 `stake` transaction (STX-only entry — flow 1).
 *
 * Per `staking-design/pox-5.clar` (2026-05-04), the contract signature is:
 *   (stake (signer-manager <signer-manager-trait>)
 *          (amount-ustx uint)
 *          (num-cycles uint)
 *          (start-burn-ht uint)
 *          (signer-calldata (optional (buff 500))))
 *
 * Authorization is delegated to the signer-manager contract via
 * `validate-stake!`. There is no `pox-address`, no per-tx signer signature,
 * no `max-amount`, no `auth-id`, no `unlock-bytes` — those belonged to the
 * paired-BTC flow (now `register-for-bond`) or to PoX-4.
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
 * Build an unsigned PoX-5 `stake-update` transaction (STX-only — flow 2).
 *
 * Per `staking-design/pox-5.clar` (2026-05-04), the contract signature is:
 *   (stake-update (signer-manager <signer-manager-trait>)
 *                 (cycles-to-extend uint)
 *                 (amount-increase uint)
 *                 (signer-calldata (optional (buff 500))))
 *
 * Unifies the PoX-4 `stake-extend` + `stake-update` shapes: a single call can
 * extend the lock by N cycles, top up the locked amount, and rotate the
 * signer-manager. Pass `0` / `0n` to skip a dimension (same `signerManager`
 * keeps the current binding from the staker's perspective, but the contract
 * still re-runs `validate-stake!` against whichever signer-manager is passed).
 *
 * unsure: flow 2 markdown sketches the API as `cyclesToExtend`/`amountIncrease`
 * with `0` meaning "skip". The contract's own min-num-cycles guard
 * (`check-pox-lock-period`) is computed against `(unlock-cycle - current-cycle - 1)`,
 * so a pure rotate (both zeros, already-extended position) only succeeds if
 * the existing tail still satisfies the bound. No client-side guard added.
 */
export async function buildStakeUpdate(
  args: {
    /** Contract address of the signer-manager implementing `signer-manager-trait`. */
    signerManager: string;
    /** Number of cycles to extend the lock by. `0` = no extension. */
    cyclesToExtend: number;
    /** Additional uSTX to lock on top of the current `amount-ustx`. `0n` = no top-up. */
    amountIncrease: IntegerType;
    /** Opaque calldata forwarded to `validate-stake!`. */
    signerCalldata?: Uint8Array | string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-update',
    [
      Cl.address(args.signerManager),
      Cl.uint(args.cyclesToExtend),
      Cl.uint(args.amountIncrease),
      clOptionalBufferFrom(args.signerCalldata),
    ],
    args
  );
}

/**
 * Build an unsigned PoX-5 `unstake` transaction (STX-only — flow 3).
 *
 * Per `staking-design/pox-5.clar` (2026-05-04), the contract signature is:
 *   (unstake)
 *
 * Sets the caller's STX-only position to unlock at the end of the current
 * reward cycle (i.e. `num-cycles` is rewritten so `first-reward-cycle +
 * num-cycles = current-cycle + 1`). The contract reverts with
 * `ERR_UNSTAKE_IN_PREPARE_PHASE` if invoked during the prepare phase, so
 * callers should gate on {@link isInPreparePhase} first (see
 * `flows/4-solo-stx/3.md`).
 *
 * No arguments — the staker is derived from `tx-sender` and the position is
 * looked up via `get-staker-info`.
 *
 * unsure: the contract `(define-public (unstake) ...)` takes no args; flow
 * markdown matches. If a future revision adds an explicit position selector
 * (e.g. for multi-position stakers) this signature will need to grow.
 */
export async function buildUnstake(args: TxParams): Promise<StacksTransactionWire> {
  return callPox5('unstake', [], args);
}

// ---------------------------------------------------------------------------
// Signer key grants
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `grant-signer-key` transaction. Records on-chain the
 * SIP-018 signature produced by [[signSignerKeyGrant]]; replay-gated by
 * `(signerKey, signerManager, authId)`. Anyone may submit; the signer
 * does not need to be the tx-sender.
 */
export async function buildGrantSignerKey(
  args: BuildGrantSignerKeyTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'grant-signer-key',
    [
      Cl.bufferFromHex(args.signerKey),
      Cl.address(args.signerManager),
      Cl.uint(args.authId),
      Cl.bufferFromHex(args.signerSignature),
    ],
    args
  );
}

/**
 * Build an unsigned `revoke-signer-grant` transaction. tx-sender must be
 * the Stacks address whose hash160 matches `signerKey`.
 */
export async function buildRevokeSignerGrant(
  args: BuildRevokeSignerKeyTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'revoke-signer-grant',
    [Cl.address(args.signerManager), Cl.bufferFromHex(args.signerKey)],
    args
  );
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
// Reward distribution (signer side) — flow 7
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `calculate-rewards` transaction (flow 7, leg 1).
 *
 * Per `staking-design/pox-5.clar` (2026-05-04):
 *   (calculate-rewards (bond-periods (list 6 uint)))
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
 * unsure: whether to expose a client-side ordering helper. Today the caller
 * must pre-sort by descending `stx-value-ratio` (older bond index breaks
 * ties); see `flows/6-rewards/7.md`. Could wrap once a fetch helper
 * surfaces per-bond `stx-value-ratio` in a single call.
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
 * Build an unsigned `claim-rewards` transaction (flow 7, leg 2).
 *
 * Per `staking-design/pox-5.clar` (2026-05-04, post-patch):
 *   (claim-rewards (bond-periods (list 6 uint)) (reward-cycle uint))
 *
 * Pulls accumulated sBTC for the contract-caller's signer share across the
 * STX-only leg keyed by `rewardCycle` plus one leg per `bondIndices` entry.
 * The 2026-05-04 patch changed the return tuple to
 * `{ stx-rewards, bond-rewards (list), bond-totals, total-rewards }` and
 * mirrors that shape in the `print` event so callers can break the payout
 * down per bond. Reverts with `ERR_NO_CLAIMABLE_REWARDS` if every leg is
 * empty — gate on {@link fetchClaimableRewards} first (the flow markdown
 * shows the `totalPending === 0n` guard).
 *
 * `tx-sender` should be the signer-manager (the contract uses
 * `contract-caller` as the signer address).
 *
 * unsure: `rewardCycle` semantics. The flow markdown passes
 * `currentDistributionCycle - 1` (claim the cycle the caller just settled
 * via `calculate-rewards`); the `-1` sits with a TODO in `flows/6-rewards/7.md`
 * about why exactly. Surfaced as a plain arg here — callers decide.
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
// Early exit (paired-BTC) — flow 13
// ---------------------------------------------------------------------------

/**
 * todo: check w stacks-core team
 *
 * Build an unsigned `request-early-exit` transaction.
 *
 * Flags a paired-BTC bond position for early exit. After this lands the
 * staker forfeits all remaining BTC yield for the bond period; the paired
 * STX stays locked through the natural bond end and earns nothing (it does
 * NOT convert to a T3 STX-only position).
 *
 * The L1 unlock follows separately: an off-chain coordinator (1-of-N AWS
 * multisig — the "Early Exit signer set") observes this L2 event and
 * co-signs a spend against the pre-authorized early-exit branch baked into
 * the locking script at enrollment time (see `buildEarlyExitUnlockScript`
 * in `locking.ts`, flow 5/9). Anyone may then broadcast that BTC tx.
 *
 * missing: `request-early-exit` is referenced in the design diagrams
 * (notes/user-flows.md §1g, notes/pox-5-design.md "Early exit",
 * notes/status.md tier-2 item 14, flows/3-paired-btc/13.md) but is NOT
 * yet defined in `staking-design/pox-5.clar` (2026-05-04 snapshot).
 * `setup-bond` does store the `early-unlock-signers` 683-byte descriptor,
 * so the L1 side is provisioned, but the L2 request entry point is a
 * placeholder. Function name, argument shape, and event payload are all
 * subject to change once the contract function lands.
 *
 * unsure: argument shape. The flow markdown sketches a no-arg call
 * (just publicKey/fee/nonce/network), implying the contract derives the
 * staker from `tx-sender` and looks up the bond via
 * `get-bond-membership`. A future revision could add `(bond-index uint)`
 * if the contract chooses to disambiguate; left out here to match the
 * sketch.
 */
export async function buildEarlyExitRequest(args: TxParams): Promise<StacksTransactionWire> {
  // missing: contract function name `request-early-exit` is the design-doc
  // placeholder. Replace once the contract surface is finalized.
  return callPox5('request-early-exit', [], args);
}

// ---------------------------------------------------------------------------
// Andon cord / payout pause — flow 15
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `pause-payout` transaction (flow 15).
 *
 * Halts a queued `calculate-rewards` settlement for distribution cycle
 * `distributionCycle` during the 250-block andon-cord window. Authorization
 * is a 3-of-5 ops multisig (the multisig is the `tx-sender`; the
 * contract enforces the membership check). Pause cannot redirect — only
 * halt; restoring a paused payout may require a hard fork
 * (`notes/pox-5-design.md` "Andon Cord", White Paper §4.4, Launch Scope D19).
 *
 * missing: `pause-payout` is NOT in `staking-design/pox-5.clar`
 * (2026-05-04 snapshot). The contract today gates `calculate-rewards`
 * solely on `last-reward-compute-height < calculation-height` — there
 * is no pause flag, no pause function, and no 3-of-5 multisig
 * authorization surface. `notes/status.md` tier-2 item 16 and open
 * design-question 3 flag the entire andon-cord surface as TBD. Replace
 * this stub once the contract function lands.
 *
 * unsure: function name + arg shape are speculative. The flow markdown
 * sketches `(distributionCycle, reason)`. Plausible alternatives:
 * `(distribution-cycle uint)` only, with the reason carried off-chain
 * via the `print` event payload; or `(distribution-cycle uint, reason
 * (buff 256))` to keep the audit trail on-chain. Encoded the
 * sketch-shape here.
 *
 * unsure: who signs. The flow-15 sketch shows the ops multisig as
 * `publicKey: ops.stxPublicKey`, implying a single principal hosts the
 * 3-of-5. A SIP-018-style aggregated multisig would invert the call
 * shape (off-chain signature collection + a single relay tx). Left as
 * a single-principal builder for parity with the rest of the package.
 */
export async function buildPausePayout(
  args: {
    /** Distribution cycle whose pending payout should be halted. */
    distributionCycle: number;
    /** Free-form audit string; capped at 256 bytes by the placeholder shape. */
    reason: string;
  } & TxParams
): Promise<StacksTransactionWire> {
  // missing: contract function name `pause-payout` is the design-doc
  // placeholder. Replace once the contract surface is finalized.
  return callPox5(
    'pause-payout',
    [Cl.uint(args.distributionCycle), Cl.bufferFromUtf8(args.reason)],
    args
  );
}

// ---------------------------------------------------------------------------
// Watchdog spent-report (paired-BTC) — flow 14
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `report-utxo-spent` transaction (watchdog flow 14).
 *
 * Anyone can post a Bitcoin SPV proof that a tracked L1 lockup has been
 * spent before its CLTV expiry. The first valid proof earns compensation;
 * the reported position is dropped from T1 eligibility at the next payout
 * (`notes/pox-5-design.md` "Watchdog", Launch Scope D21,
 * `flows/3-paired-btc/14.md`).
 *
 * missing: NO watchdog function exists in `pox-5.clar` (2026-05-04
 * snapshot). The only related primitive is the private
 * `validate-p2wsh-exists?` stub at line 1636 — itself a placeholder for
 * a future Clarity built-in. `notes/status.md` tier-2 item 15 and open
 * design-question 1 explicitly flag this surface as TBD.
 *
 * unsure: function name. The flow markdown sketches `report-utxo-spent`;
 * other plausible names are `report-l1-spend`, `submit-spend-proof`,
 * `prove-utxo-spent`. Used the flow-markdown name as the placeholder.
 *
 * unsure: argument shape. Sketch passes `staker`, `spendTxid`,
 * `spendBlockHeight`, `merkleBranch`. Real contract will likely also
 * need: the original `(lock-txid, lock-vout)` it claims to invalidate,
 * the raw spending tx bytes, the input index spending the tracked
 * output, and a block-header chain segment. Encoded the minimal sketch
 * here; expand once the contract lands.
 *
 * unsure: compensation payout asset (sBTC vs. STX) and amount are not
 * specified anywhere in the design notes — open per `flows/3-paired-btc/14.md`.
 */
export async function buildReportUtxoSpent(
  args: {
    /** Stacks address of the staker whose L1 lockup was spent. */
    staker: string;
    /** Txid of the Bitcoin transaction that spent the tracked output. */
    spendTxid: Uint8Array | string;
    /** Burn-block height that included the spending tx. */
    spendBlockHeight: number;
    /** Merkle branch proving inclusion of `spendTxid` in `spendBlockHeight`. */
    merkleBranch: (Uint8Array | string)[];
    // missing: likely also (lockTxid, lockVout), raw spending tx bytes,
    // spending input index, block header(s). Add when contract shape is
    // finalized.
  } & TxParams
): Promise<StacksTransactionWire> {
  // missing: contract function name + arg list are placeholders pulled
  // from the flow-markdown sketch. Replace once `pox-5.clar` exposes
  // the real surface.
  return callPox5(
    'report-utxo-spent',
    [
      Cl.address(args.staker),
      clBufferFrom(args.spendTxid),
      Cl.uint(args.spendBlockHeight),
      Cl.list(args.merkleBranch.map(clBufferFrom)),
    ],
    args
  );
}

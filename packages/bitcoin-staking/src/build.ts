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
// Bond setup (admin)
// ---------------------------------------------------------------------------

/**
 * Build an unsigned `setup-bond` transaction (admin / Endowment).
 *
 * Restricted to the bond admin (`bond-admin` data-var). Must be called within
 * `BOND_GAP_CYCLES` of the bond's start and before its open height.
 *
 * unsure: todo: the 683-byte `earlyUnlockSigners` descriptor format is open.
 * Currently passed through as opaque bytes; the helper in `locking.ts`
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
 * Build an unsigned PoX-5 `stake` transaction (STX-only entry).
 *
 * Authorization is delegated to the signer-manager contract via
 * `validate-stake!`. The paired-BTC entry is `register-for-bond`.
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
 * and rotate the signer-manager. Pass `0` / `0n` to skip a dimension (same
 * `signerManager` keeps the current binding from the staker's perspective,
 * but the contract still re-runs `validate-stake!` against whichever
 * signer-manager is passed).
 *
 * unsure: todo: the API takes `cyclesToExtend`/`amountIncrease` with `0` meaning
 * "skip". The contract's own min-num-cycles guard (`check-pox-lock-period`)
 * is computed against `(unlock-cycle - current-cycle - 1)`, so a pure rotate
 * (both zeros, already-extended position) only succeeds if the existing tail
 * still satisfies the bound. No client-side guard added.
 */
export async function buildStakeUpdate(
  args: {
    /** Contract address of the signer-manager implementing `signer-manager-trait`. */
    signerManager: string;
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
 * No arguments — the staker is derived from `tx-sender` and the position is
 * looked up via `get-staker-info`.
 *
 * unsure: todo: the contract `(define-public (unstake) ...)` takes no args. If a
 * future revision adds an explicit position selector (e.g. for multi-position
 * stakers) this signature will need to grow.
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
 * down per bond. Reverts with `ERR_NO_CLAIMABLE_REWARDS` if every leg is
 * empty — gate on {@link fetchClaimableRewards} first.
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

// todo: flow 13 (paired-BTC early exit) — `buildEarlyExitRequest`.
// todo: flow 14 (watchdog spent-report) — `buildReportUtxoSpent`.
// todo: flow 15 (andon cord) — `buildPausePayout`.

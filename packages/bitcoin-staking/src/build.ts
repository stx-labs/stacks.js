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
  BuildGrantSignerKeyTxArgs,
  BuildRevokeSignerKeyTxArgs,
  BuildSetBondAdminArgs,
  BuildSetPauseAdminArgs,
  TxParams,
} from './types';
import { networkFrom } from '@stacks/network';

/** @internal */
function clBufferFrom(value: Uint8Array | string) {
  return typeof value === 'string' ? Cl.bufferFromHex(value) : Cl.buffer(value);
}

/** @internal */
function clOptionalBufferFrom(value: Uint8Array | string | undefined) {
  if (value === undefined) return Cl.none();
  return Cl.some(clBufferFrom(value));
}

/** @internal */
async function callPox5(
  functionName: string,
  functionArgs: ClarityValue[],
  tx: TxParams
): Promise<StacksTransactionWire> {
  const network = networkFrom(tx.network);
  const base = {
    contractAddress: network.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName,
    functionArgs,
    fee: tx.fee,
    nonce: tx.nonce,
    network: tx.network,
    ...(tx.postConditions ? { postConditions: tx.postConditions } : {}),
    ...(tx.postConditionMode ? { postConditionMode: tx.postConditionMode } : {}),
  };
  // Discriminate single-sig (`publicKey`) vs multisig (`publicKeys`), mirroring
  // `makeUnsignedContractCall` — so any pox-5 admin call can target a multisig
  // origin (e.g. a multisig `bond-admin`) just by passing `publicKeys`. Multisig
  // defaults to the non-sequential hashmode (order-independent signatures); pass
  // `useNonSequentialMultiSig: false` to opt back into the legacy sequential one.
  return makeUnsignedContractCall(
    'publicKey' in tx
      ? { ...base, publicKey: tx.publicKey }
      : {
          ...base,
          publicKeys: tx.publicKeys,
          numSignatures: tx.numSignatures,
          useNonSequentialMultiSig: tx.useNonSequentialMultiSig ?? true,
          ...(tx.address ? { address: tx.address } : {}),
        }
  );
}

/**
 * Build an unsigned `set-bond-admin` transaction.
 *
 * Rotates the `bond-admin` data-var to a new principal. Only the current
 * `bond-admin` may call (`ERR_UNAUTHORIZED` otherwise).
 *
 * @example
 * ```ts
 * // Hand the bond-admin role to a multisig.
 * const tx = await buildSetBondAdmin({
 *   newAdmin: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR',
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildSetBondAdmin(
  args: BuildSetBondAdminArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('set-bond-admin', [Cl.address(args.newAdmin)], args);
}

/**
 * Build an unsigned `set-pause-admin` transaction.
 *
 * Rotates the `pause-admin` data-var to a new principal. Only the current
 * `pause-admin` may call (`ERR_UNAUTHORIZED` otherwise). The `pause-admin` is
 * the sole role permitted to call {@link buildPauseRewards}.
 *
 * @example
 * ```ts
 * // Hand the pause-admin role to a multisig.
 * const tx = await buildSetPauseAdmin({
 *   newAdmin: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR',
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildSetPauseAdmin(
  args: BuildSetPauseAdminArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('set-pause-admin', [Cl.address(args.newAdmin)], args);
}

/**
 * Build an unsigned `pause-rewards` transaction.
 *
 * Permanently halts signer reward claims: once paused, every `claim-rewards`
 * reverts with `ERR_REWARDS_PAUSED`. This is **one-way** — there is no unpause,
 * rewards keep accruing in the contract, and recovery requires a hard fork.
 * Only the current `pause-admin` may call (`ERR_UNAUTHORIZED` otherwise).
 *
 * @example
 * ```ts
 * const tx = await buildPauseRewards({
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildPauseRewards(args: TxParams): Promise<StacksTransactionWire> {
  return callPox5('pause-rewards', [], args);
}

/**
 * Build an unsigned `setup-bond` transaction (admin / Endowment).
 *
 * Each allowlist entry caps a staker by `max-sats`. The contract enforces this
 * cap at `register-for-bond` time; the required uSTX side is derived from
 * `min-ustx-for-sats-amount(max-sats, stx-value-ratio, min-ustx-ratio)`.
 *
 * @example
 * ```ts
 * // Open bond 0 with two allowlisted stakers, each capped at 1 BTC.
 * const tx = await buildSetupBond({
 *   bondIndex: 0,
 *   targetRateBps: 500,        // 5% target APY
 *   stxValueRatio: 1_000_000n, // uSTX per 100 sats
 *   minUstxRatioBps: 8_000,    // >=80% of the paired value must be STX
 *   earlyUnlockBytes,
 *   allowlist: [
 *     { staker: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR', maxSats: 100_000_000n },
 *     { staker: 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE', maxSats: 100_000_000n },
 *   ],
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildSetupBond(
  args: {
    bondIndex: number;
    targetRateBps: IntegerType;
    stxValueRatio: IntegerType;
    minUstxRatioBps: IntegerType;
    /**
     * Pre-pushed Bitcoin script subscript spliced into the OP_ELSE early-exit
     * branch of the locking script, validating an early L1 unlock — e.g.
     * `<pubkey> OP_CHECKSIG` or an M-of-N CHECKMULTISIG template (buff 683). Its
     * result is consumed by the locking script's shared OP_VERIFY.
     */
    earlyUnlockBytes: Uint8Array | string;
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
      clBufferFrom(args.earlyUnlockBytes),
      allowlistCV,
    ],
    args
  );
}

/**
 * Build an unsigned `register-for-bond` transaction.
 *
 * Two `lockup` shapes:
 * - `kind: 'btc'`  — caller has funded one or more L1 (BTC) timelocked outputs whose
 *   redeem script is the locking script returned by {@link buildLockScript}.
 *   Each output is accompanied by a full SPV proof (block header, merkle path,
 *   tx-index/tx-count, raw tx bytes); the contract reconstructs and verifies
 *   each P2WSH output against the bitcoin chainstate.
 * - `kind: 'sbtc'` — no L1 (BTC) lockup; the contract pulls `sbtcSats` from the caller
 *   via `lock-sbtc`. Requires `postConditions` covering the sBTC transfer.
 *
 * Dry-run the registration first with {@link fetchEligibleRegisterForBond} — it
 * replays the contract's gates (allowlist, timing, STX minimum/balance, signer
 * grant, overlaps) read-only so you can catch a failing registration before
 * broadcasting.
 *
 * @example
 * ```ts
 * // sBTC-backed enrollment. `postConditions` must cover the sBTC transfer.
 * const tx = await buildRegisterForBond({
 *   bondIndex: 0,
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   amountUstx: 1_000_000n,
 *   lockup: { kind: 'sbtc', sbtcSats: 100_000n },
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 *   postConditions,
 * });
 * ```
 *
 * @example
 * ```ts
 * // L1 BTC lockup. Each output carries an SPV proof — see buildLockProof.
 * const tx = await buildRegisterForBond({
 *   bondIndex: 0,
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   amountUstx: 1_000_000n,
 *   lockup: { kind: 'btc', outputs, unlockBytes },
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export function buildRegisterForBond(
  args: {
    bondIndex: number;
    signerManager: string;
    amountUstx: IntegerType;
    lockup: BondLockup;
    /**
     * Opaque calldata forwarded to `signer-manager.validate-stake!`.
     * Use {@link buildSignerCalldata} to elect an L1 BTC payout; omit for the
     * sBTC default.
     */
    signerCalldata?: Uint8Array | string;
  } & TxParams
): Promise<StacksTransactionWire> {
  // NOTE: the `kind: 'sbtc'` lockup makes `lock-sbtc` transfer sBTC FROM the
  // caller, which the default deny mode aborts unless covered — pass an explicit
  // `postConditions` (sBTC contract is deploy-configured, so it's caller-supplied).
  //
  // TODO(sbtc-default-pc): once the sBTC token contract is finalized per network,
  // attach this post-condition by DEFAULT here (keyed by network) so callers on
  // mainnet don't have to. Skip when the caller already supplied `postConditions`.
  // Something like:
  //
  //   let postConditions = args.postConditions;
  //   if (args.lockup.kind === 'sbtc' && postConditions === undefined) {
  //     const sender = getAddressFromPublicKey(args.publicKey, args.network);
  //     const sbtcContract = SBTC_TOKEN_CONTRACT[networkName(args.network)]; // hardcoded per network
  //     postConditions = [
  //       Pc.principal(sender).willSendEq(args.lockup.sbtcSats).ft(sbtcContract, SBTC_ASSET_NAME),
  //     ];
  //   }
  //   return callPox5('register-for-bond', [...], { ...args, postConditions });
  //
  // Not done now: the sBTC token principal still changes (deploy-configured on
  // testnet/regtest), so hardcoding it would be wrong.
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

/** @internal */
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
            'unlock-burn-height': Cl.uint(o.unlockBurnHeight),
          })
        )
      ),
      'staker-unlock-bytes': clBufferFrom(lockup.unlockBytes),
    })
  );
}

/**
 * Build an unsigned `update-bond-registration` transaction.
 *
 * Rotates the signer-manager bound to the caller's existing bond membership.
 * `oldSignerManager` must equal the currently recorded signer. Takes effect
 * from the next reward cycle (or the bond's start cycle if it hasn't begun).
 *
 * @example
 * ```ts
 * // Move an existing bond membership to a new signer-manager.
 * const tx = await buildUpdateBondRegistration({
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.new-signer-manager',
 *   oldSignerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.old-signer-manager',
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildUpdateBondRegistration(
  args: {
    /** Contract address of the new signer-manager. */
    signerManager: string;
    /** Contract address of the signer-manager currently bound to the membership. */
    oldSignerManager: string;
    /**
     * Opaque calldata forwarded to the new `signer-manager.validate-stake!`.
     * Use {@link buildSignerCalldata} to elect an L1 BTC payout; omit for the
     * sBTC default.
     */
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
 * Notifies pox-5 to stop counting the staker's BTC shares for this bond period.
 * Callable only by the staker themselves (`contract-caller == tx-sender ==
 * staker`; `ERR_UNAUTHORIZED` otherwise — forwarding via another contract is
 * not allowed), and only when the membership has `is-l1-lock = true`
 * (`ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK`). `oldSignerManager` must match the
 * staker's currently bound signer (`ERR_INVALID_OLD_SIGNER_MANAGER`). A second
 * announce for the same bond reverts with `ERR_L1_EARLY_EXIT_ALREADY_ANNOUNCED`
 * — gate on {@link fetchHasAnnouncedL1EarlyExit} first. On success the staker's
 * bond shares are zeroed and the share totals decremented; the locked STX is
 * untouched and unlocks on the bond's normal schedule.
 *
 * @example
 * ```ts
 * // Staker announces an early exit from their L1 bond (signed by the staker).
 * const tx = await buildAnnounceL1EarlyExit({
 *   staker: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR',
 *   oldSignerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
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
 * `amountToWithdrawSats` must be <= the staker's current sBTC shares
 * (`ERR_INVALID_UNSTAKE_SBTC_AMOUNT`). The sBTC is transferred to the staker
 * via `sbtc-token.transfer` from the contract.
 *
 * @example
 * ```ts
 * // Withdraw 0.5 BTC worth of sBTC shares.
 * const tx = await buildUnstakeSbtc({
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   amountToWithdrawSats: 50_000_000n,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildUnstakeSbtc(
  args: {
    /** Contract address of the signer-manager currently bound to the staker. */
    signerManager: string;
    /** sBTC sats to withdraw. Must be <= the staker's current sBTC shares. */
    amountToWithdrawSats: IntegerType;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'unstake-sbtc',
    [Cl.address(args.signerManager), Cl.uint(args.amountToWithdrawSats)],
    args
  );
}

/**
 * Build an unsigned PoX-5 `stake` transaction (STX-only entry).
 *
 * Authorization is delegated to the signer-manager contract via
 * `validate-stake!`. The paired-BTC entry is `register-for-bond`.
 *
 * @example
 * ```ts
 * // Lock 1 STX for 6 cycles under a signer-manager.
 * const tx = await buildStake({
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   amountUstx: 1_000_000n,
 *   numCycles: 6,
 *   startBurnHt: poxInfo.currentBurnchainBlockHeight,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildStake(
  args: {
    /** Contract address of the signer-manager implementing `signer-manager-trait`. */
    signerManager: string;
    amountUstx: IntegerType;
    numCycles: number;
    /** Burn-block height that anchors the cycle to enroll in (replay guard). */
    startBurnHt: number;
    /**
     * Opaque calldata forwarded to `signer-manager.validate-stake!`.
     * Use {@link buildSignerCalldata} to elect an L1 BTC payout; omit for the
     * sBTC default.
     */
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
 * (`ERR_INVALID_OLD_SIGNER_MANAGER`) before applying the update.
 *
 * unsure: todo: the API takes `cyclesToExtend`/`amountIncrease` with `0` meaning
 * "skip". The contract's own min-num-cycles guard (`check-pox-lock-period`)
 * is computed against `(unlock-cycle - current-cycle - 1)`, so a pure rotate
 * (both zeros, already-extended position) only succeeds if the existing tail
 * still satisfies the bound. No client-side guard added.
 *
 * @example
 * ```ts
 * // Extend by 3 cycles and top up by 0.5 STX; keep the same signer-manager.
 * const tx = await buildStakeUpdate({
 *   signerManager: current,
 *   oldSignerManager: current,
 *   cyclesToExtend: 3,
 *   amountIncrease: 500_000n,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 *
 * @example
 * ```ts
 * // Rotate the signer-manager only (skip extend + top-up).
 * const tx = await buildStakeUpdate({
 *   signerManager: next,
 *   oldSignerManager: current,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
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
    /**
     * Opaque calldata forwarded to `signer-manager.validate-stake!`.
     * Use {@link buildSignerCalldata} to elect an L1 BTC payout; omit for the
     * sBTC default.
     */
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
 * (`ERR_INVALID_OLD_SIGNER_MANAGER`) before zeroing the position.
 *
 * @example
 * ```ts
 * // Unlock the STX-only position at the end of the current cycle.
 * const tx = await buildUnstake({
 *   oldSignerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildUnstake(
  args: {
    /** Contract address of the signer-manager currently recorded for the staker. */
    oldSignerManager: string;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5('unstake', [Cl.address(args.oldSignerManager)], args);
}

/**
 * Build an unsigned `calculate-rewards` transaction.
 *
 * Anyone can call. Settles the current distribution cycle's waterfall:
 * iterates `bondPeriods` in descending `stx-value-ratio` order (drawdown
 * priority — caller is responsible for the ordering, contract enforces it
 * via `ERR_INVALID_BOND_PERIOD_ORDERING`), pays each up to its target APY
 * out of accrued sBTC, routes 15% (`RESERVE_RATIO`) of the cycle excess to
 * the reserve, and distributes the remainder pro rata to STX-only stakers.
 * Gated by `calculation-height > last-reward-compute-height` (where
 * `calculation-height = distribution-cycle-to-burn-height(current-distribution-cycle) - 1`);
 * reverts with `ERR_DISTRIBUTION_ALREADY_COMPUTED` otherwise.
 *
 * The `bondPeriods` list must include every active bond at
 * `calculation-height` (`assert-all-active-bonds-included`); pass the full
 * `activeBondIndices` set the dashboard surfaces, not a filtered subset.
 *
 * unsure: todo: whether to expose a client-side ordering helper. Today the caller
 * must pre-sort by descending `stx-value-ratio` (on ties the higher
 * `bond-index` comes first). Could wrap once a fetch helper surfaces
 * per-bond `stx-value-ratio` in a single call.
 *
 * @example
 * ```ts
 * // Settle the current distribution cycle. Pass ALL active bonds, sorted by
 * // descending stx-value-ratio.
 * const tx = await buildCalculateRewards({
 *   bondIndices: activeBondIndices,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
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
 * The per-bond breakdown is mirrored in the `print` event. Reverts with
 * `ERR_NO_CLAIMABLE_REWARDS` if every leg is empty — gate on {@link fetchEarned}
 * first. Reverts with `ERR_REWARDS_PAUSED` once `pause-rewards` has been called
 * — a permanent, one-way state; gate on {@link fetchRewardsPaused}.
 *
 * The signer-manager contract must be the `contract-caller` (the contract
 * uses `contract-caller` as the signer address); for direct calls this
 * means `tx-sender` is the signer-manager principal.
 *
 * `rewardCycle` is a **reward cycle** (the PoX-cycle clock) — the same value
 * as `poxInfo.rewardCycleId` and {@link fetchEarned}'s `rewardCycle`. It is
 * NOT the distribution-cycle index (distribution cycles are half a reward
 * cycle, so they tick twice as fast). To claim the cycle `calculate-rewards`
 * just settled, convert the settlement height back to its reward cycle:
 * `burnHeightToRewardCycle({ burnHeight: distributionCycleToBurnHeight({`
 * `distributionCycle: currentDistributionCycle(poxInfo), poxInfo }) - 1,`
 * `poxInfo })` — not `currentDistributionCycle - 1`.
 *
 * @example
 * ```ts
 * // Claim the STX-only leg + two bond legs for a settled reward cycle.
 * // Called by the signer-manager contract (it is the `contract-caller`).
 * const tx = await buildClaimRewards({
 *   rewardCycle: poxInfo.rewardCycleId - 1,
 *   bondIndices: [0, 1],
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
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

/**
 * Build an unsigned `claim-staker-rewards-for-signer` transaction.
 *
 * Marks a specific staker as having claimed rewards for the leg at
 * `rewardCycle` — pass `bondIndex` to target a paired-BTC bond leg, omit it for
 * the STX-only leg. Only callable by the signer-manager contract (the contract
 * uses `contract-caller` to authorize the claim); a plain wallet call reverts
 * with `ERR_UNAUTHORIZED`.
 *
 * @example
 * ```ts
 * // Mark a staker's bond-0 leg as claimed for a reward cycle (omit bondIndex
 * // for the STX-only leg). Called by the signer-manager contract.
 * const tx = await buildClaimStakerRewardsForSigner({
 *   staker: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR',
 *   rewardCycle: poxInfo.rewardCycleId - 1,
 *   bondIndex: 0,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
 */
export async function buildClaimStakerRewardsForSigner(
  args: {
    /** Staker principal being marked as claimed. */
    staker: string;
    /** Reward cycle of the leg being claimed. */
    rewardCycle: number;
    /** Bond index to target the paired-BTC bond leg; omit for the STX-only leg. */
    bondIndex?: number;
  } & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'claim-staker-rewards-for-signer',
    [
      Cl.address(args.staker),
      Cl.uint(args.rewardCycle),
      args.bondIndex === undefined ? Cl.none() : Cl.some(Cl.uint(args.bondIndex)),
    ],
    args
  );
}

/**
 * Build an unsigned `grant-signer-key` transaction.
 *
 * Records a SIP-018 grant that authorizes `signerManager` to register
 * `signerKey` via `register-signer`. The contract:
 *
 *  1. Asserts the `(signer-key, signer-manager, auth-id)` triple has not
 *     previously been consumed (`used-signer-key-grants`) — replay guard.
 *  2. Recovers the public key from `signerSignature` over the SIP-018
 *     message hash built by {@link buildSignerGrantMessage}, and asserts it
 *     equals `signerKey`.
 *  3. Marks the auth-id used and writes `signer-key-grants[signer-key,
 *     signer-manager] = true`.
 *
 * The signature is generated off-chain by the signer-key holder via
 * {@link signSignerGrant}.
 *
 * On-chain arg order: `(signer-key, signer-manager, auth-id, signer-sig)`.
 *
 * @example
 * ```ts
 * // Sign the grant off-chain, then authorize the signer-manager to register it.
 * const signerSignature = signSignerGrant(signerKey, { signerManager, authId, chainId });
 * const tx = await buildGrantSignerKey({
 *   signerKey,
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   authId,
 *   signerSignature,
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
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
 *
 * @example
 * ```ts
 * // Revoke a grant. tx-sender must be the principal derived from signerKey.
 * const tx = await buildRevokeSignerGrant({
 *   signerKey,
 *   signerManager: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.my-signer-manager',
 *   publicKey,
 *   fee, nonce, network: 'mainnet',
 * });
 * ```
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

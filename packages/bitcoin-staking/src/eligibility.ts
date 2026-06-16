import { type IntegerType, bytesToHex } from '@stacks/common';
import type { NetworkClientParam } from '@stacks/network';
import { networkFrom } from '@stacks/network';
import { getAddressFromPublicKey } from '@stacks/transactions';
import { BOND_GAP_CYCLES, MAX_NUM_CYCLES } from './constants';
import {
  BOND_END_OFFSET_PERIODS,
  bondPeriodToBurnHeight,
  bondPeriodToRewardCycle,
  burnHeightToRewardCycle,
  currentDistributionCycle,
  distributionCycleToBurnHeight,
  isBondActiveAtHeight,
  isInPreparePhase,
  minUstxForSatsAmount,
} from './cycles';
import { Pox5ErrorCode } from './errors';
import {
  fetchAccountStatus,
  fetchBondAdmin,
  fetchBondAllowance,
  fetchBondL1UnlockHeight,
  fetchBondMembership,
  fetchHasAnnouncedL1EarlyExit,
  fetchBondOverlapsNewPosition,
  fetchEarned,
  fetchLastRewardComputeHeight,
  fetchPoxInfo,
  fetchProtocolBond,
  fetchProtocolBondMemberships,
  fetchSignerInfo,
  fetchSignerKeyGrantUsed,
  fetchStakerInfo,
  fetchVerifyBlockHeader,
  fetchVerifySignerKeyGrant,
} from './fetch';
import { computeBitcoinTxid, serializeBitcoinTx } from './proof';
import { verifySignerGrant } from './signer';
import type { BondL1LockupOutput, PoxInfo } from './types';

/**
 * Result of an eligibility preflight (`fetchEligible*`).
 *
 * On `ok: false`, `reasons` lists every check that would fail, as the
 * contract's own error codes ({@link Pox5ErrorCode}), in the order the
 * contract evaluates them — `reasons[0]` is the error the transaction would
 * actually abort with.
 */
export type EligibilityResult =
  | { ok: true }
  | { ok: false; reasons: [Pox5ErrorCode, ...Pox5ErrorCode[]] };

/**
 * Dry-run the checks of `register-for-bond` via read-only fetches, without
 * broadcasting anything.
 *
 * Rebuilds the contract's assert chain client-side and reports every gate
 * that would fail (allowlist, timing, STX minimum and balance, signer
 * registration and key grant, overlapping positions, rollover window).
 *
 * Not covered:
 * - `signer-manager-validate-stake` — a public trait call on the signer
 *   manager contract; it may still reject the registration.
 * - L1 SPV proof (`verify-l1-lockups`): when `outputs` is provided, the block
 *   header validity (`ERR_INVALID_BTC_HEADER u40`) and duplicate-outpoint
 *   (`ERR_DUPLICATE_LOCKUP_OUTPOINT u46`) checks ARE run. The merkle proof
 *   (u41), output script (u42), amount (u45), and tx-parse (u39) checks are NOT
 *   yet covered — TODO — and are verified only on-chain. Pass the summed output
 *   sats as `satsTotal` regardless.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it
 * avoid the extra round-trip.
 */
export async function fetchEligibleRegisterForBond(
  opts: {
    bondIndex: number;
    /** The staker registering (the future `tx-sender`). */
    staker: string;
    /** uSTX the staker would commit. */
    amountUstx: bigint;
    /** Sats being staked: the sBTC amount, or the summed L1 lockup outputs. */
    satsTotal: bigint;
    /** The signer-manager contract the staker would register with. */
    signerManager: string;
    /**
     * L1 lockup outputs, when registering with a `kind: 'btc'` lockup. Enables
     * the header (u40) and duplicate-outpoint (u46) SPV checks; omit for sBTC.
     */
    outputs?: BondL1LockupOutput[];
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };
  const staker = { address: opts.staker };

  const [poxInfo, bond, allowance, stakerInfo, account, membership, signerInfo] = await Promise.all(
    [
      opts.poxInfo ?? fetchPoxInfo(networkClient),
      fetchProtocolBond({ bondIndex: opts.bondIndex, ...networkClient }),
      fetchBondAllowance({ bondIndex: opts.bondIndex, ...staker, ...networkClient }),
      fetchStakerInfo({ ...staker, ...networkClient }),
      fetchAccountStatus({ ...staker, ...networkClient }),
      fetchBondMembership({ ...staker, ...networkClient }),
      fetchSignerInfo({ signerManager: opts.signerManager, ...networkClient }),
    ]
  );

  const burnHeight = poxInfo.currentBurnchainBlockHeight;
  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex: opts.bondIndex, poxInfo });
  const bondStartHeight = bondPeriodToBurnHeight({ bondIndex: opts.bondIndex, poxInfo });

  // Second stage: reads that depend on the first stage's results.
  const [grantActive, overlaps, l1UnlockHeight] = await Promise.all([
    signerInfo
      ? fetchVerifySignerKeyGrant({
          signerKey: signerInfo.signerKey,
          signerManager: opts.signerManager,
          ...networkClient,
        })
      : false,
    membership
      ? fetchBondOverlapsNewPosition({
          membership,
          newFirstRewardCycle: firstRewardCycle,
          ...networkClient,
        })
      : false,
    membership
      ? fetchBondL1UnlockHeight({ bondIndex: membership.bondIndex, ...networkClient })
      : undefined,
  ]);

  // Partial L1 SPV checks (u40 header, u46 duplicate outpoint); the rest are TODO.
  const headerValidity = opts.outputs?.length
    ? await Promise.all(
        opts.outputs.map(o =>
          fetchVerifyBlockHeader({
            header: o.header,
            expectedBlockHeight: o.height,
            ...networkClient,
          })
        )
      )
    : [];

  // Mirror the contract's assert order, so `reasons[0]` matches the error a
  // real `register-for-bond` would abort with.
  const reasons: Pox5ErrorCode[] = [];

  // L1 SPV verification runs first in the contract (`sats-total` let-binding).
  if (opts.outputs?.length) {
    if (headerValidity.includes(false)) reasons.push(Pox5ErrorCode.InvalidBtcHeader);
    const outpoints = opts.outputs.map(
      o => `${bytesToHex(computeBitcoinTxid(serializeBitcoinTx(o.tx)))}:${o.outputIndex}`
    );
    if (new Set(outpoints).size !== outpoints.length) {
      reasons.push(Pox5ErrorCode.DuplicateLockupOutpoint);
    }
  }

  // `(unwrap! (map-get? protocol-bonds ...))` / allowlist unwraps in the let-bindings
  if (!bond) reasons.push(Pox5ErrorCode.BondNotFound);
  // No allowlist entry and an entry of `0` are indistinguishable here; both
  // make any positive `satsTotal` fail, the former as NOT_ALLOWLISTED.
  if (allowance === 0n) reasons.push(Pox5ErrorCode.NotAllowlisted);

  if (isInPreparePhase({ burnHeight, poxInfo })) {
    reasons.push(Pox5ErrorCode.StakeInPreparePhase);
  }

  if (
    bond &&
    opts.amountUstx <
      minUstxForSatsAmount({
        sats: opts.satsTotal,
        stxValueRatio: bond.stxValueRatio,
        minUstxRatioBps: bond.minUstxRatioBps,
      })
  ) {
    reasons.push(Pox5ErrorCode.InsufficientStx);
  }

  if (burnHeight >= bondStartHeight) reasons.push(Pox5ErrorCode.BondAlreadyStarted);

  // Existing STX-only stake must end no later than this bond's first cycle
  if (
    stakerInfo.staked &&
    stakerInfo.details.firstRewardCycle + stakerInfo.details.numCycles > firstRewardCycle
  ) {
    reasons.push(Pox5ErrorCode.AlreadyStaked);
  }

  if (opts.satsTotal > allowance) reasons.push(Pox5ErrorCode.TooMuchSats);

  // total balance (locked + unlocked) >= amount-ustx
  if (account.balance + account.locked < opts.amountUstx) {
    if (!reasons.includes(Pox5ErrorCode.InsufficientStx)) {
      reasons.push(Pox5ErrorCode.InsufficientStx);
    }
  }

  if (!signerInfo) reasons.push(Pox5ErrorCode.SignerNotFound);
  else if (!grantActive) reasons.push(Pox5ErrorCode.SignerKeyGrantNotFound);

  // No overlapping bond membership (incl. re-registering the same bond)
  if (overlaps) reasons.push(Pox5ErrorCode.AlreadyRegistered);

  // Rollover from a non-overlapping bond only in its L1 unlock window
  if (membership && !overlaps && l1UnlockHeight !== undefined && burnHeight < l1UnlockHeight) {
    reasons.push(Pox5ErrorCode.RolloverTooEarly);
  }

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `set-bond-admin` via read-only fetches, without
 * broadcasting anything.
 *
 * Only gate: the caller must be the current `bond-admin` (`ERR_UNAUTHORIZED`).
 * Fetches the current admin with {@link fetchBondAdmin} and compares.
 */
export async function fetchEligibleSetBondAdmin(
  opts: {
    /** The principal that would send the tx (the future `contract-caller`). */
    caller: string;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const admin = await fetchBondAdmin({ network: opts.network, client: opts.client });
  return opts.caller === admin
    ? { ok: true }
    : { ok: false, reasons: [Pox5ErrorCode.Unauthorized] };
}

/**
 * Dry-run the checks of `setup-bond` via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: caller is the bond admin, the setup
 * timing window (too soon / too late), the bond index is unused, and no
 * duplicate stakers in the allowlist.
 *
 * The timing gates are evaluated against the CURRENT burn height — they are
 * "true right now", and may change by the time the tx is mined.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleSetupBond(
  opts: {
    bondIndex: number;
    /** Allowlist as passed to `buildSetupBond`; only `staker` is inspected here. */
    allowlist: { staker: string; maxSats: IntegerType }[];
    /** The principal that would send the tx (the future `contract-caller`). */
    caller: string;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };

  const [admin, poxInfo, bond] = await Promise.all([
    fetchBondAdmin(networkClient),
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchProtocolBond({ bondIndex: opts.bondIndex, ...networkClient }),
  ]);

  const reasons: Pox5ErrorCode[] = [];

  if (opts.caller !== admin) reasons.push(Pox5ErrorCode.Unauthorized);

  const burnHeight = poxInfo.currentBurnchainBlockHeight;
  const bondStartHeight = bondPeriodToBurnHeight({ bondIndex: opts.bondIndex, poxInfo });
  const gap = BOND_GAP_CYCLES * poxInfo.rewardCycleLength;

  // matches the contract's underflow guard on `bondStartHeight - gap`
  if (bondStartHeight >= gap && bondStartHeight - gap > burnHeight) {
    reasons.push(Pox5ErrorCode.CannotSetupBondTooSoon);
  }

  if (burnHeight >= bondStartHeight) reasons.push(Pox5ErrorCode.CannotSetupBondTooLate);

  if (bond !== undefined) reasons.push(Pox5ErrorCode.BondAlreadySetup);

  const stakers = opts.allowlist.map(e => e.staker);
  if (new Set(stakers).size !== stakers.length) {
    reasons.push(Pox5ErrorCode.StakerAlreadyAdded);
  }

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `update-bond-registration` via read-only fetches,
 * without broadcasting anything.
 *
 * Reports every gate that would fail: the staker has an active bond membership,
 * not in prepare phase, `oldSignerManager` matches the current signer, the new
 * signer differs, and the new signer is registered with an active key grant.
 *
 * Not covered: the signer-manager `validate-stake!` trait call, which may still
 * reject the update.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleUpdateBondRegistration(
  opts: {
    /** The staker whose membership is being updated (the future `tx-sender`). */
    staker: string;
    /** New signer-manager to bind. */
    signerManager: string;
    /** Signer-manager currently bound to the membership. */
    oldSignerManager: string;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };

  const [poxInfo, membership, signerInfo] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchBondMembership({ address: opts.staker, ...networkClient }),
    fetchSignerInfo({ signerManager: opts.signerManager, ...networkClient }),
  ]);

  const grantActive = signerInfo
    ? await fetchVerifySignerKeyGrant({
        signerKey: signerInfo.signerKey,
        signerManager: opts.signerManager,
        ...networkClient,
      })
    : false;

  const reasons: Pox5ErrorCode[] = [];

  if (!membership) reasons.push(Pox5ErrorCode.NotBondParticipant);

  if (isInPreparePhase({ burnHeight: poxInfo.currentBurnchainBlockHeight, poxInfo })) {
    reasons.push(Pox5ErrorCode.StakeInPreparePhase);
  }

  if (membership && opts.oldSignerManager !== membership.signer) {
    reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
  }

  if (opts.signerManager === opts.oldSignerManager) {
    reasons.push(Pox5ErrorCode.UpdateBondSameSigner);
  }

  if (!signerInfo) reasons.push(Pox5ErrorCode.SignerNotFound);
  else if (!grantActive) reasons.push(Pox5ErrorCode.SignerKeyGrantNotFound);

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `announce-l1-early-exit` via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: the staker has an active bond membership,
 * not in prepare phase, the membership is an L1 lock, `oldSignerManager` matches
 * the current signer, and no early exit has already been announced.
 *
 * The `contract-caller == tx-sender == staker` gate (`ERR_UNAUTHORIZED`) is a
 * tx-construction concern and is not checked here — send the tx directly from
 * the staker, not via an intermediary contract.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleAnnounceL1EarlyExit(
  opts: {
    /** Staker whose L1 early-exit is announced. */
    staker: string;
    /** Signer-manager currently bound to the staker. */
    oldSignerManager: string;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };

  const [poxInfo, membership] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchBondMembership({ address: opts.staker, ...networkClient }),
  ]);

  const alreadyAnnounced = membership
    ? await fetchHasAnnouncedL1EarlyExit({
        bondIndex: membership.bondIndex,
        staker: opts.staker,
        ...networkClient,
      })
    : false;

  const reasons: Pox5ErrorCode[] = [];

  if (!membership) reasons.push(Pox5ErrorCode.NotBondParticipant);

  if (isInPreparePhase({ burnHeight: poxInfo.currentBurnchainBlockHeight, poxInfo })) {
    reasons.push(Pox5ErrorCode.StakeInPreparePhase);
  }

  if (membership && !membership.isL1Lock) {
    reasons.push(Pox5ErrorCode.CannotAnnounceL1EarlyUnlock);
  }

  if (membership && opts.oldSignerManager !== membership.signer) {
    reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
  }

  if (alreadyAnnounced) reasons.push(Pox5ErrorCode.L1EarlyExitAlreadyAnnounced);

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `unstake-sbtc` via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: the staker has a bond membership,
 * `amountToWithdrawSats` is within their shares, not in prepare phase,
 * `signerManager` matches the current signer, and the membership is sBTC-backed.
 *
 * Reads the raw membership ({@link fetchProtocolBondMemberships}) since
 * `unstake-sbtc` accepts expired-but-present memberships. The sBTC token
 * transfer is not checked — the contract custodies the staked sBTC.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleUnstakeSbtc(
  opts: {
    /** Staker withdrawing (the future `tx-sender`). */
    staker: string;
    /** Signer-manager currently bound to the staker. */
    signerManager: string;
    /** sBTC sats to withdraw. */
    amountToWithdrawSats: bigint;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };

  const [poxInfo, membership] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchProtocolBondMemberships({ address: opts.staker, ...networkClient }),
  ]);

  const reasons: Pox5ErrorCode[] = [];

  if (!membership) reasons.push(Pox5ErrorCode.NotBondParticipant);

  if (membership && opts.amountToWithdrawSats > membership.amountSats) {
    reasons.push(Pox5ErrorCode.InvalidUnstakeSbtcAmount);
  }

  if (isInPreparePhase({ burnHeight: poxInfo.currentBurnchainBlockHeight, poxInfo })) {
    reasons.push(Pox5ErrorCode.StakeInPreparePhase);
  }

  if (membership && opts.signerManager !== membership.signer) {
    reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
  }

  if (membership && membership.isL1Lock) reasons.push(Pox5ErrorCode.CannotUnstakeSbtc);

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `stake-update` via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: the staker has an active STX-only stake,
 * not in prepare phase, `oldSignerManager` matches the current signer, the new
 * signer is registered with an active key grant, the resulting lock period is
 * in `[1, MAX_NUM_CYCLES]`, and enough unlocked STX covers `amountIncrease`.
 *
 * Not covered: the signer-manager `validate-stake!` trait call.
 *
 * The num-cycles gate is the tail-period guard: `num-cycles = firstRewardCycle +
 * numCycles + cyclesToExtend - currentCycle - 1`. A value ≤ 0 surfaces as
 * `INVALID_NUM_CYCLES` here, though on-chain a negative result is a uint
 * underflow (runtime abort) rather than that error code.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleStakeUpdate(
  opts: {
    /** Staker updating their stake (the future `tx-sender`). */
    staker: string;
    /** New signer-manager to bind. */
    signerManager: string;
    /** Signer-manager currently bound to the staker. */
    oldSignerManager: string;
    /** Cycles to extend the lock by (default 0). */
    cyclesToExtend?: number;
    /** Additional uSTX to lock (default 0n). */
    amountIncrease?: bigint;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };
  const staker = { address: opts.staker };

  const [poxInfo, stakerInfo, signerInfo, account] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchStakerInfo({ ...staker, ...networkClient }),
    fetchSignerInfo({ signerManager: opts.signerManager, ...networkClient }),
    fetchAccountStatus({ ...staker, ...networkClient }),
  ]);

  const grantActive = signerInfo
    ? await fetchVerifySignerKeyGrant({
        signerKey: signerInfo.signerKey,
        signerManager: opts.signerManager,
        ...networkClient,
      })
    : false;

  const reasons: Pox5ErrorCode[] = [];

  if (!stakerInfo.staked) reasons.push(Pox5ErrorCode.NotStaking);

  if (isInPreparePhase({ burnHeight: poxInfo.currentBurnchainBlockHeight, poxInfo })) {
    reasons.push(Pox5ErrorCode.StakeInPreparePhase);
  }

  if (stakerInfo.staked && opts.oldSignerManager !== stakerInfo.details.signer) {
    reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
  }

  if (!signerInfo) reasons.push(Pox5ErrorCode.SignerNotFound);
  else if (!grantActive) reasons.push(Pox5ErrorCode.SignerKeyGrantNotFound);

  if (stakerInfo.staked) {
    const numCycles =
      stakerInfo.details.firstRewardCycle +
      stakerInfo.details.numCycles +
      (opts.cyclesToExtend ?? 0) -
      poxInfo.rewardCycleId -
      1;
    if (numCycles < 1 || numCycles > MAX_NUM_CYCLES) {
      reasons.push(Pox5ErrorCode.InvalidNumCycles);
    }
  }

  if (account.balance < (opts.amountIncrease ?? 0n)) {
    reasons.push(Pox5ErrorCode.InsufficientStx);
  }

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `unstake` via read-only fetches, without broadcasting
 * anything.
 *
 * Reports every gate that would fail: the staker has an active STX-only stake,
 * `oldSignerManager` matches the current signer, and not in prepare phase.
 * Every gate is covered.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleUnstake(
  opts: {
    /** Staker unstaking (the future `tx-sender`). */
    staker: string;
    /** Signer-manager currently bound to the staker. */
    oldSignerManager: string;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };

  const [poxInfo, stakerInfo] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchStakerInfo({ address: opts.staker, ...networkClient }),
  ]);

  const reasons: Pox5ErrorCode[] = [];

  if (!stakerInfo.staked) reasons.push(Pox5ErrorCode.NotStaking);

  if (stakerInfo.staked && opts.oldSignerManager !== stakerInfo.details.signer) {
    reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
  }

  if (isInPreparePhase({ burnHeight: poxInfo.currentBurnchainBlockHeight, poxInfo })) {
    reasons.push(Pox5ErrorCode.UnstakeInPreparePhase);
  }

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `calculate-rewards` via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: the distribution cycle isn't already
 * computed, `bondIndices` includes every active bond at the calculation height,
 * each listed bond exists, the list is ordered by descending `stx-value-ratio`
 * (ties: ascending bond index), and each listed bond is active.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleCalculateRewards(
  opts: {
    /** Bond indices to settle, pre-sorted by descending `stx-value-ratio`. */
    bondIndices: number[];
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };
  const poxInfo = opts.poxInfo ?? (await fetchPoxInfo(networkClient));

  const calcHeight =
    distributionCycleToBurnHeight({ distributionCycle: currentDistributionCycle(poxInfo), poxInfo }) -
    1;

  // Active-bond window the contract checks: indices `latest - 5 .. latest`.
  const calcCycle = burnHeightToRewardCycle({ burnHeight: calcHeight, poxInfo });
  const firstBondCycle = bondPeriodToRewardCycle({ bondIndex: 0, poxInfo });
  const latest =
    calcCycle <= firstBondCycle ? 0 : Math.floor((calcCycle - firstBondCycle) / BOND_GAP_CYCLES);
  const windowStart = Math.max(0, latest - (BOND_END_OFFSET_PERIODS - 1));
  const candidates = [];
  for (let i = windowStart; i <= latest; i++) candidates.push(i);

  const idsToFetch = [...new Set([...candidates, ...opts.bondIndices])];
  const [lastComputeHeight, ...fetchedBonds] = await Promise.all([
    fetchLastRewardComputeHeight(networkClient),
    ...idsToFetch.map(bondIndex => fetchProtocolBond({ bondIndex, ...networkClient })),
  ]);
  const bondById = new Map(idsToFetch.map((id, i) => [id, fetchedBonds[i]]));
  const isActive = (bondIndex: number) =>
    bondById.get(bondIndex) !== undefined &&
    isBondActiveAtHeight({ bondIndex, burnHeight: calcHeight, poxInfo });

  const reasons: Pox5ErrorCode[] = [];

  if (calcHeight <= lastComputeHeight) reasons.push(Pox5ErrorCode.DistributionAlreadyComputed);

  if (candidates.some(c => isActive(c) && !opts.bondIndices.includes(c))) {
    reasons.push(Pox5ErrorCode.ActiveBondNotIncluded);
  }

  if (opts.bondIndices.some(i => bondById.get(i) === undefined)) {
    reasons.push(Pox5ErrorCode.BondNotFound);
  }

  const ratios = opts.bondIndices.map(i => bondById.get(i));
  const misordered = ratios.some((bond, k) => {
    if (k === 0 || !bond || !ratios[k - 1]) return false;
    const prev = ratios[k - 1]!;
    return bond.stxValueRatio > prev.stxValueRatio
      ? true
      : bond.stxValueRatio === prev.stxValueRatio &&
          opts.bondIndices[k] <= opts.bondIndices[k - 1];
  });
  if (misordered) reasons.push(Pox5ErrorCode.InvalidBondPeriodOrdering);

  if (opts.bondIndices.some(i => bondById.get(i) !== undefined && !isActive(i))) {
    reasons.push(Pox5ErrorCode.BondNotActive);
  }

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `claim-rewards` via read-only fetches, without
 * broadcasting anything.
 *
 * Only gate: total claimable rewards must be > 0 — the sum of the signer's
 * earned across the STX-only leg and one leg per `bondIndices` entry.
 *
 * The sBTC token transfer is not checked (the contract holds the accrued sBTC).
 * `rewardCycle` is a reward cycle, not a distribution-cycle index — passing the
 * wrong cycle yields 0 earned and a `NO_CLAIMABLE_REWARDS` result.
 */
export async function fetchEligibleClaimRewards(
  opts: {
    /** The claiming signer-manager (the future `contract-caller`). */
    signerManager: string;
    /** STX-only reward cycle to claim. */
    rewardCycle: number;
    /** Bond indices whose legs to claim. */
    bondIndices: number[];
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };
  const { signerManager, rewardCycle } = opts;

  const earned = await Promise.all([
    fetchEarned({ signerManager, rewardCycle, ...networkClient }),
    ...opts.bondIndices.map(bondIndex =>
      fetchEarned({ signerManager, rewardCycle, bondIndex, ...networkClient })
    ),
  ]);

  const total = earned.reduce((sum, e) => sum + e, 0n);

  return total > 0n
    ? { ok: true }
    : { ok: false, reasons: [Pox5ErrorCode.NoClaimableRewards] };
}

/**
 * Dry-run the checks of `stake` (STX-only entry) via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: not in prepare phase, the signer is
 * registered with an active key grant, `startBurnHt` resolves to the next
 * cycle, the lock period is in `[1, MAX_NUM_CYCLES]`, no existing STX-only stake
 * or overlapping bond, any bond rollover is within its L1 unlock window, and
 * enough total balance covers `amountUstx`.
 *
 * Not covered: the signer-manager `validate-stake!` trait call.
 *
 * `poxInfo` is fetched when not provided, so callers that already hold it avoid
 * the extra round-trip.
 */
export async function fetchEligibleStake(
  opts: {
    /** Staker entering the stake (the future `tx-sender`). */
    staker: string;
    /** Signer-manager to bind. */
    signerManager: string;
    /** uSTX to lock. */
    amountUstx: bigint;
    /** Lock duration in cycles. */
    numCycles: number;
    /** Burn-block height anchoring the start cycle. */
    startBurnHt: number;
    poxInfo?: PoxInfo;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };
  const staker = { address: opts.staker };

  const [poxInfo, stakerInfo, signerInfo, account, membership] = await Promise.all([
    opts.poxInfo ?? fetchPoxInfo(networkClient),
    fetchStakerInfo({ ...staker, ...networkClient }),
    fetchSignerInfo({ signerManager: opts.signerManager, ...networkClient }),
    fetchAccountStatus({ ...staker, ...networkClient }),
    fetchBondMembership({ ...staker, ...networkClient }),
  ]);

  const firstRewardCycle = poxInfo.rewardCycleId + 1;

  const [grantActive, overlaps, l1UnlockHeight] = await Promise.all([
    signerInfo
      ? fetchVerifySignerKeyGrant({
          signerKey: signerInfo.signerKey,
          signerManager: opts.signerManager,
          ...networkClient,
        })
      : false,
    membership
      ? fetchBondOverlapsNewPosition({ membership, newFirstRewardCycle: firstRewardCycle, ...networkClient })
      : false,
    membership
      ? fetchBondL1UnlockHeight({ bondIndex: membership.bondIndex, ...networkClient })
      : undefined,
  ]);

  const burnHeight = poxInfo.currentBurnchainBlockHeight;
  const reasons: Pox5ErrorCode[] = [];

  if (isInPreparePhase({ burnHeight, poxInfo })) reasons.push(Pox5ErrorCode.StakeInPreparePhase);

  if (!signerInfo) reasons.push(Pox5ErrorCode.SignerNotFound);
  else if (!grantActive) reasons.push(Pox5ErrorCode.SignerKeyGrantNotFound);

  if (burnHeightToRewardCycle({ burnHeight: opts.startBurnHt, poxInfo }) !== poxInfo.rewardCycleId) {
    reasons.push(Pox5ErrorCode.InvalidStartBurnHeight);
  }

  if (opts.numCycles < 1 || opts.numCycles > MAX_NUM_CYCLES) {
    reasons.push(Pox5ErrorCode.InvalidNumCycles);
  }

  if (stakerInfo.staked || overlaps) reasons.push(Pox5ErrorCode.AlreadyStaked);

  if (membership && !overlaps && l1UnlockHeight !== undefined && burnHeight < l1UnlockHeight) {
    reasons.push(Pox5ErrorCode.RolloverTooEarly);
  }

  if (account.balance + account.locked < opts.amountUstx) {
    reasons.push(Pox5ErrorCode.InsufficientStx);
  }

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `grant-signer-key` via read-only fetches, without
 * broadcasting anything.
 *
 * Reports every gate that would fail: the `(signerKey, signerManager, authId)`
 * grant triple hasn't been used, and the signature recovers to `signerKey`.
 *
 * Not covered: the `contract-caller == signerManager` self-call gate
 * (`ERR_UNAUTHORIZED_SIGNER_REGISTRATION`), a tx-construction concern — this
 * call must be made by the signer-manager contract itself.
 *
 * The signature gate collapses the contract's `ERR_INVALID_SIGNATURE_RECOVER`
 * (malformed sig) and `ERR_INVALID_SIGNATURE_PUBKEY` (recovers to a different
 * key) into the latter.
 */
export async function fetchEligibleGrantSignerKey(
  opts: {
    /** Signer public key being granted (33-byte compressed). */
    signerKey: Uint8Array | string;
    /** Signer-manager being authorized. */
    signerManager: string;
    /** Replay nonce signed in the grant. */
    authId: bigint | number;
    /** SIP-018 signature over the grant message. */
    signerSignature: Uint8Array | string;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const networkClient = { network: opts.network, client: opts.client };
  const chainId = networkFrom(opts.network ?? 'mainnet').chainId;

  const used = await fetchSignerKeyGrantUsed({
    signerKey: opts.signerKey,
    signerManager: opts.signerManager,
    authId: opts.authId,
    ...networkClient,
  });

  const signatureValid = verifySignerGrant({
    signerManager: opts.signerManager,
    authId: opts.authId,
    chainId,
    publicKey: opts.signerKey,
    signature: opts.signerSignature,
  });

  const reasons: Pox5ErrorCode[] = [];

  if (used) reasons.push(Pox5ErrorCode.SignerKeyGrantUsed);
  if (!signatureValid) reasons.push(Pox5ErrorCode.InvalidSignaturePubkey);

  return reasons.length === 0
    ? { ok: true }
    : { ok: false, reasons: reasons as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

/**
 * Dry-run the checks of `revoke-signer-grant` without broadcasting anything.
 *
 * Only gate: `contract-caller` must be the Stacks principal derived from
 * `signerKey` (hash160 of the compressed pubkey, network-versioned). Pass the
 * intended sender as `caller`; revoking a missing grant is a no-op, not a revert.
 */
export async function fetchEligibleRevokeSignerGrant(
  opts: {
    /** Signer public key whose grant is being revoked (33-byte compressed). */
    signerKey: Uint8Array | string;
    /** Principal that would send the tx (the future `contract-caller`). */
    caller: string;
  } & NetworkClientParam
): Promise<EligibilityResult> {
  const expected = getAddressFromPublicKey(opts.signerKey, opts.network ?? 'mainnet');
  return opts.caller === expected
    ? { ok: true }
    : { ok: false, reasons: [Pox5ErrorCode.Unauthorized] };
}

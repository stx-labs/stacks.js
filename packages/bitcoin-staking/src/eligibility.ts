import { type IntegerType, bytesToHex } from '@stacks/common';
import type { NetworkClientParam } from '@stacks/network';
import { BOND_GAP_CYCLES } from './constants';
import {
  bondPeriodToBurnHeight,
  bondPeriodToRewardCycle,
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
  fetchBondOverlapsNewPosition,
  fetchPoxInfo,
  fetchProtocolBond,
  fetchSignerInfo,
  fetchStakerInfo,
  fetchVerifyBlockHeader,
  fetchVerifySignerKeyGrant,
} from './fetch';
import { computeBitcoinTxid, serializeBitcoinTx } from './proof';
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

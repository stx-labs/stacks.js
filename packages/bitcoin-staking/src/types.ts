import type { IntegerType } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import type { Pox5SignatureTopic } from './constants';

// ---------------------------------------------------------------------------
// Tx-level params (shared by all build*Tx functions)
// ---------------------------------------------------------------------------

export interface TxParams {
  publicKey: string;
  fee: IntegerType;
  nonce: IntegerType;
  network: StacksNetworkName | StacksNetwork;
}

// ---------------------------------------------------------------------------
// Data types (returned by fetch functions)
// ---------------------------------------------------------------------------

export interface PoxInfo {
  contractId: string;
  currentBurnchainBlockHeight: number;
  firstBurnchainBlockHeight: number;
  rewardCycleId: number;
  rewardCycleLength: number;
  prepareCycleLength: number;
  rewardSlots: number;
  currentCycle: CycleInfo;
  nextCycle: CycleInfo;
}

export interface CycleInfo {
  id: number;
  stakedUstx: bigint;
  isPoxActive: boolean;
}

export type StakerInfo =
  | { staked: false }
  | { staked: true; details: StakerDetailsSolo }
  | { staked: true; details: StakerDetailsPooled };

export interface StakerDetailsSolo {
  type: 'solo';
  numCycles: number;
  amountUstx: bigint;
  firstRewardCycle: number;
  /** The arbitrary unlock script (hex) — last section of the L1 locking script. */
  unlockBytesHex: string;
  /** The staker's BTC reward address. */
  poxAddress: string;
  /** The signer's 33-byte compressed public key (hex). */
  signerKey: string;
}

/**
 * Account-level balance/lock view returned by the `/v2/accounts/<addr>` node
 * endpoint. Mirrors the wallet-level balance + STX-lock state.
 */
export interface AccountStatus {
  balance: bigint;
  locked: bigint;
  nonce: bigint;
  unlockHeight: number;
}

/**
 * Active paired-BTC bond membership for a staker. Returned as `undefined` when
 * the staker has no current bond (the contract returns `none` when the bond's
 * unlock cycle has been reached).
 */
export interface BondMembership {
  bondIndex: number;
  amountSats: bigint;
  amountUstx: bigint;
  rewardPerSharePaid: bigint;
}

/**
 * Static configuration of a protocol bond, sourced from the on-chain
 * `protocol-bonds` map plus derived burn-height endpoints.
 *
 * Note: `capacitySats` is NOT a stored field on-chain. The contract emits the
 * sum of allowlist `max-sats` only as part of `setup-bond`'s response. Until a
 * dedicated read-only is added, this field is populated by summing the
 * `protocol-bond-allowances` map keyed on `bond-index`. If the SDK cannot
 * enumerate that map cheaply, `capacitySats` may be `undefined`.
 */
export interface Bond {
  bondIndex: number;
  /** Burn-block height at which the bond opens for enrollment. */
  openBurnHeight: number;
  /** Reward cycle in which the bond starts. */
  firstRewardCycle: number;
  /** Target APY in basis points. */
  targetRateBps: number;
  /** STX:BTC price representation: ustx per 100 sats. */
  stxValueRatio: bigint;
  /** Minimum amount of STX (in basis points) that must be paired per BTC. */
  minUstxRatioBps: number;
  /** Opaque buffer describing the early-unlock signer set (683 bytes). */
  earlyUnlockSigners: Uint8Array;
  /** Sum of allowlist `max-sats` (capacity). Optional; see note above. */
  capacitySats?: bigint;
}

export interface StakerDetailsPooled {
  type: 'pooled';
  numCycles: number;
  amountUstx: bigint;
  firstRewardCycle: number;
  /** The arbitrary unlock script (hex) — last section of the L1 locking script. */
  unlockBytesHex: string;
  /** Contract principal (address) of the pool owner. */
  poolOwner: string;
}

// ---------------------------------------------------------------------------
// Reward / distribution types
// ---------------------------------------------------------------------------

/**
 * One leg of `get-claimable-rewards`. Mirrors the post-patch contract tuple
 * `{ rewards-paid, rewards-pending, shares-staked, rewards-per-share }` plus an
 * extra `bondIndex` field on the bond legs for caller-side disambiguation
 * (the contract emits the same shape per bond inside `claim-rewards`).
 */
export interface RewardsLeg {
  rewardsPending: bigint;
  rewardsPaid: bigint;
  sharesStaked: bigint;
  rewardsPerShare: bigint;
}

export interface BondRewardsLeg extends RewardsLeg {
  bondIndex: number;
}

export interface ClaimableRewards {
  stxRewards: RewardsLeg;
  bondRewards: BondRewardsLeg[];
}

// ---------------------------------------------------------------------------
// Build function arg types — solo staking
// ---------------------------------------------------------------------------

export interface BuildStakeTxArgs {
  amountUstx: IntegerType;
  poxAddress: string;
  signerKey: string;
  signerSignature?: string;
  maxAmount: IntegerType;
  authId: IntegerType;
  numCycles: number;
  unlockBytes: Uint8Array | string;
  startBurnHt: number;
}

export interface BuildStakeExtendTxArgs {
  amountUstx: IntegerType;
  poxAddress: string;
  signerKey: string;
  signerSignature?: string;
  maxAmount: IntegerType;
  authId: IntegerType;
  numCycles: number;
  unlockBytes: Uint8Array | string;
}

export interface BuildStakeUpdateTxArgs {
  amountUstxIncrease: IntegerType;
  poxAddress: string;
  signerKey: string;
  signerSignature?: string;
  maxAmount: IntegerType;
  authId: IntegerType;
}

// ---------------------------------------------------------------------------
// Build function arg types — pool staking
// ---------------------------------------------------------------------------

export interface BuildStakePooledTxArgs {
  amountUstx: IntegerType;
  numCycles: number;
  unlockBytes: Uint8Array | string;
  startBurnHt: number;
  poolOwner: string;
}

export interface BuildStakeExtendPooledTxArgs {
  poolOwner: string;
  amountUstx: IntegerType;
  numCycles: number;
  unlockBytes: Uint8Array | string;
}

export interface BuildStakeUpdatePooledTxArgs {
  poolOwner: string;
  amountUstxIncrease: IntegerType;
}

// ---------------------------------------------------------------------------
// Build function arg types — signer grants & pool registration
// ---------------------------------------------------------------------------

export interface BuildGrantSignerKeyTxArgs {
  /** 33-byte compressed signer pubkey (hex). */
  signerKey: string;
  /** Contract principal of the signer-manager being granted permission. */
  signerManager: string;
  /** Per-grant nonce. */
  authId: IntegerType;
  /** 65-byte recoverable SIP-018 signature. */
  signerSignature: string;
}

export interface BuildRevokeSignerKeyTxArgs {
  signerKey: string;
  signerManager: string;
}

export interface BuildRegisterPoolTxArgs {
  poolOwnerContract: string;
  signerKey: string;
  poxAddress: string;
  signerSignature: string;
  authId: IntegerType;
}

// ---------------------------------------------------------------------------
// Build function arg types — contract-caller authorization
// ---------------------------------------------------------------------------

export interface BuildAllowContractCallerArgs {
  /** Principal (standard or contract) authorized to call PoX-5 methods on the
   * sender's behalf. */
  contractCaller: string;
  /** Optional burn-block height at which the authorization expires. Omit for
   * no expiry. */
  untilBurnHeight?: number;
}

export interface BuildDisallowContractCallerArgs {
  /** Principal whose authorization should be revoked. */
  contractCaller: string;
}

// ---------------------------------------------------------------------------
// Early-exit types (flow 13)
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a paired-BTC early-exit request.
 *
 * unsure: the L2 contract function `request-early-exit` is missing from the
 * 2026-05-04 `pox-5.clar` snapshot, so the on-chain status shape is
 * speculative. The values here mirror the four-state machine described in
 * `flows/3-paired-btc/13.md` (requested → co-signed → broadcast → confirmed)
 * plus a `none` sentinel for positions that have not requested exit.
 */
export type EarlyExitStatus =
  | { state: 'none' }
  | { state: 'requested'; requestedAtBurnHeight: number }
  | { state: 'co-signed'; requestedAtBurnHeight: number }
  | { state: 'broadcast'; requestedAtBurnHeight: number; spendTxid?: string }
  | { state: 'confirmed'; requestedAtBurnHeight: number; spendTxid?: string };

// ---------------------------------------------------------------------------
// Watchdog / L1 spent-report types (flow 14)
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a tracked L1 lockup as seen by the watchdog.
 *
 * unsure: contract surface for flow 14 is missing from the 2026-05-04
 * `pox-5.clar` snapshot (`notes/status.md` tier-2 item 15, Launch Scope D21,
 * design open-question 1). Sketched here per `flows/3-paired-btc/14.md`:
 *   - `locked` — UTXO observed, CLTV not yet reached.
 *   - `spent-reported` — a watchdog has posted a valid spend proof; T1
 *     eligibility removed at next payout, first valid reporter compensated.
 *   - `expired` — CLTV passed; natural unlock window.
 */
export type LockStatus =
  | { state: 'locked' }
  | {
      state: 'spent-reported';
      reporter?: string;
      reportedAtBurnHeight?: number;
      spendTxid?: string;
    }
  | { state: 'expired' };

// ---------------------------------------------------------------------------
// Andon cord / payout pause types (flow 15)
// ---------------------------------------------------------------------------

/**
 * The current state of the next-pending reward distribution, surfaced for
 * ops dashboards (3-of-5 multisig holders) and end users wanting a
 * "queued / confirmed / paused" indicator.
 *
 * Per `notes/pox-5-design.md` "Andon Cord (payout pause)" and
 * `flows/6-rewards/15.md`:
 * - Payout for distribution cycle X requires automation to call
 *   `calculate-rewards` once `current-distribution-cycle ≥ X + 1`. The
 *   White Paper §4.4 / Launch Scope D19 mandate a **250-block delay
 *   window** between when the dist cycle ticks over and when
 *   `calculate-rewards` may settle — giving ops time to halt if the
 *   coverage ratio looks wrong. That delay is NOT enforced by the
 *   2026-05-04 `pox-5.clar` snapshot today (only `last-reward-compute-height
 *   < calculation-height` is checked); see `unsure/flow-15.md`.
 *
 * unsure: `paused` cannot be answered from the current contract; there
 * is no pause flag, no pause function, and no read-only that surfaces
 * either. Callers should treat `paused` as a placeholder until the
 * contract function lands.
 */
export interface PayoutWindow {
  /** The distribution cycle whose payout is next to be settled. */
  distCycle: number;
  /** Burn-height at which the dist cycle's calculation-height was reached. */
  scheduledHeight: number;
  /** Burn-blocks remaining in the 250-block pause window (`0` once closed). */
  blocksRemaining: number;
  /** True while `blocksRemaining > 0` AND the payout has not yet fired. */
  canPause: boolean;
  /** Whether the payout was paused by a 3-of-5 multisig call. See unsure. */
  paused: boolean;
}

/**
 * Bitcoin SPV-style proof that an L1 lockup UTXO has been spent.
 *
 * unsure: the proof shape is open per `notes/status.md` open-question 1
 * and Launch Scope §7. Plausible shapes include:
 *   - Raw spending tx + merkle branch + block header chain (full SPV).
 *   - Node-side P2WSH match (contract calls a future built-in akin to
 *     `validate-p2wsh-exists?` at line 1636 of `pox-5.clar`).
 *   - Compact `(txid, vout)` reference + signed attestation from the
 *     node's burn-chain indexer.
 * Fields below mirror the sketch in `flows/3-paired-btc/14.md`.
 */
export interface SpendProof {
  /** Txid of the Bitcoin transaction spending the tracked lockup output. */
  spendTxid: Uint8Array | string;
  /** Burn-block height containing `spendTxid`. */
  blockHeight: number;
  /** Merkle branch proving inclusion of `spendTxid` in the block. */
  merkleBranch: (Uint8Array | string)[];
  // missing: likely also need `blockHeader`, the spending input index, and
  // the raw spending tx bytes for full SPV validation. Punted until the
  // contract's verification path is finalized.
}

// ---------------------------------------------------------------------------
// Signer types
// ---------------------------------------------------------------------------

export interface Pox5SignatureOptions {
  topic: Pox5SignatureTopic;
  poxAddress: string;
  rewardCycle: number;
  period: number;
  maxAmount: IntegerType;
  authId: IntegerType;
  network: StacksNetworkName | StacksNetwork;
}

export interface SignerKeyGrantOptions {
  /** Contract principal of the signer-manager being authorized. */
  signerManager: string;
  /** Per-grant nonce; replay-gated by `(signerKey, signerManager, authId)`. */
  authId: IntegerType;
  network: StacksNetworkName | StacksNetwork;
}

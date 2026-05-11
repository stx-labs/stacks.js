import type { IntegerType } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';

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

/**
 * Lock summary returned by `pox-5.get-staker-info`.
 *
 * The contract's `staker-info` map only records the lock dimensions
 * (`amount-ustx`, `first-reward-cycle`, `num-cycles`); it does NOT carry
 * pool/solo discrimination, signer key, BTC reward address, or unlock-script.
 * Those live in separate maps (e.g. `staker-signer-cycle-memberships`) and
 * are surfaced by their own fetch helpers.
 */
export type StakerInfo = { staked: false } | { staked: true; details: StakerLock };

export interface StakerLock {
  amountUstx: bigint;
  firstRewardCycle: number;
  numCycles: number;
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
 * `protocol-bonds` map.
 *
 * `openBurnHeight` / `firstRewardCycle` are NOT included — they are
 * deterministic functions of the bond index and pox params. Compose with
 * `bondPeriodToBurnHeight` / `bondPeriodToRewardCycle` from `cycles.ts`.
 *
 * Note: `capacitySats` is NOT a stored field on-chain. The contract emits the
 * sum of allowlist `max-sats` only as part of `setup-bond`'s response. Until a
 * dedicated read-only is added, this field is populated by summing the
 * `protocol-bond-allowances` map keyed on `bond-index`. If the SDK cannot
 * enumerate that map cheaply, `capacitySats` may be `undefined`.
 */
export interface Bond {
  bondIndex: number;
  /** Target APY in basis points. */
  targetRateBps: number;
  /** STX:BTC price representation: ustx per 100 sats. */
  stxValueRatio: bigint;
  /** Minimum amount of STX (in basis points) that must be paired per BTC. */
  minUstxRatioBps: number;
  /** Hex describing the early-unlock signer set (683 bytes). */
  earlyUnlockSigners: string;
  /** Sum of allowlist `max-sats` (capacity). Optional; see note above. */
  capacitySats?: bigint;
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
// Build function arg types — signer grants
// ---------------------------------------------------------------------------

export interface BuildGrantSignerKeyTxArgs {
  /** 33-byte compressed signer pubkey (hex). */
  signerKey: string;
  /** Contract address of the signer-manager being granted permission. */
  signerManager: string;
  /** Per-grant nonce. */
  authId: IntegerType;
  /** 65-byte recoverable SIP-018 signature. */
  signerSignature: string;
}

export interface BuildRevokeSignerKeyTxArgs {
  /** 33-byte compressed signer pubkey (hex). */
  signerKey: string;
  /** Contract address of the signer-manager being revoked permission. */
  signerManager: string;
}

// ---------------------------------------------------------------------------
// Build function arg types — contract-caller authorization
// ---------------------------------------------------------------------------

export interface BuildAllowContractCallerArgs {
  /** Address (standard or contract) authorized to call PoX-5 methods on the
   * sender's behalf. */
  contractCaller: string;
  /** Optional burn-block height at which the authorization expires. Omit for
   * no expiry. */
  untilBurnHeight?: number;
}

export interface BuildDisallowContractCallerArgs {
  /** Address whose authorization should be revoked. */
  contractCaller: string;
}

// todo: flow 13 (paired-BTC early exit) — `EarlyExitStatus`.
// todo: flow 14 (watchdog) — `LockStatus`.

// ---------------------------------------------------------------------------
// Andon cord / payout pause types
// ---------------------------------------------------------------------------

/**
 * The current state of the next-pending reward distribution, surfaced for
 * ops dashboards (3-of-5 multisig holders) and end users wanting a
 * "queued / confirmed / paused" indicator.
 *
 * Payout for distribution cycle X requires automation to call
 * `calculate-rewards` once `current-distribution-cycle ≥ X + 1`. A
 * 250-block delay window between dist-cycle tick-over and `calculate-rewards`
 * gives ops time to halt if the coverage ratio looks wrong.
 *
 * missing: todo: the 250-block delay is not enforced by `pox-5.clar` yet
 * (only `last-reward-compute-height < calculation-height` is checked).
 *
 * unsure: todo: `paused` cannot be answered from the current contract — no
 * pause flag, no pause function, no read-only. Treat as a placeholder.
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
 * unsure: todo: the proof shape is open. Plausible shapes include:
 *   - Raw spending tx + merkle branch + block header chain (full SPV).
 *   - Node-side P2WSH match (contract calls a future built-in akin to
 *     `validate-p2wsh-exists?`).
 *   - Compact `(txid, vout)` reference + signed attestation from the
 *     node's burn-chain indexer.
 * Fields below mirror the design sketch.
 */
export interface SpendProof {
  /** Txid of the Bitcoin transaction spending the tracked lockup output. */
  spendTxid: Uint8Array | string;
  /** Burn-block height containing `spendTxid`. */
  blockHeight: number;
  /** Merkle branch proving inclusion of `spendTxid` in the block. */
  merkleBranch: (Uint8Array | string)[];
  // missing: todo: likely also need `blockHeader`, the spending input index,
  // and the raw spending tx bytes for full SPV validation. Punted until the
  // contract's verification path is finalized.
}

// ---------------------------------------------------------------------------
// Signer types
// ---------------------------------------------------------------------------

export interface SignerKeyGrantOptions {
  /** Contract address of the signer-manager being authorized. */
  signerManager: string;
  /** Per-grant nonce; replay-gated by `(signerKey, signerManager, authId)`. */
  authId: IntegerType;
  network: StacksNetworkName | StacksNetwork;
}

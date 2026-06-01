import type { IntegerType } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import type { PostCondition, PostConditionModeName } from '@stacks/transactions';

// ---------------------------------------------------------------------------
// Tx-level params (shared by all build*Tx functions)
// ---------------------------------------------------------------------------

export interface TxParams {
  publicKey: string;
  fee: IntegerType;
  nonce: IntegerType;
  network: StacksNetworkName | StacksNetwork;
  /**
   * Post-conditions to attach. Required for calls that move assets *from the
   * caller* under the default deny mode — notably `register-for-bond` with an
   * sBTC lockup, whose `lock-sbtc` transfers sBTC from the caller (an
   * uncovered transfer otherwise aborts with `abort_by_post_condition`).
   */
  postConditions?: PostCondition[];
  /** Post-condition mode. Defaults to the wire default (`deny`). */
  postConditionMode?: PostConditionModeName;
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
  /**
   * One entry per deployed pox contract version (pox-1, pox-2, …, pox-5).
   * Sourced from the node's `/v2/pox` `contract_versions[]` field. A row only
   * appears once that version has been activated on-chain.
   */
  contractVersions: PoxContractVersion[];
}

export interface CycleInfo {
  id: number;
  stakedUstx: bigint;
  isPoxActive: boolean;
}

/**
 * One entry of `/v2/pox`'s `contract_versions[]`. Mirrors the node JSON
 * `{ contract_id, activation_burnchain_block_height, first_reward_cycle_id }`
 * shape, camelCased.
 */
export interface PoxContractVersion {
  /** Fully-qualified contract id (e.g. `SP000…0002.pox-5`). */
  contractId: string;
  /** Burn-block height at which this contract version became active. */
  activationBurnchainBlockHeight: number;
  /** First reward cycle in which this contract version is active. */
  firstRewardCycleId: number;
}

/**
 * Lock summary returned by `pox-5.get-staker-info`.
 *
 * Mirrors the `staker-info` map value
 * `{ amount-ustx, first-reward-cycle, num-cycles, signer }`. This is the
 * STX-only stake record — paired-BTC bond memberships live in
 * `protocol-bond-memberships` and are surfaced by {@link BondMembership}.
 */
export type StakerInfo = { staked: false } | { staked: true; details: StakerLock };

export interface StakerLock {
  amountUstx: bigint;
  firstRewardCycle: number;
  numCycles: number;
  /** Stacks principal of the signer the staker is delegated to. */
  signer: string;
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
 *
 * Mirrors the `protocol-bond-memberships` map value
 * `{ bond-index, amount-ustx, signer, is-l1-lock }`.
 */
export interface BondMembership {
  bondIndex: number;
  amountUstx: bigint;
  /** Stacks principal of the signer this membership is bound to. */
  signer: string;
  /** True if the BTC side is an L1 lockup; false if backed by sBTC. */
  isL1Lock: boolean;
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
  /** Stacks principal authorized to trigger early-unlock for this bond. */
  earlyUnlockAdmin: string;
  /** Sum of allowlist `max-sats` (capacity). Optional; see note above. */
  capacitySats?: bigint;
}

// ---------------------------------------------------------------------------
// Reward / distribution types
// ---------------------------------------------------------------------------

/**
 * Earned-rewards amount in micro-STX. Mirrors `pox-5.get-earned -> uint`.
 */
export type EarnedRewards = bigint;

/**
 * One entry of the list returned inside `claim-rewards`'s response. Mirrors
 * the tuple `{ earned, bond-index, rewards-per-token }`.
 */
export interface BondRewardsLeg {
  earned: bigint;
  bondIndex: number;
  rewardsPerToken: bigint;
}

export interface ClaimableRewards {
  stxRewards: EarnedRewards;
  bondRewards: BondRewardsLeg[];
}

// ---------------------------------------------------------------------------
// Build function arg types — bond admin
// ---------------------------------------------------------------------------

export interface BuildSetBondAdminArgs {
  /** Principal to install as the new `bond-admin`. */
  newAdmin: string;
}

// ---------------------------------------------------------------------------
// Signer-key grant (SIP-018) types
// ---------------------------------------------------------------------------

/**
 * Inputs to the SIP-018 signer-key grant message hash. Mirrors the args of
 * pox-5's `get-signer-grant-message-hash` plus the `chain-id` carried in
 * the `POX_5_SIGNER_DOMAIN`.
 */
export interface SignerKeyGrantOptions {
  /** Stacks principal of the signer-manager contract being authorized. */
  signerManager: string;
  /** Replay nonce — must be unique per grant. */
  authId: bigint | number;
  /** Stacks chain id (e.g. `1` for mainnet, `0x80000000` for testnet). */
  chainId: number;
}

/** Arguments for {@link buildGrantSignerKey} — wraps pox-5 `grant-signer-key`. */
export interface BuildGrantSignerKeyTxArgs extends TxParams {
  /** Compressed secp256k1 public key (33 bytes) of the signer. */
  signerKey: Uint8Array | string;
  /** Stacks principal of the signer-manager being authorized. */
  signerManager: string;
  /** Replay nonce — must match the value signed in the SIP-018 grant. */
  authId: bigint | number;
  /** Recoverable secp256k1 signature in RSV order (65 bytes). */
  signerSignature: Uint8Array | string;
}

/** Arguments for {@link buildRevokeSignerGrant} — wraps pox-5 `revoke-signer-grant`. */
export interface BuildRevokeSignerKeyTxArgs extends TxParams {
  /** Compressed secp256k1 public key (33 bytes) of the signer. */
  signerKey: Uint8Array | string;
  /** Stacks principal of the signer-manager whose grant is being revoked. */
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

// todo: flow 15 (andon cord) — `PayoutWindow`.

// ---------------------------------------------------------------------------
// BTC L1 lockup proof types
// ---------------------------------------------------------------------------
//
// NOTE: BTC SPV proof types used by `register-for-bond` live here, but the
// helpers that *construct* them (parsing tx bytes, computing merkle paths,
// etc.) live in `locking.ts`.

/**
 * Per-output proof tuple required by `register-for-bond` when committing an
 * L1 BTC lockup. Mirrors the contract's expected tuple shape.
 *
 * NOTE: a full merkle-proof builder is not provided by this SDK — the surface
 * area (block parsing, varint handling, witness stripping, merkle-tree
 * construction with Bitcoin's odd-row duplication quirk) is large enough that
 * callers should source proofs from a dedicated indexer / proof service. The
 * fields below document the expected shapes precisely so callers can supply
 * the values directly.
 */
export interface BondL1LockupOutput {
  /** BTC block height containing the tx. */
  height: number;
  /**
   * Raw BTC tx bytes (buff 100000). MUST be the legacy / non-segwit
   * serialization — i.e. the bytes that hash (double-sha256) to the txid —
   * not the witness-extended `wtxid` serialization. Pre-segwit clients and
   * the `tx` field of the Bitcoin RPC `getrawtransaction` (with verbose=0)
   * both produce the correct form.
   */
  tx: Uint8Array | string;
  /** Index of the relevant output within the tx. */
  outputIndex: number;
  /** 80-byte BTC block header (buff 80). */
  header: Uint8Array | string;
  /**
   * Sibling hashes along the merkle path from leaf to root, ordered
   * bottom-up (closest sibling first). Each hash is the raw 32-byte
   * little-endian (internal) form — NOT the reversed display form.
   *
   * Up to 14 entries (the contract's `(list 14 (buff 32))` cap, which
   * accommodates blocks of up to 2^14 = 16,384 transactions).
   *
   * The verifier folds the path by repeatedly hashing
   * `double-sha256(left || right)`, choosing left/right at each level based
   * on the bit of `txIndex` at that level (LSB first). A correctly
   * constructed path reproduces the block's merkle root from the leaf txid.
   */
  leafHashes: (Uint8Array | string)[];
  /** Total transaction count in the block. */
  txCount: number;
  /** Position of the tx in the block (0-indexed). */
  txIndex: number;
  /** Sats — must match the parsed output amount. */
  amount: bigint;
}

/**
 * Discriminated union describing the BTC-side commitment associated with a
 * bond membership. Either a list of L1 lockup outputs accompanied by an
 * unlock-script, or an sBTC sats amount.
 */
export type BondLockup =
  | { kind: 'btc'; outputs: BondL1LockupOutput[]; unlockBytes: Uint8Array | string }
  | { kind: 'sbtc'; sbtcSats: bigint };

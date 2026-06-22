import type { IntegerType } from '@stacks/common';
import type { StacksNetwork, StacksNetworkName } from '@stacks/network';
import type { BtcAddressRepr } from './btc-address';
import type {
  PostCondition,
  PostConditionModeName,
  UnsignedMultiSigOptions,
} from '@stacks/transactions';

/** Tx-level params common to single-sig and multisig builders. */
export interface TxParamsBase {
  fee: IntegerType;
  nonce: IntegerType;
  network: StacksNetworkName | StacksNetwork;
  /**
   * Post-conditions to attach. Required for calls that move assets from the
   * caller under deny mode — e.g. `register-for-bond` with an sBTC lockup.
   */
  postConditions?: PostCondition[];
  /** Post-condition mode. Defaults to the wire default (`deny`). */
  postConditionMode?: PostConditionModeName;
}

/** Single-sig caller: the origin's public key. */
export interface SingleSigTxParams extends TxParamsBase {
  /** Compressed/uncompressed secp256k1 public key of the (single) caller. */
  publicKey: string;
}

/**
 * Multisig (M-of-N) caller: the full `publicKeys` set + required
 * `numSignatures` ({@link UnsignedMultiSigOptions} — `address?` pins public-key
 * ordering, `useNonSequentialMultiSig?` opts into the newer hashmode).
 * Use this to build unsigned txs whose origin is a multisig
 * principal — e.g. a `bond-admin` held by a 2-of-3 multisig. The returned tx is
 * unsigned; sign it with `numSignatures` keys (plus `appendOrigin` for the rest).
 */
export type MultiSigTxParams = TxParamsBase & UnsignedMultiSigOptions;

/**
 * Tx-level params for every `build*` helper — either {@link SingleSigTxParams}
 * (`publicKey`) or {@link MultiSigTxParams} (`publicKeys` + `numSignatures`).
 * Builders discriminate on which is present (`'publicKey' in params`), exactly
 * like `makeUnsignedContractCall`.
 */
export type TxParams = SingleSigTxParams | MultiSigTxParams;

/**
 * PoX network parameters.
 *
 * Mirrors the node's `/v2/pox` response.
 */
export interface PoxInfo {
  /** Fully-qualified pox contract id. */
  contractId: string;
  /** Current burnchain block height. */
  currentBurnchainBlockHeight: number;
  /** Burnchain height at which PoX began. */
  firstBurnchainBlockHeight: number;
  /** Reward cycle currently in progress. */
  rewardCycleId: number;
  /** Reward cycle length in burnchain blocks. */
  rewardCycleLength: number;
  /** Prepare phase length in burnchain blocks. */
  prepareCycleLength: number;
  /** Reward slots per cycle. */
  rewardSlots: number;
  /** Current reward cycle summary. */
  currentCycle: CycleInfo;
  /** Next reward cycle summary. */
  nextCycle: CycleInfo;
  /** One entry per deployed pox contract version (pox-1, …, pox-5). */
  contractVersions: PoxContractVersion[];
}

/**
 * Per-cycle stake summary.
 *
 * Mirrors a cycle entry of the node's `/v2/pox` response.
 */
export interface CycleInfo {
  /** Reward cycle id. */
  id: number;
  /** Total micro-STX stacked for the cycle. */
  stakedUstx: bigint;
  /** Whether PoX is active for the cycle. */
  isPoxActive: boolean;
}

/**
 * Activation record for one deployed pox contract version.
 *
 * Mirrors an entry of the node's `/v2/pox` `contract_versions[]`.
 */
export interface PoxContractVersion {
  /** Fully-qualified contract id. */
  contractId: string;
  /** Burn-block height at which this contract version became active. */
  activationBurnchainBlockHeight: number;
  /** First reward cycle in which this contract version is active. */
  firstRewardCycleId: number;
}

/**
 * STX-only stake record. Paired-BTC bond memberships are separate — see
 * {@link BondMembership}.
 *
 * Mirrors the `staker-info` map value
 * `{ amount-ustx, first-reward-cycle, num-cycles, signer }`.
 */
export type StakerInfo = { staked: false } | { staked: true; details: StakerInfoDetails };

/** STX-only lock details from `pox-5.get-staker-info`. */
export interface StakerInfoDetails {
  /** Locked micro-STX. */
  amountUstx: bigint;
  /** First reward cycle the lock applies to. */
  firstRewardCycle: number;
  /** Number of cycles locked. */
  numCycles: number;
  /** Stacks principal of the signer the staker is delegated to. */
  signer: string;
}

/**
 * Account-level balance and STX-lock view.
 *
 * Mirrors the node's `/v2/accounts/<addr>` response.
 */
export interface AccountStatus {
  /** Liquid micro-STX balance. */
  balance: bigint;
  /** Locked (stacked) micro-STX. */
  locked: bigint;
  /** Account nonce. */
  nonce: bigint;
  /** Burn height at which the locked STX unlocks. */
  unlockHeight: number;
}

/**
 * Active paired-BTC bond membership for a staker.
 *
 * Mirrors the `protocol-bond-memberships` map value
 * `{ bond-index, amount-ustx, signer, is-l1-lock, amount-sats }`.
 */
export interface BondMembership {
  bondIndex: number;
  amountUstx: bigint;
  /** Stacks principal of the signer this membership is bound to. */
  signer: string;
  /** True if the BTC side is an L1 lockup; false if backed by sBTC. */
  isL1Lock: boolean;
  /** BTC shares (sats) currently attributed to this membership. */
  amountSats: bigint;
}

/**
 * Static configuration of a protocol bond.
 *
 * `openBurnHeight` / `firstRewardCycle` are NOT included — they are
 * deterministic functions of the bond index and pox params. Compose with
 * {@link bondPeriodToBurnHeight} / {@link bondPeriodToRewardCycle}.
 *
 * Mirrors the `protocol-bonds` map value.
 */
export interface Bond {
  bondIndex: number;
  /** Target APY in basis points. */
  targetRateBps: number;
  /** STX:BTC price representation: ustx per 100 sats. */
  stxValueRatio: bigint;
  /** Minimum amount of STX (in basis points) that must be paired per BTC. */
  minUstxRatioBps: number;
  /**
   * Hex-encoded early-exit subscript that guards the OP_ELSE branch of the L1
   * lockup witness script (buff 683) — e.g. `<pubkey> OP_CHECKSIG`. Its result
   * is consumed by the script's shared OP_VERIFY.
   */
  earlyUnlockBytes: string;
}

/**
 * Earned-rewards amount in micro-STX. Mirrors `pox-5.get-earned -> uint`.
 */
export type EarnedRewards = bigint;

/**
 * Per-bond reward leg of a staker's claimable rewards.
 *
 * Mirrors a `claim-rewards` response tuple
 * `{ earned, bond-index, rewards-per-token }`.
 */
export interface BondRewardsLeg {
  /** Earned micro-STX for this bond. */
  earned: bigint;
  /** Bond index the leg refers to. */
  bondIndex: number;
  /** Reward-per-token accumulator at claim time. */
  rewardsPerToken: bigint;
}

export interface BuildSetBondAdminArgs {
  /** Principal to install as the new `bond-admin`. */
  newAdmin: string;
}

export interface BuildSetPauseAdminArgs {
  /** Principal to install as the new `pause-admin`. */
  newAdmin: string;
}

/**
 * Inputs to the SIP-018 signer-key grant message hash.
 *
 * Mirrors the args of `pox-5.get-signer-grant-message-hash` plus the
 * `chain-id` carried in the `POX_5_SIGNER_DOMAIN`.
 */
export interface SignerKeyGrantOptions {
  /** Stacks principal of the signer-manager contract being authorized. */
  signerManager: string;
  /** Replay nonce — must be unique per grant. */
  authId: bigint | number;
  /** Stacks chain id (e.g. `1` for mainnet, `0x80000000` for testnet). */
  chainId: number;
}

/**
 * L1 BTC payout election carried in a `signerCalldata` blob. Encode it with
 * {@link buildSignerCalldata}; omitting `signerCalldata` keeps the sBTC default.
 */
export interface SignerCalldataL1Payout {
  /** Destination Bitcoin reward address — a parsed {@link BtcAddressRepr} or an
   * address string (P2PKH/P2SH/P2WPKH/P2WSH/P2TR). */
  poxAddress: string | BtcAddressRepr;
  /** Max sBTC fee (sats) the staker tolerates on the L1 BTC withdrawal. */
  maxFeeSats: IntegerType;
}

/** Arguments for {@link buildGrantSignerKey} — wraps pox-5 `grant-signer-key`. */
export type BuildGrantSignerKeyTxArgs = TxParams & {
  /** Compressed secp256k1 public key (33 bytes) of the signer. */
  signerKey: Uint8Array | string;
  /** Stacks principal of the signer-manager being authorized. */
  signerManager: string;
  /** Replay nonce — must match the value signed in the SIP-018 grant. */
  authId: bigint | number;
  /** Recoverable secp256k1 signature in RSV order (65 bytes). */
  signerSignature: Uint8Array | string;
};

/** Arguments for {@link buildRevokeSignerGrant} — wraps pox-5 `revoke-signer-grant`. */
export type BuildRevokeSignerKeyTxArgs = TxParams & {
  /** Compressed secp256k1 public key (33 bytes) of the signer. */
  signerKey: Uint8Array | string;
  /** Stacks principal of the signer-manager whose grant is being revoked. */
  signerManager: string;
};

// todo: flow 15 (andon cord) — `PayoutWindow`.

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
  /**
   * BTC absolute CLTV height the output's lockup script commits to — the
   * `unlockHeight` passed to {@link buildLockOutputScript}. The contract
   * re-derives the expected P2WSH script from this height and rejects the
   * output unless it is at or above the bond's minimum unlock height
   * (`ERR_INVALID_UNLOCK_HEIGHT`).
   */
  unlockBurnHeight: number;
}

/**
 * Discriminated union describing the BTC-side commitment associated with a
 * bond membership. Either a list of L1 lockup outputs accompanied by an
 * unlock-script, or an sBTC sats amount.
 */
export type BondLockup =
  | { kind: 'btc'; outputs: BondL1LockupOutput[]; unlockBytes: Uint8Array | string }
  | { kind: 'sbtc'; sbtcSats: bigint };

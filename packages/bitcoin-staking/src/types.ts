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
  numCycles: number;
  unlockBytes: Uint8Array | string;
  poxAddress: string;
  signerKey: string;
  signerSignature?: string;
  maxAmount: IntegerType;
  authId: IntegerType;
  amountUstx?: IntegerType;
}

export interface BuildStakeUpdateTxArgs {
  poxAddress: string;
  signerKey: string;
  signerSignature?: string;
  maxAmount: IntegerType;
  authId: IntegerType;
  increaseBy?: IntegerType;
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
  numCycles: number;
  unlockBytes: Uint8Array | string;
  poolOwner: string;
  amountUstx?: IntegerType;
}

export interface BuildStakeUpdatePooledTxArgs {
  poolOwner: string;
  increaseBy?: IntegerType;
}

// ---------------------------------------------------------------------------
// Build function arg types — signer grants & pool registration
// ---------------------------------------------------------------------------

export interface BuildGrantSignerKeyTxArgs {
  signerKey: string;
  staker: string;
  authId: IntegerType;
  poxAddress?: string;
  signerSignature: string;
}

export interface BuildRevokeSignerKeyTxArgs {
  signerKey: string;
  staker: string;
}

export interface BuildRegisterPoolTxArgs {
  poolOwnerContract: string;
  signerKey: string;
  poxAddress: string;
  signerSignature: string;
  authId: IntegerType;
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
  staker: string;
  authId: IntegerType;
  poxAddress?: string;
  network: StacksNetworkName | StacksNetwork;
}

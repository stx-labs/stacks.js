import { IntegerType } from '@stacks/common';
import { ClarityValue, PrincipalCV } from '../clarity';
import {
  AddressVersion,
  ClarityVersion,
  FungibleConditionCode,
  NonFungibleConditionCode,
  PayloadType,
  PostConditionPrincipalId,
  PostConditionType,
  PoxConditionCode,
  PubKeyEncoding,
  TenureChangeCause,
} from '../constants';

// todo: add explicit enum values
/**
 * The type of message that is being serialized.
 * Used internally for serializing and deserializing messages.
 */
export enum StacksWireType {
  Address,
  Principal,
  LengthPrefixedString,
  MemoString,
  Asset,
  PostCondition,
  PublicKey,
  LengthPrefixedList,
  Payload,
  MessageSignature,
  StructuredDataSignature,
  TransactionAuthField,
}

type WhenWireTypeMap<T> = Record<StacksWireType, T>;

export function whenWireType(wireType: StacksWireType) {
  return <T>(wireTypeMap: WhenWireTypeMap<T>): T => wireTypeMap[wireType];
}

export type StacksWire =
  | AddressWire
  | PostConditionPrincipalWire
  | LengthPrefixedStringWire
  | LengthPrefixedList
  | PayloadWire
  | MemoStringWire
  | AssetWire
  | PostConditionWire
  | PublicKeyWire
  | TransactionAuthFieldWire
  | MessageSignatureWire;

export interface MemoStringWire {
  readonly type: StacksWireType.MemoString;
  readonly content: string;
}

export interface PublicKeyWire {
  readonly type: StacksWireType.PublicKey;
  readonly data: Uint8Array;
}

export interface LengthPrefixedList<TWire extends StacksWire = StacksWire> {
  readonly type: StacksWireType.LengthPrefixedList;
  readonly lengthPrefixBytes: number;
  readonly values: TWire[];
}

export interface AddressWire {
  readonly type: StacksWireType.Address;
  readonly version: AddressVersion;
  readonly hash160: string; // todo: next rename to `hash` or `bytes` or `data`
}

export interface MessageSignatureWire {
  readonly type: StacksWireType.MessageSignature;
  data: string;
}

export type PayloadWire =
  | TokenTransferPayloadWire
  | ContractCallPayload
  | SmartContractPayloadWire
  | VersionedSmartContractPayloadWire
  | PoisonPayloadWire
  | CoinbasePayloadWire
  | CoinbasePayloadToAltRecipient
  | NakamotoCoinbasePayloadWire
  | TenureChangePayloadWire;

export interface TokenTransferPayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.TokenTransfer;
  readonly recipient: PrincipalCV;
  readonly amount: bigint;
  readonly memo: MemoStringWire;
}

export type PayloadInput =
  | (
      | TokenTransferPayloadWire
      | (Omit<TokenTransferPayloadWire, 'amount'> & { amount: IntegerType })
    )
  | ContractCallPayload
  | SmartContractPayloadWire
  | VersionedSmartContractPayloadWire
  | PoisonPayloadWire
  | CoinbasePayloadWire
  | CoinbasePayloadToAltRecipient
  | NakamotoCoinbasePayloadWire
  | TenureChangePayloadWire;

export interface ContractCallPayload {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.ContractCall;
  readonly contractAddress: AddressWire;
  readonly contractName: LengthPrefixedStringWire;
  readonly functionName: LengthPrefixedStringWire;
  readonly functionArgs: ClarityValue[];
}

export interface SmartContractPayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.SmartContract;
  readonly contractName: LengthPrefixedStringWire;
  readonly codeBody: LengthPrefixedStringWire;
}

export interface VersionedSmartContractPayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.VersionedSmartContract;
  readonly clarityVersion: ClarityVersion;
  readonly contractName: LengthPrefixedStringWire;
  readonly codeBody: LengthPrefixedStringWire;
}

export interface PoisonPayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.PoisonMicroblock;
}

export interface CoinbasePayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.Coinbase;
  readonly coinbaseBytes: Uint8Array;
}

export interface CoinbasePayloadToAltRecipient {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.CoinbaseToAltRecipient;
  readonly coinbaseBytes: Uint8Array;
  readonly recipient: PrincipalCV;
}

export interface NakamotoCoinbasePayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.NakamotoCoinbase;
  readonly coinbaseBytes: Uint8Array;
  readonly recipient?: PrincipalCV;
  readonly vrfProof: Uint8Array;
}

export interface TenureChangePayloadWire {
  readonly type: StacksWireType.Payload;
  readonly payloadType: PayloadType.TenureChange;
  /**
   * The consensus hash of this tenure (hex string). Corresponds to the
   * sortition in which the miner of this block was chosen. It may be the case
   * that this miner's tenure gets _extended_ acrosssubsequent sortitions; if
   * this happens, then this `consensus_hash` value _remains the same _as the
   * sortition in which the winning block-commit was mined.
   */
  readonly tenureHash: string;
  /**
   * The consensus hash (hex string) of the previous tenure.  Corresponds to the
   * sortition of the previous winning block-commit.
   */
  readonly previousTenureHash: string;
  /**
   * Current consensus hash (hex string) on the underlying burnchain.
   * Corresponds to the last-seen sortition.
   */
  readonly burnViewHash: string;
  /** Stacks block hash (hex string) */
  readonly previousTenureEnd: string;
  /** The number of blocks produced since the last sortition-linked tenure */
  readonly previousTenureBlocks: number;
  /** The cause of change in mining tenure */
  readonly cause: TenureChangeCause;
  /** The public key hash of the current tenure (hex string) */
  readonly publicKeyHash: string;
}

/** @ignore */
export interface OriginPrincipalWire {
  readonly type: StacksWireType.Principal;
  readonly prefix: PostConditionPrincipalId.Origin;
}

/** @ignore */
export interface StandardPrincipalWire {
  readonly type: StacksWireType.Principal;
  readonly prefix: PostConditionPrincipalId.Standard;
  readonly address: AddressWire;
}

/** @ignore */
export interface ContractPrincipalWire {
  readonly type: StacksWireType.Principal;
  readonly prefix: PostConditionPrincipalId.Contract;
  readonly address: AddressWire;
  readonly contractName: LengthPrefixedStringWire;
}

/** @ignore */
export interface LengthPrefixedStringWire {
  readonly type: StacksWireType.LengthPrefixedString;
  readonly content: string;
  readonly lengthPrefixBytes: number;
  readonly maxLengthBytes: number;
}

/** @ignore */
export interface AssetWire {
  readonly type: StacksWireType.Asset;
  readonly address: AddressWire;
  readonly contractName: LengthPrefixedStringWire;
  readonly assetName: LengthPrefixedStringWire;
}

/** @ignore */
export interface STXPostConditionWire {
  readonly type: StacksWireType.PostCondition;
  readonly conditionType: PostConditionType.STX;
  readonly principal: PostConditionPrincipalWire;
  readonly conditionCode: FungibleConditionCode;
  readonly amount: bigint;
}

/** @ignore */
export interface FungiblePostConditionWire {
  readonly type: StacksWireType.PostCondition;
  readonly conditionType: PostConditionType.Fungible;
  readonly principal: PostConditionPrincipalWire;
  readonly conditionCode: FungibleConditionCode;
  readonly amount: bigint;
  readonly asset: AssetWire;
}

/** @ignore */
export interface NonFungiblePostConditionWire {
  readonly type: StacksWireType.PostCondition;
  readonly conditionType: PostConditionType.NonFungible;
  readonly principal: PostConditionPrincipalWire;
  readonly conditionCode: NonFungibleConditionCode;
  /** Structure that identifies the token type. */
  readonly asset: AssetWire;
  /** The Clarity value that names the token instance. */
  readonly assetName: ClarityValue;
}

/** @ignore */
export interface StakingPostConditionWire {
  readonly type: StacksWireType.PostCondition;
  readonly conditionType: PostConditionType.Staking;
  readonly principal: PostConditionPrincipalWire;
  readonly conditionCode: FungibleConditionCode;
  readonly amount: bigint;
}

/** @ignore */
export interface PoxPostConditionWire {
  readonly type: StacksWireType.PostCondition;
  readonly conditionType: PostConditionType.PoX;
  readonly principal: PostConditionPrincipalWire;
  readonly conditionCode: PoxConditionCode;
}

/** @ignore */
export type PostConditionWire =
  | STXPostConditionWire
  | FungiblePostConditionWire
  | NonFungiblePostConditionWire
  | StakingPostConditionWire
  | PoxPostConditionWire;

/** @ignore */
export type PostConditionPrincipalWire =
  | OriginPrincipalWire
  | StandardPrincipalWire
  | ContractPrincipalWire;

export interface TransactionAuthFieldWire {
  type: StacksWireType.TransactionAuthField;
  pubKeyEncoding: PubKeyEncoding;
  contents: TransactionAuthFieldContentsWire;
}

export type TransactionAuthFieldContentsWire = PublicKeyWire | MessageSignatureWire;

/** @see {@link AuthFieldType} */
export interface TransactionAuthFieldWire {
  type: StacksWireType.TransactionAuthField;
  pubKeyEncoding: PubKeyEncoding;
  contents: TransactionAuthFieldContentsWire;
}

// todo: this file should hold the type definitions for more message types later
// needed now to fix a circular dependency issue in structuredDataSignature

/** @deprecated  */
export interface StructuredDataSignatureWire {
  readonly type: StacksWireType.StructuredDataSignature;
  data: string;
}

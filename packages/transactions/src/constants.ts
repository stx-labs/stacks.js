/** @ignore internal */
export const BLOCKSTACK_DEFAULT_GAIA_HUB_URL = 'https://hub.blockstack.org';

export const MAX_STRING_LENGTH_BYTES = 128;
export const CLARITY_INT_SIZE = 128;
export const CLARITY_INT_BYTE_SIZE = 16;
export const COINBASE_BYTES_LENGTH = 32;
export const VRF_PROOF_BYTES_LENGTH = 80;
export const RECOVERABLE_ECDSA_SIG_LENGTH_BYTES = 65;
export const COMPRESSED_PUBKEY_LENGTH_BYTES = 32;
export const UNCOMPRESSED_PUBKEY_LENGTH_BYTES = 64;
export const MEMO_MAX_LENGTH_BYTES = 34;

// https://github.com/stacks-network/stacks-core/blob/31d048c6c345c8cb7be38283385e54870b1c3c83/stacks-common/src/codec/mod.rs#L206
// messages can't be bigger than 16MB plus the preamble and relayers
const MAX_PAYLOAD_LEN = 1 + 16 * 1024 * 1024;
const PREAMBLE_ENCODED_SIZE = 165;
const MAX_RELAYERS_LEN = 16;
const PEER_ADDRESS_ENCODED_SIZE = 16;
const HASH160_ENCODED_SIZE = 20;
const NEIGHBOR_ADDRESS_ENCODED_SIZE = PEER_ADDRESS_ENCODED_SIZE + 2 + HASH160_ENCODED_SIZE;
const RELAY_DATA_ENCODED_SIZE = NEIGHBOR_ADDRESS_ENCODED_SIZE + 4;
export const STRING_MAX_LENGTH =
  MAX_PAYLOAD_LEN + (PREAMBLE_ENCODED_SIZE + MAX_RELAYERS_LEN * RELAY_DATA_ENCODED_SIZE);

/**
 * The type of transaction (payload) that is being serialized.
 * Used internally for serializing and deserializing transactions.
 */
export enum PayloadType {
  TokenTransfer = 0x00,
  SmartContract = 0x01,
  VersionedSmartContract = 0x06,
  ContractCall = 0x02,
  PoisonMicroblock = 0x03,
  Coinbase = 0x04,
  CoinbaseToAltRecipient = 0x05,
  TenureChange = 0x7,
  NakamotoCoinbase = 0x08,
}

/**
 * The version of Clarity used to deploy a smart contract.
 * Most methods will default to the latest available version of Clarity.
 */
export enum ClarityVersion {
  Clarity1 = 1,
  Clarity2 = 2,
  Clarity3 = 3,
  Clarity4 = 4,
}

/**
 * How a transaction should get appended to the Stacks blockchain.
 *
 * In the Stacks blockchain, there are two kinds of blocks: anchored
 * blocks and streaming microblocks. A transactions AnchorMode specifies
 * which kind of block it should be included in.
 *
 * For more information about the kinds of Stacks blocks and the various
 * AnchorModes, check out {@link https://github.com/stacksgov/sips/blob/main/sips/sip-001/sip-001-burn-election.md SIP 001} and
 * @deprecated `AnchorMode` is not needed in Stacks since the Nakamoto update.
 * {@link https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md SIP 005}
 */
export enum AnchorMode {
  /** The transaction MUST be included in an anchored block */
  OnChainOnly = 0x01,
  /** The transaction MUST be included in a microblock */
  OffChainOnly = 0x02,
  /** The leader can choose where to include the transaction (anchored block or microblock)*/
  Any = 0x03,
}

/** @deprecated `AnchorMode` is not needed in Stacks since the Nakamoto update. */
export const AnchorModeNames = ['onChainOnly', 'offChainOnly', 'any'] as const;
/** @deprecated `AnchorMode` is not needed in Stacks since the Nakamoto update. */
export type AnchorModeName = (typeof AnchorModeNames)[number];

const AnchorModeMap = {
  [AnchorModeNames[0]]: AnchorMode.OnChainOnly,
  [AnchorModeNames[1]]: AnchorMode.OffChainOnly,
  [AnchorModeNames[2]]: AnchorMode.Any,
  [AnchorMode.OnChainOnly]: AnchorMode.OnChainOnly,
  [AnchorMode.OffChainOnly]: AnchorMode.OffChainOnly,
  [AnchorMode.Any]: AnchorMode.Any,
};

/** @ignore @deprecated Block anchor modes don't exist on-chain anymore. */
export function anchorModeFrom(mode: AnchorModeName | AnchorMode): AnchorMode {
  if (mode in AnchorModeMap) return AnchorModeMap[mode];
  throw new Error(`Invalid anchor mode "${mode}", must be one of: ${AnchorModeNames.join(', ')}`);
}

/**
 * How to treat unspecified transfers of a transaction.
 * Used for creating transactions.
 *
 * Post-conditions are **always** be validated by nodes, regardless of the {@link PostConditionMode}.
 * `PostConditionMode.Allow` will allow additional (aka unspecified) transfers, while `PostConditionMode.Deny` will not.
 */
export enum PostConditionMode {
  /** `Allow` — Allow unspecified transfers */
  Allow = 0x01,
  /** `Deny` — Do not allow unspecified transfers */
  Deny = 0x02,
}

/**
 * The type of asset a post-condition is referring to.
 * Used for serializing post-conditions.
 */
export enum PostConditionType {
  STX = 0x00,
  Fungible = 0x01,
  NonFungible = 0x02,
}

/**
 * The sponsorship mode of a transaction.
 *
 * Specifies whether a transaction is sponsored or not.
 */
export enum AuthType {
  /** `Standard` (not sponsored) — The transaction is not sponsored. The sender will need to spend fees. */
  Standard = 0x04,
  /** `Sponsored` — The transaction is sponsored. The sponsor will spend fees on behalf of the sender. */
  Sponsored = 0x05,
}

/**
 * Serialization modes for public keys to addresses.
 * Four different modes are supported due to legacy compatibility with Stacks v1 addresses.
 */
export enum AddressHashMode {
  /** `SingleSigHashMode` — hash160(public-key), same as bitcoin's p2pkh */
  P2PKH = 0x00,
  /** Legacy `MultiSigHashMode` — hash160(multisig-redeem-script), same as bitcoin's multisig p2sh */
  P2SH = 0x01,
  /** `SingleSigHashMode` — hash160(segwit-program-00(p2pkh)), same as bitcoin's p2sh-p2wpkh */
  P2WPKH = 0x02,
  /** Legacy `MultiSigHashMode` — hash160(segwit-program-00(public-keys)), same as bitcoin's p2sh-p2wsh */
  P2WSH = 0x03,
  /** Non-Sequential `MultiSigHashMode` — hash160(multisig-redeem-script), same as bitcoin's multisig p2sh */
  P2SHNonSequential = 0x05,
  /** Non-Sequential `MultiSigHashMode` — hash160(segwit-program-00(public-keys)), same as bitcoin's p2sh-p2wsh */
  P2WSHNonSequential = 0x07,

  // todo: once live, rename to remove `NonSequential` and add `Legacy` to sequential mutlisig
}

export type SingleSigHashMode = AddressHashMode.P2PKH | AddressHashMode.P2WPKH;
export type MultiSigHashMode =
  | AddressHashMode.P2SH
  | AddressHashMode.P2WSH
  | AddressHashMode.P2SHNonSequential
  | AddressHashMode.P2WSHNonSequential;

// re-export for backwards compatibility
export { AddressVersion } from '@stacks/network';

// todo: try to remove this
export enum PubKeyEncoding {
  Compressed = 0x00,
  Uncompressed = 0x01,
}

/**
 * The type of fungible token post-condition comparison.
 * Used for serializing post-conditions.
 */
export enum FungibleConditionCode {
  Equal = 0x01,
  Greater = 0x02,
  GreaterEqual = 0x03,
  Less = 0x04,
  LessEqual = 0x05,
}

/**
 * The type of non-fungible token post-condition comparison.
 * Used for serializing post-conditions.
 */
export enum NonFungibleConditionCode {
  Sends = 0x10,
  DoesNotSend = 0x11,
}

/**
 * The type of sender for a post-condition.
 */
export enum PostConditionPrincipalId {
  Origin = 0x01,
  Standard = 0x02,
  Contract = 0x03,
}

/**
 * The type of asset used in a post-condition.
 */
export enum AssetType {
  STX = 0x00,
  Fungible = 0x01,
  NonFungible = 0x02,
}

export enum TenureChangeCause {
  /** A valid winning block-commit */
  BlockFound = 0,
  /** The next burnchain block is taking too long, so extend the runtime budget */
  Extended = 1,
  /// NEW in SIP-034: extend specific dimensions
  ExtendedRuntime = 2,
  ExtendedReadCount = 3,
  ExtendedReadLength = 4,
  ExtendedWriteCount = 5,
  ExtendedWriteLength = 6,
}

export enum AuthFieldType {
  PublicKeyCompressed = 0x00,
  PublicKeyUncompressed = 0x01,
  SignatureCompressed = 0x02,
  SignatureUncompressed = 0x03,
}

// todo: refactor this, if only used in one place, just use a string
/** @ignore */
export enum TxRejectedReason {
  Serialization = 'Serialization',
  Deserialization = 'Deserialization',
  SignatureValidation = 'SignatureValidation',
  FeeTooLow = 'FeeTooLow',
  BadNonce = 'BadNonce',
  NotEnoughFunds = 'NotEnoughFunds',
  NoSuchContract = 'NoSuchContract',
  NoSuchPublicFunction = 'NoSuchPublicFunction',
  BadFunctionArgument = 'BadFunctionArgument',
  ContractAlreadyExists = 'ContractAlreadyExists',
  PoisonMicroblocksDoNotConflict = 'PoisonMicroblocksDoNotConflict',
  PoisonMicroblockHasUnknownPubKeyHash = 'PoisonMicroblockHasUnknownPubKeyHash',
  PoisonMicroblockIsInvalid = 'PoisonMicroblockIsInvalid',
  BadAddressVersionByte = 'BadAddressVersionByte',
  NoCoinbaseViaMempool = 'NoCoinbaseViaMempool',
  ServerFailureNoSuchChainTip = 'ServerFailureNoSuchChainTip',
  ServerFailureDatabase = 'ServerFailureDatabase',
  ServerFailureOther = 'ServerFailureOther',
}

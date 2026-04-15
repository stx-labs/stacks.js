import { IntegerType, PrivateKey, PublicKey } from '@stacks/common';
import {
  NetworkClientParam,
  STACKS_MAINNET,
  clientFromNetwork,
  networkFrom,
} from '@stacks/network';
import { c32address } from 'c32check';
import {
  SpendingCondition,
  createMultiSigSpendingCondition,
  createSingleSigSpendingCondition,
  createSponsoredAuth,
  createStandardAuth,
  isSingleSig,
} from './authorization';
import { ClarityValue, PrincipalCV } from './clarity';
import {
  AddressHashMode,
  ClarityVersion,
  MultiSigHashMode,
  PayloadType,
  PostConditionMode,
  SingleSigHashMode,
} from './constants';
import { ClarityAbi, validateContractCall } from './contract-abi';
import { fetchAbi, fetchFeeEstimate, fetchNonce } from './fetch';
import {
  createStacksPublicKey,
  privateKeyToHex,
  privateKeyToPublic,
  publicKeyToAddress,
  publicKeyToHex,
} from './keys';
import { postConditionModeFrom, postConditionToWire } from './postcondition';
import { PostCondition, PostConditionModeName } from './postcondition-types';
import { TransactionSigner } from './signer';
import { StacksTransactionWire, deriveNetworkFromTx } from './transaction';
import { ContractIdString } from './types';
import { omit, parseContractId } from './utils';
import {
  PostConditionWire,
  addressFromPublicKeys,
  createAddress,
  createContractCallPayload,
  createLPList,
  createSmartContractPayload,
  createTokenTransferPayload,
  deserializePostConditionWire,
} from './wire';

/** @deprecated Not used internally */
export interface MultiSigOptions {
  numSignatures: number;
  publicKeys: string[];
  signerKeys?: string[];
}

export interface UnsignedMultiSigOptions {
  /** The minimum required signatures N (in a N of M multi-sig) */
  numSignatures: number;
  /** The M public-keys (in a N of M multi-sig), which together form the address of the multi-sig account */
  publicKeys: PublicKey[];
  /**
   * The `address` of the multi-sig account.
   * - If NOT provided, the public-key order is taken AS IS.
   * - If provided, the address will be checked against the order of the public-keys (either AS IS or SORTED).
   * The default is to SORT the public-keys (only if the `address` is provided).
   */
  address?: string;
  /** @experimental Use newer non-sequential multi-sig hashmode for transaction. Future releases may make this the default. */
  useNonSequentialMultiSig?: boolean;
}

export type SignedMultiSigOptions = UnsignedMultiSigOptions & {
  signerKeys: PrivateKey[];
};

/**
 * STX token transfer transaction options
 *
 * Note: Standard STX transfer does not allow post-conditions.
 */
export type TokenTransferOptions = {
  /** the address of the recipient of the token transfer */
  recipient: string | PrincipalCV;
  /** the amount to be transfered in microstacks */
  amount: IntegerType;
  /** the transaction fee in microstacks */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** an arbitrary string to include in the transaction, must be less than 34 bytes */
  memo?: string;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedTokenTransferOptions extends TokenTransferOptions {
  publicKey: PublicKey;
}

export interface SignedTokenTransferOptions extends TokenTransferOptions {
  senderKey: PrivateKey;
}

export type UnsignedMultiSigTokenTransferOptions = TokenTransferOptions & UnsignedMultiSigOptions;

export type SignedMultiSigTokenTransferOptions = TokenTransferOptions & SignedMultiSigOptions;

/**
 * Generates an unsigned Stacks token transfer transaction
 *
 * Returns a Stacks token transfer transaction.
 *
 * @param {UnsignedTokenTransferOptions | UnsignedMultiSigTokenTransferOptions} txOptions - an options object for the token transfer
 *
 * @return {Promise<StacksTransactionWire>}
 */
export async function makeUnsignedSTXTokenTransfer(
  txOptions: UnsignedTokenTransferOptions | UnsignedMultiSigTokenTransferOptions
): Promise<StacksTransactionWire> {
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: STACKS_MAINNET,
    memo: '',
    sponsored: false,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), txOptions.client);

  const payload = createTokenTransferPayload(options.recipient, options.amount, options.memo);

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    const hashMode = options.useNonSequentialMultiSig
      ? AddressHashMode.P2SHNonSequential
      : AddressHashMode.P2SH;

    const publicKeys = options.address
      ? sortPublicKeysForAddress(
          options.publicKeys.map(publicKeyToHex),
          options.numSignatures,
          hashMode,
          createAddress(options.address).hash160
        )
      : options.publicKeys.map(publicKeyToHex);

    spendingCondition = createMultiSigSpendingCondition(
      hashMode,
      options.numSignatures,
      publicKeys,
      options.nonce,
      options.fee
    );
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const transaction = new StacksTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    // no post conditions on STX transfers (see SIP-005)
  });

  if (txOptions.fee == null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce == null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

/**
 * Generates a signed Stacks token transfer transaction
 *
 * Returns a signed Stacks token transfer transaction.
 *
 * @param {SignedTokenTransferOptions | SignedMultiSigTokenTransferOptions} txOptions - an options object for the token transfer
 *
 * @return {StacksTransactionWire}
 */
export async function makeSTXTokenTransfer(
  txOptions: SignedTokenTransferOptions | SignedMultiSigTokenTransferOptions
): Promise<StacksTransactionWire> {
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedSTXTokenTransfer({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    const options = omit(txOptions, 'signerKeys');
    const transaction = await makeUnsignedSTXTokenTransfer(options);

    mutatingSignAppendMultiSig(
      transaction,
      txOptions.publicKeys.map(publicKeyToHex).slice(),
      txOptions.signerKeys.map(privateKeyToHex),
      txOptions.address
    );

    return transaction;
  }
}

/**
 * Contract deploy transaction options (preferred shape).
 */
export type ContractDeployParams = {
  clarityVersion?: ClarityVersion;
  /** the name of the contract to deploy */
  name: string;
  /** the Clarity code to be deployed */
  clarityCode: string;
  /** transaction fee in microstacks */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** the post condition mode, specifying whether or not post-conditions must fully cover all
   * transfered assets */
  postConditionMode?: PostConditionModeName | PostConditionMode;
  /** a list of post conditions to add to the transaction */
  postConditions?: (PostCondition | PostConditionWire | string)[];
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedContractDeployParams extends ContractDeployParams {
  /** a hex string of the public key of the transaction sender */
  publicKey: PublicKey;
}

export interface SignedContractDeployParams extends ContractDeployParams {
  senderKey: PrivateKey;
}

export type UnsignedMultiSigContractDeployParams = ContractDeployParams & UnsignedMultiSigOptions;

export type SignedMultiSigContractDeployParams = ContractDeployParams & SignedMultiSigOptions;

/**
 * Contract deploy transaction options (legacy shape).
 * @deprecated Use {@link ContractDeployParams} with `name` and `clarityCode` fields instead.
 */
export type BaseContractDeployOptions = {
  clarityVersion?: ClarityVersion;
  contractName: string;
  /** the Clarity code to be deployed */
  codeBody: string;
  /** transaction fee in microstacks */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** the post condition mode, specifying whether or not post-conditions must fully cover all
   * transfered assets */
  postConditionMode?: PostConditionModeName | PostConditionMode;
  /** a list of post conditions to add to the transaction */
  postConditions?: (PostCondition | PostConditionWire | string)[];
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

/** @deprecated Use {@link UnsignedContractDeployParams} instead. */
export interface UnsignedContractDeployOptions extends BaseContractDeployOptions {
  /** a hex string of the public key of the transaction sender */
  publicKey: PublicKey;
}

/** @deprecated Use {@link SignedContractDeployParams} instead. */
export interface SignedContractDeployOptions extends BaseContractDeployOptions {
  senderKey: PrivateKey;
}

/** @deprecated Use {@link SignedContractDeployParams} or {@link UnsignedContractDeployParams} instead. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ContractDeployOptions extends SignedContractDeployOptions {}

/** @deprecated Use {@link UnsignedMultiSigContractDeployParams} instead. */
export type UnsignedMultiSigContractDeployOptions = BaseContractDeployOptions &
  UnsignedMultiSigOptions;

/** @deprecated Use {@link SignedMultiSigContractDeployParams} instead. */
export type SignedMultiSigContractDeployOptions = BaseContractDeployOptions & SignedMultiSigOptions;

/**
 * If the preferred `name`/`clarityCode` fields are present, renames them to
 * the legacy `contractName`/`codeBody` shape used internally. All other
 * properties pass through untouched.
 * @internal
 */
function toLegacyContractDeployOptions<T extends object>(
  opts: T
): T & { contractName: string; codeBody: string } {
  const o = opts as { name?: string; clarityCode?: string };
  if (!o.name && !o.clarityCode) return opts as T & { contractName: string; codeBody: string };
  const { name, clarityCode, ...rest } = opts as T & {
    name?: string;
    clarityCode?: string;
    contractName?: string;
    codeBody?: string;
  };
  return {
    ...(rest as T),
    contractName: name ?? rest.contractName!,
    codeBody: clarityCode ?? rest.codeBody!,
  };
}

/**
 * Generates a Clarity smart contract deploy transaction.
 *
 * Accepts either the preferred {@link ContractDeployParams} shape (with `name`
 * and `clarityCode`) or the legacy {@link BaseContractDeployOptions} shape
 * (with `contractName` and `codeBody`).
 *
 * Returns a signed Stacks smart contract deploy transaction.
 *
 * @return {StacksTransactionWire}
 */
export async function makeContractDeploy(
  txOptions: SignedContractDeployParams | SignedMultiSigContractDeployParams
): Promise<StacksTransactionWire>;
/** @deprecated Use {@link SignedContractDeployParams} with `name` and `clarityCode` fields. */
export async function makeContractDeploy(
  txOptions: SignedContractDeployOptions | SignedMultiSigContractDeployOptions
): Promise<StacksTransactionWire>;
export async function makeContractDeploy(
  _txOptions:
    | SignedContractDeployParams
    | SignedMultiSigContractDeployParams
    | SignedContractDeployOptions
    | SignedMultiSigContractDeployOptions
): Promise<StacksTransactionWire> {
  const txOptions = toLegacyContractDeployOptions(_txOptions);
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedContractDeploy({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    const options = omit(txOptions, 'signerKeys');
    const transaction = await makeUnsignedContractDeploy(options);

    mutatingSignAppendMultiSig(
      transaction,
      txOptions.publicKeys.map(publicKeyToHex).slice(),
      txOptions.signerKeys.map(privateKeyToHex),
      txOptions.address
    );

    return transaction;
  }
}

/**
 * Generates an unsigned Clarity smart contract deploy transaction.
 *
 * Accepts either the preferred {@link ContractDeployParams} shape (with `name`
 * and `clarityCode`) or the legacy {@link BaseContractDeployOptions} shape
 * (with `contractName` and `codeBody`).
 */
export async function makeUnsignedContractDeploy(
  txOptions: UnsignedContractDeployParams | UnsignedMultiSigContractDeployParams
): Promise<StacksTransactionWire>;
/** @deprecated Use {@link UnsignedContractDeployParams} with `name` and `clarityCode` fields. */
export async function makeUnsignedContractDeploy(
  txOptions: UnsignedContractDeployOptions | UnsignedMultiSigContractDeployOptions
): Promise<StacksTransactionWire>;
export async function makeUnsignedContractDeploy(
  _txOptions:
    | UnsignedContractDeployParams
    | UnsignedMultiSigContractDeployParams
    | UnsignedContractDeployOptions
    | UnsignedMultiSigContractDeployOptions
): Promise<StacksTransactionWire> {
  const txOptions = toLegacyContractDeployOptions(_txOptions);
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: STACKS_MAINNET,
    postConditionMode: PostConditionMode.Deny,
    sponsored: false,
    clarityVersion: ClarityVersion.Clarity4,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), txOptions.client);
  options.postConditionMode = postConditionModeFrom(options.postConditionMode);

  const payload = createSmartContractPayload(
    options.contractName,
    options.codeBody,
    options.clarityVersion
  );

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    const hashMode = options.useNonSequentialMultiSig
      ? AddressHashMode.P2SHNonSequential
      : AddressHashMode.P2SH;

    const publicKeys = options.address
      ? sortPublicKeysForAddress(
          options.publicKeys.map(publicKeyToHex),
          options.numSignatures,
          hashMode,
          createAddress(options.address).hash160
        )
      : options.publicKeys.map(publicKeyToHex);

    spendingCondition = createMultiSigSpendingCondition(
      hashMode,
      options.numSignatures,
      publicKeys,
      options.nonce,
      options.fee
    );
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const postConditions: PostConditionWire[] = (options.postConditions ?? []).map(pc => {
    if (typeof pc === 'string') return deserializePostConditionWire(pc);
    if (typeof pc.type === 'string') return postConditionToWire(pc);
    return pc;
  });
  const lpPostConditions = createLPList(postConditions);

  const transaction = new StacksTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    postConditions: lpPostConditions,
    postConditionMode: options.postConditionMode,
  });

  if (txOptions.fee === undefined || txOptions.fee === null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce === undefined || txOptions.nonce === null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

/**
 * Contract function call transaction options (preferred shape).
 */
export type ContractCallParams = {
  /** the fully-qualified contract identifier as `<address>.<name>` */
  contract: ContractIdString;
  functionName: string;
  functionArgs: ClarityValue[];
  /** transaction fee in microstacks */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** the post condition mode, specifying whether or not post-conditions must fully cover all
   * transfered assets */
  postConditionMode?: PostConditionModeName | PostConditionMode;
  /** a list of post conditions to add to the transaction */
  postConditions?: (PostCondition | PostConditionWire | string)[];
  /** set to true to validate that the supplied function args match those specified in
   * the published contract */
  validateWithAbi?: boolean | ClarityAbi;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

export interface UnsignedContractCallParams extends ContractCallParams {
  publicKey: PublicKey;
}

export interface SignedContractCallParams extends ContractCallParams {
  senderKey: PrivateKey;
}

export type UnsignedMultiSigContractCallParams = ContractCallParams & UnsignedMultiSigOptions;

export type SignedMultiSigContractCallParams = ContractCallParams & SignedMultiSigOptions;

/**
 * Contract function call transaction options (legacy shape, split contract identifier).
 * @deprecated Use {@link ContractCallParams} with the combined `contract` field instead.
 */
export type ContractCallOptions = {
  /** the Stacks address of the contract */
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
  /** transaction fee in microstacks */
  fee?: IntegerType;
  /** the transaction nonce, which must be increased monotonically with each new transaction */
  nonce?: IntegerType;
  /** the post condition mode, specifying whether or not post-conditions must fully cover all
   * transfered assets */
  postConditionMode?: PostConditionModeName | PostConditionMode;
  /** a list of post conditions to add to the transaction */
  postConditions?: (PostCondition | PostConditionWire | string)[];
  /** set to true to validate that the supplied function args match those specified in
   * the published contract */
  validateWithAbi?: boolean | ClarityAbi;
  /** set to true if another account is sponsoring the transaction (covering the transaction fee) */
  sponsored?: boolean;
} & NetworkClientParam;

/** @deprecated Use {@link UnsignedContractCallParams} instead. */
export interface UnsignedContractCallOptions extends ContractCallOptions {
  publicKey: PrivateKey;
}

/** @deprecated Use {@link SignedContractCallParams} instead. */
export interface SignedContractCallOptions extends ContractCallOptions {
  senderKey: PublicKey;
}

/** @deprecated Use {@link UnsignedMultiSigContractCallParams} instead. */
export type UnsignedMultiSigContractCallOptions = ContractCallOptions & UnsignedMultiSigOptions;

/** @deprecated Use {@link SignedMultiSigContractCallParams} instead. */
export type SignedMultiSigContractCallOptions = ContractCallOptions & SignedMultiSigOptions;

/**
 * If the combined `contract` field is present, splits it into the legacy
 * `contractAddress` + `contractName` shape used internally. All other
 * properties pass through untouched.
 * @internal
 */
function toLegacyContractCallOptions<T extends object>(
  opts: T
): T & { contractAddress: string; contractName: string } {
  const o = opts as { contract?: ContractIdString };
  if (!o.contract) return opts as T & { contractAddress: string; contractName: string };
  const [contractAddress, contractName] = parseContractId(o.contract);
  return { ...opts, contractAddress, contractName };
}

/**
 * Generates an unsigned Clarity smart contract function call transaction.
 *
 * Accepts either the preferred {@link ContractCallParams} shape (with the
 * combined `contract: "<address>.<name>"` field) or the legacy
 * {@link ContractCallOptions} shape (with split `contractAddress` and
 * `contractName` fields).
 *
 * @returns {Promise<StacksTransactionWire>}
 */
export async function makeUnsignedContractCall(
  txOptions: UnsignedContractCallParams | UnsignedMultiSigContractCallParams
): Promise<StacksTransactionWire>;
/** @deprecated Use {@link UnsignedContractCallParams} with the combined `contract` field. */
export async function makeUnsignedContractCall(
  txOptions: UnsignedContractCallOptions | UnsignedMultiSigContractCallOptions
): Promise<StacksTransactionWire>;
export async function makeUnsignedContractCall(
  _txOptions:
    | UnsignedContractCallParams
    | UnsignedMultiSigContractCallParams
    | UnsignedContractCallOptions
    | UnsignedMultiSigContractCallOptions
): Promise<StacksTransactionWire> {
  const txOptions = toLegacyContractCallOptions(_txOptions);
  const defaultOptions = {
    fee: BigInt(0),
    nonce: BigInt(0),
    network: STACKS_MAINNET,
    postConditionMode: PostConditionMode.Deny,
    sponsored: false,
  };

  const options = Object.assign(defaultOptions, txOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), options.client);
  options.postConditionMode = postConditionModeFrom(options.postConditionMode);

  const payload = createContractCallPayload(
    options.contractAddress,
    options.contractName,
    options.functionName,
    options.functionArgs
  );

  if (options?.validateWithAbi) {
    let abi: ClarityAbi;
    if (typeof options.validateWithAbi === 'boolean') {
      if (options?.network) {
        abi = await fetchAbi({ ...options });
      } else {
        throw new Error('Network option must be provided in order to validate with ABI');
      }
    } else {
      abi = options.validateWithAbi;
    }

    validateContractCall(payload, abi);
  }

  let spendingCondition: SpendingCondition | null = null;

  if ('publicKey' in options) {
    // single-sig
    spendingCondition = createSingleSigSpendingCondition(
      AddressHashMode.P2PKH,
      options.publicKey,
      options.nonce,
      options.fee
    );
  } else {
    // multi-sig
    const hashMode = options.useNonSequentialMultiSig
      ? AddressHashMode.P2SHNonSequential
      : AddressHashMode.P2SH;

    const publicKeys = options.address
      ? sortPublicKeysForAddress(
          options.publicKeys.map(publicKeyToHex),
          options.numSignatures,
          hashMode,
          createAddress(options.address).hash160
        )
      : options.publicKeys.map(publicKeyToHex);

    spendingCondition = createMultiSigSpendingCondition(
      hashMode,
      options.numSignatures,
      publicKeys,
      options.nonce,
      options.fee
    );
  }

  const authorization = options.sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  const postConditions: PostConditionWire[] = (options.postConditions ?? []).map(pc => {
    if (typeof pc === 'string') return deserializePostConditionWire(pc);
    if (typeof pc.type === 'string') return postConditionToWire(pc);
    return pc;
  });
  const lpPostConditions = createLPList(postConditions);

  const transaction = new StacksTransactionWire({
    transactionVersion: options.network.transactionVersion,
    chainId: options.network.chainId,
    auth: authorization,
    payload,
    postConditions: lpPostConditions,
    postConditionMode: options.postConditionMode,
  });

  if (txOptions.fee === undefined || txOptions.fee === null) {
    const fee = await fetchFeeEstimate({ transaction, ...options });
    transaction.setFee(fee);
  }

  if (txOptions.nonce === undefined || txOptions.nonce === null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = c32address(addressVersion, transaction.auth.spendingCondition!.signer);
    const txNonce = await fetchNonce({ address, ...options });
    transaction.setNonce(txNonce);
  }

  return transaction;
}

/**
 * Generates a Clarity smart contract function call transaction.
 *
 * Accepts either the preferred {@link ContractCallParams} shape (with the
 * combined `contract: "<address>.<name>"` field) or the legacy
 * {@link ContractCallOptions} shape (with split `contractAddress` and
 * `contractName` fields).
 *
 * Returns a signed Stacks smart contract function call transaction.
 *
 * @return {StacksTransactionWire}
 */
export async function makeContractCall(
  txOptions: SignedContractCallParams | SignedMultiSigContractCallParams
): Promise<StacksTransactionWire>;
/** @deprecated Use {@link SignedContractCallParams} with the combined `contract` field. */
export async function makeContractCall(
  txOptions: SignedContractCallOptions | SignedMultiSigContractCallOptions
): Promise<StacksTransactionWire>;
export async function makeContractCall(
  _txOptions:
    | SignedContractCallParams
    | SignedMultiSigContractCallParams
    | SignedContractCallOptions
    | SignedMultiSigContractCallOptions
): Promise<StacksTransactionWire> {
  const txOptions = toLegacyContractCallOptions(_txOptions);
  if ('senderKey' in txOptions) {
    // single-sig
    const publicKey = privateKeyToPublic(txOptions.senderKey);
    const options = omit(txOptions, 'senderKey');
    const transaction = await makeUnsignedContractCall({ publicKey, ...options });

    const privKey = txOptions.senderKey;
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(privKey);

    return transaction;
  } else {
    // multi-sig
    const options = omit(txOptions, 'signerKeys');
    const transaction = await makeUnsignedContractCall(options);

    mutatingSignAppendMultiSig(
      transaction,
      txOptions.publicKeys.map(publicKeyToHex).slice(),
      txOptions.signerKeys.map(privateKeyToHex),
      txOptions.address
    );

    return transaction;
  }
}

/**
 * Sponsored transaction options
 */
export type SponsorOptionsOpts = {
  /** the origin-signed transaction */
  transaction: StacksTransactionWire;
  /** the sponsor's private key */
  sponsorPrivateKey: PrivateKey;
  /** the transaction fee amount to sponsor */
  fee?: IntegerType;
  /** the nonce of the sponsor account */
  sponsorNonce?: IntegerType;
  /** the hashmode of the sponsor's address */
  sponsorAddressHashmode?: AddressHashMode;
} & NetworkClientParam;

/**
 * Constructs and signs a sponsored transaction as the sponsor
 *
 * @param {SponsorOptionsOpts} sponsorOptions - the sponsor options object
 *
 * Returns a signed sponsored transaction.
 *
 * @return {ClarityValue}
 */
export async function sponsorTransaction(
  sponsorOptions: SponsorOptionsOpts
): Promise<StacksTransactionWire> {
  const defaultOptions = {
    fee: 0 as IntegerType,
    sponsorNonce: 0 as IntegerType,
    sponsorAddressHashmode: AddressHashMode.P2PKH as SingleSigHashMode,
    network: deriveNetworkFromTx(sponsorOptions.transaction),
  };

  const options = Object.assign(defaultOptions, sponsorOptions);
  options.network = networkFrom(options.network);
  options.client = Object.assign({}, clientFromNetwork(options.network), options.client);

  const sponsorPubKey = privateKeyToPublic(options.sponsorPrivateKey);

  if (sponsorOptions.fee == null) {
    let txFee: bigint | number = 0;
    switch (options.transaction.payload.payloadType) {
      case PayloadType.TokenTransfer:
      case PayloadType.SmartContract:
      case PayloadType.VersionedSmartContract:
      case PayloadType.ContractCall:
        txFee = BigInt(await fetchFeeEstimate({ ...options }));
        break;
      default:
        throw new Error(
          `Sponsored transactions not supported for transaction type ${
            PayloadType[options.transaction.payload.payloadType]
          }`
        );
    }
    options.transaction.setFee(txFee);
    options.fee = txFee;
  }

  if (sponsorOptions.sponsorNonce == null) {
    const addressVersion = options.network.addressVersion.singleSig;
    const address = publicKeyToAddress(addressVersion, sponsorPubKey);
    const sponsorNonce = await fetchNonce({ address, ...options });
    options.sponsorNonce = sponsorNonce;
  }

  const sponsorSpendingCondition = createSingleSigSpendingCondition(
    options.sponsorAddressHashmode,
    sponsorPubKey,
    options.sponsorNonce,
    options.fee
  );

  options.transaction.setSponsor(sponsorSpendingCondition);

  const privKey = options.sponsorPrivateKey;
  const signer = TransactionSigner.createSponsorSigner(
    options.transaction,
    sponsorSpendingCondition
  );
  signer.signSponsor(privKey);

  return signer.transaction;
}

/** @internal multi-sig signing re-use */
function mutatingSignAppendMultiSig(
  /** **Warning:** method mutates `transaction` */
  transaction: StacksTransactionWire,
  publicKeys: string[],
  signerKeys: string[],
  address?: string
) {
  if (isSingleSig(transaction.auth.spendingCondition)) {
    throw new Error('Transaction is not a multi-sig transaction');
  }

  const signer = new TransactionSigner(transaction);

  const pubs = address
    ? sortPublicKeysForAddress(
        publicKeys,
        transaction.auth.spendingCondition.signaturesRequired,
        transaction.auth.spendingCondition.hashMode,
        createAddress(address).hash160
      )
    : publicKeys;

  // sign in order of public keys
  for (const publicKey of pubs) {
    const signerKey = signerKeys.find(key => privateKeyToPublic(key) === publicKey);
    if (signerKey) {
      // either sign and append message signature (which allows for recovering the public key)
      signer.signOrigin(signerKey);
    } else {
      // or append the public key (which did not sign here)
      signer.appendOrigin(publicKey);
    }
  }
}

/** @internal Get the matching public-keys array for a multi-sig address */
function sortPublicKeysForAddress(
  publicKeys: string[],
  numSigs: number,
  hashMode: MultiSigHashMode,
  hash: string
): string[] {
  // unsorted
  const hashUnsorted = addressFromPublicKeys(
    0 as any, // only used for hash, so version doesn't matter
    hashMode,
    numSigs,
    publicKeys.map(createStacksPublicKey)
  ).hash160;

  if (hashUnsorted === hash) return publicKeys;

  // sorted
  const publicKeysSorted = publicKeys.slice().sort();
  const hashSorted = addressFromPublicKeys(
    0 as any, // only used for hash, so version doesn't matter
    hashMode,
    numSigs,
    publicKeysSorted.map(createStacksPublicKey)
  ).hash160;

  if (hashSorted === hash) return publicKeysSorted;

  throw new Error('Failed to find matching multi-sig address given public-keys.');
}

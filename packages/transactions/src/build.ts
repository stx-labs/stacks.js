import { IntegerType, PublicKey } from '@stacks/common';
import { NetworkParam, STACKS_MAINNET, networkFrom } from '@stacks/network';
import {
  SpendingCondition,
  createMultiSigSpendingCondition,
  createSingleSigSpendingCondition,
  createSponsoredAuth,
  createStandardAuth,
} from './authorization';
import { ClarityValue, PrincipalCV } from './clarity';
import {
  AddressHashMode,
  ClarityVersion,
  PostConditionMode,
} from './constants';
import {
  createStacksPublicKey,
  publicKeyToHex,
} from './keys';
import { postConditionModeFrom, postConditionToWire } from './postcondition';
import { PostCondition, PostConditionModeName } from './postcondition-types';
import { StacksTransactionWire } from './transaction';
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

// 33-byte all-zero placeholder. Produces a structurally valid but unsignable
// spending condition. TODO: revisit — a dedicated tx class/instance may give
// callers more control over deferred field population.
const PLACEHOLDER_PUBLIC_KEY = '00'.repeat(33);

type BaseBuildOptions = {
  /** transaction fee in microstacks; defaults to 0 */
  fee?: IntegerType;
  /** transaction nonce; defaults to 0 */
  nonce?: IntegerType;
  /** set to true if another account is sponsoring the transaction */
  sponsored?: boolean;
} & NetworkParam;

type SingleSigBuildOptions = {
  /** public key of the transaction sender; if omitted, a placeholder is used */
  publicKey?: PublicKey;
};

type MultiSigBuildOptions = {
  /** public keys in the M-of-N multi-sig account */
  publicKeys: PublicKey[];
  /** the required signatures N (in a N-of-M multi-sig). */
  // TODO: consider renaming (e.g., `requiredSignatures`).
  numSignatures: number;
  /**
   * Multi-sig account address. If provided, `publicKeys` are sorted to match;
   * if omitted, `publicKeys` are used in the given order.
   */
  address?: string;
};

type SigBuildOptions = SingleSigBuildOptions | MultiSigBuildOptions;

function isMultiSig(opts: SigBuildOptions): opts is MultiSigBuildOptions {
  return 'publicKeys' in opts && Array.isArray((opts as any).publicKeys);
}

function buildSpendingCondition(opts: SigBuildOptions, fee: IntegerType, nonce: IntegerType): SpendingCondition {
  if (isMultiSig(opts)) {
    const hashMode = AddressHashMode.P2SHNonSequential;
    const publicKeys = opts.address
      ? sortPublicKeysForAddress(
          opts.publicKeys.map(publicKeyToHex),
          opts.numSignatures,
          hashMode,
          createAddress(opts.address).hash160
        )
      : opts.publicKeys.map(publicKeyToHex);

    return createMultiSigSpendingCondition(hashMode, opts.numSignatures, publicKeys, nonce, fee);
  }

  const publicKey = opts.publicKey ?? PLACEHOLDER_PUBLIC_KEY;
  return createSingleSigSpendingCondition(AddressHashMode.P2PKH, publicKey, nonce, fee);
}

function normalizePostConditions(
  pcs: (PostCondition | PostConditionWire | string)[] | undefined
): PostConditionWire[] {
  return (pcs ?? []).map(pc => {
    if (typeof pc === 'string') return deserializePostConditionWire(pc);
    if (typeof pc.type === 'string') return postConditionToWire(pc);
    return pc;
  });
}

// =============================================================================
// STX token transfer
// =============================================================================

export type STXTokenTransferTxOptions = BaseBuildOptions &
  SigBuildOptions & {
    /** the address of the recipient of the token transfer */
    recipient: string | PrincipalCV;
    /** the amount to be transferred in microstacks */
    amount: IntegerType;
    /** an arbitrary string to include in the transaction, must be less than 34 bytes */
    memo?: string;
  };

/**
 * Synchronously build an unsigned STX token transfer transaction.
 *
 * Unlike `makeSTXTokenTransfer` / `makeUnsignedSTXTokenTransfer`, this function
 * never performs network I/O. `fee` and `nonce` default to `0`; the public key
 * defaults to a placeholder. Callers are expected to sign (and optionally
 * overwrite fee/nonce/public key) themselves.
 */
export function buildSTXTokenTransfer(opts: STXTokenTransferTxOptions): StacksTransactionWire {
  const network = networkFrom(opts.network ?? STACKS_MAINNET);
  const fee = opts.fee ?? 0;
  const nonce = opts.nonce ?? 0;
  const memo = opts.memo ?? '';
  const sponsored = opts.sponsored ?? false;

  const payload = createTokenTransferPayload(opts.recipient, opts.amount, memo);
  const spendingCondition = buildSpendingCondition(opts, fee, nonce);
  const authorization = sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);

  return new StacksTransactionWire({
    transactionVersion: network.transactionVersion,
    chainId: network.chainId,
    auth: authorization,
    payload,
    // no post-conditions on STX transfers (see SIP-005)
  });
}

// =============================================================================
// Contract deploy
// =============================================================================

export type ContractDeployTxOptions = BaseBuildOptions &
  SigBuildOptions & {
    contractName: string;
    /** the Clarity code to be deployed */
    codeBody: string;
    /** Clarity version; defaults to the latest available */
    clarityVersion?: ClarityVersion;
    /** post-condition mode; defaults to `deny` */
    postConditionMode?: PostConditionModeName | PostConditionMode;
    /** list of post-conditions */
    postConditions?: (PostCondition | PostConditionWire | string)[];
  };

/**
 * Synchronously build an unsigned Clarity smart contract deploy transaction.
 *
 * Unlike `makeContractDeploy` / `makeUnsignedContractDeploy`, this function
 * never performs network I/O. `fee` and `nonce` default to `0`; `clarityVersion`
 * defaults to the latest; the public key defaults to a placeholder.
 */
export function buildContractDeploy(opts: ContractDeployTxOptions): StacksTransactionWire {
  const network = networkFrom(opts.network ?? STACKS_MAINNET);
  const fee = opts.fee ?? 0;
  const nonce = opts.nonce ?? 0;
  const sponsored = opts.sponsored ?? false;
  const clarityVersion = opts.clarityVersion ?? ClarityVersion.Clarity5;
  const postConditionMode = postConditionModeFrom(opts.postConditionMode ?? PostConditionMode.Deny);

  const payload = createSmartContractPayload(opts.contractName, opts.codeBody, clarityVersion);
  const spendingCondition = buildSpendingCondition(opts, fee, nonce);
  const authorization = sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);
  const postConditions = createLPList(normalizePostConditions(opts.postConditions));

  return new StacksTransactionWire({
    transactionVersion: network.transactionVersion,
    chainId: network.chainId,
    auth: authorization,
    payload,
    postConditions,
    postConditionMode,
  });
}

// =============================================================================
// Contract call
// =============================================================================

export type ContractCallTxOptions = BaseBuildOptions &
  SigBuildOptions & {
    /** the Stacks address of the contract */
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: ClarityValue[];
    /** post-condition mode; defaults to `deny` */
    postConditionMode?: PostConditionModeName | PostConditionMode;
    /** list of post-conditions */
    postConditions?: (PostCondition | PostConditionWire | string)[];
  };

/**
 * Synchronously build an unsigned Clarity smart contract function call
 * transaction.
 *
 * Unlike `makeContractCall` / `makeUnsignedContractCall`, this function never
 * performs network I/O (no ABI fetch, no fee estimate, no nonce lookup).
 * `fee` and `nonce` default to `0`; the public key defaults to a placeholder.
 */
export function buildContractCall(opts: ContractCallTxOptions): StacksTransactionWire {
  const network = networkFrom(opts.network ?? STACKS_MAINNET);
  const fee = opts.fee ?? 0;
  const nonce = opts.nonce ?? 0;
  const sponsored = opts.sponsored ?? false;
  const postConditionMode = postConditionModeFrom(opts.postConditionMode ?? PostConditionMode.Deny);

  const payload = createContractCallPayload(
    opts.contractAddress,
    opts.contractName,
    opts.functionName,
    opts.functionArgs
  );
  const spendingCondition = buildSpendingCondition(opts, fee, nonce);
  const authorization = sponsored
    ? createSponsoredAuth(spendingCondition)
    : createStandardAuth(spendingCondition);
  const postConditions = createLPList(normalizePostConditions(opts.postConditions));

  return new StacksTransactionWire({
    transactionVersion: network.transactionVersion,
    chainId: network.chainId,
    auth: authorization,
    payload,
    postConditions,
    postConditionMode,
  });
}

// =============================================================================
// internal helpers (duplicated from `builders.ts`; OK per plan — drift is
// caught by shared vector fixtures)
// =============================================================================

function sortPublicKeysForAddress(
  publicKeys: string[],
  numSigs: number,
  hashMode: AddressHashMode,
  hash: string
): string[] {
  const hashUnsorted = addressFromPublicKeys(
    0 as any,
    hashMode as any,
    numSigs,
    publicKeys.map(createStacksPublicKey)
  ).hash160;
  if (hashUnsorted === hash) return publicKeys;

  const publicKeysSorted = publicKeys.slice().sort();
  const hashSorted = addressFromPublicKeys(
    0 as any,
    hashMode as any,
    numSigs,
    publicKeysSorted.map(createStacksPublicKey)
  ).hash160;
  if (hashSorted === hash) return publicKeysSorted;

  throw new Error('Failed to find matching multi-sig address given public-keys.');
}

import { hexToBytes } from '@stacks/common';
import {
  type ClarityValue,
  type StacksTransactionWire,
  bufferCV,
  contractPrincipalCV,
  makeUnsignedContractCall,
  noneCV,
  principalCV,
  someCV,
  uintCV,
} from '@stacks/transactions';
import { toPoxTuple } from './btc-address';
import { POX_5_CONTRACT } from './constants';
import type {
  BuildGrantSignerKeyTxArgs,
  BuildRegisterPoolTxArgs,
  BuildRevokeSignerKeyTxArgs,
  BuildStakeExtendPooledTxArgs,
  BuildStakeExtendTxArgs,
  BuildStakePooledTxArgs,
  BuildStakeTxArgs,
  BuildStakeUpdatePooledTxArgs,
  BuildStakeUpdateTxArgs,
  TxParams,
} from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const [CONTRACT_ADDRESS, CONTRACT_NAME] = POX_5_CONTRACT.split('.');

function normalizeUnlockBytes(unlockBytes: Uint8Array | string): Uint8Array {
  return typeof unlockBytes === 'string' ? hexToBytes(unlockBytes) : unlockBytes;
}

function optionalSigCV(sig?: string): ClarityValue {
  return sig ? someCV(bufferCV(hexToBytes(sig))) : noneCV();
}

function splitContractPrincipal(principal: string) {
  const [addr, name] = principal.split('.');
  if (!addr || !name) throw new Error(`Invalid contract principal: ${principal}`);
  return contractPrincipalCV(addr, name);
}

async function callPox5(
  functionName: string,
  functionArgs: ClarityValue[],
  tx: TxParams
): Promise<StacksTransactionWire> {
  return makeUnsignedContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs,
    publicKey: tx.publicKey,
    fee: tx.fee,
    nonce: tx.nonce,
    network: tx.network,
  });
}

// ---------------------------------------------------------------------------
// Solo staking
// ---------------------------------------------------------------------------

/** Build an unsigned `stake` transaction (solo — lock STX on L2). */
export async function buildStakeTx(
  args: BuildStakeTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake',
    [
      uintCV(args.amountUstx),
      toPoxTuple(args.poxAddress),
      uintCV(args.startBurnHt),
      uintCV(args.numCycles),
      optionalSigCV(args.signerSignature),
      bufferCV(hexToBytes(args.signerKey)),
      uintCV(args.maxAmount),
      uintCV(args.authId),
      bufferCV(normalizeUnlockBytes(args.unlockBytes)),
    ],
    args
  );
}

/** Build an unsigned `stake-extend` transaction (solo — extend during last cycle). */
export async function buildStakeExtendTx(
  args: BuildStakeExtendTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [
    uintCV(args.numCycles),
    bufferCV(normalizeUnlockBytes(args.unlockBytes)),
    toPoxTuple(args.poxAddress),
    optionalSigCV(args.signerSignature),
    bufferCV(hexToBytes(args.signerKey)),
    uintCV(args.maxAmount),
    uintCV(args.authId),
  ];

  if (args.amountUstx !== undefined) {
    functionArgs.push(someCV(uintCV(args.amountUstx)));
  } else {
    functionArgs.push(noneCV());
  }

  return callPox5('stake-extend', functionArgs, args);
}

/** Build an unsigned `stake-update` transaction (solo — change signer/address/increase mid-stake). */
export async function buildStakeUpdateTx(
  args: BuildStakeUpdateTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [
    toPoxTuple(args.poxAddress),
    optionalSigCV(args.signerSignature),
    bufferCV(hexToBytes(args.signerKey)),
    uintCV(args.maxAmount),
    uintCV(args.authId),
  ];

  if (args.increaseBy !== undefined) {
    functionArgs.push(someCV(uintCV(args.increaseBy)));
  } else {
    functionArgs.push(noneCV());
  }

  return callPox5('stake-update', functionArgs, args);
}

// ---------------------------------------------------------------------------
// Pool staking
// ---------------------------------------------------------------------------

/** Build an unsigned `stake-pooled` transaction (join a registered pool). */
export async function buildStakePooledTx(
  args: BuildStakePooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-pooled',
    [
      uintCV(args.amountUstx),
      uintCV(args.numCycles),
      bufferCV(normalizeUnlockBytes(args.unlockBytes)),
      uintCV(args.startBurnHt),
      splitContractPrincipal(args.poolOwner),
    ],
    args
  );
}

/** Build an unsigned `stake-extend-pooled` transaction. */
export async function buildStakeExtendPooledTx(
  args: BuildStakeExtendPooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [
    uintCV(args.numCycles),
    bufferCV(normalizeUnlockBytes(args.unlockBytes)),
    splitContractPrincipal(args.poolOwner),
  ];

  if (args.amountUstx !== undefined) {
    functionArgs.push(someCV(uintCV(args.amountUstx)));
  } else {
    functionArgs.push(noneCV());
  }

  return callPox5('stake-extend-pooled', functionArgs, args);
}

/** Build an unsigned `stake-update-pooled` transaction. */
export async function buildStakeUpdatePooledTx(
  args: BuildStakeUpdatePooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [splitContractPrincipal(args.poolOwner)];

  if (args.increaseBy !== undefined) {
    functionArgs.push(someCV(uintCV(args.increaseBy)));
  } else {
    functionArgs.push(noneCV());
  }

  return callPox5('stake-update-pooled', functionArgs, args);
}

// ---------------------------------------------------------------------------
// Signer key grants
// ---------------------------------------------------------------------------

/** Build an unsigned `grant-signer-key` transaction. */
export async function buildGrantSignerKeyTx(
  args: BuildGrantSignerKeyTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'grant-signer-key',
    [
      bufferCV(hexToBytes(args.signerKey)),
      principalCV(args.staker),
      args.poxAddress ? someCV(toPoxTuple(args.poxAddress)) : noneCV(),
      uintCV(args.authId),
      bufferCV(hexToBytes(args.signerSignature)),
    ],
    args
  );
}

/** Build an unsigned `revoke-signer-key` transaction. */
export async function buildRevokeSignerKeyTx(
  args: BuildRevokeSignerKeyTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'revoke-signer-key',
    [principalCV(args.staker), bufferCV(hexToBytes(args.signerKey))],
    args
  );
}

// ---------------------------------------------------------------------------
// Pool registration
// ---------------------------------------------------------------------------

/** Build an unsigned `register-pool` transaction. */
export async function buildRegisterPoolTx(
  args: BuildRegisterPoolTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'register-pool',
    [
      splitContractPrincipal(args.poolOwnerContract),
      bufferCV(hexToBytes(args.signerKey)),
      toPoxTuple(args.poxAddress),
      bufferCV(hexToBytes(args.signerSignature)),
      uintCV(args.authId),
    ],
    args
  );
}

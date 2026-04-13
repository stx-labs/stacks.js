import { hexToBytes } from '@stacks/common';
import {
  Cl,
  type ClarityValue,
  type StacksTransactionWire,
  makeUnsignedContractCall,
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
  return sig ? Cl.some(Cl.bufferFromHex(sig)) : Cl.none();
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
      Cl.uint(args.amountUstx),
      toPoxTuple(args.poxAddress),
      Cl.uint(args.startBurnHt),
      Cl.uint(args.numCycles),
      optionalSigCV(args.signerSignature),
      Cl.bufferFromHex(args.signerKey),
      Cl.uint(args.maxAmount),
      Cl.uint(args.authId),
      Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
    ],
    args
  );
}

/** Build an unsigned `stake-extend` transaction (solo — extend during last cycle). */
export async function buildStakeExtendTx(
  args: BuildStakeExtendTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [
    Cl.uint(args.numCycles),
    Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
    toPoxTuple(args.poxAddress),
    optionalSigCV(args.signerSignature),
    Cl.bufferFromHex(args.signerKey),
    Cl.uint(args.maxAmount),
    Cl.uint(args.authId),
  ];

  if (args.amountUstx !== undefined) {
    functionArgs.push(Cl.some(Cl.uint(args.amountUstx)));
  } else {
    functionArgs.push(Cl.none());
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
    Cl.bufferFromHex(args.signerKey),
    Cl.uint(args.maxAmount),
    Cl.uint(args.authId),
  ];

  if (args.increaseBy !== undefined) {
    functionArgs.push(Cl.some(Cl.uint(args.increaseBy)));
  } else {
    functionArgs.push(Cl.none());
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
      Cl.uint(args.amountUstx),
      Cl.uint(args.numCycles),
      Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
      Cl.uint(args.startBurnHt),
      Cl.address(args.poolOwner),
    ],
    args
  );
}

/** Build an unsigned `stake-extend-pooled` transaction. */
export async function buildStakeExtendPooledTx(
  args: BuildStakeExtendPooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [
    Cl.uint(args.numCycles),
    Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
    Cl.address(args.poolOwner),
  ];

  if (args.amountUstx !== undefined) {
    functionArgs.push(Cl.some(Cl.uint(args.amountUstx)));
  } else {
    functionArgs.push(Cl.none());
  }

  return callPox5('stake-extend-pooled', functionArgs, args);
}

/** Build an unsigned `stake-update-pooled` transaction. */
export async function buildStakeUpdatePooledTx(
  args: BuildStakeUpdatePooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  const functionArgs: ClarityValue[] = [Cl.address(args.poolOwner)];

  if (args.increaseBy !== undefined) {
    functionArgs.push(Cl.some(Cl.uint(args.increaseBy)));
  } else {
    functionArgs.push(Cl.none());
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
      Cl.bufferFromHex(args.signerKey),
      Cl.address(args.staker),
      args.poxAddress ? Cl.some(toPoxTuple(args.poxAddress)) : Cl.none(),
      Cl.uint(args.authId),
      Cl.bufferFromHex(args.signerSignature),
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
    [Cl.address(args.staker), Cl.bufferFromHex(args.signerKey)],
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
      Cl.address(args.poolOwnerContract),
      Cl.bufferFromHex(args.signerKey),
      toPoxTuple(args.poxAddress),
      Cl.bufferFromHex(args.signerSignature),
      Cl.uint(args.authId),
    ],
    args
  );
}

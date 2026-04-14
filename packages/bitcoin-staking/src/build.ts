import { hexToBytes } from '@stacks/common';
import {
  Cl,
  type ClarityValue,
  type StacksTransactionWire,
  makeUnsignedContractCall,
} from '@stacks/transactions';
import { BtcAddress } from '.';
import { CONTRACT_ADDRESS, CONTRACT_NAME } from './constants';
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

/** @ignore */
function normalizeUnlockBytes(unlockBytes: Uint8Array | string): Uint8Array {
  return typeof unlockBytes === 'string' ? hexToBytes(unlockBytes) : unlockBytes;
}

/** @ignore */
function clOptionalBuffer(hex?: string): ClarityValue {
  return hex ? Cl.some(Cl.bufferFromHex(hex)) : Cl.none();
}

/** @ignore */
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
      BtcAddress.toPoxTuple(args.poxAddress),
      Cl.uint(args.startBurnHt),
      clOptionalBuffer(args.signerSignature),
      Cl.bufferFromHex(args.signerKey),
      Cl.uint(args.maxAmount),
      Cl.uint(args.authId),
      Cl.uint(args.numCycles),
      Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
    ],
    args
  );
}

/** Build an unsigned `stake-extend` transaction (solo — extend during last cycle). */
export async function buildStakeExtendTx(
  args: BuildStakeExtendTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-extend',
    [
      Cl.uint(args.amountUstx),
      BtcAddress.toPoxTuple(args.poxAddress),
      clOptionalBuffer(args.signerSignature),
      Cl.bufferFromHex(args.signerKey),
      Cl.uint(args.maxAmount),
      Cl.uint(args.authId),
      Cl.uint(args.numCycles),
      Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
    ],
    args
  );
}

/** Build an unsigned `stake-update` transaction (solo — change signer/address/increase mid-stake). */
export async function buildStakeUpdateTx(
  args: BuildStakeUpdateTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-update',
    [
      Cl.uint(args.amountUstxIncrease),
      BtcAddress.toPoxTuple(args.poxAddress),
      Cl.bufferFromHex(args.signerKey),
      clOptionalBuffer(args.signerSignature),
      Cl.uint(args.maxAmount),
      Cl.uint(args.authId),
    ],
    args
  );
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
      Cl.address(args.poolOwner),
      Cl.uint(args.amountUstx),
      Cl.uint(args.numCycles),
      Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
      Cl.uint(args.startBurnHt),
    ],
    args
  );
}

/** Build an unsigned `stake-extend-pooled` transaction. */
export async function buildStakeExtendPooledTx(
  args: BuildStakeExtendPooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-extend-pooled',
    [
      Cl.address(args.poolOwner),
      Cl.uint(args.amountUstx),
      Cl.uint(args.numCycles),
      Cl.buffer(normalizeUnlockBytes(args.unlockBytes)),
    ],
    args
  );
}

/** Build an unsigned `stake-update-pooled` transaction. */
export async function buildStakeUpdatePooledTx(
  args: BuildStakeUpdatePooledTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'stake-update-pooled',
    [Cl.address(args.poolOwner), Cl.uint(args.amountUstxIncrease)],
    args
  );
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
      args.poxAddress ? Cl.some(BtcAddress.toPoxTuple(args.poxAddress)) : Cl.none(),
      Cl.uint(args.authId),
      Cl.bufferFromHex(args.signerSignature),
    ],
    args
  );
}

/** Build an unsigned `revoke-signer-grant` transaction. */
export async function buildRevokeSignerKeyTx(
  args: BuildRevokeSignerKeyTxArgs & TxParams
): Promise<StacksTransactionWire> {
  return callPox5(
    'revoke-signer-grant',
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
      BtcAddress.toPoxTuple(args.poxAddress),
      Cl.bufferFromHex(args.signerSignature),
      Cl.uint(args.authId),
    ],
    args
  );
}

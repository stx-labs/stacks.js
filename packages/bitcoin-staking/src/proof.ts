import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, equals, hexToBytes } from '@stacks/common';
import { computeP2wshOutputScript } from './script';
import type { BondL1LockupOutput } from './types';

// ---------------------------------------------------------------------------
// BTC SPV proof normalization helpers
// ---------------------------------------------------------------------------

/** Hard cap from the contract: `(buff 100000)`. */
const MAX_TX_BYTES = 100_000;

/**
 * @internal @ignore
 * Normalize a raw Bitcoin transaction to bytes. Accepts either hex or
 * `Uint8Array`. Enforces the contract's 100,000-byte cap.
 */
export function serializeBitcoinTx(tx: Uint8Array | string): Uint8Array {
  const bytes = typeof tx === 'string' ? hexToBytes(tx) : tx;
  if (bytes.length > MAX_TX_BYTES) {
    throw new Error(
      `serializeBitcoinTx: tx is ${bytes.length} bytes; exceeds the ${MAX_TX_BYTES}-byte contract cap`
    );
  }
  return bytes;
}

/**
 * @internal @ignore
 * Normalize an 80-byte Bitcoin block header. Accepts either hex or
 * `Uint8Array`. Throws if the length is not exactly 80.
 */
export function serializeBitcoinHeader(header: Uint8Array | string): Uint8Array {
  const bytes = typeof header === 'string' ? hexToBytes(header) : header;
  if (bytes.length !== 80) {
    throw new Error(`serializeBitcoinHeader: expected 80 bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * @internal @ignore
 * Compute the Bitcoin txid in BIG-ENDIAN (display) order — i.e. the
 * double-sha256 of the raw tx, then byte-reversed.
 *
 * Mirrors `get-reversed-txid` in the contract (which returns the
 * little-endian / "internal" form `sha256(sha256(tx))`); this helper returns
 * the reversed form because that's what block explorers and most external
 * tools expect. Reverse the result if you need the contract's
 * `get-reversed-txid` value.
 */
export function computeBitcoinTxid(rawTx: Uint8Array): Uint8Array {
  // Reverse to big-endian display form.
  return reverse32(sha256(sha256(rawTx)));
}

/** @internal @ignore Byte-reverse a 32-byte hash (display ⇄ internal little-endian). */
function reverse32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
  return out;
}

/** @internal @ignore `[0, 1, …, n-1]` (like Python's `range(n)`). */
function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * Indexer merkle-proof response, as returned by Esplora-compatible APIs
 * (`GET /tx/:txid/merkle-proof` on Blockstream / mempool.space). `merkle` holds
 * the sibling hashes in **display (big-endian)** order — {@link buildLockProof}
 * reverses them to the internal little-endian form the contract expects.
 */
export interface EsploraMerkleProof {
  /** BTC block height containing the tx. */
  block_height: number;
  /** Sibling hashes (display/big-endian hex) along the path leaf → root, bottom-up. */
  merkle: string[];
  /** 0-indexed position of the tx within the block. */
  pos: number;
}

/**
 * Normalize a set of already-fetched indexer responses into the
 * {@link BondL1LockupOutput} tuple `register-for-bond` expects for one L1
 * lockup output. Pure — performs no network I/O; the caller fetches.
 *
 * This deliberately stops short of *building* a proof (parsing a raw block,
 * rebuilding the merkle tree): an Esplora-compatible indexer already does that.
 * What it does absorb are the two transformations that silently produce
 * `ERR_INVALID_MERKLE_PROOF` / `ERR_READ_TX_OUT_OF_BOUNDS` when done by hand:
 *
 * 1. **Witness stripping.** `txHex` from `GET /tx/:txid/hex` is the segwit
 *    serialization (it hashes to the `wtxid`, which is *not* in the merkle
 *    tree). The witness is removed via `@scure/btc-signer` so the stored bytes
 *    are the legacy serialization that hashes to the txid.
 * 2. **Endianness.** Indexer sibling hashes are display/big-endian; the
 *    contract folds over internal little-endian hashes. Each is reversed.
 *
 * The lockup output is located by matching `expectedScript` (the P2WSH
 * `scriptPubKey` from {@link buildLockOutputScript}) against the tx's
 * outputs — the same equality the contract asserts — and its sats `amount` is
 * read from the decoded output, so a stale caller-supplied amount can't drift.
 *
 * @example
 * ```ts
 * const expectedScript = buildLockOutputScript({ stxAddress, unlockHeight, unlockBytes, earlyUnlockBytes });
 * const output = buildLockProof({
 *   txHex: await (await fetch(`${esplora}/tx/${txid}/hex`)).text(),
 *   header: await (await fetch(`${esplora}/block/${blockHash}/header`)).text(),
 *   merkleProof: await (await fetch(`${esplora}/tx/${txid}/merkle-proof`)).json(),
 *   txCount: (await (await fetch(`${esplora}/block/${blockHash}`)).json()).tx_count,
 *   expectedScript, // or: lockScript: meta.lockScript (from buildRegisterMetadata)
 * });
 * // → buildRegisterForBond({ lockup: { kind: 'btc', outputs: [output], unlockBytes }, ... })
 * ```
 */
/**
 * How to locate the lockup output: by the P2WSH `scriptPubKey` directly
 * (`expectedScript`, 34 bytes) or by the witness `lockScript` it commits to
 * (converted internally via {@link computeP2wshOutputScript}). Provide exactly
 * one. `lockScript` is what {@link buildRegisterMetadata} returns, so the
 * common path is `{ ...proof, lockScript: meta.lockScript }`.
 */
export type ExpectedScriptInput =
  | { expectedScript: Uint8Array | string; lockScript?: never }
  | { lockScript: Uint8Array | string; expectedScript?: never };

/** @internal @ignore Resolve {@link ExpectedScriptInput} to the P2WSH scriptPubKey bytes. */
function resolveExpectedScript(input: {
  expectedScript?: Uint8Array | string;
  lockScript?: Uint8Array | string;
}): Uint8Array {
  if (input.expectedScript !== undefined) {
    return typeof input.expectedScript === 'string'
      ? hexToBytes(input.expectedScript)
      : input.expectedScript;
  }
  if (input.lockScript !== undefined) {
    const script =
      typeof input.lockScript === 'string' ? hexToBytes(input.lockScript) : input.lockScript;
    return computeP2wshOutputScript(script);
  }
  throw new Error(
    'buildLockProof: provide either `expectedScript` (P2WSH scriptPubKey) or `lockScript` (witness script)'
  );
}

export function buildLockProof(
  input: {
    /** Raw tx hex (`GET /tx/:txid/hex`). May be segwit-serialized; the witness is stripped. */
    txHex: string;
    /** 80-byte block header (`GET /block/:hash/header`), hex or bytes. */
    header: Uint8Array | string;
    /** Esplora-compatible merkle-proof response (`GET /tx/:txid/merkle-proof`). */
    merkleProof: EsploraMerkleProof;
    /** Total tx count in the block (`GET /block/:hash` → `tx_count`). */
    txCount: number;
  } & ExpectedScriptInput
): BondL1LockupOutput {
  const tx = btc.Transaction.fromRaw(hexToBytes(input.txHex), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  // (withScriptSig, withWitness=false) → legacy bytes that hash to the txid.
  const legacy = tx.toBytes(true, false);

  const expectedScript = resolveExpectedScript(input);

  const outputIndex = range(tx.outputsLength).findIndex(i => {
    const out = tx.getOutput(i);
    return out.script && equals(out.script, expectedScript);
  });
  if (outputIndex === -1) {
    throw new Error('buildLockProof: no output matches the expected lockup script');
  }

  return {
    height: input.merkleProof.block_height,
    tx: serializeBitcoinTx(legacy),
    outputIndex,
    header: serializeBitcoinHeader(input.header),
    leafHashes: input.merkleProof.merkle.map(h => reverse32(hexToBytes(h))),
    txCount: input.txCount,
    txIndex: input.merkleProof.pos,
    amount: tx.getOutput(outputIndex).amount ?? 0n,
  };
}

/**
 * @internal @ignore
 * Compute the merkle branch — the sibling hashes from leaf → root, bottom-up —
 * for the tx at `pos` in a block whose ordered txid list is `txids` (display/
 * big-endian hex, e.g. bitcoind `getblock` verbosity 1's `tx` array). Returns
 * the siblings in **display order**, exactly the shape of
 * {@link EsploraMerkleProof.merkle}, so it's a drop-in replacement for the
 * `merkle` field when no Esplora `/merkle-proof` endpoint is available.
 *
 * Standard Bitcoin merkle construction, folded over internal little-endian
 * hashes (hence the reversals): odd rows duplicate their last node, and each
 * parent is `sha256(sha256(left ‖ right))`. The sibling encountered at each
 * level along the path to the root *is* the proof.
 */
export function computeMerkleBranch(txids: string[], pos: number): string[] {
  if (pos < 0 || pos >= txids.length) {
    throw new Error(`computeMerkleBranch: pos ${pos} out of range (0..${txids.length - 1})`);
  }
  let level = txids.map(id => reverse32(hexToBytes(id))); // display → internal
  let index = pos;
  const siblings: Uint8Array[] = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]); // duplicate last
    siblings.push(level[index ^ 1]);
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256(sha256(concatBytes(level[i], level[i + 1]))));
    }
    level = next;
    index = Math.floor(index / 2);
  }
  return siblings.map(s => bytesToHex(reverse32(s))); // internal → display
}

/**
 * {@link buildLockProof} for callers WITHOUT an Esplora `/merkle-proof`
 * endpoint — e.g. driving bitcoind directly. Given the block's ordered txid
 * list (`getblock` verbosity 1 → `tx`), it derives the tx's position, rebuilds
 * the merkle branch ({@link computeMerkleBranch}), and reads `txCount` from the
 * list, then delegates to {@link buildLockProof} (so witness-stripping,
 * output matching, and endianness are all the same single implementation).
 *
 * The tx's position is found by hashing `txHex` to its txid (witness stripped,
 * so it matches the block's txid list) rather than trusting a caller-supplied
 * index.
 *
 * @example
 * ```ts
 * const block = await rpc('getblock', [blockHash, 1]); // { height, tx, nTx }
 * const output = buildLockProofFromBlock({
 *   txHex: (await rpc('gettransaction', [txid, null, true])).hex,
 *   header: await rpc('getblockheader', [blockHash, false]),
 *   blockHeight: block.height,
 *   txids: block.tx,
 *   expectedScript: buildLockOutputScript({ ... }),
 * });
 * ```
 */
export function buildLockProofFromBlock(
  input: {
    /** Raw tx hex (segwit serialization is fine; the witness is stripped). */
    txHex: string;
    /** 80-byte block header, hex or bytes. */
    header: Uint8Array | string;
    /** Height of the block containing the tx. */
    blockHeight: number;
    /** Block's ordered txid list (display/big-endian hex), `getblock` v1 `tx`. */
    txids: string[];
  } & ExpectedScriptInput
): BondL1LockupOutput {
  const tx = btc.Transaction.fromRaw(hexToBytes(input.txHex), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  const txid = bytesToHex(computeBitcoinTxid(tx.toBytes(true, false)));
  const pos = input.txids.indexOf(txid);
  if (pos === -1) {
    throw new Error(`buildLockProofFromBlock: txid ${txid} not found in the block's txids`);
  }

  return buildLockProof({
    txHex: input.txHex,
    header: input.header,
    txCount: input.txids.length,
    // Resolve here so the lockScript/expectedScript overload is handled once.
    expectedScript: resolveExpectedScript(input),
    merkleProof: {
      block_height: input.blockHeight,
      merkle: computeMerkleBranch(input.txids, pos),
      pos,
    },
  });
}

import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, equals, hexToBytes, intToBigInt } from '@stacks/common';
import type { IntegerType } from '@stacks/common';
import { scriptToWshOutput } from './script';
import type { BondL1LockupOutput } from './types';

/** Hard cap from the contract: `(buff 100000)`. */
const MAX_TX_BYTES = 100_000;

/**
 * @internal
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
 * @internal
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
 * @internal
 * Compute the Bitcoin txid in BIG-ENDIAN (display) order — i.e. the
 * double-sha256 of the raw tx, then byte-reversed.
 *
 * Mirrors `pox-5.get-reversed-txid` (which returns the
 * little-endian / "internal" form `sha256(sha256(tx))`); this helper returns
 * the reversed form because that's what block explorers and most external
 * tools expect. Reverse the result if you need the contract's
 * `get-reversed-txid` value.
 */
export function computeBitcoinTxid(rawTx: Uint8Array): Uint8Array {
  // Reverse to big-endian display form.
  return reverse32(sha256(sha256(rawTx)));
}

/** @internal Byte-reverse a 32-byte hash (display <-> internal little-endian). */
function reverse32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
  return out;
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
  /** Sibling hashes (display/big-endian hex) along the path leaf -> root, bottom-up. */
  merkle: string[];
  /** 0-indexed position of the tx within the block. */
  pos: number;
}

/**
 * How to locate the lockup output: by the P2WSH `scriptPubKey` directly
 * (`outputScript`, 34 bytes) or by the witness `lockScript` it commits to
 * (converted internally to its P2WSH form). Provide exactly
 * one. `lockScript` is what {@link buildRegisterMetadata} returns, so the
 * common path is `{ ...proof, lockScript: meta.lockScript }`.
 */
export type ExpectedScriptInput =
  | { outputScript: Uint8Array | string; lockScript?: never }
  | { lockScript: Uint8Array | string; outputScript?: never };

/** @internal Resolve {@link ExpectedScriptInput} to the P2WSH scriptPubKey bytes. */
function resolveExpectedScript(input: {
  outputScript?: Uint8Array | string;
  lockScript?: Uint8Array | string;
}): Uint8Array {
  if (input.outputScript !== undefined) {
    return typeof input.outputScript === 'string'
      ? hexToBytes(input.outputScript)
      : input.outputScript;
  }
  if (input.lockScript !== undefined) {
    const script =
      typeof input.lockScript === 'string' ? hexToBytes(input.lockScript) : input.lockScript;
    return scriptToWshOutput(script);
  }
  throw new Error(
    'buildLockProof: provide either `outputScript` (P2WSH scriptPubKey) or `lockScript` (witness script)'
  );
}

/** @internal `[0, 1, …, n-1]` (like Python's `range(n)`). */
function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Contract cap on the merkle branch: `(list 14 (buff 32))` (blocks <= 16,384 txs). */
const MAX_LEAF_HASHES = 14;

/**
 * @internal
 * Fold a leaf hash up its sibling path to the merkle root, all in internal
 * little-endian form. Mirrors the contract's per-level fold: bit `i` of `index`
 * picks the side (`1` -> sibling on the left), each parent is
 * `sha256(sha256(left || right))`.
 */
function foldMerkleBranch(leaf: Uint8Array, siblings: Uint8Array[], index: number): Uint8Array {
  let hash = leaf;
  siblings.forEach((sibling, i) => {
    hash =
      (index >> i) & 1
        ? sha256(sha256(concatBytes(sibling, hash)))
        : sha256(sha256(concatBytes(hash, sibling)));
  });
  return hash;
}

/**
 * @internal
 * Validate an assembled proof against itself before it is submitted on-chain:
 * a proof failing any of these is guaranteed to abort `register-for-bond`
 * (burning the tx fee), so fail fast client-side instead.
 *
 * - `txIndex` within `txCount`, and the branch length is `ceil(log2(txCount))`
 *   (the two come from independent indexer endpoints on the Esplora path);
 * - at most 14 siblings of exactly 32 bytes (the contract's `(list 14 (buff 32))`);
 * - the branch folds from the txid back to the header's merkle root
 *   (header bytes 36..68).
 */
function validateLockProof(opts: {
  legacyTx: Uint8Array;
  header: Uint8Array;
  leafHashes: Uint8Array[];
  txCount: number;
  txIndex: number;
}): void {
  const { legacyTx, header, leafHashes, txCount, txIndex } = opts;

  if (!Number.isInteger(txCount) || txCount < 1) {
    throw new Error(`buildLockProof: invalid txCount ${txCount}`);
  }
  if (!Number.isInteger(txIndex) || txIndex < 0 || txIndex >= txCount) {
    throw new Error(`buildLockProof: txIndex ${txIndex} out of range (txCount ${txCount})`);
  }
  for (const hash of leafHashes) {
    if (hash.length !== 32) {
      throw new Error(`buildLockProof: merkle sibling is ${hash.length} bytes, expected 32`);
    }
  }
  if (leafHashes.length > MAX_LEAF_HASHES) {
    throw new Error(
      `buildLockProof: merkle branch has ${leafHashes.length} siblings; the contract accepts at most ${MAX_LEAF_HASHES}`
    );
  }
  // Tree depth must match the block's tx count (integer-safe ceil-log2).
  let expectedDepth = 0;
  while (1 << expectedDepth < txCount) expectedDepth++;
  if (leafHashes.length !== expectedDepth) {
    throw new Error(
      `buildLockProof: merkle branch depth ${leafHashes.length} does not match txCount ${txCount} (expected ${expectedDepth})`
    );
  }

  // Decisive check: fold the branch from the txid back to the header's root.
  const leaf = sha256(sha256(legacyTx)); // internal little-endian txid
  const root = foldMerkleBranch(leaf, leafHashes, txIndex);
  if (!equals(root, header.slice(36, 68))) {
    throw new Error(
      'buildLockProof: merkle branch does not fold to the header merkle root — ' +
        'the proof would be rejected on-chain (stale or inconsistent indexer data?)'
    );
  }
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
 * The lockup output is located by matching `outputScript` (the P2WSH
 * `scriptPubKey` from {@link buildLockOutputScript}) against the tx's
 * outputs — the same equality the contract asserts — and its sats `amount` is
 * read from the decoded output, so a stale caller-supplied amount can't drift.
 *
 * @example
 * ```ts
 * // Happy path: locate the output via the witness `lockScript` that
 * // `buildRegisterMetadata` already gave you.
 * const output = buildLockProof({
 *   txHex: await (await fetch(`${esplora}/tx/${txid}/hex`)).text(),
 *   header: await (await fetch(`${esplora}/block/${blockHash}/header`)).text(),
 *   merkleProof: await (await fetch(`${esplora}/tx/${txid}/merkle-proof`)).json(),
 *   txCount: (await (await fetch(`${esplora}/block/${blockHash}`)).json()).tx_count,
 *   unlockHeight: meta.unlockHeight,
 *   lockScript: meta.lockScript, // from buildRegisterMetadata
 * });
 * // -> buildRegisterForBond({ lockup: { kind: 'btc', outputs: [output], unlockBytes }, ... })
 * ```
 *
 * @example
 * ```ts
 * // Alternative: locate the output via the P2WSH `outputScript` directly.
 * const output = buildLockProof({
 *   txHex, header, merkleProof, txCount, unlockHeight,
 *   outputScript: buildLockOutputScript({ stxAddress, unlockHeight, unlockBytes, earlyUnlockBytes }),
 * });
 * ```
 */
export function buildLockProof(
  input: {
    /** Raw tx hex (`GET /tx/:txid/hex`). May be segwit-serialized; the witness is stripped. */
    txHex: string;
    /** 80-byte block header (`GET /block/:hash/header`), hex or bytes. */
    header: Uint8Array | string;
    /** Esplora-compatible merkle-proof response (`GET /tx/:txid/merkle-proof`). */
    merkleProof: EsploraMerkleProof;
    /** Total tx count in the block (`GET /block/:hash` -> `tx_count`). */
    txCount: number;
    /**
     * Absolute CLTV height the lockup script commits to — the same
     * `unlockHeight` passed to {@link buildLockOutputScript} when deriving the
     * `outputScript` / `lockScript`. Recorded in the output tuple so the
     * contract can re-derive the expected script and enforce the bond's
     * minimum unlock height.
     */
    unlockHeight: IntegerType;
    /**
     * Which output to prove, when the funding tx pays the lockup script more
     * than once. Omit for the common single-output case; a tx with several
     * matching outputs is rejected rather than proving the first, since the
     * contract dedupes on the whole `{txid, output-index}` outpoint and each
     * output needs its own tuple.
     */
    outputIndex?: number;
  } & ExpectedScriptInput
): BondL1LockupOutput {
  const tx = btc.Transaction.fromRaw(hexToBytes(input.txHex), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  // (withScriptSig, withWitness=false) -> legacy bytes that hash to the txid.
  const legacy = tx.toBytes(true, false);

  const expectedScript = resolveExpectedScript(input);
  const matching = range(tx.outputsLength).filter(i => {
    const out = tx.getOutput(i);
    return out.script && equals(out.script, expectedScript);
  });

  const outputIndex = input.outputIndex ?? matching[0];
  if (matching.length === 0) {
    throw new Error('buildLockProof: no output matches the expected lockup script');
  }
  if (input.outputIndex === undefined && matching.length > 1) {
    throw new Error(
      `buildLockProof: outputs ${matching.join(', ')} all pay the lockup script — pass \`outputIndex\` to pick one (each needs its own proof tuple)`
    );
  }
  if (!matching.includes(outputIndex)) {
    throw new Error(
      `buildLockProof: output ${outputIndex} does not pay the lockup script (matching: ${matching.join(', ') || 'none'})`
    );
  }

  const header = serializeBitcoinHeader(input.header);
  const leafHashes = input.merkleProof.merkle.map(h => reverse32(hexToBytes(h)));
  validateLockProof({
    legacyTx: legacy,
    header,
    leafHashes,
    txCount: input.txCount,
    txIndex: input.merkleProof.pos,
  });

  const amount = tx.getOutput(outputIndex).amount;
  if (amount === undefined) {
    throw new Error('buildLockProof: matched output has no decodable amount');
  }

  return {
    height: input.merkleProof.block_height,
    tx: serializeBitcoinTx(legacy),
    outputIndex,
    header,
    leafHashes,
    txCount: input.txCount,
    txIndex: input.merkleProof.pos,
    amount,
    unlockBurnHeight: Number(intToBigInt(input.unlockHeight)),
  };
}

/**
 * @internal
 * Compute the merkle branch — the sibling hashes from leaf -> root, bottom-up —
 * for the tx at `pos` in a block whose ordered txid list is `txids` (display/
 * big-endian hex, e.g. bitcoind `getblock` verbosity 1's `tx` array). Returns
 * the siblings in **display order**, exactly the shape of
 * {@link EsploraMerkleProof.merkle}, so it's a drop-in replacement for the
 * `merkle` field when no Esplora `/merkle-proof` endpoint is available.
 *
 * Standard Bitcoin merkle construction, folded over internal little-endian
 * hashes (hence the reversals): odd rows duplicate their last node, and each
 * parent is `sha256(sha256(left || right))`. The sibling encountered at each
 * level along the path to the root *is* the proof.
 */
export function computeMerkleBranch(txids: string[], pos: number): string[] {
  if (pos < 0 || pos >= txids.length) {
    throw new Error(`computeMerkleBranch: pos ${pos} out of range (0..${txids.length - 1})`);
  }
  const leaves = txids.map(id => reverse32(hexToBytes(id))); // display -> internal
  return merkleSiblings(leaves, pos).map(s => bytesToHex(reverse32(s))); // internal -> display
}

/**
 * @internal Sibling hash at each level from leaf -> root for the node at
 * `index`. Standard Bitcoin merkle climb: odd levels duplicate their last node,
 * each parent is `sha256(sha256(left || right))`.
 */
function merkleSiblings(level: Uint8Array[], index: number): Uint8Array[] {
  if (level.length <= 1) return [];
  const padded = level.length % 2 === 1 ? [...level, level[level.length - 1]] : level;
  const parents = range(padded.length / 2).map(i =>
    sha256(sha256(concatBytes(padded[2 * i], padded[2 * i + 1])))
  );
  return [padded[index ^ 1], ...merkleSiblings(parents, index >> 1)];
}

/**
 * {@link buildLockProof} for callers WITHOUT an Esplora `/merkle-proof`
 * endpoint — e.g. driving bitcoind directly. Given the block's ordered txid
 * list (`getblock` verbosity 1 -> `tx`), it derives the tx's position, rebuilds
 * the merkle branch, and reads `txCount` from the
 * list, then delegates to {@link buildLockProof} (so witness-stripping,
 * output matching, and endianness are all the same single implementation).
 *
 * The tx's position is found by hashing `txHex` to its txid (witness stripped,
 * so it matches the block's txid list) rather than trusting a caller-supplied
 * index.
 *
 * @example
 * ```ts
 * // Happy path: locate the output via the witness `lockScript`.
 * const block = await rpc('getblock', [blockHash, 1]); // { height, tx, nTx }
 * const output = buildLockProofFromBlock({
 *   txHex: (await rpc('gettransaction', [txid, null, true])).hex,
 *   header: await rpc('getblockheader', [blockHash, false]),
 *   blockHeight: block.height,
 *   txids: block.tx,
 *   unlockHeight: meta.unlockHeight,
 *   lockScript: meta.lockScript, // from buildRegisterMetadata
 * });
 * ```
 *
 * @example
 * ```ts
 * // Alternative: locate the output via the P2WSH `outputScript` directly.
 * const output = buildLockProofFromBlock({
 *   txHex, header, blockHeight, txids, unlockHeight,
 *   outputScript: buildLockOutputScript({ stxAddress, unlockHeight, unlockBytes, earlyUnlockBytes }),
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
    /**
     * Absolute CLTV height the lockup script commits to — the same
     * `unlockHeight` passed to {@link buildLockOutputScript}. Forwarded to
     * {@link buildLockProof} and recorded in the output tuple.
     */
    unlockHeight: IntegerType;
    /** Which output to prove — see {@link buildLockProof}. */
    outputIndex?: number;
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
    unlockHeight: input.unlockHeight,
    outputIndex: input.outputIndex,
    // Resolve here so the lockScript/outputScript overload is handled once.
    outputScript: resolveExpectedScript(input),
    merkleProof: {
      block_height: input.blockHeight,
      merkle: computeMerkleBranch(input.txids, pos),
      pos,
    },
  });
}

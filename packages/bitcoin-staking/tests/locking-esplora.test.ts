/**
 * Live-Esplora test for `buildLockProof` (the Esplora-shaped proof path,
 * the counterpart to `buildLockProofFromBlock` which the regtest L1 action
 * exercises via bitcoind RPC).
 *
 * It hits the public Blockstream Esplora API with a stable, deeply-confirmed
 * mainnet tx and feeds the responses straight into `buildLockProof`, then
 * VALIDATES the result by folding the assembled merkle branch back to a root and
 * comparing it to the block's `merkle_root`. If they match, the Esplora →
 * `BondL1LockupOutput` normalization (witness stripping, endianness, output
 * matching) is correct — the same thing the pox-5 contract folds over.
 *
 * Gated by `LIVE_ESPLORA=1` (external network), so it's skipped in normal/CI
 * runs. We disable jest-fetch-mock for this file so the calls hit the real API.
 *
 *   LIVE_ESPLORA=1 npx jest tests/locking.esplora --runInBand --collectCoverage=false
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import fetchMock from 'jest-fetch-mock';
import { buildLockProof, type EsploraMerkleProof } from '../src';

const LIVE = process.env.LIVE_ESPLORA === '1';
const runIf = LIVE ? test : test.skip;

const ESPLORA = process.env.ESPLORA_API ?? 'https://blockstream.info/api';

// A stable, deeply-confirmed mainnet tx (the 2010 "pizza" tx). Legacy (no
// witness), so witness-stripping is a no-op here — fine for proving the merkle
// assembly. Its block has many txs, so siblings are exercised.
const TXID = 'a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d';

const toBytes = (b: Uint8Array | string): Uint8Array => (typeof b === 'string' ? hexToBytes(b) : b);
const dsha256 = (b: Uint8Array): Uint8Array => sha256(sha256(b));
const reverse32 = (b: Uint8Array): Uint8Array => Uint8Array.from(b).reverse();

/** Fold the assembled (internal-order) branch back to a display-order root. */
function foldToRoot(internalLeaf: Uint8Array, internalSiblings: Uint8Array[], pos: number): string {
  let h = internalLeaf;
  let index = pos;
  for (const sib of internalSiblings) {
    h =
      index % 2 === 0
        ? dsha256(new Uint8Array([...h, ...sib]))
        : dsha256(new Uint8Array([...sib, ...h]));
    index = Math.floor(index / 2);
  }
  return bytesToHex(reverse32(h));
}

const getText = async (path: string): Promise<string> => {
  const res = await fetch(`${ESPLORA}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.text();
};
const getJson = async <T>(path: string): Promise<T> => JSON.parse(await getText(path)) as T;

jest.setTimeout(60_000);

beforeAll(() => {
  if (LIVE) fetchMock.disableMocks(); // hit the real Esplora API
});
afterAll(() => {
  if (LIVE) fetchMock.enableMocks();
});

runIf('buildLockProof (Esplora): folds back to the block merkle root', async () => {
  const txHex = await getText(`/tx/${TXID}/hex`);
  const merkleProof = await getJson<EsploraMerkleProof>(`/tx/${TXID}/merkle-proof`);
  const tx = await getJson<{
    status: { block_hash: string };
    vout: { scriptpubkey: string; value: number }[];
  }>(`/tx/${TXID}`);
  const blockHash = tx.status.block_hash;
  const header = await getText(`/block/${blockHash}/header`);
  const block = await getJson<{ merkle_root: string; tx_count: number }>(`/block/${blockHash}`);

  // Use the tx's first output's real scriptPubKey as the "expected" lockup
  // script so buildLockProof locates it (the value/script come back out).
  const expectedScript = tx.vout[0].scriptpubkey;

  const output = buildLockProof({
    txHex,
    header,
    merkleProof,
    txCount: block.tx_count,
    unlockHeight: 850_000,
    expectedScript,
  });

  expect(output.height).toBe(merkleProof.block_height);
  expect(output.txIndex).toBe(merkleProof.pos);
  expect(output.amount).toBe(BigInt(tx.vout[0].value));

  // The decisive check: fold the assembled branch (internal order) from the tx's
  // internal txid back to the root and compare to the block's merkle_root.
  const internalLeaf = dsha256(toBytes(output.tx)); // output.tx is the legacy (txid) serialization
  const root = foldToRoot(internalLeaf, output.leafHashes.map(toBytes), output.txIndex);
  expect(root).toBe(block.merkle_root);
});

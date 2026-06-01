/**
 * Validates the RPC-only SPV merkle-proof assembly (`computeMerkleBranch` /
 * `getRpcMerkleProof` in `tests/helpers/btc.ts`) — the substitute for a local
 * Esplora that feeds the SDK's `assembleLockupProof` on the L1 register-for-bond
 * path.
 *
 * The check is self-contained and contract-independent: for a real regtest
 * block, recompute each tx's merkle branch from the block's ordered txid list,
 * then FOLD the branch back to a root and compare it to the block header's
 * `merkleroot`. If they match, the branch (and its endianness/ordering) is
 * correct — which is exactly what the pox-5 contract folds over.
 *
 * Recent regtest blocks contain the coinbase plus the stacks miner's L1
 * block-commit tx, so siblings are exercised without funding a wallet or mining
 * manually (which would fight the env's auto-miner). Live-only (`RECORD=1`):
 * talks straight to bitcoind, not captured in the stacks fixtures.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { computeMerkleBranch } from '../../../src';
import { getBlockCount, getBlockHash, getBlockV1 } from '../../helpers/btc';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60_000);

// bitcoind-only; record→fixtures-btc-merkle-proof.json / replay→install mocks.
beforeAll(() => useFixtures('btc-merkle-proof'));

const dsha256 = (b: Uint8Array): Uint8Array => sha256(sha256(b));
const reverse32 = (b: Uint8Array): Uint8Array => Uint8Array.from(b).reverse();

/** Independent verifier: fold a display-order branch back to a display root. */
function foldToRoot(displayTxid: string, branchDisplay: string[], pos: number): string {
  let h = reverse32(hexToBytes(displayTxid)); // internal/little-endian
  let index = pos;
  for (const sib of branchDisplay) {
    const s = reverse32(hexToBytes(sib));
    h = index % 2 === 0 ? dsha256(new Uint8Array([...h, ...s])) : dsha256(new Uint8Array([...s, ...h]));
    index = Math.floor(index / 2);
  }
  return bytesToHex(reverse32(h)); // back to display order
}

/** Walk back from the tip to find a block with >1 tx (so siblings are exercised). */
async function findMultiTxBlock(): Promise<{ hash: string; height: number }> {
  const tip = await getBlockCount();
  for (let height = tip; height > Math.max(0, tip - 50); height--) {
    const hash = await getBlockHash(height);
    const block = await getBlockV1(hash);
    if (block.tx.length > 1) return { hash, height };
  }
  throw new Error('no multi-tx block found in the last 50 blocks');
}

test('RPC merkle branch folds back to the block merkleroot (every tx)', async () => {
  const { hash, height } = await findMultiTxBlock();
  const block = await getBlockV1(hash);
  console.log('validating block', { height, nTx: block.tx.length, merkleroot: block.merkleroot });

  for (let pos = 0; pos < block.tx.length; pos++) {
    const branch = computeMerkleBranch(block.tx, pos);
    const root = foldToRoot(block.tx[pos], branch, pos);
    expect(root).toBe(block.merkleroot);
  }
});

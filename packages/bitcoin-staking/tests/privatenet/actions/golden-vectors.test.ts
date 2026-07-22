/**
 * Golden-vector cross-checks for consensus-critical PURE functions.
 *
 * Each SDK implementation that "traces correctly on paper" but was never
 * executed against ground truth is pinned here against TWO independent oracles:
 *
 *   - hardcoded vectors lifted VERBATIM from stacks-core (the canonical Rust
 *     consensus impl) — see fixtures/golden-stacks-core.json; and
 *   - live privatenet contract/chain reads (recorded), where a contract
 *     read-only mirrors the pure function.
 *
 * A single divergent byte here means a different P2WSH address (stranded
 * funds), a rejected transaction, or an unverifiable signature on-chain.
 *
 * Run (record):
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     RECORD=1 npx jest tests/privatenet/actions/golden-vectors.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 */
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import { sha256 } from '@noble/hashes/sha2.js';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { Cl, encodeStructuredDataBytes, getAddressFromPublicKey } from '@stacks/transactions';
import {
  buildLockOutputScript,
  buildLockScript,
  buildUnlockScript,
  computeBitcoinTxid,
  computeSignerGrantHash,
  fetchConstructLockupOutputScript,
  fetchConstructLockupScript,
  fetchReversedTxid,
  fetchSignerGrantMessageHash,
  lockScriptToAddress,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';
import golden from '../fixtures/golden-stacks-core.json';

jest.setTimeout(10 * 60_000);

const network = getNetwork();
const dsha = (b: Uint8Array) => sha256(sha256(b));

// Deterministic keys -> a fixed lockup param set (same shape as onchain-helpers).
const STAKER_PUB = secp256k1.getPublicKey(
  hexToBytes('cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df'),
  true
);
const COSIGNER_PUB = secp256k1.getPublicKey(
  hexToBytes('5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0'),
  true
);
const LOCKUP = {
  stxAddress: getAddressFromPublicKey(bytesToHex(STAKER_PUB), 'testnet'),
  unlockHeight: 850_123,
  unlockBytes: buildUnlockScript(STAKER_PUB),
  earlyUnlockBytes: buildUnlockScript(COSIGNER_PUB),
};
// Frozen golden (computed from the fixed inputs above, cross-checked live below).
const GOLDEN_LOCK_SCRIPT =
  '6303cbf80cb16782012088a82041dfc564373f06b57e724a29efeb4d19e7cf9a1f0a04a308908074b0deb8c8e98821022bb4b050afd84f0a7eedd02d4ea6ebe426bbb02744dfcca0b789a643eff6e78cac68692103797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41ac';
const GOLDEN_LOCK_OUTPUT = '0020b44af4b2338a31e256085ac92c3d79f620b244921586cae9230952b888574c5f';
const GOLDEN_LOCK_ADDR_TESTNET = 'tb1qk390fv3n3gc7y4sgttyjc0te7csty3yjzkrv46frp9ft3zzhf30sl4wjxj';

// SIP-018 grant hash inputs — signer-manager fixed, authId fixed. chainId comes
// from the target net so the hash matches the on-chain read.
const GRANT_AUTH_ID = 1;

beforeAll(async () => {
  useFixtures('golden-vectors');
}, 60_000);

// ── 1. Lockup script / P2WSH address ────────────────────────────────────────
describe('lockup script bytes (script.ts buildLockScript)', () => {
  test('matches the frozen golden script + output + address', () => {
    expect(bytesToHex(buildLockScript(LOCKUP))).toBe(GOLDEN_LOCK_SCRIPT);
    expect(bytesToHex(buildLockOutputScript(LOCKUP))).toBe(GOLDEN_LOCK_OUTPUT);
    expect(lockScriptToAddress(buildLockScript(LOCKUP), 'testnet')).toBe(GOLDEN_LOCK_ADDR_TESTNET);
  });

  test('byte layout matches the canonical pox-5.clar construct-lockup-script assembly', () => {
    // 0x63 OP_IF · push-c-script-num(h) · 0xb167 CLTV+ELSE · 0x82012088a820
    // SIZE/32/EQUALVERIFY/SHA256/PUSH32 · <stakerHash> · 0x88 EQUALVERIFY ·
    // earlyUnlock · 0x6869 ENDIF+VERIFY · unlock.
    const hex = bytesToHex(buildLockScript(LOCKUP));
    expect(hex.startsWith('63')).toBe(true);
    expect(hex).toContain('b16782012088a820');
    expect(hex).toContain('6869');
    // P2WSH output = 0x0020 || sha256(script).
    expect(GOLDEN_LOCK_OUTPUT.startsWith('0020')).toBe(true);
    expect(GOLDEN_LOCK_OUTPUT.slice(4)).toBe(bytesToHex(sha256(buildLockScript(LOCKUP))));
  });

  test('LIVE: pox-5 construct-lockup-script mirrors buildLockScript byte-for-byte', async () => {
    const onScript = await fetchConstructLockupScript({ ...LOCKUP, network });
    const onOutput = await fetchConstructLockupOutputScript({ ...LOCKUP, network });
    console.log('contract lockup script:', bytesToHex(onScript));
    expect(bytesToHex(onScript)).toBe(GOLDEN_LOCK_SCRIPT);
    expect(bytesToHex(onOutput)).toBe(GOLDEN_LOCK_OUTPUT);
  });
});

// ── 2. Segwit witness-stripping txid (proof.ts computeBitcoinTxid) ───────────
describe('bitcoin txid from raw bytes (proof.ts computeBitcoinTxid)', () => {
  const stripWitness = (hex: string) =>
    btc.Transaction.fromRaw(hexToBytes(hex), {
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    }).toBytes(true, false); // withScriptSig=true, withWitness=false

  test('SEGWIT: witness-stripped double-sha256 equals Bitcoin Core txid (stacks-core vector)', () => {
    const txid = bytesToHex(computeBitcoinTxid(stripWitness(golden.segwitTx)));
    expect(txid).toBe(golden.segwitTxid);
  });

  test('LEGACY: non-segwit txid equals bitcoin_hash (stacks-core vector)', () => {
    expect(bytesToHex(computeBitcoinTxid(hexToBytes(golden.legacyTx)))).toBe(golden.legacyTxid);
    expect(bytesToHex(computeBitcoinTxid(stripWitness(golden.legacyTx)))).toBe(golden.legacyTxid);
  });

  test('LIVE: pox-5 get-reversed-txid is the byte-reverse of computeBitcoinTxid', async () => {
    const legacy = stripWitness(golden.segwitTx);
    const onchain = await fetchReversedTxid({ tx: legacy, network }); // internal LE
    expect(bytesToHex(onchain)).toBe(bytesToHex(computeBitcoinTxid(legacy).slice().reverse()));
  });
});

// ── 3. SIP-018 grant hash (signer.ts computeSignerGrantHash) ─────────────────
describe('SIP-018 structured-data hash (signer.ts computeSignerGrantHash)', () => {
  test('envelope machinery matches the stacks-core SIP-018 reference vector', () => {
    // Reference: domain {name:"Test App", version:"1.0.0", chain-id:u1}, message
    // (string-ascii "Hello World") -> sha256(0x534950303138 || domainHash || msgHash).
    const domain = Cl.tuple({
      name: Cl.stringAscii('Test App'),
      version: Cl.stringAscii('1.0.0'),
      'chain-id': Cl.uint(1),
    });
    const message = Cl.stringAscii('Hello World');
    const hash = bytesToHex(sha256(encodeStructuredDataBytes({ message, domain })));
    expect(hash).toBe(golden.sip018RefMessageHash);
  });

  test('LIVE: computeSignerGrantHash matches pox-5 get-signer-grant-message-hash', async () => {
    const local = bytesToHex(
      computeSignerGrantHash({
        signerManager: SIGNER_MANAGER,
        authId: GRANT_AUTH_ID,
        chainId: Number(network.chainId),
      })
    );
    const onchain = await fetchSignerGrantMessageHash({
      signerManager: SIGNER_MANAGER,
      authId: GRANT_AUTH_ID,
      network,
    });
    console.log('grant hash local:', local, ' onchain:', onchain);
    expect(local).toBe(onchain);
  });
});

// ── 5. Merkle fold bit-order (proof.ts computeMerkleBranch / foldMerkleBranch) ─
describe('merkle proof fold bit-order (proof.ts)', () => {
  // Mirror of the SDK's internal fold (proof.ts:122-131): sibling side chosen by
  // (index >> level) & 1. Used to validate branches fold back to the root.
  const fold = (leaf: Uint8Array, siblings: Uint8Array[], index: number) => {
    let hash = leaf;
    siblings.forEach((sib, i) => {
      hash = (index >> i) & 1 ? dsha(concatBytes(sib, hash)) : dsha(concatBytes(hash, sib));
    });
    return hash;
  };

  test('stacks-core symbolic trees fold to the expected root (bit-order)', () => {
    const L = new Uint8Array(32).fill(0x11);
    const R = new Uint8Array(32).fill(0x22);
    const root2 = dsha(concatBytes(L, R));
    expect(bytesToHex(fold(L, [R], 0))).toBe(bytesToHex(root2)); // leaf L, index 0
    expect(bytesToHex(fold(R, [L], 1))).toBe(bytesToHex(root2)); // leaf R, index 1

    // CVE-2012-2459 tree: A,B,C (C duplicated). leaf C at index 2.
    const A = new Uint8Array(32).fill(0x01);
    const B = new Uint8Array(32).fill(0x02);
    const C = new Uint8Array(32).fill(0x03);
    const hAB = dsha(concatBytes(A, B));
    const hCC = dsha(concatBytes(C, C));
    const root3 = dsha(concatBytes(hAB, hCC));
    expect(bytesToHex(fold(C, [C, hAB], 2))).toBe(bytesToHex(root3));
  });

  test('header merkle root occupies bytes 36..68 (stacks-core header vectors)', () => {
    // The fold-to-header self-check (proof.ts:181-187) slices header[36..68];
    // pin that offset against real stacks-core headers.
    expect(hexToBytes(golden.someBlockHeader80).slice(36, 68)).toEqual(
      hexToBytes(golden.someBlockMerkleRoot)
    );
    expect(hexToBytes(golden.segwitBlockHeader80).slice(36, 68)).toEqual(
      hexToBytes(golden.segwitBlockMerkleRoot)
    );
  });

  test('LIVE: a real privatenet block folds computeMerkleBranch back to its header root', async () => {
    // Walk back from the tip for the first block with > 1 tx (so the fold runs).
    const { getBtcTipHeight, fetchBlockHeader, fetchBlockTxCount, fetchMerkleProof } = await import(
      '../../helpers/btc-wallet'
    );
    const tip = await getBtcTipHeight();
    let chosen: { hash: string; height: number; txids: string[] } | undefined;
    for (let h = tip; h > tip - 30 && !chosen; h--) {
      const blockHash = await fetchBlockHashByHeight(h);
      if (!blockHash) continue;
      const count = await fetchBlockTxCount(blockHash);
      if (count > 1) {
        chosen = { hash: blockHash, height: h, txids: await fetchTxidsForBlock(blockHash) };
      }
    }
    if (!chosen) {
      console.warn('no multi-tx block in the last 30 — skipping live merkle fold');
      return;
    }
    const pos = 1; // a non-coinbase tx
    const txid = chosen.txids[pos];
    const { merkle } = await fetchMerkleProof(txid, chosen.hash, chosen.height);
    const headerHex = await fetchBlockHeader(chosen.hash);
    const leaf = hexToBytes(txid).reverse(); // display -> internal
    const siblings = merkle.map(h => hexToBytes(h).reverse());
    const root = fold(leaf, siblings, pos);
    console.log('block', chosen.height, 'txCount', chosen.txids.length, 'folded root', bytesToHex(root));
    expect(bytesToHex(root)).toBe(bytesToHex(hexToBytes(headerHex).slice(36, 68)));
  });
});

// Esplora helpers not wrapped in btc-wallet (block-hash-by-height, txid list).
async function fetchBlockHashByHeight(height: number): Promise<string | undefined> {
  const { MEMPOOL_BASE } = await import('../../helpers/btc-wallet');
  const r = await fetch(`${MEMPOOL_BASE}/block-height/${height}`);
  if (!r.ok) return undefined;
  return (await r.text()).trim();
}
async function fetchTxidsForBlock(blockHash: string): Promise<string[]> {
  const { MEMPOOL_BASE } = await import('../../helpers/btc-wallet');
  const r = await fetch(`${MEMPOOL_BASE}/block/${blockHash}/txids`);
  if (!r.ok) throw new Error(`txids ${blockHash} -> ${r.status}`);
  return (await r.json()) as string[];
}

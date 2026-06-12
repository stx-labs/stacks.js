/**
 * ACTION 1 — Fund a real P2WSH L1 lockup output on regtest Bitcoin.
 *
 * Builds the canonical locking script for the configured staker, funds the
 * P2WSH address on the private regtest Bitcoin network, waits for confirmation,
 * then persists all SPV-proof inputs to /tmp/btc-lock-<BOND_INDEX>.json for
 * ACTION 2.
 *
 * Composable via ENV:
 *   BOND_INDEX      bond index (default: 4)
 *   AMOUNT_SATS     sats to lock (default: 30000)
 *   STAKER          account5 | account6 | account7 (default: account5)
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     BOND_INDEX=4 AMOUNT_SATS=30000 STAKER=account5 \
 *     npx jest tests/privatenet/actions/btc-lock.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 *
 * Output: /tmp/btc-lock-<BOND_INDEX>.json (read by register-for-bond-l1.test.ts)
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { writeFileSync } from 'node:fs';
import fetchMock from 'jest-fetch-mock';
import {
  buildUnlockScript,
  buildLockScript,
  buildLockOutputScript,
  computeMerkleBranch,
  fetchBond,
  fetchBondL1UnlockHeight,
} from '../../../src';
import { getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { ensurePox5 } from '../../helpers/wait';

// This test hits live networks — disable the global jest-fetch-mock.
fetchMock.disableMocks();

jest.setTimeout(30 * 60_000);

// ─── Config ──────────────────────────────────────────────────────────────────

const BOND_INDEX = Number(process.env.BOND_INDEX ?? 4);
const AMOUNT_SATS = BigInt(process.env.AMOUNT_SATS ?? 30_000);
// Flat fee for the funding tx (1 sat/vB × ~300 vB rounded up generously)
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 500);

// ─── Staker resolution ───────────────────────────────────────────────────────
//
// STAKER env selects which account acts as the staker (account5 | account6 | account7).
// Defaults to "account5" so existing usage is unchanged.
// Bond membership is one-per-staker: use a different account (e.g. account7) for
// the early-unlock path when account5 is already enrolled in another bond.

const STAKER_NAME = process.env.STAKER ?? 'account5';

const STAKER_RAW_KEYS: Record<string, string> = {
  account5: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df',
  account6: '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0',
  account7: '16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d44',
};

// 32-byte raw private key. Either a named account from the map, or an arbitrary
// staker via STAKER_RAW_KEY (64-hex) — used for freshly-generated accounts (f2/f3…).
const STAKER_PRIV_HEX = process.env.STAKER_RAW_KEY ?? STAKER_RAW_KEYS[STAKER_NAME];
if (!STAKER_PRIV_HEX) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}" and no STAKER_RAW_KEY provided.`);
}
// Full account view derived from the raw key (+compression byte) — works for any
// account, not just those in REGTEST_KEYS.
const stakerAccount = getAccount(STAKER_PRIV_HEX + '01');
const STAKER_STX_ADDRESS = stakerAccount.address;

// account6 BTC pubkey — the early-unlock cosigner whose pubkey the bond stores.
// (Used only for sanity-checking; the bond's earlyUnlockBytes come from on-chain.)
const ACCOUNT6_BTC_PUBKEY = '022bb4b050afd84f0a7eedd02d4ea6ebe426bbb02744dfcca0b789a643eff6e78c';

// ─── Network params ──────────────────────────────────────────────────────────

const REGTEST: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';
const FAUCET_URL = 'https://api.private-1.hiro.so/extended/v1/faucets/btc';

// ─── BTC helpers (mirrors btc-send.test.ts) ───────────────────────────────────

function senderKeys() {
  const priv = hexToBytes(STAKER_PRIV_HEX);
  const pub = secp256k1.getPublicKey(priv, true);
  return { priv, pub };
}

interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
  scriptPubKey: Uint8Array;
}

/**
 * Derive UTXOs from /address/{addr}/txs (the /utxo endpoint 404s on this
 * hosted instance). Only returns confirmed outputs.
 */
async function fetchUtxos(addr: string, scriptHex: string): Promise<Utxo[]> {
  const resp = await fetch(`${MEMPOOL_BASE}/address/${addr}/txs`);
  if (!resp.ok) throw new Error(`GET /address/${addr}/txs → ${resp.status}`);
  const txs = (await resp.json()) as Array<{
    txid: string;
    vin: Array<{ txid: string; vout: number }>;
    vout: Array<{ value: number; scriptpubkey: string }>;
    status: { confirmed: boolean };
  }>;

  const spent = new Set<string>();
  for (const tx of txs) {
    for (const inp of tx.vin) {
      spent.add(`${inp.txid}:${inp.vout}`);
    }
  }

  const utxos: Utxo[] = [];
  for (const tx of txs) {
    if (!tx.status.confirmed) continue;
    tx.vout.forEach((out, idx) => {
      if (out.scriptpubkey !== scriptHex) return;
      if (spent.has(`${tx.txid}:${idx}`)) return;
      utxos.push({
        txid: tx.txid,
        vout: idx,
        value: BigInt(out.value),
        scriptPubKey: hexToBytes(out.scriptpubkey),
      });
    });
  }
  return utxos;
}

async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result != null) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms: ${label}`);
}

async function faucetFund(addr: string): Promise<void> {
  const url = `${FAUCET_URL}?address=${encodeURIComponent(addr)}&xlarge=true`;
  const resp = await fetch(url, { method: 'POST' });
  if (!resp.ok) {
    console.warn(`faucet returned ${resp.status}: ${await resp.text()}`);
  } else {
    console.log('faucet response:', JSON.stringify(await resp.json()));
  }
}

async function broadcast(rawHex: string): Promise<string> {
  for (const path of ['/tx', '/v1/tx']) {
    const resp = await fetch(`${MEMPOOL_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawHex,
    });
    const body = await resp.text();
    if (resp.ok) {
      console.log(`broadcast succeeded via POST ${MEMPOOL_BASE}${path}`);
      return body.trim();
    }
    console.warn(`POST ${MEMPOOL_BASE}${path} → ${resp.status}: ${body}`);
  }
  throw new Error('broadcast failed on both /tx and /v1/tx');
}

/**
 * Fetch the 80-byte block header hex for the block at `blockHash`.
 * Tries /block/:hash/header (Esplora-compatible); falls back to /block/:hash
 * and reconstructs from the raw block fields if the header endpoint is absent.
 */
async function fetchBlockHeader(blockHash: string): Promise<string> {
  const resp = await fetch(`${MEMPOOL_BASE}/block/${blockHash}/header`);
  if (resp.ok) {
    const text = await resp.text();
    return text.trim();
  }
  throw new Error(`GET /block/${blockHash}/header → ${resp.status}`);
}

/**
 * Build the merkle proof for `txid` from the block's ordered txid list.
 *
 * This host does NOT expose `/tx/{txid}/merkle-proof` (404 — redirects to a
 * /v1/ route that doesn't exist), so we fetch `/block/{hash}/txids` (which DOES
 * work) and compute the branch locally with the SDK's `computeMerkleBranch`.
 * Returns the same { block_height, merkle, pos } shape `assembleLockupProof`
 * expects (merkle siblings in big-endian display form; it reverses internally).
 */
async function fetchMerkleProof(
  txid: string,
  blockHash: string,
  blockHeight: number,
): Promise<{ block_height: number; merkle: string[]; pos: number }> {
  const resp = await fetch(`${MEMPOOL_BASE}/block/${blockHash}/txids`);
  if (!resp.ok) throw new Error(`GET /block/${blockHash}/txids → ${resp.status}`);
  const txids = (await resp.json()) as string[];
  const pos = txids.indexOf(txid);
  if (pos === -1) throw new Error(`txid ${txid} not in block ${blockHash} txid list`);
  const merkle = computeMerkleBranch(txids, pos);
  return { block_height: blockHeight, merkle, pos };
}

/**
 * Wait for `txid` to confirm and return the block hash it confirmed in.
 */
async function waitForConfirmation(txid: string): Promise<{ blockHash: string; blockHeight: number }> {
  return poll(
    async () => {
      const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}`);
      if (!resp.ok) return null;
      const tx = (await resp.json()) as {
        status: { confirmed: boolean; block_hash?: string; block_height?: number };
      };
      if (tx.status.confirmed && tx.status.block_hash && tx.status.block_height != null) {
        return { blockHash: tx.status.block_hash, blockHeight: tx.status.block_height };
      }
      return null;
    },
    15_000, // 15 s between polls (API is rate-limited)
    25 * 60_000, // 25 min total
    `waiting for tx ${txid} to confirm`,
  );
}

/**
 * Fetch the raw tx hex (legacy, non-segwit serialization) from the mempool API.
 * /tx/:txid/hex returns the segwit serialization; we strip the witness via
 * @scure/btc-signer so what we store matches the txid (legacy hash).
 */
async function fetchRawTxHex(txid: string): Promise<{ segwitHex: string; legacyHex: string }> {
  const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}/hex`);
  if (!resp.ok) throw new Error(`GET /tx/${txid}/hex → ${resp.status}`);
  const segwitHex = (await resp.text()).trim();
  // Strip witness so bytes hash to txid (not wtxid)
  const parsed = btc.Transaction.fromRaw(hexToBytes(segwitHex), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  const legacyBytes = parsed.toBytes(true, false); // withScriptSig=true, withWitness=false
  return { segwitHex, legacyHex: bytesToHex(legacyBytes) };
}

/**
 * Fetch tx_count for a block (needed for Esplora-proof txCount field).
 */
async function fetchBlockTxCount(blockHash: string): Promise<number> {
  const resp = await fetch(`${MEMPOOL_BASE}/block/${blockHash}`);
  if (!resp.ok) throw new Error(`GET /block/${blockHash} → ${resp.status}`);
  const data = (await resp.json()) as { tx_count: number };
  return data.tx_count;
}

// ─── Test ────────────────────────────────────────────────────────────────────

test(`fund P2WSH L1 lockup on regtest BTC for bond ${BOND_INDEX}`, async () => {
  const network = getNetwork();

  // ── 1. Fetch bond + pox info, derive unlock height + lockup script ────────
  console.log(`\n=== BTC-LOCK ACTION: bondIndex=${BOND_INDEX} amount=${AMOUNT_SATS} sats staker=${STAKER_NAME} ===`);
  console.log('staker STX address:', STAKER_STX_ADDRESS);

  await ensurePox5();

  const bond = await fetchBond({ bondIndex: BOND_INDEX, network });
  if (!bond) throw new Error(`bond ${BOND_INDEX} not found on-chain`);
  console.log('bond:', JSON.stringify({
    bondIndex: bond.bondIndex,
    stxValueRatio: bond.stxValueRatio.toString(),
    minUstxRatioBps: bond.minUstxRatioBps,
    earlyUnlockBytesHex: bond.earlyUnlockBytes,
  }));

  // Canonical unlock height — use the on-chain read-only to match the contract exactly.
  const unlockHeightBig = await fetchBondL1UnlockHeight({ bondIndex: BOND_INDEX, network });
  const unlockHeight = Number(unlockHeightBig);
  console.log('unlock-burn-height:', unlockHeight);

  // Staker BTC public key (compressed secp256k1, derived from the same raw priv)
  const { priv: stakerPriv, pub: stakerBtcPub } = senderKeys();
  const stakerBtcPubHex = bytesToHex(stakerBtcPub);
  console.log(`${STAKER_NAME} BTC pubkey:`, stakerBtcPubHex);
  console.log('account6 BTC pubkey (cosigner):', ACCOUNT6_BTC_PUBKEY);

  // Default unlock script: <stakerBtcPub> OP_CHECKSIG
  const unlockBytes = buildUnlockScript(stakerBtcPub);
  console.log('unlockBytes (default, hex):', bytesToHex(unlockBytes));

  // earlyUnlockBytes sourced from the bond's on-chain configuration
  const earlyUnlockBytes = hexToBytes(bond.earlyUnlockBytes);
  console.log('earlyUnlockBytes (from bond, hex):', bond.earlyUnlockBytes);

  // Full locking script (the witness script committed to in the P2WSH output)
  const witnessScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  console.log('witnessScript (hex):', bytesToHex(witnessScript));
  console.log('witnessScript length:', witnessScript.length, 'bytes');

  // Expected P2WSH output script (34 bytes: OP_0 <sha256(witnessScript)>)
  const p2wshOutputScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  console.log('P2WSH outputScript (hex):', bytesToHex(p2wshOutputScript));

  // Derive the P2WSH address from the locking script
  const p2wshObj = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST);
  const p2wshAddress = p2wshObj.address!;
  console.log('P2WSH address:', p2wshAddress);

  // ── 2. Derive staker P2WPKH address (funding source) ─────────────────────
  const p2wpkhObj = btc.p2wpkh(stakerBtcPub, REGTEST);
  const senderAddr = p2wpkhObj.address!;
  const senderScriptHex = bytesToHex(p2wpkhObj.script);
  console.log(`${STAKER_NAME} P2WPKH addr:`, senderAddr);
  console.log(`${STAKER_NAME} P2WPKH scriptPubKey:`, senderScriptHex);

  // ── 3. Find/fund a confirmed UTXO ─────────────────────────────────────────
  let utxos = await fetchUtxos(senderAddr, senderScriptHex);
  console.log('initial UTXOs:', utxos.map(u => `${u.txid}:${u.vout} (${u.value} sats)`));

  const needed = AMOUNT_SATS + FEE_SATS;
  if (utxos.length === 0 || !utxos.some(u => u.value >= needed)) {
    console.log(`no sufficient confirmed UTXO (need ${needed} sats) — hitting faucet...`);
    await faucetFund(senderAddr);
    utxos = await poll(
      async () => {
        const fresh = await fetchUtxos(senderAddr, senderScriptHex);
        const ok = fresh.filter(u => u.value >= needed);
        return ok.length > 0 ? fresh : null;
      },
      15_000,
      25 * 60_000,
      'waiting for confirmed UTXO after faucet',
    );
    console.log('UTXOs after faucet:', utxos.map(u => `${u.txid}:${u.vout} (${u.value} sats)`));
  }

  const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) throw new Error('no UTXO after polling');

  const changeSats = utxo.value - AMOUNT_SATS - FEE_SATS;
  console.log('spending UTXO:', `${utxo.txid}:${utxo.vout}`, `(${utxo.value} sats)`);
  console.log('lock amount:', AMOUNT_SATS.toString(), 'sats');
  console.log('fee:', FEE_SATS.toString(), 'sats');
  console.log('change:', changeSats.toString(), 'sats');
  expect(changeSats).toBeGreaterThan(0n);

  // ── 4. Build + sign funding tx ────────────────────────────────────────────
  const tx = new btc.Transaction();
  tx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: utxo.scriptPubKey,
      amount: utxo.value,
    },
  });
  // Output 0: P2WSH lockup output (this is what the SPV proof references)
  tx.addOutput({ script: p2wshObj.script, amount: AMOUNT_SATS });
  // Output 1: change back to sender P2WPKH
  tx.addOutputAddress(senderAddr, changeSats, REGTEST);

  tx.sign(stakerPriv);
  tx.finalize();

  const rawHex = tx.hex;
  console.log('funding tx size:', rawHex.length / 2, 'bytes');
  console.log('funding tx hex:', rawHex);

  // ── 5. Broadcast ──────────────────────────────────────────────────────────
  const txid = await broadcast(rawHex);
  console.log('\n=== FUNDING TXID:', txid, '===');
  expect(txid).toMatch(/^[0-9a-f]{64}$/);

  // ── 6. Wait for confirmation ──────────────────────────────────────────────
  console.log('waiting for confirmation...');
  const { blockHash, blockHeight } = await waitForConfirmation(txid);
  console.log('confirmed in block:', blockHash, 'height:', blockHeight);

  // ── 7. Fetch SPV proof components ────────────────────────────────────────
  console.log('fetching block header...');
  const headerHex = await fetchBlockHeader(blockHash);
  console.log('block header (80 bytes hex):', headerHex);
  expect(headerHex.length).toBe(160); // 80 bytes = 160 hex chars

  console.log('fetching merkle proof...');
  const merkleProof = await fetchMerkleProof(txid, blockHash, blockHeight);
  console.log('merkle proof:', JSON.stringify(merkleProof));

  console.log('fetching block tx count...');
  const txCount = await fetchBlockTxCount(blockHash);
  console.log('block tx_count:', txCount);

  console.log('fetching raw tx hex (for legacy bytes)...');
  const { legacyHex } = await fetchRawTxHex(txid);
  console.log('legacy tx hex (witness stripped):', legacyHex);

  // The P2WSH output is always at index 0 in our tx (we added it first)
  const outputIndex = 0;

  // ── 8. Summary ────────────────────────────────────────────────────────────
  console.log('\n=== BTC-LOCK SUMMARY ===');
  console.log('bondIndex:', BOND_INDEX);
  console.log('staker:', STAKER_NAME, '(', STAKER_STX_ADDRESS, ')');
  console.log('txid:', txid);
  console.log('outputIndex:', outputIndex, '(P2WSH lockup)');
  console.log('blockHash:', blockHash);
  console.log('blockHeight:', blockHeight);
  console.log('unlockHeight:', unlockHeight);
  console.log('amountSats:', AMOUNT_SATS.toString());
  console.log('witnessScript (hex):', bytesToHex(witnessScript));
  console.log('merkle.pos:', merkleProof.pos);
  console.log('merkle.block_height:', merkleProof.block_height);
  console.log('merkle.merkle (leaf-hashes):', merkleProof.merkle);
  console.log('txCount:', txCount);
  console.log('headerHex:', headerHex);
  console.log('legacyTxHex:', legacyHex);

  // ── 9. Persist to /tmp/btc-lock-<BOND_INDEX>.json ────────────────────────
  const artifact = {
    bondIndex: BOND_INDEX,
    stakerName: STAKER_NAME,
    txid,
    outputIndex,
    legacyTxHex: legacyHex,
    blockHash,
    blockHeight,
    unlockHeight,
    amountSats: AMOUNT_SATS.toString(),
    witnessScriptHex: bytesToHex(witnessScript),
    unlockBytesHex: bytesToHex(unlockBytes),
    earlyUnlockBytesHex: bond.earlyUnlockBytes,
    stakerStxAddress: STAKER_STX_ADDRESS,
    headerHex,
    merkleProof,
    txCount,
  };

  const artifactPath = `/tmp/btc-lock-${BOND_INDEX}-${STAKER_NAME}.json`;
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`\n=== ARTIFACT WRITTEN: ${artifactPath} ===`);
  console.log(JSON.stringify(artifact, null, 2));
});

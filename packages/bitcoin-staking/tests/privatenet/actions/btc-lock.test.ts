/**
 * ACTION 1 — Fund a real P2WSH L1 lockup output on regtest Bitcoin.
 *
 * Builds the canonical locking script for the configured staker, funds the
 * P2WSH address, waits for confirmation, then persists all SPV-proof inputs
 * to fixtures/artifacts/btc-lock-<STAKER>.json for register-for-bond-l1.
 *
 * ENV: BOND_INDEX (default: dynamic discovery), AMOUNT_SATS (default: 30000),
 * STAKER (account5 | account6 | account7, default: account5).
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     BOND_INDEX=4 AMOUNT_SATS=30000 STAKER=account5 \
 *     npx jest tests/privatenet/actions/btc-lock.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
import { useFixtures } from '../../helpers/mock';
import { waitForFulfilled } from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildUnlockScript,
  buildLockScript,
  buildLockOutputScript,
  fetchBond,
  fetchBondL1UnlockHeight,
} from '../../../src';
import { getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  getUtxos,
  faucetFund,
  broadcastBtc,
  waitForConfirmed,
  fetchBlockHeader,
  fetchMerkleProof,
  fetchRawTxHex,
  fetchBlockTxCount,
} from '../../helpers/btc-wallet';

jest.setTimeout(30 * 60_000);

// BOND_INDEX unset -> discover the currently registration-open bond dynamically.
const BOND_INDEX_ENV = process.env.BOND_INDEX ? Number(process.env.BOND_INDEX) : undefined;
// Canonical artifact location (repo-visible so replays/CI can read it).
const ARTIFACT_DIR = join(__dirname, '..', 'fixtures', 'artifacts');
const AMOUNT_SATS = BigInt(process.env.AMOUNT_SATS ?? 30_000);
// Flat fee for the funding tx (1 sat/vB × ~300 vB rounded up generously)
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 500);

// Bond membership is one-per-staker: use a different account (e.g. account7) for
// the early-exit path when account5 is already enrolled in another bond.
const STAKER_NAME = process.env.STAKER ?? 'account5';

const STAKER_RAW_KEYS: Record<string, string> = {
  account5: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df',
  account6: '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0',
  account7: '16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d44',
};

// STAKER_RAW_KEY (64-hex) supports arbitrary stakers not in the named map (e.g. f2/f3…).
const STAKER_PRIV_HEX = process.env.STAKER_RAW_KEY ?? STAKER_RAW_KEYS[STAKER_NAME];
if (!STAKER_PRIV_HEX) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}" and no STAKER_RAW_KEY provided.`);
}
const stakerAccount = getAccount(STAKER_PRIV_HEX + '01');
const STAKER_STX_ADDRESS = stakerAccount.address;

// account6 BTC pubkey — the early-exit cosigner whose pubkey the bond stores.
// (Used only for sanity-checking; the bond's earlyUnlockBytes come from on-chain.)
const ACCOUNT6_BTC_PUBKEY = '022bb4b050afd84f0a7eedd02d4ea6ebe426bbb02744dfcca0b789a643eff6e78c';

const REGTEST: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// BTC helpers (mirrors btc-send.test.ts)

function senderKeys() {
  const priv = hexToBytes(STAKER_PRIV_HEX);
  const pub = secp256k1.getPublicKey(priv, true);
  return { priv, pub };
}

async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number,
  timeoutMs: number,
  label: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result != null) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms: ${label}`);
}

beforeAll(() => useFixtures('btc-lock'));

test('fund P2WSH L1 lockup on regtest BTC (dynamic bond)', async () => {
  const { bondIndex: BOND_INDEX } =
    BOND_INDEX_ENV != null ? { bondIndex: BOND_INDEX_ENV } : await waitForBondWithRunway(10);
  const network = getNetwork();

  // BOND SETUP
  console.log(`bondIndex=${BOND_INDEX} amount=${AMOUNT_SATS} sats staker=${STAKER_NAME}`);
  console.log('staker STX address:', STAKER_STX_ADDRESS);

  // the daemon creates the window bond a few blocks into it (politeness gap)
  const bond = await waitForFulfilled(async () => {
    const b = await fetchBond({ bondIndex: BOND_INDEX, network });
    if (!b) throw `bond ${BOND_INDEX} not created yet`;
    return b;
  });
  console.log(
    'bond:',
    JSON.stringify({
      bondIndex: bond.bondIndex,
      stxValueRatio: bond.stxValueRatio.toString(),
      minUstxRatioBps: bond.minUstxRatioBps,
      earlyUnlockBytesHex: bond.earlyUnlockBytes,
    })
  );

  // Canonical unlock height — use the on-chain read-only to match the contract exactly.
  const unlockHeightBig = await fetchBondL1UnlockHeight({ bondIndex: BOND_INDEX, network });
  const unlockHeight = Number(unlockHeightBig);
  console.log('unlock-burn-height:', unlockHeight);

  const { priv: stakerPriv, pub: stakerBtcPub } = senderKeys();
  const stakerBtcPubHex = bytesToHex(stakerBtcPub);
  console.log(`${STAKER_NAME} BTC pubkey:`, stakerBtcPubHex);
  console.log('account6 BTC pubkey (cosigner):', ACCOUNT6_BTC_PUBKEY);

  const unlockBytes = buildUnlockScript(stakerBtcPub);
  console.log('unlockBytes (default, hex):', bytesToHex(unlockBytes));

  const earlyUnlockBytes = hexToBytes(bond.earlyUnlockBytes);
  console.log('earlyUnlockBytes (from bond, hex):', bond.earlyUnlockBytes);

  const witnessScript = buildLockScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  console.log('witnessScript (hex):', bytesToHex(witnessScript));
  console.log('witnessScript length:', witnessScript.length, 'bytes');

  const p2wshOutputScript = buildLockOutputScript({
    stxAddress: STAKER_STX_ADDRESS,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  console.log('P2WSH outputScript (hex):', bytesToHex(p2wshOutputScript));

  const p2wshObj = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST);
  const p2wshAddress = p2wshObj.address!;
  console.log('P2WSH address:', p2wshAddress);

  // FUND UTXO
  const p2wpkhObj = btc.p2wpkh(stakerBtcPub, REGTEST);
  const senderAddr = p2wpkhObj.address!;
  const senderScriptHex = bytesToHex(p2wpkhObj.script);
  console.log(`${STAKER_NAME} P2WPKH addr:`, senderAddr);
  console.log(`${STAKER_NAME} P2WPKH scriptPubKey:`, senderScriptHex);

  let utxos = await getUtxos(senderAddr, senderScriptHex);
  console.log(
    'initial UTXOs:',
    utxos.map(u => `${u.txid}:${u.vout} (${u.value} sats)`)
  );

  const needed = AMOUNT_SATS + FEE_SATS;
  if (utxos.length === 0 || !utxos.some(u => u.value >= needed)) {
    console.log(`no sufficient confirmed UTXO (need ${needed} sats) — hitting faucet...`);
    await faucetFund(senderAddr);
    utxos = await poll(
      async () => {
        const fresh = await getUtxos(senderAddr, senderScriptHex);
        const ok = fresh.filter(u => u.value >= needed);
        return ok.length > 0 ? fresh : null;
      },
      15_000,
      25 * 60_000,
      'waiting for confirmed UTXO after faucet'
    );
    console.log(
      'UTXOs after faucet:',
      utxos.map(u => `${u.txid}:${u.vout} (${u.value} sats)`)
    );
  }

  const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) throw new Error('no UTXO after polling');

  const changeSats = utxo.value - AMOUNT_SATS - FEE_SATS;
  console.log('spending UTXO:', `${utxo.txid}:${utxo.vout}`, `(${utxo.value} sats)`);
  console.log('lock amount:', AMOUNT_SATS.toString(), 'sats');
  console.log('fee:', FEE_SATS.toString(), 'sats');
  console.log('change:', changeSats.toString(), 'sats');
  expect(changeSats).toBeGreaterThan(0n);

  // SIGN + BROADCAST
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

  const txid = await broadcastBtc(rawHex);
  console.log('funding txid:', txid);
  expect(txid).toMatch(/^[0-9a-f]{64}$/);

  const { block_hash: blockHash, block_height: blockHeight } = await waitForConfirmed(txid);
  console.log('confirmed in block:', blockHash, 'height:', blockHeight);

  // SPV PROOF
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

  // Output 0 is always the P2WSH lockup (added first in the tx above).
  const outputIndex = 0;

  // PERSIST
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

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifactPath = join(ARTIFACT_DIR, `btc-lock-${STAKER_NAME}.json`);
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log('artifact written:', artifactPath);
});

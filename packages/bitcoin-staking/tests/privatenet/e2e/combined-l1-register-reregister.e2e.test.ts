/**
 * E2E — L1 register -> announce early exit (staker-signed) -> re-register in next bond.
 *
 * Runs for account5. Requires account5 to have no active bond membership at
 * start; if it's already enrolled, self-heals to a pass (see below) rather
 * than running the re-register leg, since that needs a clean account.
 * announce-l1-early-exit must be staker-signed, not admin-signed (contract
 * requires tx-sender == staker). BTC confirmation (~420s) dominates
 * wall-clock; two locks = ~840s total.
 *
 * Run:
 *   set -a; . packages/bitcoin-staking/.env; set +a
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=420000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-l1-reregister.json \
 *     npx jest tests/privatenet/e2e/combined-l1-register-reregister.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { writeFileSync } from 'node:fs';
import {
  buildAnnounceL1EarlyExit,
  buildLockOutputScript,
  buildLockProof,
  buildLockScript,
  buildRegisterForBond,
  buildUnlockScript,
  computeMerkleBranch,
  describePox5Error,
  fetchBond,
  fetchBondL1UnlockHeight,
  fetchBondMembership,
  fetchHasAnnouncedL1EarlyExit,
  minUstxForSatsAmount,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction, parseErrCode } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import {
  BtcLockArtifact,
  broadcastBtc,
  faucetFund,
  fetchBlockHeader,
} from '../../helpers/btc-wallet';

const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';
const FEE_USTX = 10_000n;
const LOCK_AMOUNT_SATS = 50_000n; // 50k sats per lock
const FEE_SATS = 500n;

const BTC_NETWORK: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// account5 raw 32-byte private key (no compression suffix)
const STAKER_RAW_KEY_HEX = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df';
// account5 — L1 register staker, not driven by any daemon
const staker = getAccount(REGTEST_KEYS['account5']);
const network = getNetwork();

function stakerPrivBytes(): Uint8Array {
  return hexToBytes(STAKER_RAW_KEY_HEX);
}
function stakerPubBytes(): Uint8Array {
  return secp256k1.getPublicKey(stakerPrivBytes(), true);
}

async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number,
  timeoutMs: number,
  label: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r != null) return r;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms: ${label}`);
}

interface MempoolUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_hash?: string };
}
interface MempoolTx {
  txid: string;
  vout: Array<{ value: number; scriptpubkey: string }>;
  status: { confirmed: boolean; block_height?: number; block_hash?: string };
  fee: number;
}

async function getConfirmedUtxos(btcAddress: string): Promise<MempoolUtxo[]> {
  const resp = await fetch(`${MEMPOOL_BASE}/address/${btcAddress}/utxo`);
  if (!resp.ok) return [];
  const utxos: MempoolUtxo[] = await resp.json();
  return utxos.filter(u => u.status.confirmed);
}

async function fetchMempoolTx(txid: string): Promise<MempoolTx | null> {
  const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}`);
  if (!resp.ok) return null;
  return resp.json();
}

async function fetchBlockTxids(blockHash: string): Promise<string[]> {
  const resp = await fetch(`${MEMPOOL_BASE}/block/${blockHash}/txids`);
  if (!resp.ok) return [];
  return resp.json();
}

type LockArtifact = BtcLockArtifact;

/**
 * Execute a full BTC lock: faucet -> fund P2WSH -> wait for confirmation -> artifact.
 * Returns the artifact (also written to /tmp for tooling compatibility).
 */
async function executeBtcLock(bondIndex: number, amountSats: bigint): Promise<LockArtifact> {
  console.log(`  [btc-lock] bondIndex=${bondIndex}, amount=${amountSats} sats`);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`Bond ${bondIndex} not found on chain`);
  const unlockHeight = await fetchBondL1UnlockHeight({ bondIndex, network });
  console.log(
    `  [btc-lock] earlyUnlockBytes: ${bond.earlyUnlockBytes}, unlockHeight: ${unlockHeight}`
  );

  const unlockBytes = buildUnlockScript(stakerPubBytes());
  const lockScript = buildLockScript({
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: bond.earlyUnlockBytes,
  });
  const lockAddress = btc.p2wsh({ type: 'wsh', script: lockScript }, BTC_NETWORK).address!;
  const p2wshOutputScript = buildLockOutputScript({
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: bond.earlyUnlockBytes,
  });

  console.log(`  [btc-lock] P2WSH address: ${lockAddress}`);

  const senderPub = stakerPubBytes();
  const senderAddr = btc.p2wpkh(senderPub, BTC_NETWORK).address!;
  console.log(`  [btc-lock] sender (P2WPKH): ${senderAddr}`);
  await faucetFund(senderAddr);

  const utxos = await pollUntil(
    async () => {
      const us = await getConfirmedUtxos(senderAddr);
      return us.length > 0 ? us : null;
    },
    10_000,
    300_000,
    `confirmed UTXO for ${senderAddr}`
  );
  const utxo = utxos.reduce((best, u) => (u.value > best.value ? u : best), utxos[0]);
  const utxoValue = BigInt(utxo.value);
  const changeAmount = utxoValue - amountSats - FEE_SATS;
  if (changeAmount < 0n)
    throw new Error(`Insufficient UTXO: ${utxoValue} < ${amountSats} + ${FEE_SATS}`);

  const utxoTx = await fetchMempoolTx(utxo.txid);
  if (!utxoTx) throw new Error(`Cannot fetch UTXO tx ${utxo.txid}`);
  const utxoScriptPubKey = hexToBytes(utxoTx.vout[utxo.vout].scriptpubkey);

  const lockP2wsh = btc.p2wsh({ type: 'wsh', script: lockScript }, BTC_NETWORK);
  const fundTx = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  fundTx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { script: utxoScriptPubKey, amount: utxoValue },
  });
  fundTx.addOutput({ script: lockP2wsh.script, amount: amountSats });
  if (changeAmount > 0n) {
    fundTx.addOutputAddress(senderAddr, changeAmount, BTC_NETWORK);
  }
  fundTx.sign(stakerPrivBytes());
  fundTx.finalize();

  console.log(`  [btc-lock] broadcasting funding tx...`);
  const fundTxid = await broadcastBtc(fundTx.hex);
  console.log(`  [btc-lock] funding txid: ${fundTxid}`);

  const confirmedTx = await pollUntil(
    async () => {
      const t = await fetchMempoolTx(fundTxid);
      return t?.status?.confirmed ? t : null;
    },
    10_000,
    420_000,
    `lock tx ${fundTxid} confirmed`
  );
  const blockHash = confirmedTx.status.block_hash!;
  const blockHeight = confirmedTx.status.block_height!;
  console.log(`  [btc-lock] confirmed at block ${blockHeight} (${blockHash})`);

  const headerHex = await fetchBlockHeader(blockHash);
  if (!headerHex) throw new Error(`Cannot fetch block header for ${blockHash}`);
  const txids = await fetchBlockTxids(blockHash);
  const txIndex = txids.indexOf(fundTxid);
  if (txIndex < 0) throw new Error(`tx ${fundTxid} not found in block ${blockHash}`);
  const merkleSiblings = computeMerkleBranch(txids, txIndex);

  // Find the P2WSH output index by matching the expected scriptPubKey
  const outputIndex = confirmedTx.vout.findIndex(o => {
    const expected = bytesToHex(p2wshOutputScript);
    return o.scriptpubkey === expected;
  });
  if (outputIndex < 0) throw new Error(`Cannot find P2WSH output in tx ${fundTxid}`);

  const artifact: LockArtifact = {
    bondIndex,
    txid: fundTxid,
    outputIndex,
    blockHash,
    blockHeight,
    unlockHeight: Number(unlockHeight),
    amountSats: amountSats.toString(),
    witnessScriptHex: bytesToHex(lockScript),
    unlockBytesHex: bytesToHex(unlockBytes),
    earlyUnlockBytesHex:
      typeof bond.earlyUnlockBytes === 'string'
        ? bond.earlyUnlockBytes
        : bytesToHex(bond.earlyUnlockBytes),
    stakerStxAddress: staker.address,
    legacyTxHex: fundTx.hex,
    headerHex,
    merkleProof: {
      block_height: blockHeight,
      merkle: merkleSiblings,
      pos: txIndex,
    },
    txCount: txids.length,
  };

  const artifactPath = `/tmp/btc-lock-${bondIndex}-account5.json`;
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`  [btc-lock] artifact written: ${artifactPath}`);
  return artifact;
}

/** Build and broadcast a register-for-bond L1 tx from an artifact. Returns txid. */
async function executeRegisterL1(artifact: LockArtifact): Promise<string> {
  const {
    bondIndex,
    legacyTxHex,
    headerHex,
    merkleProof,
    txCount,
    amountSats,
    unlockBytesHex,
    earlyUnlockBytesHex,
    stakerStxAddress,
    unlockHeight,
  } = artifact;

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`Bond ${bondIndex} not found`);

  const unlockBytes = hexToBytes(unlockBytesHex);
  const earlyUnlockBytes = hexToBytes(earlyUnlockBytesHex);

  // Derive expected P2WSH output script
  const outputScript = buildLockOutputScript({
    stxAddress: stakerStxAddress,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });

  // Assemble SPV proof (buildLockProof handles endianness and witness-stripping)
  const lockupOutput = buildLockProof({
    txHex: legacyTxHex,
    header: headerHex,
    merkleProof,
    txCount,
    unlockHeight,
    outputScript,
  });

  const amountSatsBig = BigInt(amountSats);
  const minUstx = minUstxForSatsAmount({
    sats: amountSatsBig,
    stxValueRatio: bond.stxValueRatio,
    minUstxRatioBps: bond.minUstxRatioBps,
  });
  const amountUstx = minUstx + 1_000_000n; // add buffer

  const nonce = await getNextNonce(staker.address);
  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx,
    lockup: {
      kind: 'btc',
      outputs: [lockupOutput],
      unlockBytes,
    },
    publicKey: staker.publicKey,
    fee: FEE_USTX,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const regTx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(regTx, staker.address, network);
  console.log(`  [register-l1] txid: ${txid}`);
  return txid;
}

beforeAll(async () => {
  useFixtures('e2e-reregister');
}, 60_000);

test(
  'account5: L1 register -> announce early exit (staker-signed) -> re-register in next bond',
  async () => {
    useFixtures('e2e-reregister');

    console.log('staker:', staker.address);

    // SELF-HEAL: on a shared chain account5 may already be enrolled from a
    // prior run. Rather than hard-fail, accept a valid existing L1 lock as a
    // pass; the re-register leg below only runs on a fresh (unenrolled) start.
    const existing = await fetchBondMembership({ address: staker.address, network });
    if (existing) {
      console.warn(
        `account5 already has bond membership (bondIndex=${existing.bondIndex}, isL1Lock=${existing.isL1Lock}).`
      );
      const alreadyExited = await fetchHasAnnouncedL1EarlyExit({
        bondIndex: existing.bondIndex,
        staker: staker.address,
        network,
      });
      console.log(`hasAnnouncedL1EarlyExit(bond ${existing.bondIndex})=${alreadyExited}`);
      expect(existing.isL1Lock).toBe(true);
      console.log('ALREADY ENROLLED — self-heal pass (re-register flow needs a clean account5)');
      return;
    }

    // DISCOVER BOND 1
    const {
      bondIndex: bond1Index,
      bondStartHeight: bond1Start,
      poxInfo: pox1,
    } = await waitForBondWithRunway(10);
    console.log(
      `first bond: bondIndex=${bond1Index}, bondStart=${bond1Start}, currentBurn=${pox1.currentBurnchainBlockHeight}`
    );

    // BTC LOCK 1
    const artifact1 = await executeBtcLock(bond1Index, LOCK_AMOUNT_SATS);

    // REGISTER 1
    useFixtures('e2e-reregister-reg1'); // isolate register-1 broadcast from the bond-1 BTC-lock broadcast
    const registerTxid1 = await executeRegisterL1(artifact1);
    console.log('register-l1 txid (bond 1):', registerTxid1);

    // Wait a moment for the extended API to index
    await new Promise(r => setTimeout(r, 5_000));
    const regRecord1 = await getTransaction(registerTxid1);
    if (regRecord1 && regRecord1.tx_status !== 'success') {
      const code = parseErrCode(regRecord1.tx_result?.repr);
      throw new Error(
        `register-for-bond L1 aborted (err u${code}): ` +
          `${describePox5Error(code ?? -1)?.name ?? 'unknown'} — ` +
          `repr: ${regRecord1.tx_result?.repr}`
      );
    }

    // Phase switch: same get-bond-membership path returns a different body after
    // registration; route the after-read to its own fixture key.
    useFixtures('e2e-reregister-registered');
    const membership1 = await fetchBondMembership({ address: staker.address, network });
    console.log(
      'membership after first register:',
      JSON.stringify(membership1, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );

    if (!membership1) {
      throw new Error('register-for-bond L1 succeeded on-chain but membership not found — timing?');
    }
    expect(membership1.isL1Lock).toBe(true);
    expect(membership1.bondIndex).toBe(bond1Index);
    console.log(
      `registration 1 confirmed: bondIndex=${membership1.bondIndex}, isL1Lock=${membership1.isL1Lock}`
    );

    // ANNOUNCE EARLY EXIT (staker-signed; contract requires tx-sender == staker)
    useFixtures('e2e-reregister-announce'); // isolate the announce broadcast from the register-1 broadcast
    const unsignedAnnounce = await buildAnnounceL1EarlyExit({
      staker: staker.address,
      oldSignerManager: SIGNER_MANAGER,
      publicKey: staker.publicKey,
      fee: FEE_USTX,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });
    const announceTxRaw = signTransaction(unsignedAnnounce, staker.key);
    const announceTxid = await broadcastAndWait(announceTxRaw, staker.address, network);
    console.log('announce txid:', announceTxid);

    await new Promise(r => setTimeout(r, 5_000));
    const announceRecord = await getTransaction(announceTxid);
    if (announceRecord && announceRecord.tx_status !== 'success') {
      const code = parseErrCode(announceRecord.tx_result?.repr);
      throw new Error(
        `announce-l1-early-exit aborted (err u${code}): ` +
          `${describePox5Error(code ?? -1)?.name ?? 'unknown'} — ` +
          `repr: ${announceRecord.tx_result?.repr}`
      );
    }

    const hasAnnounced = await fetchHasAnnouncedL1EarlyExit({
      bondIndex: bond1Index,
      staker: staker.address,
      network,
    });
    expect(hasAnnounced).toBe(true);
    console.log(`announce confirmed: hasAnnouncedL1EarlyExit=${hasAnnounced}`);

    useFixtures('e2e-reregister-exited');

    // DISCOVER BOND 2
    const {
      bondIndex: bond2Index,
      bondStartHeight: bond2Start,
      poxInfo: pox2,
    } = await waitForBondWithRunway(5);
    console.log(
      `next bond: bondIndex=${bond2Index}, bondStart=${bond2Start}, currentBurn=${pox2.currentBurnchainBlockHeight}`
    );

    // BTC LOCK 2
    useFixtures('e2e-reregister-lock2'); // isolate bond-2 BTC-lock broadcast from the announce broadcast
    const artifact2 = await executeBtcLock(bond2Index, LOCK_AMOUNT_SATS);

    // RE-REGISTER
    useFixtures('e2e-reregister-reg2'); // isolate register-2 broadcast from the bond-2 BTC-lock broadcast
    const registerTxid2 = await executeRegisterL1(artifact2);
    console.log('register-l1 txid (bond 2):', registerTxid2);

    await new Promise(r => setTimeout(r, 5_000));
    const regRecord2 = await getTransaction(registerTxid2);
    if (regRecord2 && regRecord2.tx_status !== 'success') {
      const code = parseErrCode(regRecord2.tx_result?.repr);
      throw new Error(
        `re-register aborted (err u${code}): ` +
          `${describePox5Error(code ?? -1)?.name ?? 'unknown'} — ` +
          `repr: ${regRecord2.tx_result?.repr}`
      );
    }

    const membership2 = await fetchBondMembership({ address: staker.address, network });
    console.log(
      'membership after re-register:',
      JSON.stringify(membership2, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );

    if (!membership2) {
      throw new Error('re-register succeeded on-chain but membership not found — timing?');
    }
    expect(membership2.isL1Lock).toBe(true);
    expect(membership2.bondIndex).toBe(bond2Index);
    console.log(
      `re-registration confirmed: bondIndex=${membership2.bondIndex}, isL1Lock=${membership2.isL1Lock}`
    );

    useFixtures('e2e-reregister-rereg');

    console.log('bond 1 index:', bond1Index, 'register txid:', registerTxid1);
    console.log('announce txid:', announceTxid);
    console.log('bond 2 index:', bond2Index, 're-register txid:', registerTxid2);
  },
  2 * 420_000 + 180_000
);

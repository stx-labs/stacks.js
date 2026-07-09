/**
 * E2E — L1 BTC timelock (CLTV / IF-branch) reclaim.
 *
 * Loads the BTC lock artifact for the staker, discovers bondIndex from the
 * live membership, and skips gracefully if the Bitcoin tip hasn't reached
 * unlockHeight yet (staker-only path, no BOND_ADMIN_KEY needed).
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-exit-l1-timelock-reclaim.json \
 *     npx jest tests/privatenet/e2e/exit-l1-timelock-reclaim.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import { readFileSync } from 'node:fs';
import { fetchBondMembership } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';

const STAKER_NAME = (process.env.STAKER ?? 'account7') as 'account5' | 'account6' | 'account7';

const STAKER_RAW_KEYS: Record<'account5' | 'account6' | 'account7', string> = {
  account5: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df',
  account6: '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0',
  account7: '16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d44',
};

if (!(STAKER_NAME in STAKER_RAW_KEYS)) {
  throw new Error(`Unknown STAKER="${STAKER_NAME}". Must be account5, account6, or account7.`);
}

const STAKER_PRIV_HEX = STAKER_RAW_KEYS[STAKER_NAME];
const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 300);

// BTC network params (private testnet uses bcrt1 addresses like regtest)
const BTC_NETWORK: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

interface LockArtifact {
  bondIndex: number;
  txid: string;
  outputIndex: number;
  unlockHeight: number;
  amountSats: string;
  witnessScriptHex: string;
  stakerStxAddress: string;
  legacyTxHex: string;
}

async function fetchTipHeight(): Promise<number> {
  const resp = await fetch(`${MEMPOOL_BASE}/blocks/tip/height`);
  if (!resp.ok) throw new Error(`GET /blocks/tip/height → ${resp.status}`);
  return Number((await resp.text()).trim());
}

async function broadcastBtcTx(rawHex: string): Promise<string> {
  for (const path of ['/tx', '/v1/tx']) {
    const resp = await fetch(`${MEMPOOL_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawHex,
    });
    const body = await resp.text();
    if (resp.ok) {
      console.log(`BTC broadcast succeeded via POST ${MEMPOOL_BASE}${path}`);
      return body.trim();
    }
    console.warn(`POST ${MEMPOOL_BASE}${path} → ${resp.status}: ${body}`);
  }
  throw new Error('BTC broadcast failed on both /tx and /v1/tx');
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

const network = getNetwork();
const stakerAccount = getAccount(REGTEST_KEYS[STAKER_NAME]);

beforeAll(async () => {
  useFixtures('e2e-exit-l1-timelock-reclaim');
}, 60_000);

test(`L1 timelock-reclaim (IF/CLTV branch) for ${STAKER_NAME}`, async () => {
  useFixtures('e2e-exit-l1-timelock-reclaim');
  console.log('staker:', stakerAccount.address, `(${STAKER_NAME})`);

  // DISCOVER MEMBERSHIP
  const membership = await fetchBondMembership({ address: stakerAccount.address, network });
  if (!membership) {
    console.warn(
      `${STAKER_NAME} has NO bond membership — skipping. Run btc-lock + register-for-bond-l1 first.`
    );
    console.log('(skipped — no L1 enrollment)');
    return;
  }

  if (!membership.isL1Lock) {
    console.warn(
      `${STAKER_NAME} membership has isL1Lock=${membership.isL1Lock} — not an L1 lock. Skipping.`
    );
    console.log('(skipped — not an L1 lock)');
    return;
  }

  const bondIndex = membership.bondIndex;
  console.log('discovered bondIndex:', bondIndex, '(from membership)');

  // LOAD ARTIFACT
  const artifactPath = `/tmp/btc-lock-${bondIndex}-${STAKER_NAME}.json`;
  console.log('loading lock artifact:', artifactPath);

  let artifact: LockArtifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as LockArtifact;
  } catch (err) {
    throw new Error(
      `Cannot read lock artifact ${artifactPath} — run btc-lock.test.ts first with STAKER=${STAKER_NAME} BOND_INDEX=${bondIndex}.\n  ${String(err)}`
    );
  }

  const {
    txid: lockTxid,
    outputIndex: lockOutputIndex,
    unlockHeight,
    amountSats: amountSatsStr,
    witnessScriptHex,
  } = artifact;
  const amountSats = BigInt(amountSatsStr);
  const witnessScript = hexToBytes(witnessScriptHex);

  console.log('artifact:', {
    lockTxid,
    lockOutputIndex,
    unlockHeight,
    amountSats: amountSats.toString(),
  });

  // CHECK TIP
  const tipHeight = await fetchTipHeight();
  console.log(`Bitcoin tip height: ${tipHeight}, unlockHeight: ${unlockHeight}`);

  if (tipHeight < unlockHeight) {
    console.log(
      `SKIP: tip (${tipHeight}) < unlockHeight (${unlockHeight}) — CLTV not yet satisfied. ` +
        `Need ${unlockHeight - tipHeight} more Bitcoin blocks (~${Math.ceil(((unlockHeight - tipHeight) * 10) / 60)} min at 10-min blocks).`
    );
    // Graceful skip — do not fail; the orchestrator retries once the height is reached.
    return;
  }

  console.log(
    `tip (${tipHeight}) >= unlockHeight (${unlockHeight}) — CLTV satisfied, proceeding with reclaim`
  );

  // DERIVE KEYS
  const stakerPriv = hexToBytes(STAKER_PRIV_HEX);
  const stakerPub = secp256k1.getPublicKey(stakerPriv, true);
  const toAddress = btc.p2wpkh(stakerPub, BTC_NETWORK).address!;
  console.log('reclaim to address (staker P2WPKH):', toAddress);

  const p2wshObj = btc.p2wsh({ type: 'wsh', script: witnessScript }, BTC_NETWORK);
  const p2wshScript = p2wshObj.script;
  console.log('P2WSH address:', p2wshObj.address);

  const reclaimSats = amountSats - FEE_SATS;
  if (reclaimSats <= 0n) throw new Error(`fee (${FEE_SATS}) exceeds lockup amount (${amountSats})`);
  console.log('reclaimSats:', reclaimSats.toString());

  // BUILD RECLAIM TX
  // lockTime = unlockHeight (CLTV requirement), sequence = 0xfffffffe (non-final, enables CLTV)
  const reclaimTx = new btc.Transaction({
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowUnknownInputs: true,
    lockTime: unlockHeight,
  });
  console.log('tx lockTime:', unlockHeight);

  reclaimTx.addInput({
    txid: lockTxid,
    index: lockOutputIndex,
    sequence: 0xfffffffe, // non-final, enables nLockTime + CLTV
    witnessUtxo: { script: p2wshScript, amount: amountSats },
  });
  reclaimTx.addOutputAddress(toAddress, reclaimSats, BTC_NETWORK);

  const SIGHASH_ALL = 1;
  const sighash = reclaimTx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amountSats);
  console.log('BIP143 sighash:', bytesToHex(sighash));

  const stakerSigDer = signECDSA(sighash, stakerPriv, true);
  const stakerSig = concatBytes(stakerSigDer, new Uint8Array([SIGHASH_ALL]));
  console.log('staker sig:', bytesToHex(stakerSig));

  // Witness stack (bottom -> top): [ staker_sig, 0x01 (truthy -> IF/CLTV branch), witnessScript ]
  const selector = new Uint8Array([0x01]);
  const witnessItems: Uint8Array[] = [stakerSig, selector, witnessScript];

  reclaimTx.updateInput(0, { finalScriptWitness: witnessItems }, true);
  if (!reclaimTx.isFinal) throw new Error('Reclaim tx is not finalized — witness injection failed');

  const rawHex = reclaimTx.hex;
  console.log('tx vsize:', reclaimTx.vsize, 'vBytes');
  console.log('tx hex (first 80 chars):', rawHex.slice(0, 80) + '...');

  // BROADCAST
  const reclaimTxid = await broadcastBtcTx(rawHex);
  console.log('reclaim txid:', reclaimTxid);

  expect(reclaimTxid).toMatch(/^[0-9a-f]{64}$/);

  const seenTx = await poll(
    async () => {
      const resp = await fetch(`${MEMPOOL_BASE}/tx/${reclaimTxid}`);
      if (!resp.ok) return null;
      return (await resp.json()) as { txid: string; fee: number; status: { confirmed: boolean } };
    },
    5_000,
    2 * 60_000,
    `reclaim tx ${reclaimTxid} visible in mempool`
  );

  console.log(
    'mempool tx:',
    JSON.stringify({
      txid: seenTx.txid,
      fee: seenTx.fee,
      confirmed: seenTx.status.confirmed,
    })
  );

  expect(seenTx.txid).toBe(reclaimTxid);
  expect(seenTx.fee).toBeGreaterThan(0);
}, 180_000);

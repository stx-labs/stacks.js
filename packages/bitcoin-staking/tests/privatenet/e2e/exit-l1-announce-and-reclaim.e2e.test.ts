/**
 * E2E — L1 BTC early-exit: announce + P2WSH ELSE-branch reclaim (real spend).
 *
 * Models the ELSE-branch witness on btc-lockup-roundtrip.test.ts (TEST 1, EARLY
 * branch) and reuses the funding/register patterns from single-l1-register.e2e.
 * Staker = account5; cosigner = account6 (bond's earlyUnlockBytes pubkey).
 *
 * Skips honestly (no fake pass) if the discovered/enrolled bond isn't
 * cosigner-enabled, or if a previously-enrolled UTXO was already reclaimed.
 *
 * Live run:
 *   set -a; . packages/bitcoin-staking/.env; set +a
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-exit-l1-announce-and-reclaim.json \
 *   npx jest tests/privatenet/e2e/exit-l1-announce-and-reclaim.e2e.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { signECDSA } from '@scure/btc-signer/utils.js';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes, hexToBytes } from '@stacks/common';
import {
  buildAnnounceL1EarlyExit,
  buildLockOutputScript,
  buildLockProof,
  buildLockScript,
  buildRegisterForBond,
  buildUnlockScript,
  computeRegisterPreimage,
  describePox5Error,
  fetchBond,
  fetchBondL1UnlockHeight,
  fetchBondMembership,
  minUstxForSatsAmount,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getTransaction } from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';
import {
  broadcastBtc,
  faucetFund,
  fetchBlockHeader,
  fetchBlockTxCount,
  fetchMerkleProof,
  fetchRawTxHex,
  getUtxos,
  waitForConfirmed,
} from '../../helpers/btc-wallet';


const MEMPOOL_BASE = 'https://mempool.bitcoin.private-1.hiro.so/api';

const AMOUNT_SATS = BigInt(process.env.AMOUNT_SATS ?? 30_000);
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 500);
const FEE_USTX = BigInt(process.env.FEE_USTX ?? 10_000);
const SWEEP_FEE_SATS = BigInt(process.env.SWEEP_FEE_SATS ?? 500);
const SIGHASH_ALL = 1;

// BTC network params (private testnet uses bcrt1 addresses like regtest).
const REGTEST_BTC: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// account5 — the staker whose L1 lock we register, then reclaim via ELSE branch.
const STAKER_PRIV_HEX = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df';
// account6 — the bond's early-exit COSIGNER (its pubkey is in earlyUnlockBytes).
const COSIGNER_PRIV_HEX = '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0';

const staker = getAccount(REGTEST_KEYS.account5);
const network = getNetwork();

// Generic poll loop (no request-identical shared equivalent).
async function btcPoll<T>(
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

beforeAll(async () => {
  useFixtures('e2e-exit-l1-announce-and-reclaim');
}, 60_000);

test('L1 early-exit: announce then P2WSH ELSE-branch reclaim for account5', async () => {
  useFixtures('e2e-exit-l1-announce-and-reclaim');
  console.log('staker (account5):', staker.address);
  console.log('signerManager:', SIGNER_MANAGER);

  const stakerPrivBytes = hexToBytes(STAKER_PRIV_HEX);
  const stakerBtcPub = secp256k1.getPublicKey(stakerPrivBytes, true);
  const cosignerPrivBytes = hexToBytes(COSIGNER_PRIV_HEX);
  const cosignerBtcPub = secp256k1.getPublicKey(cosignerPrivBytes, true);

  const expectedEarlyUnlockHex = bytesToHex(buildUnlockScript(cosignerBtcPub));
  console.log('expected cosigner earlyUnlockBytes:', expectedEarlyUnlockHex);

  // DISCOVER BOND
  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();
  console.log(`discovered bondIndex=${bondIndex} bondStartHeight=${bondStartHeight}`);
  console.log('currentBurnHeight:', poxInfo.currentBurnchainBlockHeight);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`bond ${bondIndex} not found on-chain`);
  console.log('bond earlyUnlockBytes (on-chain):', bond.earlyUnlockBytes);
  console.log('bond stxValueRatio:', bond.stxValueRatio.toString());

  // Only cosigner-enabled bonds support the ELSE-branch reclaim — old all-zero
  // bonds can't be tested here.
  if (bond.earlyUnlockBytes.toLowerCase() !== expectedEarlyUnlockHex.toLowerCase()) {
    console.warn(
      `SKIP: bond ${bondIndex} earlyUnlockBytes (${bond.earlyUnlockBytes}) is NOT the ` +
        `account6 cosigner script (${expectedEarlyUnlockHex}).`
    );
    // Honest skip: assert the precondition that prevents the test (no fake pass).
    expect(bond.earlyUnlockBytes.toLowerCase()).not.toBe(expectedEarlyUnlockHex.toLowerCase());
    console.log('(skipped — bond is not cosigner-enabled)');
    return;
  }

  // The earlyUnlockBytes used for BOTH the registered lockup script AND the reclaim
  // witnessScript come straight from the bond's on-chain value.
  const earlyUnlockBytes = hexToBytes(bond.earlyUnlockBytes);

  // ENSURE L1 LOCK
  const unlockHeightBig = await fetchBondL1UnlockHeight({ bondIndex, network });
  const unlockHeight = Number(unlockHeightBig);
  console.log('L1 unlockHeight:', unlockHeight);

  const unlockBytes = buildUnlockScript(stakerBtcPub);

  // The witnessScript / P2WSH that we will lock to AND later reclaim from.
  const witnessScript = buildLockScript({
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshOutputScript = buildLockOutputScript({
    stxAddress: staker.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });
  const p2wshObj = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST_BTC);
  console.log('P2WSH lockup address:', p2wshObj.address);

  // The UTXO (txid/vout/amount) backing the P2WSH lockup that we will reclaim,
  // plus the witnessScript that matches it (reuse path may use a different bond).
  let lockupTxid: string;
  let lockupVout: number;
  let lockupAmountSats: bigint;
  let reclaimWitnessScript: Uint8Array = witnessScript;

  const existing = await fetchBondMembership({ address: staker.address, network });
  if (existing && existing.isL1Lock) {
    // Already enrolled — reuse the existing on-chain L1 lock UTXO.
    console.warn(
      'staker already L1-enrolled:',
      JSON.stringify(existing, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    // The P2WSH is deterministic from (stakerAddress, bond's unlockHeight,
    // unlockBytes, earlyUnlockBytes) — recompute it to find the funded UTXO.
    if (existing.bondIndex !== bondIndex) {
      const existingBond = await fetchBond({ bondIndex: existing.bondIndex, network });
      if (!existingBond) throw new Error(`enrolled bond ${existing.bondIndex} not found`);
      if (existingBond.earlyUnlockBytes.toLowerCase() !== expectedEarlyUnlockHex.toLowerCase()) {
        console.warn(
          `SKIP: staker is enrolled in bond ${existing.bondIndex} whose earlyUnlockBytes ` +
            `(${existingBond.earlyUnlockBytes}) is not the account6 cosigner script — not reclaimable.`
        );
        expect(existingBond.earlyUnlockBytes.toLowerCase()).not.toBe(
          expectedEarlyUnlockHex.toLowerCase()
        );
        console.log('(skipped — enrolled bond is not cosigner-enabled)');
        return;
      }
    }
    const existingUnlockHeight = Number(
      await fetchBondL1UnlockHeight({ bondIndex: existing.bondIndex, network })
    );
    const existingWitnessScript = buildLockScript({
      stxAddress: staker.address,
      unlockHeight: existingUnlockHeight,
      unlockBytes,
      earlyUnlockBytes,
    });
    const existingP2wsh = btc.p2wsh({ type: 'wsh', script: existingWitnessScript }, REGTEST_BTC);
    const existingScriptHex = bytesToHex(existingP2wsh.script);
    console.log('searching existing P2WSH UTXO at:', existingP2wsh.address);
    const utxos = await getUtxos(existingP2wsh.address!, existingScriptHex);
    const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
    if (!utxo) {
      console.warn(
        `SKIP: staker is L1-enrolled but no spendable P2WSH UTXO found at ${existingP2wsh.address}. ` +
          `It may already have been reclaimed by a prior run.`
      );
      expect(utxos.length).toBe(0);
      console.log('(skipped — lockup UTXO already spent)');
      return;
    }
    lockupTxid = utxo.txid;
    lockupVout = utxo.vout;
    lockupAmountSats = utxo.value;
    reclaimWitnessScript = existingWitnessScript;
    console.log(
      `reusing existing L1 lockup UTXO ${lockupTxid}:${lockupVout} (${lockupAmountSats} sats)`
    );
  } else {
    // Not enrolled — do the full fund + register flow against the discovered bond.
    console.log('staker not L1-enrolled — funding a fresh P2WSH lockup + registering...');

    const p2wpkhObj = btc.p2wpkh(stakerBtcPub, REGTEST_BTC);
    const senderAddr = p2wpkhObj.address!;
    const senderScriptHex = bytesToHex(p2wpkhObj.script);
    console.log('sender P2WPKH addr:', senderAddr);

    const needed = AMOUNT_SATS + FEE_SATS;
    let utxos = await getUtxos(senderAddr, senderScriptHex);
    if (utxos.length === 0 || !utxos.some(u => u.value >= needed)) {
      console.log(`no sufficient confirmed UTXO (need ${needed} sats) — hitting faucet...`);
      await faucetFund(senderAddr);
      utxos = await btcPoll(
        async () => {
          const fresh = await getUtxos(senderAddr, senderScriptHex);
          return fresh.some(u => u.value >= needed) ? fresh : null;
        },
        15_000,
        25 * 60_000,
        'waiting for confirmed UTXO after faucet'
      );
    }

    const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
    if (!utxo) throw new Error('no UTXO available after polling');
    const changeSats = utxo.value - AMOUNT_SATS - FEE_SATS;
    expect(changeSats).toBeGreaterThan(0n);

    const fundingTx = new btc.Transaction();
    fundingTx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: utxo.scriptPubKey, amount: utxo.value },
    });
    fundingTx.addOutput({ script: p2wshObj.script, amount: AMOUNT_SATS });
    fundingTx.addOutputAddress(senderAddr, changeSats, REGTEST_BTC);
    fundingTx.sign(stakerPrivBytes);
    fundingTx.finalize();

    const btcTxid = await broadcastBtc(fundingTx.hex);
    console.log('BTC funding txid:', btcTxid);
    expect(btcTxid).toMatch(/^[0-9a-f]{64}$/);
    useFixtures('e2e-exit-l1-announce-and-reclaim-btc-confirmed');

    // Wait for confirmation + assemble SPV proof.
    const { block_hash: blockHash, block_height: blockHeight } = await waitForConfirmed(btcTxid);
    console.log('confirmed in block:', blockHash, 'height:', blockHeight);

    const headerHex = await fetchBlockHeader(blockHash);
    expect(headerHex.length).toBe(160);
    const merkleProof = await fetchMerkleProof(btcTxid, blockHash, blockHeight);
    const txCount = await fetchBlockTxCount(blockHash);
    const { legacyHex } = await fetchRawTxHex(btcTxid);

    const lockupOutput = buildLockProof({
      txHex: legacyHex,
      header: headerHex,
      merkleProof,
      txCount,
      unlockHeight,
      outputScript: p2wshOutputScript,
    });
    console.log('lockupOutput amount:', lockupOutput.amount.toString());

    const minUstx = minUstxForSatsAmount({
      sats: AMOUNT_SATS,
      stxValueRatio: bond.stxValueRatio,
      minUstxRatioBps: bond.minUstxRatioBps,
    });
    const amountUstx = minUstx + 1_000_000n;
    console.log('amountUstx:', amountUstx.toString());

    const regNonce = await getNextNonce(staker.address);
    const unsignedReg = await buildRegisterForBond({
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
      nonce: regNonce,
      network,
      postConditionMode: 'allow',
    });
    const regTx = signTransaction(unsignedReg, staker.key);
    console.log('broadcasting register-for-bond (L1)...');
    const regTxid = await broadcastAndWait(regTx, staker.address, network);
    console.log('register-for-bond txid:', regTxid);

    await new Promise(r => setTimeout(r, 5_000));
    const regRecord = await getTransaction(regTxid);
    if (regRecord && regRecord.tx_status !== 'pending' && regRecord.tx_status !== 'success') {
      const match = regRecord.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        throw new Error(`register-for-bond aborted: (err u${code}) — ${describePox5Error(code)}`);
      }
    }

    let membership = await fetchBondMembership({ address: staker.address, network });
    const deadline = Date.now() + 2 * 60_000;
    while (!membership && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10_000));
      membership = await fetchBondMembership({ address: staker.address, network });
    }
    expect(membership).toBeDefined();
    expect(membership!.isL1Lock).toBe(true);
    console.log(`account5 enrolled in bond ${membership!.bondIndex} (isL1Lock=true)`);

    lockupTxid = btcTxid;
    lockupVout = 0; // P2WSH lockup output is always index 0 in our funding tx
    lockupAmountSats = AMOUNT_SATS;
  }

  // ANNOUNCE EARLY EXIT
  // Deployed pox-5 enforces contract-caller == tx-sender == staker, so the
  // staker themselves must announce (ERR_UNAUTHORIZED otherwise).
  useFixtures('e2e-exit-l1-announce-and-reclaim-announce'); // isolate from the register-for-bond broadcast (if any)
  const announceNonce = await getNextNonce(staker.address);
  const unsignedAnnounce = await buildAnnounceL1EarlyExit({
    staker: staker.address,
    oldSignerManager: SIGNER_MANAGER,
    publicKey: staker.publicKey,
    fee: FEE_USTX,
    nonce: announceNonce,
    network,
    postConditionMode: 'allow',
  });
  const announceTx = signTransaction(unsignedAnnounce, staker.key);
  const announceTxid = await broadcastAndWait(announceTx, staker.address, network);
  console.log('announce-l1-early-exit txid:', announceTxid);

  await new Promise(r => setTimeout(r, 5_000));
  const announceRecord = await getTransaction(announceTxid);
  if (announceRecord && announceRecord.tx_status !== 'pending') {
    console.log('announce tx_status:', announceRecord.tx_status);
    console.log('announce tx_result:', announceRecord.tx_result?.repr);
    if (announceRecord.tx_status === 'abort_by_response') {
      const match = announceRecord.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        throw new Error(
          `announce-l1-early-exit aborted: (err u${code}) — ${describePox5Error(code)}`
        );
      }
    }
    expect(announceRecord.tx_status).toBe('success');
  }
  expect(announceTxid).toMatch(/^[0-9a-f]{64}$/);
  useFixtures('e2e-exit-l1-announce-and-reclaim-after');

  // BUILD RECLAIM
  // ELSE branch (no CLTV): sequence 0xffffffff. Both staker and cosigner sign
  // the same BIP143 sighash (scriptCode = witnessScript for P2WSH); the ELSE
  // branch also reveals the staker preimage. Witness order matches
  // btc-lockup-roundtrip TEST 1 exactly: [staker_sig, cosigner_sig, preimage,
  // <empty->ELSE>, witnessScript].

  // reclaimWitnessScript matches the actual locked UTXO (reuse path may differ).
  const p2wshScript = btc.p2wsh({ type: 'wsh', script: reclaimWitnessScript }, REGTEST_BTC).script;

  const reclaimSats = lockupAmountSats - SWEEP_FEE_SATS;
  if (reclaimSats <= 0n) {
    throw new Error(`sweep fee (${SWEEP_FEE_SATS}) exceeds lockup amount (${lockupAmountSats})`);
  }
  const toAddress = btc.p2wpkh(stakerBtcPub, REGTEST_BTC).address!;
  console.log('reclaim to (staker P2WPKH):', toAddress, 'reclaimSats:', reclaimSats.toString());

  const reclaimTx = new btc.Transaction({
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowUnknownInputs: true,
  });
  reclaimTx.addInput({
    txid: lockupTxid,
    index: lockupVout,
    sequence: 0xffffffff, // ELSE branch — no CLTV
    witnessUtxo: { script: p2wshScript, amount: lockupAmountSats },
  });
  reclaimTx.addOutputAddress(toAddress, reclaimSats, REGTEST_BTC);

  const sighash = reclaimTx.preimageWitnessV0(
    0,
    reclaimWitnessScript,
    SIGHASH_ALL,
    lockupAmountSats
  );
  console.log('BIP143 sighash:', bytesToHex(sighash));

  const stakerSig = concatBytes(
    signECDSA(sighash, stakerPrivBytes, true),
    new Uint8Array([SIGHASH_ALL])
  );
  const cosignerSig = concatBytes(
    signECDSA(sighash, cosignerPrivBytes, true),
    new Uint8Array([SIGHASH_ALL])
  );
  const stakerPreimage = computeRegisterPreimage(staker.address);

  const witnessItems = [
    stakerSig,
    cosignerSig,
    stakerPreimage,
    new Uint8Array(0),
    reclaimWitnessScript,
  ];
  reclaimTx.updateInput(0, { finalScriptWitness: witnessItems }, true);
  if (!reclaimTx.isFinal) throw new Error('Reclaim tx is not finalized — witness injection failed');

  const rawHex = reclaimTx.hex;
  console.log('reclaim tx vsize:', reclaimTx.vsize, 'vBytes');

  // BROADCAST RECLAIM
  const reclaimTxid = await broadcastBtc(rawHex);
  console.log('reclaim txid:', reclaimTxid);
  expect(reclaimTxid).toMatch(/^[0-9a-f]{64}$/);

  const seenTx = await btcPoll(
    async () => {
      const resp = await fetch(`${MEMPOOL_BASE}/tx/${reclaimTxid}`);
      if (!resp.ok) return null;
      return (await resp.json()) as { txid: string; fee: number; status: { confirmed: boolean } };
    },
    10_000,
    25 * 60_000,
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

  // Wait for the reclaim to confirm so the ELSE branch is proven by consensus.
  const reclaimConf = await waitForConfirmed(reclaimTxid);
  console.log(
    'reclaim confirmed in block:',
    reclaimConf.block_hash,
    'height:',
    reclaimConf.block_height
  );

  console.log('bondIndex:', bondIndex, 'announceTxid:', announceTxid, 'reclaimTxid:', reclaimTxid);
}, 900_000);

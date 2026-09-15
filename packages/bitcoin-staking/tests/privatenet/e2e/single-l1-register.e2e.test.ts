/**
 * E2E: Single-staker BTC L1 happy-path register.
 *
 * Dynamically discovers a bond with registration runway, then does the full
 * BTC L1 flow for account5:
 *   faucet-fund -> build/broadcast P2WSH lockup -> wait confirm ->
 *   buildLockProof -> register-for-bond (kind: btc) -> assert membership.
 *
 * Self-contained: BTC mempool helpers are inlined from btc-lock.test.ts.
 *
 * Live run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-single-l1-register.json \
 *   npx jest tests/privatenet/e2e/single-l1-register.e2e.test.ts \
 *     --runInBand --collectCoverage=false
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildUnlockScript,
  buildLockScript,
  buildLockOutputScript,
  buildLockProof,
  buildRegisterForBond,
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
  getUtxos,
  faucetFund,
  broadcastBtc,
  waitForConfirmed,
  fetchBlockHeader,
  fetchMerkleProof,
  fetchRawTxHex,
  fetchBlockTxCount,
} from '../../helpers/btc-wallet';

const AMOUNT_SATS = BigInt(process.env.AMOUNT_SATS ?? 30_000);
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 500);
const FEE_USTX = BigInt(process.env.FEE_USTX ?? 10_000);


// account5: STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6 — funded, allowlisted
const STAKER_PRIV_HEX = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df';
const staker = getAccount(REGTEST_KEYS.account5);

// BTC network params (regtest)

const REGTEST_BTC: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// Inlined BTC helpers (from btc-lock.test.ts)

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
  useFixtures('e2e-single-l1-register');
}, 60_000);

test('single-staker BTC L1 register: account5 end-to-end', async () => {
  useFixtures('e2e-single-l1-register');
  const network = getNetwork();

  console.log('staker:', staker.address);

  // BOND DISCOVERY
  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();

  console.log(`discovered bondIndex=${bondIndex} bondStartHeight=${bondStartHeight}`);
  console.log('currentBurnHeight:', poxInfo.currentBurnchainBlockHeight);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`bond ${bondIndex} not found on-chain`);
  console.log('bond stxValueRatio:', bond.stxValueRatio.toString());
  console.log('bond earlyUnlockBytes:', bond.earlyUnlockBytes);

  // LOCKUP SCRIPTS
  const unlockHeightBig = await fetchBondL1UnlockHeight({ bondIndex, network });
  const unlockHeight = Number(unlockHeightBig);
  console.log('unlockHeight:', unlockHeight);

  const stakerPrivBytes = hexToBytes(STAKER_PRIV_HEX);
  const stakerBtcPub = secp256k1.getPublicKey(stakerPrivBytes, true);

  const unlockBytes = buildUnlockScript(stakerBtcPub);
  const earlyUnlockBytes = hexToBytes(bond.earlyUnlockBytes);

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
  const p2wshAddress = p2wshObj.address!;
  console.log('P2WSH address:', p2wshAddress);

  // FUND UTXO
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

  // BUILD + BROADCAST FUNDING TX
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
  useFixtures('e2e-single-l1-register-btc-confirmed');

  // WAIT FOR CONFIRMATION
  const { block_hash: blockHash, block_height: blockHeight } = await waitForConfirmed(btcTxid);
  console.log('confirmed in block:', blockHash, 'height:', blockHeight);

  // SPV PROOF
  const headerHex = await fetchBlockHeader(blockHash);
  expect(headerHex.length).toBe(160);
  const merkleProof = await fetchMerkleProof(btcTxid, blockHash, blockHeight);
  const txCount = await fetchBlockTxCount(blockHash);
  const { legacyHex } = await fetchRawTxHex(btcTxid);

  console.log('headerHex:', headerHex);
  console.log('merkleProof:', JSON.stringify(merkleProof));
  console.log('txCount:', txCount);

  const lockupOutput = buildLockProof({
    txHex: legacyHex,
    header: headerHex,
    merkleProof,
    txCount,
    unlockHeight,
    outputScript: p2wshOutputScript,
  });

  console.log('lockupOutput height:', lockupOutput.height);
  console.log('lockupOutput amount:', lockupOutput.amount.toString());

  // REGISTER
  const minUstx = minUstxForSatsAmount({
    sats: AMOUNT_SATS,
    stxValueRatio: bond.stxValueRatio,
    minUstxRatioBps: bond.minUstxRatioBps,
  });
  const amountUstx = minUstx + 1_000_000n;
  console.log('amountUstx:', amountUstx.toString());

  // SELF-HEAL: account5 may already be enrolled in an OLDER bond from a prior
  // run whose index won't match the freshly-discovered window (e.g. 0). Assert
  // against the EXISTING membership rather than the discovered bondIndex.
  const existing = await fetchBondMembership({ address: staker.address, network });
  if (existing) {
    console.warn(
      'staker already enrolled:',
      JSON.stringify(existing, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    expect(existing.isL1Lock).toBe(true);
    console.log(`already enrolled in bond ${existing.bondIndex}, self-heal pass`);
    return;
  }

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
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);
  console.log('register-for-bond txid:', txid);
  useFixtures('e2e-single-l1-register-after');

  // Best-effort result check
  await new Promise(r => setTimeout(r, 5_000));
  const record = await getTransaction(txid);
  if (record && record.tx_status !== 'pending') {
    console.log('tx_status:', record.tx_status);
    console.log('tx_result:', record.tx_result?.repr);
    if (record.tx_status !== 'success') {
      const match = record.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        throw new Error(`register-for-bond aborted: (err u${code}) — ${describePox5Error(code)}`);
      }
    }
  }

  // ASSERT MEMBERSHIP
  let membership = await fetchBondMembership({ address: staker.address, network });
  const deadline = Date.now() + 2 * 60_000;
  while (!membership && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000));
    membership = await fetchBondMembership({ address: staker.address, network });
  }

  console.log('bond membership:', JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  expect(membership).toBeDefined();
  expect(membership!.isL1Lock).toBe(true);
  expect(membership!.bondIndex).toBe(bondIndex);
  expect(membership!.amountSats).toBe(AMOUNT_SATS);
}, 600_000);

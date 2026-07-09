/**
 * E2E: account5 and account6 each fund a P2WSH L1 lockup and register into
 * the SAME dynamically-discovered bond. Asserts fetchTotalSbtcStakedForBond
 * increases by exactly the sum of locked sats, and each membership shows
 * isL1Lock=true. Stakers run sequentially to avoid nonce/UTXO races.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-multi-l1-pool.json \
 *     npx jest tests/privatenet/e2e/multi-l1-pool.e2e.test.ts \
 *       --runInBand --collectCoverage=false
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
  fetchTotalSbtcStakedForBond,
  minUstxForSatsAmount,
} from '../../../src';
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

const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const AMOUNT_SATS = BigInt(process.env.AMOUNT_SATS ?? 30_000);
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 500);
const FEE_USTX = BigInt(process.env.FEE_USTX ?? 10_000);

const REGTEST_NET: typeof btc.NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// Raw 32-byte priv hex (without the compression byte suffix)
const STAKER_RAW_KEYS: Record<string, string> = {
  account5: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df',
  account6: '5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0',
  account7: '16226f674796712dfbd53bf402304579b8b6d04d4bed4d466bf84ce6db973d44',
};

interface StakerDef {
  name: string;
  rawPrivHex: string; // 32 bytes hex (no compression suffix)
  account: ReturnType<typeof getAccount>;
}

const STAKERS: StakerDef[] = (['account5', 'account6'] as const).map(name => {
  const rawPrivHex = STAKER_RAW_KEYS[name];
  // getAccount expects 66-char hex (32 bytes + 0x01 compression marker)
  const account = getAccount(REGTEST_KEYS[name as keyof typeof REGTEST_KEYS]);
  return { name, rawPrivHex, account };
});

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

interface LockupResult {
  amountSats: bigint;
  txid: string;
}

async function doL1LockupAndRegister(
  staker: StakerDef,
  bondIndex: number,
  unlockHeight: number,
  earlyUnlockBytesHex: string,
  stxValueRatio: bigint,
  minUstxRatioBps: number
): Promise<LockupResult> {
  const network = getNetwork();
  useFixtures(`e2e-multi-l1-pool-${staker.name}`); // isolate each staker's BTC + register broadcasts
  const priv = hexToBytes(staker.rawPrivHex);
  const pub = secp256k1.getPublicKey(priv, true);

  console.log(`[${staker.name}] starting L1 lockup+register, bond=${bondIndex}`);

  // SELF-HEAL
  // If already enrolled (prior run, possibly in an older bond), skip BTC-lock +
  // register entirely — those sats are already counted in totalBefore, so this
  // contributes 0 to the aggregate delta. Do not assert bondIndex matches.
  const existingMembership = await fetchBondMembership({
    address: staker.account.address,
    network,
  });
  if (existingMembership) {
    console.log(
      `[${staker.name}] already enrolled (bondIndex=${existingMembership.bondIndex}, isL1Lock=${existingMembership.isL1Lock}), skipping`
    );
    expect(existingMembership.isL1Lock).toBe(true);
    return { amountSats: 0n, txid: '' };
  }

  // BUILD SCRIPTS
  const unlockBytes = buildUnlockScript(pub);
  const earlyUnlockBytes = hexToBytes(earlyUnlockBytesHex);

  const witnessScript = buildLockScript({
    stxAddress: staker.account.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });

  const outputScript = buildLockOutputScript({
    stxAddress: staker.account.address,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  });

  const p2wshObj = btc.p2wsh({ type: 'wsh', script: witnessScript }, REGTEST_NET);
  const p2wshAddress = p2wshObj.address!;
  const p2wpkhObj = btc.p2wpkh(pub, REGTEST_NET);
  const senderAddr = p2wpkhObj.address!;
  const senderScriptHex = bytesToHex(p2wpkhObj.script);

  console.log(`[${staker.name}] P2WSH address: ${p2wshAddress}`);
  console.log(`[${staker.name}] P2WPKH address: ${senderAddr}`);

  // FUND UTXO
  const needed = AMOUNT_SATS + FEE_SATS;
  let utxos = await getUtxos(senderAddr, senderScriptHex);
  if (!utxos.some(u => u.value >= needed)) {
    console.log(`[${staker.name}] no sufficient UTXO — hitting faucet...`);
    await faucetFund(senderAddr);
    utxos = await poll(
      async () => {
        const fresh = await getUtxos(senderAddr, senderScriptHex);
        return fresh.some(u => u.value >= needed) ? fresh : null;
      },
      15_000,
      25 * 60_000,
      `[${staker.name}] waiting for confirmed UTXO after faucet`
    );
  }

  const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) throw new Error(`[${staker.name}] no UTXO available`);

  const changeSats = utxo.value - AMOUNT_SATS - FEE_SATS;
  expect(changeSats).toBeGreaterThan(0n);

  // SIGN + BROADCAST FUNDING TX
  const fundingTx = new btc.Transaction();
  fundingTx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { script: utxo.scriptPubKey, amount: utxo.value },
  });
  fundingTx.addOutput({ script: p2wshObj.script, amount: AMOUNT_SATS });
  fundingTx.addOutputAddress(senderAddr, changeSats, REGTEST_NET);
  fundingTx.sign(priv);
  fundingTx.finalize();

  const btcTxid = await broadcastBtc(fundingTx.hex);
  console.log(`[${staker.name}] BTC funding txid: ${btcTxid}`);
  expect(btcTxid).toMatch(/^[0-9a-f]{64}$/);

  // CONFIRM + SPV PROOF
  const { block_hash: blockHash, block_height: blockHeight } = await waitForConfirmed(btcTxid);
  console.log(`[${staker.name}] confirmed in block ${blockHeight} (${blockHash})`);

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
    outputScript,
  });

  const minUstx = minUstxForSatsAmount({ sats: AMOUNT_SATS, stxValueRatio, minUstxRatioBps });
  const amountUstx = minUstx + 1_000_000n;

  // REGISTER FOR BOND
  const nonce = await getNextNonce(staker.account.address);
  const unsigned = await buildRegisterForBond({
    bondIndex,
    signerManager: SIGNER_MANAGER,
    amountUstx,
    lockup: {
      kind: 'btc',
      outputs: [lockupOutput],
      unlockBytes,
    },
    publicKey: staker.account.publicKey,
    fee: FEE_USTX,
    nonce,
    network,
    postConditionMode: 'allow',
  });

  const signedTx = signTransaction(unsigned, staker.account.key);
  const stacksTxid = await broadcastAndWait(signedTx, staker.account.address, network);
  console.log(`[${staker.name}] register-for-bond txid: ${stacksTxid}`);

  // Brief delay lets the extended API index the tx
  await new Promise(r => setTimeout(r, 5_000));
  const record = await getTransaction(stacksTxid);
  if (record && record.tx_status !== 'pending') {
    console.log(
      `[${staker.name}] tx_status: ${record.tx_status}, result: ${record.tx_result?.repr}`
    );
    if (record.tx_status !== 'success' && record.tx_status !== 'pending') {
      const match = record.tx_result?.repr?.match(/^\(err u(\d+)\)$/);
      if (match) {
        const code = Number(match[1]);
        throw new Error(
          `[${staker.name}] register-for-bond aborted: (err u${code}) — ${describePox5Error(code)}`
        );
      }
    }
  }

  useFixtures(`e2e-multi-l1-pool-${staker.name}-after`); // post-register membership differs from pre
  let membership = await fetchBondMembership({ address: staker.account.address, network });
  const deadline = Date.now() + 2 * 60_000;
  while (!membership && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000));
    membership = await fetchBondMembership({ address: staker.account.address, network });
  }

  console.log(
    `[${staker.name}] bond membership: ${JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`
  );
  expect(membership).toBeDefined();
  expect(membership!.bondIndex).toBe(bondIndex);
  expect(membership!.isL1Lock).toBe(true);
  console.log(`[${staker.name}] registered successfully`);

  return { amountSats: AMOUNT_SATS, txid: stacksTxid };
}

beforeAll(async () => {
  useFixtures('e2e-multi-l1-pool');
}, 60_000);

test('multi-staker BTC L1 pooling: account5+6 all register into the same bond', async () => {
  useFixtures('e2e-multi-l1-pool');
  const network = getNetwork();

  // DISCOVER BOND
  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();
  console.log(
    `discovered bondIndex=${bondIndex} bondStartHeight=${bondStartHeight} currentBurn=${poxInfo.currentBurnchainBlockHeight}`
  );

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw new Error(`bond ${bondIndex} not found on-chain`);
  console.log(
    'bond params:',
    JSON.stringify({
      bondIndex: bond.bondIndex,
      stxValueRatio: bond.stxValueRatio.toString(),
      minUstxRatioBps: bond.minUstxRatioBps,
    })
  );

  const unlockHeightBig = await fetchBondL1UnlockHeight({ bondIndex, network });
  const unlockHeight = Number(unlockHeightBig);
  console.log('L1 unlock height:', unlockHeight);

  const totalBefore = await fetchTotalSbtcStakedForBond({ bondIndex, network });
  console.log(`totalSbtcStakedForBond BEFORE: ${totalBefore.toString()} sats`);

  // STAKERS (sequential to avoid nonce/UTXO contention)
  const results: LockupResult[] = [];
  for (const staker of STAKERS) {
    const result = await doL1LockupAndRegister(
      staker,
      bondIndex,
      unlockHeight,
      bond.earlyUnlockBytes,
      bond.stxValueRatio,
      bond.minUstxRatioBps
    );
    results.push(result);
  }

  useFixtures('e2e-multi-l1-pool-after');
  const totalAfter = await fetchTotalSbtcStakedForBond({ bondIndex, network });
  console.log(`totalSbtcStakedForBond AFTER: ${totalAfter.toString()} sats`);

  const expectedDelta = results.reduce((sum, r) => sum + r.amountSats, 0n);
  const actualDelta = totalAfter - totalBefore;
  console.log(`expectedDelta=${expectedDelta} actualDelta=${actualDelta}`);

  expect(actualDelta).toBe(expectedDelta);

  // Only stakers that registered this run (amountSats > 0) are asserted to be
  // in the freshly-discovered bond; a self-healed staker may be in an older one.
  for (let i = 0; i < STAKERS.length; i++) {
    const staker = STAKERS[i];
    const registeredThisRun = results[i].amountSats > 0n;
    const membership = await fetchBondMembership({ address: staker.account.address, network });
    expect(membership).toBeDefined();
    expect(membership!.isL1Lock).toBe(true);
    if (registeredThisRun) {
      expect(membership!.bondIndex).toBe(bondIndex);
    }
    console.log(
      `[${staker.name}] membership verified (bondIndex=${membership!.bondIndex}, isL1Lock=${membership!.isL1Lock}, registeredThisRun=${registeredThisRun})`
    );
  }
}, 720_000);

/**
 * Slice 4 tail of the contract-principal-staking suite (specs/contract-principal-staking.md):
 * a lockup that COMMITS A CONTRACT PRINCIPAL as its staker is spendable end-to-end.
 *
 * Mirrors reclaim.test.ts's locktime path, but `stxAddress` is a CONTRACT principal
 * (`<addr>.<name>`), so `buildLockScript` commits the `0x06` consensus buffer that
 * commit b726a1e6 enabled. This proves the SDK's lock-script builder and the P2WSH
 * reclaim work for a contract-principal commitment in a real fund → reclaim flow —
 * not just at the byte-encoding layer (tests/locking.test.ts).
 *
 * The BTC unlock key is orthogonal to the Stacks staker principal: a contract has
 * no key, and the design never needs one from the staker — whoever holds the BTC
 * key (here a fixed derived key) signs the reclaim. So no on-chain contract is
 * required; this is pure bitcoind (build → sign → finalize → broadcast).
 */
// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@stacks/common';
import {
  buildLockOutputScript,
  buildLockScript,
  buildReclaim,
  buildUnlockScript,
  btcNetworkFrom,
  computeReclaimSighash,
  finalizeReclaim,
  signReclaim,
} from '../../../src';
import type { Utxo } from '../../../src';
import { getAccount } from '../regtest';
import {
  findVoutByScript,
  getBlockCount,
  getRawTransactionVerbose,
  sendRawTransaction,
  sendToAddress,
} from '../../helpers/btc';
import { waitForFulfilled } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { ENV } from '../../helpers/utils';
import { derivePubKey, privKeyToP2wpkhAddress } from '../../helpers/btc-wallet';

jest.setTimeout(120_000);

const btcNetworkName = ENV.NETWORK;

const STAKER_PRIV = hexToBytes('c1c2c3c4c5c6c7c8c9cacbcccdcecf0102030405060708090a0b0c0d0e0f1001');
const STAKER_PUB = derivePubKey(STAKER_PRIV);
const COSIGNER_PUB = derivePubKey(
  hexToBytes('d1d2d3d4d5d6d7d8d9dadbdcdddedf1112131415161718191a1b1c1d1e1f2001')
);
// The committed staker is a CONTRACT principal — the whole point of this test.
const CONTRACT_STAKER = `${getAccount(bytesToHex(STAKER_PRIV) + '01').address}.some-vault`;
const OP_CHECKSIG = 0xac;
const SWEEP_ADDR = privKeyToP2wpkhAddress(STAKER_PRIV);

const LOCK_SATS = 20_000;
const FEE_SATS = 1000n;

function buildEarlyUnlockCheckSig(cosignerPub: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 33 + 1);
  out[0] = 33;
  out.set(cosignerPub, 1);
  out[34] = OP_CHECKSIG;
  return out;
}

test('a contract-principal-committed lockup is reclaimable (locktime path)', async () => {
  useFixtures('wrapper-reclaim-fund');

  const tip = await getBlockCount();
  const unlockHeight = tip - 10; // already past → CLTV spendable now

  const unlockBytes = buildUnlockScript(STAKER_PUB);
  const earlyUnlockBytes = buildEarlyUnlockCheckSig(COSIGNER_PUB);
  const lockArgs = {
    stxAddress: CONTRACT_STAKER, // ← contract principal (0x06 consensus buffer)
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes,
  };
  const lockScript = buildLockScript(lockArgs);
  const outputScript = buildLockOutputScript(lockArgs);
  const p2wshAddr = btc.p2wsh(
    { type: 'wsh', script: lockScript },
    btcNetworkFrom(btcNetworkName)
  ).address!;
  console.log('P2WSH for contract-principal staker:', p2wshAddr);

  const fundTxid = await sendToAddress(p2wshAddr, LOCK_SATS / 1e8);
  const found = await waitForFulfilled(() => findVoutByScript(fundTxid, bytesToHex(outputScript)));
  const utxo: Utxo = {
    txid: found.txid,
    vout: found.vout,
    value: found.value,
    scriptPubKey: hexToBytes(found.scriptPubKeyHex),
  };

  const tx = buildReclaim({
    path: 'locktime',
    utxo,
    network: btcNetworkName,
    output: { address: SWEEP_ADDR, feeSats: FEE_SATS },
    lockScript,
  });
  const sighash = computeReclaimSighash(tx);
  tx.updateInput(0, { partialSig: [[STAKER_PUB, signReclaim(sighash, STAKER_PRIV)]] });
  const { txHex, txid } = finalizeReclaim({ path: 'locktime', tx });

  useFixtures('wrapper-reclaim-sweep');
  const broadcastTxid = await sendRawTransaction(txHex);
  expect(broadcastTxid).toBe(txid);

  const confirmed = await waitForFulfilled(async () => {
    const raw = await getRawTransactionVerbose(broadcastTxid);
    if (!raw.confirmations || raw.confirmations < 1) throw 'not confirmed yet';
    return raw;
  });
  expect(confirmed.txid).toBe(broadcastTxid);
});

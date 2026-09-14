/**
 * Send real BTC on the private regtest network (@scure/btc-signer, P2WPKH).
 * Finds a confirmed UTXO (faucets + polls if none), then builds/signs/broadcasts.
 *
 * Composable action — configure via ENV (defaults send 0.1 BTC account5->account6):
 *   BTC_FROM_PRIV   sender private key, 64-hex (default: account5)
 *   TO_ADDRESS      recipient bcrt1 address (default: account6)
 *   AMOUNT_SATS     amount to send                       (default: 10000000)
 *   FEE_SATS        flat fee                             (default: 300)
 *
 * Run (defaults):
 *   NETWORK=testnet npx jest tests/privatenet/actions/btc-send.test.ts \
 *     --runInBand --collectCoverage=false --verbose
 */

// @ts-ignore — @scure/btc-signer is ESM; ts-jest transforms it via jest.config.js
import * as btc from '@scure/btc-signer';
// @ts-ignore — same ESM transform
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { useFixtures } from '../../helpers/mock';
import { getUtxos, faucetFund, broadcastBtc, MEMPOOL_BASE } from '../../helpers/btc-wallet';

jest.setTimeout(30 * 60_000);

const REGTEST = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

// Sender priv (64-hex). Default: account5. Override with BTC_FROM_PRIV.
const SENDER_PRIV_HEX =
  process.env.BTC_FROM_PRIV ?? 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df';
// Recipient. Default: account6. Override with TO_ADDRESS.
const RECIPIENT_ADDR = process.env.TO_ADDRESS ?? 'bcrt1qr5g5smqp2650kgxz64664vs2hwpkwpq7nm4gm4';

const SEND_SATS = BigInt(process.env.AMOUNT_SATS ?? 10_000_000); // default 0.1 BTC
const FEE_SATS = BigInt(process.env.FEE_SATS ?? 300); // 1 sat/vB × ~141 vB rounded up

/** @internal */
function senderSpend() {
  const priv = hexToBytes(SENDER_PRIV_HEX);
  const pub = secp256k1.getPublicKey(priv, true);
  const spend = btc.p2wpkh(pub, REGTEST);
  return { priv, pub, spend };
}

/** @internal */
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

beforeAll(() => useFixtures('btc-send'));

test('send 0.1 BTC from account5 to account6 on regtest', async () => {
  const { priv, spend } = senderSpend();
  const senderAddr = spend.address!;
  const senderScriptHex = bytesToHex(spend.script);

  console.log('sender addr:', senderAddr);
  console.log('recipient addr:', RECIPIENT_ADDR);
  console.log('sender scriptPubKey:', senderScriptHex);

  // FIND UTXO
  let utxos = await getUtxos(senderAddr, senderScriptHex);
  console.log(
    'initial UTXOs:',
    utxos.map(u => `${u.txid}:${u.vout} (${u.value} sats)`)
  );

  if (utxos.length === 0 || !utxos.some(u => u.value >= SEND_SATS + FEE_SATS)) {
    console.log('no spendable confirmed UTXO — hitting faucet...');
    await faucetFund(senderAddr);

    utxos = await poll(
      async () => {
        const fresh = await getUtxos(senderAddr, senderScriptHex);
        const ok = fresh.filter(u => u.value >= SEND_SATS + FEE_SATS);
        return ok.length > 0 ? fresh : null;
      },
      15_000, // 15 s between polls (mempool API is rate-limited)
      25 * 60_000, // 25 min total (block times on this regtest can be slow)
      'waiting for confirmed UTXO after faucet'
    );
    console.log(
      'UTXOs after funding:',
      utxos.map(u => `${u.txid}:${u.vout} (${u.value} sats)`)
    );
  }

  const utxo = utxos.sort((a, b) => (b.value > a.value ? 1 : -1))[0];
  if (!utxo) throw new Error('no UTXO after polling');

  const changeSats = utxo.value - SEND_SATS - FEE_SATS;
  expect(changeSats).toBeGreaterThan(0n);

  console.log('spending UTXO:', `${utxo.txid}:${utxo.vout}`, `(${utxo.value} sats)`);
  console.log('send:', SEND_SATS.toString(), 'sats');
  console.log('fee:', FEE_SATS.toString(), 'sats');
  console.log('change:', changeSats.toString(), 'sats');

  // BUILD + SIGN
  const tx = new btc.Transaction();
  tx.addInput({
    txid: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: utxo.scriptPubKey,
      amount: utxo.value,
    },
  });
  tx.addOutputAddress(RECIPIENT_ADDR, SEND_SATS, REGTEST);
  tx.addOutputAddress(senderAddr, changeSats, REGTEST);

  tx.sign(priv);
  tx.finalize();

  const rawHex = tx.hex;
  console.log('tx size:', rawHex.length / 2, 'bytes');
  console.log('tx hex:', rawHex);

  // BROADCAST
  const txid = await broadcastBtc(rawHex);
  console.log('broadcast txid:', txid);

  expect(txid).toMatch(/^[0-9a-f]{64}$/);

  // CONFIRM VISIBLE
  const seenTx = await poll(
    async () => {
      const resp = await fetch(`${MEMPOOL_BASE}/tx/${txid}`);
      if (!resp.ok) return null;
      return (await resp.json()) as { txid: string; fee: number; status: { confirmed: boolean } };
    },
    5_000, // 5 s
    2 * 60_000, // 2 min
    `tx ${txid} visible in mempool`
  );

  console.log(
    'mempool tx:',
    JSON.stringify({ txid: seenTx.txid, fee: seenTx.fee, confirmed: seenTx.status.confirmed })
  );

  expect(seenTx.txid).toBe(txid);
  expect(seenTx.fee).toBeGreaterThan(0);
});

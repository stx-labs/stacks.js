/**
 * ACTION: send STX from one account to another (live-only).
 *
 * Signs with FROM_KEY (raw hex private key), sends AMOUNT_USTX to TO_ADDRESS on
 * the configured net, waits for confirmation. Skipped under replay. Run live with
 * RECORD=1:
 *
 *   NETWORK=testnet NETWORK_ID=2147483653 STACKS_API=https://api.testnet-pox5.hiro.so \
 *   STACKS_TX_TIMEOUT=300000 BITCOIN_TX_TIMEOUT=300000 POLL_INTERVAL=10000 \
 *   FROM_KEY=<hex> TO_ADDRESS=ST... AMOUNT_USTX=1000000 RECORD=1 \
 *   npx jest tests/actions/transfer-stx --runInBand --collectCoverage=false
 */
import { getAccount } from '../regtest/regtest';
import { getNetwork, isMocking } from '../helpers/utils';
import { fundStx, getNextNonce, getStxBalance } from '../helpers/wait';

(isMocking ? describe.skip : describe)('action: transfer-stx (live)', () => {
  it('sends AMOUNT_USTX from FROM_KEY to TO_ADDRESS', async () => {
    const fromKey = process.env.FROM_KEY;
    const to = process.env.TO_ADDRESS;
    const amount = BigInt(process.env.AMOUNT_USTX ?? '0');
    if (!fromKey || !to || amount <= 0n) {
      throw new Error('set FROM_KEY=<hex>, TO_ADDRESS=ST..., AMOUNT_USTX=<uSTX>');
    }

    const funder = getAccount(fromKey);
    const network = getNetwork();
    const nonce = await getNextNonce(funder.address);
    console.log(`[transfer-stx] ${funder.address} -> ${to}: ${amount} uSTX (nonce ${nonce})`);

    const txid = await fundStx({ funder, recipient: to, amountUstx: amount, nonce, network });
    const balance = await getStxBalance(to);
    console.log(`##RESULT## ${JSON.stringify({ txid, from: funder.address, to, balance: balance.toString() })}`);
    expect(balance).toBeGreaterThanOrEqual(amount);
  });
});

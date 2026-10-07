/**
 * ACTION: faucet-fund an STX address (live-only).
 *
 * Hits the configured net's STX faucet for ADDRESS, waits for confirmation, and
 * prints the resulting balance. Skipped under replay (no fixtures — action-tests
 * are live). Run live with RECORD=1 (disables the fetch mock):
 *
 *   NETWORK=testnet NETWORK_ID=2147483653 STACKS_API=https://api.testnet-pox5.hiro.so \
 *   STACKS_TX_TIMEOUT=300000 BITCOIN_TX_TIMEOUT=300000 POLL_INTERVAL=10000 \
 *   ADDRESS=ST... RECORD=1 npx jest tests/actions/faucet-stx --runInBand --collectCoverage=false
 */
import { isMocking } from '../helpers/utils';
import { getStxBalance, waitForTransaction } from '../helpers/wait';
import { stxFaucet } from '../helpers/wallet';

(isMocking ? describe.skip : describe)('action: faucet-stx (live)', () => {
  it('faucet-funds ADDRESS and reports the balance', async () => {
    const address = process.env.ADDRESS;
    if (!address) throw new Error('set ADDRESS=ST... to faucet-fund');

    const txid = await stxFaucet(address);
    await waitForTransaction(txid);
    const balance = await getStxBalance(address);
    console.log(`##RESULT## ${JSON.stringify({ address, txid, balance: balance.toString() })}`);
    expect(balance).toBeGreaterThan(0n);
  });
});

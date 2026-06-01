import { getNewAddress, getReceivedByAddress, sendToAddress } from '../../helpers/btc';
import { timeout } from '../../helpers/utils';

jest.setTimeout(120_000);

const WALLET = 'main'; // mining-funded legacy wallet created by the regtest env
const AMOUNT = 0.5; // BTC

test('bitcoin transfer via rpc', async () => {
  const recipient = await getNewAddress(WALLET, 'e2e-recipient');
  console.log('recipient', recipient);

  const receivedBefore = await getReceivedByAddress(WALLET, recipient, 0);
  expect(receivedBefore).toBe(0);

  const txid = await sendToAddress(WALLET, recipient, AMOUNT);
  console.log('btc txid', txid);

  // the env's miner auto-mines; wait for 1 confirmation
  let received = 0;
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    received = await getReceivedByAddress(WALLET, recipient, 1);
    if (received >= AMOUNT) break;
    await timeout(1000);
  }
  expect(received).toBe(AMOUNT);
});

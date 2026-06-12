import { getNewAddress, getReceivedByAddress, sendToAddress } from '../../helpers/btc';
import { waitForFulfilled } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(120_000);

const AMOUNT = 0.5; // BTC

// One fixture file suffices: the before/after balance reads differ in
// `minconf`, so their JSON-RPC fixture keys never collide.
beforeAll(() => { useFixtures('btc-transfer'); });

test('bitcoin transfer via rpc', async () => {
  const recipient = await getNewAddress('e2e-recipient');
  console.log('recipient', recipient);

  expect(await getReceivedByAddress(recipient, 0)).toBe(0);

  const txid = await sendToAddress(recipient, AMOUNT);
  console.log('btc txid', txid);

  // the env's miner auto-mines; wait for 1 confirmation
  const received = await waitForFulfilled(async () => {
    const r = await getReceivedByAddress(recipient, 1);
    if (r < AMOUNT) throw 'not confirmed yet';
    return r;
  });
  expect(received).toBe(AMOUNT);
});

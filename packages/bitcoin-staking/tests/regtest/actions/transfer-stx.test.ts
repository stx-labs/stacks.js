/**
 * STX transfer smoke test — doubles as a "fund a wallet" utility.
 *
 * Defaults: account4 → account5 (both daemon-free, funded on all nets).
 * Override the recipient with STACKS_ADDRESS (this action only — not in the
 * shared ENV global), e.g. to top up an external wallet:
 *
 *   STACKS_ADDRESS=ST… RECORD=1 \
 *     npx jest tests/regtest/actions/transfer-stx.test.ts --runInBand --collectCoverage=false
 *
 * Must be a testnet (ST…) address — the node rejects SP… with BadAddressVersionByte.
 */
import { makeSTXTokenTransfer } from '@stacks/transactions';
import { useFixtures } from '../../helpers/mock';
import { REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getStxBalance } from '../../helpers/wait';

jest.setTimeout(300_000);

const RECIPIENT_ADDRESS = process.env.STACKS_ADDRESS ?? getAccount(REGTEST_KEYS.account5).address;

if (!RECIPIENT_ADDRESS.startsWith('ST')) {
  throw new Error(`expected a testnet (ST…) address, got ${RECIPIENT_ADDRESS}`);
}

const AMOUNT = 1_000_000n; // 1 STX
const FEE = 1_000n;

const network = getNetwork();
const sender = getAccount(REGTEST_KEYS.account4);

beforeAll(() => {
  useFixtures('transfer-stx');
});

test(`transfer ${AMOUNT} ustx: account4 → ${RECIPIENT_ADDRESS}`, async () => {
  const senderBefore = await getStxBalance(sender.address);
  const recipientBefore = await getStxBalance(RECIPIENT_ADDRESS);
  console.log('before', { senderBefore, recipientBefore });
  expect(senderBefore).toBeGreaterThan(AMOUNT + FEE);

  const nonce = await getNextNonce(sender.address);
  const tx = await makeSTXTokenTransfer({
    recipient: RECIPIENT_ADDRESS,
    amount: AMOUNT,
    senderKey: sender.key,
    network,
    fee: FEE,
    nonce,
  });
  // Switch BEFORE the broadcast: its nonce polling shares URLs with the
  // before-reads and would clobber them in the main fixture (latest-wins).
  useFixtures('transfer-stx-after');
  await broadcastAndWait(tx, sender.address, network);

  const senderAfter = await getStxBalance(sender.address);
  const recipientAfter = await getStxBalance(RECIPIENT_ADDRESS);
  console.log('after', { senderAfter, recipientAfter });
  expect(recipientAfter).toBe(recipientBefore + AMOUNT);
  expect(senderAfter).toBe(senderBefore - AMOUNT - FEE);
});

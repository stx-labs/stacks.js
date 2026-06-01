// Live-oriented (RECORD=1 / Docker) — NOT wired for offline replay: this action
// hits the same path `…/pox-5/get-total-sbtc-staked` twice expecting different
// bodies (before vs. after pox-5 activation), and `setApiMocks` keys by path
// only. See "Caveat" in tests/regtest/README.md.
import { fetchTotalSbtcStaked } from '../../../src';
import { getNetwork, regtestReset } from '../../helpers/utils';
import { waitForNetwork, waitForPox5 } from '../../helpers/wait';

const BOOT = 20 * 60_000; // 20 min: fresh chain boot + reach epoch 4.0
jest.setTimeout(BOOT);

const network = getNetwork();

beforeAll(async () => {
  await regtestReset(); // down --volumes + up -d --build → fresh chain
  await waitForNetwork(); // node + pox endpoint responsive (still pre-pox-5)
}, BOOT);

test('pox-5 read-only get-total-sbtc-staked (only after activation)', async () => {
  // Relevance check: before pox-5 activates the read-only call can't succeed
  // (contract not yet published), so the wait below is what makes it work.
  await expect(fetchTotalSbtcStaked({ network })).rejects.toBeDefined();

  await waitForPox5(); // epoch 4.0 / pox-5 active

  const total = await fetchTotalSbtcStaked({ network });
  console.log('total sBTC staked', total);
  expect(total).toBe(0n);
});

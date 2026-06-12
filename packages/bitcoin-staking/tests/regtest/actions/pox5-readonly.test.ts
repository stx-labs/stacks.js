// Recording resets the chain on purpose: the pre-activation error state only
// exists on a fresh chain. Replay never touches Docker.
import { fetchTotalSbtcStaked } from '../../../src';
import { getNetwork, isMocking, networkReset } from '../../helpers/utils';
import { waitForNetwork, waitForPox5 } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';

const BOOT = 5 * 60_000; // fresh chain boot (~150s) + reach epoch 4.0 + margin
jest.setTimeout(BOOT);

const network = getNetwork();

beforeAll(async () => {
  useFixtures('pox5-readonly');
  if (isMocking) return; // replay: fixtures provide both phases, no Docker
  await networkReset(); // NETWORK_WIPE_CMD + NETWORK_UP_CMD → fresh chain
  await waitForNetwork(); // node + pox endpoint responsive (still pre-pox-5)
}, BOOT);

test('pox-5 read-only get-total-sbtc-staked (only after activation)', async () => {
  // Relevance check: before pox-5 activates the read-only call can't succeed
  // (contract not yet published), so the wait below is what makes it work.
  await expect(fetchTotalSbtcStaked({ network })).rejects.toBeDefined();

  // Phase switch: the same read returns a different body once pox-5 is live.
  useFixtures('pox5-readonly-active');
  await waitForPox5(); // epoch 4.0 / pox-5 active

  const total = await fetchTotalSbtcStaked({ network });
  console.log('total sBTC staked', total);
  expect(total).toBe(0n);
});

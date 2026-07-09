/**
 * E2E: Single-staker STX-only stake happy-path.
 *
 * Stakes a dedicated account to the signer-manager with startBurnHt at the current cycle,
 * then asserts fetchStakerInfo reflects the staked amount and
 * firstRewardCycle === currentCycle + 1.
 *
 * Live run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *   POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *   BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *   RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-single-stx-stake.json \
 *   npx jest tests/privatenet/e2e/single-stx-stake.e2e.test.ts \
 *     --runInBand --collectCoverage=false
 */

import { buildStake, fetchStakerInfo } from '../../../src';
import { resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, getNextNonce, getPoxInfo, waitForFulfilled } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const AMOUNT_USTX = BigInt(process.env.AMOUNT_USTX ?? 1_000_000_000); // 1000 STX
const NUM_CYCLES = Number(process.env.NUM_CYCLES ?? 1);
const FEE = BigInt(process.env.FEE_USTX ?? 10_000);

const SIGNER_MANAGER =
  process.env.SIGNER_MANAGER ?? 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';

// Dedicated lane account (override via STAKER env). Default account4: funded, daemon-free, nonce-stable.
const staker = resolveAccount('STAKER', 'account4');

beforeAll(async () => {
  useFixtures('e2e-single-stx-stake');
}, 60_000);

test('single-staker STX stake: end-to-end', async () => {
  const network = getNetwork();

  console.log('staker:', staker.address);

  // READ CHAIN STATE
  const poxInfo = await getPoxInfo();
  const currentCycle = poxInfo.rewardCycleId;
  const startBurnHt = poxInfo.currentBurnchainBlockHeight;

  console.log('currentCycle:', currentCycle);
  console.log('startBurnHt:', startBurnHt);

  // ALREADY STAKED
  const existingInfo = await fetchStakerInfo({ address: staker.address, network });
  if (existingInfo.staked) {
    console.log(
      'staker is already staked:',
      JSON.stringify(existingInfo, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    expect(existingInfo.staked).toBe(true);
    expect(existingInfo.details.amountUstx).toBeGreaterThan(0n);
    return;
  }

  // BUILD + SIGN + BROADCAST
  const nonce = await getNextNonce(staker.address);

  const unsigned = await buildStake({
    signerManager: SIGNER_MANAGER,
    amountUstx: AMOUNT_USTX,
    numCycles: NUM_CYCLES,
    startBurnHt,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce,
    network,
    postConditionMode: 'allow', // stake locks STX
  });

  const tx = signTransaction(unsigned, staker.key);
  const txid = await broadcastAndWait(tx, staker.address, network);
  console.log('stake txid:', txid);
  useFixtures('e2e-single-stx-stake-after');

  // ASSERT STAKER INFO
  const stakerInfo = await waitForFulfilled(async () => {
    const info = await fetchStakerInfo({ address: staker.address, network });
    if (!info.staked) throw new Error('not yet staked');
    return info;
  });

  console.log(JSON.stringify(stakerInfo, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  expect(stakerInfo.staked).toBe(true);
  expect(stakerInfo.details.amountUstx).toBe(AMOUNT_USTX);
  // firstRewardCycle is relative to when the stake landed, not currentCycle read before broadcast
  expect(stakerInfo.details.firstRewardCycle).toBe(currentCycle + 1);
}, 180_000);

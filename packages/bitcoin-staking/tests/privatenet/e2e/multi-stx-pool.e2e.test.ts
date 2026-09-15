/**
 * E2E: three fresh stakers pool STX to the same signer-manager/cycle; asserts
 * fetchSignerSharesStakedForCycle increases by exactly the sum staked.
 *
 * Stakers run sequentially (await each) to avoid nonce races.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-multi-stx-pool.json \
 *     npx jest tests/privatenet/e2e/multi-stx-pool.e2e.test.ts \
 *       --runInBand --collectCoverage=false
 */

import { SIGNER_MANAGER } from '../constants';
import { buildStake, fetchSignerSharesStakedForCycle } from '../../../src';
import type { Account } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWaitForTransaction, getNextNonce, getPoxInfo } from '../../helpers/wait';
import { freshFundedStxAccount } from '../../helpers/fresh-account';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const AMOUNT_USTX = BigInt(process.env.AMOUNT_USTX ?? 1_000_000_000); // 1000 STX per staker
const NUM_CYCLES = Number(process.env.NUM_CYCLES ?? 1);
const FEE_USTX = BigInt(process.env.FEE_USTX ?? 10_000);

// To avoid ACCOUNT-STATE COLLISIONS (a reused REGTEST_KEYS account that's
// already staked -> err u19 ALREADY_STAKED), each of the 3 stakers is a
// freshly-derived random account funded in beforeAll. STX-only `stake` needs no
// bond allowlist, so fresh accounts work here.

const NUM_STAKERS = 3;
// Fund each fresh account with stake amount + generous fee headroom.
const FUND_USTX = AMOUNT_USTX + 1_000_000_000n;

interface Staker {
  name: string;
  account: Account;
}

const STAKERS: Staker[] = [];

beforeAll(async () => {
  useFixtures('e2e-multi-stx-pool');
  const network = getNetwork();
  for (let i = 0; i < NUM_STAKERS; i++) {
    useFixtures(`e2e-multi-stx-pool-fund${i}`); // isolate each funding broadcast
    const account = await freshFundedStxAccount({
      network,
      amountUstx: FUND_USTX,
      label: `pool-${i}`,
    });
    STAKERS.push({ name: `fresh${i + 1}`, account });
  }
}, 6 * 180_000);

test(
  'multi-staker STX pooling: three fresh stakers pool to the same signer-manager',
  async () => {
    useFixtures('e2e-multi-stx-pool');
    const network = getNetwork();

    const poxInfo = await getPoxInfo();
    const targetCycle = poxInfo.rewardCycleId + 1;
    // startBurnHt must map to the current cycle (replay guard in the contract)
    const startBurnHt = poxInfo.currentBurnchainBlockHeight;

    const sharesBefore = await fetchSignerSharesStakedForCycle({
      signerManager: SIGNER_MANAGER,
      rewardCycle: targetCycle,
      network,
    });

    const stakedAmounts: bigint[] = [];
    for (const staker of STAKERS) {
      useFixtures(`e2e-multi-stx-pool-${staker.name}`); // isolate each stake broadcast

      const nonce = await getNextNonce(staker.account.address);

      const unsigned = await buildStake({
        signerManager: SIGNER_MANAGER,
        amountUstx: AMOUNT_USTX,
        numCycles: NUM_CYCLES,
        startBurnHt,
        publicKey: staker.account.publicKey,
        fee: FEE_USTX,
        nonce,
        network,
        postConditionMode: 'allow',
      });

      const transaction = signTransaction(unsigned, staker.account.key);
      const tx = await broadcastAndWaitForTransaction(transaction, network);

      console.log(`[${staker.name}] tx_status: ${tx.tx_status}, result: ${tx.tx_result?.repr}`);

      if (tx.tx_status !== 'success') {
        throw new Error(`[${staker.name}] stake tx failed: ${tx.tx_status} ${tx.tx_result?.repr}`);
      }
      stakedAmounts.push(AMOUNT_USTX);
    }

    useFixtures('e2e-multi-stx-pool-after');
    const sharesAfter = await fetchSignerSharesStakedForCycle({
      signerManager: SIGNER_MANAGER,
      rewardCycle: targetCycle,
      network,
    });

    const expectedDelta = stakedAmounts.reduce((sum, a) => sum + a, 0n);
    const actualDelta = sharesAfter - sharesBefore;

    console.log(`expectedDelta: ${expectedDelta.toString()}, actualDelta: ${actualDelta.toString()}`);

    expect(actualDelta).toBe(expectedDelta);
  },
  3 * 180_000
);

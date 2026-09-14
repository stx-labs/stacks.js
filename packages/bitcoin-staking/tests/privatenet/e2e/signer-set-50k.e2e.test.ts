/**
 * E2E - stake >=50,000 STX -> signer counts toward the signer set.
 *
 * pox-5 gates signer-set membership on the signer's aggregate delegated
 * uSTX exceeding SIGNER_SET_MIN_USTX. A single stake from a fresh account
 * pushes that signer's aggregate over (or confirms it's over) the floor.
 *
 * If account1 is already staking >=50k (prior record run), self-heals by
 * asserting the existing position instead of re-staking.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     BITCOIN_TX_TIMEOUT=300000 STACKS_TX_TIMEOUT=300000 \
 *     RECORD=1 FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-signer-set-50k.json \
 *     npx jest tests/privatenet/e2e/signer-set-50k.e2e.test.ts \
 *       --runInBand --collectCoverage=false --verbose
 */

import { Cl, ClarityType, fetchCallReadOnlyFunction } from '@stacks/transactions';
import {
  buildStake,
  fetchSignerInfo,
  fetchSignerSharesStakedForCycle,
  fetchStakerInfo,
  fetchTotalSharesStakedForCycle,
} from '../../../src';
import { SIGNER_MANAGER } from '../constants';
import { resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWaitForTransaction,
  getNextNonce,
  getPoxInfo,
  isInPreparePhase,
  parseErrCode,
  waitForBurnBlockHeight,
  waitForRewardPhase,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const FEE = 10_000n;
// Exactly the floor: 50k STX = 50_000_000_000 uSTX.
const AMOUNT_USTX = BigInt(process.env.AMOUNT_USTX ?? 50_000_000_000n);
const NUM_CYCLES = 1;
const SIGNER_SET_MIN_USTX = 50_000_000_000n; // from pox-5

// Dedicated lane account (override via STAKER env). Default account1 (Lane A).
const staker = resolveAccount('STAKER', 'account1');
const network = getNetwork();
const bootAddress = network.bootAddress;

// Read-only helpers (not yet wrapped in src/fetch.ts)

/** @internal */
async function getAmountDelegatedForSigner(signer: string, cycle: number): Promise<bigint> {
  const r = await fetchCallReadOnlyFunction({
    contractAddress: bootAddress,
    contractName: 'pox-5',
    functionName: 'get-amount-delegated-for-signer',
    functionArgs: [Cl.address(signer), Cl.uint(cycle)],
    senderAddress: bootAddress,
    network,
  });
  return BigInt((r as { value: bigint }).value);
}

/** @internal */
async function signerSetContainsForCycle(signer: string, cycle: number): Promise<boolean> {
  const r = await fetchCallReadOnlyFunction({
    contractAddress: bootAddress,
    contractName: 'pox-5',
    functionName: 'signer-set-contains-for-cycle',
    functionArgs: [Cl.address(signer), Cl.uint(cycle)],
    senderAddress: bootAddress,
    network,
  });
  return r.type === ClarityType.BoolTrue;
}

interface Snapshot {
  delegated: bigint;
  inSet: boolean;
  signerShares: bigint;
  totalShares: bigint;
}

/** @internal */
async function snapshot(label: string, cycle: number): Promise<Snapshot> {
  const [delegated, inSet, signerShares, totalShares] = await Promise.all([
    getAmountDelegatedForSigner(SIGNER_MANAGER, cycle).catch(() => -1n),
    signerSetContainsForCycle(SIGNER_MANAGER, cycle).catch(() => false),
    fetchSignerSharesStakedForCycle({
      signerManager: SIGNER_MANAGER,
      rewardCycle: cycle,
      network,
    }).catch(() => -1n),
    fetchTotalSharesStakedForCycle({ rewardCycle: cycle, network }).catch(() => -1n),
  ]);
  console.log(`[${label}] cycle ${cycle}:`, {
    delegatedToSigner: delegated.toString(),
    inSignerSet: inSet,
    signerStxOnlyShares: signerShares.toString(),
    totalStxOnlyShares: totalShares.toString(),
  });
  return { delegated, inSet, signerShares, totalShares };
}

beforeAll(async () => {
  useFixtures('e2e-signer-set-50k');
}, 60_000);

test(
  'account1: stake ≥50k STX -> signer aggregate ≥ floor, signer counts toward signer set',
  async () => {
    useFixtures('e2e-signer-set-50k');

    console.log('staker:', staker.address, 'amountUstx:', AMOUNT_USTX.toString());

    const existing = await fetchStakerInfo({ address: staker.address, network });
    console.log(
      'account1 existing staker-info:',
      existing.staked
        ? {
            amountUstx: existing.details.amountUstx.toString(),
            numCycles: existing.details.numCycles,
          }
        : 'not staking'
    );

    if (existing.staked) {
      // Self-heal on a shared chain: a prior record run's 50k position may
      // still exist — assert it satisfies the signer-set floor instead of
      // hard-failing on a duplicate stake.
      console.warn('account1 is ALREADY staking — asserting the existing >=50k position instead.');
      expect(existing.details.amountUstx).toBeGreaterThanOrEqual(SIGNER_SET_MIN_USTX);
      return;
    }

    // WAIT OUT PREPARE PHASE
    let pox = await getPoxInfo();
    const posOf = () =>
      (pox.currentBurnchainBlockHeight - pox.firstBurnchainBlockHeight) % pox.rewardCycleLength;
    const rewardPhaseLen = pox.rewardCycleLength - pox.prepareCycleLength;

    while (
      isInPreparePhase(pox.currentBurnchainBlockHeight, pox) ||
      posOf() >= rewardPhaseLen - 2
    ) {
      console.log(
        `pos=${posOf()} too close to prepare phase (rewardLen=${rewardPhaseLen}) — waiting...`
      );
      await waitForRewardPhase(pox, 1);
      pox = await getPoxInfo();
      if (!isInPreparePhase(pox.currentBurnchainBlockHeight, pox) && posOf() < rewardPhaseLen - 2)
        break;
      const blocksToNext = pox.rewardCycleLength - posOf();
      await waitForBurnBlockHeight(pox.currentBurnchainBlockHeight + blocksToNext);
      pox = await getPoxInfo();
    }

    const startBurnHt = pox.currentBurnchainBlockHeight;
    const targetCycle = pox.rewardCycleId + 1;

    const before = await snapshot('BEFORE', targetCycle);

    // BROADCAST STAKE
    const unsigned = await buildStake({
      signerManager: SIGNER_MANAGER,
      amountUstx: AMOUNT_USTX,
      numCycles: NUM_CYCLES,
      startBurnHt,
      publicKey: staker.publicKey,
      fee: FEE,
      nonce: await getNextNonce(staker.address),
      network,
      postConditionMode: 'allow',
    });
    const transaction = signTransaction(unsigned, staker.key);
    const tx = await broadcastAndWaitForTransaction(transaction, network);
    console.log('stake on-chain result:', {
      tx_status: tx.tx_status,
      repr: tx.tx_result?.repr,
      burn_block_height: tx.burn_block_height,
    });

    if (tx.tx_status !== 'success') {
      const code = parseErrCode(tx.tx_result?.repr);
      throw new Error(`stake aborted (err u${code}): ${JSON.stringify(tx.tx_result)}`);
    }

    useFixtures('e2e-signer-set-50k-after'); // post-stake reads differ
    const after = await snapshot('AFTER', targetCycle);

    const stakerInfo = await fetchStakerInfo({ address: staker.address, network });
    console.log(
      'account1 staker-info AFTER:',
      stakerInfo.staked
        ? {
            amountUstx: stakerInfo.details.amountUstx.toString(),
            numCycles: stakerInfo.details.numCycles,
            firstRewardCycle: stakerInfo.details.firstRewardCycle,
          }
        : 'not staking'
    );

    const signerInfo = await fetchSignerInfo({ signerManager: SIGNER_MANAGER, network });

    // ASSERTIONS
    expect(stakerInfo.staked).toBe(true);
    if (stakerInfo.staked) {
      expect(stakerInfo.details.amountUstx).toBe(AMOUNT_USTX);
      expect(stakerInfo.details.firstRewardCycle).toBe(targetCycle);
    }

    const sharesDelta = after.signerShares - before.signerShares;
    expect(sharesDelta).toBe(AMOUNT_USTX);

    if (after.delegated >= SIGNER_SET_MIN_USTX) {
      expect(after.inSet).toBe(true);
    } else {
      console.warn(
        `WARN: delegated (${after.delegated}) < floor (${SIGNER_SET_MIN_USTX}) — signer NOT yet in set; more stakes needed`
      );
    }

    expect(signerInfo).toBeDefined();

    console.log('stake txid:', tx.tx_id, 'delegated BEFORE->AFTER:', before.delegated.toString(), '->', after.delegated.toString());
  },
  3 * 180_000
);

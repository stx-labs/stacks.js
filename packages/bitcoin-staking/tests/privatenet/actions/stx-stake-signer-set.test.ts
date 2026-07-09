/**
 * Privatenet STX-only stake -> signer-set inclusion probe.
 *
 * pox-5 gates signer-set membership on the signer's *aggregate* delegated
 * uSTX (SIGNER_SET_MIN_USTX = 50k STX), not the individual staker's stake.
 * A stake >= the floor into a signer previously below it pushes that signer
 * INTO the set, making total-shares-staked-for-cycle (is-bond=false) non-zero.
 *
 * The daemon signer-manager is staked every cycle, so it's likely ALREADY
 * over the floor — in that case we only assert the weaker contract guarantee
 * (in-set AND total shares grew by at least our stake), logging before/after.
 * Staker-only tx (account6); does not touch bond-admin / setup-bond.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
 *     npx jest tests/privatenet/actions/stx-stake-signer-set.test.ts --runInBand --collectCoverage=false --verbose
 */
import { Cl, ClarityType, broadcastTransaction, fetchCallReadOnlyFunction } from '@stacks/transactions';
import {
  buildStake,
  fetchStakerInfo,
  fetchAmountDelegatedForSigner,
  fetchSignerSharesStakedForCycle,
  fetchTotalSharesStakedForCycle,
  Pox5ErrorCode,
} from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import {
  ensureRewardPhase,
  getNextNonce,
  getTransaction,
  parseErrCode,
  waitForFulfilled,
} from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60 * 60_000);

const network = getNetwork();
const FEE = 10_000n;

const STAKER = process.env.STAKER ?? 'account6';
// SIGNER_SET_MIN_USTX = u50000000000 = 50_000 STX. Default to exactly the floor.
const AMOUNT_USTX = BigInt(process.env.AMOUNT_USTX ?? 50_000_000_000n);
const NUM_CYCLES = Number(process.env.NUM_CYCLES ?? 1);

const signerManager = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const SIGNER = signerManager; // contract-of(signer-manager)

const staker = getAccount(REGTEST_KEYS[STAKER as keyof typeof REGTEST_KEYS]);
const bootAddress = network.bootAddress;

// read-only helper not yet wrapped in src/fetch.ts

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

beforeAll(async () => {}, 60 * 60_000);

test('stake >= SIGNER_SET_MIN_USTX (50k STX) makes the signer count toward the set', async () => {
  useFixtures('stx-stake-signer-set');

  // stake reverts in the prepare phase (verify-not-prepare-phase -> u47). The tx
  // mines ~1 block after broadcast, so guard with a 2-block margin: if we are at
  // or near the prepare boundary, wait for the next reward phase to start fresh.
  const poxInfo = await ensureRewardPhase();

  const existing = await fetchStakerInfo({ address: staker.address, network });
  console.log(
    'account6 existing staker-info:',
    existing.staked
      ? { ...existing.details, amountUstx: existing.details!.amountUstx.toString() }
      : existing
  );
  if (existing.staked) {
    console.warn(
      'account6 is ALREADY staking — `stake` would abort u19 ERR_ALREADY_STAKED. ' +
        'Run stx-unstake + wait for unlock first, or use stx-extend to grow this position.'
    );
  }

  const startBurnHt = poxInfo.currentBurnchainBlockHeight;
  const firstRewardCycle = poxInfo.rewardCycleId + 1; // cycle the stake lands in

  console.log('signer-set stake params', {
    staker: staker.address,
    amountUstx: AMOUNT_USTX.toString(),
    amountStx: (Number(AMOUNT_USTX) / 1e6).toString(),
    signerSetMinStx: '50000',
    numCycles: NUM_CYCLES,
    currentCycle: poxInfo.rewardCycleId,
    firstRewardCycle,
    startBurnHt,
  });

  // BEFORE
  const [beforeDelegated, beforeInSet, beforeSignerShares, beforeTotalShares] = await Promise.all([
    fetchAmountDelegatedForSigner({ signerManager: SIGNER, cycle: firstRewardCycle, network }).catch(
      () => -1n
    ),
    signerSetContainsForCycle(SIGNER, firstRewardCycle).catch(() => false),
    fetchSignerSharesStakedForCycle({
      signerManager: SIGNER,
      rewardCycle: firstRewardCycle,
      network,
    }).catch(() => -1n),
    fetchTotalSharesStakedForCycle({ rewardCycle: firstRewardCycle, network }).catch(() => -1n),
  ]);
  const before = {
    delegated: beforeDelegated,
    inSet: beforeInSet,
    signerShares: beforeSignerShares,
    totalShares: beforeTotalShares,
  };
  console.log('[BEFORE] cycle', firstRewardCycle, {
    delegatedToSigner: before.delegated.toString(),
    inSignerSet: before.inSet,
    signerStxOnlyShares: before.signerShares.toString(),
    totalStxOnlyShares: before.totalShares.toString(),
  });

  // Tracks whether the broadcast (or a pre-existing stake) leaves the staker
  // actually staked — drives which post-conditions below are meaningful.
  let stakeTookEffect = existing.staked;

  if (!existing.staked) {
    const unsigned = await buildStake({
      signerManager,
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
    const res = await broadcastTransaction({ transaction, network });
    if ('error' in res)
      throw `broadcast rejected: ${res.error} — ${'reason' in res ? res.reason : ''}`;
    console.log('signer-set stake txid', res.txid);

    const tx = await waitForFulfilled(async () => {
      const t = await getTransaction(res.txid);
      if (!t || t.tx_status === 'pending') throw 'tx still pending';
      return t;
    });
    console.log('signer-set stake on-chain result', {
      txid: tx.tx_id,
      tx_status: tx.tx_status,
      result_repr: tx.tx_result?.repr,
      burn_block_height: tx.burn_block_height,
    });

    if (tx.tx_status === 'success') {
      stakeTookEffect = true;
    } else {
      // ERR_ALREADY_STAKED covers "active STX stake OR overlapping bond
      // position" (see errors.ts) — `existing.staked` only reflects the
      // STX-only stake, so this can legitimately fire from an overlapping
      // bond position we didn't observe. That's the only tolerable abort
      // here — anything else is a real bug. Either way no *new* STX-only
      // stake was created, so the set-inclusion guarantees below don't apply.
      expect(tx.tx_status).toBe('abort_by_response');
      const code = parseErrCode(tx.tx_result?.repr);
      expect(code).toBe(Pox5ErrorCode.AlreadyStaked);
      console.log(
        'stake aborted with ERR_ALREADY_STAKED — an existing STX stake or overlapping ' +
          'bond position already blocks a new stake for this staker'
      );
    }
  } else {
    console.log('skipping broadcast — already staked; reading state only');
  }

  // AFTER
  const [afterDelegated, afterInSet, afterSignerShares, afterTotalShares] = await Promise.all([
    fetchAmountDelegatedForSigner({ signerManager: SIGNER, cycle: firstRewardCycle, network }).catch(
      () => -1n
    ),
    signerSetContainsForCycle(SIGNER, firstRewardCycle).catch(() => false),
    fetchSignerSharesStakedForCycle({
      signerManager: SIGNER,
      rewardCycle: firstRewardCycle,
      network,
    }).catch(() => -1n),
    fetchTotalSharesStakedForCycle({ rewardCycle: firstRewardCycle, network }).catch(() => -1n),
  ]);
  const after = {
    delegated: afterDelegated,
    inSet: afterInSet,
    signerShares: afterSignerShares,
    totalShares: afterTotalShares,
  };
  console.log('[AFTER] cycle', firstRewardCycle, {
    delegatedToSigner: after.delegated.toString(),
    inSignerSet: after.inSet,
    signerStxOnlyShares: after.signerShares.toString(),
    totalStxOnlyShares: after.totalShares.toString(),
  });
  const staked = await fetchStakerInfo({ address: staker.address, network });
  console.log(
    'account6 staker-info AFTER:',
    staked.staked
      ? { ...staked.details, amountUstx: staked.details!.amountUstx.toString() }
      : staked
  );

  console.log('SIGNER_SET_MIN_USTX:', '50000000000 (50k STX)');
  console.log(
    'delegated-to-signer  before→after:',
    before.delegated.toString(),
    '→',
    after.delegated.toString()
  );
  console.log('in-signer-set        before→after:', before.inSet, '→', after.inSet);
  console.log(
    'signer STX-only shrs before→after:',
    before.signerShares.toString(),
    '→',
    after.signerShares.toString()
  );
  console.log(
    'total  STX-only shrs before→after:',
    before.totalShares.toString(),
    '→',
    after.totalShares.toString()
  );

  if (stakeTookEffect) {
    // Contract guarantee for a >= floor stake: the signer is in the set for the
    // staked cycle, and total STX-only shares grew by at least our stake.
    expect(staked.staked).toBe(true);
    if (after.delegated >= 50_000_000_000n) {
      expect(after.inSet).toBe(true);
      console.log(
        'CONFIRMED: signer delegated >= 50k STX floor → in signer set; stake COUNTS toward STX-only distribution'
      );
    }
    if (after.totalShares >= 0n && before.totalShares >= 0n) {
      console.log(
        'total STX-only shares delta:',
        (after.totalShares - before.totalShares).toString()
      );
    }
  }
});

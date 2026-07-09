/**
 * State-derived read-only sweep over the per-cycle / per-signer / signer-set
 * getters. Every assertion is derived from freshly-read chain state (cycle ids
 * from `/v2/pox`, signers walked out of the live set) so a re-record in any
 * chain state stays valid. Read-only: no broadcasts, no admin key.
 */
import {
  fetchPoxInfo,
  fetchProtocolBondMemberships,
  fetchReserveBalance,
  fetchRewardsPerTokenForCycle,
  fetchSignerCycleMembership,
  fetchSignerKeyGrantUsed,
  fetchSignerPendingStakedUstx,
  fetchSignerRewardsPerTokenForCycle,
  fetchSignerRewardsPerTokenSettled,
  fetchSignerSetContainsForCycle,
  fetchSignerSetFirstItem,
  fetchSignerSetItem,
  fetchSignerSetLastItem,
  fetchSignerSetNextItem,
  fetchSignerSetPrevItem,
  fetchSignerSharesStakedForCycle,
  fetchSignerUnclaimedRewards,
  fetchStakerCustodiedSbtc,
  fetchStakerRewardsPerTokenSettled,
  fetchStakerSharesStakedForCycle,
  fetchStakerUnclaimedRewards,
  fetchTotalUstxStacked,
  fetchUstxDelegatedForCycle,
  fetchBondOverlapsNewPosition,
} from '../../../src';
import type { PoxInfo } from '../../../src';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(30 * 60_000);

const network = getNetwork();
const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const account5 = getAccount(REGTEST_KEYS.account5); // L1-enrolled on this chain

// Shared spine, read once.
let poxInfo: PoxInfo;
let cycle: number;
let prevCycle: number;

beforeAll(async () => {
  useFixtures('signer-cycle-reads');
  poxInfo = await fetchPoxInfo({ network });
  cycle = poxInfo.rewardCycleId;
  prevCycle = cycle - 1;
}, 30 * 60_000);

const expectNonNegBigint = (label: string, x: bigint) => {
  console.log(label, x.toString());
  expect(typeof x === 'bigint').toBe(true);
  expect(x).toBeGreaterThanOrEqual(0n);
};

describe('cycle-level reads', () => {
  test('total uSTX stacked (current + previous cycle)', async () => {
    for (const c of [cycle, prevCycle]) {
      expectNonNegBigint(`totalUstxStacked[${c}]`, await fetchTotalUstxStacked({ rewardCycle: c, network }));
    }
  });

  test('uSTX delegated for cycle', async () => {
    expectNonNegBigint(`ustxDelegated[${cycle}]`, await fetchUstxDelegatedForCycle({ rewardCycle: cycle, network }));
  });

  test('rewards-per-token for cycle (STX leg)', async () => {
    expectNonNegBigint(`rewardsPerToken[${cycle}]`, await fetchRewardsPerTokenForCycle({ rewardCycle: cycle, network }));
  });

  test('reserve balance', async () => {
    expectNonNegBigint('reserveBalance', await fetchReserveBalance({ network }));
  });
});

describe('staker reads', () => {
  test('staker shares staked for cycle', async () => {
    expectNonNegBigint(
      'stakerShares',
      await fetchStakerSharesStakedForCycle({
        staker: account5.address,
        signer: SIGNER_MANAGER,
        rewardCycle: cycle,
        network,
      })
    );
  });

  test('staker rewards-per-token settled', async () => {
    expectNonNegBigint(
      'stakerRptSettled',
      await fetchStakerRewardsPerTokenSettled({
        signerManager: SIGNER_MANAGER,
        rewardCycle: cycle,
        staker: account5.address,
        network,
      })
    );
  });

  test('staker unclaimed rewards', async () => {
    expectNonNegBigint(
      'stakerUnclaimed',
      await fetchStakerUnclaimedRewards({
        signerManager: SIGNER_MANAGER,
        rewardCycle: cycle,
        staker: account5.address,
        network,
      })
    );
  });

  test('staker custodied sBTC', async () => {
    expectNonNegBigint('stakerCustodiedSbtc', await fetchStakerCustodiedSbtc({ staker: account5.address, network }));
  });

  test('bond-overlaps-new-position agrees with live membership', async () => {
    const membership = await fetchProtocolBondMemberships({ address: account5.address, network });
    console.log(
      'account5 raw membership:',
      JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    const overlaps = await fetchBondOverlapsNewPosition({
      membership,
      newFirstRewardCycle: cycle,
      network,
    });
    console.log('bondOverlapsNewPosition:', overlaps);
    expect(typeof overlaps).toBe('boolean');
    // No membership → nothing can overlap.
    if (!membership) expect(overlaps).toBe(false);
  });
});

describe('signer reads', () => {
  test('signer shares staked for cycle', async () => {
    expectNonNegBigint(
      'signerShares',
      await fetchSignerSharesStakedForCycle({ signerManager: SIGNER_MANAGER, rewardCycle: cycle, network })
    );
  });

  test('signer rewards-per-token (live + settled)', async () => {
    expectNonNegBigint(
      'signerRpt',
      await fetchSignerRewardsPerTokenForCycle({ signerManager: SIGNER_MANAGER, rewardCycle: cycle, network })
    );
    expectNonNegBigint(
      'signerRptSettled',
      await fetchSignerRewardsPerTokenSettled({ signerManager: SIGNER_MANAGER, rewardCycle: cycle, network })
    );
  });

  test('signer unclaimed rewards', async () => {
    expectNonNegBigint(
      'signerUnclaimed',
      await fetchSignerUnclaimedRewards({ signerManager: SIGNER_MANAGER, rewardCycle: cycle, network })
    );
  });

  test('signer pending staked uSTX', async () => {
    expectNonNegBigint(
      'signerPending',
      await fetchSignerPendingStakedUstx({ signerManager: SIGNER_MANAGER, cycle, network })
    );
  });

  test('signer cycle membership is undefined or well-shaped', async () => {
    const m = await fetchSignerCycleMembership({ staker: account5.address, cycle, network });
    console.log('signerCycleMembership:', JSON.stringify(m, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    if (m !== undefined) {
      expect(typeof m.amountUstx === 'bigint').toBe(true);
      expect(m.amountUstx).toBeGreaterThanOrEqual(0n);
      expect(typeof m.signer).toBe('string');
    }
  });

  test('signer-key-grant used flag is a boolean', async () => {
    // account5's pubkey against the known signer-manager with an arbitrary
    // auth-id — almost certainly unused, but the read must return a boolean.
    const used = await fetchSignerKeyGrantUsed({
      signerKey: account5.publicKey,
      signerManager: SIGNER_MANAGER,
      authId: 987654n,
      network,
    });
    console.log('signerKeyGrantUsed:', used);
    expect(typeof used).toBe('boolean');
  });
});

describe('signer-set traversal', () => {
  test('first/last/contains/item/next/prev agree', async () => {
    const first = await fetchSignerSetFirstItem({ cycle, network });
    const last = await fetchSignerSetLastItem({ cycle, network });
    console.log('signerSet first/last:', first, last);

    if (first === undefined) {
      // Empty set for this cycle — no members to traverse.
      expect(last).toBeUndefined();
      console.log(`signer set empty for cycle ${cycle}, skipping traversal`);
      return;
    }
    expect(typeof first).toBe('string');
    expect(typeof last).toBe('string');

    // The head is a member → contains is true.
    const contains = await fetchSignerSetContainsForCycle({ signer: first, cycle, network });
    console.log('contains(first):', contains);
    expect(contains).toBe(true);

    // Its node exists; head has no prev.
    const item = await fetchSignerSetItem({ signer: first, cycle, network });
    console.log('item(first):', JSON.stringify(item));
    expect(item).not.toBeUndefined();
    expect(item!.prev).toBeUndefined();

    // prev/next accessors agree with the node.
    const prev = await fetchSignerSetPrevItem({ signer: first, cycle, network });
    const next = await fetchSignerSetNextItem({ signer: first, cycle, network });
    console.log('prev/next(first):', prev, next);
    expect(prev).toBeUndefined();
    expect(next).toBe(item!.next);

    // Single-element set: head === tail and there is no next.
    if (first === last) expect(next).toBeUndefined();
  });
});

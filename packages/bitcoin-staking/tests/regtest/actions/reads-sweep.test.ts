// Resolution-only asserts on purpose: value-level assertions live with the flow
// tests that create the state; this suite exists so every read-only entrypoint
// is exercised at least once (ABI drift surfaces here, not in apps).
import {
  fetchAccountStatus,
  fetchAllowanceContractCallers,
  fetchAmountDelegatedForSigner,
  fetchBond,
  fetchBondAllowance,
  fetchBondL1UnlockHeight,
  fetchBondMembership,
  fetchBondOverlapsNewPosition,
  fetchBondStatus,
  fetchBurnBlockHeaderHash,
  fetchConstructLockupOutputScript,
  fetchConstructLockupScript,
  fetchEarned,
  fetchEarnedStakerRewards,
  fetchEligibleRegisterForBond,
  fetchHasAnnouncedL1EarlyExit,
  fetchLastAccountedRewards,
  fetchLastRewardComputeHeight,
  fetchNewRewards,
  fetchParseBlockHeader,
  fetchPoxInfo,
  fetchProtocolBond,
  fetchPushCScriptNum,
  fetchPushScriptBytes,
  fetchReserveBalance,
  fetchReverseBuff32,
  fetchReversedTxid,
  fetchRewards,
  fetchRewardsPerTokenForCycle,
  fetchSerializeCScriptNum,
  fetchSignerCycleMembership,
  fetchSignerGrantMessageHash,
  fetchSignerInfo,
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
  fetchStakerInfo,
  fetchStakerRewardsPerTokenSettled,
  fetchStakerSharesStakedForCycle,
  fetchStakerUnclaimedRewards,
  fetchTotalSbtcStaked,
  fetchTotalSbtcStakedForBond,
  fetchTotalSharesStakedForCycle,
  fetchTotalUstxStacked,
  fetchUintToBuffLe,
  fetchUstxDelegatedForCycle,
  fetchVerifyBlockHeader,
  fetchVerifySignerKeyGrant,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { ensurePox5, waitForSignerManager } from '../../helpers/wait';
import { pickBondIndex } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { bitcoinRpc } from '../../helpers/btc';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const staker = ACCOUNTS.sbtcDeployer.address; // daemon-staked → non-empty read state
const cleanAccount = getAccount(REGTEST_KEYS.account4);
const signerManager = SIGNER_MANAGER;

beforeAll(async () => {
  useFixtures('reads-sweep');
  await ensurePox5();
  await waitForSignerManager(signerManager);
}, 5 * 60_000);

test('every SDK read wrapper resolves against live state', async () => {
  const pox = await fetchPoxInfo({ network });
  const cycle = pox.rewardCycleId;
  const { bondIndex } = pickBondIndex(pox);

  const bestHash = await bitcoinRpc<string>('getbestblockhash', []);
  const headerHex = await bitcoinRpc<string>('getblockheader', [bestHash, false]);
  const block = await bitcoinRpc<{ height: number; tx: { hex: string }[] }>('getblock', [
    bestHash,
    2,
  ]);
  const coinbaseHex = block.tx[0]!.hex;

  const lockupArgs = {
    stxAddress: staker,
    unlockHeight: pox.currentBurnchainBlockHeight + 100,
    unlockBytes: '00'.repeat(33),
    earlyUnlockBytes: '00'.repeat(683),
  };

  const sweep: [string, () => Promise<unknown>][] = [
    ['fetchStakerInfo', () => fetchStakerInfo({ address: staker, network })],
    [
      'fetchAllowanceContractCallers',
      () => fetchAllowanceContractCallers({ sender: staker, contractCaller: signerManager, network }),
    ],
    ['fetchAccountStatus', () => fetchAccountStatus({ address: staker, network })],
    ['fetchBondMembership', () => fetchBondMembership({ address: staker, network })],
    [
      'fetchStakerSharesStakedForCycle',
      () =>
        fetchStakerSharesStakedForCycle({ staker, signer: signerManager, rewardCycle: cycle, network }),
    ],
    ['fetchBond', () => fetchBond({ bondIndex, network })],
    ['fetchProtocolBond', () => fetchProtocolBond({ bondIndex, network })],
    ['fetchBondStatus', () => fetchBondStatus({ bondIndex, poxInfo: pox, network })],
    ['fetchTotalSbtcStakedForBond', () => fetchTotalSbtcStakedForBond({ bondIndex, network })],
    [
      'fetchTotalSharesStakedForCycle',
      () => fetchTotalSharesStakedForCycle({ rewardCycle: cycle, network }),
    ],
    ['fetchTotalSbtcStaked', () => fetchTotalSbtcStaked({ network })],
    ['fetchBondL1UnlockHeight', () => fetchBondL1UnlockHeight({ bondIndex, network })],
    ['fetchConstructLockupScript', () => fetchConstructLockupScript({ ...lockupArgs, network })],
    [
      'fetchConstructLockupOutputScript',
      () => fetchConstructLockupOutputScript({ ...lockupArgs, network }),
    ],
    ['fetchPushScriptBytes', () => fetchPushScriptBytes({ bytes: 'deadbeef', network })],
    ['fetchSerializeCScriptNum', () => fetchSerializeCScriptNum({ n: 1234, network })],
    ['fetchPushCScriptNum', () => fetchPushCScriptNum({ n: 1234, network })],
    ['fetchUintToBuffLe', () => fetchUintToBuffLe({ n: 1234, network })],
    ['fetchReverseBuff32', () => fetchReverseBuff32({ input: '11'.repeat(32), network })],
    ['fetchReversedTxid', () => fetchReversedTxid({ tx: coinbaseHex, network })],
    ['fetchParseBlockHeader', () => fetchParseBlockHeader({ header: headerHex, network })],
    [
      'fetchBurnBlockHeaderHash',
      () => fetchBurnBlockHeaderHash({ burnHeight: pox.currentBurnchainBlockHeight - 5, network }),
    ],
    ['fetchTotalUstxStacked', () => fetchTotalUstxStacked({ rewardCycle: cycle, network })],
    ['fetchBondAllowance', () => fetchBondAllowance({ bondIndex, address: staker, network })],
    [
      'fetchSignerSharesStakedForCycle',
      () => fetchSignerSharesStakedForCycle({ signerManager, rewardCycle: cycle, network }),
    ],
    ['fetchEarned', () => fetchEarned({ signerManager, rewardCycle: cycle, network })],
    [
      'fetchSignerUnclaimedRewards',
      () => fetchSignerUnclaimedRewards({ signerManager, rewardCycle: cycle, network }),
    ],
    [
      'fetchSignerRewardsPerTokenSettled',
      () => fetchSignerRewardsPerTokenSettled({ signerManager, rewardCycle: cycle, network }),
    ],
    [
      'fetchSignerRewardsPerTokenForCycle',
      () => fetchSignerRewardsPerTokenForCycle({ signerManager, rewardCycle: cycle, network }),
    ],
    [
      'fetchEarnedStakerRewards',
      () => fetchEarnedStakerRewards({ signerManager, rewardCycle: cycle, staker, network }),
    ],
    [
      'fetchStakerRewardsPerTokenSettled',
      () => fetchStakerRewardsPerTokenSettled({ signerManager, rewardCycle: cycle, staker, network }),
    ],
    [
      'fetchStakerUnclaimedRewards',
      () => fetchStakerUnclaimedRewards({ signerManager, rewardCycle: cycle, staker, network }),
    ],
    ['fetchLastRewardComputeHeight', () => fetchLastRewardComputeHeight({ network })],
    ['fetchRewards', () => fetchRewards({ network })],
    ['fetchNewRewards', () => fetchNewRewards({ network })],
    ['fetchReserveBalance', () => fetchReserveBalance({ network })],
    ['fetchLastAccountedRewards', () => fetchLastAccountedRewards({ network })],
    [
      'fetchRewardsPerTokenForCycle',
      () => fetchRewardsPerTokenForCycle({ rewardCycle: cycle, network }),
    ],
    [
      'fetchSignerPendingStakedUstx',
      () => fetchSignerPendingStakedUstx({ signerManager, cycle, network }),
    ],
    [
      'fetchAmountDelegatedForSigner',
      () => fetchAmountDelegatedForSigner({ signerManager, cycle, network }),
    ],
    ['fetchUstxDelegatedForCycle', () => fetchUstxDelegatedForCycle({ rewardCycle: cycle, network })],
    ['fetchSignerCycleMembership', () => fetchSignerCycleMembership({ staker, cycle, network })],
    [
      'fetchSignerSetContainsForCycle',
      () => fetchSignerSetContainsForCycle({ signer: signerManager, cycle, network }),
    ],
    ['fetchSignerSetFirstItem', () => fetchSignerSetFirstItem({ cycle, network })],
    ['fetchSignerSetLastItem', () => fetchSignerSetLastItem({ cycle, network })],
    ['fetchSignerSetNextItem', () => fetchSignerSetNextItem({ signer: signerManager, cycle, network })],
    ['fetchSignerSetPrevItem', () => fetchSignerSetPrevItem({ signer: signerManager, cycle, network })],
    ['fetchSignerSetItem', () => fetchSignerSetItem({ signer: signerManager, cycle, network })],
    ['fetchStakerCustodiedSbtc', () => fetchStakerCustodiedSbtc({ staker, network })],
    [
      'fetchBondOverlapsNewPosition',
      () => fetchBondOverlapsNewPosition({ membership: undefined, newFirstRewardCycle: cycle + 2, network }),
    ],
    [
      'fetchHasAnnouncedL1EarlyExit',
      () => fetchHasAnnouncedL1EarlyExit({ bondIndex, staker, network }),
    ],
    ['fetchSignerInfo', () => fetchSignerInfo({ signerManager, network })],
    [
      'fetchSignerGrantMessageHash',
      () => fetchSignerGrantMessageHash({ signerManager, authId: 1, network }),
    ],
    [
      'fetchVerifySignerKeyGrant',
      () =>
        fetchVerifySignerKeyGrant({
          signerKey: ACCOUNTS.sbtcDeployer.publicKey,
          signerManager,
          network,
        }),
    ],
    [
      'fetchEligibleRegisterForBond',
      () =>
        fetchEligibleRegisterForBond({
          bondIndex,
          staker,
          amountUstx: 1_000_000n,
          satsTotal: 1_000n,
          signerManager,
          poxInfo: pox,
          network,
        }),
    ],
  ];

  const failures: { name: string; error: string }[] = [];
  for (const [name, call] of sweep) {
    try {
      const value = await call();
      console.log(`${name} →`, typeof value === 'bigint' ? value.toString() : value);
    } catch (e) {
      failures.push({ name, error: (e as Error).message });
    }
  }

  if (failures.length > 0) console.error('sweep failures:', failures);
  expect(failures).toEqual([]);
  expect(sweep.length).toBeGreaterThanOrEqual(50);
});

// Negative/none paths: the wrappers' undefined/false branches are API surface
// too (apps branch on them), so pin them against live state.
test('read wrappers: none/false paths', async () => {
  // Own phase: this test's /v2/pox fetch would otherwise overwrite (latest-wins)
  // the height the sweep test derived its dynamic call-read keys from.
  useFixtures('reads-sweep-negative');
  const pox = await fetchPoxInfo({ network });
  const unknown = cleanAccount.address; // never staked/registered

  expect(
    await fetchVerifyBlockHeader({
      header: '00'.repeat(80),
      expectedBlockHeight: pox.currentBurnchainBlockHeight - 5,
      network,
    })
  ).toBe(false);
  expect(
    await fetchBurnBlockHeaderHash({ burnHeight: pox.currentBurnchainBlockHeight + 10_000, network })
  ).toBeUndefined();
  expect(await fetchSignerSetNextItem({ signer: unknown, cycle: pox.rewardCycleId, network })).toBeUndefined();
  expect(await fetchSignerSetPrevItem({ signer: unknown, cycle: pox.rewardCycleId, network })).toBeUndefined();
  expect(await fetchSignerSetItem({ signer: unknown, cycle: pox.rewardCycleId, network })).toBeUndefined();
  expect(await fetchSignerCycleMembership({ staker: unknown, cycle: pox.rewardCycleId, network })).toBeUndefined();

  const eligibility = await fetchEligibleRegisterForBond({
    bondIndex: pickBondIndex(pox).bondIndex,
    staker: unknown,
    amountUstx: 1_000_000n,
    satsTotal: 1_000n,
    signerManager,
    poxInfo: pox,
    network,
  });
  expect(eligibility.ok).toBe(false);
  if (!eligibility.ok) expect(eligibility.reasons.length).toBeGreaterThan(0);
});

test('fetchAccountStatus: funded and unlocked (clean account)', async () => {
  const status = await fetchAccountStatus({ address: cleanAccount.address, network });
  expect(status.balance).toBeGreaterThan(0n);
  expect(status.locked).toBe(0n);
  expect(status.unlockHeight).toBe(0);
});

test('fetchStakerInfo: unstaked (clean account)', async () => {
  const info = await fetchStakerInfo({ address: cleanAccount.address, network });
  expect(info.staked).toBe(false);
});

test('fetchBondMembership: none (clean account)', async () => {
  expect(await fetchBondMembership({ address: cleanAccount.address, network })).toBeUndefined();
});

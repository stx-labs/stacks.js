/**
 * Bond state reader — enumerates protocol-bonds and prints what the daemon
 * (or anyone) has set up on the current chain.
 *
 * Env overrides (all optional):
 *   MAX_BOND_INDEX   — how many indices to probe (default 20)
 *   STACKS_ADDRESS   — whose bond membership to check (default account4)
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     npx jest tests/privatenet/actions/bonds.test.ts --runInBand --collectCoverage=false
 */
import { fetchBondMembership, fetchProtocolBond, fetchPoxInfo } from '../../../src';
import { bondPhaseRanges, bondPeriodToBurnHeight } from '../../../src/cycles';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(60_000);

const network = getNetwork();
const MAX_BOND_INDEX = Number(process.env.MAX_BOND_INDEX ?? 20);
const membershipAddress = process.env.STACKS_ADDRESS ?? getAccount(REGTEST_KEYS.account4).address;

beforeAll(() => useFixtures('bonds'));

test('enumerate protocol-bonds', async () => {
  const pox = await fetchPoxInfo({ network });
  console.log('pox info', {
    contract: pox.contractId,
    cycle: pox.rewardCycleId,
    burnHeight: pox.currentBurnchainBlockHeight,
  });
  expect(pox.contractId).toContain('pox-5');

  const found: { index: number; bond: Awaited<ReturnType<typeof fetchProtocolBond>> }[] = [];

  for (let i = 0; i < MAX_BOND_INDEX; i++) {
    const bond = await fetchProtocolBond({ bondIndex: i, network });
    if (bond) {
      const openBurnHt = bondPeriodToBurnHeight({ bondIndex: i, poxInfo: pox });
      const phases = bondPhaseRanges({ bondIndex: i, poxInfo: pox });
      const currentPhase = phases.find(
        p =>
          pox.currentBurnchainBlockHeight >= p.startBurnHeight &&
          pox.currentBurnchainBlockHeight < p.endBurnHeight
      );
      console.log(`bond ${i}`, {
        targetRateBps: bond.targetRateBps,
        stxValueRatio: bond.stxValueRatio.toString(),
        minUstxRatioBps: bond.minUstxRatioBps,
        earlyUnlockBytes: bond.earlyUnlockBytes,
        openAt: openBurnHt,
        currentPhase: currentPhase?.name ?? 'expired',
      });
      found.push({ index: i, bond });
    }
  }

  console.log(`found ${found.length} bond(s) in indices 0..${MAX_BOND_INDEX - 1}`);
});

test('bond membership for address', async () => {
  const membership = await fetchBondMembership({ address: membershipAddress, network });
  console.log(`bond membership for ${membershipAddress}:`, membership ?? 'none');
  // account4 (bond-admin) holds no bond membership; if a member, the shape is well-formed.
  if (membership) {
    expect(typeof membership.bondIndex).toBe('number');
    expect(typeof membership.isL1Lock).toBe('boolean');
  } else {
    expect(membership).toBeUndefined();
  }
});

/**
 * Eligibility preflight coverage for `calculate-rewards`.
 * Gates: DistributionAlreadyComputed, ActiveBondNotIncluded, BondNotFound,
 * InvalidBondPeriodOrdering, BondNotActive.
 *
 * beforeAll sets up ONE bond (the current open window) so BondNotActive is
 * deterministic: the bond exists on-chain but its start height is in the future,
 * so it is NOT active at calcHeight (which looks at the previous distribution
 * cycle boundary). BondNotFound and BondNotActive are unconditionally covered.
 */
import {
  buildSetupBond,
  fetchEligibleCalculateRewards,
  Pox5ErrorCode,
} from '../../../src';
import { ACCOUNTS, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { broadcastAndWait, ensurePox5, getNextNonce, getPoxInfo } from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(6 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;

const FEE = 10_000n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account;
// bondIndex of the bond set up in beforeAll; used to assert BondNotActive
let eligBondIndex: number;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('eligibility-calculate-rewards-setup');
  await ensurePox5();

  const { bondIndex } = await waitForBondWithRunway(15);
  eligBondIndex = bondIndex;

  const setupTx = await buildSetupBond({
    bondIndex,
    targetRateBps: 1_000n,
    stxValueRatio: 1_000n,
    minUstxRatioBps: 500n,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    // allowlist must be non-empty; use sbtcDeployer as a sentinel (no staker needed)
    allowlist: [{ staker: sbtcDeployer.address, maxSats: 10_000n }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
  });
  await broadcastAndWait(signTransaction(setupTx, admin.key), admin.address, network);

  useFixtures('eligibility-calculate-rewards-checks');
}, 6 * 60_000);

test('BondNotFound — non-existent bondIndex', async () => {
  const pox = await getPoxInfo();
  const r = await fetchEligibleCalculateRewards({
    bondIndices: [200], // no bond at 200
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.BondNotFound);
});

test('BondNotActive — bond exists but start height is in the future at calcHeight', async () => {
  // eligBondIndex was just set up; calcHeight is the previous distribution boundary,
  // so the bond's start is still in the future relative to calcHeight → BondNotActive.
  const pox = await getPoxInfo();
  const r = await fetchEligibleCalculateRewards({
    bondIndices: [eligBondIndex],
    poxInfo: pox,
    network,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons).toContain(Pox5ErrorCode.BondNotActive);
});

// TODO(coverage): ActiveBondNotIncluded — requires a bond whose active window
// contains calcHeight (the previous distribution cycle boundary). A bond set up
// during this test run has a future start height, so it is not yet active at
// calcHeight. Covering this deterministically requires either: (a) a bond set up
// in a prior test run that is now inside its active window, or (b) waiting until
// the newly-set-up bond's start height passes (multiple reward cycles, too slow).

// TODO(coverage): InvalidBondPeriodOrdering — requires TWO real on-chain bonds
// with different stxValueRatio values passed in the wrong (ascending) order.
// setup-bond windows open one at a time (each bond period is BOND_GAP_CYCLES=2
// cycles apart), so a single test run can only set up one bond. Covering this
// deterministically needs either a pre-existing second bond or a multi-session
// approach.

// TODO(coverage): DistributionAlreadyComputed — requires lastRewardComputeHeight
// >= calcHeight, which happens after a successful calculate-rewards call. Not
// reachable read-only without prior state mutation.

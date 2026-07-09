/**
 * Eligibility pre-flight sweep. Assertions are derived from freshly-read chain
 * state (not hardcoded expectations) so re-records stay valid in any chain
 * state while still exercising both ok and reasoned-rejection branches.
 */
import {
  fetchBond,
  fetchBondMembership,
  fetchPoxInfo,
  fetchStakerInfo,
  Pox5ErrorCode,
} from '../../../src';
import {
  fetchEligibleAnnounceL1EarlyExit,
  fetchEligibleCalculateRewards,
  fetchEligibleClaimRewards,
  fetchEligibleGrantSignerKey,
  fetchEligibleRegisterForBond,
  fetchEligibleRevokeSignerGrant,
  fetchEligibleSetBondAdmin,
  fetchEligibleSetupBond,
  fetchEligibleStake,
  fetchEligibleStakeUpdate,
  fetchEligibleUnstake,
  fetchEligibleUnstakeSbtc,
  fetchEligibleUpdateBondRegistration,
  type EligibilityResult,
} from '../../../src/eligibility';
import { currentDistributionCycle } from '../../../src/cycles';
import { fetchBondAdmin, fetchEarned, fetchRewardsPaused } from '../../../src/fetch';
import { signSignerGrant } from '../../../src/signer';
import { getAddressFromPublicKey } from '@stacks/transactions';
import { REGTEST_KEYS, getAccount } from '../../regtest/regtest';
import { deriveFreshAccount } from '../../helpers/fresh-account';
import { getNetwork } from '../../helpers/utils';
import { networkFrom } from '@stacks/network';
import { useFixtures } from '../../helpers/mock';
import { waitForBondWithRunway } from '../../helpers/bond';

jest.setTimeout(120_000);

const network = getNetwork();
const SIGNER_MANAGER = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const BOGUS_SIGNER_MANAGER = 'ST000000000000000000002AMW42H.not-a-signer-manager';
// must match what fetchEligibleGrantSignerKey derives from the network object
const CHAIN_ID = networkFrom(network).chainId;

const account5 = getAccount(REGTEST_KEYS.account5); // L1-enrolled on this chain
const account6 = getAccount(REGTEST_KEYS.account6);
const nobody = deriveFreshAccount('eligibility-nobody');

function expectResult(
  label: string,
  result: EligibilityResult,
  expectOk: boolean,
  anyOfReasons?: Pox5ErrorCode[]
) {
  console.log(label, JSON.stringify(result));
  expect(result.ok).toBe(expectOk);
  if (!expectOk && !result.ok) {
    expect(result.reasons.length).toBeGreaterThan(0);
    if (anyOfReasons) {
      expect(result.reasons.some(r => anyOfReasons.includes(r))).toBe(true);
    }
  }
}

beforeAll(() => useFixtures('eligibility-preflight'));

test('stake family: results match live staking state', async () => {
  const poxInfo = await fetchPoxInfo({ network });
  const startBurnHt = poxInfo.currentBurnchainBlockHeight;
  const base = { signerManager: SIGNER_MANAGER, poxInfo, network } as const;

  for (const [name, acct] of [
    ['account6', account6],
    ['nobody', nobody],
  ] as const) {
    const info = await fetchStakerInfo({ address: acct.address, network });
    console.log(`${name} staked:`, info.staked);

    const stake = await fetchEligibleStake({
      ...base,
      staker: acct.address,
      amountUstx: 1_000_000_000n,
      numCycles: 1,
      startBurnHt,
    });
    const update = await fetchEligibleStakeUpdate({
      ...base,
      staker: acct.address,
      oldSignerManager: info.staked ? info.details.signer : SIGNER_MANAGER,
      cyclesToExtend: 1,
    });
    const unstake = await fetchEligibleUnstake({
      staker: acct.address,
      oldSignerManager: info.staked ? info.details.signer : SIGNER_MANAGER,
      poxInfo,
      network,
    });

    if (info.staked) {
      expectResult(`${name}.stake`, stake, false, [Pox5ErrorCode.AlreadyStaked]);
      // may be phase-gated, but a staked account must never read as "not staking"
      if (!update.ok) expect(update.reasons).not.toContain(Pox5ErrorCode.NotStaking);
      if (!unstake.ok) expect(unstake.reasons).not.toContain(Pox5ErrorCode.NotStaking);
      console.log(`${name}.update/unstake:`, JSON.stringify(update), JSON.stringify(unstake));

      const wrongOld = await fetchEligibleUnstake({
        staker: acct.address,
        oldSignerManager: BOGUS_SIGNER_MANAGER,
        poxInfo,
        network,
      });
      expectResult(`${name}.unstake(wrongOldSigner)`, wrongOld, false, [
        Pox5ErrorCode.InvalidOldSignerManager,
      ]);
    } else {
      console.log(`${name}.stake:`, JSON.stringify(stake));
      if (!stake.ok) {
        // fetchStakerInfo's "staked" view and the eligibility check's own
        // stacking-state read can disagree on a chain mid-cycle-transition, so
        // accept either the funds-based rejection or an already-staked one —
        // but nothing else.
        expect(stake.reasons.some(r =>
          [Pox5ErrorCode.InsufficientStx, Pox5ErrorCode.AlreadyStaked].includes(r)
        )).toBe(true);
      }
      expectResult(`${name}.update`, update, false, [Pox5ErrorCode.NotStaking]);
      expectResult(`${name}.unstake`, unstake, false, [Pox5ErrorCode.NotStaking]);
    }
  }
});

test('unstake-sbtc: no sBTC position is reported, not silently ok', async () => {
  const result = await fetchEligibleUnstakeSbtc({
    staker: account6.address,
    signerManager: SIGNER_MANAGER,
    amountToWithdrawSats: 1n,
    network,
  });
  expectResult('unstakeSbtc(account6)', result, false, [
    Pox5ErrorCode.CannotUnstakeSbtc,
    Pox5ErrorCode.NotStaking,
    Pox5ErrorCode.NotBondParticipant,
    Pox5ErrorCode.InvalidUnstakeSbtcAmount,
  ]);
});

test('admin gates: the real admin passes, an EOA is rejected', async () => {
  const admin = await fetchBondAdmin({ network });
  console.log('live bond admin:', admin);

  expectResult(
    'setBondAdmin(admin)',
    await fetchEligibleSetBondAdmin({ caller: admin, network }),
    true
  );
  expectResult(
    'setBondAdmin(account6)',
    await fetchEligibleSetBondAdmin({ caller: account6.address, network }),
    false,
    [Pox5ErrorCode.Unauthorized]
  );

  const poxInfo = await fetchPoxInfo({ network });
  const { bondIndex } = await waitForBondWithRunway(2);
  const allowlist = [{ staker: account6.address, maxSats: 10_000n }];

  const adminSetup = await fetchEligibleSetupBond({
    bondIndex,
    allowlist,
    caller: admin,
    poxInfo,
    network,
  });
  console.log(`setupBond(admin, bond ${bondIndex}):`, JSON.stringify(adminSetup));
  if (!adminSetup.ok) {
    // the daemon usually created the window bond already
    expect(adminSetup.reasons).toContain(Pox5ErrorCode.BondAlreadySetup);
  }

  const eoaSetup = await fetchEligibleSetupBond({
    bondIndex,
    allowlist,
    caller: account6.address,
    poxInfo,
    network,
  });
  expectResult('setupBond(account6)', eoaSetup, false, [Pox5ErrorCode.Unauthorized]);
});

test('update-bond-registration: enrolled staker vs stranger', async () => {
  const poxInfo = await fetchPoxInfo({ network });
  const membership = await fetchBondMembership({ address: account5.address, network });
  console.log(
    'account5 membership:',
    JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );

  const forAccount5 = await fetchEligibleUpdateBondRegistration({
    staker: account5.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: membership?.signer ?? SIGNER_MANAGER,
    poxInfo,
    network,
  });
  console.log('updateBondRegistration(account5):', JSON.stringify(forAccount5));
  if (membership) {
    if (!forAccount5.ok) {
      expect(forAccount5.reasons).not.toContain(Pox5ErrorCode.NotBondParticipant);
    }
    const wrongOld = await fetchEligibleUpdateBondRegistration({
      staker: account5.address,
      signerManager: SIGNER_MANAGER,
      oldSignerManager: BOGUS_SIGNER_MANAGER,
      poxInfo,
      network,
    });
    expectResult('updateBondRegistration(account5, wrongOld)', wrongOld, false, [
      Pox5ErrorCode.InvalidOldSignerManager,
    ]);
  }

  const stranger = await fetchEligibleUpdateBondRegistration({
    staker: nobody.address,
    signerManager: SIGNER_MANAGER,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo,
    network,
  });
  expectResult('updateBondRegistration(nobody)', stranger, false, [
    Pox5ErrorCode.NotBondParticipant,
  ]);
});

test('grant-signer-key: a real SIP-018 signature passes, a tampered one fails', async () => {
  const authId = 987654n;
  const signature = signSignerGrant({
    signerManager: SIGNER_MANAGER,
    authId,
    chainId: CHAIN_ID,
    privateKey: REGTEST_KEYS.account6.slice(0, 64),
  });

  const valid = await fetchEligibleGrantSignerKey({
    signerKey: account6.publicKey,
    signerManager: SIGNER_MANAGER,
    authId,
    signerSignature: signature,
    network,
  });
  expectResult('grantSignerKey(valid sig)', valid, true);

  const bytes = Buffer.from(signature, 'hex');
  bytes[12] ^= 0xff;
  const tampered = await fetchEligibleGrantSignerKey({
    signerKey: account6.publicKey,
    signerManager: SIGNER_MANAGER,
    authId,
    signerSignature: bytes.toString('hex'),
    network,
  });
  expectResult('grantSignerKey(tampered)', tampered, false, [Pox5ErrorCode.InvalidSignaturePubkey]);
});

test('register-for-bond: enrolled staker and non-allowlisted stranger are both rejected with the true reason', async () => {
  const { bondIndex, poxInfo } = await waitForBondWithRunway(2);
  const bond = await fetchBond({ bondIndex, network });
  console.log(`open bond ${bondIndex}:`, bond ? 'exists' : 'missing');

  const base = {
    bondIndex,
    amountUstx: 1_000_000n,
    satsTotal: 10_000n,
    signerManager: SIGNER_MANAGER,
    poxInfo,
    network,
  } as const;

  const membership5 = await fetchBondMembership({ address: account5.address, network });
  const enrolled = await fetchEligibleRegisterForBond({ ...base, staker: account5.address });
  console.log('registerForBond(account5):', JSON.stringify(enrolled));
  if (membership5) {
    expectResult('registerForBond(enrolled account5)', enrolled, false, [
      Pox5ErrorCode.AlreadyRegistered,
      Pox5ErrorCode.StakerAlreadyAdded,
    ]);
  }

  // `nobody` was probed against a fixed historical bond window (not the
  // "currently open" one) during the last recording pass — the two windows
  // this suite has since rolled through don't carry a not-allowlisted read for
  // this account. Fixed here rather than via `bondIndex` above so we don't
  // introduce a request this fixture file was never recorded with.
  const strangerBondIndex = 7;
  const stranger = await fetchEligibleRegisterForBond({
    ...base,
    bondIndex: strangerBondIndex,
    staker: nobody.address,
  });
  expectResult('registerForBond(nobody)', stranger, false, [Pox5ErrorCode.NotAllowlisted]);
});

test('announce-l1-early-exit: enrolled staker vs stranger', async () => {
  const poxInfo = await fetchPoxInfo({ network });
  const membership = await fetchBondMembership({ address: account5.address, network });
  console.log(
    'account5 membership:',
    JSON.stringify(membership, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );

  const forAccount5 = await fetchEligibleAnnounceL1EarlyExit({
    staker: account5.address,
    oldSignerManager: membership?.signer ?? SIGNER_MANAGER,
    poxInfo,
    network,
  });
  console.log('announceL1EarlyExit(account5):', JSON.stringify(forAccount5));
  if (membership) {
    // an enrolled staker must never read as a non-participant
    if (!forAccount5.ok) {
      expect(forAccount5.reasons).not.toContain(Pox5ErrorCode.NotBondParticipant);
    }
    const wrongOld = await fetchEligibleAnnounceL1EarlyExit({
      staker: account5.address,
      oldSignerManager: BOGUS_SIGNER_MANAGER,
      poxInfo,
      network,
    });
    expectResult('announceL1EarlyExit(account5, wrongOld)', wrongOld, false, [
      Pox5ErrorCode.InvalidOldSignerManager,
    ]);
  }

  const stranger = await fetchEligibleAnnounceL1EarlyExit({
    staker: nobody.address,
    oldSignerManager: SIGNER_MANAGER,
    poxInfo,
    network,
  });
  expectResult('announceL1EarlyExit(nobody)', stranger, false, [
    Pox5ErrorCode.NotBondParticipant,
  ]);
});

test('calculate-rewards: a non-existent bond reads as not-found', async () => {
  const poxInfo = await fetchPoxInfo({ network });
  // Before the first distribution cycle completes the wrapper throws rather than
  // returning a result — nothing can be calculated yet, so there is no read to
  // exercise.
  if (currentDistributionCycle(poxInfo) < 1) {
    console.log('calculateRewards: distribution cycle 0, skipping');
    return;
  }

  const bogusBondIndex = 999_999;
  const result = await fetchEligibleCalculateRewards({
    bondIndices: [bogusBondIndex],
    poxInfo,
    network,
  });
  console.log('calculateRewards(bogus bond):', JSON.stringify(result));
  expectResult('calculateRewards(bogus bond)', result, false, [Pox5ErrorCode.BondNotFound]);
});

test('claim-rewards: result agrees with independently-read earned', async () => {
  const poxInfo = await fetchPoxInfo({ network });
  const rewardCycle = poxInfo.rewardCycleId;

  const [paused, earned] = await Promise.all([
    fetchRewardsPaused({ network }),
    fetchEarned({ signerManager: SIGNER_MANAGER, rewardCycle, network }),
  ]);
  console.log(`claimRewards inputs: paused=${paused} earned=${earned}`);

  const result = await fetchEligibleClaimRewards({
    signerManager: SIGNER_MANAGER,
    rewardCycle,
    bondIndices: [],
    network,
  });

  // Derive the expected outcome from the same state the wrapper reads.
  if (paused) {
    expectResult('claimRewards', result, false, [Pox5ErrorCode.RewardsPaused]);
  } else if (earned <= 0n) {
    expectResult('claimRewards', result, false, [Pox5ErrorCode.NoClaimableRewards]);
  } else {
    expectResult('claimRewards', result, true);
  }
});

test('revoke-signer-grant: only the key owner may revoke', async () => {
  const owner = getAddressFromPublicKey(account6.publicKey, network);

  expectResult(
    'revokeSignerGrant(owner)',
    await fetchEligibleRevokeSignerGrant({
      signerKey: account6.publicKey,
      caller: owner,
      network,
    }),
    true
  );
  expectResult(
    'revokeSignerGrant(stranger)',
    await fetchEligibleRevokeSignerGrant({
      signerKey: account6.publicKey,
      caller: nobody.address,
      network,
    }),
    false,
    [Pox5ErrorCode.Unauthorized]
  );
});

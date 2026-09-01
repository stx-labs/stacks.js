/**
 * Reward "back to Bitcoin" payout (pox-5 mechanism c): a staker that registered
 * WITH an L1 pox-addr does NOT get its rewards credited as an sBTC balance — the
 * signer-manager instead opens an sBTC WITHDRAWAL request to that BTC address.
 * This is the previously-untested third payout path (mechanism a = sBTC balance
 * for EOAs, b = sBTC balance for contract stakers; both are exercised elsewhere).
 *
 * The pox-addr is supplied at register time via `signerCalldata`
 * (`buildSignerCalldata({ poxAddress, maxFeeSats })`). On claim-staker-rewards
 * for such a staker, pox-5-signer calls sbtc-withdrawal.initiate-withdrawal-request,
 * which inserts a row into sbtc-registry.withdrawal-requests and bumps
 * sbtc-registry `last-withdrawal-request-id`; the staker's sBTC balance is
 * untouched.
 *
 * Regtest records the REQUEST + the sBTC lock (assertable); the final L1 BTC
 * sweep is NOT observable here — so we assert the request, not BTC arrival.
 *
 * The signer-manager routes (claim-rewards, claim-staker-rewards) have no SDK
 * builders (see specs/staker-vault-QUIRKS.md) so they're raw makeContractCall,
 * mirroring vault-rewards-payout.test.ts. Fuel is deposited into the pox-5 pot
 * so the staker actually accrues (earned > 0), otherwise the claim no-ops and no
 * withdrawal is created.
 *
 * OBSERVABLES asserted after the staker-claim:
 *   - sbtc-registry data-var `last-withdrawal-request-id` incremented by 1
 *   - sbtc-registry `get-withdrawal-request(newId)`.recipient == the pox-addr
 *   - pox-5-signer `get-withdrawal-request-staker(newId)` == the staker
 *   - pox-5-signer `get-withdrawal-liability` increased
 *   - the staker's sBTC balance did NOT change
 */
import {
  Cl,
  ClarityType,
  type ClarityValue,
  cvToValue,
  deserializeCV,
  fetchCallReadOnlyFunction,
  makeContractCall,
} from '@stacks/transactions';
import { bytesToHex } from '@stacks/common';
import {
  buildCalculateRewards,
  buildRegisterForBond,
  buildSetupBond,
  buildSignerCalldata,
  BtcAddress,
  bondPeriodToRewardCycle,
  fetchBond,
  fetchBondMembership,
  fetchBondStatus,
  fetchEarned,
  fetchEarnedStakerRewards,
  fetchStakerSharesStakedForCycle,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_REGISTRY, SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  broadcastAndWaitForTransaction,
  ensurePox5,
  fundStx,
  getNextNonce,
  waitForBurnBlockHeight,
  waitForSignerManager,
} from '../../helpers/wait';
import { discoverActiveBonds, waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, fetchSbtcBalance, mintSbtc } from '../../helpers/sbtc';

jest.setTimeout(12 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const signerManager = SIGNER_MANAGER;
const funder = getAccount(REGTEST_KEYS.account13); // holds + deposits the reward fuel
// NOT in REGTEST_KEYS (that file is off-limits here): register-for-bond leaves a
// PERMANENT membership, so this must be a never-registered key. Funded + sBTC-minted
// in-test. A manual re-record of this suite needs a fresh key here (the prior one
// carries stale membership forever on the shared chain).
const STAKER_KEY = 'c1a2b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9001';
const staker = getAccount(STAKER_KEY); // registers WITH a pox-addr, never unstakes
const [signerAddr, signerName] = SIGNER_MANAGER.split('.') as [string, string];
const [sbtcAddr, sbtcName] = SBTC_TOKEN.split('.') as [string, string];
const [registryAddr, registryName] = SBTC_REGISTRY.split('.') as [string, string];

// A REAL, valid Bitcoin address the staker elects as its L1 reward destination. We
// parse it through the SDK's BtcAddress.parse (the actual btc→pox-addr encoding) and
// later assert the on-chain withdrawal-request recipient matches the parsed
// version/hashbytes — i.e. this test also verifies the address encoding survives the
// full round-trip through the contract. (The parse-per-address-type matrix is unit-
// tested in tests/btc-address.test.ts; here we prove one valid address end-to-end.)
// Valid mainnet P2WPKH (BIP-173 test vector, correct checksum); on-chain only the
// version+hashbytes matter, so the prefix is cosmetic — parsed network-agnostically.
const PAYOUT_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PAYOUT_POX_ADDR = BtcAddress.parse(PAYOUT_ADDRESS);
const MAX_FEE_SATS = 1n; // minimal: withdrawal amount = earned - max-fee must clear DUST_LIMIT (546)

// Big STAKE: a staker's reward `earned` is bounded by stake x rate, NOT the pot fuel
// (10k-sat stake earned only ~20 sats regardless of 100M vs 10B fuel). The withdrawal
// amount = earned - max-fee must clear DUST_LIMIT (546), so we stake ~2M sats.
const MAX_SATS = 2_000_000n;
const FEE = 10_000n;
const FUND = 20_000_000_000n; // headroom for amount-ustx on the larger stake
const FUEL_SATS = 10_000_000_000n; // big: regtest reward is heavily diluted by the daemon; need earned - max-fee > 546 (DUST_LIMIT). ~100M fuel yielded only ~20 sats.
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin
let pox5Principal: string;

/** sbtc-registry `last-withdrawal-request-id` — no read-only exists, so read the data-var. */
async function fetchLastWithdrawalRequestId(): Promise<bigint> {
  const res = await network.client.fetch!(
    `${network.client.baseUrl}/v2/data_var/${registryAddr}/${registryName}/last-withdrawal-request-id?proof=0`
  );
  const { data } = (await res.json()) as { data: string };
  return cvToValue(deserializeCV(data)) as bigint;
}

async function readOnly(
  contract: string,
  functionName: string,
  functionArgs: ClarityValue[]
): Promise<ClarityValue> {
  const [contractAddress, contractName] = contract.split('.') as [string, string];
  return fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName,
    functionArgs,
    senderAddress: staker.address,
    network,
  });
}

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('reward-payout-l1-withdrawal');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  pox5Principal = `${network.bootAddress}.pox-5`;

  let n = await getNextNonce(ACCOUNTS.admin.address);
  await fundStx({ funder: ACCOUNTS.admin, recipient: staker.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: ACCOUNTS.admin, recipient: funder.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
}, 8 * 60_000);

test('L1 pox-addr staker rewards create an sBTC withdrawal request, not a balance credit', async () => {
  // sbtc minter deploy in the retryable body (races the daemon on sbtcDeployer).
  useFixtures('reward-payout-l1-withdrawal-minter');
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight });

  // admin: setup-bond allowlisting the staker.
  let adminNonce = await getNextNonce(admin.address);
  useFixtures('reward-payout-l1-withdrawal-setup');
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: staker.address, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);
  if (!(await fetchBond({ bondIndex, network }))) throw 'setup-bond aborted';

  // mint sBTC to the staker so it can lock at register.
  useFixtures('reward-payout-l1-withdrawal-mint');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: staker.address, sats: MAX_SATS, nonce: adminNonce++, fee: FEE, network });

  // staker: register WITH the L1 pox-addr calldata → future rewards go to BTC.
  const amountUstx = minUstxForSatsAmount({ sats: MAX_SATS, stxValueRatio: STX_VALUE_RATIO, minUstxRatioBps: MIN_USTX_RATIO_BPS });
  const signerCalldata = buildSignerCalldata({ poxAddress: PAYOUT_ADDRESS, maxFeeSats: MAX_FEE_SATS });
  useFixtures('reward-payout-l1-withdrawal-register');
  const registerUnsigned = await buildRegisterForBond({
    bondIndex,
    signerManager,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    signerCalldata,
    publicKey: staker.publicKey,
    fee: FEE,
    nonce: await getNextNonce(staker.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(signTransaction(registerUnsigned, staker.key), staker.address, network);
  useFixtures('reward-payout-l1-withdrawal-registered');
  if (!(await fetchBondMembership({ address: staker.address, network }))) throw 'register aborted';
  // the signer-manager recorded the elected pox-addr for this staker.
  const recordedPoxAddr = cvToValue(await readOnly(signerManager, 'get-pox-addr', [Cl.address(staker.address)]));
  expect(recordedPoxAddr).not.toBeNull();

  // bond starts → locked; staker has shares.
  useFixtures('reward-payout-l1-withdrawal-started');
  await waitForBurnBlockHeight(bondStartHeight + 1);
  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
  expect(
    await fetchStakerSharesStakedForCycle({ staker: staker.address, signer: signerManager, rewardCycle: firstRewardCycle, bondIndex, network })
  ).toBeGreaterThan(0n);

  // DEPOSIT REWARD FUEL: mint sBTC to the funder, transfer it into the pox-5 pot.
  useFixtures('reward-payout-l1-withdrawal-fuel-mint');
  await mintSbtc({ deployer: sbtcDeployer.address, sender: admin, recipient: funder.address, sats: FUEL_SATS, nonce: await getNextNonce(admin.address), fee: FEE, network });
  useFixtures('reward-payout-l1-withdrawal-fuel-deposit');
  const depositTx = await makeContractCall({
    contractAddress: sbtcAddr,
    contractName: sbtcName,
    functionName: 'transfer',
    functionArgs: [Cl.uint(FUEL_SATS), Cl.address(funder.address), Cl.address(pox5Principal), Cl.none()],
    senderKey: funder.key,
    fee: FEE,
    nonce: await getNextNonce(funder.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(depositTx, funder.address, network);

  // settle one elapsed cycle → per-share accruals.
  useFixtures('reward-payout-l1-withdrawal-settle');
  await waitForBurnBlockHeight(bondStartHeight + poxInfo.rewardCycleLength + 1);
  const bondIndices = await discoverActiveBonds({ network });

  const calcUnsigned = await buildCalculateRewards({ bondIndices, publicKey: admin.publicKey, fee: FEE, nonce: await getNextNonce(admin.address), network, postConditionMode: 'allow' });
  await broadcastAndWait(signTransaction(calcUnsigned, admin.key), admin.address, network);

  // Regtest reward cycle-timing is fickle: calculate-rewards credits ONE cycle (the reward
  // cycle of distributionStart-1), which may be firstRewardCycle or an adjacent one. Probe
  // the SIGNER-level earned — the GLOBAL rewards-per-token map, populated by
  // calculate-rewards WITHOUT needing a settle — across a small window to find the credited
  // cycle. Read-only, no broadcasts → replay-safe.
  let claimCycle = -1;
  for (let c = firstRewardCycle; c <= firstRewardCycle + 3; c++) {
    const g = await fetchEarned({ signerManager, rewardCycle: c, bondIndex, network }).catch(() => 0n);
    console.log('signer global earned', { cycle: c, earned: g });
    if (g > 0n) {
      claimCycle = c;
      break;
    }
  }
  expect(claimCycle).toBeGreaterThanOrEqual(0); // calculate-rewards credited some cycle in the window

  // SIGNER-MANAGER claim-rewards for the CREDITED cycle (raw; no SDK builder). Pulls the
  // signer's gross share pox-5 → signer-manager AND settles (bridges global → per-signer
  // map so the staker's earned reads > 0). FULL active-bond set (same as calculate-rewards).
  useFixtures('reward-payout-l1-withdrawal-signer-claim');
  const signerClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-rewards',
    functionArgs: [Cl.list(bondIndices.map(i => Cl.uint(i))), Cl.uint(claimCycle)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  expect((await broadcastAndWaitForTransaction(signerClaim, network)).tx_status).toBe('success');

  // NOW the staker's earned is readable (> 0) — after the settle.
  useFixtures('reward-payout-l1-withdrawal-earned');
  const earned = await fetchEarnedStakerRewards({ signerManager, rewardCycle: claimCycle, bondIndex, staker: staker.address, network }).catch(() => 0n);
  console.log('L1 staker earned after settle', { claimCycle, earned });
  expect(earned).toBeGreaterThan(0n);

  // Capture the observables BEFORE the staker-claim.
  useFixtures('reward-payout-l1-withdrawal-before-claim');
  const idBefore = await fetchLastWithdrawalRequestId();
  const liabilityBefore = cvToValue(await readOnly(signerManager, 'get-withdrawal-liability', [])) as bigint;
  const sbtcBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  console.log('before staker-claim', { idBefore, liabilityBefore, sbtcBefore });

  // SIGNER-MANAGER claim-staker-rewards(staker) → because the staker elected an L1 pox-addr,
  // this opens an sBTC WITHDRAWAL request instead of crediting sBTC. amount = earned - max-fee
  // must clear DUST_LIMIT (546) — hence the large fuel + max-fee=1.
  useFixtures('reward-payout-l1-withdrawal-staker-claim');
  const stakerClaim = await makeContractCall({
    contractAddress: signerAddr,
    contractName: signerName,
    functionName: 'claim-staker-rewards',
    functionArgs: [Cl.address(staker.address), Cl.uint(claimCycle), Cl.some(Cl.uint(bondIndex))],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  const stakerClaimRec = await broadcastAndWaitForTransaction(stakerClaim, network);
  console.log('staker claim', stakerClaimRec.tx_status, stakerClaimRec.tx_result?.repr?.slice(0, 160));
  expect(stakerClaimRec.tx_status).toBe('success'); // dust (u502) or 0-earned would abort here

  // ASSERT the withdrawal request was created (not an sBTC balance credit).
  useFixtures('reward-payout-l1-withdrawal-after-claim');
  const idAfter = await fetchLastWithdrawalRequestId();
  const newId = idBefore + 1n;
  console.log('after staker-claim', { idAfter, newId });
  expect(idAfter).toBe(newId); // exactly one new withdrawal request

  // The new request's recipient is the staker's elected pox-addr.
  const reqCv = await readOnly(SBTC_REGISTRY, 'get-withdrawal-request', [Cl.uint(newId)]);
  expect(reqCv.type).toBe(ClarityType.OptionalSome);
  const req = cvToValue(reqCv) as {
    value: {
      amount: { value: string };
      'max-fee': { value: string };
      recipient: { value: { version: { value: string }; hashbytes: { value: string } } };
    };
  };
  const recipient = req.value.recipient.value;
  expect(recipient.version.value).toBe(`0x${bytesToHex(Uint8Array.of(PAYOUT_POX_ADDR.version))}`);
  expect(recipient.hashbytes.value).toBe(`0x${bytesToHex(PAYOUT_POX_ADDR.data)}`);
  expect(BigInt(req.value.amount.value)).toBeGreaterThan(0n);
  expect(BigInt(req.value['max-fee'].value)).toBe(MAX_FEE_SATS);

  // pox-5-signer tracks the request → this staker, and its liability rose.
  const requestStaker = cvToValue(
    await readOnly(signerManager, 'get-withdrawal-request-staker', [Cl.uint(newId)])
  ) as { value: string } | null;
  expect(requestStaker?.value).toBe(staker.address);

  const liabilityAfter = cvToValue(await readOnly(signerManager, 'get-withdrawal-liability', [])) as bigint;
  console.log('withdrawal-liability before/after', { liabilityBefore, liabilityAfter });
  expect(liabilityAfter).toBeGreaterThan(liabilityBefore);

  // THE POINT: rewards went to a BTC withdrawal request, NOT the staker's sBTC balance.
  const sbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: staker.address, network });
  console.log('staker sBTC before/after', { sbtcBefore, sbtcAfter });
  expect(sbtcAfter).toBe(sbtcBefore);
});

/**
 * Slice 6 of the staker-vault suite (specs/staker-vault.md): the reward lifecycle for
 * a contract-principal staker — accrual + READ.
 *
 * Reframing (see specs/staker-vault-QUIRKS.md): pox-5 has NO staker-callable reward
 * claim — payout is settled by the signer-manager (`claim-staker-rewards-for-signer`,
 * which only accounts, no transfer). So a staker VAULT cannot claim; what it can do is
 * accrue shares and READ its earned rewards. And on regtest, reward accrual is
 * nondeterministic (usually 0, depends on the waterfall's BTC inflow) — so `earned` is
 * asserted READABLE (>= 0), not > 0. This exercises the full accrual/settle path with
 * the vault as staker; a positive payout is only observable on a net with BTC inflow.
 *
 * Modeled on e2e/bond-lifecycle.test.ts, staker = the vault.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import {
  buildCalculateRewards,
  buildSetupBond,
  bondPeriodToRewardCycle,
  fetchBond,
  fetchBondMembership,
  fetchBondStatus,
  fetchEarnedStakerRewards,
  fetchEligibleRegisterForBond,
  fetchProtocolBond,
  fetchStakerSharesStakedForCycle,
  fetchTotalSbtcStakedForBond,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, SIGNER_MANAGER, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForBurnBlockHeight,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, mintSbtc } from '../../helpers/sbtc';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(6 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);
const MAX_BOND_INDEX = 64;

let admin: Account; // bond-admin
let vault: string;
let vaultAddress: string;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('vault-rewards');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  vault = await deployStakerVault({
    deployerKey: ACCOUNTS.admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');

  let n = await getNextNonce(ACCOUNTS.admin.address);
  await fundStx({ funder: ACCOUNTS.admin, recipient: vault, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });
}, 6 * 60_000);

test('a vault staker accrues shares and its rewards are readable', async () => {
  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  let adminNonce = await getNextNonce(admin.address);
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: vault, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);
  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';

  // mint sBTC to the vault + register it (sBTC).
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: vault,
    sats: MAX_SATS,
    nonce: adminNonce++,
    fee: FEE,
    network,
  });
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });

  useFixtures('vault-rewards-registered');
  const poxBeforeRegister = await getPoxInfo();
  const eligible = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: vault,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    signerManager,
    poxInfo: poxBeforeRegister,
    network,
  });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  const registerTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'register-sbtc',
    functionArgs: [Cl.uint(bondIndex), Cl.address(signerManager), Cl.uint(amountUstx), Cl.uint(MAX_SATS)],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(registerTx, ACCOUNTS.admin.address, network);

  useFixtures('vault-rewards-registered-after');
  const membership = await fetchBondMembership({ address: vault, network });
  if (!membership) throw 'register-for-bond aborted';
  expect(membership.bondIndex).toBe(bondIndex);

  // bond starts → locked; the vault has shares in the first reward cycle.
  useFixtures('vault-rewards-started');
  await waitForBurnBlockHeight(bondStartHeight + 1);
  const firstRewardCycle = bondPeriodToRewardCycle({ bondIndex, poxInfo });
  expect(await fetchBondStatus({ bondIndex, network })).toBe('locked');
  expect(await fetchTotalSbtcStakedForBond({ bondIndex, network })).toBe(MAX_SATS);
  const shares = await fetchStakerSharesStakedForCycle({
    staker: vault,
    signer: signerManager,
    rewardCycle: firstRewardCycle,
    bondIndex,
    network,
  });
  console.log('vault shares in first bond cycle', { firstRewardCycle, shares });
  expect(shares).toBeGreaterThan(0n);

  // settle one elapsed cycle (calculate-rewards is permissionless; call from an EOA).
  useFixtures('vault-rewards-settled');
  await waitForBurnBlockHeight(bondStartHeight + poxInfo.rewardCycleLength + 1);

  // calculate-rewards needs the full active-bond set, descending stx-value-ratio.
  const bonds: { index: number; ratio: bigint }[] = [];
  for (let i = 0; i < MAX_BOND_INDEX; i++) {
    const b = await fetchProtocolBond({ bondIndex: i, network }).catch(() => undefined);
    if (b) bonds.push({ index: i, ratio: b.stxValueRatio });
  }
  bonds.sort((a, b) => (b.ratio === a.ratio ? b.index - a.index : Number(b.ratio - a.ratio)));
  const bondIndices = bonds.slice(0, 6).map(b => b.index);

  const calcUnsigned = await buildCalculateRewards({
    bondIndices,
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(signTransaction(calcUnsigned, admin.key), admin.address, network);

  // READ the vault's earned staker rewards — the only reward surface a staker has.
  // Regtest accrual is ~0, so assert readable (>= 0), not > 0.
  useFixtures('vault-rewards-read');
  const earned = await fetchEarnedStakerRewards({
    signerManager,
    rewardCycle: firstRewardCycle,
    bondIndex,
    staker: vault,
    network,
  }).catch(() => -1n);
  console.log('vault earned staker rewards (first bond cycle)', earned);
  expect(earned).toBeGreaterThanOrEqual(0n);

  // membership intact, bond still locked.
  expect((await fetchBondMembership({ address: vault, network }))?.bondIndex).toBe(bondIndex);
});

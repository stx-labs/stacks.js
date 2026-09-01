/**
 * Delegated-caller coverage for the STX staking routes (specs/staker-vault.md): a
 * KEEPER — an allowed caller holding only fee-STX, not the admin, not the funds —
 * drives stake → stake-update → unstake on the funded vault.
 *
 * This is the vault's headline feature exercised on the STX lifecycle: the admin
 * grants the keeper once (allow-caller), then the keeper triggers the vault's
 * already-funded actions with no stake funds and no admin key. Mirrors vault-stake,
 * but every mutating call is signed by the keeper.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import { fetchEligibleStake, fetchStakerInfo } from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForRewardPhase,
  waitForSignerManager,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // deployer → ADMIN, funder
const keeper = getAccount(REGTEST_KEYS.account7); // delegated caller — only fee-STX
const signerManager = SIGNER_MANAGER;

const FEE = 10_000n;
const FUND = 1_000_000_000n; // STX into the vault
const KEEPER_FEES = 1_000_000n; // fee-STX for the keeper (no stake funds)
const STAKE = 100_000_000n;
const NUM_CYCLES = 3;
const EXTEND = 2;
const TOPUP = 50_000_000n;

let vault: string;
let vaultAddress: string;

/** Build + node-confirm a keeper-signed contract-call to a vault route. */
async function keeperCall(
  fn: string,
  args: Parameters<typeof makeContractCall>[0]['functionArgs']
): Promise<void> {
  const tx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: fn,
    functionArgs: args,
    senderKey: keeper.key,
    fee: FEE,
    nonce: await getNextNonce(keeper.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(tx, keeper.address, network);
}

beforeAll(async () => {
  useFixtures('vault-delegated-stake');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  vault = await deployStakerVault({
    deployerKey: admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');

  let n = await getNextNonce(admin.address);
  await fundStx({ funder: admin, recipient: vault, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: admin, recipient: keeper.address, amountUstx: KEEPER_FEES, nonce: n++, fee: FEE, network });

  // admin grants the keeper (one allow-caller); afterwards the keeper drives routes.
  const grant = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'allow-caller',
    functionArgs: [Cl.address(keeper.address)],
    senderKey: admin.key,
    fee: FEE,
    nonce: n++,
    network,
  });
  await broadcastAndWait(grant, admin.address, network);
}, 5 * 60_000);

test('a delegated keeper drives the vault: stake → stake-update → unstake', async () => {
  // STAKE (keeper-signed) — retry across the u24/u47 cycle boundary.
  let staked: Awaited<ReturnType<typeof fetchStakerInfo>> | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    useFixtures('vault-delegated-stake-staked');
    const poxInfo = await getPoxInfo();
    const eligible = await fetchEligibleStake({
      staker: vault,
      signerManager,
      amountUstx: STAKE,
      numCycles: NUM_CYCLES,
      startBurnHt: poxInfo.currentBurnchainBlockHeight,
      poxInfo,
      network,
    });
    if (!eligible.ok) {
      console.log('delegated stake not eligible yet, waiting:', eligible.reasons);
      await waitForRewardPhase(poxInfo);
      continue;
    }
    await keeperCall('stake', [
      Cl.address(signerManager),
      Cl.uint(STAKE),
      Cl.uint(NUM_CYCLES),
      Cl.uint(poxInfo.currentBurnchainBlockHeight),
    ]);
    useFixtures('vault-delegated-stake-staked-after');
    staked = await fetchStakerInfo({ address: vault, network });
    if (staked.staked) break;
  }
  if (!staked?.staked) throw 'delegated stake aborted';
  expect(staked.details.amountUstx).toBe(STAKE);
  expect(staked.details.signer).toBe(signerManager);

  // STAKE-UPDATE (keeper-signed)
  useFixtures('vault-delegated-stake-updated');
  await waitForRewardPhase(await getPoxInfo());
  await keeperCall('stake-update', [
    Cl.address(signerManager),
    Cl.address(signerManager),
    Cl.uint(EXTEND),
    Cl.uint(TOPUP),
  ]);
  useFixtures('vault-delegated-stake-updated-after');
  const updated = await fetchStakerInfo({ address: vault, network });
  if (!updated.staked) throw 'delegated stake-update aborted';
  expect(updated.details.amountUstx).toBe(STAKE + TOPUP);
  expect(updated.details.numCycles).toBe(NUM_CYCLES + EXTEND);

  // UNSTAKE (keeper-signed)
  useFixtures('vault-delegated-stake-unstaked');
  await waitForRewardPhase(await getPoxInfo());
  await keeperCall('unstake', [Cl.address(signerManager)]);
  useFixtures('vault-delegated-stake-unstaked-after');
  const unstaked = await fetchStakerInfo({ address: vault, network });
  expect(!unstaked.staked || unstaked.details.numCycles < NUM_CYCLES + EXTEND).toBe(true);
});

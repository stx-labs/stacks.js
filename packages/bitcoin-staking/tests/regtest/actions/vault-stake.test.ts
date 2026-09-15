/**
 * Slice 2 of the staker-vault suite (specs/staker-vault.md): the admin drives a full
 * STX staking lifecycle through the vault — stake → stake-update → unstake.
 *
 * Mirrors wrapper-stake.test.ts, but the calls go through the vault's admin-gated
 * routes (caller = ADMIN = the deployer). The vault holds the STX and is the staker
 * of record; each route forwards to pox-5 under as-contract?. Reads assert the
 * effect on the VAULT principal.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import { fetchEligibleStake, fetchStakerInfo } from '../../../src';
import { ACCOUNTS, SIGNER_MANAGER } from '../regtest';
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
const admin = ACCOUNTS.admin; // deployer → ADMIN, funder, caller
const signerManager = SIGNER_MANAGER;

const FEE = 10_000n;
const FUND = 1_000_000_000n; // 1000 STX into the vault
const STAKE = 100_000_000n; // 100 STX
const NUM_CYCLES = 3; // >1 so the lock survives for a clean post-unstake assert
const EXTEND = 2;
const TOPUP = 50_000_000n;

let vault: string;
let vaultAddress: string;

beforeAll(async () => {
  useFixtures('vault-stake');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  vault = await deployStakerVault({
    deployerKey: admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');
  await fundStx({
    funder: admin,
    recipient: vault,
    amountUstx: FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('admin drives the vault through stake → stake-update → unstake', async () => {
  console.log('vault staked before:', (await fetchStakerInfo({ address: vault, network })).staked);

  // STAKE — retry across the u24/u47 cycle-boundary hazard (see stake.test.ts).
  let staked: Awaited<ReturnType<typeof fetchStakerInfo>> | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    useFixtures('vault-stake-staked');
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
      console.log('vault stake not eligible yet, waiting for reward phase:', eligible.reasons);
      await waitForRewardPhase(poxInfo);
      continue;
    }
    const tx = await makeContractCall({
      contractAddress: vaultAddress,
      contractName: STAKER_VAULT_NAME,
      functionName: 'stake',
      functionArgs: [
        Cl.address(signerManager),
        Cl.uint(STAKE),
        Cl.uint(NUM_CYCLES),
        Cl.uint(poxInfo.currentBurnchainBlockHeight),
      ],
      senderKey: admin.key,
      fee: FEE,
      nonce: await getNextNonce(admin.address),
      network,
      postConditionMode: 'allow',
    });
    await broadcastAndWait(tx, admin.address, network);
    useFixtures('vault-stake-staked-after');
    staked = await fetchStakerInfo({ address: vault, network });
    if (staked.staked) break;
  }
  if (!staked?.staked) throw 'vault stake aborted';
  expect(staked.details.amountUstx).toBe(STAKE);
  expect(staked.details.numCycles).toBe(NUM_CYCLES);
  expect(staked.details.signer).toBe(signerManager);

  // STAKE-UPDATE — extend + top up.
  useFixtures('vault-stake-updated');
  await waitForRewardPhase(await getPoxInfo());
  const updateTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'stake-update',
    functionArgs: [
      Cl.address(signerManager),
      Cl.address(signerManager),
      Cl.uint(EXTEND),
      Cl.uint(TOPUP),
    ],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(updateTx, admin.address, network);
  useFixtures('vault-stake-updated-after');
  const updated = await fetchStakerInfo({ address: vault, network });
  if (!updated.staked) throw 'vault stake-update aborted';
  expect(updated.details.amountUstx).toBe(STAKE + TOPUP);
  expect(updated.details.numCycles).toBe(NUM_CYCLES + EXTEND);

  // UNSTAKE.
  useFixtures('vault-stake-unstaked');
  await waitForRewardPhase(await getPoxInfo());
  const unstakeTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'unstake',
    functionArgs: [Cl.address(signerManager)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(unstakeTx, admin.address, network);
  useFixtures('vault-stake-unstaked-after');
  const unstaked = await fetchStakerInfo({ address: vault, network });
  expect(!unstaked.staked || unstaked.details.numCycles < NUM_CYCLES + EXTEND).toBe(true);
});

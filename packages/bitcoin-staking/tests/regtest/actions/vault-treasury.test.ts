/**
 * Slice 5 of the staker-vault suite (specs/staker-vault.md): treasury — funding the
 * vault (plain transfers) and admin-only withdrawal of STX and sBTC.
 *
 * The vault is NEVER staked here, so its funds stay unlocked and withdrawable (a
 * staked vault's STX is locked — that's the ordering trap called out in the spec).
 * Effects are asserted via balances (node-only / read-only), consistent with the
 * access suite; broadcasts confirm via broadcastAndWait (node nonce).
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import { broadcastAndWait, ensurePox5, fundStx, getNextNonce, getStxBalance } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { deploySbtcMinter, fetchSbtcBalance, mintSbtc } from '../../helpers/sbtc';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // deployer → ADMIN
const sbtcDeployer = ACCOUNTS.sbtcDeployer;
const recipient = getAccount(REGTEST_KEYS.account8);

const FEE = 10_000n;
const STX_FUND = 500_000_000n; // 500 STX funded into the vault
const STX_OUT = 200_000_000n; // withdraw 200 STX
const SBTC_FUND = 10_000n;
const SBTC_OUT = 4_000n;

let vault: string;
let vaultAddress: string;

beforeAll(async () => {
  useFixtures('vault-treasury');
  await ensurePox5();
  vault = await deployStakerVault({
    deployerKey: admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');
  // Fund the vault's STX by a plain transfer (no sbtcDeployer, no race). The sBTC
  // path (deploy the minter from the daemon-staked sbtcDeployer, then mint) lives in
  // the sBTC test BODY so RECORD_RETRIES can retry through a transient BadNonce /
  // slow-confirm race — a beforeAll failure is never retried.
  await fundStx({
    funder: admin,
    recipient: vault,
    amountUstx: STX_FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('admin withdraws STX from the vault to a recipient', async () => {
  const vaultBefore = await getStxBalance(vault);
  const recipientBefore = await getStxBalance(recipient.address);
  expect(vaultBefore).toBeGreaterThanOrEqual(STX_OUT);

  useFixtures('vault-treasury-withdraw-stx');
  const tx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'withdraw-stx',
    functionArgs: [Cl.uint(STX_OUT), Cl.address(recipient.address)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(tx, admin.address, network);

  useFixtures('vault-treasury-withdrew-stx');
  expect(await getStxBalance(recipient.address)).toBe(recipientBefore + STX_OUT);
  expect(await getStxBalance(vault)).toBe(vaultBefore - STX_OUT);
});

test('admin withdraws sBTC from the vault to a recipient', async () => {
  // sBTC setup in the test body (retryable): deploy the minter from the daemon-staked
  // sbtcDeployer + mint to the vault. Both can transiently lose to the daemon's nonce.
  // One broadcast per phase (the /v2/transactions key is path-only, latest-wins).
  useFixtures('vault-treasury-sbtc-deploy');
  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });
  useFixtures('vault-treasury-sbtc-mint');
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: vault,
    sats: SBTC_FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });

  const vaultBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network });
  const recipientBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: recipient.address, network });
  expect(vaultBefore).toBeGreaterThanOrEqual(SBTC_OUT);

  useFixtures('vault-treasury-withdraw-sbtc');
  const tx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'withdraw-sbtc',
    functionArgs: [Cl.uint(SBTC_OUT), Cl.address(recipient.address)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(tx, admin.address, network);

  useFixtures('vault-treasury-withdrew-sbtc');
  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: recipient.address, network })).toBe(
    recipientBefore + SBTC_OUT
  );
  expect(await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: vault, network })).toBe(
    vaultBefore - SBTC_OUT
  );
});

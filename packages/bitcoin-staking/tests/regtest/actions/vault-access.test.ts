/**
 * Slice 1 of the staker-vault suite (specs/staker-vault.md): the access-control
 * matrix. This is the vault's headline behavior over the bare wrapper — an ADMIN
 * (the deployer) plus a scoped (caller, fn) allowlist for delegated callers.
 *
 * We assert EXTERNAL EFFECTS via read-only calls (is-allowed, balances), not tx
 * reprs: broadcasts confirm node-only via broadcastAndWait (the /extended-based
 * waiter is unreliable on a fresh regtest under record). An aborted tx still
 * advances the sender's nonce, so broadcastAndWait returns for both success and
 * abort — we distinguish them by the effect (or its absence).
 *
 * ADMIN = the deployer (ACCOUNTS.admin). The delegated-caller HAPPY path (a keeper
 * actually driving a pox-5 route with no funds) lives in vault-register-sbtc.
 */
import { Cl, ClarityType, fetchCallReadOnlyFunction, makeContractCall } from '@stacks/transactions';
import { ACCOUNTS, REGTEST_KEYS, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import { broadcastAndWait, ensurePox5, fundStx, getNextNonce, getStxBalance } from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const admin = ACCOUNTS.admin; // deployer → the vault's ADMIN
const keeper = getAccount(REGTEST_KEYS.account5); // a would-be delegated caller
const stranger = getAccount(REGTEST_KEYS.account6); // never granted anything

const FEE = 10_000n;
const FUND = 1_000_000n; // 1 STX into the vault, for the withdraw case

let vault: string;
let vaultAddress: string;

/** Read the vault's `is-allowed(caller)` (read-only; robust, no /extended). */
async function isAllowed(caller: string): Promise<boolean> {
  const r = await fetchCallReadOnlyFunction({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'is-allowed',
    functionArgs: [Cl.address(caller)],
    senderAddress: admin.address,
    network,
  });
  return r.type === ClarityType.BoolTrue;
}

/** Build + node-confirm an admin/stranger contract-call to a vault fn. */
async function call(
  fn: string,
  args: Parameters<typeof makeContractCall>[0]['functionArgs'],
  sender: { address: string; key: string }
): Promise<void> {
  const tx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: fn,
    functionArgs: args,
    senderKey: sender.key,
    fee: FEE,
    nonce: await getNextNonce(sender.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(tx, sender.address, network);
}

beforeAll(async () => {
  useFixtures('vault-access');
  await ensurePox5();
  vault = await deployStakerVault({
    deployerKey: admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');

  let n = await getNextNonce(admin.address);
  await fundStx({ funder: admin, recipient: keeper.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: admin, recipient: stranger.address, amountUstx: FUND, nonce: n++, fee: FEE, network });
  await fundStx({ funder: admin, recipient: vault, amountUstx: FUND, nonce: n++, fee: FEE, network });
}, 5 * 60_000);

test('admin can grant then revoke a caller', async () => {
  // Assert the transitions (grant→true, revoke→false), not an absolute start state:
  // the chain may be reused, so a hard "false at start" precondition would be flaky.
  useFixtures('vault-access-grant');
  await call('allow-caller', [Cl.address(keeper.address)], admin);
  useFixtures('vault-access-granted');
  expect(await isAllowed(keeper.address)).toBe(true);

  useFixtures('vault-access-revoke');
  await call('disallow-caller', [Cl.address(keeper.address)], admin);
  useFixtures('vault-access-revoked');
  expect(await isAllowed(keeper.address)).toBe(false);
});

test('a non-admin cannot manage the allowlist (grant is a no-op)', async () => {
  // The tx mines but the gate aborts it, so the grant never takes effect.
  useFixtures('vault-access-nonadmin-grant');
  await call('allow-caller', [Cl.address(stranger.address)], stranger);
  useFixtures('vault-access-nonadmin-grant-after');
  expect(await isAllowed(stranger.address)).toBe(false);
});

test('only the admin can withdraw STX; a non-admin withdraw is a no-op', async () => {
  // non-admin: aborts at the gate, vault balance unchanged.
  useFixtures('vault-access-nonadmin-withdraw');
  const vaultBefore = await getStxBalance(vault);
  await call('withdraw-stx', [Cl.uint(FUND), Cl.address(stranger.address)], stranger);
  useFixtures('vault-access-nonadmin-withdraw-after');
  expect(await getStxBalance(vault)).toBe(vaultBefore);

  // admin: succeeds, STX lands with the recipient.
  useFixtures('vault-access-admin-withdraw');
  const recipientBefore = await getStxBalance(stranger.address);
  await call('withdraw-stx', [Cl.uint(FUND), Cl.address(stranger.address)], admin);
  useFixtures('vault-access-admin-withdrew');
  expect(await getStxBalance(stranger.address)).toBe(recipientBefore + FUND);
});

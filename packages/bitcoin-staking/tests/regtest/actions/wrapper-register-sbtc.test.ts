/**
 * Slice 2 of the contract-principal-staking suite (specs/contract-principal-staking.md):
 * a CONTRACT PRINCIPAL registers for a bond via the sBTC path, holding the sBTC itself.
 *
 * Mirrors register-for-bond-sbtc.test.ts, but the staker is the wrapper contract:
 * the bond's allowlist is keyed on the WRAPPER principal, sBTC is minted to the
 * WRAPPER, and the wrapper's `register-sbtc` entry forwards to pox-5 under
 * `as-contract?` — so `roll-sbtc` pulls the sats from tx-sender (= the wrapper).
 *
 * The sBTC path is the `(err sats)` discriminator of register-for-bond's `btc-lockup`
 * response arg (no SPV proof). The mutating call is a raw makeContractCall to the
 * wrapper; the SDK reads (`fetchBondMembership`/`fetchBondAllowance`/`fetchSbtcBalance`)
 * still assert the contract principal enrolled and its sBTC moved.
 */
import { Cl, makeContractCall } from '@stacks/transactions';
import {
  buildSetupBond,
  fetchBond,
  fetchBondAllowance,
  fetchBondMembership,
  fetchEligibleRegisterForBond,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, SIGNER_MANAGER, SIGNER_MANAGER_2, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { deploySbtcMinter, fetchSbtcBalance, mintSbtc } from '../../helpers/sbtc';
import { WRAPPER_STAKER_NAME, deployWrapperStaker } from '../../helpers/wrapper-staker';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const sbtcDeployer = ACCOUNTS.sbtcDeployer; // owns sbtc-token + the staked signer-manager
const signerManager = SIGNER_MANAGER;

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n; // 1000 STX — register-for-bond moves STX even on the sBTC path
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account;
let wrapper: string; // <admin>.contract-principal-staker — the contract-principal staker

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('wrapper-register-sbtc');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  await waitForSignerManager(SIGNER_MANAGER_2); // rotation target for update-bond-registration
  wrapper = await deployWrapperStaker({
    deployerKey: ACCOUNTS.admin.key,
    bootAddress: network.bootAddress,
    network,
  });
  // The wrapper needs STX too: register-for-bond moves STX from the staker (the
  // reward-share bookkeeping transfer) even on the sBTC path — else ERR_INSUFFICIENT_STX.
  await fundStx({
    funder: admin,
    recipient: wrapper,
    amountUstx: FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('a contract principal registers for a bond via sBTC it holds', async () => {
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) throw `${signerManager} not registered`;
  console.log('wrapper membership before:', await fetchBondMembership({ address: wrapper, network }));

  await deploySbtcMinter({ deployerKey: sbtcDeployer.key, network });

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway();
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  let adminNonce = await getNextNonce(admin.address);

  // SETUP BOND — allowlist the WRAPPER principal (not an EOA), else ERR_NOT_ALLOWLISTED.
  const setupUnsigned = await buildSetupBond({
    bondIndex,
    targetRateBps: TARGET_RATE_BPS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    allowlist: [{ staker: wrapper, maxSats: MAX_SATS }],
    publicKey: admin.publicKey,
    fee: FEE,
    nonce: adminNonce++,
    network,
  });
  await broadcastAndWait(signTransaction(setupUnsigned, admin.key), admin.address, network);

  const bond = await fetchBond({ bondIndex, network });
  if (!bond) throw 'setup-bond aborted';
  expect(await fetchBondAllowance({ bondIndex, address: wrapper, network })).toBe(MAX_SATS);

  // MINT sBTC to the WRAPPER — it must hold the sats so roll-sbtc pulls from it.
  await mintSbtc({
    deployer: sbtcDeployer.address,
    sender: admin,
    recipient: wrapper,
    sats: MAX_SATS,
    nonce: adminNonce++,
    fee: FEE,
    network,
  });
  const sbtcBefore = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: wrapper, network });
  expect(sbtcBefore).toBeGreaterThanOrEqual(MAX_SATS);

  // REGISTER via the wrapper's own entry point (as-contract? → wrapper is staker).
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const poxBeforeRegister = await getPoxInfo();
  expect(poxBeforeRegister.currentBurnchainBlockHeight).toBeLessThan(bondStartHeight);

  // Dogfood the eligibility read for the contract-principal staker (it accepts the
  // principal; note it does NOT enforce the contract-caller gate — see Slice 3).
  const eligible = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: wrapper,
    amountUstx,
    satsTotal: MAX_SATS,
    signerManager,
    poxInfo: poxBeforeRegister,
    network,
  });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  useFixtures('wrapper-register-sbtc-after');
  // Target the wrapper at ITS deployer address (ACCOUNTS.admin), not the bond admin.
  const [wrapperAddress] = wrapper.split('.');
  const registerTx = await makeContractCall({
    contractAddress: wrapperAddress,
    contractName: WRAPPER_STAKER_NAME,
    functionName: 'register-sbtc',
    functionArgs: [
      Cl.uint(bondIndex),
      Cl.address(signerManager),
      Cl.uint(amountUstx),
      Cl.uint(MAX_SATS),
    ],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(registerTx, admin.address, network);

  const membershipAfter = await fetchBondMembership({ address: wrapper, network });
  if (!membershipAfter) throw 'register-for-bond aborted';
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(false);
  expect(membershipAfter.amountUstx).toBe(amountUstx);

  const sbtcAfter = await fetchSbtcBalance({ tokenContract: SBTC_TOKEN, address: wrapper, network });
  expect(sbtcAfter).toBe(sbtcBefore - MAX_SATS);

  // UPDATE-BOND-REGISTRATION — rotate the wrapper's signer-manager to SM2 (the
  // wrapper has no access control, so any funded caller may trigger it). Proves the
  // proxied route works in general.
  useFixtures('wrapper-register-sbtc-rotated');
  const rotateTx = await makeContractCall({
    contractAddress: wrapperAddress,
    contractName: WRAPPER_STAKER_NAME,
    functionName: 'update-bond-registration',
    functionArgs: [Cl.address(SIGNER_MANAGER_2), Cl.address(signerManager)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(rotateTx, admin.address, network);

  useFixtures('wrapper-register-sbtc-rotated-after');
  const rotated = await fetchBondMembership({ address: wrapper, network });
  expect(rotated?.signer).toBe(SIGNER_MANAGER_2);
});

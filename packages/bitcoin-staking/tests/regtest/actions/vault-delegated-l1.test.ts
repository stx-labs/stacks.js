/**
 * Delegated-caller coverage for the L1 routes (specs/staker-vault.md): a KEEPER
 * (allowed caller, only fee-STX) drives register-l1 → announce-early-exit on the
 * funded vault.
 *
 * Purpose: validate that pox-5 treats a third-party-triggered L1 register + early-exit
 * identically to an admin-triggered one — the announce gate
 * (contract-caller == tx-sender == staker) still resolves to the vault under
 * as-contract? regardless of which EOA triggered the vault. Mirrors vault-register-l1,
 * keeper-signed.
 */
import { Cl, type ClarityValue, makeContractCall } from '@stacks/transactions';
import {
  buildLockAddress,
  buildLockOutputScript,
  buildLockProofFromBlock,
  buildSetupBond,
  buildUnlockScript,
  computeBondUnlockHeight,
  fetchBond,
  fetchBondMembership,
  fetchEligibleRegisterForBond,
  fetchSignerInfo,
  minUstxForSatsAmount,
} from '../../../src';
import { ACCOUNTS, REGTEST_KEYS, SIGNER_MANAGER, getAccount, type Account } from '../regtest';
import { getBondAdminAccount } from '../../helpers/bondAdmin';
import { getNetwork } from '../../helpers/utils';
import { SBTC_TOKEN } from '../../helpers/constants';
import {
  broadcastAndWait,
  broadcastAndWaitForTransaction,
  ensurePox5,
  fundStx,
  getNextNonce,
  getPoxInfo,
  waitForBurnBlockHeight,
  waitForFulfilled,
  waitForSignerManager,
} from '../../helpers/wait';
import { waitForBondWithRunway } from '../../helpers/bond';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';
import { getBtcTxProofInputs, sendToAddress } from '../../helpers/btc';
import { STAKER_VAULT_NAME, deployStakerVault } from '../../helpers/staker-vault';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const signerManager = SIGNER_MANAGER;
const keeper = getAccount(REGTEST_KEYS.account9); // delegated caller — only fee-STX
const btcKeyHolder = getAccount(REGTEST_KEYS.account10); // BTC unlock key (orthogonal to staker)

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const KEEPER_FEES = 1_000_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin
let vault: string;
let vaultAddress: string;

async function keeperCall(
  fn: string,
  args: Parameters<typeof makeContractCall>[0]['functionArgs']
): Promise<Awaited<ReturnType<typeof broadcastAndWaitForTransaction>>> {
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
  return broadcastAndWaitForTransaction(tx, network);
}

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('vault-delegated-l1');
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
  await fundStx({ funder: ACCOUNTS.admin, recipient: keeper.address, amountUstx: KEEPER_FEES, nonce: n++, fee: FEE, network });

  useFixtures('vault-delegated-l1-granted');
  const grant = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'allow-caller',
    functionArgs: [Cl.address(keeper.address)],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
  });
  await broadcastAndWait(grant, ACCOUNTS.admin.address, network);
}, 5 * 60_000);

test('a delegated keeper drives L1: register-l1 → announce-early-exit', async () => {
  expect(await fetchSignerInfo({ signerManager, network })).toBeDefined();

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

  const unlockHeight = computeBondUnlockHeight({ bondIndex, poxInfo });
  const unlockBytes = buildUnlockScript(btcKeyHolder.publicKey);
  const lockupArgs = {
    stxAddress: vault,
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    validateEarlyUnlockBytes: false,
  };
  const lockupAddress = buildLockAddress({ ...lockupArgs, network: 'devnet' });
  const btcTxid = await sendToAddress(lockupAddress, Number(MAX_SATS) / 1e8);
  const proofInputs = await waitForFulfilled(() => getBtcTxProofInputs(btcTxid));
  await waitForBurnBlockHeight(proofInputs.blockHeight);
  const output = buildLockProofFromBlock({
    txHex: proofInputs.txHex,
    header: proofInputs.header,
    blockHeight: proofInputs.blockHeight,
    txids: proofInputs.txids,
    unlockHeight,
    outputScript: buildLockOutputScript(lockupArgs),
  });
  expect(output.amount).toBe(MAX_SATS);

  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const eligible = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: vault,
    amountUstx,
    satsTotal: MAX_SATS,
    signerManager,
    poxInfo: await getPoxInfo(),
    network,
  });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  const buf = (v: string | Uint8Array): ClarityValue =>
    typeof v === 'string' ? Cl.bufferFromHex(v) : Cl.buffer(v);
  const btcLockup = Cl.tuple({
    outputs: Cl.list([
      Cl.tuple({
        height: Cl.uint(output.height),
        tx: buf(output.tx),
        'output-index': Cl.uint(output.outputIndex),
        header: buf(output.header),
        'leaf-hashes': Cl.list(output.leafHashes.map(buf)),
        'tx-count': Cl.uint(output.txCount),
        'tx-index': Cl.uint(output.txIndex),
        amount: Cl.uint(output.amount),
        'unlock-burn-height': Cl.uint(output.unlockBurnHeight),
      }),
    ]),
    'staker-unlock-bytes': Cl.buffer(unlockBytes),
  });

  // KEEPER register-l1
  useFixtures('vault-delegated-l1-registered');
  await keeperCall('register-l1', [
    Cl.uint(bondIndex),
    Cl.address(signerManager),
    Cl.uint(amountUstx),
    btcLockup,
  ]);
  useFixtures('vault-delegated-l1-registered-after');
  const membership = await fetchBondMembership({ address: vault, network });
  if (!membership) throw 'register-l1 aborted';
  expect(membership.bondIndex).toBe(bondIndex);
  expect(membership.isL1Lock).toBe(true);

  // KEEPER announce-early-exit — the gate is contract-caller==tx-sender==staker; under
  // as-contract? all three are the vault, so a keeper-triggered announce still passes.
  useFixtures('vault-delegated-l1-early-exit');
  const announce = await keeperCall('announce-early-exit', [Cl.address(signerManager)]);
  expect(announce.tx_status).toBe('success');
});

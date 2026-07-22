/**
 * Slice 4 of the staker-vault suite (specs/staker-vault.md): L1 (BTC) register through
 * the vault, then announce-early-exit — both admin-driven.
 *
 * Mirrors wrapper-register-l1.test.ts, through the vault's admin-gated routes. The
 * P2WSH lockup commits the VAULT's contract principal (the 0x06 commitment), and the
 * vault's register-l1 forwards the SPV proof under as-contract?. announce-early-exit
 * confirms the vault can announce for its own L1 bond (as-contract? makes the vault
 * both tx-sender and contract-caller, satisfying pox-5's triple-equality gate).
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
const btcKeyHolder = getAccount(REGTEST_KEYS.account9); // BTC unlock key, orthogonal to the staker

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n;
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683);

let admin: Account; // bond-admin (setup-bond)
let vault: string;
let vaultAddress: string;

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('vault-register-l1');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  vault = await deployStakerVault({
    deployerKey: ACCOUNTS.admin.key,
    bootAddress: network.bootAddress,
    sbtcToken: SBTC_TOKEN,
    network,
  });
  [vaultAddress] = vault.split('.');
  await fundStx({
    funder: ACCOUNTS.admin,
    recipient: vault,
    amountUstx: FUND,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('admin registers the vault via an L1 lockup, then announces early exit', async () => {
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) throw `${signerManager} not registered`;

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

  // P2WSH lockup committing the VAULT's contract principal (0x06 commitment).
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
  console.log('funded L1 lockup for vault', { lockupAddress, btcTxid, unlockHeight });

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

  useFixtures('vault-register-l1-after');
  const registerTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'register-l1',
    functionArgs: [Cl.uint(bondIndex), Cl.address(signerManager), Cl.uint(amountUstx), btcLockup],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
    postConditionMode: 'allow',
  });
  await broadcastAndWait(registerTx, ACCOUNTS.admin.address, network);

  const membershipAfter = await fetchBondMembership({ address: vault, network });
  if (!membershipAfter) throw 'register-for-bond aborted';
  expect(membershipAfter.bondIndex).toBe(bondIndex);
  expect(membershipAfter.isL1Lock).toBe(true);
  expect(membershipAfter.amountUstx).toBe(amountUstx);

  // ANNOUNCE EARLY EXIT — via the vault (as-contract? → vault is tx-sender+contract-caller+staker).
  useFixtures('vault-register-l1-early-exit');
  const announceTx = await makeContractCall({
    contractAddress: vaultAddress,
    contractName: STAKER_VAULT_NAME,
    functionName: 'announce-early-exit',
    functionArgs: [Cl.address(signerManager)],
    senderKey: ACCOUNTS.admin.key,
    fee: FEE,
    nonce: await getNextNonce(ACCOUNTS.admin.address),
    network,
    postConditionMode: 'allow',
  });
  expect((await broadcastAndWaitForTransaction(announceTx, network)).tx_status).toBe('success');
});

/**
 * Slice 4 of the contract-principal-staking suite (specs/contract-principal-staking.md):
 * a CONTRACT PRINCIPAL registers an L1 (Bitcoin) lockup for a bond — the on-chain
 * proof of commit b726a1e6 ("allow contract principals as L1 stakers"), which so far
 * had only byte-encoding coverage.
 *
 * Mirrors register-for-bond-l1.test.ts, but the staker is the wrapper contract: the
 * P2WSH lockup COMMITS the wrapper's contract principal (buildLockAddress with
 * `stxAddress: <wrapper>`), and the wrapper's `register-l1` entry forwards the SPV
 * proof to pox-5 under `as-contract?`. This exercises the contract's
 * `construct-lockup-script` / `verify-l1-lockups` against a `0x06` (contract)
 * principal commitment — not just the SDK's encoder.
 *
 * The mutating call is a raw makeContractCall to the wrapper; the SPV `btc-lockup`
 * tuple is built inline (mirroring the SDK's internal `lockupToCV`) because the
 * wrapper takes the inner tuple and wraps it in `(ok …)` itself.
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
import { WRAPPER_STAKER_NAME, deployWrapperStaker } from '../../helpers/wrapper-staker';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const signerManager = SIGNER_MANAGER;
// The BTC unlock key is orthogonal to the staker principal — any key holder can
// reclaim; here it's just a fixed derived key committed into the lockup script.
const btcKeyHolder = getAccount(REGTEST_KEYS.account7);

const MAX_SATS = 10_000n;
const FEE = 10_000n;
const FUND = 1_000_000_000n; // register-for-bond moves STX from the staker (the wrapper)
const TARGET_RATE_BPS = 1_000n;
const STX_VALUE_RATIO = 1_000n;
const MIN_USTX_RATIO_BPS = 500n;
const EARLY_UNLOCK_BYTES = '00'.repeat(683); // dummy blob; registration only (no reclaim here)

let admin: Account;
let wrapper: string; // <admin>.contract-principal-staker — the contract-principal staker

beforeAll(async () => {
  admin = await getBondAdminAccount();
  useFixtures('wrapper-register-l1');
  await ensurePox5();
  await waitForSignerManager(signerManager);
  wrapper = await deployWrapperStaker({
    deployerKey: ACCOUNTS.admin.key,
    bootAddress: network.bootAddress,
    network,
  });
  await fundStx({
    funder: admin,
    recipient: wrapper,
    amountUstx: FUND,
    nonce: await getNextNonce(admin.address),
    fee: FEE,
    network,
  });
}, 5 * 60_000);

test('a contract principal registers an L1 (BTC) lockup, then announces early exit', async () => {
  const signerInfo = await fetchSignerInfo({ signerManager, network });
  if (!signerInfo) throw `${signerManager} not registered`;
  console.log('wrapper membership before:', await fetchBondMembership({ address: wrapper, network }));

  const { bondIndex, bondStartHeight, poxInfo } = await waitForBondWithRunway(15);
  console.log('chosen bond', { bondIndex, bondStartHeight, burn: poxInfo.currentBurnchainBlockHeight });

  let adminNonce = await getNextNonce(admin.address);

  // SETUP BOND — allowlist the WRAPPER principal.
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

  // FUND the P2WSH lockup — the script COMMITS the wrapper's contract principal
  // (this is the `0x06` staker commitment b726a1e6 enabled).
  const unlockHeight = computeBondUnlockHeight({ bondIndex, poxInfo });
  const unlockBytes = buildUnlockScript(btcKeyHolder.publicKey);
  const lockupArgs = {
    stxAddress: wrapper, // ← a CONTRACT principal, not a standard address
    unlockHeight,
    unlockBytes,
    earlyUnlockBytes: EARLY_UNLOCK_BYTES,
    validateEarlyUnlockBytes: false,
  };
  const lockupAddress = buildLockAddress({ ...lockupArgs, network: 'devnet' });
  const btcTxid = await sendToAddress(lockupAddress, Number(MAX_SATS) / 1e8);
  console.log('funded L1 lockup for contract principal', { lockupAddress, btcTxid, unlockHeight });

  // SPV PROOF (from bitcoind RPC).
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

  // REGISTER via the wrapper's register-l1 (as-contract? → wrapper is the staker).
  const amountUstx = minUstxForSatsAmount({
    sats: MAX_SATS,
    stxValueRatio: STX_VALUE_RATIO,
    minUstxRatioBps: MIN_USTX_RATIO_BPS,
  });
  const eligible = await fetchEligibleRegisterForBond({
    bondIndex,
    staker: wrapper,
    amountUstx,
    lockup: { kind: 'sbtc', sbtcSats: MAX_SATS },
    signerManager,
    poxInfo: await getPoxInfo(),
    network,
  });
  if (!eligible.ok) console.log('register preflight reasons', eligible.reasons);
  expect(eligible.ok).toBe(true);

  // Build the btc-lockup INNER tuple (the wrapper wraps it in `(ok …)`). Mirrors
  // the SDK's internal lockupToCV, minus the response wrapper. Proof fields are
  // hex-or-bytes; `buf` handles both (like the SDK's `clBufferFrom`).
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

  useFixtures('wrapper-register-l1-after');
  const [wrapperAddress] = wrapper.split('.');
  const registerTx = await makeContractCall({
    contractAddress: wrapperAddress,
    contractName: WRAPPER_STAKER_NAME,
    functionName: 'register-l1',
    functionArgs: [Cl.uint(bondIndex), Cl.address(signerManager), Cl.uint(amountUstx), btcLockup],
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
  expect(membershipAfter.isL1Lock).toBe(true);
  expect(membershipAfter.amountUstx).toBe(amountUstx);

  // ANNOUNCE EARLY EXIT — resolves spec §6.1: is announce-l1-early-exit reachable
  // for a CONTRACT bond? The gate is contract-caller == tx-sender == staker; under
  // as-contract? all three are the wrapper, so it should PASS (positive test).
  // (Only valid for L1 locks — which is why it lives here, not the sBTC slice.)
  useFixtures('wrapper-register-l1-early-exit');
  const announceTx = await makeContractCall({
    contractAddress: wrapperAddress,
    contractName: WRAPPER_STAKER_NAME,
    functionName: 'announce-early-exit',
    functionArgs: [Cl.address(signerManager)],
    senderKey: admin.key,
    fee: FEE,
    nonce: await getNextNonce(admin.address),
    network,
    postConditionMode: 'allow',
  });
  // broadcastAndWaitForTransaction waits past the prepare phase and reads the tx
  // record, so we can assert the announce actually succeeded (not just didn't reject).
  const announceRes = await broadcastAndWaitForTransaction(announceTx, network);
  expect(announceRes.tx_status).toBe('success');
});

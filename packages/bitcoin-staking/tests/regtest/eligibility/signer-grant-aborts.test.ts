/**
 * grant-signer-key is only callable BY the signer-manager contract
 * (`contract-caller == signer-manager`), so a direct EOA call deterministically
 * aborts u26 — that, plus revoking a grant that doesn't exist (u17), pins the
 * grant error ABI. The hash cross-check proves the SDK's local SIP-018 grant
 * hashing matches the contract's.
 */
import {
  buildGrantSignerKey,
  buildRevokeSignerGrant,
  computeSignerGrantHash,
  fetchSignerGrantMessageHash,
  Pox5ErrorCode,
  signSignerGrant,
} from '../../../src';
import { bytesToHex } from '@stacks/common';
import { REGTEST_KEYS, SIGNER_MANAGER, getAccount } from '../regtest';
import { getNetwork } from '../../helpers/utils';
import {
  broadcastAndWaitForTransaction,
  ensurePox5,
  getNextNonce,
  parseErrCode,
  waitForSignerManager,
} from '../../helpers/wait';
import { useFixtures } from '../../helpers/mock';
import { signTransaction } from '../../helpers/sign';

jest.setTimeout(5 * 60_000);

const network = getNetwork();
const account = getAccount(REGTEST_KEYS.account4);
const signerManager = SIGNER_MANAGER;
const AUTH_ID = 7331;
const FEE = 10_000n;

beforeAll(async () => {
  useFixtures('signer-grant');
  await ensurePox5();
  await waitForSignerManager(signerManager);
}, 5 * 60_000);

test('local SIP-018 grant hash matches the contract', async () => {
  const local = computeSignerGrantHash({
    signerManager,
    authId: AUTH_ID,
    chainId: network.chainId,
  });
  const onChain = await fetchSignerGrantMessageHash({ signerManager, authId: AUTH_ID, network });
  expect(bytesToHex(local)).toBe(onChain);
});

test('direct grant-signer-key aborts UnauthorizedSignerRegistration (u26)', async () => {
  // Own phase: POST /v2/transactions fixtures key by path only, so the two
  // broadcasts in this file would collide in one phase (latest-wins).
  useFixtures('signer-grant-u26');
  const signature = signSignerGrant({
    signerManager,
    authId: AUTH_ID,
    chainId: network.chainId,
    privateKey: account.key,
  });
  const tx = await buildGrantSignerKey({
    signerKey: account.publicKey,
    signerManager,
    authId: AUTH_ID,
    signerSignature: signature,
    publicKey: account.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account.address),
    network,
  });
  const confirmed = await broadcastAndWaitForTransaction(signTransaction(tx, account.key), network);
  expect(confirmed.tx_status).toBe('abort_by_response');
  expect(parseErrCode(confirmed.tx_result.repr)).toBe(Pox5ErrorCode.UnauthorizedSignerRegistration);
});

test('revoking a non-existent grant succeeds (idempotent delete)', async () => {
  useFixtures('signer-grant-revoke');
  const tx = await buildRevokeSignerGrant({
    signerKey: account.publicKey,
    signerManager,
    publicKey: account.publicKey,
    fee: FEE,
    nonce: await getNextNonce(account.address),
    network,
  });
  const confirmed = await broadcastAndWaitForTransaction(signTransaction(tx, account.key), network);
  expect(confirmed.tx_status).toBe('success');
});

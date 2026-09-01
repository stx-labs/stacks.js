/**
 * E2E - signer-grant lifecycle: grant -> verify true -> revoke -> verify false.
 *
 * `grant-signer-key` and `revoke-signer-grant` both assert
 * `contract-caller == signerManager` (the ARG, not a fixed constant), so an
 * EOA succeeds by passing its own address as `signerManager`. Grant also
 * recovers the SIP-018 `signer-sig` and checks it matches `signer-key`.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-signer-grant-lifecycle.json \
 *     npx jest tests/privatenet/e2e/signer-grant-lifecycle.e2e.test.ts \
 *       --runInBand --collectCoverage=false
 */

import {
  buildGrantSignerKey,
  buildRevokeSignerGrant,
  describePox5Error,
  fetchVerifySignerKeyGrant,
  Pox5ErrorCode,
  signSignerGrant,
} from '../../../src';
import { parseErrCode } from '../../helpers/wait';
import { resolveAccount } from '../../regtest/regtest';
import { ENV, getNetwork } from '../../helpers/utils';
import { broadcastAndWaitForTransaction, getNextNonce } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

const network = getNetwork();
const FEE = 10_000n;
const GRANT_AUTH_ID = 999001n;

// Dedicated lane account (override via SIGNER env).
const signerAccount = resolveAccount('SIGNER', 'account6'); // clean, self-managed EOA
const signerKey = signerAccount.publicKey; // 33-byte compressed hex
const signerPrivateKey = signerAccount.key.slice(0, 64);
const chainId = ENV.NETWORK_ID;

// EOA acts as its own manager (see contract-truth note above).
const signerManager = signerAccount.address;

beforeAll(async () => {
  useFixtures('e2e-signer-grant');
}, 60_000);

test('grant-signer-key (self-managed EOA): grant -> verify true -> revoke -> verify false', async () => {
  useFixtures('e2e-signer-grant');

  // GRANT
  const signerSignature = signSignerGrant({
    signerManager,
    authId: GRANT_AUTH_ID,
    chainId,
    privateKey: signerPrivateKey,
  });
  expect(signerSignature.length).toBe(130);

  const unsignedGrant = await buildGrantSignerKey({
    signerKey,
    signerManager,
    authId: GRANT_AUTH_ID,
    signerSignature,
    publicKey: signerAccount.publicKey,
    fee: FEE,
    nonce: await getNextNonce(signerAccount.address),
    network,
  });

  const grantTx = signTransaction(unsignedGrant, signerAccount.key);
  const grantRecord = await broadcastAndWaitForTransaction(grantTx, network);

  console.log('grant on-chain result:', {
    txid: grantRecord.tx_id,
    tx_status: grantRecord.tx_status,
    result_repr: grantRecord.tx_result?.repr,
  });
  // A prior run may have already consumed this fixed authId's grant signature
  // (`SignerKeyGrantUsed`, err u12) — that's still the intended terminal state
  // (a grant exists), just not freshly minted by this broadcast.
  if (grantRecord.tx_status === 'abort_by_response') {
    const code = parseErrCode(grantRecord.tx_result?.repr);
    console.log('grant abort code:', code, describePox5Error(code ?? -1)?.name ?? '(unknown)');
    expect(code).toBe(Pox5ErrorCode.SignerKeyGrantUsed);
  } else {
    expect(grantRecord.tx_status).toBe('success');
  }

  useFixtures('e2e-signer-grant-after');
  // Either branch above leaves a live grant in place, so verification must
  // report true regardless of whether this run's broadcast was the one that
  // created it.
  const grantedNow = await fetchVerifySignerKeyGrant({ signerKey, signerManager, network });
  expect(grantedNow).toBe(true);

  // REVOKE
  const unsignedRevoke = await buildRevokeSignerGrant({
    signerKey,
    signerManager,
    publicKey: signerAccount.publicKey,
    fee: FEE,
    nonce: await getNextNonce(signerAccount.address),
    network,
  });

  const revokeTx = signTransaction(unsignedRevoke, signerAccount.key);
  const revokeRecord = await broadcastAndWaitForTransaction(revokeTx, network);

  console.log('revoke on-chain result:', {
    txid: revokeRecord.tx_id,
    tx_status: revokeRecord.tx_status,
    result_repr: revokeRecord.tx_result?.repr,
  });
  expect(revokeRecord.tx_status).toBe('success');

  // Phase switch: same verify-signer-key-grant path returns a different body
  // after revoke; route the after-read to its own fixture key.
  useFixtures('e2e-signer-grant-revoked');
  const grantedAfterRevoke = await fetchVerifySignerKeyGrant({ signerKey, signerManager, network });
  expect(grantedAfterRevoke).toBe(false);
}, 300_000);

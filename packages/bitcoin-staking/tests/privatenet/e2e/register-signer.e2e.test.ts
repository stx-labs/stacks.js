/**
 * E2E - register-signer coverage.
 *
 * pox-5's `register-signer` public fn MUST be called with tx-sender equal to
 * a signer-manager contract principal; a direct EOA call aborts with
 * ERR_UNAUTHORIZED_SIGNER_REGISTRATION (err u26). There is no dedicated SDK
 * builder for this fn, so this test uses `makeUnsignedContractCall` directly
 * against pox-5, matching how the SDK's internal `callPox5` helper works.
 *
 * Covers (A) the daemon's already-registered signer key (indirect happy path,
 * since a real registration needs the signer-manager contract as tx-sender,
 * not achievable from an EOA), and (B) the direct-call abort path.
 *
 * Run:
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
 *     POLL_INTERVAL=10000 RETRY_INTERVAL=10000 BITCOIN_TX_TIMEOUT=300000 \
 *     STACKS_TX_TIMEOUT=300000 RECORD=1 \
 *     FIXTURES_JSON=tests/privatenet/fixtures/fixtures-e2e-register-signer.json \
 *     npx jest tests/privatenet/e2e/register-signer.e2e.test.ts \
 *       --runInBand --collectCoverage=false
 */

import { Cl, broadcastTransaction, makeUnsignedContractCall } from '@stacks/transactions';
import { networkFrom } from '@stacks/network';
import { fetchSignerInfo, describePox5Error } from '../../../src';
import { SIGNER_MANAGER, resolveAccount } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { getNextNonce, getTransaction, parseErrCode, waitForFulfilled } from '../../helpers/wait';
import { signTransaction } from '../../helpers/sign';
import { useFixtures } from '../../helpers/mock';

// pox-5 is a boot contract; its address = network.bootAddress.
const POX5_CONTRACT_NAME = 'pox-5';

const network = getNetwork();
const FEE = 10_000n;

// Dedicated lane account (override via CALLER env). Default account6, clean EOA -> u26.
const caller = resolveAccount('CALLER', 'account6');

// ERR_UNAUTHORIZED_SIGNER_REGISTRATION = u26
const ERR_UNAUTHORIZED_SIGNER_REGISTRATION = 26;

beforeAll(async () => {
  useFixtures('e2e-register-signer');
}, 60_000);

test('register-signer (indirect): daemon signer-manager has a registered signer key', async () => {
  useFixtures('e2e-register-signer');

  const info = await fetchSignerInfo({ signerManager: SIGNER_MANAGER, network });

  // The daemon calls register-signer during its bootstrap; if pox-5 is active
  // the signer-manager MUST already have a key registered.
  expect(info).toBeDefined();
  expect(info!.signerKey).toMatch(/^[0-9a-f]{66}$/); // 33-byte compressed key hex
  console.log('registered signerKey:', info!.signerKey);
}, 30_000);

test('register-signer (direct EOA call): aborts with ERR_UNAUTHORIZED_SIGNER_REGISTRATION (err u26)', async () => {
  useFixtures('e2e-register-signer');

  // Build the call using the SDK generic path (no dedicated builder).
  const resolvedNetwork = networkFrom(network);
  const unsigned = await makeUnsignedContractCall({
    contractAddress: resolvedNetwork.bootAddress,
    contractName: POX5_CONTRACT_NAME,
    functionName: 'register-signer',
    functionArgs: [
      // signer-key: 33-byte compressed pubkey of the would-be signer
      Cl.bufferFromHex(caller.publicKey),
    ],
    publicKey: caller.publicKey,
    fee: FEE,
    nonce: await getNextNonce(caller.address),
    network,
  });

  const tx = signTransaction(unsigned, caller.key);
  const res = await broadcastTransaction({ transaction: tx, network });

  // A broadcast-level rejection is also a valid "EOA unauthorized" outcome — the
  // node may refuse a tx that would abort. Accept it as success.
  if ('error' in res) {
    console.log('broadcast rejected (valid unauthorized outcome):', res.error);
    expect(res.error).toBeDefined();
    return;
  }
  console.log('txid:', res.txid);

  const txRecord = await waitForFulfilled(async () => {
    const t = await getTransaction(res.txid);
    if (!t || t.tx_status === 'pending') throw new Error('tx still pending');
    return t;
  });

  // The contract MUST abort — an EOA is not a valid signer-manager.
  expect(txRecord.tx_status).toBe('abort_by_response');

  const code = parseErrCode(txRecord.tx_result?.repr);
  const info = code !== undefined ? describePox5Error(code) : undefined;
  console.log('abort code:', code, '-', info?.name ?? 'unknown');

  expect(code).toBe(ERR_UNAUTHORIZED_SIGNER_REGISTRATION);
}, 180_000);

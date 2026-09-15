/**
 * SIP-018 signer-key-grant verification: proves our off-chain grant-message
 * hash + secp256k1 signature match what pox-5 expects, without ever calling
 * the state-changing `grant-signer-key`. 100% read-only (contract reads +
 * local crypto), so no nonces/broadcasts to collide with other agents.
 *
 * `verify-signer-key-grant` only checks a MAP set by a prior broadcast (no
 * signature check), so acceptance is proven instead via the same predicate
 * the contract uses internally: secp256k1-recover?(hash, sig) == signer-key.
 *
 * chain-id must be the node's actual NETWORK_ID (256 here), not the
 * well-known testnet 0x80000000 — pox-5's signer domain embeds the runtime
 * chain-id.
 *
 * Run with the private testnet combo (from package dir):
 *   NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so RECORD=1 \
 *     ../../node_modules/.bin/jest tests/privatenet/actions/verify-signer-grant.test.ts \
 *     --runInBand --collectCoverage=false
 */
import { bytesToHex } from '@stacks/common';
import { publicKeyFromSignatureRsv } from '@stacks/transactions';
import { computeSignerGrantHash, signSignerGrant } from '../../../src/signer';
import { fetchSignerGrantMessageHash } from '../../../src/fetch';
import { REGTEST_KEYS, getAccount, SIGNER_MANAGER } from '../../regtest/regtest';
import { getNetwork } from '../../helpers/utils';
import { useFixtures } from '../../helpers/mock';

jest.setTimeout(30 * 60_000);

const network = getNetwork();

const signerManager = SIGNER_MANAGER;
const chainId = Number(process.env.NETWORK_ID ?? 256);
const authId = 424242n;

const signer = getAccount(REGTEST_KEYS.account6);
// Strip the trailing `01` compression marker to get the raw 32-byte private key.
const signerPrivateKey = REGTEST_KEYS.account6.slice(0, 64);
const signerKey = signer.publicKey;

beforeAll(() => useFixtures('verify-signer-grant'));

describe('SIP-018 signer-key-grant verification (read-only)', () => {
  test('message-hash parity: off-chain === on-chain', async () => {
    const offChain = bytesToHex(computeSignerGrantHash({ signerManager, authId, chainId }));
    const onChain = await fetchSignerGrantMessageHash({
      signerManager,
      authId,
      network,
    });

    console.log('grant message hash', {
      signerManager,
      authId: authId.toString(),
      chainId,
      offChain,
      onChain,
      match: offChain === onChain,
    });

    expect(onChain).toMatch(/^[0-9a-f]{64}$/);
    expect(offChain).toBe(onChain);
  });

  test('valid signature recovers to the signer-key against the on-chain hash', async () => {
    const onChain = await fetchSignerGrantMessageHash({
      signerManager,
      authId,
      network,
    });

    const signature = signSignerGrant({
      signerManager,
      authId,
      chainId,
      privateKey: signerPrivateKey,
    });
    expect(signature.length).toBe(130); // 65-byte RSV

    const recovered = publicKeyFromSignatureRsv(onChain, signature);

    console.log('signature acceptance', {
      signerKey,
      recovered,
      accepted: recovered === signerKey,
    });

    expect(recovered).toBe(signerKey);
  });

  test('tampered signature does NOT recover to the signer-key', async () => {
    const onChain = await fetchSignerGrantMessageHash({
      signerManager,
      authId,
      network,
    });
    const signature = signSignerGrant({
      signerManager,
      authId,
      chainId,
      privateKey: signerPrivateKey,
    });

    // Flip one byte in the middle of the R component.
    const bytes = Buffer.from(signature, 'hex');
    bytes[10] ^= 0xff;
    const tampered = bytes.toString('hex');

    let recovered: string | null = null;
    try {
      recovered = publicKeyFromSignatureRsv(onChain, tampered);
    } catch {
      // recover can outright fail on a malformed sig — also a rejection.
      recovered = null;
    }

    console.log('negative: tampered signature', {
      signerKey,
      recovered,
      rejected: recovered !== signerKey,
    });

    expect(recovered).not.toBe(signerKey);
  });

  test("a different signer's signature does NOT recover to the signer-key", async () => {
    const onChain = await fetchSignerGrantMessageHash({
      signerManager,
      authId,
      network,
    });
    const otherPriv = REGTEST_KEYS.account5.slice(0, 64);
    const signature = signSignerGrant({
      signerManager,
      authId,
      chainId,
      privateKey: otherPriv,
    });

    const recovered = publicKeyFromSignatureRsv(onChain, signature);

    console.log('negative: wrong signer', {
      expected: signerKey,
      recovered,
      rejected: recovered !== signerKey,
    });

    expect(recovered).not.toBe(signerKey);
  });

  test('wrong auth-id: signature bound to authId does not recover under a different auth-id hash', async () => {
    const wrongAuthId = authId + 1n;

    const onChainWrong = await fetchSignerGrantMessageHash({
      signerManager,
      authId: wrongAuthId,
      network,
    });
    const onChainRight = await fetchSignerGrantMessageHash({
      signerManager,
      authId,
      network,
    });
    expect(onChainWrong).not.toBe(onChainRight);

    const signature = signSignerGrant({
      signerManager,
      authId,
      chainId,
      privateKey: signerPrivateKey,
    });

    // Contract would recover against this wrong-auth-id hash -> wrong pubkey.
    const recovered = publicKeyFromSignatureRsv(onChainWrong, signature);

    console.log('negative: wrong auth-id', {
      signerKey,
      recovered,
      rejected: recovered !== signerKey,
    });

    expect(recovered).not.toBe(signerKey);
  });
});

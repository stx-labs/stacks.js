import { ClarityType, privateKeyToPublic, type TupleCV } from '@stacks/transactions';
import {
  getSignerKeyGrantMessageHash,
  signSignerKeyGrant,
  signerKeyGrantMessage,
  verifySignerKeyGrant,
} from '../src/signer';
import * as pkg from '../src';

// 32-byte hex private key (uncompressed marker absent → compressed pubkey).
const PRIVATE_KEY = '7287ba251d44a4d3fd9276c88ce34dbd028debf7af3c8d2dad5e3ce25c020f8801';
const WRONG_PRIVATE_KEY = '11'.repeat(32) + '01';

const SIGNER_MANAGER = 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.my-signer';
const CHAIN_ID = 1;

describe('signerKeyGrantMessage', () => {
  it('returns a SIP-018 tuple with kebab-case signer-manager / auth-id fields', () => {
    const { message, domain } = signerKeyGrantMessage({
      signerManager: SIGNER_MANAGER,
      authId: 42n,
      chainId: CHAIN_ID,
    });

    expect(message.type).toBe(ClarityType.Tuple);
    const msgFields = (message as TupleCV).value;
    expect(msgFields['topic']).toBeDefined();
    expect(msgFields['topic'].type).toBe(ClarityType.StringASCII);
    expect(msgFields['signer-manager']).toBeDefined();
    expect(msgFields['signer-manager'].type).toBe(ClarityType.PrincipalContract);
    expect(msgFields['auth-id']).toBeDefined();
    expect(msgFields['auth-id'].type).toBe(ClarityType.UInt);

    expect(domain.type).toBe(ClarityType.Tuple);
    const domFields = (domain as TupleCV).value;
    expect(domFields['name']).toBeDefined();
    expect(domFields['version']).toBeDefined();
    expect(domFields['chain-id']).toBeDefined();
  });
});

describe('getSignerKeyGrantMessageHash', () => {
  it('returns exactly 32 bytes', () => {
    const hash = getSignerKeyGrantMessageHash({
      signerManager: SIGNER_MANAGER,
      authId: 1n,
      chainId: CHAIN_ID,
    });
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    const opts = { signerManager: SIGNER_MANAGER, authId: 99n, chainId: CHAIN_ID };
    const a = getSignerKeyGrantMessageHash(opts);
    const b = getSignerKeyGrantMessageHash(opts);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });
});

describe('signSignerKeyGrant + verifySignerKeyGrant', () => {
  it('round-trips with the matching public key', () => {
    const publicKey = privateKeyToPublic(PRIVATE_KEY);
    const sig = signSignerKeyGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(typeof sig).toBe('string');
    // RSV signature is 65 bytes → 130 hex chars.
    expect(sig.length).toBe(130);

    const ok = verifySignerKeyGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      publicKey,
      signature: sig,
    });
    expect(ok).toBe(true);
  });

  it('rejects a signature against the wrong public key', () => {
    const wrongPublicKey = privateKeyToPublic(WRONG_PRIVATE_KEY);
    const sig = signSignerKeyGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      privateKey: PRIVATE_KEY,
    });

    const ok = verifySignerKeyGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      publicKey: wrongPublicKey,
      signature: sig,
    });
    expect(ok).toBe(false);
  });

  it('rejects a signature for a different auth-id', () => {
    const publicKey = privateKeyToPublic(PRIVATE_KEY);
    const sig = signSignerKeyGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      privateKey: PRIVATE_KEY,
    });

    const ok = verifySignerKeyGrant({
      signerManager: SIGNER_MANAGER,
      authId: 8n,
      chainId: CHAIN_ID,
      publicKey,
      signature: sig,
    });
    expect(ok).toBe(false);
  });
});

describe('package exports', () => {
  it('re-exports the signer helpers from the package index', () => {
    expect((pkg as Record<string, unknown>).signerKeyGrantMessage).toBe(signerKeyGrantMessage);
    expect((pkg as Record<string, unknown>).getSignerKeyGrantMessageHash).toBe(
      getSignerKeyGrantMessageHash
    );
    expect((pkg as Record<string, unknown>).signSignerKeyGrant).toBe(signSignerKeyGrant);
    expect((pkg as Record<string, unknown>).verifySignerKeyGrant).toBe(verifySignerKeyGrant);
  });
});

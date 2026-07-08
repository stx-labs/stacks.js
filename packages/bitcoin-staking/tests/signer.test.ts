import {
  Cl,
  ClarityType,
  privateKeyToPublic,
  serializeCVBytes,
  type TupleCV,
} from '@stacks/transactions';
import {
  buildSignerCalldata,
  computeSignerGrantHash,
  parseSignerCalldata,
  signSignerGrant,
  buildSignerGrantMessage,
  verifySignerGrant,
} from '../src/signer';
import * as BtcAddress from '../src/btc-address';
import * as pkg from '../src';

// 32-byte hex private key (uncompressed marker absent -> compressed pubkey).
const PRIVATE_KEY = '7287ba251d44a4d3fd9276c88ce34dbd028debf7af3c8d2dad5e3ce25c020f8801';
const WRONG_PRIVATE_KEY = '11'.repeat(32) + '01';

const SIGNER_MANAGER = 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.my-signer';
const CHAIN_ID = 1;

describe('buildSignerGrantMessage', () => {
  it('returns a SIP-018 tuple with kebab-case signer-manager / auth-id fields', () => {
    const { message, domain } = buildSignerGrantMessage({
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

describe('computeSignerGrantHash', () => {
  it('returns exactly 32 bytes', () => {
    const hash = computeSignerGrantHash({
      signerManager: SIGNER_MANAGER,
      authId: 1n,
      chainId: CHAIN_ID,
    });
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    const opts = { signerManager: SIGNER_MANAGER, authId: 99n, chainId: CHAIN_ID };
    const a = computeSignerGrantHash(opts);
    const b = computeSignerGrantHash(opts);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });
});

describe('signSignerGrant + verifySignerGrant', () => {
  it('round-trips with the matching public key', () => {
    const publicKey = privateKeyToPublic(PRIVATE_KEY);
    const sig = signSignerGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      privateKey: PRIVATE_KEY,
    });
    expect(typeof sig).toBe('string');
    // RSV signature is 65 bytes -> 130 hex chars.
    expect(sig.length).toBe(130);

    const ok = verifySignerGrant({
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
    const sig = signSignerGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      privateKey: PRIVATE_KEY,
    });

    const ok = verifySignerGrant({
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
    const sig = signSignerGrant({
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      privateKey: PRIVATE_KEY,
    });

    const ok = verifySignerGrant({
      signerManager: SIGNER_MANAGER,
      authId: 8n,
      chainId: CHAIN_ID,
      publicKey,
      signature: sig,
    });
    expect(ok).toBe(false);
  });

  it('returns false (does not throw) for malformed signatures', () => {
    const base = {
      signerManager: SIGNER_MANAGER,
      authId: 7n,
      chainId: CHAIN_ID,
      publicKey: privateKeyToPublic(PRIVATE_KEY),
    };
    expect(verifySignerGrant({ ...base, signature: '' })).toBe(false);
    expect(verifySignerGrant({ ...base, signature: 'ab'.repeat(64) })).toBe(false); // 64 bytes
    expect(verifySignerGrant({ ...base, signature: new Uint8Array(10) })).toBe(false);
  });
});

// TODO(coverage): add a golden vector freezing the SIP-018 grant hash — a fixed
// (signerManager, authId, chainId) asserting the exact computeSignerGrantHash
// hex. The domain/message literals were verified against
// pox-5.get-signer-grant-message-hash on 2026-07-06; a golden pins them so any
// drift (topic, domain name/version, tuple keys) fails offline instead of
// breaking grant recovery on-chain.
describe('signer calldata', () => {
  it.each([
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', // P2WPKH
    '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', // P2PKH
    'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', // P2TR
  ])('round-trips %s through encode/decode', addr => {
    const calldata = buildSignerCalldata({ poxAddress: addr, maxFeeSats: 1000n });
    const decoded = parseSignerCalldata(calldata);
    expect(decoded.maxFeeSats).toBe(1000n);
    expect(BtcAddress.stringify(decoded.poxAddress, 'mainnet')).toBe(addr);
  });

  it('rejects a payout address from the wrong network when one is given', () => {
    const mainnetAddr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    expect(() =>
      buildSignerCalldata({ poxAddress: mainnetAddr, maxFeeSats: 1000n, network: 'testnet' })
    ).toThrow(/testnet/);
    expect(() =>
      buildSignerCalldata({ poxAddress: mainnetAddr, maxFeeSats: 1000n, network: 'mainnet' })
    ).not.toThrow();
  });

  it('accepts pre-parsed address components and Uint8Array | hex calldata', () => {
    const parsed = BtcAddress.parse('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    const bytes = buildSignerCalldata({ poxAddress: parsed, maxFeeSats: 0n });
    const fromHex = parseSignerCalldata(Buffer.from(bytes).toString('hex'));
    expect(fromHex.poxAddress).toEqual(parsed);
    expect(fromHex.maxFeeSats).toBe(0n);
  });

  it('throws on a non-tuple calldata blob', () => {
    expect(() => parseSignerCalldata('00')).toThrow();
  });

  it('throws on a tuple whose hashbytes length does not match the version', () => {
    const bad = Cl.tuple({
      'pox-addr': Cl.tuple({
        version: Cl.buffer(Uint8Array.of(4)), // P2WPKH expects 20 bytes
        hashbytes: Cl.buffer(new Uint8Array(32)),
      }),
      'max-fee': Cl.uint(1000),
    });
    expect(() => parseSignerCalldata(serializeCVBytes(bad))).toThrow('20 bytes');
    const emptyVersion = Cl.tuple({
      'pox-addr': Cl.tuple({
        version: Cl.buffer(new Uint8Array(0)),
        hashbytes: Cl.buffer(new Uint8Array(20)),
      }),
      'max-fee': Cl.uint(1000),
    });
    expect(() => parseSignerCalldata(serializeCVBytes(emptyVersion))).toThrow(
      'Unexpected PoX address version'
    );
  });
});

describe('package exports', () => {
  it('re-exports the signer helpers from the package index', () => {
    expect((pkg as Record<string, unknown>).buildSignerGrantMessage).toBe(buildSignerGrantMessage);
    expect((pkg as Record<string, unknown>).computeSignerGrantHash).toBe(computeSignerGrantHash);
    expect((pkg as Record<string, unknown>).signSignerGrant).toBe(signSignerGrant);
    expect((pkg as Record<string, unknown>).verifySignerGrant).toBe(verifySignerGrant);
  });
});

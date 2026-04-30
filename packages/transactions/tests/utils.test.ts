import { STACKS_TESTNET } from '@stacks/network';
import {
  createMultiSigSpendingCondition,
  createSingleSigSpendingCondition,
  createSponsoredAuth,
  createStandardAuth,
  emptyMessageSignature,
} from '../src/authorization';
import { intCV, standardPrincipalCV, tupleCV } from '../src/clarity';
import { AddressHashMode, AuthType } from '../src/constants';
import { TransactionSigner } from '../src/signer';
import { StacksTransactionWire } from '../src/transaction';
import { createMessageSignature, createTokenTransferPayload } from '../src/wire';
import { cloneDeep, validateStacksAddress } from '../src/utils';

describe(validateStacksAddress.name, () => {
  test('it returns true for a legit address', () => {
    const validAddresses = [
      'STVTVW5E80EET19EZ3J8W3NZKR6RHNFG58TKQGXH',
      'STMFBYXTWAZD0NYMHSRQBZX1190EMZ42VD326PNP',
      'ST22ENKAF6J5G43TZFQS1WTV0YEH8VNX2SX048RA5',
    ];
    validAddresses.forEach(address => expect(validateStacksAddress(address)).toBeTruthy());
  });

  test('it returns false for nonsense input', () => {
    const nonsenseNotRealSillyAddresses = [
      'update borrow transfer trumpet stem topic resemble youth trophy later slam air subway invite salt quantum fossil smoke hero lift sense boat green wave',
      '03680327df912362e7d2280fea0fb80af2ba70f8fdc853d36f3c621fb93a73b801',
      'one upon a time in a land far far away',
      'lkjsdfksfjd(*&(*7sedf;lkj',
      'In the beginning...',
      // missing one char
      'ST3S6T6BS4DJ7AW74KVMNYXWH5SZ1WXX8JBCYZVY',
    ];
    nonsenseNotRealSillyAddresses.forEach(nonAddress =>
      expect(validateStacksAddress(nonAddress)).toBeFalsy()
    );
  });
});

// `cloneDeep` is used at six call sites. These tests construct the exact
// shapes cloned at each one and assert the clone behaves the way the caller
// then uses it (methods callable, bigint/Uint8Array intact, mutation isolated).
describe(cloneDeep.name, () => {
  const PUBKEY = '03ef788b3830c00abe8f64f62dc32fc863bc0b2cafeb073b6c8e1c7657d9c2c3ab';
  const PUBKEY_2 = '02ed4e25a2c2bb83adfaadce6e3da0e6c4cee6d4f4b50a52f96fb5826ee45e2b91';
  const RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159';

  function buildStandardTx() {
    const payload = createTokenTransferPayload(standardPrincipalCV(RECIPIENT), 2_500_000n, 'memo');
    const cond = createSingleSigSpendingCondition(AddressHashMode.P2PKH, PUBKEY, 7n, 250n);
    return new StacksTransactionWire({
      network: STACKS_TESTNET,
      auth: createStandardAuth(cond),
      payload,
    });
  }

  function buildSponsoredTx() {
    const payload = createTokenTransferPayload(standardPrincipalCV(RECIPIENT), 1_000n, 'sponsor');
    const originCond = createSingleSigSpendingCondition(AddressHashMode.P2PKH, PUBKEY, 1n, 100n);
    return new StacksTransactionWire({
      network: STACKS_TESTNET,
      auth: createSponsoredAuth(originCond),
      payload,
    });
  }

  describe('StacksTransactionWire (signer.ts, transaction.ts call sites)', () => {
    test('cloned tx is a StacksTransactionWire instance', () => {
      const tx = buildStandardTx();
      const clone = cloneDeep(tx);
      expect(clone).toBeInstanceOf(StacksTransactionWire);
    });

    test('class methods (txid/serialize/signBegin) callable on clone and produce same output as original', () => {
      const tx = buildStandardTx();
      const clone = cloneDeep(tx);
      // these are the methods invoked on cloneDeep results in transaction.ts and signer.ts
      expect(clone.txid()).toBe(tx.txid());
      expect(clone.serialize()).toBe(tx.serialize());
      expect(clone.signBegin()).toBe(tx.signBegin());
    });

    test('bigint fields (fee, nonce, amount) preserved as bigint on clone', () => {
      const tx = buildStandardTx();
      const clone = cloneDeep(tx);
      const cond = clone.auth.spendingCondition!;
      expect(typeof cond.fee).toBe('bigint');
      expect(typeof cond.nonce).toBe('bigint');
      expect(cond.fee).toBe(250n);
      expect(cond.nonce).toBe(7n);
      // payload amount is bigint too
      expect(typeof (clone.payload as any).amount).toBe('bigint');
      expect((clone.payload as any).amount).toBe(2_500_000n);
    });

    test('mutating clone.auth does not mutate the original (signBegin/verifyBegin contract)', () => {
      // transaction.ts:115 / :122 rely on this: signBegin/verifyBegin clone, mutate
      // the clone's auth (intoInitialSighashAuth), then take txid — must not mutate self
      const tx = buildStandardTx();
      const originalNonce = tx.auth.spendingCondition!.nonce;
      const clone = cloneDeep(tx);
      clone.auth.spendingCondition!.nonce = 999n;
      expect(tx.auth.spendingCondition!.nonce).toBe(originalNonce);
      expect(tx.auth.spendingCondition!.nonce).not.toBe(clone.auth.spendingCondition!.nonce);
    });

    test('createSponsorSigner flow: clone, setSponsor, verifyOrigin (signer.ts:71)', () => {
      const tx = buildSponsoredTx();
      // Sign the origin first so verifyOrigin has something real to check
      const originSigner = new TransactionSigner(tx);
      originSigner.signOrigin('edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01');
      // This mirrors createSponsorSigner: clone, then call class methods on the clone
      const sponsorCond = createSingleSigSpendingCondition(
        AddressHashMode.P2PKH,
        PUBKEY_2,
        2n,
        50n
      );
      const clone = cloneDeep(tx);
      expect(() => clone.setSponsor(sponsorCond)).not.toThrow();
      expect(() => clone.verifyOrigin()).not.toThrow();
      // original auth must be untouched
      if (tx.auth.authType === AuthType.Sponsored) {
        expect(tx.auth.sponsorSpendingCondition.signer).not.toBe(sponsorCond.signer);
      }
    });

    test('TransactionSigner.resume + getTxInComplete preserve bigint and methods', () => {
      // signer.ts:156 (getTxInComplete) and :160 (resume) both go through cloneDeep
      const tx = buildStandardTx();
      const signer = new TransactionSigner(tx);
      const out = signer.getTxInComplete();
      expect(out).toBeInstanceOf(StacksTransactionWire);
      expect(out.txid()).toBe(tx.txid());
      expect(typeof out.auth.spendingCondition!.fee).toBe('bigint');

      const tx2 = buildStandardTx();
      signer.resume(tx2);
      expect(signer.transaction).toBeInstanceOf(StacksTransactionWire);
      expect(signer.transaction.txid()).toBe(tx2.txid());
    });
  });

  describe('SpendingCondition (authorization.ts:196 — clearCondition)', () => {
    test('single-sig: bigint fee/nonce preserved, signature object preserved, mutation isolated', () => {
      const cond = createSingleSigSpendingCondition(AddressHashMode.P2PKH, PUBKEY, 5n, 1000n);
      cond.signature = createMessageSignature(
        '01' + 'aa'.repeat(64) // 65-byte recoverable sig
      );
      const clone = cloneDeep(cond);

      expect(typeof clone.fee).toBe('bigint');
      expect(typeof clone.nonce).toBe('bigint');
      expect(clone.fee).toBe(1000n);
      expect(clone.nonce).toBe(5n);
      expect(clone.signature.data).toBe(cond.signature.data);

      // clearCondition mutates clone.nonce/fee/signature — must not affect input
      clone.nonce = 0 as any;
      clone.fee = 0 as any;
      clone.signature = emptyMessageSignature();
      expect(cond.nonce).toBe(5n);
      expect(cond.fee).toBe(1000n);
      expect(cond.signature.data).not.toBe(clone.signature.data);
    });

    test('multi-sig: fields array deep-cloned (mutation isolation on nested array)', () => {
      const cond = createMultiSigSpendingCondition(
        AddressHashMode.P2SH,
        2,
        [PUBKEY, PUBKEY_2],
        3n,
        500n
      );
      // simulate a populated fields array (clearCondition wipes it on the clone)
      cond.fields = [{ marker: 'original' } as any];

      const clone = cloneDeep(cond);
      expect(typeof clone.fee).toBe('bigint');
      expect(typeof clone.nonce).toBe('bigint');
      expect(clone.fields).not.toBe(cond.fields);
      expect(clone.fields[0]).not.toBe(cond.fields[0]);

      clone.fields = [];
      expect(cond.fields).toHaveLength(1);
      expect((cond.fields[0] as any).marker).toBe('original');
    });
  });

  describe('Clarity tuple value (contract-abi.ts:350 — matchType)', () => {
    test('cloning a tuple value preserves bigints and isolates key deletion', () => {
      // matchType clones cv.value, then `delete tuple[key]` for matched keys.
      // Cloning must not mutate the original tuple value.
      const original = tupleCV({
        amount: intCV(42),
        recipient: standardPrincipalCV(RECIPIENT),
      }).value;

      const clone = cloneDeep(original);
      expect(Object.keys(clone).sort()).toEqual(['amount', 'recipient']);
      expect(typeof (clone.amount as any).value).toBe('bigint');
      expect((clone.amount as any).value).toBe(42n);

      delete (clone as any).amount;
      expect(original.amount).toBeDefined();
      expect((original.amount as any).value).toBe(42n);
    });
  });

  describe('low-level invariants', () => {
    test('preserves bigint, Uint8Array, and nested mutation isolation', () => {
      const input = {
        big: 12345678901234567890n,
        bytes: new Uint8Array([1, 2, 3, 4]),
        nested: { arr: [{ x: 1 }] },
      };
      const clone = cloneDeep(input);

      expect(clone.big).toBe(12345678901234567890n);
      expect(typeof clone.big).toBe('bigint');
      expect(clone.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(clone.bytes)).toEqual([1, 2, 3, 4]);
      expect(clone.bytes).not.toBe(input.bytes);
      expect(clone.nested).not.toBe(input.nested);
      expect(clone.nested.arr[0]).not.toBe(input.nested.arr[0]);

      clone.nested.arr[0].x = 99;
      expect(input.nested.arr[0].x).toBe(1);
    });

    test('returns primitives as-is', () => {
      expect(cloneDeep(42)).toBe(42);
      expect(cloneDeep('hello')).toBe('hello');
      expect(cloneDeep(null)).toBe(null);
      expect(cloneDeep(undefined)).toBe(undefined);
      expect(cloneDeep(true)).toBe(true);
      expect(cloneDeep(7n)).toBe(7n);
    });
  });
});

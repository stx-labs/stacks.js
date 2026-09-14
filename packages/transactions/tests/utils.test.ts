import { STACKS_TESTNET } from '@stacks/network';
import {
  createMultiSigSpendingCondition,
  createSingleSigSpendingCondition,
  createSponsoredAuth,
  createStandardAuth,
  emptyMessageSignature,
} from '../src/authorization';
import { makeContractCall, makeContractDeploy, makeSTXTokenTransfer } from '../src/builders';
import { intCV, standardPrincipalCV, tupleCV, uintCV } from '../src/clarity';
import { AddressHashMode, AuthType, PubKeyEncoding } from '../src/constants';
import { createStacksPublicKey, privateKeyToPublic } from '../src/keys';
import * as Pc from '../src/pc';
import { TransactionSigner } from '../src/signer';
import { StacksTransactionWire } from '../src/transaction';
import { cloneDeep, omit, validateStacksAddress } from '../src/utils';
import {
  createMessageSignature,
  createTokenTransferPayload,
  createTransactionAuthField,
} from '../src/wire';

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

// Tests mirror the actual shapes cloned at each `cloneDeep` call site.
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
      // signBegin/verifyBegin clone, mutate the clone's auth, then take txid — must not mutate self
      const tx = buildStandardTx();
      const originalNonce = tx.auth.spendingCondition!.nonce;
      const clone = cloneDeep(tx);
      clone.auth.spendingCondition!.nonce = 999n;
      expect(tx.auth.spendingCondition!.nonce).toBe(originalNonce);
      expect(tx.auth.spendingCondition!.nonce).not.toBe(clone.auth.spendingCondition!.nonce);
    });

    test('createSponsorSigner clones the transaction and leaves the original untouched', () => {
      const tx = buildSponsoredTx();
      new TransactionSigner(tx).signOrigin(
        'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01'
      );
      const originalSponsorSigner =
        tx.auth.authType === AuthType.Sponsored ? tx.auth.sponsorSpendingCondition.signer : '';
      const sponsorCond = createSingleSigSpendingCondition(
        AddressHashMode.P2PKH,
        PUBKEY_2,
        2n,
        50n
      );

      const sponsorSigner = TransactionSigner.createSponsorSigner(tx, sponsorCond);

      expect(sponsorSigner.transaction).toBeInstanceOf(StacksTransactionWire);
      expect(sponsorSigner.transaction).not.toBe(tx);
      if (sponsorSigner.transaction.auth.authType === AuthType.Sponsored) {
        expect(sponsorSigner.transaction.auth.sponsorSpendingCondition.signer).toBe(
          sponsorCond.signer
        );
      }
      // original auth must be untouched
      if (tx.auth.authType === AuthType.Sponsored) {
        expect(tx.auth.sponsorSpendingCondition.signer).toBe(originalSponsorSigner);
      }
    });

    test('TransactionSigner.resume + getTxInComplete preserve bigint and methods', () => {
      // getTxInComplete and resume both go through cloneDeep
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

  describe('SpendingCondition (clearCondition)', () => {
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
      // populate fields the way mutatingSignAppendMultiSig does (clearCondition wipes them on the clone)
      cond.fields = [
        createTransactionAuthField(PubKeyEncoding.Compressed, createStacksPublicKey(PUBKEY)),
      ];

      const clone = cloneDeep(cond);
      expect(typeof clone.fee).toBe('bigint');
      expect(typeof clone.nonce).toBe('bigint');
      expect(clone.fields).not.toBe(cond.fields);
      expect(clone.fields[0]).not.toBe(cond.fields[0]);

      const cloneData = (clone.fields[0].contents as any).data;
      const originalData = (cond.fields[0].contents as any).data;
      expect(cloneData).toBeInstanceOf(Uint8Array);
      expect(cloneData).not.toBe(originalData);
      expect(cloneData).toEqual(originalData);
      expect(clone.fields[0].contents.type).toBe(cond.fields[0].contents.type);

      clone.fields = [];
      expect(cond.fields).toHaveLength(1);
      expect((cond.fields[0].contents as any).data).toEqual(originalData);
    });
  });

  describe('Clarity tuple value (matchType)', () => {
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
});

describe(omit.name, () => {
  test('removes the key, keeps the rest, does not mutate the input', () => {
    const fetch = jest.fn();
    const input = { senderKey: 'secret', fee: 1n, client: { fetch } };
    const result = omit(input, 'senderKey');

    expect(result).not.toBe(input);
    expect('senderKey' in result).toBe(false);
    expect(result.fee).toBe(1n);
    expect(result.client.fetch).toBe(fetch);
    expect(input.senderKey).toBe('secret');
  });
});

describe('signed builders isolate the transaction from caller data', () => {
  const SENDER_KEY = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';

  test('custom client.fetch survives omit and is invoked for the nonce lookup', async () => {
    const fetch = jest.fn(async () =>
      new Response(JSON.stringify({ balance: '0', nonce: 4 }), { status: 200 })
    );

    const tx = await makeContractCall({
      contractAddress: 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE',
      contractName: 'counter',
      functionName: 'increment',
      functionArgs: [uintCV(1)],
      senderKey: SENDER_KEY,
      fee: 100n,
      network: 'testnet',
      client: { fetch },
    });

    expect(fetch).toHaveBeenCalled();
    expect(tx.auth.spendingCondition!.nonce).toBe(4n);
  });

  const CONTRACT = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const MULTISIG_KEYS = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  // Before the `omit` change, options were deep-cloned, so mutating any option value after
  // the builder returned could not affect the signed transaction. Keep that guarantee.
  function expectUnaffected(tx: StacksTransactionWire, mutate: () => void) {
    const before = tx.serialize();
    mutate();
    expect(tx.serialize()).toBe(before);
    expect(() => tx.verifyOrigin()).not.toThrow();
  }

  test('makeContractCall: functionArgs and postConditions', async () => {
    const functionArgs = [uintCV(1), tupleCV({ amount: uintCV(10) })];
    const postConditions = [Pc.principal(CONTRACT).willSendEq(100).ustx()];
    const tx = await makeContractCall({
      contractAddress: CONTRACT,
      contractName: 'counter',
      functionName: 'increment',
      functionArgs,
      postConditions,
      senderKey: SENDER_KEY,
      fee: 100n,
      nonce: 0n,
      network: 'testnet',
    });

    // the transaction must not hold references to the caller's objects
    const payload = tx.payload as any;
    expect(payload.functionArgs).not.toBe(functionArgs);
    expect(payload.functionArgs[0]).not.toBe(functionArgs[0]);
    expect(payload.functionArgs[1]).not.toBe(functionArgs[1]);
    expect(tx.postConditions.values[0]).not.toBe(postConditions[0]);

    expectUnaffected(tx, () => {
      functionArgs[0] = uintCV(2);
      (functionArgs[1] as any).value.amount.value = 99n;
      functionArgs.push(uintCV(3));
      (postConditions[0] as any).amount = 1n;
      postConditions.push(Pc.principal(CONTRACT).willSendEq(5).ustx());
    });
  });

  test('makeSTXTokenTransfer: recipient value', async () => {
    const recipient = standardPrincipalCV(CONTRACT);
    const tx = await makeSTXTokenTransfer({
      recipient,
      amount: 12345n,
      senderKey: SENDER_KEY,
      fee: 100n,
      nonce: 0n,
      network: 'testnet',
    });

    expect((tx.payload as any).recipient).not.toBe(recipient);

    expectUnaffected(tx, () => {
      (recipient as any).value = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
    });
  });

  test('makeContractDeploy: postConditions', async () => {
    const postConditions = [Pc.principal(CONTRACT).willSendEq(100).ustx()];
    const tx = await makeContractDeploy({
      contractName: 'hello',
      codeBody: '(define-public (hi) (ok u1))',
      postConditions,
      senderKey: SENDER_KEY,
      fee: 100n,
      nonce: 0n,
      network: 'testnet',
    });

    expectUnaffected(tx, () => {
      (postConditions[0] as any).amount = 1n;
      postConditions.length = 0;
    });
  });

  test('multi-sig makeContractCall: publicKeys, functionArgs and postConditions', async () => {
    const publicKeys = MULTISIG_KEYS.map(privateKeyToPublic);
    const signerKeys = MULTISIG_KEYS.slice(0, 2);
    const functionArgs = [uintCV(1)];
    const postConditions = [Pc.principal(CONTRACT).willSendEq(100).ustx()];
    const tx = await makeContractCall({
      contractAddress: CONTRACT,
      contractName: 'counter',
      functionName: 'increment',
      functionArgs,
      postConditions,
      publicKeys,
      numSignatures: 2,
      signerKeys,
      fee: 100n,
      nonce: 0n,
      network: 'testnet',
    });

    expect((tx.payload as any).functionArgs).not.toBe(functionArgs);
    expect((tx.payload as any).functionArgs[0]).not.toBe(functionArgs[0]);

    expectUnaffected(tx, () => {
      publicKeys.reverse();
      publicKeys.push(publicKeys[0]);
      signerKeys.length = 0;
      functionArgs[0] = uintCV(2);
      (postConditions[0] as any).amount = 1n;
    });
  });
});

import {
  HIRO_MAINNET_URL,
  HIRO_TESTNET_URL,
  PRIVATE_KEY_BYTES_COMPRESSED,
  bytesToHex,
  bytesToUtf8,
  createApiKeyMiddleware,
  createFetchFn,
  hexToBytes,
  utf8ToBytes,
} from '@stacks/common';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import * as fs from 'fs';
import fetchMock from 'jest-fetch-mock';
import {
  ACCOUNT_PATH,
  BROADCAST_PATH,
  BadNonceRejection,
  CONTRACT_ABI_PATH,
  ClarityAbi,
  Pc,
  READONLY_FUNCTION_CALL_PATH,
  StacksWireType,
  TRANSACTION_FEE_ESTIMATE_PATH,
  TokenTransferPayloadWire,
  TxBroadcastResult,
  TxBroadcastResultOk,
  TxBroadcastResultRejected,
  addressFromPublicKeys,
  addressToString,
  broadcastTransaction,
  createMessageSignature,
  createStacksPublicKey,
  createTokenTransferPayload,
  createTransactionAuthField,
  fetchCallReadOnlyFunction,
  fetchContractMapEntry,
  fetchFeeEstimate,
  fetchFeeEstimateTransaction,
  fetchNonce,
  postConditionToWire,
  privateKeyToPublic,
  publicKeyIsCompressed,
  publicKeyToHex,
  serializePayloadBytes,
  serializePublicKeyBytes,
} from '../src';
import { BytesReader } from '../src/BytesReader';
import {
  MultiSigSpendingCondition,
  SingleSigSpendingCondition,
  SponsoredAuthorization,
  StandardAuthorization,
  createSingleSigSpendingCondition,
  createSponsoredAuth,
  emptyMessageSignature,
  isSingleSig,
  nextSignature,
} from '../src/authorization';
import {
  SignedTokenTransferOptions,
  makeContractCall,
  makeContractDeploy,
  makeSTXTokenTransfer,
  makeUnsignedContractCall,
  makeUnsignedContractDeploy,
  makeUnsignedSTXTokenTransfer,
  sponsorTransaction,
} from '../src/builders';
import {
  ClarityType,
  UIntCV,
  bufferCV,
  bufferCVFromString,
  noneCV,
  principalCV,
  serializeCV,
  serializeCVBytes,
  standardPrincipalCV,
  uintCV,
} from '../src/clarity';
import {
  AddressHashMode,
  AuthType,
  ClarityVersion,
  FungibleConditionCode,
  PayloadType,
  PostConditionMode,
  PostConditionPrincipalId,
  PostConditionType,
  PubKeyEncoding,
  TxRejectedReason,
} from '../src/constants';
import { compressPrivateKey, makeRandomPrivKey } from '../src/keys';
import { FungiblePostCondition, PostCondition, StxPostCondition } from '../src/postcondition-types';
import { TransactionSigner } from '../src/signer';
import {
  StacksTransactionWire,
  deserializeTransaction,
  estimateTransactionByteLength,
  transactionToHex,
} from '../src/transaction';
import { cloneDeep, randomBytes } from '../src/utils';
import { FungiblePostConditionWire, STXPostConditionWire } from '../src/wire/types';

function setSignature(
  unsignedTransaction: StacksTransactionWire,
  signature: string | Uint8Array
): StacksTransactionWire {
  const parsedSig = typeof signature === 'string' ? signature : bytesToHex(signature);
  const tx = cloneDeep(unsignedTransaction);
  if (!tx.auth.spendingCondition) {
    throw new Error('Cannot set signature on transaction without spending condition');
  }
  if (isSingleSig(tx.auth.spendingCondition)) {
    tx.auth.spendingCondition.signature = createMessageSignature(parsedSig);
    return tx;
  } else {
    throw new Error('Cannot set signature on multi-sig transaction');
  }
}

beforeEach(() => {
  fetchMock.resetMocks();
  jest.resetModules();
});

test('API key middleware - get nonce', async () => {
  const address = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

  const apiKey = '1234-my-api-key-example';
  const fetch = createFetchFn(createApiKeyMiddleware({ apiKey }));
  const client = { fetch };

  fetchMock.mockRejectOnce();
  fetchMock.mockOnce(`{"balance": "0", "nonce": "123"}`);

  const fetchedNonce = await fetchNonce({ address, client });
  expect(fetchedNonce).toBe(123n);
  expect(fetchMock.mock.calls.length).toEqual(2);
  expect(fetchMock.mock.calls[1][0]).toEqual(
    'https://api.mainnet.hiro.so/v2/accounts/STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6?proof=0'
  );
  const callHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
  expect(callHeaders.has('x-api-key')).toBeTruthy();
  expect(callHeaders.get('x-api-key')).toBe(apiKey);
});

test('Make STX token transfer with set tx fee', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '0000000001040015c31b8c1c11c515e244b75806bac48d1399c77500000000000000000000000000000000' +
    '00008b316d56e35b3b8d03ab3b9dbe05eb44d64c53e7ba3c468f9a78c82a13f2174c32facb0f29faeb2107' +
    '5ec933db935ebc28a8793cc60e14b8ee4ef05f52c94016030200000000000516df0ba3e79792be7be5e50a' +
    '370289accfc8c9e032000000000000303974657374206d656d6f0000000000000000000000000000000000' +
    '0000000000000000';

  expect(serialized).toBe(tx);
});

test('Make STX token transfer with fee estimate', async () => {
  const apiUrl = `${HIRO_MAINNET_URL}/v2/fees/transaction`;
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const mockedResponse = JSON.stringify({
    cost_scalar_change_by_byte: 0.00476837158203125,
    estimated_cost: {
      read_count: 19,
      read_length: 4814,
      runtime: 7175000,
      write_count: 2,
      write_length: 1020,
    },
    estimated_cost_scalar: 14,
    estimations: [
      {
        fee: 200,
        fee_rate: 10,
      },
      {
        fee: 180,
        fee_rate: 1.2410714285714286,
      },
      {
        fee: 160,
        fee_rate: 8.958333333333332,
      },
    ],
  });

  fetchMock.mockOnce(mockedResponse);

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    nonce,
    senderKey,
    memo,
  });

  expect(() => transaction.verifyOrigin()).not.toThrow();
  expect(transaction.auth.spendingCondition?.fee?.toString()).toEqual('180');

  const serialized = transaction.serialize();
  const tx =
    '0000000001040015c31b8c1c11c515e244b75806bac48d1399c775000000000000000000000000000000b4' +
    '0001e5ac1152f6018fbfded102268b22086666150823d0ae57f4023bde058a7ff0b279076db25b358b8833' +
    '2efba7a8a75e7ccd08207af62d799e6eb8b0357ad55558030200000000000516df0ba3e79792be7be5e50a' +
    '370289accfc8c9e032000000000000303974657374206d656d6f0000000000000000000000000000000000' +
    '0000000000000000';

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(apiUrl);
  expect(serialized).toBe(tx);
});

test('Make STX token transfer with testnet', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
    memo: memo,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();
  const tx =
    '8080000000040015c31b8c1c11c515e244b75806bac48d1399c77500000000000000000000000000000000' +
    '00014199f63f7e010141a36a4624d032758f54e08ff03b24ed2667463eb405b4d81505631b32a1f13b5737' +
    '1f29a6095b81741b32b5864b178e3546ff2bfb3dc08682030200000000000516df0ba3e79792be7be5e50a' +
    '370289accfc8c9e032000000000000303974657374206d656d6f0000000000000000000000000000000000' +
    '0000000000000000';

  expect(serialized).toBe(tx);
});

test('Make STX token transfer with testnet string name', async () => {
  const transaction = await makeSTXTokenTransfer({
    recipient: standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'),
    amount: 12345,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
    fee: 0,
    nonce: 0,
    network: 'testnet',
    memo: 'test memo',
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();
  const tx =
    '8080000000040015c31b8c1c11c515e244b75806bac48d1399c77500000000000000000000000000000000' +
    '00014199f63f7e010141a36a4624d032758f54e08ff03b24ed2667463eb405b4d81505631b32a1f13b5737' +
    '1f29a6095b81741b32b5864b178e3546ff2bfb3dc08682030200000000000516df0ba3e79792be7be5e50a' +
    '370289accfc8c9e032000000000000303974657374206d656d6f0000000000000000000000000000000000' +
    '0000000000000000';

  expect(serialized).toBe(tx);
});

test('Throws making STX token transder with invalid network name', async () => {
  const txOptions = {
    recipient: standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'),
    amount: 12345,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
    fee: 0,
    nonce: 0,
    network: 'invalidnet',
    memo: 'test memo',
  };

  await expect(
    async () => await makeSTXTokenTransfer(txOptions as SignedTokenTransferOptions)
  ).rejects.toThrow(Error);
});

test("STX token transfers don't take post conditions", async () => {
  const recipientAddress = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159';
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const postConditions = [
    {
      type: 'stx-postcondition',
      address: recipientAddress,
      condition: 'gte',
      amount: 54321,
    },
  ];

  const transaction = await makeSTXTokenTransfer({
    recipient: standardPrincipalCV(recipientAddress),
    amount,
    senderKey,
    fee,
    nonce,
    memo,
    postConditions,
  } as SignedTokenTransferOptions);

  const serialized = transaction.serializeBytes();

  const bytesReader = new BytesReader(serialized);
  const deserializedTx = deserializeTransaction(bytesReader);

  expect(deserializedTx.postConditions.values).toHaveLength(0);
  expect(deserializedTx.postConditionMode).toBe(PostConditionMode.Deny);
});

test('Make Multi-Sig STX token transfer', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 0;
  const nonce = 0;
  const memo = 'test memo';

  const authType = AuthType.Standard;
  const addressHashMode = AddressHashMode.P2SH;

  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  const transaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    memo: memo,
    numSignatures: 2,
    publicKeys: pubKeyStrings,
  });
  const signer = new TransactionSigner(transaction);
  expect(signer.sigHash).toBe(transaction.signBegin());
  signer.signOrigin(privKeys[0]);
  expect(signer.sigHash).not.toBe(transaction.signBegin());
  signer.signOrigin(privKeys[1]);
  signer.appendOrigin(pubKeys[2]);
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serializedTx = transaction.serialize();
  const tx =
    '00000000010401a23ea89d6529ac48ac766f720e480beec7f1927300000000000000000000000000000000' +
    '000000030200dc8061e63a8ed7ca4712c257299b4bdc3938e34ccc01ce979dd74e5483c4f971053a12680c' +
    'bfbea87976543a94500314c9a1eaf33986aef97821eb65fb0c604202018ff7d2d8cd4e43498912bfc2c30b' +
    'e1fd58bef8d819e1371a0f5afa5e4b58ff6e498bd67b58c32bf670f0d8bcb399fa141e5c5cc21e57d30a09' +
    '1395c95c9e05580003661ec7479330bf1ef7a4c9d1816f089666a112e72d671048e5424fc528ca51530002' +
    '030200000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000002625a074657374206d' +
    '656d6f00000000000000000000000000000000000000000000000000';

  expect(serializedTx).toBe(tx);

  const bytesReader = new BytesReader(hexToBytes(serializedTx));
  const deserializedTx = deserializeTransaction(bytesReader);

  expect(deserializedTx.auth.authType).toBe(authType);

  expect(deserializedTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedTx.auth.spendingCondition!.nonce.toString()).toBe(nonce.toString());
  expect(deserializedTx.auth.spendingCondition!.fee.toString()).toBe(fee.toString());
  expect(deserializedTx.auth.spendingCondition!.signer).toEqual(
    'a23ea89d6529ac48ac766f720e480beec7f19273'
  );
  const deserializedPayload = deserializedTx.payload as TokenTransferPayloadWire;
  expect(deserializedPayload.amount.toString()).toBe(amount.toString());

  const serializedSignedTx = serializedTx;

  const signedTx =
    '00000000010401a23ea89d6529ac48ac766f720e480beec7f19273000000000000000000000000000000000' +
    '00000030200dc8061e63a8ed7ca4712c257299b4bdc3938e34ccc01ce979dd74e5483c4f971053a12680cbf' +
    'bea87976543a94500314c9a1eaf33986aef97821eb65fb0c604202018ff7d2d8cd4e43498912bfc2c30be1f' +
    'd58bef8d819e1371a0f5afa5e4b58ff6e498bd67b58c32bf670f0d8bcb399fa141e5c5cc21e57d30a091395' +
    'c95c9e05580003661ec7479330bf1ef7a4c9d1816f089666a112e72d671048e5424fc528ca5153000203020' +
    '0000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000002625a074657374206d656d6f' +
    '00000000000000000000000000000000000000000000000000';

  expect(serializedSignedTx).toBe(signedTx);
});

test('Should deserialize partially signed multi-Sig STX token transfer', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 0;
  const nonce = 0;
  const memo = 'test memo';

  const authType = AuthType.Standard;
  const addressHashMode = AddressHashMode.P2SH;

  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  const transaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    memo: memo,
    numSignatures: 2,
    publicKeys: pubKeyStrings,
  });

  const serializedTx = transaction.serialize();

  const tx =
    '00000000010401a23ea89d6529ac48ac766f720e480beec7f1927300000000000000000000000000000000' +
    '000000000002030200000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000002625a0' +
    '74657374206d656d6f00000000000000000000000000000000000000000000000000';

  expect(serializedTx).toBe(tx);

  const bytesReader = new BytesReader(hexToBytes(serializedTx));

  // Partially signed or unsigned multi-sig tx can be serialized and deserialized without exception (Incorrect number of signatures)
  // Should be able to deserializeTransaction with missing signatures.
  expect(() => deserializeTransaction(bytesReader)).not.toThrowError();

  // Now add the required signatures in the original transactions
  const signer = new TransactionSigner(transaction);
  signer.signOrigin(privKeys[0]);
  signer.signOrigin(privKeys[1]);
  signer.appendOrigin(pubKeys[2]);

  const fullySignedTransaction = transaction.serializeBytes();
  const bytesReaderSignedTx = new BytesReader(fullySignedTransaction);

  // Should deserialize fully signed multi sig transaction
  const deserializedTx = deserializeTransaction(bytesReaderSignedTx);

  expect(deserializedTx.auth.authType).toBe(authType);

  expect(deserializedTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedTx.auth.spendingCondition!.nonce.toString()).toBe(nonce.toString());
  expect(deserializedTx.auth.spendingCondition!.fee.toString()).toBe(fee.toString());
  expect(deserializedTx.auth.spendingCondition!.signer).toEqual(
    'a23ea89d6529ac48ac766f720e480beec7f19273'
  );
  const deserializedPayload = deserializedTx.payload as TokenTransferPayloadWire;
  expect(deserializedPayload.amount.toString()).toBe(amount.toString());

  const signedTx =
    '00000000010401a23ea89d6529ac48ac766f720e480beec7f19273000000000000000000000000000000000' +
    '00000030200dc8061e63a8ed7ca4712c257299b4bdc3938e34ccc01ce979dd74e5483c4f971053a12680cbf' +
    'bea87976543a94500314c9a1eaf33986aef97821eb65fb0c604202018ff7d2d8cd4e43498912bfc2c30be1f' +
    'd58bef8d819e1371a0f5afa5e4b58ff6e498bd67b58c32bf670f0d8bcb399fa141e5c5cc21e57d30a091395' +
    'c95c9e05580003661ec7479330bf1ef7a4c9d1816f089666a112e72d671048e5424fc528ca5153000203020' +
    '0000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000002625a074657374206d656d6f' +
    '00000000000000000000000000000000000000000000000000';

  expect(bytesToHex(fullySignedTransaction)).toBe(signedTx);
});

test('Should throw error if multisig transaction is oversigned', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 0;
  const nonce = 0;
  const memo = 'test memo';

  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  const transaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    memo: memo,
    numSignatures: 2,
    publicKeys: pubKeyStrings,
  });

  const signer = new TransactionSigner(transaction);
  signer.signOrigin(privKeys[0]);
  signer.signOrigin(privKeys[1]);
  expect(() => {
    signer.signOrigin(privKeys[2]);
  }).toThrow('Origin would have too many signatures');

  const fields = (transaction.auth.spendingCondition as MultiSigSpendingCondition).fields;
  fields.push({ ...fields[0] });
  expect(() => {
    new TransactionSigner(transaction);
  }).toThrow('SpendingCondition has more signatures than are expected');
});

test('Make Multi-Sig STX token transfer with two transaction signers', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 0;
  const nonce = 0;
  const memo = 'test memo';

  const authType = AuthType.Standard;
  const addressHashMode = AddressHashMode.P2SH;

  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  const transaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    memo: memo,
    numSignatures: 2,
    publicKeys: pubKeyStrings,
  });

  const serializedTxUnsigned = transaction.serialize();

  const tx =
    '00000000010401a23ea89d6529ac48ac766f720e480beec7f1927300000000000000000000000000000000' +
    '000000000002030200000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000002625a0' +
    '74657374206d656d6f00000000000000000000000000000000000000000000000000';

  expect(serializedTxUnsigned).toBe(tx);

  // obtain first auth field and sign once
  const signer = new TransactionSigner(transaction);

  const sig1 = nextSignature(signer.sigHash, authType, fee, nonce, privKeys[0]).nextSig;

  const compressed1 = privKeys[0].endsWith('01');
  const field1 = createTransactionAuthField(
    compressed1 ? PubKeyEncoding.Compressed : PubKeyEncoding.Uncompressed,
    createMessageSignature(sig1)
  );
  signer.signOrigin(privKeys[0]);

  // serialize
  const partiallySignedSerialized = transaction.serializeBytes();

  // deserialize
  const bytesReader2 = new BytesReader(partiallySignedSerialized);
  // Partially signed multi-sig tx can be serialized and deserialized without exception (Incorrect number of signatures)
  // Should be able to deserialize as number of signatures are less than signatures required
  expect(() => deserializeTransaction(bytesReader2)).not.toThrowError();

  // finish signing with new TransactionSigner
  const signer2 = new TransactionSigner(transaction);

  const sig2 = nextSignature(signer2.sigHash, authType, fee, nonce, privKeys[1]).nextSig;

  const compressed2 = privKeys[1].endsWith('01');
  const field2 = createTransactionAuthField(
    compressed2 ? PubKeyEncoding.Compressed : PubKeyEncoding.Uncompressed,
    createMessageSignature(sig2)
  );

  const compressedPub = publicKeyIsCompressed(pubKeys[2].data);
  const field3 = createTransactionAuthField(
    compressedPub ? PubKeyEncoding.Compressed : PubKeyEncoding.Uncompressed,
    pubKeys[2]
  );

  signer2.signOrigin(privKeys[1]);
  signer2.appendOrigin(pubKeys[2]);

  const serializedTx = transaction.serializeBytes();

  const bytesReader = new BytesReader(serializedTx);
  const deserializedTx = deserializeTransaction(bytesReader);
  expect(() => deserializedTx.verifyOrigin()).not.toThrow();

  expect(deserializedTx.auth.authType).toBe(authType);

  expect(deserializedTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedTx.auth.spendingCondition!.nonce.toString()).toBe(nonce.toString());
  expect(deserializedTx.auth.spendingCondition!.fee.toString()).toBe(fee.toString());
  expect(deserializedTx.auth.spendingCondition!.signer).toEqual(
    'a23ea89d6529ac48ac766f720e480beec7f19273'
  );
  const deserializedPayload = deserializedTx.payload as TokenTransferPayloadWire;
  expect(deserializedPayload.amount.toString()).toBe(amount.toString());

  const spendingCondition = deserializedTx.auth.spendingCondition as MultiSigSpendingCondition;
  expect(spendingCondition.fields[0]).toEqual(field1);
  expect(spendingCondition.fields[1]).toEqual(field2);
  expect(spendingCondition.fields[2]).toEqual(field3);

  const serializedSignedTx = deserializedTx.serialize();

  const signedTx =
    '00000000010401a23ea89d6529ac48ac766f720e480beec7f19273000000000000000000000000000000000' +
    '00000030200dc8061e63a8ed7ca4712c257299b4bdc3938e34ccc01ce979dd74e5483c4f971053a12680cbf' +
    'bea87976543a94500314c9a1eaf33986aef97821eb65fb0c604202018ff7d2d8cd4e43498912bfc2c30be1f' +
    'd58bef8d819e1371a0f5afa5e4b58ff6e498bd67b58c32bf670f0d8bcb399fa141e5c5cc21e57d30a091395' +
    'c95c9e05580003661ec7479330bf1ef7a4c9d1816f089666a112e72d671048e5424fc528ca5153000203020' +
    '0000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000002625a074657374206d656d6f' +
    '00000000000000000000000000000000000000000000000000';

  expect(serializedSignedTx).toBe(signedTx);
});

test('addSignature to an unsigned transaction', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 0;
  const nonce = 0;
  const publicKey = '021ae7f08f9eaecaaa93f7c6ceac29213bae09588c15e2aded32016b259cfd9a1f';

  const unsignedTx = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    publicKey,
  });

  const nullSignature = (unsignedTx.auth.spendingCondition as any).signature.data;

  expect(nullSignature).toEqual(
    '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  );

  const sig =
    '00e4ee626905ee9d04b786e2942a69504dcc0f35ca79b86fb0aafcd47a81fc3bf1547e302c3acf5c89d935a53df334316e6fcdc203cf6bed91288ebf974385398c';
  const signedTx = setSignature(unsignedTx, sig);
  expect((signedTx.auth.spendingCondition as SingleSigSpendingCondition).signature.data).toEqual(
    sig
  );
  expect(unsignedTx).not.toBe(signedTx);
});

test('Make versioned smart contract deploy', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const fee = 0;
  const nonce = 0;

  const transaction = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
    clarityVersion: ClarityVersion.Clarity2,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c50034290000000000000000000000000000000000009172c9841e763c32e827c177491f5228956e6ef1071043be898bfdd694bf3e680309b0666e8fec013a8a453573a8bd707152c9f21aa6f2d5e57c407af672b6f00302000000000602086b762d73746f72650000015628646566696e652d6d61702073746f72652028286b657920286275666620333229292920282876616c7565202862756666203332292929290a0a28646566696e652d7075626c696320286765742d76616c756520286b65792028627566662033322929290a20202020286d6174636820286d61702d6765743f2073746f72652028286b6579206b65792929290a2020202020202020656e74727920286f6b20286765742076616c756520656e74727929290a20202020202020202865727220302929290a0a28646566696e652d7075626c696320287365742d76616c756520286b65792028627566662033322929202876616c75652028627566662033322929290a2020202028626567696e0a2020202020202020286d61702d7365742073746f72652028286b6579206b6579292920282876616c75652076616c75652929290a2020202020202020286f6b2027747275652929290a';

  expect(serialized).toBe(tx);
});

test('Make smart contract deploy (defaults to versioned smart contract, as of 2.1)', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const fee = 0;
  const nonce = 0;

  const transaction = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey,
    fee,
    nonce,
    clarityVersion: 2,
    network: STACKS_TESTNET,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c50034290000000000000000000000000000000000009172c9841e763c32e827c177491f5228956e6ef1071043be898bfdd694bf3e680309b0666e8fec013a8a453573a8bd707152c9f21aa6f2d5e57c407af672b6f00302000000000602086b762d73746f72650000015628646566696e652d6d61702073746f72652028286b657920286275666620333229292920282876616c7565202862756666203332292929290a0a28646566696e652d7075626c696320286765742d76616c756520286b65792028627566662033322929290a20202020286d6174636820286d61702d6765743f2073746f72652028286b6579206b65792929290a2020202020202020656e74727920286f6b20286765742076616c756520656e74727929290a20202020202020202865727220302929290a0a28646566696e652d7075626c696320287365742d76616c756520286b65792028627566662033322929202876616c75652028627566662033322929290a2020202028626567696e0a2020202020202020286d61702d7365742073746f72652028286b6579206b6579292920282876616c75652076616c75652929290a2020202020202020286f6b2027747275652929290a';

  expect(serialized).toBe(tx);
});

test('Make smart contract deploy with network string name (versioned smart contracts exist, as of 2.1)', async () => {
  const transaction = await makeContractDeploy({
    contractName: 'kv-store',
    codeBody: fs.readFileSync('./tests/contracts/kv-store.clar').toString(),
    senderKey: 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801',
    clarityVersion: ClarityVersion.Clarity2,
    fee: 0,
    nonce: 0,
    network: 'testnet',
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  expect(serialized[233]).toBe('2');

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c50034290000000000000000000000000000000000009172c9841e763c32e827c177491f5228956e6ef1071043be898bfdd694bf3e680309b0666e8fec013a8a453573a8bd707152c9f21aa6f2d5e57c407af672b6f00302000000000602086b762d73746f72650000015628646566696e652d6d61702073746f72652028286b657920286275666620333229292920282876616c7565202862756666203332292929290a0a28646566696e652d7075626c696320286765742d76616c756520286b65792028627566662033322929290a20202020286d6174636820286d61702d6765743f2073746f72652028286b6579206b65792929290a2020202020202020656e74727920286f6b20286765742076616c756520656e74727929290a20202020202020202865727220302929290a0a28646566696e652d7075626c696320287365742d76616c756520286b65792028627566662033322929202876616c75652028627566662033322929290a2020202028626567696e0a2020202020202020286d61702d7365742073746f72652028286b6579206b6579292920282876616c75652076616c75652929290a2020202020202020286f6b2027747275652929290a';

  expect(serialized).toBe(tx);
});

test('Make smart contract deploy with clarity version 3', async () => {
  const transaction = await makeContractDeploy({
    contractName: 'kv-store',
    codeBody: fs.readFileSync('./tests/contracts/kv-store.clar').toString(),
    senderKey: 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801',
    clarityVersion: ClarityVersion.Clarity3,
    fee: 0,
    nonce: 0,
    network: 'testnet',
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  expect(serialized[233]).toBe('3');

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c5003429000000000000000000000000000000000000d96e95cd80a14b294ab618061f886939c15a01692dff98a58e09310e8291cf3659ccb2b5fb98236ca74fd814fd51642f8287379f397262f266b41dda18773b860302000000000603086b762d73746f72650000015628646566696e652d6d61702073746f72652028286b657920286275666620333229292920282876616c7565202862756666203332292929290a0a28646566696e652d7075626c696320286765742d76616c756520286b65792028627566662033322929290a20202020286d6174636820286d61702d6765743f2073746f72652028286b6579206b65792929290a2020202020202020656e74727920286f6b20286765742076616c756520656e74727929290a20202020202020202865727220302929290a0a28646566696e652d7075626c696320287365742d76616c756520286b65792028627566662033322929202876616c75652028627566662033322929290a2020202028626567696e0a2020202020202020286d61702d7365742073746f72652028286b6579206b6579292920282876616c75652076616c75652929290a2020202020202020286f6b2027747275652929290a';

  expect(serialized).toBe(tx);
});

test('Make smart contract deploy unsigned', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const publicKey = '03797dd653040d344fd048c1ad05d4cbcb2178b30c6a0c4276994795f3e833da41';
  const fee = 0;
  const nonce = 0;

  const authType = AuthType.Standard;
  const addressHashMode = AddressHashMode.P2PKH;
  const transaction = await makeUnsignedContractDeploy({
    contractName,
    codeBody,
    publicKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
  });

  const serializedTx = transaction.serializeBytes();

  const bytesReader = new BytesReader(serializedTx);
  const deserializedTx = deserializeTransaction(bytesReader);

  expect(deserializedTx.auth.authType).toBe(authType);

  expect(deserializedTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());
});

test('make a multi-sig contract deploy', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const fee = 0;
  const nonce = 0;
  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  const transaction = await makeContractDeploy({
    codeBody,
    contractName,
    publicKeys: pubKeyStrings,
    numSignatures: 3,
    signerKeys: privKeys,
    fee,
    nonce,
    network: STACKS_TESTNET,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();
  expect(transaction.auth.spendingCondition!.signer).toEqual(
    '04128cacf0764f69b1e291f62d1dcdd8f65be5ab'
  );
});

test('Make smart contract deploy signed', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const fee = 0;
  const nonce = 0;

  const authType = AuthType.Standard;
  const addressHashMode = AddressHashMode.P2PKH;
  const transaction = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serializedTx = transaction.serializeBytes();

  const bytesReader = new BytesReader(serializedTx);
  const deserializedTx = deserializeTransaction(bytesReader);
  expect(deserializedTx.auth.authType).toBe(authType);

  expect(deserializedTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());
});

test('Make contract-call', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';

  const fee = 0;

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    senderKey,
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c500342900000000000000010000000000000000' +
    '0000b2c4262b8716891ee4a3361b31b3847cdb3d4897538f0f7716a3720686aee96f01be6610141c6afb36' +
    'f32c60575147b7e08191bae5cf9706c528adf46f28473e030200000000021ae6c05355e0c990ffad19a5e9' +
    'bda394a9c5003429086b762d73746f7265096765742d76616c7565000000010200000003666f6f';

  expect(serialized).toBe(tx);
});

test('Make contract-call with network string', async () => {
  const transaction = await makeContractCall({
    contractAddress: 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE',
    contractName: 'kv-store',
    functionName: 'get-value',
    functionArgs: [bufferCV(utf8ToBytes('foo'))],
    senderKey: 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801',
    fee: 0,
    nonce: 1,
    network: 'testnet',
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c500342900000000000000010000000000000000' +
    '0000b2c4262b8716891ee4a3361b31b3847cdb3d4897538f0f7716a3720686aee96f01be6610141c6afb36' +
    'f32c60575147b7e08191bae5cf9706c528adf46f28473e030200000000021ae6c05355e0c990ffad19a5e9' +
    'bda394a9c5003429086b762d73746f7265096765742d76616c7565000000010200000003666f6f';

  expect(serialized).toBe(tx);
});

test('Make contract-call with post conditions', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const postConditionAddress = 'ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH';
  const assetAddress = 'ST34RKEJKQES7MXQFBT29KSJZD73QK3YNT5N56C6X';
  const assetContractName = 'test-asset-contract';
  const assetName = 'test-asset-name';
  const tokenAssetName = 'token-asset-name';

  const fee = 0;

  const postConditions: PostCondition[] = [
    {
      type: 'stx-postcondition',
      address: postConditionAddress,
      condition: 'gte',
      amount: 10,
    },
    {
      type: 'stx-postcondition',
      address: `${contractAddress}.${contractName}`,
      condition: 'gte',
      amount: 12345,
    },
    {
      type: 'ft-postcondition',
      address: postConditionAddress,
      condition: 'lt',
      amount: 1000,
      asset: `${assetAddress}.${assetContractName}::${assetName}`,
    },
    {
      type: 'ft-postcondition',
      address: `${postConditionAddress}.${contractName}`,
      condition: 'eq',
      amount: 1,
      asset: `${assetAddress}.${assetContractName}::${assetName}`,
    },
    {
      type: 'nft-postcondition',
      address: postConditionAddress,
      condition: 'not-sent',
      asset: `${assetAddress}.${assetContractName}::${assetName}`,
      assetId: bufferCVFromString(tokenAssetName),
    },
    {
      type: 'nft-postcondition',
      address: `${postConditionAddress}.${contractName}`,
      condition: 'sent',
      asset: `${assetAddress}.${assetContractName}::${assetName}`,
      assetId: bufferCVFromString(tokenAssetName),
    },
  ];

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    senderKey,
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
    postConditions,
    postConditionMode: 'deny',
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c500342900000000000000010000000000000000' +
    '0000dcaf5f38038f787babf86644e0251945b93d9bffac610fb3b8c56da9eb2961de04ab66f64aa0b2e1cc' +
    '04172a2b002b8ff34e4b0c3ee430c00331c911325446c203020000000600021a5dd8ff3545259925b98252' +
    '4807686567eec2933f03000000000000000a00031ae6c05355e0c990ffad19a5e9bda394a9c5003429086b' +
    '762d73746f726503000000000000303901021a5dd8ff3545259925b982524807686567eec2933f1ac989ba' +
    '53bbb27a76ef5e8499e65f69c7798fd5d113746573742d61737365742d636f6e74726163740f746573742d' +
    '61737365742d6e616d650400000000000003e801031a5dd8ff3545259925b982524807686567eec2933f08' +
    '6b762d73746f72651ac989ba53bbb27a76ef5e8499e65f69c7798fd5d113746573742d61737365742d636f' +
    '6e74726163740f746573742d61737365742d6e616d6501000000000000000102021a5dd8ff3545259925b9' +
    '82524807686567eec2933f1ac989ba53bbb27a76ef5e8499e65f69c7798fd5d113746573742d6173736574' +
    '2d636f6e74726163740f746573742d61737365742d6e616d650200000010746f6b656e2d61737365742d6e' +
    '616d651102031a5dd8ff3545259925b982524807686567eec2933f086b762d73746f72651ac989ba53bbb2' +
    '7a76ef5e8499e65f69c7798fd5d113746573742d61737365742d636f6e74726163740f746573742d617373' +
    '65742d6e616d650200000010746f6b656e2d61737365742d6e616d6510021ae6c05355e0c990ffad19a5e9' +
    'bda394a9c5003429086b762d73746f7265096765742d76616c7565000000010200000003666f6f';

  expect(serialized).toBe(tx);
});

test('Make contract-call with post condition allow mode', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';

  const fee = 0;

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    senderKey,
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
    postConditionMode: PostConditionMode.Allow,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  const serialized = transaction.serialize();

  const tx =
    '80800000000400e6c05355e0c990ffad19a5e9bda394a9c50034290000000000000001000000000000000' +
    '0000074ba5083c1b444e5d1eb7bc7add66a9a511f57fc4b2514f5b0e54892962d5b453ea0ec6e473bc695' +
    '22fd3fdd9104b7a354f830ad7ceabd0b3f2859d15697ad9b030100000000021ae6c05355e0c990ffad19a' +
    '5e9bda394a9c5003429086b762d73746f7265096765742d76616c7565000000010200000003666f6f';

  expect(serialized).toBe(tx);
});

test('addSignature to an unsigned contract call transaction', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const fee = 0;
  const publicKey = '021ae7f08f9eaecaaa93f7c6ceac29213bae09588c15e2aded32016b259cfd9a1f';

  const unsignedTx = await makeUnsignedContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    publicKey,
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
    postConditionMode: PostConditionMode.Allow,
  });

  const nullSignature = (unsignedTx.auth.spendingCondition as any).signature.data;

  expect(nullSignature).toEqual(
    '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  );

  const sig =
    '00e4ee626905ee9d04b786e2942a69504dcc0f35ca79b86fb0aafcd47a81fc3bf1547e302c3acf5c89d935a53df334316e6fcdc203cf6bed91288ebf974385398c';
  const signedTx = setSignature(unsignedTx, sig);
  expect((signedTx.auth.spendingCondition as SingleSigSpendingCondition).signature.data).toEqual(
    sig
  );
  expect(unsignedTx).not.toBe(signedTx);
});

test('make a multi-sig contract call', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const fee = 0;
  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    publicKeys: pubKeyStrings,
    numSignatures: 3,
    signerKeys: privKeys,
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
    postConditionMode: PostConditionMode.Allow,
  });
  expect(() => transaction.verifyOrigin()).not.toThrow();

  expect(transaction.auth.spendingCondition!.signer).toEqual(
    '04128cacf0764f69b1e291f62d1dcdd8f65be5ab'
  );
});

test('Estimate transaction transfer fee', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const publicKey = privateKeyToPublic(senderKey);
  const memo = 'test memo';

  const transaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    publicKey,
    amount,
    fee,
    nonce,
    memo,
  });

  const serialized = transaction.serializeBytes();
  const transactionByteLength = serialized.byteLength;

  const mockedResponse = JSON.stringify({
    cost_scalar_change_by_byte: 0.00476837158203125,
    estimated_cost: {
      read_count: 19,
      read_length: 4814,
      runtime: 7175000,
      write_count: 2,
      write_length: 1020,
    },
    estimated_cost_scalar: 14,
    estimations: [
      {
        fee: 140,
        fee_rate: 10,
      },
      {
        fee: 17,
        fee_rate: 1.2410714285714286,
      },
      {
        fee: 125,
        fee_rate: 8.958333333333332,
      },
    ],
  });

  fetchMock.mockOnce(mockedResponse);

  const mainnet = {}; // default
  const resultEstimateFee = await fetchFeeEstimateTransaction({
    payload: bytesToHex(serializePayloadBytes(transaction.payload)),
    estimatedLength: transactionByteLength,
    client: mainnet,
  });

  fetchMock.mockOnce(mockedResponse);

  const testnet = { baseUrl: HIRO_TESTNET_URL };
  const resultEstimateFee2 = await fetchFeeEstimateTransaction({
    payload: bytesToHex(serializePayloadBytes(transaction.payload)),
    estimatedLength: transactionByteLength,
    client: testnet,
  });

  expect(fetchMock.mock.calls.length).toEqual(2);
  expect(fetchMock.mock.calls[0][0]).toEqual(`${HIRO_MAINNET_URL}${TRANSACTION_FEE_ESTIMATE_PATH}`);
  expect(fetchMock.mock.calls[0][1]?.body).toEqual(
    JSON.stringify({
      transaction_payload: bytesToHex(serializePayloadBytes(transaction.payload)),
      estimated_len: transactionByteLength,
    })
  );
  expect(fetchMock.mock.calls[1][0]).toEqual(`${HIRO_TESTNET_URL}${TRANSACTION_FEE_ESTIMATE_PATH}`);
  expect(fetchMock.mock.calls[1][1]?.body).toEqual(
    JSON.stringify({
      transaction_payload: bytesToHex(serializePayloadBytes(transaction.payload)),
      estimated_len: transactionByteLength,
    })
  );
  expect(resultEstimateFee.map(f => f.fee)).toEqual([140, 17, 125]);
  expect(resultEstimateFee2.map(f => f.fee)).toEqual([140, 17, 125]);
});

test('Estimate transaction fee fallback', async () => {
  const privateKey = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01';
  const poolAddress = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
  const client = { baseUrl: 'http://localhost:3999' };

  // http://localhost:3999/v2/fees/transaction
  fetchMock.once(
    `{"error":"Estimation could not be performed","reason":"NoEstimateAvailable","reason_data":{"message":"No estimate available for the provided payload."}}`,
    { status: 400 }
  );

  // http://localhost:3999/v2/fees/transfer
  fetchMock.once('1');

  const transaction = await makeContractCall({
    senderKey: privateKey,
    contractAddress: 'ST000000000000000000002AMW42H',
    contractName: 'pox-2',
    functionName: 'delegate-stx',
    functionArgs: [uintCV(100_000), principalCV(poolAddress), noneCV(), noneCV()],
    nonce: 1,
    network: STACKS_TESTNET,
    client,
  });

  // http://localhost:3999/v2/fees/transaction
  fetchMock.once(
    `{"error":"Estimation could not be performed","reason":"NoEstimateAvailable","reason_data":{"message":"No estimate available for the provided payload."}}`,
    { status: 400 }
  );

  // http://localhost:3999/v2/fees/transfer
  fetchMock.once('1');

  const testnet = { baseUrl: HIRO_TESTNET_URL };
  const resultEstimateFee = await fetchFeeEstimate({ transaction, client: testnet });
  expect(resultEstimateFee).toBe(201n);

  // http://localhost:3999/v2/fees/transaction
  fetchMock.once(
    `{"error":"Estimation could not be performed","reason":"NoEstimateAvailable","reason_data":{"message":"No estimate available for the provided payload."}}`,
    { status: 400 }
  );

  // http://localhost:3999/v2/fees/transfer
  fetchMock.once('2'); // double

  const doubleRate = await fetchFeeEstimate({ transaction, client: testnet });
  expect(doubleRate).toBe(402n);

  expect(fetchMock.mock.calls.length).toEqual(6);
});

test('Single-sig transaction byte length must include signature', async () => {
  /*
   * *** Context ***
   * 1) Single-sig transaction byte length remain same due to empty message signature which allocates the space for signature
   * 2) estimateTransactionByteLength should correctly estimate the byte length of single-sig transaction
   */

  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 100;
  const nonce = 10;
  const memo = 'test memo...';

  const privateKey = 'a5c61c6ca7b3e7e55edee68566aeab22e4da26baa285c7bd10e8d2218aa3b229';
  const publicKey = '027d28f9951ce46538951e3697c62588a87f1f1f295de4a14fdd4c780fc52cfe69';

  // Create a unsigned single-sig transaction
  const unsignedTransaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    memo: memo,
    publicKey: publicKey,
  });

  // Due to empty message signature space will be allocated for signature
  expect(unsignedTransaction.serializeBytes().byteLength).toEqual(
    estimateTransactionByteLength(unsignedTransaction)
  );

  const signer = new TransactionSigner(unsignedTransaction);
  // Now sign the transaction and verify the byteLength after adding signature
  signer.signOrigin(privateKey);

  const finalSerializedTx = signer.transaction.serializeBytes();

  // Byte length will remains the same after signing due to pre allocated space by empty message signature
  expect(finalSerializedTx.byteLength).toEqual(estimateTransactionByteLength(signer.transaction));
});

test('Multi-sig transaction byte length must include the required signatures', async () => {
  /*
   * *** Context ***
   * 1) Multi-sig transaction byte length increases by adding signatures
   *    which causes the incorrect fee estimation because the fee value is set while creating unsigned transaction
   * 2) estimateTransactionByteLength should correctly estimate the byte length of multi-sig transaction
   */

  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;
  const fee = 100;
  const nonce = 10;
  const memo = 'test memo...';

  const privKeys = [
    '6d430bb91222408e7706c9001cfaeb91b08c2be6d5ac95779ab52c6b431950e001',
    '2a584d899fed1d24e26b524f202763c8ab30260167429f157f1c119f550fa6af01',
    'd5200dee706ee53ae98a03fba6cf4fdcc5084c30cfa9e1b3462dcdeaa3e0f1d201',
  ];

  const pubKeys = privKeys.map(privateKeyToPublic).map(createStacksPublicKey);
  const pubKeyStrings = pubKeys.map(serializePublicKeyBytes).map(publicKeyToHex);

  // Create a unsigned multi-sig transaction
  const transaction = await makeUnsignedSTXTokenTransfer({
    recipient,
    amount,
    fee,
    nonce,
    memo: memo,
    numSignatures: 3,
    publicKeys: pubKeyStrings,
  });

  // Total length without signatures
  const unsignedByteLength = 120;

  const serializedTx = transaction.serializeBytes();
  // Unsigned transaction byte length without signatures
  expect(serializedTx.byteLength).toEqual(unsignedByteLength);

  // Expected final byte length after adding the required signatures
  const expectedFinalLength = 318;

  // estimatedLen includes the space required for signatures in case of multi-sig transaction
  expect(estimateTransactionByteLength(transaction)).toEqual(expectedFinalLength);

  // Now add the required signatures one by one and test it against the value returned by estimateTransactionByteLength
  const signer = new TransactionSigner(transaction);

  signer.signOrigin(privKeys[0]);
  // Should calculate correct length if transaction is partially signed
  expect(estimateTransactionByteLength(signer.transaction)).toEqual(expectedFinalLength);

  signer.signOrigin(privKeys[1]);
  // Should calculate correct length if transaction is partially signed
  expect(estimateTransactionByteLength(signer.transaction)).toEqual(expectedFinalLength);

  signer.signOrigin(privKeys[2]);
  // Should calculate correct length if transaction is completely signed
  expect(estimateTransactionByteLength(signer.transaction)).toEqual(expectedFinalLength);

  const finalSerializedTx = signer.transaction.serializeBytes();
  // Validate expectedFinalLength is correct
  expect(finalSerializedTx.byteLength).toEqual(expectedFinalLength);

  // Final byte length should match as estimated by estimateTransactionByteLength
  expect(finalSerializedTx.byteLength).toEqual(estimateTransactionByteLength(signer.transaction));
});

test('Make STX token transfer with fetch account nonce', async () => {
  const nonce = 123;
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const senderKey = 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01';
  const address = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
  const memo = 'test memo';

  fetchMock.mockRejectOnce();
  fetchMock.mockOnce(`{"balance":"0", "nonce":${nonce}}`);
  const fetchedNonce = await fetchNonce({
    address,
    client: { baseUrl: HIRO_TESTNET_URL },
  });

  fetchMock.mockRejectOnce();
  fetchMock.mockOnce(`{"balance":"0", "nonce":${nonce}}`);
  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    memo,
    network: 'testnet',
  });

  const EXPECTED_ACCOUNT_URL = `${HIRO_TESTNET_URL}${ACCOUNT_PATH}/${address}?proof=0`;
  expect(fetchMock.mock.calls.length).toEqual(4);
  expect(fetchMock.mock.calls[1][0]).toEqual(EXPECTED_ACCOUNT_URL);
  expect(fetchMock.mock.calls[3][0]).toEqual(EXPECTED_ACCOUNT_URL);
  expect(fetchedNonce.toString()).toEqual(nonce.toString());
  expect(transaction.auth.spendingCondition?.nonce?.toString()).toEqual(nonce.toString());
});

test('Make sponsored STX token transfer', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 50;
  const nonce = 2;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const sponsorKey = '9888d734e6e80a943a6544159e31d6c7e342f695ec867d549c569fa0028892d401';
  const sponsorFee = 123;
  const sponsorNonce = 55;

  const authType = AuthType.Sponsored;
  const addressHashMode = AddressHashMode.P2PKH;

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo: memo,
    sponsored: true,
  });

  const preSponsorSerialized = transaction.serialize();
  const preSponsorTx =
    '0000000001050015c31b8c1c11c515e244b75806bac48d1399c77500000000000000020000000000000032' +
    '000012f0e0f7eec8657e814bdcde9352920dd9416dd757f1ada573ef268cc93001fd76db462508ffd90dec' +
    '57bd977c3b8517f7cbc7d31b3a80aee6068c35714f83e40029cfc6376255a78451eeb4b129ed8eacffa2fe' +
    'ef000000000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000000000000000000000000030200' +
    '000000000516df0ba3e79792be7be5e50a370289accfc8c9e032000000000000303974657374206d656d6f' +
    '00000000000000000000000000000000000000000000000000';

  expect(preSponsorSerialized).toBe(preSponsorTx);
  const sponsorOptions = {
    transaction,
    sponsorPrivateKey: sponsorKey,
    fee: sponsorFee,
    sponsorNonce,
  };

  const sponsorSignedTx = await sponsorTransaction(sponsorOptions);
  const sponsorSignedTxSerialized = sponsorSignedTx.serializeBytes();

  const bytesReader = new BytesReader(sponsorSignedTxSerialized);
  const deserializedSponsorTx = deserializeTransaction(bytesReader);

  // Create same sponsored transaction in steps to verify the signature contents with sponsorTransaction call
  const payload = createTokenTransferPayload(recipient, amount, memo);
  const baseSpendingCondition = createSingleSigSpendingCondition(
    addressHashMode,
    privateKeyToPublic(senderKey),
    nonce,
    fee
  );
  const sponsorSpendingCondition = createSingleSigSpendingCondition(
    addressHashMode,
    privateKeyToPublic(sponsorKey),
    sponsorNonce,
    sponsorFee
  );
  const authorization = createSponsoredAuth(baseSpendingCondition, sponsorSpendingCondition);
  const sponsoredTransaction = new StacksTransactionWire({
    network: STACKS_MAINNET,
    auth: authorization,
    payload,
  });

  const signer = new TransactionSigner(sponsoredTransaction);
  signer.signOrigin(senderKey);
  signer.signSponsor(sponsorKey);

  // Sponsored spending condition
  const sponsoredTransactionClone = signer.transaction;
  const sponsoredSpendingConditionClone = (sponsoredTransactionClone.auth as SponsoredAuthorization)
    .sponsorSpendingCondition;
  const sponsoredSpendingCondition = sponsoredSpendingConditionClone as SingleSigSpendingCondition;

  // signer spending condition
  const signerSpendingConditionClone = (sponsoredTransactionClone.auth as StandardAuthorization)
    .spendingCondition;

  const signerSpendingCondition = signerSpendingConditionClone as SingleSigSpendingCondition;

  expect(deserializedSponsorTx.auth.authType).toBe(authType);

  expect(deserializedSponsorTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedSponsorTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());

  const deserializedSponsorSpendingCondition = (
    deserializedSponsorTx.auth as SponsoredAuthorization
  ).sponsorSpendingCondition!;
  expect(deserializedSponsorSpendingCondition.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorSpendingCondition.nonce!.toString()).toBe(sponsorNonce.toString());
  expect(deserializedSponsorSpendingCondition.fee!.toString()).toBe(sponsorFee.toString());

  const spendingCondition = deserializedSponsorSpendingCondition as SingleSigSpendingCondition;
  const emptySignature = emptyMessageSignature();
  expect(spendingCondition.signature.data.toString()).not.toBe(emptySignature.data.toString());

  // Verify sponsored signature contents
  expect(spendingCondition.signature.data.toString()).toBe(
    sponsoredSpendingCondition.signature.data.toString()
  );
  expect(spendingCondition.signature.type.toString()).toBe(
    sponsoredSpendingCondition.signature.type.toString()
  );

  const signerCreatedSpendingCondition = (sponsorSignedTx.auth as StandardAuthorization)
    .spendingCondition;

  const signersSpendingCondition = signerCreatedSpendingCondition as SingleSigSpendingCondition;
  // Verify signers signature contents
  expect(signersSpendingCondition.signature.data.toString()).toBe(
    signerSpendingCondition.signature.data.toString()
  );
  expect(signersSpendingCondition.signature.type.toString()).toBe(
    signerSpendingCondition.signature.type.toString()
  );

  const deserializedPayload = deserializedSponsorTx.payload as TokenTransferPayloadWire;
  expect(deserializedPayload.amount.toString()).toBe(amount.toString());
});

test('Make sponsored STX token transfer with sponsor fee estimate', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 50;
  const nonce = 2;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';
  const client = { baseUrl: HIRO_MAINNET_URL };

  const sponsorKey = '9888d734e6e80a943a6544159e31d6c7e342f695ec867d549c569fa0028892d401';
  const sponsorNonce = 55;

  const authType = AuthType.Sponsored;
  const addressHashMode = AddressHashMode.P2PKH;

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo,
    sponsored: true,
  });

  const sponsorOptions = {
    transaction,
    sponsorPrivateKey: sponsorKey,
    sponsorNonce,
  };

  const mockedResponse = JSON.stringify({
    cost_scalar_change_by_byte: 0.00476837158203125,
    estimated_cost: {
      read_count: 19,
      read_length: 4814,
      runtime: 7175000,
      write_count: 2,
      write_length: 1020,
    },
    estimated_cost_scalar: 14,
    estimations: [
      {
        fee: 140,
        fee_rate: 10,
      },
      {
        fee: 1,
        fee_rate: 1.2410714285714286,
      },
      {
        fee: 125,
        fee_rate: 8.958333333333332,
      },
    ],
  });

  fetchMock.mockOnce(mockedResponse);

  const sponsorSignedTx = await sponsorTransaction(sponsorOptions);

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(`${client.baseUrl}${TRANSACTION_FEE_ESTIMATE_PATH}`);

  const sponsorSignedTxSerialized = sponsorSignedTx.serializeBytes();

  const bytesReader = new BytesReader(sponsorSignedTxSerialized);
  const deserializedSponsorTx = deserializeTransaction(bytesReader);

  expect(deserializedSponsorTx.auth.authType).toBe(authType);

  expect(deserializedSponsorTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedSponsorTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());

  const deserializedSponsorSpendingCondition = (
    deserializedSponsorTx.auth as SponsoredAuthorization
  ).sponsorSpendingCondition!;
  expect(deserializedSponsorSpendingCondition.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorSpendingCondition.nonce!.toString()).toBe(sponsorNonce.toString());
  expect(deserializedSponsorSpendingCondition.fee!.toString()).toBe('1');

  const deserializedPayload = deserializedSponsorTx.payload as TokenTransferPayloadWire;
  expect(deserializedPayload.amount.toString()).toBe(amount.toString());
});

test('Make sponsored STX token transfer with set tx fee', async () => {
  const recipient = 'ST2HQE346DED7F58Z54EJ26M2B9MQQ3JZ7RW6MXRJ';
  const amount = 113;
  const fee = 0;
  const nonce = 0;
  const senderKey = '8ca861519c4fa4a08de4beaa41688f60a24b575a976cf84099f38dc099a6d74401';
  // const senderAddress = 'ST2HTEQF50SW4X8077F8RSR8WCT57QG166TVG0GCE';
  const client = { baseUrl: HIRO_TESTNET_URL };

  const sponsorKey = '9888d734e6e80a943a6544159e31d6c7e342f695ec867d549c569fa0028892d401';
  // const sponsorAddress = 'ST2TPJ3NEZ63MMJ8AY9S45HZ10QSH51YF93GE89GQ';
  const sponsorNonce = 0;
  const sponsorFee = 500;

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    sponsored: true,
    client,
  });

  const sponsorOptions = {
    transaction,
    sponsorPrivateKey: sponsorKey,
    fee: sponsorFee,
    sponsorNonce,
  };

  const sponsorSignedTx = await sponsorTransaction(sponsorOptions);

  const sponsorSignedTxSerialized = sponsorSignedTx.serializeBytes();

  const bytesReader = new BytesReader(sponsorSignedTxSerialized);
  const deserializedSponsorTx = deserializeTransaction(bytesReader);

  expect(fetchMock.mock.calls.length).toEqual(0);
  expect(deserializedSponsorTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedSponsorTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());

  const deserializedSponsorSpendingCondition = (
    deserializedSponsorTx.auth as SponsoredAuthorization
  ).sponsorSpendingCondition!;
  expect(deserializedSponsorSpendingCondition.nonce!.toString()).toBe(sponsorNonce.toString());
  expect(deserializedSponsorSpendingCondition.fee!.toString()).toBe(sponsorFee.toString());

  const deserializedPayload = deserializedSponsorTx.payload as TokenTransferPayloadWire;
  expect(deserializedPayload.amount.toString()).toBe(amount.toString());
});

test('Make sponsored contract deploy with sponsor fee estimate', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const senderKey = '8ca861519c4fa4a08de4beaa41688f60a24b575a976cf84099f38dc099a6d74401';
  const fee = 0;
  const nonce = 0;
  const client = { baseUrl: HIRO_TESTNET_URL };

  const sponsorKey = '9888d734e6e80a943a6544159e31d6c7e342f695ec867d549c569fa0028892d401';
  // const sponsorAddress = 'ST2TPJ3NEZ63MMJ8AY9S45HZ10QSH51YF93GE89GQ';
  const sponsorNonce = 56;
  const sponsorFee = 4000;

  const authType = AuthType.Sponsored;
  const addressHashMode = AddressHashMode.P2PKH;

  const transaction = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey,
    fee,
    nonce,
    sponsored: true,
    client,
  });

  const sponsorOptions = {
    transaction,
    sponsorPrivateKey: sponsorKey,
    fee: sponsorFee,
    sponsorNonce,
  };

  const sponsorSignedTx = await sponsorTransaction(sponsorOptions);

  expect(fetchMock.mock.calls.length).toEqual(0);

  const sponsorSignedTxSerialized = sponsorSignedTx.serializeBytes();

  const bytesReader = new BytesReader(sponsorSignedTxSerialized);
  const deserializedSponsorTx = deserializeTransaction(bytesReader);

  expect(deserializedSponsorTx.auth.authType).toBe(authType);

  expect(deserializedSponsorTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedSponsorTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());

  const deserializedSponsorSpendingCondition = (
    deserializedSponsorTx.auth as SponsoredAuthorization
  ).sponsorSpendingCondition!;
  expect(deserializedSponsorSpendingCondition.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorSpendingCondition.nonce!.toString()).toBe(sponsorNonce.toString());
  expect(deserializedSponsorSpendingCondition.fee!.toString()).toBe(sponsorFee.toString());
});

test('Make sponsored contract call with sponsor nonce fetch', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const nonce = 0;
  const fee = 0;
  const sponsorFee = 1000;

  const sponsorKey = '9888d734e6e80a943a6544159e31d6c7e342f695ec867d549c569fa0028892d401';
  const sponsorAddress = 'ST2TPJ3NEZ63MMJ8AY9S45HZ10QSH51YF93GE89GQ';
  const sponsorNonce = 55;

  const authType = AuthType.Sponsored;
  const addressHashMode = AddressHashMode.P2PKH;

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    senderKey,
    fee,
    nonce,
    sponsored: true,
    network: 'testnet',
  });

  const sponsorOptions = {
    transaction,
    sponsorPrivateKey: sponsorKey,
    fee: sponsorFee,
  };

  fetchMock.mockRejectOnce();
  fetchMock.mockOnce(`{"balance":"100000", "nonce":${sponsorNonce}}`);

  const sponsorSignedTx = await sponsorTransaction(sponsorOptions);

  expect(fetchMock.mock.calls.length).toEqual(2);
  expect(fetchMock.mock.calls[1][0]).toEqual(
    `${HIRO_TESTNET_URL}${ACCOUNT_PATH}/${sponsorAddress}?proof=0`
  );

  const sponsorSignedTxSerialized = sponsorSignedTx.serializeBytes();

  const bytesReader = new BytesReader(sponsorSignedTxSerialized);
  const deserializedSponsorTx = deserializeTransaction(bytesReader);

  expect(deserializedSponsorTx.auth.authType).toBe(authType);

  expect(deserializedSponsorTx.auth.spendingCondition!.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorTx.auth.spendingCondition!.nonce!.toString()).toBe(nonce.toString());
  expect(deserializedSponsorTx.auth.spendingCondition!.fee!.toString()).toBe(fee.toString());

  const deserializedSponsorSpendingCondition = (
    deserializedSponsorTx.auth as SponsoredAuthorization
  ).sponsorSpendingCondition!;
  expect(deserializedSponsorSpendingCondition.hashMode).toBe(addressHashMode);
  expect(deserializedSponsorSpendingCondition.nonce!.toString()).toBe(sponsorNonce.toString());
  expect(deserializedSponsorSpendingCondition.fee!.toString()).toBe(sponsorFee.toString());
});

test('Transaction broadcast success', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const client = { baseUrl: HIRO_MAINNET_URL };

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo,
  });

  const txid = transaction.txid();
  fetchMock.mockOnce(`"${txid}"`);

  const response: TxBroadcastResult = await broadcastTransaction({ transaction, client });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(`${client.baseUrl}${BROADCAST_PATH}`);
  expect(fetchMock.mock.calls[0][1]?.body).toEqual(
    JSON.stringify({ tx: bytesToHex(transaction.serializeBytes()) })
  );
  expect(response as TxBroadcastResultOk).toEqual({ txid });
});

test('Transaction broadcast success with string network name', async () => {
  const transaction = await makeSTXTokenTransfer({
    recipient: standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'),
    amount: 12345,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
    network: 'mainnet',
    fee: 0,
    nonce: 0,
    memo: 'test memo',
  });

  const txid = transaction.txid();
  fetchMock.mockOnce(`"${txid}"`);

  const response: TxBroadcastResult = await broadcastTransaction({ transaction });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(`${HIRO_MAINNET_URL}${BROADCAST_PATH}`);
  expect(fetchMock.mock.calls[0][1]?.body).toEqual(JSON.stringify({ tx: transaction.serialize() }));
  expect(response as TxBroadcastResultOk).toEqual({ txid });
});

test('Transaction broadcast success with network detection', async () => {
  const transaction = await makeSTXTokenTransfer({
    recipient: standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'),
    amount: 12345,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
    network: 'testnet',
    fee: 0,
    nonce: 0,
    memo: 'test memo',
  });

  const txid = transaction.txid();
  fetchMock.mockOnce(`"${txid}"`);

  const response: TxBroadcastResult = await broadcastTransaction({ transaction });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(`${HIRO_TESTNET_URL}${BROADCAST_PATH}`);
  expect(fetchMock.mock.calls[0][1]?.body).toEqual(JSON.stringify({ tx: transaction.serialize() }));
  expect(response as TxBroadcastResultOk).toEqual({ txid });
});

test('Transaction broadcast with attachment', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';
  const attachment = bytesToHex(utf8ToBytes('this is an attachment...'));

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo,
  });

  const txid = transaction.txid();
  fetchMock.mockOnce(`"${txid}"`);

  const response: TxBroadcastResult = await broadcastTransaction({ transaction, attachment });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(`${HIRO_MAINNET_URL}${BROADCAST_PATH}`);
  expect(fetchMock.mock.calls[0][1]?.body).toEqual(
    JSON.stringify({
      tx: transaction.serialize(),
      attachment,
    })
  );
  expect(response as TxBroadcastResultOk).toEqual({ txid });
});

test('Transaction broadcast returns error', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo,
  });

  const rejection = {
    error: 'transaction rejected',
    reason: 'BadNonce',
    reason_data: {
      actual: 3,
      expected: 0,
      is_origin: true,
      principal: 'ST2MVNFYF6H9DCMAV3HVNHTJVVE3CFWT1JYMH1EZB',
    },
    txid: '0x4068179cb9169b969c80518d83890f8b808a70ab998dd227149221be9480a616',
  };

  fetchMock.mockOnce(JSON.stringify(rejection), { status: 400 });

  const result = await broadcastTransaction({ transaction });
  expect((result as TxBroadcastResultRejected).reason).toEqual(TxRejectedReason.BadNonce);
  expect((result as BadNonceRejection).reason_data).toEqual(rejection.reason_data);
});

test('Transaction broadcast fails', async () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 12345;
  const fee = 0;
  const nonce = 0;
  const senderKey = 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01';
  const memo = 'test memo';

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey,
    fee,
    nonce,
    memo,
  });

  fetchMock.mockOnce('test', { status: 400 });

  await expect(broadcastTransaction({ transaction })).rejects.toThrow();
});

test('Make contract-call with serialized hex post conditions', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const fee = 0;

  // These are serialized post conditions
  const stxPostConditionHex = '00021a5dd8ff3545259925b982524807686567eec2933f03000000000000000a'; // STX post condition for ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH, gte, 10
  const ftPostConditionHex =
    '01021a5dd8ff3545259925b982524807686567eec2933f1ac989ba53bbb27a76ef5e8499e65f69c7798fd5d113746573742d61737365742d636f6e74726163740f746573742d61737365742d6e616d650400000000000003e8'; // FT post condition

  const postConditions = [stxPostConditionHex, ftPostConditionHex];

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    senderKey,
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
    postConditions,
    postConditionMode: 'deny',
  });

  expect(() => transaction.verifyOrigin()).not.toThrow();

  // Re-serialize and check if the serialized post conditions were correctly handled
  const serializedTx = transaction.serialize();
  const bytesReader = new BytesReader(hexToBytes(serializedTx));
  const deserializedTx = deserializeTransaction(bytesReader);

  // Should have 2 post conditions
  expect(deserializedTx.postConditions.values.length).toBe(2);

  const firstPC = deserializedTx.postConditions.values[0];
  expect(firstPC.conditionType).toBe(PostConditionType.STX);
  expect((firstPC as STXPostConditionWire).amount.toString()).toBe('10');

  const secondPC = deserializedTx.postConditions.values[1];
  expect(secondPC.conditionType).toBe(PostConditionType.Fungible);
  expect((secondPC as FungiblePostConditionWire).amount.toString()).toBe('1000');
});

test('Make contract deploy with mixed post conditions (objects and serialized hex)', async () => {
  const contractName = 'kv-store';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const fee = 0;
  const nonce = 0;

  // Object post condition
  const stxPostCondition: StxPostCondition = {
    type: 'stx-postcondition',
    address: 'ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH',
    condition: 'eq',
    amount: 5000,
  };

  // Serialized hex post condition
  const serializedPostConditionHex =
    '00021a5dd8ff3545259925b982524807686567eec2933f03000000000000000a'; // STX post condition for the same address, gte, 10

  const transaction = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
    postConditions: [stxPostCondition, serializedPostConditionHex],
    postConditionMode: 'deny',
  });

  expect(() => transaction.verifyOrigin()).not.toThrow();

  // Re-serialize and check if both post conditions were correctly handled
  const serializedTx = transaction.serialize();
  const bytesReader = new BytesReader(hexToBytes(serializedTx));
  const deserializedTx = deserializeTransaction(bytesReader);

  // Should have 2 post conditions
  expect(deserializedTx.postConditions.values.length).toBe(2);

  const firstPC = deserializedTx.postConditions.values[0];
  expect(firstPC.conditionType).toBe(PostConditionType.STX);
  expect((firstPC as STXPostConditionWire).amount).toBe(5000n);

  const secondPC = deserializedTx.postConditions.values[1];
  expect(secondPC.conditionType).toBe(PostConditionType.STX);
  expect((secondPC as STXPostConditionWire).amount).toBe(10n);
});

test('Make contract transactions with multiple post condition formats', async () => {
  // Common test variables
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';
  const fee = 0;
  const nonce = 0;

  // Test data - Post Conditions in different formats

  // 1. Normal post condition objects
  const stxPostCondition: StxPostCondition = {
    type: 'stx-postcondition',
    address: 'ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH',
    condition: 'eq',
    amount: 5000,
  };

  const ftPostCondition: FungiblePostCondition = {
    type: 'ft-postcondition',
    address: 'ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH',
    condition: 'gte',
    asset: 'ST34RKEJKQES7MXQFBT29KSJZD73QK3YNT5N56C6X.test-asset-contract::test-asset-name',
    amount: 1000,
  };

  // 2. Wire format post conditions
  const stxPostConditionWire: STXPostConditionWire = {
    type: StacksWireType.PostCondition,
    conditionType: PostConditionType.STX,
    principal: {
      type: StacksWireType.Principal,
      prefix: PostConditionPrincipalId.Standard,
      address: {
        type: StacksWireType.Address,
        version: 22,
        hash160: '5dd8ff3545259925b982524807686567eec2933f',
      },
    },
    conditionCode: FungibleConditionCode.Less,
    amount: 7500n,
  };

  // 3. Hex serialized post conditions
  const hexSerializedStxPostCondition =
    '00021a5dd8ff3545259925b982524807686567eec2933f03000000000000000a'; // STX post condition for ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH, gte, 10

  const hexSerializedFtPostCondition =
    '01021a5dd8ff3545259925b982524807686567eec2933f1ac989ba53bbb27a76ef5e8499e65f69c7798fd5d113746573742d61737365742d636f6e74726163740f746573742d61737365742d6e616d650400000000000003e8'; // FT post condition

  // Create an array with all post condition types
  const allPostConditions = [
    stxPostCondition,
    ftPostCondition,
    stxPostConditionWire,
    hexSerializedStxPostCondition,
    hexSerializedFtPostCondition,
  ];

  // Define expected post condition values after deserialization for easier testing
  const expectedPostConditions = [
    {
      conditionType: PostConditionType.STX,
      amount: 5000n,
      conditionCode: FungibleConditionCode.Equal,
    },
    {
      conditionType: PostConditionType.Fungible,
      amount: 1000n,
      conditionCode: FungibleConditionCode.GreaterEqual,
    },
    {
      conditionType: PostConditionType.STX,
      amount: 7500n,
      conditionCode: FungibleConditionCode.Less,
    },
    {
      conditionType: PostConditionType.STX,
      amount: 10n,
      conditionCode: FungibleConditionCode.GreaterEqual,
    },
    {
      conditionType: PostConditionType.Fungible,
      amount: 1000n,
      conditionCode: FungibleConditionCode.Less,
    },
  ];

  // Test Contract Deploy with all post condition types
  const contractName = 'test-contract';
  const codeBody = fs.readFileSync('./tests/contracts/kv-store.clar').toString();

  const deployTx = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
    postConditions: allPostConditions,
    postConditionMode: 'deny',
  });

  // Verify transaction and post conditions
  expect(() => deployTx.verifyOrigin()).not.toThrow();

  // Re-serialize and check if post conditions were correctly handled
  let serializedTx = deployTx.serialize();
  let deserializedTx = deserializeTransaction(serializedTx);

  // Should have all 5 post conditions
  expect(deserializedTx.postConditions.values.length).toBe(5);

  // Verify all post conditions from deserialized transaction match expected values
  const deployPCs = deserializedTx.postConditions.values;

  // Validate all post conditions at once with a loop
  expectedPostConditions.forEach((expected, index) => {
    const actual = deployPCs[index];
    expect(actual.conditionType).toBe(expected.conditionType);

    if (actual.conditionType === PostConditionType.STX) {
      expect((actual as STXPostConditionWire).amount).toBe(expected.amount);
      expect((actual as STXPostConditionWire).conditionCode).toBe(expected.conditionCode);
    } else if (actual.conditionType === PostConditionType.Fungible) {
      expect((actual as FungiblePostConditionWire).amount).toBe(expected.amount);
      expect((actual as FungiblePostConditionWire).conditionCode).toBe(expected.conditionCode);
    }
  });

  // Test Contract Call with same post conditions
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractCallName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('test-key'));

  const callTx = await makeContractCall({
    contractAddress,
    contractName: contractCallName,
    functionName,
    functionArgs: [buffer],
    senderKey,
    fee,
    nonce,
    network: STACKS_TESTNET,
    postConditions: allPostConditions,
    postConditionMode: 'deny',
  });

  // Verify transaction and post conditions
  expect(() => callTx.verifyOrigin()).not.toThrow();

  // Re-serialize and check if post conditions were correctly handled
  serializedTx = callTx.serialize();
  deserializedTx = deserializeTransaction(serializedTx);

  // Should have all 5 post conditions
  expect(deserializedTx.postConditions.values.length).toBe(5);

  // Verify all post conditions from deserialized transaction match expected values
  const callPCs = deserializedTx.postConditions.values;

  // Validate all post conditions at once with a loop (same expected values)
  expectedPostConditions.forEach((expected, index) => {
    const actual = callPCs[index];
    expect(actual.conditionType).toBe(expected.conditionType);

    if (actual.conditionType === PostConditionType.STX) {
      expect((actual as STXPostConditionWire).amount).toBe(expected.amount);
      expect((actual as STXPostConditionWire).conditionCode).toBe(expected.conditionCode);
    } else if (actual.conditionType === PostConditionType.Fungible) {
      expect((actual as FungiblePostConditionWire).amount).toBe(expected.amount);
      expect((actual as FungiblePostConditionWire).conditionCode).toBe(expected.conditionCode);
    }
  });

  // Test conversion back to JSON format using Pc.fromHex
  const expectedPcFromHex = {
    type: 'stx-postcondition',
    address: 'ST1EXHZSN8MJSJ9DSG994G1V8CNKYXGMK7Z4SA6DH',
    condition: 'gte',
    amount: '10',
  };

  // Check that Pc.fromHex correctly converts the serialized hex post condition
  const pcFromHex = Pc.fromHex(hexSerializedStxPostCondition) as StxPostCondition;
  expect({
    type: pcFromHex.type,
    address: pcFromHex.address,
    condition: pcFromHex.condition,
    amount: pcFromHex.amount,
  }).toEqual(expectedPcFromHex);
});

test('Make contract-call with network ABI validation', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';

  const fee = 0;

  const abi = fs.readFileSync('./tests/abi/kv-store-abi.json').toString();
  fetchMock.mockOnce(abi);

  await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    senderKey,
    functionArgs: [buffer],
    fee,
    nonce: 1,
    network: STACKS_TESTNET,
    validateWithAbi: true,
    postConditionMode: 'allow',
  });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(
    `${HIRO_TESTNET_URL}${CONTRACT_ABI_PATH}/${contractAddress}/${contractName}`
  );
});

test('Make contract-call with provided ABI validation', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';

  const fee = 0;

  const abi: ClarityAbi = JSON.parse(fs.readFileSync('./tests/abi/kv-store-abi.json').toString());

  await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    senderKey,
    functionArgs: [buffer],
    fee,
    nonce: 1,
    validateWithAbi: abi,
    postConditionMode: PostConditionMode.Allow,
  });
});

test('Make contract-call with network ABI validation failure', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value';
  const buffer = bufferCV(utf8ToBytes('foo'));
  const senderKey = 'e494f188c2d35887531ba474c433b1e41fadd8eb824aca983447fd4bb8b277a801';

  const fee = 0;

  fetchMock.mockOnce('failed', { status: 404 });

  let error;
  try {
    await makeContractCall({
      contractAddress,
      contractName,
      functionName,
      senderKey,
      functionArgs: [buffer],
      fee,
      nonce: 1,
      network: 'testnet',
      validateWithAbi: true,
      postConditionMode: PostConditionMode.Allow,
    });
  } catch (e) {
    error = e;
  }

  const abiUrl = `${HIRO_TESTNET_URL}${CONTRACT_ABI_PATH}/${contractAddress}/${contractName}`;
  expect(error).toEqual(
    new Error(
      `Error fetching contract ABI for contract "kv-store" at address ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE. Response 404: Not Found. Attempted to fetch ${abiUrl} and failed with the message: "failed"`
    )
  );
});

test('Call read-only function', async () => {
  const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
  const contractName = 'kv-store';
  const functionName = 'get-value?';
  const buffer = bufferCVFromString('foo');
  const client = { baseUrl: HIRO_TESTNET_URL };
  const senderAddress = 'ST2F4BK4GZH6YFBNHYDDGN4T1RKBA7DA1BJZPJEJJ';
  const mockResult = bufferCVFromString('test');

  const options = {
    contractAddress,
    contractName,
    functionName,
    functionArgs: [buffer],
    senderAddress,
    client,
  };

  const apiUrl = `${client.baseUrl}${READONLY_FUNCTION_CALL_PATH}/${contractAddress}/kv-store/get-value%3F`; // uri encoded
  fetchMock.mockOnce(`{"okay": true, "result": "0x${serializeCV(mockResult)}"}`);

  const result = await fetchCallReadOnlyFunction(options);

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(fetchMock.mock.calls[0][0]).toEqual(apiUrl);
  expect(result).toEqual(mockResult);
});

test('Get contract map entry - success', async () => {
  const mockValue = 60n;
  const mockResult = uintCV(mockValue);
  fetchMock.mockOnce(`{"data": "0x${serializeCV(mockResult)}"}`);

  const result = await fetchContractMapEntry<UIntCV>({
    contractAddress: 'SPSCWDV3RKV5ZRN1FQD84YE1NQFEDJ9R1F4DYQ11',
    contractName: 'newyorkcitycoin-core-v2',
    mapName: 'UserIds',
    mapKey: principalCV('SP25V8V2QQ2K8N3JAS15Z14W4YW7ABFDZHK5ZPGW7'),
  });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(result).toEqual(mockResult);
  expect(result.type).toBe(ClarityType.UInt);
  if (result.type === ClarityType.UInt) {
    expect(result.value).toBe(mockValue);
  }
});

test('Get contract map entry - no match', async () => {
  const mockResult = noneCV();
  fetchMock.mockOnce(`{"data": "0x${serializeCVBytes(mockResult)}"}`);

  const result = await fetchContractMapEntry({
    contractAddress: 'SPSCWDV3RKV5ZRN1FQD84YE1NQFEDJ9R1F4DYQ11',
    contractName: 'newyorkcitycoin-core-v2',
    mapName: 'UserIds',
    mapKey: principalCV('SP34EBMKMRR6SXX65GRKJ1FHEXV7AGHJ2D8ASQ5M3'),
  });

  expect(fetchMock.mock.calls.length).toEqual(1);
  expect(result).toEqual(mockResult);
  expect(result.type).toBe(ClarityType.OptionalNone);
});

describe(fetchNonce.name, () => {
  test('without API', async () => {
    const nonce = 123n;
    const address = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

    fetchMock.mockRejectOnce(); // missing API
    fetchMock.mockOnce(`{"balance":"0", "nonce":${nonce}}`);

    await expect(
      fetchNonce({
        address,
        client: {
          baseUrl: HIRO_TESTNET_URL,
        },
      })
    ).resolves.toEqual(nonce);

    expect(fetchMock.mock.calls.length).toEqual(2);
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.testnet.hiro.so/extended/');
    expect(fetchMock.mock.calls[1][0]).toContain('https://api.testnet.hiro.so/v2/');
  });

  test('with API', async () => {
    const nonce = 123n;
    const address = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

    fetchMock.mockOnce(
      `{"last_executed_tx_nonce":${nonce - 2n},"last_mempool_tx_nonce":${
        nonce - 1n
      },"possible_next_nonce":${nonce},"detected_missing_nonces":[],"detected_mempool_nonces":[]}`
    );

    await expect(
      fetchNonce({
        address,
        client: {
          baseUrl: HIRO_TESTNET_URL,
        },
      })
    ).resolves.toEqual(nonce);

    expect(fetchMock.mock.calls.length).toEqual(1);
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.testnet.hiro.so/extended/');
  });
});

test('Post-conditions with amount larger than 8 bytes throw an error', () => {
  const amount = BigInt('0xffffffffffffffff') + 1n;

  const stxPc: StxPostCondition = {
    type: 'stx-postcondition',
    address: 'SP34EBMKMRR6SXX65GRKJ1FHEXV7AGHJ2D8ASQ5M3',
    condition: 'eq',
    amount,
  };

  const fungiblePc: FungiblePostCondition = {
    type: 'ft-postcondition',
    address: 'SP34EBMKMRR6SXX65GRKJ1FHEXV7AGHJ2D8ASQ5M3',
    condition: 'eq',
    amount,
    asset: 'SP34EBMKMRR6SXX65GRKJ1FHEXV7AGHJ2D8ASQ5M3.token::frank',
  };

  expect(() => {
    postConditionToWire(stxPc);
  }).toThrowError(/Post-condition amount must be between 0 and 18446744073709551615/);

  expect(() => {
    postConditionToWire(fungiblePc);
  }).toThrowError(/Post-condition amount must be between 0 and 18446744073709551615/);
});

test('StacksTransaction serialize/deserialize equality with an empty memo', async () => {
  const options = {
    recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
    amount: 12345n,
    fee: 100n,
    nonce: 0n,
    memo: '', // empty memo
    network: STACKS_MAINNET,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
  };
  const tx = await makeSTXTokenTransfer(options);

  const txHex = tx.serialize();
  const txDecoded = deserializeTransaction(txHex);

  expect(txDecoded).toEqual(tx);
});

test('StacksTransaction serialize/deserialize equality with a memo', async () => {
  const options = {
    recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
    amount: 12345n,
    fee: 100n,
    nonce: 0n,
    memo: 'Memento Mori',
    network: STACKS_MAINNET,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
  };
  const tx = await makeSTXTokenTransfer(options);

  const txHex = tx.serialize();
  const txDecoded = deserializeTransaction(txHex);

  expect(txDecoded).toEqual(tx);
});

test('StacksTransaction serialize/deserialize equality with a memo ending in a zero byte', async () => {
  const options = {
    recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
    amount: 12345n,
    fee: 100n,
    nonce: 0n,
    memo: bytesToUtf8(hexToBytes('0')), // null character
    network: STACKS_MAINNET,
    senderKey: 'edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc01',
  };
  const tx = await makeSTXTokenTransfer(options);

  const txHex = tx.serialize();
  const txDecoded = deserializeTransaction(txHex);

  expect(txDecoded).not.toEqual(tx); // we are expecting the zero byte to be stripped (null character)
});

test('StacksTransaction serialize/deserialize equality with an invalid utf-8 byte sequence', () => {
  // custom memo with `c200` included; invalid utf-8 (`c200`; `c2` indicating two bytes, but is followed by a null character)
  const txHex =
    '000000000104006b323aaec89736bc54f751991daeb2e18fe60d2e00000000000000060000000000002710000195deaac518e5e9f910b9214690af80fea0dd13745e392f33392e959208c3e8393e61b355608e4bc23248253c8b6286de63d782bb65dd5f4da5741288095c478c030200000000000516f0f57e9989bca0cf5269db54a4ea809b0291c3fa000000000112a8806d656d6fc20000000000000000000000000000000000000000000000000000000000';
  const txDecoded = deserializeTransaction(txHex);

  if (txDecoded.payload.payloadType !== PayloadType.TokenTransfer) throw Error;

  expect(txDecoded.payload.memo.content).toContain('memo'); //                _m_e_m_o--
  expect(utf8ToBytes(txDecoded.payload.memo.content)).not.toEqual(hexToBytes('6d656d6fc2'));
  expect(utf8ToBytes(txDecoded.payload.memo.content)).not.toEqual(hexToBytes('6d656d6fc200'));

  expect(utf8ToBytes(txDecoded.payload.memo.content)).toEqual(hexToBytes('6d656d6fefbfbd')); // javascript may replace invalid utf-8 with `efbfbd` (�)
});

test('StacksTransaction serialize/deserialize equality with an invalid utf-8 byte sequence', () => {
  // custom memo with `81` at the start; invalid utf-8 (`81` is a continuation byte, but is not preceded)
  const txHex =
    '000000000104006b323aaec89736bc54f751991daeb2e18fe60d2e00000000000000060000000000002710000195deaac518e5e9f910b9214690af80fea0dd13745e392f33392e959208c3e8393e61b355608e4bc23248253c8b6286de63d782bb65dd5f4da5741288095c478c030200000000000516f0f57e9989bca0cf5269db54a4ea809b0291c3fa000000000112a880816d656d6f0000000000000000000000000000000000000000000000000000000000';
  const txDecoded = deserializeTransaction(txHex);

  if (txDecoded.payload.payloadType !== PayloadType.TokenTransfer) throw Error;

  expect(txDecoded.payload.memo.content).toContain('memo');
  expect(utf8ToBytes(txDecoded.payload.memo.content)).toEqual(hexToBytes('efbfbd6d656d6f')); // javascript may replace invalid utf-8 with `efbfbd` (�)
});

test('StacksTransaction serialize/deserialize equality with an invalid utf-8 byte sequence', () => {
  // custom memo with `f0f00000` included; invalid utf-8 (`f0f00000`; `f0` indicating four bytes, but is followed by null characters)
  const txHex =
    '000000000104006b323aaec89736bc54f751991daeb2e18fe60d2e00000000000000060000000000002710000195deaac518e5e9f910b9214690af80fea0dd13745e392f33392e959208c3e8393e61b355608e4bc23248253c8b6286de63d782bb65dd5f4da5741288095c478c030200000000000516f0f57e9989bca0cf5269db54a4ea809b0291c3fa000000000112a8806d656d6ff0f000000000000000000000000000000000000000000000000000000000';
  const txDecoded = deserializeTransaction(txHex);

  if (txDecoded.payload.payloadType !== PayloadType.TokenTransfer) throw Error;

  expect(txDecoded.payload.memo.content).toContain('memo');
  expect(bytesToHex(utf8ToBytes(txDecoded.payload.memo.content))).toContain('efbfbd'); // javascript may replace invalid utf-8 with `efbfbd` (�) twice
});

describe('serialize/deserialize tenure change', () => {
  test.skip('transaction', () => {
    // test vector generated with mockamoto node
    const txBytes =
      '808000000004000f873150e9790e305b701aa8c7b3bcff9e31a5f9000000000000000000000000000000000001d367da530b92f4984f537f0b903c330eb5158262afa08d67cbbdea6c8e2ecae06008248ac147fc34101d3cc207b1b3e386e0f53732b5548bd5abe1570c2271340302000000000755c9861be5cff984a20ce6d99d4aa65941412889bdc665094136429b84f8c2ee00000001000000000000000000000000000000000000000000000000000279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f817980000000000000000000000000000000000000000000000000000000000000000';
    const transaction = deserializeTransaction(txBytes);

    expect(transaction.serialize()).toEqual(txBytes);
  });

  test('deserialize/serialize tenure change transaction', () => {
    // test vector taken from https://github.com/hirosystems/stacks-encoding-native-js/blob/9e2aa260cd88ffa217b338daea4a09c22e3bccdc/tests/tx-decode-3.0.test.ts#L15
    const txBytes =
      '808000000004001dc27eba0247f8cc9575e7d45e50a0bc7e72427d000000000000001d000000000000000000011dc72b6dfd9b36e414a2709e3b01eb5bbdd158f9bc77cd2ca6c3c8b0c803613e2189f6dacf709b34e8182e99d3a1af15812b75e59357d9c255c772695998665f010200000000076f2ff2c4517ab683bf2d588727f09603cc3e9328b9c500e21a939ead57c0560af8a3a132bd7d56566f2ff2c4517ab683bf2d588727f09603cc3e932828dcefb98f6b221eef731cabec7538314441c1e0ff06b44c22085d41aae447c1000000010014ff3cb19986645fd7e71282ad9fea07d540a60e';
    const transaction = deserializeTransaction(txBytes);

    expect(transaction.serialize()).toEqual(txBytes);
  });
});

test.each([
  // test vector generated based on https://github.com/stacks-network/stacks-core/tree/396b34ba414220834de7ff96a890d55458ded51b
  '00000000000400143e543243dfcd8c02a12ad7ea371bd07bc91df900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010200000000081212121212121212121212121212121212121212121212121212121212121212099275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af28718501047bfd87b810c2d2139b73c23bd69de66360953a642c2a330a',
  // test vector taken from https://github.com/hirosystems/stacks-encoding-native-js/blob/bba3528685912e30a86f1e35ed62573e43a2aa88/tests/tx-decode-3.0.test.ts#L53
  '80800000000400b40723ab4d7781cf1b45083aa043ce4563006c6100000000000000010000000000000000000158be820619a4838f74e63099bb113fcf7ee13ef3b2bb56728cd19470f9379f05288d4accc987d8dd85de5101776c2ad000784d118e35deb4f02852540bf6dd5f01020000000008010101010101010101010101010101010101010101010101010101010101010109119054d8cfba5f6aebaac75b0f6671a6917211729fa7bafa35ab0ad68fe243cf4169eb339d8a26ee8e036c8380e3afd63da8aca1f9673d19a59ef00bf13e1ba2e540257d0b471fc591a877a90e04e00b',
  // test vector taken from https://github.com/hirosystems/stacks-encoding-native-js/blob/bba3528685912e30a86f1e35ed62573e43a2aa88/tests/tx-decode-3.0.test.ts#L93
  '80800000000400b40723ab4d7781cf1b45083aa043ce4563006c6100000000000000010000000000000000000158be820619a4838f74e63099bb113fcf7ee13ef3b2bb56728cd19470f9379f05288d4accc987d8dd85de5101776c2ad000784d118e35deb4f02852540bf6dd5f010200000000081212121212121212121212121212121212121212121212121212121212121212099275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af28718501047bfd87b810c2d2139b73c23bd69de66360953a642c2a330a',
  // test vector taken from https://github.com/hirosystems/stacks-encoding-native-js/blob/bba3528685912e30a86f1e35ed62573e43a2aa88/tests/tx-decode-3.0.test.ts#L133
  '80800000000400b40723ab4d7781cf1b45083aa043ce4563006c6100000000000000010000000000000000000158be820619a4838f74e63099bb113fcf7ee13ef3b2bb56728cd19470f9379f05288d4accc987d8dd85de5101776c2ad000784d118e35deb4f02852540bf6dd5f0102000000000812121212121212121212121212121212121212121212121212121212121212120a0601ffffffffffffffffffffffffffffffffffffffff0c666f6f2d636f6e74726163749275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af28718501047bfd87b810c2d2139b73c23bd69de66360953a642c2a330a',
])('deserialize/serialize nakamoto coinbase transaction', txBytes => {
  const transaction = deserializeTransaction(txBytes);

  expect(bytesToHex(transaction.serializeBytes())).toEqual(txBytes);
});

describe('multi-sig', () => {
  test('working legacy (sequential) multi-sig', async () => {
    const pk1 = bytesToHex(randomBytes(32)) + '01';
    const pk2 = bytesToHex(randomBytes(32)) + '01';
    const pk3 = bytesToHex(randomBytes(32)) + '01';

    const publicKeys = [pk1, pk2, pk3].map(privateKeyToPublic);
    const signerKeys = [pk1, pk2];

    const tx = await makeSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12345n,
      fee: 1_000_000n,
      nonce: 0n,
      network: 'testnet',
      numSignatures: 2,
      publicKeys,
      signerKeys,
    });

    expect(() => tx.verifyOrigin()).not.toThrow();
  });

  test('working legacy (sequential) skipped signer multi-sig', async () => {
    const pk1 = bytesToHex(randomBytes(32)) + '01';
    const pk2 = bytesToHex(randomBytes(32)) + '01';
    const pk3 = bytesToHex(randomBytes(32)) + '01';

    const publicKeys = [pk1, pk2, pk3].map(privateKeyToPublic);

    //                  pk1 signer was skipped
    const signerKeys = [pk2, pk3];

    const tx = await makeSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12345n,
      fee: 1_000_000n,
      nonce: 0n,
      network: 'testnet',
      numSignatures: 2,
      publicKeys,
      signerKeys,
    });

    expect(() => tx.verifyOrigin()).not.toThrow();
  });

  test('working (local) signer key sorting for legacy (sequential) multi-sig', async () => {
    const pk1 = bytesToHex(randomBytes(32)) + '01';
    const pk2 = bytesToHex(randomBytes(32)) + '01';
    const pk3 = bytesToHex(randomBytes(32)) + '01';

    const publicKeys = [pk1, pk2, pk3].map(privateKeyToPublic);
    const signerKeys = [pk2, pk1];

    const tx = await makeSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12345n,
      fee: 1_000_000n,
      nonce: 0n,
      network: 'testnet',
      numSignatures: 2,
      publicKeys,
      signerKeys,
    });

    expect(() => tx.verifyOrigin()).not.toThrow();
  });

  describe('working non-sequential multi-sig', () => {
    const pk1 = makeRandomPrivKey();
    const pk2 = makeRandomPrivKey();
    const pk3 = compressPrivateKey(makeRandomPrivKey());
    const pk4 = compressPrivateKey(makeRandomPrivKey());

    const CASES = [
      { signers: [pk1, pk2, pk3], signing: [pk1, pk2], required: 2 },
      { signers: [pk2, pk3, pk1], signing: [pk1, pk2], required: 2 },
      { signers: [pk3, pk2, pk1], signing: [pk1, pk2, pk3], required: 2 },
      { signers: [pk4, pk2, pk3], signing: [pk2, pk4], required: 2 },
      { signers: [pk1, pk2, pk3], signing: [pk3, pk2], required: 2 },
      { signers: [pk1, pk4, pk3], signing: [pk4, pk1, pk3], required: 3 },
      { signers: [pk2, pk1, pk4, pk3], signing: [pk4, pk1, pk3, pk2], required: 3 }, // oversign
    ];

    test.each(CASES)('works in multi-sig make method', async ({ signers, signing, required }) => {
      const publicKeys = signers.map(privateKeyToPublic);
      const signerKeys = signing; // also works out-of-order

      const tx = await makeSTXTokenTransfer({
        recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        amount: 12_345n,
        fee: 1_000n,
        nonce: 2n,
        network: 'testnet',
        numSignatures: required,
        publicKeys,
        signerKeys,
        useNonSequentialMultiSig: true,
      });

      expect(() => tx.verifyOrigin()).not.toThrow();

      const parsed = deserializeTransaction(tx.serialize());
      if (isSingleSig(parsed.auth.spendingCondition)) throw 'type error';

      expect(parsed.auth.spendingCondition.signaturesRequired).toBe(required);

      const signatures = parsed.auth.spendingCondition.fields
        .filter(f => f.contents.type === StacksWireType.MessageSignature)
        .map(s => s.contents.data);
      expect(signatures.length).toBe(signing.length);

      const signingSigs = new Set(
        // deduplicate
        signing.map(sk => nextSignature(tx.signBegin(), tx.auth.authType, 1_000n, 2n, sk).nextSig)
      );
      expect(signingSigs.size).toBe(signatures.length);
      expect(Array.from(signingSigs)).toEqual(expect.arrayContaining(signatures));

      const appendedKeys = parsed.auth.spendingCondition.fields.filter(
        f => f.contents.type === StacksWireType.PublicKey
      );
      expect(appendedKeys.length).toBe(signers.length - signing.length);

      // random byte changes
      for (let i = 0; i < 100; i++) {
        const bytes = Array.from(tx.serializeBytes());
        const randomIdx = Math.floor(Math.random() * bytes.length);
        bytes[randomIdx] ^= 1;
        expect(() => deserializeTransaction(Uint8Array.from(bytes)).verifyOrigin()).toThrow();
      }
    });

    test.each(CASES)('works when signing separately', async ({ signers, signing, required }) => {
      const publicKeys = signers.map(privateKeyToPublic);
      const signerKeys = signing;

      const txInitial = await makeSTXTokenTransfer({
        recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        amount: 12_345n,
        fee: 1_000n,
        nonce: 2n,
        network: 'testnet',
        numSignatures: required,
        publicKeys,
        signerKeys: [], // empty at first (e.g. created by a web interface)
        useNonSequentialMultiSig: true,
      });

      let serialized = transactionToHex(txInitial); // unsigned, so far (but has public key auth fields instead)

      // mimic signing and serializing in between (e.g. shared group of people over the web)
      for (const signerKey of signerKeys) {
        // todo: this whole for loop content should be a helper function in TransactionSigner or StacksTransaction

        const tx = deserializeTransaction(serialized);

        // replace signers public key, with signature
        const { nextSig } = nextSignature(
          tx.signBegin(),
          tx.auth.authType,
          tx.auth.spendingCondition.fee,
          tx.auth.spendingCondition.nonce,
          signerKey
        );

        if (isSingleSig(tx.auth.spendingCondition)) throw 'type error';

        const signerPublicKey = privateKeyToPublic(signerKey);
        const fieldIdx = tx.auth.spendingCondition.fields.findIndex(field => {
          return (
            field.contents.type === StacksWireType.PublicKey &&
            bytesToHex(field.contents.data) === signerPublicKey
          );
        });
        tx.auth.spendingCondition.fields[fieldIdx] = createTransactionAuthField(
          hexToBytes(signerKey).byteLength === PRIVATE_KEY_BYTES_COMPRESSED
            ? PubKeyEncoding.Compressed
            : PubKeyEncoding.Uncompressed,
          createMessageSignature(nextSig)
        );

        serialized = transactionToHex(tx);
      }

      const txFinal = deserializeTransaction(serialized);
      expect(() => txFinal.verifyOrigin()).not.toThrow();
    });

    test('non sequential multi-sig test vector', async () => {
      // test vector generated from manual test in stacks-core
      const EXPECTED =
        '8080000000040535e2fdeee173024af6848ca6e335691b55498fc4000000000000000000000000000000640000000300028bd9dd96b66534e23cbcce4e69447b92bf1d738edb83182005cfb3b402666e42020158146dc95e76926e3add7289821e983e0dd2f2b0bf464c8e94bb082a213a91067ced1381a64bd03afa662992099b04d4c3f538cc6afa3d043ae081e25ebbde6f0300e30e7e744c6eef7c0a4d1a2dad6f0daa3c7655eb6e9fd6c34d1efa87b648d3e55cdd004ca4e8637cddad3316f3fbd6146665fad2e7ca26725ad09f58c4e43aa0000203020000000000051a70f696e2bda63701e044609eb7a7ce5876571905000000000000271000000000000000000000000000000000000000000000000000000000000000000000';

      const pk1 = '04fbae5c79d50dc21c653ed8bf1ad53a43081f839f1ecdda9774d9170e4bb5c501';
      const pk2 = 'f8cefc8e181a06ab004c722cb156e7a24f57d9b08af27f36b15fa1357d572b9301';
      const pk3 = '84e72ac806a425bdef5add21be8771c7498b5e36c235d295d8339a83daf364e3';

      const signers = [pk1, pk2, pk3];
      const publicKeys = signers.map(privateKeyToPublic);

      const signerKeys = [pk3, pk2];

      const recipient = 'ST1RFD5Q2QPK3E0F08HG9XDX7SSC7CNRS0QR0SGEV';
      const amount = 10000;
      const nonce = 0;
      const fee = 100;
      const numSignatures = 2;

      const txMake = await makeSTXTokenTransfer({
        useNonSequentialMultiSig: true,

        recipient,
        amount,
        nonce,
        fee,
        network: 'testnet',

        numSignatures,
        publicKeys,
        signerKeys, // "make" will technically ignore these and sign in the sorted order
      });

      expect(() => txMake.verifyOrigin()).not.toThrow();
      expect(transactionToHex(txMake)).toBe(EXPECTED);

      ///

      const tx = await makeUnsignedSTXTokenTransfer({
        useNonSequentialMultiSig: true,

        recipient,
        amount,
        nonce,
        fee,
        network: 'testnet',

        numSignatures,
        publicKeys,
      });

      const signer = new TransactionSigner(tx);

      // sign in reverse order
      expect(signer.sigHash).toBe(tx.signBegin());
      signer.signOrigin(pk3);
      expect(signer.sigHash).toBe(tx.signBegin());
      signer.signOrigin(pk2);
      expect(signer.sigHash).toBe(tx.signBegin());
      signer.appendOrigin(createStacksPublicKey(privateKeyToPublic(pk1)));
      expect(signer.sigHash).toBe(tx.signBegin());

      if (isSingleSig(tx.auth.spendingCondition)) throw 'type error';

      expect(signer.sigHash).toBe(tx.signBegin()); // sighash doesn't change for non-sequential multisig

      // todo: a `finalize` method would be nice to do this for us
      // we'll manually need to fix the order (for now)
      tx.auth.spendingCondition.fields.reverse();

      expect(() => tx.verifyOrigin()).not.toThrow();
      expect(transactionToHex(tx)).toBe(EXPECTED);
    });
  });

  test('non-sequential multi-sig oversign', async () => {
    // test case needs 3 of 5 signers, but 4 sign (too many)
    // but here the oversign is ok

    const privateKeys = Array.from({ length: 5 }, () => makeRandomPrivKey());
    const signers = new Map(privateKeys.map(pk => [privateKeyToPublic(pk), pk]));
    const publicKeys = Array.from(signers.keys()).sort();

    const tx = await makeUnsignedSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12_345n,
      fee: 1_000_000n,
      nonce: 2n,
      network: 'testnet',

      numSignatures: 3,
      publicKeys,

      useNonSequentialMultiSig: true,
    });

    const missingSigner = publicKeys.pop();

    const signer = new TransactionSigner(tx);

    for (const pub of publicKeys) {
      signer.signOrigin(signers.get(pub)!);
    }

    signer.appendOrigin(missingSigner!);

    expect(() => tx.verifyOrigin()).not.toThrow();
  });

  test('multi-sig optional address param', async () => {
    const pk1 = bytesToHex(randomBytes(32)) + '01';
    const pk2 = bytesToHex(randomBytes(32)) + '01';
    const pk3 = bytesToHex(randomBytes(32)) + '01';

    const publicKeys = [pk1, pk2, pk3].map(privateKeyToPublic).sort().reverse(); // ensure doesn't match sorted

    const address = addressFromPublicKeys(
      0 as any, // only used for hash, so version doesn't matter
      AddressHashMode.P2SHNonSequential,
      2,
      publicKeys.map(createStacksPublicKey)
    );

    const addressSorted = addressFromPublicKeys(
      0 as any, // only used for hash, so version doesn't matter
      AddressHashMode.P2SHNonSequential,
      2,
      publicKeys.slice().sort().map(createStacksPublicKey)
    );

    expect(addressSorted).not.toEqual(address);

    // normal works
    const tx = await makeSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12345n,
      fee: 1_000_000n,
      nonce: 0n,
      network: 'testnet',

      numSignatures: 2,
      publicKeys,
      signerKeys: [pk1, pk2],

      address: addressToString(address),
    });
    expect(() => tx.verifyOrigin()).not.toThrow();

    // sorted works
    const txSorted = await makeSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12345n,
      fee: 1_000_000n,
      nonce: 0n,
      network: 'testnet',

      numSignatures: 2,
      publicKeys,
      signerKeys: [pk1, pk2],

      address: addressToString(addressSorted),
    });
    expect(() => txSorted.verifyOrigin()).not.toThrow();

    const txMismatch = makeSTXTokenTransfer({
      recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      amount: 12345n,
      fee: 1_000_000n,
      nonce: 0n,
      network: 'testnet',

      numSignatures: 2,
      publicKeys: publicKeys.slice().sort(), // already sorted (Stacks.js "cannot" think of anything else to check)
      signerKeys: [pk1, pk2],

      address: addressToString(address), // Stacks.js "cannot" figure out how to get to this sorting
    });
    await expect(txMismatch).rejects.toThrow();
  });
});

import { bytesToHex, utf8ToBytes } from '@stacks/common';
import {
  ClarityVersion,
  CoinbasePayloadToAltRecipient,
  CoinbasePayloadWire,
  ContractCallPayload,
  SmartContractPayloadWire,
  StacksWireType,
  TenureChangeCause,
  TenureChangePayloadWire,
  TokenTransferPayloadWire,
  VersionedSmartContractPayloadWire,
  createCoinbasePayload,
  createContractCallPayload,
  createSmartContractPayload,
  createTenureChangePayload,
  createTokenTransferPayload,
  deserializePayload,
  randomBytes,
  serializePayload,
} from '../../src';
import { contractPrincipalCV, falseCV, standardPrincipalCV, trueCV } from '../../src/clarity';
import { serializeDeserialize } from '../macros';

test('STX token transfer payload serialization and deserialization', () => {
  const recipient = standardPrincipalCV('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159');
  const amount = 2500000;

  const payload = createTokenTransferPayload(recipient, amount, 'memo (not being included)');

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as TokenTransferPayloadWire;
  expect(deserialized.payloadType).toBe(payload.payloadType);
  expect(deserialized.recipient).toEqual(recipient);
  expect(deserialized.amount.toString()).toBe(amount.toString());
});

test('STX token transfer payload (to contract addr)  serialization and deserialization', () => {
  const recipient = contractPrincipalCV(
    'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
    'contract-name'
  );
  const amount = 2500000;

  const payload = createTokenTransferPayload(recipient, amount, 'memo (not being included)');

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as TokenTransferPayloadWire;
  expect(deserialized.payloadType).toBe(payload.payloadType);
  expect(deserialized.recipient).toEqual(recipient);
  expect(deserialized.amount.toString()).toBe(amount.toString());
});

test('STX token transfer payload (with contract principal string) serialization and deserialization', () => {
  const recipient = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159.contract-name';
  const amount = 2500000;

  const payload = createTokenTransferPayload(recipient, amount, 'memo (not being included)');

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as TokenTransferPayloadWire;
  expect(deserialized.payloadType).toBe(payload.payloadType);
  expect(deserialized.recipient.value).toEqual(recipient);
  expect(deserialized.amount.toString()).toBe(amount.toString());
});

test('STX token transfer payload (with address principal string) serialization and deserialization', () => {
  const recipient = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159';
  const amount = 2500000;

  const payload = createTokenTransferPayload(recipient, amount, 'memo (not being included)');

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as TokenTransferPayloadWire;
  expect(deserialized.payloadType).toBe(payload.payloadType);
  expect(deserialized.recipient.value).toEqual(recipient);
  expect(deserialized.amount.toString()).toBe(amount.toString());
});

test('Contract call payload serialization and deserialization', () => {
  const contractAddress = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159';
  const contractName = 'contract_name';
  const functionName = 'function_name';
  const args = [trueCV(), falseCV()];

  const payload = createContractCallPayload(contractAddress, contractName, functionName, args);

  const deserialized = serializeDeserialize(payload, StacksWireType.Payload) as ContractCallPayload;
  expect(deserialized).toEqual(payload);
});

test('Smart contract payload serialization and deserialization', () => {
  const contractName = 'contract_name';
  const codeBody =
    '(define-map store ((key (buff 32))) ((value (buff 32))))' +
    '(define-public (get-value (key (buff 32)))' +
    '   (match (map-get? store ((key key)))' +
    '       entry (ok (get value entry))' +
    '       (err 0)))' +
    '(define-public (set-value (key (buff 32)) (value (buff 32)))' +
    '   (begin' +
    '       (map-set store ((key key)) ((value value)))' +
    "       (ok 'true)))";

  const payload = createSmartContractPayload(contractName, codeBody);

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as SmartContractPayloadWire;
  expect(deserialized.contractName.content).toBe(contractName);
  expect(deserialized.codeBody.content).toBe(codeBody);
});

test('Versioned smart contract payload serialization and deserialization', () => {
  const contractName = 'contract_name';
  const codeBody =
    '(define-map store ((key (buff 32))) ((value (buff 32))))' +
    '(define-public (get-value (key (buff 32)))' +
    '   (match (map-get? store ((key key)))' +
    '       entry (ok (get value entry))' +
    '       (err 0)))' +
    '(define-public (set-value (key (buff 32)) (value (buff 32)))' +
    '   (begin' +
    '       (map-set store ((key key)) ((value value)))' +
    "       (ok 'true)))";

  const payload = createSmartContractPayload(contractName, codeBody, ClarityVersion.Clarity2);

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as VersionedSmartContractPayloadWire;
  expect(deserialized.clarityVersion).toBe(2);
  expect(deserialized.contractName.content).toBe(contractName);
  expect(deserialized.codeBody.content).toBe(codeBody);
});

test('Coinbase payload serialization and deserialization', () => {
  const coinbaseBuffer = utf8ToBytes('coinbase buffer                 ');

  const payload = createCoinbasePayload(coinbaseBuffer);

  const deserialized = serializeDeserialize(payload, StacksWireType.Payload) as CoinbasePayloadWire;
  expect(deserialized.coinbaseBytes).toEqual(coinbaseBuffer);
});

test('Coinbase to standard principal recipient payload serialization and deserialization', () => {
  const coinbaseBuffer = utf8ToBytes('coinbase buffer                 ');
  const standardRecipient = standardPrincipalCV('ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5');

  const payload = createCoinbasePayload(coinbaseBuffer, standardRecipient);

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as CoinbasePayloadToAltRecipient;
  expect(deserialized.coinbaseBytes).toEqual(coinbaseBuffer);
  expect(deserialized.recipient).toEqual(standardRecipient);
});

test('Coinbase to contract principal recipient payload serialization and deserialization', () => {
  const coinbaseBuffer = utf8ToBytes('coinbase buffer                 ');
  const contractRecipient = contractPrincipalCV(
    'ST2X2FYCY01Y7YR2TGC2Y6661NFF3SMH0NGXPWTV5',
    'hello_world'
  );

  const payload = createCoinbasePayload(coinbaseBuffer, contractRecipient);

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as CoinbasePayloadToAltRecipient;
  expect(deserialized.coinbaseBytes).toEqual(coinbaseBuffer);
  expect(deserialized.recipient).toEqual(contractRecipient);
});

test('serialize/deserialize tenure change payload', () => {
  const tenureHash = bytesToHex(randomBytes(20));
  const previousTenureHash = bytesToHex(randomBytes(20));
  const burnViewHash = bytesToHex(randomBytes(20));
  const previousTenureEnd = bytesToHex(randomBytes(32));
  const previousTenureBlocks = 100;
  const cause = TenureChangeCause.Extended;
  const publicKeyHash = bytesToHex(randomBytes(20));

  const payload = createTenureChangePayload(
    tenureHash,
    previousTenureHash,
    burnViewHash,
    previousTenureEnd,
    previousTenureBlocks,
    cause,
    publicKeyHash
  );

  const deserialized = serializeDeserialize(
    payload,
    StacksWireType.Payload
  ) as TenureChangePayloadWire;
  expect(deserialized).toEqual(payload);
});

test.each([
  // test vector taken from https://github.com/stacks-network/stacks-core/blob/396b34ba414220834de7ff96a890d55458ded51b/stackslib/src/chainstate/stacks/transaction.rs#L2003-L2122
  '081212121212121212121212121212121212121212121212121212121212121212099275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af28718501047bfd87b810c2d2139b73c23bd69de66360953a642c2a330a',
  // test vector taken from https://github.com/stacks-network/stacks-core/blob/396b34ba414220834de7ff96a890d55458ded51b/stackslib/src/chainstate/stacks/transaction.rs#L2143-L2301
  '0812121212121212121212121212121212121212121212121212121212121212120a0601ffffffffffffffffffffffffffffffffffffffff0c666f6f2d636f6e74726163749275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af28718501047bfd87b810c2d2139b73c23bd69de66360953a642c2a330a',
])('deserialize/serialize nakamoto coinbase payload', payloadHex => {
  const payload = deserializePayload(payloadHex);

  expect(payload).toBeDefined();
  expect(serializePayload(payload)).toEqual(payloadHex);
});

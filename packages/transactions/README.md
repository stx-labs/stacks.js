# @stacks/transactions [![npm](https://img.shields.io/npm/v/@stacks/transactions?color=red)](https://www.npmjs.com/package/@stacks/transactions)

Construct, decode transactions and work with Clarity smart contracts on the Stacks blockchain.

## Installation

```
npm install @stacks/transactions
```

## Overview

This library supports the creation of the following Stacks transaction types:

1. STX token transfer
2. Smart contract deploy
3. Smart contract function call

## Key Generation

```ts
import { randomPrivateKey, privateKeyToPublic } from '@stacks/transactions';

// Random key generation
const privateKey = randomPrivateKey(); // string (hex-encoded)

// Get public key from private key
const publicKey = privateKeyToPublic(privateKey);
```

## STX Token Transfer Transaction

```ts
import { makeSTXTokenTransfer, broadcastTransaction } from '@stacks/transactions';

const txOptions = {
  recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
  amount: 12345n,
  network: 'testnet', // for mainnet, use 'mainnet'
  memo: 'test memo',

  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01', // private key

  nonce: 0n, // set a nonce manually, or let the builder fetch from a Stacks node
  fee: 200n, // set a tx fee manually, or let the builder estimate the fee
};

const transaction = await makeSTXTokenTransfer(txOptions);

// to see the raw serialized tx
const serializedTx = transaction.serialize(); // string (hex-encoded)

// broadcasting transaction to the specified network
const response = await broadcastTransaction({ transaction, network: 'testnet' });
const txid = response.txid;
```

## Smart Contract Deploy Transaction

```ts
import { makeContractDeploy, broadcastTransaction } from '@stacks/transactions';
import { readFileSync } from 'fs';

const txOptions = {
  contractName: 'contract_name',
  codeBody: readFileSync('/path/to/contract.clar').toString(),
  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01',
  network: 'testnet', // for mainnet, use 'mainnet'
};

const transaction = await makeContractDeploy(txOptions);

const response = await broadcastTransaction({ transaction, network: 'testnet' });
const txid = response.txid;
```

## Smart Contract Function Call

```ts
import { makeContractCall, broadcastTransaction, Cl, Pc } from '@stacks/transactions';

const postCondition01 = Pc.principal('SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE')
  .willSendGte(1000000n)
  .ustx();

const txOptions = {
  contractAddress: 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X',
  contractName: 'contract_name',
  functionName: 'contract_function',
  functionArgs: [Cl.bufferFromUtf8('foo')],

  postConditions: [postCondition01],
  validateWithAbi: true,

  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01', // private key
  network: 'testnet', // for mainnet, use 'mainnet'
};

const transaction = await makeContractCall(txOptions);

const response = await broadcastTransaction({ transaction, network: 'testnet' });
const txid = response.txid;
```

In this example we construct a `contract-call` transaction with a post condition. We have set the `validateWithAbi` option to `true`, so the `makeContractCall` builder will attempt to fetch this contracts ABI from the specified Stacks network, and validate that the provided functionArgs match what is described in the ABI. This should help you avoid constructing invalid contract-call transactions. If you would prefer to provide your own ABI instead of fetching it from the network, the `validateWithABI` option also accepts [ClarityABI](https://github.com/blockstack/stacks-transactions-js/blob/master/src/contract-abi.ts#L231) objects, which can be constructed from ABI files like so:

```ts
import { ClarityAbi } from '@stacks/transactions';
import { readFileSync } from 'fs';

const abi: ClarityAbi = JSON.parse(readFileSync('abi.json').toString());
// For sample abi json see: stacks.js/packages/transactions/tests/abi/test-abi.json
```

## Sponsoring Transactions

To generate a sponsored transaction, first create and sign the transaction as the origin. The `sponsored` property in the options object must be set to true.

```ts
import { bytesToHex } from '@stacks/common';
import { makeContractCall, BufferCV, bufferCVFromString } from '@stacks/transactions';

const txOptions = {
  contractAddress: 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X',
  contractName: 'contract_name',
  functionName: 'contract_function',
  functionArgs: [bufferCVFromString('foo')],
  fee: 0,
  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01',
  validateWithAbi: true,
  sponsored: true,
};

const transaction = await makeContractCall(txOptions);
const serializedTx = bytesToHex(transaction.serialize());
```

The serialized transaction can now be passed to the sponsoring party which will sign the sponsor portion of the transaction and set the fee.

```ts
import {
  sponsorTransaction,
  BytesReader,
  deserializeTransaction,
  broadcastTransaction,
} from '@stacks/transactions';
import { StacksTestnet, StacksMainnet } from '@stacks/network';

const bytesReader = new BytesReader(Buffer.from(serializedTx, 'hex'));
const deserializedTx = deserializeTransaction(bytesReader);
const sponsorKey = '770287b9471081c8acd37d57190c7a70f0da2633311cc120853537362d32e67c01';
const fee = 1000n;

const sponsorOptions = {
  transaction: deserializedTx,
  sponsorPrivateKey: sponsorKey,
  fee,
  sponsorNonce: 0,
};

const sponsoredTx = await sponsorTransaction(sponsorOptions);

// for mainnet, use `StacksMainnet()`
const network = new StacksTestnet();

const broadcastResponse = await broadcastTransaction(sponsoredTx, network);
const txId = broadcastResponse.txid;
```

## Supporting multi-signature transactions

To generate a multi-sig transaction, first create an unsigned transaction.
The `numSignatures` and `publicKeys` properties in the options object must be set:

```ts
import {
  makeUnsignedSTXTokenTransfer,
  createStacksPrivateKey,
  deserializeTransaction,
  pubKeyfromPrivKey,
  publicKeyToString,
  TransactionSigner,
  standardPrincipalCV,
  BytesReader,
} from '@stacks/transactions';

const recipient = standardPrincipalCV('SP3FGQ8...');
const amount = 2500000n;
const fee = 0n;
const memo = 'test memo';

// private keys of the participants in the transaction
const privKeyStrings = ['6d430bb9...', '2a584d89...', 'd5200dee...'];

// create private key objects from string array
const privKeys = privKeyStrings.map(createStacksPrivateKey);

// corresponding public keys
const pubKeys = privKeyStrings.map(pubKeyfromPrivKey);

// create public key string array from objects
const pubKeyStrings = pubKeys.map(publicKeyToString);

const transaction = await makeUnsignedSTXTokenTransfer({
  recipient,
  amount,
  fee,
  memo,
  numSignatures: 2, // number of signature required
  publicKeys: pubKeyStrings, // public key string array with >= numSignatures elements
});

const serializedTx = transaction.serialize();
```

This transaction payload can be passed along to other participants to sign. In addition to
meeting the numSignatures requirement, the public keys of the parties who did not sign the
transaction must be appended to the signature.

```ts
// deserialize and sign transaction
const bytesReader = new BytesReader(serializedTx);
// Partially signed or unsigned multi-sig tx can be deserialized to add the required signatures
const deserializedTx = deserializeTransaction(bytesReader);

const signer = new TransactionSigner(deserializedTx);

// first signature
signer.signOrigin(privKeys[0]);

// second signature
signer.signOrigin(privKeys[1]);

// after meeting the numSignatures requirement, the public
// keys of the participants who did not sign must be appended
signer.appendOrigin(pubKeys[2]);

// the serialized multi-sig tx
const serializedSignedTx = deserializedTx.serialize();
```

## Calling Read-only Contract Functions

Read-only contract functions can be called without generating or broadcasting a transaction. Instead it works via a direct API call to a Stacks node.

```ts
import { bufferCVFromString, callReadOnlyFunction } from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';

const contractAddress = 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE';
const contractName = 'kv-store';
const functionName = 'get-value';
const buffer = bufferCVFromString('foo');
const network = new StacksTestnet();
const senderAddress = 'ST2F4BK4GZH6YFBNHYDDGN4T1RKBA7DA1BJZPJEJJ';

const options = {
  contractAddress,
  contractName,
  functionName,
  functionArgs: [buffer],
  network,
  senderAddress,
};

const result = await callReadOnlyFunction(options);
```

## Constructing Clarity Values

Building transactions that call functions in deployed clarity contracts requires you to construct valid Clarity Values to pass to the function as arguments. The [Clarity type system](https://github.com/stacksgov/sips/blob/master/sip/sip-002-smart-contract-language.md#clarity-type-system) contains the following types:

- `(tuple (key-name-0 key-type-0) (key-name-1 key-type-1) ...)`
  - a typed tuple with named fields.
- `(list max-len entry-type)`
  - a list of maximum length max-len, with entries of type entry-type
- `(response ok-type err-type)`
  - object used by public functions to commit their changes or abort. May be returned or used by other functions as well, however, only public functions have the commit/abort behavior.
- `(optional some-type)`
  - an option type for objects that can either be (some value) or none
- `(buff max-len)`
  - byte buffer or maximum length max-len.
- `principal`
  - object representing a principal (whether a contract principal or standard principal).
- `bool`
  - boolean value ('true or 'false)
- `int`
  - signed 128-bit integer
- `uint`
  - unsigned 128-bit integer

This library contains Typescript types and classes that map to the Clarity types, in order to make it easy to construct well-typed Clarity values in Javascript. These types all extend the abstract class `ClarityValue`.

```ts
import {
  trueCV,
  falseCV,
  noneCV,
  someCV,
  intCV,
  uintCV,
  standardPrincipalCV,
  contractPrincipalCV,
  responseErrorCV,
  responseOkCV,
  listCV,
  tupleCV,
  bufferCV,
} from '@stacks/transactions';
import { utf8ToBytes } from '@stacks/common';

// construct boolean clarity values
const t = trueCV();
const f = falseCV();

// construct optional clarity values
const nothing = noneCV();
const something = someCV(t);

// construct a buffer clarity value from an existing byte array
const bytes = utf8ToBytes('foo'); // Uint8Array(3) [ 102, 111, 111 ]
const bufCV = bufferCV(bytes);

// construct signed and unsigned integer clarity values
const i = intCV(-10);
const u = uintCV(10);

// construct principal clarity values
const address = 'SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B';
const contractName = 'contract-name';
const spCV = standardPrincipalCV(address);
const cpCV = contractPrincipalCV(address, contractName);

// construct response clarity values
const errCV = responseErrorCV(trueCV());
const okCV = responseOkCV(falseCV());

// construct tuple clarity values
const tupCV = tupleCV({
  a: intCV(1),
  b: trueCV(),
  c: falseCV(),
});

// construct list clarity values
const l = listCV([trueCV(), falseCV()]);
```

If you develop in Typescript, the type checker can help prevent you from creating wrongly-typed Clarity values. For example, the following code won't compile since in Clarity lists are homogeneous, meaning they can only contain values of a single type. It is important to include the type variable `BooleanCV` in this example, otherwise the typescript type checker won't know which type the list is of and won't enforce homogeneity.

```ts
const l = listCV<BooleanCV>([trueCV(), intCV(1)]);
```

## Post Conditions

Three types of post conditions can be added to transactions:

1. STX post condition
2. Fungible token post condition
3. Non-Fungible token post condition

For details see: https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md#transaction-post-conditions

### STX post condition

```ts
import {
  FungibleConditionCode,
  makeStandardSTXPostCondition,
  makeContractSTXPostCondition,
} from '@stacks/transactions';

// With a standard principal
const postConditionAddress = 'SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE';
const postConditionCode = FungibleConditionCode.GreaterEqual;
const postConditionAmount = 12345n;

const standardSTXPostCondition = makeStandardSTXPostCondition(
  postConditionAddress,
  postConditionCode,
  postConditionAmount
);

// With a contract principal
const contractAddress = 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X';
const contractName = 'test-contract';

const contractSTXPostCondition = makeContractSTXPostCondition(
  contractAddress,
  contractName,
  postConditionCode,
  postConditionAmount
);
```

### Fungible token post condition

```ts
import {
  FungibleConditionCode,
  createAsset,
  makeStandardFungiblePostCondition,
} from '@stacks/transactions';

// With a standard principal
const postConditionAddress = 'SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE';
const postConditionCode = FungibleConditionCode.GreaterEqual;
const postConditionAmount = 12345n;
const assetAddress = 'SP62M8MEFH32WGSB7XSF9WJZD7TQB48VQB5ANWSJ';
const assetContractName = 'test-asset-contract';
const assetName = 'test-token';
const fungibleAsset = createAsset(assetAddress, assetContractName, assetName);

const standardFungiblePostCondition = makeStandardFungiblePostCondition(
  postConditionAddress,
  postConditionCode,
  postConditionAmount,
  fungibleAsset
);

// With a contract principal
const contractAddress = 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X';
const contractName = 'test-contract';
const assetAddress = 'SP62M8MEFH32WGSB7XSF9WJZD7TQB48VQB5ANWSJ';
const assetContractName = 'test-asset-contract';
const assetName = 'test-token';
const fungibleAsset = createAsset(assetAddress, assetContractName, assetName);

const contractFungiblePostCondition = makeContractFungiblePostCondition(
  contractAddress,
  contractName,
  postConditionCode,
  postConditionAmount,
  fungibleAsset
);
```

### Non-fungible token post condition

> **Warning**
> The Stacks blockchain's post-condition processor can NOT check ownership.
> It checks whether or not a principal **will send** or **will not send** an NFT.
> Post-conditions can NOT verify anything about the recipient of an asset.
> If you want to verify conditions about asset recipients, you will need to use [Clarity](https://docs.stacks.co/docs/write-smart-contracts/).

```ts
import {
  NonFungibleConditionCode,
  createAsset,
  makeStandardNonFungiblePostCondition,
  makeContractNonFungiblePostCondition,
  bufferCVFromString,
} from '@stacks/transactions';

// With a standard principal
const postConditionAddress = 'SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE';
const postConditionCode = NonFungibleConditionCode.DoesNotSend;
const assetAddress = 'SP62M8MEFH32WGSB7XSF9WJZD7TQB48VQB5ANWSJ';
const assetContractName = 'test-asset-contract';
const assetName = 'test-asset';
const assetId = bufferCVFromString('test-token-asset-id');
const nonFungibleAsset = createAsset(assetAddress, assetContractName, assetName);

const standardNonFungiblePostCondition = makeStandardNonFungiblePostCondition(
  postConditionAddress,
  postConditionCode,
  nonFungibleAsset,
  assetId
);

// With a contract principal
const contractAddress = 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X';
const contractName = 'test-contract';

const contractNonFungiblePostCondition = makeContractNonFungiblePostCondition(
  contractAddress,
  contractName,
  postConditionCode,
  nonFungibleAsset,
  assetId
);
```

## Helper functions

### Conversion of Clarity Values to JSON

Clarity Values represent values of Clarity contracts. If a JSON format is required the helper function `cvToJSON` can be used.

```ts
import { cvToJSON, hexToCV } from '@stacks/transactions';

cvToJSON(hexToCV(tx.tx_result.hex));
```

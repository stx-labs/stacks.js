# @stacks/transactions [![npm](https://img.shields.io/npm/v/@stacks/transactions?color=red)](https://www.npmjs.com/package/@stacks/transactions)

Build, sign, and broadcast transactions on the Stacks blockchain. Construct and read Clarity values. Guard transfers with post conditions.

This package works with plain private keys. For app-based flows with a wallet extension, see [`@stacks/connect`](https://github.com/hirosystems/connect). For network configuration (custom nodes, API keys), see [`@stacks/network`](../network).

## Installation

```
npm install @stacks/transactions
```

## Keys and addresses

```typescript
import {
  randomPrivateKey,
  privateKeyToPublic,
  Address,
} from '@stacks/transactions';

const privateKey = randomPrivateKey(); // hex string
const publicKey = privateKeyToPublic(privateKey);

const mainnetAddress = Address.fromPrivateKey(privateKey); // defaults to mainnet
const testnetAddress = Address.fromPrivateKey(privateKey, 'testnet');
```

> **Note:** For seed phrases and multi-account wallets, see [`@stacks/wallet-sdk`](../wallet-sdk).

An address depends on the network. The same key gives a different address on mainnet and testnet.

## Send an STX transfer

```typescript
import {
  makeSTXTokenTransfer,
  broadcastTransaction,
} from '@stacks/transactions';

const transaction = await makeSTXTokenTransfer({
  recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
  amount: 12345n, // amount in micro-STX
  senderKey: privateKey,
  network: 'testnet',
  memo: 'test memo', // optional
});

const result = await broadcastTransaction({ transaction, network: 'testnet' });

if ('error' in result) throw new Error(result.reason); // or handle
console.log(result.txid);
```

> **Note:** `network` accepts the string `'mainnet'`, `'testnet'`, or a network object — see [`@stacks/network`](../network) for custom nodes and API keys.

Things to know:

- `makeSTXTokenTransfer` signs the transaction. Broadcasting is a separate `broadcastTransaction` call.
- If you omit `fee` or `nonce`, the `make*` functions fetch them from the network at build time.
- The broadcast result is a union. Check `'error' in result` before you read `result.txid`.
- STX transfers cannot carry post conditions.

## Call a contract function

```typescript
import {
  makeContractCall,
  broadcastTransaction,
  Cl,
  Pc,
} from '@stacks/transactions';

const transaction = await makeContractCall({
  contractAddress: 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X',
  contractName: 'my-contract',
  functionName: 'my-function',
  functionArgs: [
    // Clarity values — the arguments of the contract function
    Cl.uint(100),
    Cl.standardPrincipal('SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE'),
  ],
  senderKey: privateKey,
  network: 'mainnet',
  postConditions: [
    // the network checks these conditions; on a mismatch the transaction aborts
    Pc.principal('SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE')
      .willSendGte(1_000_000n)
      .ustx(),
  ],
  postConditionMode: 'deny', // the default
});

const result = await broadcastTransaction({ transaction, network: 'mainnet' });
```

`functionArgs` takes Clarity values — see [Clarity values](#clarity-values). `postConditions` guards asset movement — see [Post conditions](#post-conditions).

## Call a read-only function

A read-only call is a pure API read of the chain state. It builds no transaction and costs no fee. The `senderAddress` simulates the `tx-sender`; it needs no key and no funds.

```typescript
import { fetchCallReadOnlyFunction, Cl } from '@stacks/transactions';

const result = await fetchCallReadOnlyFunction({
  contractAddress: 'ST3KC0MTNW34S1ZXD36JYKFD3JJMWA01M55DSJ4JE',
  contractName: 'kv-store',
  functionName: 'get-value',
  functionArgs: [Cl.stringAscii('foo')],
  senderAddress: 'ST2F4BK4GZH6YFBNHYDDGN4T1RKBA7DA1BJZPJEJJ',
  network: 'testnet',
});

// Narrow on the type — after the check, `value` is correctly typed
if (result.type === 'err') throw new Error('Contract returned an error');
console.log(result.value);
```

If the contract function returns `(err ...)`, the call still resolves — it does not throw. Branch on `result.type` to handle contract-level errors.

## Clarity values

Contract functions take and return Clarity values. You can construct them in two equal ways: with the `Cl` namespace, or as plain object literals. Both produce the same values.

```typescript
import { Cl, type ClarityValue } from '@stacks/transactions';

// Cl namespace
const args = [
  Cl.uint(100),
  Cl.standardPrincipal('SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B'),
  Cl.some(Cl.stringUtf8('hello world')),
  Cl.tuple({ id: Cl.uint(1), active: Cl.bool(true) }),
];

// Plain literals (identical result)
const sameArgs: ClarityValue[] = [
  { type: 'uint', value: 100n },
  {
    type: 'address',
    value: 'SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B',
  },
  {
    type: 'some',
    value: { type: 'utf8', value: 'hello world' },
  },
  {
    type: 'tuple',
    value: {
      id: { type: 'uint', value: 1n },
      active: { type: 'true' },
    },
  },
];
```

All Clarity types, in both forms:

| Clarity type       | `Cl.` form                                                                                            | Plain literal                             |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `int`              | `Cl.int(-100)`                                                                                        | `{ type: 'int', value: -100n }`           |
| `uint`             | `Cl.uint(100)`                                                                                        | `{ type: 'uint', value: 100n }`           |
| `bool`             | `Cl.bool(true)`                                                                                       | `{ type: 'true' }` / `{ type: 'false' }`  |
| `buff`             | `Cl.buffer(bytes)`, `Cl.bufferFromHex('a1b2c3')`, `Cl.bufferFromAscii(str)`, `Cl.bufferFromUtf8(str)` | `{ type: 'buffer', value: 'a1b2c3' }`     |
| `string-ascii`     | `Cl.stringAscii('hi')`                                                                                | `{ type: 'ascii', value: 'hi' }`          |
| `string-utf8`      | `Cl.stringUtf8('hi')`                                                                                 | `{ type: 'utf8', value: 'hi' }`           |
| standard principal | `Cl.standardPrincipal('SP…')`                                                                         | `{ type: 'address', value: 'SP…' }`       |
| contract principal | `Cl.contractPrincipal('SP…', 'name')`                                                                 | `{ type: 'contract', value: 'SP….name' }` |
| `none`             | `Cl.none()`                                                                                           | `{ type: 'none' }`                        |
| `some`             | `Cl.some(inner)`                                                                                      | `{ type: 'some', value: inner }`          |
| `ok`               | `Cl.ok(inner)`                                                                                        | `{ type: 'ok', value: inner }`            |
| `err`              | `Cl.error(inner)`                                                                                     | `{ type: 'err', value: inner }`           |
| `list`             | `Cl.list([a, b])`                                                                                     | `{ type: 'list', value: [a, b] }`         |
| `tuple`            | `Cl.tuple({ id: Cl.uint(1) })`                                                                        | `{ type: 'tuple', value: { id: … } }`     |

To read a value, narrow on its `type` and read `.value`, as shown in the read-only example above.

The `Cl` namespace also has:

- `Cl.serialize(value)` / `Cl.deserialize(hex)` — convert a Clarity value to and from wire-format hex, for example a `tx_result.hex` from the API.
- `Cl.stringify(value)` / `Cl.parse(source)` — convert a Clarity value to and from Clarity source text, like `JSON.stringify` and `JSON.parse`.

## Post conditions

Post conditions protect users. The network aborts a transaction when its asset movement does not match the declared conditions.

You can construct them in two equal ways: with the `Pc` builder, or as plain object literals.

```typescript
import { Pc, Cl, type PostCondition } from '@stacks/transactions';

// Pc builder
const ft = Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6')
  .willSendGte(2000n)
  .ft('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.token-contract', 'my-token');

const nft = Pc.principal('STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6')
  .willSendAsset()
  .nft(
    'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.nft-contract',
    'my-nft',
    Cl.uint(1),
  );

// Plain literals (identical result)
const conditions: PostCondition[] = [
  {
    type: 'ft-postcondition',
    address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
    condition: 'gte',
    asset: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.token-contract::my-token',
    amount: 2000n,
  },
  {
    type: 'nft-postcondition',
    address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
    condition: 'sent',
    asset: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.nft-contract::my-nft',
    assetId: Cl.uint(1),
  },
];
```

All five post-condition types, in both forms:

| Type               | `Pc` builder                                                 | Plain literal                                                                                        |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| STX                | `Pc.principal(addr).willSendGte(n).ustx()`                   | `{ type: 'stx-postcondition', address, condition: 'gte', amount: n }`                                |
| Fungible token     | `Pc.principal(addr).willSendEq(n).ft(contractId, tokenName)` | `{ type: 'ft-postcondition', address, condition: 'eq', asset: '<contract-id>::<token>', amount: n }` |
| Non-fungible token | `Pc.principal(addr).willSendAsset().nft(asset, assetId)`     | `{ type: 'nft-postcondition', address, condition: 'sent', asset, assetId }`                          |
| Staking (SIP-044)  | `Pc.principal(addr).willSendGte(n).ustxToLock()`             | `{ type: 'staking-postcondition', address, condition: 'gte', amount: n }`                            |
| PoX (SIP-044)      | `Pc.principal(addr).willPerformPox()`                        | `{ type: 'pox-postcondition', address, condition: 'will-perform' }`                                  |

The comparators per type:

- STX, fungible token, and staking conditions compare an amount: `eq`, `gt`, `gte`, `lt`, `lte` — via `willSendEq`, `willSendGt`, `willSendGte`, `willSendLt`, `willSendLte`. Amounts are in the smallest unit (micro-STX for STX and staking).
- Non-fungible token conditions track one token instance: `sent`, `not-sent`, `maybe-sent` — via `willSendAsset()`, `willNotSendAsset()`, `willMaybeSendAsset()`.
- PoX conditions gate a PoX action and take no amount: `will-perform`, `will-not-perform`, `may-perform` — via `willPerformPox()`, `willNotPerformPox()`, `mayPerformPox()` directly on the principal.

Staking and PoX conditions also accept `'origin'` as the address, which targets the transaction sender. `Pc.origin()` produces it:

```typescript
const staking = Pc.origin().willSendGte(1_000_000n).ustxToLock();
const pox = Pc.origin().willNotPerformPox();
```

### Post-condition mode

The mode controls asset transfers that no condition covers. Declared conditions are ALWAYS checked, in EVERY mode.

- `'deny'` (default) — abort the transaction on any unlisted asset transfer.
- `'allow'` — allow unlisted asset transfers.
- `'originator'` — deny unlisted transfers for the transaction sender, allow them for others (for example contracts).

```typescript
postConditionMode: 'deny',
```

## Deploy a contract

```typescript
import { makeContractDeploy, broadcastTransaction } from '@stacks/transactions';
import { readFileSync } from 'fs';

const transaction = await makeContractDeploy({
  contractName: 'my-contract',
  codeBody: readFileSync('./contracts/my-contract.clar', 'utf8'),
  senderKey: privateKey,
  network: 'testnet',
});

const result = await broadcastTransaction({ transaction, network: 'testnet' });
```

## Sign a message

Sign typed, structured data ([SIP-018](https://github.com/stacksgov/sips/blob/main/sips/sip-018/sip-018-signed-structured-data.md)) — for example an off-chain login challenge.

```typescript
import { Cl, signStructuredData } from '@stacks/transactions';

const domain = Cl.tuple({
  name: Cl.stringAscii('my-app'),
  version: Cl.stringAscii('1.0.0'),
  'chain-id': Cl.uint(1), // 1 = mainnet
});

const message = Cl.tuple({
  action: Cl.stringAscii('login'),
  nonce: Cl.uint(1),
});

const signature = signStructuredData({ message, domain, privateKey });
```

The `domain` tuple must have exactly the fields `name`, `version`, and `chain-id`.

## Advanced

### Sponsored transactions

A sponsor pays the fee for a transaction that another key signs.

```typescript
import {
  makeContractCall,
  sponsorTransaction,
  broadcastTransaction,
  Cl,
} from '@stacks/transactions';

const originTx = await makeContractCall({
  contractAddress: 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X',
  contractName: 'my-contract',
  functionName: 'my-function',
  functionArgs: [Cl.bufferFromUtf8('foo')],
  senderKey: ORIGIN_PRIVATE_KEY,
  sponsored: true, // required for sponsoring
  network: 'mainnet',
});

const sponsoredTx = await sponsorTransaction({
  transaction: originTx,
  sponsorPrivateKey: SPONSOR_PRIVATE_KEY,
  network: 'mainnet',
});

const result = await broadcastTransaction({
  transaction: sponsoredTx,
  network: 'mainnet',
});
```

### Build now, sign later

Build an unsigned transaction with a public key, serialize it, and sign it elsewhere — for example on a hardware device or an air-gapped machine.

```typescript
import {
  makeUnsignedSTXTokenTransfer,
  deserializeTransaction,
  TransactionSigner,
  broadcastTransaction,
} from '@stacks/transactions';

const unsigned = await makeUnsignedSTXTokenTransfer({
  recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
  amount: 12345n,
  publicKey, // the unsigned variants take a public key, not a senderKey
  network: 'testnet',
});

const hex = unsigned.serialize(); // hex string — transport this

const tx = deserializeTransaction(hex);
const signer = new TransactionSigner(tx);
signer.signOrigin(privateKey);

const result = await broadcastTransaction({
  transaction: tx,
  network: 'testnet',
});
```

## Fetch helpers

The `fetch*` functions read from a Stacks node API. They come from this package and take the same `network`/`client` options as everything else.

```typescript
import {
  fetchNonce,
  fetchFeeEstimate,
  fetchAbi,
  fetchContractMapEntry,
  Cl,
} from '@stacks/transactions';

// the next nonce of an address
const nonce = await fetchNonce({ address, network: 'mainnet' });

// the estimated fee for a built transaction
const fee = await fetchFeeEstimate({ transaction, network: 'mainnet' });

// the interface (ABI) of a contract
const abi = await fetchAbi({
  contractAddress: 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X',
  contractName: 'my-contract',
  network: 'mainnet',
});

// one entry of a contract map, without a contract call
const entry = await fetchContractMapEntry({
  contractAddress: 'SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X',
  contractName: 'my-contract',
  mapName: 'my-map',
  mapKey: Cl.uint(1),
  network: 'mainnet',
});
```

The `make*` functions call `fetchNonce` and `fetchFeeEstimate` internally when you omit `nonce` or `fee`. `fetchCallReadOnlyFunction` is documented [above](#call-a-read-only-function).

## Utilities

- `transaction.txid()` — compute the transaction id of a built transaction.
- `transaction.serialize()` / `deserializeTransaction(hex)` — move a transaction over the wire as hex.
- `validateStacksAddress(address)` — check an address string.
- `Address.parse(value)` / `Address.stringify(repr)` — convert between address strings and their parts.

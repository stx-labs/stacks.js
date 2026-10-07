# @stacks/network

Network configuration for Stacks.js.

This package defines which chain and which node the other `@stacks/*` packages talk to. A network is a plain data object. It is not a class. It holds constants (chain id, transaction version, address versions) and a static client instance with the node URL.

The network is a plain object on purpose. You can serialize it, copy it, and override single fields.

## Installation

```
npm install @stacks/network
```

## Usage

### Use a network

In most cases the string name is enough. Every function that accepts a network accepts `'mainnet'`, `'testnet'`, or `'devnet'`.

```typescript
import { makeSTXTokenTransfer } from '@stacks/transactions';

const tx = await makeSTXTokenTransfer({
  // ...
  network: 'testnet',
});
```

The exported constants hold the full network objects. Use them when you want the object itself.

```typescript
import { STACKS_MAINNET, STACKS_TESTNET, STACKS_DEVNET } from '@stacks/network';

const tx = await makeSTXTokenTransfer({
  // ...
  network: STACKS_TESTNET,
});
```

### Customize a network

Use `createNetwork` to set an API key or a custom node URL.

```typescript
import { createNetwork } from '@stacks/network';

// Network name and API key
const network = createNetwork('mainnet', 'my-api-key');

// Options object
const network2 = createNetwork({ network: 'testnet', apiKey: 'my-api-key' });

// Custom node URL
const network3 = createNetwork({
  network: 'mainnet',
  client: { baseUrl: 'https://custom-api.example.com' },
});
```

`createNetwork` copies the base network. It does not mutate `STACKS_MAINNET` or the other constants.

The API key is sent as an `x-api-key` header. By default, the header is only sent to Hiro API hosts.

### The network and client options

Functions in other packages accept the network and the client as separate options. The network selects the chain. The client selects the node URL and the fetch function.

```typescript
import { broadcastTransaction } from '@stacks/transactions';

await broadcastTransaction({
  transaction,
  network: 'mainnet',
  client: { baseUrl: 'https://custom-api.example.com' }, // optional override
});
```

The network's own `client` is used by default. A `client` option overrides it, field by field.

The `client` object has two optional fields:

- `baseUrl` — the node URL.
- `fetch` — a custom [fetch-compatible](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) function.

`fetch` is the only field of a network that is not serializable. It is also the extension point: bake middleware (authentication, retries, logging) into your `fetch` function.

On the exported constants, `client.fetch` is undefined. The consuming function creates a default fetch function when it needs one.

## The network object

A `StacksNetwork` object has this shape:

```typescript
interface StacksNetwork {
  chainId: number;
  transactionVersion: number;
  peerNetworkId: number;
  magicBytes: string;
  bootAddress: string;
  addressVersion: { singleSig: number; multiSig: number };
  client: { baseUrl: string; fetch?: FetchFn };
}
```

The constants `ChainId`, `TransactionVersion`, and `AddressVersion` are exported for code that reads these fields.

```typescript
import { AddressVersion, ChainId, TransactionVersion } from '@stacks/network';

ChainId.Mainnet; // 0x00000001
TransactionVersion.Mainnet; // 0x00
AddressVersion.MainnetSingleSig; // 22
```

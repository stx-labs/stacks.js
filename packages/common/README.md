# @stacks/common

Shared low-level primitives for Stacks.js.

You rarely need this package directly. It provides the helpers and types that the other `@stacks/*` packages use internally — they are exposed here so you can re-use them instead of re-implementing them. This page defines the few exports that you touch directly. For everything else, see the package that uses the type:

- Transactions, Clarity values, post conditions: [`@stacks/transactions`](../transactions)
- Networks, node URLs, API keys: [`@stacks/network`](../network)
- Wallets and accounts: [`@stacks/wallet-sdk`](../wallet-sdk)

## Installation

```
npm install @stacks/common
```

## Usage

### Convert between hex strings and bytes

```typescript
import { bytesToHex, hexToBytes } from '@stacks/common';

const bytes = hexToBytes('0xdeadbeef'); // Uint8Array(4), the 0x prefix is optional
const hex = bytesToHex(bytes); // 'deadbeef'
```

`hexToBytes` throws on input that is not a valid hex string. `bytesToHex` throws on input that is not a `Uint8Array`.

### Add an API key to outgoing requests

Most users do not need this package for API keys. `createNetwork({ apiKey })` from [`@stacks/network`](../network) does this for you — it calls the primitives below internally.

Use the primitives directly when you build a custom fetch function yourself.

```typescript
import { createApiKeyMiddleware, createFetchFn } from '@stacks/common';

const middleware = createApiKeyMiddleware({ apiKey: 'YOUR_API_KEY' });
const fetchFn = createFetchFn(middleware);

// Pass fetchFn as the client fetch function:
// network: 'mainnet', client: { fetch: fetchFn }
```

By default, the middleware sends the key to Hiro API hosts only. Set the `host` option to match a different host.

A middleware is a plain object with an optional `pre` and `post` hook. A minimal custom one:

```typescript
import { createFetchFn, type FetchMiddleware } from '@stacks/common';

const logger: FetchMiddleware = {
  pre: ({ url }) => console.log('->', url),
  post: ({ url, response }) => console.log('<-', url, response.status),
};

const fetchFn = createFetchFn(logger);
```

## Types you see in other packages

- `PrivateKey` and `PublicKey` are `string | Uint8Array`. A key parameter (for example `senderKey`) accepts a hex string or raw bytes.

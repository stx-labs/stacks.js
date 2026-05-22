# @stacks/network

Network and API library for working with Stacks blockchain nodes.

## Installation

```
npm install @stacks/network
```

## Usage

### Using Pre-configured Network Constants

The `@stacks/network` package exports pre-configured network constants for common Stacks networks:

```typescript
import {
  STACKS_MAINNET,
  STACKS_TESTNET,
  STACKS_DEVNET,
  STACKS_MOCKNET,
} from '@stacks/network';

// Use directly as the `network` parameter in stacks.js functions
console.log(STACKS_MAINNET.client.baseUrl); // 'https://api.mainnet.hiro.so'
console.log(STACKS_TESTNET.client.baseUrl); // 'https://api.testnet.hiro.so'
```

You can also use string literals instead of importing the constants:

```typescript
import { makeSTXTokenTransfer } from '@stacks/transactions';

const transaction = await makeSTXTokenTransfer({
  network: 'mainnet', // or 'testnet', 'devnet', 'mocknet'
  recipient: 'SP2BS6HD7TN34V8Z5BNF8Q2AW3K8K2DPV4264CF26',
  amount: 12345n,
  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01',
});
```

### Creating Custom Networks with `createNetwork`

The `createNetwork` function is the recommended way to configure custom network URLs, API keys, and other client options. It creates a new network object based on a pre-configured network with your customizations applied.

#### Basic Usage

```typescript
import { createNetwork, STACKS_MAINNET } from '@stacks/network';

// From a network name string
const network = createNetwork('mainnet');

// From a network constant
const network = createNetwork(STACKS_MAINNET);
```

#### With an API Key

Many Stacks API providers (such as [Hiro](https://www.hiro.so/)) offer API keys for higher rate limits.
The `createNetwork` function can automatically attach API keys to all requests via the `x-api-key` HTTP header.

```typescript
import { createNetwork } from '@stacks/network';

// Shorthand: pass the API key as the second argument
const network = createNetwork('mainnet', 'your-api-key-here');

// Using the options object
const network = createNetwork({
  network: 'mainnet',
  apiKey: 'your-api-key-here',
});
```

> **Important:** When using an API key, always pass the `network` object (not a string name) to functions
> like `broadcastTransaction`. Passing a string network name will create a _new_ network object without
> your API key configuration:
>
> ```typescript
> import { broadcastTransaction, makeSTXTokenTransfer } from '@stacks/transactions';
> import { createNetwork } from '@stacks/network';
>
> const network = createNetwork('mainnet', 'your-api-key-here');
>
> const tx = await makeSTXTokenTransfer({
>   network, // ✅ Uses your API key for fee estimation
>   recipient: 'SP2BS6HD7TN34V8Z5BNF8Q2AW3K8K2DPV4264CF26',
>   amount: 12345n,
>   senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01',
> });
>
> // ✅ Correct: pass the network object to retain the API key
> await broadcastTransaction({ transaction: tx, network });
>
> // ❌ Incorrect: passing a string creates a new network without the API key
> await broadcastTransaction({ transaction: tx, network: 'mainnet' });
> ```

#### With Custom API Key Options

By default, the API key middleware only attaches the key to requests matching Hiro's API domains. You can customize the host matching pattern and the HTTP header name:

```typescript
import { createNetwork } from '@stacks/network';

const network = createNetwork({
  network: 'mainnet',
  apiKey: 'your-api-key-here',
  host: /\.example\.com$/, // Only attach the key to requests matching this pattern
  httpHeader: 'x-custom-api-key', // Use a custom header name (default: 'x-api-key')
});
```

#### With a Custom Base URL

```typescript
import { createNetwork } from '@stacks/network';

const network = createNetwork({
  network: 'testnet',
  client: {
    baseUrl: 'https://my-custom-stacks-node.example.com',
  },
});
```

#### With a Custom Fetch Function

```typescript
import { createNetwork } from '@stacks/network';
import { createFetchFn } from '@stacks/common';

const customFetch = createFetchFn();

const network = createNetwork({
  network: 'mainnet',
  client: {
    baseUrl: 'https://my-custom-stacks-node.example.com',
    fetch: customFetch,
  },
});
```

### Network Usage in Transaction Building

```typescript
import { makeSTXTokenTransfer, broadcastTransaction } from '@stacks/transactions';
import { createNetwork } from '@stacks/network';

// Create a network with an API key
const network = createNetwork('mainnet', 'your-api-key-here');

const transaction = await makeSTXTokenTransfer({
  network,
  recipient: 'SP2BS6HD7TN34V8Z5BNF8Q2AW3K8K2DPV4264CF26',
  amount: 12345n,
  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01',
});

// Broadcast using the same network object to preserve the API key
const response = await broadcastTransaction({ transaction, network });
```

### Use the Built-in API Key Middleware (Advanced)

For more control over how API keys are attached to requests, you can use the lower-level middleware API directly:

```typescript
import { createApiKeyMiddleware, createFetchFn } from '@stacks/common';
import { STACKS_MAINNET } from '@stacks/network';
import { broadcastTransaction, fetchNonce, makeSTXTokenTransfer } from '@stacks/transactions';

// Create a custom fetch function with API key middleware
const apiMiddleware = createApiKeyMiddleware({
  apiKey: 'example_e8e044a3_41d8b0fe_3dd3988ef302',
});
const customFetch = createFetchFn(apiMiddleware);

// Create a network object with the custom fetch function
const network = {
  ...STACKS_MAINNET,
  client: { ...STACKS_MAINNET.client, fetch: customFetch },
};

const txOptions = {
  recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
  amount: 12345n,
  senderKey: 'b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01',
  memo: 'some memo',
  network,
};
const transaction = await makeSTXTokenTransfer(txOptions);

const response = await broadcastTransaction({ transaction, network });

// All stacks.js functions that accept a network object will use the custom fetch function
const nonce = await fetchNonce('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159', { network });
```

### Use Custom Middleware

Middleware can be used to hook into network calls before sending a request or after receiving a response.

```typescript
import { createFetchFn, RequestContext, ResponseContext } from '@stacks/common';
import { STACKS_TESTNET } from '@stacks/network';
import { fetchNonce } from '@stacks/transactions';

const preMiddleware = (ctx: RequestContext) => {
  ctx.init.headers = new Headers();
  ctx.init.headers.set('x-foo', 'bar'); // override headers and set new `x-foo` header
};
const postMiddleware = async (ctx: ResponseContext) => {
  console.log(await ctx.response.json()); // log response body as json
};

const fetchFn = createFetchFn({ pre: preMiddleware, post: postMiddleware });

const network = {
  ...STACKS_TESTNET,
  client: { ...STACKS_TESTNET.client, fetch: fetchFn },
};

// stacks.js functions that accept a network object will use the custom fetch function
const nonce = await fetchNonce('SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159', { network });
```

### Checking Network Type

```typescript
import { STACKS_MAINNET, TransactionVersion } from '@stacks/network';

// Check if a network is mainnet by comparing the transaction version
const isMainnet = STACKS_MAINNET.transactionVersion === TransactionVersion.Mainnet;
```

### `createNetwork` vs String Network Names

| Approach | When to Use |
| --- | --- |
| `'mainnet'` / `'testnet'` string | Simple usage with default Hiro API URLs and no API key |
| `createNetwork('mainnet')` | When you need a mutable network copy or plan to customize later |
| `createNetwork('mainnet', apiKey)` | When you have an API key for higher rate limits |
| `createNetwork({ network, client })` | When you need a custom base URL or fetch function |
| `createNetwork({ network, apiKey, host })` | When you need API key with custom host matching |

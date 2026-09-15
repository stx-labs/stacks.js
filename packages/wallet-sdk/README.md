# @stacks/wallet-sdk

Create a Stacks wallet from a seed phrase and manage its accounts.

This package derives BIP39/BIP32 wallets and accounts. Each account holds a plain hex private key. You pass that key to [`@stacks/transactions`](../transactions) to sign and broadcast. This package does not build, sign, or broadcast transactions itself, and it is not a network client.

## Installation

```
npm install @stacks/wallet-sdk
```

## Usage

### Create a new wallet

```typescript
import { randomSeedPhrase, generateWallet } from '@stacks/wallet-sdk';

const secretKey = randomSeedPhrase(); // 24-word seed phrase

const wallet = await generateWallet({
  secretKey,
  password: 'user-supplied-password',
});

const account = wallet.accounts[0];
```

`generateWallet` derives the first account (`index: 0`). Keep the seed phrase and the private keys in memory only.

### Restore a wallet from a seed phrase

There is no separate restore function. Derivation is deterministic: the same seed phrase always produces the same keys. Run `generateWallet` again with the known seed phrase.

```typescript
import { generateWallet, generateNewAccount } from '@stacks/wallet-sdk';

let wallet = await generateWallet({ secretKey: seedPhrase, password });

// Derive the same additional accounts again
for (let i = 1; i < accountCount; i++) {
  wallet = generateNewAccount(wallet);
}
```

`generateNewAccount` also adds an account to any existing wallet. It does not mutate the input wallet — it returns a new wallet with the next account appended.

### Get an address and send a transaction

An account does not store an address. The address depends on the network, so you derive it on demand with `getStxAddress`.

```typescript
import { getStxAddress } from '@stacks/wallet-sdk';
import {
  makeSTXTokenTransfer,
  broadcastTransaction,
} from '@stacks/transactions';

const account = wallet.accounts[0];

const address = getStxAddress({ account, network: 'testnet' });

const transaction = await makeSTXTokenTransfer({
  recipient: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
  amount: 12345n,
  senderKey: account.stxPrivateKey,
  network: 'testnet',
});

const result = await broadcastTransaction({ transaction, network: 'testnet' });
```

`getStxAddress` defaults to `'mainnet'` when you omit the network. Pass `account.stxPrivateKey` directly as `senderKey`; it is a ready-to-use hex string.

For contract calls, post conditions, and everything past this hand-off, see [`@stacks/transactions`](../transactions).

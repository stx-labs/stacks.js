# DeFi Examples for Stacks.js

Real-world examples for building DeFi applications on Stacks blockchain.

## Examples

### 1. Contract Deployment (`contract-deployment.ts`)
Deploy Clarity smart contracts programmatically.

```bash
npx ts-node contract-deployment.ts
```

### 2. Contract Interaction (`contract-interaction.ts`)
Call read-only and public functions on deployed contracts.

```bash
npx ts-node contract-interaction.ts
```

### 3. Token Operations (`token-operations.ts`)
Work with SIP-010 fungible tokens - balance, transfer, metadata.

```bash
npx ts-node token-operations.ts
```

## Setup

```bash
npm install @stacks/transactions @stacks/network
```

## Configuration

Replace placeholder values:
- `YOUR_PRIVATE_KEY_HERE` - Your Stacks private key (never commit!)
- Contract addresses as needed

## Network Selection

```typescript
// Testnet
import { StacksTestnet } from '@stacks/network';
const network = new StacksTestnet();

// Mainnet
import { StacksMainnet } from '@stacks/network';
const network = new StacksMainnet();
```

## Live Contracts Used in Examples

These examples use real deployed contracts on mainnet:

| Contract | Address |
|----------|---------|
| sentinel-token | SP2PEBKJ2W1ZDDF2QQ6Y4FXKZEDPT9J9R2NKD9WJB.sentinel-token |
| voting | SP2PEBKJ2W1ZDDF2QQ6Y4FXKZEDPT9J9R2NKD9WJB.voting |

## Resources

- [Stacks.js Documentation](https://stacks.js.org)
- [Clarity Language Reference](https://docs.stacks.co/clarity)
- [Stacks Explorer](https://explorer.stacks.co)

## Contributing

These examples are part of the stacks.js repository. Contributions welcome!



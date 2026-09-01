# @stacks/bitcoin-staking [![npm](https://img.shields.io/npm/v/@stacks/bitcoin-staking?color=red)](https://www.npmjs.com/package/@stacks/bitcoin-staking) <!-- omit in toc -->

Library for PoX-5 paired-BTC bond staking.

## Installation <!-- omit in toc -->

```shell
npm install @stacks/bitcoin-staking
```

- [Post conditions](#post-conditions)
  - [Finding the sBTC token contract](#finding-the-sbtc-token-contract)
  - [Which builders move assets](#which-builders-move-assets)
  - [Locking STX](#locking-stx)
  - [Sending sBTC](#sending-sbtc)
  - [When no post condition can be derived](#when-no-post-condition-can-be-derived)

## Post conditions

Builders in this package do not attach post conditions. Transactions default to
`Deny` mode, so any call that moves an asset aborts with
`abort_by_post_condition` unless you either attach the matching post conditions
or set `postConditionMode: 'allow'`.

### Finding the sBTC token contract

pox-5 holds custodied sBTC through a token contract whose principal **is not
fixed across networks**. It is compiled into the contract body per network:
mainnet uses one principal, testnets default to another, and a node operator can
point their node at a different one entirely. Never hardcode it — read it from
`/v2/pox`:

```ts
import { fetchPoxInfo } from '@stacks/bitcoin-staking';

const poxInfo = await fetchPoxInfo({ network });
poxInfo.sbtcContract; // e.g. 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token'
```

`poxInfo.sbtcRegistryContract` is also exposed, but it is only read by the node
when deriving the per-cycle payout recipient — it never moves an asset, so it
plays no part in post conditions.

### Which builders move assets

| Builder | Moves | Post condition |
| --- | --- | --- |
| `buildRegisterForBond` | Locks `amountUstx`; with `kind: 'sbtc'` also sends up to `sbtcSats` | `ustxToLock` + `ft` upper bound |
| `buildStake` | Locks `amountUstx` | `ustxToLock` |
| `buildStakeUpdate` | Locks a further `amountIncrease` | `ustxToLock` |
| `buildUnstakeSbtc` | Contract sends `amountToWithdrawSats` to the staker | `ft` exact |
| `buildUnstake` | Contract returns all custodied sBTC | none derivable |
| `buildClaimRewards` | Contract sends the settled reward total | none derivable |

Every other builder is bookkeeping or admin only and needs no post condition —
including `buildClaimStakerRewardsForSigner`, which settles and zeroes a staker's
entry and returns the amount, leaving the payout to the signer-manager.

### Locking STX

pox-5 never calls `stx-transfer?`; the lock is applied natively by the node, so
the STX side is a SIP-044 staking post condition, not an STX transfer one.

```ts
import { Pc } from '@stacks/transactions';
import { buildStake } from '@stacks/bitcoin-staking';

const tx = await buildStake({
  signerManager,
  amountUstx,
  numCycles,
  startBurnHt,
  publicKey,
  fee,
  nonce,
  network,
  postConditions: [Pc.principal(stakerAddress).willSendEq(amountUstx).ustxToLock()],
});
```

`buildStakeUpdate` is the same with `amountIncrease` in place of `amountUstx`.

### Sending sBTC

`buildUnstakeSbtc` withdraws an amount you name, so the bound is exact. The
sender is the pox-5 contract, not the staker:

```ts
import { Pc } from '@stacks/transactions';
import { buildUnstakeSbtc, fetchPoxInfo } from '@stacks/bitcoin-staking';

const poxInfo = await fetchPoxInfo({ network });

const tx = await buildUnstakeSbtc({
  signerManager,
  amountToWithdrawSats,
  publicKey,
  fee,
  nonce,
  network,
  postConditions: [
    Pc.principal(poxInfo.contractId)
      .willSendEq(amountToWithdrawSats)
      .ft(poxInfo.sbtcContract, 'sbtc-token'),
  ],
});
```

`buildRegisterForBond` with `kind: 'sbtc'` runs in the other direction — the
staker sends sBTC to the contract — and transfers the *difference* between the
sBTC already custodied and the new total, so `sbtcSats` is only an upper bound:

```ts
postConditions: [
  Pc.principal(stakerAddress).willSendEq(amountUstx).ustxToLock(),
  Pc.principal(stakerAddress).willSendLte(sbtcSats).ft(poxInfo.sbtcContract, 'sbtc-token'),
],
```

With `kind: 'btc'` only the STX lock applies — the BTC is already locked on L1
and never touches a Stacks asset.

### When no post condition can be derived

`buildUnstake` and `buildClaimRewards` both send an amount the contract computes
at execution time. Any bound you write is a guess, and a guess that comes in low
turns a working transaction into `abort_by_post_condition`. Use
`postConditionMode: 'allow'` for these:

```ts
const tx = await buildClaimRewards({
  rewardCycle,
  bondIndices,
  publicKey,
  fee,
  nonce,
  network,
  postConditionMode: 'allow',
});
```

If you need a bound, read the amount first — `fetchEarned` for `buildClaimRewards`,
`fetchStakerCustodiedSbtc` for `buildUnstake` — and accept that the value can
change between the read and the broadcast.

# General composable actions

Net-agnostic, single-purpose operations we run by hand while testing on any net
(regtest / privatenet / testnet-pox5). NOT part of the recorded regtest/privatenet
suites — they're the ops we'd expose as CLI commands if we had a CLI. Everything
reads the target net from env (`STACKS_API` / `NETWORK_ID`), so the same action
serves every net.

**Live-only.** Except `generate-wallet` (pure, offline), each action talks to the live
net and is **skipped under replay** (`isMocking`) so a normal offline
`npx jest tests` stays green. Run them live with `RECORD=1` (disables the fetch
mock). They do NOT write committed fixtures — ignore any stray fixture output.

## Base env (testnet-pox5 shown)

```sh
NETWORK=testnet NETWORK_ID=2147483653 STACKS_API=https://api.testnet-pox5.hiro.so \
STACKS_TX_TIMEOUT=300000 BITCOIN_TX_TIMEOUT=300000 POLL_INTERVAL=10000 RETRY_INTERVAL=10000
```
`NETWORK_ID=2147483653` (0x80000005) is testnet-pox5's chain id — confirm on first
broadcast. For privatenet use `NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so`.

## Actions

Each action is single-purpose and prints a single-line `##RESULT## {json}` marker on
stdout — parse it with `grep -o '##RESULT## .*' | sed 's/##RESULT## //' | jq` to feed
the next action. Multi-item flows (e.g. N wallets) are a bash loop, not a JS flag.

| Action | Env | `##RESULT##` | Does |
| --- | --- | --- | --- |
| `generate-wallet` | — | `{mnemonic, stxKey, stxAddr, btcAddr}` | Generate one seed phrase + first account. Offline. |
| `faucet-stx` | `ADDRESS` | `{address, txid, balance}` | STX-faucet `ADDRESS`, wait, report balance. |
| `transfer-stx` | `FROM_KEY` (66-hex), `TO_ADDRESS`, `AMOUNT_USTX` | `{txid, from, to, balance}` | Send STX between accounts. |

## Examples

```sh
# one wallet (offline)
npx jest tests/actions/generate-wallet --collectCoverage=false

# faucet one address / move funds between two (live)
<base-env> ADDRESS=ST... RECORD=1 npx jest tests/actions/faucet-stx --runInBand --collectCoverage=false
<base-env> FROM_KEY=<hex> TO_ADDRESS=ST... AMOUNT_USTX=1000000 RECORD=1 \
  npx jest tests/actions/transfer-stx --runInBand --collectCoverage=false
```

## Composing (fan-out = loop + faucet + transfer)

The old `fan-out-stx` action is just these three composed in bash — generate 5 wallets,
faucet the first, split its balance evenly to the other four:

```sh
run() { npx jest "tests/actions/$1" --collectCoverage=false --silent=false 2>&1 \
        | grep -o '##RESULT## .*' | sed 's/##RESULT## //'; }

# 1. generate 5 wallets (loop the single-shot action)
: > wallets.json
for i in $(seq 5); do run generate-wallet >> wallets.json; done
FUNDER=$(jq -rs '.[0].stxAddr' wallets.json)
FKEY=$(jq -rs '.[0].stxKey' wallets.json)

# 2. faucet the first, read its balance
BAL=$(<base-env> ADDRESS=$FUNDER RECORD=1 run faucet-stx | jq -r '.balance')
SLICE=$(( BAL / 5 - 10000 ))   # 20% per recipient, minus fee

# 3. split to the other four
for TO in $(jq -rs '.[1:][].stxAddr' wallets.json); do
  <base-env> FROM_KEY=$FKEY TO_ADDRESS=$TO AMOUNT_USTX=$SLICE RECORD=1 run transfer-stx
done
```

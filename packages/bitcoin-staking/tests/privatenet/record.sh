#!/usr/bin/env bash
# One-command full privatenet re-record. Serial, dependency-ordered, daily-safe.
#
#   BOND_ADMIN_KEY=... tests/privatenet/record.sh
#
# BOND_ADMIN_KEY is only needed for setup-bond (self-heal still reads it under
# RECORD). FRESH_ACCOUNT_SEED defaults to today so fresh accounts never collide
# with a previous record on a non-wiped chain.
set -euo pipefail
cd "$(dirname "$0")/../.."

NETWORK=testnet NETWORK_ID=256 STACKS_API=https://api.private-1.hiro.so \
POLL_INTERVAL=10000 RETRY_INTERVAL=10000 \
STACKS_TX_TIMEOUT=300000 BITCOIN_TX_TIMEOUT=600000 \
FRESH_ACCOUNT_SEED="privatenet-$(date +%F)" \
# default to the whole suite; explicit path args override it (targeted re-record)
RECORD=1 \
npx jest "${@:-tests/privatenet}" --runInBand --collectCoverage=false \
  --testSequencer="$(pwd)/tests/privatenet/record-sequencer.js"

#!/usr/bin/env bash
# Record (or replay) regtest tests, immune to the caller's cwd and env.
#
#   scripts/record.sh <jest-path-or-pattern> [extra jest args]   # RECORD=1, live
#   REPLAY=1 scripts/record.sh <pattern>                         # offline replay
#   FRESH=1 scripts/record.sh <pattern>                          # reset chain first
#
# - Always runs jest from the package dir (running it from the repo root picks
#   the wrong jest config and fails with "Cannot use import statement…").
# - .env is self-loaded by tests/helpers/utils.ts — no sourcing needed here.
# - FRESH=1 wipes + restarts the regtest env and waits for pox-5 before testing
#   (recording sessions should start from a clean chain; see CONTRACT-COVERAGE.md).
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

PATTERN="${1:?usage: record.sh <jest-path-or-pattern> [jest args]}"
shift || true

if [ "${FRESH:-0}" = "1" ]; then
  REGTEST_DIR="$PKG_DIR/../../../stacks-regtest-env"
  echo "FRESH=1: resetting regtest env at $REGTEST_DIR"
  (cd "$REGTEST_DIR" && docker compose down --volumes --remove-orphans --timeout=1 && docker compose up -d)
  echo "waiting for pox-5 activation…"
  until curl -s --max-time 2 localhost:20443/v2/pox 2>/dev/null | jq -e '.contract_id | endswith(".pox-5")' >/dev/null 2>&1; do
    sleep 5
  done
  echo "pox-5 active"
fi

if [ "${REPLAY:-0}" = "1" ]; then
  exec npx jest "$PATTERN" --collectCoverage=false "$@"
fi
RECORD=1 exec npx jest "$PATTERN" --runInBand --collectCoverage=false "$@"

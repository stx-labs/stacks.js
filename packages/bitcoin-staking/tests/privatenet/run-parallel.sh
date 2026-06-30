#!/usr/bin/env bash
#
# Durable, resumable, PID-tracked PARALLEL runner for the privatenet E2E suite.
#
# ─── Lane → account mapping ──────────────────────────────────────────────────
# Lanes run CONCURRENTLY; tests WITHIN a lane run SERIALLY. No two lanes share a
# broadcasting account, so parallel lanes never collide on nonces.
#
#   Lane A  (account1) : register-signer, signer-grant-lifecycle, signer-set-50k,
#                        claim-staker-rewards-for-signer
#   Lane B  (account2) : combined-stx-stake-extend-unstake
#   Lane C  (account3) : single-stx-stake          (STAKER=account3)
#   Lane D  (account4) : exit-stx-unstake           (STAKER=account4)
#   Lane E  (accounts 5,6,7,8) : every test that touches the L1/BTC keys or the
#                        account5/6/7 staker pools — run serially so they never
#                        race each other:
#                          single-l1-register, single-sbtc-register-abort,
#                          combined-l1-register-reregister, multi-bond-reward-waterfall,
#                          contract-caller, update-bond-registration, negative-matrix,
#                          exit-sbtc-unstake-abort, exit-l1-announce-and-reclaim,
#                          exit-l1-timelock-reclaim, multi-l1-pool, multi-stx-pool
#
# Disjoint account sets across lanes: A={1} B={2} C={3} D={4} E={5,6,7,8}.
#
# ─── Usage ───────────────────────────────────────────────────────────────────
#   bash tests/privatenet/run-parallel.sh           # launch detached, resumable
#   FORCE=1 bash tests/privatenet/run-parallel.sh    # re-run even recorded tests
#   ONLY="single-stx-stake exit-stx-unstake" bash tests/privatenet/run-parallel.sh
#                                                    # restrict to named tests (1 quick lane)
#   bash tests/privatenet/status.sh                  # check progress any time
#
# Resumable: a test whose fixtures-<key>.json already has >0 keys is SKIPPED
# unless FORCE=1. Re-invoking only runs not-yet-recorded tests.
#
# Detached via setsid+nohup so it survives terminal/session close.

set -u

# ─── Locate package root (this script lives in tests/privatenet/) ────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"           # packages/bitcoin-staking
cd "$PKG_DIR"

E2E_DIR="tests/privatenet/e2e"
FIX_DIR="tests/privatenet/fixtures"
RUNS_DIR="$FIX_DIR/runs"
mkdir -p "$RUNS_DIR"

PIDS_FILE="$RUNS_DIR/pids.txt"

# ─── Common env for every test ───────────────────────────────────────────────
export NETWORK=testnet
export NETWORK_ID=256
export STACKS_API=https://api.private-1.hiro.so
export POLL_INTERVAL=10000
export RETRY_INTERVAL=10000
export BITCOIN_TX_TIMEOUT=420000
export STACKS_TX_TIMEOUT=300000
export RECORD=1

# Source .env for BOND_ADMIN_KEY (and any other secrets) if present.
if [ -f "$PKG_DIR/.env" ]; then
  set -a; . "$PKG_DIR/.env"; set +a
fi

# ─── Lane definitions: "lane|ACCOUNT_ENV|test1 test2 ..." ────────────────────
# ACCOUNT_ENV is applied to every test in the lane (empty = test default).
LANES=(
  "A|STAKER=account1 CALLER=account1 SIGNER=account1|register-signer signer-grant-lifecycle signer-set-50k claim-staker-rewards-for-signer"
  "B|STAKER=account2|combined-stx-stake-extend-unstake"
  "C|STAKER=account3|single-stx-stake"
  "D|STAKER=account4|exit-stx-unstake"
  "E||single-l1-register single-sbtc-register-abort combined-l1-register-reregister multi-bond-reward-waterfall contract-caller update-bond-registration negative-matrix exit-sbtc-unstake-abort exit-l1-announce-and-reclaim exit-l1-timelock-reclaim multi-l1-pool multi-stx-pool"
)

# Extract the primary useFixtures key from a test file.
primary_key() {
  grep -oE "useFixtures\('[^']+'\)" "$E2E_DIR/$1.e2e.test.ts" 2>/dev/null \
    | head -1 | sed "s/useFixtures('//;s/')//"
}

# A fixture is "recorded" if its JSON exists and has >0 top-level keys.
fixture_recorded() {
  local key="$1"
  local f="$FIX_DIR/fixtures-$key.json"
  [ -f "$f" ] || return 1
  # >0 keys: file is an object with at least one "key":
  grep -qE '"[^"]+"[[:space:]]*:' "$f"
}

run_lane() {
  local lane="$1" envstr="$2" tests="$3"
  for t in $tests; do
    local key; key="$(primary_key "$t")"
    local log="$RUNS_DIR/$t.log"
    local status="$RUNS_DIR/$t.status"

    # Skip only if the fixture is recorded AND the last run PASSED (status 0).
    # A failed/partial run (e.g. frozen chain) is NOT skipped — it retries — so
    # bad partial fixtures never get locked in across resume invocations.
    if [ "${FORCE:-0}" != "1" ] && [ -n "$key" ] && fixture_recorded "$key" \
       && [ "$(cat "$status" 2>/dev/null)" = "0" ]; then
      echo "[lane $lane] SKIP $t (fixture-$key.json recorded + passed)" >> "$log"
      # leave .status as "0" so subsequent resume invokes keep skipping it
      continue
    fi

    echo "[lane $lane] RUN  $t (key=$key) @ $(date '+%H:%M:%S')" >> "$log"
    # NOTE: deliberately do NOT pass FIXTURES_JSON — useFixtures('<key>') alone
    # routes to fixtures-<key>.json off the default base (avoids doubled-name bug).
    env $envstr npx jest "$E2E_DIR/$t.e2e.test.ts" --runInBand --collectCoverage=false \
      >> "$log" 2>&1
    local rc=$?
    echo "$rc" > "$status"
    echo "[lane $lane] DONE $t rc=$rc @ $(date '+%H:%M:%S')" >> "$log"
  done
}

# ─── Worker mode: this process IS the detached master; spawn lanes ───────────
if [ "${_WORKER:-0}" = "1" ]; then
  echo "master pid $$ started @ $(date '+%Y-%m-%d %H:%M:%S')" >> "$RUNS_DIR/master.log"
  declare -a LANE_PIDS=()
  for entry in "${LANES[@]}"; do
    IFS='|' read -r lane envstr tests <<< "$entry"
    # ONLY filter: keep only requested tests
    if [ -n "${ONLY:-}" ]; then
      filtered=""
      for t in $tests; do for o in $ONLY; do [ "$t" = "$o" ] && filtered="$filtered $t"; done; done
      tests="$filtered"
    fi
    [ -z "${tests// }" ] && continue
    run_lane "$lane" "$envstr" "$tests" &
    lp=$!
    LANE_PIDS+=("$lp")
    echo "$lp lane-$lane" >> "$PIDS_FILE"
    echo "[master] launched lane $lane pid=$lp tests:$tests" >> "$RUNS_DIR/master.log"
  done
  wait
  echo "master pid $$ finished @ $(date '+%Y-%m-%d %H:%M:%S')" >> "$RUNS_DIR/master.log"
  exit 0
fi

# ─── Launcher mode: detach a worker via setsid+nohup ─────────────────────────
: > "$PIDS_FILE"   # reset pid registry for this run
LOG_MASTER="$RUNS_DIR/master.log"
setsid nohup env _WORKER=1 FORCE="${FORCE:-0}" ONLY="${ONLY:-}" \
  bash "$SCRIPT_DIR/run-parallel.sh" >> "$LOG_MASTER" 2>&1 &
MASTER_PID=$!
echo "$MASTER_PID master" >> "$PIDS_FILE"

cat <<EOF
─────────────────────────────────────────────────────────────────────────────
 privatenet E2E parallel run LAUNCHED (detached, survives terminal close)
─────────────────────────────────────────────────────────────────────────────
 master PID : $MASTER_PID   (also in $PIDS_FILE)
 logs       : $RUNS_DIR/<test>.log   master: $LOG_MASTER
 status     : bash tests/privatenet/status.sh
 resume     : re-run this script — recorded fixtures are skipped (FORCE=1 overrides)
 stop all   : kill -- -$MASTER_PID    (kills the whole process group)
─────────────────────────────────────────────────────────────────────────────
EOF

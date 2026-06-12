#!/usr/bin/env bash
#
# Status report for the privatenet E2E parallel runner.
# Per test: lane, state (running/passed/failed/skipped/pending), recorded fixture key-count.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PKG_DIR"

E2E_DIR="tests/privatenet/e2e"
FIX_DIR="tests/privatenet/fixtures"
RUNS_DIR="$FIX_DIR/runs"
PIDS_FILE="$RUNS_DIR/pids.txt"

# Same lane mapping as run-parallel.sh (keep in sync).
declare -A LANE_OF
for t in register-signer signer-grant-lifecycle signer-set-50k claim-staker-rewards-for-signer; do LANE_OF[$t]=A; done
for t in combined-stx-stake-extend-unstake; do LANE_OF[$t]=B; done
for t in single-stx-stake; do LANE_OF[$t]=C; done
for t in exit-stx-unstake; do LANE_OF[$t]=D; done
for t in single-l1-register single-sbtc-register-abort combined-l1-register-reregister multi-bond-reward-waterfall contract-caller update-bond-registration negative-matrix exit-sbtc-unstake-abort exit-l1-announce-and-reclaim exit-l1-timelock-reclaim multi-l1-pool multi-stx-pool; do LANE_OF[$t]=E; done

primary_key() {
  grep -oE "useFixtures\('[^']+'\)" "$E2E_DIR/$1.e2e.test.ts" 2>/dev/null \
    | head -1 | sed "s/useFixtures('//;s/')//"
}

key_count() {
  local f="$1"
  [ -f "$f" ] || { echo 0; return; }
  grep -oE '"[^"]+"[[:space:]]*:' "$f" | wc -l | tr -d ' '
}

# Is the master still alive?
master_pid="$(grep ' master$' "$PIDS_FILE" 2>/dev/null | tail -1 | awk '{print $1}')"
master_state="not-started"
if [ -n "${master_pid:-}" ]; then
  if kill -0 "$master_pid" 2>/dev/null; then master_state="RUNNING (pid $master_pid)"; else master_state="finished (pid $master_pid)"; fi
fi

echo "master: $master_state"
echo "pids.txt:"; [ -f "$PIDS_FILE" ] && sed 's/^/  /' "$PIDS_FILE" || echo "  (none)"
echo
printf "%-38s %-5s %-9s %s\n" "TEST" "LANE" "STATE" "FIXTURE-KEYS"
printf "%-38s %-5s %-9s %s\n" "----" "----" "-----" "------------"

for f in "$E2E_DIR"/*.e2e.test.ts; do
  t="$(basename "$f" .e2e.test.ts)"
  lane="${LANE_OF[$t]:-?}"
  key="$(primary_key "$t")"
  fix="$FIX_DIR/fixtures-$key.json"
  kc="$(key_count "$fix")"
  status_file="$RUNS_DIR/$t.status"
  state="pending"
  if [ -f "$status_file" ]; then
    rc="$(cat "$status_file")"
    case "$rc" in
      skipped) state="skipped" ;;
      0)       state="passed" ;;
      *[0-9]*) state="failed($rc)" ;;
      *)       state="?" ;;
    esac
  fi
  # Running = master alive AND no terminal status yet AND a log exists with a RUN line not followed by DONE.
  if [ "${master_state#RUNNING}" != "$master_state" ] && [ ! -f "$status_file" ] \
     && [ -f "$RUNS_DIR/$t.log" ] && grep -q "RUN  $t" "$RUNS_DIR/$t.log" \
     && ! grep -q "DONE $t" "$RUNS_DIR/$t.log"; then
    state="running"
  fi
  printf "%-38s %-5s %-9s %s\n" "$t" "$lane" "$state" "$kc"
done

#!/usr/bin/env bash
# Durable unattended driver for the privatenet e2e fixture recording.
# - Only runs the suite when the burn chain is actually advancing (avoids
#   wasting faucet calls / partial fixtures while the chain is frozen).
# - Each iteration runs run-parallel.sh in BLOCKING worker mode (skips tests
#   already recorded+passed, retries the rest), so failures retry across the
#   testnet's instability until everything is recorded.
# - Detaches itself (setsid nohup) so it survives the terminal/session.
# - Exits when all e2e tests have a passing (.status==0) recorded fixture, or
#   after MAX_LOOPS.
#
# Launch:  bash tests/privatenet/run-until-done.sh
# Status:  bash tests/privatenet/status.sh   +   tail fixtures/runs/until-done.log
# Stop:    kill -- -<pid printed at launch>   (or: pkill -f run-until-done)
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS_DIR="$SCRIPT_DIR/fixtures/runs"
E2E_DIR="$SCRIPT_DIR/e2e"
API="${STACKS_API:-https://api.private-1.hiro.so}"
MAX_LOOPS="${MAX_LOOPS:-300}"
IDLE_SLEEP="${IDLE_SLEEP:-300}"   # wait between checks when chain frozen
LOOP_SLEEP="${LOOP_SLEEP:-120}"   # wait between suite runs

burn() { curl -s -m 8 "$API/v2/pox" 2>/dev/null | grep -o '"current_burnchain_block_height":[0-9]*' | grep -o '[0-9]*$'; }

# ── Detach self once ────────────────────────────────────────────────────────
if [ "${_DETACHED:-0}" != "1" ]; then
  mkdir -p "$RUNS_DIR"
  setsid nohup env _DETACHED=1 bash "$SCRIPT_DIR/run-until-done.sh" \
    >> "$RUNS_DIR/until-done.log" 2>&1 &
  echo "run-until-done detached, pid $! (process-group). log: $RUNS_DIR/until-done.log"
  exit 0
fi

cd "$PKG_DIR"
echo "=== run-until-done start $(date '+%F %T') pid $$ ==="
total=$(ls "$E2E_DIR"/*.e2e.test.ts 2>/dev/null | wc -l | tr -d ' ')
i=0
while [ "$i" -lt "$MAX_LOOPS" ]; do
  i=$((i+1))
  passed=$(grep -lx 0 "$RUNS_DIR"/*.status 2>/dev/null | wc -l | tr -d ' ')
  echo "--- loop $i  passed=$passed/$total  $(date '+%T') ---"
  if [ "$passed" -ge "$total" ] && [ "$total" -gt 0 ]; then
    echo "ALL RECORDED ($passed/$total). done."; break
  fi
  b1=$(burn); sleep 25; b2=$(burn)
  if [ -n "$b1" ] && [ -n "$b2" ] && [ "$b2" -gt "$b1" ] 2>/dev/null; then
    echo "chain advancing ($b1 -> $b2) — running suite (blocking)"
    _WORKER=1 bash "$SCRIPT_DIR/run-parallel.sh" >> "$RUNS_DIR/master.log" 2>&1 || true
    sleep "$LOOP_SLEEP"
  else
    echo "chain frozen/unreachable (b1=$b1 b2=$b2) — skip run, idle ${IDLE_SLEEP}s"
    sleep "$IDLE_SLEEP"
  fi
done
echo "=== run-until-done end $(date '+%F %T') loops=$i ==="

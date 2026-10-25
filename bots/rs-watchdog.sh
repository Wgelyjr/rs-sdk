#!/bin/bash
# rs-watchdog.sh — keeps the RuneScape fleet alive and busy.
#
# Fleet: 4 legacy scripts (fishing/smith/guard/wgelyjrqwen income),
# 4 essence feeder bots (qweness1-4: mine/bank rune essence, run to altars on
# wgelyjr's chat commands) and qwenflax (Seers' flax -> spinning wheel runs).
# Feeders' script.ts is a shim importing the real feeder; all are fully
# re-entrant (boot re-stows, re-reads state, rejoins the loop), so stall
# restarts are safe.
#
# Every 5 minutes:
#   1. Ensure each lite runner (game client) is running; start if dead.
#   2. Ensure each bot script is running; start if dead (only if its lite
#      runner is alive, so the script can connect).
#   3. Detect stalls: if a script process is alive but its log has had no
#      new output for STALL_MIN minutes, kill and restart it (restarts are
#      safe — scripts re-select phases from current levels).
#   4. Append a one-line status per bot to the watchdog log for review.
#
# Safe to run one instance only; a lock guard is used below.

ROOT=/home/wgelyjr/Projects/rs-sdk
LOG=/tmp/opencode/watchdog.log
BOTS="wgelyjrqwen qwenfish qwensmith qwenguard qweness1 qweness2 qweness3 qweness4 qwenflax qwenrune"
RUNNER_ONLY="qwenrune"   # runner kept alive only; its script is driven elsewhere
INTERVAL=300      # seconds between checks
STALL_MIN=30      # minutes of log silence => stalled

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Lock: bail out if another watchdog is already running.
LOCKFILE=/tmp/opencode/rs-watchdog.lock
if [ -f "$LOCKFILE" ]; then
  oldpid=$(cat "$LOCKFILE" 2>/dev/null)
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    echo "watchdog already running (pid $oldpid); exiting"
    exit 0
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

log "=== watchdog started (pid $$) ==="

mtime_epoch() { stat -c %Y "$1" 2>/dev/null || echo 0; }

while true; do
  now=$(date +%s)

  for b in $BOTS; do
    # --- lite runner (game client) ---
    if ! pgrep -f "lite/runner.ts $b" >/dev/null; then
      log "RESTART lite runner: $b"
      # exec: the subshell must BECOME the bun process (orphaned to init),
      # not wait on it — a waiting subshell lingers as the child's parent
      # for the child's whole life (verified leak 2026-10-21, see
      # learnings/watchdog.md).
      ( cd "$ROOT/server/webclient" && exec nohup bun src/lite/runner.ts "$b" \
          > "/tmp/opencode/$b-lite.log" 2>&1 < /dev/null & )
    fi

    # runner-only bots: no script/stall management here (another agent drives them)
    case " $RUNNER_ONLY " in *" $b "*) continue ;; esac

    # --- bot script ---
    if ! pgrep -f "bots/$b/script.ts" >/dev/null; then
      if pgrep -f "lite/runner.ts $b" >/dev/null; then
        log "RESTART script: $b (was dead)"
        ( cd "$ROOT" && exec nohup bun bots/"$b"/script.ts \
            > "/tmp/opencode/$b-script.log" 2>&1 < /dev/null & )
      else
        log "script $b dead but lite runner also down; will retry next cycle"
      fi
      continue
    fi

    # --- stall detection (alive but silent) ---
    lf="/tmp/opencode/$b-script.log"
    if [ -f "$lf" ]; then
      mt=$(mtime_epoch "$lf")
      silent=$(( (now - mt) / 60 ))
      if [ "$silent" -ge "$STALL_MIN" ]; then
        log "STALL ($silent min silent) -> kill+restart script: $b"
        pkill -f "bots/$b/script.ts" 2>/dev/null
        sleep 2
        ( cd "$ROOT" && exec nohup bun bots/"$b"/script.ts \
            > "/tmp/opencode/$b-script.log" 2>&1 < /dev/null & )
      fi
    fi
  done

  # --- status snapshot for review ---
  log "--- status ---"
  for b in $BOTS; do
    last=$(tail -1 "/tmp/opencode/$b-script.log" 2>/dev/null | cut -c1-120)
    log "$b: ${last:-<no log>}"
  done

  sleep "$INTERVAL"
done

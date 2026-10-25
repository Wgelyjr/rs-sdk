#!/usr/bin/env bash
# watchdog.sh — keep the 5 lite game-client runners alive.
#
# Each bot has a persistent headless lite client (`bun src/lite/runner.ts {bot}`)
# that must stay running for scripts / the MCP to control the bot. If a runner
# dies (crash, server restart, etc.), this restarts it.
#
# A per-bot restart cooldown (90 s) avoids a tight restart loop when the runner
# exits immediately for a reason this can't fix (e.g. a game-revision mismatch
# that needs a `git pull` — see the runner's exit code 3).
#
# Usage:  nohup bash watchdog.sh > /dev/null 2> /tmp/opencode/watchdog.out &
# Log:    /tmp/opencode/watchdog.log        (restart events)
#         /tmp/opencode/runner-{bot}.log    (per-runner stdout/stderr)
set -u
# RETIRED 2026-10-24 by fleet consolidation: bots/rs-watchdog.sh is now the
# single supervisor (it manages every runner this script watched, plus scripts
# and stall restarts). This script double-owned wgelyjrqwen (it phantom-ran a
# runner.ts for a bot whose client is income.ts -> login ping-pong, 316
# re-logins). See learnings/fleet-ops.md "one supervisor". To force-run anyway,
# delete the guard below.
if [ -n "${WATCHDOG_FORCE:-}" ]; then :; else
  echo "watchdog.sh is RETIRED - use bots/rs-watchdog.sh (set WATCHDOG_FORCE=1 to override)" >&2
  exit 1
fi


cd /home/wgelyjr/Projects/rs-sdk/server/webclient || { echo "cannot cd"; exit 1; }
BOTS="qwensmith qwenguard qwenfish qwenrune wgelyjrqwen"
LOG=/tmp/opencode/watchdog.log
COOLDOWN=90

declare -A LAST
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "watchdog started (pid $$), watching: $BOTS"
while true; do
  for bot in $BOTS; do
    if pgrep -f "src/lite/runner\.ts ${bot}\$" > /dev/null 2>&1; then
      continue
    fi
    now=$(date +%s)
    last=${LAST[$bot]:-0}
    if (( now - last < COOLDOWN )); then
      log "runner $bot still down (<${COOLDOWN}s since last restart) — skipping this cycle"
      continue
    fi
    LAST[$bot]=$now
    log "runner $bot DEAD — restarting"
    nohup bun src/lite/runner.ts "$bot" >> "/tmp/opencode/runner-${bot}.log" 2>&1 &
    log "runner $bot restart pid $!"
  done
  sleep 30
done

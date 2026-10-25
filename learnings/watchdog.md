# Watchdog / Process Hygiene

Lessons from `bots/rs-watchdog.sh` (keeps the 4 bots alive: lite runner +
script per bot, stall detection via log mtime, 5-min cycles).

## Subshell leak: the launch subshell must `exec` into the child

**BUG (2026-10-21):** the launch lines were

```bash
( cd "$ROOT" && nohup bun bots/$b/script.ts > log 2>&1 ) &
```

The subshell (cmdline stays `bash bots/rs-watchdog.sh`) waits on its `bun`
child FOREVER — one leaked subshell per restart per bot (8 accumulated over
3 restart rounds).

**FIRST "FIX" (INCOMPLETE — do not use):** moving the `&` inside the
parentheses,

```bash
( cd "$ROOT" && nohup bun bots/$b/script.ts > log 2>&1 & )
```

does NOT fix it. Bash still forks a subshell to run the backgrounded
`cd && nohup bun` AND-list, and that subshell waits on `bun` for bun's whole
life. Proven live: the watchdog running this version restarted the
wgelyjrqwen script at 16:25:31 and immediately produced a fresh leak
(306375, parent of the running script 306376).

**REAL FIX (on-disk + running, verified 2026-10-21 16:57):** `exec` so the
subshell BECOMES the child — no process left to wait:

```bash
( cd "$ROOT" && exec nohup bun bots/$b/script.ts \
    > log 2>&1 < /dev/null & )
```

The subshell execs `nohup`, which execs `bun`: one process, orphaned to init
(PPID 244). Verified with a sleep A/B test (leaky pattern left a `bash -c`
parent; exec pattern left PPID 244) and by the patched watchdog (pid 315932
since 16:57:05) launching with zero leaked subshells.

**SWAP PROCEDURE** (a running bash instance executes its START-TIME code —
editing the file does not affect the running watchdog):

1. `kill <watchdog pid>` — its `trap 'rm -f lockfile' EXIT` releases the lock
   (`/tmp/opencode/rs-watchdog.lock`).
2. Kill the leaked subshells (their `bun` children orphan and survive).
3. Relaunch: `nohup bash bots/rs-watchdog.sh > /tmp/opencode/watchdog-stdout.log 2>&1 &`
4. Verify: `watchdog started (pid N)` in `/tmp/opencode/watchdog.log`,
   lockfile content = N, no RESTART lines in the next cycle (all procs alive).

The watchdog proved out on 4+ server-restart rounds
(15:18, 15:23, 15:28, 16:xx on 2026-10-21): it relaunched all 8 processes
each time and liveness checks held.

## Launching scripts by hand

- **NEVER put a literal `bots/<name>/script.ts` path in the same shell
  command as `pgrep -f`** — the command line itself matches the pattern and
  `xargs kill` kills your own shell ("Killed by SIGTERM"). The bracket trick
  (`pgrep -f 'bots/<name>/scr[i]pt'`) stops pgrep from self-matching, but a
  LITERAL path elsewhere in the same command (e.g. a `bun build
  bots/<name>/script.ts` in the same `&&` chain) still matches. Keep build,
  kill, and launch in SEPARATE commands.
- Kill: `pgrep -f 'bots/<name>/scr[i]pt' | xargs -r kill`
- Launch: `nohup bun bots/<name>/script.ts > /tmp/opencode/<name>-script.log 2>&1 &`
  (the `>` truncate means you read the log fresh after each restart).
- **Lingering wrapper:** a shell-tool launch like `nohup bun ... & sleep N`
  leaves the `bash -c` wrapper alive as the script's PARENT for the whole
  life of the script (its command line contains the literal script path, so
  it also matches the watchdog's `pgrep -f "bots/$b/script.ts"`). It exits
  when the `bun` child exits, and the watchdog's `pkill -f` matches it too,
  so restarts stay clean. Harmless — but if you audit processes, expect one
  `bash -c ... script.ts` wrapper per hand-launched script.

## Liveness / stall semantics

- `STALL_MIN=30`: a script alive but silent for 30 min gets killed +
  restarted (restarts are safe — scripts re-select phases from levels).
- Status lines land in `/tmp/opencode/watchdog.log` every cycle; the last
  line of each bot's script log is the snapshot.
- A successful `send*` is not an ack, and a death mid-`await` can be
  UNLOGGED — the CLI's `Life: N (M respawns observed)` is the ground truth
  for whether the bot actually died.

# Fleet Operations Runbook (for the bot-managing agent)

Read this BEFORE debugging a bot. Match the symptom, apply the fix, verify with
facts — never from the bot's own reports. Written 2026-10-24 after a session
that rediscovered every trap here the hard way.

## 0. Prime directives

1. **Ground truth first.** `timeout 25 bun sdk/cli.ts <bot>` for real
   position/inventory/nearby. A bot's own log fields can be defaults it never
   refreshed (a parked bot reported `th1` for 8 hours; it was actually th94).
2. **Two deaths at one spot = stop.** The route/target is wrong; changing the
   target beats retrying. Do not "power through".
3. **Three layers of bugs in a hand-rolled subsystem = replace it** with the
   proven pattern (runner + SDK script), not layer four.
4. **Never kill and launch in one command** (see §4 — this exact mistake
   happened three times in one session).

## 1. Symptom → cause → fix

| Symptom (log/ps) | Cause | Fix |
|---|---|---|
| Process alive, zero new log lines | onTick returns early every tick: an always-"open" modal being auto-dismissed, or a HOLD/park flag | Add modal guards (`isDialogOpen() && !state.bank.isOpen`); grep the source for `return` before logging |
| `still=NN` climbs then resets forever, position frozen | `walkTo` to the tile the bot already stands on never resolves → `busy=true` stuck | Never walk to own position; add a busy-stuck escape (force-clear after ~40 ticks) |
| Position drifts on one axis only (x moves, z stuck) | Sliding against an unwalkable barrier (city wall, one-way door) | Check learnings/walking.md gate table; reroute to the real opening (Varrock: river bridges; Al Kharid: toll gate needs 10gp — penniless bots cannot enter) |
| `Account already logged in` + climbing re-login count | **Two clients, one account**: two watchdogs, zombie one-shot script that logged DONE but never exited, or runner.ts + income.ts both owning one bot | `ps -eo pid,args \| grep "run bots/"` + `grep "[l]ite/"`; kill the stale one; one supervisor only (bots/rs-watchdog.sh) |
| `openBank fail: no_bank_found` AT a known bank | Standing >~15 tiles from a counter; bankers render as `reachable=false` from afar | Walk to the banker's own stand tile first (per-bank anchors in runecrafting.md) |
| `rejected` / `inventory_full` in logs **while inventory grows** | SDK false-negative on server bulk actions (essence fills the whole bag per op) | Gate on inventory/XP deltas, not on the result flag (bug mvltjyh3-04af218b) |
| Bot ignores DM commands | Reading `m.from` (doesn't exist) | Sender is **`m.sender`**; also: prime `getNewChat()` once at boot, else history-replay false-triggers; command dedup windows block re-issues <45s |
| Same chat line repeats to other players | Old script personality-spam loop | Remove/one-shot the chatter; chat is public state — spam is how "errant behaviour" gets noticed |
| Loop stalls at a loc with `cant_reach` | Loc footprint blocks its own anchor tile; or a closed door between (doors CLOSE behind you) | Walk adjacent, dispatch `sendInteractLoc` directly, retry after opening nearby doors (`scanNearbyLocs(14)` — small `findNearbyLoc` misses locs across a room) |
| "Works when I watch, stalls when I leave" | You left a foreground process bound to your shell | `(... exec nohup ... & )`, verify by the log advancing after the launching command returns |

## 2. State-reading gotchas (the model WILL get these wrong)

- **Non-stacking items count as slots**: rune ore/essence/flax = 1 per slot
  (`x27` in a state dump = 27 slots, inventory full). Coins/notes stack.
- Open bank/shop modal **hides the inventory** (it mirrors into
  `shop.playerItems`; `state.bank.items` reads while the bank is up).
- Skill values read 0/default on first ticks and while parked — never treat a
  reported stat as real until the code path that refreshes it has run.
- Rock locs are named `Rocks copper ore`, inventory is `copper ore`.
  Pattern that matches both: `/^(?:Rocks )?copper ore$/i`.
- Dialog continue: message boxes publish 1-based indices; blind
  `sendClickDialog(0)` silently no-ops on them. Prefer published index /
  `clickDialogByText`.

## 3. Current fleet map (verify against ps, update on change)

| Bot | Entry (`bun bots/<b>/script.ts`) | Job | Key coords |
|---|---|---|---|
| qweness1-4 | shim -> `essence-feeder.ts` | mine/bank essence, run to altars on chat | hub E Varrock (3253,3421); meet/banks in runecrafting.md |
| qwenflax | shim -> `flax-feeder.ts` | flax -> spinning wheel runs | Seers: field (2742,3445), bank (2724,3494), wheel (2711,3469) |
| wgelyjrqwen | `script.ts` (SDK) | men today; goal P3: eat-branch fix -> rogue/knight/hero cash ladder (GOALS.md 2026-10-24) | castle (3222,3218), Draynor (3092,3243) |
| qwenfish | `script.ts` | fish/cook/thieve loop; goal P4: Fishing Guild (Fish99) = crew shark/swordfish pipeline | Lumbridge range (3230,3196) now; guild N of Ardougne |
| qwensmith | `script.ts` | mine->smelt->smith; goal P2: AK mith/adam/coal node (3304,3305) -> adamant gear for crew | Varrock SE mine (3285,3365), Lumbridge furnace (3225,3256), VW anvil/bank (3188,3421 / 3185,3436) |
| qwenguard | `script.ts` | combat loop c118 — goal P1: kill-tier ladder BK->blue dragon->KBD (KBD re-serves the **nature talisman** goal); current cow grind | cow fields now; targets in GOALS.md 2026-10-24 |
| qwenrune | **runner-only** — driven elsewhere | do NOT start its script | — |

- All feeders/scripts are **re-entrant**: kill any time; boot re-reads state,
  auto-banks in-hand items. Watchdog (`bots/rs-watchdog.sh`) restarts
  runners+scripts within 5 min — prefer waiting for it over manual launches.
- There must be exactly ONE supervisor: root `watchdog.sh` is retired for good
  (it phantom-ran a runner for the runner-less bot -> re-login wars).

## 4. Process hygiene (copy-exact commands)

```bash
# KILL — its own command, bracket pattern, and the literal path must NOT
# appear anywhere else on the same command line (launcher included). Match the
# PROCESS cmdline (bots/<name>/script.ts — the shim entry), not imported files:
pkill -f 'bots/qweness1/scri[p]t.ts'

# LAUNCH — a separate command:
cd /home/wgelyjr/Projects/rs-sdk && \
  ( cd "$PWD" && exec nohup bun bots/qweness1/script.ts \
      > /tmp/opencode/qweness1-script.log 2>&1 < /dev/null & )
```

The `exec` matters (learnings/watchdog.md). Self-match kill cost this session:
3 incidents, one killing a live income bot mid-deploy.

## 5. Debugging recipes

- `grep -oE "ph=[a-zA-Z]+" log | sort -u` — which phases were reached.
- Phase stuck >2 min + no position change = §1 row 1/2; position changing but
  circling = §1 row 3.
- Re-run with `DEBUG=1` env for per-tick state (add such logging when a
  hand-rolled loop misbehaves; it found the stuck-busy and bankOpen bugs here).
- Compare `cli.ts` position twice 45s apart to catch silent freezes.
- Before "fixing" a coord/name, grep the map/engine census
  (`server/content/maps/m*.jm2`, `server/engine/data/symbols/`) or the
  learnings — a guessed tile cost 6 deaths and a lost kit this session.

## 6. When to stop and ask the human

- Any change to another account's bots you don't own, item handoffs, or
  economy retargets (what a bot *should* earn is the owner's call).
- A fix that needs a new game mechanic you can't find in configs/learnings.
- Anything requiring spending the user's gp/items, deleting files, or git
  operations. Committing learnings (this file's siblings) is fine — say what
  you wrote and move on.

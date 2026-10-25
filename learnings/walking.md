# Walking & Navigation

Successful patterns for movement and pathfinding.

## Basic Walking

`bot.walkTo()` performs pathfinding for both short and long routes:

```typescript
const result = await bot.walkTo(3222, 3218);  // Walk to Lumbridge
if (!result.success) console.warn(result.reason, result.message);
```

## Long Distance Walking

`walkTo()` supports long routes. Use waypoints when you intentionally need a
safer route, want progress checkpoints, or need to avoid a dangerous area:

```typescript
const WAYPOINTS_TO_BANK = [
    { x: 3270, z: 3380 },  // Step 1
    { x: 3250, z: 3395 },  // Step 2
    { x: 3230, z: 3410 },  // Step 3
    { x: 3210, z: 3425 },  // Step 4
    { x: 3185, z: 3436 },  // Final destination
];

async function walkWaypoints(waypoints) {
    for (const wp of waypoints) {
        // Try up to 3 times per waypoint
        for (let attempt = 0; attempt < 3; attempt++) {
            await bot.walkTo(wp.x, wp.z);
            await new Promise(r => setTimeout(r, 500));

            const player = sdk.getState()?.player;
            const dist = Math.sqrt(
                Math.pow(player.worldX - wp.x, 2) +
                Math.pow(player.worldZ - wp.z, 2)
            );

            if (dist <= 5) break;  // Close enough
        }
    }
}
```

## Verifying Arrival

Always check if you actually arrived:

```typescript
const result = await bot.walkTo(targetX, targetZ);

const player = sdk.getState()?.player;
const dist = Math.sqrt(
    Math.pow(player.worldX - targetX, 2) +
    Math.pow(player.worldZ - targetZ, 2)
);

if (dist > 5) {
    console.warn(`Walk failed: still ${dist.toFixed(0)} tiles away`);
}
```

## Known Routes

### Varrock Mine to Varrock West Bank (~100 tiles)

```typescript
const MINE_TO_BANK = [
    { x: 3270, z: 3380 },
    { x: 3250, z: 3395 },
    { x: 3230, z: 3410 },
    { x: 3210, z: 3425 },
    { x: 3185, z: 3436 },
];

const BANK_TO_MINE = [
    { x: 3210, z: 3425 },
    { x: 3230, z: 3410 },
    { x: 3250, z: 3395 },
    { x: 3270, z: 3380 },
    { x: 3285, z: 3365 },
];
```

## Opening Obstacles

`bot.walkTo()` attempts to open doors and gates on its route. If a route fails,
inspect nearby objects and open the specific obstacle before retrying:

```typescript
let result = await bot.walkTo(3250, 3260);
if (!result.success) {
    const gate = sdk.findNearbyLoc(/^gate$/i);
    if (gate?.optionsWithIndex.some(option => /^open$/i.test(option.text))) {
        await bot.openDoor(gate);
        result = await bot.walkTo(3250, 3260);
    }
}
```





## Cow Field to Draynor Bank

Draynor Bank (3092, 3243) is the closest bank to Lumbridge cow field.

### DANGER: Dark Wizards
**AVOID** the area around (3220, 3220) - aggressive Dark Wizards here will attack and likely kill characters under combat level 20.

### Safe Route Strategy
Stay **north of z=3240** when walking west from cow field to Draynor. Use `walkTo` with intermediate points that curve north around the danger zone rather than walking in a straight line.

```typescript
// Safe: curve north around Dark Wizards
await bot.walkTo(3230, 3270);  // Go west, stay north
await bot.walkTo(3150, 3250);  // Continue west
await bot.walkTo(3092, 3243);  // Draynor Bank

// DANGEROUS: straight line cuts through wizard area!
await bot.walkTo(3092, 3243);  // May path through (3220, 3220)
```

## Key Coordinates

| Location | Coordinates |
|----------|-------------|
| Lumbridge spawn | (3222, 3218) |
| Lumbridge cows (field center) | (3253, 3290) |
| Cow field south gate | (3253, 3266) |
| Draynor fishing | (3087, 3230) |
| Varrock West bank | (3185, 3436) |
| SE Varrock mine | (3285, 3365) |
| Lumbridge general store | (3212, 3247) |
| Lumbridge castle (thieving) | (3222, 3218) |
| Falador center | (2951, 3380) |
| Falador north gate (to Taverley and wester side of map) | ~(2935, 3460) | 
| Taverley (stone circle) | (2935, 3479) |

### Al Kharid Coordinates

| Location | Coordinates | Notes |
|----------|-------------|-------|
| Toll gate (Lumbridge side) | (3268, 3228) | Pay 10gp to enter |
| Toll gate (Al Kharid side) | (3277, 3227) | Walk here after paying |
| Al Kharid bank | (3269, 3167) | x=3269 is 1 tile west of typical "in Al Kharid" check |
| Kebab seller | (3273, 3180) | Dialog-based shop, 1gp per kebab.
| Scimitar shop (Zeke) | (3287, 3186) | Bronze to Mithril scimitars |
| Al-Kharid warriors (palace) | ~(3293, 3170) | Good thieving/combat training.
| Fishing spots | (3267, 3148) | Safe shrimp fishing (there is a lvl 14 scorpion)

### Al Kharid Detection

```typescript
// Simple check: x >= 3270 means inside Al Kharid
// BUT note the bank is at x=3269, so use x >= 3267 for safety
function isInAlKharid() {
    const player = sdk.getState()?.player;
    if (!player) return false;
    return player.worldX >= 3267 && player.worldZ < 3220;
}
```

## One-way doors (server-enforced)

Some doors are one-way in one direction but **not** in the SDK's static
`ONE_WAY_DOORS` list (pathfinding.ts) — so `walkTo` will happily path toward the
blocked side and time out. Known:

| Door | Coords | Behaviour |
|------|--------|-----------|
| Lumbridge→Al Kharid gate | (3268, 3227) / (3268, 3228) | One-way, server-enforced. The **west** (castle) side is open and safe; routing **east** toward Al Kharid dead-ends here and times out. The proven crossing is the **toll gate** (pay 10gp), not this door — see `sdk/test/alkharid-gate.ts`. |

**Diagnostic red herring (2026-10-22):** a bot was reported "stuck at the
one-way door" because a *route test* probed only the **east** target (the Al
Kharid kebab, 3273,3180), which routes through the blocked door and timed out.
The bot was actually already at the **west** castle (3222,3218), fully
reachable, with pickpocketable Men right there. Lesson: when a route test times
out, check which *direction* it probed and whether the bot's real position is
already on the safe side — don't assume it's trapped.

## Process hygiene (killing bot scripts)

NEVER put a literal `bots/<name>/script.ts` path in the **same** shell command
as `pkill -f` / `pgrep -f` — the pattern matches the shell's own command line and
kills the shell. Kill in its own command using the bracket trick
(`pkill -f 'bots/<name>/scr[i]pt'`), and launch in a **separate** command.
(Careful: broad pkill patterns also killed the crew watchdog once, 2026-10-23.)

## Cellar stairs: approach side matters, and the landing may be indoors (2026-10-23)

- Varrock West Bank cellar stair (loc 1733 @ (3187,3433)): the op only routes from the
  **west** tile (3186,3433, `reachable=true`); from the south tile (3187,3432) the client
  returns `cant_reach` and writes no packet. When a loc-op "can't reach", probe each side
  tile for `reachable` instead of giving up on the loc.
- The stair's `p_telejump` lands at (3190,9833) — **inside a furnished building**
  (chairs/tables/shelves; the Climb-up return stair loc 1734 sits at (3187,9833) in the
  same room). An overland march from there dead-ends indoors; find the building exit (or
  a different crossing) before marching.
- A queued arrive-then-op can complete **after** the controlling script has returned:
  march3 reported "climb failed", yet the bot ended up teleported. Poll a moment longer,
  or re-read position on the next run before re-attempting.

## Al Kharid toll gate tiles are a wedge trap (2026-10-23)

Standing ON the gate ((3268,3227)/(3268,3228)) wedges the bot: every walkTo whose route
crosses the gate re-fails ("impassable door — re-routing"), and no escape route resolves.
The toll dialog chain works (interact gate → "Who does my money go to?" → "Yes, ok." →
10 gp → teleport to x≥3270) but **requires 10 gp in the bag** — a penniless bot cannot
self-rescue via the toll. Never park a coinless bot on the gate tile.

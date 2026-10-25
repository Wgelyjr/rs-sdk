# Combat

Successful patterns for combat training.

## Attacking NPCs

Use `bot.attack()` for cleaner code, or raw SDK for more control:

```typescript
// Porcelain method (recommended)
const attack = await bot.attack(/cow/i);
if (!attack.success) console.warn(attack.reason, attack.message);

// Raw SDK dispatch (observe combat state afterwards)
const state = sdk.getState();
const npc = state?.nearbyNpcs.find(n => /cow/i.test(n.name));
const attackOpt = npc?.optionsWithIndex.find(o => /attack/i.test(o.text));
if (npc && attackOpt) {
    await sdk.sendInteractNpc(npc.index, attackOpt.opIndex);
    await sdk.waitForCondition(s => s.player?.combat.inCombat === true, 5_000);
}
```

## Combat Style Cycling

Combat-style indices depend on the equipped weapon the SDK reads
the table from the combat tab the server installed, so resolve indices from state

```typescript
const targetSkill = 'Defence';
// A controlled style lists every skill it trains, so match against trainsSkills.
const style = sdk.getState()?.combatStyle?.styles.find(
    candidate => candidate.trainsSkills.includes(targetSkill),
);
if (!style) {
    throw new Error(`No ${targetSkill} style is available for the equipped weapon`);
}
await sdk.sendSetCombatStyle(style.index);
await sdk.waitForCondition(
    state => state.combatStyle?.currentStyle === style.index,
    5_000,
);
```

## Checking Combat State

```typescript
const state = sdk.getState();
const inCombat = state?.player?.combat.inCombat ?? false;

// Animation is a useful heuristic, but is not specific to combat.
const isAnimating = (state?.player?.animId ?? -1) !== -1;
```

## Safe Training Locations

| Location | Coordinates | Targets | Notes |
|----------|-------------|---------|-------|
| Lumbridge cows | (3253, 3290) | Cows | Safe, good for all levels. South gate at (3253, 3266) |
| Lumbridge goblins | (3252, 3230) | Goblins, rats | Mixed enemies. Cluster runs NE from here — nothing at the old (3240, 3220) waypoint |
| Lumbridge chickens | (3237, 3295) | Chickens | Very safe, feathers drop |
| Al Kharid warriors | ~(3293, 3170) | `Al-Kharid warrior` (lvl 9) | Faster XP, kebabs nearby for food, can hit hard via multicombat vs low combat levels. |

## Cow Field Details (Proven from 200+ kills)

The cow field is fenced with a gate on the south side:
- **Field center**: ~(3253, 3290)
- **South gate position**: (3253, 3266)
- **Inside cow pen**: x between 3242-3265, z between 3255-3298

```typescript
function isInsideCowPen(x, z) {
    return x >= 3242 && x <= 3265 && z >= 3255 && z <= 3298;
}
```

## Opening Gates

Cow field and chicken coop have fenced gates:

```typescript
// Check for gate blocking path
const gate = sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
if (gate) {
    const openOpt = gate.optionsWithIndex.find(o => /^open$/i.test(o.text));
    if (openOpt) {
        await bot.openDoor(gate);
    }
}
```

## Finding New Targets

After killing an NPC, find the next one quickly:

```typescript
async function findTarget(pattern) {
    const state = sdk.getState();
    if (!state) return null;

    return state.nearbyNpcs
        .filter(n => pattern.test(n.name))
        .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}
```

## Looting Ground Items

**CRITICAL**: Use `sdk.scanGroundItems()` NOT `state.nearbyLocs` for dropped items!

```typescript
// WRONG - nearbyLocs is for static objects (trees, rocks, etc.)
const wrongLoot = sdk.getState()?.nearbyLocs.filter(i => /hide/i.test(i.name));  // Won't work!

// CORRECT - scanGroundItems() for drops
const groundItems = await sdk.scanGroundItems();
const loot = groundItems.filter(i => /hide|bones|coins/i.test(i.name));
```

**Ground-item source (2026-10-21):** Prefer `state.groundItems` (populated in the
state snapshot, what the CLI's "Ground Items" section prints) over the on-demand
`await sdk.scanGroundItems()` round-trip — in the guard's case the on-demand scan
was silently returning `[]` while `state.groundItems` had the drops, so the pickup
"found" nothing even though items were on the ground. If `scanGroundItems()`
comes back empty but the CLI shows items, switch to `state.groundItems`.

### Limit Pickups Per Loop

Pick up a few items (e.g. 3), then return to combat. Prevents getting stuck in infinite loot loops:

```typescript
const MAX_PICKUPS = 3;
const groundItems = await sdk.scanGroundItems();
const loot = groundItems
    .filter(i => /hide|bones/i.test(i.name))
    .filter(i => i.distance < 5)
    .slice(0, MAX_PICKUPS);

for (const item of loot) {
    await bot.pickupItem(item);
    await new Promise(r => setTimeout(r, 500));
}
// Back to combat
```

## Pickup Timing and Failure Modes (2026-10-21)

- **Pick up while idle, not mid-attack.** A pickup op dispatched right after
  `bot.attack()` is silently refused as a side-op of the active attack (no
  message). Run the loot block *before* the attack, while the bot is standing
  between fights. The guard's post-attack pickup picked up 0 hides for 4
  sessions; moving it pre-attack fixed it.
- **A full inventory silently blocks pickup.** `bot.pickupItem` into a full bag
  is refused with no "inventory full" message — it waits 10s and returns reason
  `timeout`. If pickups start timing out, check `sdk.getInventory().length`
  (slots used) first: 28 = full.
- **Ground item name is `Cowhide`** (one word), not "Cow hide". `/hide/i`
  matches either way; an exact-name match must use `Cowhide`.

## Error Handling for Long Runs (Critical!)

Timeouts and errors are frequent in crowded areas. Wrap attacks in try/catch:

```typescript
// This pattern enabled consistent 10-minute runs
try {
    await bot.attack(/cow/i);
} catch (err) {
    console.log(`Attack timed out, trying next cow`);
    continue;  // Don't crash - just find another target
}
```

### Common Messages and Handling

| Message | Meaning | Response |
|---------|---------|----------|
| "I'm already under attack" | Crowded area, NPC in combat | Find different target |
| "I can't reach that!" | Obstacle or fence | Move closer, check gates |
| Attack timeout | Target died/moved | Try next NPC |

### State Validation

Browser glitches sometimes return invalid positions. Validate state before acting:

```typescript
const player = sdk.getState()?.player;
if (!player || player.worldX === 0 || player.worldZ === 0) {
    console.log('Invalid state - waiting for sync');
    await new Promise(r => setTimeout(r, 2000));
    continue;
}

// Also catch impossible position changes (>500 tiles = glitch)
if (Math.abs(player.worldX - lastX) > 500) {
    console.log('Position glitch detected, skipping action');
    continue;
}
```

## Auto-Train Lowest Combat Stat

For balanced progression, automatically train whichever stat is lowest:

```typescript
function getLowestCombatStat(state) {
    const skills = state.skills;
    const atk = skills.find(s => s.name === 'Attack')?.baseLevel ?? 1;
    const str = skills.find(s => s.name === 'Strength')?.baseLevel ?? 1;
    const def = skills.find(s => s.name === 'Defence')?.baseLevel ?? 1;

    if (def <= atk && def <= str) return 'Defence';
    if (str <= atk) return 'Strength';
    return 'Attack';
}

const state = sdk.getState();
if (!state) throw new Error('No world state');
const stat = getLowestCombatStat(state);
const style = state.combatStyle?.styles.find(option => option.trainsSkills.includes(stat));
if (!style) throw new Error(`No style trains ${stat} with the equipped weapon`);
await sdk.sendSetCombatStyle(style.index);
console.log(`Training ${stat} with ${style.name}`);
```

This pattern enabled balanced 60+ in all melee stats.

## Surviving Aggressive Monsters (dark-wizard post-mortem, 2026-10-21)

Two combat-12 bots died at the Draynor fishing spot (learnings/fishing.md)
to L7 dark wizards. The rules that make an under-levelled bot survive:

1. **Walk the moment `inCombat` turns true.** Never "wait out the fight"
   standing still — a `waitOutFight`-style handler that only moves after a
   25s XP-stall timer means standing still, and a low-HP bot dies in ~5s.
   `await bot.walkTo(escape.x, escape.z, 2)` FIRST, then poll for combat to
   drop.
2. **The escape point must be OUT of chase range**, not just out of aggro
   range. 3 tiles away was still inside the wizard's chase; 10-12 tiles
   away (on a verified walkable strip) is safe. Lower z = south.
3. **Equip, and re-equip after respawn.** A death drops the equipped gear;
   the respawn grants a fresh starter kit (shortbow/bronze sword/wooden
   shield) IN THE BAG, unarmed. Check `player.combat.weaponName` each loop:
   if `/unarmed/i` and a sword is in the bag, `bot.equipItem()` it.
4. **Know your respawn point.** qwenfish respawns at Lumbridge castle
   (3222,3218) — dropped gear at the death site is lost unless retrieved.
5. **Raw food is not edible** ("I need to cook this first.") — a bot with
   only raw food has 0 heal. Cook at the Lumbridge range (3230,3196).
6. **If the bot can't survive, train more first.** Combat 12 with
   sword+shield still died to a L7 wizard (no food). Combat ~20 + food +
   immediate escape is the working margin. Passive targets (cows) are the
   safe way to close the gap — they give faster XP than chickens.
7. **Death scatters EVERYTHING at the corpse** (source: `death.rs2`,
   2026-10-23): `inv_dropall` dumps the full inventory **and worn gear** at the death
   coord with a `lootdrop_duration` expiry — unretrieved drops vanish. Bank contents are
   safe. This explains qwensmith's cleared bag after 6 desert deaths and qwenrune's lost
   pickaxe. Ground-retrieval scans at the death site (like `ensurePickaxe`) partially
   rescue; and any risky node needs food + gear *before* the run, not after a death.

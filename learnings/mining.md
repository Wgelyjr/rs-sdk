# Mining

Successful patterns for mining automation.

## Finding Rocks

Rocks are **locations** (not NPCs). Filter for rocks with a "Mine" option:

The client names live rocks `Rocks copper ore`, `Rocks tin ore`, and so on.
Use `/copper ore/i` to find a rock; `/^copper ore$/i` matches the inventory item only.
Depleted rocks can appear as plain `Rocks`; select a live ore-specific rock again.

```typescript
const state = sdk.getState();
const rock = state?.nearbyLocs
  .filter((loc) => /rocks?/i.test(loc.name))
  .filter((loc) => loc.optionsWithIndex.some((o) => /^mine$/i.test(o.text)))
  .sort((a, b) => a.distance - b.distance)[0];
```

## Mining Action

```typescript
if (!rock) throw new Error("No mineable rock nearby");
const result = await bot.mineRock(rock);
if (!result.success) console.warn(result.reason, result.message);
```

For lower-level control, `sendInteractLoc()` only confirms client dispatch. Take
an XP/inventory baseline and wait for the intended change rather than sleeping
for an arbitrary duration.

## Detecting Mining Activity

Animation ID 625 indicates active mining:

```typescript
const animation = sdk.getState()?.player?.animId ?? -1;
const isMining = animation === 625;
const isIdle = animation === -1;
```

**Note:** Al Kharid mine is full of Lvl 14 scorpions. Combat 27+ with defensive style is enough to survive while mining. The scorpion fights actually train Defence passively.

**Wildy-edge node (recon 2026-10-23):** mithril Rocks #2102 @ (3304,3305) / #2103 @ (3305,3304), d=3 from each other. Fallback ore same cluster: iron #2092/#2093, coal #2096/#2097, silver #2100/#2101, gold #2098/#2099, tin #2094. **7 lv14 scorpions** ring the node (3301,3305 / 3299,3300 / 3302,3297 / 3297,3299 / 3297,3312 / 3299,3312 / 3302,3292). Bank is Al Kharid (3268,3167) — 10 gp toll each way at the gate (3268,3227).

## Reliable Locations

| Location             | Coordinates  | Notes                                              |
| -------------------- | ------------ | -------------------------------------------------- |
| SE Varrock mine      | (3285, 3365) | Copper, tin, iron                                  |
| Al Kharid mine       | (3295, 3287) | Iron, coal, gold, silver, mithril, tin. Scorpions! |
| Lumbridge Swamp mine | -            |                                                    |

**Getting to Al Kharid mine from Lumbridge:** Pay 10gp toll at gate (3268, 3227), walk NE. Dialog sequence: continue → continue → "Yes, ok." (index 3) → continue.

## Counting Ore

```typescript
function countOre() {
  const state = sdk.getState();
  if (!state) return 0;
  return state.inventory
    .filter((i) => /ore$/i.test(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}
```

## Drop When Full

```typescript
const state = sdk.getState();
if (!state) throw new Error("No world state");
if (state.inventory.length >= 28) {
  const ores = state.inventory.filter((i) => /ore$/i.test(i.name));
  for (const ore of ores) {
    await sdk.sendDropItem(ore.slot);
    await new Promise((r) => setTimeout(r, 100));
  }
}
```

## Pickaxe tier does NOT lock out ore types (source-verified 2026-10-23)

`pickaxes.param` `mining_rate` (bronze=7, iron=6, steel=5, mithril=4, adamant=3, rune=2)
only sets `%action_delay` in `mining.rs2` — ticks per swing, i.e. **speed**. Rocks gate on
the Mining `levelrequire` alone. A bronze pickaxe at Mining 94 mines mithril (55),
adamantite (70) and runite (85) — just slowly. Don't gate a mining loop on pickaxe
"tier"; gate it on Mining level. Buying a better pickaxe is a throughput upgrade, not an
unlock (verified live: bronze pickaxe mining mithril).

## Where the mithril actually is (live scan 2026-10-23)

The Al Kharid **Wildy-edge** mine cluster — Rocks mithril ore #2102/#2103 at
**(3304,3305)/(3305,3304)**, surrounded by iron (#2092/2093 at 3294-3305 x 3284-3311),
coal (#2096/2097) and silver (#2100/2101). The node (3243,3160) hardcoded in
`bots/qwensmith/script.ts` shows **no mithril/adamant rocks at all** — wrong tile.
WARNING: 7 lv14 scorpions ring this node (recounted 2026-10-23, was x5) and killed the
combat-3 smith repeatedly — death
scatters the whole bag at the corpse (see learnings/combat.md #7). Mine it only with
food + gear, or move the loop to the safe Varrock forge/bank cluster (anvil 3246,3404;
furnace nearby; banked money is death-proof).

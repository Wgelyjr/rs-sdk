# Fishing

Successful patterns for fishing automation.

## Finding Fishing Spots

Fishing spots are **NPCs**, not locations:

```typescript
const spot = sdk.getState()?.nearbyNpcs.find((npc) => /fishing\s*spot/i.test(npc.name));
```

## Spot Types Matter

Different spots have different level requirements:

| Spot Options | Fish Type           | Level |
| ------------ | ------------------- | ----- |
| Net, Bait    | Shrimp, anchovies   | 1+    |
| Net, Harpoon | Mackerel, cod, bass | 16+   |
| Lure, Bait   | Trout, salmon       | 20+   |

Filter for the right spot type:

```typescript
// Level 1 fishing - need "Bait" option (indicates small net spot)
const fishingSpots = sdk.getState()?.nearbyNpcs.filter(
  npc => /fishing\s*spot/i.test(npc.name),
) ?? [];
const smallNetSpots = fishingSpots.filter((npc) =>
  npc.optionsWithIndex.some((opt) => /^bait$/i.test(opt.text)),
);
```

## Fishing Action

```typescript
const spot = sdk.getState()?.nearbyNpcs.find((npc) => /fishing\s*spot/i.test(npc.name));
const netOpt = spot?.optionsWithIndex.find((o) => /^net$/i.test(o.text));
if (spot && netOpt) await sdk.sendInteractNpc(spot.index, netOpt.opIndex);
```

## Continuous Clicking Works

Don't over-engineer wait conditions. Just keep clicking:

```typescript
while (true) {
  const state = sdk.getState();
  if (!state) {
    await sdk.waitForStateUpdate();
    continue;
  }

  // Dismiss any dialogs (level-ups)
  if (state.dialog.isOpen) {
    await sdk.sendClickDialog(0);
    continue;
  }

  const spot = state.nearbyNpcs.find((npc) => /fishing\s*spot/i.test(npc.name));
  if (spot) {
    const netOpt = spot.optionsWithIndex.find((o) => /^net$/i.test(o.text));
    if (netOpt) await sdk.sendInteractNpc(spot.index, netOpt.opIndex);
  }

  await new Promise((r) => setTimeout(r, 1000));
}
```

## Safe Fishing Locations

| Location            | Coordinates      | Spot Type    | Notes                                                                                                                                     |
| ------------------- | ---------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Draynor Village** | **(3087, 3230)** | **Net/Bait** | **USE THIS for level 1.** Shrimp/anchovies. Dark wizards at (3084, 3236)/(3085, 3238) — stay south of z≈3232 if you are low combat level! |
| Al Kharid cape      | (3267, 3148)     | Lure/Bait    | **DEAD TRAP for low-level bots.** 10gp toll gate + lvl 14 scorpions — a combat-12 bot died here repeatedly on 2026-10-21. Fly fishing (level 20+). |
| Barbarian Village   | (3110, 3434)     | Lure/Bait    | Fly fishing (level 20+). Second spot at (3104, 3424).                                                                                     |

**COMMON MISTAKE**: Lumbridge area (3238, 3251) has NO level-1 fishing spots. Use Draynor!

**VERIFIED LIVE (2026-10-21)**: the Lumbridge river spot at (3240,3241) exists but is **[Lure, Bait] = fishing 20+** — unusable below that.

## Draynor Survival (2026-10-21 post-mortems)

The dark wizards at (3084,3236)/(3085,3238) are ~6-7 tiles north of the spot.
Two combat-12 bots died here on 2026-10-21 despite the "stay south" rule.
Root causes and fixes:

1. **Never stand still while in combat.** `waitOutFight`-style handlers that
   wait for an XP stall before moving = standing still = dead in ~5s. The
   instant `inCombat` turns true, WALK. A combat-12 bot with sword+shield
   died at the 3-tile escape point because it waited out a 25s stall timer.
2. **Escape SOUTH, far.** The verified walkable strip at x≈3087-3100 runs
   south to z≈3214 (draynor-tiles.ts against m48_50.jm2). Escape to
   (3087,3220): 10 tiles from the spot, ~16 from the nearest wizard — out
   of chase range. The old escape (bank at 3092,3243) was north, inside the
   wizard zone; the 3-tile escape (3087,3227) was still inside chase range.
3. **Equip the sword+shield, and RE-EQUIP after death.** A death drops the
   equipped gear; the respawn grants a fresh starter kit (shortbow, bronze
   sword, wooden shield) in the bag, unarmed. Check `player.combat.weaponName`
   each loop; if `/unarmed/i` and a sword is in the bag, re-equip.
4. **Combat 12 is below the survival line even with gear.** Train to combat
   ~20 first (passive L2 cows at (3253,3290) give faster XP than chickens;
   pen gate at (3253,3266) starts closed).
5. **Raw food is NOT edible in this game** (item flavour: "I need to cook
   this first."). Fish/meat must be cooked at the Lumbridge range
   (3230,3196) — see learnings/cooking.md. A bot with 0 food dies to any
   fight it can't escape.
6. **Respawn point is Lumbridge castle (3222,3218)** — the same tile as the
   castle thieving spot. Net + caught fish drop at the death location and
   are lost unless retrieved; the net must be re-bought (5gp, Gerrants
   Port Sarim) after every death.

**COMMON MISTAKE**: Lumbridge Swamp **(3239, 3147)** has NO fishing spots _at all_ — not net, not lure/bait. Verified against map spawn data: nearest spot is 28 tiles east at (3267, 3148) across the toll gate. Do not walk here to fish.

## Handling Drift

Fishing spots move. Check distance and walk back if needed:

```typescript
const START_AREA = { x: 3087, z: 3230 };
const MAX_DRIFT = 15;

const player = sdk.getState()?.player;
if (!player) throw new Error('No player state');
const drift = Math.sqrt(
  Math.pow(player.worldX - START_AREA.x, 2) +
    Math.pow(player.worldZ - START_AREA.z, 2),
);

if (drift > MAX_DRIFT) {
  console.log(`Drifted ${drift.toFixed(0)} tiles, walking back`);
  await bot.walkTo(START_AREA.x, START_AREA.z);
}
```

## Fly-fishing feather economy at Lumbridge (measured 2026-10-23)

- **1 feather per catch** (not per cast). A full lure bag (~21-24 raw fish before the
  28-slot bag fills) consumes an entire feather batch, so top-ups are needed nearly every
  bank cycle.
- Gerrant's (Port Sarim) sells only **~14-16 of 40 requested per visit** — a live stock/
  restock cap. Each top-up detour is bank (Draynor) -> thieve coins at Lumbridge castle ->
  Port Sarim -> back to the spot, ~500+ tiles. Measured 181 such trips in ~18 h — a large
  time tax on qwenfish.
- The thieving funds itself (3 gp/pick × 15 picks ≈ 45 gp ≈ 20+ feathers), but the walking
  is what costs. Fixes to try: find a nearer high-stock feather shop (the wiki lists
  Fernahei's fishing hut at 800 stock — wiki locations are unreliable on this server,
  verify live), or bank a feather stockpile in one dedicated multi-visit session instead
  of buying per-cycle.

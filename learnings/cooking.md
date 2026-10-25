# Cooking

## Cooking on a Range

Use `bot.useItemOnLoc(item, loc)` with raw food on a range:

```typescript
const raw = sdk.findInventoryItem(/^raw shrimps$/i);
const range = sdk.findNearbyLoc(/^range$/i);
if (raw && range) {
  await bot.useItemOnLoc(raw, range);
}
```

## Range Locations

| Location | Coordinates | Loc name | Notes |
|----------|-------------|----------|-------|
| **Lumbridge (near Bob's Axes)** | **(3230, 3196)** | `Range` | **USE THIS.** No quest needed. Just south of Bob's Axes (3232, 3203). |
| Lumbridge Castle kitchen | (3212, 3215) | `Cooking range` | **REQUIRES Cook's Assistant quest completion.** The Cook stands next to it at (3209, 3215). |
| Al Kharid (Karim's kebab shop) | (3271, 3180) | `Range` | No quest needed, but 10gp toll gate to get there. |

**COMMON MISTAKE**: The range inside Lumbridge Castle kitchen — **(3212, 3215)**, ground floor, SW corner where the Cook stands — is locked behind the Cook's Assistant quest. Without the quest the Cook says *"Hey! Who said you could use that?"* and nothing cooks. Use the Range at (3230, 3196), south of Bob's Brilliant Axes, instead.

**Name gotcha**: the quest-gated castle range is named `Cooking range`, not `Range`, so `/^range$/i` deliberately skips it. Usable cooking sources are `Range` (loc 2728-2731), `Fireplace` (2724-2726), `Cooking pot` (2727), and `Fire` (2732) — a wider match is:

```typescript
const source = sdk.findNearbyLoc(/^(range|fireplace|fire|cooking pot)$/i);
```

Nearest usable sources elsewhere: Fireplace (3205, 3220) in Lumbridge castle, Cooking pot (3232, 3238), Fire (3245, 3246), Fireplace (3100, 3256) near Draynor.

## PITFALL: `useItemOnLoc` with a regex re-resolves to the NEAREST match

`bot.useItemOnLoc(raw, /^(fireplace|range)$/i)` resolves the regex to the
**nearest** matching loc at call time — not the one you walked to. From
Draynor that is always the unreachable fireplace at (3100,3256), never the
Lumbridge range you just walked 145 tiles to. This produced a false
"both cooking sources are dead" verdict on 2026-10-21 (the range works —
qwenguard cooks there all session).

**CORRECT pattern** (what qwenguard uses, proven):

```typescript
const walk = await bot.walkTo(RANGE.x, RANGE.z, 2);
if (!walk.success) { /* switch source / handle */ return; }
const src = sdk.findNearbyLoc(/^(range|fireplace|fire|cooking pot)$/i);
if (!src) return;
const r = await bot.useItemOnLoc(raw, src); // pass the loc OBJECT, not a regex
```

Also check the walk result: an unchecked `await bot.walkTo(...)` followed by
a regex-based use silently keeps resolving to the wrong (nearby) loc, so the
failure loop looks like "the source is unreachable" when it's actually
"we never got there".

## PITFALL: Inventory Slots, Non-Stacking Food, and Overcooking (2026-10-21)

The guard's bag kept pinning at 26-28/28 slots and every pickup timed out. Three
compounding causes:

1. **Food and Cowhide do NOT stack.** Raw food (fish AND meat), cooked food, and
   `Cowhide` (one word) each take **1 item = 1 slot**. Coins, runes, and arrows
   DO stack. So "Raw beef x18" = 18 slots, not 1.
2. **`getInventory()` is per-slot, not grouped.** Each occupied slot is one
   entry (with `.count` = 1 for non-stacking items). `getInventory().length` is
   the number of **slots used** (28 = full), and `countItems(/re/)` is the
   summed item count. The CLI formatter groups by name, so it *understates* the
   slot count — "0 empty slots" means all 28 are used even though the CLI lists
   only a few names.
3. **Never assume a "cooked/food" regex matches raw items.** `FOOD =
   /shrimp|bread|kebab|cake|cooked/i` matches *cooked* food but **not "Raw
   beef"**. The `bankTrip` deposit `if (food > 6) depositItem(FOOD, food - 6)`
   therefore never touched the raw beef, which accumulated forever and pinned
   the bag. Match raw items explicitly if you intend to bank them.

**Overcooking fills the bag.** Cooking *all* raw beef at session start (18 raw →
20 cooked + 4 burnt) filled the bag even though the guard already had food. Cap
cooking at a target (e.g. stop once `countItems(FOOD) >= 8`), and don't collect
the non-stacking drop you'll bank whole (the guard now skips raw beef entirely —
see learnings/combat.md).

**Banks with a count only drain one slot** for non-stacking items — use the `-1`
all-match path. See learnings/banking.md.

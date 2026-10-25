# Crew Goals

Long-term goals for the 5-account crew on `rs.elyworks.net`. Rates are **5x**.
NPC levels are **compressed**; ore / logs / food (raw + cooked) / Cowhide do **not**
stack (1 item = 1 slot); coins / runes / arrows do stack.

> **Standing requirement:** revisit and revise these goals periodically as levels
> progress. Update the snapshot table below at each revision and add a dated entry
> to the revision log at the bottom.

## Crew overview

| Bot | Role | Self-sufficient? |
|-----|------|------------------|
| `qwenfish` | Fishing + Cooking — crew **food supplier** | yes (F99/C99, feeding the crew — do not touch) |
| `qwensmith` | Mining + Smithing — crew **gear supplier** | **M97/S79, Attack 30 DONE** (the Adamant's level gate was the whole "Failed to equip" saga); **Adamant pickaxe equipped + 90-min Wildy mine loop relaunched** (pid 931307, 21:40) on the 2.33× Adamant; Bronze banked; 200 gp toll buffer |
| `qwenguard` | Melee — crew **tank** | yes (C109 cow grind restarted 18:21, pid 888265 — do not divert) |
| `wgelyjrqwen` | Thieving (+ WC/FM) — **income** | **relaunching the castle Men income grind (T87)** after the adamant fetch; home (3248,3226), 2115 gp; **watchdog running** (pid 931007) |
| `qwenrune` | Runecraft — crew **rune supplier** + high-alch rune source | **Rune Mysteries COMPLETE**; **kit WITHDRAWN + in hand** (shortbow/bronze sword/wooden shield/air talisman); **tower→Falador bank route PROVEN** (a single direct `walkTo(3013,3354)` routes the whole trip — 48s, clean, no combat); **at the tower (3104,3166) hp 10/10** — needs a pickaxe + the Air Altar to start the runecrafter loop |

## Level snapshot — 2026-10-23 ~23:22 (refreshed)

| Bot | Skill levels |
|-----|--------------|
| qwenfish | Fishing 99 (MAX), Cooking 99 (MAX), Thieving 61+ (feather funds), Combat 25 — healthy, cycle 634+ (do not touch) |
| qwensmith | Mining 97, Smithing 79, **Attack 30 (Adamant now legal)**, Combat 29 — **90-min Adamant Wildy loop relaunched** (23:17, pid 955072) after the 21:40 run (480 ores, 110,625 xp, 0 deaths); Adamant pickaxe equipped |
| qwenguard | Combat 106, Prayer 62, Cooking 21 — healthy, cow grind (do not divert) |
| wgelyjrqwen | **Thieving 90** (547,256 xp), Woodcutting 82, Combat 7 — focused `income.ts` castle Men grind (pid 949895, ends ~23:46), ~6,261 gp in bag |
| qwenrune | Combat 3, Runecraft 1 — Rune Mysteries **DONE**; **kit in hand** (shortbow/bronze sword/wooden shield/air talisman); **tower→bank route proven** (direct `walkTo`, no waypoints); **at the tower (3104,3166) hp 10/10**; needs pickaxe + Air Altar for the runecrafter loop |

## Gear progression (added 2026-10-22)

**Goal:** progress the whole crew to **rune-tier equipment** (where applicable) —
armor, weapons, **boots, gloves, tools (pickaxes), amulets, rings**, and **capes**
— with **qwensmith as the producer**.

**Engine:** qwensmith (Mining 94 / Smithing 79) climbs the
**pickaxe → ore → bar → gear** ladder. Each pickaxe tier unlocks a higher ore; the
ore is smelted into bars and smitted into gear. Gear is either **worn by the crew**
(traded to them) or **sold** (to fund the next pickaxe tier). Smithing gear also
levels Smithing (mithril platebody 313xp, adamant 521, rune 697), so the bot works
toward the **Smithing 85** needed for rune gear.

**Pickaxe ladder (the means — all tiers sold at Nurmof's Pickaxe Shop, Falador):**
> **CORRECTION 2026-10-23 (source-verified):** this game does **not** bind rocks to
> pickaxe tiers — `mining_rate` is swing speed only (bronze=7 … rune=2), rocks gate on
> Mining level. Mithril/adamantite are minable NOW with the bronze pick. The ladder
> below funds **speed upgrades** (and Smithing xp), not ore access — priority drops
> below "keep qwensmith alive" (see revision log).
| Pickaxe | Cost | Unlocks ore | Ore Mining req |
|---------|------|-------------|----------------|
| Mithril | 1,300 gp | Mithril | 55 |
| Adamant | 3,200 gp | Adamant | 70 |
| Rune    | 32,000 gp | Runite  | 85 |

**Phase plan:**
1. **Mithril (now):** fund + send qwenguard (C100) to Falador → buy the mithril
   pickaxe (1,300 gp) → trade to qwensmith at Al Kharid → mine mithril → smith
   mithril gear (first wearable/sellable output; starts funding the next tier).
2. **Adamant:** sell mithril gear / use banked coins → adamant pickaxe (3,200 gp)
   → mine adamant → smith adamant gear.
3. **Rune (target):** rune pickaxe (32,000 gp — the big save-up, well beyond the
   current ~11k bar stock) → mine runite → smith **rune gear** (the end goal; needs
   Smithing 85 — the mithril/adamant gear smitted closes the gap).

**Gear targets per account (rune tier, where applicable):**
- **qwenguard (C100 melee tank) — the priority:** full rune set (platebody,
  platelegs, full helm, sword/2h, **boots**, **gauntlets**) + **amulet** + **ring**
  + **cape**.
- **qwenfish (C25):** survival gear (weapon + armor) so it doesn't die; scale up
  as it levels.
- **qwensmith (C3):** survival gear (weapon + armor + food) to stop mine deaths.
- **wgelyjrqwen (C7, T86):** thieving gear (soft coif / leather cap) + basic
  self-defense.

**Secondary track (not smittable):** **capes** (Fire/Dragonhide, etc.) and some
**amulets/rings** come from minigames, quests, or trade with other players — not
from qwensmith's anvil. The smittable gear (armor, weapons, boots, gloves, tools)
is the core engine; the rest is added on top as the crew reaches each tier.

## qwenfish — food supplier
**Role:** Keep the crew fed. Fish → cook → bank the food.
**Current:** Fishing 99 (MAX), Cooking 99 (MAX), Thieving 61 (accidental, feather funds), Combat 25.
**Role economics:** both money skills are maxed — the output that matters is **~100+ cooked
salmon/hr banked at Draynor** for the crew. Two open flaws: no eat branch (ran at HP 2, died
once en route) and the feather top-up tax (Gerrant's ~15/buy → 181 Port Sarim+thieve detours
per 18h — see learnings/fishing.md).
**Short-term:** fish the **Lumbridge Lure** spot (fly rod + feathers), cook the
salmon at the range (3230,3196), bank at Draynor (3092,3243). `lumbridge.ts` is
deployed as `script.ts` (verified Lure catch loop + proven Draynor cook/bank/equip
logic; 2-food bag margin since Lumbridge is a safe town).
**Upgrade (DEPLOYED — VERIFIED WIN, 2026-10-22 ~09:00):** the Lumbridge Lure spot
(3239,3244) IS a win. The earlier "NOT-a-win" call rested on the wiki's OSRS xp
values (salmon 70xp); this game's xp table is **~3× that**. Closed the one real gap
(the earlier probes never saw an actual catch) with an **empty-bag catch probe**:
**11/11 salmon in 3.1 min, 3650 xp → ~71k xp/hr raw**, ~330 xp/fish (~41% catch
rate, 1 feather/catch). Cooked salmon also **heals 9 HP + 90xp Cooking** vs Draynor
anchovies 3 HP + 30xp — a clean 3× on food quality AND Cooking xp (qwenfish's whole
role). The only cost is the bank (no bank at Lumbridge): cycle is
fish → range (cook) → Draynor bank → back. Even after that walk the effective rate
(~35k/hr) is competitive with Draynor (~28k in the overhead-heavy window / ~50k
steady) and the food/Cooking gain is decisive. (The full-bag mechanic + no-bank
blocker still hold — the script stops fishing at a full bag and walks back to bank.)
**Long-term:** max Fishing + Cooking; become the crew's standing food source
(cooked fish + meat, banked for the others).

## qwensmith — gear supplier
**Role:** Mine → smelt → smith. Supply bars/arms to the crew.
**Current:** Mining 94, Smithing 79, Combat **3→29 DONE** (v3, 0 deaths over 94
engagements). **STATUS 2026-10-23 ~19:45: 90-min Wildy-edge mine→bank run
18:22→~19:52** (18+ hauls, 0 deaths, 3,227 gp, mined=287 at 19:36) — then
**V4 = the adamant pickaxe buy run** (3,200 gp funded at 3,258): descend the
Falador cellar (S tile, proven) → walkTo(2998,9844) direct (pathfinder finds
the maze route through the sealed pockets) → find Nurmof (deployed coords
unverified — dump NPCs, match /nurmof/i or a Trade option) → buy at his shop
(loc 2776) → return → ascent (N tile). C29 fights through the L14 scorpions
(they AGGRO — repo census said passive, wrong); King L32 = risky, route around
if visible; HP<8 extract; death-aware (surface mid-route → skip ascent).
**FALADOR CELLAR (probe v2 19:04 + v3 19:28, both clean returns):** stair
**1733 @ surface (3059,3376)** / **1734 @ band (3059,9776)**. Descent = stand
**S (3059,3378)**, `sendInteractLoc(3059,3376,1733,1)` → lands (3058,9776).
Ascent = stand **N (3059,9775)**, send 1734 op1 → surface (3062,3376). N/E
approach tiles fail silently (no teleport, no rejection); `opRejectedCount`
bumps even on success — **gate on observed z, never the flag**. Landing pocket:
tin #2094/2095, coal #2096/2097, iron #2093 + rockslides/stalactites;
**8× Scorpion L14 + 1× King L32 ring the landing and they AGGRO** (v2 west
walk → combat in 4 tiles). v3: direct south column (x3058, z9784+) is **sealed
(walls)**; the pocket opens **SW** into a second pocket (~3047-3049, 9784-9792,
more scorpions) — (3058,9792) itself is unroutable from the landing. Scorpion
positions drift between runs (they move). Nurmof's expected (2998,9844) is
**unverified against the deployed world** (see the west-bank pack divergence
below — repo .jm2 can be stale).
**Tower-basement route (ABANDONED, history):** Fetch v1 + probes mapped the
tower basement as a sealed pocket (lab + dining + bedroom, x3096-3121
z9555-9578) — 8-dir ring from the dining room: every direction unroutable.
Closed doors are masked in the pathfinder (auto-open only when the target is
behind them) — open explicitly from an adjacent approach tile. Door state:
read OPTIONS, never id (`[1:Open]` = closed, `[1:Close]` = open; auto-close).
**PRIOR STATUS ~14:30: TRAINING COMBAT (v3, sustainable)** at the Lumbridge
duck/goblin cluster (3252,3230) — Liam's call ("level up the miner"): bring
Combat to **27+** so the smith can survive the lvl-14 scorpions ringing the
Wildy-edge mithril node (3304,3305) and mine it itself. **The survival fix = EQUIP gear:** the bot was
fighting **unarmed** with no food → died 8x and scattered its bag (lost 1370 gp /
hammer / pick). v3 equips the **Bronze sword + Wooden shield** at start (and
re-equips after each death) → **0 deaths, stable HP**, and it picks up coin drops
to re-accumulate funds. Combat 18→20 in the first 2 min of v3 (a24/s19/d4/h16),
climbing. `train.ts` = weakest-first melee, **style rotation** (combat tab
0:Stab[Atk] 1:Lunge[Str] 3:Block[Def]; see below), stray-guard (6 tiles) to stop
the southward drift toward the toll gate. The Al Kharid toll gate is
**bidirectional** (20 gp toll) — see revision log.
**COMBAT XP IS STYLE-GATED (source: `server/content/scripts/skill_combat/scripts/
combat.rs2` `give_combat_experience`):** Accurate→Attack only, Aggressive→Strength
only, Defensive→Defence only, Controlled→all three 133%; all styles +HP 133%.
`bot.attack()` defaults to Accurate → **only Attack rose** in v1 (Str/Def stuck at
1). Fix = rotate styles via `sdk.sendSetCombatStyle(value)` (0-3). `state.
combatStyle.styles` is an **array indexed by the style value** (entry has `.name`
+ `.trainsSkills`, NO `.value`/`.label` field) — the value is the array index.
Unarmed/bronze-sword tab here = 0:Stab[Atk] 1:Lunge[Str] 2:Slash[Str] 3:Block[Def];
cycle [0,1,3] trains Atk+Str+Def+HP at the same 133%/hit average as a Controlled
style.
**Short-term (current, ~13:50): combat training → Wildy-edge mithril.** Train
Combat to **27+** (defensive style survives lvl-14 scorpions, per learnings),
then mine the **Wildy-edge mithril node (3304,3305)/(3305,3304)** — Rocks mithril
ore **#2102/#2103** — ringed by 7 lvl-14 scorpions; bank the full 28-slot bag at
the Al Kharid bank (3268,3167). (The old hardcoded mine (3243,3160) is a **dead
tile** — no mithril/adamantite; see revision log.)
**Iron pipeline (2026-10-22, prior phase):** the mine→smelt→smith pipeline was
**upgraded to iron** (Mining 80 was still mining Cu/Tin). The SE Varrock mine
(3285,3365) carries **iron** rocks; iron is a single-ore smelt (1 ore → 1 bar).
Deployed + verified (bot holding iron ore, Mining 80→81).
**Smelting — IMPURITY mechanic (verified by live probe, 2026-10-22):** iron
smelting is NOT 1:1. The ore is **always consumed**, but ~1/3 of the time the
furnace says *"The ore is too impure and you fail to refine it"* and yields **no
bar** (probe 1: 3 smelts → 1 bar, 2 impure). The old script read 3 impure results
as "stalled" and bailed, wasting the rest of the bag. `smeltAll` is now
impurity-aware: a smelt "resolves" when the **ore is consumed** (bar OR impure);
only a *non-consumed* ore (furnace busy / op rejected) is a real stall. Smelts
must be **spaced** — dispatching faster than the furnace processes gets silently
rejected (probe 3c: 9 rapid smelts, 0 ore consumed). Net effect: expect ~3 ore per
bar; mine a full bag (24) per cycle, not 12.
**Survival:** the combat-raise IS the survival fix — at Combat 27+ (defensive
style) the smith can survive the lvl-14 scorpions at the Wildy-edge node. Until
then it trains on lvl-1/2 mobs (0 deaths in the first validation window). Add a
food leg (kebab seller, south across the gate) and a bank leg if deaths or a
full bag show up.
**Long-term:** max Mining + Smithing; climb the pickaxe→ore→bar→gear ladder
(see **Gear progression** above) — mithril → adamant → **rune** — and supply
progressively better gear to the crew (qwenguard's rune set is the priority).

## qwenguard — tank
**Role:** Melee DPS/tank. Self-sufficient (grinds its own food, buries bones for Prayer).
**Current:** Combat 82 (Atk 65 / Str 72 / Def 65 / HP 68), Prayer 41.
**Short-term:** keep the cow grind (healthy, 0 deaths); push Prayer toward 50+;
balance Atk/Def ahead of the next mob tier (Strength leading — cycle styles so
Atk/Def rise too).
**Long-term:** max Combat + Prayer; the crew's front line and main loot earner.

### Goal (2026-10-24, set by wgelyjr): acquire a nature talisman
- **Why:** nature-altar runs can't be serviced from any shop/GE (nature is
  drop-only on this server — see learnings/runecrafting.md "Talisman
  acquisition"). The tank is the only crew member with combat for it.
- **Farm:** vamps (combat 61-72, hp 40-50, not aggressive, flee when attacked,
  weakened by an equipped holy symbol). Odds per kill: 4/128 (vamp randomjewel
  band) x 4/128 (randomjewel nature band; 4/65 with Ring of Wealth) = **~1 per
  1,000 kills** (RoW: ~1 per 520). Earth talismans come along at 2/128.
- **Location:** Mort Myre, map m56_54 (wiki/npcs/vampire.md; sample (3585,3478)).
  VERIFY THE ROUTE before switching the loop (fleet-ops §5: no guessed coords;
  first trip walked with cli watch). Necrofiends ring the swamp — the
  approach is the risk, not the vamps.
- **Plan (for the implementing sweep):** keep the cow grind until the route is
  verified; then retarget the script at vamps, holy symbol equipped, immediate
  loot pickup (ground drops despawn in ~4 min — guard already hoovers bones).
- **Done when:** a nature talisman is in bag -> bank it, note the location +
  kill count in bots/qwenguard/lab_log.md, and it's available for qweness*
  nature runs (meet point in learnings/runecrafting.md).

## wgelyjrqwen — income (thieving)
**Role:** Pickpocket for coins + Thieving xp; secondary Woodcutting / Firemaking.
**Current:** Thieving 86, Woodcutting 82, Combat 7.
**Short-term:** grind the castle Men/Women (safe, respawn happens right at the
spot). **STATUS 2026-10-23 ~10:45: BACK ON THE GRIND** — its lite runner had
died (the paladin-rewrite incident); runner restarted, bot verified safe at
Lumbridge Castle (3219,3218), proven v3 `script.ts` relaunched. (The ~01:18
`HOLD=true` strike is over; retarget resolved to: keep the castle Men loop —
see learnings/thieving.md.) **Death-loop FIXED (2026-10-22):** root cause was that the weapon
unequips on death and the main loop never re-equipped it — so the bot was left
unarmed and lost to the **L2 Man**, who fights back on a failed pick (1 dmg/hit;
confirmed via live probe — NOT environmental Rat/Imp aggro). Fix (v3): re-equip a
melee axe each loop + eat food when HP<70%. Verified: armed, 0 deaths since
restart, Thieving 40→60. The bot carries no food yet, so the eat branch is inert
until it stocks some — the re-equip is what stops the deaths.
**Known constraint:** the Al Kharid toll gate (one-way, **not** in the SDK
`ONE_WAY_DOORS` list) can strand the bot if it walks east for food — so the Al
Kharid kebab purchase is **disabled** in its script. Crossing into Al Kharid is
proven via the toll (interact gate → pay 10gp → teleport to x≥3270), see
`sdk/test/alkharid-gate.ts`.
**Income upgrade (researched 2026-10-22 ~02:00):** the higher-value targets
exist but are **blocked by combat level, not target availability**:
- **Farmer** (L7, 9gp) is at Barbarian Village (3154,3293) — ~90 tiles west, on
  a route with **aggressive Dark Wizards** (learnings/walking.md). A combat-7
  bot dies in that travel.
- **Fremennik Warrior** (combat 48) is west (3145,3202) — far too high-level to
  pickpocket at Thieving 40 (constant stuns).
- **Al-Kharid warrior** (L9) is east through the one-way toll gate and pays only
  ~3gp/pick (same as castle Men) — no income gain, just stranding risk.

So the **castle Men grind is the correct safe baseline for a combat-7 bot**: it
sits at the respawn point and income self-improves as Thieving climbs (fewer
stuns = more 3gp picks/min). The real unlock is **raising Combat to ~20+**
(combat.md: ~20 + food + immediate escape is the working margin) so the bot can
safely travel to 9gp Farmers. That combat raise is the follow-up, not a target
change.
**Long-term:** max Thieving + Woodcutting + Firemaking; raise Combat to ~20+ to
unlock safe travel to 9gp Farmers, then keep pushing Thieving.

## qwenrune — runecrafter (5th bot, added 2026-10-23)
**Role:** Runecraft — the crew's **rune supplier**. Mine rune essence → craft
runes → bank. Also the **High Alchemy** rune source (fire / nature / law) so the
rest of the crew can high-alch gear instead of selling to stores.
**Current:** Combat 3, Runecraft 1. **RUNE MYSTERIES COMPLETE** (2026-10-23
~10:38): all 5 legs done — Notes handed to Sedridor (dialog p28: "You hand the
head wizard the research notes. He hands you back the Air Talisman."), **Air
talisman in hand**. **STATUS 2026-10-23 ~19:45: banking the starter kit at the FALADOR bank**
(`bank-falador.ts` 19:44): shortbow + bronze sword + wooden shield + **air
talisman** (Rune Mysteries complete — banking is death-proof, withdrawable for
the air-altar work). Bank geography (live-verified): **west Al Kharid bank is
DEAD in the deployed world** (no functional 2213 booths in the live LocIndex —
deployed pack diverges from repo .jm2; flag to Liam, not an SDK bug); east
Al Kharid bank works but sits **behind the 10 gp toll gate (3268,3227)** and
qwenrune has 0 gp; Falador bank (3011-3015,3354) works, toll-free. No
Lumbridge bank exists; (3120/3122,3100) = sealed tutorial-island newbie bank.
Still missing a **pickaxe** (0 coins) and the **Air Altar** location.
**RUNE ESSENCE MINE (verified 2026-10-23, corrected):** **4 essence rocks** loc
id **2491 `Rocks rune essence ore`** @ (2925,4848), (2927,4814), (2891,4847),
(2893,4812) — NOT a single rock. Surface band (z<5000), northern icefields
excavation (Rockslides, dead trees, ladders 743, scaffolds 744, torches). No
NPCs/bank/shop in 40 tiles. **Return is NOT on foot:** **4 Portals** loc id
**2492** @ (2932,4854), (2933,4815), (2889,4813), (2885,4850), option
`[1:Use]`; the one at **(2932,4854) is verified → tower basement (3104,9570)**,
adjacent to Sedridor + Climb-up 2148. (Other 3 portals untested.)
**Rune Mysteries — full flow (all verified at runtime, DONE):**
1. **Duke Horacio** (id 741 @ (3212,3220) on **L1** of Lumbridge Castle) —
   "Have you any quests for me?" → air talisman. **DONE.**
2. **Tower basement ladder → Sedridor** (id 300, runtime (3103,9570); match
   /sedridor/i ONLY — basement also has generic Wizards id 13). Trigger option:
   **"I'm looking for the head wizard."** → takes the talisman, gives the
   **Research package**. **DONE.**
3. **Aubury**, rune shop SE Varrock (id 553 @ (3252,3400) runtime) — deliver
   package → receive **research notes**. **DONE.**
4. Back to **Sedridor** — hand Notes → quest complete (dialog runs 29 pages,
   all single "Click here to continue"; handover is p28). **DONE.**
5. Sedridor **or** Aubury now offer **Teleport** (Sedridor op 3) →
   **Rune Essence Mine**. Pre-quest the teleport landed in place; post-quest it
   flies to (2912,4834). **DONE + VERIFIED.**
**Tower ladder (the solved puzzle):** descent = loc **2147 `wizards_tower_laddertop`
@ (3104,3162)**; basement end of the same ladder = **2148 @ (3103,9576)**
(Climb-up → lands (3105,3162)). The ladder sits in a sealed nook (N/S/E walls);
**sole entrance = west door 1536 @ (3107,3162)** (other doors: N 1536 @(3109,3166),
open-variant 1537 @(3109,3167); E 1536 @(3111,3163)). All three **reset to
closed between runs**. Repeated failures were caused by walking to (3107,3164) —
reachable *without* the west door, so the pathfinder never opened it and the bot
was on the wrong side of the wall. Working recipe (`enter3.ts`): open west door
→ `walkTo` a tile INSIDE the room (e.g. (3102,3162)) → Climb-down from any
in-room tile → gate on z>5000 (descend takes ~2 s). **PATHFINDER DOOR RULE:**
`walkTo` auto-opens doors only when the target is reachable ONLY through them.
**Short-term:**
1. ✅ **Rune Mysteries complete** (2026-10-23 ~10:38) — Air talisman in hand.
2. ✅ **Mine↔tower logistics loop done** (2026-10-23) — Sedridor Teleport in,
   **4 essence rocks**, **Portal (2932,4854) out** → tower basement, verified.
   Bank-route from the tower surface + a full **mine→bank** grind script remain
   (mine 4 rocks → Portal → walk to bank → refill; 28-slot rule).
3. **Air Altar — BLOCKED.** The talisman's only inventory option is
   `4:Locate` (there is **no "Use"** — that's why `sendUseItem` no-oped);
   invoking "Locate" via `sendUseItem(slot,4)` produced **no move/dialog/chat**
   (tested at the tower basement). Sedridor's post-quest dialog carries no altar
   info. **Altar location unknown** → the craft half (essence→Air runes) is
   blocked until Locate works in some context or the Altar is found another way.
4. **Re-acquire a bronze pickaxe** — qwenrune has **0 coins**. Free spawn:
   Lumbridge Floor 2 / Falador / Taverley (north) / Wilderness (wiki); or a
   1 gp trade from wgelyjrqwen (2,679 gp). Needed before the mine leg runs.
5. **Law talisman** from the **Troll Stronghold** (law runes, RC 54).
6. **Nature talisman** via the Canifis citizens `randomjewel` proc (1/32) or a
   trade — nature is required for High Alchemy.
**Runecraft altars (source-verified):** Nature = RC 44 (90 xp/ess), Law = RC 54
(95 xp/ess), Fire = RC 14, Death = RC 65. runes/ess = floor(level/mult)+1.
**High Alchemy (the payoff, source-verified):** Magic 55, 1 nature + 5 fire,
60% of the item's `oc_cost`, 650 xp/cast. **From mithril upward the crew
high-alches instead of selling to stores** (a mithril bar = 300 gp → 180 gp
alched vs ~110–120 haggling a store). **Caster = qwensmith** (train Magic → 55);
qwenrune supplies the fire + nature runes.
**Long-term:** max Runecraft; a steady rune supply for the crew's high alch and
combat spells.

## Revision log
- **2026-10-23 ~23:22 (QWENRUNE TOWER→BANK ROUTE PROVEN (direct walkTo, no waypoints); kit WITHDRAWN + in hand; smith 90-min run relaunched; income → T90)**
  - **QWENRUNE ROUTE — SOLVED (23:07–23:21).** After the four-side probe
    (S/E/SE/NE open, W/SW/N walled) and two failed waypoint designs (route2,
    south-detour — both died because **intermediate waypoints land in walled
    pockets around the tower**), the fix was to stop giving waypoints: a single
    `bot.walkTo(3013,3354)` from the tower (3103,3165) lets the pathfinder route
    the whole tower→Falador-bank trip itself — **49s out, reached (3012,3357),
    clean, no combat, no death**; the return leg is clean too. The bank is
    toll-free (confirmed). **Rule: never chain intermediate waypoints near the
    tower — give only the final target and let the pathfinder route.** (A minor
    2 HP hit appeared once on a return leg, source unknown, never inCombat —
    monitor during the kit run; the actual kit run came back **hp 10/10**.)
  - **QWENRUNE KIT WITHDRAWN (`withdraw-kit.ts`, 23:19–23:21, `[wkit]`).** At the
    Falador bank: 5 slots logged (Coins x25, Shortbow, Bronze sword, Wooden
    shield, Air talisman) → withdrew all 4 kit items → bag now
    `[Shortbowx1, Bronze swordx1, Wooden shieldx1, Air talismanx1]` → returned to
    the tower (3104,3166) **hp 10/10, clean**. qwenrune is now kitted + at the
    tower; remaining blockers for the runecrafter loop = a **pickaxe** (essence
    mining) + the **Air Altar** (the talisman's `Locate` was a no-op — re-test in
    the right context, e.g. at the icefields / near the temple).
  - **SMITH 90-MIN WILDY RUN #2 DONE 23:11** (`[wmine]`): 480 ores, 110,625 xp,
    38 hauls, 0 deaths; banked remainder + walked home (3254,3230). Relaunched
    23:17 (pid 955072, MINUTES=90) on the Adamant pickaxe.
  - **MY INCOME → T90:** the castle Men `income.ts` run crossed into
    **Thieving 90** (547,256 xp) at 23:16; ~6,261 gp in bag. Current run (pid
    949895) ends ~23:46 → relaunch fresh log then; bank the gp if convenient.
  - **PICKAXE DELIVERY (pending, needs a coordinated window):** I (wgelyjrqwen)
    free + qwenrune running `serveTrades` at the tower. I buy a bronze pickaxe
    from Bob (Lumbridge ~3230,3203, 100 gp) → walk to the tower (stays south of
    the L26 jail-guard band, clean) → `bot.trade('qwenrune', {give:[pickaxe]})`
    per the `fund-smith.ts` pattern. Next window: when the income run ends ~23:46.
- **2026-10-23 ~21:26 (ADAMANT PICKAXE REQUIRES ATTACK 30 — smith training to 30; funding done (200 gp); qwenrune back at the tower; toll-crossing correction; watchdog WRITTEN + started)**
  - **ADAMANT PICKAXE = ATTACK 30 REQUIRED (this game).** Every "Failed to equip
    Adamant pickaxe" (the v4 buy run + the 20:53 equip-fund) was NOT a bank-modal or
    weapon-in-hand issue — it's a level gate: game chat is explicit, "You need to have
    an attack level of 30." / "You are not a high enough level to use this item."
    smith is **Attack 29** (7,140 xp, compressed curve) — one level short. Fix: train
    Attack to 30 at the Lumbridge training spot (3254,3230) (Goblin/Giant spider L2,
    Rat/Duck L1 — all `[Attack]` + reachable), **Spike (Attack) style idx 0**, then
    swap to the Adamant. `attack30.ts` launched 21:27 (pid 929200): fight until Attack
    30 → unequip the Bronze (temp, wieldable L1) → equip the Adamant (now legal) →
    defensive style → bank the Bronze → walk to the mine-loop bank (3268,3167). Then
    relaunch the 90-min Wildy mine loop **on the Adamant**.
  - **FUNDING DONE (20:55:02):** 200 gp trade (`bot.trade` + `serveTrades` pair, meet
    at the bank side) — smith coins 7→**207**, wgelyjrqwen 2335→**2125** (−200 trade,
    −10 toll). The 200 gp = toll buffer for the Adamant mine run (~20 crossings).
  - **TOLL CROSSING CORRECTION:** the funding walk was **NOT** toll-free — the
    pathfinder routed through the toll gate (3268,3227) even though both endpoints were
    z<3227 (north). wgelyjrqwen paid 1 toll (10 gp) getting out and got stuck at the
    gate on the return leg (walkTo timed out at the gate, toll dialog left open).
    `go-home.ts` (21:27, pid 929201) pays the return toll + walks home (3247,3226).
    **Rule: treat every home↔(bank|meet) road crossing as toll-paying; only the
    node↔bank route is toll-free.**
  - **QWENRUNE BACK AT THE TOWER (20:54, `[runebank-f]`):** after dying in the
    jail-guard zone (Life 3), respawn (3220,3218) → mid (3159,3191) → NW gap
    (3106,3169) → tower (3105,3167). `DONE back=true hp=10/10 inv=[]`. Still
    empty-handed (kit banked at Falador); the runecrafter role still needs kit
    withdrawal + a pickaxe + the Air Altar.
  - **WATCHDOG WRITTEN + STARTED:** `watchdog.sh` (repo root) keeps the 5 lite runners
    alive (30 s pgrep check, 90 s restart cooldown to avoid a restart storm on a game
    revision mismatch). The recurring "watchdog still dead" note is resolved — no
    watchdog file existed; it's now written + running.
  - **SMITH 90-MIN WILDY RUN (18:22→~19:52) → M97:** the run completed, Mining
    94→**97**, 0 deaths; the 3,227 gp funded the Adamant pickaxe (v4 buy run
    20:06–20:12 via the Falador cellar, Nurmof (2993,9842)).
- **2026-10-23 ~19:45 (Falador-cellar descent/ascent PROVEN (probe v2/v3); scorpions AGGRO; west Al Kharid bank DEAD in the deployed world (pack divergence); qwenrune banking at the Falador bank; smith's 90-min Wildy run → v4 adamant buy after ~19:52)**
  - **CELLAR PROBE v2 DONE 18:26–19:05** (`cellar-probe2.ts`, `[probe2]`):
    surface walk to the Falador-mine stair (3059,3376) in one 70 s attempt;
    **descent sweep: N tile failed, E tile failed, S tile (3059,3378) worked
    first try** — `sendInteractLoc(3059,3376,1733,1)` → landed (3058,9776) in
    ~2 s. Landing dump: tin #2094/2095, coal #2096/2097, iron #2093,
    rockslides 472/474, stalactites 467. **8× Scorpion L14 + 1× King Scorpion
    L32 within ~15 tiles of the landing — and they AGGRO**: the 10-tile west
    test walk was in combat after 4 tiles (the repo census "passive" was
    wrong). Ascent: N tile (3059,9775) + 1734 op1 → surface (3062,3376),
    walked home in one go. `opRejectedCount` bumped 607→608 **on the successful
    ascent** — never gate on it.
  - **CELLAR PROBE v3 DONE 19:28–19:30** (`cellar-probe3.ts`, `[probe3]`):
    descent from S again first try. cp s1 (3058,9784) reached (3057,9780), no
    combat — new scorpion sightings: (3057,9779), (3050,9776), (3052,9772),
    (3049,9778), (3043,9770), King (3052,9775) → **they move between runs**.
    cp s2 (3058,9792): **unroutable** — path stops 9 tiles short at
    (3049,9792), "locked door or separate room"; the walk detoured SW to
    (3047,9791) and entered combat (hp 13→10) → aborted, clean ascent + home.
    **Layout: the landing pocket opens SW into a second pocket (more
    scorpions); the direct south column is walled.** v4 (smith) walks to
    (2998,9844) direct and lets the pathfinder thread the pockets, fighting
    through.
  - **WEST AL KHARID BANK = BROKEN IN THE DEPLOYED WORLD** (root cause found
    19:07–19:30, query `/tmp/opencode/locindex-query.ts` on the live LocIndex
    cache `~/.cache/rs-sdk-lite/locindex-1333187759.bin`, built from the
    rs.elyworks.net ondemand.zip): the west row (3111,3241-45) carries ground
    decor **1253/1254/1248** (unnamed — invisible in nearbyLocs), NOT the 2213
    bankbooths the repo `m48_50.jm2` claims; the 2214 deco booths
    ("private customers only", zero options) sit at (3096,3241-45). The east
    bank row diverges too (extra 2215 closed variant at (3268,3165) absent
    from the repo .jm2). The engine loads maps from `data/pack/`, not `.jm2`,
    so **the deployed pack is out of sync with the repo content** — a
    server-side pack staleness to flag to Liam, NOT an SDK bug (no bug report).
    Unfixable from the bot side.
  - **BANK GEOGRAPHY (live-verified):** east Al Kharid (3268,3164-3169)
    WORKS but behind the 10 gp toll gate (3268,3227); west Al Kharid
    (3111,3241-45) DEAD (above); Falador (3011-3015,3354) WORKS, toll-free
    (used by probe v1); **no Lumbridge bank**; (3120/3122,3100) = sealed
    tutorial-island newbie bank.
  - **QWENRUNE BANKING (the "bank items you're not using" pass):** west
    bank-check 19:02 (booth invisible, banked=0); bank-east 19:28–19:33 got
    stuck at (3267,3228) = **one tile south of the toll gate, 0 gp, can't
    pay** (returned clean via the NW gap). Now `bank-falador.ts` (19:44, pid
    912438): out of the compound via the proven south exit, waypoints SW to
    the Falador bank, deposits shortbow + bronze sword + wooden shield + air
    talisman, returns via the NW gap.
  - **SMITH 90-MIN WILDY RUN** (18:22→~19:52, `[wmine]`): at 19:36 t=4473 s,
    mined=287, xp=75650, 18 hauls, 3,227 gp, hp 27/27, 0 deaths. On completion
    → stats here + lab log, verify the `banked junk` lines, then launch
    **v4** (adamant pickaxe buy, recipe in the smith section).
  - **WATCHDOG STILL DEAD** — restart after the scripts settle (add qwenrune
    to BOTS).
- **2026-10-23 ~17:40 (PROBE V3: tower-basement route to Nurmof's is DEAD; band = sealed pockets, not a corridor region; smith on the Wildy-edge mine loop with the BRONZE pickaxe now; adamant deferred to the Falador-mine-cellar route)**
  - **PROBE V3 DONE 16:44–16:51** (`basement-probe3.ts`, log tag `[bprobe3]`): descent
    ~35 s (door 1 auto-opened again); **full 8-dir ring from the dining room: every
    direction unroutable** — the tower room (lab + dining + bedroom, x3096-3121
    z9555-9578) is a **sealed pocket in the pathfinder mask**; no corridor data
    exists between it and the rest of the band. Clean return home.
  - **DOOR STATE (definitive — read OPTIONS, never id):** `1530 @(x,9559)
    opts=[1:Open]` = CLOSED; `1531 @(x-1,9559) opts=[1:Close]` = OPEN. Doors
    **auto-close** (door 2 reverted to 1530/[Open] during a 120 s wait). Explicit
    open via `sendInteractLoc(x,z,id,opIndex)` works.
  - **DOOR 2 = DEAD-END BEDROOM:** beyond the open door is a furnished strip
    (z9555-9558: bed/chairs/tables/candles/mirror/portraits) — walkable (reached
    3109-3112, 9555-9556) but **nothing routable or loc-bearing north of z9555**.
    The east test: mask stops at the east wall (x3121); the **east warehouse
    pocket** (shelves/crates/barrels/dead trees @ x3140-3144, z9562-9571) lives in
    the world (server sends it) but NOT in the mask — target tiles "blocked".
  - **BAND MODEL (settled): the basement band (z≥5000) is NOT one continuous
    region — it is SEALED POCKETS, each with its own surface entrance.** Tower
    room (ladder 2147) sealed; bank vault (cellar stair **1733 @ surface
    (3187,3433)** → band (3190,9833)) a sealed dead-end (do NOT route through).
    **Candidate entrance near Nurmof's (2998,9844): Falador mine cellar, map
    47,52→47,152 ≈ surface (3008,3328) → band (3008,9728)** — UNVERIFIED (stair
    world coords + pocket connectivity still to map). Others: Yanille dungeon
    40,48→40,148; Legends Guild 42,52→42,152; Wilderness 47,61→47,161.
  - **SMITH PLAN REVISION:** the tower fetch is abandoned. Since the
    pickaxe-tier myth (see the ~03:20 entry), **the bronze pickaxe already mines
    mithril at M94** (tier = speed only: bronze 7 / iron 6 / steel 5 / mithril 4 /
    adamant 3 / rune 2 ticks), so the smith started the **Wildy-edge
    mine→bank loop NOW on bronze** (`wildy-mine.ts`, 10-min test launched 17:39;
    node (3304,3305), bank (3268,3167) safe side, toll 10 gp/crossing,
    HP<8 extract + 1/100-tick regen, death handler = respawn → corpse, pickaxe
    FIRST — drops vanish after 200 ticks). Adamant (3,200 gp; smith holds
    3,258 harmlessly at home) is deferred to the **Falador-mine-cellar probe**
    (walk surface to ~(3008,3328) → find the cellar stair loc → Climb-down →
    gate on z>5000 → chunk-walk to Nurmof's → buy).
  - **HP REGEN (source-verified, `stat.rs2`):** `[timer,health_regen]`
    `stat_heal(hitpoints,1)` on a timer set to **100** at login (Rapid Heal → 50)
    — 1 HP per 100 ticks. No passive foodless sustain: risky nodes still need
    food or a retreat gate.
- **2026-10-23 ~16:20 (smith Combat 29 DONE; Wildy-edge recon DONE; adamant pickaxe funded via paired trade; fetch v1 mapped the tower basement; probe v2 running)**
  - **SMITH COMBAT 3→29 DONE** (v3, 0 deaths over ~94 engagements) — cleared the
    27+ survival threshold for the lvl-14 scorpions.
  - **WILDY-EDGE RECON DONE 15:33 (no death):** mithril #2102 @ (3304,3305) /
    #2103 @ (3305,3304) verified; **7 lv14 scorpions** (was 5) mapped; fallback
    ore same cluster (iron #2092/2093, coal #2096/2097, silver #2100/2101, gold
    #2098/2099, tin #2094); toll 10 gp each way (recon paid 20 + 1 gp bronze pick).
    Smith home (3254,3230), 58 gp.
  - **PICKAXE DECISION (Liam): ADAMANT** — 3,200 gp, 2.33× (Nurmof stock 2).
    **Funding trade DONE 15:54:** `bot.trade()` (giver, empty `want` = pure gift)
    + `bot.serveTrades({want: 3200 coins})` (receiver — `want` gates accept on the
    visible offer, so it can't complete short) in a 10 s round trip. wgelyjrqwen
    5,535→**2,335**; smith 58→**3,258**; nothing dropped. Proven two-bot template:
    `fund-smith.ts` + `receive-funds.ts`.
  - **FETCH V1 (15:55) — route 90% proven, basement walk died.** Surface walk
    (Lumbridge→tower, ~60 s, no tolls on the west route) OK; tower nook descent OK
    (the pathfinder **auto-opened** the west door 1536 when targeting the inside
    tile — the explicit open is optional); **basement: moved +11 then STUCK ×10** —
    the tower basement is a walled room and the exits are EAST, not west. Safety
    return (ladder Climb-up 2148 → home) worked; note the Climb-up dispatch logged
    "REJECTED" yet still teleported — gate on observed position, not the reject
    delta.
  - **TOWER BASEMENT MAP (qwenrune loc dump 11:13):** ladder lands in the LAB
    (x3096-3106, z9566-9576; Sedridor + chickens + wizard lv9); **Door 1530 @
    (3108,9570) [Open]** → DINING (x3106-3121, z9555-9567; tables/chairs/mirror/
    bed); **Door 1530 @ (3111,9559) [Open]** → outside (unmapped). Runner log:
    "2691 doors masked" — closed doors block the pathfinder; they auto-open only
    when the target is behind them. Probe v2 (`basement-probe.ts`, ~16:20):
    descend → door1 (auto-open tried first, explicit from approach tile
    (3107,9570) as fallback) → door2 → ring-walk for the outside → chunk-walk to
    Nurmof (2998,9844) → **buy + return in the same run**.
- **2026-10-23 ~13:50 (Liam: "level up the miner"; smith node = dead tile → Wildy-edge mithril; gate bidirectional; essence mine 4 rocks + 4 portals; talisman = Locate no-op; 28-slot banking rule)**
  - **Liam's decision (~11:45): "level up the miner."** Train qwensmith's Combat
    3→**27+** so the smith itself survives the lvl-14 scorpions at the Wildy-edge
    mithril node and mines it — NOT a tank-divert, NOT a safe-iron downgrade.
    Combat 27+ (defensive style) is the survival threshold per learnings.
  - **SMITH NODE CORRECTION (mine-verify live scan ~11:23):** the hardcoded node
    **(3243,3160) is a DEAD TILE — no mithril/adamantite at all** (the ~09:15
    "5 mithril + 2 adamantite + 7 coal" claim is retracted). The **real mithril =
    Wildy-edge (3304,3305)/(3305,3304)**, Rocks mithril ore **#2102/#2103**, amid
    iron #2092/2093 (3294-3305 x 3284-3311), coal #2096/2097, silver #2100/2101.
    **5 lvl-14 scorpions ring it; a death scatters the whole bag at the corpse.**
  - **GATE CORRECTION:** the Al Kharid border gate is **BIDIRECTIONAL + 20 gp
    toll** — plain walk S↔N both work once the stale "impassable door" pathfinder
    mask clears (minutes). The ~10:45 "N→S blocked" was a stale mask, not a real
    block. Toll dialog: continue → continue → **"Yes, ok." (index 3)** → one
    follow-up continue page; **20 gp charged** despite the "10 gold" quote.
    Verified live today (train-verify paid S→N and reached the training spot).
  - **RUNE ESSENCE MINE CORRECTION:** **4 essence rocks** (id 2491) @ (2925,4848),
    (2927,4814), (2891,4847), (2893,4812) — not one. Return is **NOT on foot:**
    **4 Portals** (id 2492) @ (2932,4854), (2933,4815), (2889,4813), (2885,4850)
    `[1:Use]`; **(2932,4854) verified → tower basement (3104,9570)** (Sedridor +
    Climb-up 2148 adjacent). Runecraft loop = Teleport in → mine → Portal out.
  - **AIR TALISMAN (blocked):** only inventory option is **`4:Locate`** (no
    "Use" — why `sendUseItem` no-oped). "Locate" via `sendUseItem(slot,4)` =
    **no observed move/dialog/chat** (tower basement). Sedridor post-quest dialog
    is ONLY welcome + "Teleport me to the Rune Essence?" (op 2) → take care.
    **Air Altar location unknown.**
  - **qwenrune on the TOWER SURFACE (3105,3162)** — climbed via Climb-up 2148.
    Surface mapped: Staircase 1738 [1:Climb-up] @ (3103,3159), Doors 1536 @
    (3107,3162)/(3109,3166)/(3111,3163), 4 Wizards. Bank route + the Lumbridge
    Floor 2 free-pickaxe spawn still to map. **0 coins** → pickaxe from a free
    spawn or a 1 gp trade.
  - **TRAINING SPOT VERIFIED (train-verify):** Lumbridge duck/goblin cluster
    **(3252,3230)** reachable (paid toll S→N), full of **lvl-1 ducks, lvl-2
    goblins, lvl-2 giant spiders**, all `[Attack]`. Goblins here are **lvl 2**,
    not the lvl 8 old learnings assumed — safer for a low-combat bot. No food NPC
    nearby (kebab seller 3272,3181 is south across the gate). `train.ts` 5-min
    validation: attacks land, **0 deaths**, Attack 6→7, Combat 3→5.
  - **Liam's new instruction (~13:40): manage inventories well — 28 slots to hold
    resources for banking, use them wisely.** Fill the bag toward 28 before
    banking (not per item). Applies to the mining/smithing (qwensmith) and
    runecraft (qwenrune) loops.
  - **CREW STATUS:** all 5 alive + progressing. wgelyjrqwen v3 thieving timed out
    at 55 min but netted **+35,720 Thieving xp** (→ T87, 458,536); stun-heavy
    (358 stuns / 90 catches) — relaunched ~13:50, low priority. qwenfish F99/C99
    feeding (do not touch). qwenguard C106/P62 cow grind (do not divert).
    Watchdog still down — restart after the smith + qwenrune scripts are stable
    (add qwenrune to BOTS).
- **2026-10-23 ~10:45 (RUNE MYSTERIES COMPLETE; Rune Essence Mine found; one-way toll gate confirmed; wgelyjrqwen back on the grind)**
  - **RUNE MYSTERIES DONE (qwenrune):** the return-to-Sedridor dialog runs
    **29 pages** (the earlier 18-page cap stopped at p17, before the handover).
    p28: "You hand the head wizard the research notes. He hands you back the
    Air Talisman." — **Notes consumed, Air talisman in hand** (inv: Shortbow,
    Bronze sword, Wooden shield, Air talisman). No XP reward, no chat fanfare
    observed; the item handover is the completion evidence.
  - **RUNE ESSENCE MINE LOCATED (the quest reward, verified):** post-quest,
    Sedridor's **Teleport (op 3)** from the tower basement (3102,9570) flies to
    **(2912,4834)** — northern icefields, surface band. The essence rock = loc
    id **2491 `Rocks rune essence ore` @ (2925,4848)** (single rock in 24 tiles;
    the site is an excavation: Rockslides, dead trees, ladders 743, scaffolds
    744, standing torches). **No NPCs/bank/shop in 40 tiles.** Pre-quest the
    same teleport landed in place — it is genuinely gated on completion.
    Access is one-way (teleport in, walk out). Open logistics questions: does
    essence stack? Is the Yanille/Varrock level-1 essence (mining wiki) a
    better loop? Where is the nearest bank to the icefields?
  - **AIR TALISMAN:** post-quest Sedridor returns it and says "Use the Air
    Talisman to locate the air temple" — the temple is where essence is
    charged into Air Runes. Experiment in flight (`mine-explore.ts`, send
    `sendUseItem`) to learn what "use" does (dialog? direction? teleport?).
  - **ONE-WAY TOLL GATE CONFIRMED (Al Kharid border, gate tiles
    (3268,3227-3228)):** south→north crossing works — guard dialog
    (Talk-to after a movement step) → two continue pages → toll menu →
    "Yes, ok." → **one follow-up continue page** (the earlier failure stopped
    before it; that's why the pay "did nothing") → dialog closes, gate
    passable. **Charged 20 gp (1390→1370)** despite the "10 gold" quote.
    North→south is BLOCKED: pathfinder "Door at (3268,3228) cant_reach" —
    qwensmith is now stranded on the north side with the mine/bank/furnace
    behind the gate. This matches wgelyjrqwen's 2026-10-22 kebab stranding
    (its script already calls it "one-way toll gate"). Return experiment in
    flight (`gate-explore.ts`): plain walk / north-guard toll / manual gate
    ops / east-west roundabout.
  - **PATHFINDER NOTE:** from the south side, a direct walk to the mine
    (3243,3160) reports "stops 6 tiles short at (3261,3158) — the rest is
    unroutable from here (locked door or separate room?)" — the mine area
    may be a pathfinding segment that routes via the gate. The mine WAS
    reachable in earlier sessions (it mined there), so the wedge is new or
    state-dependent; re-verify from the south side once the return route is
    known.
  - **CREW TRIAGE:** all 5 bots alive + progressing. qwenfish healthy (cycle
    634+, F99/C99, thieving its own feather coins); qwenguard healthy
    (C105/P61); wgelyjrqwen's runner had died — restarted, verified at castle
    (3219,3218, T86/WC82, armed iron axe), v3 relaunched (strike over).
    Watchdog still down — restart after the smith's rewrite is stable
    (add qwenrune to its BOTS list once the runecrafter script exists).
  - **qwensmith script rewrite pending** (root causes confirmed): remove
    `clearDialogs()` auto-decline of the toll (regex matched
    "no thank you|walk around"); remove the wrong-pickaxe-tier hold (myth);
    add food purchase + toll handling for the north anvil leg only.
- **2026-10-23 ~09:15 (Rune Mysteries legs 1–2 DONE; tower ladder puzzle SOLVED; world model corrected)**
  - **Rune Mysteries:** leg 1 (Duke Horacio, id **741** @ (3212,3220) on **L1** —
    up-stair 1738/1739 @ (3204,3207), lands (3205,3209); dialog: "Have you any
    quests for me?" → air talisman) and leg 2 (**tower basement → Sedridor**, id
    **300**, runtime ~(3100,9568) — wiki (3103,9571) is wrong; options
    Talk-to/Teleport) are DONE. Talisman handed over; **Research package in
    hand**. Next: Aubury (SE Varrock rune shop, candidate (3253,3402)) →
    research notes → complete with Sedridor → Teleport (op 3) → Rune Essence
    Mine. Dialog trigger for Sedridor: **"I'm looking for the head wizard."**
    (the other two greeting options are dead ends).
  - **TOWER LADDER PUZZLE SOLVED** (root cause of ~10 failed descents): the
    descent ladder **2147 `wizards_tower_laddertop` @ (3104,3162)** is sealed in
    a nook (its own tile + N/S/E are walls); **sole entrance = west door 1536 @
    (3107,3162)**. All three room doors (W 3107,3162 / N 3109,3166 / E
    3111,3163) **reset to closed between runs**. Every failed attempt had the
    bot at (3107,3164) — a tile reachable *without* the west door — so the
    pathfinder never opened it and the dispatch hit the wrong side of the wall
    (accepted, no effect, `opRejectedCount` flat). Fix (`enter3.ts`, verified):
    open west door → `walkTo` a tile INSIDE the room ((3102,3162)) → Climb-down
    from any in-room tile → descent in ~2 s, gate on z>5000. Same ladder's
    basement end = **2148 @ (3103,9576)** (Climb-up → (3105,3162)); the spiral
    **staircase 1738 @ (3103,3159)** in the same nook goes UP to the tower top
    (don't use).
  - **PATHFINDER DOOR RULE:** `walkTo` auto-opens doors only when the target is
    reachable ONLY through them. To enter a sealed room, target a tile INSIDE
    the room, not a tile outside it.
  - **WORLD MODEL CORRECTION (user-confirmed): the world is generally
    CONTINUOUS with segmentation on z-levels; doors/stairs occasionally
    segment. The old "sea/void separates two regions" model (see the 2026-10-23
    entry below) is WRONG** — the Lumbridge↔tower surface is plain walking
    (maps 49/50). Keep the z-level rule though: **surface = z<5000; basement
    band = z≥5000** (map z 149–153; holds the tower basement/Sedridor, the
    bank cellar, Nurmof's/Falador shop). Tower surface↔basement offset ≈
    +6414 (9576↔3162) — NOT a clean +6400, verify per structure.
    **ZONE INVERSION BUG (hit this session):** `to-tower.ts` had
    `if (worldZ < SURFACE_Z) {"already in basement"}` — backwards; the buggy
    run walked 349 tiles south before being killed.
  - **BANK CELLAR = SEALED DEAD-END VAULT:** the (3187,3433) cellar stair
    lands (3190,9833) inside the bank cellar; its only exit is the stair UP.
    Do NOT route through it.
  - **LUMBRIDGE CASTLE:** entrance large doors (3213,3220)/(3213,3221) —
    "Open" gets rejected but doesn't block; the pathfinder passes through.
    Ground floor has only Man/Hans/Cook/Rat — the **Duke is on L1**. The other
    staircase (1738 @ (3204,3229)) is a different one; Climb-up from it is
    silently rejected.
  - **INTERACTION LESSON:** a loc's own footprint blocks its anchor tile —
    walk close and dispatch `sdk.sendInteractLoc(x,z,id,opIndex)` directly;
    gate loops on observed effect + `opRejectedCount` delta, never on the
    dispatch result alone (a refused op just bumps `opRejectedCount`, no
    game message).
  - **MITHRIL NODE CORRECTION:** the ~03:20 "MINE (3243,3160) is the wrong
    node" claim is retracted — live scan verified (3243,3160) carries
    **5 mithril + 2 adamantite + 7 coal**. Keep it.
  - **PICKAXE SOURCES:** bronze 1 gp (Bob, Lumbridge) … rune 32,000 gp.
    **Nurmof's (Falador, (2998,9844) — basement band)** is the only full-tier
    pickaxe shop.
  - **PROBE METHODOLOGY:** static probes (`buildCollision` →
    `CollisionMap.flags`, SQ_BLOCKED=0x280100, `W` cells carry direction
    bits) miss runtime door states — confirm with a runtime loc dump
    (`bots/qwenrune/dump-locs.ts [radius]`).
- **2026-10-23 ~03:20 (party eval: pickaxe-tier myth killed, death-drop rule, income+gear engines at 0, watchdog dead)**
  - **PICKAXE-TIER MYTH KILLED (source + live probe):** `mining_rate` only sets swing
    speed; rocks gate on Mining level alone. Bronze pickaxe at Mining 94 mines
    mithril/adamantite. The **pickaxe→ore "unlock" premise in Gear progression is wrong**
    — a mithril pickaxe (1,300 gp) buys throughput, not access. qwensmith can start the
    mithril phase NOW; the risk is death, not the pickaxe (see next point).
  - **DEATH-DROP RULE (source, `death.rs2`):** death scatters the full inventory + worn
    gear at the corpse (timed expiry); bank is safe. qwensmith's 6 desert deaths wiped
    the ore/bar/dagger carry (Thieving 9 + empty bag corroborate a death spiral near the
    gate/desert). **Survival gear for qwensmith is no longer "deferred"** — it is the
    precondition for any desert mining.
  - **ECONOMY ENGINE = 0 gp/hr:** `income.ts` was rewritten around Ardougne paladins
    (80gp+2 chaos/pick) — empirically infeasible at combat 7 (2 deaths en route), so the
    bot now sits at `HOLD=true` next to the Lumbridge men it used to grind. Decision:
    retarget `income.ts` to the Lumbridge men (coins stack → keep the money in-bag, no
    bank/shop legs needed; equip axe + eat like v3 did), OR revert to the proven
    `bots/wgelyjrqwen/script.ts` v3 under the runner.
  - **GEAR ENGINE WEDGED at the Al Kharid toll gate:** qwensmith sat ON the gate tile
    (3268,3227); walkTo routes keep re-crossing it and fail ("impassable door —
    re-routing"); the toll escape needs 10 gp and the bag has 0 coins. A parallel
    session's probes moved it to the desert side (found Scorpion x5 near iron/gold rocks
    @~3297,3287 — the C3 death source) and are verifying a free Varrock smith cluster.
    Script bugs to fix with it: the "wrong pickaxe tier, holding" branch is pointless
    (myth above), and `mineOre` treats `loc_not_found` as a reposition trigger — so the
    wedge turned into an hours-long walkTo-door loop with ZERO XP (Mining stuck 729,152).
    **LIVE WIN 03:2x:** bronze pick → "You manage to mine some mithril" confirmed; real
    mithril rocks are at **(3304-3305,3304-3305)** (Wildy-edge Al Kharid mine, scorpion
    ring); the script's MINE (3243,3160) is the wrong node. Smith last seen at the
    Varrock forge cluster (3242,3407) holding mithril ore — the mithril phase can start
    as soon as survival (food/gear) and the furnace/bank legs are wired.
  - **CELLAR-STAIR CORRECTIONS (live-verified):** the stair is loc 1733 @ **(3187,3433)**
    (not 3167,3433) and only routes from the WEST side tile (3186,3433); it teleports to
    **(3190,9833)** — INSIDE a furnished warehouse room, so an overland march from the
    landing dead-ends indoors. qwenrune is there now; the next quest step needs a building
    exit found first. His bronze pickaxe was lost to a death (respawn point ~banker area).
  - **FOOD ENGINE (qwenfish):** Fishing **99** and Cooking **99** are now both MAXED —
    XP rates are meaningless; the role's output is **~100-117 cooked salmon/hr banked at
    Draynor** (measured +13,400 xp in 22 min). Costs: 1 feather/catch, Gerrant's sells
    only ~14-16 feathers/visit → 181 Port Sarim+thieve detours in 18h (Thieving ground to
    61 funding it). **No eat logic** → ran at HP 2 and died once en route. Fixes: eat at
    <70% HP; bulk feather stockpile; after that, spare capacity could feed the crew's
    other needs (or just idle-bank food).
  - **TANK (qwenguard): healthy** — C104, Prayer 60 (~3-4k xp/hr), 0 deaths, banking ~11
    cowhides/run. Open questions: hides pile up in the bank with no sell route yet;
    Cooking 21 (auto-cooks meat drops — fine).
  - **PROCESS: the watchdog has been DEAD since ~03:03** (a broad `pkill` from the
    concurrent management session killed it — see learnings/walking.md process hygiene).
    No auto-restarts; fish/guard/income scripts happen to be alive, qwensmith's script is
    dead and NOT being restarted (intentionally left so — restarting the door-loop script
    would ping-pong the active repair probes). Restart the watchdog AFTER the smith
    script is fixed, and add qwenrune to its BOTS list once a persistent script exists.
  - **COORDINATION HAZARD:** two "Party Management" scheduled sessions ran concurrently
    (21:52 + 22:00) and fought for control (two march scripts on qwenrune; probes vs
    script restarts on qwensmith). Consider scheduling one manager at a time.
- **2026-10-23 (Sedridor route SOLVED — region-based world + cellar-stair crossing)**
  > **CORRECTED (see ~09:15 entry above):** the "region-based / sea-void" model
  > is **WRONG** — the world is generally continuous, segmented on z-levels;
  > Lumbridge ↔ wizard tower is plain surface walking. Everything below the
  > walkability/cellar-stair mechanics still holds.
  - **The world is REGION-BASED, not a continuous map.** The southern surface
    (Lumbridge/Varrock, maps z 50-62) and the northern region (Sedridor / wizard
    tower, maps z ~145-156) are separated by a **sea/void** (maps z 63-141 have no
    files, impassable). The original "march north" walked straight into the sea —
    that was the wrong way; there is no land bridge (scanned x=20-80).
  - **Walkability is NOT the `.jm2` ground u-type.** It's the terrain `Block` flag
    (`MapFlag.Block` = 0x1) encoded in the binary **land files** (opcodes 50-81),
    precomputed by the lite client into the disk-cached `LocIndex`
    (`~/.cache/rs-sdk-lite/locindex-<crc>.bin`). To probe any tile: load
    `LocIndex` (cache hit, no network) and `index.mapFlags(level, x, z) & 1` =
    blocked. The north region's u48/u58/u66 ground types are all **walkable**
    (Block not set) — the earlier u-type counts were a red herring.
    `isMapBlocked` (`server/engine/src/engine/GameMap.ts:465`) is the engine
    equivalent; `CollisionBuilder.ts`/`CollisionMap.ts` build the client collision
    from these flags + LOCs.
  - **The crossing near Sedridor = the "Varrock West Bank" cellar stair**
    (`stairs.rs2` `[oploc1,stairs_cellar]`): loc **1733** @ world **(3167,3433)**
    → `p_telejump` → **(3170,9857)** (same level 0), op1 = **Climb-down**.
    Route: walk SE to the stair → Climb-down → walk SW to Sedridor (3103,9571).
    Terrain probe confirmed the stair, its exit, Sedridor, and the straight line
    between the exit and Sedridor are all open.
  - `march-to-sedridor.ts` rewritten for this 3-phase route (to-stair → climb →
    to-sedridor), chunked ~45-tile sub-walks + offset fallbacks. Other cellar
    crossings exist and are useful for the **pickaxe trip** / future travel:
    Falador mine 47,52→47,152; Yanille dungeon 40,48→40,148; Legends Guild
    42,52→42,152; Wilderness 47,61→47,161.
- **2026-10-23 (5th bot qwenrune + runecraft + high alch + map/floor findings)**
  - **5th bot created: `qwenrune`** — dedicated runecrafter (rune supplier +
    high-alch rune source). On the crew server, tutorial skipped, starter kit in
    bag. A march script takes it Lumbridge → Sedridor for Rune Mysteries.
  - **HIGH ALCH verified from source:** Magic 55, 1 nature + 5 fire, 60% of item
    `oc_cost`, 650 xp/cast (low alch: Magic 21, 1 nat + 3 fire, 40%). Strategy
    set: **from mithril upward, high-alch gear instead of selling to stores**
    (mithril bar 300 gp → 180 gp alched vs ~110–120 haggled store). Caster =
    qwensmith (train Magic → 55); qwenrune supplies fire + nature runes.
  - **Anvil geography (user-corrected + source):** Al Kharid has **no anvil**.
    The region anvil is **Varrock (3246,3404)**; qwensmith's proven batch pattern
    is 40+ bars → walk to Varrock, smith 40/visit (chainbodies).
  - **Coordinate system (resolved, verified 4 ways):** bot `worldX/worldZ` =
    `mapIndex*64 + localX/Z` from `content/maps/m{X}_{Z}.jm2` (TEXT files; LOC
    lines `level x z: id [shape] [angle]`, NPC lines `level x z: npcId`); same
    formula as `wiki/generate-npcs.ts`. Quest NPC positions map-verified:
    Duke Horacio = m50_50 L1 (12,20) → world **(3212,3220)**; Sedridor = m48_149
    L0 (31,35) → **(3103,9571)**; Aubury = m50_53 L0 (53,10) → **(3253,3402)**.
    Client renders quest NPCs by real name (the Duke = "Duke Horacio").
  - **Floor transitions (solved + executed):** the lite-client BFS
    (`route()` in `server/webclient/src/lite/movement.ts`) is **single-level**
    (`c.collision[c.minusedlevel]`) — `walkTo` CANNOT cross floors. A floor
    change is a server-side `p_telejump` fired by a stair loc's script. Lumbridge
    Castle stair = loc **`loc_1738`** (L0) / **`loc_1739`** (L1) in
    `stairs.rs2` `[oploc1,spiralstairs]`/`[oploc*,spiralstairsmiddle]`; options
    "Climb"/"Climb-up"/"Climb-down" (oploc3 = down). **Rune Mysteries stage 0→1
    DONE** (Duke: "Have you any quests for me?" → "Sure, no problem." → air
    talisman, stage 1 given_talisman); bot descended the north stair (L1→L0) and
    is **marching to Sedridor** (~6350 tiles) via a loop of ~45-tile sub-walks
    with perpendicular offset fallbacks — `sendFindPath`'s 3rd arg is
    maxWaypoints and BFS only covers the ~104-tile build area, so far targets
    need the march loop.
  - **Fund loop COMPLETED:** sold 26 iron daggers/trip × 11 trips → bank **1,385
    gp** (269 daggers left). Unblocks the **mithril pickaxe trip** (Nurmof's,
    Falador 2998,9844; 1,300 gp). Next: move gold to qwenguard (C103 tank) → he
    walks to Falador, buys the pickaxe, trades it back to qwensmith at Al Kharid;
    his mine script auto-resumes on a mithril pickaxe in-bag (holds on wrong
    tier, 30 s retry).
  - **XP table** (`engine/entity/Player.ts:77-99`): CLI XP = engine XP ÷ 10.
    Targets: RC 44 = 21,172, RC 54 = 43,354, RC 99 = 998,458, Magic 55 = 46,534.
  - Levels refreshed: qwenfish F99 (MAX)/C98, qwensmith M94/S79/Magic1/RC1,
    qwenguard C103/P59, wgelyjrqwen T86/WC82, qwenrune C3/RC1. Watchdog restarted
    (4 bots; qwenrune joins once his runecrafter `script.ts` exists).
- **2026-10-22 (gear progression)** — Added a **gear-progression goal** for the
  whole crew: rune-tier equipment where applicable (armor, weapons, boots, gloves,
  tools/pickaxes, amulets, rings, capes). qwensmith (M94/S79) is the producer and
  climbs the pickaxe→ore→bar→gear ladder (mithril → adamant → rune). **Immediate
  step (in progress):** fund + send qwenguard (C100) to Falador to buy the mithril
  pickaxe (1,300 gp) and trade it back to qwensmith at Al Kharid. Also solved the
  Al Kharid toll-gate wedge (qwensmith was anchored at the gate; un-stuck to the
  safe mine 3243,3161 via the gate-block route; watchdog + fixed script hold it
  there, auto-mine armed). Levels refreshed: qwensmith M94/S79, qwenguard C100,
  wgelyjrqwen T86.
- **2026-10-22 ~09:00 UTC** — **CORRECTION: Lumbridge IS a win — deployed.**
  The ~06:00 "NOT-a-win" call is retracted. It rested on the wiki's OSRS xp
  figures (salmon 70xp); this game's xp table is ~3× that, and the earlier
  probes never actually observed a Lumbridge catch (they only confirmed the
  full-bag + no-bank blockers). Closed the gap with an **empty-bag catch probe**
  (bank raw at Draynor → walk to Lumbridge → cast Lure on an empty bag):
  **11/11 salmon in 3.1 min, 3650 xp → ~71k xp/hr raw, ~330 xp/fish** (~41% catch
  rate, 1 feather/catch). Cooking table confirms the food angle: cooked salmon
  **heals 9 + 90xp Cooking** vs Draynor anchovies 3 + 30xp — a clean 3× on food
  quality AND Cooking xp. Draynor measured ~28k/hr effective in the
  overhead-heavy window (505,120→506,520 in 180s) / ~50k steady. Net: Lumbridge
  wins on fish value + food + Cooking, competitive on xp/hr after the bank walk.
  **Deployed `lumbridge.ts`** (fish→range cook→Draynor bank→back; 2-food margin).
  Cross-account trade also confirmed real from the SDK (`bot.tradeWith`,
  `offerTradeItems`, `serveTrades`) — a trade needs both bots co-located + active.
  Levels: qwenfish F89/C72, qwensmith M85/S70, qwenguard C85/P45, wgelyjrqwen
  T70/WC82. All 4 + watchdog running + progressing.
- **2026-10-22 ~06:00 UTC** — **Lumbridge salmon verified NOT-a-win; fresh rates
  (SUPERSEDED by ~09:00 — the "NOT-a-win" conclusion rested on the wiki's OSRS xp
  values and was wrong; Lumbridge IS a win and is now deployed):**
  measured.** Ran the Lumbridge fly-rod upgrade end-to-end (buy rod+feathers at
  Port Sarim → walk to Lumbridge → instrumented casts → dialog dump →
  bank-then-fish). Findings:
  - The spot is real (Fishing spot @3239,3241, Lure/Bait) and qwenfish qualifies
    (F88); the rod (5gp) + feathers (2gp) are trivial at Port Sarim.
  - **Game mechanic (verified):** a fishing spot **refuses to catch when the
    inventory is full** — the Lure op opens *"You can't carry any more fish"*
    (Continue button at index 1) instead of casting. The SDK's generic
    "mid-action, stunned, or a modal is open" message is emitted for ANY rejected
    op, so a full-bag rejection looks identical to a real mid-action state — check
    the dialog to disambiguate.
  - **No bank at Lumbridge** — the river is far from the nearest bank (Draynor), so
    a full bag means a long walk back. The bank-then-fish probe looped on
    `openBank` "No banker NPC or bank booth found nearby".
  - **Conclusion:** Lumbridge is NOT a win. Draynor's spot+bank are co-located, so
    it stays despite 40 xp vs 70 xp fish. qwenfish restored to the original Draynor
    script; it carries the fly rod + 27 feathers (banked) for a later run at a
    bank-adjacent Lure spot.
  - **Fresh rates (2.3-min window):** qwenfish Fishing ~26k/hr (understated — the
    window caught it repositioning; steady ~50k) + Cooking ~39k/hr (cooking the
    raw-fish backlog); qwensmith Mining ~32k/hr + Smithing ~33k/hr (**3.7× vs the
    8.6k pre-fix — the smelt fix confirmed the bottleneck**); qwenguard Prayer
    ~3.5k/hr (combat 85); wgelyjrqwen Thieving ~37.5k/hr (Woodcutting 0 — focused
    on thieving). All 4 bots + watchdog running and progressing.
- **2026-10-22 ~05:00 UTC** — **qwensmith smelting: found + fixed the impurity
  leak** (the biggest efficiency problem in the party). A live instrumented
  probe (killed the script, ran a one-shot smelt probe, relaunched) revealed iron
  smelting has a **success chance**: the ore is always consumed but ~1/3 of smelts
  come back *"The ore is too impure and you fail to refine it"* with **no bar**.
  The old `smeltAll` treated 3 impure results as "stalled" and bailed, throwing
  away the rest of the bag. Fix deployed: `smeltAll` now resolves a smelt on
  **ore consumed** (bar OR impure) and only backs off on a non-consumed ore; also
  added `onDisconnect:'wait'` (a probe hit the transient-disconnect crash on the
  default `'error'` policy). Mine→smelt ratio should be ~3 ore/bar. Levels now:
  qwenfish F87/C70, qwensmith M82/S67, qwenguard C83/P43, wgelyjrqwen T63/WC82/
  Combat 15 (combat is climbing from the Men fighting back on failed picks).
- **2026-10-22 ~03:15 UTC** — Full party evaluation via live probes (not
  assumptions), plus two fixes deployed + verified:
  - **wgelyjrqwen death-loop FIXED.** The "caught! escaping" combat is the
    **pickpocketed L2 Man** attacking on a failed pick (1 dmg/hit) — confirmed by
    probe (`In Combat: Man`), not environmental aggro. Root cause: the weapon
    unequips on death and the main loop never re-equipped it, leaving the bot
    unarmed (HP 2/12, no food) and losing every fight. Fix (v3): re-equip a melee
    axe each loop + eat food when HP<70%. Verified: armed, **0 deaths since
    restart**, Thieving 40→60, coins climbing.
  - **qwensmith upgraded to iron.** Mining 80 was still mining Cu/Tin (bronze).
    Live mine scan confirmed the SE Varrock mine (3285,3365) carries **iron**
    rocks. Switched the whole pipeline to iron (single-ore smelt: 1 iron ore → 1
    iron bar). Deployed + verified (13 iron ore in bag, Mining 80→81). Combat 3,
    died once to a Giant rat (L6) — mostly survives; survival gear deferred
    unless deaths recur.
  - **qwenfish:** confirmed the Draynor spot is genuinely capped (Net/Bait →
    anchovies 40 xp; Bait is worse at 30). The real jump is the Lumbridge river
    spot (3240,3241, Lure/Bait → trout 50 / pike 60 / salmon 70), but it needs a
    **fly fishing rod** (feathers) and the bot carries only a net. **Deferred**
    pending a verified fly-rod/feather source (don't switch on assumption).
  - **qwenguard:** healthy — Combat 82, Prayer 41, 0 deaths, steady cow grind.
  - Levels now: qwenfish F86/C67, qwensmith M81/S66, qwenguard C82/P41,
    wgelyjrqwen T60/WC82. All 4 running + progressing under the watchdog.
- **2026-10-22 ~02:00 UTC** — Revised wgelyjrqwen income-upgrade. Researched all
  higher-value pickpocket targets: the upgrade is **blocked by combat level**
  (combat 7 can't survive the Dark-Wizard route to the 9gp Farmers at Barbarian
  Village, and the L48 Fremennik Warrior is un-pickpocketable at Thieving 40).
  Castle Men stays the safe baseline; the unlock is raising Combat to ~20+.
  Levels now: qwenfish F84/C56, qwensmith M79/S65, qwenguard C79/P38,
  wgelyjrqwen T40/WC82. All 4 still running + progressing.
- **2026-10-22** — Initial goals written. Levels: qwenfish F84/C56, qwensmith
  M79/S65, qwenguard C79/P38, wgelyjrqwen T39/WC82. All 4 running under the
  watchdog. wgelyjrqwen grind fixed and relaunched: Al Kharid kebab walk disabled
  after the one-way-gate stranding, weapon ping-pong fixed (equipment check),
  one-time Draynor log-clear added.

## Fleet sweep 2026-10-24 16:31
First sweep section — no prior stock baselines existed in GOALS.md; the numbers
below are the baseline for the next sweep. Supervisor: 1 watchdog (pid 419382).
All 10 runners + 9 scripts alive (qwenrune runner-only by design); 0 "Died" log
lines across all script logs.

- qweness1 HEALTHY — essence-mine fill/bank loop, M82; stock 12,605
- qweness2 HEALTHY — same loop; stock 12,330
- qweness3 HEALTHY — same loop; stock 11,769
- qweness4 HEALTHY — same loop; stock 11,797
- qwenflax HEALTHY — pick→bank at Seers; stock 21,476 → 21,756 (+280 during sweep)
- wgelyjrqwen AT-RISK → PARKED + watchdog-relaunched (only repair this sweep).
  hp 6→2→3/13 across three cli reads in the castle men courtyard, no food in
  bag; relaunched 16:28:44, now 6/13 climbing, 1,796 gp accumulating, T96.
- qwenfish HEALTHY — cycle 229; ate 17 cooked salmon during the sweep (bag
  19→2), hp 14→12→12 stable at the Lure spot (3240,3244). Do not touch.
- qwensmith HEALTHY — redeployed to SE Varrock mine (3284,3368) with bag
  iron ore 10→22 and hp 27/27; the "Mine rejected" log spam is the §1-row-8
  SDK false-negative (gate on deltas), NOT a stall. M99/S80/A30.
- qwenguard HEALTHY — cow grind (3245,3292), hp 94/94, C116/P70. Do not divert.
- qwenrune RUNNER-ONLY — untouched; at tower (3103,3165) hp 10/10, kit +
  bronze pickaxe in bag, M56; recent pick/swing + portal messages show it is
  actively driven by another agent.

Goals (fleet-wide):
1. wgelyjrqwen — raise Combat 8→20 with an interleaved training leg.
   Why: this sweep it repeatedly sat at 1–6/13 hp next to the men (no food, eat
   branch inert); GOALS 10-22 research established combat ~20+ as the unlock
   for 9gp Farmers and fewer stuns at the current spot. Plan: alternate the
   castle-men grind (3222,3218) with the verified duck/goblin cluster
   (3252,3230), style cycle [0,1,3] via sendSetCombatStyle (qwensmith's proven
   pattern, 0 deaths at C3→29); bank coins once bag gp > 2,000 (death scatters
   the bag, death.rs2). Risk: failed picks still hit for 1hp while training;
   stop the leg if any "Died" line appears. No new mechanic; owner: wgelyjrqwen.
2. qwensmith — enforce the 28-slot rule on the Varrock loop.
   Why: observed banking/smithing on a 10-ore bag with 16 free slots — Liam's
   10-23 instruction is fill toward 28 before any transport leg. Plan: mine to
   ore 27 + hammer, then walk the existing legs (Varrock West anvil/bank,
   3188,3421 / 3185,3436); ~2× fewer trips per ore mined. Risk: none new —
   same safe-mine loop. Owner: qwensmith.

Escalations:
- wgelyjrqwen AT-RISK decision: caretaker parked it per §A.4 (hp falling
  6→2/13 between reads, zero food); §1 has no matching fix; watchdog could only
  relaunch the same castle target (it did — now recovering, 0 deaths). Needed:
  owner sign-off on goal 1 (training leg), and a call on kebab sustain — the
  thieving.md loop (seller (3273,3180), toll gate bidirectional, 10–20gp)
  exists, but Al Kharid puts a combat-8 bot in L9-warrior range, which §B's
  death-route rule says is the human's call, not mine.
- qwenfish feather drain (monitor only): feathers 24→8 during one sweep while
  salmon ate down 19→2 — the Gerrant top-up tax is unchanged; no action.

## Fleet sweep 2026-10-24 17:15
Second sweep. Supervisor: 1 watchdog (pid 419382). All 10 runners + 9 scripts
alive (qwenrune runner-only by design). 1 "dead" line this sweep (wgelyjrqwen,
below); 0 "Died" lines in every other script log.

- qweness1 HEALTHY — M83, mine-fill loop (icefields ↔ E Varrock); stock
  12,605 → 13,388 (+783). No repairs.
- qweness2 HEALTHY — M83, same loop; stock 12,330 → 13,005 (+675). No repairs.
- qweness3 HEALTHY — M82, same loop; stock 11,769 → 12,417 (+648). No repairs.
- qweness4 HEALTHY — M82, same loop; stock 11,797 → 12,445 (+648). No repairs.
- qwenflax HEALTHY — Seers pick→bank loop; stock 21,756 → 23,240 (+1,484).
  No repairs.
- wgelyjrqwen AT-RISK → PARKED + watchdog-relaunched (only repair this sweep).
  hp 6/13 (17:01) → 3/13 (17:03), no food in bag, L2 men netting 1 dmg per
  failed pick; **died 17:09:15** (death #1 this sweep, castle men
  (3217,3219); ~1,281 gp + iron axe dropped at the corpse, boot gp=50). Parked
  per §A.4, watchdog relaunch 17:13:46; verified boot (3220,3219), 12/13
  climbing, earning again (31 picks by 17:14:50), T97. Attempt 1/2 this sweep.
- qwenfish HEALTHY — F99/C99, cycle 246+, bag full → heading to bank at
  Draynor (17:13). Do not touch.
- qwensmith HEALTHY — M99/S81/A30 iron loop, cycle 20, "bank loop healthy";
  "Mine rejected" spam = §1-row-8 SDK false-negative, NOT a stall.
- qwenguard HEALTHY — C116/P71 cow grind, banking loot at Draynor. Do not
  divert.
- qwenrune RUNNER-ONLY — untouched; at tower (3103,3165), M56, kit + bronze
  pickaxe in bag, actively driven by another agent (its essence loop finished
  08:09, banked 984).

Goals (fleet-wide):
1. qwensmith — enforce the 28-slot rule on the Varrock iron loop (carried from
   the 16:31 sweep; still not enforced — this sweep the script paused at
   iron 22 with ~4 slots spare). Why: Liam's 10-23 instruction is fill toward
   28 before banking; pausing at 22 ore leaves ~4 slots unused per cycle and
   ~2× more transport legs per ore mined. Plan: mine until the bag is full
   (~26 ore + hammer + pickaxe = 28 slots), then the existing legs — Varrock
   SE mine (3285,3365) → Lumbridge furnace (3225,3256) → Varrock West
   anvil/bank (3188,3421 / 3185,3436); all coords from fleet-ops §3, verified
   this sweep (bot observed in the mine at (3293,3355) with smelt messages at
   the furnace). No new mechanic; impurity already handled (~3 ore/bar).
   Risk: none new — same safe-town loop, 0 deaths in the current log.
   Owner: qwensmith.
2. Feeders — bank stockpile targets: each essence feeder (qweness1–qweness4)
   to 15,000 banked; qwenflax to 25,000. Why: the feeders are the committed
   on-demand buffer for wgelyjr's crafting (fleet-ops §3) and stock is
   drifting without a target (12.4k–13.4k essence, 23.2k flax). Plan: no route
   change — keep the current loops (mine→bank: E Varrock hub (3253,3421);
   Seers field (2742,3445) → bank (2724,3494) → wheel (2711,3469), fleet-ops
   §3 coords); caretaker checks the "banked; stock" line each sweep and flags
   any feeder with zero progress for 2 consecutive sweeps. At the current
   rates (~1.1–1.5k/hr essence, ~2.1k/hr flax) the targets land within ~3 h of
   runtime. Risk: none new — safe-town banking, proven mine↔portal loop, 0
   feeder deaths in the current logs. Owner: qweness1, qweness2, qweness3,
   qweness4, qwenflax.

Escalations:
- wgelyjrqwen AT-RISK recurrence (2nd consecutive sweep). Observed: hp falling
  6/13 → 3/13 between cli reads ~2 min apart, zero food in bag, passive L2
  men netting 1 dmg/hit on failed picks; the bot then died 17:09:15 (death #1
  this sweep, castle men (3217,3219)) before my park SIGTERM landed — ~1,281
  gp + iron axe at the corpse (boot gp=50). Tried: parked once per §A.4
  (pkill; watchdog relaunched 17:13:46; attempt 1/2) — same action as the
  16:31 sweep, and it is again recovering (12/13, earning). Still pending
  from 16:31, needs owner decision: (a) sign-off on the combat 8→20 training
  leg at the verified duck/goblin cluster (3252,3230); (b) a food-sustain
  call — the kebab loop (seller (3273,3180), per learnings/thieving.md) is a
  death-routed path for a combat-8 bot, so §B makes it the human's call;
  alternative is crew food from qwenfish's Draynor bank (item handoff =
  human's call per §6); otherwise accept chip-damage and a periodic death
  that scatters the bag.

## Fleet sweep 2026-10-24 20:01
Third sweep. Supervisor: 1 watchdog (pid 419382). All 10 runners + 9 scripts
alive (qwenrune runner-only by design). 0 "Died" lines in any script log
since its last launch. Only repair: the wgelyjrqwen AT-RISK park + watchdog
relaunch (below). All five feeder stockpile targets set at 17:15 REACHED.

- qweness1 HEALTHY — mine-fill loop (icefields ↔ E Varrock), M82→86; stock
  13,388 → 16,601 (+3,213). 15,000 target reached. No repairs.
- qweness2 HEALTHY — same loop, M83→86; stock 13,005 → 16,353 (+3,348).
  Target reached. No repairs.
- qweness3 HEALTHY — same loop, M82→85; stock 12,417 → 15,765 (+3,348).
  Target reached. No repairs.
- qweness4 HEALTHY — same loop, M82→85; stock 12,445 → 15,793 (+3,348).
  Target reached. No repairs.
- qwenflax HEALTHY — Seers pick→bank loop; stock 23,240 → 29,568 (+6,328).
  25,000 target reached. No repairs.
- wgelyjrqwen AT-RISK (3rd consecutive sweep) → PARKED + watchdog-relaunched
  (only repair this sweep). hp 6/13 (20:02) → 5/13 (20:06), 1-dmg hits from
  the L2 men, no food in bag; **Thieving 99 (MAX, up from T97)**, C8/Atk13.
  Parked per §A.4 (pkill 20:07:30, KILL alone); watchdog relaunched 20:08:50
  (pid 530318, attempt 1/2); verified boot (3217,3218), Life 20 stable (0 new
  deaths), earning again (32 picks by 20:09:57; coins 1,032 → 1,767).
- qwenfish HEALTHY — F99/C99, cycle 246→353, T61→77 (now self-funding
  feathers by thieving + Port Sarim top-ups); full loop observed this sweep:
  bank (8/28) → fish to 27/28 → cook at the range (3230,3196) → bank at
  Draynor. ~19 fish/cycle, ~33 min/cycle. Note: the "caught 1 this cycle"
  counter undercounts (bag delta shows ~19) — a display bug in its script,
  not a stall. Do not touch.
- qwensmith HEALTHY — M99 (MAX), S81→83, C29→31 (A30/Def24/Str26/HP28);
  smelting at the Lumbridge furnace (12 bars from 22 ore, observed at
  (3226,3255)) + smithing iron chainbodies at the Varrock West anvil. No
  repairs.
- qwenguard HEALTHY — C116→118 (A94/Def94/Str97/HP95), P70→71, 73 kills this
  run, cow fields (3258,3288), hp 95/95, 7 cowhides + 6 cooked meat in bag.
  Do not divert.
- qwenrune RUNNER-ONLY — untouched; at tower (3103,3165) hp 10/10, M56, kit +
  air talisman + bronze pickaxe in bag (23 slots free); its essence loop
  ended 08:09 (banked 984); actively driven by another agent.

Goals (fleet-wide):
1. qwensmith — Smithing 83→85 on the existing iron loop (the rune-tier gate).
   Why: Mining is MAX (99) — Smithing is the level gate left on the gear
   ladder, and GOALS.md "Gear progression" sets S85 as the rune-gear
   threshold; the loop already produces bars + chainbodies (verified this
   sweep: 12 bars from 22 ore at the furnace, chainbody batch at the VW
   anvil). Plan: no route change — SE Varrock mine (3285,3365) → Lumbridge
   furnace (3225,3256) → Varrock West anvil/bank (3188,3421 / 3185,3436)
   (fleet-ops §3; furnace + anvil positions verified this sweep); keep
   batching iron chainbodies until S85, then reassess the rune tier
   (32,000 gp pickaxe + runite ore = a separate save-up decision). Risk:
   none new — same safe-town loop, 0 deaths in the current log; at the
   current rate (S81→83 in ~2h45m) S85 lands within ~6 h of runtime.
   Owner: qwensmith.
2. qwenguard — route-verify the Lumbridge→Mort Myre trip (pre-step of the
   owner-set nature-talisman goal). Why: the owner-set talisman goal
   (GOALS.md "qwenguard", 2026-10-24) is explicitly blocked on route
   verification — "VERIFY THE ROUTE before switching the loop (fleet-ops §5:
   no guessed coords; first trip walked with cli watch)"; the necrofiends
   ring the swamp, so the approach is the risk, not the vamps. The tank is
   now C118/HP95 — a wide margin over the C109 of the goal's snapshot. Plan:
   pause the cow loop (re-entrant, safe to kill — fleet-ops §3), ONE walk
   from the cow fields (3258,3288 — verified by cli this sweep) to the
   owner-set goal's vamp reference (Mort Myre m56_54, sample (3585,3478) per
   wiki/npcs/vampire.md), cli-watched leg by leg, logging waypoints +
   necrofiend sightings + travel time; return to the cow fields and resume
   the grind. No combat retarget this sweep — the vamps loop starts only
   after the route is proven (holy symbol equipped, fast loot pickup, per
   the owner-set plan). Risk: necrofiend aggro on the approach — retreat
   gate = turn back on first aggro; a C118 tank with 6 cooked meat survives
   a test fight. Owner: qwenguard.
3. wgelyjrqwen — combat 8→20 training leg (CARRIED, pending owner sign-off).
   Why: 3rd consecutive AT-RISK sweep; new this sweep — Thieving is 99
   (MAX), so the xp engine is done and the bot's remaining value is coin
   income (1,767 gp in bag), which the chip-damage treadmill keeps
   scattering (Life 20; the 17:09 death lost ~1,281 gp + axe). Plan
   (unchanged from the 16:31 sweep): alternate the castle-men grind
   (3222,3218 — learnings/thieving.md) with the verified Lumbridge
   goblin/duck cluster (3252,3230 — learnings/combat.md "Safe Training
   Locations"), style cycle [0,1,3] via sendSetCombatStyle (qwensmith's
   proven pattern, 0 deaths at C3→29); bank coins once bag gp > 2,000
   (death scatters the bag, death.rs2). Not a death route: the cluster is a
   verified safe-town spot (the 10-23 train-verify walk reached it cleanly,
   toll S→N paid; the bot carries 1,767 gp for crossings), not aggressive
   mobs. Risk: failed picks still hit for 1 hp while training; stop the leg
   if any "Died" line appears. Owner: wgelyjrqwen.

Escalations:
- wgelyjrqwen AT-RISK — 3rd consecutive sweep (16:31, 17:15, 20:01); owner
  decision still pending from 16:31. Observed this sweep: hp 6/13 → 5/13
  between cli reads, 1-dmg hits from L2 men, zero food in bag, T99 (now
  MAX), Life 20 (last death 17:09, ~1,281 gp + iron axe at the corpse).
  Tried: parked per §A.4 (pkill 20:07:30; watchdog relaunch 20:08:50,
  attempt 1/2; verified boot + earning, 0 new deaths). §1 has no matching
  fix for foodless chip damage at a passive-mob spot. Needed: (a) sign-off
  on goal 3 (training leg at (3252,3230)); (b) a food-sustain call — the
  kebab loop (seller (3273,3180), learnings/thieving.md) is a death-routed
  path for a combat-8 bot (§B: the human's call); the alternative is crew
  food from qwenfish's Draynor bank (item handoff = the human's call per
  §6); otherwise accept chip damage and periodic bag-scattering deaths.
- qwenfish feather drain (monitor item from 16:31) — RESOLVED by the bot
  itself: it now self-funds feathers by thieving (T61→77, "short on coins —
  thieved, coins now N" then "Bought Feather x18 of 40" in the cycle log),
  so the Gerrant top-up tax is no longer the constraint. No action.
- qwenfish low-HP monitor (new, no action by me): observed hp 8/28 with 21
  salmon in bag and zero eat lines in the log — the 10-22 "eat at <70% HP"
  fix is not visible in the current script. It has survived this loop at
  low HP for hours (0 respawns, safe-town routing), so it is not AT-RISK by
  §A.4; but if the owner wants it, the eat branch needs re-adding. Script
  edits are out of my remit for a HEALTHY bot (§B); flagging only.

## Fleet sweep 2026-10-24 23:23

Fourth sweep. Supervisor: 1 watchdog (pid 419382). All 10 runners + 9 scripts
alive (qwenrune runner-only by design). 3 deaths in the window, all
wgelyjrqwen (below); 0 elsewhere.

- qweness1 HEALTHY — mine-fill loop (icefields ↔ E Varrock), M87→88; stock
  16,601 → 19,733 (+3,132). No repairs.
- qweness2 HEALTHY — same loop, M88; stock 16,353 → 19,485 (+3,132). No
  repairs.
- qweness3 HEALTHY — same loop, M87; stock 15,765 → 18,897 (+3,132). No
  repairs.
- qweness4 HEALTHY — same loop, M87; stock 15,793 → 18,925 (+3,132). No
  repairs.
- qwenflax HEALTHY — Seers pick→bank loop, c3 (6 respawns, unchanged since the
  18:45 assessment); stock 29,568 → 35,840 (+6,272). No repairs.
- wgelyjrqwen AT-RISK (4th consecutive sweep) + 2+ deaths at one spot →
  PARKED + watchdog-relaunched (only repair this sweep). Three deaths in the
  window: 20:31:34 and 22:17:21 (log: "died en route to (3222, 3218)" — both
  ~10 s after Draynor bank runs deposited 2001/2000 gp; bag scattered, boot gp
  102/81) and one more between 23:09 (hp 6/13 at (3219,3219)) and 23:16 (Life
  28→29), during the 69 s scriptless window of my park — the bot stood idle in
  the courtyard. Parked per §A.4 (pkill 23:12:45, KILL alone); watchdog
  relaunched 23:13:54 (pid 595419, attempt 1/2); verified boot (3220,3215) +
  re-earning (821 gp by 23:19:42, 0 new deaths since). T99 (MAX), C8, 68% stun
  rate (121 stuns / 179 picks).
- qwenfish HEALTHY — F99/C99/T77, hp 16→19/28 (recovered), at the Draynor bank
  (3092,3246) at sweep time, 9 salmon in bag, cycle 417+. No repairs; the 20:01
  eat-branch monitor stands (no explicit eat lines, but HP is recovering — no
  action).
- qwensmith HEALTHY — M99 (MAX), S83→84, C31; iron loop: "Smelted 5 bars (used
  22 ore); Smithing 84" at the Lumbridge furnace, then smithing iron
  chainbodies at the VW anvil. "Mine rejected" spam = the bag-full phase (gate
  on deltas), NOT a stall. No repairs.
- qwenguard HEALTHY — C118 (A94/Def95/Str97/HP95), P71→72, 84 kills this run,
  cow fields (3252,3274), hp 95. No repairs. Do not divert.
- qwenrune RUNNER-ONLY — untouched; at tower (3103,3165) hp 10/10, M56, C3;
  actively driven by another agent.

Goals (fleet-wide):
1. wgelyjrqwen — stop the death bleed: eat branch + bank-threshold fix (owner
   sign-off P3 step 1) + a death-location logger before any retarget.
   Why: 4th consecutive AT-RISK sweep; 3 deaths this window each scattered
   ~2,000 gp + the iron axe (bank total 14,006 over 7 runs vs boot-gp resets);
   the 68% stun rate (121 stuns / 179 picks, T99 vs L2 men) is the "stun
   spiral" the owner flagged at 18:45. Plan (P3, GOALS 18:45): (a) eat branch
   at ≤10 hp — needs food in bag (source is the owner's call: qwenfish
   Draynor-bank crew-food handoff, or the kebab loop — both the human's call
   per §B/§6); (b) bank threshold 2,000 → ~500 gp so a death scatters less;
   (c) log the death location on every death — this window's deaths carry no
   corpse coords, and diagnose the real killer before changing the route: the
   23:16 live cli census at the castle spot (3225,3216) shows only passive
   L1/L2 men/women/rats/imps — the walking.md "aggressive Dark Wizards
   (3220,3220)" warning is NOT corroborated by the census and conflicts with
   the wiki (dark wizard: Aggressive No, (3084,3236) etc.); the known chip
   source is L2 men fighting back on failed picks (GOALS 10-22). No retarget
   (rogue/knight/hero ladder) until deaths stop. Risk: chip damage continues
   until the eat branch lands; the men are passive L2 — no new hazard. Owner:
   wgelyjrqwen.
2. qwensmith — P2: switch the mine target to the AK wildy-edge node
   (3304,3305) and smith the guard's first adamant platebody batch.
   Why: owner's 18:45 P2 (fleet-ops §3) — the P1 dragon tier "waits for P2
   gear first"; the smith is M99/S84/C31, above the L14-scorpion ring's c27+
   defensive threshold (learnings/mining.md), and has a proven 90-min run on
   this exact node (10-23: 480 ores, 0 deaths, bronze pick — now Adamant
   2.33×). Plan: mine mithril/adamantite/coal (#2102/#2103/#2096/#2097,
   learnings/mining.md) at (3304,3305)/(3305,3304) to a 27–28-slot bag (the
   28-slot rule — still not enforced; this sweep it paused at 20–22 ore);
   smelt at the Lumbridge furnace (3225,3256); smith the first adamant
   platebody batch for qwenguard at the VW anvil (3188,3421); bank ore/bars
   at the AK bank (3268,3167, safe side of the toll gate (3268,3227), 10 gp
   per crossing — the bot carries a coin buffer from the current loop). Risk:
   the 7× L14 scorpions aggro around the node (defensive style, proven margin;
   HP<8 retreat per the 10-23 loop); the toll gate is bidirectional — keep the
   coin buffer. No new mechanic (node + bank proven 10-23). Owner: qwensmith.
3. qwenguard — P1 step 1: route-verify the BK reference points and dump the
   live BK census; NO combat retarget yet. Why: the owner's 18:45 P1 kill-tier
   ladder starts at black knights (c33/hp42, Aggressive No, 50-tick respawn —
   wiki/npcs/black-knight.md); fleet-ops §5: first trip walked with cli watch,
   no guessed coords. Today's repo census (m*.jm2, npc id 178) found the wiki
   BK table partially stale vs the deployed world: only 2 singles in the
   Edgeville area — (3101,3220) [m48_50.jm2:6687, verified today] and
   (3019,3182) [m47_49.jm2, verified today] — plus 3 wilderness singles; no
   dense BKF cluster found. Plan: pause the cow loop (re-entrant, safe to
   kill — fleet-ops §3), ONE cli-watched walk from the cow fields (3252,3274 —
   verified by cli this sweep) to (3101,3220), dumping nearby NPCs en route
   (live BK census — the deployed world can diverge from the repo, as the west
   AK bank did), log waypoints + travel time, return to the cow fields and
   resume the grind. The ladder-rung decision (sparse-single BK farming vs
   going straight to blue dragons) goes to the owner next sweep with the live
   census. Risk: the approach crosses the Edgeville area — a C118 tank with
   food; no combat expected (BK passive per wiki; the dark wizards there are
   passive per the wiki, (3084,3236)). Owner: qwenguard.

Escalations:
- wgelyjrqwen AT-RISK — 4th consecutive sweep (16:31, 17:15, 20:01, 23:23).
  Observed this sweep: 3 deaths in the window — 20:31:34 and 22:17:21
  ("died en route to (3222,3218)", each ~10 s after a Draynor bank run
  deposited 2001/2000 gp; ~2,000 gp + iron axe scattered each time, boot gp
  102/81) and one more between 23:09 and 23:16 while its script was killed
  (Life 28→29; last seen hp 6/13 at (3219,3219)). Tried: parked once per
  §A.4 (pkill 23:12:45, KILL alone; watchdog relaunch 23:13:54, attempt 1/2;
  verified boot + re-earning, 0 new deaths by 23:23). The idle-window death
  means deaths continued after relaunch — noted per §A.4, moving on, no
  second park. §1 has no matching fix for passive-mob chip damage; the
  walking.md dark-wizard warning at (3220,3220) is uncorroborated (today's
  live census: no wizards at the castle; wiki: passive). Needed: owner to
  implement/sign off goal 1 (eat branch — food source is the human's call:
  crew-food handoff from qwenfish's Draynor bank, or the kebab loop; bank
  threshold 500 gp; death-location logger), after which the P3 ladder can
  proceed.
- (monitor, no action) qwenfish low-HP — hp 16/28 at 23:02 with 9 salmon in
  bag and no explicit eat lines in the log (the 10-22 "eat at <70%" fix is not
  visible in the current script); hp recovered to 19/28 by 23:09 (Draynor
  bank). Not AT-RISK (safe-town routing, 0 respawns); if the owner wants it,
  the eat branch needs re-adding — script edits on a HEALTHY bot are outside
  caretaker repair (§B).

## Fleet goals assessment 2026-10-24 ~18:45 (with wgelyjr — supersedes stale short-terms below until sweeps re-baseline)

Ground-truth snapshot (live cli): guard c118 (Atk94/Str97/Def94, Pray71, Cook21, **all other skills 1**) | smith Mine99/Smith83 c31 | fish Fish99/Cook99/Th77 c25 | qwen Th99/WC82 c8 (20 respawns on file) | rune Mine56 c3 | qweness1-4 lvl-1 feeders | flax c3 (6 respawns, 26k flax banked).

**Core problem: maxed assets running novice loops.** Priorities:

| P | Bot | Goal | Plan (verified sources only) | Risk/gate |
|---|-----|------|------------------------------|-----------|
| 1 | qwenguard | **Kill-tier ladder** — cows are beneath c118 | black knights (c33/hp42, wiki/npcs/black-knight.md) -> blue dragons (c111/hp105) -> KBD (c276, 150t respawn, lair rolls randomjewel incl. nature ~1/2048 + ultrarare band). Nature-talisman goal re-homes from vamps to KBD once reached | BKF fortress gate + dragon magic vs pr71 - test one pull, eat policy, gear from P2 first |
| 2 | qwensmith | **Gear up the crew + high-tier pipeline** | mine coal (30) / mithril 55 / adamant 70 at the AK wildy-edge node (learnings/mining.md: (3304,3305)/(3305,3304) & coal 2096/2097, scorpion ring - "combat 27+ defensive style" margin, he is c31); smelt adamant platebodies (smith 83>=80 - VERIFY product levels in configs) for guard+fish; bars -> crew, dupes -> shop | scorpions on approach; smith shop overstock (learnings/shops.md) before counting gp |
| 3 | wgelyjrqwen | **Cash engine: thieving ladder + survive** | fix the stun spiral FIRST (it has 20 respawns at hp21): eat branch at <=10hp, bank threshold down to ~500gp (954 in bag now); men -> rogues (th32, 25-40gp) -> knights (th55, 50gp, wiki/npcs/knight-of-ardougne.md) -> heroes (th80, c69/hp82 non-aggressive, 200-300gp, wiki/npcs/hero.md) | WC82 yew branch (cemetery S of Edgeville bank, wiki/skills/woodcutting.md) parked: npc log buy-prices unverified, thieving pays better |
| 4 | qwenfish | **Fishing Guild activation + crew larder** | qualifies (Fish99>=68, wiki/skills/fishing.md): swordfish(50)/shark(76) at guild spots + in-guild range + Ardougne bank = cooked-food pipeline for P1/P3 (sharks for guard); Thief77 -> knights between casts (same city) | guild members-only gate + 27-ish req items (bait/harpoon) check; big-net casket->talisman claim is UNVERIFIED server-side (only trail scripts reference caskets) - verify before treating as a nature source |
| 5 | qwenrune | (other agent's bot) notes only | Mine56 -> can take mithril shift from smith; RC1 still despite "runecrafter" role - craft from feeder stock is the obvious sync | do not retarget; surface in GOALS only |
| 6 | qwenflax | **Stop dying, decide the flax glut** | 6 respawns: grep deaths, find killer on the Seers field/road, fix route before scaling; 26k flax has no sink - human decision: wgelyjr fletch run vs GE listing vs retire bot to fishing support | flax npc-buy prices unverified; do not mass-sell into empty economy |

**Economy read:** the GE has zero orders - cash comes from thieving + kill loot + smith output sold into npc shops (mind overstock). Food supply (P4) is the current crew bottleneck for P1/P3 tiers - fish bot first on the guild, guard ladder waits for sharks.

**Sweep instructions:** implement one priority at a time per bot, verify flagged items (marked VERIFY/UNVERIFIED) against configs before coding, log outcomes here. P2 gear precedes P1 dragons; P3 eat-branch precedes P3 ladder.


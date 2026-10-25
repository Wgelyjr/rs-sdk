# QoL Client Feature Suite — Implementation Plan

RuneLite-style quality-of-life features for the LostCity (rev 289) TypeScript webclient,
all configurable through a new in-game **Client Options** settings panel.

Work is delegated to `alibaba-token-plan/qwen3.8-flash` subagents in waves. This document is
the single source of truth for architecture, feature specs, file ownership, and acceptance
criteria. Line numbers refer to commit `b05622561` (branch `staging`) and will drift — treat
them as landmarks, re-grep before editing.

## Steps

- [ ] Wave 1 — C1 Foundation: qol plugin layer + hook wiring in Client.ts/GameShell.ts
- [ ] Wave 2 — C2 Settings panel UI (`QolSettingsPanel.ts`)
- [ ] Wave 2 — C3 Shift-click drop + Menu Entry Swapper (`plugins/MenuSwapper.ts`)
- [ ] Wave 2 — C4 XP drops + XP tracker (`plugins/XpDrops.ts`)
- [ ] Wave 2 — C5 Camera unlock + scroll zoom + middle-drag (`plugins/CameraUnlock.ts`)
- [ ] Wave 2 — C6 Display scaling + FPS unlock (`plugins/Display.ts`, owns `GameShell.ts`)
- [ ] Wave 2 — C7 Opponent HP + stat timers + HP/prayer orbs (`plugins/InfoOverlays.ts`)
- [ ] Wave 2 — C8 Ground item labels + entity hider + tile markers (`plugins/WorldOverlays.ts`)
- [ ] Wave 2 — C9 Dialog keyboard support (`plugins/DialogKeys.ts`)
- [ ] Wave 2 — C10a Bank placeholders (`plugins/BankPlaceholders.ts`)
- [ ] Wave 3 — C10b Bank tabs & tags (`plugins/BankTabs.ts`)
- [ ] Integration: typecheck, tests, build, PATCHES.md, live smoke test

---

## 1. Ground rules (every chunk)

1. **Vendored code discipline.** `server/webclient` is vendored upstream LostCity. Only the
   Foundation chunk (C1) edits `Client.ts`; only C6 edits `GameShell.ts`. All hook edits are
   tiny and tagged `// qol:`. Every vendored-file touch gets a `server/PATCHES.md` entry.
2. **File ownership.** Each chunk owns exactly the files listed for it. Never edit files owned
   by another chunk (wave-2 agents run in parallel). `qol/plugins/index.ts` is created once by
   C1 with imports for ALL planned plugin files (stubs included) — nobody edits it afterwards.
3. **No top-level DOM access.** All `window`/`localStorage`/`canvas` use inside qol code must
   be behind `typeof window !== 'undefined'` guards or inside functions (precedent:
   `MobileKeyboard.ts`; the lite runner's `dom-shim.ts` shims localStorage at module scope).
4. **Plugin crashes must not kill the client.** Every hook dispatch in `Qol.ts` is wrapped in
   try/catch; a failing plugin is disabled after N repeated errors and logged once.
5. **Bot compatibility.** The bot browser client (`bot.ejs`, built with
   `process.env.ENABLE_BOT_SDK === 'true'`) shares `Client.ts`. `StateCollector.collectMenuActions`
   (bot/StateCollector.ts:1391) reads `menuOption/menuAction/menuNumEntries` — menu reordering
   must be suppressed in bot builds (`ctx.isBotBuild()`). Never rename/remove Client members
   (the bot bridge reads ~54 methods / ~36 private fields). `LiteClient.ts` does not share
   Client.ts and must stay untouched.
6. **Definition of done per chunk.** `bunx tsc --noEmit -p server/webclient/tsconfig.json`
   reports **zero errors in your own files**. The baseline currently has 3 pre-existing errors
   you must NOT fix and must ignore: `bot/StateCollector.ts:1040`, `lite/income.ts:710`,
   `lite/probe-locs.ts:66`. Other agents' half-finished `qol/plugins/*.ts` files may show
   errors while you work — ignore anything you don't own. Do not run `bun run build` (the
   integrator does). Do not `git commit`.
7. **Report.** Each chunk ends with a short report: files touched, settings added, hooks used,
   manual test recipe, known gaps.

## 2. Architecture

New directory `server/webclient/src/client/qol/`:

```
qol/
├── Qol.ts               # lifecycle: init(client), dispatch for every hook, error containment
├── QolConfig.ts         # setting registry + localStorage persistence ('rs-qol-v1')
├── QolHooks.ts          # typed event bus: on/filter/map with priorities
├── QolContext.ts        # facade handed to plugins: typed helpers + raw client escape hatch
├── QolGraphics.ts       # Pix2D/PixFont wrapper: rects, text w/ shadow, sprites, clip
├── QolSettingsPanel.ts  # canvas-drawn options UI (body implemented by C2; stub from C1)
├── index.ts             # createQol(client) + plugin registry imports
└── plugins/
    ├── index.ts         # imports every plugin file, calls register(ctx) — created by C1, frozen
    ├── MenuSwapper.ts        # C3
    ├── XpDrops.ts            # C4
    ├── CameraUnlock.ts       # C5
    ├── Display.ts            # C6
    ├── InfoOverlays.ts       # C7
    ├── WorldOverlays.ts      # C8
    ├── DialogKeys.ts         # C9
    ├── BankPlaceholders.ts   # C10a
    ├── BankTabs.ts           # C10b (stub until wave 3)
    └── (each file: export default { name, register(ctx) })
```

### 2.1 Settings (`QolConfig`)

```ts
type SettingType = 'boolean' | 'choice' | 'slider' | 'color' | 'keybind' | 'text';
interface SettingDef {
    key: string;          // unique, dotted: 'menu.shiftDrop'
    section: string;      // panel category: 'Menu', 'Skilling', 'Bank', 'Visuals', 'Overlays'
    label: string;
    type: SettingType;
    default: boolean | number | string;
    choices?: string[];   // choice
    min?: number; max?: number; // slider
    tooltip?: string;
    hiddenInBotBuild?: boolean;
}
class QolConfig {
    define(def: SettingDef): void;
    getBool(key: string): boolean; getNum(key: string): number; getStr(key: string): string;
    set(key: string, value: boolean | number | string): void;   // persists + notifies
    onChange(key: string, cb: () => void): void;
    sections(): string[]; defs(section?: string): SettingDef[];
    exportJson(): string; importJson(s: string): void; resetAll(): void;
}
```

Persistence: single JSON blob in `localStorage['rs-qol-v1']`, written debounced (~500 ms),
loaded at init, unknown keys preserved, corrupt JSON → defaults. All DOM access guarded.

### 2.2 Hook surface (`QolHooks`, dispatched from `Qol.ts`)

| Hook | Kind | Dispatched from (landmark) | Purpose |
|---|---|---|---|
| `tick(dtMs)` | event | end of `Client.gameLoop()` (~4513) | per-logic-frame updates |
| `drawScene(g)` | event | end of `Client.gameDraw()` (~6395), clipped to viewport (4,4,512,334) | in-world overlays (XP drops, ground labels, HP bars, tile markers) |
| `drawTop(g)` | event | right after `drawScene` | full-screen UI (settings panel, trackers, orbs), draws over interfaces |
| `key(ch)` | consume | both `pollKey()` sites in Client.ts (~3867, ~5446) | dialog keys, panel navigation; `true` = swallow |
| `click({button,x,y,shift,middle})` | consume | top of the mouse-click handler that feeds `doAction` (~10860) | panel/bank-overlay input, tile marking |
| `wheel({dx,dy,x,y})` | consume | new `canvas.onwheel` listener in `GameShell.run()` | camera zoom, overlay scrolling |
| `xpGain({skill,oldXp,newXp,oldLevel,newLevel})` | event | `UPDATE_STAT` packet handler (~9252), before overwrite | XP drops/tracker |
| `menuBuilt(menu: QolMenuView)` | event | end of `buildMinimenu()` after the `_PRIORITY` sort (~5090) | shift-drop + MES reordering; **skipped in bot builds** |
| `hidePlayer(p)/hideNpc(n)/hideProjectile(p)/hideGroundItem(o)` | filter (any `true` wins) | `addPlayers`/`addNpcs`/`addProjectiles` loops in `gameDrawMain` (~6683) and the SET_OBJ ground-item add paths (~9833/~9905) + obj menu picking (~10172) | entity hider |
| `camera({pitch,distance} ) → {pitch,distance,minPitch,maxPitch}` | map | `camFollow` call site (~6705) and pitch clamps (~5759, ~4353) | camera unlock/zoom |
| `resizeCanvas(canvas,w,h)` | event | `GameShell.resize()` | display scaling |
| `framePace(nowMs) → extraSleepMs \| null` | map | outer loop in `GameShell.run()` after `mainredraw()` | FPS control (C6 owns GameShell and may restructure the loop instead) |

`QolMenuView` (safe view over the raw arrays `menuOption[]`, `menuAction[]`,
`menuParamA/B/C[]`, `menuNumEntries`):

```ts
interface QolMenuView {
    readonly count: number;
    text(i: number): string; action(i: number): number;
    paramA(i: number): number; paramB(i: number): number; paramC(i: number): number;
    find(pred: (text: string, action: number, i: number) => boolean): number; // index or -1
    move(from: number, to: number): void;
    promote(i: number): void;   // move(i, count-1) → becomes left-click action
    add(text: string, action: number, paramA?: number, paramB?: number, paramC?: number): void;
}
```

Menu semantics: entries render bottom-up; the **last** array entry is the menu top and the
left-click action (`doAction(this.menuNumEntries - 1)`, ~10940/10978). Reordering the arrays
is therefore all shift-drop/MES needs — `doAction` and packets stay untouched.

`QolContext` (passed to `register(ctx)`):

```ts
interface QolContext {
    config: QolConfig; hooks: QolHooks; g: QolGraphicsFactory;
    client: any;                 // escape hatch — prefer the typed helpers below
    isBotBuild(): boolean;       // process.env.ENABLE_BOT_SDK === 'true'
    ingame(): boolean;
    shiftHeld(): boolean; altHeld(): boolean; ctrlHeld(): boolean;
    loopCycle(): number; nowMs(): number;
    localPlayer(): { x: number; z: number; level: number } | null;  // world coords via existing helpers
    fonts(): { p11: PixFont; p12: PixFont; b12: PixFont };          // client fonts
    projectTile(worldX: number, worldZ: number): {x,y} | null;      // Client.projectTileToScreen (2343)
    projectEntity(kind: 'npc'|'player', index: number): {x,y} | null;
    npcs(): Array<{ index: number; npc: ClientNpc }>;               // active list
    players(): Array<{ index: number; player: ClientPlayer }>;
    groundItems(): Array<{ level,x,z, id, count }>;                 // walk groundObj LinkLists (484)
    objType(id: number): { name: string; cost: number; members: boolean } | null;
    skillName(stat: number): string; statXp/statLevel/statBase(stat): number;
    isBankOpen(): boolean; getBankItems(): Array<{slot,id,name,count}>; // Client 1758/1795
    getDialogOptions(): Array<{index,text,componentId,buttonType}>;     // Client 2587
    clickDialogOption(n: number): void;                                 // Client ~2542 helper
    sendComponent(comId: number): void;                                 // IF_BUTTON packet
    menuTarget(): { area: number; comId: number; slot: number } | null; // best-effort hover context
    chatCommand(cmd: string, cb: () => void): void; // foundation wires '::qol' etc. via existing :: dispatch (~5561)
}
```

### 2.3 Wiring in vendored files (C1 only; each edit tagged `// qol:`)

`Client.ts`:
- import `createQol`; field `private qol` initialized at end of `maininit()` (assets/fonts loaded).
- hook dispatches per table above (~14 small insertions).
- `::qol` chat command toggles the settings panel (piggyback existing `::` dispatch ~5561).

`GameShell.ts`:
- `canvas.onwheel` listener → qol wheel hook (remove in `shutdown()`).
- Track `shiftHeld/altHeld/ctrlHeld` from `e.shiftKey/altKey/ctrlKey` in mouse+key handlers and
  expose them (do NOT route shift through `keyHeld`/`keyQueue` — ch<30 gets zeroed and would
  leak control chars into chat; KeyCodes Shift ch=6 is currently dead code).
- Capture middle mouse (`e.button === 1`) as `middleButton` state + event to qol (vanilla maps
  everything non-right to left; keep vanilla behavior otherwise).
- `resize()` → `resizeCanvas` hook; outer run-loop → `framePace` hook.

`server/PATCHES.md`: add a webclient section entry "QoL plugin hooks" listing every `// qol:`
site with a `grep -n "qol:" src/client/Client.ts src/client/GameShell.ts` verification step.

## 3. Settings panel (C2)

Canvas-drawn (Pix2D/PixFont via `QolGraphics`), 2004-styled: dark parchment/stone palette to
match the client (sample colors from existing sprites, e.g. menu background `0x5d5447`,
`SCROLLBAR_TRACK 0x23201b`). Layout: ~500x330 panel centered on the viewport; left column =
sections; right = scrollable setting rows rendered generically from `QolConfig.defs()`:

- boolean → clickable checkbox; choice → cycle button showing current value; slider → track +
  drag handle; color → swatch cycling a palette + `#rrggbb` text input; keybind → click-to-capture;
  text → single/multi-line input using the `key` hook for typing (backspace, printable chars).
- Footer: `Reset all`, `Export`, `Import` (export/import via a text field), close X.
- While open: consume all clicks (`click` hook, high priority) and keys; ESC closes; game keeps
  running behind it.
- Entry points: **F11** (in `CanvasEnabledKeys` already), `::qol` chat command, and a small
  always-visible gear button drawn in the strip between viewport and side panel (~x 518-548).
- Sections come from the config registry, so every later chunk's settings appear automatically.

Settings inventory (keys defined by each owning chunk):

| Section | Keys (owner) |
|---|---|
| Menu | `menu.shiftDrop` bool=true, `menu.shiftDropExclude` text='' (C3); `menu.swapperEnabled` bool=false, `menu.swapRules` text='' (C3) |
| Skilling | `skilling.xpDrops` bool=true, `skilling.xpDropSize` choice=true, `skilling.xpDropColor` color (C4); `skilling.xpTracker` bool=true, `skilling.xpTrackerPos` choice (C4); `skilling.dialogKeys` bool=true (C9); `skilling.groundItems` bool=true, `skilling.groundItemMinValue` slider, `skilling.groundItemQuantity` bool, tier colors (C8) |
| Bank | `bank.placeholders` bool=true (C10a); `bank.tabsEnabled` bool=false, `bank.tagDefs` text (C10b) |
| Visuals | `visual.cameraUnlock` bool=true, `visual.zoomMin/zoomMax` slider, `visual.pitchMin/pitchMax` slider, `visual.wheelInvert` bool, `visual.middleDragRotate` bool=true (C5); `visual.displayScale` choice off/integer/fit (C6); `visual.fpsCap` choice 50/60/75/120/144/240/unlimited (C6); `visual.hidePlayers/hideNpcs/hideProjectiles/hideGroundItems` bool=false (C8) |
| Overlays | `overlay.npcHpMode` choice off/bar/exact, `overlay.npcHpScope` choice all/combat/target (C7); `overlay.statTimers` bool=true, position (C7); `overlay.orbMode` choice off/orbs/bars, `overlay.orbPos` choice (C7); `overlay.tileMarkers` bool=true, `overlay.tileMarkerColor` color (C8) |

## 4. Feature specs

### F1 Shift-click to drop (C3)
When shift is held and the hover menu is over an inventory/bank-side item, promote the entry
whose text matches `/^Drop/i` (or op action OP_HELD4/IF_BUTTON drop) to left-click. Implement
purely in `menuBuilt` using `menuTarget()`/entry text. `menu.shiftDropExclude`: comma-separated
item-name regexes that keep vanilla behavior (e.g. precious items). Right-click still shows the
full menu. Acceptance: shift+left-click a log drops it; without shift, left-click uses/equips as
vanilla; excluded items unaffected; no effect in bot builds.

### F2 Menu Entry Swapper (C3)
`menu.swapRules`: one rule per line, grammar `[@targetRegex] Swap<Over` — e.g.
`@bones Bury<Use` (left-click Bury on bones), `@banker Bank<Talk` , `Burn<Use`. Semantics: when
the hovered target name matches (best-effort from `menuTarget()` comId→item/NPC/loc name, else
match on entry target text embedded in menu labels like "Use Logs"), the entry containing `A`
ranks above the entry containing `B` (A nearer array end). Missing entries → rule no-ops.
`menu.swapperEnabled` master toggle, default OFF. Rules are case-insensitive substrings.
Acceptance: with rules `@bones Bury<Use`, left-clicking bones buries; invalid lines ignored
gracefully; vanilla order untouched when disabled.

### F3 XP drops (C4)
On `xpGain`, spawn a floating text at the right edge of the viewport (RS-style column just left
of the side panel, y starts ~40, each new drop pushes older ones down), rising+fading over
~2.5 s, color = white/green for gains (red never happens), optional skill-color. Size choice
small/medium/large maps to p11/p12/b12 fonts. Drops queue max ~12, oldest culled. Draw in
`drawScene` (skip when a main modal covers the viewport? still draw — configurable later).
Acceptance: chopping a tree shows "+25" style drops; no drops when setting off; zero GC churn
spikes (reuse array).

### F4 XP tracker (C4)
Sidebar panel (drawTop) anchored per `skilling.xpTrackerPos` (top-right of viewport default):
for each skill with XP gained this session — skill name, level (base→current if boosted),
XP gained, XP/hour (rolling 5-min window of timestamped gains), actions/hour (gains counted per
skill), XP to level, TTL to next level at current rate. Session-based; resets on logout
(`ingame()` false transition). Collapsible via a header click; compact (max ~8 rows,
highest-rate first). Acceptance: mine several rocks → tracker shows Mining XP/h + TTL; values
plausible vs elapsed time.

### F5 Dialog keyboard support (C9)
When a chat modal dialog is open (`client.getDialogOptions()` non-empty or a
"Click here to continue" BUTTON_OK/BUTTON_CONTINUE present):
- Space or Enter → click the default/first option (for multi-option dialogs, first option;
  for continue-dialogs, continue). Must not fire while chat input is open (`dialogInputOpen` /
  `chatInput` active) or the settings panel has focus.
- Digits 1-9 → click option N (index order = `getDialogOptions()` order); also draw small
  `[1]`..[n] prefixes over the option text in `drawTop` when `skilling.dialogKeys` is on.
- Escape → close modal (sendCloseModal equivalent).
Uses `key` hook (consume when handled) + `clickDialogOption`. Acceptance: fletching dialog —
press 2 clicks second option; "click to continue" advances with space; typing in chat unaffected.

### F6 Ground item text overlays (C8)
For each entry of `groundItems()` on the current level within the build area: project tile to
screen, draw `Name` (and `xCount` when >1 and enabled) centered above the stack, colored by
`objType.cost * count` tiers: <1k white, ≥1k yellow, ≥10k light purple, ≥100k pink,
≥1m red (RuneLite-ish; tier colors configurable, thresholds constants v1).
`skilling.groundItemMinValue` hides labels below a value (0 = show all). Stack label = top item
(match vanilla menu behavior, `groundItems()` provides the stack; label the most valuable item
in the stack — RuneLite behavior). Cap at ~60 labels/frame, nearest first. Skip when
`hideGroundItems` (entity hider) is on. Acceptance: drop items of varying value → colored
labels track them while walking; no labels when disabled.

### F7 Unlocked camera & scroll zoom (C5)
- Wheel (over viewport, no modal): adjust zoom = the `distance` term in `camFollow(pitch*3+600)`
  (~6705). Map to a zoom setting range `visual.zoomMin..zoomMax` (defaults 0.5x..4x of vanilla
  distance), smoothed over a few ticks (lerp) to avoid judder. `visual.wheelInvert`.
- Middle-mouse drag: rotate `orbitCameraYaw`/`orbitCameraPitch` directly (delta * sensitivity),
  bypassing the key velocity path; clamp pitch to `visual.pitchMin..pitchMax` (defaults 128..500
  vs vanilla 128..383 — verify what Pix3D tolerates without rendering artifacts; raise
  cautiously). `visual.middleDragRotate`.
- `visual.cameraUnlock=false` restores vanilla clamps and ignores wheel/middle entirely.
- Camera packets: the client throttles EVENT_CAMERA_POSITION already (~4641); unchanged.
Acceptance: wheel zooms smoothly in/out beyond vanilla limits with no scene culling glitches;
middle-drag orbits including near-top-down; toggling unlock off restores vanilla behavior
exactly.

### F8 Stretched mode / UI scaling (C6)
`visual.displayScale`: `off` (vanilla 765x503), `integer` (largest integer factor that fits the
window, crisp: canvas internal size stays 765x503, CSS size = 765k x 503k,
`image-rendering: pixelated`), `fit` (max CSS stretch, pixelated — replaces current blurry
`resizeToFit` behavior). Implement via `resizeCanvas` hook + a window resize listener inside
the plugin; do not fight `resizeToFit` — override canvas.style and internal size as needed and
call `Pix3D.setRenderClipping()` semantics only through existing `resize()`. Mouse coordinate
mapping: verify `GameShell.getMousePos` uses `getBoundingClientRect` scaling (it computes
absMouseX/Y) — fix scaling math **inside GameShell (C6 owns it)** if CSS scaling breaks clicks.
Acceptance: on a 1080p window, integer mode gives 2x crisp with working clicks everywhere
(viewport, side panel, chat, minimap); fit mode stretches; off = pixel-identical to today.

### F9 FPS unlocking (C6)
Investigate first: outer loop in `GameShell.run()` paces iterations at ~`deltime` (14 ms →
~70 Hz) and calls `mainloop()` (logic, accumulator-paced via `count += ratio`) then
`mainredraw()`; `tfps` adds an extra sleep capping ≤50. `visual.fpsCap` options:
50 (current default), 60, 75, 120, 144, 240, unlimited. Implementation freedom (C6 owns
GameShell): preferred approach = keep **logic** at its current accumulator rate while allowing
the outer iteration (and thus `mainredraw`) to run at the cap: shrink the sleep, but make the
`while (count < 256)` logic loop self-limiting by wall-clock so logic Hz stays constant
(measure with `::fpson` debug + bot regression: `bun test server/webclient/src/bot`). Camera
panning smoothness is the acceptance target; movement interpolation beyond existing 20 ms
tweening is a stretch goal, NOT required. Must not change game speed (verify: walk animation
traversal time, XP/h of a sample bot script unchanged). Acceptance: 120 cap measurably renders
~120 fps (fps counter), logic rate and bot tests unchanged; 50 cap = today's behavior.

### F10 Entity hider (C8)
Filters: `hidePlayers` (all except local), `hideNpcs`, `hideProjectiles`, `hideGroundItems`.
Applied at the `addPlayers/addNpcs/addProjectiles` filter points and ground-item add/pick paths.
Hidden entities must not draw overheads (chat, hitsplats, HP bars) — filter at the entity loop,
not the overhead pass. Ground items: hidden = not rendered AND not menu-pickable (consistent).
Acceptance: in a populated area each toggle removes exactly its category with no leftover
sprites/bars; combat you're in is still visible (local player never hidden).

### F11 Opponent HP bars (C7)
Server sends exact `health`/`totalHealth` with hitmarks (Client.ts ~10759-10819 npc,
~10492-10587 player; vanilla bar drawn at ~7178). `overlay.npcHpMode`:
`off` | `bar` (vanilla-style but exact ratio, drawn above head out of combat too while
`combatCycle` active) | `exact` (text `cur/max` + bar). `overlay.npcHpScope`: `combat` (only
NPCs with recent hitmarks — vanilla data availability) | `interacting` (only the NPC you're
combatting: detect via client's current interacting/target fields) | `all` (all NPCs with known
hp — same data constraint; document that HP is only known after first damage). Draw in
`drawScene` via `projectEntity('npc', i)` + `fonts()`. Also show the same for the local player's
current target as a small "opponent info" strip (name + hp bar + hp%) anchored top-center of the
viewport when in combat. Acceptance: attack a goblin → numbers above it match damage dealt;
strip shows target name/HP; no bars when off.

### F12 Stat boost/drain timers (C7)
Engine facts: `settimer(stat_regen, 100)` / `settimer(stat_boost_restore, 100)`
(server/content/scripts/login_logout/login.rs2:35) → every 100 cycles = 60 s; Rapid Restore
prayer halves regen to 50 cycles (skill_prayer/scripts/prayers/rapidrestore.rs2). Client side:
observe `xpGain`/UPDATE_STAT-driven level changes per skill (hook `tick` + compare
`statLevel`); on any effective-level change record `lastChange[skill]`; countdown =
interval − (now − lastChange), interval default 60 s, **self-calibrating**: keep a rolling
estimate per skill from observed consecutive same-direction changes (covers Rapid Restore).
UI (drawTop): compact list anchored near the XP-tracker side (own position setting): rows only
for skills where `statLevel !== statBase` — `Skill  cur/base (±d)  Ns`. Blink ≤5 s.
Acceptance: drink a strength potion → timer counts 60→0 and resets on each drain tick; drained
stat after goblin hits shows recovery countdown.

### F13 Tile markers (C8)
Shift+right-click a tile: foundation's click hook order lets WorldOverlays intercept
(button 2 + shift, viewport area, no modal): compute tile from click (reuse client's
pickTile/mouse->tile math used by Walk-here — see `doAction` TGT_* path / `minimapGetPos` &
scene picking; a helper `ctx.pickTile(x,y)` should be added by C1 if not trivially derivable,
otherwise C8 computes from `projectTile` inverse search over the 1-tile neighborhood).
Toggle a marker at that world tile (persist in localStorage, keyed by level+x+z, cap 100).
Render: filled diamond quad over the tile (four projected corners, filled via scanline or 4
triangles using QolGraphics polygon fill; fallback: thick colored outline + corner ticks if
fill is not feasible without alpha). `overlay.tileMarkerColor`. Also: shift+right-click on a
marked tile removes it. Markers list + "Clear all" button in settings panel section.
Acceptance: mark 3 tiles around Lumbridge, walk away/back + relog → markers persist and render
flat on the ground at the right perspective; unmark works.

### F14 HP/Prayer orbs or bars (C7)
`overlay.orbMode`: `off` | `orbs` (RS3-style circular gauges) | `bars` (horizontal),
`overlay.orbPos`: `minimap-left` (default: strip at x~520 left of minimap) | `side-top`
(top of side panel) | `viewport-tl`. Show HP (current/base, red) and Prayer (current/base,
white/blue) using `statLevel/statBase` (skill indices from `Skill.ts`), exact numbers on hover
or always (setting `overlay.orbNumbers`). Clicking an orb opens the matching skill side tab
(sendComponent on the tab button — reuse client tab-click logic coords ~5287ff, or simply
switch `activeIcon` the way the client does). Acceptance: after eating/brain-drain the orb
fills match the sidebar numbers; click opens Prayer tab.

### F15 Bank placeholders (C10a — safe layout-preserving variant)
While bank open (`isBankOpen()`, grid comId 5382): snapshot `getBankItems()` each tick; when an
item vanishes from slot S, remember `ghost[S] = itemId` until the bank closes or slot refills.
Draw ghost sprites into empty slots of the **vanilla grid at vanilla positions** (read
`IfType.list[5382]` slot geometry — same math as `drawInterface` inventory rendering), rendered
"translucent" (draw sprite then darken: plot sprite via existing item-sprite drawing, overlay a
dark rect with Pix2D stipple/`trans` if available; otherwise draw only the item outline +
count in gray). No click interception at all — layout unchanged, so vanilla interaction,
scrolling, right-click menus all keep working; ghosts are purely visual and never overlap a
real item. `bank.placeholders` bool. Acceptance: withdraw an item → its slot shows a faded
ghost until close; withdraw-all of a stack, deposit back → ghost replaced by real item; scroll
works.

### F16 Bank tabs & tags (C10b — wave 3, custom filtered view)
`bank.tabsEnabled` (default off): when the bank is open, `drawTop` paints a tab bar above the
bank grid (All / Untagged / user tags) and replaces the grid contents with the filtered list;
the overlay **consumes clicks** inside its rect and translates them to real bank slots
(`sendComponent`/IF_BUTTON with the true slot index — copy the packet shape from
`Client.bankWithdraw` ~1828). `bank.tagDefs` text: lines `tagname: item name, item name`
(regex allowed per item). Wheel scrolls the filtered view. Right-click inside the custom view:
open a small custom menu (Withdraw-1 / Withdraw-5 / Withdraw-10 / Withdraw-All / Withdraw-All-
but-one, honoring note mode varp 115) sending the same IF_BUTTON ops the vanilla grid would.
Fallback scope if interaction remap proves flaky: ship read-only "tag search" — a filter box
that highlights matching slots in the vanilla grid (dim non-matching via overlay) without
moving anything. Acceptance: tag `armor:` picks up equipped-style gear names; switching tabs
shows only tagged items; withdrawing from a filtered tab withdraws the correct item (verified
against inventory); ESC/close still closes the bank cleanly.

### F17 Settings panel (C2) — see §3.

## 5. Delegation

Model: `alibaba-token-plan/qwen3.8-flash` (foundation & FPS use `#xhigh`/`#medium` reasoning
variants). All agents work in `/home/wgelyjr/Projects/rs-sdk-staging`.

| Wave | Chunk | Files owned | Depends on |
|---|---|---|---|
| 1 | C1 Foundation | `qol/**` (core + stubs + plugins/index.ts), `Client.ts`, `GameShell.ts`, `PATCHES.md` | — |
| 2 | C2 Panel | `qol/QolSettingsPanel.ts` | C1 |
| 2 | C3 Menu | `qol/plugins/MenuSwapper.ts` | C1 |
| 2 | C4 XP | `qol/plugins/XpDrops.ts` | C1 |
| 2 | C5 Camera | `qol/plugins/CameraUnlock.ts` | C1 |
| 2 | C6 Display/FPS | `qol/plugins/Display.ts`, `GameShell.ts` | C1 |
| 2 | C7 Info | `qol/plugins/InfoOverlays.ts` | C1 |
| 2 | C8 World | `qol/plugins/WorldOverlays.ts` | C1 |
| 2 | C9 Dialog keys | `qol/plugins/DialogKeys.ts` | C1 |
| 2 | C10a Placeholders | `qol/plugins/BankPlaceholders.ts` | C1 |
| 3 | C10b Bank tabs | `qol/plugins/BankTabs.ts` | C1 (+ C2 for panel testing) |

Integrator (this session) after each wave: review diffs, run full
`bunx tsc --noEmit -p server/webclient/tsconfig.json` (only the 3 baseline errors allowed),
`bun test server/webclient/src/bot server/webclient/src/lite` + root `bun run test` spot
checks, `cd server/webclient && bun run build:dev`, fix/patch small issues directly, commit
per wave (`feat(webclient): qol foundation`, `feat(webclient): qol features wave 2`, ...).
Live smoke test once per wave where feasible: `bun run server/start.ts` → start server +
web client, drive with playwright-mcp (login test account, open panel, toggle, screenshot).

## 6. Risks & fallbacks

- **FPS unlock regressions** → cap feature behind setting default 50 (current behavior);
  if logic/render decoupling proves unsafe, ship "unlock to ~70" (remove tfps cap) and document.
- **Camera pitch raise breaks culling** → clamp at empirically safe max; zoom-out too far may
  expose map edges — limit zoomMax until clean.
- **Bank tabs interaction bugs** → default off; fallback read-only highlight mode (F16).
- **No per-pixel alpha in Pix2D** → use stipple/darken tricks (precedent: `Pix3D.trans`,
  menu dimming); never block clicks with decorative overlays.
- **Menu reordering vs bot bridge** → suppressed in bot builds; MES default off.
- **qol exception takes down game loop** → try/catch dispatch + auto-disable after 20 errors.
- **Vendor sync (rev bump) severs hooks** → PATCHES.md entry with grep verification is
  mandatory (this repo's documented failure mode).

## 7. Out of scope (v1)

Make-All production interfaces (server-side), bank tag drag-and-drop editor, GPU rendering,
HD models, roof removal, minimap zoom, plugin API for third parties.

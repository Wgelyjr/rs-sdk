// Ground item labels (F6, incl. the hold-Alt categorical hide lens),
// entity hider (F10) and tile markers (F13).
// docs/qol-features-plan.md §4, §7. Chunk C8; owns this file only.
//
// Projection note (IMPORTANT): `Client.projectTileToScreen` — and therefore
// `ctx.projectTile`/`ctx.pickTile`, which forward to it — is broken against the
// rev-289 `getOverlayPos(x, z, height)` signature. It was written against the
// rev-274 absolute-position projection `project(x, y, z)` and the vendor
// upgrade left the old argument order in place: it passes the terrain height
// into the `z` slot, where the `z < 128` bounds check rejects it (ground
// heights are negative), so it returns null for every surface tile. This
// plugin therefore re-implements the projection correctly through the
// `ctx.client` escape hatch — `getOverlayPos(sceneX, sceneZ, height)` reads
// `projectX/projectY` (viewport-local scene-buffer coords, same space the
// draw hooks paint into). If the Client.ts call site is ever fixed, this code
// keeps working untouched (the correct `(x, z, height)` order is what
// `getOverlayPos` takes).
//
// Hot paths: `drawScene` runs 50-70 Hz. All label/marker buffers are reused
// scratch arrays owned by the instance; the only per-frame allocations are the
// label strings (documented exception) and sort comparisons.

import ObjType from '#/config/ObjType.js';
import { BuildArea } from '#/dash3d/CollisionMap.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type { QolClickEvent } from '#/client/qol/QolHooks.js';

/** Max ground-item labels drawn per frame, nearest-to-local-player first (§4 F6). */
const LABEL_CAP: number = 60;
/** Max persisted tile markers; the oldest entries are evicted past this. */
const MARKER_CAP: number = 100;
/** localStorage key for the marker list: JSON array of `[level, worldX, worldZ]` tuples. */
const MARKER_STORAGE_KEY: string = 'rs-qol-tilemarkers-v1';
/** Marker persistence debounce, mirroring the QolConfig save cadence. */
const MARKER_SAVE_DEBOUNCE_MS: number = 500;
/** Stack-value tiers for the label colors (thresholds are constants in v1). */
const TIER_1: number = 1_000;
const TIER_2: number = 10_000;
const TIER_3: number = 100_000;
const TIER_4: number = 1_000_000;
/** Default tier-less label color. */
const COLOR_WHITE: number = 0xffffff;
/** Inverse-projection scan radius (mirrors `QolContext.pickTile`). */
const PICK_RADIUS: number = 25;
/** Click-hook priority for tile marking; below the settings panel's 10000 (§7). */
const CLICK_PRIORITY: number = 5000;
/** Marker fill alpha (0..256) and its brighter outline. */
const MARKER_FILL_ALPHA: number = 90;
const MARKER_LINE_ALPHA: number = 224;

/** Max item lines drawn per tile; extras collapse into '+N more'. */
const GROUND_LABEL_MAX_LINES: number = 4;
/** Distinct item ids tracked per tile (scratch cap; drawn lines = the
 *  most valuable GROUND_LABEL_MAX_LINES of them). */
const GROUND_LABEL_MAX_TRACK: number = 8;
/** Line height (px) between item lines of one tile label (p12). */
const GROUND_LABEL_LINE_H: number = 12;
/** Max hidden ground item categories; the oldest entry is evicted past this. */
const HIDDEN_CAT_CAP: number = 200;
/** localStorage key: JSON array of lowercased item names, in hide order. */
const HIDDEN_STORAGE_KEY: string = 'rs-qol-hidden-ground-v1';
/** Click-hook priority for the Alt ground-hide lens (above tileMark's 5000). */
const HIDE_CLICK_PRIORITY: number = 6000;
/** Dim color for hidden lines in the Alt-management lens. */
const HIDDEN_DIM: number = 0x808080;

/** One line of a tile label: a single item id's merged stacks (scratch). */
interface GroundLabelLine {
    /** Item id this line merges (for the within-tile merge). */
    id: number;
    name: string;
    /** Hide category key: `name.trim().toLowerCase()` (set with the name). */
    cat: string;
    /** True while `cat` is in the hidden set (line renders dimmed in the lens). */
    hidden: boolean;
    /** Merged count over every stack of that id on the tile. */
    count: number;
    /** Merged `cost * count` value (within-tile sort key, most valuable first). */
    value: number;
}

/** One merged ground-item tile label (scratch object, reused across frames).
 *  Lists EVERY item id on the tile (merged by id), most valuable first. */
interface GroundLabel {
    /** Absolute world tile x. */
    worldX: number;
    /** Absolute world tile z. */
    worldZ: number;
    /** Squared tile distance from the local player (sort key). */
    dist: number;
    /** Total stack value: sum of `ObjType.cost * count` over the tile. */
    value: number;
    /** Distinct item ids on the tile this frame (before the track cap). */
    distinct: number;
    /** Filled lines in `lines`; sorted most-valuable-first before draw. */
    lineCount: number;
    /** Preallocated line slots (GROUND_LABEL_MAX_TRACK), reused across frames. */
    lines: GroundLabelLine[];
}

/** One marked tile (world coordinates, persisted). */
interface TileMark {
    level: number;
    x: number;
    z: number;
}

/** One label line's click rect in the Alt-management lens (pooled, scratch).
 *  `cat` holds the category string of the line that was drawn this frame, so
 *  a click landing between frames still toggles the right item. */
interface GroundHideRect {
    x: number;
    y: number;
    w: number;
    h: number;
    cat: string;
}

/** Plugin implementation: owns the scratch state and the hook handlers. */
class WorldOverlaysImpl {
    /** Pool of label scratch objects, indexed by slot (never shrinks). */
    private readonly labelPool: GroundLabel[] = [];
    /** This frame's labels, pool references in sort order (reused array). */
    private readonly visibleLabels: GroundLabel[] = [];
    /** Markers in insertion order (oldest first — eviction takes the head). */
    private readonly markers: TileMark[] = [];
    /** `'level:x:z'` lookup for O(1) toggling. */
    private readonly markerKeys: Set<string> = new Set();

    /** Hidden ground item categories (lowercased names, F6 lens). */
    private readonly hiddenCats: Set<string> = new Set();
    /** Insertion order of `hiddenCats` for oldest-first eviction. */
    private readonly hiddenOrder: string[] = [];
    /** Pooled line hit rects for the Alt lens; valid for one drawn frame. */
    private readonly hideRects: GroundHideRect[] = WorldOverlaysImpl.hideRectPool();
    /** Hit rects recorded by the last drawLabels pass (0 when not in the lens). */
    private hideRectCount: number = 0;

    /** Corner projections for the tile diamond fill/outline (reused). */
    private readonly cornerX: number[] = [0, 0, 0, 0];
    private readonly cornerY: number[] = [0, 0, 0, 0];
    private readonly innerX: number[] = [0, 0, 0, 0];
    private readonly innerY: number[] = [0, 0, 0, 0];

    /** Cached outline color (marker color blended toward white). */
    private outlineSource: number = -1;
    private outlineColor: number = 0;

    /** Debounce handle for the marker localStorage write. */
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    /** Reused sort comparator — never allocate one per frame. */
    private readonly labelCompare = (a: GroundLabel, b: GroundLabel): number => a.dist - b.dist;

    /** Preallocate the full hit-rect pool (LABEL_CAP lines × 5 lines per tile). */
    private static hideRectPool(): GroundHideRect[] {
        const out: GroundHideRect[] = [];
        for (let i: number = 0; i < LABEL_CAP * (GROUND_LABEL_MAX_LINES + 1); i++) {
            out.push({ x: 0, y: 0, w: 0, h: 0, cat: '' });
        }
        return out;
    }

    constructor(private readonly ctx: QolContext) {}

    /** Register settings, hooks, persistence and the chat commands. */
    register(): void {
        this.defineSettings();

        const hooks = this.ctx.hooks;
        hooks.onDrawScene((g: QolGraphics): void => this.drawScene(g), 'WorldOverlays.drawScene');
        hooks.onClick((e: QolClickEvent): boolean => this.handleClick(e), 'WorldOverlays.tileMark', CLICK_PRIORITY);
        // Both gates are Alt+left-click: the lens (higher priority) consumes
        // clicks that land on a label line; tileMark gets the rest (bare ground).
        hooks.onClick((e: QolClickEvent): boolean => this.handleHideClick(e), 'WorldOverlays.groundHide', HIDE_CLICK_PRIORITY);

        // F10 entity hider: pure config passthrough. `() => boolean` is a valid
        // filter handler; nothing is allocated per call beyond the Map lookup.
        // The foundation never consults hidePlayer for the local player.
        const cfg = this.ctx.config;
        hooks.onHidePlayer((): boolean => cfg.getBool('visual.hidePlayers'), 'WorldOverlays.hidePlayers');
        hooks.onHideNpc((): boolean => cfg.getBool('visual.hideNpcs'), 'WorldOverlays.hideNpcs');
        hooks.onHideProjectile((): boolean => cfg.getBool('visual.hideProjectiles'), 'WorldOverlays.hideProjectiles');
        hooks.onHideGroundItem((): boolean => cfg.getBool('visual.hideGroundItems'), 'WorldOverlays.hideGroundItems');

        // These commands need no arguments (Qol.handleChatCommand passes the
        // text after the command word through, but it is ignored here), so
        // reporting and clearing are separate commands: `::tilemark` lists,
        // `::tilemarkclear` clears.
        this.ctx.chatCommand('tilemark', (): void => this.reportMarkers());
        this.ctx.chatCommand('tilemarkclear', (): void => this.clearMarkers());
        this.ctx.chatCommand('groundhide', (): void => this.reportHidden());
        this.ctx.chatCommand('groundhideclear', (): void => this.clearHidden());

        this.loadMarkers();
        this.loadHidden();
    }

    // ---- settings ----

    /** Define every F6/F10/F13 setting (§3 key table; idempotent). */
    private defineSettings(): void {
        const cfg = this.ctx.config;

        cfg.define({
            key: 'skilling.groundItems',
            section: 'Skilling',
            label: 'Ground item labels',
            type: 'boolean',
            default: true,
            tooltip: 'Show item names over ground stacks, colored by total stack value.'
        });
        cfg.define({
            key: 'skilling.groundItemMinValue',
            section: 'Skilling',
            label: 'Minimum stack value',
            type: 'slider',
            default: 0,
            min: 0,
            max: 100_000,
            tooltip: 'Hide ground item labels worth less than this value (0 = show all). Step 500.'
        });
        cfg.define({
            key: 'skilling.groundItemQuantity',
            section: 'Skilling',
            label: 'Show stack size',
            type: 'boolean',
            default: true,
            tooltip: 'Append xCount to labels when a stack holds more than one item.'
        });
        cfg.define({
            key: 'skilling.groundItemHideMode',
            section: 'Skilling',
            label: 'Hold-Alt ground hide',
            type: 'boolean',
            default: true,
            tooltip:
                'Hold Alt to manage hidden ground item categories: every label shows [-] (visible) or a ' +
                'dimmed [+]; click a label to hide or show that item everywhere. Persists across sessions. ' +
                '::groundhide lists, ::groundhideclear clears.'
        });
        cfg.define({
            key: 'skilling.groundItemColor1',
            section: 'Skilling',
            label: 'Label color >= 1k',
            type: 'color',
            default: 0xffff00
        });
        cfg.define({
            key: 'skilling.groundItemColor2',
            section: 'Skilling',
            label: 'Label color >= 10k',
            type: 'color',
            default: 0xbb00bb
        });
        cfg.define({
            key: 'skilling.groundItemColor3',
            section: 'Skilling',
            label: 'Label color >= 100k',
            type: 'color',
            default: 0xff6ec7
        });
        cfg.define({
            key: 'skilling.groundItemColor4',
            section: 'Skilling',
            label: 'Label color >= 1m',
            type: 'color',
            default: 0xff0000
        });

        cfg.define({
            key: 'visual.hidePlayers',
            section: 'Visuals',
            label: 'Hide players',
            type: 'boolean',
            default: false,
            tooltip: 'Hide all other players (your own character is never hidden).'
        });
        cfg.define({
            key: 'visual.hideNpcs',
            section: 'Visuals',
            label: 'Hide NPCs',
            type: 'boolean',
            default: false,
            tooltip: 'Hide NPC models and their overhead text/hitsplats.'
        });
        cfg.define({
            key: 'visual.hideProjectiles',
            section: 'Visuals',
            label: 'Hide projectiles',
            type: 'boolean',
            default: false,
            tooltip: 'Hide arrow/magic projectile sprites.'
        });
        cfg.define({
            key: 'visual.hideGroundItems',
            section: 'Visuals',
            label: 'Hide ground items',
            type: 'boolean',
            default: false,
            tooltip:
                'Hide ground items (also removes their labels and menu entries). ' +
                'Caveat: items that spawned or were dropped while hidden stay invisible after ' +
                'unhiding — they reappear only after the next map/zone reload.'
        });

        cfg.define({
            key: 'overlay.tileMarkers',
            section: 'Overlays',
            label: 'Tile markers',
            type: 'boolean',
            default: true,
            tooltip: 'Alt+left-click a tile to mark/unmark it (persists across sessions, max 100). On a ground item label, Alt+left-click drives the hide lens instead. ::tilemark lists, ::tilemarkclear clears.'
        });
        cfg.define({
            key: 'overlay.tileMarkerColor',
            section: 'Overlays',
            label: 'Tile marker color',
            type: 'color',
            default: 0xff00ff
        });
    }

    // ---- drawScene ----

    /** Draw tile markers then ground item labels (both viewport-local). */
    private drawScene(g: QolGraphics): void {
        const ctx = this.ctx;
        // The lens hit rects are valid for exactly the frame that drew them;
        // reset first so every early-return / gate-off path leaves them dead.
        this.hideRectCount = 0;
        if (!ctx.ingame()) {
            return;
        }
        const client: any = ctx.client;
        if (ctx.config.getBool('overlay.tileMarkers')) {
            this.drawMarkers(g, client);
        }
        if (ctx.config.getBool('skilling.groundItems') && !ctx.config.getBool('visual.hideGroundItems')) {
            this.drawLabels(g, client);
        }
    }

    // ---- F6 ground item labels ----

    /**
     * Merge `ctx.groundItems()` stacks on the rendered level into value tiers,
     * sort nearest-first, and draw up to `LABEL_CAP` centered labels.
     */
    private drawLabels(g: QolGraphics, client: any): void {
        const items = this.ctx.groundItems();
        const total: number = items.length;
        if (total === 0) {
            return;
        }
        const local = client.localPlayer;
        if (!local) {
            return;
        }
        const level: number = client.minusedlevel;
        const baseX: number = client.mapBuildBaseX;
        const baseZ: number = client.mapBuildBaseZ;
        const localTileX: number = baseX + (local.x >> 7);
        const localTileZ: number = baseZ + (local.z >> 7);
        // Alt-management lens: hidden categories are collected (dimmed) so the
        // player can click them back, and every line gets a toggle hit rect.
        const manage: boolean = this.ctx.altHeld();

        // `groundItems()` walks level -> x -> z, so every object of one tile
        // arrives in a contiguous run: merge the runs without any key strings.
        this.visibleLabels.length = 0;
        let prevX: number = -1;
        let prevZ: number = -1;
        for (let i: number = 0; i < total; i++) {
            const e = items[i];
            if (e.level !== level) {
                prevX = -1;
                prevZ = -1;
                continue;
            }
            if (e.x !== prevX || e.z !== prevZ) {
                prevX = e.x;
                prevZ = e.z;
                const label: GroundLabel = this.nextLabel(this.visibleLabels.length);
                label.worldX = baseX + e.x;
                label.worldZ = baseZ + e.z;
                const ddx: number = label.worldX - localTileX;
                const ddz: number = label.worldZ - localTileZ;
                label.dist = ddx * ddx + ddz * ddz;
                label.value = 0;
                label.distinct = 0;
                label.lineCount = 0;
                this.visibleLabels.push(label);
            }
            const label = this.visibleLabels[this.visibleLabels.length - 1];
            let type: ObjType;
            try {
                type = ObjType.list(e.id);
            } catch {
                continue; // config cache not ready / bad id: skip this stack
            }
            const cost: number = type.cost > 0 ? type.cost : 1;
            const count: number = e.count > 0 ? e.count : 1;
            const val: number = cost * count;
            // Merge this stack into the tile's per-id line list: same id sums
            // into its existing line, a new id takes a free slot (up to the
            // track cap — past that only the distinct count grows).
            let line: GroundLabelLine | null = null;
            for (let li: number = 0; li < label.lineCount; li++) {
                if (label.lines[li].id === e.id) {
                    line = label.lines[li];
                    break;
                }
            }
            if (line === null) {
                // New id: resolve its hide category (lowercased name). A hidden
                // category skips the stack entirely (value, lines, distinct)
                // unless the Alt lens is up, in which case it is collected so
                // the dimmed line can be clicked back.
                const name: string = type.name ?? `obj_${e.id}`;
                const cat: string = name.trim().toLowerCase();
                const hidden: boolean = this.hiddenCats.has(cat);
                if (hidden && !manage) {
                    continue;
                }
                label.distinct++;
                if (label.lineCount < GROUND_LABEL_MAX_TRACK) {
                    line = label.lines[label.lineCount++];
                    line.id = e.id;
                    line.name = name;
                    line.cat = cat;
                    line.hidden = hidden;
                    line.count = 0;
                    line.value = 0;
                }
            }
            // Tile value sums every (non-hidden) stack, including ids past the
            // track cap that get no line of their own (original F6 semantics).
            label.value += val;
            if (line !== null) {
                line.count += count;
                line.value += val;
            }
        }

        const labels = this.visibleLabels;
        if (labels.length === 0) {
            return;
        }
        labels.sort(this.labelCompare);
        // Within-tile: most valuable item first, so a full tile shows its best
        // lines and the '+N more' tail is the least valuable remainder.
        // Bounded insertion sort over the filled prefix only (n ≤ 8): the
        // preallocated slots past lineCount hold last-frame values, so a full
        // Array.sort would let a stale slot float into the drawn prefix.
        for (let i: number = 0; i < labels.length; i++) {
            const lines = labels[i].lines;
            const n: number = labels[i].lineCount;
            for (let a: number = 1; a < n; a++) {
                const cur = lines[a];
                let b: number = a - 1;
                while (b >= 0 && lines[b].value < cur.value) {
                    lines[b + 1] = lines[b];
                    b--;
                }
                lines[b + 1] = cur;
            }
        }

        const cfg = this.ctx.config;
        const minValue: number = cfg.getNum('skilling.groundItemMinValue');
        const showCount: boolean = cfg.getBool('skilling.groundItemQuantity');
        const color1: number = cfg.getNum('skilling.groundItemColor1');
        const color2: number = cfg.getNum('skilling.groundItemColor2');
        const color3: number = cfg.getNum('skilling.groundItemColor3');
        const color4: number = cfg.getNum('skilling.groundItemColor4');
        const font = client.p12;

        let drawn: number = 0;
        for (let i: number = 0; i < labels.length && drawn < LABEL_CAP; i++) {
            const label = labels[i];
            if (label.lineCount === 0) {
                continue; // every item on the tile is hidden: nothing to draw
            }
            if (minValue > 0 && label.value < minValue) {
                continue;
            }
            if (!this.projectGround(client, ((label.worldX - baseX) << 7) + 64, ((label.worldZ - baseZ) << 7) + 64)) {
                continue;
            }
            const x: number = client.projectX;
            const y: number = client.projectY;
            if (x < 4 || x > 508 || y < 18 || y > 334) {
                continue;
            }
            const v: number = label.value;
            const baseColor: number =
                v >= TIER_4 ? color4 : v >= TIER_3 ? color3 : v >= TIER_2 ? color2 : v >= TIER_1 ? color1 : COLOR_WHITE;

            // One line per item on the tile (most valuable first), stacked
            // bottom-up so the last line keeps the tile-anchored y-10 slot.
            const lineTotal: number = Math.min(label.lineCount, GROUND_LABEL_MAX_LINES);
            const overflow: number = label.distinct - lineTotal;
            let ty: number = y - 10 - (lineTotal - 1) * GROUND_LABEL_LINE_H - (overflow > 0 ? GROUND_LABEL_LINE_H : 0);
            for (let li: number = 0; li < lineTotal; li++) {
                const line = label.lines[li];
                let text: string = showCount && line.count > 1 ? `${line.name} x${line.count}` : line.name;
                let color: number = baseColor;
                if (manage) {
                    // Lens: [-] hides the category, dimmed [+] brings it back.
                    if (line.hidden) {
                        text += ' [+]';
                        color = HIDDEN_DIM;
                    } else {
                        text += ' [-]';
                    }
                    // Whole-line click rect so the small glyph is easy to hit.
                    if (this.hideRectCount < this.hideRects.length) {
                        const tw: number = g.textWidth(font, text);
                        const r = this.hideRects[this.hideRectCount++];
                        r.x = x - (tw >> 1) - 3;
                        r.y = ty - 11;
                        r.w = tw + 6;
                        r.h = 13;
                        r.cat = line.cat;
                    }
                }
                g.centreText(font, text, x, ty, color, true);
                ty += GROUND_LABEL_LINE_H;
            }
            if (overflow > 0) {
                g.centreText(font, `+${overflow} more`, x, ty, baseColor, true);
            }
            drawn++;
        }
    }

    /** Pool-allocate the scratch label for visible slot `index`. */
    private nextLabel(index: number): GroundLabel {
        let label = this.labelPool[index];
        if (label === undefined) {
            const lines: GroundLabelLine[] = [];
            for (let i: number = 0; i < GROUND_LABEL_MAX_TRACK; i++) {
                lines.push({ id: -1, name: '', cat: '', hidden: false, count: 0, value: 0 });
            }
            label = { worldX: 0, worldZ: 0, dist: 0, value: 0, distinct: 0, lineCount: 0, lines };
            this.labelPool.push(label);
        }
        return label;
    }

    // ---- F13 tile markers ----

    /** Fill the marked tiles' ground diamonds with a translucent quad + outline. */
    private drawMarkers(g: QolGraphics, client: any): void {
        if (this.markers.length === 0) {
            return;
        }
        const level: number = client.minusedlevel;
        const baseX: number = client.mapBuildBaseX;
        const baseZ: number = client.mapBuildBaseZ;
        const color: number = this.ctx.config.getNum('overlay.tileMarkerColor');
        const outline: number = this.outlineFor(color);
        const xs = this.cornerX;
        const ys = this.cornerY;
        const ixs = this.innerX;
        const iys = this.innerY;

        for (let m: number = 0; m < this.markers.length; m++) {
            const mark = this.markers[m];
            if (mark.level !== level) {
                continue;
            }
            const lx: number = mark.x - baseX;
            const lz: number = mark.z - baseZ;
            if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
                continue; // outside the loaded build area
            }
            // Tile corners in scene coords: center +/- 64 on each axis. Project
            // each corner through getOverlayPos(x, z, 0) so the fill sits on the
            // terrain vertices exactly like the rendered ground.
            const x0: number = lx << 7;
            const x1: number = x0 + 128;
            const z0: number = lz << 7;
            const z1: number = z0 + 128;
            if (
                !this.projectGround(client, x0, z0) ||
                !this.projectGround(client, x1, z0) ||
                !this.projectGround(client, x1, z1) ||
                !this.projectGround(client, x0, z1)
            ) {
                continue;
            }
            xs[0] = client.projectX;
            ys[0] = client.projectY;
            xs[1] = client.projectX;
            ys[1] = client.projectY;
            xs[2] = client.projectX;
            ys[2] = client.projectY;
            xs[3] = client.projectX;
            ys[3] = client.projectY;

            g.fillQuadTrans(xs[0], ys[0], xs[1], ys[1], xs[2], ys[2], xs[3], ys[3], color, MARKER_FILL_ALPHA);

            // ~1.5px bright band along each edge, inset toward the diamond center.
            const midX: number = (xs[0] + xs[1] + xs[2] + xs[3]) * 0.25;
            const midY: number = (ys[0] + ys[1] + ys[2] + ys[3]) * 0.25;
            for (let c: number = 0; c < 4; c++) {
                const dx: number = xs[c] - midX;
                const dy: number = ys[c] - midY;
                const d: number = Math.sqrt(dx * dx + dy * dy);
                const f: number = d > 3 ? (d - 1.5) / d : 0;
                ixs[c] = midX + dx * f;
                iys[c] = midY + dy * f;
            }
            for (let c: number = 0; c < 4; c++) {
                const n: number = (c + 1) & 3;
                g.fillQuadTrans(xs[c], ys[c], xs[n], ys[n], ixs[n], iys[n], ixs[c], iys[c], outline, MARKER_LINE_ALPHA);
            }
        }
    }

    /** `color` blended 65% toward white; cached because it changes only per setting edit. */
    private outlineFor(color: number): number {
        if (color === this.outlineSource) {
            return this.outlineColor;
        }
        this.outlineSource = color;
        const r: number = ((((color >> 16) & 0xff) * 35) / 100 + 165) | 0;
        const g: number = ((((color >> 8) & 0xff) * 35) / 100 + 165) | 0;
        const b: number = (((color & 0xff) * 35) / 100 + 165) | 0;
        this.outlineColor = (r << 16) | (g << 8) | b;
        return this.outlineColor;
    }

    /** Alt+left-click inside the viewport toggles a marker; consumes the click. */
    private handleClick(e: QolClickEvent): boolean {
        const ctx = this.ctx;
        if (e.button !== 1 || !e.alt || !ctx.config.getBool('overlay.tileMarkers')) {
            return false;
        }
        // Viewport rect in full-frame coords (512x334 buffer at 4,4).
        if (e.x < 4 || e.x > 516 || e.y < 4 || e.y > 338) {
            return false;
        }
        const client: any = ctx.client;
        if (!ctx.ingame() || client.mainModalId !== -1 || !client.localPlayer) {
            return false;
        }
        const mark = this.pickTileGround(client, e.x, e.y);
        if (mark === null) {
            return false; // no ground tile under the cursor: let vanilla respond
        }

        const key: string = `${mark.level}:${mark.x}:${mark.z}`;
        if (this.markerKeys.has(key)) {
            for (let i: number = 0; i < this.markers.length; i++) {
                const m = this.markers[i];
                if (m.level === mark.level && m.x === mark.x && m.z === mark.z) {
                    this.markers.splice(i, 1);
                    break;
                }
            }
            this.markerKeys.delete(key);
        } else {
            if (this.markers.length >= MARKER_CAP) {
                const oldest = this.markers.shift();
                if (oldest !== undefined) {
                    this.markerKeys.delete(`${oldest.level}:${oldest.x}:${oldest.z}`);
                }
            }
            this.markers.push(mark);
            this.markerKeys.add(key);
        }
        this.saveSoon();
        return true;
    }

    /** Alt+left-click a label line in the management lens: toggles its category. */
    private handleHideClick(e: QolClickEvent): boolean {
        const ctx = this.ctx;
        if (e.button !== 1 || !e.alt || !ctx.config.getBool('skilling.groundItemHideMode')) {
            return false;
        }
        // Viewport rect in full-frame coords (512x334 buffer at 4,4).
        if (e.x < 4 || e.x > 516 || e.y < 4 || e.y > 338) {
            return false;
        }
        const client: any = ctx.client;
        if (!ctx.ingame() || client.mainModalId !== -1 || !client.localPlayer) {
            return false;
        }
        const px: number = e.x - 4;
        const py: number = e.y - 4;
        for (let i: number = 0; i < this.hideRectCount; i++) {
            const r = this.hideRects[i];
            if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
                this.toggleCat(r.cat);
                return true;
            }
        }
        return false;
    }

    /** Toggle one category in the hidden set (oldest-first eviction at the cap). */
    private toggleCat(cat: string): void {
        if (cat === '') {
            return;
        }
        if (this.hiddenCats.has(cat)) {
            this.hiddenCats.delete(cat);
            const oi: number = this.hiddenOrder.indexOf(cat);
            if (oi !== -1) {
                this.hiddenOrder.splice(oi, 1);
            }
        } else {
            if (this.hiddenCats.size >= HIDDEN_CAT_CAP) {
                const oldest: string | undefined = this.hiddenOrder.shift();
                if (oldest !== undefined) {
                    this.hiddenCats.delete(oldest);
                }
            }
            this.hiddenCats.add(cat);
            this.hiddenOrder.push(cat);
        }
        this.saveSoon();
    }

    /**
     * Inverse projection of a full-frame click onto the rendered ground plane:
     * scan +/- `PICK_RADIUS` tiles around the local player for the projected
     * center nearest the point (vertical error weighted down, as the diamonds
     * stack vertically) — the same algorithm as `QolContext.pickTile`, but with
     * the projection fixed for the rev-289 `getOverlayPos` argument order.
     */
    private pickTileGround(client: any, screenX: number, screenY: number): TileMark | null {
        const px: number = screenX - 4;
        const py: number = screenY - 4;
        if (px < 0 || py < 0 || px > 512 || py > 334) {
            return null;
        }
        const local = client.localPlayer;
        if (!local) {
            return null;
        }
        const centerX: number = local.x >> 7;
        const centerZ: number = local.z >> 7;

        let bestDist: number = Infinity;
        let bestX: number = -1;
        let bestZ: number = -1;
        for (let dz: number = -PICK_RADIUS; dz <= PICK_RADIUS; dz++) {
            const tz: number = centerZ + dz;
            if (tz < 1 || tz >= BuildArea.SIZE - 1) {
                continue;
            }
            for (let dx: number = -PICK_RADIUS; dx <= PICK_RADIUS; dx++) {
                const tx: number = centerX + dx;
                if (tx < 1 || tx >= BuildArea.SIZE - 1) {
                    continue;
                }
                if (!this.projectGround(client, (tx << 7) + 64, (tz << 7) + 64)) {
                    continue;
                }
                const ddx: number = client.projectX - px;
                const ddy: number = client.projectY - py;
                const dist: number = ddx * ddx + ddy * ddy * 2;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestX = tx;
                    bestZ = tz;
                }
            }
        }
        if (bestX < 0) {
            return null;
        }
        return { level: client.minusedlevel, x: client.mapBuildBaseX + bestX, z: client.mapBuildBaseZ + bestZ };
    }

    // ---- projection helper ----

    /**
     * Project a scene point onto its terrain surface into viewport-local
     * scene-buffer coords; on true, read `client.projectX` / `client.projectY`.
     * Correct rev-289 call order: `getOverlayPos(sceneX, sceneZ, height)` with
     * height 0 for the ground surface (see the header note on the Client bug).
     */
    private projectGround(client: any, sceneX: number, sceneZ: number): boolean {
        client.getOverlayPos(sceneX, sceneZ, 0);
        return client.projectX > -1;
    }

    // ---- chat commands ----

    /** `::tilemark` — announce the marker count and usage. */
    private reportMarkers(): void {
        const client: any = this.ctx.client;
        const msg: string =
            `Tile markers: ${this.markers.length} (max ${MARKER_CAP}). ` +
            'Alt+left-click a tile to mark/unmark; ::tilemarkclear removes all.';
        try {
            client.addChat(0, msg, '');
        } catch (_e) {
            console.warn('[qol] tilemark: no chat box', msg);
        }
    }

    /** `::tilemarkclear` — drop every marker and persist immediately. */
    private clearMarkers(): void {
        this.markers.length = 0;
        this.markerKeys.clear();
        this.saveNow();
        const client: any = this.ctx.client;
        try {
            client.addChat(0, 'Cleared all tile markers.', '');
        } catch (_e) {
            console.warn('[qol] tilemarkclear: all tile markers cleared');
        }
    }

    /** `::groundhide` — announce the hidden categories (first 10 + count). */
    private reportHidden(): void {
        const n: number = this.hiddenCats.size;
        let msg: string;
        if (n === 0) {
            msg = 'No hidden ground item categories. Hold Alt over ground labels and click one to hide it.';
        } else {
            msg = `Hidden ground items: ${n}.`;
            let shown: number = 0;
            for (const cat of this.hiddenCats) {
                if (shown >= 10) {
                    msg += ', ...';
                    break;
                }
                msg += (shown === 0 ? ' ' : ', ') + cat;
                shown++;
            }
            msg += '. Hold Alt + click a label to toggle; ::groundhideclear removes all.';
        }
        const client: any = this.ctx.client;
        try {
            client.addChat(0, msg, '');
        } catch (_e) {
            console.warn('[qol] groundhide: no chat box', msg);
        }
    }

    /** `::groundhideclear` — drop every hidden category and persist immediately. */
    private clearHidden(): void {
        this.hiddenCats.clear();
        this.hiddenOrder.length = 0;
        this.saveNow();
        const client: any = this.ctx.client;
        try {
            client.addChat(0, 'Cleared all hidden ground item categories.', '');
        } catch (_e) {
            console.warn('[qol] groundhideclear: all hidden ground categories cleared');
        }
    }

    // ---- marker persistence (guarded DOM access, ground rule 3) ----

    /** Debounced localStorage write of the marker list. */
    private saveSoon(): void {
        if (this.saveTimer !== null || typeof window === 'undefined') {
            return;
        }
        this.saveTimer = setTimeout((): void => {
            this.saveTimer = null;
            this.saveNow();
        }, MARKER_SAVE_DEBOUNCE_MS);
    }

    /** Write both persisted lists (markers + hidden ground categories) to
     *  storage; quota/private-mode failures leave the values in memory. */
    private saveNow(): void {
        if (typeof window === 'undefined') {
            return;
        }
        try {
            const tuples: number[][] = [];
            for (let i: number = 0; i < this.markers.length; i++) {
                const m = this.markers[i];
                tuples.push([m.level, m.x, m.z]);
            }
            window.localStorage.setItem(MARKER_STORAGE_KEY, JSON.stringify(tuples));
        } catch (_e) {
            // Values stay in memory for this session.
        }
        try {
            // hiddenOrder is the full set in insertion order: one write covers it.
            window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(this.hiddenOrder));
        } catch (_e) {
            // Categories stay in memory for this session.
        }
    }

    /** Restore markers from storage at register time (silently drops bad data). */
    private loadMarkers(): void {
        if (typeof window === 'undefined') {
            return;
        }
        let raw: string | null = null;
        try {
            raw = window.localStorage.getItem(MARKER_STORAGE_KEY);
        } catch (_e) {
            return;
        }
        if (raw === null) {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (_e) {
            return;
        }
        if (!Array.isArray(parsed)) {
            return;
        }
        for (const item of parsed) {
            if (!Array.isArray(item) || item.length < 3) {
                continue;
            }
            const level: number = Number(item[0]);
            const x: number = Number(item[1]);
            const z: number = Number(item[2]);
            if (!Number.isInteger(level) || !Number.isInteger(x) || !Number.isInteger(z) || level < 0 || level >= BuildArea.LEVELS) {
                continue;
            }
            if (this.markers.length >= MARKER_CAP) {
                break;
            }
            const key: string = `${level}:${x}:${z}`;
            if (this.markerKeys.has(key)) {
                continue;
            }
            this.markers.push({ level, x, z });
            this.markerKeys.add(key);
        }
    }

    /** Restore hidden ground categories from storage (silently drops bad data). */
    private loadHidden(): void {
        if (typeof window === 'undefined') {
            return;
        }
        let raw: string | null = null;
        try {
            raw = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
        } catch (_e) {
            return;
        }
        if (raw === null) {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (_e) {
            return;
        }
        if (!Array.isArray(parsed)) {
            return;
        }
        for (const item of parsed) {
            if (typeof item !== 'string' || item.length === 0 || item.length > 80) {
                continue;
            }
            if (this.hiddenCats.size >= HIDDEN_CAT_CAP) {
                break;
            }
            if (!this.hiddenCats.has(item)) {
                this.hiddenCats.add(item);
                this.hiddenOrder.push(item);
            }
        }
    }
}

/** The plugin as the registry expects it (`plugins/index.ts`, §2). */
export default {
    name: 'WorldOverlays',
    register(ctx: QolContext): void {
        new WorldOverlaysImpl(ctx).register();
    }
};

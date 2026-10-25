// Ground item labels (F6), entity hider (F10) and tile markers (F13).
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

/** One merged ground-item stack label (scratch object, reused across frames). */
interface GroundLabel {
    /** Absolute world tile x. */
    worldX: number;
    /** Absolute world tile z. */
    worldZ: number;
    /** Squared tile distance from the local player (sort key). */
    dist: number;
    /** Total stack value: sum of `ObjType.cost * count` over the tile. */
    value: number;
    /** Value of the single most valuable item (`cost * count`), the label item. */
    bestVal: number;
    /** Name of the most valuable item in the stack. */
    bestName: string;
    /** Count of that item. */
    bestCount: number;
}

/** One marked tile (world coordinates, persisted). */
interface TileMark {
    level: number;
    x: number;
    z: number;
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

    constructor(private readonly ctx: QolContext) {}

    /** Register settings, hooks, persistence and the chat commands. */
    register(): void {
        this.defineSettings();

        const hooks = this.ctx.hooks;
        hooks.onDrawScene((g: QolGraphics): void => this.drawScene(g), 'WorldOverlays.drawScene');
        hooks.onClick((e: QolClickEvent): boolean => this.handleClick(e), 'WorldOverlays.tileMark', CLICK_PRIORITY);

        // F10 entity hider: pure config passthrough. `() => boolean` is a valid
        // filter handler; nothing is allocated per call beyond the Map lookup.
        // The foundation never consults hidePlayer for the local player.
        const cfg = this.ctx.config;
        hooks.onHidePlayer((): boolean => cfg.getBool('visual.hidePlayers'), 'WorldOverlays.hidePlayers');
        hooks.onHideNpc((): boolean => cfg.getBool('visual.hideNpcs'), 'WorldOverlays.hideNpcs');
        hooks.onHideProjectile((): boolean => cfg.getBool('visual.hideProjectiles'), 'WorldOverlays.hideProjectiles');
        hooks.onHideGroundItem((): boolean => cfg.getBool('visual.hideGroundItems'), 'WorldOverlays.hideGroundItems');

        // `chatCommand` callbacks receive no arguments (Qol.handleChatCommand
        // drops everything after the command word), so reporting and clearing
        // are separate commands: `::tilemark` lists, `::tilemarkclear` clears.
        this.ctx.chatCommand('tilemark', (): void => this.reportMarkers());
        this.ctx.chatCommand('tilemarkclear', (): void => this.clearMarkers());

        this.loadMarkers();
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
            tooltip: 'Shift+right-click a tile to mark/unmark it (persists across sessions, max 100). ::tilemark lists, ::tilemarkclear clears.'
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
                label.bestVal = -1;
                label.bestName = '';
                label.bestCount = 1;
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
            label.value += val;
            if (val > label.bestVal) {
                label.bestVal = val;
                label.bestName = type.name ?? `obj_${e.id}`;
                label.bestCount = count;
            }
        }

        const labels = this.visibleLabels;
        if (labels.length === 0) {
            return;
        }
        labels.sort(this.labelCompare);

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
            const color: number =
                v >= TIER_4 ? color4 : v >= TIER_3 ? color3 : v >= TIER_2 ? color2 : v >= TIER_1 ? color1 : COLOR_WHITE;
            const text: string = showCount && label.bestCount > 1 ? `${label.bestName} x${label.bestCount}` : label.bestName;
            g.centreText(font, text, x, y - 10, color, true);
            drawn++;
        }
    }

    /** Pool-allocate the scratch label for visible slot `index`. */
    private nextLabel(index: number): GroundLabel {
        let label = this.labelPool[index];
        if (label === undefined) {
            label = { worldX: 0, worldZ: 0, dist: 0, value: 0, bestVal: 0, bestName: '', bestCount: 1 };
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

    /** Shift+right-click inside the viewport toggles a marker; consumes the click. */
    private handleClick(e: QolClickEvent): boolean {
        const ctx = this.ctx;
        if (e.button !== 2 || !e.shift || !ctx.config.getBool('overlay.tileMarkers')) {
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
            'Shift+right-click a tile to mark/unmark; ::tilemarkclear removes all.';
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

    /** Write `[[level, x, z], ...]` JSON to storage; quota/private-mode failures ignored. */
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
}

/** The plugin as the registry expects it (`plugins/index.ts`, §2). */
export default {
    name: 'WorldOverlays',
    register(ctx: QolContext): void {
        new WorldOverlaysImpl(ctx).register();
    }
};

// The facade handed to every QoL plugin's `register(ctx)` (§2.2 of
// docs/qol-features-plan.md). Typed helpers over the real Client, with a
// `client: any` escape hatch for anything the facade doesn't cover yet.
//
// Private Client members are read through the escape hatch, mirroring what the
// bot bridge already does: never rename or remove the members this touches.

import Skill from '#/client/Skill.js';
import { LoopCycle } from '#/client/LoopCycle.js';
import { ClientProt } from '#/io/ClientProt.js';
import ObjType from '#/config/ObjType.js';
import { BuildArea } from '#/dash3d/CollisionMap.js';

import type { QolMenuView } from '#/client/qol/QolHooks.js';
import type { QolDom } from '#/client/qol/QolDom.js';
import type QolConfig from '#/client/qol/QolConfig.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type QolHooks from '#/client/qol/QolHooks.js';
import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';
import type PixFont from '#/graphics/PixFont.js';

declare const process: { env: { ENABLE_BOT_SDK?: string } };

/** A tile result of `QolContext.pickTile`. */
export interface QolPickResult {
    /** Build-area tile x (add `mapBuildBaseX` for the world coordinate). */
    x: number;
    /** Build-area tile z (add `mapBuildBaseZ` for the world coordinate). */
    z: number;
    /** Absolute world tile x. */
    worldX: number;
    /** Absolute world tile z. */
    worldZ: number;
    /** Render level used (`minusedlevel`). */
    level: number;
}

/** Hover context for menu logic: which interface area the pointer is over. */
export interface QolMenuTarget {
    /** 1 = main modal, 2 = side panel/tab, 3 = chat box, 0 = viewport/nothing. */
    area: number;
    /** Component id under the pointer (layer or child), 0 when none. */
    comId: number;
    /** Inventory slot last hovered by the interface option builder, or 0. */
    slot: number;
}

/**
 * QoL plugin facade. One instance is created by `Qol` and passed to every
 * plugin's `register(ctx)`.
 */
export class QolContext {
    /** Reused return buffers so per-frame readers (C4/C8) don't churn the GC. */
    private readonly npcScratch: Array<{ index: number; npc: ClientNpc }> = [];
    private readonly playerScratch: Array<{ index: number; player: ClientPlayer }> = [];
    private readonly groundScratch: Array<{ level: number; x: number; z: number; id: number; count: number }> = [];

    /**
     * @param client the live `Client` instance (typed loosely — this is also the plugin escape hatch)
     * @param config setting registry
     * @param hooks the hook bus (plugins register; `Qol` dispatches)
     * @param g shared drawing facade
     * @param registerChatCommand wires a `::cmd` into the client's `::` chain
     */
    constructor(
        public readonly client: any,
        public readonly config: QolConfig,
        public readonly hooks: QolHooks,
        public readonly g: QolGraphics,
        private readonly registerChatCommand: (cmd: string, cb: () => void) => void
    ) {}

    /** True in the bot browser build (`ENABLE_BOT_SDK === 'true'`). */
    isBotBuild(): boolean {
        // Must mirror Client.ts's ENABLE_BOT_SDK: bundle.ts defines the literal.
        return process.env.ENABLE_BOT_SDK === 'true';
    }

    /** DOM overlay layer (orbs on the frame, dockable panels); null pre-init. */
    dom: QolDom | null = null;

    /** True when tracker/timers/orbs should live in DOM docks, not the viewport. */
    domDocks(): boolean {
        return this.dom !== null && this.config.getBool('overlay.domDocks');
    }

    /** True while the game session is live (as opposed to the title screen). */
    ingame(): boolean {
        return this.client !== null && this.client !== undefined && this.client.ingame === true;
    }

    /** Native Shift state, tracked from DOM events by GameShell (not keyHeld). */
    shiftHeld(): boolean {
        return this.client.shiftHeld === true;
    }

    /** Native Alt state. */
    altHeld(): boolean {
        return this.client.altHeld === true;
    }

    /** Native Ctrl state. */
    ctrlHeld(): boolean {
        return this.client.ctrlHeld === true;
    }

    /** Client game-loop cycle counter (monotonic while the tab runs). */
    loopCycle(): number {
        return LoopCycle.value;
    }

    /** Wall clock in milliseconds. */
    nowMs(): number {
        return performance.now();
    }

    /** Local player's absolute world tile, or null when not in game. */
    localPlayer(): { x: number; z: number; level: number } | null {
        const pos = this.client.getPlayerPosition?.();
        if (!pos) {
            return null;
        }
        return { x: pos.worldX, z: pos.worldZ, level: this.client.minusedlevel };
    }

    /** The three bundled client fonts (loaded by `maininit` before qol inits). */
    fonts(): { p11: PixFont; p12: PixFont; b12: PixFont } {
        return { p11: this.client.p11, p12: this.client.p12, b12: this.client.b12 };
    }

    /**
     * Project a world tile to the scene drawing buffer. The scene buffer is
     * 512x334 and blitted at screen (4,4): result coords are viewport-local.
     * Null when off-scene or the point is behind the camera.
     */
    projectTile(worldX: number, worldZ: number): { x: number; y: number } | null {
        return this.client.projectTileToScreen(worldX, worldZ);
    }

    /** Project an entity's current position (viewport-local coords; head height is built into it). */
    projectEntity(kind: 'npc' | 'player', index: number): { x: number; y: number } | null {
        if (kind === 'npc') {
            return this.client.projectNpcToScreen(index);
        }
        return this.client.projectPlayerToScreen(index);
    }

    /**
     * In-view NPC active list. The array AND entries are REUSED between calls —
     * copy what you need if you keep it past the current frame.
     */
    npcs(): Array<{ index: number; npc: ClientNpc }> {
        const list = this.npcScratch;
        let n: number = 0;
        const count: number = this.client.npcCount;
        const npcArray = this.client.npc;
        const npcIds = this.client.npcIds;
        for (let i: number = 0; i < count; i++) {
            const index: number = npcIds[i];
            const npc = npcArray[index];
            if (!npc) {
                continue;
            }
            if (n >= list.length) {
                list.push({ index, npc });
            } else {
                const entry = list[n];
                entry.index = index;
                entry.npc = npc;
            }
            n++;
        }
        list.length = n;
        return list;
    }

    /**
     * Visible other players (active list; excludes the local player, which is
     * `client.localPlayer`). REUSED array and entries — see `npcs()`.
     */
    players(): Array<{ index: number; player: ClientPlayer }> {
        const list = this.playerScratch;
        let n: number = 0;
        const count: number = this.client.playerCount;
        const playerArray = this.client.players;
        const playerIds = this.client.playerIds;
        for (let i: number = 0; i < count; i++) {
            const index: number = playerIds[i];
            const player = playerArray[index];
            if (!player) {
                continue;
            }
            if (n >= list.length) {
                list.push({ index, player });
            } else {
                const entry = list[n];
                entry.index = index;
                entry.player = player;
            }
            n++;
        }
        list.length = n;
        return list;
    }

    /**
     * Every ground item on the loaded build area, all levels
     * (`x`/`z` are build-area tiles; add `mapBuildBaseX/Z` for world tiles).
     * REUSED array and entries — see `npcs()`.
     */
    groundItems(): Array<{ level: number; x: number; z: number; id: number; count: number }> {
        const list = this.groundScratch;
        let n: number = 0;
        const ground = this.client.groundObj;
        if (!ground) {
            list.length = 0;
            return list;
        }
        for (let level: number = 0; level < BuildArea.LEVELS; level++) {
            const plane = ground[level];
            if (!plane) {
                continue;
            }
            for (let x: number = 0; x < BuildArea.SIZE; x++) {
                const col = plane[x];
                if (!col) {
                    continue;
                }
                for (let z: number = 0; z < BuildArea.SIZE; z++) {
                    const objs = col[z];
                    if (!objs) {
                        continue;
                    }
                    for (let obj = objs.head(); obj !== null; obj = objs.next()) {
                        if (n >= list.length) {
                            list.push({ level, x, z, id: obj.id, count: obj.count });
                        } else {
                            const entry = list[n];
                            entry.level = level;
                            entry.x = x;
                            entry.z = z;
                            entry.id = obj.id;
                            entry.count = obj.count;
                        }
                        n++;
                    }
                }
            }
        }
        list.length = n;
        return list;
    }

    /** Item definition, or null for an unknown id. */
    objType(id: number): { name: string; cost: number; members: boolean } | null {
        if (id < 0) {
            return null;
        }
        // ObjType.list is a lazy decode over the cache packets (no static
        // count); an out-of-range/uninitialized read throws.
        try {
            const type: ObjType = ObjType.list(id);
            return { name: type.name ?? `obj_${id}`, cost: type.cost, members: type.members };
        } catch {
            return null;
        }
    }

    /** Skill name from `Skill.names` (lower-case), or ''. */
    skillName(stat: number): string {
        return Skill.names[stat] ?? '';
    }

    /** Raw XP (0..200m) for a skill. */
    statXp(stat: number): number {
        return this.client.statXP[stat] ?? 0;
    }

    /** Effective (possibly boosted/drained) level. */
    statLevel(stat: number): number {
        return this.client.statEffectiveLevel[stat] ?? 0;
    }

    /** Base level from XP. */
    statBase(stat: number): number {
        return this.client.statBaseLevel[stat] ?? 0;
    }

    /** True while the bank interface is open. */
    isBankOpen(): boolean {
        return this.client.isBankOpen() === true;
    }

    /** Bank grid contents (`bank_main:inv`). */
    getBankItems(): Array<{ slot: number; id: number; name: string; count: number }> {
        return this.client.getBankItems();
    }

    /** Clickable dialog options in the open chat modal, in display order. */
    getDialogOptions(): Array<{ index: number; text: string; componentId: number; buttonType: number }> {
        return this.client.getDialogOptions();
    }

    /**
     * Click dialog option N (1-based, same order as `getDialogOptions()`);
     * N = 0 resumes the "click to continue" pause button. Returns whether a
     * packet went out.
     */
    clickDialogOption(n: number): boolean {
        return this.client.clickDialogOption(n) === true;
    }

    /** Send an IF_BUTTON packet for a component (interface click). */
    sendComponent(comId: number): void {
        if (!this.ingame() || !this.client.out) {
            return;
        }
        this.client.writePacketOpcode(ClientProt.IF_BUTTON);
        this.client.out.p2(comId);
    }

    /** Best-effort hover context for menu logic (which interface region the pointer last hovered). */
    menuTarget(): QolMenuTarget | null {
        if (this.client.overMainComId > 0) {
            return { area: 1, comId: this.client.overMainComId, slot: this.client.hoveredSlot };
        }
        if (this.client.overSideComId > 0) {
            return { area: 2, comId: this.client.overSideComId, slot: this.client.hoveredSlot };
        }
        if (this.client.overChatComId > 0) {
            return { area: 3, comId: this.client.overChatComId, slot: this.client.hoveredSlot };
        }
        // Inventory/bank grid hovers never set a region over*ComId (all three
        // stay 0 over a grid); the slot tracker is the only signal. Fall back
        // to it so menu logic (shift-drop promotion, hover-item name) sees the
        // hover context instead of bailing on the `=== null` gate.
        if (this.client.hoveredSlotComId > 0) {
            return { area: 0, comId: this.client.hoveredSlotComId, slot: this.client.hoveredSlot };
        }
        return null;
    }

    /**
     * Re-run the client's minimenu build for the current pointer position and
     * re-dispatch `menuBuilt`. The vanilla client only rebuilds on mouse
     * movement, so a click at a stationary cursor executes the menu built by
     * the last hover — call this from a click hook (before the vanilla
     * doAction routing) when a modifier's state has changed since that build.
     * No-op while a drag is in progress or a right-click menu is open.
     */
    rebuildMenu(): void {
        const client: any = this.client;
        if (client === null || client === undefined) {
            return;
        }
        if (client.objDragArea !== 0 || client.isMenuOpen === true) {
            return;
        }
        if (typeof client.buildMinimenu === 'function') {
            client.buildMinimenu();
        }
    }

    /** Register a `::cmd` chat command; `cb` runs instead of the CLIENT_CHEAT passthrough. */
    chatCommand(cmd: string, cb: () => void): void {
        this.registerChatCommand(cmd, cb);
    }

    /**
     * Resolve a click in FULL-FRAME screen coordinates to the ground tile under
     * it (used by C8 tile markers).
     *
     * Approach note: the client's own picking is frame-driven —
     * `doAction(WALK)` calls `World.updateMousePicking(x-4, y-4)`, and the next
     * `World.renderAll()` pass fills `World.groundX/groundZ` from the projected
     * ground triangles. That cannot be queried synchronously from a hook, so
     * this is an inverse projection: scan the tile neighborhood around the
     * local player (radius 25 covers the visible ground at every camera
     * distance incl. unlocked zoom — the plan suggested 15x15 for vanilla) and
     * return the tile whose projected center is nearest the click.
     *
     * @param screenX canvas frame x (0..765)
     * @param screenY canvas frame y (0..503)
     */
    pickTile(screenX: number, screenY: number): QolPickResult | null {
        if (!this.ingame()) {
            return null;
        }
        const local = this.client.localPlayer;
        if (!local) {
            return null;
        }

        // Scene buffer coords: the 512x334 buffer is blitted at screen (4,4).
        const px: number = screenX - 4;
        const py: number = screenY - 4;
        if (px < 0 || py < 0 || px > 512 || py > 334) {
            return null;
        }

        const baseX: number = this.client.mapBuildBaseX;
        const baseZ: number = this.client.mapBuildBaseZ;
        const centerX: number = local.x >> 7;
        const centerZ: number = local.z >> 7;
        const radius: number = 25;

        let bestDist: number = Infinity;
        let bestX: number = -1;
        let bestZ: number = -1;

        for (let dz: number = -radius; dz <= radius; dz++) {
            for (let dx: number = -radius; dx <= radius; dx++) {
                const tx: number = centerX + dx;
                const tz: number = centerZ + dz;
                const worldX: number = baseX + tx;
                const worldZ: number = baseZ + tz;
                const pos = this.client.projectTileToScreen(worldX, worldZ);
                if (pos === null) {
                    continue;
                }
                const ddx: number = pos.x - px;
                const ddy: number = pos.y - py;
                // Weight vertical distance down: tiles project as diamonds, so
                // nearest-center ties at the same x belong to the nearer tile.
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

        return {
            x: bestX,
            z: bestZ,
            worldX: baseX + bestX,
            worldZ: baseZ + bestZ,
            level: this.client.minusedlevel
        };
    }
}

/**
 * Mutable view over the raw minimenu arrays, handed to `menuBuilt` handlers
 * (only outside bot builds). All indices are array indices: entry
 * `count - 1` renders at the menu top and is the left-click action.
 */
export class QolMenuViewImpl implements QolMenuView {
    constructor(private readonly client: any) {}

    get count(): number {
        return this.client.menuNumEntries;
    }

    text(i: number): string {
        return this.client.menuOption[i] ?? '';
    }

    action(i: number): number {
        return this.client.menuAction[i];
    }

    paramA(i: number): number {
        return this.client.menuParamA[i];
    }

    paramB(i: number): number {
        return this.client.menuParamB[i];
    }

    paramC(i: number): number {
        return this.client.menuParamC[i];
    }

    find(pred: (text: string, action: number, i: number) => boolean): number {
        const count: number = this.count;
        for (let i: number = 0; i < count; i++) {
            if (pred(this.text(i), this.action(i), i)) {
                return i;
            }
        }
        return -1;
    }

    move(from: number, to: number): void {
        const count: number = this.count;
        if (from < 0 || from >= count || to < 0 || to >= count || from === to) {
            return;
        }

        const forward: boolean = to > from;
        const steps: number = forward ? to - from : from - to;
        for (let s: number = 0; s < steps; s++) {
            const a: number = forward ? from + s : from - s;
            const b: number = forward ? a + 1 : a - 1;
            this.swap(a, b);
        }
    }

    promote(i: number): void {
        this.move(i, this.count - 1);
    }

    add(text: string, action: number, paramA: number = 0, paramB: number = 0, paramC: number = 0): void {
        const i: number = this.count;
        if (i >= this.client.menuAction.length) {
            return;
        }
        this.client.menuOption[i] = text;
        this.client.menuAction[i] = action;
        this.client.menuParamA[i] = paramA;
        this.client.menuParamB[i] = paramB;
        this.client.menuParamC[i] = paramC;
        this.client.menuNumEntries = i + 1;
    }

    private swap(a: number, b: number): void {
        const client = this.client;

        const t0: string = client.menuOption[a];
        client.menuOption[a] = client.menuOption[b];
        client.menuOption[b] = t0;

        const t1: number = client.menuAction[a];
        client.menuAction[a] = client.menuAction[b];
        client.menuAction[b] = t1;

        const t2: number = client.menuParamA[a];
        client.menuParamA[a] = client.menuParamA[b];
        client.menuParamA[b] = t2;

        const t3: number = client.menuParamB[a];
        client.menuParamB[a] = client.menuParamB[b];
        client.menuParamB[b] = t3;

        const t4: number = client.menuParamC[a];
        client.menuParamC[a] = client.menuParamC[b];
        client.menuParamC[b] = t4;
    }
}

export default QolContext;

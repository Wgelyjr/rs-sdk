// Typed hook bus for the QoL plugin layer (docs/qol-features-plan.md §2.2).
//
// Four dispatch semantics:
//  - event  (`tick`, `drawScene`, `drawTop`, `xpGain`, `menuBuilt`, `resizeCanvas`):
//    every handler runs, return value ignored.
//  - consume (`key`, `click`, `wheel`): handlers run in descending priority
//    order; the first one returning `true` swallows the event.
//  - filter (`hidePlayer`, `hideNpc`, `hideProjectile`, `hideGroundItem`):
//    any handler returning `true` wins ("any true").
//  - map (`camera`, `framePace`): handlers pipe a mutable value; each sees the
//    result of the previous ones.
//
// Error containment (ground rule 4): every handler call is individually
// try/caught; a handler that throws `MAX_HANDLER_ERRORS` times is disabled with
// a single console.warn so one bad plugin can never kill the game loop.
// Registration returns an unsubscribe function.

import type QolGraphics from '#/client/qol/QolGraphics.js';
import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';
import type ClientProj from '#/dash3d/ClientProj.js';

/** A handler that throws this many times is disabled. */
const MAX_HANDLER_ERRORS = 20;

/** Removes a previously registered hook handler. */
export type QolUnsubscribe = () => void;

/** Click payload (canvas frame coordinates, 0..765 x 0..503). */
export interface QolClickEvent {
    /** 1 = left, 2 = right, 3 = middle. */
    button: number;
    x: number;
    y: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    middle: boolean;
}

/** Wheel payload; `dy` is positive for scroll-down (native delta sign). */
export interface QolWheelEvent {
    dx: number;
    dy: number;
    x: number;
    y: number;
}

/** XP gain payload; levels are *base* levels (before/after the packet). */
export interface QolXpGainEvent {
    /** Skill index into `Skill.names`. */
    skill: number;
    oldXp: number;
    newXp: number;
    oldLevel: number;
    newLevel: number;
}

/**
 * Mutable camera state handed to `camera` map handlers at the `camFollow`
 * call site. `minPitch`/`maxPitch` are sticky overrides: the pitch clamps in
 * `followCamera()`/camera-shake re-clamping read them every frame, so a handler
 * only has to set them once (or via `config.onChange`).
 */
export interface QolCameraState {
    pitch: number;
    distance: number;
    minPitch: number;
    maxPitch: number;
}

/**
 * Safe view over the raw minimenu arrays (`menuOption`/`menuAction`/
 * `menuParamA/B/C`/`menuNumEntries`). Entries render bottom-up: the LAST
 * array entry is the menu top and the left-click action. Reordering the
 * arrays is all shift-drop / menu-entry-swapping needs; `doAction` and the
 * packets stay untouched.
 */
export interface QolMenuView {
    readonly count: number;
    text(i: number): string;
    action(i: number): number;
    paramA(i: number): number;
    paramB(i: number): number;
    paramC(i: number): number;
    /** Index of the first entry matching the predicate, or -1. */
    find(pred: (text: string, action: number, i: number) => boolean): number;
    /** Move an entry, shifting the ones in between (insert semantics). */
    move(from: number, to: number): void;
    /** `move(i, count - 1)` — becomes the left-click action. */
    promote(i: number): void;
    /** Append a new entry (no-ops when the menu is full). */
    add(text: string, action: number, paramA?: number, paramB?: number, paramC?: number): void;
}

export type TickHandler = (dtMs: number) => void;
export type DrawHandler = (g: QolGraphics) => void;
export type XpGainHandler = (e: QolXpGainEvent) => void;
export type MenuBuiltHandler = (menu: QolMenuView) => void;
export type ResizeCanvasHandler = (width: number, height: number) => void;
/** Key handler; `ch` is the GameShell key code (see KeyCodes.ts; F10 = 1017, ESC = 27). */
export type KeyHandler = (ch: number) => boolean;
export type ClickHandler = (e: QolClickEvent) => boolean;
export type WheelHandler = (e: QolWheelEvent) => boolean;
export type PlayerFilterHandler = (player: ClientPlayer) => boolean;
export type NpcFilterHandler = (npc: ClientNpc) => boolean;
export type ProjectileFilterHandler = (proj: ClientProj) => boolean;
export type GroundItemFilterHandler = (obj: ClientObj) => boolean;
export type CameraMapHandler = (state: QolCameraState) => void;
export type FramePaceHandler = (nowMs: number, previous: number | null) => number | null;
/**
 * Map hook at the `roofCheck()` call site in `gameDrawMain()`: the topmost
 * level `world.renderAll()` will draw this frame (vanilla `roofCheck()`
 * result). Return `null` to keep it, or a number to replace it. "Remove
 * roofs" returns the player's level — the map's built-in RemoveRoof-tile
 * behavior applied to every tile.
 */
export type RoofTopMapHandler = (maxLevel: number) => number | null;

/** One registered handler with its error bookkeeping. */
interface HookSlot<T> {
    fn: T;
    name: string;
    priority: number;
    order: number;
    errors: number;
    disabled: boolean;
}

/**
 * The hook bus. Dispatch methods are called from `Qol`; plugin code only ever
 * touches the `on*` registration methods.
 */
export class QolHooks {
    private readonly tick: Array<HookSlot<TickHandler>> = [];
    private readonly drawScene: Array<HookSlot<DrawHandler>> = [];
    private readonly drawTop: Array<HookSlot<DrawHandler>> = [];
    private readonly xpGain: Array<HookSlot<XpGainHandler>> = [];
    private readonly menuBuilt: Array<HookSlot<MenuBuiltHandler>> = [];
    private readonly resizeCanvas: Array<HookSlot<ResizeCanvasHandler>> = [];
    private readonly key: Array<HookSlot<KeyHandler>> = [];
    private readonly click: Array<HookSlot<ClickHandler>> = [];
    private readonly wheel: Array<HookSlot<WheelHandler>> = [];
    private readonly hidePlayer: Array<HookSlot<PlayerFilterHandler>> = [];
    private readonly hideNpc: Array<HookSlot<NpcFilterHandler>> = [];
    private readonly hideProjectile: Array<HookSlot<ProjectileFilterHandler>> = [];
    private readonly hideGroundItem: Array<HookSlot<GroundItemFilterHandler>> = [];
    private readonly camera: Array<HookSlot<CameraMapHandler>> = [];
    private readonly framePace: Array<HookSlot<FramePaceHandler>> = [];
    private readonly roofTop: Array<HookSlot<RoofTopMapHandler>> = [];
    private nextOrder: number = 1;

    // ---- registration ----

    /** Per-logic-frame update at the end of `Client.gameLoop()`, only while ingame. */
    onTick(fn: TickHandler, name: string = 'tick'): QolUnsubscribe {
        return this.register(this.tick, fn, name, 0);
    }

    /** In-world overlays into the 512x334 scene buffer (coords are viewport-local; screen = +4,+4), clipped for you. */
    onDrawScene(fn: DrawHandler, name: string = 'drawScene'): QolUnsubscribe {
        return this.register(this.drawScene, fn, name, 0);
    }

    /** Topmost UI pass, drawn after menus/modals, still inside the scene buffer. */
    onDrawTop(fn: DrawHandler, name: string = 'drawTop'): QolUnsubscribe {
        return this.register(this.drawTop, fn, name, 0);
    }

    /** Stat update from the UPDATE_STAT packet (before/after values in the payload). */
    onXpGain(fn: XpGainHandler, name: string = 'xpGain'): QolUnsubscribe {
        return this.register(this.xpGain, fn, name, 0);
    }

    /** Minimap/side-panel right-click menu finalized (skipped in bot builds). */
    onMenuBuilt(fn: MenuBuiltHandler, name: string = 'menuBuilt'): QolUnsubscribe {
        return this.register(this.menuBuilt, fn, name, 0);
    }

    /** `GameShell.resize()`. */
    onResizeCanvas(fn: ResizeCanvasHandler, name: string = 'resizeCanvas'): QolUnsubscribe {
        return this.register(this.resizeCanvas, fn, name, 0);
    }

    /**
     * Consume hook: keyboard `pollKey` codes, offered to both poll sites.
     * Return `true` to swallow the key. Priority: higher runs first.
     */
    onKey(fn: KeyHandler, name: string = 'key', priority: number = 0): QolUnsubscribe {
        return this.register(this.key, fn, name, priority);
    }

    /**
     * Consume hook: mouse clicks before vanilla menu/doAction routing.
     * Coords are full-frame; `button` is 1/2/3. Return `true` to swallow.
     */
    onClick(fn: ClickHandler, name: string = 'click', priority: number = 0): QolUnsubscribe {
        return this.register(this.click, fn, name, priority);
    }

    /** Consume hook: wheel events on the canvas (live DOM event, not a tick). */
    onWheel(fn: WheelHandler, name: string = 'wheel', priority: number = 0): QolUnsubscribe {
        return this.register(this.wheel, fn, name, priority);
    }

    /** Filter hook (any `true` wins): hides the player's model, overheads included. Never consulted for the local player. */
    onHidePlayer(fn: PlayerFilterHandler, name: string = 'hidePlayer'): QolUnsubscribe {
        return this.register(this.hidePlayer, fn, name, 0);
    }

    /** Filter hook (any `true` wins): hides the npc's model and overheads. */
    onHideNpc(fn: NpcFilterHandler, name: string = 'hideNpc'): QolUnsubscribe {
        return this.register(this.hideNpc, fn, name, 0);
    }

    /** Filter hook (any `true` wins): hides the projectile. */
    onHideProjectile(fn: ProjectileFilterHandler, name: string = 'hideProjectile'): QolUnsubscribe {
        return this.register(this.hideProjectile, fn, name, 0);
    }

    /**
     * Filter hook (any `true` wins): ground items are refused at the OBJ_ADD/
     * OBJ_REVEAL push, skipped in the `showObject` render pick and the menu pick.
     */
    onHideGroundItem(fn: GroundItemFilterHandler, name: string = 'hideGroundItem'): QolUnsubscribe {
        return this.register(this.hideGroundItem, fn, name, 0);
    }

    /** Map hook: mutate the reusable `QolCameraState` at the camFollow call site. */
    onCamera(fn: CameraMapHandler, name: string = 'camera', priority: number = 0): QolUnsubscribe {
        return this.register(this.camera, fn, name, priority);
    }

    /**
     * Map hook: return extra milliseconds to sleep after `mainredraw()` (FPS
     * caps), or `null` to pass. Later handlers see earlier results.
     */
    onFramePace(fn: FramePaceHandler, name: string = 'framePace', priority: number = 0): QolUnsubscribe {
        return this.register(this.framePace, fn, name, priority);
    }

    /**
     * Map hook: remap the top render level at the `roofCheck()` call site.
     * Return `null` to keep the vanilla value. Later handlers see earlier
     * results.
     */
    onRoofTop(fn: RoofTopMapHandler, name: string = 'roofTop', priority: number = 0): QolUnsubscribe {
        return this.register(this.roofTop, fn, name, priority);
    }

    // ---- dispatch (called from Qol) ----

    get tickCount(): number {
        return this.countOf(this.tick);
    }

    get drawSceneCount(): number {
        return this.countOf(this.drawScene);
    }

    get drawTopCount(): number {
        return this.countOf(this.drawTop);
    }

    get xpGainCount(): number {
        return this.countOf(this.xpGain);
    }

    get menuBuiltCount(): number {
        return this.countOf(this.menuBuilt);
    }

    get resizeCanvasCount(): number {
        return this.countOf(this.resizeCanvas);
    }

    get keyCount(): number {
        return this.countOf(this.key);
    }

    get clickCount(): number {
        return this.countOf(this.click);
    }

    get wheelCount(): number {
        return this.countOf(this.wheel);
    }

    get hidePlayerCount(): number {
        return this.countOf(this.hidePlayer);
    }

    get hideNpcCount(): number {
        return this.countOf(this.hideNpc);
    }

    get hideProjectileCount(): number {
        return this.countOf(this.hideProjectile);
    }

    get hideGroundItemCount(): number {
        return this.countOf(this.hideGroundItem);
    }

    get cameraCount(): number {
        return this.countOf(this.camera);
    }

    get framePaceCount(): number {
        return this.countOf(this.framePace);
    }

    get roofTopCount(): number {
        return this.countOf(this.roofTop);
    }

    dispatchTick(dtMs: number): void {
        this.dispatchEvent(this.tick, (h) => h(dtMs));
    }

    dispatchDrawScene(g: QolGraphics): void {
        this.dispatchEvent(this.drawScene, (h) => h(g));
    }

    dispatchDrawTop(g: QolGraphics): void {
        this.dispatchEvent(this.drawTop, (h) => h(g));
    }

    dispatchXpGain(e: QolXpGainEvent): void {
        this.dispatchEvent(this.xpGain, (h) => h(e));
    }

    dispatchMenuBuilt(menu: QolMenuView): void {
        this.dispatchEvent(this.menuBuilt, (h) => h(menu));
    }

    dispatchResizeCanvas(width: number, height: number): void {
        this.dispatchEvent(this.resizeCanvas, (h) => h(width, height));
    }

    dispatchKey(ch: number): boolean {
        return this.dispatchConsume(this.key, (h) => h(ch));
    }

    dispatchClick(e: QolClickEvent): boolean {
        return this.dispatchConsume(this.click, (h) => h(e));
    }

    dispatchWheel(e: QolWheelEvent): boolean {
        return this.dispatchConsume(this.wheel, (h) => h(e));
    }

    dispatchHidePlayer(player: ClientPlayer): boolean {
        return this.dispatchFilter(this.hidePlayer, (h) => h(player));
    }

    dispatchHideNpc(npc: ClientNpc): boolean {
        return this.dispatchFilter(this.hideNpc, (h) => h(npc));
    }

    dispatchHideProjectile(proj: ClientProj): boolean {
        return this.dispatchFilter(this.hideProjectile, (h) => h(proj));
    }

    dispatchHideGroundItem(obj: ClientObj): boolean {
        return this.dispatchFilter(this.hideGroundItem, (h) => h(obj));
    }

    /** Runs the camera map chain over the reusable state object (mutates it). */
    dispatchCamera(state: QolCameraState): void {
        this.dispatchEvent(this.camera, (h) => h(state));
    }

    dispatchFramePace(nowMs: number): number | null {
        let result: number | null = null;
        for (const slot of this.framePace) {
            if (slot.disabled) {
                continue;
            }
            try {
                const value: number | null = slot.fn(nowMs, result);
                if (value !== null && value !== undefined) {
                    result = value;
                }
            } catch (e) {
                this.recordError(slot, e);
            }
        }
        return result;
    }

    /** Pipes the top render level through the chain; null when nothing overrode it. */
    dispatchRoofTop(maxLevel: number): number | null {
        let result: number | null = null;
        for (const slot of this.roofTop) {
            if (slot.disabled) {
                continue;
            }
            try {
                const value: number | null = slot.fn(result ?? maxLevel);
                if (value !== null && value !== undefined) {
                    result = value;
                }
            } catch (e) {
                this.recordError(slot, e);
            }
        }
        return result;
    }

    // ---- internals ----

    private countOf<T>(list: Array<HookSlot<T>>): number {
        let n: number = 0;
        for (const slot of list) {
            if (!slot.disabled) {
                n++;
            }
        }
        return n;
    }

    private register<T>(list: Array<HookSlot<T>>, fn: T, name: string, priority: number): QolUnsubscribe {
        const slot: HookSlot<T> = { fn, name, priority, order: this.nextOrder++, errors: 0, disabled: false };
        list.push(slot);
        if (priority !== 0) {
            // Stable descending-priority order.
            list.sort((a: HookSlot<T>, b: HookSlot<T>) => b.priority - a.priority || a.order - b.order);
        }
        return () => {
            slot.disabled = true;
            const index: number = list.indexOf(slot);
            if (index !== -1) {
                list.splice(index, 1);
            }
        };
    }

    private dispatchEvent<T>(list: Array<HookSlot<T>>, call: (fn: T) => void): void {
        for (let i: number = 0; i < list.length; i++) {
            const slot = list[i];
            if (slot.disabled) {
                continue;
            }
            try {
                call(slot.fn);
            } catch (e) {
                this.recordError(slot, e);
            }
        }
    }

    private dispatchConsume<T>(list: Array<HookSlot<T>>, call: (fn: T) => boolean): boolean {
        for (let i: number = 0; i < list.length; i++) {
            const slot = list[i];
            if (slot.disabled) {
                continue;
            }
            try {
                if (call(slot.fn)) {
                    return true;
                }
            } catch (e) {
                this.recordError(slot, e);
            }
        }
        return false;
    }

    private dispatchFilter<T>(list: Array<HookSlot<T>>, call: (fn: T) => boolean): boolean {
        for (let i: number = 0; i < list.length; i++) {
            const slot = list[i];
            if (slot.disabled) {
                continue;
            }
            try {
                if (call(slot.fn)) {
                    return true;
                }
            } catch (e) {
                this.recordError(slot, e);
            }
        }
        return false;
    }

    /** Count a handler failure; auto-disable with one console.warn at the cap. */
    private recordError(slot: { name: string; errors: number; disabled: boolean }, e: unknown): void {
        slot.errors++;
        if (slot.errors >= MAX_HANDLER_ERRORS && !slot.disabled) {
            slot.disabled = true;
            console.warn(`[qol] hook '${slot.name}' failed ${slot.errors} times, disabling it`, e);
        }
    }
}

export default QolHooks;

// QoL lifecycle + dispatch hub (docs/qol-features-plan.md §2.2/§2.3).
//
// One instance lives on `Client` (created at the end of `maininit()` when the
// fonts/interfaces/sprites are loaded). Client calls the `dispatch*` methods at
// the `// qol:` tagged hook sites; every dispatch is a cheap no-op while its
// hook has no handlers, and each handler call is error-contained by QolHooks.
//
// Coordinate spaces — important for the draw hooks:
//  - `drawScene` and `drawTop` both run inside `Client.gameDrawMain()` writing
//    the 512x334 scene buffer, which is blitted at screen (4, 4):
//    viewport-local pixel = screen pixel - (4, 4). Tile projection
//    (`ctx.projectTile`/`projectEntity`) returns the same viewport-local space.
//  - `click`/`wheel` coords are full-frame (0..765 x 0..503), matching
//    `mouseClickX/Y`.
//  - `drawScene` runs after world rendering but before the interface/menu pass
//    (world overlays under the UI); `drawTop` runs after it (over modals).
//    Both are dispatched here rather than at the end of `gameDraw()` because
//    that buffer is cleared by `Pix2D.cls()` before each frame's blit — pixels
//    written after `areaGame.draw(4, 4)` would never reach the screen.

import { canvas, canvas2d } from '#/graphics/Canvas.js';
import Pix2D from '#/graphics/Pix2D.js';

import { QolDom, qolDomEnsureCss } from '#/client/qol/QolDom.js';
import QolSettingsPanel from '#/client/qol/QolSettingsPanel.js';
import { QolConfig } from '#/client/qol/QolConfig.js';
import { QolContext, QolMenuViewImpl } from '#/client/qol/QolContext.js';
import { QolGraphics } from '#/client/qol/QolGraphics.js';
import { QolHooks } from '#/client/qol/QolHooks.js';

import type { QolCameraState, QolClickEvent, QolWheelEvent, QolXpGainEvent } from '#/client/qol/QolHooks.js';
import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';
import type ClientProj from '#/dash3d/ClientProj.js';

declare const process: { env: { ENABLE_BOT_SDK?: string } };

/** KeyCodes.ts ch for F10 — toggles the settings panel (canvas keeps focus). */
const KEY_F10: number = 1017;
/** KeyCodes.ts ch for Escape — closes the settings panel. */
const KEY_ESCAPE: number = 27;
/** Panel input priority: above every plugin, so it gets first refusal. */
const PANEL_PRIORITY: number = 10000;

/**
 * The gear toggle button. x 519..545 / y 340..352 sits in the dead strip
 * between the viewport (ends at x=516) and the minimap panel (hit-tests start
 * at x=553; `iconLoop` uses 539..573 but only y 168..205, and the minimap
 * itself 575..720 / 8..158), so no vanilla hit-test claims it. It is drawn as
 * a canvas-space overlay tile (background captured once, re-restored every
 * frame) because that strip lives in the static frame buffers, not the scene
 * buffer the draw hooks paint into.
 */
const GEAR_X: number = 519;
const GEAR_Y: number = 340;
const GEAR_W: number = 26;
const GEAR_H: number = 12;

/**
 * The foundation object behind every `// qol:` call site in Client/GameShell.
 */
export class Qol {
    /** Setting registry + localStorage persistence ('rs-qol-v1'). */
    readonly config: QolConfig;
    /** Typed hook bus. */
    readonly hooks: QolHooks = new QolHooks();
    /** Shared drawing facade. */
    readonly g: QolGraphics = new QolGraphics();
    /** DOM overlay layer (frame orbs, dockable panels). */
    readonly dom: QolDom = new QolDom();
    /** The facade passed to plugin `register(ctx)`. */
    readonly ctx: QolContext;
    /** Settings panel (C2 implements the body; the wiring is already here). */
    readonly panel: QolSettingsPanel;

    private readonly menuView: QolMenuViewImpl;
    private readonly chatCommands: Map<string, () => void> = new Map();

    // Reused dispatch payloads — hot paths (tick, click, camera) allocate nothing.
    private readonly clickEvent: QolClickEvent = { button: 0, x: 0, y: 0, shift: false, alt: false, ctrl: false, middle: false };
    private readonly wheelEvent: QolWheelEvent = { dx: 0, dy: 0, x: 0, y: 0 };
    private readonly xpEvent: QolXpGainEvent = { skill: 0, oldXp: 0, newXp: 0, oldLevel: 0, newLevel: 0 };
    private readonly cameraState: QolCameraState = { pitch: 0, distance: 0, minPitch: 128, maxPitch: 383 };
    private lastTickMs: number = 0;
    private gearBackground: ImageData | null = null;
    private gearCaptured: boolean = false;
    private gearDrawn: boolean = false;

    /** @param client the live `Client` instance */
    constructor(readonly client: any) {
        this.config = new QolConfig(Qol.isBotBuildStatic());
        this.menuView = new QolMenuViewImpl(client);
        this.ctx = new QolContext(client, this.config, this.hooks, this.g, (cmd: string, cb: () => void) => this.registerChatCommand(cmd, cb));
        this.ctx.dom = this.dom;
        this.panel = new QolSettingsPanel(this.ctx);
    }

    /** True in the bot browser build (`process.env.ENABLE_BOT_SDK === 'true'`, defined by bundle.ts). */
    isBotBuild(): boolean {
        return Qol.isBotBuildStatic();
    }

    /**
     * Wire the panel/commands and the GameShell callbacks. Called once from
     * `Client.maininit()` (via `createQol`); assets and fonts are loaded by
     * then, and dispatch sites are null-guarded until it returns.
     */
    init(): void {
        // DOM docks (orbs on the frame beside the minimap, tracker/timer panels
        // floating beside the client when the window is wide enough).
        qolDomEnsureCss();
        this.dom.attach(canvas);
        this.config.define({
            key: 'overlay.domDocks',
            section: 'Overlays',
            label: 'Dock overlays off-viewport',
            type: 'boolean',
            default: true,
            tooltip: 'HP/Prayer orbs sit on the frame beside the minimap; the XP tracker and stat timers float beside the game window when it fits, instead of covering the viewport. Off draws them inside the viewport as before.'
        });

        // Panel navigation before any plugin sees the input: F10 toggles
        // (in-game only, so login typing is never swallowed), ESC closes.
        this.hooks.onKey((ch: number): boolean => {
            if (ch === KEY_ESCAPE && this.panel.isOpen()) {
                this.panel.close();
                return true;
            }
            if (ch === KEY_F10 && this.ctx.ingame()) {
                this.panel.toggle();
                return true;
            }
            return false;
        }, 'qol-panel-keys', PANEL_PRIORITY + 1);

        // While open the panel owns the mouse; the gear rect toggles it.
        this.hooks.onClick((e: QolClickEvent): boolean => {
            if (this.panel.isOpen()) {
                return this.panel.handleClick(e);
            }
            if (e.button === 1 && e.x >= GEAR_X && e.x < GEAR_X + GEAR_W && e.y >= GEAR_Y && e.y < GEAR_Y + GEAR_H) {
                this.panel.toggle();
                return true;
            }
            return false;
        }, 'qol-panel-clicks', PANEL_PRIORITY);

        this.registerChatCommand('qol', () => this.panel.toggle());

        // GameShell hook plumbing (see the `// qol:` fields there).
        this.client.onqolwheel = (dx: number, dy: number, x: number, y: number): boolean => this.dispatchWheel(dx, dy, x, y);
        this.client.onqolresize = (width: number, height: number): void => this.dispatchResize(width, height);
        this.client.onqolframepace = (nowMs: number): number | null => this.mapFramePace(nowMs);
    }

    // ---- input state exposure ----

    /** Shift as seen from native DOM events (never via keyHeld/keyQueue). */
    shiftHeld(): boolean {
        return this.client.shiftHeld === true;
    }

    /** True while the middle mouse button is held (GameShell maps it to button state 3). */
    middleDown(): boolean {
        return this.client.mouseButton === 3;
    }

    // ---- hook dispatch ----

    /** End of `Client.gameLoop()`; dt is wall-clock ms since the previous tick. */
    dispatchTick(): void {
        // DOM docks reposition on canvas moves; cheap (few widgets, cached rect).
        this.dom.layout();
        if (this.hooks.tickCount === 0) {
            return;
        }
        const now: number = performance.now();
        const dt: number = this.lastTickMs === 0 ? 0 : now - this.lastTickMs;
        this.lastTickMs = now;
        this.hooks.dispatchTick(dt);
    }

    /** World-space overlay pass inside `gameDrawMain` (before modals/menus). */
    dispatchDrawScene(): void {
        if (this.hooks.drawSceneCount === 0) {
            return;
        }
        const g: QolGraphics = this.g;
        g.pushClip(0, 0, Pix2D.width, Pix2D.height);
        try {
            this.hooks.dispatchDrawScene(g);
        } finally {
            // A handler that throws mid-draw may leave pushClip entries on the
            // stack; a leaked clip corrupts every later draw (and grows the
            // stack). Reset is cheap and makes handler throws stateless.
            g.resetClip();
        }
    }

    /** Topmost UI pass (after modals/menus), then the gear button tile. */
    dispatchDrawTop(): void {
        const count: number = this.hooks.drawTopCount;
        if (count > 0 || this.panel.isOpen()) {
            const g: QolGraphics = this.g;
            g.pushClip(0, 0, Pix2D.width, Pix2D.height);
            try {
                if (count > 0) {
                    this.hooks.dispatchDrawTop(g);
                }
                if (this.panel.isOpen()) {
                    this.panel.draw(g);
                }
            } finally {
                g.resetClip();
            }
        }
        this.drawGearButton();
    }

    /** Key consume hook from both `pollKey()` sites; true = swallowed. */
    dispatchKey(ch: number): boolean {
        if (this.hooks.keyCount === 0) {
            return false;
        }
        return this.hooks.dispatchKey(ch);
    }

    /** Click consume hook from the top of `Client.mouseLoop()`; button 1/2/3. */
    dispatchClick(button: number, x: number, y: number): boolean {
        if (this.hooks.clickCount === 0) {
            return false;
        }
        const e = this.clickEvent;
        e.button = button;
        e.x = x;
        e.y = y;
        e.shift = this.client.shiftHeld === true;
        e.alt = this.client.altHeld === true;
        e.ctrl = this.client.ctrlHeld === true;
        e.middle = button === 3;
        return this.hooks.dispatchClick(e);
    }

    /** Wheel consume hook from the GameShell canvas listener (live event). */
    dispatchWheel(dx: number, dy: number, x: number, y: number): boolean {
        if (this.hooks.wheelCount === 0) {
            return false;
        }
        const e = this.wheelEvent;
        e.dx = dx;
        e.dy = dy;
        e.x = x;
        e.y = y;
        return this.hooks.dispatchWheel(e);
    }

    /** UPDATE_STAT payload; dispatched after the overwrite with captured old values. */
    dispatchXpGain(skill: number, oldXp: number, newXp: number, oldLevel: number, newLevel: number): void {
        if (this.hooks.xpGainCount === 0) {
            return;
        }
        const e = this.xpEvent;
        e.skill = skill;
        e.oldXp = oldXp;
        e.newXp = newXp;
        e.oldLevel = oldLevel;
        e.newLevel = newLevel;
        this.hooks.dispatchXpGain(e);
    }

    /** End of `buildMinimenu()`, outside bot builds only (client gates the call). */
    dispatchMenuBuilt(): void {
        if (this.hooks.menuBuiltCount === 0) {
            return;
        }
        this.hooks.dispatchMenuBuilt(this.menuView);
    }

    /** Entity hider filter for a non-local player. */
    hidePlayerFilter(player: ClientPlayer): boolean {
        return this.hooks.hidePlayerCount > 0 && this.hooks.dispatchHidePlayer(player);
    }

    /** Entity hider filter for an npc. */
    hideNpcFilter(npc: ClientNpc): boolean {
        return this.hooks.hideNpcCount > 0 && this.hooks.dispatchHideNpc(npc);
    }

    /** Entity hider filter for a projectile. */
    hideProjectileFilter(proj: ClientProj): boolean {
        return this.hooks.hideProjectileCount > 0 && this.hooks.dispatchHideProjectile(proj);
    }

    /** Ground-item hider filter (add + pick + menu paths). */
    hideGroundItemFilter(obj: ClientObj): boolean {
        return this.hooks.hideGroundItemCount > 0 && this.hooks.dispatchHideGroundItem(obj);
    }

    /**
     * Camera map hook at the `camFollow` call site. Returns the shared state
     * with mapped `pitch`/`distance`, or null when no camera plugin is
     * registered (caller keeps its vanilla values). `minPitch`/`maxPitch` are
     * sticky: the pitch clamps read them via `cameraLimits()`.
     */
    mapCamera(pitch: number, distance: number): QolCameraState | null {
        if (this.hooks.cameraCount === 0) {
            return null;
        }
        const state = this.cameraState;
        state.pitch = pitch;
        state.distance = distance;
        this.hooks.dispatchCamera(state);
        return state;
    }

    /** Pitch clamp overrides, or null while no camera hook exists (vanilla 128/383). */
    cameraLimits(): QolCameraState | null {
        return this.hooks.cameraCount === 0 ? null : this.cameraState;
    }

    /** `framePace` map hook: extra ms to sleep after `mainredraw()` (or null). */
    mapFramePace(nowMs: number): number | null {
        if (this.hooks.framePaceCount === 0) {
            return null;
        }
        return this.hooks.dispatchFramePace(nowMs);
    }

    /** `GameShell.resize()`. */
    dispatchResize(width: number, height: number): void {
        if (this.hooks.resizeCanvasCount === 0) {
            return;
        }
        this.hooks.dispatchResizeCanvas(width, height);
    }

    // ---- chat commands ----

    /** Register `::cmd`; foundation dispatch consults this before the CLIENT_CHEAT passthrough. */
    registerChatCommand(cmd: string, cb: () => void): void {
        this.chatCommands.set(cmd.toLowerCase(), cb);
    }

    /**
     * Try to consume a typed `::command` (text after the two colons, may carry
     * arguments). Returns true when a registered command ran — the chat chain
     * then skips the server CLIENT_CHEAT passthrough.
     */
    handleChatCommand(input: string): boolean {
        const space: number = input.indexOf(' ');
        const cmd: string = (space === -1 ? input : input.substring(0, space)).trim().toLowerCase();
        const cb = this.chatCommands.get(cmd);
        if (cb === undefined) {
            return false;
        }
        try {
            cb();
        } catch (e) {
            console.warn(`[qol] chat command '::${cmd}' failed`, e);
        }
        return true;
    }

    // ---- gear button ----

    /**
     * Paint the toggle gear into the frame strip via canvas2d (see GEAR_* for
     * the dead-zone analysis). The strip buffer is only refreshed on full
     * frame redraws, so the overlay restores a captured background every frame
     * it is not drawn, leaving no ghost when the plugin layer disables it.
     */
    private drawGearButton(): void {
        if (typeof window === 'undefined' || canvas2d === null || canvas2d === undefined) {
            return;
        }

        const draw: boolean = this.ctx.ingame() && !this.panel.isOpen();
        if (!draw && !this.gearDrawn) {
            return;
        }

        try {
            if (!this.gearCaptured) {
                this.gearBackground = canvas2d.getImageData(GEAR_X, GEAR_Y, GEAR_W, GEAR_H);
                this.gearCaptured = true;
            }
            if (this.gearBackground !== null) {
                canvas2d.putImageData(this.gearBackground, GEAR_X, GEAR_Y);
            }
            if (draw) {
                canvas2d.fillStyle = '#23201b';
                canvas2d.fillRect(GEAR_X, GEAR_Y, GEAR_W, GEAR_H);
                canvas2d.strokeStyle = '#4d4233';
                canvas2d.strokeRect(GEAR_X + 0.5, GEAR_Y + 0.5, GEAR_W - 1, GEAR_H - 1);
                // A gear silhouette: hub + four teeth, pixel-cheap.
                canvas2d.fillStyle = '#766654';
                const cx: number = GEAR_X + (GEAR_W >> 1);
                const cy: number = GEAR_Y + (GEAR_H >> 1);
                canvas2d.fillRect(cx - 1, cy - 5, 3, 11);
                canvas2d.fillRect(cx - 5, cy - 1, 11, 3);
                canvas2d.fillRect(cx - 3, cy - 3, 7, 7);
                canvas2d.fillStyle = '#23201b';
                canvas2d.fillRect(cx - 1, cy - 1, 3, 3);
            }
            this.gearDrawn = draw;
        } catch (e) {
            // Off-screen canvas or detached context: drop the button silently.
            this.gearCaptured = false;
            this.gearBackground = null;
        }
    }

    private static isBotBuildStatic(): boolean {
        // bundle.ts `define`s this member expression to the string literal,
        // exactly like Client.ts line 82 — no typeof guard (it would evaluate
        // false at browser runtime and break the bot-build suppression).
        return process.env.ENABLE_BOT_SDK === 'true';
    }
}

export default Qol;

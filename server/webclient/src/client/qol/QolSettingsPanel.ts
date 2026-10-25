// QoL Client Options panel — STUB (wave 2 / chunk C2 implements the body).
//
// The lifecycle contract that `Qol.ts` already wires around this class:
//  - F10 (`key` hook, ch 1017) and `::qol` toggle it, ESC closes it;
//  - while open, clicks at priority 10000 are offered to `handleClick` first
//    and any consumed click never reaches the vanilla menu/doAction path;
//  - `draw(g)` is called from the `drawTop` pass (512x334 scene buffer,
//    viewport-local coordinates; screen pixel = buffer pixel + (4, 4)).
// C2 replaces only the internals of this file.

import type { QolClickEvent } from '#/client/qol/QolHooks.js';
import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';

/**
 * Canvas-drawn settings overlay. Constructor takes the plugin context so the
 * implementation can read `ctx.config.defs()` / `ctx.g` / `ctx.fonts()`.
 */
export default class QolSettingsPanel {
    private panelOpen: boolean = false;

    constructor(protected readonly ctx: QolContext) {}

    /** True while the panel is visible and eating input. */
    isOpen(): boolean {
        return this.panelOpen;
    }

    /** Flip open/closed (F10, `::qol`, gear button). */
    toggle(): void {
        this.panelOpen = !this.panelOpen;
    }

    /** Show the panel. */
    open(): void {
        this.panelOpen = true;
    }

    /** Hide the panel (ESC, close button). */
    close(): void {
        this.panelOpen = false;
    }

    /**
     * A click while open. The stub swallows everything (game input is frozen
     * behind the panel); C2 replaces this with row hit-testing and returns
     * false for clicks outside the panel rect.
     */
    handleClick(_e: QolClickEvent): boolean {
        return this.panelOpen;
    }

    /** Render the panel. The stub draws nothing. */
    draw(_g: QolGraphics): void {
        // C2: section list, generic setting rows, footer buttons (C2).
    }
}

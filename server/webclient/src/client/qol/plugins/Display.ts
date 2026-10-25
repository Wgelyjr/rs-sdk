// F8 display scaling (stretched mode) + F9 FPS unlock — wave 2, chunk C6
// (docs/qol-features-plan.md §4). This chunk also owns this wave's GameShell.ts
// edits; both features touch only the presentation/pacing layer: the internal
// 765x503 canvas buffer (and every coordinate space the client knows) never
// changes.
//
// F8 model: rewrite the canvas' INLINE css width/height (+ image-rendering)
// only. Click mapping stays exact because GameShell.getMousePos() divides the
// clientX/clientY offset by getBoundingClientRect() ratios (canvas.width /
// rect.width) — any CSS scale self-corrects, and the mouse, pointer, touch and
// qol-wheel paths all funnel through that one function. The engine pages write
// the same inline props (server/engine/view/client.ejs `setSize()`,
// bot.ejs minimal mode via a stylesheet `!important` rule), so our writes use
// inline `!important` (inline important beats everything) and the `tick` hook
// re-asserts when the page's own controls clobber us. 'Off' restores the
// inline values captured before the first override — pixel-identical to today.
// Fullscreen yields to the browser (it ignores inline sizes on the fullscreen
// element and GameShell's fullscreen mouse math models that letterboxing).
//
// F9 model: `visual.fpsCap` maps to GameShell.setQolFramePace — '50 (default)'
// = 0 = the untouched vanilla accumulator loop; higher caps run mainredraw()
// at the cap while GameShell's wall-clock logic accumulator keeps mainloop()
// at the loop's own measured step interval (game speed invariant); 'Unlimited'
// = Infinity = pacing sleep floored at mindel. The framePace hook and the
// mobile tfps governor keep their sleeps (they are measured into the pacing,
// never cancelled). Direct loop surgery rather than driving the `framePace`
// hook: the hook can only ADD sleep after mainredraw() — it cannot shorten
// the loop-top `sleep(delta)` (the ~70 Hz outer floor) and cannot decouple
// the logic accumulator, which the ±2% logic-invariance requirement needs.

import { canvas } from '#/graphics/Canvas.js';

import type { QolContext } from '#/client/qol/QolContext.js';

/** Native frame size; the live canvas.width/height are preferred over these. */
const FRAME_WIDTH: number = 765;
const FRAME_HEIGHT: number = 503;

/** visual.displayScale choice labels (exact strings — the setting's value domain). */
const SCALE_OFF: string = 'Off';
const SCALE_INTEGER: string = 'Integer';
const SCALE_FIT: string = 'Fit';

/** visual.fpsCap choice label → GameShell redraw target (0 = vanilla pacing). */
const FPS_TARGET_HZ: Record<string, number> = {
    '50 (default)': 0,
    '60': 60,
    '75': 75,
    '120': 120,
    '144': 144,
    '240': 240,
    'Unlimited': Number.POSITIVE_INFINITY
};

/** Inline style properties owned by this plugin while a scale mode is on. */
const STYLE_WIDTH: number = 0;
const STYLE_HEIGHT: number = 1;
const STYLE_PROPS: string[] = ['width', 'height', 'maxWidth', 'maxHeight', 'imageRendering'];

/** Re-assert check period (ms): cheap insurance against the page's size controls. */
const VERIFY_INTERVAL_MS: number = 250;

/** The canvas element, or null in non-DOM environments (lite runner, bun test). */
function getCanvasElement(): HTMLCanvasElement | null {
    if (typeof document === 'undefined' || !canvas) {
        return null;
    }
    return canvas;
}

/** True while the document (canvas) is fullscreen — scaling yields to the browser. */
function isFullscreen(): boolean {
    return typeof document !== 'undefined' && document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

/**
 * Plugin state for one register() call (one Qol layer per Client). Kept in a
 * class so the hook closures capture only `this`.
 */
class DisplayState {
    /** Style strings last written by us; empty array = no active override. */
    wanted: string[] = [];
    /** Inline values/priorities captured before the first override ('Off' restores). */
    saved: string[] | null = null;
    savedPriorities: string[] | null = null;
    /** Wall-clock gate for the tick re-assert check. */
    nextVerifyMs: number = 0;
}

class DisplayControls {
    private readonly state: DisplayState = new DisplayState();

    constructor(private readonly ctx: QolContext) { }

    /** Settings → DOM/pacing sync for display scaling; idempotent, recompute-safe. */
    applyScale(): void {
        const el: HTMLCanvasElement | null = getCanvasElement();
        if (el === null || typeof window === 'undefined') {
            return;
        }

        const mode: string = this.scaleMode();
        if (mode === SCALE_OFF || isFullscreen()) {
            this.restore(el);
            return;
        }

        this.capture(el);

        // Mirror client.ejs setSize('auto'): reserve the controls strip when it is
        // visible, so the scaled canvas plus page chrome still fits without scroll.
        const iw: number = el.width > 0 ? el.width : FRAME_WIDTH;
        const ih: number = el.height > 0 ? el.height : FRAME_HEIGHT;
        const availW: number = window.innerWidth > 0 ? window.innerWidth : iw;
        let availH: number = window.innerHeight > 0 ? window.innerHeight : ih;
        const controls: HTMLElement | null = typeof document === 'undefined' ? null : document.getElementById('controls');
        if (controls !== null && window.getComputedStyle(controls).display !== 'none') {
            availH = Math.max(1, availH - Math.max(window.innerHeight * 0.05, 40));
        }

        let width: number;
        let height: number;
        if (mode === SCALE_INTEGER) {
            const k: number = Math.max(1, Math.min(Math.floor(availW / iw), Math.floor(availH / ih)));
            width = iw * k;
            height = ih * k;
        } else {
            const scale: number = Math.min(availW / iw, availH / ih);
            width = Math.round(iw * scale);
            height = Math.round(ih * scale);
        }

        const values: string[] = [`${Math.round(width)}px`, `${Math.round(height)}px`, 'none', 'none', 'pixelated'];
        for (let i: number = 0; i < STYLE_PROPS.length; i++) {
            el.style.setProperty(STYLE_PROPS[i], values[i], 'important');
        }
        this.state.wanted = values;
    }

    /** Settings → GameShell pacing sync. */
    applyFpsCap(): void {
        const label: string = this.ctx.config.getStr('visual.fpsCap');
        const target: number = FPS_TARGET_HZ[label] !== undefined ? FPS_TARGET_HZ[label] : 0;
        const client = this.ctx.client as { setQolFramePace?: (targetHz: number, logicPeriodMs?: number) => void };
        if (client != null && typeof client.setQolFramePace === 'function') {
            client.setQolFramePace(target);
        }
    }

    /**
     * Cheap tick guard: the page's own size controls (hideControls/setSize) write
     * the same inline props without `!important`, so a stale comparison of the
     * two size strings catches any clobber and re-applies. No-ops when Off.
     */
    verifyScale(): void {
        if (this.state.wanted.length === 0) {
            return;
        }
        const el: HTMLCanvasElement | null = getCanvasElement();
        if (el === null) {
            return;
        }
        if (el.style.getPropertyValue(STYLE_PROPS[STYLE_WIDTH]) !== this.state.wanted[STYLE_WIDTH]
            || el.style.getPropertyValue(STYLE_PROPS[STYLE_HEIGHT]) !== this.state.wanted[STYLE_HEIGHT]) {
            this.applyScale();
        }
    }

    /** Current scale mode, coerced to the choice domain. */
    private scaleMode(): string {
        const mode: string = this.ctx.config.getStr('visual.displayScale');
        return mode === SCALE_INTEGER || mode === SCALE_FIT ? mode : SCALE_OFF;
    }

    /** Snapshot our inline style slot values before the first override. */
    private capture(el: HTMLCanvasElement): void {
        if (this.state.saved !== null) {
            return;
        }
        const values: string[] = [];
        const priorities: string[] = [];
        for (const prop of STYLE_PROPS) {
            values.push(el.style.getPropertyValue(prop));
            priorities.push(el.style.getPropertyPriority(prop));
        }
        this.state.saved = values;
        this.state.savedPriorities = priorities;
    }

    /** Put the captured inline values back (no-op when we never overrode). */
    private restore(el: HTMLCanvasElement): void {
        if (this.state.wanted.length === 0 || this.state.saved === null || this.state.savedPriorities === null) {
            this.state.wanted = [];
            return;
        }
        for (let i: number = 0; i < STYLE_PROPS.length; i++) {
            el.style.removeProperty(STYLE_PROPS[i]);
            if (this.state.saved[i] !== '') {
                el.style.setProperty(STYLE_PROPS[i], this.state.saved[i], this.state.savedPriorities[i]);
            }
        }
        this.state.wanted = [];
    }

    /** Wire settings, listeners and hooks; sync both features once at register. */
    register(): void {
        const config = this.ctx.config;
        config.define({
            key: 'visual.displayScale',
            section: 'Visuals',
            label: 'Display scaling',
            type: 'choice',
            choices: [SCALE_OFF, SCALE_INTEGER, SCALE_FIT],
            default: SCALE_OFF,
            tooltip: 'CSS-stretch the 765x503 frame. Integer = whole-pixel scale (crisp), Fit = fill the window (still crisp pixels, fractional scale). Clicks map through the scale automatically. Off = today.'
        });
        config.define({
            key: 'visual.fpsCap',
            section: 'Visuals',
            label: 'Max framerate',
            type: 'choice',
            choices: ['50 (default)', '60', '75', '120', '144', '240', 'Unlimited'],
            default: '50 (default)',
            tooltip: 'Redraw rate cap for the render loop. Game logic speed is unchanged at every cap. 50 (default) = the client\u2019s built-in pacing.'
        });

        config.onChange('visual.displayScale', (): void => this.applyScale());
        config.onChange('visual.fpsCap', (): void => this.applyFpsCap());

        // GameShell.resize() → re-assert (internal size is fixed, but a resize()
        // would change the buffer our scale math reads from).
        this.ctx.hooks.onResizeCanvas((): void => this.applyScale(), 'display-scale-resize');

        // Our own listeners: with resizeToFit=false (every engine view) GameShell's
        // resizeHandler never calls resize(), so the window listener is the only
        // signal for scaling on window changes.
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', (): void => this.applyScale());
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('fullscreenchange', (): void => this.applyScale());
        }

        // Periodic clobber check (see verifyScale). ~free when Off (empty wanted).
        this.ctx.hooks.onTick((): void => {
            const now: number = performance.now();
            if (now >= this.state.nextVerifyMs) {
                this.state.nextVerifyMs = now + VERIFY_INTERVAL_MS;
                this.verifyScale();
            }
        }, 'display-scale-verify');

        this.applyScale();
        this.applyFpsCap();
    }
}

export default {
    name: 'Display',
    register(ctx: QolContext): void {
        new DisplayControls(ctx).register();
    }
};

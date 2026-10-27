// QoL Client Options panel (docs/qol-features-plan.md §3, chunk C2).
//
// Canvas-drawn settings overlay rendered into the 512x334 scene buffer during
// the `drawTop` pass (viewport-local coords; screen pixel = buffer pixel + (4,4)).
// `Qol.ts` owns the entry points: F10 / `::qol` / gear button toggle it, ESC
// closes it, clicks at priority 10000 are offered to `handleClick` first. This
// class adds its own `key` (9999) and `wheel` (9999) hook registrations so it
// owns the keyboard and scrolls the row list while open, below the foundation's
// F10/ESC handler at 10001.
//
// The body renders generically from the `QolConfig` registry: the left column
// lists `config.sections()`, the right column scrollable rows come from
// `config.defs(section)`, so every wave-2 plugin's settings appear the moment
// they `define()`. With an empty registry an 'About' section is shown instead
// so the panel is never blank.
//
// Input model:
//  - clicks arrive once per press (the `click` consume hook fires from
//    `mouseLoop` on `mouseClickButton`), so drags (slider handle, scrollbar
//    thumb) continue by polling `client.mouseButton/mouseX/mouseY` in `draw()`;
//  - click and wheel coordinates are FULL-FRAME; subtract (4,4) for buffer
//    space, then the panel origin for panel-local math;
//  - the `key` hook delivers GameShell `ch` codes (KeyCodes.ts): printable
//    characters are ASCII 32..126, backspace 8, enter 10/13, F-keys 1000+,
//    unknown keys 65535.
//
// Style: 2004 palette sampled from the client itself — menu background
// 0x5d5447 and scrollbar track / border dark 0x23201b (Client.ts), plus the
// mid-tan 0x766654 used by the qol gear button border.

import { KeyCodes } from '#/client/KeyCodes.js';
import type { SettingDef } from '#/client/qol/QolConfig.js';
import type { QolContext } from '#/client/qol/QolContext.js';
import type { QolClickEvent, QolWheelEvent } from '#/client/qol/QolHooks.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type PixFont from '#/graphics/PixFont.js';

/** Panel input key priority: below the foundation F10/ESC handler (10001). */
const KEY_PRIORITY: number = 9999;
/** Wheel priority: below the panel click ownership, above plain plugins (see plan §7). */
const WHEEL_PRIORITY: number = 9999;

// ---- geometry (panel-local; the panel lives in the 512x334 viewport) ----
const PANEL_X: number = 6;
const PANEL_Y: number = 7;
const PANEL_W: number = 500;
const PANEL_H: number = 320;
const HEADER_H: number = 20;
const FOOTER_H: number = 22;
const SECTION_W: number = 100;
const SECTION_ROW_H: number = 18;
const ROW_H: number = 26;
const SCROLLBAR_W: number = 12;
const CONTROL_W: number = 160;
const SLIDER_TRACK_W: number = CONTROL_W - 46;
const TEXT_LINE_H: number = 14;
const MAX_EDIT_LEN: number = 4096;
const ABOUT_SECTION: string = 'About';
const PSEUDO_TEXT: string = '@text';
const RESET_CONFIRM_MS: number = 3000;
const STATUS_MS: number = 4000;

// ---- 2004 palette ----
const COL_BG: number = 0x5d5447;
const COL_FRAME: number = 0x23201b;
const COL_EDGE: number = 0x766654;
const COL_HEADER_TOP: number = 0x4a4238;
const COL_HEADER_BOT: number = 0x28241e;
const COL_BUTTON: number = 0x3a352c;
const COL_TEXT: number = 0xffffff;
const COL_LABEL: number = 0xeeeeaa;
const COL_YELLOW: number = 0xffff00;
const COL_GREEN: number = 0x66ff66;
const COL_RED: number = 0xff5555;

/** Curated color-setting palette (swatch click cycles through it). */
const COLOR_PALETTE: number[] = [
    0xffffff, 0xffe000, 0xff8000, 0xff4040, 0xff00ff, 0x9000ff, 0x4040ff, 0x00c0ff, 0x00ff00, 0x008000, 0x000000
];

/** Which interactive body the panel currently shows. */
type PanelMode = 'settings' | 'export' | 'import';

/** Kinds of clickable regions produced by `layout()`. */
type RegionKind =
    | 'close'
    | 'section'
    | 'bool'
    | 'choice'
    | 'slider'
    | 'colorSwatch'
    | 'colorText'
    | 'keybind'
    | 'text'
    | 'textField'
    | 'scrollThumb'
    | 'scrollTrack'
    | 'reset'
    | 'export'
    | 'import'
    | 'back'
    | 'apply';

/**
 * One hit-testable rectangle in panel-local coordinates. The pool is reused
 * across frames (layout runs at click time and at draw time), so hit-testing
 * allocates nothing.
 */
interface PanelRegion {
    kind: RegionKind;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Setting key, section name, or {@link PSEUDO_TEXT}. */
    key: string;
    /** Owning setting def where applicable (slider drag math). */
    def: SettingDef | null;
}

/**
 * Canvas-drawn settings overlay. Constructor takes the plugin context so the
 * implementation can read `ctx.config.defs()` / `ctx.g` / `ctx.fonts()`.
 */
export default class QolSettingsPanel {
    private panelOpen: boolean = false;

    /** Current body: settings list vs export/import text field. */
    private mode: PanelMode = 'settings';
    /** Selected left-column section ('' until first layout picks one). */
    private selectedSection: string = '';
    /** Row-list scroll offset in pixels. */
    private scroll: number = 0;
    /** Text-field scroll offset in pixels. */
    private textScroll: number = 0;

    /** Focused editable control: setting key or {@link PSEUDO_TEXT}; null = none. */
    private focusedKey: string | null = null;
    /** Live edit buffer for the focused setting (committed on Enter / blur). */
    private editBuf: string = '';
    /** Buffer for the export/import text field. */
    private textBuf: string = '';
    /** Setting whose keybind is waiting for the next `key` hook event. */
    private captureKey: string | null = null;
    /** Slider being dragged (polled from the held mouse button in `draw`). */
    private dragKey: string | null = null;
    /** Scrollbar thumb drag state (+ grab offset inside the thumb). */
    private scrollDrag: boolean = false;
    private scrollGrab: number = 0;

    // qol mobile: touch drags. The click hook only fires on release, so a
    // touch can't drive slider/thumb drags the way a held mouse button does;
    // the client calls touchBegin/touchMove/touchEnd for touches that start
    // inside panelScreenRect(). A tap (no committed motion) falls through to
    // the normal synthesized click.
    private touchMode: 'none' | 'pending' | 'scroll' | 'drag' = 'none';
    private touchBeginX: number = 0;
    private touchBeginY: number = 0;
    private touchLastY: number = 0;

    /** Footer status line, with expiry so errors don't linger. */
    private statusText: string = '';
    private statusColor: number = COL_YELLOW;
    private statusUntil: number = 0;
    /** Second-click window for `Reset all`. */
    private resetArmedUntil: number = 0;

    // Layout output reused between layout/hit-test/draw (panel-local metrics).
    private readonly regions: PanelRegion[] = [];
    private regionCount: number = 0;
    private listTop: number = 0;
    private listH: number = 0;
    private listX: number = 0;
    private listW: number = 0;
    private contentH: number = 0;
    private thumbTop: number = 0;
    private thumbH: number = 0;
    private currentRows: SettingDef[] = [];
    /** true when the registry is empty and the About info body is shown. */
    private aboutMode: boolean = false;

    // Wrapped-text cache for the export/import field (recomputed only on edit).
    private wrapSource: string = '\u0000';
    private wrapWidth: number = -1;
    private wrapLines: string[] = [];

    // Font refs, resolved lazily (fonts are loaded before `createQol` per C1).
    private fontP11: PixFont | null = null;
    private fontP12: PixFont | null = null;
    private fontB12: PixFont | null = null;

    /** ch -> display name, built lazily from the shared KeyCodes table. */
    private static keyNames: Map<number, string> | null = null;

    constructor(protected readonly ctx: QolContext) {
        // Keyboard: F10/ESC stay the foundation's (priority 10001); everything
        // else while open is the panel's (text editing, capture, swallowing).
        ctx.hooks.onKey((ch: number): boolean => this.handleKey(ch), 'qol-panel-ui', KEY_PRIORITY);
        // Wheel: scroll the row list / text field while open and hovered over
        // the panel rect; otherwise pass through to camera zoom etc.
        ctx.hooks.onWheel((e: QolWheelEvent): boolean => this.handleWheel(e), 'qol-panel-wheel', WHEEL_PRIORITY);
    }

    /** True while the panel is visible and eating input. */
    isOpen(): boolean {
        return this.panelOpen;
    }

    /** Flip open/closed (F10, `::qol`, gear button). */
    toggle(): void {
        if (this.panelOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /** Show the panel with a clean input state. */
    open(): void {
        this.panelOpen = true;
        this.clearTransient();
    }

    /** Hide the panel (ESC, close button); flush pending persistence. */
    close(): void {
        this.panelOpen = false;
        this.clearTransient();
        this.ctx.config.flush();
    }

    /** Full-frame screen rect of the open panel, or null when closed. */
    panelScreenRect(): { x: number; y: number; w: number; h: number } | null {
        if (!this.panelOpen) {
            return null;
        }
        return { x: PANEL_X + 4, y: PANEL_Y + 4, w: PANEL_W, h: PANEL_H };
    }

    /** qol mobile: a finger went down inside the panel; track it for touch drags. */
    touchBegin(x: number, y: number): void {
        if (!this.panelOpen) {
            this.touchMode = 'none';
            return;
        }
        const lx: number = x - 4 - PANEL_X;
        const ly: number = y - 4 - PANEL_Y;
        if (lx < 0 || ly < 0 || lx >= PANEL_W || ly >= PANEL_H) {
            this.touchMode = 'none';
            return;
        }
        this.touchBeginX = x;
        this.touchBeginY = y;
        this.touchLastY = y;
        this.touchMode = 'pending';
    }

    /** True once the finger moved far enough to commit to a scroll/drag. */
    touchCommitted(): boolean {
        return this.touchMode === 'scroll' || this.touchMode === 'drag';
    }

    /** qol mobile: finger moved; commits to a scroll/drag on the first real motion. */
    touchMove(x: number, y: number): void {
        if (!this.panelOpen || this.touchMode === 'none') {
            return;
        }
        if (this.touchMode === 'pending') {
            if (Math.abs(x - this.touchBeginX) < 6 && Math.abs(y - this.touchBeginY) < 6) {
                return;
            }
            const lx: number = this.touchBeginX - 4 - PANEL_X;
            const ly: number = this.touchBeginY - 4 - PANEL_Y;
            const hit: PanelRegion | null = this.findRegion(lx, ly);
            if (hit !== null && hit.kind === 'slider') {
                this.dragKey = hit.key;
                this.applySlider(hit, lx);
                this.touchMode = 'drag';
            } else if (hit !== null && hit.kind === 'scrollThumb') {
                this.scrollDrag = true;
                this.scrollGrab = ly - hit.y;
                this.touchMode = 'drag';
            } else {
                this.touchMode = 'scroll';
            }
        }
        if (this.touchMode === 'drag') {
            this.applyDragAt(x - 4 - PANEL_X, y - 4 - PANEL_Y);
        } else if (this.touchMode === 'scroll') {
            // finger up (y decreasing) scrolls the list forward, like wheel down
            const dy: number = this.touchLastY - y;
            if (this.mode === 'settings') {
                this.scrollBy(dy);
            } else {
                this.textScrollBy(dy);
            }
        }
        this.touchLastY = y;
    }

    /** qol mobile: finger lifted; a committed drag releases on the next poll. */
    touchEnd(): void {
        this.touchMode = 'none';
    }

    /**
     * A click while open (full-frame coords). Consumes everything: hits act on
     * controls, anything else only clears focus/capture so no click leaks to
     * the vanilla menu/doAction path.
     */
    handleClick(e: QolClickEvent): boolean {
        if (!this.panelOpen) {
            return false;
        }
        this.layout();
        const lx: number = e.x - 4 - PANEL_X;
        const ly: number = e.y - 4 - PANEL_Y;
        const hit: PanelRegion | null = this.findRegion(lx, ly);

        // Keybind capture swallows the next click: re-clicking the same control
        // cancels capture; anything else cancels and commits a pending edit.
        if (this.captureKey !== null) {
            if (hit !== null && hit.kind === 'keybind' && hit.key === this.captureKey) {
                this.captureKey = null;
            } else {
                this.captureKey = null;
                this.commitFocus();
            }
            return true;
        }

        // Commit a pending inline edit when the click moves focus elsewhere.
        if (
            this.focusedKey !== null &&
            this.focusedKey !== PSEUDO_TEXT &&
            !(hit !== null && hit.key === this.focusedKey && (hit.kind === 'text' || hit.kind === 'colorText'))
        ) {
            this.commitFocus();
        }

        if (hit === null) {
            this.focusedKey = null;
            return true;
        }

        if (e.button === 2) {
            // Right-click: reverse-cycle the two cycle controls, else just swallowed.
            if (hit.kind === 'choice') {
                this.cycleChoice(hit.key, -1);
            } else if (hit.kind === 'colorSwatch') {
                this.cycleColor(hit.key, -1);
            }
            return true;
        }
        if (e.button !== 1) {
            return true;
        }

        switch (hit.kind) {
            case 'close':
                this.close();
                break;
            case 'section':
                this.selectedSection = hit.key;
                this.scroll = 0;
                this.focusedKey = null;
                break;
            case 'bool':
                this.ctx.config.set(hit.key, !this.ctx.config.getBool(hit.key));
                break;
            case 'choice':
                this.cycleChoice(hit.key, 1);
                break;
            case 'slider':
                this.dragKey = hit.key;
                this.applySlider(hit, lx);
                break;
            case 'colorSwatch':
                this.cycleColor(hit.key, 1);
                break;
            case 'colorText':
                if (this.focusedKey !== hit.key) {
                    this.focusedKey = hit.key;
                    this.editBuf = this.ctx.config.getStr(hit.key);
                }
                break;
            case 'keybind':
                this.captureKey = hit.key;
                break;
            case 'text':
                if (this.focusedKey !== hit.key) {
                    this.focusedKey = hit.key;
                    this.editBuf = this.ctx.config.getStr(hit.key);
                }
                break;
            case 'textField':
                this.focusedKey = PSEUDO_TEXT;
                break;
            case 'scrollThumb':
                this.scrollDrag = true;
                this.scrollGrab = ly - hit.y;
                break;
            case 'scrollTrack':
                this.pageScroll(ly < this.thumbTop ? -1 : 1);
                break;
            case 'reset':
                this.handleReset();
                break;
            case 'export':
                this.openTextField('export');
                break;
            case 'import':
                this.openTextField('import');
                break;
            case 'back':
                this.mode = 'settings';
                this.focusedKey = null;
                break;
            case 'apply':
                this.doImport();
                break;
        }
        return true;
    }

    /**
     * Render the panel into the scene buffer (viewport-local). Also continues
     * slider/thumb drags by polling the live mouse state, since the click hook
     * only fires per press.
     */
    draw(g: QolGraphics): void {
        if (!this.panelOpen) {
            return;
        }
        const now: number = this.ctx.nowMs();
        if (this.statusUntil !== 0 && now > this.statusUntil) {
            this.statusText = '';
            this.statusUntil = 0;
        }

        this.layout();
        this.pollDrag();

        // ---- frame + header ----
        g.fillRect(PANEL_X - 2, PANEL_Y - 2, PANEL_W + 4, PANEL_H + 4, COL_FRAME);
        g.fillRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, COL_BG);
        g.fillRect(PANEL_X, PANEL_Y, PANEL_W, 1, COL_EDGE);
        g.fillGradientRect(PANEL_X + 1, PANEL_Y + 1, PANEL_W - 2, HEADER_H - 1, COL_HEADER_TOP, COL_HEADER_BOT);
        g.text(this.b12(), 'Client Options', PANEL_X + 6, PANEL_Y + HEADER_H - 5, COL_YELLOW);
        const closeX: number = PANEL_X + PANEL_W - 21;
        const closeY: number = PANEL_Y + 3;
        g.fillRect(closeX, closeY, 16, 15, COL_BUTTON);
        g.drawRect(closeX, closeY, 16, 15, COL_EDGE);
        g.centreText(this.p12(), 'X', closeX + 8, closeY + 13, COL_TEXT);

        // ---- body ----
        if (this.mode === 'settings') {
            this.drawSections(g);
            this.drawRows(g, now);
            this.drawScrollbar(g);
        } else {
            this.drawTextField(g, now);
        }

        // ---- footer ----
        const footerY: number = PANEL_Y + PANEL_H - FOOTER_H;
        g.fillRect(PANEL_X, footerY, PANEL_W, 1, COL_FRAME);
        g.fillRect(PANEL_X + 1, footerY + 1, PANEL_W - 2, FOOTER_H - 2, COL_HEADER_TOP);
        for (let i: number = 0; i < this.regionCount; i++) {
            const r: PanelRegion = this.regions[i];
            if (r.kind === 'reset' || r.kind === 'export' || r.kind === 'import' || r.kind === 'back' || r.kind === 'apply') {
                const label: string = r.kind === 'reset' ? (now < this.resetArmedUntil ? 'Confirm reset?' : 'Reset all') : labelOf(r.kind);
                const color: number = r.kind === 'reset' && now < this.resetArmedUntil ? COL_YELLOW : r.kind === 'apply' ? COL_GREEN : COL_LABEL;
                g.fillRect(PANEL_X + r.x, PANEL_Y + r.y, r.w, r.h, COL_BUTTON);
                g.drawRect(PANEL_X + r.x, PANEL_Y + r.y, r.w, r.h, COL_EDGE);
                g.centreText(this.p12(), label, PANEL_X + r.x + r.w / 2, PANEL_Y + r.y + r.h - 4, color);
            }
        }

        // Status line; else the hovered row's tooltip (settings) or the field hint.
        const statusX: number = PANEL_X + 214;
        if (this.statusText !== '') {
            g.text(this.p11(), this.fit(this.p11(), this.statusText, PANEL_X + PANEL_W - 6 - statusX), statusX, footerY + FOOTER_H - 6, this.statusColor);
        } else {
            const tip: string = this.mode === 'settings' ? this.hoverTooltip() : this.mode === 'export' ? 'Exported JSON. Copy it out, or edit freely.' : 'Edit the JSON, then click Apply.';
            if (tip !== '') {
                g.text(this.p11(), this.fit(this.p11(), tip, PANEL_X + PANEL_W - 6 - statusX), statusX, footerY + FOOTER_H - 6, COL_TEXT);
            }
        }
    }

    // ---- input internals ----

    /** `key` hook body: edit buffers, capture, and keyboard ownership while open. */
    private handleKey(ch: number): boolean {
        if (!this.panelOpen) {
            return false;
        }
        if (this.captureKey !== null) {
            if (ch !== 65535) {
                this.ctx.config.set(this.captureKey, QolSettingsPanel.keyName(ch));
                this.setStatus(`Bound ${QolSettingsPanel.keyName(ch)}`, COL_GREEN);
            }
            this.captureKey = null;
            return true;
        }
        if (this.focusedKey !== null) {
            if (ch === 8) {
                if (this.focusedKey === PSEUDO_TEXT) {
                    if (this.textBuf.length > 0) {
                        this.textBuf = this.textBuf.substring(0, this.textBuf.length - 1);
                    }
                } else if (this.editBuf.length > 0) {
                    this.editBuf = this.editBuf.substring(0, this.editBuf.length - 1);
                }
            } else if (ch === 10 || ch === 13 || ch === 9) {
                if (this.focusedKey !== PSEUDO_TEXT) {
                    this.commitFocus();
                }
            } else if (ch >= 32 && ch <= 126) {
                if (this.focusedKey === PSEUDO_TEXT) {
                    if (this.textBuf.length < MAX_EDIT_LEN) {
                        this.textBuf += String.fromCharCode(ch);
                    }
                } else if (this.editBuf.length < MAX_EDIT_LEN) {
                    this.editBuf += String.fromCharCode(ch);
                }
            }
            return true;
        }
        // While open the panel owns the keyboard (no chat/dialog leaks).
        return true;
    }

    /** `wheel` hook body: scrolls the row list / text field only over the panel. */
    private handleWheel(e: QolWheelEvent): boolean {
        if (!this.panelOpen) {
            return false;
        }
        const lx: number = e.x - 4 - PANEL_X;
        const ly: number = e.y - 4 - PANEL_Y;
        if (lx < 0 || ly < 0 || lx >= PANEL_W || ly >= PANEL_H) {
            return false;
        }
        this.layout();
        if (this.mode === 'settings') {
            this.scrollBy((e.dy > 0 ? 1 : -1) * ROW_H * 2);
        } else {
            this.textScrollBy((e.dy > 0 ? 1 : -1) * TEXT_LINE_H * 3);
        }
        return true;
    }

    /** Continue slider / scrollbar drags from the polled held mouse state. */
    private pollDrag(): void {
        if (this.dragKey === null && !this.scrollDrag) {
            return;
        }
        if (this.touchMode === 'drag') {
            // a touch owns the drag; touchEnd() + this poll's next frame release it
            return;
        }
        const client: any = this.ctx.client;
        const button: number = client.mouseButton ?? 0;
        if (button !== 1) {
            this.dragKey = null;
            this.scrollDrag = false;
            return;
        }
        this.applyDragAt((client.mouseX ?? -1) - 4 - PANEL_X, (client.mouseY ?? -1) - 4 - PANEL_Y);
    }

    /** Shared slider/thumb drag math for the mouse poll and the touch path. */
    private applyDragAt(lx: number, ly: number): void {
        if (this.dragKey !== null) {
            const region: PanelRegion | null = this.findRegionByKind('slider', this.dragKey);
            if (region !== null) {
                this.applySlider(region, lx);
            } else {
                this.dragKey = null;
            }
        }
        if (this.scrollDrag) {
            const travel: number = this.listH - this.thumbH;
            if (travel > 0) {
                const ratio: number = (ly - this.scrollGrab - this.listTop) / travel;
                this.scroll = this.clamp(ratio, 0, 1) * (this.contentH - this.listH);
            }
        }
    }

    /** Set a slider value from a panel-local pointer x over its track region. */
    private applySlider(region: PanelRegion, lx: number): void {
        const def: SettingDef | null = region.def;
        if (def === null) {
            return;
        }
        const min: number = def.min ?? 0;
        const max: number = def.max ?? 100;
        if (max <= min) {
            return;
        }
        const ratio: number = this.clamp((lx - region.x) / Math.max(1, region.w), 0, 1);
        let value: number = min + ratio * (max - min);
        value = max - min >= 20 ? Math.round(value) : Math.round(value * 10) / 10;
        this.ctx.config.set(def.key, value);
    }

    /** Commit the focused inline edit back into the config. */
    private commitFocus(): void {
        const key: string | null = this.focusedKey;
        if (key === null) {
            return;
        }
        this.focusedKey = null;
        if (key === PSEUDO_TEXT) {
            return;
        }
        const def: SettingDef | undefined = this.currentRows.find((d: SettingDef): boolean => d.key === key);
        if (def === undefined) {
            return;
        }
        if (def.type === 'color') {
            const normalized: string | null = normalizeColor(this.editBuf);
            if (normalized === null) {
                this.setStatus('Bad color: use #rrggbb', COL_RED);
                return;
            }
            this.ctx.config.set(key, normalized);
        } else {
            this.ctx.config.set(key, this.editBuf);
        }
    }

    /** Reset-all button: second click inside {@link RESET_CONFIRM_MS} applies. */
    private handleReset(): void {
        const now: number = this.ctx.nowMs();
        if (now < this.resetArmedUntil) {
            this.ctx.config.resetAll();
            this.resetArmedUntil = 0;
            this.setStatus('All settings reset to defaults', COL_GREEN);
        } else {
            this.resetArmedUntil = now + RESET_CONFIRM_MS;
            this.setStatus('Click Reset all again to confirm', COL_YELLOW);
        }
    }

    /** Switch the body to the export/import edit field, prefilled with current JSON. */
    private openTextField(mode: PanelMode): void {
        this.mode = mode;
        this.textBuf = this.ctx.config.exportJson();
        this.focusedKey = PSEUDO_TEXT;
        this.textScroll = 0;
        if (mode === 'export') {
            // Best-effort clipboard copy; guarded, silently ignored elsewhere.
            try {
                if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
                    navigator.clipboard.writeText(this.textBuf).catch((): void => {
                        /* clipboard permission / insecure context: the field is visible anyway */
                    });
                }
            } catch (_e) {
                /* no clipboard API */
            }
            this.setStatus('Export shown below', COL_GREEN);
        } else {
            this.setStatus('Edit the JSON, then click Apply', COL_YELLOW);
        }
    }

    /** Parse the import buffer and merge it; a status error on bad JSON. */
    private doImport(): void {
        try {
            const parsed: unknown = JSON.parse(this.textBuf);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                this.setStatus('Import needs a JSON object', COL_RED);
                return;
            }
            this.ctx.config.importJson(this.textBuf);
            this.mode = 'settings';
            this.focusedKey = null;
            this.setStatus('Settings imported', COL_GREEN);
        } catch (_e) {
            this.setStatus('Invalid JSON text', COL_RED);
        }
    }

    /** Reset everything transient on open/close. */
    private clearTransient(): void {
        this.mode = 'settings';
        this.focusedKey = null;
        this.editBuf = '';
        this.captureKey = null;
        this.dragKey = null;
        this.scrollDrag = false;
        this.resetArmedUntil = 0;
    }

    private cycleChoice(key: string, dir: number): void {
        const def: SettingDef | undefined = this.findDef(key);
        if (def === undefined || def.choices === undefined || def.choices.length === 0) {
            return;
        }
        const n: number = def.choices.length;
        const raw: string = this.ctx.config.getStr(key);
        let idx: number = def.choices.indexOf(raw);
        if (idx < 0) {
            const num: number = Number(raw);
            idx = Number.isInteger(num) && raw.trim() !== '' ? this.clampMod(num, n) : 0;
        }
        idx = ((idx + dir) % n + n) % n;
        this.ctx.config.set(key, def.choices[idx]);
    }

    private cycleColor(key: string, dir: number): void {
        const current: number = parseColorInt(this.ctx.config.getStr(key));
        let idx: number = COLOR_PALETTE.indexOf(current);
        idx = idx < 0 ? (dir > 0 ? 0 : COLOR_PALETTE.length - 1) : ((idx + dir) % COLOR_PALETTE.length + COLOR_PALETTE.length) % COLOR_PALETTE.length;
        this.ctx.config.set(key, hexColor(COLOR_PALETTE[idx]));
    }

    private findDef(key: string): SettingDef | undefined {
        return this.ctx.config.defs().find((d: SettingDef): boolean => d.key === key);
    }

    // ---- layout ----

    /**
     * Rebuild the hit-region pool + body metrics from current state. Called at
     * click time, wheel time and every draw; deterministic and allocation-light
     * (regions are pooled, only `config.defs()` copies a small array).
     */
    private layout(): void {
        this.regionCount = 0;
        this.addRegion('close', PANEL_W - 21, 3, 16, 15, '', null);

        const sections: string[] = this.ctx.config.sections();
        if (sections.length === 0) {
            this.selectedSection = ABOUT_SECTION;
        } else if (!sections.includes(this.selectedSection)) {
            this.selectedSection = sections[0];
        }
        this.aboutMode = sections.length === 0;

        const bodyTop: number = HEADER_H + 2;
        const bodyH: number = PANEL_H - HEADER_H - FOOTER_H - 3;
        this.listTop = bodyTop;
        this.listH = bodyH;
        this.listX = SECTION_W + 2;
        this.listW = PANEL_W - 4 - SCROLLBAR_W - 2 - this.listX;

        if (this.mode === 'settings') {
            // Left column: sections (or just the About entry on an empty registry).
            const names: string[] = this.aboutMode ? [ABOUT_SECTION] : sections;
            for (let i: number = 0; i < names.length; i++) {
                this.addRegion('section', 3, bodyTop + i * SECTION_ROW_H, SECTION_W - 6, SECTION_ROW_H - 2, names[i], null);
            }

            this.currentRows = this.aboutMode ? [] : this.ctx.config.defs(this.selectedSection);
            const rowCount: number = this.aboutMode ? ABOUT_LINES.length : this.currentRows.length;
            this.contentH = rowCount * ROW_H;
            this.scroll = this.clamp(this.scroll, 0, Math.max(0, this.contentH - this.listH));

            const controlX: number = this.listX + this.listW - CONTROL_W;
            const first: number = Math.max(0, Math.floor(this.scroll / ROW_H));
            const last: number = Math.min(rowCount - 1, Math.ceil((this.scroll + this.listH) / ROW_H));
            for (let i: number = first; i <= last && !this.aboutMode; i++) {
                const def: SettingDef = this.currentRows[i];
                const rowY: number = this.listTop + i * ROW_H - this.scroll;
                this.addRowRegions(def, controlX, rowY);
            }

            if (this.contentH > this.listH) {
                const trackX: number = this.listX + this.listW + 2;
                this.addRegion('scrollTrack', trackX, bodyTop, SCROLLBAR_W, bodyH, '', null);
                this.thumbH = Math.max(20, Math.floor((bodyH * bodyH) / this.contentH));
                this.thumbTop = bodyTop + Math.round((this.scroll / (this.contentH - this.listH)) * (bodyH - this.thumbH));
                this.addRegion('scrollThumb', trackX, this.thumbTop, SCROLLBAR_W, this.thumbH, '', null);
            } else {
                this.thumbH = 0;
                this.thumbTop = 0;
            }

            this.addRegion('reset', 6, PANEL_H - FOOTER_H + 3, 64, 16, '', null);
            this.addRegion('export', 74, PANEL_H - FOOTER_H + 3, 64, 16, '', null);
            this.addRegion('import', 142, PANEL_H - FOOTER_H + 3, 64, 16, '', null);
        } else {
            this.currentRows = [];
            this.contentH = 0;
            this.thumbH = 0;
            this.addRegion('textField', 6, bodyTop, PANEL_W - 12, bodyH, PSEUDO_TEXT, null);
            this.addRegion('back', 6, PANEL_H - FOOTER_H + 3, 64, 16, '', null);
            if (this.mode === 'import') {
                this.addRegion('apply', 74, PANEL_H - FOOTER_H + 3, 64, 16, '', null);
            }
        }
    }

    /** Add the clickable control region(s) for one setting row. */
    private addRowRegions(def: SettingDef, controlX: number, rowY: number): void {
        const midY: number = rowY + ((ROW_H - 16) >> 1);
        switch (def.type) {
            case 'boolean':
                this.addRegion('bool', controlX, rowY + ((ROW_H - 14) >> 1), 14, 14, def.key, def);
                break;
            case 'choice':
                this.addRegion('choice', controlX, midY, CONTROL_W, 16, def.key, def);
                break;
            case 'slider':
                this.addRegion('slider', controlX, rowY, SLIDER_TRACK_W, ROW_H, def.key, def);
                break;
            case 'color':
                this.addRegion('colorSwatch', controlX, midY, 16, 16, def.key, def);
                this.addRegion('colorText', controlX + 20, midY, CONTROL_W - 20, 16, def.key, def);
                break;
            case 'keybind':
                this.addRegion('keybind', controlX, midY, CONTROL_W, 16, def.key, def);
                break;
            case 'text':
                this.addRegion('text', controlX, midY, CONTROL_W, 16, def.key, def);
                break;
        }
    }

    /** Fetch/create the next pooled region. */
    private addRegion(kind: RegionKind, x: number, y: number, w: number, h: number, key: string, def: SettingDef | null): void {
        let region: PanelRegion;
        if (this.regionCount >= this.regions.length) {
            region = { kind, x, y, w, h, key, def };
            this.regions.push(region);
        } else {
            region = this.regions[this.regionCount];
            region.kind = kind;
            region.x = x;
            region.y = y;
            region.w = w;
            region.h = h;
            region.key = key;
            region.def = def;
        }
        this.regionCount++;
    }

    /** Topmost (last-drawn) region under a panel-local point. */
    private findRegion(lx: number, ly: number): PanelRegion | null {
        for (let i: number = this.regionCount - 1; i >= 0; i--) {
            const r: PanelRegion = this.regions[i];
            if (lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h) {
                return r;
            }
        }
        return null;
    }

    /** Find a region by kind + key (drag continuation). */
    private findRegionByKind(kind: RegionKind, key: string): PanelRegion | null {
        for (let i: number = this.regionCount - 1; i >= 0; i--) {
            const r: PanelRegion = this.regions[i];
            if (r.kind === kind && r.key === key) {
                return r;
            }
        }
        return null;
    }

    private scrollBy(delta: number): void {
        this.scroll = this.clamp(this.scroll + delta, 0, Math.max(0, this.contentH - this.listH));
    }

    private pageScroll(dir: number): void {
        this.scrollBy(dir * this.listH * 0.8);
    }

    private textScrollBy(delta: number): void {
        this.textScroll = this.clamp(this.textScroll + delta, 0, Math.max(0, this.wrapLines.length * TEXT_LINE_H - (this.listH - 8)));
    }

    // ---- drawing internals ----

    private drawSections(g: QolGraphics): void {
        const sections: string[] = this.aboutMode ? [ABOUT_SECTION] : this.ctx.config.sections();
        const baseY: number = PANEL_Y + this.listTop;
        // Column background plate, 2004 inset style.
        g.fillRect(PANEL_X + 2, baseY - 1, SECTION_W - 4, this.listH + 2, COL_HEADER_TOP);
        g.drawRect(PANEL_X + 1, baseY - 2, SECTION_W - 2, this.listH + 4, COL_FRAME);
        for (let i: number = 0; i < sections.length; i++) {
            const name: string = sections[i];
            const selected: boolean = name === this.selectedSection;
            const y: number = baseY + i * SECTION_ROW_H;
            if (selected) {
                g.fillRect(PANEL_X + 3, y, SECTION_W - 6, SECTION_ROW_H - 2, COL_FRAME);
            }
            g.text(this.p12(), this.fit(this.p12(), name, SECTION_W - 14), PANEL_X + 7, y + SECTION_ROW_H - 6, selected ? COL_YELLOW : COL_LABEL);
        }
    }

    private drawRows(g: QolGraphics, now: number): void {
        const config = this.ctx.config;
        if (this.aboutMode) {
            for (let i: number = 0; i < ABOUT_LINES.length; i++) {
                const y: number = PANEL_Y + this.listTop + i * ROW_H;
                if (y > PANEL_Y + this.listTop + this.listH) {
                    continue;
                }
                g.text(this.p12(), ABOUT_LINES[i], PANEL_X + this.listX + 4, y + ROW_H - 9, i === 0 ? COL_YELLOW : COL_TEXT);
            }
            return;
        }

        const controlX: number = this.listX + this.listW - CONTROL_W;
        const first: number = Math.max(0, Math.floor(this.scroll / ROW_H));
        const last: number = Math.min(this.currentRows.length - 1, Math.ceil((this.scroll + this.listH) / ROW_H));
        g.pushClip(PANEL_X + this.listX, PANEL_Y + this.listTop, this.listW, this.listH);
        for (let i: number = first; i <= last; i++) {
            const def: SettingDef = this.currentRows[i];
            const rowY: number = PANEL_Y + this.listTop + i * ROW_H - this.scroll;
            const midY: number = rowY + ((ROW_H - 16) >> 1);
            const focused: boolean = this.focusedKey === def.key;

            // Alternating row tint for readability.
            if ((i & 1) === 1) {
                g.fillRectTrans(PANEL_X + this.listX, rowY, this.listW, ROW_H, COL_FRAME, 40);
            }

            const labelMax: number = controlX - this.listX - 10;
            const label: string = def.label.length > 0 ? def.label : def.key;
            g.text(this.p12(), this.fit(this.p12(), label, labelMax), PANEL_X + this.listX + 4, rowY + ROW_H - 9, COL_TEXT);

            const cx: number = PANEL_X + controlX;
            switch (def.type) {
                case 'boolean': {
                    const bx: number = cx;
                    const by: number = rowY + ((ROW_H - 14) >> 1);
                    g.fillRect(bx, by, 12, 12, COL_FRAME);
                    g.drawRect(bx, by, 12, 12, COL_EDGE);
                    if (config.getBool(def.key)) {
                        g.fillRect(bx + 2, by + 2, 8, 8, COL_YELLOW);
                    }
                    if (focused) {
                        g.drawRect(bx - 1, by - 1, 14, 14, COL_YELLOW);
                    }
                    break;
                }
                case 'choice': {
                    this.drawFieldButton(g, cx, midY, CONTROL_W, this.choiceText(def), COL_LABEL);
                    break;
                }
                case 'slider': {
                    const min: number = def.min ?? 0;
                    const max: number = def.max ?? 100;
                    const value: number = this.clamp(config.getNum(def.key), min, max);
                    const trackX: number = cx;
                    const trackY: number = rowY + ((ROW_H - 8) >> 1);
                    const ratio: number = max > min ? (value - min) / (max - min) : 0;
                    g.fillRect(trackX, trackY, SLIDER_TRACK_W, 8, COL_FRAME);
                    g.drawRect(trackX, trackY, SLIDER_TRACK_W, 8, COL_EDGE);
                    g.fillRect(trackX + 1, trackY + 1, Math.round((SLIDER_TRACK_W - 2) * ratio), 6, COL_HEADER_TOP);
                    const hx: number = trackX + Math.round(ratio * (SLIDER_TRACK_W - 10));
                    g.fillRect(hx, trackY - 4, 10, 16, COL_EDGE);
                    g.drawRect(hx, trackY - 4, 10, 16, COL_FRAME);
                    g.text(this.p11(), this.formatNumber(value, max - min), trackX + SLIDER_TRACK_W + 4, rowY + ROW_H - 10, COL_LABEL);
                    if (focused) {
                        g.drawRect(trackX - 1, trackY - 5, SLIDER_TRACK_W + 2, 18, COL_YELLOW);
                    }
                    break;
                }
                case 'color': {
                    const stored: string = config.getStr(def.key);
                    const parsed: number = parseColorInt(stored);
                    g.fillRect(cx, midY, 16, 16, parsed >= 0 ? parsed : 0x000000);
                    g.drawRect(cx, midY, 16, 16, COL_FRAME);
                    g.drawRect(cx + 1, midY + 1, 14, 14, COL_EDGE);
                    const hex: string = focused ? this.editBuf + (this.caretOn(now) ? '|' : '') : parsed >= 0 ? hexColor(parsed) : stored;
                    g.text(this.p12(), this.fit(this.p12(), hex, CONTROL_W - 26), cx + 22, midY + 13, focused ? COL_YELLOW : COL_LABEL);
                    if (focused) {
                        g.drawRect(cx - 1, midY - 1, CONTROL_W + 1, 18, COL_YELLOW);
                    }
                    break;
                }
                case 'keybind': {
                    const label2: string = this.captureKey === def.key ? 'press a key...' : config.getStr(def.key) || '(none)';
                    this.drawFieldButton(g, cx, midY, CONTROL_W, label2, this.captureKey === def.key ? COL_YELLOW : COL_LABEL);
                    break;
                }
                case 'text': {
                    const shown: string = focused ? this.editBuf + (this.caretOn(now) ? '|' : '') : config.getStr(def.key);
                    this.drawFieldButton(g, cx, midY, CONTROL_W, shown, focused ? COL_YELLOW : COL_LABEL);
                    if (focused) {
                        g.drawRect(cx - 1, midY - 1, CONTROL_W + 1, 18, COL_YELLOW);
                    }
                    break;
                }
            }
        }
        g.popClip();
    }

    /** Dark inset field/button with centered text (choice/keybind/text share it). */
    private drawFieldButton(g: QolGraphics, x: number, y: number, w: number, text: string, textColor: number): void {
        g.fillRect(x, y, w, 16, COL_BUTTON);
        g.drawRect(x, y, w, 16, COL_EDGE);
        g.centreText(this.p12(), this.fit(this.p12(), text, w - 8), x + w / 2, y + 13, textColor);
    }

    private drawScrollbar(g: QolGraphics): void {
        const trackX: number = PANEL_X + this.listX + this.listW + 2;
        g.fillRect(trackX, PANEL_Y + this.listTop, SCROLLBAR_W, this.listH, COL_FRAME);
        if (this.contentH > this.listH && this.thumbH > 0) {
            g.fillRect(trackX + 1, PANEL_Y + this.thumbTop, SCROLLBAR_W - 2, this.thumbH, COL_EDGE);
            g.drawRect(trackX + 1, PANEL_Y + this.thumbTop, SCROLLBAR_W - 2, this.thumbH, COL_FRAME);
        }
    }

    private drawTextField(g: QolGraphics, now: number): void {
        const x: number = PANEL_X + 6;
        const y: number = PANEL_Y + this.listTop;
        const w: number = PANEL_W - 12;
        const h: number = this.listH;
        g.fillRect(x, y, w, h, COL_FRAME);
        g.drawRect(x, y, w, h, COL_EDGE);

        if (this.wrapSource !== this.textBuf || this.wrapWidth !== w - 16) {
            this.wrapSource = this.textBuf;
            this.wrapWidth = w - 16;
            this.wrapLines = this.wrap(g, this.p11(), this.textBuf, w - 16);
        }
        const visible: number = Math.floor((h - 8) / TEXT_LINE_H);
        const maxScroll: number = Math.max(0, this.wrapLines.length * TEXT_LINE_H - (h - 8));
        this.textScroll = this.clamp(this.textScroll, 0, maxScroll);

        g.pushClip(x + 2, y + 2, w - 4, h - 4);
        const firstLine: number = Math.floor(this.textScroll / TEXT_LINE_H);
        for (let i: number = 0; i <= visible; i++) {
            const li: number = firstLine + i;
            if (li >= this.wrapLines.length) {
                break;
            }
            const lineY: number = y + 2 + TEXT_LINE_H - 3 + i * TEXT_LINE_H - (this.textScroll - firstLine * TEXT_LINE_H);
            let line: string = this.wrapLines[li];
            if (li === this.wrapLines.length - 1 && this.focusedKey === PSEUDO_TEXT && this.caretOn(now)) {
                line += '|';
            }
            g.text(this.p11(), line, x + 8, lineY, COL_TEXT);
        }
        g.popClip();
    }

    /** Word-wrap with hard chunking for oversized tokens (single-line JSON). */
    private wrap(g: QolGraphics, font: PixFont, text: string, maxW: number): string[] {
        const lines: string[] = [];
        const paras: string[] = text.split('\n');
        for (let p: number = 0; p < paras.length; p++) {
            const para: string = paras[p];
            if (para.length === 0) {
                lines.push('');
                continue;
            }
            let current: string = '';
            const words: string[] = para.split(' ');
            for (let wi: number = 0; wi < words.length; wi++) {
                let word: string = words[wi];
                let piece: string = current.length === 0 ? word : ' ' + word;
                let guard: number = 0;
                while (g.textWidth(font, current + piece) > maxW && guard < 512) {
                    guard++;
                    if (current.length > 0) {
                        lines.push(current);
                        current = '';
                        piece = word;
                        continue;
                    }
                    let k: number = word.length;
                    while (k > 1 && g.textWidth(font, word.substring(0, k)) > maxW) {
                        k--;
                    }
                    lines.push(word.substring(0, k));
                    word = word.substring(k);
                    piece = word;
                    if (word.length === 0) {
                        break;
                    }
                }
                if (word.length === 0) {
                    continue;
                }
                current += piece;
            }
            if (current.length > 0) {
                lines.push(current);
            }
        }
        return lines;
    }

    /** Text of a choice control: the current value, or the def default when unset. */
    private choiceText(def: SettingDef): string {
        const raw: string = this.ctx.config.getStr(def.key);
        if (def.choices !== undefined && def.choices.length > 0) {
            const idx: number = def.choices.indexOf(raw);
            if (idx < 0) {
                const num: number = Number(raw);
                if (Number.isInteger(num) && raw.trim() !== '' && num >= 0 && num < def.choices.length) {
                    return def.choices[num];
                }
                return raw !== '' ? raw : def.choices[0];
            }
            return def.choices[idx];
        }
        return raw;
    }

    /** Tooltip of the row under the polled mouse pointer, or ''. */
    private hoverTooltip(): string {
        if (this.mode !== 'settings' || this.aboutMode) {
            return '';
        }
        const client: any = this.ctx.client;
        const lx: number = (client.mouseX ?? -1) - 4 - PANEL_X;
        const ly: number = (client.mouseY ?? -1) - 4 - PANEL_Y;
        if (lx < this.listX || lx > this.listX + this.listW || ly < this.listTop || ly > this.listTop + this.listH) {
            return '';
        }
        const row: number = Math.floor((ly - this.listTop + this.scroll) / ROW_H);
        if (row < 0 || row >= this.currentRows.length) {
            return '';
        }
        return this.currentRows[row].tooltip ?? '';
    }

    private caretOn(now: number): boolean {
        return Math.floor(now / 500) % 2 === 0;
    }

    private setStatus(text: string, color: number): void {
        this.statusText = text;
        this.statusColor = color;
        this.statusUntil = this.ctx.nowMs() + STATUS_MS;
    }

    // ---- tiny helpers ----

    private fit(font: PixFont, str: string, maxW: number): string {
        if (maxW <= 0) {
            return '';
        }
        const g: QolGraphics = this.ctx.g;
        if (g.textWidth(font, str) <= maxW) {
            return str;
        }
        let len: number = str.length;
        while (len > 1 && g.textWidth(font, str.substring(0, len) + '..') > maxW) {
            len--;
        }
        return str.substring(0, len) + '..';
    }

    private formatNumber(value: number, range: number): string {
        return range >= 20 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
    }

    private clamp(v: number, lo: number, hi: number): number {
        return v < lo ? lo : v > hi ? hi : v;
    }

    private clampMod(v: number, n: number): number {
        return ((v % n) + n) % n;
    }

    private p11(): PixFont {
        if (this.fontP11 === null) {
            this.fontP11 = this.ctx.fonts().p11;
        }
        return this.fontP11;
    }

    private p12(): PixFont {
        if (this.fontP12 === null) {
            this.fontP12 = this.ctx.fonts().p12;
        }
        return this.fontP12;
    }

    private b12(): PixFont {
        if (this.fontB12 === null) {
            this.fontB12 = this.ctx.fonts().b12;
        }
        return this.fontB12;
    }

    /** Display name for a captured `ch` (KeyCodes reverse lookup). */
    private static keyName(ch: number): string {
        let names: Map<number, string> | null = QolSettingsPanel.keyNames;
        if (names === null) {
            names = new Map();
            for (const [name, mapping] of KeyCodes) {
                if (!names.has(mapping.ch) && mapping.ch !== 65535) {
                    names.set(mapping.ch, name);
                }
            }
            QolSettingsPanel.keyNames = names;
        }
        const found: string | undefined = names.get(ch);
        if (found !== undefined) {
            return found === ' ' ? 'Space' : found;
        }
        if (ch >= 32 && ch < 127) {
            return String.fromCharCode(ch);
        }
        return `key_${ch}`;
    }
}

/** Footer button labels for the region kinds that draw themselves in the footer. */
function labelOf(kind: RegionKind): string {
    switch (kind) {
        case 'export':
            return 'Export';
        case 'import':
            return 'Import';
        case 'back':
            return 'Back';
        case 'apply':
            return 'Apply';
        default:
            return '';
    }
}

/** '#rrggbb' for a palette int. */
function hexColor(rgb: number): string {
    return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Parse a color setting value ('#rrggbb', 'rrggbb', '0xrrggbb' or decimal) to int; -1 unusable. */
function parseColorInt(value: string): number {
    const trimmed: string = value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
        return parseInt(trimmed.replace('#', ''), 16);
    }
    if (/^0[xX][0-9a-fA-F]{6}$/.test(trimmed)) {
        return parseInt(trimmed.substring(2), 16);
    }
    if (/^\d+$/.test(trimmed)) {
        const n: number = Number(trimmed);
        return n >= 0 && n <= 0xffffff ? n : -1;
    }
    return -1;
}

/** Normalize a user-typed color to '#rrggbb' (lower-case), or null when invalid. */
function normalizeColor(value: string): string | null {
    const parsed: number = parseColorInt(value);
    if (parsed < 0) {
        return null;
    }
    return hexColor(parsed);
}

/** Registry-empty placeholder body (kept until plugins declare settings). */
const ABOUT_LINES: string[] = [
    'No plugin settings registered yet.',
    'Open/close: F10, the gear button, or ::qol.',
    'ESC closes the panel.',
    'Plugins add sections by calling ctx.config.define().',
    'LostCity webclient - game revision 289.'
];

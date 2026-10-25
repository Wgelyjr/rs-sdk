// F15 — Bank placeholders (layout-preserving ghost items).
//
// While the bank is open, every slot that empties during the session keeps a
// faded "ghost" of the item that was there until the slot refills or the bank
// closes. Purely visual: the plugin registers no `click`/`wheel`/menu hooks,
// so vanilla interaction, scrolling and right-click menus are untouched.
//
// Geometry approach (docs/qol-features-plan.md §4 F15): the ghost slots are
// drawn into the 512x334 viewport buffer during `drawTop`, which runs right
// after `otherOverlays()` has painted the bank modal into the SAME buffer
// (Client.gameDrawMain). The slot rectangles replicate `Client.drawInterface`'s
// TYPE_INV branch exactly:
//   - resolve a cached parent→child chain from `mainModalId` (5292) down to the
//     grid component 5382 by DFS-ing `IfType.children`/`childX`/`childY` just
//     like the recursive draw walk (only TYPE_LAYER components recurse, each
//     hop subtracting the layer's live `scrollPos`);
//   - grid slot (row, col): x = gridX + col * (marginX + 32), y = gridY +
//     row * (marginY + 32), plus the `invBackgroundX/Y[slot]` nudges vanilla
//     applies to the first 20 slots;
//   - the scroll window / clip is the grid's direct TYPE_LAYER parent rect
//     (that is the innermost `Pix2D.setClipping` in effect when vanilla draws
//     the grid).
// Exact chain replication was stable, so no `invBackgroundX/Y`-only fallback
// was needed (those arrays still feed the per-slot offsets where present).
//
// Icons go through the same `ObjType.getSprite(id, count, 0)` cache the
// interface renderer uses; unloaded models return null and the ghost is simply
// skipped for the frame (no new on-demand requests are issued by this plugin).

import IfType, { ComponentType } from '#/config/IfType.js';
import ObjType from '#/config/ObjType.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type Pix32 from '#/graphics/Pix32.js';

/** `mainModalId` of the bank interface (`bank_main`). */
const BANK_MAIN_ID: number = 5292;
/** `bank_main:inv` — the scrollable bank grid component (TYPE_INV, 8 x 36). */
const BANK_GRID_ID: number = 5382;
/** Slots tracked at most (the bank grid holds 288; caps runaway layouts). */
const MAX_TRACKED_SLOTS: number = 300;
/** Parent-chain capacity (bank nesting depth is ~3; 24 is generous). */
const PATH_CAPACITY: number = 24;
/** Vanilla inventory slot size in pixels. */
const SLOT_PX: number = 32;
/** Icon blend (same alpha the client uses for drag/selection ghosts). */
const GHOST_ICON_ALPHA: number = 128;
/** Extra black darkening over the icon rect so it reads as a placeholder. */
const GHOST_DARKEN_ALPHA: number = 56;
/** Count-text colour: muted gray, unlike the vanilla yellow stack count. */
const GHOST_COUNT_COLOUR: number = 0x909090;

/**
 * Per-session ghost bookkeeping: two slot→state snapshots (previous and ghost)
 * over fixed Int32Array buffers so the tick/draw hot paths allocate nothing.
 */
class BankPlaceholderState {
    /** Raw `linkObjType` (1-based) that last left each slot; 0 = no ghost. */
    private readonly ghostRaw: Int32Array = new Int32Array(MAX_TRACKED_SLOTS);
    /** Stack size the ghost item had when the slot emptied. */
    private readonly ghostCount: Int32Array = new Int32Array(MAX_TRACKED_SLOTS);
    /** Pre-formatted count text (allocated once per ghost, null when count is 1). */
    private readonly ghostText: (string | null)[] = new Array(MAX_TRACKED_SLOTS).fill(null);
    /** Live snapshot of `linkObjType` / `linkObjNumber` from the previous tick. */
    private readonly prevRaw: Int32Array = new Int32Array(MAX_TRACKED_SLOTS);
    private readonly prevCount: Int32Array = new Int32Array(MAX_TRACKED_SLOTS);

    /** Slots that currently have a ghost (drives the early-out). */
    private ghostActive: number = 0;
    /** Whether `prevRaw` holds a same-session snapshot to diff against. */
    private prevValid: boolean = false;
    /** Bank open state on the previous tick (for open/close transitions). */
    private wasOpen: boolean = false;

    /** Cached root→grid component chain resolved from `drawInterface` structure. */
    private readonly pathComps: IfType[] = new Array(PATH_CAPACITY);
    private readonly pathIdx: number[] = new Array(PATH_CAPACITY).fill(0);
    /** Chain length (0 = unresolved / stale). */
    private pathLen: number = 0;

    /** Resolved this-frame grid position and clip (viewport-buffer coords). */
    private gridX: number = 0;
    private gridY: number = 0;
    private clipX: number = 0;
    private clipY: number = 0;
    private clipW: number = 0;
    private clipH: number = 0;
    private grid: IfType | null = null;

    /** @param ctx the plugin facade */
    constructor(private readonly ctx: QolContext) {}

    /**
     * Diff the live grid contents against the previous tick: emptied slots gain
     * a ghost, refilled slots lose theirs; the first snapshot after opening
     * only seeds the baseline (no ghosts from the pre-open state).
     */
    tick(): void {
        const open: boolean = this.ctx.isBankOpen();
        if (!open) {
            if (this.wasOpen) {
                this.clearGhosts();
            }
            this.wasOpen = false;
            return;
        }

        const grid: IfType | undefined = IfType.list[BANK_GRID_ID];
        const types = grid ? grid.linkObjType : null;
        const numbers = grid ? grid.linkObjNumber : null;
        if (!types || !numbers) {
            return;
        }

        const n: number = Math.min(types.length, MAX_TRACKED_SLOTS);

        if (!this.prevValid) {
            // First snapshot of this bank session: baseline only.
            for (let s: number = 0; s < n; s++) {
                const cur: number = types[s];
                this.prevRaw[s] = cur;
                this.prevCount[s] = cur > 0 ? numbers[s] : 0;
            }
            this.prevValid = true;
            this.wasOpen = true;
            return;
        }

        for (let s: number = 0; s < n; s++) {
            const cur: number = types[s];
            if (cur > 0) {
                // Slot holds an item: any stale ghost is wrong (refill/deposit).
                if (this.ghostRaw[s] !== 0) {
                    this.ghostRaw[s] = 0;
                    this.ghostText[s] = null;
                    this.ghostActive--;
                }
                this.prevRaw[s] = cur;
                this.prevCount[s] = numbers[s];
                continue;
            }
            const prev: number = this.prevRaw[s];
            if (prev > 0) {
                // Emptied this tick (or since the last diff): remember it.
                if (this.ghostRaw[s] === 0) {
                    this.ghostActive++;
                }
                this.ghostRaw[s] = prev;
                const count: number = this.prevCount[s];
                this.ghostCount[s] = count;
                this.ghostText[s] = count > 1 ? formatInvNumber(count) : null;
            }
            this.prevRaw[s] = 0;
            this.prevCount[s] = 0;
        }

        this.wasOpen = true;
    }

    /**
     * Paint ghosts into the empty slots the vanilla grid is currently showing.
     * Registered on `drawTop` (after modals), inside the same 512x334 buffer
     * the bank itself was drawn to, clipped to the grid's scroll layer.
     */
    drawTop(g: QolGraphics): void {
        if (this.ghostActive <= 0) {
            return;
        }
        if (!this.ctx.config.getBool('bank.placeholders')) {
            return;
        }
        if (!this.ctx.ingame() || !this.ctx.isBankOpen()) {
            return;
        }

        const grid: IfType | null = this.resolveLayout();
        if (grid === null || this.clipW <= 0 || this.clipH <= 0) {
            return;
        }

        const types: Int32Array | null = grid.linkObjType;
        if (!types) {
            return;
        }

        const cols: number = grid.width;
        const rows: number = grid.height;
        if (cols <= 0) {
            return;
        }

        const strideX: number = grid.marginX + SLOT_PX;
        const strideY: number = grid.marginY + SLOT_PX;
        const bgX: Int16Array | null = grid.invBackgroundX;
        const bgY: Int16Array | null = grid.invBackgroundY;
        const n: number = Math.min(types.length, MAX_TRACKED_SLOTS);

        const clipRight: number = this.clipX + this.clipW;
        const clipBottom: number = this.clipY + this.clipH;

        const font = this.ctx.fonts().p11;

        g.pushClip(this.clipX, this.clipY, this.clipW, this.clipH);
        for (let s: number = 0; s < n; s++) {
            const raw: number = this.ghostRaw[s];
            if (raw === 0) {
                continue;
            }
            if (types[s] > 0) {
                // Never paint over a slot that currently holds an item.
                continue;
            }

            // Same row/col decomposition as drawInterface's slot walk.
            const row: number = (s / cols) | 0;
            if (row >= rows) {
                continue;
            }
            const col: number = s - row * cols;

            let slotX: number = this.gridX + col * strideX;
            let slotY: number = this.gridY + row * strideY;
            if (s < 20 && bgX !== null && bgY !== null) {
                slotX += bgX[s];
                slotY += bgY[s];
            }

            // Fully-outside-the-window ghosts are skipped (partial ones clip).
            if (slotX + SLOT_PX <= this.clipX || slotX >= clipRight) {
                continue;
            }
            if (slotY + SLOT_PX <= this.clipY || slotY >= clipBottom) {
                continue;
            }

            // Same sprite path as the interface renderer: cache hit when the
            // icon is loaded, null (skip this frame) while it still is not.
            const icon: Pix32 | null = ObjType.getSprite(raw - 1, this.ghostCount[s], 0);
            if (icon === null) {
                continue;
            }

            icon.transPlotSprite(slotX, slotY, GHOST_ICON_ALPHA);
            g.fillRectTrans(slotX, slotY, SLOT_PX, SLOT_PX, 0, GHOST_DARKEN_ALPHA);

            const text: string | null = this.ghostText[s];
            if (text !== null && font) {
                font.drawString(text, slotX + 1, slotY + 10, 0);
                font.drawString(text, slotX, slotY + 9, GHOST_COUNT_COLOUR);
            }
        }
        g.popClip();
    }

    /** Drop every ghost + baseline (bank closed, or stale-layout safety). */
    private clearGhosts(): void {
        this.ghostRaw.fill(0);
        this.ghostCount.fill(0);
        this.prevRaw.fill(0);
        this.prevCount.fill(0);
        for (let i: number = 0; i < this.ghostText.length; i++) {
            this.ghostText[i] = null;
        }
        this.ghostActive = 0;
        this.prevValid = false;
        this.pathLen = 0;
        this.grid = null;
    }

    /**
     * Rebuild (and validate) the root→grid chain, then walk it exactly like
     * `drawInterface` to get this-frame grid coords and scroll-clip rect.
     * Returns the grid component when it is actually being drawn, else null.
     */
    private resolveLayout(): IfType | null {
        const client: any = this.ctx.client;
        if (client.mainModalId !== BANK_MAIN_ID) {
            this.pathLen = 0;
            return null;
        }

        const root: IfType | undefined = IfType.list[BANK_MAIN_ID];
        if (!root || root.type !== ComponentType.TYPE_LAYER || !root.children || root.hide) {
            this.pathLen = 0;
            return null;
        }

        if (this.pathLen > 0 && this.pathComps[0] !== root) {
            this.pathLen = 0;
        }
        if (this.pathLen === 0) {
            this.pathComps[0] = root;
            if (!this.findGridPath(root, 0)) {
                return null;
            }
        }

        // Walk the cached chain with drawInterface's offset math; a mismatch
        // (interface reload / re-parent) invalidates the cache for next frame.
        let x: number = 0;
        let y: number = 0;
        let scrollY: number = 0;
        let lastX: number = 0;
        let lastY: number = 0;
        for (let k: number = 0; k + 1 < this.pathLen; k++) {
            const parent: IfType = this.pathComps[k];
            const child: IfType = this.pathComps[k + 1];
            const idx: number = this.pathIdx[k];
            const children = parent.children;
            const childX = parent.childX;
            const childY = parent.childY;
            if (
                parent.type !== ComponentType.TYPE_LAYER ||
                children === null ||
                childX === null ||
                childY === null ||
                idx >= children.length ||
                childX.length <= idx ||
                childY.length <= idx ||
                children[idx] !== child.id
            ) {
                this.pathLen = 0;
                return null;
            }
            if (k > 0 && parent.hide) {
                this.pathLen = 0;
                return null;
            }

            const cx: number = childX[idx] + x + child.x;
            const cy: number = childY[idx] + y - scrollY + child.y;
            scrollY = child.type === ComponentType.TYPE_LAYER ? child.scrollPos : 0;
            x = cx;
            y = cy;
            if (k === this.pathLen - 2) {
                lastX = cx;
                lastY = cy;
            }
        }

        const grid: IfType = this.pathComps[this.pathLen - 1];
        if (grid.id !== BANK_GRID_ID || grid.type !== ComponentType.TYPE_INV || grid.hide) {
            this.pathLen = 0;
            return null;
        }

        this.gridX = x;
        this.gridY = y;
        // The innermost clip in effect for grid drawing is its parent layer rect.
        const layer: IfType = this.pathComps[this.pathLen - 2];
        this.clipX = lastX;
        this.clipY = lastY;
        this.clipW = layer.width;
        this.clipH = layer.height;
        this.grid = grid;
        return grid;
    }

    /**
     * DFS mirroring `drawInterface`'s recursion: only non-hidden TYPE_LAYER
     * children are descended into; fills `pathComps`/`pathIdx`/`pathLen` on a
     * hit. Cheap and allocation-free (the bank tree is ~100 components).
     */
    private findGridPath(com: IfType, depth: number): boolean {
        this.pathComps[depth] = com;
        const children = com.children;
        if (children === null || depth + 2 > PATH_CAPACITY) {
            return false;
        }

        for (let i: number = 0; i < children.length; i++) {
            const child: IfType | undefined = IfType.list[children[i]];
            if (!child) {
                continue;
            }
            if (child.id === BANK_GRID_ID && child.type === ComponentType.TYPE_INV) {
                this.pathIdx[depth] = i;
                this.pathComps[depth + 1] = child;
                this.pathLen = depth + 2;
                return true;
            }
            if (child.type === ComponentType.TYPE_LAYER && !child.hide && child.children) {
                this.pathIdx[depth] = i;
                if (this.findGridPath(child, depth + 1)) {
                    return true;
                }
            }
        }
        return false;
    }
}

/** Clone of `Client.invNumber` (the count format the grid itself uses). */
function formatInvNumber(amount: number): string {
    if (amount < 100000) {
        return String(amount);
    } else if (amount < 10000000) {
        return ((amount / 1000) | 0) + 'K';
    } else {
        return ((amount / 1000000) | 0) + 'M';
    }
}

export default {
    name: 'BankPlaceholders',
    register(ctx: QolContext): void {
        ctx.config.define({
            key: 'bank.placeholders',
            section: 'Bank',
            label: 'Bank placeholders',
            type: 'boolean',
            default: true,
            tooltip: 'Show faded ghost icons in bank slots that emptied during this bank session. Ghosts clear when the bank closes.'
        });

        const state = new BankPlaceholderState(ctx);
        ctx.hooks.onTick(() => state.tick(), 'BankPlaceholders.tick');
        ctx.hooks.onDrawTop((g: QolGraphics) => state.drawTop(g), 'BankPlaceholders.drawTop');
    }
};

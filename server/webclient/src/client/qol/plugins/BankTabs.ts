// F16 Bank tabs & tags — wave 3, chunk C10b (docs/qol-features-plan.md §4).
//
// v1 scope = the plan's sanctioned safe variant: tag-driven TABS that visually
// filter the vanilla bank grid by dimming non-matching slots. The bank's
// interaction model is untouched — no clicks are remapped, no packets are
// synthesized beyond nothing at all: every slot stays where the server put it
// and remains clickable through the dim layer (the client hit-tests component
// geometry, not pixels). This satisfies "sort gear without altering how the
// bank functions on the server side" with zero risk of withdraw/deposit
// misrouting. The full RuneLite-style reordered custom grid (slot remapping +
// custom withdraw menus) is deferred to a v2 behind the same setting once it
// can be validated against a live server.
//
// Mechanics (mirrors BankPlaceholders' proven layout resolution):
//  - a tab strip is painted along the top of the bank window in the drawTop
//    pass (viewport buffer, after the modal + placeholders were drawn);
//  - selecting a tag dims every non-empty grid slot whose item name does not
//    match, clipped to the grid's scroll layer, tracking the live scroll;
//  - tab clicks are consumed by the `click` hook (priority 8000: below the
//    settings panel's 10000, above world plugins) — only inside a tab rect,
//    so the rest of the bank keeps vanilla mouse behavior;
//  - tag definitions come from `bank.tagDefs`:
//      `tag: item, item; tag2: /regex/, item`
//    ';' separates tags (panel text fields are single-line), ',' separates
//    items, `/re/` is a case-insensitive regex, anything else a case-
//    insensitive substring of the item name.
//
// Item names resolve through ObjType.list[rawId - 1] exactly like the client's
// own getBankItems/bankDeposit helpers (cert entries carry their base name).

import IfType, { ComponentType } from '#/config/IfType.js';
import ObjType from '#/config/ObjType.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type { QolClickEvent } from '#/client/qol/QolHooks.js';

/** `mainModalId` of the bank interface (`bank_main`). */
const BANK_MAIN_ID: number = 5292;
/** `bank_main:inv` — the scrollable bank grid component (TYPE_INV, 8 x 36). */
const BANK_GRID_ID: number = 5382;
/** Slots scanned at most (the grid holds 288; caps runaway layouts). */
const MAX_SCANNED_SLOTS: number = 300;
/** Parent-chain capacity (bank nesting depth is ~3; 24 is generous). */
const PATH_CAPACITY: number = 24;
/** Vanilla inventory slot size in pixels. */
const SLOT_PX: number = 32;

/** Dim blend over non-matching slots (0..256; items stay faintly visible). */
const DIM_ALPHA: number = 175;

/** Tab strip geometry. */
const TAB_H: number = 13;
const TAB_PAD_X: number = 6;
const TAB_GAP: number = 2;
const STRIP_PAD: number = 3;
const MAX_TAB_ROWS: number = 2;

/** Strip/tab colors (2004 palette-adjacent). */
const COL_STRIP_BG: number = 0x000000;
const COL_STRIP_BG_ALPHA: number = 190;
const COL_TAB_BG: number = 0x362f23;
const COL_TAB_BG_SEL: number = 0x5d5447;
const COL_TAB_TEXT: number = 0xffffff;
const COL_TAB_TEXT_SEL: number = 0xffb000;
const COL_COUNT: number = 0xc0c0c0;

/** Hard cap on parsed tags (runaway tagDefs protection). */
const MAX_TAGS: number = 12;

interface TagDef {
    name: string;
    /** Lowercased substrings and compiled regexes; a name matches any entry. */
    substrings: string[];
    regexes: RegExp[];
}

interface TabRect {
    x: number;
    y: number;
    w: number;
    h: number;
    tab: number; // 0 = All, 1..n = tag index + 1
}

/**
 * Parse `bank.tagDefs`: `tag: item, item; tag2: /re/, item`.
 * Invalid pieces are skipped silently (the tooltip documents the grammar;
 * throwing here would spam the hook error counter on every keystroke).
 */
function parseTagDefs(raw: string): TagDef[] {
    const tags: TagDef[] = [];
    for (const chunk of raw.split(/[\n;]/)) {
        if (tags.length >= MAX_TAGS) {
            break;
        }
        const colon: number = chunk.indexOf(':');
        if (colon <= 0) {
            continue;
        }
        const name: string = chunk.slice(0, colon).trim();
        if (name === '' || name.length > 14) {
            continue;
        }
        const tag: TagDef = { name, substrings: [], regexes: [] };
        for (const item of chunk.slice(colon + 1).split(',')) {
            const trimmed: string = item.trim();
            if (trimmed === '') {
                continue;
            }
            if (trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
                try {
                    tag.regexes.push(new RegExp(trimmed.slice(1, -1), 'i'));
                } catch {
                    // invalid regex: treat as a literal substring instead
                    tag.substrings.push(trimmed.toLowerCase());
                }
            } else {
                tag.substrings.push(trimmed.toLowerCase());
            }
        }
        if (tag.substrings.length > 0 || tag.regexes.length > 0) {
            tags.push(tag);
        }
    }
    return tags;
}

class BankTabsState {
    private readonly ctx: QolContext;

    private enabled: boolean = false;
    private tags: TagDef[] = [];
    /** 0 = All (no dimming); n>=1 = tags[n-1]. */
    private selectedTab: number = 0;

    /** rawId → matches-selected-tag cache (cleared on tag/tab change). */
    private readonly matchCache: Map<number, boolean> = new Map();

    /** Tab hit rects from the last draw (viewport-local coords). */
    private readonly tabRects: TabRect[] = [];

    // ---- cached root→grid component chain (BankPlaceholders pattern) ----
    private readonly pathComps: IfType[] = new Array(PATH_CAPACITY);
    private readonly pathIdx: number[] = new Array(PATH_CAPACITY).fill(0);
    private pathLen: number = 0;
    private gridX: number = 0;
    private gridY: number = 0;
    private clipX: number = 0;
    private clipY: number = 0;
    private clipW: number = 0;
    private clipH: number = 0;

    constructor(ctx: QolContext) {
        this.ctx = ctx;
    }

    register(): void {
        const config = this.ctx.config;

        config.define({
            key: 'bank.tabsEnabled',
            section: 'Bank',
            label: 'Bank tag tabs',
            type: 'boolean',
            default: false,
            tooltip: 'Draws a tag tab strip on the bank window; selecting a tag dims non-matching slots. Purely visual — slot positions, clicks and server behavior are unchanged.'
        });
        config.define({
            key: 'bank.tagDefs',
            section: 'Bank',
            label: 'Bank tags',
            type: 'text',
            default: '',
            tooltip: 'Tags separated by ";", items by ",": armor: platebody, platelegs, kiteshield; food: shark, lobster; runes: /.*rune.*/ — /re/ items are case-insensitive regexes, others name substrings. Max 12 tags.'
        });

        config.onChange('bank.tabsEnabled', (): void => {
            this.enabled = config.getBool('bank.tabsEnabled');
        });
        config.onChange('bank.tagDefs', (): void => {
            this.tags = parseTagDefs(config.getStr('bank.tagDefs'));
            this.matchCache.clear();
            if (this.selectedTab > this.tags.length) {
                this.selectedTab = 0;
            }
        });
        this.enabled = config.getBool('bank.tabsEnabled');
        this.tags = parseTagDefs(config.getStr('bank.tagDefs'));

        // Tab clicks: consumed only inside a tab rect (priority 8000 — the
        // settings panel at 10000 still wins; grid clicks pass through).
        this.ctx.hooks.onClick((e: QolClickEvent): boolean => this.click(e), 'bank-tabs-click', 8000);
        this.ctx.hooks.onDrawTop((g: QolGraphics): void => this.drawTop(g), 'bank-tabs-draw');
    }

    // ---- input ----

    private click(e: QolClickEvent): boolean {
        if (!this.enabled || !this.ctx.ingame() || !this.ctx.isBankOpen() || e.button !== 1) {
            return false;
        }
        // Click coords are full-frame; tab rects are viewport-local.
        const x: number = e.x - 4;
        const y: number = e.y - 4;
        for (let i = 0; i < this.tabRects.length; i++) {
            const r: TabRect = this.tabRects[i];
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                if (this.selectedTab !== r.tab) {
                    this.selectedTab = r.tab;
                    this.matchCache.clear();
                }
                return true;
            }
        }
        return false;
    }

    // ---- drawing ----

    private drawTop(g: QolGraphics): void {
        this.tabRects.length = 0;
        if (!this.enabled || !this.ctx.ingame() || !this.ctx.isBankOpen()) {
            return;
        }

        const root: IfType | undefined = IfType.list[BANK_MAIN_ID];
        if (!root || root.hide) {
            return;
        }

        const font = this.ctx.fonts().p11;
        if (!font) {
            return;
        }

        // --- tab strip along the top of the bank window ---
        const stripX: number = root.x + STRIP_PAD;
        const stripY: number = root.y + STRIP_PAD;
        const stripMaxW: number = Math.max(60, root.width - STRIP_PAD * 2);

        const tabNames: string[] = ['All'];
        for (let i = 0; i < this.tags.length; i++) {
            tabNames.push(this.tags[i].name);
        }
        if (this.tags.length === 0) {
            tabNames.push('no tags (F10)');
        }

        // Lay out (wrapping at MAX_TAB_ROWS) and measure the strip height.
        let cursorX: number = stripX + TAB_GAP;
        let row: number = 0;
        const layout: TabRect[] = [];
        for (let i = 0; i < tabNames.length; i++) {
            const w: number = g.textWidth(font, tabNames[i]) + TAB_PAD_X * 2;
            if (cursorX + w > stripX + stripMaxW && row < MAX_TAB_ROWS - 1 && layout.length > 0) {
                row++;
                cursorX = stripX + TAB_GAP;
            }
            if (cursorX + w > stripX + stripMaxW) {
                break; // overflow beyond the row cap: drop the excess tabs
            }
            layout.push({
                x: cursorX,
                y: stripY + TAB_GAP + row * (TAB_H + TAB_GAP),
                w,
                h: TAB_H,
                tab: i
            });
            cursorX += w + TAB_GAP;
        }

        const stripH: number = (row + 1) * (TAB_H + TAB_GAP) + TAB_GAP;
        g.fillRectTrans(stripX, stripY, stripMaxW, stripH, COL_STRIP_BG, COL_STRIP_BG_ALPHA);
        g.drawRect(stripX, stripY, stripMaxW, stripH, COL_TAB_BG_SEL);

        for (let i = 0; i < layout.length; i++) {
            const r: TabRect = layout[i];
            const selected: boolean = r.tab === this.selectedTab;
            const clickable: boolean = r.tab <= this.tags.length;
            g.fillRect(r.x, r.y, r.w, r.h, selected ? COL_TAB_BG_SEL : COL_TAB_BG);
            g.text(font, tabNames[r.tab], r.x + TAB_PAD_X, r.y + 10, clickable ? (selected ? COL_TAB_TEXT_SEL : COL_TAB_TEXT) : COL_COUNT, false);
            if (clickable) {
                this.tabRects.push(r);
            }
        }

        // Match counter on the strip's right edge while a tag is selected.
        if (this.selectedTab >= 1 && this.selectedTab <= this.tags.length) {
            const grid: IfType | null = this.resolveLayout();
            if (grid !== null && grid.linkObjType !== null) {
                let matched = 0;
                let total = 0;
                const n: number = Math.min(grid.linkObjType.length, MAX_SCANNED_SLOTS);
                for (let s = 0; s < n; s++) {
                    const raw: number = grid.linkObjType[s];
                    if (raw <= 0) {
                        continue;
                    }
                    total++;
                    if (this.matches(raw)) {
                        matched++;
                    }
                }
                const label: string = matched + '/' + total;
                g.text(font, label, stripX + stripMaxW - g.textWidth(font, label) - TAB_GAP, stripY + 10, COL_COUNT, false);
            }
        }

        // --- dim non-matching slots ---
        if (this.selectedTab < 1 || this.selectedTab > this.tags.length) {
            return;
        }
        const gridForDim: IfType | null = this.resolveLayout();
        if (gridForDim === null || this.clipW <= 0 || this.clipH <= 0) {
            return;
        }
        const types: Int32Array | null = gridForDim.linkObjType;
        if (types === null) {
            return;
        }
        const cols: number = gridForDim.width;
        if (cols <= 0) {
            return;
        }

        const strideX: number = gridForDim.marginX + SLOT_PX;
        const strideY: number = gridForDim.marginY + SLOT_PX;
        const bgX: Int16Array | null = gridForDim.invBackgroundX;
        const bgY: Int16Array | null = gridForDim.invBackgroundY;
        const n: number = Math.min(types.length, MAX_SCANNED_SLOTS);
        const clipRight: number = this.clipX + this.clipW;
        const clipBottom: number = this.clipY + this.clipH;

        g.pushClip(this.clipX, this.clipY, this.clipW, this.clipH);
        for (let s = 0; s < n; s++) {
            const raw: number = types[s];
            if (raw <= 0 || this.matches(raw)) {
                continue;
            }

            const rowIdx: number = (s / cols) | 0;
            const colIdx: number = s - rowIdx * cols;
            let slotX: number = this.gridX + colIdx * strideX;
            let slotY: number = this.gridY + rowIdx * strideY;
            if (s < 20 && bgX !== null && bgY !== null) {
                slotX += bgX[s];
                slotY += bgY[s];
            }
            if (slotX + SLOT_PX <= this.clipX || slotX >= clipRight || slotY + SLOT_PX <= this.clipY || slotY >= clipBottom) {
                continue;
            }
            g.fillRectTrans(slotX, slotY, SLOT_PX, SLOT_PX, 0x000000, DIM_ALPHA);
        }
        g.popClip();
    }

    /** rawId → does it match the selected tag? Cached per rawId. */
    private matches(rawId: number): boolean {
        const cached: boolean | undefined = this.matchCache.get(rawId);
        if (cached !== undefined) {
            return cached;
        }

        let result = false;
        const tag: TagDef | undefined = this.tags[this.selectedTab - 1];
        let obj: ObjType | null = null;
        try {
            obj = ObjType.list(rawId - 1);
        } catch {
            obj = null;
        }
        if (tag !== undefined && obj !== null && obj.name != null) {
            const name: string = obj.name.toLowerCase();
            for (let i = 0; i < tag.substrings.length && !result; i++) {
                if (name.indexOf(tag.substrings[i]) !== -1) {
                    result = true;
                }
            }
            for (let i = 0; i < tag.regexes.length && !result; i++) {
                if (tag.regexes[i].test(obj.name)) {
                    result = true;
                }
            }
        }

        if (this.matchCache.size > 4096) {
            this.matchCache.clear();
        }
        this.matchCache.set(rawId, result);
        return result;
    }

    // ---- layout resolution (BankPlaceholders chain-walk, trimmed) ----

    /**
     * Rebuild/validate the root→grid chain and walk it with drawInterface's
     * offset math to get this-frame grid coords + scroll-clip rect. Returns
     * the grid component when it is actually being drawn, else null.
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
        const layer: IfType = this.pathComps[this.pathLen - 2];
        this.clipX = lastX;
        this.clipY = lastY;
        this.clipW = layer.width;
        this.clipH = layer.height;
        return grid;
    }

    /** DFS mirroring drawInterface's recursion, filling the chain arrays. */
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

export default {
    name: 'BankTabs',
    register(ctx: QolContext): void {
        new BankTabsState(ctx).register();
    }
};

// Shop bulk actions — "sell all / sell x, buy all / buy x" at shops (user
// request, RuneLite-style QoL round).
//
// The shop interface has no Max option on the server side:
//
//   shelf inv 3900  iop = [Value | Buy 1 | Buy 5 | Buy 10 | ]
//   side  inv 3823  iop = [Value | Sell 1 | Sell 5 | Sell 10 | ]
//
// so bulk amounts are streamed as INV_BUTTON2/3/4 (1/5/10) packets — the
// same shape the SDK's buyFromShop/sellToShop use. The client also cannot
// price a buy: the server's calc_shop_value (server/content/scripts/shop/
// scripts/shop.rs2) folds in inv_stockbase and per-NPC shopkeeper params
// that never reach the client. Instead of predicting, the engine OBSERVES:
// send one 1/5/10 step, wait for the traded inventory to change, re-resolve
// the slot (slots slide as stacks drain), send the next step. A step with
// no state change after ~1.5s is a server rejection — the reason lands in
// chat and the task ends.
//
// UI, all on the shop window (both modals draw at the viewport origin):
//
//   title row (free zone between title 3901 @x225 and Close 3902 @x420):
//     [Sell All]   X:[100]
//
//   - [Sell All]  dumps the whole player inventory: one task per occupied
//     slot of 3823, run sequentially (observe-and-step — a non-stackable
//     sell slides the slots, so a blind burst would race them).
//   - X:[100]     bulk quantity, click to type (digits / Backspace /
//     Enter commits / Esc cancels), persisted in localStorage; drives the
//     menu entry labels.
//
//   right-click menu additions (menuBuilt, placed just above the
//   Cancel/Examine block so the menu top — the left-click action — is
//   untouched):
//     shelf item  → "Buy 100" (the X value) + "Buy Max"
//     side  item  → "Sell 100" (the X value) + "Sell Max"
//
//   A click on one of the injected entries is intercepted by the click
//   hook (the client's own menu hit-test, replicated), which starts the
//   task and closes the menu — a consumed click does not close it on its
//   own. The injected entries carry INV_BUTTON5 (354): if interception
//   ever fails, doAction sends an inv_button5 packet the shop scripts do
//   not define — a harmless server-side no-op.
//
// The observe-and-step pump runs in onTick (end of gameLoop, after this
// frame's updates are applied):
//
//   task = { comId 3900|3823, rawId (linkObjType value), remaining (0=Max) }
//   per tick:
//     - shop closed / feature off → drop the queue
//     - re-resolve the first slot holding rawId + the total count
//     - no slot / count 0         → task done, next task
//     - step = largest of {10,5,1} <= remaining-or-Inf and <= count
//     - a step in flight:
//         count changed vs snapshot → send the next step this tick
//         no change for 1500ms      → rejected, task done
//     - else send one step (client.shopBuy/shopSell), snapshot, wait
//
// A new bulk request replaces the queue (last click wins).
//
// Hot path: drawTop/menuBuilt run at 50-70Hz — preallocated rects and meta
// slots, only the quantity/status label strings allocate per frame.

import IfType from '#/config/IfType.js';
import ObjType from '#/config/ObjType.js';
import { MiniMenuAction } from '#/client/MiniMenuAction.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type { QolClickEvent, QolMenuView } from '#/client/qol/QolHooks.js';

/** Setting key (Shop section). */
const KEY: string = 'shop.bulkActions';
const SECTION: string = 'Shop';

/** shop_main root — drawn at the viewport origin while open. */
const SHOP_MAIN_ID: number = 3824;
/** Title label on the main window's title row (left edge of the free zone). */
const SHOP_TITLE_ID: number = 3901;
/** Close button on the main window's title row (right edge of the free zone). */
const SHOP_CLOSE_ID: number = 3902;
/** Shop goods grid (8x5). iop: [Value, Buy 1, Buy 5, Buy 10]. */
const SHELF_INV_ID: number = 3900;
/** Player's own grid in the side panel (4x7, 28 slots). iop: [Value, Sell 1, Sell 5, Sell 10]. */
const SIDE_INV_ID: number = 3823;

const BTN_H: number = 13;
const PAD_X: number = 6;
const BOX_W: number = 42;
/** Busy-status line, under the shop's hint text (3903, y 291..305). */
const STATUS_X: number = 63;
const STATUS_Y: number = 307;

const COL_BTN_BG: number = 0x362f23;
const COL_BTN_BORDER: number = 0x5d5447;
const COL_BTN_TEXT: number = 0xffffff;
const COL_EDIT_BORDER: number = 0xc9a86a;
const COL_STATUS: number = 0xc8b89a;

const SELL_ALL_LABEL: string = 'Sell All';
const QTY_LABEL: string = 'X';
const MAX_BUY_TEXT: string = 'Buy Max';
const MAX_SELL_TEXT: string = 'Sell Max';

const QTY_STORAGE_KEY: string = 'rs-qol-shopqty-v1';
const QTY_DEFAULT: number = 100;
const QTY_MAX: number = 99999;

/** No state change this long after a send → the server rejected the step. */
const REJECT_MS: number = 1500;
/** A single task may not run longer than this (desync safety). */
const TASK_TIMEOUT_MS: number = 120_000;

interface BtnRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface BulkTask {
    /** SHELF_INV_ID (buy) or SIDE_INV_ID (sell). */
    comId: number;
    /** linkObjType value (obj id + 1) the task trades. */
    rawId: number;
    /** Units still to trade; 0 = Max (until the source runs dry). */
    remaining: number;
    startedAt: number;
}

interface EntryMeta {
    comId: number;
    rawId: number;
}

interface Resolved {
    slot: number;
    count: number;
}

interface PosSize {
    x: number;
    y: number;
    w: number;
}

interface ShopLayout {
    rowY: number;
    titleEnd: number;
}

class ShopBulkPlugin {
    private enabled: boolean = true;
    /** Cached title-row geometry (static data, resolved once). */
    private layout: ShopLayout | null = null;
    /** Live button rects, repainted every drawTop frame. */
    private readonly sellAllRect: BtnRect = { x: 0, y: 0, w: 0, h: 0 };
    private readonly boxRect: BtnRect = { x: 0, y: 0, w: 0, h: 0 };

    // ---- quantity field ----

    private qty: number = QTY_DEFAULT;
    private draft: number = 0;
    private editing: boolean = false;
    /** Cached "Buy N"/"Sell N" labels, rebuilt only when qty changes. */
    private buyXText: string = '';
    private sellXText: string = '';

    // ---- injected menu entries ----

    /** Final index of the injected X entry (-1 = none in the current build). */
    private entryX: number = -1;
    /** Final index of the injected Max entry (-1 = none in the current build). */
    private entryMax: number = -1;
    private readonly entryXMeta: EntryMeta = { comId: 0, rawId: 0 };
    private readonly entryMaxMeta: EntryMeta = { comId: 0, rawId: 0 };

    // ---- the pump ----

    private readonly tasks: BulkTask[] = [];
    private pending: boolean = false;
    /** Count snapshot taken when the in-flight step was sent. */
    private snapshot: number = 0;
    private pendingSince: number = 0;
    /** Plugin clock in ms (accumulated dtMs), for the timeouts. */
    private now: number = 0;
    private readonly resolved: Resolved = { slot: -1, count: 0 };

    register(ctx: QolContext): void {
        ctx.config.define({
            key: KEY,
            section: SECTION,
            label: 'Shop bulk actions',
            type: 'boolean',
            default: true,
            tooltip:
                'Sell All button + X quantity box on the shop window, and Buy/Sell X / Buy/Sell Max options in shop item right-click menus.'
        });
        this.enabled = ctx.config.getBool(KEY);
        this.qty = this.loadQty();
        this.refreshQtyTexts();

        ctx.config.onChange(KEY, (): void => {
            this.enabled = ctx.config.getBool(KEY);
            if (!this.enabled) {
                this.editing = false;
                this.abortAll();
            }
        });

        ctx.hooks.onClick((e: QolClickEvent): boolean => this.click(e, ctx), 'shop-bulk-click', 8000);
        ctx.hooks.onKey((ch: number): boolean => this.key(ch, ctx), 'shop-bulk-key', 8000);
        ctx.hooks.onDrawTop((g: QolGraphics): void => this.drawTop(g, ctx), 'shop-bulk-draw');
        ctx.hooks.onMenuBuilt((menu: QolMenuView): void => this.menuBuilt(menu, ctx), 'shop-bulk-menu');
        ctx.hooks.onTick((dtMs: number): void => this.tick(dtMs, ctx), 'shop-bulk-tick');
    }

    // ---- layout ----

    /**
     * Walk the shop main root for the title/close positions, replicating the
     * draw-walk position math (parent pos + childX/childY). Static data only
     * — the modal is drawn at the viewport origin, so the result IS the
     * drawTop coordinate. Resolved once and cached (BankDeposit pattern).
     */
    private resolveLayout(): ShopLayout | null {
        const root: IfType | undefined = IfType.list[SHOP_MAIN_ID];
        if (!root || root.type !== 0) {
            return null;
        }
        const title: PosSize | null = this.findIn(root, 0, 0, SHOP_TITLE_ID);
        const close: PosSize | null = this.findIn(root, 0, 0, SHOP_CLOSE_ID);
        if (!title || !close) {
            return null;
        }
        return { rowY: title.y, titleEnd: title.x + title.w };
    }

    private findIn(com: IfType, x: number, y: number, id: number): PosSize | null {
        const children: number[] | null = com.children;
        if (!children) {
            return null;
        }
        for (let i: number = 0; i < children.length; i++) {
            const child: IfType | undefined = IfType.list[children[i]];
            if (!child) {
                continue;
            }
            const cx: number = x + (com.childX?.[i] ?? 0);
            const cy: number = y + (com.childY?.[i] ?? 0);
            if (child.id === id) {
                return { x: cx, y: cy, w: child.width };
            }
            if (child.type === 0) {
                const found: PosSize | null = this.findIn(child, cx, cy, id);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    // ---- state helpers ----

    private shopOpen(ctx: QolContext): boolean {
        return ctx.client.isShopOpen() === true;
    }

    /** First slot holding rawId + the total count over all holding slots.
     *  Callers check `linkObjType`/`linkObjNumber` are non-null first. */
    private resolveTask(com: IfType, rawId: number): void {
        const inv: Int32Array = com.linkObjType!;
        const num: Int32Array = com.linkObjNumber!;
        this.resolved.slot = -1;
        this.resolved.count = 0;
        for (let s: number = 0; s < inv.length; s++) {
            if (inv[s] === rawId) {
                if (this.resolved.slot < 0) {
                    this.resolved.slot = s;
                }
                this.resolved.count += num[s];
            }
        }
    }

    private countOf(comId: number, rawId: number): number {
        const com: IfType | undefined = IfType.list[comId];
        if (!com || !com.linkObjType || !com.linkObjNumber) {
            return 0;
        }
        this.resolveTask(com, rawId);
        return this.resolved.count;
    }

    private abortAll(): void {
        this.tasks.length = 0;
        this.pending = false;
    }

    // ---- actions ----

    /** A new bulk request replaces the queue (last click wins). */
    private startTask(comId: number, rawId: number, remaining: number): void {
        this.tasks.length = 0;
        this.tasks.push({ comId, rawId, remaining, startedAt: this.now });
        this.pending = false;
        console.log(`[qol] shop: ${comId === SHELF_INV_ID ? 'buy' : 'sell'} ${remaining > 0 ? remaining : 'max'} of obj ${rawId - 1}`);
    }

    /** One task per occupied side-inventory slot, run in slot order. */
    private startSellAll(): boolean {
        const com: IfType | undefined = IfType.list[SIDE_INV_ID];
        if (!com || !com.linkObjType || !com.linkObjNumber) {
            return false;
        }
        const inv: Int32Array = com.linkObjType;
        const num: Int32Array = com.linkObjNumber;
        this.tasks.length = 0;
        let any: boolean = false;
        for (let s: number = 0; s < inv.length; s++) {
            if (inv[s] > 0) {
                this.tasks.push({ comId: SIDE_INV_ID, rawId: inv[s], remaining: num[s], startedAt: this.now });
                any = true;
            }
        }
        this.pending = false;
        if (any) {
            console.log(`[qol] shop: sell-all over ${this.tasks.length} inventory slot(s)`);
        }
        return any;
    }

    // ---- the pump ----

    private tick(dtMs: number, ctx: QolContext): void {
        this.now += dtMs;

        if (this.tasks.length === 0) {
            this.pending = false;
            return;
        }

        if (!this.enabled || !ctx.ingame() || !this.shopOpen(ctx)) {
            this.abortAll();
            return;
        }

        const task: BulkTask = this.tasks[0];

        if (this.now - task.startedAt > TASK_TIMEOUT_MS) {
            this.tasks.shift();
            this.pending = false;
            return;
        }

        const com: IfType | undefined = IfType.list[task.comId];
        if (!com || !com.linkObjType || !com.linkObjNumber) {
            this.abortAll();
            return;
        }

        this.resolveTask(com, task.rawId);
        const slot: number = this.resolved.slot;
        const count: number = this.resolved.count;

        if (slot < 0 || count <= 0) {
            this.tasks.shift();
            this.pending = false;
            return;
        }

        if (this.pending) {
            if (count !== this.snapshot) {
                // Observed progress — fall through and send the next step.
                this.pending = false;
            } else if (this.now - this.pendingSince > REJECT_MS) {
                // The server refused the step; its reason is already in chat.
                this.tasks.shift();
                this.pending = false;
                return;
            } else {
                return; // still waiting for the step to land
            }
        }

        let cap: number = count;
        if (task.remaining > 0 && task.remaining < cap) {
            cap = task.remaining;
        }
        if (cap <= 0) {
            this.tasks.shift();
            this.pending = false;
            return;
        }

        // shopBuy/shopSpeak accept 1/5/10 only — the largest supported step.
        const step: number = cap >= 10 ? 10 : cap >= 5 ? 5 : 1;
        const client: any = ctx.client;
        const sent: boolean = task.comId === SHELF_INV_ID
            ? client.shopBuy(slot, step)
            : client.shopSell(slot, step);
        if (!sent) {
            this.abortAll();
            return;
        }

        if (task.remaining > 0) {
            task.remaining -= step;
            if (task.remaining <= 0) {
                this.tasks.shift();
            }
        }

        this.snapshot = count;
        this.pending = true;
        this.pendingSince = this.now;
    }

    // ---- menu ----

    private menuBuilt(menu: QolMenuView, ctx: QolContext): void {
        this.entryX = -1;
        this.entryMax = -1;

        if (!this.enabled || !ctx.ingame() || !this.shopOpen(ctx)) {
            return;
        }

        // The menu carries one slot's worth of entries; the component iop
        // entries (Value/Buy|Sell 1/5/10) pin the slot via paramA/B/C.
        const n: number = menu.count;
        let comId: number = 0;
        let rawId: number = 0;
        let slot: number = -1;
        for (let i: number = 0; i < n; i++) {
            const pc: number = menu.paramC(i);
            if (pc === SHELF_INV_ID || pc === SIDE_INV_ID) {
                comId = pc;
                rawId = menu.paramA(i) + 1;
                slot = menu.paramB(i);
            }
        }
        if (comId === 0 || slot < 0) {
            return;
        }

        // The slot must actually hold the item (defensive).
        const com: IfType | undefined = IfType.list[comId];
        if (!com || !com.linkObjType || com.linkObjType[slot] !== rawId) {
            return;
        }

        // Placement: the top of the low (<1000) group — just above the
        // Cancel/Examine block, so the menu top (left-click) is untouched.
        let k: number = -1;
        for (let i: number = 1; i < n; i++) {
            if (menu.action(i) < 1000) {
                k = i;
                break;
            }
        }
        if (k < 0) {
            return;
        }

        const buy: boolean = comId === SHELF_INV_ID;
        menu.add(buy ? this.buyXText : this.sellXText, MiniMenuAction.INV_BUTTON5, rawId - 1, slot, comId);
        menu.add(buy ? MAX_BUY_TEXT : MAX_SELL_TEXT, MiniMenuAction.INV_BUTTON5, rawId - 1, slot, comId);
        // Both additions land at the menu top; move them down to k/k+1.
        menu.move(n, k);
        menu.move(n + 1, k + 1);

        this.entryX = k;
        this.entryMax = k + 1;
        this.entryXMeta.comId = comId;
        this.entryXMeta.rawId = rawId;
        this.entryMaxMeta.comId = comId;
        this.entryMaxMeta.rawId = rawId;
    }

    // ---- click ----

    private click(e: QolClickEvent, ctx: QolContext): boolean {
        if (!this.enabled || !ctx.ingame() || !this.shopOpen(ctx)) {
            return false;
        }
        const client: any = ctx.client;

        // Open menu: replicate the client's hit-test; intercept a hit on an
        // injected entry.
        if (client.isMenuOpen === true) {
            if (e.button !== 1) {
                return false;
            }
            let cx: number = e.x;
            let cy: number = e.y;
            if (client.menuArea === 0) {
                cx -= 4;
                cy -= 4;
            } else if (client.menuArea === 1) {
                cx -= 553;
                cy -= 205;
            } else if (client.menuArea === 2) {
                cx -= 17;
                cy -= 357;
            }
            const n: number = client.menuNumEntries;
            const mx: number = client.menuX;
            const my: number = client.menuY;
            const mw: number = client.menuWidth;
            for (let i: number = 0; i < n; i++) {
                const optionY: number = my + (n - 1 - i) * 15 + 31;
                if (cx > mx && cx < mx + mw && cy > optionY - 13 && cy < optionY + 3) {
                    if (i === this.entryX) {
                        this.startTask(this.entryXMeta.comId, this.entryXMeta.rawId, this.qty);
                        this.closeMenu(client);
                        return true;
                    }
                    if (i === this.entryMax) {
                        this.startTask(this.entryMaxMeta.comId, this.entryMaxMeta.rawId, 0);
                        this.closeMenu(client);
                        return true;
                    }
                    return false;
                }
            }
            return false;
        }

        if (e.button !== 1) {
            return false;
        }

        // Click coords are full-frame; button rects are viewport-local.
        const x: number = e.x - 4;
        const y: number = e.y - 4;

        if (x >= this.boxRect.x && x < this.boxRect.x + this.boxRect.w &&
            y >= this.boxRect.y && y < this.boxRect.y + this.boxRect.h) {
            if (this.editing) {
                this.editing = false;
                return true;
            }
            this.editing = true;
            this.draft = this.qty;
            return true;
        }

        if (x >= this.sellAllRect.x && x < this.sellAllRect.x + this.sellAllRect.w &&
            y >= this.sellAllRect.y && y < this.sellAllRect.y + this.sellAllRect.h) {
            this.editing = false;
            return this.startSellAll();
        }

        if (this.editing) {
            this.editing = false; // click elsewhere cancels; let it pass through
        }
        return false;
    }

    /** Close the open menu exactly the way the vanilla handler does. */
    private closeMenu(client: any): void {
        client.isMenuOpen = false;
        if (client.menuArea === 1) {
            client.redrawSide = true;
        } else if (client.menuArea === 2) {
            client.redrawChat = true;
        }
    }

    // ---- keys (quantity editing) ----

    private key(ch: number, ctx: QolContext): boolean {
        if (!this.editing || !this.enabled || !this.shopOpen(ctx)) {
            return false;
        }
        if (ch >= 48 && ch <= 57) { // '0'..'9'
            this.draft = Math.min(QTY_MAX, this.draft * 10 + (ch - 48));
            return true;
        }
        if (ch === 8) { // Backspace
            this.draft = Math.floor(this.draft / 10);
            return true;
        }
        if (ch === 10) { // Enter
            this.commitQty();
            return true;
        }
        if (ch === 27) { // Esc — cancel, keep the old value
            this.editing = false;
            return true;
        }
        return false;
    }

    private commitQty(): void {
        this.qty = Math.max(1, this.draft);
        this.editing = false;
        this.refreshQtyTexts();
        this.saveQty();
    }

    private refreshQtyTexts(): void {
        this.buyXText = 'Buy ' + this.qty;
        this.sellXText = 'Sell ' + this.qty;
    }

    private loadQty(): number {
        try {
            const raw: string | null = localStorage.getItem(QTY_STORAGE_KEY);
            if (raw !== null) {
                const v: number = parseInt(raw, 10);
                if (Number.isFinite(v) && v >= 1 && v <= QTY_MAX) {
                    return v;
                }
            }
        } catch {
            // storage unavailable — fall back to the default
        }
        return QTY_DEFAULT;
    }

    private saveQty(): void {
        try {
            localStorage.setItem(QTY_STORAGE_KEY, String(this.qty));
        } catch {
            // ignore
        }
    }

    // ---- drawing ----

    private drawTop(g: QolGraphics, ctx: QolContext): void {
        if (!this.enabled || !ctx.ingame() || !this.shopOpen(ctx)) {
            this.sellAllRect.w = 0;
            this.boxRect.w = 0;
            return;
        }

        if (this.layout === null) {
            this.layout = this.resolveLayout();
        }
        const layout: ShopLayout | null = this.layout;
        if (!layout) {
            this.sellAllRect.w = 0;
            this.boxRect.w = 0;
            return;
        }

        const font = ctx.fonts().p11;
        if (!font) {
            return;
        }

        // [Sell All]
        const btnW: number = g.textWidth(font, SELL_ALL_LABEL) + PAD_X * 2;
        const btnX: number = layout.titleEnd + 6;
        const y: number = layout.rowY;
        this.sellAllRect.x = btnX;
        this.sellAllRect.y = y;
        this.sellAllRect.w = btnW;
        this.sellAllRect.h = BTN_H;
        g.fillRect(btnX, y, btnW, BTN_H, COL_BTN_BG);
        g.drawRect(btnX, y, btnW, BTN_H, COL_BTN_BORDER);
        g.text(font, SELL_ALL_LABEL, btnX + PAD_X, y + 2, COL_BTN_TEXT, false);

        // X:[qty]
        const labelX: number = btnX + btnW + 5;
        g.text(font, QTY_LABEL, labelX, y + 2, COL_BTN_TEXT, false);
        const boxX: number = labelX + g.textWidth(font, QTY_LABEL) + 3;
        this.boxRect.x = boxX;
        this.boxRect.y = y;
        this.boxRect.w = BOX_W;
        this.boxRect.h = BTN_H;
        const val: string = String(this.editing ? this.draft : this.qty);
        g.fillRect(boxX, y, BOX_W, BTN_H, COL_BTN_BG);
        g.drawRect(boxX, y, BOX_W, BTN_H, this.editing ? COL_EDIT_BORDER : COL_BTN_BORDER);
        g.text(font, val, boxX + ((BOX_W - g.textWidth(font, val)) >> 1), y + 2, COL_BTN_TEXT, false);

        // Busy status under the hint line
        if (this.tasks.length > 0) {
            const task: BulkTask = this.tasks[0];
            let name: string = 'item';
            try {
                const obj: ObjType = ObjType.list(task.rawId - 1);
                if (obj && obj.name) {
                    name = obj.name;
                }
            } catch {
                // unknown id — keep the fallback label
            }
            const left: number = task.remaining > 0 ? task.remaining : this.countOf(task.comId, task.rawId);
            const str: string = (task.comId === SHELF_INV_ID ? 'buying ' : 'selling ') + name + ': ' + left + ' left';
            g.text(font, str, STATUS_X, STATUS_Y, COL_STATUS, true);
        }
    }
}

export default {
    name: 'ShopBulk',
    register(ctx: QolContext): void {
        new ShopBulkPlugin().register(ctx);
    }
};

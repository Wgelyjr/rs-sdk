// Shop bulk actions — "sell all / sell x, buy all / buy x" at shops (user
// request, RuneLite-style QoL round).
//
// Everything lives in the right-click menus — the shop window itself is
// untouched (user correction: the actions are menu entries, not window UI):
//
//   right-click a shelf item (shop stock)   → "Buy <X>"  + "Buy Max"
//   right-click an item in your own grid    → "Sell <X>" + "Sell Max" + "Sell All"
//
// <X> is the "Bulk quantity" slider (Shop settings section, 1-1000,
// default 100).
//
// Why not one big packet: the shop interface has no Max option on the
// server side —
//
//   shelf inv 3900  iop = [Value | Buy 1 | Buy 5 | Buy 10 | ]
//   side  inv 3823  iop = [Value | Sell 1 | Sell 5 | Sell 10 | ]
//
// — so bulk amounts are streamed as INV_BUTTON2/3/4 (1/5/10) packets via
// client.shopBuy/shopSell (the same shape the SDK's buyFromShop/sellToShop
// use). The client also cannot price a buy: the server's calc_shop_value
// (server/content/scripts/shop/scripts/shop.rs2) folds in inv_stockbase and
// per-NPC shopkeeper params that never reach the client.
//
// Instead of predicting, the engine OBSERVES: send one 1/5/10 step, wait
// for the traded inventory to change, re-resolve the slot (slots slide as
// stacks drain), send the next step. A step with no state change after
// ~1.5s is a server rejection — the reason lands in chat and the task ends.
//
// The injected entries carry INV_BUTTON5 (354) and sit just above the
// Cancel/Examine block (menuBuilt runs after the client sort; entries are
// appended then moved, so the menu top — the left-click action — is
// untouched). A click on one is intercepted by the click hook (the
// client's own menu hit-test, replicated), which starts the task and closes
// the menu the vanilla way. If interception ever fails, doAction sends an
// inv_button5 packet the shop scripts don't define — a harmless
// server-side no-op.
//
// The observe-and-step pump runs in onTick (end of gameLoop):
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
// "Sell All" pushes one task per occupied side-inventory slot (slot order).
// A new bulk request replaces the queue (last click wins).
//
// drawTop paints only the busy status line under the shop hint text while a
// task runs ("buying/selling <name>: <left> left"). Hot path: preallocated
// scratch, only the status string allocates per frame.

import IfType from '#/config/IfType.js';
import ObjType from '#/config/ObjType.js';
import { MiniMenuAction } from '#/client/MiniMenuAction.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type { QolClickEvent, QolMenuView } from '#/client/qol/QolHooks.js';

/** Master toggle (Shop section). */
const KEY: string = 'shop.bulkActions';
/** Bulk quantity slider (Shop section). */
const QTY_KEY: string = 'shop.bulkQty';
const SECTION: string = 'Shop';

/** Shop goods grid (8x5). iop: [Value, Buy 1, Buy 5, Buy 10]. */
const SHELF_INV_ID: number = 3900;
/** Player's own grid in the side panel (4x7, 28 slots). iop: [Value, Sell 1, Sell 5, Sell 10]. */
const SIDE_INV_ID: number = 3823;

const QTY_DEFAULT: number = 100;
const QTY_MIN: number = 1;
const QTY_MAX: number = 1000;

/** Busy-status line, under the shop's hint text (3903, y 291..305). */
const STATUS_X: number = 63;
const STATUS_Y: number = 307;
const COL_STATUS: number = 0xc8b89a;

const MAX_BUY_TEXT: string = 'Buy Max';
const MAX_SELL_TEXT: string = 'Sell Max';
const SELL_ALL_TEXT: string = 'Sell All';

/** No state change this long after a send → the server rejected the step. */
const REJECT_MS: number = 1500;
/** A single task may not run longer than this (desync safety). */
const TASK_TIMEOUT_MS: number = 120_000;

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

class ShopBulkPlugin {
    private enabled: boolean = true;
    /** Slider value; "Buy <X>"/"Sell <X>" labels rebuilt only on change. */
    private qty: number = QTY_DEFAULT;
    private buyXText: string = '';
    private sellXText: string = '';

    // ---- injected menu entries (final indices; -1 = none in this build) ----

    private entryX: number = -1;
    private entryMax: number = -1;
    private entryAll: number = -1;
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
                'Buy X / Buy Max on shop stock and Sell X / Sell Max / Sell All on your own items, in the right-click menus.'
        });
        ctx.config.define({
            key: QTY_KEY,
            section: SECTION,
            label: 'Bulk quantity',
            type: 'slider',
            default: QTY_DEFAULT,
            min: QTY_MIN,
            max: QTY_MAX,
            tooltip: 'Quantity used by the "Buy X" and "Sell X" menu entries. Max = until the stock or bag runs dry.'
        });
        this.enabled = ctx.config.getBool(KEY);
        this.qty = ctx.config.getNum(QTY_KEY);
        this.refreshQtyTexts();

        ctx.config.onChange(KEY, (): void => {
            this.enabled = ctx.config.getBool(KEY);
            if (!this.enabled) {
                this.abortAll();
            }
        });
        ctx.config.onChange(QTY_KEY, (): void => {
            this.qty = ctx.config.getNum(QTY_KEY);
            this.refreshQtyTexts();
        });

        ctx.hooks.onClick((e: QolClickEvent): boolean => this.click(e, ctx), 'shop-bulk-click', 8000);
        ctx.hooks.onDrawTop((g: QolGraphics): void => this.drawTop(g, ctx), 'shop-bulk-draw');
        ctx.hooks.onMenuBuilt((menu: QolMenuView): void => this.menuBuilt(menu, ctx), 'shop-bulk-menu');
        ctx.hooks.onTick((dtMs: number): void => this.tick(dtMs, ctx), 'shop-bulk-tick');
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

    /** One task per occupied side-inventory slot, in slot order. */
    private startSellAll(): void {
        const com: IfType | undefined = IfType.list[SIDE_INV_ID];
        if (!com || !com.linkObjType || !com.linkObjNumber) {
            return;
        }
        const inv: Int32Array = com.linkObjType;
        const num: Int32Array = com.linkObjNumber;
        this.tasks.length = 0;
        let count: number = 0;
        for (let s: number = 0; s < inv.length; s++) {
            if (inv[s] > 0) {
                this.tasks.push({ comId: SIDE_INV_ID, rawId: inv[s], remaining: num[s], startedAt: this.now });
                count++;
            }
        }
        this.pending = false;
        console.log(`[qol] shop: sell-all over ${count} inventory slot(s)`);
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

        // shopBuy/shopSell accept 1/5/10 only — the largest supported step.
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
        this.entryAll = -1;

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
        if (!buy) {
            // "Sell All" dumps the whole bag; the clicked slot is irrelevant.
            menu.add(SELL_ALL_TEXT, MiniMenuAction.INV_BUTTON5, rawId - 1, slot, comId);
        }
        // The additions land at the menu top; move them down to k/k+1(/k+2).
        menu.move(n, k);
        menu.move(n + 1, k + 1);
        if (!buy) {
            menu.move(n + 2, k + 2);
        }

        this.entryX = k;
        this.entryMax = k + 1;
        this.entryAll = buy ? -1 : k + 2;
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
                    if (i === this.entryAll) {
                        this.startSellAll();
                        this.closeMenu(client);
                        return true;
                    }
                    return false;
                }
            }
            return false;
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

    // ---- settings ----

    private refreshQtyTexts(): void {
        this.buyXText = 'Buy ' + this.qty;
        this.sellXText = 'Sell ' + this.qty;
    }

    // ---- drawing ----

    private drawTop(g: QolGraphics, ctx: QolContext): void {
        if (this.tasks.length === 0 || !this.enabled || !ctx.ingame() || !this.shopOpen(ctx)) {
            return;
        }

        const font = ctx.fonts().p11;
        if (!font) {
            return;
        }

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

export default {
    name: 'ShopBulk',
    register(ctx: QolContext): void {
        new ShopBulkPlugin().register(ctx);
    }
};

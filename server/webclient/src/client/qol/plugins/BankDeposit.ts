// F16b — Quick bank deposit buttons (docs/qol-features-plan.md §4 F16, user
// request: "a 'deposit inv/deposit worn' button are what I really need").
//
// Two buttons on the bank window's title row, drawn in the drawTop pass:
//
//   [Deposit Inv] [Deposit Worn]
//
// "Deposit Inv" — fires INV_BUTTON4 ("Deposit All", whole stack) for every
//   occupied slot of bank_side:inv (2006). The server's InvButtonHandler
//   validates each packet against the live inventory in receive order, so a
//   same-tick burst empties the whole bag — the vanilla deposit-all shape.
//   (Verified in the interface pack: 2006 iop = ["Deposit 1","Deposit 5",
//   "Deposit 10","Deposit All","Deposit X"] → option 4 = Deposit All, and
//   Client.bankDeposit(slot, -1) sends exactly that packet. No p_delay in the
//   bank scripts, so the burst is not throttled.)
//
// "Deposit Worn" — wornitems:wear (1688) carries only ["Remove"] (unequip to
//   inventory; the bank has no direct worn→bank path). The game's own Remove
//   script (server/content/scripts/player/scripts/equip.rs2,
//   [inv_button1,wornitems:wear]) starts with `if_close;` — PlayerOps'
//   IF_CLOSE handler runs player.closeModal(), which closes the bank before
//   the unequip lands. That is vanilla game behaviour (a manual Remove with
//   the bank open closes it identically), so the button works around it:
//
//     phase 1: INV_BUTTON1 ("Remove") burst over all occupied worn slots.
//              The bank closes as a side effect of the FIRST Remove — the
//              burst still lands because the equipment screen (1644) sits in
//              the player's tab list, which closeModal() does not clear.
//     phase 2: WORN_REOPEN_DELAY_MS later, re-open the bank the vanilla way —
//              OPLOC2 on the nearest bank chest (bank_booth.rs2: oploc2 goes
//              straight to @openbank, no banker dialogue) or OPNPC3 on a
//              nearby banker NPC (banker.rs2: apnpc3 → @openbank).
//     phase 3: once isBankOpen() (plus WORN_DEPOSIT_DELAY_MS so the
//              interface/inventory updates land) fire the Deposit Inv burst.
//
//   Net effect of one click: everything worn ends up in the bank. If the
//   bank cannot be found to reopen (no chest/booth within scan radius, no
//   banker), the items simply stay in the inventory — the same result a
//   manual Remove produces.
//
//   Items that don't fit in a too-full inventory get the vanilla "not enough
//   free space" message and stay worn — same constraint as manual unequips.
//
// Placement: the bank window (5381) is a static childX/childY of root 5292 at
// (36,20) — the root is drawn at the viewport origin (Client.gameDrawMain →
// drawInterface(list[mainModalId], 0, 0, 0)). The title row spans
// winY+10..winY+24: the title label starts at winX+145, Close (5384) owns
// winX+383..winX+451, so the free zone winX+4..winX+144 fits both buttons.
//
// Clicks: left button only (e.button === 1), consumed inside the button rects
// only, priority 8000 (same tier as bank-tabs).

import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';
import type { QolClickEvent } from '#/client/qol/QolHooks.js';

/** Setting key (Bank section). */
const KEY: string = 'bank.quickDeposit';

/** bank_main root layer — drawn at the viewport origin while open. */
const BANK_ROOT_ID: number = 5292;
/** The visible bank window (440x299), a child of the root layer. */
const BANK_WINDOW_ID: number = 5381;
/** bank_side:inv — player inventory grid in the bank window (28 slots).
 *  iop: ["Deposit 1","Deposit 5","Deposit 10","Deposit All","Deposit X"]. */
const BANK_SIDE_INV_ID: number = 2006;
/** "Deposit All" (whole stack) — option index into the iop above. */
const DEPOSIT_ALL_OPTION: number = 4;
/** wornitems:wear — equipment grid (15 slots). iop: ["Remove", null, ...]. */
const WORN_INV_ID: number = 1688;
/** "Remove" (unequip to inventory) — option index into the iop above. */
const REMOVE_OPTION: number = 1;

/** Deposit Worn phases (see the header for the flow). */
const PHASE_IDLE: number = 0;
/** Remove burst sent; waiting for the bank to close before reopening. */
const PHASE_PENDING_REOPEN: number = 1;
/** Reopen op sent; waiting for the bank to open, then the deposit burst. */
const PHASE_AWAITING_BANK: number = 2;

/** Remove burst → reopen op delay (ms): server processing + close round-trip. */
const WORN_REOPEN_DELAY_MS: number = 500;
/** Max wait for the bank to reopen before giving up (ms). */
const WORN_REOPEN_TIMEOUT_MS: number = 8000;
/** Bank confirmed open → deposit burst delay (ms): lets the interface and
 *  inventory updates for the reopened window land. */
const WORN_DEPOSIT_DELAY_MS: number = 250;
/** Tiles around the player to scan for the bank chest/booth. */
const BANK_CHEST_SCAN_RADIUS: number = 2;
/** Tiles around the player to scan for a fallback banker NPC. */
const BANKER_SCAN_RADIUS: number = 3;

/** A reopen target found near the player. */
interface BankTarget {
    kind: 'loc' | 'npc';
    /** loc only: absolute world tile. */
    worldX: number;
    worldZ: number;
    /** loc id or npc index. */
    id: number;
    /** 1-based op index (loc: 2 = quick open; npc: 3 = use/withdraw). */
    opIndex: number;
}

const BTN_H: number = 13;
const BTN_PAD_X: number = 6;
const BTN_GAP: number = 3;
const BTN_ROW_DX: number = 4; // button row offset from the window's left edge
const BTN_ROW_DY: number = 10; // title row

const COL_BTN_BG: number = 0x362f23;
const COL_BTN_BORDER: number = 0x5d5447;
const COL_BTN_TEXT: number = 0xffffff;

const LABELS: [string, string] = ['Deposit Inv', 'Deposit Worn'];

interface BtnRect {
    x: number;
    y: number;
    w: number;
    h: number;
    which: 0 | 1; // 0 = Deposit Inv, 1 = Deposit Worn
}

class BankDepositPlugin {
    private enabled: boolean = true;
    /** Static window offset within the root, cached from the first walk. */
    private winOffset: { x: number; y: number } | null = null;
    /** Live button rects, repainted every drawTop frame. */
    private rects: BtnRect[] = [];
    /** Deposit Worn flow state (see PHASE_*). */
    private wornPhase: number = PHASE_IDLE;
    /** nowMs when the current phase started (or the pending action fires). */
    private wornPhaseAt: number = 0;
    /** nowMs the bank first read open during PHASE_AWAITING_BANK; 0 = not yet. */
    private bankOpenedAt: number = 0;

    register(ctx: QolContext): void {
        ctx.config.define({
            key: KEY,
            section: 'Bank',
            label: 'Quick deposit buttons',
            type: 'boolean',
            default: true,
            tooltip: 'Deposit Inv / Deposit Worn buttons on the bank window title row. Deposit Inv empties the inventory; Deposit Worn unequips everything, reopens the bank (the game closes it on unequip), and deposits it.'
        });
        this.enabled = ctx.config.getBool(KEY);
        ctx.config.onChange(KEY, (): void => {
            this.enabled = ctx.config.getBool(KEY);
            this.rects.length = 0;
        });

        ctx.hooks.onClick((e: QolClickEvent): boolean => this.click(e, ctx), 'bank-deposit-click', 8000);
        ctx.hooks.onDrawTop((g: QolGraphics): void => this.drawTop(g, ctx), 'bank-deposit-draw');
        ctx.hooks.onTick((): void => this.tick(ctx), 'bank-deposit-tick');
    }

    // ---- layout ----

    /**
     * DFS from the bank root to the window component, replicating the
     * draw-walk position math (parent pos + childX/childY). Static data only —
     * the per-frame live offsets are read off the window component directly.
     */
    private resolveWindowOffset(): { x: number; y: number } | null {
        const root: IfType | undefined = IfType.list[BANK_ROOT_ID];
        if (!root || root.type !== 0 || !root.children) {
            return null;
        }
        return this.findWindow(root, 0, 0);
    }

    private findWindow(com: IfType, x: number, y: number): { x: number; y: number } | null {
        const children: number[] = com.children!;
        for (let i: number = 0; i < children.length; i++) {
            if (children[i] === BANK_WINDOW_ID) {
                return { x: x + (com.childX?.[i] ?? 0), y: y + (com.childY?.[i] ?? 0) };
            }
            const child: IfType | undefined = IfType.list[children[i]];
            if (child && child.type === 0 && child.children) {
                const found: { x: number; y: number } | null = this.findWindow(child, x + (com.childX?.[i] ?? 0), y + (com.childY?.[i] ?? 0));
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    // ---- actions ----

    /** Burst "Deposit All" over every occupied inventory slot. */
    private depositInventory(ctx: QolContext): void {
        const client = ctx.client;
        const com = IfType.list[BANK_SIDE_INV_ID];
        if (!com || !com.linkObjType) {
            return;
        }
        const inv: Int32Array = com.linkObjType;
        let sent: number = 0;
        for (let s: number = 0; s < inv.length; s++) {
            if (inv[s] > 0 && client.bankDeposit(s, -1)) {
                sent++;
            }
        }
        if (sent > 0) {
            console.log(`[qol] bank: deposit-all over ${sent} inventory slot(s)`);
        }
    }

    /** Phase 1: burst "Remove" over every occupied worn slot. */
    private depositWorn(ctx: QolContext): void {
        if (this.wornPhase !== PHASE_IDLE) {
            return; // a reopen is already in flight
        }
        const client = ctx.client;
        const com = IfType.list[WORN_INV_ID];
        if (!com || !com.linkObjType) {
            return;
        }
        const worn: Int32Array = com.linkObjType;
        let removed: number = 0;
        for (let s: number = 0; s < worn.length; s++) {
            if (worn[s] > 0 && client.clickEquipmentSlot(s, REMOVE_OPTION)) {
                removed++;
            }
        }
        if (removed === 0) {
            return;
        }
        this.wornPhase = PHASE_PENDING_REOPEN;
        this.wornPhaseAt = ctx.nowMs() + WORN_REOPEN_DELAY_MS;
        console.log(`[qol] bank: unequipped ${removed} worn slot(s), reopening the bank after the game's if_close`);
    }

    /**
     * Find the nearest thing that opens the bank: a bank chest/booth within
     * BANK_CHEST_SCAN_RADIUS tiles (OPLOC2 — bank_booth.rs2's oploc2 goes
     * straight to @openbank, skipping the banker dialogue; OPLOC1 falls back
     * when there is no second option), else a banker NPC within
     * BANKER_SCAN_RADIUS tiles (OPNPC3 — banker.rs2's apnpc3 → @openbank).
     */
    private findBankReopenTarget(ctx: QolContext): BankTarget | null {
        const client = ctx.client;
        const world: any = client.world;
        const local = ctx.localPlayer();
        if (!world || !local) {
            return null;
        }
        const baseX: number = client.mapBuildBaseX;
        const baseZ: number = client.mapBuildBaseZ;
        const centerX: number = local.x >> 7;
        const centerZ: number = local.z >> 7;

        let best: BankTarget | null = null;
        let bestDist: number = Infinity;
        for (let dz: number = -BANK_CHEST_SCAN_RADIUS; dz <= BANK_CHEST_SCAN_RADIUS; dz++) {
            for (let dx: number = -BANK_CHEST_SCAN_RADIUS; dx <= BANK_CHEST_SCAN_RADIUS; dx++) {
                const tx: number = centerX + dx;
                const tz: number = centerZ + dz;
                const sprite = world.getScene(local.level, tx, tz);
                if (!sprite) {
                    continue;
                }
                const locId: number = (sprite.typecode >> 14) & 0x7fff;
                let loc: LocType | undefined;
                try {
                    loc = LocType.list(locId);
                } catch {
                    continue;
                }
                if (!loc || !loc.name || !/bank (booth|chest)/i.test(loc.name)) {
                    continue;
                }
                if (!loc.op) {
                    continue;
                }
                const opIndex: number = loc.op[1] ? 2 : loc.op[0] ? 1 : 0;
                if (opIndex === 0) {
                    continue;
                }
                const dist: number = dx * dx + dz * dz;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { kind: 'loc', worldX: baseX + tx, worldZ: baseZ + tz, id: locId, opIndex };
                }
            }
        }
        if (best) {
            return best;
        }

        // Fallback: a banker NPC standing near (banks that are teller-only).
        for (const entry of ctx.npcs()) {
            const name: string | null = entry.npc.type?.name ?? null;
            if (!name || !/banker/i.test(name)) {
                continue;
            }
            const dx: number = (entry.npc.x >> 7) - centerX;
            const dz: number = (entry.npc.z >> 7) - centerZ;
            const dist: number = dx * dx + dz * dz;
            if (dist <= BANKER_SCAN_RADIUS * BANKER_SCAN_RADIUS && dist < bestDist) {
                bestDist = dist;
                best = { kind: 'npc', worldX: 0, worldZ: 0, id: entry.index, opIndex: 3 };
            }
        }
        return best;
    }

    /** Fire the deposit burst once the reopen window elapses. */
    private tick(ctx: QolContext): void {
        if (this.wornPhase === PHASE_PENDING_REOPEN) {
            if (ctx.nowMs() < this.wornPhaseAt) {
                return;
            }
            this.wornPhaseAt = 0;
            // Edge: the bank never closed (if_close is unconditional, so this
            // should not happen) — the items are in the inventory, just deposit.
            if (!ctx.isBankOpen()) {
                const target = this.findBankReopenTarget(ctx);
                if (!target) {
                    console.log('[qol] bank: no bank chest/booth or banker nearby to reopen — the unequipped items are in your inventory');
                    this.wornPhase = PHASE_IDLE;
                    return;
                }
                const result =
                    target.kind === 'loc'
                        ? ctx.client.interactLoc(target.worldX, target.worldZ, target.id, target.opIndex)
                        : ctx.client.interactNpc(target.id, target.opIndex);
                if (!result || result.success !== true) {
                    console.log(`[qol] bank: reopen interact failed (${result?.reason ?? 'unknown'}) — the unequipped items are in your inventory`);
                    this.wornPhase = PHASE_IDLE;
                    return;
                }
                console.log(`[qol] bank: reopening the bank via ${target.kind} ${target.id} (op ${target.opIndex})`);
            }
            this.wornPhase = PHASE_AWAITING_BANK;
            this.wornPhaseAt = ctx.nowMs() + WORN_REOPEN_TIMEOUT_MS;
            this.bankOpenedAt = 0;
            return;
        }

        if (this.wornPhase === PHASE_AWAITING_BANK) {
            if (ctx.isBankOpen()) {
                if (this.bankOpenedAt === 0) {
                    this.bankOpenedAt = ctx.nowMs();
                }
                if (ctx.nowMs() - this.bankOpenedAt >= WORN_DEPOSIT_DELAY_MS) {
                    this.depositInventory(ctx);
                    this.wornPhase = PHASE_IDLE;
                    this.bankOpenedAt = 0;
                }
            } else if (ctx.nowMs() >= this.wornPhaseAt) {
                console.log('[qol] bank: the bank did not reopen in time — the unequipped items are in your inventory');
                this.wornPhase = PHASE_IDLE;
            }
        }
    }

    // ---- click ----

    private click(e: QolClickEvent, ctx: QolContext): boolean {
        if (!this.enabled || !ctx.ingame() || !ctx.isBankOpen() || e.button !== 1) {
            return false;
        }
        // Click coords are full-frame; button rects are viewport-local.
        const x: number = e.x - 4;
        const y: number = e.y - 4;
        for (let i: number = 0; i < this.rects.length; i++) {
            const r: BtnRect = this.rects[i];
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                if (r.which === 0) {
                    this.depositInventory(ctx);
                } else {
                    this.depositWorn(ctx);
                }
                return true;
            }
        }
        return false;
    }

    // ---- drawing ----

    private drawTop(g: QolGraphics, ctx: QolContext): void {
        this.rects.length = 0;
        if (!this.enabled || !ctx.ingame() || !ctx.isBankOpen()) {
            return;
        }

        const win: IfType | undefined = IfType.list[BANK_WINDOW_ID];
        if (!win || win.hide) {
            return;
        }
        if (this.winOffset === null) {
            this.winOffset = this.resolveWindowOffset();
            if (!this.winOffset) {
                return;
            }
        }

        const font = ctx.fonts().p11;
        if (!font) {
            return;
        }

        const winX: number = this.winOffset.x + win.x;
        const winY: number = this.winOffset.y + win.y;

        let x: number = winX + BTN_ROW_DX;
        const y: number = winY + BTN_ROW_DY;
        for (let i: number = 0; i < LABELS.length; i++) {
            const w: number = g.textWidth(font, LABELS[i]) + BTN_PAD_X * 2;
            this.rects.push({ x, y, w, h: BTN_H, which: i as 0 | 1 });
            g.fillRect(x, y, w, BTN_H, COL_BTN_BG);
            g.drawRect(x, y, w, BTN_H, COL_BTN_BORDER);
            g.text(font, LABELS[i], x + BTN_PAD_X, y + 2, COL_BTN_TEXT, false);
            x += w + BTN_GAP;
        }
    }
}

export default {
    name: 'BankDeposit',
    register(ctx: QolContext): void {
        new BankDepositPlugin().register(ctx);
    }
};

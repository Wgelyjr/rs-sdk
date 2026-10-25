// Opponent HP bars (F11) + stat boost/drain timers (F12) + HP/Prayer orbs (F14)
// — chunk C7 of docs/qol-features-plan.md §4. Hooks: `tick` (stat-change
// timing), `drawScene` (npc head bars via the vanilla overlay projection),
// `drawTop` (opponent strip, timer rows, orbs; every orb position lives inside
// the 512x334 scene buffer — the old 'Minimap Left' canvas-tile variant was
// removed: its one-time background capture baked wrong pixels and misplaced
// the orbs on the frame strip).
//
// Detection notes (code is truth, Client.ts rev 289):
//  - NPC HP arrives with the HITMARK/HITMARK2 extended-update masks, which set
//    `health`/`totalHealth` and push `combatCycle` to `loopCycle + 400`; the
//    vanilla overhead bar draws while `combatCycle > loopCycle + 100`.
//  - The client does NOT persistently store the NPC you attacked: `doAction`
//    (OP_NPC1..5 / TGT_NPC) reads `menuParamA` and discards it. The qol `click`
//    hook fires at the top of `mouseLoop()` while the menu arrays are still
//    intact, so we decode the hovered entry ourselves (same hit-test math as
//    `mouseLoop`) and remember the npc index — see `myTarget*` below.
//  - Second interacting signal: while a npc fights us the server sends
//    NpcUpdate.FACEENTITY = 32768 + our network slot (`selfSlot`), so a
//    combat-cycle npc facing us counts as our opponent even if we never
//    clicked it (aggro'd by a third party, spell ticks, etc.).
//  - Side tabs: `Client.setTab(n)` performs exactly the iconLoop() state
//    change (`activeIcon`/`redrawSide`/`redrawIcons`, no packet). Tab ids from
//    server content/scripts/general/configs/tabs.constant: 0 = combat, 5 =
//    prayer.

import Pix2D from '#/graphics/Pix2D.js';
import Skill from '#/client/Skill.js';
import { MiniMenuAction } from '#/client/MiniMenuAction.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type { QolDomWidget } from '#/client/qol/QolDom.js';
import type { QolClickEvent } from '#/client/qol/QolHooks.js';
import type QolGraphics from '#/client/qol/QolGraphics.js';

// ---- cached setting domains ----
const HP_OFF: number = 0;
const HP_BAR: number = 1;
const HP_EXACT: number = 2;
const SCOPE_COMBAT: number = 0;
const SCOPE_INTERACTING: number = 1;
const SCOPE_ALL: number = 2;
const ORB_OFF: number = 0;
const ORB_DISCS: number = 1;
const ORB_BARS: number = 2;
const POS_CANVAS: number = 3; // overlay.orbPos: 'Minimap Left' (outside the scene buffer)

// ---- colours (client-adjacent palette) ----
const COL_GREEN: number = 0x00ff00;
const COL_RED: number = 0xff0000;
const COL_WHITE: number = 0xffffff;
const COL_GREY: number = 0x9b9b9b;
const COL_WARN: number = 0xff9040;
const COL_PANEL: number = 0x1c1a17;
const COL_BORDER: number = 0x4d4233;
const COL_ORB_RING: number = 0x0d0b09;
const COL_ORB_BACK: number = 0x282320;
const COL_HP_FILL: number = 0xcc2020;
const COL_PR_FILL: number = 0xd8e6ff;

/** Server stat-regen / boost-restore period: 100 cycles at 0.6 s (login.rs2:35). */
const DEFAULT_INTERVAL_MS: number = 60_000;
/** Rapid Restore shortens regen to 50 cycles; calibrate per-skill inside this window. */
const CALIB_MIN_MS: number = 20_000;
const CALIB_MAX_MS: number = 120_000;

/** Hitmark combatCycle horizon (Client.ts: `npc.combatCycle = loopCycle + 400`). */
const TARGET_WINDOW_CYCLES: number = 400;
/** faceEntity encodes a player index above this bias (Client.entityFace). */
const PLAYER_FACE_BIAS: number = 32768;

/** 'Right Edge' orb anchor: vertical stack hugging the viewport's right edge
 *  (visually beside the minimap/menu column, but inside the scene buffer so
 *  it needs no canvas-tile hack). */
const RIGHT_EDGE_MARGIN: number = 5;

/** One skill row in the stat-timer list (reused buffers — see `buildTimerRows`). */
interface TimerRow {
    skill: number;
    remainingMs: number;
}

/**
 * F11/F12/F14 overlay plugin. Instance state lives in the closure of
 * `register`; all per-frame paths are allocation-free except the small strings
 * of the ≤ 20 UI rows actually drawn (the npc bar loop builds none of them).
 */
class InfoOverlaysPlugin {
    // ---- cached settings (refreshed on change, never read per frame) ----
    private npcHpMode: number = HP_EXACT;
    private npcHpScope: number = SCOPE_COMBAT;
    private statTimersOn: boolean = true;
    private statTimerPos: number = 0; // 0 TL, 1 TR, 2 BL, 3 BR
    private orbMode: number = ORB_OFF;
    private orbPos: number = 0; // 0 Viewport TL, 1 TR, 2 BL, 3 Right Edge
    private orbNumbers: boolean = true;

    // ---- F11 click-derived opponent ----
    /** npc index of the last Attack/cast-on click, -1 when none. */
    private myTargetIndex: number = -1;
    /** loopCycle until which `myTargetIndex` counts as our opponent. */
    private myTargetUntil: number = 0;

    // ---- F12 stat-change bookkeeping ----
    private readonly cachedLevel: Int32Array = new Int32Array(Skill.count).fill(-1);
    private readonly lastChangeMs: Float64Array = new Float64Array(Skill.count);
    private readonly lastDirection: Int32Array = new Int32Array(Skill.count);
    private readonly intervalMs: Int32Array = new Int32Array(Skill.count).fill(DEFAULT_INTERVAL_MS);
    /** Display names ('hitpoints' → 'Hitpoints'), built lazily per skill. */
    private readonly skillLabel: (string | null)[] = new Array<string | null>(Skill.count).fill(null);
    private wasIngame: boolean = false;
    /** Reused row buffers (max 25 skills, realistically a handful). */
    private readonly rows: TimerRow[] = InfoOverlaysPlugin.makeRows();
    private rowCount: number = 0;

    private static makeRows(): TimerRow[] {
        const rows: TimerRow[] = [];
        for (let i: number = 0; i < Skill.count; i++) {
            rows.push({ skill: 0, remainingMs: 0 });
        }
        return rows;
    }

    // ---- F14 orb layout ----
    /** Reused layout rect, viewport-local (scene buffer) coordinates. */
    private readonly orbRect = { x: 0, y: 0, w: 0, h: 0, canvas: false };

    // ---- DOM docks ----
    private orbWidget: QolDomWidget | null = null;
    private timerWidget: QolDomWidget | null = null;
    private orbFillEls: (HTMLDivElement | null)[] = [null, null];
    private orbNumEls: (HTMLDivElement | null)[] = [null, null];
    private lastOrbHp: number = -1;
    private lastOrbPr: number = -1;
    private nextDomMs: number = 0;

    private ctx!: QolContext;

    register(ctx: QolContext): void {
        this.ctx = ctx;
        const config = ctx.config;

        config.define({
            key: 'overlay.npcHpMode',
            section: 'Overlays',
            label: 'NPC health',
            type: 'choice',
            default: 'Exact',
            choices: ['Off', 'Bar', 'Exact'],
            tooltip: 'Health bar over damaged NPCs; Exact also prints cur/max above the bar.'
        });
        config.define({
            key: 'overlay.npcHpScope',
            section: 'Overlays',
            label: 'NPC health scope',
            type: 'choice',
            default: 'Combat',
            choices: ['Combat', 'Interacting', 'All'],
            tooltip:
                'Combat: recently-hit NPCs. Interacting: only your opponent (last attacked/attacking you). ' +
                'All: every NPC whose HP the client has received — HP is only known after the first damage.'
        });
        config.define({
            key: 'overlay.statTimers',
            section: 'Overlays',
            label: 'Stat boost/drain timers',
            type: 'boolean',
            default: true,
            tooltip: 'Countdown to the next regen/boost-restore tick for boosted or drained skills (self-calibrating).'
        });
        config.define({
            key: 'overlay.statTimerPos',
            section: 'Overlays',
            label: 'Stat timers position',
            type: 'choice',
            default: 'Top Left',
            choices: ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right']
        });
        config.define({
            key: 'overlay.orbMode',
            section: 'Overlays',
            label: 'HP/Prayer orbs',
            type: 'choice',
            default: 'Off',
            choices: ['Off', 'Orbs', 'Bars'],
            tooltip: 'Click the HP orb to open the Combat tab, the Prayer orb to open the Prayer tab.'
        });
        config.define({
            key: 'overlay.orbPos',
            section: 'Overlays',
            label: 'Orb position',
            type: 'choice',
            default: 'Viewport TL',
            choices: ['Viewport TL', 'Viewport TR', 'Viewport BL', 'Right Edge'],
            tooltip: 'Where the HP/Prayer orbs sit inside the game viewport. Right Edge stacks them beside the minimap column.'
        });
        config.define({
            key: 'overlay.orbNumbers',
            section: 'Overlays',
            label: 'Orb numbers',
            type: 'boolean',
            default: true
        });

        const sync = (): void => this.syncSettings();
        for (const key of ['overlay.npcHpMode', 'overlay.npcHpScope', 'overlay.statTimers', 'overlay.statTimerPos', 'overlay.orbMode', 'overlay.orbPos', 'overlay.orbNumbers']) {
            config.onChange(key, sync);
        }
        this.syncSettings();

        ctx.hooks.onTick((dtMs: number): void => this.tick(dtMs), 'info-timers');
        ctx.hooks.onDrawScene((g: QolGraphics): void => this.drawNpcHealth(g), 'info-npc-hp');
        ctx.hooks.onDrawTop((g: QolGraphics): void => this.drawTop(g), 'info-top');

        // Click: observe menu-resolved npc targets (never consumes) and switch
        // side tabs on orb hits (consumes only inside the orb rects, only while
        // orbs are on). Priority 0: the settings panel (10000) still wins.
        ctx.hooks.onClick((e: QolClickEvent): boolean => this.click(e), 'info-click');
    }

    // ---- settings ----

    private syncSettings(): void {
        const config = this.ctx.config;
        this.npcHpMode = this.choiceOf(config.getStr('overlay.npcHpMode'), ['Off', 'Bar', 'Exact'], HP_EXACT);
        this.npcHpScope = this.choiceOf(config.getStr('overlay.npcHpScope'), ['Combat', 'Interacting', 'All'], SCOPE_COMBAT);
        this.statTimersOn = config.getBool('overlay.statTimers');
        this.statTimerPos = this.choiceOf(config.getStr('overlay.statTimerPos'), ['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'], 0);
        this.orbMode = this.choiceOf(config.getStr('overlay.orbMode'), ['Off', 'Orbs', 'Bars'], ORB_OFF);
        this.orbPos = this.choiceOf(config.getStr('overlay.orbPos'), ['Viewport TL', 'Viewport TR', 'Viewport BL', 'Right Edge'], 0);
        this.orbNumbers = config.getBool('overlay.orbNumbers');
        if (this.npcHpMode === HP_OFF) {
            this.myTargetIndex = -1;
        }
    }

    private choiceOf(value: string, choices: string[], fallback: number): number {
        const i: number = choices.indexOf(value);
        return i === -1 ? fallback : i;
    }

    /**
     * Combat NPCs only: a positive vislevel or an 'Attack' right-click op.
     * Tutorial guides, fishing spots, bankers etc. have neither and must never
     * carry HP bars/strips even if hitmark data somehow arrives.
     */
    private isAttackable(npc: any): boolean {
        const type = npc.type;
        if (!type) {
            return false;
        }
        if (type.vislevel > 0) {
            return true;
        }
        const ops: (string | null)[] | null = type.op;
        if (ops) {
            for (let i: number = 0; i < ops.length; i++) {
                const op: string | null = ops[i];
                if (op !== null && op.toLowerCase().indexOf('attack') !== -1) {
                    return true;
                }
            }
        }
        return false;
    }

    // ---- F12 tick: observe effective-level changes ----

    /**
     * Compare `statLevel` against the per-skill cache. Any change records the
     * timestamp + direction; consecutive same-direction ±1 changes inside the
     * 20-120 s window refine that skill's interval estimate (rolling 3:1 mean —
     * Rapid Restore's 50-cycle regen self-calibrates to ~30 s, boost restore
     * stays ~60 s since it is unaffected by the prayer).
     */
    private tick(dtMs: number): void {
        const ingame: boolean = this.ctx.ingame();
        if (!ingame) {
            if (this.wasIngame) {
                this.resetTimers();
            }
            this.wasIngame = false;
            this.updateDom(this.ctx.nowMs());
            return;
        }
        if (!this.wasIngame) {
            this.seedLevels();
            this.wasIngame = true;
            return;
        }

        // §7: post-suspend dt can be enormous. Re-seed instead of observing a
        // change through the gap (the reconnect re-sends all stats anyway).
        const dt: number = dtMs > 0 ? dtMs : 0;
        if (dt > CALIB_MAX_MS) {
            this.seedLevels();
            return;
        }

        const now: number = this.ctx.nowMs();
        for (let s: number = 0; s < Skill.count; s++) {
            if (!Skill.used[s]) {
                continue;
            }
            const level: number = this.ctx.statLevel(s);
            const prev: number = this.cachedLevel[s];
            if (prev === level) {
                continue;
            }
            this.cachedLevel[s] = level;
            if (prev === -1) {
                continue; // login-sync arrival, not a timed change
            }

            const delta: number = level - prev;
            const gap: number = this.lastChangeMs[s] > 0 ? now - this.lastChangeMs[s] : -1;
            if (gap >= CALIB_MIN_MS && gap <= CALIB_MAX_MS && Math.abs(delta) === 1 && this.lastDirection[s] === delta) {
                // Consecutive same-direction single steps at a steady cadence.
                this.intervalMs[s] = ((this.intervalMs[s] * 3 + gap) / 4) | 0;
            }
            this.lastDirection[s] = delta > 0 ? 1 : -1;
            this.lastChangeMs[s] = now;
        }

        this.updateDom(now);
    }

    private seedLevels(): void {
        for (let s: number = 0; s < Skill.count; s++) {
            this.cachedLevel[s] = Skill.used[s] ? this.ctx.statLevel(s) : -1;
            this.lastChangeMs[s] = 0;
            this.lastDirection[s] = 0;
            this.intervalMs[s] = DEFAULT_INTERVAL_MS;
        }
    }

    private resetTimers(): void {
        this.cachedLevel.fill(-1);
        this.lastChangeMs.fill(0);
        this.lastDirection.fill(0);
        this.intervalMs.fill(DEFAULT_INTERVAL_MS);
        this.myTargetIndex = -1;
        this.myTargetUntil = 0;
    }

    // ---- F11 drawScene: npc head bars ----

    /**
     * Health data availability: `totalHealth`/`health` arrive with the hitmark
     * masks; `combatCycle = loopCycle + 400` marks them as fresh (the vanilla
     * overhead bar gates on `combatCycle > loopCycle + 100`). Scope All drops
     * the freshness gate and shows every NPC whose HP the client still holds —
     * HP is only known once the NPC has taken damage.
     */
    private drawNpcHealth(g: QolGraphics): void {
        if (this.npcHpMode === HP_OFF || !this.ctx.ingame()) {
            return;
        }
        const ctx = this.ctx;
        const client = ctx.client;
        const loop: number = ctx.loopCycle();
        const selfSlot: number = client.selfSlot;
        const faceMe: number = selfSlot >= 0 ? selfSlot + PLAYER_FACE_BIAS : -1;
        const npcs = ctx.npcs();

        for (let n: number = 0; n < npcs.length; n++) {
            const entry = npcs[n];
            const npc = entry.npc;
            const total: number = npc.totalHealth;
            const hp: number = npc.health;
            if (total <= 0 || hp < 0) {
                continue; // never damaged this session — nothing to show
            }
            if (this.npcHpScope !== SCOPE_ALL && npc.combatCycle <= loop) {
                continue; // stale hitmark data
            }
            if (this.npcHpScope === SCOPE_INTERACTING && entry.index !== this.myTargetIndex && npc.faceEntity !== faceMe) {
                continue;
            }
            if (!npc.isReady()) {
                continue;
            }
            // Never put HP elements on non-attackable NPCs (guides, fishing
            // spots, bankers): no combat level and no Attack op = no bar.
            if (!this.isAttackable(npc)) {
                continue;
            }

            // Same anchor the vanilla combat bar uses (head top, +15 height units).
            client.getOverlayPosEntity(npc, npc.height + 15);
            const px: number = client.projectX;
            if (px <= -1) {
                continue;
            }
            const py: number = client.projectY;
            const ratio: number = Math.min(Math.max(hp / total, 0), 1);
            const w: number = (ratio * 30) | 0;
            g.fillRect(px - 15, py - 3, w, 5, COL_GREEN);
            g.fillRect(px - 15 + w, py - 3, 30 - w, 5, COL_RED);

            if (this.npcHpMode === HP_EXACT) {
                const fonts = ctx.fonts();
                const f = fonts.p11;
                if (f) {
                    const frac: number = Math.min(Math.max(hp, 0), total);
                    // Right of the bar: above/below placements collide with
                    // hitsplats and with bars of NPCs stacked behind this one.
                    g.text(f, frac + '/' + total, px + 18, py + 2, COL_WHITE);
                }
            }
        }
    }

    // ---- drawTop: opponent strip + F12 rows + F14 orbs ----

    private drawTop(g: QolGraphics): void {
        if (!this.ctx.ingame()) {
            return;
        }
        this.drawOpponentStrip(g);
        if (!this.ctx.domDocks()) {
            this.drawStatTimers(g);
            this.drawOrbs(g);
        }
    }

    /**
     * Opponent info strip (F11): the NPC we last attacked — or, if we never
     * clicked one, the fresh-hit NPC facing us — with name + bar + percent at
     * the viewport top-centre.
     */
    private drawOpponentStrip(g: QolGraphics): void {
        if (this.npcHpMode === HP_OFF) {
            return;
        }
        const ctx = this.ctx;
        const client = ctx.client;
        const loop: number = ctx.loopCycle();
        if (this.myTargetIndex >= 0 && loop > this.myTargetUntil) {
            this.myTargetIndex = -1;
        }

        let npc: any = this.myTargetIndex >= 0 ? client.npc[this.myTargetIndex] : null;
        if (!npc || !npc.isReady()) {
            npc = null;
            // Fallback opponent: the freshest NPC whose faceEntity is us.
            const selfSlot: number = client.selfSlot;
            const faceMe: number = selfSlot >= 0 ? selfSlot + PLAYER_FACE_BIAS : -1;
            if (faceMe >= 0) {
                let bestCycle: number = 0;
                const npcs = ctx.npcs();
                for (let n: number = 0; n < npcs.length; n++) {
                    const cand = npcs[n].npc;
                    if (cand.faceEntity === faceMe && cand.combatCycle > loop && cand.combatCycle > bestCycle && this.isAttackable(cand)) {
                        bestCycle = cand.combatCycle;
                        npc = cand;
                    }
                }
            }
        }
        if (!npc) {
            return;
        }

        const fonts = ctx.fonts();
        const name: string = (npc.type && npc.type.name) ? String(npc.type.name) : 'NPC';
        const total: number = npc.totalHealth;
        const hp: number = npc.health;
        const known: boolean = total > 0 && hp >= 0;

        const cx: number = 256; // viewport-local (512-wide scene buffer)
        const top: number = 4;
        const w: number = 150;
        const h: number = 44; // name row + bar row + numbers row, no overlaps
        g.fillRectTrans(cx - w / 2, top, w, h, COL_PANEL, 216);
        g.drawRectTrans(cx - w / 2, top, w, h, COL_BORDER, 230);

        if (fonts.b12) {
            g.centreText(fonts.b12, name, cx, top + 12, COL_WHITE);
        }
        if (known) {
            const ratio: number = Math.min(Math.max(hp / total, 0), 1);
            const barW: number = (ratio * 100) | 0;
            const barY: number = top + 18;
            g.fillRect(cx - 50, barY, barW, 5, COL_GREEN);
            g.fillRect(cx - 50 + barW, barY, 100 - barW, 5, COL_RED);
            if (fonts.p11) {
                const pct: number = Math.round(ratio * 100);
                // Numbers BELOW the bar — never on top of it.
                g.text(fonts.p11, hp + '/' + total, cx - 50, barY + 16, COL_WHITE);
                const pctText: string = pct + '%';
                g.text(fonts.p11, pctText, cx + 50 - g.textWidth(fonts.p11, pctText), barY + 16, pct > 50 ? COL_GREEN : pct > 20 ? COL_WARN : COL_RED);
            }
        } else if (fonts.p11) {
            g.centreText(fonts.p11, 'HP unknown until damaged', cx, top + 32, COL_GREY);
        }
    }

    /**
     * F12 timer rows: one per skill whose effective level differs from base —
     * `Name cur/base (+d/-d) Ns`, blinking red inside the last 5 seconds.
     */
    /** Fill this.rows/this.rowCount from live stat state; returns rowCount. */
    private computeTimerRows(): number {
        const ctx = this.ctx;
        const now: number = ctx.nowMs();
        this.rowCount = 0;
        for (let s: number = 0; s < Skill.count; s++) {
            if (!Skill.used[s] || this.lastChangeMs[s] === 0) {
                continue;
            }
            const level: number = ctx.statLevel(s);
            const base: number = ctx.statBase(s);
            if (level === base || level <= 0) {
                continue;
            }
            let remaining: number = this.intervalMs[s] - (now - this.lastChangeMs[s]);
            if (remaining < 0) {
                remaining = 0;
            }
            const row = this.rows[this.rowCount];
            row.skill = s;
            row.remainingMs = remaining;
            this.rowCount++;
        }
        return this.rowCount;
    }

    /** `Name cur/base (+d/-d) Ns` for a computed row. */
    private timerText(i: number): string {
        const ctx = this.ctx;
        const row = this.rows[i];
        const s: number = row.skill;
        const level: number = ctx.statLevel(s);
        const base: number = ctx.statBase(s);
        const delta: number = level - base;
        return this.label(s) + ' ' + level + '/' + base + ' (' + (delta > 0 ? '+' + delta : delta) + ') ' + Math.ceil(row.remainingMs / 1000) + 's';
    }

    private drawStatTimers(g: QolGraphics): void {
        if (!this.statTimersOn) {
            return;
        }
        if (this.computeTimerRows() === 0) {
            return;
        }
        const fonts = this.ctx.fonts();
        const f = fonts.p11;
        if (!f) {
            return;
        }

        // Backed panel: without it the rows collide with the vanilla menu-hint
        // text ("Walk here") that also lives at the viewport top-left.
        const rowH: number = 12;
        const pad: number = 4;
        let maxW: number = 0;
        for (let i: number = 0; i < this.rowCount; i++) {
            const w: number = g.textWidth(f, this.timerText(i));
            if (w > maxW) {
                maxW = w;
            }
        }
        const panelW: number = maxW + pad * 2;
        const panelH: number = this.rowCount * rowH + pad * 2 - 3;
        const margin: number = 4;
        const px0: number = this.statTimerPos === 1 || this.statTimerPos === 3 ? 512 - margin - panelW : margin;
        const py0: number = this.statTimerPos >= 2 ? 334 - margin - panelH : margin;
        g.fillRectTrans(px0, py0, panelW, panelH, COL_PANEL, 216);
        g.drawRectTrans(px0, py0, panelW, panelH, COL_BORDER, 230);

        const now: number = this.ctx.nowMs();
        const blinkHide: boolean = ((now / 300) | 0) % 2 === 1;
        for (let i: number = 0; i < this.rowCount; i++) {
            const row = this.rows[i];
            if (row.remainingMs <= 5_000 && blinkHide) {
                continue;
            }
            const level: number = this.ctx.statLevel(row.skill);
            const base: number = this.ctx.statBase(row.skill);
            g.text(f, this.timerText(i), px0 + pad, py0 + pad + i * rowH + 8, row.remainingMs <= 5_000 ? COL_RED : level > base ? COL_GREEN : COL_WARN);
        }
    }

    // ---- DOM docks (orbs on the frame beside the minimap; timers panel
    //      floating beside the client when the window is wide enough) ----

    private ensureDom(): void {
        const dom = this.ctx.dom;
        if (dom === null) {
            return;
        }
        if (this.orbWidget === null) {
            this.orbWidget = dom.create(
                '<div class="qol-orbwrap">' +
                    '<div class="qol-orb" data-tab="0"><div class="fill" style="background:#cc2020"></div><div class="num"></div></div>' +
                    '<div class="qol-orb" data-tab="5"><div class="fill" style="background:#d8e6ff"></div><div class="num"></div></div>' +
                    '</div>',
                519, 118, false);
            if (this.orbWidget !== null) {
                const fills = this.orbWidget.el.querySelectorAll('.fill');
                const nums = this.orbWidget.el.querySelectorAll('.num');
                this.orbFillEls = [fills[0] as HTMLDivElement, fills[1] as HTMLDivElement];
                this.orbNumEls = [nums[0] as HTMLDivElement, nums[1] as HTMLDivElement];
                this.orbWidget.el.addEventListener('click', (ev: MouseEvent): void => {
                    const target = ev.target as HTMLElement | null;
                    const orb = target !== null ? target.closest('.qol-orb') : null;
                    const tab = orb !== null ? parseInt(orb.getAttribute('data-tab') ?? '0', 10) : -1;
                    if (tab === 0 || tab === 5) {
                        this.ctx.client.setTab(tab);
                    }
                });
            }
        }
        if (this.timerWidget === null) {
            const anchor = this.timerAnchor();
            this.timerWidget = dom.create('<div class="qol-panel"></div>', anchor.x, anchor.y, true);
        }
    }

    /** Fallback buffer-space anchor for the timers panel when docking outside doesn't fit. */
    private timerAnchor(): { x: number; y: number } {
        if (this.statTimerPos === 1) return { x: 340, y: 5 };
        if (this.statTimerPos === 2) return { x: 5, y: 290 };
        if (this.statTimerPos === 3) return { x: 340, y: 290 };
        return { x: 5, y: 20 };
    }

    /** Refresh DOM widgets (tick cadence, internally throttled). */
    private updateDom(now: number): void {
        const ctx = this.ctx;
        const dom = ctx.dom;
        if (dom === null) {
            return;
        }
        if (!ctx.domDocks()) {
            if (this.orbWidget !== null) dom.show(this.orbWidget, false);
            if (this.timerWidget !== null) dom.show(this.timerWidget, false);
            return;
        }
        this.ensureDom();

        if (this.orbWidget !== null) {
            const on = this.orbMode !== ORB_OFF && ctx.ingame();
            dom.show(this.orbWidget, on);
            if (on) {
                const hp: number = ctx.statLevel(3);
                const hpBase: number = ctx.statBase(3);
                const pr: number = ctx.statLevel(5);
                const prBase: number = ctx.statBase(5);
                if (hp !== this.lastOrbHp && this.orbFillEls[0] !== null && this.orbNumEls[0] !== null) {
                    this.lastOrbHp = hp;
                    this.orbFillEls[0].style.height = Math.round(Math.min(Math.max(hpBase > 0 ? hp / hpBase : 0, 0), 1) * 100) + '%';
                    this.orbNumEls[0].textContent = String(hp);
                }
                if (pr !== this.lastOrbPr && this.orbFillEls[1] !== null && this.orbNumEls[1] !== null) {
                    this.lastOrbPr = pr;
                    this.orbFillEls[1].style.height = Math.round(Math.min(Math.max(prBase > 0 ? pr / prBase : 0, 0), 1) * 100) + '%';
                    this.orbNumEls[1].textContent = String(pr);
                }
            }
        }

        if (this.timerWidget !== null) {
            const on = this.statTimersOn && ctx.ingame() && this.computeTimerRows() > 0;
            dom.show(this.timerWidget, on);
            if (on && now >= this.nextDomMs) {
                this.nextDomMs = now + 250;
                let html = '<div class="qol-h"><span>Stat timers</span></div>';
                for (let i = 0; i < this.rowCount; i++) {
                    const row = this.rows[i];
                    const level: number = ctx.statLevel(row.skill);
                    const base: number = ctx.statBase(row.skill);
                    const delta: number = level - base;
                    const cls: string = row.remainingMs <= 5_000 ? 'qol-red' : delta > 0 ? 'qol-grn' : 'qol-yel';
                    html += '<div class="qol-row"><span>' + this.label(row.skill) + ' ' + level + '/' + base +
                        ' <span class="' + cls + '">(' + (delta > 0 ? '+' + delta : delta) + ')</span></span>' +
                        '<span class="' + cls + '">' + Math.ceil(row.remainingMs / 1000) + 's</span></div>';
                }
                this.timerWidget.el.innerHTML = '<div class="qol-panel">' + html + '</div>';
            }
        }
    }

    /** Capitalized display name for a skill index, cached per skill. */
    private label(skill: number): string {
        let label = this.skillLabel[skill];
        if (label === null) {
            const raw = this.ctx.skillName(skill);
            label = raw.length > 0 ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'stat' + skill;
            this.skillLabel[skill] = label;
        }
        return label;
    }

    // ---- F14 orbs ----

    /** Compute the current orb block rect (viewport-local, or full-frame for the canvas tile). */
    private layoutOrbs(): { x: number; y: number; w: number; h: number; canvas: boolean } {
        const rect = this.orbRect;
        rect.canvas = false;
        if (this.orbMode === ORB_DISCS) {
            if (this.orbPos === POS_CANVAS) {
                // Vertical disc stack at the viewport's right edge.
                rect.w = 26;
                rect.h = 56;
            } else {
                rect.w = 56; // two 26px discs side by side + gap
                rect.h = 26;
            }
        } else {
            if (this.orbPos === POS_CANVAS) {
                rect.w = 96;
                rect.h = 44; // two stacked bars + gap
            } else {
                rect.w = 96;
                rect.h = 24;
            }
        }
        const m: number = 5;
        if (this.orbPos === POS_CANVAS) {
            rect.x = 512 - m - rect.w;
            rect.y = m;
        } else {
            rect.x = this.orbPos === 1 ? 512 - m - rect.w : m;
            rect.y = this.orbPos === 2 ? 334 - m - rect.h : m;
        }
        return rect;
    }

    private drawOrbs(g: QolGraphics): void {
        if (this.orbMode === ORB_OFF) {
            return;
        }
        const rect = this.layoutOrbs();
        const ctx = this.ctx;
        const hp = ctx.statLevel(3); // Skill.names: hitpoints
        const hpBase = ctx.statBase(3);
        const prayer = ctx.statLevel(5); // Skill.names: prayer
        const prayerBase = ctx.statBase(5);

        if (this.orbMode === ORB_DISCS) {
            // Right Edge stacks the discs vertically; other positions side by side.
            const dx: number = this.orbPos === POS_CANVAS ? 0 : 30;
            const dy: number = this.orbPos === POS_CANVAS ? 30 : 0;
            this.drawDiscOrb(rect.x + 13, rect.y + 13, 10, hp / (hpBase > 0 ? hpBase : 1), COL_HP_FILL);
            this.drawDiscOrb(rect.x + 13 + dx, rect.y + 13 + dy, 10, prayer / (prayerBase > 0 ? prayerBase : 1), COL_PR_FILL);
            if (this.orbNumbers) {
                const f = ctx.fonts().p11;
                if (f) {
                    g.centreText(f, String(hp), rect.x + 13, rect.y + 17, COL_WHITE);
                    g.centreText(f, String(prayer), rect.x + 13 + dx, rect.y + 17 + dy, COL_WHITE);
                }
            }
        } else {
            this.drawBarOrb(g, rect.x, rect.y + 2, hp, hpBase, COL_HP_FILL, 'HP');
            this.drawBarOrb(g, rect.x, rect.y + 16, prayer, prayerBase, COL_PR_FILL, 'Pr');
        }
    }

    /** One circular gauge: dark ring + backing + bottom-clipped colour fill (RS3-style). */
    private drawDiscOrb(cx: number, cy: number, r: number, ratio: number, rgb: number): void {
        const clamped: number = Math.min(Math.max(ratio, 0), 1);
        this.disc(cx, cy, r + 2, COL_ORB_RING, 256, cy - r - 2, cy + r + 2);
        this.disc(cx, cy, r, COL_ORB_BACK, 256, cy - r, cy + r);
        const fillHeight: number = Math.round(2 * r * clamped);
        if (fillHeight > 0) {
            this.disc(cx, cy, r, rgb, 256, cy + r - fillHeight, cy + r);
        }
    }

    /** Compact horizontal bar: dark track, proportional fill, numbers centred. */
    private drawBarOrb(g: QolGraphics, x: number, y: number, value: number, base: number, rgb: number, label: string): void {
        const w: number = 96;
        const h: number = 10;
        g.fillRect(x, y, w, h, COL_ORB_BACK);
        g.drawRect(x, y, w, h, COL_ORB_RING);
        const clamped: number = Math.min(Math.max(base > 0 ? value / base : 0, 0), 1);
        const fillW: number = ((w - 2) * clamped) | 0;
        g.fillRect(x + 1, y + 1, fillW, h - 2, rgb);
        const f = this.ctx.fonts().p11;
        if (f) {
            g.text(f, label, x + 3, y + h - 1, COL_WHITE);
            if (this.orbNumbers) {
                const text: string = value === base ? String(value) : value + '/' + base;
                g.centreText(f, text, x + w / 2 + 6, y + h - 1, COL_WHITE);
            }
        }
    }

    /**
     * Scanline disc fill honouring the live Pix2D clip (Pix2D.fillCircle writes
     * unclipped, so a clipped gauge fill cannot use it). `yTop`/`yBot` bound the
     * drawn band — the gauge fill is the band's lower `2*r*frac` pixels.
     */
    private disc(cx: number, cy: number, r: number, rgb: number, alpha: number, yTop: number, yBot: number): void {
        const pixels: Int32Array = Pix2D.pixels;
        const width: number = Pix2D.width;
        let y0: number = Math.max(cy - r, Math.ceil(yTop), Pix2D.clipMinY);
        let y1: number = Math.min(cy + r, Math.floor(yBot), Pix2D.clipMaxY - 1);
        if (y1 < y0) {
            return;
        }
        const blend: boolean = alpha < 256;
        const inv: number = 256 - alpha;
        const r0: number = ((rgb >> 16) & 0xff) * alpha;
        const g0: number = ((rgb >> 8) & 0xff) * alpha;
        const b0: number = (rgb & 0xff) * alpha;
        for (let y: number = y0; y <= y1; y++) {
            const dy: number = y - cy;
            const rr: number = r * r - dy * dy;
            if (rr < 0) {
                continue;
            }
            const xr: number = Math.sqrt(rr) | 0;
            let xs: number = Math.max(cx - xr, Pix2D.clipMinX);
            let xe: number = Math.min(cx + xr, Pix2D.clipMaxX - 1);
            let off: number = xs + y * width;
            for (let x: number = xs; x <= xe; x++, off++) {
                if (!blend) {
                    pixels[off] = rgb;
                    continue;
                }
                const dst: number = pixels[off];
                pixels[off] =
                    ((((r0 + (((dst >> 16) & 0xff) * inv)) >> 8) << 16) & 0xff0000) |
                    ((((g0 + (((dst >> 8) & 0xff) * inv)) >> 8) << 8) & 0xff00) |
                    (((b0 + (dst & 0xff) * inv)) >> 8) & 0xff;
            }
        }
    }

    // ---- click handling ----

    /**
     * Orb clicks: left click on a disc/bar switches the side tab via
     * `Client.setTab` (HP→Combat 0, Prayer→Prayer 5 — exactly the iconLoop()
     * state change, no packet). All other clicks merely OBSERVE the resolved
     * menu entry for F11 target tracking and return false.
     */
    private click(e: QolClickEvent): boolean {
        if (e.button !== 1 || !this.ctx.ingame()) {
            return false;
        }

        if (this.orbMode !== ORB_OFF && !this.ctx.domDocks()) {
            const rect = this.layoutOrbs();
            const px: number = e.x - 4; // scene buffer sits at (4,4)
            const py: number = e.y - 4;
            if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) {
                const discIndex: number = this.hitOrb(rect, px - rect.x, py - rect.y);
                if (discIndex !== -1) {
                    this.ctx.client.setTab(discIndex === 0 ? 0 : 5);
                    return true;
                }
            }
        }

        this.trackNpcTarget(e);
        return false;
    }

    /** Which orb of the block contains the point: 0 = HP, 1 = Prayer, -1 = neither. */
    private hitOrb(rect: { x: number; y: number; w: number; h: number; canvas: boolean }, x: number, y: number): number {
        if (this.orbMode === ORB_DISCS) {
            if (this.orbPos === POS_CANVAS) {
                return y < rect.h / 2 ? 0 : 1; // vertical stack
            }
            return x < rect.w / 2 ? 0 : 1;
        }
        return y < rect.h / 2 ? 0 : 1;
    }

    /**
     * F11 opponent tracking: at this point in `mouseLoop()` the menu arrays
     * still hold the hovered entity (doAction runs after us, on the same
     * click). Reuse mouseLoop's own hit-test to resolve the option, then note
     * OP_NPC1..5 / TGT_NPC (attack / cast-on) targets. Never consumes.
     */
    private trackNpcTarget(e: QolClickEvent): void {
        const client = this.ctx.client;
        let option: number = -1;
        if (client.isMenuOpen) {
            if (client.menuArea !== 0) {
                return;
            }
            const clickX: number = e.x - 4;
            const clickY: number = e.y - 4;
            const count: number = client.menuNumEntries;
            for (let i: number = 0; i < count; i++) {
                const optionY: number = client.menuY + (count - 1 - i) * 15 + 31;
                if (clickX > client.menuX && clickX < client.menuX + client.menuWidth && clickY > optionY - 13 && clickY < optionY + 3) {
                    option = i;
                }
            }
            if (option === -1) {
                return; // click outside the open menu: no action follows
            }
        } else if (client.menuNumEntries > 0) {
            option = client.menuNumEntries - 1; // left-click = top entry
        } else {
            return;
        }

        let action: number = client.menuAction[option];
        if (action >= MiniMenuAction._PRIORITY) {
            action -= MiniMenuAction._PRIORITY;
        }
        if (
            action === MiniMenuAction.OP_NPC1 ||
            action === MiniMenuAction.OP_NPC2 ||
            action === MiniMenuAction.OP_NPC3 ||
            action === MiniMenuAction.OP_NPC4 ||
            action === MiniMenuAction.OP_NPC5 ||
            action === MiniMenuAction.TGT_NPC
        ) {
            this.myTargetIndex = client.menuParamA[option];
            this.myTargetUntil = this.ctx.loopCycle() + TARGET_WINDOW_CYCLES;
        }
    }
}

export default {
    name: 'InfoOverlays',
    register(ctx: QolContext): void {
        new InfoOverlaysPlugin().register(ctx);
    }
};

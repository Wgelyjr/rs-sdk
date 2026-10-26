// F3 XP drops + F4 XP tracker — wave 2, chunk C4 (docs/qol-features-plan.md §4).
//
// XP drops: floating '+N' texts in a right-aligned column at the right edge of
// the 3D viewport (drawScene pass, viewport-local coords). New drops spawn at
// the top and push older ones down; each drop holds its row and expires after
// 2.5s with a stipple fade over its last 300ms (PixFont has no alpha).
//
// XP tracker: session-scoped per-skill panel (drawTop pass) with XP gained,
// XP/hour and actions/hour over a rolling 5-minute window (session-rate
// fallback while the window holds <30s of data), XP to level and time-to-level
// at the current rate. Collapsible via a header click. The session resets on
// the ingame true→false transition (logout/kick).
//
// Level thresholds use the standard 1-98 RuneScape experience table embedded
// below — Client.ts is NOT imported (it owns this plugin through the qol
// registry; importing it back would be circular).
//
// xpGain gating: the login burst replays every skill as 0 → stored XP, so
// drops/tracker entries require oldXp > 0 && newXp > oldXp.

import type { QolContext } from '#/client/qol/QolContext.js';
import type { QolDomWidget } from '#/client/qol/QolDom.js';
import type { QolGraphics } from '#/client/qol/QolGraphics.js';
import type { QolClickEvent, QolXpGainEvent } from '#/client/qol/QolHooks.js';
import type PixFont from '#/graphics/PixFont.js';

/**
 * Canonical RS experience table: XP_FOR_LEVEL[level] = total XP at that level.
 * Indices 0/1 are padding (level 1 = 0 XP); valid through level 99.
 */
const XP_FOR_LEVEL: number[] = [
    0, 0, 83, 174, 276, 388, 512, 650, 801, 969, 1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
    4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031, 13363, 14833, 16456, 18247, 20224, 22406,
    24815, 27473, 30408, 33648, 37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721, 101333,
    111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886, 273742, 302288, 333804, 368599,
    407015, 449428, 496254, 547953, 605032, 668051, 737627, 814445, 899257, 992895, 1096278, 1210421, 1336443,
    1475581, 1629200, 1798808, 1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776,
    4842295, 5346332, 5902831, 6517253, 7195629, 7944612, 8771558, 9684577, 10692629, 11805606, 13034431
];

/** Max simultaneous floating drops; the oldest is recycled past that. */
const MAX_DROPS: number = 12;

/** Drop lifetime (ms) and the fade window at its end. */
const DROP_LIFE_MS: number = 2500;
const DROP_FADE_MS: number = 300;

/**
 * Drop rise speed in px/s — 0. Raising drops between spawns let them drift
 * above their row, so a spawn's one-row push left adjacent drops closer than
 * the text height (visible stacking). Drops now hold their row until expiry.
 */
const DROP_RISE_PX_S: number = 0;

/** Right-aligned column: text ends here (viewport is 512 wide). */
const DROP_RIGHT_X: number = 505;
const DROP_FIRST_Y: number = 30;

/** Rolling rate window and the minimum span before it is trusted over the session rate. */
const RATE_WINDOW_MS: number = 5 * 60 * 1000;
const RATE_MIN_SPAN_MS: number = 30 * 1000;

/** Tracker geometry (p11 rows). */
const TRACKER_W: number = 172;
const TRACKER_HEADER_H: number = 16;
const TRACKER_ROW_H: number = 24; // two text lines per skill
const TRACKER_MAX_ROWS: number = 8;
const TRACKER_MARGIN: number = 6;

/** Tracker chrome colors (2004 palette-adjacent). */
const COL_BG: number = 0x000000;
const COL_BG_ALPHA: number = 160;
const COL_BORDER: number = 0x5d5447;
const COL_HEADER: number = 0xffb000;
const COL_NAME: number = 0xffffff;
const COL_GAIN: number = 0xffff00;
const COL_RATE: number = 0x00ffff;
const COL_TTL: number = 0xc0c0c0;
const COL_BOOSTED: number = 0x00ff00;
const COL_DRAINED: number = 0xff4040;
const COL_BASE: number = 0xff9040;

/** Per-size drop metrics: font key + row height. */
interface DropStyle {
    fontKey: 'p11' | 'p12' | 'b12';
    rowHeight: number;
    textHeight: number;
}

const STYLE_SMALL: DropStyle = { fontKey: 'p11', rowHeight: 13, textHeight: 11 };
const STYLE_MEDIUM: DropStyle = { fontKey: 'p12', rowHeight: 15, textHeight: 13 };
const STYLE_LARGE: DropStyle = { fontKey: 'b12', rowHeight: 18, textHeight: 15 };

/** One floating drop; the pool is preallocated and recycled (zero churn). */
interface XpDrop {
    live: boolean;
    text: string;
    y: number;
    bornMs: number;
    color: number;
    font: PixFont | null;
    textHeight: number;
}

/** One timestamped gain for the rolling rate window. */
interface GainSample {
    t: number;
    xp: number;
}

/** Session aggregation for one skill. */
interface SkillSession {
    skill: number;
    totalXp: number;
    gainCount: number;
    lastGainMs: number;
    samples: GainSample[];
}

/** Compact '12.3k' / '1.50M' formatter (shared by rate and gain columns). */
function formatShort(n: number): string {
    if (n < 1000) {
        return n.toString();
    }
    if (n < 1000000) {
        const k: number = n / 1000;
        return (k >= 100 ? (k | 0).toString() : k.toFixed(1).replace(/\.0$/, '')) + 'k';
    }
    const m: number = n / 1000000;
    return (m >= 100 ? (m | 0).toString() : m.toFixed(2).replace(/\.?0+$/, '')) + 'M';
}

/** 'm:ss' below an hour, 'h:mm:ss' above; '--' for non-finite/negative. */
function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return '--';
    }
    const total: number = (ms / 1000) | 0;
    const h: number = (total / 3600) | 0;
    const m: number = ((total % 3600) / 60) | 0;
    const s: number = total % 60;
    const mm: string = m < 10 ? '0' + m : '' + m;
    const ss: string = s < 10 ? '0' + s : '' + s;
    return h > 0 ? h + ':' + mm + ':' + ss : m + ':' + ss;
}

class XpDropsPlugin {
    private readonly ctx: QolContext;

    // ---- settings cache (synced on change) ----
    private dropsOn: boolean = true;
    private trackerOn: boolean = true;
    private style: DropStyle = STYLE_MEDIUM;
    private dropColor: number = 0xffffff;
    private trackerPos: number = 0; // index into ['Top Right','Top Left','Bottom Right','Bottom Left']

    // ---- drop pool ----
    private readonly drops: XpDrop[] = [];

    // ---- tracker session state ----
    private readonly sessions: SkillSession[] = [];
    private sessionStartMs: number = 0;
    private wasIngame: boolean = false;
    private nextRecomputeMs: number = 0;
    private collapsed: boolean = false;

    /** Recomputed row cache (1Hz), sorted most-recent-gain first. */
    private rows: SkillSession[] = [];
    /** Per-row derived strings, refreshed with the rows (avoids draw-loop allocs). */
    private readonly rowText: Array<{ name: string; gain: string; rate: string; act: string; ttl: string }> = [];

    // ---- DOM dock ----
    private trackerWidget: QolDomWidget | null = null;

    constructor(ctx: QolContext) {
        this.ctx = ctx;

        for (let i = 0; i < MAX_DROPS; i++) {
            this.drops.push({ live: false, text: '', y: 0, bornMs: 0, color: 0xffffff, font: null, textHeight: 12 });
        }
        for (let i = 0; i < TRACKER_MAX_ROWS; i++) {
            this.rowText.push({ name: '', gain: '', rate: '', act: '', ttl: '' });
        }
    }

    register(): void {
        const config = this.ctx.config;

        config.define({
            key: 'skilling.xpDrops',
            section: 'Skilling',
            label: 'XP drops',
            type: 'boolean',
            default: true,
            tooltip: 'Floating +XP numbers at the right edge of the viewport, RuneLite style.'
        });
        config.define({
            key: 'skilling.xpDropSize',
            section: 'Skilling',
            label: 'XP drop size',
            type: 'choice',
            choices: ['Small', 'Medium', 'Large'],
            default: 'Medium',
            tooltip: 'Font size of the floating XP numbers.'
        });
        config.define({
            key: 'skilling.xpDropColor',
            section: 'Skilling',
            label: 'XP drop color',
            type: 'color',
            default: 0xffffff,
            tooltip: 'Color of the floating XP numbers.'
        });
        config.define({
            key: 'skilling.xpTracker',
            section: 'Skilling',
            label: 'XP tracker',
            type: 'boolean',
            default: true,
            tooltip: 'Sidebar panel: session XP, XP/hour and actions/hour (rolling 5-minute window), XP to level and time-to-level. Resets on logout.'
        });
        config.define({
            key: 'skilling.xpTrackerPos',
            section: 'Skilling',
            label: 'XP tracker position',
            type: 'choice',
            choices: ['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left'],
            default: 'Top Right',
            tooltip: 'Viewport corner the tracker panel anchors to. Click its header to collapse.'
        });

        const sync = (): void => this.syncSettings();
        config.onChange('skilling.xpDrops', sync);
        config.onChange('skilling.xpDropSize', sync);
        config.onChange('skilling.xpDropColor', sync);
        config.onChange('skilling.xpTracker', sync);
        config.onChange('skilling.xpTrackerPos', sync);
        this.syncSettings();

        this.ctx.hooks.onXpGain((e: QolXpGainEvent): void => this.xpGain(e), 'xpdrops-gain');
        this.ctx.hooks.onTick((dtMs: number): void => this.tick(dtMs), 'xpdrops-tick');
        this.ctx.hooks.onDrawScene((g: QolGraphics): void => this.drawDrops(g), 'xpdrops-drops');
        this.ctx.hooks.onDrawTop((g: QolGraphics): void => this.drawTracker(g), 'xpdrops-tracker');
        // Header collapse toggle. 5000: below the settings panel (10000).
        this.ctx.hooks.onClick((e: QolClickEvent): boolean => this.click(e), 'xpdrops-collapse', 5000);
    }

    // ---- settings ----

    private syncSettings(): void {
        const config = this.ctx.config;
        this.dropsOn = config.getBool('skilling.xpDrops');
        this.trackerOn = config.getBool('skilling.xpTracker');
        this.dropColor = config.getNum('skilling.xpDropColor');

        const size: string = config.getStr('skilling.xpDropSize');
        this.style = size === 'Small' ? STYLE_SMALL : size === 'Large' ? STYLE_LARGE : STYLE_MEDIUM;

        const pos: number = ['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left'].indexOf(config.getStr('skilling.xpTrackerPos'));
        this.trackerPos = pos === -1 ? 0 : pos;
    }

    // ---- xpGain: spawn a drop + record the session sample ----

    private xpGain(e: QolXpGainEvent): void {
        if (!this.ctx.ingame()) {
            return;
        }
        // Login-burst gate: the first UPDATE_STAT wave replays 0 → stored XP.
        const delta: number = e.newXp - e.oldXp;
        if (delta <= 0 || e.oldXp <= 0) {
            return;
        }

        const now: number = this.ctx.nowMs();

        if (this.dropsOn) {
            this.spawnDrop('+' + delta.toLocaleString('en-US'), now);
        }

        if (this.trackerOn) {
            this.record(e.skill, delta, now);
        }
    }

    private spawnDrop(text: string, now: number): void {
        const fonts = this.ctx.fonts();
        const font: PixFont = fonts[this.style.fontKey];

        // Push every live drop down one row; recycle the oldest when the pool
        // is full or the column would overflow the viewport.
        for (let i = 0; i < this.drops.length; i++) {
            const d: XpDrop = this.drops[i];
            if (d.live) {
                d.y += this.style.rowHeight;
            }
        }

        let slot: XpDrop | null = null;
        let oldest: XpDrop | null = null;
        for (let i = 0; i < this.drops.length; i++) {
            const d: XpDrop = this.drops[i];
            if (!d.live && slot === null) {
                slot = d;
            }
            if (oldest === null || d.bornMs < oldest.bornMs) {
                oldest = d;
            }
        }
        if (slot === null) {
            slot = oldest;
        }
        if (slot === null) {
            return;
        }

        slot.live = true;
        slot.text = text;
        slot.y = DROP_FIRST_Y;
        slot.bornMs = now;
        slot.color = this.dropColor;
        slot.font = font;
        slot.textHeight = this.style.textHeight;
    }

    // ---- tracker session model ----

    private record(skill: number, delta: number, now: number): void {
        let s: SkillSession | null = null;
        for (let i = 0; i < this.sessions.length; i++) {
            if (this.sessions[i].skill === skill) {
                s = this.sessions[i];
                break;
            }
        }
        if (s === null) {
            s = { skill, totalXp: 0, gainCount: 0, lastGainMs: now, samples: [] };
            this.sessions.push(s);
        }
        s.totalXp += delta;
        s.gainCount++;
        s.lastGainMs = now;
        s.samples.push({ t: now, xp: delta });
    }

    private tick(dtMs: number): void {
        const ingame: boolean = this.ctx.ingame();
        if (!ingame) {
            if (this.wasIngame) {
                this.resetSession();
            }
            this.wasIngame = false;
            this.updateTrackerDom();
            return;
        }
        if (!this.wasIngame) {
            this.resetSession();
            this.sessionStartMs = this.ctx.nowMs();
        }
        this.wasIngame = true;

        // Expired drops retire on their own in draw; the tracker recomputes at 1Hz.
        const now: number = this.ctx.nowMs();
        if (dtMs >= 0 && now >= this.nextRecomputeMs) {
            this.nextRecomputeMs = now + 1000;
            this.recompute(now);
        }
    }

    private resetSession(): void {
        this.sessions.length = 0;
        this.rows = [];
        for (let i = 0; i < this.drops.length; i++) {
            this.drops[i].live = false;
        }
    }

    /** Prune the rolling window, pick the 8 most recent skills, build row strings. */
    private recompute(now: number): void {
        // Prune samples outside the window.
        for (let i = this.sessions.length - 1; i >= 0; i--) {
            const s: SkillSession = this.sessions[i];
            const samples: GainSample[] = s.samples;
            let cut = 0;
            while (cut < samples.length && now - samples[cut].t > RATE_WINDOW_MS) {
                cut++;
            }
            if (cut > 0) {
                samples.splice(0, cut);
            }
        }

        // Most recently active first, capped.
        const sorted: SkillSession[] = this.sessions.slice().sort((a, b) => b.lastGainMs - a.lastGainMs);
        this.rows = sorted.slice(0, TRACKER_MAX_ROWS);

        for (let r = 0; r < this.rows.length; r++) {
            const s: SkillSession = this.rows[r];
            const out = this.rowText[r];

            out.name = this.ctx.skillName(s.skill);
            out.gain = '+' + formatShort(s.totalXp);

            // Rolling-window rate; fall back to the session rate on thin data.
            let windowXp = 0;
            let first = now;
            for (let i = 0; i < s.samples.length; i++) {
                windowXp += s.samples[i].xp;
                if (s.samples[i].t < first) {
                    first = s.samples[i].t;
                }
            }
            let span: number = now - first;
            let xpBase: number = windowXp;
            let actBase: number = s.samples.length;
            if (span < RATE_MIN_SPAN_MS) {
                span = now - this.sessionStartMs;
                xpBase = s.totalXp;
                actBase = s.gainCount;
            }

            const xpPerHour: number = span > 0 ? (xpBase / span) * 3600000 : 0;
            out.rate = formatShort(Math.round(xpPerHour)) + '/h';

            const actPerHour: number = span > 0 ? (actBase / span) * 3600000 : 0;
            out.act = formatShort(Math.round(actPerHour)) + '/h';

            // Time-to-level at the current rate.
            const baseLevel: number = this.ctx.statBase(s.skill);
            const curXp: number = this.ctx.statXp(s.skill);
            if (baseLevel >= 99) {
                out.ttl = '99';
            } else {
                const toNext: number = XP_FOR_LEVEL[baseLevel + 1] - curXp;
                out.ttl = xpPerHour > 0 ? formatDuration((toNext / xpPerHour) * 3600000) : '--';
            }
        }

        this.updateTrackerDom();
    }

    /** Mirror the tracker into a DOM dock (beside the client when it fits). */
    private updateTrackerDom(): void {
        const ctx = this.ctx;
        const dom = ctx.dom;
        if (dom === null) {
            return;
        }
        if (!ctx.domDocks() || !this.trackerOn || this.rows.length === 0 || !ctx.ingame()) {
            if (this.trackerWidget !== null) {
                dom.show(this.trackerWidget, false);
            }
            return;
        }
        if (this.trackerWidget === null) {
            const a = this.trackerAnchor();
            // qol: clickable — the container is pointer-events:none, so without
            // this the collapse toggle's click listener never fires.
            this.trackerWidget = dom.create('<div class="qol-panel"></div>', a.x, a.y, true, true);
            if (this.trackerWidget !== null) {
                this.trackerWidget.el.addEventListener('click', (): void => {
                    this.collapsed = !this.collapsed;
                    this.updateTrackerDom();
                });
            }
        }
        if (this.trackerWidget === null) {
            return;
        }
        dom.show(this.trackerWidget, true);

        let html = '<div class="qol-h"><span>XP Tracker</span><span class="qol-dim">' + (this.collapsed ? '[+]' : '[-]') + '</span></div>';
        if (!this.collapsed) {
            for (let r = 0; r < this.rows.length; r++) {
                const s = this.rows[r];
                const t = this.rowText[r];
                const base: number = ctx.statBase(s.skill);
                const eff: number = ctx.statLevel(s.skill);
                const cls: string = eff > base ? 'qol-grn' : eff < base ? 'qol-red' : 'qol-dim';
                const lvl: string = eff === base ? String(base) : eff + '/' + base;
                html += '<div class="qol-row"><span>' + t.name + ' <span class="' + cls + '">' + lvl + '</span></span><span class="qol-yel">' + t.gain + '</span></div>';
                html += '<div class="qol-row"><span class="qol-cyn">' + t.rate + ' &middot; ' + t.act + '</span><span class="qol-dim">' + t.ttl + '</span></div>';
            }
        }
        this.trackerWidget.el.innerHTML = '<div class="qol-panel">' + html + '</div>';
    }

    /** Fallback buffer-space anchor when docking beside the client doesn't fit. */
    private trackerAnchor(): { x: number; y: number } {
        if (this.trackerPos === 1) return { x: 5, y: 5 };
        if (this.trackerPos === 2) return { x: 330, y: 290 };
        if (this.trackerPos === 3) return { x: 5, y: 290 };
        return { x: 330, y: 5 };
    }

    // ---- drawing ----

    private drawDrops(g: QolGraphics): void {
        if (!this.dropsOn || !this.ctx.ingame()) {
            return;
        }
        const now: number = this.ctx.nowMs();
        for (let i = 0; i < this.drops.length; i++) {
            const d: XpDrop = this.drops[i];
            if (!d.live || d.font === null) {
                continue;
            }
            const age: number = now - d.bornMs;
            if (age >= DROP_LIFE_MS) {
                d.live = false;
                continue;
            }

            const rise: number = ((age / 1000) * DROP_RISE_PX_S) | 0;
            const y: number = d.y - rise;
            const x: number = DROP_RIGHT_X - g.textWidth(d.font, d.text);

            g.text(d.font, d.text, x, y, d.color, true);

            // Stipple fade over the last DROP_FADE_MS (PixFont has no alpha).
            if (age >= DROP_LIFE_MS - DROP_FADE_MS) {
                g.fillStipple(x - 1, y - d.textHeight, g.textWidth(d.font, d.text) + 2, d.textHeight + 3, COL_BG);
            }
        }
    }

    /** Header rect in viewport-local coords for the current position setting. */
    private headerRect(): { x: number; y: number; w: number; h: number } {
        const x: number = this.trackerPos === 1 || this.trackerPos === 3 ? TRACKER_MARGIN : 512 - TRACKER_W - TRACKER_MARGIN;
        let y: number;
        if (this.trackerPos < 2) {
            y = TRACKER_MARGIN;
        } else {
            const bodyH: number = this.collapsed ? 0 : this.rows.length * TRACKER_ROW_H + 4;
            y = 334 - TRACKER_MARGIN - TRACKER_HEADER_H - bodyH;
        }
        return { x, y, w: TRACKER_W, h: TRACKER_HEADER_H };
    }

    private drawTracker(g: QolGraphics): void {
        if (this.ctx.domDocks()) {
            return; // the DOM dock owns the tracker
        }
        if (!this.trackerOn || !this.ctx.ingame() || this.rows.length === 0) {
            return;
        }

        const header = this.headerRect();
        const bodyH: number = this.collapsed ? 0 : this.rows.length * TRACKER_ROW_H + 4;
        const totalH: number = TRACKER_HEADER_H + bodyH;

        g.fillRectTrans(header.x, header.y, header.w, totalH, COL_BG, COL_BG_ALPHA);
        g.drawRect(header.x, header.y, header.w, totalH, COL_BORDER);

        const fonts = this.ctx.fonts();
        g.text(fonts.p11, 'XP Tracker', header.x + 4, header.y + 11, COL_HEADER, true);
        g.text(fonts.p11, this.collapsed ? '[+]' : '[-]', header.x + header.w - 20, header.y + 11, COL_HEADER, true);

        if (this.collapsed) {
            return;
        }

        let rowY: number = header.y + TRACKER_HEADER_H + 12;
        for (let r = 0; r < this.rows.length; r++) {
            const s: SkillSession = this.rows[r];
            const t = this.rowText[r];

            // Level with live boost/drain coloring.
            const base: number = this.ctx.statBase(s.skill);
            const eff: number = this.ctx.statLevel(s.skill);
            const lvlColor: number = eff > base ? COL_BOOSTED : eff < base ? COL_DRAINED : COL_BASE;
            const lvl: string = eff === base ? '' + base : eff + '/' + base;

            g.text(fonts.p11, t.name, header.x + 4, rowY, COL_NAME, true);
            g.text(fonts.p11, lvl, header.x + 4 + g.textWidth(fonts.p11, t.name) + 4, rowY, lvlColor, true);
            const gainW: number = g.textWidth(fonts.p11, t.gain);
            g.text(fonts.p11, t.gain, header.x + header.w - 4 - gainW, rowY, COL_GAIN, true);

            g.text(fonts.p11, t.rate, header.x + 4, rowY + 10, COL_RATE, true);
            const actW: number = g.textWidth(fonts.p11, t.act);
            g.text(fonts.p11, t.act, header.x + ((header.w - actW) / 2 | 0), rowY + 10, COL_RATE, true);
            const ttlW: number = g.textWidth(fonts.p11, t.ttl);
            g.text(fonts.p11, t.ttl, header.x + header.w - 4 - ttlW, rowY + 10, COL_TTL, true);

            rowY += TRACKER_ROW_H;
        }
    }

    // ---- input ----

    private click(e: QolClickEvent): boolean {
        if (this.ctx.domDocks()) {
            return false; // collapse lives on the DOM header
        }
        if (!this.trackerOn || !this.ctx.ingame() || this.rows.length === 0 || e.button !== 1) {
            return false;
        }
        const header = this.headerRect();
        // Click coords are full-frame; the tracker lives in viewport-local space.
        const x: number = e.x - 4;
        const y: number = e.y - 4;
        if (x >= header.x && x < header.x + header.w && y >= header.y && y < header.y + header.h) {
            this.collapsed = !this.collapsed;
            return true;
        }
        return false;
    }
}

export default {
    name: 'XpDrops',
    register(ctx: QolContext): void {
        new XpDropsPlugin(ctx).register();
    }
};

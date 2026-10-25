// Opponent HP bars, stat timers, HP/prayer orbs — STUB (wave 2, chunk C7 owns this file).
// Planned hooks: `tick` (stat-change timing), `xpGain`, `drawScene` (bars over
// entities via ctx.projectEntity), `drawTop` (opponent strip, timers, orbs),
// settings keys overlay.npcHp*, overlay.statTimers*, overlay.orb*.

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'InfoOverlays',
    register(_ctx: QolContext): void {
        // C7
    }
};

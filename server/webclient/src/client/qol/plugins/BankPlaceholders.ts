// Bank placeholders (ghost sprites in emptied slots) — STUB (wave 2, chunk C10a owns this file).
// Planned hooks: `tick` (slot snapshot), `drawScene`/`drawTop` (ghosts at vanilla
// grid positions via IfType 5382 geometry), settings key bank.placeholders.

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'BankPlaceholders',
    register(_ctx: QolContext): void {
        // C10a
    }
};

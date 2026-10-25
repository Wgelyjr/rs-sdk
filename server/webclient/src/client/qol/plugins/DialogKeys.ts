// Dialog keyboard support (space/enter continue, digits 1-9 options) — STUB
// (wave 2, chunk C9 owns this file). Planned hooks: `key` consume,
// `drawTop` ([n] prefixes), ctx.getDialogOptions/clickDialogOption,
// settings key skilling.dialogKeys.

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'DialogKeys',
    register(_ctx: QolContext): void {
        // C9
    }
};

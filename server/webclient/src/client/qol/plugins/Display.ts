// Display scaling (stretched mode) + FPS caps — STUB (wave 2, chunk C6 owns this
// file AND GameShell.ts). Planned hooks: `resizeCanvas`, `framePace` map,
// settings keys visual.displayScale, visual.fpsCap.

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'Display',
    register(_ctx: QolContext): void {
        // C6
    }
};

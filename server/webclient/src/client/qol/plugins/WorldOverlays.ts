// Ground item labels, entity hider, tile markers — STUB (wave 2, chunk C8 owns this file).
// Planned hooks: `drawScene` (labels + markers), filter hooks `hidePlayer`,
// `hideNpc`, `hideProjectile`, `hideGroundItem`, `click` (shift+right mark),
// ctx.pickTile, settings keys skilling.groundItems*, visual.hide*, overlay.tileMarkers.

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'WorldOverlays',
    register(_ctx: QolContext): void {
        // C8
    }
};

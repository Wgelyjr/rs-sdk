// Unlocked camera, scroll zoom, middle-drag rotate — STUB (wave 2, chunk C5 owns this file).
// Planned hooks: `wheel` (zoom), `camera` map (distance/pitch + minPitch/maxPitch),
// click/middle state via ctx.client (GameShell.mouseButton === 3),
// settings keys visual.cameraUnlock, visual.zoomMin/zoomMax, visual.pitchMin/pitchMax,
// visual.wheelInvert, visual.middleDragRotate.

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'CameraUnlock',
    register(_ctx: QolContext): void {
        // C5
    }
};

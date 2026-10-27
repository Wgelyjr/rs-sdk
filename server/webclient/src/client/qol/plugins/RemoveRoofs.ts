// Remove building roofs (QoL plugin, Visuals).
//
// The map already carries a per-tile RemoveRoof flag (MapFlag.RemoveRoof):
// when the camera or player stands on a flagged tile, `roofCheck()`
// (Client.ts) lowers the top render level to the player's level, so
// `world.renderAll()` skips the upper levels — roofs included, and their
// occluders with them. This plugin makes that behavior global: a `roofTop`
// map handler at the same call site returns the player's level for every
// tile, at any camera pitch.
//
// Everything strictly above the current level (upper floors, upper walls,
// roofs) is skipped, so interiors are visible from outside and the renderer
// does less work (a small speed bonus). Cinematic camera frames are left
// untouched — the call site only consults the hook on the normal path.
//
// Default on: the toggle exists so the vanilla roofed look is one click away
// (F10 / gear / `::qol`, Visuals section).

import type { QolContext } from '#/client/qol/QolContext.js';

export default {
    name: 'RemoveRoofs',
    register(ctx: QolContext): void {
        const config = ctx.config;

        config.define({
            key: 'visual.removeRoofs',
            section: 'Visuals',
            label: 'Remove roofs',
            type: 'boolean',
            default: true,
            tooltip: 'Hide everything above the current level — roofs and upper floors — so interiors are visible from outside. The map\'s built-in RemoveRoof behavior, applied to every tile. Also a small render-speed bonus.'
        });

        ctx.hooks.onRoofTop((maxLevel: number): number | null => {
            if (!config.getBool('visual.removeRoofs')) {
                return null;
            }
            const client = ctx.client;
            if (!client.localPlayer) {
                return null;
            }
            return client.minusedlevel < maxLevel ? client.minusedlevel : maxLevel;
        }, 'remove-roofs');
    }
};

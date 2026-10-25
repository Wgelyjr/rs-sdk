// Toggle for the page's bottom control bar — the green link row rendered
// under the canvas by the engine views (`div#controls` in view/*.ejs):
// Auto Sizing | Go Fullscreen | Take screenshot | Map | Hiscores | Market |
// Discord | GitHub | N online.
//
// The bar is static server-rendered HTML, so the toggle is a display state
// on the element itself — no engine view edits, and re-enabling restores it
// untouched. Hiding it strands no QoL feature: display scaling and the FPS
// cap both live in this settings panel (visual.displayScale / visual.fpsCap).
//
// Applied via the settings change bus; a cheap tick catch-up covers the case
// where the element is (re)created after register.

import type { QolContext } from '#/client/qol/QolContext.js';

/** Setting key (Overlays section). */
const KEY: string = 'overlay.bottomBar';

export default {
    name: 'BottomBar',
    register(ctx: QolContext): void {
        ctx.config.define({
            key: KEY,
            section: 'Overlays',
            label: 'Bottom control bar',
            type: 'boolean',
            default: true,
            tooltip: 'Show the green link bar under the game window (Auto Sizing, Go Fullscreen, Take screenshot, Map, Hiscores, ...). Turn off to reclaim the vertical space — display scaling and the FPS cap stay available in this panel.'
        });

        let attached: boolean = false;
        const apply = (): void => {
            if (typeof document === 'undefined') {
                return;
            }
            const el = document.getElementById('controls') as HTMLElement | null;
            if (el === null) {
                return;
            }
            attached = true;
            el.style.display = ctx.config.getBool(KEY) ? '' : 'none';
        };

        ctx.config.onChange(KEY, apply);
        ctx.hooks.onTick((): void => {
            if (!attached) {
                apply();
            }
        });
    }
};

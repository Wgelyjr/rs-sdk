// QoL plugin registry — created by C1 and FROZEN (ground rule 2): later chunks
// edit their own plugin file, never this one. Import order = registration
// order; each register() is isolated so one bad plugin can't take the client
// down (ground rule 4).

import type { QolContext } from '#/client/qol/QolContext.js';

import MenuSwapper from './MenuSwapper.js';
import XpDrops from './XpDrops.js';
import CameraUnlock from './CameraUnlock.js';
import RemoveRoofs from './RemoveRoofs.js';
import Display from './Display.js';
import InfoOverlays from './InfoOverlays.js';
import WorldOverlays from './WorldOverlays.js';
import DialogKeys from './DialogKeys.js';
import BankTabs from './BankTabs.js';
import BankDeposit from './BankDeposit.js';
import BottomBar from './BottomBar.js';
import ShopBulk from './ShopBulk.js';
import MobileBar from './MobileBar.js';

/** Every plugin module: `export default { name, register(ctx) }`. */
export const qolPlugins: ReadonlyArray<{ name: string; register(ctx: QolContext): void }> = [
    MenuSwapper,
    XpDrops,
    CameraUnlock,
    RemoveRoofs,
    Display,
    InfoOverlays,
    WorldOverlays,
    DialogKeys,
    BankTabs,
    BankDeposit,
    BottomBar,
    ShopBulk,
    // Mobile last: its menuBuilt disarm must run after MenuSwapper's promotion
    MobileBar
];

/** Call every plugin's `register(ctx)` with per-plugin error containment. */
export function registerQolPlugins(ctx: QolContext): void {
    for (const plugin of qolPlugins) {
        try {
            plugin.register(ctx);
        } catch (e) {
            console.warn(`[qol] plugin '${plugin.name}' failed to register, skipping`, e);
        }
    }
}

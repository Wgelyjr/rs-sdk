// QoL entry point (docs/qol-features-plan.md §2). `Client.maininit()` calls
// `createQol(this)` once assets are ready; everything else hangs off `Qol`.
// The plugin registry import here guarantees every chunk's plugin file is part
// of the bundle graph — plugins/index.ts is created once and frozen (§1 rule 2).

import Qol from '#/client/qol/Qol.js';
import { registerQolPlugins } from '#/client/qol/plugins/index.js';

/**
 * Build the QoL layer for a client: lifecycle object, then panel/shell wiring
 * (`init`), then each plugin's `register(ctx)`.
 */
export function createQol(client: any): Qol {
    const qol: Qol = new Qol(client);
    qol.init();
    registerQolPlugins(qol.ctx);
    return qol;
}

export default createQol;

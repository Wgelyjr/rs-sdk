// Shift-click Drop (F1) + Menu Entry Swapper (F2) — docs/qol-features-plan.md §4,
// wave-2 chunk C3. Both features are pure `menuBuilt` reorders over the raw
// minimenu arrays: the LAST array entry is the menu top and the default
// left-click action (`Client.doAction(menuNumEntries - 1)`, Client.ts click
// handler ~11086), so moving entries is all we need — no packets, no label
// rewriting, and the right-click menu still shows every option.
//
// Exact vanilla shapes matched (verified against Client.addComponentOptions,
// the type-2 inventory-grid branch):
//  - Drop entry: text `'Drop @lre@' + ObjType.name`, action `OP_HELD5` (added
//    when the item has no 5th inventory op; an item whose `iop[4]` literally
//    starts with 'Drop' matches too). Params: A = 0-based obj id, B = grid
//    slot, C = grid comId. Works identically for the inventory and the
//    bank-side grid (same code path, `child.objOps`).
//  - NPC/loc/item labels embed the target: `'Talk-to @yel@<name>'`,
//    `'Mine @cya@<rock>'`, `'Bury @lre@<bones>'` — swap-rule targets match on
//    these as a fallback for viewport hovers, where `menuTarget()` is null.
//
// Drag-swap compatibility: a plain left-click on a drag-enabled component is
// intercepted by the client's drag machinery using the TOP entry's paramB/
// paramC (slot + grid). Those are the same item whichever entry we promote,
// so reordering only changes what a finished click DOES, never what gets
// dragged. `buildMinimenu()` also returns early while a drag is in flight
// (`objDragArea !== 0`), so this handler never reorders mid-drag.
//
// Bot builds: `Client.buildMinimenu()` dispatches `menuBuilt` in every build
// (the arrays' only bot-side consumer is the CLI display, and shift-drop is
// inert without a physically held Shift key) — no build check needed here.
//
// Hot-path budget: `menuBuilt` fires every hover tick. Rule/exclusion text is
// precompiled to RegExp objects and only re-parsed when the setting string
// actually changes (source comparison + `onChange` invalidation). Steady state
// allocates no rules, no closures and no arrays; the only per-tick strings are
// the lowercase label copies the matcher takes from vanilla's own freshly
// built labels.

import IfType from '#/config/IfType.js';
import ObjType from '#/config/ObjType.js';
import { MiniMenuAction } from '#/client/MiniMenuAction.js';

import type { QolContext } from '#/client/qol/QolContext.js';
import type { QolClickEvent, QolMenuView } from '#/client/qol/QolHooks.js';

/** Setting keys (plan §3, Menu section). */
const KEY_SHIFT_DROP: string = 'menu.shiftDrop';
const KEY_SHIFT_DROP_EXCLUDE: string = 'menu.shiftDropExclude';
const KEY_SWAPPER_ENABLED: string = 'menu.swapperEnabled';
const KEY_SWAP_RULES: string = 'menu.swapRules';

/** Vanilla drop entry prefix — label is `'Drop @lre@<item>'`. */
const DROP_PREFIX: string = 'Drop ';

/** One parsed `[@target ]A<B` swap rule (F2). */
interface SwapRule {
    /** Case-insensitive target matcher, or null when the rule always applies. */
    target: RegExp | null;
    /** Lowercased substring of the entry that must rank higher (toward menu top). */
    a: string;
    /** Lowercased substring of the entry that must rank lower. */
    b: string;
}

/**
 * Parse `menu.swapRules`: one rule per line, grammar `[@targetRegex ]A<B`.
 * Rules may be separated by newlines or `;` (the settings panel's text fields
 * are single-line, so `;` is the practical separator).
 * Blank lines, lines without a usable `<` split, and rules whose target regex
 * fails to compile are skipped silently (re-throwing here would spam the hook
 * error counter every time the panel repaints the text setting).
 */
function parseSwapRules(raw: string): SwapRule[] {
    const rules: SwapRule[] = [];
    if (raw.trim() === '') {
        return rules;
    }

    const lines: string[] = raw.split(/[\n;]/);
    for (let l: number = 0; l < lines.length; l++) {
        const line: string = lines[l].trim();
        if (line === '') {
            continue;
        }

        let target: RegExp | null = null;
        let body: string = line;
        if (line.charAt(0) === '@') {
            const space: number = line.indexOf(' ');
            if (space <= 1) {
                continue; // '@' with no target text or no rule after it
            }
            try {
                target = new RegExp(line.substring(1, space), 'i');
            } catch (_e) {
                continue; // invalid regex → skip line silently
            }
            body = line.substring(space + 1);
        }

        const lt: number = body.indexOf('<');
        if (lt <= 0 || lt >= body.length - 1) {
            continue;
        }
        const a: string = body.substring(0, lt).trim().toLowerCase();
        const b: string = body.substring(lt + 1).trim().toLowerCase();
        if (a === '' || b === '') {
            continue;
        }
        rules.push({ target, a, b });
    }
    return rules;
}

/**
 * Parse `menu.shiftDropExclude`: comma-separated case-insensitive item-name
 * regexes. Empty parts are ignored; invalid regexes are skipped silently.
 */
function parseExcludeList(raw: string): RegExp[] {
    const patterns: RegExp[] = [];
    if (raw.trim() === '') {
        return patterns;
    }

    const parts: string[] = raw.split(',');
    for (let p: number = 0; p < parts.length; p++) {
        const source: string = parts[p].trim();
        if (source === '') {
            continue;
        }
        try {
            patterns.push(new RegExp(source, 'i'));
        } catch (_e) {
            // skip invalid pattern
        }
    }
    return patterns;
}

/**
 * Read the 0-based obj id of an inventory-grid component slot, or -1 when the
 * component is not an item-carrying inventory or the slot is empty.
 * (`IfType.linkObjType` stores 1-based ids; Client.ts itself does
 * `ObjType.list(child.linkObjType[slot] - 1)`.)
 */
function itemIdAtSlot(comId: number, slot: number): number {
    if (comId < 0 || comId >= IfType.list.length) {
        return -1;
    }
    const com: IfType | undefined = IfType.list[comId];
    const inv: Int32Array | null = com ? com.linkObjType : null;
    if (inv === null || slot < 0 || slot >= inv.length) {
        return -1;
    }
    const typeId: number = inv[slot];
    if (typeId <= 0) {
        return -1; // 1-based id, 0/negative = empty slot
    }
    return typeId - 1;
}

/** ObjType name for a 0-based id, or '' when unknown. */
function objName(id: number): string {
    if (id < 0 || id >= ObjType.numDefinitions) {
        return '';
    }
    return ObjType.list(id).name ?? '';
}

/**
 * Best-effort name of the item under the hover context (inventory/bank grids
 * only; viewport hovers have no `menuTarget()`), '' when unresolvable.
 */
function hoveredItemName(ctx: QolContext): string {
    const target = ctx.menuTarget();
    if (target === null) {
        return '';
    }
    return objName(itemIdAtSlot(target.comId, target.slot));
}

/** Does this rule's optional target match the hover or any entry label? */
function ruleTargetMatches(rule: SwapRule, menu: QolMenuView, hoverName: string): boolean {
    if (rule.target === null) {
        return true;
    }
    if (hoverName !== '' && rule.target.test(hoverName)) {
        return true;
    }
    // Entry labels embed the target ('Talk-to @yel@Banker'), which also covers
    // npc/loc hovers where menuTarget() is null. Best effort: a regex like
    // 'le' can spuriously match the '@lre@' colour code — documented gap.
    const count: number = menu.count;
    for (let i: number = 1; i < count; i++) {
        if (rule.target.test(menu.text(i))) {
            return true;
        }
    }
    return false;
}

/** First entry index (>= 1, index 0 is 'Cancel') whose text contains `needle`, or -1. */
function findEntryContaining(menu: QolMenuView, needle: string, skip: number): number {
    const count: number = menu.count;
    for (let i: number = 1; i < count; i++) {
        if (i !== skip && menu.text(i).toLowerCase().indexOf(needle) !== -1) {
            return i;
        }
    }
    return -1;
}

/**
 * Pairwise swap of two entries via `QolMenuView.move` insert semantics, for
 * indices `1 <= a < b < count`. `move(a, b)` slides A up to index b (entries
 * a+1..b shift down one, so B now sits at b-1); `move(b - 1, a)` then slides B
 * back down to index a, restoring every in-between entry to its original
 * position. Result: exactly A and B exchange indices — A ends at b (the menu
 * top side), B ends at a. Adjacent entries need only the first move
 * (`move(a, a + 1)`; the second no-ops on `from === to`). Index 0 ('Cancel')
 * is never a legal argument by construction.
 */
function swapEntries(menu: QolMenuView, a: number, b: number): void {
    menu.move(a, b);
    menu.move(b - 1, a);
}

/** F2: reorder entries so each rule's A ranks above its B (A nearer menu top). */
function applySwapRules(menu: QolMenuView, rules: SwapRule[], hoverName: string): void {
    for (let r: number = 0; r < rules.length; r++) {
        const rule: SwapRule = rules[r];
        if (!ruleTargetMatches(rule, menu, hoverName)) {
            continue;
        }
        const a: number = findEntryContaining(menu, rule.a, -1);
        if (a === -1) {
            continue; // move only entries that both exist
        }
        const b: number = findEntryContaining(menu, rule.b, a);
        if (b === -1) {
            continue;
        }
        if (a < b) {
            swapEntries(menu, a, b); // A ends up at b — above B
        }
        // a > b already satisfies "A nearer array end"; leave the menu alone.
    }
}

/**
 * F1: while Shift is held, promote the hovered item's Drop entry to the menu
 * top (array end) so a plain left-click drops it. Only when the entry's own
 * paramC/paramB resolve to a real item in an inventory-carrying component
 * (IfType `linkObjType`), and the item name is not excluded.
 */
function promoteShiftDrop(menu: QolMenuView, ctx: QolContext, exclude: RegExp[]): void {
    // Must be hovering an interface region — a viewport menu can never carry
    // OP_HELD entries, but gate anyway so the hover context is explicit.
    if (ctx.menuTarget() === null) {
        return;
    }

    const count: number = menu.count;
    for (let i: number = count - 1; i >= 1; i--) {
        if (menu.action(i) !== MiniMenuAction.OP_HELD5) {
            continue;
        }
        const text: string = menu.text(i);
        if (!text.startsWith(DROP_PREFIX)) {
            continue; // OP_HELD5 with a custom 5th op label is not a drop
        }

        // Confirm the hover context is an inventory-like component: the entry
        // carries (paramC = grid comId, paramB = slot) for the item it drops.
        const itemId: number = itemIdAtSlot(menu.paramC(i), menu.paramB(i));
        if (itemId < 0) {
            return; // not a real inventory item under the cursor — leave vanilla order
        }

        let name: string = objName(itemId);
        if (name === '') {
            name = objName(menu.paramA(i)); // entry-stored obj id as fallback
        }
        if (name === '') {
            // Last resort: the label suffix ('Drop @lre@<name>' → name).
            const at: number = text.indexOf('@', DROP_PREFIX.length);
            name = at === -1 ? text.substring(DROP_PREFIX.length) : text.substring(at + 5);
        }
        for (let p: number = 0; p < exclude.length; p++) {
            if (exclude[p].test(name)) {
                return; // excluded item keeps the vanilla menu order
            }
        }

        menu.promote(i); // becomes the left-click action; full menu still shown
        return;
    }
}

export default {
    name: 'MenuSwapper',
    register(ctx: QolContext): void {
        ctx.config.define({
            key: KEY_SHIFT_DROP,
            section: 'Menu',
            label: 'Shift-click Drop',
            type: 'boolean',
            default: true,
            tooltip: 'Hold Shift and left-click an inventory or bank-side item to drop it. Without Shift, left-click behaves exactly like vanilla; right-click always shows the full menu.'
        });
        ctx.config.define({
            key: KEY_SHIFT_DROP_EXCLUDE,
            section: 'Menu',
            label: 'Shift-Drop exclusions',
            type: 'text',
            default: '',
            tooltip: 'Comma-separated case-insensitive item-name regexes that keep the vanilla menu even while Shift is held (e.g. Fire battlestaff, Zamorak staff).'
        });
        ctx.config.define({
            key: KEY_SWAPPER_ENABLED,
            section: 'Menu',
            label: 'Menu Entry Swapper',
            type: 'boolean',
            default: false,
            tooltip: 'Reorder right-click menu entries per the rules below. The menu top entry is what a left-click performs.'
        });
        ctx.config.define({
            key: KEY_SWAP_RULES,
            section: 'Menu',
            label: 'Swap rules',
            type: 'text',
            default: '',
            tooltip:
                'Rules separated by ";" (or newlines), grammar [@targetRegex ] A<B — the entry containing A ranks above (closer to the top than) the entry containing B; case-insensitive substrings. ' +
                'The optional @target regex (no spaces, no ";") only applies the rule when it matches the hovered item name or any menu entry label. ' +
                'Example: @bones Bury<Use; @banker Bank<Talk-to; Burn<Use. Blank and invalid rules (bad regex, missing <) are skipped; Cancel is never moved. ' +
                'Multiple rules apply in listed order.'
        });

        // Precompiled rule caches — rebuilt only when the source text changes
        // (lazy source compare, plus eager invalidation on setting changes so
        // importJson/resetAll paths refresh even for identical-looking strings).
        let rulesSource: string | null = null;
        let rules: SwapRule[] = [];
        let excludeSource: string | null = null;
        let exclude: RegExp[] = [];

        // Whether the currently built menu was built while Shift was held.
        // The client only rebuilds the minimenu on mouse movement, so a click
        // at a stationary cursor would execute the last hover-time build —
        // the click hook below refreshes the menu when Shift has flipped.
        let buildShift: boolean = false;

        ctx.config.onChange(KEY_SWAP_RULES, () => {
            rulesSource = null;
        });
        ctx.config.onChange(KEY_SHIFT_DROP_EXCLUDE, () => {
            excludeSource = null;
        });

        ctx.hooks.onMenuBuilt((menu: QolMenuView): void => {
            buildShift = ctx.shiftHeld();
            if (menu.count <= 1) {
                return; // just 'Cancel' — nothing to reorder
            }

            const swapper: boolean = ctx.config.getBool(KEY_SWAPPER_ENABLED);
            const shiftDrop: boolean = ctx.config.getBool(KEY_SHIFT_DROP);
            const shifting: boolean = shiftDrop && ctx.shiftHeld();
            if (!swapper && !shifting) {
                return; // both features off (or Shift up): vanilla order untouched
            }

            // Swap rules first; shift-Drop gets the final say on left-click.
            if (swapper) {
                const source: string = ctx.config.getStr(KEY_SWAP_RULES);
                if (source !== rulesSource) {
                    rulesSource = source;
                    rules = parseSwapRules(source);
                }
                if (rules.length > 0) {
                    applySwapRules(menu, rules, hoveredItemName(ctx));
                }
            }

            if (shifting) {
                const source: string = ctx.config.getStr(KEY_SHIFT_DROP_EXCLUDE);
                if (source !== excludeSource) {
                    excludeSource = source;
                    exclude = parseExcludeList(source);
                }
                promoteShiftDrop(menu, ctx, exclude);
            }
        }, 'MenuSwapper.menuBuilt');

        // F1: the menu a left click executes was built on the LAST mouse
        // movement, which may predate Shift being held (or its release) — the
        // typical gesture (hover, hold Shift, click in place) hits a stale,
        // un-promoted menu. When the Shift state has flipped since that build,
        // refresh the menu here: the re-dispatched menuBuilt promotes (or
        // un-promotes) the Drop entry before the vanilla routing that follows
        // runs doAction on the top entry (mouseLoop directly, or the
        // drag-release path for inventory-style grids). Never consumes — the
        // click still routes through the vanilla handlers.
        ctx.hooks.onClick((e: QolClickEvent): boolean => {
            if (e.button !== 1 || e.shift === buildShift) {
                return false;
            }
            ctx.rebuildMenu();
            return false;
        }, 'MenuSwapper.shiftRefresh', 1000);
    }
};

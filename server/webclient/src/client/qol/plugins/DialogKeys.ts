// F5 Chatbox skilling prompts — keyboard support (wave 2, chunk C9;
// docs/qol-features-plan.md §4).
//
// While a chat-modal dialog is open:
//  - digits 1..9 click the Nth dialog option (getDialogOptions order — the
//    same order the client/bot bridge publishes);
//  - Space or Enter clicks the single option of continue-style dialogs
//    ("Click here to continue", level-up modals). Multi-choice menus are
//    deliberately NOT auto-picked by Space — an arbitrary default there would
//    mis-fire crafting/bank dialogs; use the digit keys.
//
// Never intercepts real text entry: the hook bails when the server-driven
// input prompt is up (`dialogInputOpen` — Make-X amount, name entry), when the
// friend/PM input line is open (`socialInputOpen`), at the login screen
// (`ingame()`), or when no dialog options exist (plain chat typing). The
// settings panel consumes keys at a higher priority (10001/9999), so an open
// panel wins automatically.
//
// Not handled (v1 gaps, documented in the plan):
//  - ESC does not close dialogs: vanilla has no keyboard close and sending
//    CLOSE_MODAL mid-pause can desync the server's resume state.
//  - No [1]..[n] badges over the option text: dialog options render in the
//    chat buffer (y >= 357), outside the viewport scene buffer the draw hooks
//    paint into; badges would need the canvas-tile capture technique.

import type { QolContext } from '#/client/qol/QolContext.js';

/** Java-style char codes (GameShell keyQueue / KeyCodes.ts). */
const CH_ENTER: number = 10;
const CH_SPACE: number = 32;
const CH_DIGIT_1: number = 49;
const CH_DIGIT_9: number = 57;

/** Key-hook priority: below the settings panel (10001/9999), above plugins at 0. */
const KEY_PRIORITY: number = 5000;

class DialogKeysPlugin {
    private readonly ctx: QolContext;
    private enabled: boolean = true;

    constructor(ctx: QolContext) {
        this.ctx = ctx;
    }

    register(): void {
        const config = this.ctx.config;

        config.define({
            key: 'skilling.dialogKeys',
            section: 'Skilling',
            label: 'Dialog keyboard',
            type: 'boolean',
            default: true,
            tooltip: 'Space/Enter confirms single-option dialogs ("click here to continue", level-ups); digits 1-9 pick numbered dialog options. Never affects typed input (chat, Make-X amounts, names).'
        });
        config.onChange('skilling.dialogKeys', (): void => {
            this.enabled = config.getBool('skilling.dialogKeys');
        });
        this.enabled = config.getBool('skilling.dialogKeys');

        this.ctx.hooks.onKey((ch: number): boolean => this.key(ch), 'dialog-keys', KEY_PRIORITY);
    }

    private key(ch: number): boolean {
        if (!this.enabled) {
            return false;
        }

        // Only act on the keys we own; everything else flows through untouched.
        const isDigit: boolean = ch >= CH_DIGIT_1 && ch <= CH_DIGIT_9;
        const isConfirm: boolean = ch === CH_SPACE || ch === CH_ENTER;
        if (!isDigit && !isConfirm) {
            return false;
        }

        if (!this.ctx.ingame()) {
            return false; // login-screen text loops share this hook
        }

        const client = this.ctx.client;

        // Never steal keys from a text-entry state.
        if (client.dialogInputOpen === true || client.socialInputOpen === true) {
            return false;
        }

        // A dialog must actually be open in the chat modal.
        if (client.chatModalId === -1 || client.chatModalId === undefined) {
            return false;
        }

        const options = this.ctx.getDialogOptions();
        if (options.length === 0) {
            return false;
        }

        if (isDigit) {
            const n: number = ch - (CH_DIGIT_1 - 1); // ch 49..57 → 1..9
            if (n >= 1 && n <= options.length) {
                return this.ctx.clickDialogOption(n);
            }
            return false;
        }

        // Space/Enter: only unambiguous single-option (continue-style) dialogs.
        if (options.length === 1) {
            return this.ctx.clickDialogOption(1);
        }
        return false;
    }
}

export default {
    name: 'DialogKeys',
    register(ctx: QolContext): void {
        new DialogKeysPlugin(ctx).register();
    }
};

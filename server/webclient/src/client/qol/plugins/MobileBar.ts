// qol mobile action bar (T2): a fixed DOM strip of touch targets for what a
// phone can't otherwise reach — the Alt/Shift modifiers (one-shot arming),
// wheel zoom, the chat keyboard, the world map, and the settings panel.
//
// Config lives in the 'Mobile' section. `mobile.bar` defaults ON on touch
// devices (define() applies the per-device default until the user stores a
// value); the gesture toggles gate the Client.ts touch paths.
//
// The bar is a plain fixed-position DOM layer (QolDom CSS-injection pattern),
// not a QolDom widget — it sits outside the canvas frame, at the bottom of the
// screen, so it never collides with the 765x503 layout.

import type { QolContext } from '#/client/qol/QolContext.js';
import MobileKeyboard from '#/client/MobileKeyboard.js';

const CSS_ID: string = 'qol-mobile-bar-css';
const BAR_ID: string = 'qol-mobilebar';

/** Alt one-shot: disarms after the next dispatched click or this long. */
const ALT_TIMEOUT_MS: number = 15_000;
/** Drop one-shot: disarms on the first built menu or this long. */
const DROP_TIMEOUT_MS: number = 30_000;

const BAR_CSS: string = `
#qol-mobilebar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 200;
  display: none; gap: 6px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
  background: rgba(6,10,6,0.94); border-top: 1px solid #2a4a2a;
  font: 600 13px 'Segoe UI', system-ui, sans-serif; }
#qol-mobilebar.show { display: flex; }
#qol-mobilebar button { flex: 1 1 0; min-width: 0; min-height: 44px; border: 1px solid #1c331c;
  border-radius: 6px; background: #102310; color: #b8ff9e; font: inherit;
  text-shadow: 1px 1px 0 #000; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  user-select: none; }
#qol-mobilebar button:active { background: #1d3d1d; }
#qol-mobilebar button.armed { background: #04a800; color: #001a00; border-color: #06d000; }
@media (min-width: 821px) {
  #qol-mobilebar { max-width: 765px; left: 50%; right: auto; transform: translateX(-50%); }
}
`;

interface BarButton {
    el: HTMLButtonElement;
    armed: boolean;
}

export default {
    name: 'MobileBar',
    register(ctx: QolContext): void {
        const client: any = ctx.client;
        const config = ctx.config;

        const isTouch: boolean =
            typeof window !== 'undefined' &&
            ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);

        config.define({
            key: 'mobile.bar',
            section: 'Mobile',
            label: 'Touch action bar',
            type: 'boolean',
            default: isTouch,
            tooltip:
                'Fixed bar of touch targets (Alt, Drop, zoom, chat, map, settings). On by default on touch devices.',
        });
        config.define({
            key: 'mobile.gestureMenu',
            section: 'Mobile',
            label: 'Two-finger tap = context menu',
            type: 'boolean',
            default: true,
            tooltip: 'Tap with two fingers to open the right-click menu.',
        });
        config.define({
            key: 'mobile.gestureChatSwipe',
            section: 'Mobile',
            label: 'Swipe up = chat',
            type: 'boolean',
            default: true,
            tooltip: 'A quick upward swipe from below the viewport opens the chat keyboard.',
        });
        config.define({
            key: 'mobile.gestureDoubleTap',
            section: 'Mobile',
            label: 'Double-tap = center camera',
            type: 'boolean',
            default: true,
            tooltip: 'Double-tap the game view to recenter the camera on the player.',
        });

        if (typeof document === 'undefined') {
            return; // lite runner / headless: settings exist, no DOM bar
        }

        // ---- build the bar (once) ----
        if (document.getElementById(CSS_ID) === null) {
            const style = document.createElement('style');
            style.id = CSS_ID;
            style.textContent = BAR_CSS;
            document.head.appendChild(style);
        }

        let bar: HTMLDivElement | null = document.getElementById(BAR_ID) as HTMLDivElement | null;
        if (bar === null) {
            bar = document.createElement('div');
            bar.id = BAR_ID;
            document.body.appendChild(bar);
        }

        const makeButton = (label: string, title: string, onActivate: () => void): BarButton => {
            const el = document.createElement('button');
            el.type = 'button';
            el.textContent = label;
            el.title = title;
            el.addEventListener('click', () => {
                onActivate();
                el.blur(); // don't trap focus/scroll on the canvas
            });
            bar!.appendChild(el);
            return { el, armed: false };
        };

        // ---- one-shot Alt (tile markers, hide-lens management) ----
        // Armed Alt survives the next pointerdown (virtual modifier), so the
        // marker click hook sees alt=true; the tick disarms once a click has
        // been dispatched (mouseClickTime moves) or after the safety timeout.
        let altButton: BarButton;
        let altArmedAt: number = 0;
        let altArmedClickTime: number = 0;

        const disarmAlt = (): void => {
            if (!altButton.armed) {
                return;
            }
            altButton.armed = false;
            altButton.el.classList.remove('armed');
            client.setVirtualAltHeld(false);
        };

        altButton = makeButton('Alt', 'Arm Alt for the next tap (tile markers, ground-hide lens). One-shot.', () => {
            if (altButton.armed) {
                disarmAlt();
                return;
            }
            altButton.armed = true;
            altButton.el.classList.add('armed');
            altArmedAt = performance.now();
            altArmedClickTime = client.mouseClickTime ?? 0;
            client.setVirtualAltHeld(true);
        });

        // ---- one-shot Drop (Shift promotes the Drop menu entry) ----
        // MenuSwapper's menuBuilt handler runs before this one (registration
        // order), so by the time we disarm the promotion has already happened.
        let dropButton: BarButton;
        let dropArmedAt: number = 0;

        const disarmDrop = (): void => {
            if (!dropButton.armed) {
                return;
            }
            dropButton.armed = false;
            dropButton.el.classList.remove('armed');
            client.setVirtualShiftHeld(false);
        };

        dropButton = makeButton('Drop', 'Arm Shift for the next menu (promotes Drop). Needs Menu > Shift-click drop on.', () => {
            if (dropButton.armed) {
                disarmDrop();
                return;
            }
            dropButton.armed = true;
            dropButton.el.classList.add('armed');
            dropArmedAt = performance.now();
            client.setVirtualShiftHeld(true);
        });

        ctx.hooks.onMenuBuilt(() => {
            if (dropButton.armed) {
                disarmDrop();
            }
        }, 'MobileBar.dropDisarm');

        // ---- wheel-zoom shortcuts (CameraUnlock consumes the synthesized notch) ----
        const zoomNotch = (out: boolean): void => {
            const wheel: any = client.onqolwheel;
            if (typeof wheel === 'function') {
                wheel.call(client, 0, out ? 120 : -120, 258, 170);
            }
        };
        makeButton('Zoom−', 'Zoom out (wheel notch)', () => zoomNotch(true));
        makeButton('Zoom+', 'Zoom in (wheel notch)', () => zoomNotch(false));

        // ---- chat / map / settings ----
        makeButton('Chat', 'Open the chat keyboard', () => {
            MobileKeyboard.show(256, 447);
        });
        makeButton('Map', 'Open the world map in a new tab', () => {
            window.open('/mapview/', '_blank', 'noopener');
        });
        makeButton('Gear', 'Toggle the settings panel (F10)', () => {
            // client.qol is only assigned after createQol() returns, so resolve lazily
            const qol: any = client.qol;
            if (qol !== null && qol !== undefined) {
                qol.panel.toggle();
            }
        });

        // ---- per-tick: bar visibility + one-shot disarms ----
        let barVisible: boolean = false;
        ctx.hooks.onTick(() => {
            const shouldShow: boolean = config.getBool('mobile.bar') && ctx.ingame();
            if (barVisible !== shouldShow) {
                barVisible = shouldShow;
                bar!.classList.toggle('show', shouldShow);
            }
            if (altButton.armed) {
                const clicked: boolean = (client.mouseClickTime ?? 0) !== altArmedClickTime;
                if (clicked || performance.now() - altArmedAt > ALT_TIMEOUT_MS) {
                    disarmAlt();
                }
            }
            if (dropButton.armed && performance.now() - dropArmedAt > DROP_TIMEOUT_MS) {
                disarmDrop();
            }
        }, 'MobileBar.tick');
    },
};

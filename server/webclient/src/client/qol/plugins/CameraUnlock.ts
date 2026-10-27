// F7 — Unlocked camera, scroll zoom, middle-drag rotate (wave 2, chunk C5).
//
// Zoom model: a distance multiplier m applied to the vanilla follow-camera
// distance at the `camFollow` call site. Vanilla distance is
// `pitch * 3 + 600` (computed by the caller into `state.distance`); this
// plugin maps `state.distance = round(vanilla * m)` with
// `m ∈ [visual.zoomMin, visual.zoomMax]`, where values below 1 zoom IN
// (`zoomMin`, default 0.5) and values above 1 zoom OUT (`zoomMax`, default
// 1.5, hard-capped at 3.0). `m = 1` is exactly vanilla distance, so the
// wheel converges on the vanilla view when reset. Wheel notches move the
// *target* multiplicatively
// (×/÷ 1.1); the camera map handler lerps the actual `m` toward the target
// every render frame (the hook runs per `gameDrawMain`, not per logic tick)
// and caps the per-call change, so zoom is smooth and can never teleport.
//
// Pitch limits: `minPitch`/`maxPitch` on the reusable camera state are sticky
// overrides read every logic tick by `followCamera()` (Client.ts ~5792) and
// re-clamped after camera shake (~6783). We refresh them on every camera-map
// call: the settings range while unlocked, vanilla 128/383 when
// `visual.cameraUnlock` is off.
//
// Middle-drag rotate: GameShell gives the middle button its own state code
// (`client.mouseButton === 3`) with no drag events and vanilla ignores code 3
// entirely, so we poll `mouseX/mouseY` in the `tick` hook and write
// `orbitCameraYaw`/`orbitCameraPitch` directly through the context escape
// hatch. Key-orbit velocity fields are zeroed while dragging so vanilla
// momentum doesn't fight the drag, and `sendCamera` is flagged true so the
// (untouched, rate-limited) `EVENT_CAMERA_POSITION` throttle reports the new
// angle like arrow-key rotation does.

import type { QolContext } from '#/client/qol/QolContext.js';
import type { QolCameraState, QolWheelEvent } from '#/client/qol/QolHooks.js';

/** Wheel notch: target zoom multiplier scaled by this factor per notch. */
const ZOOM_NOTCH: number = 1.1;

/** Camera-map lerp toward the target zoom factor per call (render-frame rate). */
const ZOOM_LERP: number = 0.25;

/** Hard cap on the zoom-factor change per camera-map call (anti-teleport). */
const ZOOM_MAX_STEP: number = 0.12;

/** Vanilla pitch floor/ceiling, restored whenever the unlock is off. */
const VANILLA_MIN_PITCH: number = 128;
const VANILLA_MAX_PITCH: number = 383;

/** Middle-drag sensitivity in camera units per pixel (2048 units = full circle). */
const DRAG_SENSITIVITY: number = 4;

/** Per-tick drag delta clamp (px) so teleporting pointers can't whip the camera. */
const DRAG_MAX_PX: number = 48;

/** Viewport rect in full-frame wheel coordinates (the 512x334 scene buffer). */
const VIEWPORT_X0: number = 4;
const VIEWPORT_Y0: number = 4;
const VIEWPORT_X1: number = 516;
const VIEWPORT_Y1: number = 338;

/**
 * Plugin state kept out of the hot closures' capture list; one instance per
 * `register(ctx)` call (one Qol layer per Client). All camera/tick handlers
 * are allocation-free.
 */
class CameraUnlockState {
    /** Smoothed zoom multiplier actually applied to the distance term. */
    zoom: number = 1;
    /** Wheel-driven zoom target the smoothed value chases. */
    zoomTarget: number = 1;
    /** True while a middle-drag sequence is being tracked. */
    dragging: boolean = false;
    /** Pointer position at the previous drag sample. */
    prevX: number = 0;
    prevY: number = 0;
}

export default {
    name: 'CameraUnlock',
    register(ctx: QolContext): void {
        const config = ctx.config;

        config.define({
            key: 'visual.cameraUnlock',
            section: 'Visuals',
            label: 'Unlock camera',
            type: 'boolean',
            default: true,
            tooltip: 'Master toggle: scroll zoom, extended pitch and middle-drag rotate. Off restores vanilla camera exactly.'
        });
        config.define({
            key: 'visual.zoomMin',
            section: 'Visuals',
            label: 'Max zoom in (x vanilla)',
            type: 'slider',
            default: 0.5,
            min: 0.3,
            max: 1.0,
            tooltip: 'Smallest camera-distance factor. 0.05 steps. Very close views may clip geometry at extreme pitch.'
        });
        config.define({
            key: 'visual.zoomMax',
            section: 'Visuals',
            label: 'Max zoom out (x vanilla)',
            type: 'slider',
            default: 1.5,
            min: 1.0,
            max: 3.0,
            tooltip: 'Largest camera-distance factor. 0.25 steps. Zooming past ~2x may show the edges of the loaded map area.'
        });
        config.define({
            key: 'visual.pitchMin',
            section: 'Visuals',
            label: 'Min pitch (flat)',
            type: 'slider',
            default: 128,
            min: 60,
            max: 128,
            tooltip: 'Lowest camera pitch (vanilla 128). Lower angles can show map edges and distant culling artifacts.'
        });
        config.define({
            key: 'visual.pitchMax',
            section: 'Visuals',
            label: 'Max pitch (top-down)',
            type: 'slider',
            default: 480,
            min: 383,
            max: 550,
            tooltip: 'Highest camera pitch (vanilla 383). Near top-down the scene buffer may show map edges; raise cautiously.'
        });
        config.define({
            key: 'visual.wheelInvert',
            section: 'Visuals',
            label: 'Invert scroll zoom',
            type: 'boolean',
            default: false,
            tooltip: 'Scroll up zooms out instead of in.'
        });
        config.define({
            key: 'visual.middleDragRotate',
            section: 'Visuals',
            label: 'Middle-drag rotate',
            type: 'boolean',
            default: true,
            tooltip: 'Hold middle mouse and drag to orbit. Extreme pitch may show map edges.'
        });

        const s = new CameraUnlockState();

        const unlocked = (): boolean => config.getBool('visual.cameraUnlock');

        const pitchFloor = (): number => {
            const lo: number = config.getNum('visual.pitchMin');
            const hi: number = config.getNum('visual.pitchMax');
            return lo <= hi ? lo : hi;
        };

        const pitchCeiling = (): number => {
            const lo: number = config.getNum('visual.pitchMin');
            const hi: number = config.getNum('visual.pitchMax');
            return lo <= hi ? hi : lo;
        };

        const zoomFloor = (): number => {
            const lo: number = config.getNum('visual.zoomMin');
            const hi: number = config.getNum('visual.zoomMax');
            return lo <= hi ? lo : hi;
        };

        const zoomCeiling = (): number => {
            const lo: number = config.getNum('visual.zoomMin');
            const hi: number = config.getNum('visual.zoomMax');
            return lo <= hi ? hi : lo;
        };

        // ---- camera map (runs every render frame at the camFollow call site) ----
        ctx.hooks.onCamera((state: QolCameraState): void => {
            if (!unlocked()) {
                // Identity map + vanilla sticky clamps; park the zoom at 1 so a
                // later re-enable starts from the vanilla distance, not a jump.
                s.zoom = 1;
                s.zoomTarget = 1;
                state.minPitch = VANILLA_MIN_PITCH;
                state.maxPitch = VANILLA_MAX_PITCH;
                return;
            }

            state.minPitch = pitchFloor();
            state.maxPitch = pitchCeiling();

            // Keep the target inside the (possibly just-changed) slider range.
            const lo: number = zoomFloor();
            const hi: number = zoomCeiling();
            if (s.zoomTarget < lo) {
                s.zoomTarget = lo;
            } else if (s.zoomTarget > hi) {
                s.zoomTarget = hi;
            }

            // Lerp toward the target, capped so no single frame can teleport the view.
            let step: number = (s.zoomTarget - s.zoom) * ZOOM_LERP;
            if (step > ZOOM_MAX_STEP) {
                step = ZOOM_MAX_STEP;
            } else if (step < -ZOOM_MAX_STEP) {
                step = -ZOOM_MAX_STEP;
            }
            s.zoom += step;
            if (s.zoom < lo) {
                s.zoom = lo;
            } else if (s.zoom > hi) {
                s.zoom = hi;
            }

            // `state.distance` arrives as the fresh vanilla term (pitch*3+600),
            // so multiplying here is idempotent per frame — no compounding.
            state.distance = (state.distance * s.zoom) | 0;
        }, 'camera-unlock');

        // ---- wheel zoom (consume hook; priority 0 so the settings panel wins) ----
        ctx.hooks.onWheel((e: QolWheelEvent): boolean => {
            if (!unlocked()) {
                return false;
            }
            if (e.dy === 0) {
                return false; // horizontal trackpad scroll: not ours
            }
            if (e.x < VIEWPORT_X0 || e.x >= VIEWPORT_X1 || e.y < VIEWPORT_Y0 || e.y >= VIEWPORT_Y1) {
                return false; // only over the world viewport
            }
            const client = ctx.client;
            if (ctx.ingame() && client.mainModalId !== -1) {
                return false; // a main modal covers the viewport; leave the wheel to it
            }

            // Best-effort: don't steal the wheel from an open settings panel.
            // (Foundation field access only; harmlessly skipped if unavailable.)
            const qol = client.qol;
            if (qol && typeof qol.panel?.isOpen === 'function' && qol.panel.isOpen() === true) {
                return false;
            }

            // Scroll up (negative delta) zooms in by default; invert flips it.
            const zoomOut: boolean = (e.dy > 0) !== config.getBool('visual.wheelInvert');
            const lo: number = zoomFloor();
            const hi: number = zoomCeiling();
            if (zoomOut) {
                s.zoomTarget = Math.min(hi, s.zoomTarget * ZOOM_NOTCH);
            } else {
                s.zoomTarget = Math.max(lo, s.zoomTarget / ZOOM_NOTCH);
            }
            return true;
        }, 'camera-zoom', 0);

        // ---- middle-drag rotate (polled in the logic tick; no drag events exist) ----
        ctx.hooks.onTick((): void => {
            const client = ctx.client;
            if (!unlocked() || !config.getBool('visual.middleDragRotate') || !ctx.ingame()) {
                s.dragging = false;
                return;
            }
            if (client.mouseButton !== 3) {
                s.dragging = false; // button released (or never held): reset prev-pos
                return;
            }

            const x: number = client.mouseX as number;
            const y: number = client.mouseY as number;
            if (!s.dragging) {
                s.dragging = true;
                s.prevX = x;
                s.prevY = y;
                return;
            }

            let dx: number = x - s.prevX;
            let dy: number = y - s.prevY;
            s.prevX = x;
            s.prevY = y;

            // Clamp per-tick pointer jumps (tab refocus, teleporting cursor).
            if (dx > DRAG_MAX_PX) {
                dx = DRAG_MAX_PX;
            } else if (dx < -DRAG_MAX_PX) {
                dx = -DRAG_MAX_PX;
            }
            if (dy > DRAG_MAX_PX) {
                dy = DRAG_MAX_PX;
            } else if (dy < -DRAG_MAX_PX) {
                dy = -DRAG_MAX_PX;
            }
            if (dx === 0 && dy === 0) {
                return;
            }

            // Yaw: 2048 units = full circle; dragging right spins the camera left
            // (grab-the-world feel). Pitch: dragging down tilts toward top-down.
            client.orbitCameraYaw = (((client.orbitCameraYaw as number) - (dx * DRAG_SENSITIVITY) | 0) & 0x7ff) as number;

            let pitch: number = (client.orbitCameraPitch as number) + (dy * DRAG_SENSITIVITY | 0);
            const lo: number = pitchFloor();
            const hi: number = pitchCeiling();
            if (pitch < lo) {
                pitch = lo;
            } else if (pitch > hi) {
                pitch = hi;
            }
            client.orbitCameraPitch = pitch as number;

            // Kill vanilla key-orbit momentum so it doesn't fight the drag, and
            // flag a camera event like arrow rotation does (the ~4641 throttle
            // itself is untouched and still rate-limits to 1/20 cycles).
            client.orbitCameraYawVelocity = 0;
            client.orbitCameraPitchVelocity = 0;
            client.sendCamera = true;
        }, 'camera-middle-drag');
    }
};

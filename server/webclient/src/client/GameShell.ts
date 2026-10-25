import { CanvasEnabledKeys, KeyCodes } from '#/client/KeyCodes.js';

import { canvas, canvas2d } from '#/graphics/Canvas.js';
import Pix3D from '#/dash3d/Pix3D.js';
import PixMap from '#/graphics/PixMap.js';

import { sleep } from '#/util/JsUtil.js';

export default abstract class GameShell {
    protected state: number = 0;
    protected deltime: number = 14; // 30% faster than original 20ms
    protected mindel: number = 1;
    protected otim: number[] = new Array(10);
    protected fps: number = 0;
    protected debug: boolean = false;
    protected drawArea: PixMap | null = null;
    protected fullredraw: boolean = true;
    protected focus: boolean = true;

    public idleTimer: number = performance.now();
    public mouseButton: number = 0;
    public mouseX: number = -1;
    public mouseY: number = -1;
    protected nextMouseClickButton: number = 0;
    protected nextMouseClickX: number = -1;
    protected nextMouseClickY: number = -1;
    public mouseClickButton: number = 0;
    public mouseClickX: number = -1;
    public mouseClickY: number = -1;
    protected nextMouseClickTime: number = 0;
    public mouseClickTime: number = 0;

    public keyHeld: number[] = [];
    protected keyQueue: number[] = [];
    protected keyQueueReadPos: number = 0;
    protected keyQueueWritePos: number = 0;

    // qol: native modifier state, tracked from DOM events. Deliberately NOT routed
    // through keyHeld/keyQueue: ch < 30 gets zeroed and control chars would leak
    // into chat (plan §2.3).
    public shiftHeld: boolean = false;
    public altHeld: boolean = false;
    public ctrlHeld: boolean = false;

    // qol: middle mouse button state. Vanilla maps everything non-right to left,
    // so the middle button keeps its own click code (mouseButton/mouseClickButton
    // === 3) that no vanilla comparison consumes; the QoL click hook sees button 3.
    public get middleButton(): boolean {
        return this.mouseButton === 3;
    }

    // qol: hook callbacks assigned by the QoL layer (Qol.init()). Kept as plain
    // function fields so GameShell stays independent of the qol/ directory.
    // wheel: (dx, dy, canvasX, canvasY) -> consumed? (a consumed wheel stops the
    // page scroll); resize: (canvasWidth, canvasHeight); framePace: (nowMs) ->
    // extra ms to sleep after mainredraw().
    public onqolwheel: ((dx: number, dy: number, x: number, y: number) => boolean) | null = null;
    public onqolresize: ((width: number, height: number) => void) | null = null;
    public onqolframepace: ((nowMs: number) => number | null) | null = null;

    // qol: F9 frame-pacing state, driven by setQolFramePace() (visual.fpsCap).
    // qolFrameTargetHz: 0 = vanilla accumulator pacing (untouched loop); > 0 =
    // outer iterations (mainredraw) paced to that rate; Infinity ('Unlimited')
    // floors the pacing sleep at mindel. qolLogicPeriodMs is the loop's own
    // measured mainloop() step interval (wall-clock averaged, see
    // qolTrackLogicStep) — the unlocked branch dispenses logic steps at exactly
    // that interval so the game speed never changes with the cap.
    public qolFrameTargetHz: number = 0;
    private qolLogicPeriodMs: number = 0;
    private qolLogicAnchor: number = 0;
    private qolLogicAcc: number = 0;
    private qolLastWorkMs: number = 0;
    /** Pacing sleep taken at the top of the current iteration (excluded from work). */
    private qolTopSleepMs: number = 0;
    private qolIterEnd: number = 0;
    private qolWindowStart: number = 0;
    private qolWindowTicks: number = 0;

    /// custom
    protected resizeToFit: boolean = false;
    protected tfps: number = 50;
    private absMouseX: number = 0;
    private absMouseY: number = 0;

    private readonly resizeHandler = (): void => {
        if (this.resizeToFit) {
            this.resize(window.innerWidth, window.innerHeight);
        }
    };

    private readonly touchEndHandler = (e: TouchEvent): void => {
        e.preventDefault();
    };

    protected async maininit() { }
    protected mainquit() { }
    protected async mainloop() { }
    protected async mainredraw() { }
    protected refresh() { }

    constructor(resizetoFit: boolean = false) {
        canvas.tabIndex = -1;
        canvas2d.fillStyle = 'black';
        canvas2d.fillRect(0, 0, canvas.width, canvas.height);

        this.resizeToFit = resizetoFit;
        if (this.resizeToFit) {
            this.resize(window.innerWidth, window.innerHeight);
        } else {
            this.resize(canvas.width, canvas.height);
        }
    }

    protected get sWid(): number {
        return canvas.width;
    }

    protected get sHei(): number {
        return canvas.height;
    }

    protected resize(width: number, height: number) {
        canvas.width = width;
        canvas.height = height;
        this.drawArea = new PixMap(width, height);
        Pix3D.setRenderClipping();

        // qol: resizeCanvas hook (display scaling plugins)
        if (this.onqolresize !== null) {
            this.onqolresize(width, height);
        }
    }

    async run() {
        window.addEventListener('resize', this.resizeHandler, false);

        canvas.onfocus = this.onfocus.bind(this);
        canvas.onblur = this.onblur.bind(this);

        canvas.onkeydown = this.onkeydown.bind(this);
        canvas.onkeyup = this.onkeyup.bind(this);

        canvas.onmousedown = this.onmousedown.bind(this);
        canvas.onpointerdown = this.onpointerdown.bind(this);
        canvas.onmouseup = this.onmouseup.bind(this);
        canvas.onpointerup = this.onpointerup.bind(this);
        canvas.onpointerenter = this.onpointerenter.bind(this);
        canvas.onpointerleave = this.onpointerleave.bind(this);
        canvas.onpointermove = this.onpointermove.bind(this);
        window.onmouseup = this.windowMouseUp.bind(this);
        window.onmousemove = this.windowMouseMove.bind(this);

        // qol: wheel events route through the hook bus (camera zoom, overlay scrolling)
        canvas.onwheel = this.onqolwheelEvent.bind(this);

        if (this.isTouchDevice) {
            canvas.style.touchAction = 'pinch-zoom';
            canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
        }

        // Preventing mouse events from bubbling up to the context menu in the browser for our canvas.
        // This may need to be hooked up to our own context menu in the future.
        canvas.oncontextmenu = (e: MouseEvent): void => {
            e.preventDefault();
        };

        window.oncontextmenu = (e: MouseEvent): void => {
            e.preventDefault();
        };

        await this.drawProgress('Loading...', 0);
        await this.maininit();

        let ntime: number = 0;
        let opos: number = 0;
        let ratio: number = 256;
        let delta: number = 1;
        let count: number = 0;

        for (let i: number = 0; i < 10; i++) {
            this.otim[i] = performance.now();
        }

        while (this.state >= 0) {
            if (this.state > 0) {
                this.state--;

                if (this.state === 0) {
                    this.shutdown();
                    return;
                }
            }

            const lastRatio: number = ratio;
            const lastDelta: number = delta;

            ratio = 300;
            delta = 1;

            ntime = performance.now();

            const otim: number = this.otim[opos];
            if (otim === 0) {
                ratio = lastRatio;
                delta = lastDelta;
            } else if (ntime > otim) {
                ratio = ((this.deltime * 2560) / (ntime - otim)) | 0;
            }

            if (ratio < 25) {
                ratio = 25;
            } else if (ratio > 256) {
                ratio = 256;
                delta = (this.deltime - (ntime - otim) / 10) | 0;
            }

            // qol: F9 — unlocked frame pacing (visual.fpsCap, see setQolFramePace). The
            // window math above still runs in both branches so the fps/debug overlay
            // keeps working; with a cap set, this branch owns the pacing and the logic
            // accumulator: mainredraw() lands on the cap while mainloop() keeps its
            // measured rate.
            const qolUnlocked: boolean = this.qolFrameTargetHz > 0;

            if (qolUnlocked) {
                // qol: the count accumulator is bypassed; clamp ratio so a switch back
                // to vanilla pacing resumes at full rate from a healthy window.
                ratio = 256;

                // qol: stamp the window with the previous frame's end instead of ntime
                // — the sleep below is wall-clock paced, so there is no `delta` for
                // the `otim += delta` compensation shift to model.
                this.otim[opos] = this.qolIterEnd > 0 ? this.qolIterEnd : ntime;
                opos = (opos + 1) % 10;

                // qol: sleep off the previous frame's measured cost so the
                // iteration-to-iteration period lands on the target. 'Unlimited'
                // (Infinity) makes the target 0 ms and floors at mindel: uncapped,
                // yet still yielding to DOM/network work.
                let qolSleep: number = 1000 / this.qolFrameTargetHz - this.qolLastWorkMs;
                if (qolSleep < this.mindel) {
                    qolSleep = this.mindel;
                }
                this.qolTopSleepMs = qolSleep;
                await sleep(qolSleep);

                // qol: explicit wall-clock logic accumulator — every millisecond of
                // real time (sleep, redraw, stalls) buys logic at the measured classic
                // interval, so the logic Hz is cap-invariant. The 8-step bound mirrors
                // the original loop's catch-up burst on a slow frame.
                const qolNow: number = performance.now();
                if (this.qolLogicAnchor > 0) {
                    const qolElapsed: number = qolNow - this.qolLogicAnchor;
                    this.qolLogicAcc += qolElapsed > 1000 ? 1000 : qolElapsed;
                }
                this.qolLogicAnchor = qolNow;

                const qolPeriod: number = this.qolLogicPeriodMs > 0 ? this.qolLogicPeriodMs : this.deltime;
                let qolSteps: number = 0;
                while (qolSteps < 8 && this.qolLogicAcc >= qolPeriod) {
                    this.qolLogicAcc -= qolPeriod;
                    qolSteps++;

                    this.mouseClickButton = this.nextMouseClickButton;
                    this.mouseClickX = this.nextMouseClickX;
                    this.mouseClickY = this.nextMouseClickY;
                    this.mouseClickTime = this.nextMouseClickTime;
                    this.nextMouseClickButton = 0;

                    await this.mainloop();

                    this.qolTrackLogicStep(); // qol: F9
                    this.keyQueueReadPos = this.keyQueueWritePos;
                }
            } else {
                this.otim[opos] = ntime;
                opos = (opos + 1) % 10;

                if (delta > 1) {
                    for (let i: number = 0; i < 10; i++) {
                        if (this.otim[i] !== 0) {
                            this.otim[i] += delta;
                        }
                    }
                }

                if (delta < this.mindel) {
                    delta = this.mindel;
                }

                await sleep(delta);

                while (count < 256) {
                    this.mouseClickButton = this.nextMouseClickButton;
                    this.mouseClickX = this.nextMouseClickX;
                    this.mouseClickY = this.nextMouseClickY;
                    this.mouseClickTime = this.nextMouseClickTime;
                    this.nextMouseClickButton = 0;

                    await this.mainloop();

                    this.qolTrackLogicStep(); // qol: F9 — keeps the unlock seed measured
                    this.keyQueueReadPos = this.keyQueueWritePos;
                    count += ratio;
                }
                count &= 0xff;
            }

            if (this.deltime > 0) {
                // qol: F9 — with a cap set `ratio` is clamped and no longer tracks the
                // iteration rate; report the real frame rate from the same 10-sample
                // otim window (10 iterations per window → 10000/elapsed ms → Hz).
                const qolWindow: number = otim > 0 ? ntime - otim : 0;
                this.fps = qolUnlocked && qolWindow > 0 ? ((10000 / qolWindow) | 0) : ((ratio * 1000) / (this.deltime * 256)) | 0;
            }

            await this.mainredraw();

            // qol: framePace map hook — plugins (FPS caps) may request extra sleep
            if (this.onqolframepace !== null) {
                const qolPace: number | null = this.onqolframepace(performance.now());
                if (qolPace !== null && qolPace > 0) {
                    await sleep(qolPace);
                }
            }

            // this is custom for targeting specific fps (on mobile).
            if (this.tfps < 50) {
                const tfps: number = 1000 / this.tfps - (performance.now() - ntime);
                if (tfps > 0) {
                    await sleep(tfps);
                }
            }

            // qol: F9 — frame-end stamp: next iteration's window entry and work-time
            // estimate. The work estimate EXCLUDES this iteration's top pacing
            // sleep (qolTopSleepMs): including it made the next sleep =
            // target - (sleep + work), converging the period to (target+work)/2
            // instead of target (measured 178 Hz at a 120 cap).
            if (this.qolFrameTargetHz > 0) {
                const qolEnd: number = performance.now();
                this.qolIterEnd = qolEnd;
                const qolWork: number = qolEnd - ntime - this.qolTopSleepMs;
                this.qolLastWorkMs = qolWork > 0 ? qolWork : 0;
            }

            if (this.debug) {
                console.log('ntime:' + ntime);
                for (let i = 0; i < 10; i++) {
                    const o = (opos - i - 1 + 20) % 10;
                    console.log('otim' + o + ':' + this.otim[o]);
                }
                console.log('fps:' + this.fps + ' ratio:' + ratio + ' count:' + count);
                console.log('del:' + delta + ' deltime:' + this.deltime + ' mindel:' + this.mindel);
                console.log('opos:' + opos);
                this.debug = false;
            }
        }

        if (this.state === -1) {
            this.shutdown();
        }
    }

    /**
     * qol: F9 — select frame pacing (visual.fpsCap). `targetHz` 0 restores the
     * vanilla accumulator pacing (the '50 (default)' setting — the loop stays
     * exactly as upstream); a finite rate paces the outer iteration (and thus
     * mainredraw()) to it; Infinity ('Unlimited') floors the pacing sleep at
     * mindel. Game logic never changes speed: the wall-clock accumulator in the
     * unlocked branch dispenses mainloop() steps at `logicPeriodMs` when given,
     * otherwise at the loop's own measured mainloop() interval (deltime before
     * the first measurement completes). Called by the qol Display plugin.
     */
    public setQolFramePace(targetHz: number, logicPeriodMs: number = 0): void {
        const next: number = targetHz > 0 && (Number.isFinite(targetHz) || targetHz === Number.POSITIVE_INFINITY) ? targetHz : 0;
        if (next === this.qolFrameTargetHz && !(next > 0 && logicPeriodMs >= 1)) {
            return;
        }

        const modeChanged: boolean = (next > 0) !== (this.qolFrameTargetHz > 0);
        this.qolFrameTargetHz = next;

        if (logicPeriodMs >= 1 && logicPeriodMs <= 1000) {
            this.qolLogicPeriodMs = logicPeriodMs;
        }

        if (modeChanged) {
            this.qolLogicAnchor = 0;
            this.qolLogicAcc = 0;
            this.qolIterEnd = 0;
            this.qolLastWorkMs = 0;
            if (next > 0 && this.qolLogicPeriodMs <= 0) {
                this.qolLogicPeriodMs = this.deltime > 0 ? this.deltime : 14;
            }
        }
    }

    /**
     * qol: F9 — call once per mainloop() step from either branch. Keeps a
     * wall-clock-averaged step interval over windows of 128 measured intervals —
     * the true logic period of this machine in its current state, which is what
     * the unlocked branch reproduces when a cap is enabled. Cheap by design:
     * one counter plus one performance.now() per window, and a full no-op for
     * shells without the qol layer wired (MapView etc.).
     */
    private qolTrackLogicStep(): void {
        if (this.onqolframepace === null) {
            return;
        }

        const now: number = performance.now();
        if (this.qolWindowStart === 0) {
            this.qolWindowStart = now;
            this.qolWindowTicks = 0;
        } else if (++this.qolWindowTicks >= 128) {
            const period: number = (now - this.qolWindowStart) / this.qolWindowTicks;
            if (period >= 2 && period <= 60) {
                this.qolLogicPeriodMs = period;
            }
            this.qolWindowStart = 0;
            this.qolWindowTicks = 0;
        }
    }

    protected shutdown() {
        this.state = -2;
        this.mainquit();

        window.removeEventListener('resize', this.resizeHandler, false);
        canvas.onfocus = null;
        canvas.onblur = null;
        canvas.onkeydown = null;
        canvas.onkeyup = null;
        canvas.onmousedown = null;
        canvas.onpointerdown = null;
        canvas.onmouseup = null;
        canvas.onpointerup = null;
        canvas.onpointerenter = null;
        canvas.onpointerleave = null;
        canvas.onpointermove = null;
        canvas.onwheel = null; // qol: remove the wheel hook listener
        canvas.removeEventListener('touchend', this.touchEndHandler);
        canvas.oncontextmenu = null;
        window.onmouseup = null;
        window.onmousemove = null;
        window.oncontextmenu = null;
    }

    protected setFramerate(rate: number) {
        this.deltime = (1000 / rate) | 0;
    }

    protected setTargetedFramerate(rate: number) {
        this.tfps = Math.max(Math.min(50, rate | 0), 0);
    }

    protected start() {
        if (this.state >= 0) {
            this.state = 0;
        }
    }

    protected stop() {
        if (this.state >= 0) {
            this.state = (4000 / this.deltime) | 0;
        }
    }

    protected async drawProgress(message: string, progress: number): Promise<void> {
        const width: number = this.sWid;
        const height: number = this.sHei;

        if (this.fullredraw) {
            canvas2d.fillStyle = 'black';
            canvas2d.fillRect(0, 0, width, height);
            this.fullredraw = false;
        }

        const y: number = height / 2 - 18;

        // draw full progress bar
        canvas2d.strokeStyle = 'rgb(140, 17, 17)';
        canvas2d.strokeRect(((width / 2) | 0) - 152, y, 304, 34);
        canvas2d.fillStyle = 'rgb(140, 17, 17)';
        canvas2d.fillRect(((width / 2) | 0) - 150, y + 2, progress * 3, 30);

        // cover up progress bar
        canvas2d.fillStyle = 'black';
        canvas2d.fillRect(((width / 2) | 0) - 150 + progress * 3, y + 2, 300 - progress * 3, 30);

        // draw text
        canvas2d.font = 'bold 13px helvetica, sans-serif';
        canvas2d.textAlign = 'center';
        canvas2d.fillStyle = 'white';
        canvas2d.fillText(message, (width / 2) | 0, y + 22);

        await sleep(5); // return a slice of time to the main loop so it can update the progress bar
    }

    // ----

    // qol: wheel listener; canvas-relative coords, native delta signs, consumed -> no page scroll
    private onqolwheelEvent(e: WheelEvent) {
        if (this.onqolwheel === null) {
            return;
        }

        this.getMousePos(e);

        if (this.onqolwheel(e.deltaX, e.deltaY, this.absMouseX, this.absMouseY)) {
            e.preventDefault();
        }
    }

    // qol: mirror native modifier flags (ch<30 zeroing makes keyQueue unusable for them)
    private qolModifiersFrom(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }) {
        this.shiftHeld = e.shiftKey;
        this.altHeld = e.altKey;
        this.ctrlHeld = e.ctrlKey;
    }

    private onmousedown(e: MouseEvent) {
        if (e.clientX < 0 || e.clientY < 0) {
            return;
        }

        this.getMousePos(e);

        this.qolModifiersFrom(e); // qol: track shift/alt/ctrl from the native event

        this.mouseDown(this.absMouseX, this.absMouseY, e);
    }

    protected mouseDown(x: number, y: number, e: MouseEvent) {
        this.idleTimer = performance.now();
        this.nextMouseClickX = x;
        this.nextMouseClickY = y;
        this.nextMouseClickTime = performance.now();

        // custom: down event comes before and potentially without move event
        this.mouseX = x;
        this.mouseY = y;

        if (e.button === 2) {
            this.nextMouseClickButton = 2;
            this.mouseButton = 2;
        } else if (e.button === 1) {
            // qol: middle button gets its own code (3) so vanilla — which maps
            // every non-right press to left — never sees it, and the QoL click
            // hook receives button 3. preventDefault kills the browser's
            // middle-click autoscroll.
            e.preventDefault();
            this.nextMouseClickButton = 3;
            this.mouseButton = 3;
        } else {
            this.nextMouseClickButton = 1;
            this.mouseButton = 1;
        }
    }

    private onpointerdown(e: PointerEvent) {
        if (e.clientX < 0 || e.clientY < 0) {
            return;
        }

        this.getMousePos(e);

        // qol: middle button — cancel before the default autoscroll kicks in;
        // preventDefault here also suppresses the compat mousedown, so mirror
        // the button state that mouseDown() would have set (its own middle
        // branch covers browsers that still deliver it).
        if (e.button === 1) {
            e.preventDefault();

            this.idleTimer = performance.now();
            this.nextMouseClickX = this.absMouseX;
            this.nextMouseClickY = this.absMouseY;
            this.nextMouseClickTime = performance.now();
            this.mouseX = this.absMouseX;
            this.mouseY = this.absMouseY;
            this.nextMouseClickButton = 3;
            this.mouseButton = 3;
        }

        this.qolModifiersFrom(e); // qol: track shift/alt/ctrl from the native event

        this.pointerDown(this.absMouseX, this.absMouseY, e);
    }

    protected pointerDown(_x: number, _y: number, _e: PointerEvent) {
    }

    private onmouseup(e: MouseEvent) {
        this.getMousePos(e);

        this.mouseUp(this.absMouseX, this.absMouseY, e);
    }

    protected mouseUp(x: number, y: number, e: MouseEvent) {
        this.idleTimer = performance.now();
        this.mouseButton = 0;

        // custom: up event comes before and potentially without move event
        this.mouseX = x;
        this.mouseY = y;
    }

    private onpointerup(e: PointerEvent) {
        this.getMousePos(e);

        // qol: the suppressed compat mouseup for middle clicks still must release held state
        if (e.button === 1) {
            this.idleTimer = performance.now();
            this.mouseButton = 0;
            this.mouseX = this.absMouseX;
            this.mouseY = this.absMouseY;
        }

        this.pointerUp(this.absMouseX, this.absMouseY, e);
    }

    protected pointerUp(_x: number, _y: number, _e: PointerEvent) {
    }

    private onpointerenter(e: PointerEvent) {
        if (e.clientX < 0 || e.clientY < 0) {
            return;
        }

        this.getMousePos(e);

        this.pointerEnter(this.absMouseX, this.absMouseY, e);
    }

    protected pointerEnter(x: number, y: number, _e: PointerEvent) {
        this.mouseX = x;
        this.mouseY = y;
    }

    private onpointerleave(e: PointerEvent) {
        this.pointerLeave(e);
    }

    protected pointerLeave(_e: PointerEvent) {
        this.idleTimer = performance.now();
        this.mouseX = -1;
        this.mouseY = -1;

        // custom: moving off-canvas may have a stuck mouse event
        this.nextMouseClickX = -1;
        this.nextMouseClickY = -1;
        this.nextMouseClickButton = 0;
        this.mouseButton = 0;
    }

    private onpointermove(e: PointerEvent) {
        if (e.clientX < 0 || e.clientY < 0) {
            return;
        }

        this.getMousePos(e);

        this.pointerMove(this.absMouseX, this.absMouseY, e);
    }

    protected pointerMove(x: number, y: number, e: PointerEvent) {
        this.idleTimer = performance.now();
        this.mouseX = x;
        this.mouseY = y;
    }

    protected windowMouseUp(e: MouseEvent) {
    }

    protected windowMouseMove(e: MouseEvent) {
    }

    private onkeydown(e: KeyboardEvent) {
        this.idleTimer = performance.now();

        this.qolModifiersFrom(e); // qol: track shift/alt/ctrl from the native event

        const keyCode = KeyCodes.get(e.key);
        if (!keyCode || (e.code.length === 0 && !e.isTrusted)) {
            return;
        }

        let ch: number = keyCode.ch;

        if (e.ctrlKey) {
            if ((ch >= 'A'.charCodeAt(0) && ch <= ']'.charCodeAt(0)) || ch == '_'.charCodeAt(0)) {
                ch -= 'A'.charCodeAt(0) - 1;
            } else if (ch >= 'a'.charCodeAt(0) && ch <= 'z'.charCodeAt(0)) {
                ch -= 'a'.charCodeAt(0) - 1;
            }
        }

        if (ch < 30) {
            ch = 0;
        }

        // qol: ESC is a UI key (settings panel close) — without this the ch<30
        // control-char zeroing drops it before the key queue ever sees it.
        if (keyCode.code === 27) {
            ch = 27;
        }

        if (keyCode.code === 37) {
            ch = 1;
        } else if (keyCode.code === 39) {
            ch = 2;
        } else if (keyCode.code === 38) {
            ch = 3;
        } else if (keyCode.code === 40) {
            ch = 4;
        } else if (keyCode.code === 17) {
            ch = 5;
        } else  if (keyCode.code === 8 || keyCode.code === 127) {
            ch = 8;
        } else if (keyCode.code === 9) {
            ch = 9;
        } else if (keyCode.code === 10) {
            ch = 10;
        }

        if (ch > 0 && ch < 128) {
            this.keyHeld[ch] = 1;
        }

        if (ch > 4) {
            this.keyQueue[this.keyQueueWritePos] = ch;
            this.keyQueueWritePos = (this.keyQueueWritePos + 1) & 0x7f;
        }

        if (!CanvasEnabledKeys.includes(e.key)) {
            e.preventDefault();
        }
    }

    private onkeyup(e: KeyboardEvent) {
        // if (e.isTrusted && MobileKeyboard.isDisplayed()) {
        //     // physical keyboard started typing, hide virtual
        //     MobileKeyboard.hide();
        //     this.refresh();
        // }

        this.idleTimer = performance.now();

        this.qolModifiersFrom(e); // qol: track shift/alt/ctrl from the native event

        const keyCode = KeyCodes.get(e.key);
        if (!keyCode || (e.code.length === 0 && !e.isTrusted)) {
            return;
        }

        let ch: number = keyCode.ch;

        if (e.ctrlKey) {
            if ((ch >= 'A'.charCodeAt(0) && ch <= ']'.charCodeAt(0)) || ch == '_'.charCodeAt(0)) {
                ch -= 'A'.charCodeAt(0) - 1;
            } else if (ch >= 'a'.charCodeAt(0) && ch <= 'z'.charCodeAt(0)) {
                ch -= 'a'.charCodeAt(0) - 1;
            }
        }

        if (ch < 30) {
            ch = 0;
        }

        // qol: ESC is a UI key (settings panel close) — without this the ch<30
        // control-char zeroing drops it before the key queue ever sees it.
        if (keyCode.code === 27) {
            ch = 27;
        }

        if (keyCode.code === 37) {
            ch = 1;
        } else if (keyCode.code === 39) {
            ch = 2;
        } else if (keyCode.code === 38) {
            ch = 3;
        } else if (keyCode.code === 40) {
            ch = 4;
        } else if (keyCode.code === 17) {
            ch = 5;
        } else  if (keyCode.code === 8 || keyCode.code === 127) {
            ch = 8;
        } else if (keyCode.code === 9) {
            ch = 9;
        } else if (keyCode.code === 10) {
            ch = 10;
        }

        if (ch > 0 && ch < 128) {
            this.keyHeld[ch] = 0;
        }

        if (!CanvasEnabledKeys.includes(e.key)) {
            e.preventDefault();
        }
    }

    protected pollKey() {
        let key: number = -1;
        if (this.keyQueueWritePos !== this.keyQueueReadPos) {
            key = this.keyQueue[this.keyQueueReadPos];
            this.keyQueueReadPos = (this.keyQueueReadPos + 1) & 0x7f;
        }
        return key;
    }

    private onfocus(_e: FocusEvent) {
        this.focus = true;
        this.fullredraw = true;
        this.refresh();
    }

    private onblur(_e: FocusEvent) {
        this.focus = false;

        // custom: taken from later version to release all keys
        for (let i = 0; i < 128; i++) {
            this.keyHeld[i] = 0;
        }
    }

    // ----

    private get hasTouchEvents() {
        return 'ontouchstart' in window;
    }

    private get isTouchDevice() {
        return (
            this.hasTouchEvents ||
            navigator.maxTouchPoints > 0 ||
            (navigator as any).msMaxTouchPoints > 0
        );
    }

    protected get isMobile(): boolean {
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone|Mobile/i.test(navigator.userAgent)) {
            return true;
        }

        return this.isTouchDevice;
    }

    private isFullScreen() {
        return document.fullscreenElement !== null;
    }

    private getMousePos(e: MouseEvent): void {
        const fixedWidth: number = this.sWid;
        const fixedHeight: number = this.sHei;

        const canvasBounds: DOMRect = canvas.getBoundingClientRect();
        const clickX = e.clientX - canvasBounds.left;
        const clickY = e.clientY - canvasBounds.top;
        let x = 0;
        let y = 0;

        if (this.isFullScreen()) {
            // Fullscreen logic will ensure the canvas aspect ratio is
            // preserved, centering the canvas on the screen.
            const gameAspectRatio = fixedWidth / fixedHeight;
            const ourAspectRatio = window.innerWidth / window.innerHeight;

            // Determine whether our aspect ratio is wider than canvas' one.
            const wider = ourAspectRatio >= gameAspectRatio;

            let trueCanvasWidth = 0;
            let trueCanvasHeight = 0;
            let offsetX = 0;
            let offsetY = 0;

            if (wider) {
                // Browser will scale canvas according to _height_.
                trueCanvasWidth = window.innerHeight * gameAspectRatio;
                trueCanvasHeight = window.innerHeight;
                // As such, there will be a gap on the X axis either side.
                offsetX = (window.innerWidth - trueCanvasWidth) / 2;
            } else {
                // Browser will scale canvas according to _width_.
                trueCanvasWidth = window.innerWidth;
                trueCanvasHeight = window.innerWidth / gameAspectRatio;
                // As such, there will be a gap on the Y axis either side.
                offsetY = (window.innerHeight - trueCanvasHeight) / 2;
            }
            const scaleX = fixedWidth / trueCanvasWidth;
            const scaleY = fixedHeight / trueCanvasHeight;
            x = ((clickX - offsetX) * scaleX) | 0;
            y = ((clickY - offsetY) * scaleY) | 0;
        } else {
            const scaleX: number = canvas.width / canvasBounds.width;
            const scaleY: number = canvas.height / canvasBounds.height;
            x = (clickX * scaleX) | 0;
            y = (clickY * scaleY) | 0;
        }

        // Specifically filter events outside of bounds of canvas; this can
        // happen if fullscreen mode is on due to letterboxing! The result is
        // that the mouse appears to move up/down vertically along X:0 if they
        // move mouse on the black section to the left, vice versa for other
        // sides, depending on aspect ratio.
        if (x < 0) {
            x = 0;
        }

        if (x > fixedWidth) {
            x = fixedWidth;
        }

        if (y < 0) {
            y = 0;
        }

        if (y > fixedHeight) {
            y = fixedHeight;
        }

        this.absMouseX = x;
        this.absMouseY = y;
    }
}

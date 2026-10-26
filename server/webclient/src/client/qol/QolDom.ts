// DOM overlay layer for qol widgets that should NOT consume viewport space:
// HP/Prayer orbs on the frame beside the minimap, and dockable XP tracker /
// stat timer panels that float OUTSIDE the canvas when the window is wide
// enough (falling back to in-viewport canvas drawing when it is not).
//
// Why DOM: the scene buffer is a fixed 512x334 inside a fixed 765x503 frame,
// so anything drawn through QolGraphics either eats game pixels or needs the
// fragile getImageData tile hack (removed). Absolutely-positioned divs over
// the canvas are crisp at any display scale, clickable without hook plumbing,
// and can sit on the stone frame or beside the client entirely.
//
// The layer is a single position:fixed container (pointer-events none) whose
// children are placed in CANVAS BUFFER coordinates (765x503) and converted to
// page pixels from the canvas bounding rect on resize/scroll. Widgets update
// at tick cadence, not per frame.

/** One managed widget. */
export interface QolDomWidget {
    readonly el: HTMLDivElement;
    /** Stable id for position persistence ('' = not persisted/draggable). */
    readonly id: string;
    /** Buffer-space anchor (765x503 coords); may be outside for docks. */
    x: number;
    y: number;
    /** When true the widget prefers docking outside the canvas (right side). */
    dockOutside: boolean;
    visible: boolean;
    /** True while the user is dragging; layout() leaves the widget alone. */
    dragging: boolean;
}

const CONTAINER_ID = 'qol-dom-layer';

export class QolDom {
    private container: HTMLDivElement | null = null;
    private readonly widgets: QolDomWidget[] = [];
    private canvas: HTMLCanvasElement | null = null;
    private rectLeft = 0;
    private rectTop = 0;
    private scaleX = 1;
    private scaleY = 1;
    private rectDirty = true;
    private drag: { w: QolDomWidget; startX: number; startY: number; offX: number; offY: number; active: boolean } | null = null;
    private readonly onMove = (): void => {
        this.rectDirty = true;
    };

    private static readonly POS_KEY = 'rs-qol-dompos-v1';

    private static readPos(id: string): { x: number; y: number } | null {
        try {
            const raw = window.localStorage.getItem(QolDom.POS_KEY);
            if (raw === null) {
                return null;
            }
            const all = JSON.parse(raw) as Record<string, unknown>;
            const p = all[id] as { x?: unknown; y?: unknown } | undefined;
            if (p !== undefined && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
                return { x: p.x, y: p.y };
            }
            return null;
        } catch {
            return null;
        }
    }

    private static savePos(id: string, x: number, y: number): void {
        try {
            let all: Record<string, unknown> = {};
            const raw = window.localStorage.getItem(QolDom.POS_KEY);
            if (raw !== null) {
                const parsed: unknown = JSON.parse(raw);
                if (parsed !== null && typeof parsed === 'object') {
                    all = parsed as Record<string, unknown>;
                }
            }
            all[id] = { x, y };
            window.localStorage.setItem(QolDom.POS_KEY, JSON.stringify(all));
        } catch {
            // storage unavailable - the drag still works for this session
        }
    }

    private widgetById(id: string): QolDomWidget | null {
        for (let i = 0; i < this.widgets.length; i++) {
            if (this.widgets[i].id === id) {
                return this.widgets[i];
            }
        }
        return null;
    }

    private refreshRect(): void {
        if (this.canvas === null) {
            return;
        }
        const r = this.canvas.getBoundingClientRect();
        this.rectLeft = r.left;
        this.rectTop = r.top;
        this.scaleX = r.width / 765;
        this.scaleY = r.height / 503;
        this.rectDirty = false;
    }

    private startDrag(id: string, ev: MouseEvent): void {
        const w = this.widgetById(id);
        if (w === null || !w.visible || this.drag !== null) {
            return;
        }
        ev.preventDefault();
        this.drag = { w, startX: ev.clientX, startY: ev.clientY, offX: 0, offY: 0, active: false };
        window.addEventListener('mousemove', this.onDragMove);
        window.addEventListener('mouseup', this.onDragEnd);
    }

    private readonly onDragMove = (ev: MouseEvent): void => {
        const d = this.drag;
        if (d === null) {
            return;
        }
        if (!d.active) {
            // Sub-threshold motion is still a click, not a drag.
            if (Math.abs(ev.clientX - d.startX) < 4 && Math.abs(ev.clientY - d.startY) < 4) {
                return;
            }
            d.active = true;
            d.w.dragging = true;
            this.refreshRect();
            d.offX = d.w.el.offsetLeft - ev.clientX;
            d.offY = d.w.el.offsetTop - ev.clientY;
        }
        ev.preventDefault();
        d.w.el.style.left = (ev.clientX + d.offX).toFixed(1) + 'px';
        d.w.el.style.top = (ev.clientY + d.offY).toFixed(1) + 'px';
    };

    private readonly onDragEnd = (): void => {
        window.removeEventListener('mousemove', this.onDragMove);
        window.removeEventListener('mouseup', this.onDragEnd);
        const d = this.drag;
        this.drag = null;
        if (d === null || !d.active) {
            return; // plain click: let the event through untouched
        }
        const w = d.w;
        w.dragging = false;
        // Clamp inside the viewport, then convert page px -> buffer coords.
        this.refreshRect();
        const left = Math.min(Math.max(0, w.el.offsetLeft), Math.max(0, window.innerWidth - w.el.offsetWidth));
        const top = Math.min(Math.max(0, w.el.offsetTop), Math.max(0, window.innerHeight - w.el.offsetHeight));
        w.el.style.left = left.toFixed(1) + 'px';
        w.el.style.top = top.toFixed(1) + 'px';
        w.x = Math.round((left - this.rectLeft) / this.scaleX);
        w.y = Math.round((top - this.rectTop) / this.scaleY);
        w.dockOutside = false;
        QolDom.savePos(w.id, w.x, w.y);
        // The browser fires a click for the mousedown that ended the drag;
        // swallow it once (capture phase) so an orb tab-switch or a panel's
        // collapse toggle doesn't fire from the drop.
        document.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
        }, { capture: true, once: true });
    };

    /** Attach to the game canvas. No-op outside a browser. */
    attach(canvas: HTMLCanvasElement | null): void {
        if (typeof document === 'undefined' || canvas === null) {
            return;
        }
        this.canvas = canvas;
        let container = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
        if (container === null) {
            container = document.createElement('div');
            container.id = CONTAINER_ID;
            container.style.position = 'fixed';
            container.style.left = '0';
            container.style.top = '0';
            container.style.width = '0';
            container.style.height = '0';
            container.style.overflow = 'visible';
            container.style.pointerEvents = 'none';
            container.style.zIndex = '50';
            document.body.appendChild(container);
        }
        this.container = container;
        window.addEventListener('resize', this.onMove);
        window.addEventListener('scroll', this.onMove, true);
        this.rectDirty = true;
    }

    detach(): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.onMove);
            window.removeEventListener('scroll', this.onMove, true);
            if (this.drag !== null) {
                window.removeEventListener('mousemove', this.onDragMove);
                window.removeEventListener('mouseup', this.onDragEnd);
                this.drag.w.dragging = false;
                this.drag = null;
            }
        }
        if (this.container !== null && this.container.parentNode !== null) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.widgets.length = 0;
    }

    /** Create a widget; `html` is its initial inner markup. */
    /**
     * @param clickable when true the widget receives pointer events (the
     *   container is `pointer-events: none`, so without this a widget's click
     *   listeners never fire — e.g. the XP tracker's collapse toggle)
     * @param id stable widget id ('orbs', 'stat-timers', ...). When set, the
     *   widget is draggable and its dropped position survives reloads.
     */
    create(html: string, x: number, y: number, dockOutside: boolean = false, clickable: boolean = false, id: string = ''): QolDomWidget | null {
        if (this.container === null) {
            return null;
        }
        // A user-dropped position wins over the default anchor/dock.
        if (id !== '') {
            const saved = QolDom.readPos(id);
            if (saved !== null) {
                x = saved.x;
                y = saved.y;
                dockOutside = false;
            }
        }
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.pointerEvents = clickable ? 'auto' : 'none';
        el.style.display = 'none';
        // The container is a 0x0 anchor; without an explicit width the
        // widget shrink-fits to ~0 and its text wraps one word per line.
        el.style.width = 'max-content';
        el.innerHTML = html;
        if (id !== '') {
            el.addEventListener('mousedown', (ev: MouseEvent) => this.startDrag(id, ev));
        }
        this.container.appendChild(el);
        const w: QolDomWidget = { el, id, x, y, dockOutside, visible: false, dragging: false };
        this.widgets.push(w);
        this.rectDirty = true;
        return w;
    }

    remove(w: QolDomWidget | null): void {
        if (w === null) {
            return;
        }
        const i = this.widgets.indexOf(w);
        if (i !== -1) {
            this.widgets.splice(i, 1);
        }
        if (w.el.parentNode !== null) {
            w.el.parentNode.removeChild(w.el);
        }
    }

    show(w: QolDomWidget, visible: boolean): void {
        w.visible = visible;
        w.el.style.display = visible ? 'block' : 'none';
    }

    /** Reposition all visible widgets; call at tick cadence (cheap: few nodes). */
    layout(): void {
        if (this.container === null || this.canvas === null) {
            return;
        }
        if (this.rectDirty) {
            this.refreshRect();
        }

        const winW = typeof window !== 'undefined' ? window.innerWidth : 765;
        const canvasRight = this.rectLeft + 765 * this.scaleX;

        // Outside docks stack vertically beside the canvas (right edge first,
        // left edge when the window is wider than it is tall) so several
        // floating panels never overlap and no game pixels are consumed.
        let rightTop: number | null = null;
        let leftTop: number | null = null;

        for (let i = 0; i < this.widgets.length; i++) {
            const w = this.widgets[i];
            if (!w.visible || w.dragging) {
                continue;
            }
            let left: number;
            let top: number;
            if (w.dockOutside && canvasRight + 8 + w.el.offsetWidth < winW - 2) {
                // Float to the right of the client.
                left = canvasRight + 8;
                if (rightTop === null) {
                    rightTop = this.rectTop + 6;
                }
                top = rightTop;
                rightTop = top + w.el.offsetHeight + 8;
            } else if (w.dockOutside && this.rectLeft - 8 - w.el.offsetWidth > 2) {
                // Float to the left of the client (wide-short windows).
                left = this.rectLeft - 8 - w.el.offsetWidth;
                if (leftTop === null) {
                    leftTop = this.rectTop + 6;
                }
                top = leftTop;
                leftTop = top + w.el.offsetHeight + 8;
            } else {
                // On the frame (orbs) or in-viewport fallback when docking
                // outside doesn't fit: use the widget's buffer-space anchor.
                left = this.rectLeft + w.x * this.scaleX;
                top = this.rectTop + w.y * this.scaleY;
            }
            const ls = left.toFixed(1) + 'px';
            const ts = top.toFixed(1) + 'px';
            if (w.el.style.left !== ls) {
                w.el.style.left = ls;
            }
            if (w.el.style.top !== ts) {
                w.el.style.top = ts;
            }
        }
    }
}

/** Shared 2004-flavoured widget chrome. */
export const QOL_DOM_CSS = `
.qol-panel { background: rgba(30,26,20,0.88); border: 1px solid #5d5447; box-shadow: 0 0 0 1px #17130e;
  padding: 5px 7px; font: 11px/1.45 'Segoe UI', system-ui, sans-serif; color: #fff; min-width: 150px;
  text-shadow: 1px 1px 0 #000; border-radius: 2px; }
.qol-panel .qol-h { color: #ffb000; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.qol-panel .qol-row { display: flex; justify-content: space-between; gap: 10px; white-space: pre; }
.qol-panel .qol-dim { color: #9c9384; }
.qol-panel .qol-yel { color: #ffff00; }
.qol-panel .qol-cyn { color: #00ffff; }
.qol-panel .qol-grn { color: #00ff00; }
.qol-panel .qol-red { color: #ff4040; }
.qol-orbwrap { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.qol-orb { pointer-events: auto; cursor: pointer; width: 30px; height: 30px; border-radius: 50%;
  border: 2px solid #17130e; box-shadow: 0 0 0 1px #766654, inset 0 0 6px #000; position: relative;
  background: #241f19; overflow: hidden; }
.qol-orb .fill { position: absolute; left: 0; right: 0; bottom: 0; }
.qol-orb .num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font: bold 10px 'Segoe UI', system-ui, sans-serif; color: #fff; text-shadow: 1px 1px 0 #000; }
`;

/** Inject the stylesheet once. */
export function qolDomEnsureCss(): void {
    if (typeof document === 'undefined' || document.getElementById('qol-dom-css') !== null) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'qol-dom-css';
    style.textContent = QOL_DOM_CSS;
    document.head.appendChild(style);
}

// Pix2D/PixFont wrapper for QoL overlays (docs/qol-features-plan.md §2.2).
//
// All drawing goes into whatever buffer Pix2D currently targets. During the
// `drawScene`/`drawTop` dispatches inside `Client.gameDrawMain()` that is the
// 512x334 scene buffer (`areaGame`), so coordinates are viewport-local:
// screen pixel = buffer pixel + (4, 4).
//
// Translucency: Pix2D already blends (`fillRectTrans`, `drawRectTrans`,
// `hlineTrans`, `vlineTrans`, `fillCircle`, all with alpha 0..256) and Pix3D
// has the same 8-bit `trans` blending for 3D fills. There is no per-pixel
// alpha texture format, so the stipple helpers below are provided as the
// frame-independent 50%-darkening fallback the plan anticipates (§6).

import Pix2D from '#/graphics/Pix2D.js';
import type PixFont from '#/graphics/PixFont.js';
import type Pix32 from '#/graphics/Pix32.js';
import type Pix8 from '#/graphics/Pix8.js';

/** Saved Pix2D clip rectangle on the `pushClip` stack. */
interface ClipRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/**
 * Stateless-in-the-game sense drawing facade: one shared instance is passed to
 * draw hooks and exposed on `QolContext.g`. It reads the live Pix2D clip/buffer
 * on every call, so it follows whichever area buffer the client targets.
 */
export class QolGraphics {
    /** Clip stack; `pushClip`/`popClip` are re-entrant. */
    private readonly clips: ClipRect[] = [];
    /** Reused corner buffers so the hot `fillQuad` path allocates nothing. */
    private readonly qxs: number[] = [0, 0, 0, 0];
    private readonly qys: number[] = [0, 0, 0, 0];

    /** Current target width (the scene buffer is 512 during draw hooks). */
    get width(): number {
        return Pix2D.width;
    }

    /** Current target height (the scene buffer is 334 during draw hooks). */
    get height(): number {
        return Pix2D.height;
    }

    /** Solid rectangle in the current clip. */
    fillRect(x: number, y: number, width: number, height: number, rgb: number): void {
        Pix2D.fillRect(x, y, width, height, rgb);
    }

    /** Alpha-blended rectangle; `alpha` is 0 (invisible) .. 256 (opaque). */
    fillRectTrans(x: number, y: number, width: number, height: number, rgb: number, alpha: number): void {
        if (alpha <= 0) {
            return;
        }
        if (alpha >= 256) {
            Pix2D.fillRect(x, y, width, height, rgb);
            return;
        }
        Pix2D.fillRectTrans(x, y, width, height, rgb, alpha);
    }

    /** 1px rectangle outline. */
    drawRect(x: number, y: number, width: number, height: number, rgb: number): void {
        Pix2D.drawRect(x, y, width, height, rgb);
    }

    /** Alpha-blended 1px rectangle outline. */
    drawRectTrans(x: number, y: number, width: number, height: number, rgb: number, alpha: number): void {
        if (alpha <= 0) {
            return;
        }
        if (alpha >= 256) {
            Pix2D.drawRect(x, y, width, height, rgb);
            return;
        }
        Pix2D.drawRectTrans(x, y, width, height, rgb, alpha);
    }

    /**
     * Checkerboard 50% fill — the per-pixel-alpha-free "translucent" fallback
     * the plan calls for (menu-dimming precedent). Cheap: one pass, alternating
     * runs, honoring the active clip through `Pix2D.hline`.
     */
    fillStipple(x: number, y: number, width: number, height: number, rgb: number): void {
        for (let row: number = 0; row < height; row++) {
            const parity: number = row & 1;
            for (let col: number = parity; col < width; col += 2) {
                Pix2D.hline(x + col, y + row, 1, rgb);
            }
        }
    }

    /**
     * Vertical two-color gradient rectangle, row blended in 8-bit fixed point
     * like `fillRectTrans`. Rows = clipped height, so cost is bounded and this
     * is only used for panel headers etc.
     */
    fillGradientRect(x: number, y: number, width: number, height: number, rgbTop: number, rgbBottom: number): void {
        if (height <= 0 || width <= 0) {
            return;
        }
        for (let row: number = 0; row < height; row++) {
            const t: number = height === 1 ? 0 : ((row << 8) / (height - 1)) | 0;
            const inv: number = 256 - t;
            const r: number = ((((rgbTop >> 16) & 0xff) * inv + ((rgbBottom >> 16) & 0xff) * t) >> 8) & 0xff;
            const g: number = ((((rgbTop >> 8) & 0xff) * inv + ((rgbBottom >> 8) & 0xff) * t) >> 8) & 0xff;
            const b: number = (((rgbTop & 0xff) * inv + (rgbBottom & 0xff) * t) >> 8) & 0xff;
            Pix2D.hline(x, y + row, width, (r << 16) | (g << 8) | b);
        }
    }

    /** Text with optional drop shadow; `@col@` tags are interpreted (drawStringTag). */
    text(font: PixFont, str: string, x: number, y: number, rgb: number, shadow: boolean = true): void {
        font.drawStringTag(str, x, y, rgb, shadow);
    }

    /** Centered text (`x` is the center, like `centreStringTag`). */
    centreText(font: PixFont, str: string, x: number, y: number, rgb: number, shadow: boolean = true): void {
        font.centreStringTag(str, x, y, rgb, shadow);
    }

    /** Measured pixel width of `str`. */
    textWidth(font: PixFont, str: string): number {
        return font.stringWid(str);
    }

    /** Blit a packed sprite at its top-left; alpha-ish pixels are skipped by the sprite itself. */
    drawSprite(sprite: Pix32 | Pix8, x: number, y: number): void {
        sprite.plotSprite(x, y);
    }

    /** Push a clip rect (x, y, w, h); draws are limited to it until `popClip`. */
    pushClip(x: number, y: number, width: number, height: number): void {
        this.clips.push({ x1: Pix2D.clipMinX, y1: Pix2D.clipMinY, x2: Pix2D.clipMaxX, y2: Pix2D.clipMaxY });
        Pix2D.setClipping(x, y, x + width, y + height);
    }

    /** Restore the clip rect saved by the matching `pushClip`. */
    popClip(): void {
        const rect = this.clips.pop();
        if (rect === undefined) {
            Pix2D.resetClipping();
            return;
        }
        Pix2D.setClipping(rect.x1, rect.y1, rect.x2, rect.y2);
    }

    /** Drop the whole clip stack and clip to the full buffer. */
    resetClip(): void {
        this.clips.length = 0;
        Pix2D.setClipping(0, 0, Pix2D.width, Pix2D.height);
    }

    /**
     * Scanline convex-quadrilateral fill (tile diamonds for C8's markers).
     * Writes directly into `Pix2D.pixels` the way `fillRect` does, honoring the
     * current clip rectangle. Corners may be in any winding; non-convex input
     * is undefined behaviour (a quad from four projected tile corners is
     * always convex).
     */
    fillQuad(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, rgb: number): void {
        this.quad(x1, y1, x2, y2, x3, y3, x4, y4, rgb, 256);
    }

    /** `fillQuad` with blending; `alpha` 0..256. */
    fillQuadTrans(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, rgb: number, alpha: number): void {
        if (alpha <= 0) {
            return;
        }
        this.quad(x1, y1, x2, y2, x3, y3, x4, y4, rgb, alpha);
    }

    // ---- internals ----

    /**
     * Alpha-aware scanline fill. `alpha` 256 takes the fast overwrite path.
     * Each scanline of a convex quad crosses exactly two edges between the
     * sample rows, so collecting edge intersections per row is complete.
     */
    private quad(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, rgb: number, alpha: number): void {
        // Corners of the quad polygon in order (reused buffers, no allocation).
        const xs = this.qxs;
        const ys = this.qys;
        xs[0] = x1;
        ys[0] = y1;
        xs[1] = x2;
        ys[1] = y2;
        xs[2] = x3;
        ys[2] = y3;
        xs[3] = x4;
        ys[3] = y4;

        let minY: number = Math.min(y1, y2, y3, y4);
        let maxY: number = Math.max(y1, y2, y3, y4);
        if (minY < Pix2D.clipMinY) {
            minY = Pix2D.clipMinY;
        }
        // Exclusive upper bound: Pix2D.clipMaxY is one past the last row.
        if (maxY > Pix2D.clipMaxY) {
            maxY = Pix2D.clipMaxY;
        }
        if (maxY <= minY) {
            return;
        }

        const blend: boolean = alpha < 256;
        const invAlpha: number = 256 - alpha;
        const r0: number = ((rgb >> 16) & 0xff) * alpha;
        const g0: number = ((rgb >> 8) & 0xff) * alpha;
        const b0: number = (rgb & 0xff) * alpha;
        const pixels: Int32Array = Pix2D.pixels;
        const width: number = Pix2D.width;

        for (let y: number = Math.ceil(minY); y < maxY; y++) {
            const cy: number = y + 0.5;
            if (cy < minY || cy >= maxY) {
                continue;
            }

            // Intersections of the horizontal sample line with each edge.
            let ix0: number = 0;
            let ix1: number = 0;
            let crossings: number = 0;

            for (let e: number = 0; e < 4; e++) {
                const ay: number = ys[e];
                const by: number = ys[(e + 1) & 3];
                if (ay === by) {
                    continue;
                }
                if ((cy >= ay && cy < by) || (cy >= by && cy < ay)) {
                    const t: number = (cy - ay) / (by - ay);
                    const x: number = xs[e] + t * (xs[(e + 1) & 3] - xs[e]);
                    if (crossings === 0) {
                        ix0 = x;
                    } else {
                        ix1 = x;
                    }
                    crossings++;
                    if (crossings > 2) {
                        // Not convex-as-documented: bail rather than fill garbage.
                        break;
                    }
                }
            }

            if (crossings !== 2) {
                continue;
            }

            if (ix0 > ix1) {
                const tmp: number = ix0;
                ix0 = ix1;
                ix1 = tmp;
            }

            let startX: number = Math.floor(ix0);
            let endX: number = Math.ceil(ix1);
            if (startX < Pix2D.clipMinX) {
                startX = Pix2D.clipMinX;
            }
            if (endX > Pix2D.clipMaxX) {
                endX = Pix2D.clipMaxX;
            }

            let off: number = startX + y * width;
            for (let x: number = startX; x < endX; x++, off++) {
                if (!blend) {
                    pixels[off] = rgb;
                    continue;
                }
                const dst: number = pixels[off];
                pixels[off] =
                    ((((r0 + (((dst >> 16) & 0xff) * invAlpha)) >> 8) << 16) & 0xff0000) |
                    ((((g0 + (((dst >> 8) & 0xff) * invAlpha)) >> 8) << 8) & 0xff00) |
                    (((b0 + ((dst & 0xff) * invAlpha)) >> 8)) & 0xff;
            }
        }
    }
}

export default QolGraphics;

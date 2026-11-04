/**
 * Photo mode, pure part (backlog KB-I47, visual-audit §5.11 / P14): sample plan for the accumulated still, the
 * sub-pixel jitter and thin-lens aperture offsets, the projection shift that keeps the focus plane fixed, the output
 * size, and the burned-in German text. No three.js, no DOM (tests: viewer/tests/photo.test.ts).
 *
 * Technique: supersampling by accumulating jittered frames (as TAA does over time, here all at one camera; Yang,
 * Nehab & Sander 2009, "Amortized supersampling", https://doi.org/10.1145/1618452.1618481) and depth of field by
 * accumulating views from points on the lens with the frustum sheared so the focus plane projects identically
 * (the accumulation-buffer method; Haeberli & Akeley 1990, "The accumulation buffer",
 * https://doi.org/10.1145/97880.97913).
 */
import { STAR_ATTRIBUTION } from './starCatalogue.ts';

/** Radical inverse of i in base b (Halton sequence, i ≥ 1). */
export function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  let n = i;
  while (n > 0) {
    f /= b;
    r += f * (n % b);
    n = Math.floor(n / b);
  }
  return r;
}

/** Sub-pixel jitter of sample k (0-based): Halton (2, 3), centred on the pixel, in pixels (−0.5…0.5). */
export function pixelJitter(k: number): [number, number] {
  return [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Lens offset of sample k of n on a disc of radius r (golden-angle spiral, even coverage at any n). */
export function lensOffset(k: number, n: number, r: number): [number, number] {
  if (!(r > 0) || n <= 1) return [0, 0];
  const rad = r * Math.sqrt((k + 0.5) / n);
  const a = k * GOLDEN_ANGLE;
  return [rad * Math.cos(a), rad * Math.sin(a)];
}

/**
 * Aperture radius (m) for a "mild" depth of field: a point at infinity blurs to a circle of `cocFrac` × image width
 * when the camera focuses at `focus` m. `p00` is the projection's x scale (1 / (aspect · tan(fov / 2))).
 * Derivation: a lens offset a shifts a point at depth d by p00 · a · |1/d − 1/F| in NDC (half-width units).
 */
export function apertureRadius(focus: number, p00: number, cocFrac = 0.0012): number {
  if (!(focus > 0) || !(p00 > 0)) return 0;
  return (2 * cocFrac * focus) / p00;
}

/**
 * Wave-7 review: with the camera focused far away (the autofocus picks the screen centre: 57 m across the Ehrenhof,
 * 141 m over the Weiher) the mild aperture blurred the whole foreground court or bank and the palace read as a
 * tilt-shift miniature, against the calm documentary target. Beyond `farFocus` m the aperture is limited so that
 * nothing from `near` m to infinity blurs by more than `maxBlurPx` output pixels (radius); a near subject keeps the
 * mild depth of field [I].
 */
export const PHOTO_DOF = { farFocus: 25, near: 15, maxBlurPx: 1.5 } as const;

/** Blur radius (output px, image `widthPx` wide) of a point at depth d for aperture a focused at F. */
export function blurPx(d: number, focus: number, a: number, p00: number, widthPx: number): number {
  return ((p00 * a) / 2) * Math.abs(1 / d - 1 / focus) * widthPx;
}

/** Aperture of a photo-mode still: the mild DOF, limited for far focus (PHOTO_DOF). */
export function photoAperture(focus: number, p00: number, widthPx: number): number {
  const a = apertureRadius(focus, p00);
  if (!(a > 0) || !(widthPx > 0) || focus <= PHOTO_DOF.farFocus) return a;
  const worst = Math.max(1 / PHOTO_DOF.near - 1 / focus, 1 / focus);
  return Math.min(a, (2 * PHOTO_DOF.maxBlurPx) / (p00 * worst * widthPx));
}

/**
 * Shift of a perspective projection (three.js column-major elements, modified in place) for one accumulation sample:
 * a sub-pixel jitter (jx, jy in pixels of a w × h image) and a lens offset (ax, ay in camera-space metres) whose
 * shear keeps the plane at distance `focus` fixed. With x_ndc = −(P[0]·x)/z − P[8], moving the eye by +ax and
 * setting P[8] −= P[0]·ax / focus maps every point at z = −focus to the same pixel.
 */
export function shiftProjection(e: number[] | Float32Array, jx: number, jy: number, w: number, h: number, ax = 0, ay = 0, focus = Infinity): void {
  const f = Number.isFinite(focus) && focus > 0 ? focus : Infinity;
  e[8] += (2 * jx) / w - (f === Infinity ? 0 : (e[0] * ax) / f);
  e[9] += (2 * jy) / h - (f === Infinity ? 0 : (e[5] * ay) / f);
}

/** NDC x of a camera-space point (x, z < 0) under projection elements e (for tests and focus checks). */
export function ndcX(e: ArrayLike<number>, x: number, z: number): number {
  return -(e[0] * x) / z - e[8];
}

export interface PhotoOptions {
  /** Render scale relative to CSS pixels (2 or 3). */
  scale: number;
  /** Mild depth of field (focus at the screen centre). */
  dof: boolean;
  /** Number of accumulated frames; default 16, 32 with DOF. */
  samples?: number;
}

export function sampleCount(o: PhotoOptions): number {
  return Math.max(1, Math.min(64, Math.round(o.samples ?? (o.dof ? 32 : 16))));
}

/** Output size in pixels: CSS size × scale, shrunk (aspect kept) to fit `maxSide` (GPU limit). */
export function photoSize(cssW: number, cssH: number, scale: number, maxSide = 8192): { w: number; h: number; scale: number } {
  let s = Math.max(1, scale);
  const big = Math.max(cssW, cssH) * s;
  if (big > maxSide) s = maxSide / Math.max(cssW, cssH);
  return { w: Math.floor(cssW * s), h: Math.floor(cssH * s), scale: s };
}

/** "15. Juli 1789, 17:30 Uhr" for an hour on the viewer's day. */
export function sceneTime(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const hh = m === 60 ? h + 1 : h;
  return `15. Juli 1789, ${String(hh).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} Uhr`;
}

/** File name of a still: schloss-karlsberg-1789_<hhmm>_<yyyymmdd-hhmmss>.png (scene hour, then capture time). */
export function photoFileName(hour: number, now: Date): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60) % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `schloss-karlsberg-1789_${p(h)}${p(m)}_${stamp}.png`;
}

/**
 * The text burned into every still (look-and-period.md §8): a label "Rekonstruktion – Hypothese" with the scene
 * time, and the attribution line (terrain data, textures, research, "Schauen, nicht graben").
 */
export function burnInText(hour: number, attribution: string): { label: string; sub: string; attribution: string } {
  return {
    label: 'Schloss Karlsberg um 1789 · Rekonstruktion – Hypothese',
    sub: `${sceneTime(hour)} · Gebäude und Gelände nach research/01–11, Konfidenz je Gebäude unterschiedlich`,
    attribution: footerParts(attribution).join(' · '),
  };
}

/**
 * The credit line of the live footer (hud.ts) and of the burned-in photo, as parts joined by " · " (the last one,
 * "Schauen, nicht graben", is bold in the footer). Wave-5 review: the photo's credit was shorter than the footer.
 */
export function footerParts(attribution: string): string[] {
  return [attribution, 'Texturen CC0 (Poly Haven, ambientCG)', STAR_ATTRIBUTION, 'Rekonstruktion: Hypothese nach research/01–11', 'Schauen, nicht graben'];
}

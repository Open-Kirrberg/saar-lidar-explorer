/**
 * Pure: resolution of `rgb` image textures (orthophoto, historic maps) per chunk by screen need
 * (perf pass). A chunk image of native side P₀ (manifest `pixelsPerChunk`) is decoded at one of
 * the tiers P₀, P₀/2, P₀/4 … (≥ MIN_TIER_PX): the smallest tier that still gives ≥ 1 texel per
 * screen pixel at the chunk's nearest point. With anisotropic filtering the GPU picks the mip by
 * the minor axis (across the view ray, ≈ viewportPx / (2·tan(fov/2)) / d px per metre), so a
 * larger texture would only add mip levels that are never sampled. No three.js / DOM.
 */

/** Smallest decoded image side (px per chunk side). */
export const MIN_TIER_PX = 125;

/** Decode tiers of an image with native side `native`, descending: P₀, P₀/2, … (integer, ≥ min). */
export function imageTiers(native: number, min = MIN_TIER_PX): number[] {
  const out = [native];
  for (let p = native / 2; Number.isInteger(p) && p >= min; p /= 2) out.push(p);
  return out;
}

/** Screen pixels per metre across the view ray at distance `dist` (m). */
export function screenPxPerMetre(viewportPx: number, fovDeg: number, dist: number): number {
  return viewportPx / (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(dist, 1);
}

/** Smallest tier ≥ `needPx` (px per chunk side); the native size if none is large enough. */
export function tierFor(tiers: readonly number[], needPx: number): number {
  let best = tiers[0];
  for (const t of tiers) if (t >= needPx && t < best) best = t;
  return best;
}

/** Downgrade band: a resident image shrinks only once its need is ≤ DOWN_BAND × the smaller tier. */
export const DOWN_BAND = 0.8;

/**
 * Target decode size for a resident image of side `current`, or null (keep it).
 * - need above `current` → upgrade to the tier for `needPx` (approaching camera);
 * - need ≤ DOWN_BAND × a smaller tier → downgrade to it (receding camera; the 20 % band stops a
 *   camera hovering at a tier boundary from re-decoding the image back and forth);
 * - `pressure` (resident set over budget) → downgrade straight to the tier for `needPx`.
 */
export function resizeTarget(tiers: readonly number[], current: number, needPx: number, pressure = false): number | null {
  const want = tierFor(tiers, needPx);
  if (want > current) return want;
  const down = pressure ? want : tierFor(tiers, needPx / DOWN_BAND);
  return down < current ? down : null;
}

/**
 * Resample an RGBA8 edge strip of `from` px to `to` px (image apron between chunks decoded at
 * different tiers). Down: box mean of the `from/to` source pixels under each target pixel. Up:
 * linear between pixel centres (target k at source position (k + 0.5)·from/to − 0.5, clamped).
 */
export function resampleStrip(src: Uint8ClampedArray, from: number, to: number): Uint8ClampedArray {
  if (from === to) return src;
  const out = new Uint8ClampedArray(to * 4);
  if (from > to) {
    const r = from / to;
    for (let k = 0; k < to; k++) {
      const a = k * r;
      const b = a + r;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let s = Math.floor(a); s < Math.ceil(b - 1e-9); s++) {
          const w = Math.min(b, s + 1) - Math.max(a, s);
          sum += w * src[4 * s + c];
        }
        out[4 * k + c] = Math.round(sum / r);
      }
    }
    return out;
  }
  const r = from / to;
  for (let k = 0; k < to; k++) {
    const x = Math.min(Math.max((k + 0.5) * r - 0.5, 0), from - 1);
    const s0 = Math.floor(x);
    const s1 = Math.min(s0 + 1, from - 1);
    const f = x - s0;
    for (let c = 0; c < 4; c++) out[4 * k + c] = Math.round(src[4 * s0 + c] * (1 - f) + src[4 * s1 + c] * f);
  }
  return out;
}

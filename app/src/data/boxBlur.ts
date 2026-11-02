/**
 * Separable box blur (edge-clamped) via running sums — O(w·h) independent of radius.
 * Used to build the low-pass surface for the live "Lokales Relief" (SLRM-style) mode.
 */
export function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Copy the `cw` × `ch` window at (x, y) out of a row-major `w`-wide raster. */
export function cropRaster(src: Float32Array, w: number, x: number, y: number, cw: number, ch: number): Float32Array {
  const out = new Float32Array(cw * ch);
  for (let r = 0; r < ch; r++) out.set(src.subarray((y + r) * w + x, (y + r) * w + x + cw), r * cw);
  return out;
}

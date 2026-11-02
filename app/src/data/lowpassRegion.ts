/**
 * Per-chunk low-pass for the live local relief (F9): assemble the chunk's height image plus a
 * margin of `radius` cells from neighbouring chunks of the same level, so a box blur of the
 * region, cropped to the chunk's height image, equals the AOI-wide edge-clamped blur exactly
 * wherever the neighbours are resident. Missing neighbour cells come from `fallback` (e.g. a
 * coarser level, bilinear) — then only the band within `radius` of that side is approximate.
 * Pure (no DOM / three.js).
 */

export interface RegionGrid {
  /** Level raster in cells (edge clamp bounds). */
  width: number;
  height: number;
  chunkSize: number;
  apron: number;
}

export interface Region {
  data: Float32Array;
  /** Region origin in cells and size. */
  c0: number;
  r0: number;
  w: number;
  h: number;
  /** Cells taken from `fallback` (0 = exact). */
  approx: number;
}

/**
 * Cells [c0, c0+w) × [r0, r0+h), indices edge-clamped to the raster (like numpy pad "edge"),
 * read from resident chunk images (`chunk(i, j)`, side cs + 2·apron) or `fallback(c, r)`.
 */
export function assembleRegion(
  g: RegionGrid,
  c0: number,
  r0: number,
  w: number,
  h: number,
  chunk: (i: number, j: number) => Float32Array | undefined,
  fallback: (c: number, r: number) => number,
): Region {
  const { chunkSize: cs, apron } = g;
  const side = cs + 2 * apron;
  const data = new Float32Array(w * h);
  let approx = 0;
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  // Column → (chunk i, pixel x) lookup, shared by all rows.
  const ci = new Int32Array(w);
  const cc = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const c = clamp(c0 + x, g.width - 1);
    cc[x] = c;
    ci[x] = Math.floor(c / cs);
  }
  for (let y = 0; y < h; y++) {
    const r = clamp(r0 + y, g.height - 1);
    const j = Math.floor(r / cs);
    const row = (r - j * cs + apron) * side;
    let lastI = -1;
    let img: Float32Array | undefined;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const i = ci[x];
      if (i !== lastI) {
        img = chunk(i, j);
        lastI = i;
      }
      const c = cc[x];
      if (img) data[o + x] = img[row + c - i * cs + apron];
      else {
        data[o + x] = fallback(c, r);
        approx++;
      }
    }
  }
  return { data, c0, r0, w, h, approx };
}

/**
 * Region needed for the low-pass of chunk (i, j)'s height image (side cs + 2·apron) at `radius`:
 * the image's cells plus `radius` on every side. Crop the blurred region at (radius, radius).
 */
export function lowpassWindow(g: RegionGrid, i: number, j: number, radius: number): { c0: number; r0: number; size: number } {
  const side = g.chunkSize + 2 * g.apron;
  return { c0: i * g.chunkSize - g.apron - radius, r0: j * g.chunkSize - g.apron - radius, size: side + 2 * radius };
}

/**
 * Image pixels whose cell lies outside the raster (AOI edge apron, or the padding of coarse-level
 * edge chunks) take the value of the edge-clamped cell, like the edge-clamped AOI-wide low-pass
 * did (in place). `side` = image side, (c0, r0) = cell of pixel (0, 0).
 */
export function clampOutside(data: Float32Array, side: number, c0: number, r0: number, width: number, height: number): void {
  const cl = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let py = 0; py < side; py++) {
    const qy = cl(r0 + py, height - 1) - r0;
    for (let px = 0; px < side; px++) {
      const qx = cl(c0 + px, width - 1) - c0;
      if (qx !== px || qy !== py) data[py * side + px] = data[qy * side + qx];
    }
  }
}

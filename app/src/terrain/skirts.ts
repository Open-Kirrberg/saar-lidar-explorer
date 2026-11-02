/**
 * Pure LOD-seam math (no three.js): how deep terrain skirts must hang so that a chunk rendered
 * at one LOD spacing never shows a crack next to a neighbour at another spacing.
 *
 * Two neighbouring chunks share the same edge line of height samples (via the apron). Each draws
 * that edge as a polyline through every `spacing`-th sample. The vertical gap between the two
 * polylines is at most devA + devB, where dev = max |sample − linear interpolation| of a polyline
 * against the full-resolution (1-sample) polyline. Both deviations are bounded by the chunk's
 * maximum edge deviation over all LOD spacings, so a skirt of 2·maxDev (× exaggeration) closes
 * every crack. A small spacing-based floor keeps the previous behaviour at 1×.
 */

/**
 * Max |h − lerp| along the four mesh edges of a height image (row-major, `side` × `side`) when
 * the edge is drawn every `spacing` samples. Edges run over pixels [apron, apron + chunkSize].
 * Non-finite samples are ignored.
 */
export function edgeDeviation(
  heights: ArrayLike<number>,
  side: number,
  apron: number,
  chunkSize: number,
  spacing: number,
): number {
  if (spacing <= 1) return 0;
  const lo = apron;
  const hi = apron + chunkSize;
  if (hi >= side) throw new Error(`edge ${hi} outside height image of side ${side}`);
  let dev = 0;
  // Sample k of an edge: rows lo/hi (x varies) and columns lo/hi (y varies).
  const edges: Array<(k: number) => number> = [
    (k) => lo * side + k,
    (k) => hi * side + k,
    (k) => k * side + lo,
    (k) => k * side + hi,
  ];
  for (const at of edges) {
    for (let k0 = lo; k0 < hi; k0 += spacing) {
      const k1 = Math.min(k0 + spacing, hi);
      const h0 = heights[at(k0)];
      const h1 = heights[at(k1)];
      if (!Number.isFinite(h0) || !Number.isFinite(h1)) continue;
      for (let k = k0 + 1; k < k1; k++) {
        const h = heights[at(k)];
        if (!Number.isFinite(h)) continue;
        const t = (k - k0) / (k1 - k0);
        const d = Math.abs(h - (h0 + (h1 - h0) * t));
        if (d > dev) dev = d;
      }
    }
  }
  return dev;
}

/** Max edge deviation over all LOD spacings. */
export function maxEdgeDeviation(
  heights: ArrayLike<number>,
  side: number,
  apron: number,
  chunkSize: number,
  spacings: readonly number[],
): number {
  let dev = 0;
  for (const s of spacings) dev = Math.max(dev, edgeDeviation(heights, side, apron, chunkSize, s));
  return dev;
}

/**
 * Terrain skirt depth in displayed metres for a chunk drawn at `spacing`, vertical exaggeration
 * `exag` and maximum edge deviation `edgeDev` (true metres). Crack heights scale with the
 * exaggeration, so the skirt does too (never shorter than at 1×).
 */
export function terrainSkirtDepth(spacing: number, exag: number, edgeDev: number): number {
  return Math.max(2 + 2 * spacing, 1 + 2 * edgeDev) * Math.max(exag, 1);
}

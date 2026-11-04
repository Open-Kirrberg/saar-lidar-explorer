/**
 * V2.4 trees — pure LOD rules (TS twins of the GLSL in TreeMaterial.ts; keep both in sync).
 *
 * Two independent axes, both decided per tree from its distance d to the camera:
 *  1. Existence (density): a tree is drawn when its stable `rank` (fmix32 order) is below the
 *     density D(d). Records are sorted by rank, so the CPU only draws a prefix per chunk
 *     (`prefixCount`) and the shader dithers the last `fade` of it in/out — no reseeding.
 *  2. Shape LOD (near / mid / far mesh): each mesh owns a distance band; between two bands both
 *     meshes draw the tree with complementary dither masks (cross-fade). All meshes read the same
 *     instance row, so a tree never moves between levels.
 */

export interface TreeLodParams {
  /** Near → mid mesh transition [start, end] (m). */
  near: [number, number];
  /** Mid → far mesh transition [start, end] (m). */
  mid: [number, number];
  /** All trees up to here (m); beyond, density falls as (full/d)². */
  full: number;
  /** Fade-out to zero density over [0.85·max, max] (m). */
  max: number;
  /** Width of the dithered rank band at the density edge (rank units). */
  fade: number;
}

/**
 * LOD distances from the vegetation radius. `vegetation` = `terrain.streaming.canopyDistance`
 * (quality presets: hoch 2000, mittel 1500, niedrig 1000, mobil 700 m).
 */
export function lodParams(vegetation: number): TreeLodParams {
  const max = Math.max(400, 1.5 * vegetation);
  const midEnd = Math.min(620, 0.5 * max);
  const nearEnd = Math.min(170, 0.3 * midEnd + 20);
  return {
    near: [nearEnd * 0.75, nearEnd],
    mid: [midEnd * 0.8, midEnd],
    full: Math.min(900, 0.6 * max),
    max,
    fade: 0.08,
  };
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Distance thinning (full/d)² beyond `full` — the part the crown scale compensates. */
export function treeFalloff(d: number, p: TreeLodParams): number {
  return d <= p.full ? 1 : (p.full / d) ** 2;
}

/** Fraction of trees drawn at distance d (non-increasing in d, 1 up to `full`). */
export function treeDensity(d: number, p: TreeLodParams): number {
  return treeFalloff(d, p) * (1 - smoothstep(0.85 * p.max, p.max, d));
}

/** Upper bound of the crown scale (lateral bounds use it). */
export const CROWN_SCALE_MAX = 2.5;

/**
 * Crown radius factor at distance d: 1/√falloff keeps the canopy cover of a thinned forest constant
 * (cover ∝ density · r²), capped at CROWN_SCALE_MAX. Continuous in d and 1 wherever the shape LODs
 * cross-fade (d ≤ full), so it never pops; positions are untouched.
 */
export function crownScale(d: number, p: TreeLodParams): number {
  return Math.min(CROWN_SCALE_MAX, 1 / Math.sqrt(treeFalloff(d, p)));
}

/** Rank threshold of a density: trees with rank < threshold may be (partly) drawn. */
export function rankThreshold(density: number, p: TreeLodParams): number {
  return density * (1 + p.fade);
}

/**
 * Existence weight 0…1 of a tree (dither keep-probability). D = 1 → every rank < 1 is fully
 * visible; the band of width `fade` below the threshold fades in.
 */
export function treeVisibility(rank: number, d: number, p: TreeLodParams): number {
  const thr = rankThreshold(treeDensity(d, p), p);
  return Math.min(1, Math.max(0, (thr - rank) / p.fade));
}

/** First index whose rank ≥ threshold (ranks ascending) = instances to draw. */
export function prefixCount(rank: ArrayLike<number>, threshold: number): number {
  let lo = 0;
  let hi = rank.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (rank[m] < threshold) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export type TreeLod = 'near' | 'mid' | 'far';
export const TREE_LODS: readonly TreeLod[] = ['near', 'mid', 'far'];

/** Band of a mesh: fades in over `inner`, out over `outer` (null = open end). */
export interface LodBand {
  inner: [number, number] | null;
  outer: [number, number] | null;
}

export function lodBand(lod: TreeLod, p: TreeLodParams): LodBand {
  if (lod === 'near') return { inner: null, outer: p.near };
  if (lod === 'mid') return { inner: p.near, outer: p.mid };
  return { inner: p.mid, outer: null };
}

/**
 * Does this mesh draw the pixel? `t` ∈ [0, 1) is the per-pixel dither value (same for every mesh
 * of the tree). The closer mesh keeps t < w, the farther t ≥ w, with w = 1 − smoothstep over the
 * shared transition — so exactly one mesh keeps each pixel (bands must not overlap).
 */
export function lodKeeps(band: LodBand, d: number, t: number): boolean {
  if (band.inner && d < band.inner[1]) {
    const w = 1 - smoothstep(band.inner[0], band.inner[1], d);
    if (t < w) return false;
  }
  if (band.outer && d > band.outer[0]) {
    const w = 1 - smoothstep(band.outer[0], band.outer[1], d);
    if (t >= w) return false;
  }
  return true;
}

/** Distance range [dMin, dMax] over which a mesh draws anything. */
export function bandRange(band: LodBand, p: TreeLodParams): [number, number] {
  return [band.inner ? band.inner[0] : 0, band.outer ? band.outer[1] : p.max];
}

/** 3D distance from the camera to an axis-aligned box (0 inside). */
export function boxDistance(
  cx: number, cy: number, cz: number,
  b: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number },
): number {
  const dx = cx < b.xMin ? b.xMin - cx : cx > b.xMax ? cx - b.xMax : 0;
  const dy = cy < b.yMin ? b.yMin - cy : cy > b.yMax ? cy - b.yMax : 0;
  const dz = cz < b.zMin ? b.zMin - cz : cz > b.zMax ? cz - b.zMax : 0;
  return Math.hypot(dx, dy, dz);
}

/** Farthest corner distance of the box (upper bound for any tree inside). */
export function boxFarDistance(
  cx: number, cy: number, cz: number,
  b: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number },
): number {
  const dx = Math.max(Math.abs(cx - b.xMin), Math.abs(cx - b.xMax));
  const dy = Math.max(Math.abs(cy - b.yMin), Math.abs(cy - b.yMax));
  const dz = Math.max(Math.abs(cz - b.zMin), Math.abs(cz - b.zMax));
  return Math.hypot(dx, dy, dz);
}

/** Displayed y of a true height (the one formula for everything in 3D). */
export function displayY(h: number, hRef: number, exag: number): number {
  return hRef + (h - hRef) * exag;
}

/**
 * TS twin of the vertex shader's tree anchor: the trunk base on the ground. Only the instance row
 * and the exaggeration enter — no LOD input, so every mesh puts the tree at the same spot.
 */
export function treeAnchor(row: ArrayLike<number>, o: number, hRef: number, exag: number): [number, number, number] {
  return [row[o], displayY(row[o + 1], hRef, exag), row[o + 2]];
}

/**
 * Pure level / quadtree-node math for the chunk pyramid (contract v2 "Levels"). No three.js.
 *
 * Level k: cellSize = cellSize₀·2^k, chunkSize cells per chunk, anchored at the AOI's north-west
 * corner. A level-k chunk (i, j) covers world x ∈ [i·cs·s, (i+1)·cs·s), z (from the north edge
 * −extentZ) likewise, and has the (up to) 2×2 children (k−1, 2i+a, 2j+b) that exist.
 */
import type { GridSpec } from '../data/grid';

/** Geometry of one level (subset of ManifestLevel). */
export interface LevelDims {
  level: number;
  cellSize: number;
  chunkSize: number;
  size: { width: number; height: number };
  chunks: { nx: number; ny: number };
}

/** AOI extent in metres (level-0 raster · cellSize₀). */
export interface AoiExtent {
  width: number;
  height: number;
}

export interface NodeId {
  level: number;
  i: number;
  j: number;
}

export function nodeKey(level: number, i: number, j: number): string {
  return `${level}/${i}_${j}`;
}

export function parseNodeKey(key: string): NodeId {
  const [l, rest] = key.split('/');
  const [i, j] = rest.split('_').map(Number);
  return { level: Number(l), i, j };
}

/** GridSpec of a level (for HeightQuery / chunk pixel math). */
export function levelGridSpec(lv: LevelDims, apron: number, aoi: AoiExtent): GridSpec {
  return {
    width: lv.size.width,
    height: lv.size.height,
    chunkSize: lv.chunkSize,
    apron,
    cellSize: lv.cellSize,
    extentZ: aoi.height,
  };
}

/** World rectangle of a node, clamped to the AOI: x ∈ [x0, x1], z ∈ [z0, z1] (z0 = north). */
export function nodeRect(lv: LevelDims, i: number, j: number, aoi: AoiExtent): { x0: number; x1: number; z0: number; z1: number } {
  const span = lv.chunkSize * lv.cellSize;
  const x0 = i * span;
  const z0 = j * span - aoi.height;
  return { x0, x1: Math.min(x0 + span, aoi.width), z0, z1: Math.min(z0 + span, 0) };
}

/** Existing children of node (level k ≥ 1) at level k−1. */
export function childrenOf(levels: readonly LevelDims[], n: NodeId): NodeId[] {
  if (n.level <= 0) return [];
  const c = levels[n.level - 1];
  const out: NodeId[] = [];
  for (let b = 0; b < 2; b++) {
    for (let a = 0; a < 2; a++) {
      const i = 2 * n.i + a;
      const j = 2 * n.j + b;
      if (i < c.chunks.nx && j < c.chunks.ny) out.push({ level: n.level - 1, i, j });
    }
  }
  return out;
}

export function parentOf(levels: readonly LevelDims[], n: NodeId): NodeId | null {
  if (n.level >= levels.length - 1) return null;
  return { level: n.level + 1, i: n.i >> 1, j: n.j >> 1 };
}

/** All chunks of the coarsest level (they cover the whole AOI). */
export function rootNodes(levels: readonly LevelDims[]): NodeId[] {
  const top = levels[levels.length - 1];
  const out: NodeId[] = [];
  for (let j = 0; j < top.chunks.ny; j++) for (let i = 0; i < top.chunks.nx; i++) out.push({ level: top.level, i, j });
  return out;
}

/**
 * Highest height-pixel coordinate of node (i, j) that still lies inside the AOI (x, y), so the
 * vertex shader can clamp meshes of edge chunks to the AOI rectangle. Pixel p ↔ world
 * x = (i·cs − apron + p + 0.5)·s, so the AOI edge x = W is at p = W/s − i·cs + apron − 0.5.
 */
export function aoiPixelMax(lv: LevelDims, i: number, j: number, apron: number, aoi: AoiExtent): { x: number; y: number } {
  const cs = lv.chunkSize;
  const s = lv.cellSize;
  return { x: aoi.width / s - i * cs + apron - 0.5, y: aoi.height / s - j * cs + apron - 0.5 };
}

/** Vertex spacings (in pixels) that divide chunkSize, ascending. */
export function pixelSpacings(chunkSize: number): number[] {
  const out: number[] = [];
  for (let p = 1; p <= chunkSize; p++) if (chunkSize % p === 0) out.push(p);
  return out;
}

/**
 * Vertex spacing in pixels for a desired spacing in metres on a level with `cellSize`: the
 * largest allowed pixel spacing p with p·cellSize ≤ max(metres, cellSize) (≥ 1).
 */
export function pixelSpacingFor(metres: number, cellSize: number, allowed: readonly number[]): number {
  const limit = Math.max(metres, cellSize) / cellSize + 1e-9;
  let best = 1;
  for (const p of allowed) if (p <= limit && p > best) best = p;
  return best;
}

/** Pixels per metre at distance 1 for a perspective camera (reference viewport height in px). */
export function projectionFactor(fovDeg: number, viewportHeightPx = 1080): number {
  return viewportHeightPx / (2 * Math.tan(((fovDeg * Math.PI) / 180) / 2));
}

/** Screen-space error (px) of drawing a level with `cellSize` at distance `dist`. */
export function screenSpaceError(cellSize: number, dist: number, projFactor: number): number {
  return (cellSize * projFactor) / Math.max(dist, 1e-3);
}

/** Distance from point p to an axis-aligned box (0 inside). */
export function distanceToBox(
  px: number,
  py: number,
  pz: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): number {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  const dz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
  return Math.hypot(dx, dy, dz);
}

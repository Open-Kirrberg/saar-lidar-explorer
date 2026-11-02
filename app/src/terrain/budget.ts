/**
 * Pure GPU-memory accounting + LRU eviction planning for streamed chunks (no three.js).
 * Sizes follow docs/data-contract.md "GPU memory per chunk": R32F heights, R8 layers, no mipmaps.
 */

export const MiB = 1024 * 1024;
/** Default soft budget for resident chunk textures. */
export const DEFAULT_BUDGET = 600 * MiB;
/** Never configure more than this (acceptance: < 1.5 GB GPU estimate). */
export const HARD_CAP = 1400 * MiB;

export interface ChunkMemory {
  /** Side of the (square) height image incl. apron, e.g. 502. */
  heightSide: number;
  /** Side of relief layer images, e.g. 500. */
  layerSide: number;
  layers: number;
  canopy: boolean;
  lowpass: boolean;
  /** Further texture bytes, e.g. `rgb` image layers incl. mipmaps (`imageGpuBytes`). */
  extraBytes?: number;
}

/** GPU bytes of one RGBA8 image texture of side `px` with a full mip chain (≈ 4/3). */
export function imageGpuBytes(px: number, mipmaps = true): number {
  const base = px * px * 4;
  return mipmaps ? Math.ceil((base * 4) / 3) : base;
}

/** Estimated GPU bytes of one chunk's textures. */
export function chunkGpuBytes(m: ChunkMemory): number {
  const h = m.heightSide * m.heightSide * 4;
  return h + m.layers * m.layerSide * m.layerSide + (m.canopy ? h : 0) + (m.lowpass ? h : 0) + (m.extraBytes ?? 0);
}

export function clampBudget(bytes: number): number {
  return Math.min(Math.max(bytes, 32 * MiB), HARD_CAP);
}

export interface LruEntry {
  key: string;
  bytes: number;
  /** Frame (or tick) the entry was last needed. */
  lastUsed: number;
  /** Never evicted (e.g. the coarsest level). */
  pinned?: boolean;
}

/**
 * Keys to evict so that the total fits `budget`: least recently used first, never pinned entries
 * or entries in `keep`. If that is not enough, the result evicts everything evictable.
 */
export function planEviction(entries: readonly LruEntry[], budget: number, keep: ReadonlySet<string>): string[] {
  let total = 0;
  for (const e of entries) total += e.bytes;
  if (total <= budget) return [];
  const candidates = entries.filter((e) => !e.pinned && !keep.has(e.key)).sort((a, b) => a.lastUsed - b.lastUsed);
  const out: string[] = [];
  for (const e of candidates) {
    if (total <= budget) break;
    out.push(e.key);
    total -= e.bytes;
  }
  return out;
}

/**
 * Adapt the refinement threshold (px) so the nodes that must stay resident fit the budget:
 * over budget → raise it (coarser), comfortably under → relax towards `base`.
 */
export function adaptThreshold(current: number, base: number, keptBytes: number, budget: number): number {
  if (keptBytes > budget) return Math.min(current * 1.25, base * 64);
  if (keptBytes < 0.7 * budget && current > base) return Math.max(base, current / 1.1);
  return current;
}

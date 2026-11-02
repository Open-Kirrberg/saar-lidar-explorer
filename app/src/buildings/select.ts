/**
 * F11: pure distance-based chunk selection for the LoD2 building meshes (no three/DOM imports).
 *
 * Building glbs are per level-0 chunk (contract "Models"). Chunk (i, j) covers world
 *   x ∈ [i·L, (i+1)·L],  z ∈ [j·L − extentZ, (j+1)·L − extentZ]   with L = chunkSize·cellSize
 * (row j counts south from the north edge, world z = −(N − N0), north edge at z = −extentZ).
 * Buildings sit whole in the chunk of their centroid, so they may poke over the edge: `margin`
 * grows the rect for distance tests.
 */

export interface ChunkRect {
  key: string;
  i: number;
  j: number;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface ChunkGridSpec {
  chunkSize: number;
  cellSize: number;
  /** AOI height in metres (world z of the north edge is −extentZ). */
  extentZ: number;
}

export function buildingChunkKey(i: number, j: number): string {
  return `${i}_${j}`;
}

/** World rect of each listed level-0 chunk, grown by `margin` metres on every side. */
export function chunkRects(chunks: ReadonlyArray<readonly [number, number]>, g: ChunkGridSpec, margin = 0): ChunkRect[] {
  const L = g.chunkSize * g.cellSize;
  return chunks.map(([i, j]) => ({
    key: buildingChunkKey(i, j),
    i,
    j,
    xMin: i * L - margin,
    xMax: (i + 1) * L + margin,
    zMin: j * L - g.extentZ - margin,
    zMax: (j + 1) * L - g.extentZ + margin,
  }));
}

/** Horizontal distance (m) from (x, z) to the rect (0 inside). */
export function rectDistance(r: ChunkRect, x: number, z: number): number {
  const dx = x < r.xMin ? r.xMin - x : x > r.xMax ? x - r.xMax : 0;
  const dz = z < r.zMin ? r.zMin - z : z > r.zMax ? z - r.zMax : 0;
  return Math.hypot(dx, dz);
}

export interface ChunkPlanInput {
  rects: readonly ChunkRect[];
  /** Camera world x/z. */
  x: number;
  z: number;
  /** Chunks with a mesh in the scene. */
  resident: ReadonlySet<string>;
  /** Chunks whose fetch is in flight. */
  loading: ReadonlySet<string>;
  /** Chunks that failed (404, parse error): never requested again. */
  failed: ReadonlySet<string>;
  /** Load chunks whose rect is within this distance. */
  loadRadius: number;
  /** Drop resident/in-flight chunks beyond this distance (≥ loadRadius: hysteresis band). */
  dropRadius: number;
  /** Max fetches in flight at once. */
  maxInFlight: number;
}

export interface ChunkPlan {
  /** Chunks to start loading now, nearest first (at most maxInFlight − loading). */
  load: string[];
  /** Resident or in-flight chunks to dispose / discard on arrival. */
  drop: string[];
  /** Chunks within loadRadius that are not resident yet (incl. in-flight, excl. failed). */
  pending: number;
}

/**
 * One planning step: what to fetch next and what to drop. Chunks between loadRadius and
 * dropRadius keep their state (hysteresis), so a camera hovering at the edge doesn't churn.
 */
export function planChunks(p: ChunkPlanInput): ChunkPlan {
  const dropR = Math.max(p.dropRadius, p.loadRadius);
  const want: Array<[number, string]> = [];
  const drop: string[] = [];
  let pending = 0;
  for (const r of p.rects) {
    const d = rectDistance(r, p.x, p.z);
    const have = p.resident.has(r.key);
    const inFlight = p.loading.has(r.key);
    if (d > dropR) {
      if (have || inFlight) drop.push(r.key);
      continue;
    }
    if (d > p.loadRadius || have || p.failed.has(r.key)) continue;
    pending++;
    if (!inFlight) want.push([d, r.key]);
  }
  want.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  const slots = Math.max(0, p.maxInFlight - p.loading.size);
  return { load: want.slice(0, slots).map((w) => w[1]), drop, pending };
}

/** Displayed y of a true height (same formula as the terrain and every other 3D object). */
export function displayHeight(h: number, hRef: number, exag: number): number {
  return hRef + (h - hRef) * exag;
}

/**
 * Fallback surface class per vertex (contract `_SURFACE`: 0 ground, 1 wall, 2 roof) from unit
 * normals when a glb lacks the attribute: steep faces are walls, upward faces roofs, downward
 * faces ground/closure. `wallMaxNy` = |n.y| below which a face counts as a wall.
 */
export function classifySurfaceByNormal(normals: ArrayLike<number>, wallMaxNy = 0.26): Uint8Array {
  const n = Math.floor(normals.length / 3);
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const ny = normals[k * 3 + 1];
    out[k] = Math.abs(ny) < wallMaxNy ? 1 : ny > 0 ? 2 : 0;
  }
  return out;
}

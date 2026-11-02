/**
 * Pure LOD / budget / streaming logic for the F16 point clouds (no three/DOM).
 *
 * Tiles store their records in a random permutation, so drawing the first n records is a uniform
 * subsample (contract "Progressive LOD"). Per tile we want a fraction f(d) that keeps the number
 * of points per screen pixel roughly constant: the projected area of a tile falls with d², so
 * f = (dFull / d)² (clamped to [minFraction, 1]). The global budget is then spent by water-filling:
 * every visible tile gets min(count, wanted·s) with one common scale s (s < 1 when the wanted
 * points exceed the budget, s > 1 to fill far tiles when there is budget to spare). That keeps the
 * density ratio between near and far tiles, so neighbouring tiles at the same distance look alike.
 */

export interface Box3Like {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Euclidean distance from a point to an axis-aligned box (0 inside). */
export function distanceToBox(px: number, py: number, pz: number, b: Box3Like): number {
  const dx = Math.max(b.minX - px, 0, px - b.maxX);
  const dy = Math.max(b.minY - py, 0, py - b.maxY);
  const dz = Math.max(b.minZ - pz, 0, pz - b.maxZ);
  return Math.hypot(dx, dy, dz);
}

export interface LodParams {
  /** Global point budget (drawn points over all visible tiles). */
  budget: number;
  /** Up to this distance (m) a tile wants all of its points. */
  fullDetailDist: number;
  /** Lower bound of the wanted fraction for far tiles (before budget scaling). */
  minFraction: number;
}

export const DEFAULT_LOD: LodParams = { budget: 3_000_000, fullDetailDist: 120, minFraction: 0.02 };

/** Wanted fraction of a tile's points at distance `d` (before the budget). */
export function desiredFraction(d: number, p: Pick<LodParams, 'fullDetailDist' | 'minFraction'>): number {
  if (d <= p.fullDetailDist) return 1;
  const f = (p.fullDetailDist / d) ** 2;
  return Math.min(1, Math.max(p.minFraction, f));
}

export interface LodTile {
  count: number;
  /** Distance from the camera to the tile's (displayed) bounding box. */
  dist: number;
  /** In the view frustum; invisible tiles get 0 (they are culled anyway). */
  visible: boolean;
}

/**
 * Points to draw per tile (`drawRange` count). Σ result ≤ budget; each ≤ its tile count. Visible
 * tiles with a non-zero wanted share draw at least one point.
 */
export function allocatePoints(tiles: readonly LodTile[], p: LodParams): number[] {
  const want = tiles.map((t) => (t.visible && t.count > 0 ? t.count * desiredFraction(t.dist, p) : 0));
  const budget = Math.max(0, Math.floor(p.budget));
  const cap = (i: number) => tiles[i].count;
  // Water-filling: one common scale s with n_i = min(count_i, want_i·s) and Σ n_i = budget (or all
  // visible points if they fit). s < 1 thins every tile alike; s > 1 spends a spare budget on the
  // far tiles until they are full.
  const sumAt = (s: number) => want.reduce((acc, w, i) => acc + (w > 0 ? Math.min(cap(i), w * s) : 0), 0);
  let lo = 0;
  let hi = 1;
  while (sumAt(hi) < budget && hi < 1e9) {
    if (want.every((w, i) => w === 0 || w * hi >= cap(i))) break; // everything full
    hi *= 2;
  }
  let scale = hi;
  if (sumAt(hi) > budget) {
    for (let it = 0; it < 48; it++) {
      const mid = (lo + hi) / 2;
      if (sumAt(mid) > budget) hi = mid;
      else lo = mid;
    }
    scale = lo;
  }
  const out = want.map((w, i) => (w > 0 ? Math.min(cap(i), Math.max(1, Math.floor(w * scale))) : 0));
  // max(1, …) may overshoot a tiny budget: trim from the largest allocations.
  let over = out.reduce((s, n) => s + n, 0) - budget;
  if (over > 0) {
    const order = out.map((_, i) => i).sort((a, b) => out[b] - out[a]);
    for (const i of order) {
      if (over <= 0) break;
      const cut = Math.min(out[i], over);
      out[i] -= cut;
      over -= cut;
    }
  }
  return out;
}

/** Average spacing (m) of n points spread over a square tile of side `tileSize` (≥ tiny). */
export function pointSpacing(tileSize: number, n: number): number {
  return tileSize / Math.sqrt(Math.max(n, 1));
}

export interface StreamTile {
  key: string;
  /** Horizontal distance (m) from the camera to the tile rectangle. */
  dist: number;
  resident: boolean;
  loading: boolean;
  /** Fetch failed or malformed and not (yet) due for a retry (see `retryDue`). */
  failed: boolean;
  /** Points in the tile (manifest count); only needed with a residency cap. */
  count?: number;
}

export interface StreamPlan {
  /** Tiles to fetch now, nearest first (at most `slots`). */
  load: string[];
  /** Resident or loading tiles beyond `disposeRadius` or over the residency cap (free / abort). */
  dispose: string[];
}

/** Loads start only while the nearer tiles' points stay ≤ this share of the cap (hysteresis vs. disposal). */
export const RESIDENT_LOAD_SHARE = 0.9;

/**
 * Streaming plan: load tiles within `loadRadius` (nearest first, `slots` free fetch slots), dispose
 * those beyond `disposeRadius` (> loadRadius: hysteresis so tiles at the edge don't thrash).
 * `maxResidentPoints` caps residency: walking the kept/wanted tiles nearest first with a running point
 * sum, a tile is disposed once the sum exceeds the cap and only loaded while it stays ≤
 * `RESIDENT_LOAD_SHARE` · cap (the gap keeps a tile at the cap boundary from thrashing). The nearest
 * tile is always allowed.
 */
export function planStreaming(
  tiles: readonly StreamTile[],
  loadRadius: number,
  disposeRadius: number,
  slots: number,
  maxResidentPoints = Infinity,
): StreamPlan {
  const dispose: string[] = [];
  const candidates: StreamTile[] = [];
  const kept: StreamTile[] = [];
  for (const t of tiles) {
    const live = t.resident || t.loading;
    if (live && t.dist > disposeRadius) dispose.push(t.key);
    else if (live) kept.push(t);
    else if (!t.failed && t.dist <= loadRadius) candidates.push(t);
  }
  const ordered = [...kept, ...candidates].sort((a, b) => a.dist - b.dist);
  const load: string[] = [];
  const overCap: string[] = [];
  let sum = 0;
  ordered.forEach((t, i) => {
    sum += t.count ?? 0;
    const live = t.resident || t.loading;
    if (live) {
      if (i > 0 && sum > maxResidentPoints) overCap.push(t.key);
    } else if (i === 0 || sum <= maxResidentPoints * RESIDENT_LOAD_SHARE) {
      if (load.length < slots) load.push(t.key);
    }
  });
  // Farthest over-cap tiles first (ordered is nearest first).
  dispose.push(...overCap.reverse());
  return { load, dispose };
}

/** Horizontal distance from (x, z) to a rectangle [minX, maxX] × [minZ, maxZ]. */
export function distanceToRect(x: number, z: number, minX: number, maxX: number, minZ: number, maxZ: number): number {
  return Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minZ - z, 0, z - maxZ));
}

/** Retry policy for failed tiles: exponential backoff 2 s, 4 s, 8 s … capped at 60 s, at most 6 tries. */
export const RETRY = { baseMs: 2000, maxMs: 60_000, maxTries: 6 } as const;

/** Wait before retry number `failures` (1 = after the first failure). */
export function retryDelayMs(failures: number, policy: { baseMs: number; maxMs: number } = RETRY): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(policy.maxMs, policy.baseMs * 2 ** (n - 1));
}

/** Is a tile that failed `failures` times (next try at `retryAt` ms) due for another fetch at `now`? */
export function retryDue(failures: number, retryAt: number, now: number, maxTries: number = RETRY.maxTries): boolean {
  return failures < maxTries && now >= retryAt;
}

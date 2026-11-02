import type { GridSpec } from '../data/grid';
import { cellSizeOf, chunkKey, extentZOf, heightImageSize, worldToCell } from '../data/grid';

/**
 * CPU bilinear height lookup over decoded height chunks (with apron).
 * Returns *true* heights in metres (no vertical exaggeration).
 */
export class HeightQuery {
  private readonly chunks = new Map<string, Float32Array>();
  private readonly side: number;

  constructor(
    readonly grid: GridSpec,
    readonly nx: number,
    readonly ny: number,
  ) {
    this.side = heightImageSize(grid);
  }

  add(i: number, j: number, heights: Float32Array): void {
    if (heights.length !== this.side * this.side) {
      throw new Error(`HeightQuery: chunk ${i}_${j} has ${heights.length} samples, expected ${this.side ** 2}`);
    }
    this.chunks.set(chunkKey(i, j), heights);
  }

  /** Forget chunk (i, j) (evicted). */
  remove(i: number, j: number): boolean {
    return this.chunks.delete(chunkKey(i, j));
  }

  has(i: number, j: number): boolean {
    return this.chunks.has(chunkKey(i, j));
  }

  get loadedCount(): number {
    return this.chunks.size;
  }

  /** Raw height-image samples of chunk (i, j), or undefined if not loaded. */
  chunk(i: number, j: number): Float32Array | undefined {
    return this.chunks.get(chunkKey(i, j));
  }

  /** Is the world position inside the raster footprint? */
  contains(x: number, z: number): boolean {
    const s = cellSizeOf(this.grid);
    const ez = extentZOf(this.grid);
    return x >= 0 && x <= this.grid.width * s && z >= -ez && z <= this.grid.height * s - ez;
  }

  /** Key of the chunk `heightAt(x, z)` reads from (edge-clamped, same rule as `heightAt`). */
  chunkKeyAt(x: number, z: number): string {
    const g = this.grid;
    const p = worldToCell(x, z, g);
    const c0 = Math.min(Math.floor(Math.min(Math.max(p.c, 0), g.width - 1)), g.width - 1);
    const r0 = Math.min(Math.floor(Math.min(Math.max(p.r, 0), g.height - 1)), g.height - 1);
    return chunkKey(Math.min(Math.floor(c0 / g.chunkSize), this.nx - 1), Math.min(Math.floor(r0 / g.chunkSize), this.ny - 1));
  }

  /**
   * Chunk (i, j) whose node rectangle contains world (x, z) (edge-clamped). Differs from
   * `chunkKeyAt` in the half-cell band inside a chunk's west/north edge, where the bilinear base
   * cell belongs to the neighbour.
   */
  nodeAt(x: number, z: number): { i: number; j: number } {
    const span = this.grid.chunkSize * cellSizeOf(this.grid);
    const i = Math.min(Math.max(Math.floor(x / span), 0), this.nx - 1);
    const j = Math.min(Math.max(Math.floor((z + extentZOf(this.grid)) / span), 0), this.ny - 1);
    return { i, j };
  }

  /**
   * Bilinear height at world (x, z). Positions outside the AOI are edge-clamped.
   * Returns NaN if the needed chunk is not loaded yet.
   */
  heightAt(x: number, z: number): number {
    const g = this.grid;
    const p = worldToCell(x, z, g);
    const c = Math.min(Math.max(p.c, 0), g.width - 1);
    const r = Math.min(Math.max(p.r, 0), g.height - 1);
    const c0 = Math.min(Math.floor(c), g.width - 1);
    const r0 = Math.min(Math.floor(r), g.height - 1);
    const i = Math.min(Math.floor(c0 / g.chunkSize), this.nx - 1);
    const j = Math.min(Math.floor(r0 / g.chunkSize), this.ny - 1);
    return this.sample(i, j, c, r);
  }

  /**
   * Bilinear height at world (x, z) read from chunk (i, j) — the chunk whose node rectangle
   * contains the point (`nodeAt`); the 1-cell apron covers the half-cell band at its west/north
   * edge. NaN if that chunk is not loaded.
   */
  heightAtInChunk(x: number, z: number, i: number, j: number): number {
    const g = this.grid;
    const p = worldToCell(x, z, g);
    return this.sample(i, j, Math.min(Math.max(p.c, 0), g.width - 1), Math.min(Math.max(p.r, 0), g.height - 1));
  }

  private sample(i: number, j: number, c: number, r: number): number {
    const g = this.grid;
    const cs = g.chunkSize;
    const data = this.chunks.get(chunkKey(i, j));
    if (!data) return NaN;
    // Keep the base cell inside this chunk's image (apron included): c0 ∈ [i·cs − apron, (i+1)·cs + apron − 1).
    const c0 = Math.min(Math.max(Math.floor(c), i * cs - g.apron), (i + 1) * cs + g.apron - 2, g.width - 1);
    const r0 = Math.min(Math.max(Math.floor(r), j * cs - g.apron), (j + 1) * cs + g.apron - 2, g.height - 1);
    const fx = c - c0;
    const fy = r - r0;
    const px = c0 - i * cs + g.apron;
    const py = r0 - j * cs + g.apron;
    const s = this.side;
    const k = py * s + px;
    const h00 = data[k];
    const h10 = data[k + 1];
    const h01 = data[k + s];
    const h11 = data[k + s + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  /** Assemble the full raster (width × height, row 0 = north) from loaded chunks. */
  mosaic(): Float32Array {
    const { width, height, chunkSize: cs, apron } = this.grid;
    const out = new Float32Array(width * height);
    const s = this.side;
    for (const [key, data] of this.chunks) {
      const [i, j] = key.split('_').map(Number);
      const c0 = i * cs;
      const r0 = j * cs;
      const w = Math.min(cs, width - c0);
      const h = Math.min(cs, height - r0);
      for (let y = 0; y < h; y++) {
        const src = (y + apron) * s + apron;
        out.set(data.subarray(src, src + w), (r0 + y) * width + c0);
      }
    }
    return out;
  }
}

/**
 * Heights over all resolution levels (F9): `heightAt` answers from the finest level whose chunk
 * is resident at that position (level 0 = 1 m, then 2 m, 4 m, …). True heights, no exaggeration.
 */
export class LevelHeights {
  /** Bumped on every add/remove (consumers can re-sample when it changes). */
  version = 0;
  /** Per level: keys (`i_j`) of the chunks drawn this frame; null before the first frame. */
  private displayed: Array<Set<string>> | null = null;

  constructor(readonly levels: readonly HeightQuery[]) {}

  add(level: number, i: number, j: number, heights: Float32Array): void {
    this.levels[level].add(i, j, heights);
    this.version++;
  }

  remove(level: number, i: number, j: number): void {
    if (this.levels[level].remove(i, j)) this.version++;
  }

  /** Number of resident height chunks over all levels. */
  get loadedCount(): number {
    let n = 0;
    for (const q of this.levels) n += q.loadedCount;
    return n;
  }

  /** Level-0 chunk (i, j) is resident. */
  has(i: number, j: number): boolean {
    return this.levels[0].has(i, j);
  }

  /** Raw level-0 height image of chunk (i, j). */
  chunk(i: number, j: number): Float32Array | undefined {
    return this.levels[0].chunk(i, j);
  }

  contains(x: number, z: number): boolean {
    return this.levels[0].contains(x, z);
  }

  /** Bilinear true height from the finest resident level ≥ `minLevel` (NaN if none). */
  heightAt(x: number, z: number, minLevel = 0): number {
    for (let k = minLevel; k < this.levels.length; k++) {
      const h = this.levels[k].heightAt(x, z);
      if (!Number.isNaN(h)) return h;
    }
    return NaN;
  }

  /** Record the drawn quadtree cover (per frame), used by `heightAtDisplayed`. */
  setDisplayed(nodes: Iterable<{ level: number; i: number; j: number }>): void {
    const d = this.levels.map(() => new Set<string>());
    for (const n of nodes) d[n.level]?.add(chunkKey(n.i, n.j));
    this.displayed = d;
  }

  /**
   * Bilinear true height of the surface actually drawn at (x, z): from the level of the drawn chunk
   * covering it (finest first at shared borders), else the finest resident level. Use for picking,
   * anchors and collision so they match the visible mesh; `heightAt` for true readouts.
   */
  heightAtDisplayed(x: number, z: number): number {
    const d = this.displayed;
    if (d) {
      for (let k = 0; k < this.levels.length; k++) {
        if (d[k].size === 0) continue;
        // Drawn-ness is decided by the node rectangle containing (x, z), not by the chunk owning
        // the bilinear base cell (they differ in the half-cell band at west/north edges).
        const q = this.levels[k];
        const { i, j } = q.nodeAt(x, z);
        if (!d[k].has(chunkKey(i, j))) continue;
        const h = q.heightAtInChunk(x, z, i, j);
        if (!Number.isNaN(h)) return h;
      }
    }
    return this.heightAt(x, z);
  }

  /** Finest resident level at (x, z), or −1. */
  levelAt(x: number, z: number): number {
    for (let k = 0; k < this.levels.length; k++) if (!Number.isNaN(this.levels[k].heightAt(x, z))) return k;
    return -1;
  }
}

/**
 * March a ray against a height function (display-space heights) and refine by bisection.
 * Returns the hit distance along the (normalised) direction, or null.
 * Use for marker placement / picking (three.js mesh raycasting cannot see GPU displacement).
 */
export function raycastHeightField(
  surfaceY: (x: number, z: number) => number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist = 20000,
): number | null {
  const above = (t: number) => {
    const y = surfaceY(ox + dx * t, oz + dz * t);
    return Number.isNaN(y) ? true : oy + dy * t - y > 0;
  };
  if (!above(0)) return 0;
  let prev = 0;
  let t = 0;
  // Step grows with distance: fine near the camera, coarser far away.
  while (t < maxDist) {
    const step = Math.max(0.5, t * 0.01);
    t = Math.min(t + step, maxDist);
    if (!above(t)) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid)) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prev = t;
  }
  return null;
}

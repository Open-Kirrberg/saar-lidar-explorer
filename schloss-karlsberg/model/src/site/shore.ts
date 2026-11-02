/**
 * Natural pond shores (wave 9, garden; visual audit #1: the Karlsbergweiher and the Schwanenweiher read as rectangles
 * with ruler-straight cuts and a cut cliff on the bank, poses 39 / 45 / 48).
 *
 * scripts/prepare-terrain.py grades the 1789 terrain of every pond with a natural bank (`naturalShore`): a smoothed,
 * wandering shoreline up to `SHORE.reach` m beyond the catalogue polygon, a shallow shelf inside and a grass bank to the
 * water outside (research/11 S12, §4.5: grass to the water on the gentle side) [I generator rule]. The viewer then
 * lets the **terrain contour be the shore**:
 *
 * - `shoreWater`: the water surface is a grid on the terrain's own 1 m vertices (cell centres of the DTM, local
 *   x, z = k + 0.5) over the polygon grown by `SHORE.reach`, keeping each cell with a corner below the level + `under`. The
 *   cells along the bank lie partly under the terrain, which hides them, so the visible edge is the terrain's waterline.
 *   Each vertex carries its depth (level − ground), which tints the shallow water toward the bed (`shallowTint`): a
 *   light, olive margin fading over `SHORE.shallow` m of depth instead of a uniform sheet to the edge [I look].
 * - Wave-9 review fix (45: the near shore stepped along the 1 m grid with a dark rim and no shallow fade): each vertex
 *   also carries its unclamped depth (`depths`), and the water fades in over the first `SHORE.fade` m of depth
 *   (`shoreFade`, per fragment from the interpolated depth). On the terrain's own triangulation the interpolated depth
 *   is exactly level − ground, so the fade is 0 on the true waterline and no grid edge or contour step can show; the
 *   shallow rim lets the bank show through. features.ts blends it so the post chain's water marker (alpha 0) only
 *   holds where the water is nearly opaque (scene alpha = dst · (1 − fade)) [I look].
 * - No wet band (water.ts `wetBank`) on natural shores: on the 1 m grid its per-vertex darkening drew the cells' zigzag
 *   along the waterline at eye level and in the screen-space reflection (45); the graded bank and the shallow tint carry
 *   the waterline instead.
 *
 * The material keeps the post chain's water marker (alpha 0, materials/index.ts `waterPatch`). No reeds: no source
 * documents them at the 1789 ponds (KB-I37). Pure geometry here; tests in model/tests/shore.test.ts.
 */
import { type P2, pointInPolygon } from '../layout/geom.ts';
import type { TerrainFeature } from '../spec.ts';
import { offsetRing } from './water.ts';

export const SHORE = {
  /** how far (m) the graded shore may wander beyond the catalogue polygon (prepare-terrain.py SHORE_WANDER low end, + 2 m) */
  reach: 3.5,
  /** depth (m) over which the shallow-water tint fades out */
  shallow: 0.7,
  /** multiplier of the water colour at the waterline (the bed seen through a few cm of water) and its weight [I] */
  tint: [1.55, 1.42, 1.0] as readonly [number, number, number],
  tintWeight: 0.6,
  /** water cells reach this far (m of height) under the bank, so no gap opens at the waterline */
  under: 0.1,
  /** depth (m) over which the water fades in from the waterline (wave-9 review fix) */
  fade: 0.3,
} as const;

/** A pond with a natural bank (mirrors prepare-terrain.py natural_pond): pond, water level, no coping, not a formal Bassin. */
export function naturalShore(f: TerrainFeature): boolean {
  return f.kind === 'pond' && f.water_level !== undefined && !f.coping && f.geometry.type === 'Polygon' && !/bassin/i.test(f.name ?? '');
}

/** Opacity of the water at a depth (m) below the level: 0 on the waterline, 1 from `SHORE.fade` m (linear; GLSL in features.ts). */
export function shoreFade(depth: number): number {
  return Math.min(1, Math.max(0, depth / SHORE.fade));
}

/** Water-colour multiplier at a depth (m) below the level: `SHORE.tint` blended in toward the shore. */
export function shallowTint(depth: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (depth - 0.03) / (SHORE.shallow - 0.03)));
  const s = (1 - t * t * (3 - 2 * t)) * SHORE.tintWeight;
  return [1 + (SHORE.tint[0] - 1) * s, 1 + (SHORE.tint[1] - 1) * s, 1 + (SHORE.tint[2] - 1) * s];
}

interface Grid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  h: Float64Array;
  inside: Uint8Array;
}

/** Terrain vertices (x, z = k + 0.5) over the ring grown by `grow` m: heights and which cells' centres lie inside. */
function vertexGrid(ring: readonly [number, number][], grow: number, terrain: (x: number, z: number) => number): Grid | null {
  const outer = offsetRing(ring as [number, number][], grow) as P2[];
  if (outer.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of outer) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const x0 = Math.floor(minX - 0.5) + 0.5;
  const z0 = Math.floor(minZ - 0.5) + 0.5;
  const nx = Math.ceil(maxX - x0) + 2;
  const nz = Math.ceil(maxZ - z0) + 2;
  const h = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = terrain(x0 + i, z0 + j);
  const inside = new Uint8Array((nx - 1) * (nz - 1));
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) inside[j * (nx - 1) + i] = pointInPolygon([x0 + i + 0.5, z0 + j + 0.5], outer) ? 1 : 0;
  return { x0, z0, nx, nz, h, inside };
}

export interface ShoreMesh {
  /** xyz per vertex (local frame) */
  positions: Float32Array;
  /** rgb per vertex (shallow tint for the water, wet shade for the bank) */
  colors: Float32Array;
  /** depth (m) below the level per vertex, unclamped (negative above the waterline): drives `shoreFade` per fragment */
  depths: Float32Array;
  /** triangles, facing up (+y), on the terrain mesh's diagonal (col + 1, row) – (col, row + 1) */
  index: Uint32Array;
}

/** Collect the kept cells of a grid into a mesh (shared vertices), with per-vertex y and colour. */
function gridMesh(g: Grid, keep: (i: number, j: number) => boolean, y: (k: number) => number, rgb: (k: number) => [number, number, number], depth: (k: number) => number): ShoreMesh | null {
  const map = new Int32Array(g.nx * g.nz).fill(-1);
  const pos: number[] = [];
  const col: number[] = [];
  const dep: number[] = [];
  const idx: number[] = [];
  const vert = (i: number, j: number) => {
    const k = j * g.nx + i;
    if (map[k] < 0) {
      map[k] = pos.length / 3;
      pos.push(g.x0 + i, y(k), g.z0 + j);
      col.push(...rgb(k));
      dep.push(depth(k));
    }
    return map[k];
  };
  for (let j = 0; j < g.nz - 1; j++)
    for (let i = 0; i < g.nx - 1; i++) {
      if (!keep(i, j)) continue;
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i, j + 1);
      const d = vert(i + 1, j + 1);
      // (x, z) → (x + 1, z) → (x, z + 1): counter-clockwise seen from above (+y)
      idx.push(a, c, b, b, c, d);
    }
  if (idx.length === 0) return null;
  return { positions: new Float32Array(pos), colors: new Float32Array(col), depths: new Float32Array(dep), index: new Uint32Array(idx) };
}

/**
 * Water surface of a natural pond at `level` (local ring x, z; terrain sampler): the grid cells within `SHORE.reach` m
 * of the ring with any corner below the level + `SHORE.under`; vertex colours `shallowTint(level − ground)` and depths
 * `level − ground` (for `shoreFade`). Null when nothing is wet.
 */
export function shoreWater(ring: readonly [number, number][], level: number, terrain: (x: number, z: number) => number): ShoreMesh | null {
  const g = vertexGrid(ring, SHORE.reach, terrain);
  if (!g) return null;
  const below = (k: number) => !(g.h[k] >= level + SHORE.under); // NaN (no terrain) counts as water
  return gridMesh(
    g,
    (i, j) => g.inside[j * (g.nx - 1) + i] === 1 && (below(j * g.nx + i) || below(j * g.nx + i + 1) || below((j + 1) * g.nx + i) || below((j + 1) * g.nx + i + 1)),
    () => level,
    (k) => shallowTint(Number.isFinite(g.h[k]) ? level - g.h[k] : 99),
    (k) => (Number.isFinite(g.h[k]) ? level - g.h[k] : 99),
  );
}

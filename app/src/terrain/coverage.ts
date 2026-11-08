/**
 * Catalog-mode coverage mask (S2 polish). The central overview has no no-data marker: its level-k
 * cells outside the source data (France, RLP beyond the 1-tile relief buffer) are pyramid-filled
 * (`pipeline/overview.py` `pyramid_fill`: flat blocks with stair-step edges), and overview chunks
 * are present when they touch ≥ 1 owned tile, so the coarse levels reach far beyond the catalog
 * area. The terrain shaders therefore mask everything outside the union of the catalog's owned
 * tiles (all statuses): one u8 texel per 1 km tile (255 = owned), sampled bilinearly; within
 * ≈ 200 m of the tile edge the terrain fades into the haze colour, beyond the edge it is drawn as
 * plain, unlit haze and sinks to hRef (not discarded: a cut heightfield would show the skirts
 * behind it from below).
 *
 * Pure: no three, no DOM.
 */
import type { Rect } from '../data/globalGrid';
import { parseTileId, TILE_M } from '../data/globalGrid';

/** One texel per 1 km tile of `rect`, row 0 = south (texture v grows north), 255 = covered. */
export interface CoverageGrid {
  w: number;
  h: number;
  data: Uint8Array;
  /** Covered tiles inside the rectangle. */
  count: number;
}

/**
 * Coverage grid of a session rectangle (aligned at 1 km) from tile ids (`"E_N"` in km, e.g. the
 * keys of the catalog's tile → owner map). Tiles outside the rectangle are ignored.
 */
export function coverageGrid(tiles: Iterable<string>, rect: Rect): CoverageGrid {
  const w = Math.round(rect.W / TILE_M);
  const h = Math.round(rect.H / TILE_M);
  if (!(w > 0 && h > 0)) throw new Error(`coverage: empty rectangle ${rect.W}×${rect.H}`);
  const data = new Uint8Array(w * h);
  let count = 0;
  for (const id of tiles) {
    const t = parseTileId(id);
    if (!t) continue;
    const col = Math.round((t.E - rect.E0) / TILE_M);
    const row = Math.round((t.N - rect.N0) / TILE_M);
    if (col < 0 || row < 0 || col >= w || row >= h) continue;
    if (!data[row * w + col]) count++;
    data[row * w + col] = 255;
  }
  return { w, h, data, count };
}

/**
 * CPU reference of the shader's bilinear coverage value at world (x, z) of the session frame
 * (x = E − E0, z = −(N − N0)): texel centres at tile centres, clamp to edge. 0 … 1.
 */
export function coverageAt(g: CoverageGrid, x: number, z: number): number {
  const u = x / TILE_M - 0.5;
  const v = -z / TILE_M - 0.5;
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const fu = u - c0;
  const fv = v - r0;
  const at = (c: number, r: number) => g.data[Math.min(g.h - 1, Math.max(0, r)) * g.w + Math.min(g.w - 1, Math.max(0, c))] / 255;
  const a = at(c0, r0) * (1 - fu) + at(c0 + 1, r0) * fu;
  const b = at(c0, r0 + 1) * (1 - fu) + at(c0 + 1, r0 + 1) * fu;
  return a * (1 - fv) + b * fv;
}

/**
 * Coverage value of the tile edge: below it a fragment is drawn in the plain haze colour (opaque,
 * unlit: the pyramid-filled plateaus, their stair steps and every skirt out there vanish in one
 * flat colour, and the hidden terrain still occludes, so no skirt is ever seen through a cut).
 */
export const COVERAGE_EDGE = 0.5;
/**
 * Below this coverage value (≈ 150 m outside a straight tile edge) the terrain vertices sit at hRef
 * (the catalog's lowest height): the filled plateaus never stand against the sky or occlude real
 * terrain; between it and COVERAGE_EDGE they ramp up (all of it drawn as plain haze).
 */
export const COVERAGE_SINK_LO = 0.35;
/** Coverage value where the fade into the haze starts (≈ 200 m inside a straight tile edge). */
export const COVERAGE_FADE_END = 0.7;

/**
 * CPU reference of the shader: haze share 0 … 1 (1 = plain haze colour) for coverage value `c`.
 * 0 at COVERAGE_FADE_END and beyond, smooth ramp to 1 at the tile edge, 1 outside.
 */
export function coverageHaze(c: number): number {
  const t = Math.min(1, Math.max(0, (c - COVERAGE_EDGE) / (COVERAGE_FADE_END - COVERAGE_EDGE)));
  return 1 - t * t * (3 - 2 * t);
}

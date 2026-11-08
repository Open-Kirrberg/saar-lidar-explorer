/**
 * Catalog-mode coverage mask (S2, contract revision 3.1 „Overview no-data“). Overview heights
 * outside covered 1 km tiles are *filler* (a smooth push-pull continuation that keeps meshes,
 * aprons and skirts finite) and carry no meaning. The covered set is the overview's optional
 * `coverage` bitmap (tiles with real SL / RLP source data, incl. the relief-buffer ring and RLP
 * neighbours; `coverageTileIds`); without a valid one (3.0 files) the union of the catalog's owned
 * tiles (all statuses). The terrain shaders mask everything outside it: one u8 texel per 1 km tile
 * (255 = covered), sampled bilinearly; within ≈ 200 m of the tile edge the terrain fades into the
 * haze colour, beyond the edge it is drawn as plain, unlit haze and sinks to hRef (not discarded: a
 * cut heightfield would show the skirts behind it from below). CPU readers (height readouts, ground
 * clamp, profiles, measurements, fly-to framing) never answer from filler: `Terrain.heightAt` and
 * friends return NaN outside covered tiles (`isCovered`).
 *
 * Pure: no three, no DOM.
 */
import type { Bitmap, Rect } from '../data/globalGrid';
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
 * Tile ids of the set bits of an overview `coverage` bitmap over `bbox` (row 0 = north): bit
 * (col, row) = tile `${bbox[0]/1000 + col}_${bbox[3]/1000 − 1 − row}` (contract „Overview no-data“).
 */
export function coverageTileIds(cov: Bitmap, bbox: readonly [number, number, number, number]): string[] {
  const e0 = Math.round(bbox[0] / TILE_M);
  const nTop = Math.round(bbox[3] / TILE_M);
  const out: string[] = [];
  for (let row = 0; row < cov.h; row++) {
    for (let col = 0; col < cov.w; col++) if (cov.cells[row * cov.w + col]) out.push(`${e0 + col}_${nTop - 1 - row}`);
  }
  return out;
}

/**
 * True when world (x, z) of the session frame lies in a covered tile (exact tile test, no
 * bilinear blend): CPU height readers answer only there. Outside the rectangle → false.
 */
export function isCovered(g: CoverageGrid, x: number, z: number): boolean {
  const col = Math.floor(x / TILE_M);
  const row = Math.floor(-z / TILE_M);
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) return false;
  return g.data[row * g.w + col] > 0;
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

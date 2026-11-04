/**
 * Wave 10 (garden, audit #1): mowing zones of Petri's Herzogsgarten lawn (HG-01). A July lawn of the 1780s was a
 * close-scythed pleasure-ground band only near the house and along the walks; the open lawn beyond was an aftermath
 * hay meadow, a patchwork of scythed swaths and taller seeding grass (research/11 §3.1, §4.4; grammar
 * PLEASURE_GROUND). This module turns the ground classes plus the garden front, the walks and the benches into a
 * signed distance per 2 m ground cell: negative inside the close-mown zone, positive in the meadow. The terrain
 * shader and the land-cover bake read it (landcover.ts GroundPack.macro B) and dither the mown edge.
 * Pure (no three.js), unit-tested in viewer/tests/lawnZones.test.ts.
 */
import { E0, N0 } from '@model/frame.ts';
import { PLEASURE_GROUND } from '@model/layout/grammar.ts';
import type { TerrainFeature } from '@model/spec.ts';
import { GROUND_CLASS, distanceTo } from './landcover.ts';

type XZ = readonly [number, number];

export interface LawnZoneInput {
  /** the meadow-lawn's outline (local x, z), e.g. HG-01; only cells inside it can turn to meadow */
  lawn: readonly XZ[];
  /**
   * rings (local x, z) with a close-mown band `band` m beyond them: the garden terrace (TF-09, PLEASURE_GROUND.frontBand)
   * and the basin's levelled grass ring (HG-05, PLEASURE_GROUND.rondell)
   */
  rings: readonly { ring: readonly XZ[]; band: number }[];
  /** mown bays round single points (benches, a herm): centre and radius (m) */
  spots?: readonly { x: number; z: number; r: number }[];
  /**
   * wave-10 review fix: the draped walks (local [x, z] centre lines and widths) that cross the lawn. The class raster
   * paints the lawn over them (prepare-terrain.py), so without these lines no verge followed the belt walk
   */
  walks?: readonly { line: readonly XZ[]; width: number }[];
  /** close-mown verge beyond any hard surface: walks, terrace, buildings (m) */
  walkVerge?: number;
}

export interface ZoneGrid {
  ground: ArrayLike<number>;
  cols: number;
  rows: number;
  cell: number;
  /** local x / z of the centre of cell (0, 0); x grows with the column, z with the row */
  x0: number;
  z0: number;
}

/** Ray-casting point-in-polygon on a local [x, z] ring. */
export function inRing(x: number, z: number, ring: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (m) from a point to the segment a → b. */
function segmentDistance(x: number, z: number, a: XZ, b: XZ): number {
  const [ax, az] = a;
  const ex = b[0] - ax;
  const ez = b[1] - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
}

/** Distance (m) from a point to an open polyline. */
export function lineDistance(x: number, z: number, line: readonly XZ[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, segmentDistance(x, z, line[i], line[i + 1]));
  return best;
}

/** Distance (m) from a point to a closed ring (0 inside). */
export function ringDistance(x: number, z: number, ring: readonly XZ[]): number {
  if (inRing(x, z, ring)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segmentDistance(x, z, ring[j], ring[i]));
  return best;
}

/** Signed-distance range (m) of the byte encoding: 128 ± ZONE_RANGE · ZONE_SCALE. */
export const ZONE_SCALE = 8;
export const ZONE_RANGE = 127 / ZONE_SCALE;

/** Byte encoding of a signed distance (m): 128 + 8 · sd, clamped (the shaders decode (b · 255 − 128) / 8). */
export function encodeZone(sd: number): number {
  return Math.max(0, Math.min(255, Math.round(128 + sd * ZONE_SCALE)));
}

/**
 * Signed distance (m) per ground cell to the edge of the close-mown zone: negative = close-mown, positive = aftermath
 * meadow. Cells outside the meadow-lawn outline that are lawn of another feature (parterre panels, the rondell's own
 * class is HG-01's) are fully mown (−ZONE_RANGE); every other cell carries the geometric value, so the bilinear lookup
 * at the outline's edge does not pull a mown rim into the meadow.
 */
export function lawnZoneField(g: ZoneGrid, z: LawnZoneInput): Float32Array {
  const n = g.cols * g.rows;
  const out = new Float32Array(n).fill(-ZONE_RANGE);
  if (z.lawn.length < 3) return out;
  const verge = z.walkVerge ?? PLEASURE_GROUND.walkVerge;
  const reach = ZONE_RANGE;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, zz] of z.lawn) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, zz);
    z1 = Math.max(z1, zz);
  }
  const pad = 2 * g.cell;
  const c0 = Math.max(0, Math.floor((x0 - pad - g.x0) / g.cell));
  const c1 = Math.min(g.cols - 1, Math.ceil((x1 + pad - g.x0) / g.cell));
  const r0 = Math.max(0, Math.floor((z0 - pad - g.z0) / g.cell));
  const r1 = Math.min(g.rows - 1, Math.ceil((z1 + pad - g.z0) / g.cell));
  if (c0 > c1 || r0 > r1) return out;
  // hard surfaces (walks, the terrace, the buildings): the chamfer distance of the class raster, measured to the class
  // boundary (half a cell from the nearest hard cell centre)
  const C = GROUND_CLASS;
  const toHard = distanceTo({ ground: g.ground as Uint8Array, cols: g.cols, rows: g.rows, cell: g.cell }, [C.gravel, C.cobbles, C.sand, C.building, C.parterre_sand]);
  const rings = z.rings.filter((r) => r.ring.length >= 3);
  const spots = z.spots ?? [];
  // only the walks that come near the lawn's bounding box (padded by the encoding range and the verge)
  const reachW = ZONE_RANGE + verge + 4;
  const walks = (z.walks ?? []).filter((w) => w.line.length >= 2 && w.line.some(([x, zz]) => x > x0 - reachW - 60 && x < x1 + reachW + 60 && zz > z0 - reachW - 60 && zz < z1 + reachW + 60));
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const i = r * g.cols + c;
      const x = g.x0 + c * g.cell;
      const zz = g.z0 + r * g.cell;
      const inside = inRing(x, zz, z.lawn);
      if (!inside && g.ground[i] === C.lawn) continue; // another lawn: close-mown
      let sd = toHard[i] - g.cell / 2 - verge;
      for (const { ring, band } of rings) {
        if (sd <= -ZONE_RANGE) break;
        sd = Math.min(sd, ringDistance(x, zz, ring) - band);
      }
      for (const s of spots) sd = Math.min(sd, Math.hypot(x - s.x, zz - s.z) - s.r);
      for (const w of walks) if (sd > -ZONE_RANGE) sd = Math.min(sd, lineDistance(x, zz, w.line) - w.width / 2 - verge);
      out[i] = Math.max(-ZONE_RANGE, Math.min(reach, sd));
    }
  return out;
}

/** Area (m²) of a ring (shoelace). */
export function ringArea(ring: readonly XZ[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}

/**
 * The zone input from the scene's terrain features (already filtered to the scene year): the largest `lawn` of at
 * least PLEASURE_GROUND.minArea (Petri's lawn; small lawns round a pavilion stay close-mown), the terraces within
 * 10 m of it (its garden terrace) with the front band, the rondells inside it with the rondell band, and every
 * furniture point inside it (benches, the herm) with a mown bay. Null when no lawn qualifies.
 */
export function lawnZoneInput(features: readonly TerrainFeature[]): LawnZoneInput | null {
  const local = (c: readonly number[][]): XZ[] => c.map(([E, N]) => [E - E0, -(N - N0)] as XZ);
  const polys = (kind: string) =>
    features.filter((f) => f.kind === kind && f.geometry.type === 'Polygon').map((f) => local((f.geometry.coordinates as number[][][])[0]));
  let lawn: XZ[] | null = null;
  for (const r of polys('lawn')) if (ringArea(r) >= PLEASURE_GROUND.minArea && (!lawn || ringArea(r) > ringArea(lawn))) lawn = r;
  if (!lawn) return null;
  const L = lawn;
  const near = (r: readonly XZ[], m: number) => r.some(([x, z]) => ringDistance(x, z, L) <= m) || L.some(([x, z]) => inRing(x, z, r));
  const rings: { ring: readonly XZ[]; band: number }[] = [];
  for (const r of polys('terrace')) if (near(r, 10)) rings.push({ ring: r, band: PLEASURE_GROUND.frontBand });
  for (const r of polys('rondell')) if (r.every(([x, z]) => inRing(x, z, L))) rings.push({ ring: r, band: PLEASURE_GROUND.rondell });
  const spots: { x: number; z: number; r: number }[] = [];
  for (const f of features) {
    if (f.kind !== 'furniture') continue;
    const g = f.geometry;
    const pts = g.type === 'MultiPoint' ? (g.coordinates as number[][]) : g.type === 'Point' ? [g.coordinates as number[]] : [];
    for (const [x, z] of local(pts)) if (inRing(x, z, L)) spots.push({ x, z, r: PLEASURE_GROUND.spot });
  }
  // the walks (paths ≤ 4 m, draped ribbons) that touch the lawn: belt walk, serpentine, spurs, the garden-front walk
  const walks: { line: XZ[]; width: number }[] = [];
  for (const f of features) {
    if (f.kind !== 'path' || f.geometry.type !== 'LineString' || !f.width || f.width > 4 || f.placement === 'hypothetical') continue;
    const line = local(f.geometry.coordinates as number[][]);
    if (line.some(([x, z]) => ringDistance(x, z, L) <= f.width! / 2 + PLEASURE_GROUND.walkVerge)) walks.push({ line, width: f.width });
  }
  return { lawn: L, rings, spots, walks };
}

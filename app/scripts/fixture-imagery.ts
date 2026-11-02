/**
 * Synthetic colour imagery + building rasters for the fixture (F13/F14, R0.7). Pure (no I/O).
 * Coordinates: u = metres east, v = metres north from the AOI lower-left corner (fixture-terrain.ts).
 *
 * - `orthoColor`: a fake orthophoto (meadow/fields, forest crowns, roads/track of the fixture OSM
 *   ways, red roofs of FIXTURE_HOUSES) — buildings and roads let you check 3D alignment.
 * - `histColor`: a fake 1840 map sheet (paper, 5 m contours, hatched forest, roads, pink houses).
 * - `houseRoofAt` / `bldgMask`: LoD2-like roof height and the contract's building mask
 *   (cell centre inside a footprint, dilated 1 m).
 */
import type { House } from './fixture-buildings.ts';
import { FIXTURE_HOUSES } from './fixture-buildings.ts';
import { fbm, fixtureCanopy, fixtureHeight } from './fixture-terrain.ts';

export type RGB = [number, number, number];

/** Fixture road / track polylines in (u, v) (same vertices as the synthetic OSM ways). */
export const FIXTURE_ROAD: Array<[number, number]> = [[0, 120], [300, 180], [620, 160], [1000, 240]];
export const FIXTURE_TRACK: Array<[number, number]> = [[620, 160], [600, 400], [640, 700], [700, 1000]];

export function distToPolyline(u: number, v: number, pts: ReadonlyArray<[number, number]>): number {
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.min(Math.max(((u - ax) * ex + (v - ay) * ey) / (ex * ex + ey * ey), 0), 1);
    best = Math.min(best, Math.hypot(u - (ax + t * ex), v - (ay + t * ey)));
  }
  return best;
}

/** Local footprint coordinates (x along the ridge, y across) of (u, v) for house h. */
function local(h: House, u: number, v: number): [number, number] {
  const r = (h.rotDeg * Math.PI) / 180;
  const du = u - h.u;
  const dv = v - h.v;
  return [du * Math.cos(r) + dv * Math.sin(r), -du * Math.sin(r) + dv * Math.cos(r)];
}

/** Footprint base height = lowest terrain corner (as fixture-buildings.ts houseTriangles). */
const baseCache = new Map<House, number>();
function houseBase(h: House): number {
  let b = baseCache.get(h);
  if (b === undefined) {
    const r = (h.rotDeg * Math.PI) / 180;
    const ax = [Math.cos(r), Math.sin(r)];
    const ay = [-Math.sin(r), Math.cos(r)];
    b = Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const u = h.u + (ax[0] * sx * h.len) / 2 + (ay[0] * sy * h.wid) / 2;
      const v = h.v + (ax[1] * sx * h.len) / 2 + (ay[1] * sy * h.wid) / 2;
      b = Math.min(b, fixtureHeight(u, v));
    }
    baseCache.set(h, b);
  }
  return b;
}

/** House whose footprint contains (u, v), with its local coordinates; or null. */
export function houseAt(u: number, v: number, houses: readonly House[] = FIXTURE_HOUSES): { h: House; x: number; y: number } | null {
  for (const h of houses) {
    const [x, y] = local(h, u, v);
    if (Math.abs(x) <= h.len / 2 && Math.abs(y) <= h.wid / 2) return { h, x, y };
  }
  return null;
}

/** Absolute roof height (m) at (u, v), or NaN outside every footprint (gable roof along x). */
export function houseRoofAt(u: number, v: number, houses: readonly House[] = FIXTURE_HOUSES): number {
  const hit = houseAt(u, v, houses);
  if (!hit) return NaN;
  const { h, y } = hit;
  return houseBase(h) + h.eave + (h.ridge - h.eave) * (1 - Math.abs(y) / (h.wid / 2));
}

/**
 * Contract building mask for a W×H cell raster (row 0 = north): 1 where the cell centre lies inside
 * a footprint, then dilated by one cell (3 × 3).
 */
export function bldgMask(W: number, H: number, houses: readonly House[] = FIXTURE_HOUSES): Float32Array {
  const inside = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) {
    const v = H - r - 0.5;
    for (let c = 0; c < W; c++) if (houseAt(c + 0.5, v, houses)) inside[r * W + c] = 1;
  }
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let on = 0;
      for (let dr = -1; dr <= 1 && !on; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < H && cc >= 0 && cc < W && inside[rr * W + cc]) {
            on = 1;
            break;
          }
        }
      }
      out[r * W + c] = on;
    }
  }
  return out;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Fake orthophoto colour (sRGB 0–1) at (u, v). */
export function orthoColor(u: number, v: number): RGB {
  const hit = houseAt(u, v);
  if (hit) {
    // Red tiles; the side facing south-east is lit, the other shaded; dark ridge line.
    const lit = hit.y < 0 ? 1 : 0.72;
    const ridge = Math.abs(hit.y) < 0.35 ? 0.55 : 1;
    return [0.66 * lit * ridge, 0.24 * lit * ridge, 0.18 * lit * ridge];
  }
  if (distToPolyline(u, v, FIXTURE_ROAD) < 3) return [0.42, 0.42, 0.44];
  if (distToPolyline(u, v, FIXTURE_TRACK) < 1.6) return [0.6, 0.5, 0.36];
  const chm = fixtureCanopy(u, v);
  if (chm > 0) {
    const crown = 0.5 + 0.5 * fbm(u / 4, v / 4, 2, 31);
    return mix([0.08, 0.2, 0.08], [0.22, 0.38, 0.16], clamp01(crown * 0.8 + chm / 80));
  }
  const field = fbm(u / 90, v / 90, 2, 37);
  const grass = 0.5 + 0.5 * fbm(u / 7, v / 7, 2, 41);
  const meadow = mix([0.36, 0.5, 0.22], [0.52, 0.6, 0.3], grass);
  return field > 0.25 ? mix(meadow, [0.72, 0.64, 0.42], 0.8) : meadow;
}

/** Fake 1836–41 map sheet colour (sRGB 0–1) at (u, v). */
export function histColor(u: number, v: number): RGB {
  const paper: RGB = [0.93, 0.88, 0.75];
  if (houseAt(u, v)) return [0.85, 0.42, 0.45];
  const dRoad = distToPolyline(u, v, FIXTURE_ROAD);
  if (dRoad < 4 && dRoad > 2.5) return [0.15, 0.12, 0.1]; // double-lined road
  if (dRoad <= 2.5) return [0.97, 0.93, 0.8];
  if (Math.abs(distToPolyline(u, v, FIXTURE_TRACK) - 0.0) < 1) return [0.3, 0.25, 0.2];
  let c = paper;
  if (fixtureCanopy(u, v) > 0) {
    c = mix(paper, [0.7, 0.8, 0.6], 0.6);
    // Tree symbols on a 12 m grid.
    const gx = ((u % 12) + 12) % 12;
    const gy = ((v % 12) + 12) % 12;
    if (Math.hypot(gx - 6, gy - 6) < 1.2) c = [0.25, 0.35, 0.2];
  }
  // 5 m contours (brown, ~1 m wide on gentle slopes).
  const h = fixtureHeight(u, v);
  const f = h / 5 - Math.floor(h / 5);
  if (f < 0.04 || f > 0.96) c = mix(c, [0.55, 0.35, 0.2], 0.8);
  return c;
}

/**
 * Render `color` on a raster of `W × H` px at `s` m per px, row 0 = north edge (v = Vtop),
 * pixel centres at ((px + 0.5)·s, Vtop − (py + 0.5)·s). Returns three Float32 planes.
 */
export function renderPlanes(W: number, H: number, s: number, Vtop: number, color: (u: number, v: number) => RGB): Float32Array[] {
  const planes = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  for (let py = 0; py < H; py++) {
    const v = Vtop - (py + 0.5) * s;
    for (let px = 0; px < W; px++) {
      const c = color((px + 0.5) * s, v);
      const k = py * W + px;
      planes[0][k] = c[0];
      planes[1][k] = c[1];
      planes[2][k] = c[2];
    }
  }
  return planes;
}

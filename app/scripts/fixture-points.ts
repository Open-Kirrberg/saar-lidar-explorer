/**
 * Synthetic F16 point clouds for the fixture AOI (docs/data-contract.md "Point clouds"): two small
 * focus areas of 100 m tiles in `sle-pts-v1`, ≈ 4 pts/m² like the LVGL ALS 2025 data. Ground
 * points (class 2) lie on the exact procedural surface, vegetation (20) under/at the fixture
 * canopy, roofs (6) on the fixture houses, a few unclassified (1) and synthetic fill points (30).
 * `agl` = z − bilinear 1 m DTM (cell centres), as the pipeline computes it. Deterministic.
 */
import { encodeSlep } from '../src/pointcloud/slep.ts';
import type { SlepPoint } from '../src/pointcloud/slep.ts';
import { houseRoofAt } from './fixture-imagery.ts';
import { FIXTURE, fixtureCanopy, fixtureHeight } from './fixture-terrain.ts';

export const POINT_TILE = 100;
export const POINT_DENSITY = 4;

/** Areas in metres east/north of the fixture's lower-left corner (multiples of 100 m). */
export interface FixturePointArea {
  id: string;
  name_de: string;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export const FIXTURE_POINT_AREAS: readonly FixturePointArea[] = [
  { id: 'fixture-dorf', name_de: 'Dorf (synthetisch)', u0: 100, v0: 100, u1: 300, v1: 300 },
  { id: 'fixture-mitte', name_de: 'Befunde Mitte (synthetisch)', u0: 400, v0: 400, u1: 700, v1: 700 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear height of a W×H cell raster (row 0 = north, cell centres, edge-clamped) at (u, v). */
export function bilinearDtm(dtm: Float32Array, W: number, H: number, u: number, v: number): number {
  const fc = Math.min(Math.max(u - 0.5, 0), W - 1);
  const fr = Math.min(Math.max(H - v - 0.5, 0), H - 1);
  const c0 = Math.min(Math.floor(fc), W - 2);
  const r0 = Math.min(Math.floor(fr), H - 2);
  const tx = fc - c0;
  const ty = fr - r0;
  const z = (c: number, r: number) => dtm[r * W + c];
  const top = z(c0, r0) * (1 - tx) + z(c0 + 1, r0) * tx;
  const bot = z(c0, r0 + 1) * (1 - tx) + z(c0 + 1, r0 + 1) * tx;
  return top * (1 - ty) + bot * ty;
}

export interface FixturePointTile {
  tx: number;
  ty: number;
  buf: ArrayBuffer;
  count: number;
  classCounts: Record<string, number>;
  hMin: number;
  hMax: number;
}

/** Generate all tiles of one area (dtm = the fixture's full-resolution raster). */
export function fixturePointTiles(area: FixturePointArea, dtm: Float32Array): FixturePointTile[] {
  const { width: W, height: H } = FIXTURE;
  const out: FixturePointTile[] = [];
  const nx = (area.u1 - area.u0) / POINT_TILE;
  const ny = (area.v1 - area.v0) / POINT_TILE;
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const rnd = mulberry32(0x5eed + tx * 7919 + ty * 104729 + area.u0 * 31);
      const n = Math.round(POINT_TILE * POINT_TILE * POINT_DENSITY * (0.95 + 0.1 * rnd()));
      const pts: SlepPoint[] = [];
      for (let k = 0; k < n; k++) {
        const dE = rnd() * POINT_TILE;
        const dN = rnd() * POINT_TILE;
        const u = area.u0 + tx * POINT_TILE + dE;
        const v = area.v0 + ty * POINT_TILE + dN;
        const g = fixtureHeight(u, v) + (rnd() - 0.5) * 0.06;
        const roof = houseRoofAt(u, v);
        const canopy = fixtureCanopy(u, v);
        const r = rnd();
        let z = g;
        let cls = 2;
        let intensity = 70 + rnd() * 80;
        if (Number.isFinite(roof)) {
          z = roof + (rnd() - 0.5) * 0.04;
          cls = 6;
          intensity = 150 + rnd() * 70;
        } else if (canopy > 2) {
          if (r < 0.5) {
            z = g + canopy * (0.8 + 0.2 * rnd());
            cls = 20;
            intensity = 30 + rnd() * 80;
          } else if (r < 0.75) {
            z = g + 0.3 + canopy * 0.8 * rnd();
            cls = 20;
            intensity = 25 + rnd() * 60;
          } else if (r < 0.752) {
            cls = 30; // synthetic fill point under dense canopy
            intensity = 0;
          }
        } else if (r < 0.04) {
          z = g + 0.2 + 1.3 * rnd();
          cls = 20;
          intensity = 40 + rnd() * 70;
        } else if (r < 0.045) {
          z = g + 2 + 18 * rnd();
          cls = 1;
          intensity = 10 + rnd() * 40;
        }
        pts.push({ dE, dN, h: z, agl: z - bilinearDtm(dtm, W, H, u, v), cls, intensity });
      }
      const buf = encodeSlep(pts);
      const classCounts: Record<string, number> = {};
      let hMin = Infinity;
      let hMax = -Infinity;
      for (const p of pts) {
        classCounts[p.cls] = (classCounts[p.cls] ?? 0) + 1;
        hMin = Math.min(hMin, p.h);
        hMax = Math.max(hMax, p.h);
      }
      out.push({ tx, ty, buf, count: pts.length, classCounts, hMin, hMax });
    }
  }
  return out;
}

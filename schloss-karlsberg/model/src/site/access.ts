/**
 * Walk access around the buildings (pure, no three.js; unit-tested in Node):
 *  - siteEntrances(): portals and Durchfahrten of the placed buildings in the local frame (these are the entrance POIs);
 *  - siteWalls(): the retaining-wall pieces of terraces and scarps exactly as features.ts builds them, with a gap and
 *    a short flight of steps where a Durchfahrt at terrace level leads through a terrace wall (e.g. the garden-side
 *    Durchfahrten of the S/N arms down to the lower terrace TF-08);
 *  - entranceWalkable(): can a walker starting at the entrance POI reach the threshold? No wall piece on the way and
 *    no first step higher than the walk step height (viewer/src/controls.ts STEP_MAX).
 *
 * Local frame: x = E − E0, z = −(N − N0), y = true height (m DHHN2016).
 */
import type { BuildContext, TerrainSampler } from '../context.ts';
import { E0, N0 } from '../frame.ts';
import { stToEN } from '../layout/footprint.ts';
import type { Building, EN, SideName, SiteSpec, TerrainFeature } from '../spec.ts';
import { isPlaced } from '../spec.ts';
import { SCENE_YEAR, inEpoch, inScene } from '../layout/epoch.ts';
import { driveCuts, isDrive } from './drive.ts';

/** Highest step the walker climbs without a stair (m). Shared with viewer/src/controls.ts. */
export const WALK_STEP_MAX = 0.35;
/** Distance of an entrance POI from the facade (m). */
export const ENTRANCE_POI_DIST = 8;
/** Steps cut into a terrace wall in front of a Durchfahrt [N: Freitreppe proportions, grammar STAIR.freitreppe]. */
export const GAP_STAIR = { riser: 0.15, tread: 0.4, extraWidth: 0.6 } as const;
/** Freitreppe run in front of a portal: steps × tread + top landing (exterior/facade.ts freitreppe()). */
const FREITREPPE_TREAD = 0.4;
const FREITREPPE_LANDING = 0.3;
/** Walker capsule radius used for the wall clearance test (viewer controls: 0.3 m). */
const WALKER_RADIUS = 0.3;

type XZ = [number, number];

/** Buildings to render: placed, standing in the scene year (KB-I03 `epoch`), and hypothetical ones only on request. */
export function siteBuildings(spec: SiteSpec, ctx: Pick<BuildContext, 'options'>): Building[] {
  const year = ctx.options.year ?? SCENE_YEAR;
  return spec.buildings.filter((b) => isPlaced(b) && inEpoch(b.epoch, year) && (b.placement !== 'hypothetical' || ctx.options.showHypothetical));
}

/** Terrain features that existed in the scene year (KB-I03 `epoch`; default 1789). */
export function siteFeatures(spec: SiteSpec, year: number = SCENE_YEAR): TerrainFeature[] {
  return inScene(spec.terrain_features, year);
}

export interface Entrance {
  /** Same id as the entrance POI: `${buildingId}/${kind}-${side}-${axis}`. */
  id: string;
  buildingId: string;
  kind: 'portal' | 'durchfahrt';
  side: SideName;
  axis: number;
  /** Opening centre on the facade (local x, z). */
  door: XZ;
  /** Unit outward facade normal (local x, z). */
  out: XZ;
  width: number;
  /** Opening bottom (m DHHN2016). */
  threshold_h: number;
  /** Where a walker steps on from outside: distance from the facade (Freitreppe run, 0 without steps) and height. */
  foot_d: number;
  foot_h: number;
}

/** Portals and Durchfahrten of the placed buildings (layout failures are skipped like in sitePois). */
export function siteEntrances(spec: SiteSpec, ctx: Pick<BuildContext, 'options' | 'layout'>): Entrance[] {
  const out: Entrance[] = [];
  for (const b of siteBuildings(spec, ctx)) {
    let L;
    try {
      L = ctx.layout(b);
    } catch {
      continue;
    }
    const f = L.frame;
    for (const o of L.openings) {
      if (o.kind !== 'portal' && o.kind !== 'durchfahrt') continue;
      const sd = f.sides[o.side];
      const pIn: [number, number] = [sd.p0[0] + sd.tangent[0] * o.a, sd.p0[1] + sd.tangent[1] * o.a];
      const [Ed, Nd] = stToEN(f, pIn);
      const [Eo, No] = stToEN(f, [pIn[0] + sd.normal[0], pIn[1] + sd.normal[1]]);
      const dx = Eo - Ed;
      const dz = -(No - Nd);
      const dl = Math.hypot(dx, dz) || 1;
      const steps = o.steps ?? 0;
      out.push({
        id: `${b.id}/${o.kind}-${o.side}-${o.axis}`,
        buildingId: b.id,
        kind: o.kind,
        side: o.side,
        axis: o.axis,
        door: [Ed - E0, -(Nd - N0)],
        out: [dx / dl, dz / dl],
        width: o.width,
        threshold_h: o.bottom_h,
        foot_d: steps > 0 ? steps * FREITREPPE_TREAD + FREITREPPE_LANDING : 0,
        foot_h: steps > 0 ? (o.grade_h ?? L.stack.base_h) : o.bottom_h,
      });
    }
  }
  return out;
}

export interface WallPiece {
  featureId: string;
  /** Centre line (local x, z). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Cap top and foundation bottom (m). */
  top: number;
  foot: number;
  thick: number;
}

/** Flight of steps in a terrace-wall gap, descending outward from the terrace level to the ground outside. */
export interface GapStair {
  featureId: string;
  entranceId: string;
  /** Where the corridor centre line crosses the terrace edge (local x, z). */
  x: number;
  z: number;
  /** Unit downhill direction (local x, z) = the entrance's outward normal. */
  dir: XZ;
  width: number;
  /** Terrace level (top of the flight) and the ground at its foot (m). */
  top: number;
  ground: number;
  steps: number;
  riser: number;
  tread: number;
}

export interface SiteWalls {
  pieces: WallPiece[];
  stairs: GapStair[];
}

/** Wall pieces (≤ `piece` m) along a local polyline; same rule as before: skip where top − foot < 0.2 or NaN. */
function piecesAlong(out: WallPiece[], featureId: string, line: XZ[], thick: number, top: TerrainSampler, foot: TerrainSampler, piece = 3): void {
  for (let i = 1; i < line.length; i++) {
    const [xa, za] = line[i - 1];
    const [xb, zb] = line[i];
    const len = Math.hypot(xb - xa, zb - za);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / piece));
    for (let k = 0; k < n; k++) {
      const x0 = xa + ((xb - xa) * k) / n;
      const z0 = za + ((zb - za) * k) / n;
      const x1 = xa + ((xb - xa) * (k + 1)) / n;
      const z1 = za + ((zb - za) * (k + 1)) / n;
      const xm = (x0 + x1) / 2;
      const zm = (z0 + z1) / 2;
      const t = top(xm, zm);
      const f = Math.min(foot(x0, z0), foot(x1, z1), foot(xm, zm)) - 0.4;
      if (!Number.isFinite(t) || !Number.isFinite(f) || t - f < 0.2) continue;
      out.push({ featureId, x0, z0, x1, z1, top: t, foot: f, thick });
    }
  }
}

/** Merge [a, b] intervals and return the complement within [0, len]. */
function keepIntervals(len: number, cuts: [number, number][]): [number, number][] {
  const c = cuts.map(([a, b]) => [Math.max(0, a), Math.min(len, b)] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const keep: [number, number][] = [];
  let s = 0;
  for (const [a, b] of c) {
    if (a > s) keep.push([s, a]);
    s = Math.max(s, b);
  }
  if (s < len) keep.push([s, len]);
  return keep.filter(([a, b]) => b - a > 0.05);
}

const local = ([E, N]: EN): XZ => [E - E0, -(N - N0)];

/**
 * Retaining walls of terraces (where the outside drops > 0.6 m below the terrace level; top = level + 0.35 parapet)
 * and scarps (top + 0.3), cut by 0.8 / 0.9 m thick pieces of ≤ 3 m. A Durchfahrt whose threshold lies on a terrace
 * level and whose outward corridor (−1 … ENTRANCE_POI_DIST + 4 m) crosses that terrace's edge gets a gap of
 * (opening width + 0.6 m) in the wall and, where the wall would stand, a flight of steps down to the outside ground.
 */
export function siteWalls(spec: SiteSpec, terr: TerrainSampler, entrances: readonly Entrance[], year: number = SCENE_YEAR): SiteWalls {
  const pieces: WallPiece[] = [];
  const stairs: GapStair[] = [];
  // wave-9 review fix: a graded drive leaving a terrace edge (KB-V2) cuts the terrace wall (drive.ts driveCuts)
  const drives = siteFeatures(spec, year).filter(isDrive);
  for (const f of siteFeatures(spec, year)) {
    if (f.kind === 'terrace') {
      if (f.level === undefined || !f.wall_height || f.geometry.type !== 'Polygon') continue;
      const lvl = f.level;
      const ring = f.geometry.coordinates[0] as EN[];
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      const pts = area > 0 ? ring : ring.slice().reverse();
      const doors = entrances.filter((e) => e.kind === 'durchfahrt' && Math.abs(e.threshold_h - lvl) <= WALK_STEP_MAX);
      for (let i = 1; i < pts.length; i++) {
        const [E1, N1] = pts[i - 1];
        const [E2, N2] = pts[i];
        const len = Math.hypot(E2 - E1, N2 - N1);
        if (len < 1e-6) continue;
        const nx = (N2 - N1) / len; // outward (right of a CCW ring), EN
        const ny = -(E2 - E1) / len;
        const outside = (x: number, z: number) => {
          let m = Infinity;
          for (const d of [1.0, 2.5, 4]) m = Math.min(m, terr(x + nx * d, z - ny * d));
          return m;
        };
        const a = local([E1, N1]);
        const b = local([E2, N2]);
        const ux = (b[0] - a[0]) / len;
        const uz = (b[1] - a[1]) / len;
        const onx = nx; // outward normal in local (x, z) = (nx, −ny)
        const onz = -ny;
        const cuts: [number, number][] = driveCuts(drives, a, b);
        for (const e of doors) {
          // corridor centre line door + out·d crosses the segment a + u·s?
          const cos = e.out[0] * onx + e.out[1] * onz;
          if (cos < 0.3) continue; // door must face out of the terrace, not graze its edge
          const den = e.out[0] * uz - e.out[1] * ux;
          if (Math.abs(den) < 1e-9) continue;
          const wx = a[0] - e.door[0];
          const wz = a[1] - e.door[1];
          const d = (wx * uz - wz * ux) / den; // along the corridor
          const s = (wx * e.out[1] - wz * e.out[0]) / den; // along the segment
          if (d < -1 || d > ENTRANCE_POI_DIST + 4 || s < -1 || s > len + 1) continue;
          const width = e.width + GAP_STAIR.extraWidth;
          const half = width / 2 / cos;
          cuts.push([s - half, s + half]);
          const x = e.door[0] + e.out[0] * d;
          const z = e.door[1] + e.out[1] * d;
          const ground = outside(x, z);
          if (!(ground < lvl - 0.6)) continue; // no wall here, so no steps either
          const steps = Math.max(2, Math.ceil((lvl - ground) / GAP_STAIR.riser - 1e-6));
          stairs.push({ featureId: f.id, entranceId: e.id, x, z, dir: [e.out[0], e.out[1]], width, top: lvl, ground, steps, riser: (lvl - ground) / steps, tread: GAP_STAIR.tread });
        }
        for (const [s0, s1] of keepIntervals(len, cuts)) {
          const line: XZ[] = [
            [a[0] + ux * s0, a[1] + uz * s0],
            [a[0] + ux * s1, a[1] + uz * s1],
          ];
          piecesAlong(pieces, f.id, line, 0.8, (x, z) => (outside(x, z) < lvl - 0.6 ? lvl + 0.35 : NaN), outside);
        }
      }
    } else if (f.kind === 'scarp') {
      if (f.geometry.type !== 'LineString' || f.top === undefined) continue;
      const top = f.top;
      piecesAlong(pieces, f.id, (f.geometry.coordinates as EN[]).map(local), 0.9, () => top + 0.3, (x, z) => Math.min(terr(x, z), f.foot ?? Infinity));
    }
  }
  return { pieces, stairs };
}

/** Shortest distance between segments p0–p1 and q0–q1 in the plane. */
export function segSegDist(p0: XZ, p1: XZ, q0: XZ, q1: XZ): number {
  const cross = (o: XZ, a: XZ, b: XZ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = cross(q0, q1, p0);
  const d2 = cross(q0, q1, p1);
  const d3 = cross(p0, p1, q0);
  const d4 = cross(p0, p1, q1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const ptSeg = (p: XZ, a: XZ, b: XZ) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
  };
  return Math.min(ptSeg(p0, q0, q1), ptSeg(p1, q0, q1), ptSeg(q0, p0, p1), ptSeg(q1, p0, p1));
}

/**
 * Can a walker standing at `start` (local x, z) walk to the entrance? Deterministic plan test against the generated
 * walls: (1) the straight approach from `start` to the foot of the entrance (or 1 m into a Durchfahrt) keeps clear of
 * every wall piece; (2) unless a gap stair serves the entrance, the first step at the foot — foot_h minus the ground
 * 0.5 m in front of it — is at most WALK_STEP_MAX. A NaN ground (outside the terrain) does not count against it.
 */
export function entranceWalkable(e: Entrance, start: XZ, walls: SiteWalls, terr: TerrainSampler): boolean {
  const endD = e.foot_d > 0 ? e.foot_d + 0.3 : -1;
  const end: XZ = [e.door[0] + e.out[0] * endD, e.door[1] + e.out[1] * endD];
  for (const p of walls.pieces) if (segSegDist(start, end, [p.x0, p.z0], [p.x1, p.z1]) < p.thick / 2 + WALKER_RADIUS) return false;
  if (walls.stairs.some((s) => s.entranceId === e.id)) return true;
  const fd = e.foot_d + 0.5;
  const g = terr(e.door[0] + e.out[0] * fd, e.door[1] + e.out[1] * fd);
  return !(e.foot_h - g > WALK_STEP_MAX);
}

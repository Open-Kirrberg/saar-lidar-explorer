/**
 * Graded carriage drives (wave-9 review fix, catalogue KB-V2): a `path` LineString with `top` (height at its first
 * vertex), `foot` (at its last), `width` and `wall_height` (0 = unwalled) is a drive on a straight grade (a path with
 * top/foot/width but no `wall_height`, like the terrace stair TF-35, is not); with `wall_height` > 0 it is a walled ramp whose
 * flanking walls (Wangenmauern) stand on both edges while the fill exceeds DRIVE.wallMinFill, their parapet
 * `wall_height` above the drive. scripts/prepare-terrain.py grades the terrain the same way (DRIVE_* there mirror
 * DRIVE here); access.ts cuts a terrace wall across the drive (driveCuts) and features.ts draws the walls and clips a
 * fence that crosses the drive (clipOutsideDrives). Pure: no three.js; local frame x = E − E0, z = −(N − N0).
 */
import { E0, N0 } from '../frame.ts';
import { DRIVE } from '../layout/grammar.ts';
import type { EN, TerrainFeature } from '../spec.ts';

type XZ = [number, number];

export interface DriveFrame {
  id: string;
  /** top end (first vertex) and unit direction down the drive, local x/z */
  a: XZ;
  dir: XZ;
  /** unit normal (left of `dir` seen from above) */
  nrm: XZ;
  len: number;
  half: number;
  top: number;
  foot: number;
  /** parapet above the drive surface (m); 0 = no walls */
  parapet: number;
  /** drive surface height at `s` metres from the top (clamped to the ends) */
  at(s: number): number;
}

export function isDrive(f: TerrainFeature): boolean {
  return f.kind === 'path' && f.geometry.type === 'LineString' && f.top !== undefined && f.foot !== undefined && !!f.width && f.wall_height !== undefined && (f.geometry.coordinates as EN[]).length >= 2;
}

/** The forecourt strip KB-V1: a path LineString whose surface names a forecourt and that is no drive (prepare-terrain is_forecourt). */
export function isForecourt(f: TerrainFeature): boolean {
  return f.kind === 'path' && f.geometry.type === 'LineString' && /forecourt/i.test(f.surface ?? '') && !isDrive(f);
}

/**
 * A path drawn as a draped ribbon (features.ts walkMesh; the grass blades keep off it): garden walks up to 4 m, and
 * the forecourt strip and graded drives at any width. The last two are not painted into the ground classes
 * (prepare-terrain), so the viewer's seeded tree planners never see them (a new hypothetical way moves no tree).
 */
export function isDrapedWay(f: TerrainFeature): boolean {
  return f.kind === 'path' && f.geometry.type === 'LineString' && !!f.width && (f.width <= 4 || isDrive(f) || isForecourt(f));
}

export function driveFrame(f: TerrainFeature): DriveFrame {
  const pts = f.geometry.coordinates as EN[];
  const [E0a, N0a] = pts[0];
  const [E1, N1] = pts[pts.length - 1];
  const a: XZ = [E0a - E0, -(N0a - N0)];
  const b: XZ = [E1 - E0, -(N1 - N0)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir: XZ = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const top = f.top as number;
  const foot = f.foot as number;
  return {
    id: f.id,
    a,
    dir,
    nrm: [-dir[1], dir[0]],
    len,
    half: (f.width as number) / 2,
    top,
    foot,
    parapet: f.wall_height ?? 0,
    at: (s: number) => top + ((foot - top) * Math.min(Math.max(s, 0), len)) / len,
  };
}

/** Grade of a drive (rise / run, positive). */
export function driveGrade(d: DriveFrame): number {
  return Math.abs(d.top - d.foot) / d.len;
}

/** (along, across) of a local point in the drive frame: along from the top end, across signed (+ = `nrm` side). */
export function driveCoords(d: DriveFrame, x: number, z: number): [number, number] {
  const px = x - d.a[0];
  const pz = z - d.a[1];
  return [px * d.dir[0] + pz * d.dir[1], px * d.nrm[0] + pz * d.nrm[1]];
}

export interface DriveWall {
  driveId: string;
  side: -1 | 1;
  /** centre line ends (local x/z) */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** top of the parapet at each end (sloping with the drive) and the foot (lowest ground along the outer face − 0.4) */
  top0: number;
  top1: number;
  foot: number;
  thick: number;
}

/**
 * Flanking walls of a walled drive: on each side a run of pieces (≤ DRIVE.pieceLen m) from DRIVE.wallStart m inside the
 * top end (the terrace wall's inner face) down the drive while the drive stands more than DRIVE.wallMinFill above the
 * ground just outside the wall (sampled DRIVE.wallThick + DRIVE.runout + 0.4 m off the edge, beyond prepare-terrain's
 * run-out). The parapet slopes with the drive (one sloping box per piece, so joints line up without steps).
 */
export function driveWalls(f: TerrainFeature, terr: (x: number, z: number) => number): DriveWall[] {
  if (!isDrive(f) || !(f.wall_height && f.wall_height > 0)) return [];
  const d = driveFrame(f);
  const t = DRIVE.wallThick;
  const out: DriveWall[] = [];
  for (const side of [-1, 1] as const) {
    const off = side * (d.half + t / 2);
    const pt = (s: number): XZ => [d.a[0] + d.dir[0] * s + d.nrm[0] * off, d.a[1] + d.dir[1] * s + d.nrm[1] * off];
    const ground = (s: number) => {
      const o = side * (d.half + t + DRIVE.runout + 0.4);
      return terr(d.a[0] + d.dir[0] * s + d.nrm[0] * o, d.a[1] + d.dir[1] * s + d.nrm[1] * o);
    };
    // last station where the fill still needs a wall (scan in 0.5 m steps from the top)
    let end = -1;
    for (let s = 0; s <= d.len; s += 0.5) {
      const g = ground(s);
      if (Number.isFinite(g) && d.at(s) - g > DRIVE.wallMinFill) end = s;
    }
    if (end < 1) continue;
    const s0 = -DRIVE.wallStart;
    const n = Math.max(1, Math.ceil((end - s0) / DRIVE.pieceLen));
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((end - s0) * k) / n;
      const sb = s0 + ((end - s0) * (k + 1)) / n;
      const [x0, z0] = pt(sa);
      const [x1, z1] = pt(sb);
      let low = Infinity;
      for (const u of [0, 0.5, 1]) {
        const s = sa + (sb - sa) * u;
        for (const o of [d.half, d.half + t, d.half + t + DRIVE.runout]) {
          const g = terr(d.a[0] + d.dir[0] * s + d.nrm[0] * side * o, d.a[1] + d.dir[1] * s + d.nrm[1] * side * o);
          if (Number.isFinite(g)) low = Math.min(low, g);
        }
      }
      if (!Number.isFinite(low)) continue;
      out.push({ driveId: d.id, side, x0, z0, x1, z1, top0: d.at(sa) + d.parapet, top1: d.at(sb) + d.parapet, foot: Math.min(low, d.at(sb)) - 0.4, thick: t });
    }
  }
  return out;
}

/**
 * Interval [s0, s1] (metres along the segment a→b, local x/z) where a drive crosses the segment, widened to the
 * drive's outer wall faces (walled) or its edges, so a terrace wall stops where the flanking walls begin. Only drives
 * whose top end lies within `near` m of the segment cut it (the terrace edge the drive leaves).
 */
export function driveCuts(drives: readonly TerrainFeature[], a: XZ, b: XZ, near = 2): [number, number][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const ux = (b[0] - a[0]) / len;
  const uz = (b[1] - a[1]) / len;
  const cuts: [number, number][] = [];
  for (const f of drives) {
    if (!isDrive(f)) continue;
    const d = driveFrame(f);
    // top end near the segment?
    const wx = d.a[0] - a[0];
    const wz = d.a[1] - a[1];
    const along = wx * ux + wz * uz;
    const dist = Math.abs(wx * uz - wz * ux);
    if (dist > near || along < -d.half - 2 || along > len + d.half + 2) continue;
    // crossing of the drive centre line with the segment's line, and the half-width measured along the segment
    const cos = Math.abs(d.dir[0] * uz - d.dir[1] * ux); // |sin| of the angle between the drive and the segment
    if (cos < 0.2) continue;
    const den = d.dir[0] * uz - d.dir[1] * ux;
    const tSeg = (wx * d.dir[1] - wz * d.dir[0]) / -den; // along the segment
    const w = (d.half + (d.parapet > 0 ? DRIVE.wallThick : 0)) / cos;
    cuts.push([tSeg - w, tSeg + w]);
  }
  return cuts;
}

/**
 * Pieces of a polyline (local x/z) that lie outside every drive corridor (|across| ≤ half + wall + `clear`, along
 * within the drive): a fence across a drive stops at its walls.
 */
export function clipOutsideDrives(line: readonly XZ[], drives: readonly TerrainFeature[], clear = 0.2): XZ[][] {
  const fr = drives.filter(isDrive).map(driveFrame);
  const inside = (p: XZ) =>
    fr.some((d) => {
      const [s, c] = driveCoords(d, p[0], p[1]);
      return s >= -1 && s <= d.len && Math.abs(c) <= d.half + (d.parapet > 0 ? DRIVE.wallThick : 0) + clear;
    });
  const out: XZ[][] = [];
  let cur: XZ[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const p = line[i];
    const q = line[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.05));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const r: XZ = [p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n];
      if (inside(r)) {
        if (cur.length >= 2) out.push(cur);
        cur = [];
      } else cur.push(r);
    }
  }
  if (cur.length >= 2) out.push(cur);
  // keep only the run ends (and the original interior vertices) so the fence layout sees straight runs
  return out
    .map((run) => [run[0], ...line.filter((v) => run.some((r) => r[0] === v[0] && r[1] === v[1]) && v !== run[0] && v !== run[run.length - 1]), run[run.length - 1]] as XZ[])
    .filter((run) => Math.hypot(run[run.length - 1][0] - run[0][0], run[run.length - 1][1] - run[0][1]) > 0.3);
}

/**
 * Building local frame derived from a footprint ring (pure).
 *
 * Plan coordinates [s, t] in metres, origin at the centre of the oriented (minimum-area)
 * rectangle around the footprint:
 *   +t = outward normal of the COURT side (the long side that faces `courtToward`)
 *   +s = +t rotated 90° clockwise, so (s, t) is right-handed like (E, N)
 *
 *            end_a (s = −L/2)          end_b (s = +L/2)
 *                 ┌──────────── court (t = +W/2) ───────────┐
 *                 │                    ↑ +t                  │
 *                 │                    o──→ +s               │
 *                 └──────────── garden (t = −W/2) ──────────┘
 *
 * Sides run counter-clockwise around the plan; each side's p0 is its LEFT end as seen
 * from outside, p1 its right end; facade positions `a` are measured from p0 towards p1.
 *   garden: (−L/2,−W/2) → (+L/2,−W/2)      end_b: (+L/2,−W/2) → (+L/2,+W/2)
 *   court : (+L/2,+W/2) → (−L/2,+W/2)      end_a: (−L/2,+W/2) → (−L/2,−W/2)
 *
 * three.js object space of a building group (see docs/architecture.md):
 *   group.position = (xc, 0, zc), group.rotation.y = frame.rotationY,
 *   children at (X, Y, Z) = (s, h, −t) with h the TRUE height (m DHHN2016).
 */
import { E0, N0, type Vec3, azimuthOf } from '../frame.ts';
import type { EN, PolygonST, RingEN, SideName, ST } from '../spec.ts';
import { type P2, circleEstimate, ensureCCW, minAreaRect, openRing, signedArea } from './geom.ts';

export interface FrameSide {
  name: SideName;
  p0: ST;
  p1: ST;
  length: number;
  /** Unit vector p0 -> p1 in [s, t]. */
  tangent: ST;
  /** Outward unit normal in [s, t]. */
  normal: ST;
  p0EN: EN;
  p1EN: EN;
  /** Grid azimuth (deg) of the outward normal - "which way the facade looks". */
  normalAzimuth: number;
}

export type FootprintShape = 'rect' | 'polygon' | 'round';

export interface BuildingFrame {
  shape: FootprintShape;
  /** Origin of [s, t] in EN (centre of the oriented rectangle, or circle centre). */
  centreEN: EN;
  /** Unit vectors of +s and +t in EN. */
  sDir: EN;
  tDir: EN;
  /** Grid azimuth of +s. */
  azimuthS: number;
  /** Rectangle extents along s (length, >= width for rect) and t. */
  length: number;
  width: number;
  /** Round footprints: mean radius. */
  radius?: number;
  /** Footprint area / rectangle area. */
  rectangularity: number;
  /** Footprint in [s, t] (CCW, open). */
  ringST: PolygonST;
  sides: Record<SideName, FrameSide>;
  /** three.js rotation.y of the building group (radians). */
  rotationY: number;
  /** Local-frame position (x, 0, z) of the group origin. */
  originLocal: Vec3;
}

export interface FrameOptions {
  /** EN point the court side faces (default: none -> +t chosen so +s has azimuth in [0°, 180°)). */
  courtToward?: EN;
  /** Force the long axis to this grid azimuth (deg) instead of the min-area rectangle. */
  axisAzimuth?: number;
  /** Rectangularity above which the footprint counts as a rectangle (default 0.97). */
  rectThreshold?: number;
  /** Max coefficient of variation of radii for a round footprint (default 0.04). */
  roundCv?: number;
}

export function buildingFrame(ring: RingEN, opts: FrameOptions = {}): BuildingFrame {
  const pts = ensureCCW(openRing(ring)) as P2[];
  if (pts.length < 3) throw new Error('buildingFrame: footprint needs >= 3 points');
  const area = Math.abs(signedArea(pts));

  // Work relative to the first vertex to keep precision with UTM magnitudes.
  const ref: P2 = [pts[0][0], pts[0][1]];
  const rel = pts.map((p) => [p[0] - ref[0], p[1] - ref[1]] as P2);

  let centre: P2;
  let axis: P2;
  let length: number;
  let width: number;
  let rectArea: number;

  const circ = circleEstimate(rel);
  const round = rel.length >= 12 && circ.cv < (opts.roundCv ?? 0.04);

  if (opts.axisAzimuth !== undefined) {
    const a = (opts.axisAzimuth * Math.PI) / 180;
    axis = [Math.sin(a), Math.cos(a)];
    const r = extentsAlong(rel, axis);
    centre = r.centre;
    length = r.length;
    width = r.width;
    rectArea = length * width; // the given axis stays +s even if it is the short side
  } else {
    const r = minAreaRect(rel);
    centre = r.centre;
    axis = r.axis;
    length = r.length;
    width = r.width;
    rectArea = r.area;
  }
  if (round) {
    centre = circ.centre;
    length = width = 2 * circ.radius;
  }

  // Choose t (perpendicular to the axis) towards the court.
  let tDir: P2 = [-axis[1], axis[0]]; // axis rotated CCW
  const centreEN: EN = [centre[0] + ref[0], centre[1] + ref[1]];
  if (opts.courtToward) {
    const d: P2 = [opts.courtToward[0] - centreEN[0], opts.courtToward[1] - centreEN[1]];
    if (d[0] * tDir[0] + d[1] * tDir[1] < 0) tDir = [-tDir[0], -tDir[1]];
  } else {
    // canonical: +s azimuth in [0, 180)
    const sTry: P2 = [tDir[1], -tDir[0]];
    if (azimuthOf(sTry[0], sTry[1]) >= 180) tDir = [-tDir[0], -tDir[1]];
  }
  const sDir: EN = [tDir[1], -tDir[0]]; // t rotated CW

  const toST = (p: P2): ST => {
    const dx = p[0] - centreEN[0];
    const dy = p[1] - centreEN[1];
    return [dx * sDir[0] + dy * sDir[1], dx * tDir[0] + dy * tDir[1]];
  };
  const ringST = pts.map((p) => toST(p));

  const L = length;
  const W = width;
  const toEN = (p: ST): EN => [centreEN[0] + p[0] * sDir[0] + p[1] * tDir[0], centreEN[1] + p[0] * sDir[1] + p[1] * tDir[1]];
  const mk = (name: SideName, p0: ST, p1: ST, normal: ST): FrameSide => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const nEN: EN = [normal[0] * sDir[0] + normal[1] * tDir[0], normal[0] * sDir[1] + normal[1] * tDir[1]];
    return {
      name,
      p0,
      p1,
      length: len,
      tangent: [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len],
      normal,
      p0EN: toEN(p0),
      p1EN: toEN(p1),
      normalAzimuth: azimuthOf(nEN[0], nEN[1]),
    };
  };
  const sides: Record<SideName, FrameSide> = {
    garden: mk('garden', [-L / 2, -W / 2], [L / 2, -W / 2], [0, -1]),
    end_b: mk('end_b', [L / 2, -W / 2], [L / 2, W / 2], [1, 0]),
    court: mk('court', [L / 2, W / 2], [-L / 2, W / 2], [0, 1]),
    end_a: mk('end_a', [-L / 2, W / 2], [-L / 2, -W / 2], [-1, 0]),
  };

  const shape: FootprintShape = round ? 'round' : area / rectArea >= (opts.rectThreshold ?? 0.97) ? 'rect' : 'polygon';
  return {
    shape,
    centreEN,
    sDir,
    tDir: [tDir[0], tDir[1]],
    azimuthS: azimuthOf(sDir[0], sDir[1]),
    length: L,
    width: W,
    radius: round ? circ.radius : undefined,
    rectangularity: area / (round ? Math.PI * circ.radius * circ.radius : rectArea),
    ringST,
    sides,
    // object +x (= s) must map to local (sDir_E, 0, −sDir_N): rotation.y = atan2(sDir_N, sDir_E)
    rotationY: Math.atan2(sDir[1], sDir[0]),
    originLocal: { x: centreEN[0] - E0, y: 0, z: -(centreEN[1] - N0) },
  };
}

function extentsAlong(rel: P2[], axis: P2): { centre: P2; length: number; width: number } {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const q of rel) {
    const u = q[0] * axis[0] + q[1] * axis[1];
    const v = -q[0] * axis[1] + q[1] * axis[0];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return { centre: [cu * axis[0] - cv * axis[1], cu * axis[1] + cv * axis[0]], length: maxU - minU, width: maxV - minV };
}

// ---------------------------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------------------------

export function stToEN(f: BuildingFrame, p: ST): EN {
  return [f.centreEN[0] + p[0] * f.sDir[0] + p[1] * f.tDir[0], f.centreEN[1] + p[0] * f.sDir[1] + p[1] * f.tDir[1]];
}

export function enToST(f: BuildingFrame, p: EN): ST {
  const dx = p[0] - f.centreEN[0];
  const dy = p[1] - f.centreEN[1];
  return [dx * f.sDir[0] + dy * f.sDir[1], dx * f.tDir[0] + dy * f.tDir[1]];
}

/** Building-local (s, t, h) -> explorer local frame (x, y, z). */
export function stToLocal(f: BuildingFrame, s: number, t: number, h: number): Vec3 {
  const [E, N] = stToEN(f, [s, t]);
  return { x: E - E0, y: h, z: -(N - N0) };
}

/** Building-local (s, t, h) -> three.js object space of the building group: (s, h, −t). */
export function stToObject(s: number, t: number, h: number): Vec3 {
  return { x: s, y: h, z: -t };
}

/** Point on a side at distance `a` from p0, moved `inset` metres inwards (negative = outwards). */
export function sidePoint(f: BuildingFrame, side: SideName, a: number, inset = 0): ST {
  const sd = f.sides[side];
  return [sd.p0[0] + sd.tangent[0] * a - sd.normal[0] * inset, sd.p0[1] + sd.tangent[1] * a - sd.normal[1] * inset];
}

/** The side whose outward normal is closest to a grid azimuth (e.g. 270 = "west"). */
export function sideFacing(f: BuildingFrame, azGridDeg: number): SideName {
  let best: SideName = 'court';
  let bestD = Infinity;
  for (const sd of Object.values(f.sides)) {
    const d = Math.abs(((sd.normalAzimuth - azGridDeg + 540) % 360) - 180);
    if (d < bestD) {
      bestD = d;
      best = sd.name;
    }
  }
  return best;
}

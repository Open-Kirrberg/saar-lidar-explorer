/**
 * Scale transforms between model coordinates and paper millimetres (pure).
 *
 * Plan views: EN (EPSG:25832) -> paper (x right, y DOWN, mm). The view is a rotation by
 * `upAzimuth` (grid azimuth that points up on the paper; 0 = grid north up) and a uniform scale
 * 1:`scale`. A rotation never mirrors: the determinant of the EN -> paper map is −k² (y flips
 * because paper y runs down), so the plan is seen from above, never from below.
 *
 * Elevation / section views: a horizontal unit vector `right` (EN) and heights h:
 *   x = cx + k · ((P − O) · right),  y = cy − k · (h − h0).
 */
import type { EN } from '../../../model/src/spec.ts';
import type { P2 } from '../svg.ts';

const DEG = Math.PI / 180;

export interface PlanView {
  scale: number;
  /** mm per model metre (1000 / scale). */
  k: number;
  centreEN: EN;
  paperCentre: P2;
  upAzimuth: number;
  toPaper(E: number, N: number): P2;
  toEN(x: number, y: number): EN;
  /** Paper direction (unit, y down) of a grid azimuth. */
  dirOfAzimuth(az: number): P2;
}

export function planView(scale: number, centreEN: EN, paperCentre: P2, upAzimuth = 0): PlanView {
  const k = 1000 / scale;
  const a = upAzimuth * DEG;
  // up = (sin a, cos a), right = (cos a, −sin a) in EN
  const up: EN = [Math.sin(a), Math.cos(a)];
  const right: EN = [Math.cos(a), -Math.sin(a)];
  return {
    scale,
    k,
    centreEN,
    paperCentre,
    upAzimuth,
    toPaper(E, N) {
      const dE = E - centreEN[0];
      const dN = N - centreEN[1];
      return [paperCentre[0] + k * (dE * right[0] + dN * right[1]), paperCentre[1] - k * (dE * up[0] + dN * up[1])];
    },
    toEN(x, y) {
      const r = (x - paperCentre[0]) / k;
      const u = -(y - paperCentre[1]) / k;
      return [centreEN[0] + r * right[0] + u * up[0], centreEN[1] + r * right[1] + u * up[1]];
    },
    dirOfAzimuth(az) {
      const b = (az - upAzimuth) * DEG;
      return [Math.sin(b), -Math.cos(b)];
    },
  };
}

export interface ElevView {
  scale: number;
  k: number;
  /** EN origin of the horizontal axis. */
  origin: EN;
  /** Unit EN vector of +x on the paper. */
  right: EN;
  /** Unit EN vector pointing AWAY from the viewer (into the drawing). */
  depth: EN;
  h0: number;
  paperOrigin: P2;
  /** Horizontal model coordinate (m along `right`) of an EN point. */
  along(E: number, N: number): number;
  /** Depth (m) of an EN point (larger = further away). */
  depthOf(E: number, N: number): number;
  toPaper(E: number, N: number, h: number): P2;
  /** Paper point of (along, h). */
  at(x: number, h: number): P2;
}

/**
 * Elevation looking towards grid azimuth `lookAz` (e.g. 80.5 = looking east at a west front).
 * +x on the paper is `lookAz + 90°` (the viewer's right hand).
 */
export function elevView(scale: number, origin: EN, lookAz: number, h0: number, paperOrigin: P2): ElevView {
  const k = 1000 / scale;
  const a = lookAz * DEG;
  const depth: EN = [Math.sin(a), Math.cos(a)];
  const right: EN = [Math.cos(a), -Math.sin(a)];
  const along = (E: number, N: number) => (E - origin[0]) * right[0] + (N - origin[1]) * right[1];
  return {
    scale,
    k,
    origin,
    right,
    depth,
    h0,
    paperOrigin,
    along,
    depthOf: (E, N) => (E - origin[0]) * depth[0] + (N - origin[1]) * depth[1],
    toPaper: (E, N, h) => [paperOrigin[0] + k * along(E, N), paperOrigin[1] - k * (h - h0)],
    at: (x, h) => [paperOrigin[0] + k * x, paperOrigin[1] - k * (h - h0)],
  };
}

/** Signed area of a paper polygon (positive = clockwise on screen, since y runs down). */
export function paperArea(pts: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Nice scale-bar steps for a scale: returns [step m, count]. */
export function scaleBarSteps(scale: number, maxLengthMm = 100): [number, number] {
  const cands = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const k = 1000 / scale;
  for (const c of cands) {
    for (const count of [5, 4]) {
      if (c * count * k <= maxLengthMm && c * count * k >= maxLengthMm * 0.45) return [c, count];
    }
  }
  return [cands.find((c) => c * 5 * k >= maxLengthMm * 0.3) ?? 10, 5];
}

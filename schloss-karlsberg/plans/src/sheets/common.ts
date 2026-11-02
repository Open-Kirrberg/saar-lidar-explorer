/** Helpers shared by the building sheets (Grundriss, Ansicht, Schnitt). */
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { stToEN } from '../../../model/src/layout/footprint.ts';
import { isPlaced } from '../../../model/src/spec.ts';
import type { Building, SiteSpec, ST } from '../../../model/src/spec.ts';
import type { PlanView } from '../geom/transform.ts';
import { type P2, n } from '../svg.ts';

export const PALACE_GROUP = ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B07'];

/** Height datum ±0,00 of a building: palace group = CdL Erdgeschoss; else its first full storey. */
export function datumOf(spec: SiteSpec, layoutOf: (b: Building) => BuildingLayout, b: Building): { h: number; label: string } {
  if (PALACE_GROUP.includes(b.id)) {
    const cdl = spec.buildings.find((x) => x.id === 'KB-B01')!;
    const lv = layoutOf(cdl).stack.levels.find((l) => l.kind === 'floor')!;
    return { h: lv.floor_h, label: 'Fußboden EG Corps de logis' };
  }
  const L = layoutOf(b);
  const lv = L.stack.levels.find((l) => l.kind === 'floor') ?? L.stack.levels[0];
  return { h: lv.floor_h, label: `Fußboden ${shortStorey(lv.name)}` };
}

export function shortStorey(name: string): string {
  return name.replace(/\s*\(.*\)\s*/g, '').trim();
}

/** Paper mapping of a building's [s, t] through a plan view. */
export function stPaper(L: BuildingLayout, view: PlanView) {
  const P = (s: number, t: number): P2 => {
    const [E, N] = stToEN(L.frame, [s, t]);
    return view.toPaper(E, N);
  };
  const dirP = (v: ST): P2 => {
    const a = P(0, 0);
    const b = P(v[0], v[1]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  return { P, dirP, k: view.k };
}

/** Grid azimuth for "up" on a building plan: palace v (≈ N) unless the long axis is closer to v, then palace u (≈ E). */
export function planUpAzimuth(L: BuildingLayout, spec: SiteSpec): number {
  const u = spec.palace_grid.u_azimuth_grid_deg;
  const v = (u + 270) % 360;
  const diff = Math.abs((((L.frame.azimuthS - v) % 180) + 180) % 180);
  const nearV = Math.min(diff, 180 - diff) < 45;
  const base = nearV ? u : v;
  // snap to the building's own axes (buildings off the palace grid, e.g. the Orangerie, are drawn square)
  let best = base;
  let bestD = Infinity;
  for (let k = 0; k < 4; k++) {
    const a = (L.frame.azimuthS + k * 90) % 360;
    const dd = Math.abs((((a - base) % 360) + 540) % 360 - 180);
    if (dd < bestD) {
      bestD = dd;
      best = a;
    }
  }
  return best;
}

export function bboxOf(pts: P2[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])),
    y1: Math.max(...pts.map((p) => p[1])),
  };
}

/** SVG arc path for a door swing: from the closed-leaf end to the open-leaf end around the hinge. */
export function swingArc(hinge: P2, closedEnd: P2, openEnd: P2): string {
  const r = Math.hypot(closedEnd[0] - hinge[0], closedEnd[1] - hinge[1]);
  const c = (closedEnd[0] - hinge[0]) * (openEnd[1] - hinge[1]) - (closedEnd[1] - hinge[1]) * (openEnd[0] - hinge[0]);
  return `M${n(closedEnd[0])} ${n(closedEnd[1])}A${n(r)} ${n(r)} 0 0 ${c > 0 ? 1 : 0} ${n(openEnd[0])} ${n(openEnd[1])}`;
}

export const add = (a: ST, b: ST, k = 1): ST => [a[0] + b[0] * k, a[1] + b[1] * k];

/** Buildings with a position and a base height (unplaced catalogue entries have base_h null). */
export function placedBuildings(spec: SiteSpec): Building[] {
  return spec.buildings.filter(isPlaced);
}

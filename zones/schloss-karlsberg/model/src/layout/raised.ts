/**
 * Raised roof sections (pure). Added by the plans package (additive, new file; import directly):
 * one shared reading of `roof.raised[]` so elevations, sections and the 3D exterior agree.
 *
 * Reading [I]: the raised part (e.g. the CdL centre pavilion, D LC 1790) keeps the main eaves
 * line and has its own roof of `type` (default: the main type) whose ridge is `extra_h` above the
 * main ridge (default 1.5 m, U). For a hip roof the pitch is solved to reach that ridge
 * (CdL: 356.0 + 10.22 m over 9 m half-depth -> 48.6°, ridge 366.2 = HMS centre ridge).
 * The optional turret (lantern / Dachreiter) stands on the ridge centre.
 */
import type { RaisedRoofSection } from '../spec.ts';
import type { BuildingLayout, RaisedRange } from './building.ts';
import { type RoofPlan, type RoofSection, roofPlan, roofSection } from './roof.ts';

/** Default extra height of a raised roof section when the catalogue gives none (m) [U]. */
export const RAISED_EXTRA_H = 1.5;
/** Default turret height (m) [U]. */
export const TURRET_HEIGHT = 3.0;

export interface RaisedRoof {
  range: RaisedRange;
  section: RoofSection;
  plan: RoofPlan;
  /** Centre of the raised part along s. */
  sMid: number;
  length: number;
  turret?: { kind: NonNullable<RaisedRoofSection['turret']>['kind']; base_h: number; top_h: number; width: number };
}

export function raisedRoof(layout: Pick<BuildingLayout, 'roof' | 'roofSpec'>, range: RaisedRange): RaisedRoof {
  const r = range.section;
  const main = layout.roof;
  const type = r.type ?? main.type;
  const ridge = main.ridge_h + (r.extra_h ?? RAISED_EXTRA_H);
  const section = roofSection({
    type,
    depth: main.depth,
    eaves_h: main.eaves_h,
    pitch_lower: type === 'mansard' ? main.pitch_lower : undefined,
    pitch_upper: type === 'mansard' ? main.pitch_upper : undefined,
    ridge_h: ridge,
  });
  const length = range.s1 - range.s0;
  const plan = roofPlan(section, length, true);
  const out: RaisedRoof = { range, section, plan, sMid: (range.s0 + range.s1) / 2, length };
  if (r.turret) {
    const h = r.turret.height ?? TURRET_HEIGHT;
    out.turret = { kind: r.turret.kind, base_h: section.ridge_h, top_h: section.ridge_h + h, width: Math.min(2.4, Math.max(1.2, main.depth * 0.12)) };
  }
  return out;
}

export function raisedRoofs(layout: Pick<BuildingLayout, 'roof' | 'roofSpec' | 'raised'>): RaisedRoof[] {
  return layout.raised.map((rr) => raisedRoof(layout, rr));
}

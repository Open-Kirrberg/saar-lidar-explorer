/**
 * One-call layout of a building (pure): frame + storey stack + roof section/plan + facade bays +
 * openings + dormers. Exterior, interiors and plans MUST all start from `layoutBuilding()` so that
 * a window in the elevation drawing, the hole in the 3D wall and the light in the room agree.
 */
import type { Building, EN, RaisedRoofSection, RingEN, Roof, SideName, SiteSpec } from '../spec.ts';
import { SIDE_NAMES } from '../spec.ts';
import { type BuildingFrame, buildingFrame } from './footprint.ts';
import { type BayLayout, type FacadeOpening, type RoofOpening, facadeOpenings, layoutBays, roofOpenings, sideSpec } from './facade.ts';
import { centroid } from './geom.ts';
import { MEMBERS, WALL_THICKNESS, corniceFor } from './grammar.ts';
import { type RoofPlan, type RoofSection, roofPlan, roofSection } from './roof.ts';
import { resolveCourtToward } from './site.ts';
import { type StoreyStack, storeyStack } from './storeys.ts';

/**
 * Roof variants for open question "mansard only on the CdL (enwp/K1) or on all wings (HMS)":
 *  catalogue  : as in the catalogue (v1 = HMS reading, mansards on all palace wings)
 *  enwp-gabled: only CDL keeps a mansard; WING2/RANGE1 mansards become 45° hipped roofs
 */
export type RoofVariant = 'catalogue' | 'enwp-gabled';

export interface LayoutOptions {
  roofVariant?: RoofVariant;
  /** Lowest terrain under the footprint, overrides ground_dtm.min. */
  groundMin?: number;
}

export interface RaisedRange {
  section: RaisedRoofSection;
  /** Range along s covered by the raised part. */
  s0: number;
  s1: number;
}

export interface BuildingLayout {
  id: string;
  building: Building;
  frame: BuildingFrame;
  /** Footprint actually used (WALL: buffered centre line). */
  ring: RingEN;
  stack: StoreyStack;
  roofSpec: Roof;
  roof: RoofSection;
  roofPlan: RoofPlan;
  sides: Record<SideName, BayLayout>;
  openings: FacadeOpening[];
  roofOpenings: RoofOpening[];
  raised: RaisedRange[];
  /** KB-I17 facade members shared by the 3D exterior and the plan elevations. */
  members: FacadeMembers;
  warnings: string[];
}

/**
 * KB-I17 (research/09 §3.4 G7-G9): main cornice (one continuous palace cornice, CORNICE.palace), string courses
 * (Gurtgesims, only MEMBERS.stringCourse classes) and where Lisenen go: corner strips everywhere except plain farm
 * buildings; risalit-edge Lisenen only on the CdL and on risalits carrying a porticoed portal (B02 head, LC 1790).
 */
export interface FacadeMembers {
  cornice: { height: number; projection: number };
  stringCourse: boolean;
  cornerLisenen: boolean;
  /** Risalit-edge Lisenen on all risalits (CdL) or only porticoed risalits ('portico'). */
  risalitLisenen: 'all' | 'portico';
}

export function facadeMembers(b: Building, spec: SiteSpec, eaves: number): FacadeMembers {
  return {
    cornice: corniceFor(b.cls, eaves, spec.defaults),
    stringCourse: MEMBERS.stringCourse.has(b.cls),
    cornerLisenen: b.cls !== 'FARM' && b.cls !== 'FARM_GROUP',
    risalitLisenen: b.cls === 'CDL' ? 'all' : 'portico',
  };
}

export function applyRoofVariant(b: Building, variant: RoofVariant = 'catalogue'): Roof {
  const r = b.roof;
  if (variant === 'enwp-gabled' && r.type === 'mansard' && (b.cls === 'WING2' || b.cls === 'RANGE1')) {
    return { ...r, type: 'hip', pitch_lower: 45, pitch_upper: undefined, ridge_h: undefined, tags: `${r.tags ?? ''}; variant enwp-gabled (D K1 'gabled roofs', pitch N)` };
  }
  return r;
}

/** Rectangle ring around a wall centre line (2 points) of the given thickness, CCW, closed. */
export function lineFootprint(line: EN[], thickness: number): RingEN {
  const [a, b] = [line[0], line[line.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (-(b[1] - a[1]) / len) * (thickness / 2);
  const ny = ((b[0] - a[0]) / len) * (thickness / 2);
  return [
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
    [a[0] + nx, a[1] + ny],
    [a[0] - nx, a[1] - ny],
  ];
}

export function layoutBuilding(b: Building, spec: SiteSpec, opts: LayoutOptions = {}): BuildingLayout {
  const warnings: string[] = [];
  if (b.base_h === null) throw new Error(`${b.id}: unplaced (base_h null)`);
  const ring = b.footprint ?? (b.line && b.line.length >= 2 ? lineFootprint(b.line, WALL_THICKNESS[b.cls]) : null);
  if (!ring) throw new Error(`${b.id}: no footprint or line`);

  const frame = buildingFrame(ring, { courtToward: resolveCourtToward(spec, b.court_toward, centroid(ring) as EN) });

  // WALL / storey-less buildings: synthesise one 'wall' storey from facade.height_m
  const storeys = b.storeys.length ? b.storeys : b.facade.height_m ? [{ name: 'Mauer', height: b.facade.height_m, tag: b.facade.tags ?? 'catalogue height_m', kind: 'wall' as const }] : [];
  const stack = storeyStack({ ...b, storeys }, { groundMin: opts.groundMin });

  const roofSpec = applyRoofVariant(b, opts.roofVariant);
  if (roofSpec.eaves_h !== undefined && Math.abs(roofSpec.eaves_h - stack.eaves_h) > 0.05) {
    warnings.push(`roof.eaves_h ${roofSpec.eaves_h} != base_h + storeys ${stack.eaves_h.toFixed(2)}; using the storey stack`);
  }
  const depth = roofSpec.depth_m ?? (frame.shape === 'round' ? 2 * (frame.radius ?? frame.width / 2) : frame.width);
  if (roofSpec.depth_m !== undefined && Math.abs(roofSpec.depth_m - frame.width) > 0.5 && frame.shape !== 'round') {
    warnings.push(`roof.depth_m ${roofSpec.depth_m} differs from footprint width ${frame.width.toFixed(2)}`);
  }
  const roof = roofSection({
    type: roofSpec.type,
    depth,
    eaves_h: stack.eaves_h,
    pitch_lower: roofSpec.pitch_lower,
    pitch_upper: roofSpec.pitch_upper,
    break_ratio: roofSpec.break_ratio,
    dome_rise_ratio: roofSpec.dome_rise_ratio,
    dome_tiers: roofSpec.dome_tiers,
    ridge_h: roofSpec.ridge_h,
  });
  warnings.push(...roof.notes);
  const plan = roofPlan(roof, frame.length, roofSpec.type === 'mansard' ? (roofSpec.hipped_ends ?? true) : undefined);

  const sides = {} as Record<SideName, BayLayout>;
  const openings: FacadeOpening[] = [];
  const roofOps: RoofOpening[] = [];
  // FARM_GROUP is an envelope of several buildings (catalogue note): no facade of its own
  const hasFacade = frame.shape !== 'round' && b.cls !== 'WALL' && b.cls !== 'GARD' && b.cls !== 'FARM_GROUP';
  for (const side of SIDE_NAMES) {
    const sd = frame.sides[side];
    const ss = hasFacade ? sideSpec(b.facade, side, sd.length, b.cls) : { axes: 0 };
    const lay = layoutBays({
      side,
      length: sd.length,
      axes: ss.axes,
      spacing: ss.spacing,
      from: ss.from,
      to: ss.to,
      groups: ss.groups,
      risalits: b.facade.risalits,
      cls: b.cls,
      blind: ss.blind,
    });
    if (lay.compressed && ss.spacing !== undefined && lay.spacing < ss.spacing * 0.99) warnings.push(`${side}: ${ss.axes} axes compressed to ${lay.spacing.toFixed(2)} m spacing`);
    sides[side] = lay;
    openings.push(...facadeOpenings({ cls: b.cls, side, layout: lay, stack, portals: b.facade.portals, windowKind: 'window_kind' in ss ? ss.window_kind : undefined, windowKindStoreys: 'window_kind_storeys' in ss ? ss.window_kind_storeys : undefined }));
    roofOps.push(...roofOpenings(lay, roof, roofSpec.dormers ?? {}));
  }

  const raised: RaisedRange[] = [];
  for (const r of roofSpec.raised ?? []) {
    const lay = sides[r.side];
    const first = lay.bays[r.first_axis];
    const last = lay.bays[r.first_axis + r.axis_count - 1];
    if (!first || !last) {
      warnings.push(`raised roof section on ${r.side} axes ${r.first_axis}+${r.axis_count} outside the layout`);
      continue;
    }
    const a0 = first.a - lay.spacing / 2;
    const a1 = last.a + lay.spacing / 2;
    const sd = frame.sides[r.side];
    const sA = sd.p0[0] + sd.tangent[0] * a0;
    const sB = sd.p0[0] + sd.tangent[0] * a1;
    raised.push({ section: r, s0: Math.min(sA, sB), s1: Math.max(sA, sB) });
  }

  const members = facadeMembers(b, spec, stack.eaves_h);
  return { id: b.id, building: b, frame, ring, stack, roofSpec, roof, roofPlan: plan, sides, openings, roofOpenings: roofOps, raised, members, warnings };
}

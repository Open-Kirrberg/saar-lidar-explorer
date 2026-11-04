/**
 * KB-I23 Ehrenhof furniture planning (pure, no three.js; unit-tested in model/tests/court.test.ts).
 *
 * Everything is derived from the catalogue, nothing is placed by hand (research/09 §5, C6; research/06 §3.1-3.2):
 *  - the Ehrenhof = the catalogue `court` feature named "Ehrenhof" (TF-01); its mouth gate = the grille building
 *    (WALL named Gitter, KB-B39), whose centre is the gate;
 *  - the palace group = buildings that carry the continuous palace cornice (CORNICE.palace, KB-I17: B01-B05);
 *  - sentry boxes: a pair at every portal / Durchfahrt of the palace group that opens into the Ehrenhof or faces the
 *    W approach (the grille's outward side): the CdL court portal, both arm Durchfahrten, the B02 head portico and the
 *    W gate of the Sammlungsflügel, as HMS shows them [HMS t=10.5, 16.5, 76.5, 88-89];
 *  - Prellsteine: a pair at every Durchfahrt / carriage gate face of the palace group [HMS t=71.5, 76.5, 88-89];
 *  - cobbled carriage lanes: from the gate to the court portal facing it (COURT_FURNITURE.lane.width), and from each
 *    other court Durchfahrt straight out to that axis lane (the narrower crossWidth) [N research/09 §5; I widths];
 *  - sandstone gutters along the court walls, open at the portals [N].
 * Positions are plan points (x, t) = (E − E0, N − N0), heights absolute (DHHN2016).
 */
import type { BuildingLayout } from '../layout/building.ts';
import { E0, N0 } from '../frame.ts';
import { stToEN } from '../layout/footprint.ts';
import { type P2, pointInPolygon } from '../layout/geom.ts';
import { inEpoch } from '../layout/epoch.ts';
import { ARTICULATION, CORNICE, COURT_FURNITURE, PASSAGE_PORTICO, PORTICO } from '../layout/grammar.ts';
import { type FacadeOpening, freitreppePlan, perronSentryAlong } from '../layout/facade.ts';
import { type Building, type SiteSpec, type TerrainFeature, isPlaced } from '../spec.ts';

/** A door-like opening of a palace-group building, in plan. */
export interface CourtPortal {
  buildingId: string;
  kind: FacadeOpening['kind'];
  /** Threshold point on the wall plane (plan x, t). */
  p: P2;
  /** Outward unit normal and the facade tangent (plan). */
  n: P2;
  tan: P2;
  width: number;
  /** Half width along the facade kept clear for the opening, its stairs / portico and Prellsteine (m). */
  clear: number;
  /** How far in front of the wall the stairs / portico reach (0 for passages). */
  reach: number;
  /** Ground (court) height at the threshold. */
  grade: number;
  inCourt: boolean;
  approach: boolean;
  /** Portico / porch in front (columns stand where a Freitreppe would). */
  porch?: boolean;
  /** Main perron: signed along offsets [left, right] of the sentry pair, snapped to the piers (perronSentryAlong). */
  sentryAlong?: [number, number];
}

export interface Placed {
  p: P2;
  /** Facing (outward) unit vector in plan. */
  n: P2;
  ground: number;
  buildingId: string;
}

export interface Strip {
  /** Centre line from a to b (plan), width w, at height h. */
  a: P2;
  b: P2;
  w: number;
  h: number;
}

export interface CourtPlan {
  courtId: string;
  portals: CourtPortal[];
  sentries: Placed[];
  prellsteine: Placed[];
  lanes: Strip[];
  gutters: Strip[];
}

const add = (a: P2, b: P2, k = 1): P2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const unit = (a: P2): P2 => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
const toEN = (p: P2): P2 => [p[0] + E0, p[1] + N0];
const fromEN = (p: readonly number[]): P2 => [p[0] - E0, p[1] - N0];

/** The Ehrenhof court feature (catalogue `court` named Ehrenhof / cour d'honneur), if any. */
export function ehrenhof(spec: SiteSpec, year: number): TerrainFeature | null {
  return spec.terrain_features.find((f) => f.kind === 'court' && /ehrenhof|cour d.honneur/i.test(f.name) && f.geometry.type === 'Polygon' && inEpoch(f.epoch, year)) ?? null;
}

/** Does the building carry the continuous palace cornice (the palace group, KB-I17)? */
export function isPalaceGroup(L: BuildingLayout): boolean {
  return L.members.cornice === CORNICE.palace;
}

/**
 * Half width along the facade that an opening keeps clear (its stairs, portico, dressed jambs and Prellsteine) and how
 * far its stairs or portico reach in front of the wall. Mirrors the exterior builder (facade.ts portico / freitreppe).
 */
export function openingClearance(o: Pick<FacadeOpening, 'kind' | 'width' | 'steps' | 'portico'>): { clear: number; reach: number } {
  const P = COURT_FURNITURE.prellstein;
  // wave-8 review fix (KB-I72): a porch in front of a passage keeps its columns clear
  if (o.kind === 'durchfahrt' && o.portico) {
    const PP = PASSAGE_PORTICO;
    const pairs = Math.max(1, Math.round(o.portico.columns / 2));
    return { clear: o.width / 2 + PP.inner + PP.columnDiameter + (pairs - 1) * PP.pair + 0.4, reach: o.portico.depth };
  }
  if (o.portico) {
    const cw = PORTICO.columnDiameter;
    const span = o.width + 2 * cw + PORTICO.stairWidthExtra * 0.5;
    const w = span + 2 * cw + PORTICO.stairWidthExtra;
    return { clear: w / 2 + 0.4, reach: o.portico.depth + Math.max(1, o.steps ?? 0) * 0.4 };
  }
  const fp = o.kind === 'portal' || o.kind === 'door' ? freitreppePlan(o) : null;
  if (fp) return { clear: fp.halfWidth + Math.max(fp.cheek, fp.pedestal ? (fp.cheek + fp.pedestal[0]) / 2 + 0.05 : 0), reach: fp.depth };
  if (o.kind === 'durchfahrt' || o.kind === 'carriage_gate') return { clear: o.width / 2 + 0.35 + P.base + P.gap, reach: 0 };
  return { clear: o.width / 2 + 0.3, reach: 0 };
}

/** Is the building standing in the scene (placed, in epoch, shown)? */
function standing(b: Building, year: number, showHypothetical: boolean): boolean {
  return !!(b.footprint || b.line) && isPlaced(b) && inEpoch(b.epoch, year) && (b.placement !== 'hypothetical' || showHypothetical);
}

/**
 * Plan the Ehrenhof furniture. `layout` is the memoised layout function, `terrain(x, t)` the ground height at a plan
 * point (NaN if unknown; the court level is used then).
 */
export function courtPlan(spec: SiteSpec, layout: (b: Building) => BuildingLayout, terrain: (x: number, t: number) => number, year: number, showHypothetical = false): CourtPlan | null {
  const court = ehrenhof(spec, year);
  if (!court) return null;
  const ring = (court.geometry.coordinates as number[][][])[0].map((p) => [p[0], p[1]] as P2);
  const inCourtEN = (p: P2) => pointInPolygon(toEN(p), ring);
  const level = court.level ?? NaN;
  const ground = (p: P2) => {
    const h = terrain(p[0], p[1]);
    return Number.isFinite(h) ? h : Number.isFinite(level) ? level : 0;
  };
  const buildings = spec.buildings.filter((b) => standing(b, year, showHypothetical));
  const footprints = buildings.filter((b) => b.footprint && b.cls !== 'WALL' && b.cls !== 'GARD').map((b) => ({ id: b.id, ring: b.footprint! as P2[] }));
  const inBuilding = (p: P2, except?: string) => footprints.some((f) => f.id !== except && pointInPolygon(toEN(p), f.ring));

  // gate: centre of the court grille; `inward` points into the court
  let gate: P2 | null = null;
  let inward: P2 | null = null;
  for (const b of buildings) {
    if (b.cls !== 'WALL' || !/gitter|grille/i.test(`${b.name_de} ${b.facade.material ?? ''}`)) continue;
    const L = layout(b);
    const c = fromEN(stToEN(L.frame, [0, 0]));
    let n = unit(add(fromEN(stToEN(L.frame, [0, 1])), c, -1));
    if (!inCourtEN(add(c, n, 3)) && inCourtEN(add(c, n, -3))) n = [-n[0], -n[1]];
    if (inCourtEN(add(c, n, 3))) {
      gate = c;
      inward = n;
      break;
    }
  }

  // portals of the palace group
  const portals: CourtPortal[] = [];
  for (const b of buildings) {
    if (b.cls === 'WALL' || b.cls === 'GARD') continue;
    const L = layout(b);
    if (!isPalaceGroup(L)) continue;
    for (const o of L.openings) {
      if (o.kind !== 'portal' && o.kind !== 'durchfahrt' && o.kind !== 'carriage_gate') continue;
      const sd = L.frame.sides[o.side];
      const rr = L.sides[o.side]?.risalits.find((r) => o.a >= r.a0 && o.a <= r.a1);
      const wd = rr ? (rr.risalit.projection ?? ARTICULATION.risalitProjection) : 0;
      const st: [number, number] = [sd.p0[0] + sd.tangent[0] * o.a + sd.normal[0] * wd, sd.p0[1] + sd.tangent[1] * o.a + sd.normal[1] * wd];
      const p = fromEN(stToEN(L.frame, st));
      const n = unit(add(fromEN(stToEN(L.frame, [st[0] + sd.normal[0], st[1] + sd.normal[1]])), p, -1));
      const tan = unit(add(fromEN(stToEN(L.frame, [st[0] + sd.tangent[0], st[1] + sd.tangent[1]])), p, -1));
      const { clear, reach } = openingClearance(o);
      const inCourt = inCourtEN(add(p, n, 2));
      // faces the W approach: outward along the grille's outer side, in the open (not into another building)
      const approach = !inCourt && !!inward && dot(n, inward) < -0.7 && !inBuilding(add(p, n, 4), b.id);
      // wave-9 review fix (KB-I72): the sentry pair of a main perron stands on the piers beside the cheek pedestals
      const sentryAlong = perronSentryAlong(o, L.openings, clear, COURT_FURNITURE.sentry.width, COURT_FURNITURE.sentry.gap) ?? undefined;
      portals.push({ buildingId: b.id, kind: o.kind, p, n, tan, width: o.width, clear, reach, grade: o.grade_h ?? ground(add(p, n, 1)), inCourt, approach, porch: !!o.portico, sentryAlong });
    }
  }

  const S = COURT_FURNITURE.sentry;
  const P = COURT_FURNITURE.prellstein;
  const pp = ARTICULATION.plinthProjection;
  const sentries: Placed[] = [];
  const prellsteine: Placed[] = [];
  for (const q of portals) {
    if (q.kind === 'durchfahrt' || q.kind === 'carriage_gate') {
      for (const sg of [-1, 1]) {
        const p = add(add(q.p, q.tan, sg * (q.width / 2 + P.base / 2 - 0.06)), q.n, pp + P.base / 2 + 0.02);
        prellsteine.push({ p, n: q.n, ground: ground(p), buildingId: q.buildingId });
      }
    }
    if (!q.inCourt && !q.approach) continue;
    // wave-8 review fix (KB-I72): at a portal with a Freitreppe the pair flanks the stair foot (not its cheeks), at a
    // passage porch its front columns; the B02 head portico keeps its pair at the wall
    const foot = q.reach > 0 && (q.kind === 'durchfahrt' || (q.kind === 'portal' && !q.porch));
    const out = foot ? pp + q.reach - S.depth / 2 + (q.kind === 'portal' ? 0.3 : -0.2) : pp + S.setOut + S.depth / 2;
    for (const [i, sg] of [-1, 1].entries()) {
      const along = foot && q.sentryAlong ? q.sentryAlong[i] : sg * (q.clear + S.gap + S.width / 2);
      const p = add(add(q.p, q.tan, along), q.n, out);
      sentries.push({ p, n: q.n, ground: ground(p), buildingId: q.buildingId });
    }
  }

  // cobbled lanes: the axis lane from the gate to the court portal facing it, then each other court passage to it
  const lanes: Strip[] = [];
  const L = COURT_FURNITURE.lane;
  const h = (Number.isFinite(level) ? level : 0) + L.lift;
  if (gate && inward) {
    const facing = portals.filter((q) => q.inCourt && dot(q.n, inward!) < -0.7).sort((x, y) => dot(add(x.p, gate!, -1), inward!) - dot(add(y.p, gate!, -1), inward!));
    const main = facing[0];
    if (main) {
      const end = add(main.p, main.n, main.reach + 0.1);
      // the axis runs along `inward` from the gate; the lane ends level with the portal's stair foot
      const len = dot(add(end, gate, -1), inward);
      const b = add(gate, inward, len);
      lanes.push({ a: gate, b, w: L.width, h });
      for (const q of portals) {
        if (q === main || !q.inCourt || (q.kind !== 'durchfahrt' && q.kind !== 'carriage_gate')) continue;
        // ray from the passage along its normal to the axis line (gate + s·inward)
        const den = q.n[0] * inward[1] - q.n[1] * inward[0];
        if (Math.abs(den) < 0.2) continue;
        const d = add(gate, q.p, -1);
        const s = (d[0] * inward[1] - d[1] * inward[0]) / den;
        if (s <= 0) continue;
        const hit = add(q.p, q.n, s);
        const along = dot(add(hit, gate, -1), inward);
        if (along < 0 || along > len) continue;
        // narrower cross lane (wave-4 review), ending at the axis lane's edging
        lanes.push({ a: add(q.p, q.n, 0.05), b: add(q.p, q.n, s - L.width / 2), w: L.crossWidth, h });
      }
    }
  }

  // gutters along the court walls (polygon edges with a building behind them), open at portals and sentry boxes
  const G = COURT_FURNITURE.gutter;
  const gutters: Strip[] = [];
  const open = ring.slice(0, -1).map(fromEN);
  let area = 0;
  for (let i = 0; i < open.length; i++) area += open[i][0] * open[(i + 1) % open.length][1] - open[(i + 1) % open.length][0] * open[i][1];
  for (let i = 0; i < open.length; i++) {
    const a = open[i];
    const b = open[(i + 1) % open.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 2) continue;
    const tan = unit(add(b, a, -1));
    // inward normal of a CCW ring is the left normal
    const nIn: P2 = area > 0 ? [-tan[1], tan[0]] : [tan[1], -tan[0]];
    const mid = add(a, tan, len / 2);
    if (!inBuilding(add(mid, nIn, -1))) continue;
    // blocked intervals along the edge: portals (clear + sentry boxes) on this wall
    const blocks: [number, number][] = [];
    for (const q of portals) {
      if (Math.abs(dot(add(q.p, a, -1), nIn)) > 1.5 || dot(q.n, nIn) < 0.7) continue;
      const u = dot(add(q.p, a, -1), tan);
      const half = q.clear + (q.inCourt || q.approach ? S.gap + S.width + 0.1 : 0.1);
      blocks.push([u - half, u + half]);
    }
    blocks.sort((x, y) => x[0] - y[0]);
    let u0 = 0.3;
    const off = pp + 0.02 + G.width / 2;
    for (const [b0, b1] of [...blocks, [len - 0.3, Infinity] as [number, number]]) {
      if (b0 - u0 > 0.5) gutters.push({ a: add(add(a, tan, u0), nIn, off), b: add(add(a, tan, Math.min(b0, len - 0.3)), nIn, off), w: G.width, h: (Number.isFinite(level) ? level : 0) + G.lift });
      u0 = Math.max(u0, b1);
    }
  }
  return { courtId: court.id, portals, sentries, prellsteine, lanes, gutters };
}

/**
 * Diagonal stripes on a wall face (blue-white Schilderhaus): the rectangle [u0, u0 + W] × [0, H] cut by the lines
 * u + v = k · stripe · √2 into bands; returns each band polygon (u, v) with its colour index (0 / 1). `u0` is the face's
 * start along the box perimeter, so stripes run on round the corners [HMS diagonal stripes; I width].
 */
export function diagonalBands(u0: number, W: number, H: number, stripe: number): { poly: P2[]; colour: 0 | 1 }[] {
  const step = stripe * Math.SQRT2;
  const out: { poly: P2[]; colour: 0 | 1 }[] = [];
  const rect: P2[] = [
    [u0, 0],
    [u0 + W, 0],
    [u0 + W, H],
    [u0, H],
  ];
  const k0 = Math.floor(u0 / step);
  const k1 = Math.ceil((u0 + W + H) / step);
  for (let k = k0; k < k1; k++) {
    let poly = clip(rect, (p) => p[0] + p[1] - k * step);
    poly = clip(poly, (p) => (k + 1) * step - (p[0] + p[1]));
    if (poly.length >= 3 && Math.abs(polyArea(poly)) > 1e-6) out.push({ poly, colour: (((k % 2) + 2) % 2) as 0 | 1 });
  }
  return out;
}

/** Sutherland-Hodgman: keep the part of a convex polygon where f(p) >= 0. */
function clip(poly: P2[], f: (p: P2) => number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polyArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return a / 2;
}

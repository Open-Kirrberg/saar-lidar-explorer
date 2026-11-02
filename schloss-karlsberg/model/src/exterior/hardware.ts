/**
 * KB-I22 roof hardware geometry (research/09 §2.8, §3.6; G5, G6, E3-E5): Hemmer lightning rods with five-point heads
 * and a down-conductor (LOD2), downpipes with hopper heads (LOD1+), weather vanes (LOD1+). Placement comes from the
 * pure planner exterior/hardwarePlan.ts, numbers from layout/grammar.ts. All iron parts use `metal.iron` (tinted for the
 * lead-grey pipes), which the explorer light layer leaves out (thin detail, scripts/export-explorer.ts DROP_MATERIALS).
 */
import type { BuildContext } from '../context.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { stToEN } from '../layout/footprint.ts';
import { pointInPolygon } from '../layout/geom.ts';
import { inEpoch } from '../layout/epoch.ts';
import { ARTICULATION, DOWNPIPE, HEMMER_ROD, LIGHTNING_ROD, WEATHER_VANE } from '../layout/grammar.ts';
import { roofHeightAtInset } from '../layout/roof.ts';
import { raisedRoofs } from '../layout/raised.ts';
import { E0, N0 } from '../frame.ts';
import { isPlaced } from '../spec.ts';
import type { SideName } from '../spec.ts';
import { type GeoBuilder, type MatKey, type P3, matKey } from './builder.ts';
import { chimneyStations, conductorCorner, conductorPath, hemmerMastHeight, hemmerMasts, sideDownpipes } from './hardwarePlan.ts';

const IRON = matKey('metal.iron');
const GILT = matKey('metal.gilt');
const PIPE = matKey('metal.iron', DOWNPIPE.colour);
const ROD = matKey('metal.iron', HEMMER_ROD.ironColour);

/** Thin prism (`sides`-gon, radius r) along a 3D segment A -> B ([s, t, h]); no end caps. */
export function rodSegment(g: GeoBuilder, k: MatKey, A: P3, B: P3, r: number, sides = 4): void {
  const d: P3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-4) return;
  const u: P3 = [d[0] / l, d[1] / l, d[2] / l];
  // two perpendicular axes
  const ref: P3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cx = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a: P3): P3 => {
    const m = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / m, a[1] / m, a[2] / m];
  };
  const x = nrm(cx(u, ref));
  const y = cx(u, x);
  const ring = (P: P3, i: number): P3 => {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    return [P[0] + x[0] * c + y[0] * s, P[1] + x[1] * c + y[1] * s, P[2] + x[2] * c + y[2] * s];
  };
  for (let i = 0; i < sides; i++) {
    const a0 = ring(A, i);
    const a1 = ring(A, i + 1);
    const b0 = ring(B, i);
    const b1 = ring(B, i + 1);
    const mid = (i + 0.5) / sides;
    const ang = mid * Math.PI * 2 + Math.PI / sides;
    const out: P3 = [x[0] * Math.cos(ang) + y[0] * Math.sin(ang), x[1] * Math.cos(ang) + y[1] * Math.sin(ang), x[2] * Math.cos(ang) + y[2] * Math.sin(ang)];
    g.quadFacing(k, a0, a1, b1, b0, out);
  }
}

/** Small pyramid tip from `base` (half width w) up to `apex`. */
function tip(g: GeoBuilder, k: MatKey, base: P3, apex: P3, w: number): void {
  const c: P3[] = [
    [base[0] - w, base[1] - w, base[2]],
    [base[0] + w, base[1] - w, base[2]],
    [base[0] + w, base[1] + w, base[2]],
    [base[0] - w, base[1] + w, base[2]],
  ];
  for (let i = 0; i < 4; i++) {
    const p = c[i];
    const q = c[(i + 1) % 4];
    const out: P3 = [(p[0] + q[0]) / 2 - base[0], (p[1] + q[1]) / 2 - base[1], 0];
    g.polygonFacing(k, [p, q, apex], out);
  }
}

/**
 * Hemmer "Fünfspitz" mast [D NDB: vertical rod + horizontal cross; N/U sizes, HEMMER_ROD]: a tapered iron mast from
 * `foot` up `mast` m to a gilt knob carrying a tall vertical spike and four short level points that grow straight out of
 * the knob (no thin arms, wave 9: the old cross on arms read as a TV aerial); gilt (research/09 G6 "gilt or copper tips").
 */
export function hemmerMast(g: GeoBuilder, s: number, t: number, foot: number, axes: [[number, number], [number, number]] = [[1, 0], [0, 1]], lod = 2, mast: number = HEMMER_ROD.mast): void {
  const R = HEMMER_ROD;
  const sides = lod >= 2 ? 6 : 4;
  const kc = foot + mast; // knob centre
  const k = R.knob;
  taperSegment(g, ROD, [s, t, foot - 0.3], [s, t, kc - k * 0.8], R.baseRadius, R.topRadius, sides);
  // knob: two cones (an octahedral ball at LOD1, a hexagonal one at LOD2)
  taperSegment(g, GILT, [s, t, kc - k], [s, t, kc], k * 0.25, k, sides);
  taperSegment(g, GILT, [s, t, kc], [s, t, kc + k * 0.7], k, R.spikeRadius, sides);
  // vertical spike
  taperSegment(g, GILT, [s, t, kc + k * 0.7], [s, t, kc + k * 0.7 + R.spike], R.spikeRadius, 0.002, sides);
  // four level points out of the knob, tapering to a tip
  for (const [ax, ay] of [axes[0], axes[1], [-axes[0][0], -axes[0][1]], [-axes[1][0], -axes[1][1]]] as [number, number][]) {
    const A: P3 = [s + ax * k * 0.5, t + ay * k * 0.5, kc];
    const B: P3 = [s + ax * R.point, t + ay * R.point, kc];
    coneSegment(g, GILT, A, B, R.pointRadius, 4);
  }
}

/** Cone along a 3D segment from A (radius r, `sides`-gon) to a point at B; no base cap. */
function coneSegment(g: GeoBuilder, k: MatKey, A: P3, B: P3, r: number, sides: number): void {
  const d: P3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-4) return;
  const u: P3 = [d[0] / l, d[1] / l, d[2] / l];
  const ref: P3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x: P3 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const xm = Math.hypot(x[0], x[1], x[2]) || 1;
  x[0] /= xm;
  x[1] /= xm;
  x[2] /= xm;
  const y: P3 = [u[1] * x[2] - u[2] * x[1], u[2] * x[0] - u[0] * x[2], u[0] * x[1] - u[1] * x[0]];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const a1 = ((i + 1) / sides) * Math.PI * 2 + Math.PI / sides;
    const am = (a0 + a1) / 2;
    const p = (a: number): P3 => [A[0] + (x[0] * Math.cos(a) + y[0] * Math.sin(a)) * r, A[1] + (x[1] * Math.cos(a) + y[1] * Math.sin(a)) * r, A[2] + (x[2] * Math.cos(a) + y[2] * Math.sin(a)) * r];
    const out: P3 = [x[0] * Math.cos(am) + y[0] * Math.sin(am), x[1] * Math.cos(am) + y[1] * Math.sin(am), x[2] * Math.cos(am) + y[2] * Math.sin(am)];
    g.polygonFacing(k, [p(a0), p(a1), B], out);
  }
}

/** Tapered rod (frustum, `sides`-gon) from A (radius r0) to B (radius r1), vertical axis only; no end caps. */
function taperSegment(g: GeoBuilder, k: MatKey, A: P3, B: P3, r0: number, r1: number, sides: number): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const p = (P: P3, r: number, a: number): P3 => [P[0] + Math.cos(a) * r, P[1] + Math.sin(a) * r, P[2]];
    g.quadFacing(k, p(A, r0, a0), p(A, r0, a1), p(B, r1, a1), p(B, r1, a0), [Math.cos(am), Math.sin(am), (r0 - r1) / Math.max(1e-3, B[2] - A[2])]);
  }
}

/** Unit vectors of true north and east in the building's [s, t] plan (for vane letters; the frame is rotated). */
export function northEastST(L: BuildingLayout): { north: [number, number]; east: [number, number] } {
  // [s, t] -> EN is a rotation (+ translation): invert it on two unit steps
  const o = stToEN(L.frame, [0, 0]);
  const es = stToEN(L.frame, [1, 0]);
  const sE = es[0] - o[0];
  const sN = es[1] - o[1];
  // s axis in EN = (sE, sN); t axis is +90° (CCW) or -90°: get it from a t step
  const et = stToEN(L.frame, [0, 1]);
  const tE = et[0] - o[0];
  const tN = et[1] - o[1];
  // grid north (0, 1) in [s, t] = (dot with s axis, dot with t axis); true north differs by γ ≈ −1.2° (negligible here)
  return { north: [sN, tN], east: [sE, tE] };
}

/**
 * Weather vane [HMS 06 §3.2; research/09 E5; WEATHER_VANE]: an iron spindle from `base`, cross arms toward N, E, S, W
 * with small letter plates, and a pennant on top streaming toward `downwind` (plan unit vector). LOD1+.
 */
export function weatherVane(g: GeoBuilder, s: number, t: number, base: number, ne: { north: [number, number]; east: [number, number] }, downwind: [number, number]): void {
  const V = WEATHER_VANE;
  const r = 0.018;
  const top = base + V.spindle;
  rodSegment(g, IRON, [s, t, base], [s, t, top], r);
  const armH = base + V.spindle * 0.45;
  const { north: n, east: e } = ne;
  for (const [dx, dy] of [n, e, [-n[0], -n[1]], [-e[0], -e[1]]] as [number, number][]) {
    const end: P3 = [s + dx * V.arms, t + dy * V.arms, armH];
    rodSegment(g, IRON, [s, t, armH], end, r * 0.7);
    // letter plate (stand-in for N / O / S / W): a thin square facing along the arm
    const px = -dy;
    const py = dx;
    const h = V.letter / 2;
    const c: P3 = [end[0] + dx * 0.04, end[1] + dy * 0.04, armH];
    const q: P3[] = [
      [c[0] - px * h, c[1] - py * h, armH - h],
      [c[0] + px * h, c[1] + py * h, armH - h],
      [c[0] + px * h, c[1] + py * h, armH + h],
      [c[0] - px * h, c[1] - py * h, armH + h],
    ];
    g.quadFacing(IRON, q[0], q[1], q[2], q[3], [dx, dy, 0]);
    g.quadFacing(IRON, q[3], q[2], q[1], q[0], [-dx, -dy, 0]);
  }
  // pennant (flag) near the top, both faces
  const P = V.pennant;
  const fx = downwind[0];
  const fy = downwind[1];
  const h0 = top - 0.12 - P.height;
  const h1 = top - 0.12;
  const a: P3 = [s, t, h0];
  const b: P3 = [s, t, h1];
  const c: P3 = [s + fx * P.length, t + fy * P.length, (h0 + h1) / 2 + 0.03];
  const side: P3 = [-fy, fx, 0];
  g.polygonFacing(IRON, [a, c, b], side);
  g.polygonFacing(IRON, [a, b, c], [-side[0], -side[1], 0]);
  // gilt ball on the spindle top
  tip(g, GILT, [s, t, top], [s, t, top + 0.12], 0.035);
}

/** Prevailing wind on the Westrich plateau is south-west to west [N]; a vane's pennant streams downwind (to the NE). */
const DOWNWIND_EN: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];

/** Downwind direction in the building's [s, t] plan. */
function downwindST(ne: { north: [number, number]; east: [number, number] }): [number, number] {
  return [ne.east[0] * DOWNWIND_EN[0] + ne.north[0] * DOWNWIND_EN[1], ne.east[1] * DOWNWIND_EN[0] + ne.north[1] * DOWNWIND_EN[1]];
}

/** Vane over a pavilion roof apex or a Dachreiter spire top (plan point s, t; spindle foot at `base`). */
export function vaneAt(g: GeoBuilder, L: BuildingLayout, s: number, t: number, base: number): void {
  const ne = northEastST(L);
  weatherVane(g, s, t, base, ne, downwindST(ne));
}

/** Is a building-plan point clear of every other placed building in the scene year? */
function freeTest(L: BuildingLayout, ctx: BuildContext): (s: number, t: number) => boolean {
  const others = ctx.spec.buildings.filter((o) => o.id !== L.id && o.footprint && isPlaced(o) && inEpoch(o.epoch, ctx.options.year) && o.cls !== 'WALL' && o.cls !== 'GARD').map((o) => o.footprint!);
  return (s, t) => {
    const p = stToEN(L.frame, [s, t]);
    return !others.some((r) => pointInPolygon(p, r));
  };
}

/** Plan area of the building footprint (m²); frame length x width when there is no polygon. */
function footprintArea(L: BuildingLayout): number {
  const r = L.building.footprint;
  if (!r || r.length < 3) return L.frame.length * L.frame.width;
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function groundAt(L: BuildingLayout, ctx: BuildContext, s: number, t: number): number {
  const [E, N] = stToEN(L.frame, [s, t]);
  const h = ctx.terrain(E - E0, -(N - N0));
  return Number.isFinite(h) ? Math.min(h, L.stack.base_h + 0.5) : L.stack.base_h;
}

/**
 * Lightning rods (LOD2): masts on the main ridge (not over a raised centre roof, whose Dachreiter carries the vane) and
 * one down-conductor from the mast nearest a free corner. Pavilion roofs (no ridge) carry a vane instead (LOD1+, see
 * roofHardware), whose spindle is the air terminal [I], and the conductor starts at the apex.
 */
function lightningRods(g: GeoBuilder, L: BuildingLayout, ctx: BuildContext, free: (s: number, t: number) => boolean): void {
  const plan = L.roofPlan;
  const raised = raisedRoofs(L);
  const apex = plan.ridgeLength < 0.5;
  // wave-8 review fix: no masts on small huts; masts clear of the chimneys on the ridge line; height scaled to the roof
  if (footprintArea(L) < HEMMER_ROD.minArea) return;
  const stacks = chimneyStations(L)
    .filter((c) => Math.abs(c.t) < c.section[1] / 2 + 0.3)
    .map((c) => ({ s: c.s, half: c.section[0] / 2 }));
  const masts = apex ? [] : hemmerMasts(plan.ridgeLength, 0, HEMMER_ROD, stacks).filter((s) => !raised.some((r) => s > r.sMid - r.length / 2 - 1 && s < r.sMid + r.length / 2 + 1));
  const ne = northEastST(L);
  const axes: [[number, number], [number, number]] = [ne.north, ne.east];
  const mast = hemmerMastHeight(L.roof.ridge_h - L.stack.eaves_h, HEMMER_ROD, footprintArea(L));
  for (const s of masts) hemmerMast(g, s, 0, L.roof.ridge_h, axes, ctx.lod, mast);
  // the down-conductor (2 cm) only reads close up: LOD2
  if (ctx.lod < 2) return;
  const c = conductorCorner(L, free);
  if (!c) return;
  const f = L.frame;
  const start = apex ? 0 : masts.length ? masts.reduce((b, s) => (Math.abs(s - (c.sx * f.length) / 2) < Math.abs(b - (c.sx * f.length) / 2) ? s : b), masts[0]) : null;
  if (start === null) return;
  const ground = groundAt(L, ctx, (c.sx * f.length) / 2, (c.ty * f.width) / 2);
  const path = conductorPath(L, c, start, ground);
  const r = LIGHTNING_ROD.conductor / 2;
  for (let i = 1; i < path.length; i++) rodSegment(g, IRON, path[i - 1], path[i], r);
}

/**
 * Downpipes with hopper heads (LOD1+) on the garden and court sides (research/09 §2.8, G5, E3) [N]. Pipes stand at the
 * corners and risalit flanks, in a pier only where it is free of surrounds and open shutter leaves (sideDownpipes);
 * corners inside a junction with another building are skipped. Not on farm buildings (drip eaves, DOWNPIPE.noPipeClasses).
 */
function downpipes(g: GeoBuilder, L: BuildingLayout, ctx: BuildContext, free: (s: number, t: number) => boolean): void {
  const b = L.building;
  if (DOWNPIPE.noPipeClasses.has(b.cls)) return;
  if (L.roof.type === 'none' || L.roof.type === 'flat') return;
  const f = L.frame;
  const P = DOWNPIPE;
  const r = P.diameter / 2;
  const cd = L.members.cornice;
  const foot = L.stack.eaves_h - cd.height;
  const inset = (L.members.cornerLisenen ? 0.6 : 0) + 0.25;
  for (const side of ['garden', 'court'] as SideName[]) {
    const sd = f.sides[side];
    const lay = L.sides[side];
    if (!sd || !lay) continue;
    const pt = (a: number, d: number): [number, number] => [sd.p0[0] + sd.tangent[0] * a + sd.normal[0] * d, sd.p0[1] + sd.tangent[1] * a + sd.normal[1] * d];
    const cornerFree: [boolean, boolean] = [free(...pt(-1, 1)), free(...pt(sd.length + 1, 1))];
    const lone: 0 | 1 = side === 'garden' ? 1 : 0;
    for (const a of sideDownpipes(L, side, cornerFree, lone, inset)) {
      const rr = lay.risalits.find((x) => a >= x.a0 && a <= x.a1);
      // a corner pipe on the arris stands on the corner lisene
      const onLisene = L.members.cornerLisenen && (a < ARTICULATION.ecklisene.width || a > sd.length - ARTICULATION.ecklisene.width);
      const d = (rr ? (rr.risalit.projection ?? 0.5) : 0) + (onLisene ? ARTICULATION.ecklisene.projection : 0) + P.standoff;
      const [s, t] = pt(a, d);
      if (!free(...pt(a, 1.5))) continue;
      const ground = groundAt(L, ctx, s, t);
      const hTop = foot - P.hopper.height;
      // hopper head under the cornice, flaring up
      const n = sd.normal;
      const tg = sd.tangent;
      const hw = P.hopper.width / 2;
      const hd = P.hopper.depth;
      const back = d - P.standoff;
      const corner = (u: number, v: number, h: number): P3 => [sd.p0[0] + tg[0] * (a + u) + n[0] * (back + v), sd.p0[1] + tg[1] * (a + u) + n[1] * (back + v), h];
      g.quadFacing(PIPE, corner(-hw * 0.5, hd * 0.75, hTop), corner(hw * 0.5, hd * 0.75, hTop), corner(hw, hd, foot), corner(-hw, hd, foot), [n[0], n[1], 0]);
      g.quadFacing(PIPE, corner(-hw * 0.5, 0, hTop), corner(-hw * 0.5, hd * 0.75, hTop), corner(-hw, hd, foot), corner(-hw, 0, foot), [-tg[0], -tg[1], 0]);
      g.quadFacing(PIPE, corner(hw * 0.5, hd * 0.75, hTop), corner(hw * 0.5, 0, hTop), corner(hw, 0, foot), corner(hw, hd, foot), [tg[0], tg[1], 0]);
      g.quadFacing(PIPE, corner(-hw * 0.5, 0, hTop), corner(hw * 0.5, 0, hTop), corner(hw * 0.5, hd * 0.75, hTop), corner(-hw * 0.5, hd * 0.75, hTop), [0, 0, -1]);
      // pipe down to the shoe, the shoe turns out over the gutter / ground
      const hs = ground + P.shoe;
      rodSegment(g, PIPE, [s, t, hTop + 0.02], [s, t, hs], r, 6);
      rodSegment(g, PIPE, [s, t, hs + r], [s + n[0] * P.shoe, t + n[1] * P.shoe, ground + 0.06], r, 6);
    }
  }
}

/**
 * KB-I22 roof hardware of a rectangular building with facades: downpipes and pavilion-roof vanes at LOD1+, Hemmer rods
 * and the down-conductor at LOD2 (research/09 G6 "at LOD2"). `rods` = the building has lightning rods (catalogue
 * `facade.lightning_rods`, default `defaults.lightning_rods`: every building, research/10 §c.1 [D]).
 */
export function roofHardware(g: GeoBuilder, L: BuildingLayout, ctx: BuildContext, rods: boolean): void {
  const lod = ctx.lod;
  if (lod < 1 || L.roof.type === 'none' || L.roof.type === 'flat') return;
  const free = freeTest(L, ctx);
  downpipes(g, L, ctx, free);
  // vane on a pavilion (apex) roof [HMS; research/09 E5]
  if (L.roofPlan.ridgeLength < 0.5 && (L.roof.type === 'pavilion' || L.roof.type === 'hip')) {
    const top = roofHeightAtInset(L.roof, L.roof.ridge_inset);
    vaneAt(g, L, 0, 0, top - 0.05);
  }
  // wave-8 audit rank 10: masts with their gilt heads from LOD1, the down-conductor at LOD2
  if (rods) lightningRods(g, L, ctx, free);
}

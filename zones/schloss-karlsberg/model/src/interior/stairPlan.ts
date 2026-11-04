/**
 * Stair planning for the interiors (pure, no three.js).
 *
 * Input: a catalogue Stair (hall polygon, kind, riser/tread, flight width), the rise and the
 * doors of the hall. Output: flights, landings, upper-floor slabs and balustrade lines in
 * building-local [s, t], so that every flight obeys Blondel (2R + T = 0.65, research/02 §2.10)
 * with R <= 0.18 m and as many catalogue doors as possible stay reachable:
 *   - a door at the lower floor must not open onto the low part of a flight;
 *   - a door at the upper floor must open onto a landing / gallery slab.
 * Several layouts are tried (axis, start end, side) and scored; the catalogue riser is kept
 * when a layout fits, otherwise the riser grows in small steps (tagged I in the plan notes).
 *
 *  imperial : central flight up to a landing at the far end, two return flights along the
 *             sides to an upper landing over the entry; galleries along the long walls (Würzburg /
 *             Brühl type, 02 §2.10 [N]).
 *  dogleg   : two parallel flights with a half landing (doors -> gallery band beside them).
 *  u3       : three flights around an open well (short halls).
 */
import type { ST, Stair } from '../spec.ts';
import { STAIR } from '../layout/grammar.ts';

export interface RectST {
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

export interface Flight {
  id: string;
  /** Centre of the first riser line (bottom of the flight). */
  start: ST;
  /** Unit direction going up. */
  dir: ST;
  width: number;
  risers: number;
  riser: number;
  tread: number;
  /** Floor level at the bottom of the flight (abs. m). */
  h0: number;
}

export interface Landing {
  rect: RectST;
  h: number;
  kind: 'mid' | 'upper' | 'gallery';
}

export interface Rail {
  p0: ST;
  p1: ST;
  /** Walking-surface height at p0 / p1 (rail runs parallel, 0.95 m above). */
  h0: number;
  h1: number;
}

export interface StairPlan {
  id: string;
  kind: 'imperial' | 'dogleg' | 'u3';
  riser: number;
  tread: number;
  risers: number;
  h0: number;
  h1: number;
  flights: Flight[];
  /** Mid landings + upper slabs (kind 'upper' / 'gallery' are at h1). */
  landings: Landing[];
  rails: Rail[];
  /** Open area of the upper floor over the stair (union bbox of flights + mid landings). */
  well: RectST;
  /** Doors that could not be served (ids) and other notes. */
  blocked: string[];
  notes: string[];
  score: number;
}

export interface StairDoor {
  id: string;
  centre: ST;
  width: number;
  bottom_h: number;
}

export interface PlanStairInput {
  stair: Stair;
  h0: number;
  h1: number;
  doors: StairDoor[];
  /** Preferred configuration key (stacked stairs reuse the plan below). */
  prefer?: string;
  /** Upper slab thickness (headroom checks). */
  slab?: number;
}

// ---------------------------------------------------------------------------------------------
// Flight math
// ---------------------------------------------------------------------------------------------

/** Horizontal length of a flight with n risers (n − 1 treads; the last riser lands). */
export function flightGoing(risers: number, tread: number): number {
  return Math.max(0, risers - 1) * tread;
}

/** Nosing height of the tread under a point `x` metres along the flight (x from the first riser). */
export function treadHeight(f: Pick<Flight, 'risers' | 'riser' | 'tread' | 'h0'>, x: number): number {
  if (x < 0) return f.h0;
  const k = Math.min(f.risers, Math.floor(x / f.tread + 1e-9) + 1);
  return f.h0 + k * f.riser;
}

/**
 * Ramp collider line of a flight: through all nosings, extended down to the floor one tread
 * before the first riser. Returns [x0, h0] and [x1, h1] along the flight (x from the first riser).
 */
export function rampLine(f: Pick<Flight, 'risers' | 'riser' | 'tread' | 'h0'>): [[number, number], [number, number]] {
  return [
    [-f.tread, f.h0],
    [flightGoing(f.risers, f.tread), f.h0 + f.risers * f.riser],
  ];
}

/** Risers and Blondel tread for a rise at a target riser (R <= max). */
export function riserFor(rise: number, target: number): { risers: number; riser: number; tread: number } {
  const risers = Math.max(1, Math.ceil(rise / target - 1e-9));
  const riser = rise / risers;
  return { risers, riser, tread: STAIR.blondel - 2 * riser };
}

export const MAX_RISER = 0.18;

// ---------------------------------------------------------------------------------------------
// Local hall frame
// ---------------------------------------------------------------------------------------------

interface Frame {
  key: string;
  a: ST;
  b: ST;
  origin: ST;
  D: number;
  W: number;
}

function hallRect(poly: ST[]): RectST {
  const ss = poly.map((p) => p[0]);
  const ts = poly.map((p) => p[1]);
  return { s0: Math.min(...ss), s1: Math.max(...ss), t0: Math.min(...ts), t1: Math.max(...ts) };
}

function frames(r: RectST): Frame[] {
  const Ls = r.s1 - r.s0;
  const Lt = r.t1 - r.t0;
  return [
    { key: '+s', a: [1, 0], b: [0, 1], origin: [r.s0, r.t0], D: Ls, W: Lt },
    { key: '-s', a: [-1, 0], b: [0, 1], origin: [r.s1, r.t0], D: Ls, W: Lt },
    { key: '+t', a: [0, 1], b: [1, 0], origin: [r.s0, r.t0], D: Lt, W: Ls },
    { key: '-t', a: [0, -1], b: [1, 0], origin: [r.s0, r.t1], D: Lt, W: Ls },
  ];
}

const toST = (f: Frame, u: number, v: number): ST => [f.origin[0] + f.a[0] * u + f.b[0] * v, f.origin[1] + f.a[1] * u + f.b[1] * v];

function rectToST(f: Frame, u0: number, u1: number, v0: number, v1: number): RectST {
  const p = toST(f, u0, v0);
  const q = toST(f, u1, v1);
  return { s0: Math.min(p[0], q[0]), s1: Math.max(p[0], q[0]), t0: Math.min(p[1], q[1]), t1: Math.max(p[1], q[1]) };
}

function dirST(f: Frame, du: number, dv: number): ST {
  return [f.a[0] * du + f.b[0] * dv, f.a[1] * du + f.b[1] * dv];
}

// ---------------------------------------------------------------------------------------------
// Layout generators (local u along the hall, v across; return null when infeasible)
// ---------------------------------------------------------------------------------------------

interface Draft {
  kind: StairPlan['kind'];
  flights: Flight[];
  landings: Landing[];
  notes: string[];
}

interface Ctx {
  f: Frame;
  flip: boolean;
  N: number;
  R: number;
  T: number;
  h0: number;
  h1: number;
  fw: number;
  id: string;
}

/** v in a possibly mirrored frame. */
const V = (c: Ctx, v: number) => (c.flip ? c.f.W - v : v);

function flight(c: Ctx, id: string, u: number, v: number, du: number, dv: number, width: number, risers: number, h0: number): Flight {
  return { id, start: toST(c.f, u, V(c, v)), dir: dirST(c.f, du, c.flip ? -dv : dv), width, risers, riser: c.R, tread: c.T, h0 };
}

function landing(c: Ctx, u0: number, u1: number, v0: number, v1: number, h: number, kind: Landing['kind']): Landing {
  const a = V(c, v0);
  const b = V(c, v1);
  return { rect: rectToST(c.f, u0, u1, Math.min(a, b), Math.max(a, b)), h, kind };
}

function dogleg(c: Ctx): Draft | null {
  const { f, N, R, T } = c;
  const gap = 0.12;
  let fw = c.fw;
  if (2 * fw + gap > f.W) fw = (f.W - gap) / 2;
  if (fw < 0.85) return null;
  const n1 = Math.ceil(N / 2);
  const n2 = N - n1;
  const g1 = flightGoing(n1, T);
  const g2 = flightGoing(n2, T);
  const Ld = Math.max(fw, 1.0);
  const cMax = f.D - g1 - Ld;
  const cMin = Math.max(0.6, 1.0 - (g1 - g2));
  if (cMax < cMin - 1e-9) return null;
  const c0 = Math.min(cMax, Math.max(cMin, 1.6));
  const uTop = c0 + g1 - g2;
  const band = 2 * fw + gap;
  const hm = c.h0 + n1 * R;
  const fl = [flight(c, `${c.id}/lauf-1`, c0, fw / 2, 1, 0, fw, n1, c.h0), flight(c, `${c.id}/lauf-2`, c0 + g1, fw + gap + fw / 2, -1, 0, fw, n2, hm)];
  const ls = [landing(c, c0 + g1, c0 + g1 + Ld, 0, band, hm, 'mid'), landing(c, 0, uTop, 0, f.W, c.h1, 'upper')];
  if (f.W - band >= 0.9) ls.push(landing(c, uTop, f.D, band, f.W, c.h1, 'gallery'));
  if (f.D - (c0 + g1 + Ld) >= 0.6) ls.push(landing(c, c0 + g1 + Ld, f.D, 0, band, c.h1, 'gallery'));
  return { kind: 'dogleg', flights: fl, landings: ls, notes: [] };
}

function u3(c: Ctx): Draft | null {
  const { f, N, R, T } = c;
  const fw = Math.min(c.fw, (f.W - 0.9) / 2);
  if (fw < 0.85) return null;
  const c0 = 1.0;
  const g1max = f.D - fw - c0;
  const g2max = f.W - 2 * fw;
  const g3max = f.D - fw - 1.0;
  if (g1max <= 0 || g3max <= 0) return null;
  const nmax = [g1max, g2max, g3max].map((g) => Math.floor(g / T + 1e-9) + 1);
  if (nmax[0] + nmax[1] + nmax[2] < N) return null;
  let n2 = Math.min(nmax[1], Math.max(2, Math.round((N * g2max) / (g1max + g2max + g3max))));
  let n1 = Math.min(nmax[0], Math.ceil((N - n2) / 2));
  let n3 = N - n1 - n2;
  if (n3 > nmax[2]) {
    n1 = Math.min(nmax[0], n1 + (n3 - nmax[2]));
    n3 = N - n1 - n2;
  }
  if (n3 > nmax[2]) {
    n2 = N - n1 - nmax[2];
    n3 = nmax[2];
  }
  if (n2 < 1 || n2 > nmax[1] || n1 < 2 || n3 < 2) return null;
  const g1 = flightGoing(n1, T);
  const g2 = flightGoing(n2, T);
  const g3 = flightGoing(n3, T);
  const uL = f.D - fw;
  const slack = g2max - g2;
  const v2a = fw + slack / 2;
  const h2 = c.h0 + n1 * R;
  const h3 = h2 + n2 * R;
  const uTop = uL - g3;
  return {
    kind: 'u3',
    flights: [
      flight(c, `${c.id}/lauf-1`, c0, fw / 2, 1, 0, fw, n1, c.h0),
      flight(c, `${c.id}/lauf-2`, f.D - fw / 2, v2a, 0, 1, fw, n2, h2),
      flight(c, `${c.id}/lauf-3`, uL, f.W - fw / 2, -1, 0, fw, n3, h3),
    ],
    landings: [landing(c, c0 + g1, f.D, 0, v2a, h2, 'mid'), landing(c, uL, f.D, v2a + g2, f.W, h3, 'mid'), landing(c, 0, uTop, 0, f.W, c.h1, 'upper')],
    notes: [],
  };
}

function imperial(c: Ctx): Draft | null {
  const { f, N, R, T } = c;
  const half = f.W / 2;
  const fwC = Math.min(c.fw, f.W * 0.3);
  const Rband = half - fwC / 2;
  const fwS = Math.min(0.72 * fwC, Rband - 0.8 - 1.4);
  if (fwS < 1.2) return null;
  const G = Math.min(2.4, Rband - fwS - 0.8);
  const gap = Rband - fwS - G;
  const n1 = Math.round(N / 2);
  const n2 = N - n1;
  const g1 = flightGoing(n1, T);
  const g2 = flightGoing(n2, T);
  const Ld = Math.max(2.4, fwS + 0.2);
  const c0 = f.D - Ld - g1;
  const uTop = f.D - Ld - g2;
  if (c0 < 0.8 || uTop < 2.0) return null;
  const hm = c.h0 + n1 * R;
  const inner = half - G; // |v - half| < inner: everything but the galleries
  const vS = fwC / 2 + gap + fwS / 2; // side flight centre offset
  const notes: string[] = [];
  // headroom over the central flight under the upper landing
  const hc = c.h0 + (Math.max(0, uTop - c0) / T + 1) * R;
  if (c.h1 - 0.45 - hc < 2.1) notes.push('low headroom under the upper landing');
  return {
    kind: 'imperial',
    flights: [
      flight(c, `${c.id}/mittellauf`, c0, half, 1, 0, fwC, n1, c.h0),
      flight(c, `${c.id}/seitenlauf-links`, f.D - Ld, half - vS, -1, 0, fwS, n2, hm),
      flight(c, `${c.id}/seitenlauf-rechts`, f.D - Ld, half + vS, -1, 0, fwS, n2, hm),
    ],
    landings: [
      landing(c, f.D - Ld, f.D, half - inner, half + inner, hm, 'mid'),
      landing(c, 0, uTop, 0, f.W, c.h1, 'upper'),
      landing(c, uTop, f.D, 0, G, c.h1, 'gallery'),
      landing(c, uTop, f.D, f.W - G, f.W, c.h1, 'gallery'),
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

function inRect(p: ST, r: RectST, pad = 0): boolean {
  return p[0] >= r.s0 - pad && p[0] <= r.s1 + pad && p[1] >= r.t0 - pad && p[1] <= r.t1 + pad;
}

/** Plan footprint of a flight. */
export function flightRect(fl: Flight): RectST {
  const L = flightGoing(fl.risers, fl.tread);
  const n: ST = [-fl.dir[1], fl.dir[0]];
  const pts: ST[] = [-1, 1].flatMap((k) => [0, L].map((x) => [fl.start[0] + fl.dir[0] * x + (n[0] * k * fl.width) / 2, fl.start[1] + fl.dir[1] * x + (n[1] * k * fl.width) / 2] as ST));
  return { s0: Math.min(...pts.map((p) => p[0])), s1: Math.max(...pts.map((p) => p[0])), t0: Math.min(...pts.map((p) => p[1])), t1: Math.max(...pts.map((p) => p[1])) };
}

/** Point 0.5 m inside the hall in front of a door on (or near) the hall boundary. */
export function doorApproach(hall: RectST, c: ST, inside = 0.5): ST {
  const d = [Math.abs(c[0] - hall.s0), Math.abs(c[0] - hall.s1), Math.abs(c[1] - hall.t0), Math.abs(c[1] - hall.t1)];
  const k = d.indexOf(Math.min(...d));
  const clampS = Math.min(hall.s1, Math.max(hall.s0, c[0]));
  const clampT = Math.min(hall.t1, Math.max(hall.t0, c[1]));
  if (k === 0) return [hall.s0 + inside, clampT];
  if (k === 1) return [hall.s1 - inside, clampT];
  if (k === 2) return [clampS, hall.t0 + inside];
  return [clampS, hall.t1 - inside];
}

function blockedDoors(d: Draft, hall: RectST, doors: StairDoor[], h0: number, h1: number, slab: number): string[] {
  const out: string[] = [];
  for (const door of doors) {
    const p = doorApproach(hall, door.centre);
    const lower = Math.abs(door.bottom_h - h0) < 0.35;
    const upper = Math.abs(door.bottom_h - h1) < 0.35;
    if (upper) {
      if (!d.landings.some((l) => l.kind !== 'mid' && inRect(p, l.rect, 0.05))) out.push(door.id);
    } else if (lower) {
      let bad = false;
      for (const fl of d.flights) {
        if (!inRect(p, flightRect(fl), -0.05)) continue;
        const x = (p[0] - fl.start[0]) * fl.dir[0] + (p[1] - fl.start[1]) * fl.dir[1];
        if (treadHeight(fl, x) - 0.35 - h0 < 2.2) bad = true;
      }
      for (const l of d.landings) if (inRect(p, l.rect, -0.05) && l.h - slab - h0 < 2.1 && l.h > h0 + 0.01) bad = true;
      if (bad) out.push(door.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rails (balustrade lines)
// ---------------------------------------------------------------------------------------------

function onHallEdge(p: ST, q: ST, hall: RectST): boolean {
  const e = 0.06;
  const sameS = Math.abs(p[0] - q[0]) < 1e-6;
  const sameT = Math.abs(p[1] - q[1]) < 1e-6;
  if (sameS && (Math.abs(p[0] - hall.s0) < e || Math.abs(p[0] - hall.s1) < e)) return true;
  if (sameT && (Math.abs(p[1] - hall.t0) < e || Math.abs(p[1] - hall.t1) < e)) return true;
  return false;
}

function subtract1D(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [x0, x1] of parts) {
      if (c1 <= x0 || c0 >= x1) next.push([x0, x1]);
      else {
        if (c0 > x0) next.push([x0, c0]);
        if (c1 < x1) next.push([c1, x1]);
      }
    }
    parts = next;
  }
  return parts.filter(([x0, x1]) => x1 - x0 > 0.15);
}

function rails(d: Draft, hall: RectST): Rail[] {
  const out: Rail[] = [];
  // flights: both long sides unless against a wall
  for (const fl of d.flights) {
    const L = flightGoing(fl.risers, fl.tread);
    const n: ST = [-fl.dir[1], fl.dir[0]];
    for (const k of [-1, 1]) {
      const o: ST = [(n[0] * k * fl.width) / 2, (n[1] * k * fl.width) / 2];
      const p0: ST = [fl.start[0] + o[0], fl.start[1] + o[1]];
      const p1: ST = [p0[0] + fl.dir[0] * L, p0[1] + fl.dir[1] * L];
      if (onHallEdge(p0, p1, hall)) continue;
      out.push({ p0, p1, h0: fl.h0 + fl.riser, h1: fl.h0 + fl.risers * fl.riser });
    }
  }
  // landings / slabs: open edges minus flight connections and same-height neighbours
  for (const l of d.landings) {
    const r = l.rect;
    const edges: [ST, ST][] = [
      [[r.s0, r.t0], [r.s1, r.t0]],
      [[r.s1, r.t0], [r.s1, r.t1]],
      [[r.s1, r.t1], [r.s0, r.t1]],
      [[r.s0, r.t1], [r.s0, r.t0]],
    ];
    for (const [p, q] of edges) {
      if (onHallEdge(p, q, hall)) continue;
      const alongS = Math.abs(p[1] - q[1]) < 1e-6;
      const lo = alongS ? Math.min(p[0], q[0]) : Math.min(p[1], q[1]);
      const hi = alongS ? Math.max(p[0], q[0]) : Math.max(p[1], q[1]);
      const fixed = alongS ? p[1] : p[0];
      const cuts: [number, number][] = [];
      for (const fl of d.flights) {
        const fr = flightRect(fl);
        const ends = [fl.h0, fl.h0 + fl.risers * fl.riser];
        if (!ends.some((h) => Math.abs(h - l.h) < 0.01)) continue;
        const touches = alongS ? Math.abs(fr.t0 - fixed) < 0.02 || Math.abs(fr.t1 - fixed) < 0.02 : Math.abs(fr.s0 - fixed) < 0.02 || Math.abs(fr.s1 - fixed) < 0.02;
        if (touches) cuts.push(alongS ? [fr.s0, fr.s1] : [fr.t0, fr.t1]);
      }
      for (const m of d.landings) {
        if (m === l || Math.abs(m.h - l.h) > 0.01) continue;
        const mr = m.rect;
        const touches = alongS ? Math.abs(mr.t0 - fixed) < 0.02 || Math.abs(mr.t1 - fixed) < 0.02 : Math.abs(mr.s0 - fixed) < 0.02 || Math.abs(mr.s1 - fixed) < 0.02;
        if (touches) cuts.push(alongS ? [mr.s0, mr.s1] : [mr.t0, mr.t1]);
      }
      for (const [a, b] of subtract1D(lo, hi, cuts)) {
        const p0: ST = alongS ? [a, fixed] : [fixed, a];
        const p1: ST = alongS ? [b, fixed] : [fixed, b];
        out.push({ p0, p1, h0: l.h, h1: l.h });
      }
    }
  }
  return out;
}

function unionRect(rs: RectST[]): RectST {
  return {
    s0: Math.min(...rs.map((r) => r.s0)),
    s1: Math.max(...rs.map((r) => r.s1)),
    t0: Math.min(...rs.map((r) => r.t0)),
    t1: Math.max(...rs.map((r) => r.t1)),
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** Plan a stair; never throws - an impossible hall yields the least bad layout with notes. */
export function planStair(inp: PlanStairInput): StairPlan {
  const { stair, h0, h1 } = inp;
  const rise = h1 - h0;
  const hall = hallRect(stair.polygon);
  const slab = inp.slab ?? 0.45;
  const cls = stair.kind === 'imperial' ? STAIR.prunk : (stair.flight_width ?? 1.7) < 1.4 ? STAIR.service : STAIR.secondary;
  const R0 = stair.riser ?? cls.riser;
  const fw = stair.flight_width ?? cls.width;
  const upKey = stair.up_dir ? (Math.abs(stair.up_dir[0]) > Math.abs(stair.up_dir[1]) ? (stair.up_dir[0] > 0 ? '+s' : '-s') : stair.up_dir[1] > 0 ? '+t' : '-t') : '+s';
  const sameAxis = (k: string) => k[1] === upKey[1];

  let best: { plan: StairPlan; score: number } | null = null;
  for (let target = R0 * 1.004; target <= MAX_RISER * 1.004 + 1e-9; target += 0.004) {
    const rr = riserFor(rise, target);
    if (rr.riser > MAX_RISER + 1e-9) break;
    // keep the catalogue tread when the riser is unchanged
    const T = Math.abs(rr.riser - (stair.riser ?? -1)) < 0.0015 && stair.tread ? stair.tread : rr.tread;
    for (const f of frames(hall)) {
      for (const flip of [false, true]) {
        const c: Ctx = { f, flip, N: rr.risers, R: rr.riser, T, h0, h1, fw, id: stair.id };
        const gens: [Draft | null, number][] =
          stair.kind === 'imperial'
            ? [
                [imperial(c), 0],
                [dogleg(c), 3],
              ]
            : [
                [dogleg(c), 0],
                [u3(c), 0.4],
              ];
        for (const [d, kindPenalty] of gens) {
          if (!d) continue;
          const blocked = blockedDoors(d, hall, inp.doors, h0, h1, slab);
          const key = `${d.kind}${f.key}${flip ? '~' : ''}`;
          let score = blocked.length * 10 + kindPenalty + Math.abs(rr.riser - R0) * 40;
          score += f.key === upKey ? 0 : sameAxis(f.key) ? 0.3 : 0.6;
          if (flip) score += 0.05;
          if (inp.prefer && inp.prefer !== key) score += 0.8;
          if (stair.kind === 'imperial' && d.kind === 'imperial' && flip) score += 0.01;
          if (best && score >= best.score) continue;
          const notes = [...d.notes, `layout ${key}`];
          if (Math.abs(rr.riser - R0) > 0.0015) notes.push(`I riser ${R0.toFixed(3)} -> ${rr.riser.toFixed(3)} m to fit the hall (Blondel 2R+T = ${(2 * rr.riser + T).toFixed(3)})`);
          if (blocked.length) notes.push(`doors not served by this layout: ${blocked.join(', ')}`);
          const plan: StairPlan = {
            id: stair.id,
            kind: d.kind,
            riser: rr.riser,
            tread: T,
            risers: rr.risers,
            h0,
            h1,
            flights: d.flights,
            landings: d.landings,
            rails: rails(d, hall),
            well: unionRect([...d.flights.map(flightRect), ...d.landings.filter((l) => l.kind === 'mid').map((l) => l.rect)]),
            blocked,
            notes,
            score,
          };
          best = { plan, score };
        }
      }
    }
    const cur = best as { plan: StairPlan; score: number } | null;
    if (cur && cur.plan.blocked.length === 0) break;
  }
  const found = best as { plan: StairPlan; score: number } | null;
  if (found) return found.plan;
  // nothing fits even at the max riser: a single straight flight along the long axis (warned)
  const rr = riserFor(rise, MAX_RISER);
  const f = frames(hall).sort((a, b) => b.D - a.D)[0];
  const c: Ctx = { f, flip: false, N: rr.risers, R: rr.riser, T: rr.tread, h0, h1, fw: Math.min(fw, f.W), id: stair.id };
  const fl = flight(c, `${stair.id}/lauf-1`, 0.3, f.W / 2, 1, 0, c.fw, rr.risers, h0);
  const going = flightGoing(rr.risers, rr.tread);
  const d: Draft = { kind: 'dogleg', flights: [fl], landings: [landing(c, Math.min(f.D, 0.3 + going), f.D, 0, f.W, h1, 'upper')], notes: ['U stair does not fit the hall; straight flight overruns'] };
  return { id: stair.id, kind: 'dogleg', riser: rr.riser, tread: rr.tread, risers: rr.risers, h0, h1, flights: d.flights, landings: d.landings, rails: rails(d, hall), well: flightRect(fl), blocked: [], notes: d.notes, score: 999 };
}

/** Configuration key of a plan (for stacking the next stair on the same hall). */
export function planKey(p: StairPlan): string {
  return p.notes.find((n) => n.startsWith('layout '))?.slice(7) ?? '';
}

export { hallRect };

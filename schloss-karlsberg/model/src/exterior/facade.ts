/**
 * LOD1 / LOD2 facades of rectangular buildings: real wall geometry with holes.
 *
 * Per side the wall is split into segments (base plane and risalit planes, with return faces); each segment has a
 * plinth band (red sandstone, projecting) and a wall band (render). Openings from `layoutBuilding()` are cut with
 * the slab decomposition in cut.ts; arched heads get spandrels, reveals run through the wall thickness, frames and
 * glass sit 0.12-0.2 m behind the face. Members (surrounds, sills, Verdachungen, corner strips, cornices, string
 * courses) are separate pieces in the members colour. Dormers, oculi and chimneys sit on the roof.
 *
 * LOD1: frames with one mullion + transom, closed dark backing behind the glass, shutters, Freitreppen.
 * LOD2: full glazing bars (Sprossen), open portal leaves, fanlights, keystones; no backing (interiors behind).
 */
import type { BuildContext } from '../context.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { type FacadeOpening, type RoofOpening, cullBuriedOpenings, facadeOpenings, layoutBays } from '../layout/facade.ts';
import type { FrameSide } from '../layout/footprint.ts';
import { ARTICULATION, CHIMNEY, CORNICE, PORTICO, WALL_THICKNESS } from '../layout/grammar.ts';
import { roofHeightAtInset } from '../layout/roof.ts';
import type { HeadForm, ST } from '../spec.ts';
import { normaliseColour } from '../materials/index.ts';
import { type GeoBuilder, type MatKey, type P3, matKey } from './builder.ts';
import { type Rect, archCurve, archRise, archSpandrels, glazingGrid, wallPieces } from './cut.ts';
import { type ExteriorInfo, type ExteriorPalette, offsetRing } from './index.ts';

const GLASS = matKey('glass.crown');
const FRAME = matKey('wood.frame', '#E9E6DE');
const DOOR = matKey('wood.door');
const BACKING = matKey('wall.limewash', '#2E2925');
const IRON = matKey('metal.iron');

/** Drawing helper in facade coordinates (a along the side, h absolute, d = outward offset from the side line). */
class Face {
  constructor(
    public g: GeoBuilder,
    public sd: Pick<FrameSide, 'p0' | 'tangent' | 'normal'>,
  ) {}
  P(a: number, h: number, d: number): P3 {
    const { p0, tangent: T, normal: N } = this.sd;
    return [p0[0] + T[0] * a + N[0] * d, p0[1] + T[1] * a + N[1] * d, h];
  }
  get out(): P3 {
    return [this.sd.normal[0], this.sd.normal[1], 0];
  }
  dirA(sign: number): P3 {
    return [this.sd.tangent[0] * sign, this.sd.tangent[1] * sign, 0];
  }
  /** Front-facing rectangle at offset d. */
  rect(k: MatKey, a0: number, a1: number, h0: number, h1: number, d: number): void {
    this.g.quad(k, this.P(a0, h0, d), this.P(a1, h0, d), this.P(a1, h1, d), this.P(a0, h1, d));
  }
  /** Front-facing polygon at offset d from (a, h) points. */
  poly(k: MatKey, pts: [number, number][], d: number, facing: P3 = this.out): void {
    this.g.polygonFacing(
      k,
      pts.map(([a, h]) => this.P(a, h, d)),
      facing,
    );
  }
  box(k: MatKey, a0: number, a1: number, d0: number, d1: number, h0: number, h1: number, skipBack = true): void {
    this.g.orientedBox(k, this.sd.p0, this.sd.tangent, this.sd.normal, a0, a1, d0, d1, h0, h1, skipBack);
  }
  /** Quad between two (a, h) points extruded from d0 to d1, facing `dir`. */
  strip(k: MatKey, p: [number, number], q: [number, number], d0: number, d1: number, dir: P3): void {
    this.g.quadFacing(k, this.P(p[0], p[1], d0), this.P(q[0], q[1], d0), this.P(q[0], q[1], d1), this.P(p[0], p[1], d1), dir);
  }
}

interface Segment {
  a0: number;
  a1: number;
  d: number;
}

/** Ring of the building outline including risalit projections (CCW, deduplicated) - for cornices and caps. */
export function outlineWithRisalits(L: BuildingLayout): ST[] {
  const pts: ST[] = [];
  const push = (p: ST) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-4) pts.push(p);
  };
  for (const name of ['garden', 'end_b', 'court', 'end_a'] as const) {
    const sd = L.frame.sides[name];
    const P = (a: number, d: number): ST => [sd.p0[0] + sd.tangent[0] * a + sd.normal[0] * d, sd.p0[1] + sd.tangent[1] * a + sd.normal[1] * d];
    push(P(0, 0));
    for (const r of [...L.sides[name].risalits].sort((x, y) => x.a0 - y.a0)) {
      const p = r.risalit.projection ?? ARTICULATION.risalitProjection;
      const a0 = Math.max(0, r.a0);
      const a1 = Math.min(sd.length, r.a1);
      push(P(a0, 0));
      push(P(a0, p));
      push(P(a1, p));
      push(P(a1, 0));
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
  // drop collinear points
  return pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6;
  });
}

/** Extrude a cornice-like profile [d outward, h] along a CCW ring. */
/**
 * A Durchfahrt cut out of a moulding that runs at its height (the plinth course): opening centre on the facade
 * plane, facade tangent and half width (plan [s, t]), and the opening's height range.
 */
export interface MouldingCut {
  p: ST;
  tan: ST;
  half: number;
  h0: number;
  h1: number;
}

/** [0, 1] minus the given parameter intervals. */
function keepSpans(gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let u = 0;
  for (const [a, b] of gaps.map(([a, b]): [number, number] => [Math.max(0, a), Math.min(1, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    if (a > u) out.push([u, a]);
    u = Math.max(u, b);
  }
  if (u < 1) out.push([u, 1]);
  return out;
}

export function profileRing(g: GeoBuilder, k: MatKey, ring: ST[], prof: [number, number][], cuts: readonly MouldingCut[] = []): void {
  const rings = prof.map(([d]) => offsetRing(ring, d));
  const hLo = Math.min(...prof.map((p) => p[1]));
  const hHi = Math.max(...prof.map((p) => p[1]));
  const lerp = (r: ST[], i: number, n: number, u: number): ST => [r[i][0] + (r[n][0] - r[i][0]) * u, r[i][1] + (r[n][1] - r[i][1]) * u];
  for (let i = 0; i < ring.length; i++) {
    const n = (i + 1) % ring.length;
    const ex = ring[n][0] - ring[i][0];
    const ey = ring[n][1] - ring[i][1];
    const len = Math.hypot(ex, ey);
    // Durchfahrten through this edge at the moulding's height: leave the passage open (no ledge across the arch)
    const gaps: [number, number][] = [];
    if (len > 1e-6) {
      for (const c of cuts) {
        if (c.h1 <= hLo || c.h0 >= hHi) continue;
        if (Math.abs(ex * c.tan[0] + ey * c.tan[1]) / len < 0.99) continue;
        const wx = c.p[0] - ring[i][0];
        const wy = c.p[1] - ring[i][1];
        if (Math.abs(wx * ey - wy * ex) / len > 2) continue; // not this facade plane (risalits project < 2 m)
        const along = (wx * ex + wy * ey) / len;
        gaps.push([(along - c.half) / len, (along + c.half) / len]);
      }
    }
    const spans = gaps.length ? keepSpans(gaps) : [[0, 1] as [number, number]];
    for (let j = 1; j < prof.length; j++) {
      const h0 = prof[j - 1][1];
      const h1 = prof[j][1];
      for (const [u0, u1] of spans) {
        const a0 = lerp(rings[j - 1], i, n, u0);
        const a1 = lerp(rings[j - 1], i, n, u1);
        const b0 = lerp(rings[j], i, n, u0);
        const b1 = lerp(rings[j], i, n, u1);
        g.quad(k, [a0[0], a0[1], h0], [a1[0], a1[1], h0], [b1[0], b1[1], h1], [b0[0], b0[1], h1]);
      }
    }
    // end caps where a span stops at a cut (profile section down to the wall plane, both windings)
    if (gaps.length) {
      for (const [u0, u1] of spans) {
        for (const u of [u0, u1]) {
          if (u <= 1e-6 || u >= 1 - 1e-6) continue;
          const w = lerp(ring, i, n, u);
          for (let j = 1; j < prof.length; j++) {
            const p0 = lerp(rings[j - 1], i, n, u);
            const p1 = lerp(rings[j], i, n, u);
            const q: [P3, P3, P3, P3] = [
              [p0[0], p0[1], prof[j - 1][1]],
              [p1[0], p1[1], prof[j][1]],
              [w[0], w[1], prof[j][1]],
              [w[0], w[1], prof[j - 1][1]],
            ];
            g.quad(k, q[0], q[1], q[2], q[3]);
            g.quad(k, q[3], q[2], q[1], q[0]);
          }
        }
      }
    }
  }
}

/** Classical main cornice profile (fascia, bed moulding, corona, cymatium), unit height/projection. */
const CORNICE_PROFILE: [number, number][] = [
  [0, 0],
  [0.1, 0],
  [0.1, 0.12],
  [0.18, 0.2],
  [0.22, 0.32],
  [0.3, 0.36],
  [0.32, 0.46],
  [0.86, 0.5],
  [0.86, 0.7],
  [0.94, 0.76],
  [1.0, 0.9],
  [1.0, 1.0],
  [0, 1.0],
];

function corniceDims(cls: string): { height: number; projection: number } {
  return (CORNICE as Record<string, { height: number; projection: number }>)[cls] ?? CORNICE.default;
}

export interface FacadeOptions {
  lod: 1 | 2;
  thickness: number;
  backing: boolean;
  shutters: MatKey | null;
  members: MatKey;
  wall: MatKey;
  plinth: MatKey;
  roof: MatKey;
  plinthTop: number;
  plinthBottom: number;
  eaves: number;
  corniceH: number;
  /** Whole building depth (Durchfahrt tunnels). */
  depth: number;
  cls: string;
  upperRowFloor: number;
}

function isWindowLike(k: FacadeOpening['kind']): boolean {
  return k === 'window' || k === 'porte_fenetre' || k === 'cellar_window' || k === 'stall_window' || k === 'dormer' || k === 'oculus';
}

/** Hole rectangle of an opening (full height incl. the arch rise). */
function holeOf(o: { a: number; width: number; bottom_h: number; top_h: number }): Rect {
  return { a0: o.a - o.width / 2, a1: o.a + o.width / 2, h0: o.bottom_h, h1: o.top_h };
}

/**
 * Cut + furnish one opening on face `f` whose wall plane is at offset `d`, inside band [h0, h1] (clipped).
 * Returns nothing; adds spandrels, reveals, frames/glass/doors, surrounds.
 */
function furnishOpening(
  f: Face,
  o: { kind: FacadeOpening['kind']; a: number; width: number; bottom_h: number; top_h: number; head: HeadForm; storey?: number },
  d: number,
  bandKey: MatKey,
  band: Rect,
  opt: FacadeOptions,
  revealDepth: number,
  isLowestBand: boolean,
): void {
  const a0 = o.a - o.width / 2;
  const a1 = o.a + o.width / 2;
  const head: HeadForm = o.kind === 'durchfahrt' || o.kind === 'carriage_gate' ? (o.head === 'straight' ? 'straight' : 'round') : o.head;
  const rise = Math.min(archRise(head, o.width), o.top_h - o.bottom_h);
  const spring = o.top_h - rise;
  const hb0 = Math.max(o.bottom_h, band.h0);
  const hb1 = Math.min(spring, band.h1);
  // spandrels (only where the arch lies inside the band)
  if (rise > 0 && o.top_h <= band.h1 + 1e-6 && spring >= band.h0 - 1e-6) {
    for (const sp of archSpandrels(a0, a1, o.top_h, head, 10)) f.poly(bandKey, sp, d);
  }
  // reveals: jambs, soffit / arch soffit, sill (each clipped to the band)
  const dIn = d - revealDepth;
  if (hb1 > hb0) {
    f.strip(bandKey, [a0, hb0], [a0, hb1], d, dIn, f.dirA(1));
    f.strip(bandKey, [a1, hb0], [a1, hb1], d, dIn, f.dirA(-1));
  }
  if (rise > 0 && o.top_h <= band.h1 + 1e-6 && spring >= band.h0 - 1e-6) {
    const c = archCurve(a0, a1, o.top_h, head, 10);
    for (let i = 1; i < c.length; i++) {
      const p = c[i - 1];
      const q = c[i];
      const mx = (p[0] + q[0]) / 2 - o.a;
      const my = (p[1] + q[1]) / 2 - spring;
      const l = Math.hypot(mx, my) || 1;
      const T = f.sd.tangent;
      f.strip(bandKey, p, q, d, dIn, [(-mx / l) * T[0], (-mx / l) * T[1], -my / l]);
    }
  } else if (rise === 0 && o.top_h <= band.h1 + 1e-6 && o.top_h > band.h0) {
    f.strip(bandKey, [a0, o.top_h], [a1, o.top_h], d, dIn, [0, 0, -1]);
  }
  if (o.bottom_h >= band.h0 - 1e-6 && o.bottom_h < band.h1) {
    const door = o.kind === 'portal' || o.kind === 'door' || o.kind === 'double_door' || o.kind === 'porte_fenetre' || o.kind === 'carriage_gate';
    if (door) {
      // stone threshold slab, running 0.8 m past the inner wall face (under the interior floor) - no walk gap
      f.box(opt.plinth, a0, a1, dIn - 0.8, d, o.bottom_h - 0.3, o.bottom_h - 0.005, false);
    }
    f.strip(bandKey, [a0, o.bottom_h], [a1, o.bottom_h], d, dIn, [0, 0, 1]);
  }
  // fittings once per opening: in the band that contains the opening's bottom (or the lowest band for passages)
  const owns = (o.bottom_h >= band.h0 - 1e-6 && o.bottom_h < band.h1) || (isLowestBand && o.bottom_h < band.h0);
  if (!owns) return;
  const lod = opt.lod;
  const kind = o.kind;
  if (isWindowLike(kind)) {
    const fd = d - 0.14; // frame plane
    const fw = kind === 'cellar_window' ? 0.05 : 0.07;
    // frame: jambs + head + bottom rail
    f.box(FRAME, a0, a0 + fw, fd - 0.06, fd, o.bottom_h, spring, false);
    f.box(FRAME, a1 - fw, a1, fd - 0.06, fd, o.bottom_h, spring, false);
    f.box(FRAME, a0, a1, fd - 0.06, fd, o.bottom_h, o.bottom_h + fw, false);
    if (rise === 0) f.box(FRAME, a0, a1, fd - 0.06, fd, o.top_h - fw, o.top_h, false);
    else {
      const c = archCurve(a0 + fw * 0.5, a1 - fw * 0.5, o.top_h - fw * 0.5, head, 8);
      for (let i = 1; i < c.length; i++) {
        const p = c[i - 1];
        const q = c[i];
        f.strip(FRAME, p, q, fd, fd - 0.06, [0, 0, -1]);
        f.poly(FRAME, [p, q, [q[0], q[1] - fw], [p[0], p[1] - fw]], fd);
      }
      f.box(FRAME, a0, a1, fd - 0.06, fd, spring - fw / 2, spring + fw / 2, false); // transom at the springer
    }
    // glass
    const gd = fd - 0.03;
    const glassPts: [number, number][] = rise > 0 ? [[a0, o.bottom_h], [a1, o.bottom_h], ...archCurve(a0, a1, o.top_h, head, 10).reverse()] : [
      [a0, o.bottom_h],
      [a1, o.bottom_h],
      [a1, o.top_h],
      [a0, o.top_h],
    ];
    f.poly(GLASS, glassPts, gd);
    if (opt.backing) f.poly(BACKING, glassPts, d - revealDepth + 0.02);
    // glazing bars
    const bw = 0.035;
    const h = spring - o.bottom_h;
    if (kind !== 'cellar_window' && kind !== 'oculus') {
      if (lod >= 2) {
        const { cols, rows } = glazingGrid(o.width, h);
        for (let i = 1; i < cols; i++) {
          const x = a0 + (o.width * i) / cols;
          const w = i === cols / 2 ? 0.05 : bw;
          f.box(FRAME, x - w / 2, x + w / 2, fd - 0.05, fd - 0.01, o.bottom_h, spring, false);
        }
        for (let j = 1; j < rows; j++) {
          const y = o.bottom_h + (h * j) / rows;
          f.box(FRAME, a0, a1, fd - 0.05, fd - 0.01, y - bw / 2, y + bw / 2, false);
        }
      } else {
        f.box(FRAME, o.a - 0.03, o.a + 0.03, fd - 0.05, fd - 0.01, o.bottom_h, spring, false);
        const y = o.bottom_h + h * 0.68;
        if (h > 1.2) f.box(FRAME, a0, a1, fd - 0.05, fd - 0.01, y - 0.03, y + 0.03, false);
      }
    }
  } else if (kind === 'portal' || kind === 'door' || kind === 'double_door' || kind === 'carriage_gate') {
    const dd = d - Math.min(0.35, revealDepth * 0.4);
    const leafH = spring - o.bottom_h;
    const open = lod >= 2 && (kind === 'portal' || kind === 'door' || kind === 'double_door');
    if (open) {
      // leaves opened inwards against the reveal (walkable)
      const lw = o.width / 2;
      f.box(DOOR, a0, a0 + 0.08, dd - lw, dd, o.bottom_h, spring, false);
      f.box(DOOR, a1 - 0.08, a1, dd - lw, dd, o.bottom_h, spring, false);
    } else {
      f.box(DOOR, a0, a1, dd - 0.08, dd, o.bottom_h, spring, false);
      // panels
      for (const x of [a0 + o.width * 0.25, a0 + o.width * 0.75]) {
        f.box(DOOR, x - o.width * 0.18, x + o.width * 0.18, dd, dd + 0.025, o.bottom_h + 0.25, o.bottom_h + leafH * 0.42, false);
        f.box(DOOR, x - o.width * 0.18, x + o.width * 0.18, dd, dd + 0.025, o.bottom_h + leafH * 0.5, spring - 0.25, false);
      }
      f.box(DOOR, o.a - 0.02, o.a + 0.02, dd, dd + 0.03, o.bottom_h, spring, false);
    }
    if (rise > 0) {
      // fanlight
      const c = archCurve(a0, a1, o.top_h, head, 10);
      f.poly(GLASS, [[a0, spring], [a1, spring], ...c.slice().reverse()], dd - 0.02);
      f.box(FRAME, a0, a1, dd - 0.08, dd, spring - 0.05, spring + 0.05, false);
      for (let i = 1; i < 4; i++) {
        const ang = (Math.PI * i) / 4;
        const r = Math.min(o.width / 2, rise);
        const x = o.a - Math.cos(ang) * r * 0.95;
        f.box(FRAME, Math.min(o.a, x) - 0.02, Math.max(o.a, x) + 0.02, dd - 0.06, dd - 0.02, spring, spring + 0.04, false);
      }
    }
  }
  // surrounds (members) on palace-type facades
  if (kind === 'cellar_window' || kind === 'durchfahrt' || kind === 'stall_window') {
    if (kind === 'cellar_window') {
      // iron bars
      for (let i = 1; i < 4; i++) {
        const x = a0 + (o.width * i) / 4;
        f.box(IRON, x - 0.012, x + 0.012, d - 0.1, d - 0.07, o.bottom_h, o.top_h, false);
      }
    }
    if (kind === 'durchfahrt') {
      // stone voussoir band
      const sw = 0.35;
      f.box(opt.members, a0 - sw, a0, d, d + 0.05, Math.max(o.bottom_h, opt.plinthTop), spring, true);
      f.box(opt.members, a1, a1 + sw, d, d + 0.05, Math.max(o.bottom_h, opt.plinthTop), spring, true);
      archBand(f, opt.members, a0, a1, o.top_h, head, sw, d, 0.05, lod >= 1);
    }
    return;
  }
  if (kind === 'dormer' || kind === 'oculus') return;
  const sf = ARTICULATION.surround.face;
  const pj = ARTICULATION.surround.projection;
  const m = opt.members;
  const jb = Math.max(o.bottom_h, band.h0);
  f.box(m, a0 - sf, a0, d, d + pj, jb, spring, true);
  f.box(m, a1, a1 + sf, d, d + pj, jb, spring, true);
  if (rise === 0) f.box(m, a0 - sf, a1 + sf, d, d + pj, o.top_h, o.top_h + sf, true);
  else archBand(f, m, a0, a1, o.top_h, head, sf, d, pj, true);
  const crown = o.top_h + sf;
  if (lod >= 2 && rise > 0) f.box(m, o.a - 0.14, o.a + 0.14, d, d + pj + 0.05, o.top_h - 0.05, crown + 0.08, true); // keystone
  // sill (Sohlbank)
  if (kind === 'window') f.box(m, a0 - sf - 0.06, a1 + sf + 0.06, d - 0.02, d + 0.13, o.bottom_h - 0.13, o.bottom_h, true);
  // Verdachung (cornice cap) on the piano nobile
  const nobile = (opt.cls === 'CDL' || opt.cls === 'WING2' || opt.cls === 'ORANG') && Math.abs(o.bottom_h - opt.upperRowFloor) < 2.5 && o.bottom_h > opt.upperRowFloor - 0.2;
  if (nobile && (kind === 'window' || kind === 'porte_fenetre')) {
    const top = rise > 0 ? crown + 0.04 : crown;
    f.box(m, a0 - sf - 0.08, a1 + sf + 0.08, d, d + pj + 0.08, top, top + 0.07, true);
    f.box(m, a0 - sf - 0.12, a1 + sf + 0.12, d, d + pj + 0.16, top + 0.07, top + 0.16, true);
  }
  // balconet in front of upper portes-fenêtres (iron railing on a stone slab) [I]
  if (kind === 'porte_fenetre' && o.bottom_h > opt.plinthTop + 1.5) {
    const bd = 0.75;
    f.box(m, a0 - sf - 0.1, a1 + sf + 0.1, d, d + bd, o.bottom_h - 0.18, o.bottom_h, false);
    f.box(IRON, a0 - sf - 0.05, a1 + sf + 0.05, d + bd - 0.06, d + bd - 0.02, o.bottom_h + 0.9, o.bottom_h + 0.95, false);
    for (let x = a0 - sf; x <= a1 + sf + 1e-6; x += 0.12) f.box(IRON, x - 0.012, x + 0.012, d + bd - 0.055, d + bd - 0.03, o.bottom_h, o.bottom_h + 0.9, false);
    for (const x of [a0 - sf - 0.05, a1 + sf + 0.03]) f.box(IRON, x, x + 0.025, d, d + bd - 0.02, o.bottom_h + 0.9, o.bottom_h + 0.95, false);
  }
  // shutters (open, against the wall)
  if (opt.shutters && kind === 'window' && o.bottom_h > opt.plinthTop - 0.01) {
    const lw = o.width / 2;
    const h0 = o.bottom_h;
    const h1 = spring;
    f.box(opt.shutters, a0 - sf - 0.02 - lw, a0 - sf - 0.02, d + 0.01, d + 0.05, h0, h1, true);
    f.box(opt.shutters, a1 + sf + 0.02, a1 + sf + 0.02 + lw, d + 0.01, d + 0.05, h0, h1, true);
    if (lod >= 2) {
      for (let y = h0 + 0.12; y < h1 - 0.1; y += 0.12) {
        f.box(opt.shutters, a0 - sf - lw + 0.03, a0 - sf - 0.05, d + 0.05, d + 0.065, y, y + 0.03, true);
        f.box(opt.shutters, a1 + sf + 0.05, a1 + sf + lw - 0.03, d + 0.05, d + 0.065, y, y + 0.03, true);
      }
    }
  }
}

/** Flat arch band of width w around an arched head, projecting pj. */
function archBand(f: Face, k: MatKey, a0: number, a1: number, top: number, head: HeadForm, w: number, d: number, pj: number, _sides: boolean): void {
  const inner = archCurve(a0, a1, top, head, 10);
  const outer = archCurve(a0 - w, a1 + w, top + w, head === 'round' ? 'round' : head, 10);
  // match the outer springer height to the inner one for segmental heads
  for (let i = 1; i < inner.length; i++) {
    const p0 = inner[i - 1];
    const p1 = inner[i];
    const q0 = outer[i - 1];
    const q1 = outer[i];
    f.poly(k, [p0, q0, q1, p1], d + pj);
    f.strip(k, q0, q1, d, d + pj, [0, 0, 1]);
  }
  f.strip(k, outer[0], inner[0], d, d + pj, [0, 0, -1]);
  f.strip(k, inner[inner.length - 1], outer[outer.length - 1], d, d + pj, [0, 0, -1]);
}

/** Freitreppe in front of a portal: `steps` steps from the court level up to the portal threshold. */
function freitreppe(f: Face, k: MatKey, o: FacadeOpening, base: number, d: number): void {
  const n = Math.max(1, o.steps ?? 0);
  const rise = (o.bottom_h - base) / n;
  if (rise <= 0.02) return;
  const tread = 0.4;
  const w = o.width + 1.2;
  for (let i = 1; i <= n; i++) {
    const top = base + i * rise;
    const depth = (n - i + 1) * tread + (i === n ? 0.3 : 0);
    f.box(k, o.a - w / 2, o.a + w / 2, d - 0.1, d + depth, base - 0.3, top, true);
  }
  // cheek walls (Wangen)
  const depth = n * tread + 0.3;
  f.box(k, o.a - w / 2 - 0.35, o.a - w / 2, d - 0.1, d + depth, base - 0.3, o.bottom_h + 0.15, true);
  f.box(k, o.a + w / 2, o.a + w / 2 + 0.35, d - 0.1, d + depth, base - 0.3, o.bottom_h + 0.15, true);
}

/** One wall segment (plane at offset s.d): plinth band + wall band with the openings cut and furnished. */
function wallSegment(f: Face, s: Segment, mine: FacadeOpening[], opt: FacadeOptions): void {
  const pp = ARTICULATION.plinthProjection;
  const T = opt.thickness;
  const holes = mine.map(holeOf);
  const bands: { key: MatKey; band: Rect; d: number }[] = [
    { key: opt.plinth, band: { a0: s.a0, a1: s.a1, h0: opt.plinthBottom, h1: opt.plinthTop }, d: s.d + pp },
    { key: opt.wall, band: { a0: s.a0, a1: s.a1, h0: opt.plinthTop, h1: opt.eaves }, d: s.d },
  ];
  bands.forEach(({ key, band, d }, bi) => {
    if (band.h1 - band.h0 < 0.01) return;
    for (const p of wallPieces(band, holes)) f.rect(key, p.a0, p.a1, p.h0, p.h1, d);
    for (const o of mine) {
      if (o.top_h <= band.h0 || o.bottom_h >= band.h1) continue;
      const depth = o.kind === 'durchfahrt' ? opt.depth + s.d + 0.2 : T + (d - s.d);
      furnishOpening(f, o, d, key, band, opt, depth, bi === 0);
    }
  });
  // plinth top ledge (horizontal strip between the projecting plinth and the wall), open over Durchfahrten that
  // pass through the plinth (else a thin stone strip hangs across the arch and stops the walker)
  const cuts = mine.filter((o) => o.bottom_h < opt.plinthTop && o.top_h > opt.plinthTop).map(holeOf);
  let a = s.a0;
  for (const c of [...cuts.sort((x, y) => x.a0 - y.a0), { a0: s.a1, a1: s.a1 }]) {
    const b = Math.min(s.a1, c.a0);
    if (b > a + 1e-4) f.g.quadFacing(opt.plinth, f.P(a, opt.plinthTop, s.d), f.P(b, opt.plinthTop, s.d), f.P(b, opt.plinthTop, s.d + pp), f.P(a, opt.plinthTop, s.d + pp), [0, 0, 1]);
    a = Math.max(a, c.a1);
  }
}

/** Facade side: segments, bands, openings, returns, lisenen, steps. */
function buildSide(g: GeoBuilder, L: BuildingLayout, side: 'garden' | 'end_b' | 'court' | 'end_a', openings: FacadeOpening[], opt: FacadeOptions): void {
  const sd = L.frame.sides[side];
  const lay = L.sides[side];
  const f = new Face(g, sd);
  const len = sd.length;
  const segs: Segment[] = [];
  let a = 0;
  for (const r of [...lay.risalits].sort((x, y) => x.a0 - y.a0)) {
    const r0 = Math.max(0, r.a0);
    const r1 = Math.min(len, r.a1);
    if (r0 > a + 1e-4) segs.push({ a0: a, a1: r0, d: 0 });
    segs.push({ a0: r0, a1: r1, d: r.risalit.projection ?? ARTICULATION.risalitProjection });
    a = r1;
  }
  if (len > a + 1e-4) segs.push({ a0: a, a1: len, d: 0 });
  const pp = ARTICULATION.plinthProjection;
  const ops = openings.filter((o) => o.side === side);
  for (const s of segs) {
    const mine = ops.filter((o) => o.a >= s.a0 && o.a <= s.a1);
    wallSegment(f, s, mine, opt);
    // returns at segment ends (risalit sides) - from the base plane out to the segment plane
    if (s.d > 0) {
      for (const [ae, dir] of [
        [s.a0, -1],
        [s.a1, 1],
      ] as [number, number][]) {
        f.strip(opt.wall, [ae, opt.plinthTop], [ae, opt.eaves], 0, s.d, f.dirA(dir));
        f.strip(opt.plinth, [ae, opt.plinthBottom], [ae, opt.plinthTop], 0, s.d + pp, f.dirA(dir));
        // plinth top ledge across the return
      }
      // corner strips on the risalit edges
      lisene(f, opt, s.a0, s.a0 + 0.6, s.d, mine);
      lisene(f, opt, s.a1 - 0.6, s.a1, s.d, mine);
    }
  }
  // corner Lisenen at the side ends (on the base plane unless a risalit covers the corner)
  const lw = ARTICULATION.ecklisene.width;
  const base = segs.filter((s) => s.d === 0);
  if (base.some((s) => s.a0 <= 1e-4)) lisene(f, opt, 0, lw, 0, ops);
  if (base.some((s) => s.a1 >= len - 1e-4)) lisene(f, opt, len - lw, len, 0, ops);
  // Freitreppen (portals) and perrons (doors with steps), porticos
  for (const o of ops) if ((o.kind === 'portal' || o.kind === 'door') && (o.steps ?? 0) > 0) {
    const s = segs.find((x) => o.a >= x.a0 && o.a <= x.a1);
    const d = (s?.d ?? 0) + pp;
    const base = o.grade_h ?? L.stack.base_h;
    if (o.portico) portico(f, opt, o, base, d);
    else freitreppe(f, opt.plinth, o, base, d);
  }
}

/**
 * Columned portico with balcony [D LC 1790 B02 W head; dims N grammar PORTICO]: podium at threshold level,
 * `columns` Tuscan columns carrying an entablature and a balustraded balcony, and a broad Freitreppe in front.
 */
function portico(f: Face, opt: FacadeOptions, o: FacadeOpening, base: number, d: number): void {
  const p = o.portico!;
  const cw = PORTICO.columnDiameter;
  const span = o.width + 2 * cw + PORTICO.stairWidthExtra * 0.5; // column axis span
  const e0 = o.a - span / 2 - cw;
  const e1 = o.a + span / 2 + cw;
  const dd = d + p.depth; // front of the podium
  const top = o.top_h + 0.3; // column top
  const stone = opt.plinth;
  // podium
  f.box(stone, e0, e1, d - 0.1, dd, base - 0.3, o.bottom_h, true);
  // Freitreppe in front of the podium, broader than the portico
  const n = Math.max(1, o.steps ?? 0);
  const rise = (o.bottom_h - base) / n;
  const w = e1 - e0 + PORTICO.stairWidthExtra;
  const tread = 0.4;
  if (rise > 0.02) {
    for (let i = 1; i <= n; i++) {
      const depth = (n - i + 1) * tread;
      f.box(stone, o.a - w / 2, o.a + w / 2, dd - 0.05, dd + depth, base - 0.3, base + i * rise, true);
    }
    const depth = n * tread;
    f.box(stone, o.a - w / 2 - 0.4, o.a - w / 2, d - 0.1, dd + depth, base - 0.3, o.bottom_h + 0.2, true);
    f.box(stone, o.a + w / 2, o.a + w / 2 + 0.4, d - 0.1, dd + depth, base - 0.3, o.bottom_h + 0.2, true);
  }
  // columns (octagonal shafts with base and capital) on the podium front, pilasters against the wall
  const m = opt.members;
  for (let i = 0; i < p.columns; i++) {
    const c = o.a - span / 2 + (span * i) / Math.max(1, p.columns - 1);
    const t = dd - cw / 2 - 0.15;
    const ring = (r: number): ST[] => Array.from({ length: 10 }, (_, k): ST => {
      const ang = ((k + 0.5) / 10) * Math.PI * 2;
      const q = f.P(c + r * Math.cos(ang), 0, t + r * Math.sin(ang));
      return [q[0], q[1]];
    });
    const shaft = ring(cw / 2);
    for (let k = 0; k < shaft.length; k++) {
      const a = shaft[k];
      const b = shaft[(k + 1) % shaft.length];
      const top0 = ring(cw * 0.42);
      const cc = f.P(c, 0, t);
      const out: P3 = [(a[0] + b[0]) / 2 - cc[0], (a[1] + b[1]) / 2 - cc[1], 0];
      f.g.quadFacing(opt.wall, [a[0], a[1], o.bottom_h + 0.3], [b[0], b[1], o.bottom_h + 0.3], [top0[(k + 1) % 10][0], top0[(k + 1) % 10][1], top - 0.3], [top0[k][0], top0[k][1], top - 0.3], out);
    }
    f.box(m, c - cw * 0.65, c + cw * 0.65, t - cw * 0.65, t + cw * 0.65, o.bottom_h, o.bottom_h + 0.3, false); // plinth + torus
    f.box(m, c - cw * 0.6, c + cw * 0.6, t - cw * 0.6, t + cw * 0.6, top - 0.3, top, false); // capital (abacus)
    f.box(m, c - cw * 0.45, c + cw * 0.45, d, d + 0.12, o.bottom_h, top, true); // respond pilaster on the wall
  }
  // entablature (architrave, frieze, cornice) across the portico depth
  const ent = PORTICO.entablature;
  f.box(m, e0, e1, d - 0.05, dd, top, top + ent * 0.6, true);
  f.box(m, e0 - 0.15, e1 + 0.15, d - 0.05, dd + 0.15, top + ent * 0.6, top + ent, true);
  if (p.balcony) {
    // balustrade on the balcony (piers at the corners, balusters between, handrail)
    const b0 = top + ent;
    const h = PORTICO.balustrade;
    const bal = (x0: number, x1: number, y0: number, y1: number) => f.box(m, x0, x1, y0, y1, b0, b0 + h, false);
    bal(e0 - 0.1, e0 + 0.3, dd - 0.25, dd + 0.15);
    bal(e1 - 0.3, e1 + 0.1, dd - 0.25, dd + 0.15);
    for (let x = e0 + 0.45; x < e1 - 0.4; x += 0.3) f.box(m, x - 0.07, x + 0.07, dd - 0.12, dd + 0.02, b0 + 0.12, b0 + h - 0.12, false);
    f.box(m, e0 - 0.1, e1 + 0.1, dd - 0.2, dd + 0.08, b0, b0 + 0.12, false);
    f.box(m, e0 - 0.1, e1 + 0.1, dd - 0.22, dd + 0.1, b0 + h - 0.12, b0 + h, false);
    for (const [x0, x1] of [[e0 - 0.1, e0 + 0.15], [e1 - 0.15, e1 + 0.1]]) {
      f.box(m, x0, x1, d, dd, b0, b0 + 0.12, false);
      f.box(m, x0, x1, d, dd, b0 + h - 0.12, b0 + h, false);
    }
  }
  void p.tag;
}

function lisene(f: Face, opt: FacadeOptions, a0: number, a1: number, d: number, ops: FacadeOpening[]): void {
  // shrink away from openings (and their surrounds)
  const sf = ARTICULATION.surround.face + 0.08;
  for (const o of ops) {
    const h = holeOf(o);
    if (h.a1 + sf > a0 && h.a0 - sf < a1 && o.top_h > opt.plinthTop) {
      if (h.a0 - sf - a0 > a1 - h.a1 - sf) a1 = Math.min(a1, h.a0 - sf);
      else a0 = Math.max(a0, h.a1 + sf);
    }
  }
  if (a1 - a0 < 0.2) return;
  const pj = ARTICULATION.ecklisene.projection;
  f.box(opt.members, a0, a1, d, d + pj, opt.plinthTop, opt.eaves - opt.corniceH * 0.6, true);
}

/** Dormer (Gaube) in the roof: front wall with window, cheeks, small roof. */
function dormer(g: GeoBuilder, L: BuildingLayout, r: RoofOpening, opt: FacadeOptions): void {
  const sd = L.frame.sides[r.side];
  const f = new Face(g, sd);
  const d = -r.inset;
  const w = r.width;
  const a0 = r.a - w / 2 - 0.22;
  const a1 = r.a + w / 2 + 0.22;
  const hb = r.bottom_h - 0.25;
  const rise = archRise(r.head === 'triangular' ? 'straight' : r.head, w);
  const top = r.bottom_h + r.height + 0.18;
  const back = d - 2.2;
  const m = opt.members;
  // front wall around the window
  const hole = { a0: r.a - w / 2, a1: r.a + w / 2, h0: r.bottom_h, h1: r.bottom_h + r.height };
  for (const p of wallPieces({ a0, a1, h0: hb, h1: top }, [hole])) f.rect(m, p.a0, p.a1, p.h0, p.h1, d);
  furnishOpening(
    f,
    { kind: 'dormer', a: r.a, width: w, bottom_h: r.bottom_h, top_h: r.bottom_h + r.height, head: r.head === 'triangular' ? 'straight' : r.head },
    d,
    m,
    { a0, a1, h0: hb, h1: top },
    { ...opt, backing: true },
    0.25,
    true,
  );
  // cheeks
  f.strip(opt.roof, [a0, hb], [a0, top], d, back, f.dirA(-1));
  f.strip(opt.roof, [a1, hb], [a1, top], d, back, f.dirA(1));
  // roof: gable or segmental hood
  const ov = 0.12;
  if (r.head === 'segmental' || r.head === 'round') {
    const c = archCurve(a0 - ov, a1 + ov, top + Math.max(0.25, rise), 'segmental', 8);
    for (let i = 1; i < c.length; i++) {
      const p = c[i - 1];
      const q = c[i];
      f.strip(opt.roof, [p[0], p[1] - 0.0], [q[0], q[1]], d + ov, back, [0, 0, 1]);
    }
    f.poly(m, [[a0, top], [a1, top], ...archCurve(a0, a1, top + Math.max(0.25, rise) - 0.02, 'segmental', 8).reverse()], d + 0.01);
  } else {
    const apex = top + (a1 - a0) / 2 * Math.tan((35 * Math.PI) / 180);
    const mid = (a0 + a1) / 2;
    f.strip(opt.roof, [a0 - ov, top - 0.05], [mid, apex], d + ov, back, [0, 0, 1]);
    f.strip(opt.roof, [mid, apex], [a1 + ov, top - 0.05], d + ov, back, [0, 0, 1]);
    f.poly(m, [[a0, top], [a1, top], [mid, apex - 0.05]], d + 0.01);
  }
}

function oculus(g: GeoBuilder, L: BuildingLayout, r: RoofOpening, opt: FacadeOptions): void {
  const f = new Face(g, L.frame.sides[r.side]);
  const d = -r.inset + 0.05;
  const rad = r.width / 2;
  const cy = r.bottom_h + rad;
  const n = 12;
  const ring = (rr: number): [number, number][] => Array.from({ length: n }, (_, i) => [r.a + rr * Math.cos((i / n) * Math.PI * 2), cy + rr * Math.sin((i / n) * Math.PI * 2)]);
  const inner = ring(rad);
  const outer = ring(rad + 0.15);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.poly(opt.members, [inner[i], outer[i], outer[j], inner[j]], d);
  }
  f.poly(GLASS, inner, d - 0.05);
  f.poly(BACKING, inner, d - 0.3);
}

function chimneys(g: GeoBuilder, L: BuildingLayout, opt: FacadeOptions): void {
  const spec = L.roofSpec.chimneys;
  if (!spec || L.roof.type === 'none' || L.roof.type === 'flat' || L.roof.type === 'dome') return;
  const cs = typeof spec === 'object' ? spec : {};
  const kitchen = /küche|kitchen/i.test(L.building.function + ' ' + L.building.name_de);
  const every = cs.every_axes ?? CHIMNEY.everyAxes;
  const sec = cs.section ?? (kitchen ? CHIMNEY.kitchenSection : CHIMNEY.section);
  const above = cs.above_roof ?? (kitchen ? CHIMNEY.kitchenAbove : CHIMNEY.aboveRidge);
  const lay = L.sides.court;
  const sd = L.frame.sides.court;
  if (!lay.axes) return;
  const count = Math.max(2, Math.round(lay.axes / every));
  const ridgeInset = L.roof.ridge_inset;
  const tOff = L.roof.deck_width > 0 ? L.roof.deck_width / 4 : 0;
  const raised = L.raised;
  for (let i = 0; i < count; i++) {
    const axis = Math.round(((i + 0.5) * lay.axes) / count - 0.5);
    const bay = lay.bays[Math.max(0, Math.min(lay.axes - 1, axis))];
    const s = sd.p0[0] + sd.tangent[0] * bay.a;
    if (raised.some((r) => s > r.s0 - 1 && s < r.s1 + 1)) continue;
    if (Math.abs(s) > L.frame.length / 2 - Math.max(2, L.roofPlan.ridgeEndInset)) continue;
    for (const t of tOff ? [tOff * (i % 2 ? 1 : -1)] : [0]) {
      const base = roofHeightAtInset(L.roof, Math.min(ridgeInset, L.frame.width / 2 - Math.abs(t))) - 0.6;
      const top = L.roof.ridge_h + above;
      // sandstone stack (catalogue plinth colour) with a projecting cap and a thin cover slab [N; fix round 1]
      g.box(opt.plinth, s - sec[0] / 2, s + sec[0] / 2, t - sec[1] / 2, t + sec[1] / 2, base, top);
      g.box(opt.members, s - sec[0] / 2 - 0.07, s + sec[0] / 2 + 0.07, t - sec[1] / 2 - 0.07, t + sec[1] / 2 + 0.07, top, top + 0.12);
      g.box(opt.members, s - sec[0] / 2 + 0.05, s + sec[0] / 2 - 0.05, t - sec[1] / 2 + 0.05, t + sec[1] / 2 - 0.05, top + 0.12, top + 0.2);
    }
  }
}

/** Full LOD1/LOD2 facade set of a rectangular building (adds walls, members, roof furniture). */
function facadeOptions(L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ctx: BuildContext): FacadeOptions {
  const b = L.building;
  const lod = (ctx.lod >= 2 ? 2 : 1) as 1 | 2;
  const shutterC = normaliseColour(b.facade.shutter_colour) ?? normaliseColour(b.facade.shutters) ?? normaliseColour(String(ctx.spec.defaults?.shutters ?? '')) ?? '#7D8A78';
  const st = b.facade.shutter_type ?? (b.facade.shutters ? 'louvred' : 'none');
  const cd = corniceDims(b.cls);
  const floors = L.stack.floors;
  return {
    lod,
    thickness: WALL_THICKNESS[b.cls] ?? 0.6,
    backing: lod < 2 || b.interior === 'none',
    shutters: st === 'louvred' || st === 'plank' ? matKey('wood.shutter', shutterC) : null,
    members: pal.members,
    wall: pal.wall,
    plinth: pal.plinth,
    roof: pal.roof,
    plinthTop: info.plinthTop,
    plinthBottom: info.plinthBottom,
    eaves: info.eaves,
    corniceH: cd.height,
    depth: L.frame.width,
    cls: b.cls,
    upperRowFloor: floors[1]?.floor_h ?? Infinity,
  };
}

/** Cornice, string courses and plinth course along a CCW ring. */
function mouldings(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ring: ST[], cuts: readonly MouldingCut[] = []): void {
  const cd = corniceDims(L.building.cls);
  const e = info.eaves;
  profileRing(g, pal.members, ring, CORNICE_PROFILE.map(([d, h]): [number, number] => [d * cd.projection, e - cd.height + h * cd.height]));
  for (const fl of L.stack.floors.slice(1)) {
    if (fl.floor_h >= e - 0.5) continue;
    const H = 0.24;
    profileRing(g, pal.members, ring, [
      [0, fl.floor_h - H],
      [0.06, fl.floor_h - H],
      [0.06, fl.floor_h - 0.05],
      [0.1, fl.floor_h],
      [0, fl.floor_h],
    ]);
  }
  const pt = info.plinthTop;
  const pp = ARTICULATION.plinthProjection;
  profileRing(
    g,
    pal.plinth,
    ring,
    [
      [pp, pt - 0.2],
      [pp + 0.06, pt - 0.12],
      [pp + 0.06, pt],
      [0, pt],
    ],
    cuts,
  );
}

/**
 * Round buildings (rotunda, round pavilions): the wall is a 2n-gon; every second edge carries one window axis
 * (layoutBays + facadeOpenings on a one-axis "side"), cut as real holes with the same wall code as straight facades.
 */
export function buildRoundFacades(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ctx: BuildContext): void {
  const R = L.frame.radius ?? L.frame.width / 2;
  const bays = Math.max(6, Math.round((2 * Math.PI * R) / 3.4));
  const n = 2 * bays;
  const ring: ST[] = Array.from({ length: n }, (_, i): ST => [R * Math.cos((i / n) * Math.PI * 2), R * Math.sin((i / n) * Math.PI * 2)]);
  const edge = 2 * R * Math.sin(Math.PI / n);
  const opt = facadeOptions(L, pal, info, ctx);
  opt.shutters = null;
  const lay = layoutBays({ side: 'court', length: edge * 2, axes: 1, cls: L.building.cls });
  const ops = facadeOpenings({ cls: L.building.cls, side: 'court', layout: lay, stack: L.stack }).map((o) => ({ ...o, width: Math.min(o.width, edge * 1.6) }));
  for (let i = 0; i < n; i += 2) {
    // one straight wall per bay (chord over two polygon edges), window axis in its middle
    const p = ring[i];
    const q = ring[(i + 2) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const tan: ST = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const sd = { p0: p, tangent: tan, normal: [tan[1], -tan[0]] as ST };
    const f = new Face(g, sd);
    wallSegment(f, { a0: 0, a1: len, d: 0 }, ops.map((o) => ({ ...o, a: len / 2 })), opt);
  }
  const chordRing = ring.filter((_, i) => i % 2 === 0);
  mouldings(g, L, pal, info, chordRing);
}

export function buildFacades(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ctx: BuildContext, roofG?: GeoBuilder): void {
  const b = L.building;
  const opt = facadeOptions(L, pal, info, ctx);
  const lod = opt.lod;
  const cd = corniceDims(b.cls);
  const groundAt = (E: number, N: number) => ctx.terrain(E - 381000, 5465000 - N);
  // openings below grade are dropped (cellar windows on rising ground etc.)
  const ops = cullBuriedOpenings(L.openings, L.frame, groundAt);
  for (const side of ['garden', 'end_b', 'court', 'end_a'] as const) buildSide(g, L, side, ops, opt);
  // cornice + string courses + plinth course along the outline incl. risalits
  const ring = outlineWithRisalits(L);
  const e = info.eaves;
  const cuts: MouldingCut[] = ops
    .filter((o) => o.kind === 'durchfahrt')
    .map((o) => {
      const sd = L.frame.sides[o.side];
      return { p: [sd.p0[0] + sd.tangent[0] * o.a, sd.p0[1] + sd.tangent[1] * o.a], tan: sd.tangent, half: o.width / 2, h0: o.bottom_h, h1: o.top_h };
    });
  mouldings(g, L, pal, info, ring, cuts);
  const rg = roofG ?? g;
  // flat cap at the eaves over the whole outline (closes the risalit strips under the roof)
  rg.polygonFacing(pal.deck, ring.map((p): P3 => [p[0], p[1], e - 0.02]), [0, 0, 1]);
  // pediments on risalits
  for (const side of ['garden', 'court', 'end_a', 'end_b'] as const) {
    const sd = L.frame.sides[side];
    for (const r of L.sides[side].risalits) {
      if (!r.risalit.pediment) continue;
      const f = new Face(rg, sd);
      const d = (r.risalit.projection ?? 0.5) + cd.projection * 0.5;
      const half = (r.a1 - r.a0) / 2;
      const mid = (r.a0 + r.a1) / 2;
      const apex = e + half * Math.tan((ARTICULATION.pedimentPitch * Math.PI) / 180);
      f.poly(pal.wall, [[r.a0, e], [r.a1, e], [mid, apex]], d - 0.15);
      f.strip(pal.roof, [r.a0 - 0.3, e + 0.1], [mid, apex + 0.3], d + 0.1, -3, [0, 0, 1]);
      f.strip(pal.roof, [mid, apex + 0.3], [r.a1 + 0.3, e + 0.1], d + 0.1, -3, [0, 0, 1]);
      f.strip(pal.members, [r.a0 - 0.3, e + 0.1], [mid, apex + 0.3], d + 0.1, d - 0.15, [0, 0, -1]);
      f.strip(pal.members, [mid, apex + 0.3], [r.a1 + 0.3, e + 0.1], d + 0.1, d - 0.15, [0, 0, -1]);
    }
  }
  // roof furniture
  for (const r of L.roofOpenings) {
    if (r.kind === 'dormer') dormer(rg, L, r, opt);
    else oculus(rg, L, r, opt);
  }
  chimneys(rg, L, opt);
  // lightning rods (LOD2)
  if (lod >= 2 && (b.facade.lightning_rods ?? ctx.spec.defaults?.lightning_rods)) {
    const n = Math.max(2, Math.round(L.roofPlan.ridgeLength / 15));
    for (let i = 0; i < n; i++) {
      const s = -L.roofPlan.ridgeLength / 2 + (L.roofPlan.ridgeLength * (i + 0.5)) / n;
      rg.box(IRON, s - 0.015, s + 0.015, -0.015, 0.015, L.roof.ridge_h, L.roof.ridge_h + 2.2);
    }
  }
}

/**
 * LOD1 / LOD2 facades of rectangular buildings: real wall geometry with holes.
 *
 * Per side the wall is split into segments (base plane and risalit planes, with return faces); each segment has a
 * plinth band (red sandstone, projecting) and a wall band (render). Openings from `layoutBuilding()` are cut with
 * the slab decomposition in cut.ts; arched heads get spandrels, reveals run through the wall thickness, frames and
 * glass sit 0.12-0.2 m behind the face. Members (surrounds, sills, Verdachungen, corner strips, cornices, string
 * courses) are separate pieces in the members colour. Dormers, oculi and chimneys sit on the roof.
 *
 * LOD1: casement frames with the meeting stile and (windows >= 2.6 m) the transom, closed dark backing behind the glass,
 *       shutters, Freitreppen.
 * LOD2: full glazing bars (Sprossen) after the GLAZING class table (KB-I16), crown-glass panes with a slight per-pane
 *       normal jitter, open portal leaves, fanlights, keystones; no backing (interiors behind).
 * KB-I17 members: flat 0.20 m surrounds, Verdachungen only where the layout marks `hood`, balconets only where it marks
 * `balcony`, corner strips and risalit Lisenen after `L.members`, one palace cornice, string courses only on the CdL.
 * KB-I19/I20: every vertex carries a baked shade (exterior/shade.ts): AO in reveals, under cornices and soffits, at the
 * wall foot and dormer cheeks; limewash grime under sills and the cornice; per-block sandstone hues on plinths, steps
 * and portal dressings (aligned to the ashlar texture's joints).
 */
import type { BuildContext } from '../context.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { type FacadeOpening, type RoofOpening, cullBuriedOpenings, facadeOpenings, freitreppePlan, layoutBays } from '../layout/facade.ts';
import type { FrameSide } from '../layout/footprint.ts';
import { resolveCourtToward } from '../layout/site.ts';
import { ARTICULATION, BALCONY, CASEMENT, FACHWERK, MAIN_PERRON, PASSAGE_PORTICO, PORTAL_FRAME, PORTICO, WALL_THICKNESS, glazingLayout } from '../layout/grammar.ts';
import { fachwerkStoreys } from '../layout/fachwerk.ts';
import type { WindowRow } from '../layout/grammar.ts';
import type { HeadForm, ST } from '../spec.ts';
import { normaliseColour } from '../materials/index.ts';
import { hashString, mulberry32 } from '../layout/geom.ts';
import * as THREE from 'three';
import { type GeoBuilder, type MatKey, type P3, type ShadeFn, matKey } from './builder.ts';
import { type Rect, archCurve, archRise, archSpandrels, wallPieces } from './cut.ts';
import { AO, CORNICE_AO, type WallZones, ashlarBlocks, blockTint, passageAO, plinthAO, REVEAL_GRIME, revealAO, revealCornerAO, sillGrime, wallAO, wallBreaks, wallGrime } from './shade.ts';
import { type ExteriorInfo, type ExteriorPalette, offsetRing } from './index.ts';
import { roofHardware } from './hardware.ts';
import { chimneyStations } from './hardwarePlan.ts';

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
  /** Glazing bar: front + the two long sides only (ends and back sit in the frame / against the glass). */
  bar(k: MatKey, a0: number, a1: number, d0: number, d1: number, h0: number, h1: number, vertical: boolean): void {
    this.g.orientedBox(k, this.sd.p0, this.sd.tangent, this.sd.normal, a0, a1, d0, d1, h0, h1, true, vertical ? 'caps' : 'ends');
  }
  /** Quad between two (a, h) points extruded from d0 to d1, facing `dir`; optional AO at d0 and at d1. */
  strip(k: MatKey, p: [number, number], q: [number, number], d0: number, d1: number, dir: P3, ao?: [number, number]): void {
    this.g.quadFacing(k, this.P(p[0], p[1], d0), this.P(q[0], q[1], d0), this.P(q[0], q[1], d1), this.P(p[0], p[1], d1), dir, ao ? [ao[0], ao[0], ao[1], ao[1]] : undefined);
  }
  /** Texture u (metres) of facade position a on this face (builder UV axes: u = −Nt·s + Ns·t = u0 + a). */
  get u0(): number {
    const { p0, tangent: T } = this.sd;
    return T[0] * p0[0] + T[1] * p0[1];
  }
  /** Object-space outward normal and tangent (building group: X = s, Y = h, Z = −t). */
  objN(): THREE.Vector3 {
    return new THREE.Vector3(this.sd.normal[0], 0, -this.sd.normal[1]);
  }
  objT(): THREE.Vector3 {
    return new THREE.Vector3(this.sd.tangent[0], 0, -this.sd.tangent[1]);
  }
}

/**
 * Reveal strip (jamb, soffit or sill) from the facade plane d to dIn with baked AO (KB-I20): darkening from the facade
 * edge to the joinery plane `jd` m in, constant behind it; deep passages darken with depth (passageAO). The reveal AO is
 * multiplied by the AO of the wall zone it is cut into (`zone(h)`: plinthAO in the plinth band, wallAO in the render
 * band), so a reveal is never lighter than the wall around it (wave-3 review: cellar-window reveals read as bright
 * squares in the dark wall foot). `tint` < 1 darkens the albedo (weathered stone reveals in the plinth, REVEAL_GRIME).
 */
function revealStrip(f: Face, k: MatKey, p: [number, number], q: [number, number], d: number, dIn: number, dir: P3, face: 'jamb' | 'soffit' | 'sill', jd: number, zone: (h: number) => number, tint = 1): void {
  if (tint < 1) {
    f.g.withShade(
      (_p, _ny, out) => {
        out[0] *= tint;
        out[1] *= tint;
        out[2] *= tint;
      },
      () => revealStrip(f, k, p, q, d, dIn, dir, face, jd, zone),
    );
    return;
  }
  const zp = zone(p[1]);
  const zq = zone(q[1]);
  const strip = (d0: number, d1: number, ao0: number, ao1: number) =>
    f.g.quadFacing(k, f.P(p[0], p[1], d0), f.P(q[0], q[1], d0), f.P(q[0], q[1], d1), f.P(p[0], p[1], d1), dir, revealCornerAO(ao0, ao1, zp, zq));
  const depth = d - dIn;
  if (depth > AO.passage.depth + 0.3) {
    const dm = d - AO.passage.depth;
    strip(d, dm, passageAO(0), passageAO(AO.passage.depth));
    strip(dm, dIn, passageAO(AO.passage.depth), passageAO(depth));
    return;
  }
  const j = Math.min(jd, depth);
  if (depth - j < 0.02) {
    strip(d, dIn, revealAO(0, face), revealAO(1, face));
    return;
  }
  strip(d, d - j, revealAO(0, face), revealAO(1, face));
  strip(d - j, dIn, revealAO(1, face), revealAO(1, face));
}

/** Shade provider: joinery and glass sitting in a reveal (KB-I20). */
const joineryShade: ShadeFn = (_p, _ny, out) => {
  out[3] = Math.min(out[3], AO.joinery);
};
const glassShade: ShadeFn = (_p, _ny, out) => {
  out[3] = AO.glass;
};

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

export function profileRing(g: GeoBuilder, k: MatKey, ring: ST[], prof: [number, number][], cuts: readonly MouldingCut[] = [], ao?: readonly [number, number][]): void {
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
      const sa = ao?.[j - 1];
      for (const [u0, u1] of spans) {
        const a0 = lerp(rings[j - 1], i, n, u0);
        const a1 = lerp(rings[j - 1], i, n, u1);
        const b0 = lerp(rings[j], i, n, u0);
        const b1 = lerp(rings[j], i, n, u1);
        g.quad(k, [a0[0], a0[1], h0], [a1[0], a1[1], h0], [b1[0], b1[1], h1], [b0[0], b0[1], h1], sa ? [sa[0], sa[0], sa[1], sa[1]] : undefined);
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


export interface FacadeOptions {
  lod: 1 | 2;
  thickness: number;
  backing: boolean;
  shutters: MatKey | null;
  members: MatKey;
  /** KB-I15: exposed sandstone dressings at portals, Durchfahrten and porticos (palette().stone). */
  stone: MatKey;
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
  /** KB-I20 wall zones (grade, plinth top, cornice foot) for the baked AO and grime. */
  zones: WallZones;
  /** KB-I19: building id + seed for the per-block stone hues; plinth / stone base colours. */
  buildingId: string;
  seed: number;
  plinthColour: string;
  stoneColour: string;
  /** Lisenen rules (L.members, KB-I17). */
  cornerLisenen: boolean;
  risalitLisenen: 'all' | 'portico';
  /** KB-I28: window frame / glazing bar and door leaf materials (facade.joinery_colour, default wood.frame / wood.door). */
  joinery: MatKey;
  door: MatKey;
  /** KB-I28: storeys whose windows get no shutters (facade.shutters_omit_storeys). */
  shutterOmit: number[];
  /** KB-I21: Fachwerk storeys (layout/fachwerk.ts): 0.30 m wall and shallow reveal on their openings. */
  fachwerk: number[];
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
  o: { kind: FacadeOpening['kind']; a: number; width: number; bottom_h: number; top_h: number; head: HeadForm; storey?: number; row?: WindowRow | null; hood?: boolean; balcony?: boolean; portico?: unknown },
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
  // reveals: jambs, soffit / arch soffit, sill (each clipped to the band), with baked AO (KB-I20)
  const dIn = d - revealDepth;
  // KB-I20 fix (wave-3 review): reveals inherit the AO of the band they cut (plinth foot / wall zones)
  const zone = (h: number) => (isLowestBand ? plinthAO(h, opt.zones) : wallAO(h, opt.zones));
  // stone reveals in the plinth (cellar windows, passage feet): weathered, dirt-darkened sandstone [I]; it also stands in
  // for the sub-texel self-shadow the shadow map misses on a sunlit jamb (wave-3 review)
  const rt = isLowestBand ? REVEAL_GRIME.stone : 1;
  const isDoor = o.kind === 'portal' || o.kind === 'door' || o.kind === 'double_door' || o.kind === 'carriage_gate';
  const fwk = o.storey !== undefined && opt.fachwerk.includes(o.storey);
  const jd = isDoor ? Math.min(0.35, revealDepth * 0.4) : o.kind === 'cellar_window' ? 0.1 : fwk ? FACHWERK.reveal : 0.17;
  if (hb1 > hb0) {
    revealStrip(f, bandKey, [a0, hb0], [a0, hb1], d, dIn, f.dirA(1), 'jamb', jd, zone, rt);
    revealStrip(f, bandKey, [a1, hb0], [a1, hb1], d, dIn, f.dirA(-1), 'jamb', jd, zone, rt);
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
      revealStrip(f, bandKey, p, q, d, dIn, [(-mx / l) * T[0], (-mx / l) * T[1], -my / l], 'soffit', jd, zone, rt);
    }
  } else if (rise === 0 && o.top_h <= band.h1 + 1e-6 && o.top_h > band.h0) {
    revealStrip(f, bandKey, [a0, o.top_h], [a1, o.top_h], d, dIn, [0, 0, -1], 'soffit', jd, zone, rt);
  }
  if (o.bottom_h >= band.h0 - 1e-6 && o.bottom_h < band.h1) {
    const door = o.kind === 'portal' || o.kind === 'door' || o.kind === 'double_door' || o.kind === 'porte_fenetre' || o.kind === 'carriage_gate';
    if (door) {
      // stone threshold slab, running 0.8 m past the inner wall face (under the interior floor) - no walk gap. Its front
      // stops 1 cm behind the facade plane: flush, it z-fought with the wall band below and showed red sandstone flecks
      // under upper-storey portes-fenêtres on rendered fronts (wave-6 review: KB-B10 court and ends, palace balconets)
      stoneBox(f, opt, `thr${o.a.toFixed(1)}`, opt.plinth, a0, a1, dIn - 0.8, d - 0.01, o.bottom_h - 0.3, o.bottom_h - 0.005, false);
    }
    revealStrip(f, bandKey, [a0, o.bottom_h], [a1, o.bottom_h], d, dIn, [0, 0, 1], 'sill', jd, zone, rt);
  }
  // fittings once per opening: in the band that contains the opening's bottom (or the lowest band for passages)
  const owns = (o.bottom_h >= band.h0 - 1e-6 && o.bottom_h < band.h1) || (isLowestBand && o.bottom_h < band.h0);
  if (!owns) return;
  const lod = opt.lod;
  const kind = o.kind;
  if (isWindowLike(kind)) f.g.withShade(joineryShade, () => windowJoinery(f, o, d, revealDepth, opt, head, rise, spring));
  else if (kind === 'portal' || kind === 'door' || kind === 'double_door' || kind === 'carriage_gate') f.g.withShade(joineryShade, () => {
    const dd = d - Math.min(0.35, revealDepth * 0.4);
    const leafH = spring - o.bottom_h;
    const open = lod >= 2 && (kind === 'portal' || kind === 'door' || kind === 'double_door');
    if (open) {
      // leaves opened inwards against the reveal (walkable)
      const lw = o.width / 2;
      f.box(opt.door, a0, a0 + 0.08, dd - lw, dd, o.bottom_h, spring, false);
      f.box(opt.door, a1 - 0.08, a1, dd - lw, dd, o.bottom_h, spring, false);
    } else {
      f.box(opt.door, a0, a1, dd - 0.08, dd, o.bottom_h, spring, false);
      // panels
      for (const x of [a0 + o.width * 0.25, a0 + o.width * 0.75]) {
        f.box(opt.door, x - o.width * 0.18, x + o.width * 0.18, dd, dd + 0.025, o.bottom_h + 0.25, o.bottom_h + leafH * 0.42, false);
        f.box(opt.door, x - o.width * 0.18, x + o.width * 0.18, dd, dd + 0.025, o.bottom_h + leafH * 0.5, spring - 0.25, false);
      }
      f.box(opt.door, o.a - 0.02, o.a + 0.02, dd, dd + 0.03, o.bottom_h, spring, false);
    }
    if (rise > 0) {
      // fanlight
      const c = archCurve(a0, a1, o.top_h, head, 10);
      f.poly(GLASS, [[a0, spring], [a1, spring], ...c.slice().reverse()], dd - 0.02);
      f.box(opt.joinery, a0, a1, dd - 0.08, dd, spring - 0.05, spring + 0.05, false);
      for (let i = 1; i < 4; i++) {
        const ang = (Math.PI * i) / 4;
        const r = Math.min(o.width / 2, rise);
        const x = o.a - Math.cos(ang) * r * 0.95;
        f.box(opt.joinery, Math.min(o.a, x) - 0.02, Math.max(o.a, x) + 0.02, dd - 0.06, dd - 0.02, spring, spring + 0.04, false);
      }
    }
  });
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
      // stone voussoir band (exposed sandstone, KB-I15)
      const sw = 0.35;
      const jb0 = Math.max(o.bottom_h, opt.plinthTop);
      // jamb blocks course by course (alternating hues, KB-I19 recycled stone)
      for (let h = jb0, i = 0; h < spring - 1e-3; h += 0.6, i++) {
        const h1 = Math.min(spring, h + 0.6);
        stoneBox(f, opt, `dfL${o.a.toFixed(1)}:${i}`, opt.stone, a0 - sw, a0, d, d + 0.05, h, h1, true);
        stoneBox(f, opt, `dfR${o.a.toFixed(1)}:${i}`, opt.stone, a1, a1 + sw, d, d + 0.05, h, h1, true);
      }
      f.g.withShade(stoneShade(opt, `dfA${o.a.toFixed(1)}`, opt.stone), () => archBand(f, opt.stone, a0, a1, o.top_h, head, sw, d, 0.05, lod >= 1));
    }
    return;
  }
  if (kind === 'dormer' || kind === 'oculus') return;
  const sf = ARTICULATION.surround.face;
  const pj = ARTICULATION.surround.projection;
  // KB-I15: portal and gate surrounds are exposed sandstone; window surrounds, sills and caps are painted render members
  const portalStone = kind === 'portal' || kind === 'carriage_gate';
  const m = portalStone ? opt.stone : opt.members;
  const jb = Math.max(o.bottom_h, band.h0);
  const dress = (key: string, draw: () => void) => (portalStone ? f.g.withShade(stoneShade(opt, `${key}${o.a.toFixed(1)}`, opt.stone), draw) : draw());
  dress('pjL', () => f.box(m, a0 - sf, a0, d, d + pj, jb, spring, true));
  dress('pjR', () => f.box(m, a1, a1 + sf, d, d + pj, jb, spring, true));
  dress('pjH', () => {
    if (rise === 0) f.box(m, a0 - sf, a1 + sf, d, d + pj, o.top_h, o.top_h + sf, true);
    else archBand(f, m, a0, a1, o.top_h, head, sf, d, pj, true);
  });
  const crown = o.top_h + sf;
  if (lod >= 2 && rise > 0) dress('pjK', () => f.box(m, o.a - 0.14, o.a + 0.14, d, d + pj + 0.05, o.top_h - 0.05, crown + 0.08, true)); // keystone
  // wave-8 audit rank 3: sandstone pilaster strips and an entablature frame a main portal without a portico [PORTAL_FRAME]
  if (kind === 'portal' && !o.portico && lod >= 1) {
    const P = PORTAL_FRAME;
    const top = crown + P.above;
    const l0 = a0 - sf - P.pilaster;
    const l1 = a1 + sf + P.pilaster;
    dress('pfL', () => f.box(m, l0, a0 - sf, d, d + P.projection, jb, top, true));
    dress('pfR', () => f.box(m, a1 + sf, l1, d, d + P.projection, jb, top, true));
    dress('pfE', () => f.box(m, l0 - 0.05, l1 + 0.05, d, d + P.projection + 0.04, top, top + P.frieze, true));
    dress('pfC', () => f.box(m, l0 - 0.15, l1 + 0.15, d, d + P.corniceProjection, top + P.frieze, top + P.frieze + P.cornice, true));
  }
  // sill (Sohlbank)
  if (kind === 'window') f.box(m, a0 - sf - 0.06, a1 + sf + 0.06, d - 0.02, d + 0.13, o.bottom_h - 0.13, o.bottom_h, true);
  // Verdachung (cornice cap): only where the layout marks it (CdL Beletage centre axes, KB-I17) [HMS; research/09 G7]
  if (o.hood && (kind === 'window' || kind === 'porte_fenetre')) {
    const top = rise > 0 ? crown + 0.04 : crown;
    f.box(m, a0 - sf - 0.08, a1 + sf + 0.08, d, d + pj + 0.08, top, top + 0.07, true);
    f.box(m, a0 - sf - 0.12, a1 + sf + 0.12, d, d + pj + 0.16, top + 0.07, top + 0.16, true);
  }
  // balconet in front of a catalogue porte-fenêtre on an upper storey (iron railing on a stone slab) [KB-I17]
  if (kind === 'porte_fenetre' && o.balcony) {
    const bd = 0.75;
    f.box(m, a0 - sf - 0.1, a1 + sf + 0.1, d, d + bd, o.bottom_h - 0.18, o.bottom_h, false);
    f.box(IRON, a0 - sf - 0.05, a1 + sf + 0.05, d + bd - 0.06, d + bd - 0.02, o.bottom_h + 0.9, o.bottom_h + 0.95, false);
    for (let x = a0 - sf; x <= a1 + sf + 1e-6; x += 0.12) f.box(IRON, x - 0.012, x + 0.012, d + bd - 0.055, d + bd - 0.03, o.bottom_h, o.bottom_h + 0.9, false);
    for (const x of [a0 - sf - 0.05, a1 + sf + 0.03]) f.box(IRON, x, x + 0.025, d, d + bd - 0.02, o.bottom_h + 0.9, o.bottom_h + 0.95, false);
  }
  // shutters (open, against the wall)
  if (opt.shutters && kind === 'window' && o.bottom_h > opt.plinthTop - 0.01 && !(o.storey !== undefined && opt.shutterOmit.includes(o.storey))) {
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

/** Per-block sandstone hue as a shade provider (KB-I19): one block keyed per building. */
function stoneShade(opt: FacadeOptions, key: string, k: MatKey): ShadeFn {
  const base = k.includes('|') ? k.slice(k.indexOf('|') + 1) : opt.plinthColour;
  const t = blockTint(opt.buildingId, key, base, opt.seed);
  return (_p, _ny, out) => {
    out[0] *= t[0];
    out[1] *= t[1];
    out[2] *= t[2];
  };
}

/** A dressed stone box (step, threshold, jamb block) with its own block hue. */
function stoneBox(f: Face, opt: FacadeOptions, key: string, k: MatKey, a0: number, a1: number, d0: number, d1: number, h0: number, h1: number, skipBack: boolean): void {
  f.g.withShade(stoneShade(opt, key, k), () => f.box(k, a0, a1, d0, d1, h0, h1, skipBack));
}

/** Small deterministic normal jitter of a glass pane (crown / cylinder glass waviness, research/09 §3.1, M6) [N; I 0.5-1.5°]. */
const PANE_JITTER = 0.026; // rad ≈ 1.5°

/**
 * Window joinery (KB-I16): frame, glass, casement meeting stile, transom only on windows >= 2.6 m, and at LOD2 the
 * glazing bars of the GLAZING class with one glass quad per pane (slightly jittered normals catch low sun).
 */
function windowJoinery(
  f: Face,
  o: { kind: FacadeOpening['kind']; a: number; width: number; bottom_h: number; top_h: number; row?: WindowRow | null; storey?: number },
  d: number,
  revealDepth: number,
  opt: FacadeOptions,
  head: HeadForm,
  rise: number,
  spring: number,
): void {
  const a0 = o.a - o.width / 2;
  const a1 = o.a + o.width / 2;
  const kind = o.kind;
  const lod = opt.lod;
  // frame plane; KB-I21: Fachwerk storeys set the frame in a shallow reveal (grammar FACHWERK)
  const fd = d - (o.storey !== undefined && opt.fachwerk.includes(o.storey) ? FACHWERK.reveal : 0.14);
  const fw = kind === 'cellar_window' ? 0.05 : CASEMENT.frame;
  // frame: jambs + head + bottom rail
  f.box(opt.joinery, a0, a0 + fw, fd - 0.06, fd, o.bottom_h, spring, false);
  f.box(opt.joinery, a1 - fw, a1, fd - 0.06, fd, o.bottom_h, spring, false);
  f.box(opt.joinery, a0, a1, fd - 0.06, fd, o.bottom_h, o.bottom_h + fw, false);
  if (rise === 0) f.box(opt.joinery, a0, a1, fd - 0.06, fd, o.top_h - fw, o.top_h, false);
  else {
    const c = archCurve(a0 + fw * 0.5, a1 - fw * 0.5, o.top_h - fw * 0.5, head, 8);
    for (let i = 1; i < c.length; i++) {
      const p = c[i - 1];
      const q = c[i];
      f.strip(opt.joinery, p, q, fd, fd - 0.06, [0, 0, -1]);
      f.poly(opt.joinery, [p, q, [q[0], q[1] - fw], [p[0], p[1] - fw]], fd);
    }
  }
  const gd = fd - 0.03;
  const arch: [number, number][] = rise > 0 ? archCurve(a0, a1, o.top_h, head, 10) : [];
  const glassPts: [number, number][] = rise > 0 ? [[a0, o.bottom_h], [a1, o.bottom_h], ...arch.slice().reverse()] : [
    [a0, o.bottom_h],
    [a1, o.bottom_h],
    [a1, o.top_h],
    [a0, o.top_h],
  ];
  if (opt.backing) f.poly(BACKING, glassPts, d - revealDepth + 0.02);
  const h = spring - o.bottom_h;
  const bars = kind !== 'cellar_window' && kind !== 'oculus';
  const gl = glazingLayout(opt.cls as never, o.row, o.width, h, rise);
  // glass: one quad per leaf and light (lower casement / top light) at LOD2 with jittered normals, so neighbouring
  // leaves catch the sky differently like hand-blown crown glass [N]; one polygon otherwise
  f.g.withShade(glassShade, () => {
    if (lod >= 2 && bars) {
      const N = f.objN();
      const T = f.objT();
      const up = new THREE.Vector3(0, 1, 0);
      const low = gl.transom ?? h;
      const rows: [number, number][] = gl.transom !== null ? [[o.bottom_h, o.bottom_h + low], [o.bottom_h + low, spring]] : [[o.bottom_h, spring]];
      for (let i = 0; i < gl.leaves; i++) {
        const x0 = a0 + (o.width * i) / gl.leaves;
        const x1 = a0 + (o.width * (i + 1)) / gl.leaves;
        for (const [y0, y1] of rows) {
          const rnd = mulberry32(hashString(`${opt.buildingId}|${(x0 + f.u0).toFixed(2)}|${y0.toFixed(2)}`) ^ opt.seed);
          const n = N.clone()
            .addScaledVector(T, (rnd() * 2 - 1) * PANE_JITTER)
            .addScaledVector(up, (rnd() * 2 - 1) * PANE_JITTER)
            .normalize();
          const P0 = f.P(x0, y0, gd);
          const P1 = f.P(x1, y0, gd);
          const P2 = f.P(x1, y1, gd);
          const P3 = f.P(x0, y1, gd);
          f.g.tri(GLASS, P0, P1, P2, [n, n, n]);
          f.g.tri(GLASS, P0, P2, P3, [n, n, n]);
        }
      }
      if (rise > 0) f.poly(GLASS, [[a0, spring], [a1, spring], ...arch.slice().reverse()], gd);
    } else f.poly(GLASS, glassPts, gd);
  });
  if (!bars) return;
  const bar = gl.bar;
  // transom (Kämpfer): straight heads >= 2.6 m at 3/4 h; arched heads at the springer when >= 2.6 m [N]
  const tH = gl.transom !== null ? o.bottom_h + gl.transom : null;
  if (tH !== null) f.box(opt.joinery, a0, a1, fd - 0.06, fd, tH - fw / 2, tH + fw / 2, false);
  // meeting stile of the two leaves (no fixed mullion; it stops at the transom, the top light is fixed) [D Baunetz]
  const stileTop = tH ?? spring;
  if (gl.leaves === 2) f.box(opt.joinery, o.a - CASEMENT.meetingStile / 2, o.a + CASEMENT.meetingStile / 2, fd - 0.055, fd - 0.005, o.bottom_h, stileTop, false);
  if (lod < 2) return;
  // glazing bars (Sprossen)
  const low = gl.transom ?? h;
  for (let i = 1; i < gl.cols; i++) {
    if (gl.leaves === 2 && i * 2 === gl.cols) {
      // the top light continues the stile line as a bar
      if (tH !== null && rise === 0) f.bar(opt.joinery, o.a - bar / 2, o.a + bar / 2, fd - 0.05, fd - 0.01, tH, spring, true);
      continue;
    }
    const x = a0 + (o.width * i) / gl.cols;
    f.bar(opt.joinery, x - bar / 2, x + bar / 2, fd - 0.05, fd - 0.01, o.bottom_h, rise > 0 && tH !== null ? tH : spring, true);
  }
  for (let j = 1; j < gl.rowsLow; j++) {
    const y = o.bottom_h + (low * j) / gl.rowsLow;
    f.bar(opt.joinery, a0, a1, fd - 0.05, fd - 0.01, y - bar / 2, y + bar / 2, false);
  }
  for (let j = 1; j < gl.rowsTop; j++) {
    const y = o.bottom_h + low + ((h - low) * j) / gl.rowsTop;
    f.bar(opt.joinery, a0, a1, fd - 0.05, fd - 0.01, y - bar / 2, y + bar / 2, false);
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

/** A material key with its tint mixed `t` toward white (keys without a tint are returned unchanged). */
function paler(k: MatKey, t: number): MatKey {
  const i = k.indexOf('|');
  if (i < 0) return k;
  const c = new THREE.Color(k.slice(i + 1));
  c.lerp(new THREE.Color(1, 1, 1), t);
  return `${k.slice(0, i)}|#${c.getHexString()}` as MatKey;
}

/** A material key with its tint scaled to `t` of its (linear) albedo (keys without a tint are returned unchanged). */
function darker(k: MatKey, t: number): MatKey {
  const i = k.indexOf('|');
  if (i < 0) return k;
  const c = new THREE.Color(k.slice(i + 1)).multiplyScalar(t);
  return `${k.slice(0, i)}|#${c.getHexString()}` as MatKey;
}

/** Freitreppe in front of a portal: `steps` steps from the court level up to the portal threshold. */
function freitreppe(f: Face, opt: FacadeOptions, o: FacadeOpening, base: number, d: number): void {
  const k = opt.plinth;
  const fp = freitreppePlan(o);
  if (!fp) return;
  const n = Math.max(1, o.steps ?? 0);
  const rise = (o.bottom_h - base) / n;
  if (rise <= 0.02) return;
  const w = fp.halfWidth * 2;
  const id = `ft${(o.a + f.u0).toFixed(1)}`;
  if (fp.main) {
    // wave-8 review fix (KB-I72): broad perron [MAIN_PERRON]: landing + treads, cheeks stepped with the treads in the
    // grey-pink portal sandstone, a pedestal at each foot
    const front = (i: number) => d + fp.landing + (n - i) * fp.tread; // front edge of step i (i = n: the landing)
    const st = opt.stone;
    // wave 9: treads in the portal sandstone (MAIN_PERRON.stoneTreads), so the perron reads with the portal frame
    const tk = MAIN_PERRON.stoneTreads ? st : k;
    // the nosing (Stufenkante) a shade paler than the treads and overhanging the riser, so its shadow line marks every
    // step from the court [I]
    const nk = MAIN_PERRON.stoneTreads ? paler(st, 0.3) : st;
    // wave-9 review fix: risers the same stone at MAIN_PERRON.riser albedo, and baked AO in each step's inner corner
    // (riser foot, tread back edge), so the 0.14 m rhythm survives in shade and at dusk [I render]. Each step is a
    // riser block standing on the step below plus a tread slab in the tread stone; the nosing caps its front.
    const rk = MAIN_PERRON.stoneTreads ? darker(st, MAIN_PERRON.riser) : k;
    const top = (i: number) => base + i * rise;
    const depthOf = (p: P3) => (p[0] - f.sd.p0[0]) * f.sd.normal[0] + (p[1] - f.sd.p0[1]) * f.sd.normal[1];
    for (let i = 1; i <= n; i++) {
      const tint = stoneShade(opt, `${id}:${i}`, tk);
      const h0 = i === 1 ? base - 0.3 : top(i - 1);
      // riser block: dark at its foot (the inner corner with the tread below)
      f.g.withShade(
        (p, ny, out) => {
          tint(p, ny, out);
          if (p[2] <= h0 + 0.01) out[3] = Math.min(out[3], AO.stepCorner);
        },
        () => f.box(rk, o.a - w / 2, o.a + w / 2, d - 0.1, front(i), h0, top(i) - 0.05, true),
      );
      // tread slab from the next riser (or the wall) to under the nosing: dark along its back edge
      const back = i === n ? d - 0.1 : front(i + 1);
      f.g.withShade(
        (p, ny, out) => {
          tint(p, ny, out);
          if (ny > 0.5 && depthOf(p) <= back + 0.01) out[3] = Math.min(out[3], AO.stepCorner);
        },
        () => f.box(tk, o.a - w / 2, o.a + w / 2, back, front(i) - 0.04, top(i) - 0.05, top(i), true),
      );
      f.box(nk, o.a - w / 2, o.a + w / 2, front(i) - 0.05, front(i) + 0.045, top(i) - 0.05, top(i) + 0.005, false);
    }
    for (const sg of [-1, 1]) {
      const c0 = o.a + sg * fp.halfWidth;
      const c1 = c0 + sg * fp.cheek;
      const [x0, x1] = sg < 0 ? [c1, c0] : [c0, c1];
      for (let i = 1; i <= n; i++) {
        const back = i === n ? d - 0.1 : front(i + 1);
        stoneBox(f, opt, `${id}:W${sg}${i}`, st, x0, x1, back, front(i), base - 0.3, base + i * rise + fp.cheekAbove, true);
      }
      if (fp.pedestal) {
        const [pw, pd, ph] = fp.pedestal;
        const pc = (c0 + c1) / 2;
        const foot = front(1);
        stoneBox(f, opt, `${id}:P${sg}`, st, pc - pw / 2, pc + pw / 2, foot - pd, foot + 0.02, base - 0.3, base + ph, true);
        f.box(st, pc - pw / 2 - 0.05, pc + pw / 2 + 0.05, foot - pd - 0.05, foot + 0.07, base + ph, base + ph + 0.1, false);
      }
    }
    return;
  }
  for (let i = 1; i <= n; i++) {
    const top = base + i * rise;
    const depth = (n - i + 1) * fp.tread + (i === n ? fp.landing : 0);
    stoneBox(f, opt, `${id}:${i}`, k, o.a - w / 2, o.a + w / 2, d - 0.1, d + depth, base - 0.3, top, true);
  }
  // cheek walls (Wangen)
  const depth = fp.depth;
  stoneBox(f, opt, `${id}:L`, k, o.a - w / 2 - fp.cheek, o.a - w / 2, d - 0.1, d + depth, base - 0.3, o.bottom_h + fp.cheekAbove, true);
  stoneBox(f, opt, `${id}:R`, k, o.a + w / 2, o.a + w / 2 + fp.cheek, d - 0.1, d + depth, base - 0.3, o.bottom_h + fp.cheekAbove, true);
}

/**
 * Wave-8 review fix (KB-I72): columned porch in front of a Durchfahrt [PASSAGE_PORTICO; D LC 1790 / PL; sizes N/I]:
 * `columns` Tuscan columns in pairs either side of the passage on pedestals standing on the court (`base`), an
 * entablature at the balcony deck (`o.portico.deck_h`, the floor of the storey above) and a wrought-iron railing.
 */
function passagePortico(f: Face, opt: FacadeOptions, o: FacadeOpening, base: number, d: number): void {
  const p = o.portico!;
  const P = PASSAGE_PORTICO;
  const deck = p.deck_h ?? o.top_h + P.entablature + P.slab;
  const cw = P.columnDiameter;
  const dd = d + p.depth;
  const m = opt.stone;
  const t = dd - cw / 2 - 0.15;
  const pairs = Math.max(1, Math.round(p.columns / 2));
  const xs: number[] = [];
  for (const sg of [-1, 1]) for (let i = 0; i < pairs; i++) xs.push(o.a + sg * (o.width / 2 + P.inner + cw / 2 + i * P.pair));
  const e0 = Math.min(...xs) - cw / 2 - 0.15;
  const e1 = Math.max(...xs) + cw / 2 + 0.15;
  const entB = deck - P.slab - P.entablature;
  const shaft0 = base + P.pedestal;
  const top = entB;
  const pid = `pp${(o.a + f.u0).toFixed(1)}`;
  for (const c of xs) {
    // pedestal, plinth + torus, octagonal tapering shaft, capital, respond pilaster on the wall
    stoneBox(f, opt, `${pid}:ped${c.toFixed(1)}`, m, c - cw * 0.7, c + cw * 0.7, t - cw * 0.7, t + cw * 0.7, base - 0.3, shaft0, false);
    f.box(m, c - cw * 0.62, c + cw * 0.62, t - cw * 0.62, t + cw * 0.62, shaft0, shaft0 + 0.25, false);
    const ring = (r: number): ST[] => Array.from({ length: 8 }, (_, k): ST => {
      const ang = ((k + 0.5) / 8) * Math.PI * 2;
      const q = f.P(c + r * Math.cos(ang), 0, t + r * Math.sin(ang));
      return [q[0], q[1]];
    });
    const r0 = ring(cw / 2);
    const r1 = ring(cw * 0.42);
    const cc = f.P(c, 0, t);
    for (let k = 0; k < 8; k++) {
      const a = r0[k];
      const b = r0[(k + 1) % 8];
      const out: P3 = [(a[0] + b[0]) / 2 - cc[0], (a[1] + b[1]) / 2 - cc[1], 0];
      f.g.quadFacing(opt.wall, [a[0], a[1], shaft0 + 0.25], [b[0], b[1], shaft0 + 0.25], [r1[(k + 1) % 8][0], r1[(k + 1) % 8][1], top - 0.3], [r1[k][0], r1[k][1], top - 0.3], out);
    }
    f.box(m, c - cw * 0.6, c + cw * 0.6, t - cw * 0.6, t + cw * 0.6, top - 0.3, top, false);
    f.box(m, c - cw * 0.4, c + cw * 0.4, d, d + 0.1, base, top, true);
  }
  // entablature (architrave + frieze) round the three open sides, the balcony deck slab on top
  f.box(m, e0, e1, d - 0.05, dd, entB, entB + P.entablature, true);
  f.box(m, e0 - 0.12, e1 + 0.12, d - 0.05, dd + 0.12, deck - P.slab, deck, true);
  if (p.balcony) ironRailing(f, e0 - 0.05, e1 + 0.05, d, dd + 0.05, deck, P.railing, opt.lod);
}

/** Wrought-iron balcony railing round the three free sides of a deck from a0..a1, d0 (wall) .. d1 (front) [BALCONY]. */
function ironRailing(f: Face, a0: number, a1: number, d0: number, d1: number, deck: number, h: number, lod: number): void {
  const B = BALCONY;
  const rail = 0.05;
  // top and bottom rails (front and returns)
  for (const [y0, y1] of [[deck + h - rail, deck + h], [deck + 0.06, deck + 0.06 + rail]] as [number, number][]) {
    f.box(IRON, a0, a1, d1 - 0.05, d1, y0, y1, false);
    f.box(IRON, a0, a0 + 0.05, d0, d1, y0, y1, false);
    f.box(IRON, a1 - 0.05, a1, d0, d1, y0, y1, false);
  }
  // straight bars (LOD2), else a few standards so the railing still reads from afar
  const step = lod >= 2 ? B.bar : 0.9;
  const bw = lod >= 2 ? 0.012 : 0.025;
  for (let x = a0 + step / 2; x < a1; x += step) f.box(IRON, x - bw, x + bw, d1 - 0.045, d1 - 0.02, deck, deck + h, false);
  for (const a of [a0 + 0.025, a1 - 0.025]) for (let y = d0 + step / 2; y < d1 - 0.05; y += step) f.box(IRON, a - bw, a + bw, y - bw, y + bw, deck, deck + h, false);
  if (lod < 2) {
    // a mid rail stands in for the bars' density at LOD1
    f.box(IRON, a0, a1, d1 - 0.045, d1 - 0.02, deck + h * 0.5, deck + h * 0.5 + 0.03, false);
  }
}

/**
 * Wave-8 review fix (KB-I72): continuous balcony across a run of portes-fenêtres [BALCONY]: a sandstone slab on consoles
 * (one at each end and under each pier between the doors), with the iron railing; deck at the door threshold.
 */
function balconyRun(f: Face, opt: FacadeOptions, o: FacadeOpening, run: NonNullable<FacadeOpening['balconyRun']>, d: number, ops: FacadeOpening[]): void {
  const B = BALCONY;
  const deck = o.bottom_h;
  const m = opt.stone;
  stoneBox(f, opt, `bal${(run.a0 + f.u0).toFixed(1)}`, m, run.a0, run.a1, d - 0.02, d + run.depth, deck - B.slab, deck, false);
  f.box(m, run.a0 - 0.04, run.a1 + 0.04, d - 0.02, d + run.depth + 0.04, deck - B.slab - 0.06, deck - B.slab, false);
  // consoles at the ends and the piers between the doors of the run
  const doors = ops.filter((q) => q.kind === 'porte_fenetre' && q.storey === o.storey && q.a >= run.a0 && q.a <= run.a1).map((q) => q.a).sort((x, y) => x - y);
  const cs = [run.a0 + 0.3, run.a1 - 0.3];
  for (let i = 1; i < doors.length; i++) cs.push((doors[i - 1] + doors[i]) / 2);
  const [cw, ch] = B.console;
  for (const c of cs) {
    // a console tapering back to the wall: two stacked blocks
    f.box(m, c - cw / 2, c + cw / 2, d, d + run.depth * 0.8, deck - B.slab - ch * 0.45, deck - B.slab - 0.06, false);
    f.box(m, c - cw / 2 + 0.03, c + cw / 2 - 0.03, d, d + run.depth * 0.4, deck - B.slab - ch, deck - B.slab - ch * 0.45, false);
  }
  ironRailing(f, run.a0 + 0.04, run.a1 - 0.04, d, d + run.depth - 0.06, deck, B.railing, opt.lod);
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
    if (bi === 0) plinthPieces(f, key, band, holes, d, opt);
    else renderPieces(f, key, band, holes, mine, d, opt);
    for (const o of mine) {
      if (o.top_h <= band.h0 || o.bottom_h >= band.h1) continue;
      const wT = o.storey !== undefined && opt.fachwerk.includes(o.storey) ? FACHWERK.wall : T;
      const depth = o.kind === 'durchfahrt' ? opt.depth + s.d + 0.2 : wT + (d - s.d);
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

/**
 * Sub-bands of a band split at the given heights (KB-I20): vertex shading is linear between vertices, so a wall is
 * cut where the AO / grime profile bends.
 */
function splitBand(band: Rect, breaks: number[]): Rect[] {
  const hs = [band.h0, ...breaks.filter((h) => h > band.h0 + 0.02 && h < band.h1 - 0.02).sort((a, b) => a - b), band.h1];
  const out: Rect[] = [];
  for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1e-4) out.push({ ...band, h0: hs[i - 1], h1: hs[i] });
  return out;
}

/** Render (limewash) wall pieces with baked AO (foot ledge, under the cornice) and grime under sills and the cornice. */
function renderPieces(f: Face, key: MatKey, band: Rect, holes: Rect[], mine: FacadeOpening[], d: number, opt: FacadeOptions): void {
  const z = opt.zones;
  const sills = mine.filter((o) => o.kind === 'window').map((o) => ({ a0: o.a - o.width / 2, a1: o.a + o.width / 2, h: o.bottom_h }));
  for (const sub of splitBand(band, wallBreaks(z))) {
    for (const p of wallPieces(sub, holes)) {
      // the wall column under a window sill carries the sill's run-off streak [N research/09 §2.4; I]
      const sill = sills.find((w) => p.a0 >= w.a0 - 1e-3 && p.a1 <= w.a1 + 1e-3 && w.h >= p.h1 - 1e-3 && w.h - p.h1 < 2.5);
      const fn: ShadeFn = (q, _ny, out) => {
        const h = q[2];
        out[3] = wallAO(h, z);
        const g = wallGrime(h, z) * (sill ? sillGrime(sill.h - h) : 1);
        out[0] *= g;
        out[1] *= g;
        out[2] *= g;
      };
      f.g.withShade(fn, () => f.rect(key, p.a0, p.a1, p.h0, p.h1, d));
    }
  }
}

/**
 * Plinth (exposed sandstone) pieces split into the ashlar texture's blocks (0.36 m courses), each with its own value
 * and hue (KB-I19: red, some blocks a little toward yellow-grey), and the wall-foot AO (KB-I20). LOD1+ only (facades).
 */
function plinthPieces(f: Face, key: MatKey, band: Rect, holes: Rect[], d: number, opt: FacadeOptions): void {
  const z = opt.zones;
  const u0 = f.u0;
  const ao: ShadeFn = (q, _ny, out) => {
    out[3] = plinthAO(q[2], z);
  };
  // no extra split at the foot fade: the 0.36 m courses already carry the AO gradient
  for (const sub of splitBand(band, [z.grade])) {
    for (const p of wallPieces(sub, holes)) {
      // per-block hue at LOD2; LOD1 (seen from afar) keeps one tint per wall piece to save ~85 k triangles
      const blocks = opt.lod >= 2 ? ashlarBlocks(u0 + p.a0, u0 + p.a1, p.h0, p.h1) : [{ u0: u0 + p.a0, u1: u0 + p.a1, h0: p.h0, h1: p.h1, key: `p${(u0 + p.a0).toFixed(1)}` }];
      for (const b of blocks) {
        const t = blockTint(opt.buildingId, b.key, opt.plinthColour, opt.seed);
        f.g.withShade(
          (q, ny, out) => {
            ao(q, ny, out);
            out[0] *= t[0];
            out[1] *= t[1];
            out[2] *= t[2];
          },
          () => f.rect(key, b.u0 - u0, b.u1 - u0, b.h0, b.h1, d),
        );
      }
    }
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
        const z = opt.zones;
        for (const sub of splitBand({ a0: ae, a1: ae, h0: opt.plinthTop, h1: opt.eaves }, wallBreaks(z))) {
          f.g.withShade(
            (q, _ny, out) => {
              out[3] = wallAO(q[2], z);
              const gr = wallGrime(q[2], z);
              out[0] *= gr;
              out[1] *= gr;
              out[2] *= gr;
            },
            () => f.strip(opt.wall, [ae, sub.h0], [ae, sub.h1], 0, s.d, f.dirA(dir)),
          );
        }
        f.g.withShade(stoneShade(opt, `ret${(ae + f.u0).toFixed(1)}`, opt.plinth), () => f.strip(opt.plinth, [ae, opt.plinthBottom], [ae, opt.plinthTop], 0, s.d + pp, f.dirA(dir)));
      }
      // Lisenen on the risalit edges (KB-I17): building corners follow the corner-strip rule; inner edges only on the
      // CdL and on porticoed risalits (B02 head, LC 1790) [HMS; research/09 §3.4]
      const lw = ARTICULATION.ecklisene.width;
      for (const [e0, e1, edge] of [
        [s.a0, s.a0 + lw, s.a0],
        [s.a1 - lw, s.a1, s.a1],
      ] as [number, number, number][]) {
        const corner = edge <= 1e-4 || edge >= len - 1e-4;
        const ok = corner ? opt.cornerLisenen : opt.risalitLisenen === 'all' || mine.some((o) => o.portico);
        if (ok) lisene(f, opt, e0, e1, s.d, mine);
      }
    }
  }
  // corner Lisenen at the side ends (on the base plane unless a risalit covers the corner) [HMS corner strips]
  const lw = ARTICULATION.ecklisene.width;
  const base = segs.filter((s) => s.d === 0);
  if (opt.cornerLisenen && base.some((s) => s.a0 <= 1e-4)) lisene(f, opt, 0, lw, 0, ops);
  if (opt.cornerLisenen && base.some((s) => s.a1 >= len - 1e-4)) lisene(f, opt, len - lw, len, 0, ops);
  // Freitreppen (portals) and perrons (doors with steps), porticos
  for (const o of ops) if ((o.kind === 'portal' || o.kind === 'door') && (o.steps ?? 0) > 0) {
    const s = segs.find((x) => o.a >= x.a0 && o.a <= x.a1);
    const d = (s?.d ?? 0) + pp;
    const base = o.grade_h ?? L.stack.base_h;
    if (o.portico) portico(f, opt, o, base, d);
    else freitreppe(f, opt, o, base, d);
  }
  // wave-8 review fix (KB-I72): porch in front of a Durchfahrt, continuous balconies across porte-fenêtre runs
  for (const o of ops) {
    const s = segs.find((x) => o.a >= x.a0 && o.a <= x.a1);
    if (o.kind === 'durchfahrt' && o.portico) passagePortico(f, opt, o, o.grade_h ?? L.stack.base_h, (s?.d ?? 0) + pp);
    if (o.balconyRun) balconyRun(f, opt, o, o.balconyRun, s?.d ?? 0, ops);
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
  const pid = `po${(o.a + f.u0).toFixed(1)}`;
  stoneBox(f, opt, `${pid}:podium`, stone, e0, e1, d - 0.1, dd, base - 0.3, o.bottom_h, true);
  // Freitreppe in front of the podium, broader than the portico
  const n = Math.max(1, o.steps ?? 0);
  const rise = (o.bottom_h - base) / n;
  const w = e1 - e0 + PORTICO.stairWidthExtra;
  const tread = 0.4;
  if (rise > 0.02) {
    for (let i = 1; i <= n; i++) {
      const depth = (n - i + 1) * tread;
      stoneBox(f, opt, `${pid}:${i}`, stone, o.a - w / 2, o.a + w / 2, dd - 0.05, dd + depth, base - 0.3, base + i * rise, true);
    }
    const depth = n * tread;
    stoneBox(f, opt, `${pid}:L`, stone, o.a - w / 2 - 0.4, o.a - w / 2, d - 0.1, dd + depth, base - 0.3, o.bottom_h + 0.2, true);
    stoneBox(f, opt, `${pid}:R`, stone, o.a + w / 2, o.a + w / 2 + 0.4, d - 0.1, dd + depth, base - 0.3, o.bottom_h + 0.2, true);
  }
  // columns (octagonal shafts with base and capital) on the podium front, pilasters against the wall;
  // bases, capitals, responds, entablature and balustrade in exposed sandstone (KB-I15: stone at portals) [I]
  const m = opt.stone;
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
  // KB-I20: the dormer front and cheeks darken where they meet the roof
  const footAO = (h: number) => Math.min(1, AO.dormerFoot + ((1 - AO.dormerFoot) * Math.max(0, h - hb)) / AO.dormerFade);
  g.withShade(
    (q, _ny, out) => {
      out[3] = Math.min(out[3], footAO(q[2]));
    },
    () => {
      for (const sub of splitBand({ a0, a1, h0: hb, h1: top }, [hb + AO.dormerFade])) for (const p of wallPieces(sub, [hole])) f.rect(m, p.a0, p.a1, p.h0, p.h1, d);
    },
  );
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
  // cheeks (AO at the roof line, KB-I20)
  for (const [ae, dir] of [
    [a0, -1],
    [a1, 1],
  ] as [number, number][]) {
    const mid = Math.min(top, hb + AO.dormerFade);
    g.withShade(
      (q, _ny, out) => {
        out[3] = footAO(q[2]);
      },
      () => {
        f.strip(opt.roof, [ae, hb], [ae, mid], d, back, f.dirA(dir));
        if (top > mid + 1e-3) f.strip(opt.roof, [ae, mid], [ae, top], d, back, f.dirA(dir));
      },
    );
  }
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
  // stations planned in exterior/hardwarePlan.ts chimneyStations() (shared with the Hemmer masts, which keep clear)
  for (const c of chimneyStations(L)) {
    const { s, t, section: sec, base, top } = c;
    // sandstone stack (catalogue plinth colour) with a projecting cap and a thin cover slab [N; fix round 1]
    g.box(opt.plinth, s - sec[0] / 2, s + sec[0] / 2, t - sec[1] / 2, t + sec[1] / 2, base, top);
    g.box(opt.members, s - sec[0] / 2 - 0.07, s + sec[0] / 2 + 0.07, t - sec[1] / 2 - 0.07, t + sec[1] / 2 + 0.07, top, top + 0.12);
    g.box(opt.members, s - sec[0] / 2 + 0.05, s + sec[0] / 2 - 0.05, t - sec[1] / 2 + 0.05, t + sec[1] / 2 - 0.05, top + 0.12, top + 0.2);
  }
}

/** Full LOD1/LOD2 facade set of a rectangular building (adds walls, members, roof furniture). */
function facadeOptions(L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ctx: BuildContext): FacadeOptions {
  const b = L.building;
  const lod = (ctx.lod >= 2 ? 2 : 1) as 1 | 2;
  const shutterC = normaliseColour(b.facade.shutter_colour) ?? normaliseColour(b.facade.shutters) ?? normaliseColour(String(ctx.spec.defaults?.shutters ?? '')) ?? '#7D8A78';
  const st = b.facade.shutter_type ?? (b.facade.shutters ? 'louvred' : 'none');
  const cd = L.members.cornice;
  const floors = L.stack.floors;
  return {
    lod,
    thickness: WALL_THICKNESS[b.cls] ?? 0.6,
    backing: lod < 2 || b.interior === 'none',
    shutters: st === 'louvred' || st === 'plank' ? matKey('wood.shutter', shutterC) : null,
    members: pal.members,
    stone: pal.stone,
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
    zones: { grade: L.stack.base_h, plinthTop: info.plinthTop, corniceFoot: info.eaves - cd.height },
    buildingId: b.id,
    seed: ctx.options.seed,
    plinthColour: pal.colours.plinth,
    stoneColour: pal.colours.stone,
    cornerLisenen: L.members.cornerLisenen,
    risalitLisenen: L.members.risalitLisenen,
    joinery: b.facade.joinery_colour ? matKey('wood.frame', b.facade.joinery_colour) : FRAME,
    door: b.facade.joinery_colour ? matKey('wood.door', b.facade.joinery_colour) : DOOR,
    shutterOmit: b.facade.shutters_omit_storeys ?? [],
    fachwerk: fachwerkStoreys(b),
  };
}

/** Cornice, string courses and plinth course along a CCW ring. */
function mouldings(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ring: ST[], cuts: readonly MouldingCut[] = []): void {
  const cd = L.members.cornice;
  const e = info.eaves;
  // one main cornice (the palace-group profile on B01-B05, KB-I17) with baked soffit AO (KB-I20)
  profileRing(g, pal.members, ring, CORNICE_PROFILE.map(([d, h]): [number, number] => [d * cd.projection, e - cd.height + h * cd.height]), [], CORNICE_AO);
  // string courses (Gurtgesims) only where the grammar allows them (CdL) [HMS; research/09 G9]
  for (const fl of L.members.stringCourse ? L.stack.floors.slice(1) : []) {
    if (fl.floor_h >= e - 0.5) continue;
    const H = 0.24;
    profileRing(g, pal.members, ring, [
      [0, fl.floor_h - H],
      [0.06, fl.floor_h - H],
      [0.06, fl.floor_h - 0.05],
      [0.1, fl.floor_h],
      [0, fl.floor_h],
    ], [], [
      [0.7, 0.8],
      [1, 1],
      [0.92, 1],
      [1, 1],
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
    [
      [0.95, 1],
      [1, 1],
      [1, 0.9],
    ],
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
  // wave-5 fix (KB-B87): a round pavilion with `court_toward` turns one bay to face that point (a walk) and gets its
  // entrance there: a round-headed door at floor level with steps over the plinth [N garden pavilion; I direction]
  let phase = 0;
  let doorBay = -1;
  const b = L.building;
  if (b.court_toward !== undefined) {
    const to = resolveCourtToward(ctx.spec, b.court_toward, L.frame.centreEN);
    const dE = to[0] - L.frame.centreEN[0];
    const dN = to[1] - L.frame.centreEN[1];
    const ds = dE * L.frame.sDir[0] + dN * L.frame.sDir[1];
    const dt = dE * L.frame.tDir[0] + dN * L.frame.tDir[1];
    if (Math.hypot(ds, dt) > 1e-3) {
      phase = Math.atan2(dt, ds) - (2 * Math.PI) / n; // bay 0 spans ring[0]..ring[2], its middle at 2π/n
      doorBay = 0;
    }
  }
  const ring: ST[] = Array.from({ length: n }, (_, i): ST => [R * Math.cos((i / n) * Math.PI * 2 + phase), R * Math.sin((i / n) * Math.PI * 2 + phase)]);
  const edge = 2 * R * Math.sin(Math.PI / n);
  const opt = facadeOptions(L, pal, info, ctx);
  opt.shutters = null;
  const lay = layoutBays({ side: 'court', length: edge * 2, axes: 1, cls: L.building.cls });
  const ops = facadeOpenings({ cls: L.building.cls, side: 'court', layout: lay, stack: L.stack }).map((o) => ({ ...o, width: Math.min(o.width, edge * 1.6) }));
  const doorOps = ops.map((o): FacadeOpening => {
    const lv = L.stack.levels[o.storey];
    if (!lv || lv.kind !== 'floor' || o.storey !== L.stack.levels.findIndex((x) => x.kind === 'floor')) return o;
    const bottom = o.bottom_h - o.sill;
    const height = Math.min(lv.height - 0.45, o.height + o.sill);
    const steps = Math.max(1, Math.round((bottom - L.stack.base_h) / 0.16));
    return { ...o, kind: 'door', sill: 0, bottom_h: bottom, top_h: bottom + height, height, width: Math.min(Math.max(o.width, 1.3), edge * 1.6), head: 'round', steps, grade_h: L.stack.base_h, tag: 'N garden-pavilion entrance; I direction (court_toward)' };
  });
  for (let i = 0; i < n; i += 2) {
    // one straight wall per bay (chord over two polygon edges), window axis in its middle
    const p = ring[i];
    const q = ring[(i + 2) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const tan: ST = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const sd = { p0: p, tangent: tan, normal: [tan[1], -tan[0]] as ST };
    const f = new Face(g, sd);
    const mine = (i / 2 === doorBay ? doorOps : ops).map((o) => ({ ...o, a: len / 2 }));
    wallSegment(f, { a0: 0, a1: len, d: 0 }, mine, opt);
    for (const o of mine) if (o.kind === 'door' && (o.steps ?? 0) > 0) freitreppe(f, opt, o, o.grade_h ?? L.stack.base_h, ARTICULATION.plinthProjection);
  }
  const chordRing = ring.filter((_, i) => i % 2 === 0);
  mouldings(g, L, pal, info, chordRing);
}

export function buildFacades(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ctx: BuildContext, roofG?: GeoBuilder): void {
  const b = L.building;
  const opt = facadeOptions(L, pal, info, ctx);
  const cd = L.members.cornice;
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
  // KB-I22: downpipes and pavilion vanes (LOD1+), Hemmer rods with a down-conductor (LOD2) [research/09 G5, G6, E3-E5]
  roofHardware(rg, L, ctx, !!(b.facade.lightning_rods ?? ctx.spec.defaults?.lightning_rods));
}

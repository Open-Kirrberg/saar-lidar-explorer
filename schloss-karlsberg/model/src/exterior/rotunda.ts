/**
 * KB-I24: exterior (LOD1/LOD2) of a round temple pavilion with `facade.rotunda` - the Tempelzimmer / Rotunde at the
 * garden end of the gallery (research/10 §0.2, §b.1 KB-B07). Geometry comes only from `rotundaLayout()` (pure,
 * layout/rotunda.ts), so plans and 3D agree; the dome is the ordinary `dome` roof from exterior/index.ts buildRoof.
 *
 * LOD1: plinth, drum with glazed doors / niches / the colonnade link between Ionic pilasters (volute pairs), entablature,
 *       attic with a coping lip onto the dome, the smooth lead dome, tetrastyle portico (Ionic columns
 *       in the grey of the order, three-fascia architrave, frieze, cornice, pediment) whose roof ends against a raised
 *       attic block, three steps, open colonnade with steps up from the gallery floor, plain inner faces, floor and
 *       ceiling (seen through the glass). Wave-4 review: volutes and the entablature split moved down from LOD2.
 * LOD2: + glazing bars, finer volutes, lead roll seams on the dome, and the room finish of 1789 (paper granite walls with marble
 *       pilasters [D T5 name and material; N hues research/10 §c.2], stucco ceiling, two upholstered benches [D T5]).
 * Draws into the building-group space (s, t, h) like facade.ts.
 */
import type { BuildContext } from '../context.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { ROTUNDA } from '../layout/grammar.ts';
import { type RotundaColumn, type RotundaLayout, type RotundaSteps, drumPoint, rotundaLayout } from '../layout/rotunda.ts';
import type { ST } from '../spec.ts';
import { type GeoBuilder, type MatKey, type P3, matKey } from './builder.ts';
import { domeSection, halfProfile } from './roof.ts';
import { profileRing } from './facade.ts';
import type { ExteriorInfo, ExteriorPalette } from './index.ts';

const GLASS = matKey('glass.crown');
const FRAME = matKey('wood.frame', '#E9E6DE'); // white joinery [D-> Bamberg; HMS] (KB-I15)
/**
 * Faux granite and marble of the Tempelzimmer, paper over boards from 1789 [D T5 (T7 no. 2); hues N research/10 §c.2].
 * KB-I70: the granite is the flecked `wall.granite` (materials/granite.ts), not a flat grey-mauve.
 */
const GRANITE = matKey('wall.granite');
const MARBLE = matKey('stone.marble', '#E8E2D6');
const FLOOR = matKey('floor.flags', '#D2CABB');
const STUCCO = matKey('ceiling.stucco');
const SEAT = matKey('wall.silk.crimson'); // upholstery colour U (N crimson silk, research/09 §4)
const GILT = matKey('metal.gilt');
/** KB-I70: bench frames painted white and picked out in gilt (Louis-seize "peint en blanc, rechampi d'or") [N]. */
const BENCH_FRAME = matKey('wood.frame', '#ECE9E1');

const add = (p: ST, v: ST, k: number): ST => [p[0] + v[0] * k, p[1] + v[1] * k];

/** Curved wall surface at radius r between angles a0 < a1, facing out (away from the centre) or in. */
function arc(g: GeoBuilder, k: MatKey, r: number, a0: number, a1: number, h0: number, h1: number, segs: number, out: boolean): void {
  if (a1 - a0 < 1e-6 || h1 - h0 < 1e-6) return;
  const n = Math.max(1, Math.ceil(((a1 - a0) / (Math.PI / 2)) * segs * 2));
  for (let i = 0; i < n; i++) {
    const b0 = a0 + ((a1 - a0) * i) / n;
    const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const p = drumPoint(b0, r);
    const q = drumPoint(b1, r);
    const m = (b0 + b1) / 2;
    const dir: P3 = out ? [Math.cos(m), Math.sin(m), 0] : [-Math.cos(m), -Math.sin(m), 0];
    g.quadFacing(k, [p[0], p[1], h0], [q[0], q[1], h0], [q[0], q[1], h1], [p[0], p[1], h1], dir);
  }
}

/** Horizontal annulus sector r0..r1 between a0 and a1 at height h, facing up or down. */
function annulus(g: GeoBuilder, k: MatKey, r0: number, r1: number, a0: number, a1: number, h: number, up: boolean, segs: number): void {
  const n = Math.max(1, Math.ceil(((a1 - a0) / (Math.PI / 2)) * segs * 2));
  for (let i = 0; i < n; i++) {
    const b0 = a0 + ((a1 - a0) * i) / n;
    const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const p0 = drumPoint(b0, r0);
    const p1 = drumPoint(b1, r0);
    const q0 = drumPoint(b0, r1);
    const q1 = drumPoint(b1, r1);
    g.quadFacing(k, [p0[0], p0[1], h], [p1[0], p1[1], h], [q1[0], q1[1], h], [q0[0], q0[1], h], [0, 0, up ? 1 : -1]);
  }
}

/** Radial face (opening jamb) at angle a from r0 to r1, facing towards increasing (+1) or decreasing (−1) angle. */
function jamb(g: GeoBuilder, k: MatKey, a: number, r0: number, r1: number, h0: number, h1: number, sense: 1 | -1): void {
  const p = drumPoint(a, r0);
  const q = drumPoint(a, r1);
  const dir: P3 = [-Math.sin(a) * sense, Math.cos(a) * sense, 0];
  g.quadFacing(k, [p[0], p[1], h0], [q[0], q[1], h0], [q[0], q[1], h1], [p[0], p[1], h1], dir);
}

/**
 * KB-I70: the two straight reveals of a through opening on bay axis `a`: planes parallel to the axis at lateral ±hw,
 * from depth dI (inner wall) to dO (outer face), each facing into the opening.
 */
function reveal(g: GeoBuilder, k: MatKey, a: number, hw: number, dI: number, dO: number, h0: number, h1: number): void {
  const n: ST = [Math.cos(a), Math.sin(a)];
  const t: ST = [-n[1], n[0]];
  for (const sg of [-1, 1]) {
    const p = add(add([0, 0], n, dI), t, sg * hw);
    const q = add(add([0, 0], n, dO), t, sg * hw);
    g.quadFacing(k, [p[0], p[1], h0], [q[0], q[1], h0], [q[0], q[1], h1], [p[0], p[1], h1], [-t[0] * sg, -t[1] * sg, 0]);
  }
}

/**
 * KB-I70: soffit (down) or threshold (up) of a through opening: the strip between the straight reveals (±hw) from the
 * inner circle r0 to the outer circle r1, with curved inner and outer edges.
 */
function revealCap(g: GeoBuilder, k: MatKey, a: number, hw: number, r0: number, r1: number, h: number, up: boolean, segs: number): void {
  const n = Math.max(2, segs);
  const pt = (r: number, u: number): P3 => {
    const d = Math.sqrt(Math.max(0, r * r - u * u));
    return [Math.cos(a) * d - Math.sin(a) * u, Math.sin(a) * d + Math.cos(a) * u, h];
  };
  for (let i = 0; i < n; i++) {
    const u0 = -hw + (2 * hw * i) / n;
    const u1 = -hw + (2 * hw * (i + 1)) / n;
    g.quadFacing(k, pt(r0, u0), pt(r0, u1), pt(r1, u1), pt(r1, u0), [0, 0, up ? 1 : -1]);
  }
}

/**
 * Ionic volute seen from the front (wave-4 review: built from LOD1, a flattened disc, not a hexagonal cylinder): a disc
 * of radius `r` in the plane spanned by `side` and the vertical, facing `out`, centre `c` = [s, t, h]. Baked AO draws
 * the eye and the rolled rim; the middle ring stands 0.15 r proud so the scroll catches the light [N Vignola; I].
 */
export function voluteDisc(g: GeoBuilder, k: MatKey, c: P3, side: ST, out: ST, r: number, lod: number): void {
  const n = lod >= 2 ? 12 : 8;
  const P = (rr: number, a: number, d: number): P3 => [c[0] + side[0] * rr * Math.cos(a) + out[0] * d, c[1] + side[1] * rr * Math.cos(a) + out[1] * d, c[2] + rr * Math.sin(a)];
  const dir: P3 = [out[0], out[1], 0];
  const eye = 0.22 * r;
  const mid = 0.62 * r;
  const lift = 0.15 * r;
  for (let i = 0; i < n; i++) {
    // the scroll winds inward: each segment's mid radius shrinks a little round the turn (one coil) [I]
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const m0 = mid * (1.08 - 0.16 * (i / n));
    const m1 = mid * (1.08 - 0.16 * ((i + 1) / n));
    g.quadFacing(k, P(m0, a0, lift), P(m1, a1, lift), P(r, a1, 0), P(r, a0, 0), dir, [1, 1, 0.62, 0.62]);
    g.quadFacing(k, P(eye, a0, lift * 0.6), P(eye, a1, lift * 0.6), P(m1, a1, lift), P(m0, a0, lift), dir, [0.7, 0.7, 1, 1]);
    if (lod >= 2 || i % 2 === 0) g.polygonFacing(k, [P(0, 0, lift * 0.7), P(eye, a0, lift * 0.6), P(eye, lod >= 2 ? a1 : ((i + 2) / n) * Math.PI * 2, lift * 0.6)], dir);
  }
}

/** Tapered round column (n-gon shaft) with a square plinth + torus base and an Ionic (volutes from LOD1) / plain capital. */
function column(g: GeoBuilder, c: RotundaColumn, order: RotundaLayout['order']['name'], shaft: MatKey, lod: number, facing: ST): void {
  const o = ROTUNDA.orders[order];
  const D = c.D;
  const baseH = o.base * D;
  const capH = o.capital * D;
  const [s, t] = c.at;
  const n = lod >= 2 ? 12 : 8;
  const r0 = D / 2;
  const r1 = (D / 2) * o.taper;
  const h0 = c.foot_h + baseH;
  const h1 = c.top_h - capH;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const P = (r: number, a: number, h: number): P3 => [s + r * Math.cos(a), t + r * Math.sin(a), h];
    const m = (a0 + a1) / 2;
    g.quadFacing(shaft, P(r0, a0, h0), P(r0, a1, h0), P(r1, a1, h1), P(r1, a0, h1), [Math.cos(m), Math.sin(m), 0]);
  }
  // base: square plinth + a round torus (octagon) [N Attic base]
  g.box(shaft, s - D * 0.62, s + D * 0.62, t - D * 0.62, t + D * 0.62, c.foot_h, c.foot_h + baseH * 0.45);
  const tor: [number, number][] = Array.from({ length: 8 }, (_, i) => [s + D * 0.58 * Math.cos(((i + 0.5) / 8) * Math.PI * 2), t + D * 0.58 * Math.sin(((i + 0.5) / 8) * Math.PI * 2)]);
  for (let i = 0; i < 8; i++) {
    const p = tor[i];
    const q = tor[(i + 1) % 8];
    const m = ((i + 1) / 8) * Math.PI * 2;
    g.quadFacing(shaft, [p[0], p[1], c.foot_h + baseH * 0.45], [q[0], q[1], c.foot_h + baseH * 0.45], [q[0], q[1], h0], [p[0], p[1], h0], [Math.cos(m), Math.sin(m), 0]);
  }
  if (order !== 'ionic') {
    // plain capital: echinus block + abacus
    const cr = r1 * 1.12;
    g.box(shaft, s - cr, s + cr, t - cr, t + cr, h1, h1 + capH * 0.55);
    g.box(shaft, s - D * 0.58, s + D * 0.58, t - D * 0.58, t + D * 0.58, h1 + capH * 0.55, c.top_h);
    return;
  }
  // Ionic capital [N Vignola]: round echinus, the volute channel across the front and back, a pair of volutes on each
  // face joined by the side bolsters (pulvini), a thin abacus. Volute eyes ≈ ±0.52 D, radius ≈ 0.2 D, hanging from the
  // abacus over the neck of the shaft.
  const side: ST = [-facing[1], facing[0]];
  const ab0 = c.top_h - 0.07 * D;
  const ec = n;
  for (let i = 0; i < ec; i++) {
    const a0 = (i / ec) * Math.PI * 2;
    const a1 = ((i + 1) / ec) * Math.PI * 2;
    const P = (r: number, a: number, h: number): P3 => [s + r * Math.cos(a), t + r * Math.sin(a), h];
    const m = (a0 + a1) / 2;
    g.quadFacing(shaft, P(r1, a0, h1), P(r1, a1, h1), P(r1 * 1.2, a1, h1 + capH * 0.45), P(r1 * 1.2, a0, h1 + capH * 0.45), [Math.cos(m), Math.sin(m), 0.4]);
  }
  const vr = 0.2 * D;
  const vx = 0.52 * D;
  const vd = 0.42 * D;
  const vh = ab0 - vr;
  // channel: the band between the volutes, the full depth of the bolsters
  g.orientedBox(shaft, c.at, side, facing, -vx, vx, -vd, vd, vh, ab0, false, 'none');
  for (const sg of [-1, 1]) {
    const vc = add(c.at, side, sg * vx);
    // bolster: a short cylinder along `facing` under the volute pair (6 sides at LOD1)
    const bn = lod >= 2 ? 10 : 6;
    for (let i = 0; i < bn; i++) {
      const a0 = (i / bn) * Math.PI * 2;
      const a1 = ((i + 1) / bn) * Math.PI * 2;
      const P = (a: number, d: number): P3 => {
        const off = add(add(vc, side, sg * vr * 0.92 * Math.cos(a)), facing, d);
        return [off[0], off[1], vh + vr * 0.92 * Math.sin(a)];
      };
      const m = (a0 + a1) / 2;
      const out: P3 = [side[0] * sg * Math.cos(m), side[1] * sg * Math.cos(m), Math.sin(m)];
      g.quadFacing(shaft, P(a0, -vd), P(a1, -vd), P(a1, vd), P(a0, vd), out);
    }
    for (const fd of [-1, 1]) {
      const f: ST = [facing[0] * fd, facing[1] * fd];
      const ctr = add(vc, f, vd + 0.005);
      voluteDisc(g, shaft, [ctr[0], ctr[1], vh], [side[0] * sg, side[1] * sg], f, vr, lod);
    }
  }
  // abacus (thin, square with the volutes reaching just past it)
  g.box(shaft, s - D * 0.6, s + D * 0.6, t - D * 0.6, t + D * 0.6, ab0, c.top_h);
}

/**
 * Lead roll seams on the low dome (LOD2 only: thinner than a pixel from the air they alias into dots; wave-4 review): ROTUNDA.domeRibs raised strips along the meridians of the
 * same smooth dome profile buildRoof draws (domeSection, 12 steps), from the coping lip to a small boss at the top
 * [N sheet-lead practice; count I].
 */
function domeRibs(g: GeoBuilder, L: BuildingLayout, k: MatKey, radius: number, lod: number): void {
  if (lod < 2 || L.roof.type !== 'dome') return;
  const sec = domeSection({ ...L.roof, type: 'dome' }, 12);
  const prof = halfProfile(sec).map(([d, h]): [number, number] => [radius * (1 - d / (sec.depth / 2)), h]);
  const ribs = ROTUNDA.domeRibs;
  const hw = 0.035;
  const up = 0.03;
  const rMin = 0.45;
  for (let j = 0; j < ribs; j++) {
    const a = ((j + 0.5) / ribs) * Math.PI * 2;
    const dir: ST = [Math.cos(a), Math.sin(a)];
    const tg: ST = [-dir[1], dir[0]];
    for (let i = 1; i < prof.length; i++) {
      const [r0, h0] = prof[i - 1];
      const [r1, h1] = prof[i];
      if (r0 < rMin || h0 < L.stack.eaves_h + 0.04) continue;
      const rr1 = Math.max(rMin, r1);
      const hh1 = r1 < rMin ? h0 + ((h1 - h0) * (r0 - rMin)) / Math.max(1e-6, r0 - r1) : h1;
      const l = Math.hypot(rr1 - r0, hh1 - h0) || 1;
      const nr = (hh1 - h0) / l;
      const nh = -(rr1 - r0) / l;
      const P = (r: number, h: number, u: number, o: number): P3 => [dir[0] * (r + nr * o) + tg[0] * u, dir[1] * (r + nr * o) + tg[1] * u, h + nh * o];
      g.quadFacing(k, P(r0, h0, -hw, up), P(r0, h0, hw, up), P(rr1, hh1, hw, up), P(rr1, hh1, -hw, up), [dir[0] * nr, dir[1] * nr, nh]);
      for (const sg of [-1, 1]) g.quadFacing(k, P(r0, h0, sg * hw, 0), P(rr1, hh1, sg * hw, 0), P(rr1, hh1, sg * hw, up), P(r0, h0, sg * hw, up), [tg[0] * sg, tg[1] * sg, 0]);
    }
  }
  // lead boss where the seams meet
  const top = sec.eaves_h + sec.rise;
  const n = 8;
  const ring: P3[] = Array.from({ length: n }, (_, i): P3 => [rMin * 1.15 * Math.cos(((i + 0.5) / n) * Math.PI * 2), rMin * 1.15 * Math.sin(((i + 0.5) / n) * Math.PI * 2), top - 0.02]);
  g.polygonFacing(k, ring.map((p): P3 => [p[0], p[1], top + 0.06]), [0, 0, 1]);
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const m = ((i + 1) / n) * Math.PI * 2;
    g.quadFacing(k, p, q, [q[0], q[1], top + 0.06], [p[0], p[1], top + 0.06], [Math.cos(m), Math.sin(m), 0]);
  }
}

/** A flight of steps: step j (0 = highest) spans [from + j·tread, from + (j+1)·tread] along `dir`, top = top_h − (j+1)·riser. */
function steps(g: GeoBuilder, k: MatKey, st: RotundaSteps, bottom: number): void {
  const nrm: ST = st.dir;
  const tan: ST = [-nrm[1], nrm[0]];
  for (let j = 0; j < st.count; j++) {
    const top = st.top_h - (j + 1) * st.riser;
    if (top <= bottom + 0.01) continue;
    g.orientedBox(k, [0, 0], tan, nrm, -st.halfWidth, st.halfWidth, st.from + j * st.tread, st.from + (j + 1) * st.tread, bottom, top);
  }
}

/**
 * Glazed double door (KB-I70): a flat leaf pair of the full clear width `w` in the plane at `depth` along the bay
 * axis `a`, so its stiles meet the straight reveals (lateral ±w/2) with no gap. Glass: one outward-facing plane per
 * leaf like the facade windows (single quads facing out of the room), so `glassPatch`'s outside test holds from both
 * sides and the garden shows through from inside; frame, meeting stile, transom and (LOD2) glazing bars in front.
 */
export function glazedDoor(g: GeoBuilder, a: number, w: number, depth: number, h0: number, h1: number, lod: number): void {
  const nrm: ST = [Math.cos(a), Math.sin(a)];
  const tan: ST = [-nrm[1], nrm[0]];
  const mid: ST = [nrm[0] * depth, nrm[1] * depth];
  const fw = 0.09;
  const fd = 0.06;
  const ms = 0.045;
  const Q = (u: number, h: number): P3 => [mid[0] + tan[0] * u, mid[1] + tan[1] * u, h];
  const out: P3 = [nrm[0], nrm[1], 0];
  // glass: one plane per leaf, between the outer stile and the meeting stile, bottom rail to head (frame covers edges)
  for (const [u0, u1] of [
    [-w / 2 + fw * 0.5, -ms * 0.5],
    [ms * 0.5, w / 2 - fw * 0.5],
  ] as [number, number][]) {
    g.quadFacing(GLASS, Q(u0, h0 + 0.4), Q(u1, h0 + 0.4), Q(u1, h1 - fw * 0.5), Q(u0, h1 - fw * 0.5), out);
  }
  // frame: stiles, head, bottom rail (raised panel zone), meeting stile, transom [N French door, research/09 G1]
  g.orientedBox(FRAME, mid, tan, nrm, -w / 2, -w / 2 + fw, -fd, fd, h0, h1);
  g.orientedBox(FRAME, mid, tan, nrm, w / 2 - fw, w / 2, -fd, fd, h0, h1);
  g.orientedBox(FRAME, mid, tan, nrm, -w / 2, w / 2, -fd, fd, h1 - fw, h1);
  g.orientedBox(FRAME, mid, tan, nrm, -w / 2, w / 2, -fd, fd, h0, h0 + 0.42);
  g.orientedBox(FRAME, mid, tan, nrm, -ms, ms, -fd, fd, h0, h1 - 1.0);
  g.orientedBox(FRAME, mid, tan, nrm, -w / 2, w / 2, -fd, fd, h1 - 1.0 - 0.05, h1 - 1.0 + 0.03);
  if (lod >= 2) {
    // large panes (St-Louis glass [D T5]): rows of ≈ 0.62 m, one pane per leaf width [N]
    const top = h1 - 1.05;
    const rows = Math.max(2, Math.round((top - (h0 + 0.42)) / 0.62));
    for (let i = 1; i < rows; i++) {
      const h = h0 + 0.42 + ((top - h0 - 0.42) * i) / rows;
      g.orientedBox(FRAME, mid, tan, nrm, -w / 2 + fw, w / 2 - fw, -0.025, 0.025, h - 0.015, h + 0.015, false, 'ends');
    }
    for (const sg of [-1, 1]) g.orientedBox(FRAME, mid, tan, nrm, sg * w * 0.25 - 0.015, sg * w * 0.25 + 0.015, -0.025, 0.025, h1 - 1.0, h1 - fw, false, 'caps');
  }
}

/**
 * KB-I70: curved upholstered banquette against the drum wall (Louis-seize banquette cintrée: white-painted frame with
 * gilt mouldings, an apron rail, six turned tapering legs, scrolled ends and a stuffed seat) [D T5 "zwei gepolsterte
 * Bänke"; form N; size I], centred on angle `a`, front edge at radius `r` (inside the room), `span` m long.
 */
export function banquette(g: GeoBuilder, a: number, r: number, span: number, floor: number, lod: number): void {
  const depth = 0.5;
  const rb = r + depth; // back edge (toward the wall)
  const half = span / 2 / (r + depth / 2);
  const segs = lod >= 2 ? 8 : 4;
  const seatH = 0.46;
  const apron = [0.31, 0.4] as const;
  const P = (ang: number, rr: number, h: number): P3 => {
    const p = drumPoint(ang, rr);
    return [p[0], p[1], h];
  };
  // apron rail (front and back faces, underside) and the seat deck; the front and back rails carry a gilt bead
  arc(g, BENCH_FRAME, r, a - half, a + half, floor + apron[0], floor + apron[1], segs, false);
  arc(g, BENCH_FRAME, rb, a - half, a + half, floor + apron[0], floor + apron[1], segs, true);
  annulus(g, BENCH_FRAME, r, rb, a - half, a + half, floor + apron[0], false, segs);
  arc(g, GILT, r - 0.012, a - half, a + half, floor + apron[1] - 0.035, floor + apron[1] - 0.015, segs, false);
  // stuffed seat: a squab over the rail, its front edge rounded by a chamfer (two faces) [N]
  const s0 = floor + apron[1];
  arc(g, SEAT, r - 0.01, a - half, a + half, s0, s0 + 0.04, segs, false);
  g.withShade(null, () => {
    const n = Math.max(1, Math.ceil(((2 * half) / (Math.PI / 2)) * segs * 2));
    for (let i = 0; i < n; i++) {
      const b0 = a - half + (2 * half * i) / n;
      const b1 = a - half + (2 * half * (i + 1)) / n;
      const m = (b0 + b1) / 2;
      const inward: P3 = [-Math.cos(m), -Math.sin(m), 0];
      // chamfer from the front face up onto the top
      g.quadFacing(SEAT, P(b0, r - 0.01, s0 + 0.04), P(b1, r - 0.01, s0 + 0.04), P(b1, r + 0.04, seatH + floor), P(b0, r + 0.04, seatH + floor), [inward[0], inward[1], 1]);
      g.quadFacing(SEAT, P(b0, r + 0.04, floor + seatH), P(b1, r + 0.04, floor + seatH), P(b1, rb - 0.02, floor + seatH - 0.01), P(b0, rb - 0.02, floor + seatH - 0.01), [0, 0, 1]);
    }
  });
  // scrolled ends (accotoirs): a low upholstered roll on a frame block at each end [N]
  for (const sg of [-1, 1]) {
    const ae = a + sg * half;
    const ai = a + sg * (half - 0.09 / (r + depth / 2));
    const lo = Math.min(ae, ai);
    const hi = Math.max(ae, ai);
    arc(g, BENCH_FRAME, r - 0.005, lo, hi, floor + apron[0], floor + 0.62, 1, false);
    arc(g, BENCH_FRAME, rb, lo, hi, floor + apron[0], floor + 0.62, 1, true);
    jamb(g, BENCH_FRAME, ae, r - 0.005, rb, floor + apron[0], floor + 0.62, sg as 1 | -1);
    jamb(g, BENCH_FRAME, ai, r - 0.005, rb, floor + seatH, floor + 0.62, (-sg) as 1 | -1);
    annulus(g, SEAT, r - 0.03, rb, lo, hi, floor + 0.62, true, 1);
    arc(g, SEAT, r - 0.03, lo, hi, floor + 0.58, floor + 0.62, 1, false);
    annulus(g, GILT, r - 0.035, r - 0.005, lo, hi, floor + 0.58, false, 1);
  }
  // six turned legs: tapering octagonal (LOD2) / square shafts with a gilt collar under the rail and a toupie foot [N]
  const n = lod >= 2 ? 8 : 4;
  for (const f of [-1, 0, 1]) {
    for (const rr of [r + 0.06, rb - 0.06]) {
      const ang = a + f * (half - 0.07 / (r + depth / 2));
      const c = drumPoint(ang, rr);
      const top = floor + apron[0];
      const ring = (rad: number, h: number, k: number): P3 => [c[0] + rad * Math.cos(((k + 0.5) / n) * Math.PI * 2), c[1] + rad * Math.sin(((k + 0.5) / n) * Math.PI * 2), h];
      for (let k = 0; k < n; k++) {
        const mm = ((k + 1) / n) * Math.PI * 2;
        const dir: P3 = [Math.cos(mm), Math.sin(mm), 0];
        g.quadFacing(BENCH_FRAME, ring(0.018, floor + 0.04, k), ring(0.018, floor + 0.04, k + 1), ring(0.03, top - 0.05, k + 1), ring(0.03, top - 0.05, k), dir);
        g.quadFacing(GILT, ring(0.036, top - 0.05, k), ring(0.036, top - 0.05, k + 1), ring(0.036, top, k + 1), ring(0.036, top, k), dir);
        g.quadFacing(GILT, ring(0.022, floor, k), ring(0.022, floor, k + 1), ring(0.022, floor + 0.04, k + 1), ring(0.022, floor + 0.04, k), dir);
      }
    }
  }
}

export function buildRotunda(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, info: ExteriorInfo, ctx: BuildContext): void {
  const R = rotundaLayout(L);
  if (!R) return;
  const lod = ctx.lod;
  const segs = lod >= 2 ? 6 : 4; // segments per quarter circle on curved faces (x2 per half-bay)
  const Ro = R.radius;
  const Ri = R.inner;
  const fl = R.floor_h;
  const [e0, e1] = R.order.entablature;
  const [, eaves] = R.attic;
  const D = R.order.D;
  const detail = lod >= 2;
  const innerWall = detail ? GRANITE : pal.wall;
  const innerMember = detail ? MARBLE : pal.members;

  // ---- plinth (sandstone) with the floor threshold ring
  arc(g, pal.plinth, Ro + 0.08, 0, Math.PI * 2, info.plinthBottom, fl, segs, true);
  annulus(g, pal.plinth, Ro, Ro + 0.08, 0, Math.PI * 2, fl, true, segs);

  // ---- drum: piers, lintels and openings between the pilasters
  for (const bay of R.bays) {
    const a = bay.angle;
    const op = bay.opening;
    const dIn = Math.asin(Math.min(0.99, (op.width / 2) / Ri));
    const lo = a - bay.half;
    const hi = a + bay.half;
    // outer and inner faces of the two piers (full height up to the architrave)
    arc(g, pal.wall, Ro, lo, a - op.half, fl, e0, segs, true);
    arc(g, pal.wall, Ro, a + op.half, hi, fl, e0, segs, true);
    arc(g, innerWall, Ri, lo, a - dIn, fl, e0, segs, false);
    arc(g, innerWall, Ri, a + dIn, hi, fl, e0, segs, false);
    // above / below the opening
    arc(g, pal.wall, Ro, a - op.half, a + op.half, op.top_h, e0, segs, true);
    arc(g, innerWall, Ri, a - dIn, a + dIn, op.top_h, e0, segs, false);
    if (bay.kind === 'niche') {
      // blind niche (statue niche without a statue outside [I]); inner face closed
      const back = Ro - ROTUNDA.nicheDepth;
      arc(g, pal.wall, Ro, a - op.half, a + op.half, fl, op.bottom_h, segs, true);
      arc(g, pal.members, back, a - op.half, a + op.half, op.bottom_h, op.top_h, segs, true);
      jamb(g, pal.members, a - op.half, back, Ro, op.bottom_h, op.top_h, 1);
      jamb(g, pal.members, a + op.half, back, Ro, op.bottom_h, op.top_h, -1);
      annulus(g, pal.members, back, Ro, a - op.half, a + op.half, op.top_h, false, segs);
      annulus(g, pal.plinth, back, Ro + 0.05, a - op.half, a + op.half, op.bottom_h, true, segs);
      arc(g, innerWall, Ri, a - dIn, a + dIn, fl, op.top_h, segs, false);
      continue;
    }
    // through opening (KB-I70): straight reveals parallel to the bay axis at ±width/2 (they meet the inner wall at
    // ±dIn and the outer face at ±op.half, so no slit opens between the jambs and the inner wall), soffit, threshold,
    // and a glazed double door of the full clear width in the middle of the reveal [D T5 large glass doors]
    const hw = op.width / 2;
    const dI = Math.sqrt(Math.max(0, Ri * Ri - hw * hw));
    const dO = Math.sqrt(Math.max(0, Ro * Ro - hw * hw));
    reveal(g, pal.members, a, hw, dI, dO, op.bottom_h, op.top_h);
    revealCap(g, pal.members, a, hw, Ri, Ro, op.top_h, false, segs);
    revealCap(g, pal.plinth, a, hw, Ri, Ro + 0.08, op.bottom_h + 0.02, true, segs);
    glazedDoor(g, a, op.width, (dI + dO) / 2, op.bottom_h + 0.02, op.top_h, lod);
    // surround (flat render band) round the door head and jambs [N]
    const sw = 0.16;
    const sa = Math.asin(Math.min(0.99, sw / Ro));
    arc(g, pal.members, Ro + 0.04, a - op.half - sa, a - op.half, op.bottom_h, op.top_h + sw, 1, true);
    arc(g, pal.members, Ro + 0.04, a + op.half, a + op.half + sa, op.bottom_h, op.top_h + sw, 1, true);
    arc(g, pal.members, Ro + 0.04, a - op.half, a + op.half, op.top_h, op.top_h + sw, 2, true);
  }

  // ---- pilasters (painted render members [KB-I15]; Ionic [D T5])
  const proj = ROTUNDA.pilasterProjection * D;
  const o = ROTUNDA.orders[R.order.name];
  for (const ang of R.pilasters) {
    const at = drumPoint(ang, Ro);
    const nrm: ST = [Math.cos(ang), Math.sin(ang)];
    const tan: ST = [-nrm[1], nrm[0]];
    const baseH = o.base * D;
    const capH = o.capital * D;
    g.orientedBox(pal.members, at, tan, nrm, -D / 2, D / 2, -0.06, proj, fl + baseH, e0 - capH);
    g.orientedBox(pal.members, at, tan, nrm, -D * 0.6, D * 0.6, -0.06, proj + 0.07, fl, fl + baseH);
    g.orientedBox(pal.members, at, tan, nrm, -D * 0.62, D * 0.62, -0.06, proj + 0.08, e0 - capH, e0);
    if (R.order.name === 'ionic') {
      // Ionic pilaster capital from LOD1 (wave-4 review): a volute pair on the face under the abacus [D T5 Ionic; N]
      const vr = 0.2 * D;
      for (const sg of [-1, 1]) {
        const c = add(at, tan, sg * D * 0.5);
        const f = add(c, nrm, proj + 0.085);
        voluteDisc(g, pal.members, [f[0], f[1], e0 - 0.07 * D - vr], [tan[0] * sg, tan[1] * sg], nrm, vr, lod);
      }
    }
    // inner pilasters (marble on the granite walls, LOD2 finish) [D T5 Ionic pilasters inside]
    if (detail) {
      const ai = drumPoint(ang, Ri);
      // wave 9 (review leftover, pose 19): Attic base and Ionic capital like the outer order, so the inner pilasters
      // stop reading as plain white strips [D T5 Ionic pilasters inside; forms N, as outside]
      g.orientedBox(innerMember, ai, tan, nrm, -D / 2, D / 2, -proj, 0.06, fl + baseH, e0 - capH);
      g.orientedBox(innerMember, ai, tan, nrm, -D * 0.62, D * 0.62, -proj - 0.08, 0.06, fl, fl + baseH * 0.45);
      g.orientedBox(innerMember, ai, tan, nrm, -D * 0.56, D * 0.56, -proj - 0.05, 0.06, fl + baseH * 0.45, fl + baseH);
      g.orientedBox(innerMember, ai, tan, nrm, -D * 0.54, D * 0.54, -proj - 0.04, 0.06, e0 - capH, e0 - capH * 0.45);
      g.orientedBox(innerMember, ai, tan, nrm, -D * 0.64, D * 0.64, -proj - 0.09, 0.06, e0 - capH * 0.3, e0);
      if (R.order.name === 'ionic') {
        const vr = 0.2 * D;
        const inw: ST = [-nrm[0], -nrm[1]];
        for (const sg of [-1, 1]) {
          const c = add(ai, tan, sg * D * 0.5);
          const f = add(c, nrm, -proj - 0.095);
          voluteDisc(g, innerMember, [f[0], f[1], e0 - 0.07 * D - vr], [tan[0] * sg, tan[1] * sg], inw, vr, lod);
        }
      }
    }
  }

  // ---- entablature (architrave, frieze, cornice) round the drum, outside and in
  const ringN = lod >= 2 ? 64 : 40;
  const ring: ST[] = Array.from({ length: ringN }, (_, i) => drumPoint((i / ringN) * Math.PI * 2, Ro));
  const E = e1 - e0;
  const a1 = e0 + E * 0.36;
  const f1 = e0 + E * 0.66;
  profileRing(g, pal.members, ring, [
    [0.04, e0],
    [0.04, a1],
    [0.0, a1],
    [0.0, f1],
    [0.1, f1],
    [0.42, e1 - 0.1],
    [0.42, e1],
  ]);
  annulus(g, pal.members, Ro, Ro + 0.42, 0, Math.PI * 2, e1, true, segs);
  arc(g, innerMember, Ri, 0, Math.PI * 2, e0, e1, segs, false);

  // ---- attic (plain parapet ring) with a coping [N]; the dome springs at its top (buildRoof)
  arc(g, pal.wall, Ro, 0, Math.PI * 2, e1, eaves - 0.12, segs, true);
  // coping with a lip that runs 0.05 m up onto the dome foot and closes the attic-dome joint (wave-4 review: a bright
  // seam between coping and dome) [N]
  arc(g, pal.members, Ro + 0.08, 0, Math.PI * 2, eaves - 0.14, eaves + 0.05, segs, true);
  annulus(g, pal.members, Ro + 0.08, Ro + 0.0, 0, Math.PI * 2, eaves - 0.14, false, segs);
  annulus(g, pal.members, Ro - 0.1, Ro + 0.08, 0, Math.PI * 2, eaves + 0.05, true, segs);
  // lead roll seams (ribs) on the low dome, LOD2 [N sheet-lead practice]
  domeRibs(g, L, pal.roof, Ro, lod);

  // ---- inside: floor and a flat stucco ceiling at the top of the order (the dome is a roof shell over it)
  annulus(g, detail ? FLOOR : pal.plinth, 0.001, Ri, 0, Math.PI * 2, fl + 0.005, true, segs);
  annulus(g, detail ? STUCCO : pal.wall, 0.001, Ri, 0, Math.PI * 2, e1 - 0.01, false, segs);
  if (detail) {
    // shallow coffered-dome reading: a stepped stucco ring under the ceiling [N]
    annulus(g, MARBLE, Ri - 0.35, Ri, 0, Math.PI * 2, e1 - 0.02, false, segs);
    // two upholstered benches against the niches beside the colonnade door [D T5 "zwei gepolsterte Bänke"; position I]:
    // curved Louis-seize banquettes following the wall (KB-I70) [N form]
    for (const bay of R.bays.filter((x) => x.kind === 'niche')) banquette(g, bay.angle, Ri - 0.06 - 0.5, 1.8, fl, lod);
  }

  // ---- portico: podium, steps, columns, entablature, pediment, roof [D T5 form; N size]
  const P = R.portico;
  if (P) {
    const ax = R.axis;
    const tan: ST = [-ax[1], ax[0]];
    const back = Math.sqrt(Math.max(0, Ro * Ro - P.halfWidth * P.halfWidth)) - 0.25;
    g.orientedBox(pal.plinth, [0, 0], tan, ax, -P.halfWidth, P.halfWidth, back, P.podiumFront, info.plinthBottom, P.floor_h);
    steps(g, pal.plinth, P.steps, info.plinthBottom);
    // columns in the painted grey of the order (research/10 §c.1 members #BDBAB2 [N]); the faux granite of 1789 is
    // documented for the room inside only [D T5]; red sandstone stays for podium and steps (wave-4 review)
    for (const c of P.columns) column(g, c, R.order.name, pal.members, lod, ax);
    // antae (flat pilasters) where the portico meets the drum
    const antaBack = Math.sqrt(Math.max(0, Ro * Ro - P.halfSpan * P.halfSpan));
    for (const sg of [-1, 1]) g.orientedBox(pal.members, [0, 0], tan, ax, sg * P.halfSpan - D / 2, sg * P.halfSpan + D / 2, antaBack - 0.15, antaBack + 0.2 + proj, P.floor_h, e0);
    // entablature [N Vignola Ionic]: three-fascia architrave (0.4 E), plain frieze (0.3 E), cornice with bed moulding
    // and corona (0.3 E), each stepping out on the front and both flanks (wave-4 review)
    const front = P.front + D / 2 + 0.05;
    const hw = P.halfSpan + D / 2 + 0.05;
    const E = e1 - e0;
    const band = (h0: number, h1: number, out: number) => g.orientedBox(pal.members, [0, 0], tan, ax, -hw - out, hw + out, back, front + out, h0, h1);
    band(e0, e0 + E * 0.13, 0);
    band(e0 + E * 0.13, e0 + E * 0.26, 0.025);
    band(e0 + E * 0.26, e0 + E * 0.4, 0.05);
    band(e0 + E * 0.4, e0 + E * 0.7, 0.0);
    band(e0 + E * 0.7, e0 + E * 0.8, 0.12);
    band(e0 + E * 0.8, e1, 0.3);
    if (P.pediment) {
      const w = P.pediment.halfWidth;
      const apex = P.pediment.apex_h;
      const Q = (a: number, d: number, h: number): P3 => {
        const p = add(add([0, 0], tan, a), ax, d);
        return [p[0], p[1], h];
      };
      // the portico roof ends against the raised attic block (wave-4 review: it ran into the dome)
      const B = P.atticBlock;
      const roofBack = B ? B.front : back - 0.3;
      // tympanum (render) and raking cornice (members)
      g.polygonFacing(pal.wall, [Q(-hw, front - 0.12, e1), Q(hw, front - 0.12, e1), Q(0, front - 0.12, apex - 0.25)], [ax[0], ax[1], 0]);
      for (const sg of [-1, 1]) {
        g.quadFacing(pal.members, Q(sg * (w + 0.05), front + 0.3, e1), Q(0, front + 0.3, apex + 0.05), Q(0, front + 0.3, apex - 0.25), Q(sg * (w - 0.3), front + 0.3, e1), [ax[0], ax[1], 0]);
        // roof slopes (lead) back to the attic block
        g.quadFacing(pal.roof, Q(sg * (w + 0.05), front + 0.32, e1 + 0.02), Q(0, front + 0.32, apex + 0.07), Q(0, roofBack, apex + 0.07), Q(sg * (w + 0.05), roofBack, e1 + 0.02), [tan[0] * sg, tan[1] * sg, 1]);
        // sloped soffit under the raking cornice
        g.quadFacing(pal.members, Q(sg * (w + 0.05), front + 0.3, e1), Q(0, front + 0.3, apex + 0.05), Q(0, front - 0.12, apex - 0.25), Q(sg * (w - 0.3), front - 0.12, e1), [0, 0, -1]);
        // gable end of the roof prism against the block: closed by the block face; flank under the eaves edge
        g.quadFacing(pal.members, Q(sg * (w + 0.05), front + 0.32, e1), Q(sg * (w + 0.05), roofBack, e1), Q(sg * (w + 0.05), roofBack, e1 + 0.02), Q(sg * (w + 0.05), front + 0.32, e1 + 0.02), [tan[0] * sg, tan[1] * sg, 0]);
      }
      g.quadFacing(pal.members, Q(-hw, back, e0), Q(hw, back, e0), Q(hw, front, e0), Q(-hw, front, e0), [0, 0, -1]);
      if (B) {
        // raised attic block: rendered faces, a members coping band and a lead top running back under the dome [N]
        g.orientedBox(pal.wall, [0, 0], tan, ax, -B.halfWidth, B.halfWidth, B.back, B.front, e1, B.top_h - 0.16, true);
        g.orientedBox(pal.members, [0, 0], tan, ax, -B.halfWidth - 0.06, B.halfWidth + 0.06, B.back, B.front + 0.06, B.top_h - 0.16, B.top_h, true, 'caps');
        g.quadFacing(pal.roof, Q(-B.halfWidth - 0.06, B.front + 0.06, B.top_h), Q(B.halfWidth + 0.06, B.front + 0.06, B.top_h), Q(B.halfWidth + 0.06, B.back, B.top_h), Q(-B.halfWidth - 0.06, B.back, B.top_h), [0, 0, 1]);
      }
    }
  }

  // ---- colonnade to the gallery: floor, steps up to the rotunda floor, columns, beams, deck [D T1/R12; I form]
  const C = R.colonnade;
  if (C) {
    const bk: ST = [-R.axis[0], -R.axis[1]];
    const tan: ST = [-bk[1], bk[0]];
    const [c0, c1] = C.entablature;
    g.orientedBox(pal.plinth, [0, 0], tan, bk, -C.halfWidth, C.halfWidth, C.from, C.to, info.plinthBottom, C.floor_h);
    if (detail) g.orientedBox(FLOOR, [0, 0], tan, bk, -C.halfWidth + 0.15, C.halfWidth - 0.15, C.from, C.to, C.floor_h, C.floor_h + 0.005);
    if (C.steps) {
      // landing at the rotunda floor inside the wall, then the flight down to the colonnade floor
      g.orientedBox(pal.plinth, [0, 0], tan, bk, -C.steps.halfWidth, C.steps.halfWidth, C.from, C.steps.from, C.floor_h, C.steps.top_h);
      steps(g, pal.plinth, C.steps, C.floor_h);
    }
    for (const c of C.columns) column(g, c, R.order.name, pal.members, lod, tan);
    const cD = C.columns[0]?.D ?? D;
    const off = C.halfWidth - cD * 0.6;
    for (const sg of [-1, 1]) {
      g.orientedBox(pal.members, [0, 0], tan, bk, sg * off - cD * 0.55, sg * off + cD * 0.55, Ro - 0.3, C.to, c0, c1 - 0.25);
    }
    g.orientedBox(pal.members, [0, 0], tan, bk, -C.halfWidth - 0.25, C.halfWidth + 0.25, Ro - 0.3, C.to, c1 - 0.25, c1);
    g.orientedBox(pal.deck, [0, 0], tan, bk, -C.halfWidth - 0.2, C.halfWidth + 0.2, Ro - 0.3, C.to, c1, c1 + 0.08);
    // ceiling between the beams
    const Q = (a: number, d: number, h: number): P3 => {
      const p = add(add([0, 0], tan, a), bk, d);
      return [p[0], p[1], h];
    };
    g.quadFacing(detail ? STUCCO : pal.members, Q(-off, Ro - 0.3, c0 + 0.3), Q(off, Ro - 0.3, c0 + 0.3), Q(off, C.to, c0 + 0.3), Q(-off, C.to, c0 + 0.3), [0, 0, -1]);
  }
}

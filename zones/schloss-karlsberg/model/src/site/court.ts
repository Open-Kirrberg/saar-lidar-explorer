/**
 * KB-I23 Ehrenhof furniture geometry (research/09 §5, C6, G11, M9; research/06 §3.1-3.2): blue-white striped sentry
 * boxes with dark domed caps, sandstone Prellsteine, cobbled (Katzenkopf) carriage lanes and sandstone gutters. Where
 * they stand comes from the pure planner site/courtPlan.ts; sizes and colours from layout/grammar.ts COURT_FURNITURE.
 *
 * GeoBuilder works in [s, t, h] with object = (s, h, −t); here s = x and t = −z (= N − N0), so object space = local frame.
 */
import * as THREE from 'three';
import type { BuildContext } from '../context.ts';
import { COURT_FURNITURE } from '../layout/grammar.ts';
import type { P2 } from '../layout/geom.ts';
import { GeoBuilder, type MatKey, type P3, matKey, resolveMaterial } from '../exterior/builder.ts';
import { cobblePatch } from '../materials/cobbles.ts';
import { palette } from '../exterior/index.ts';
import { type CourtPlan, type Placed, type Strip, courtPlan, diagonalBands } from './courtPlan.ts';

const S = COURT_FURNITURE.sentry;
const BLUE = matKey('wood.shutter', S.blue);
/** White painted boards: a wood.shutter variant (not wood.frame, which the explorer light layer drops as joinery). */
const WHITE = matKey('wood.shutter', S.white);
const CAP = matKey('roof.slate', S.capColour);
/** Gutter: dressed yellow-grey sandstone, one of the local hues (research/09 §2.2 [D]); the choice is [I]. */
const GUTTER = matKey('stone.yellow', '#C8B38C');

/** One sentry box at `q` (open front toward q.n): striped walls, white inner faces, plinth, domed cap. */
export function sentryBox(g: GeoBuilder, q: Placed): void {
  const n = q.n;
  const tg: P2 = [n[1], -n[0]]; // right-hand side seen from the front
  const W = S.width / 2;
  const D = S.depth / 2;
  const h0 = q.ground;
  const top = h0 + S.height;
  const P = (u: number, v: number, h: number): P3 => [q.p[0] + tg[0] * u + n[0] * v, q.p[1] + tg[1] * u + n[1] * v, h];
  // floor plinth (sandstone-coloured planks on a sill)
  g.orientedBox(WHITE, [q.p[0], q.p[1]], tg, n, -W, W, -D, D, h0 - 0.15, h0 + 0.08);
  // outer faces round the box: back (−n), left (−tg), front jambs + lintel (+n), right (+tg); stripes run on round the
  // perimeter (u along it, measured from the back-right corner going round)
  const faces: { p0: [number, number]; p1: [number, number]; out: P2; open?: boolean }[] = [
    { p0: [W, -D], p1: [-W, -D], out: [-n[0], -n[1]] },
    { p0: [-W, -D], p1: [-W, D], out: [-tg[0], -tg[1]] },
    { p0: [-W, D], p1: [W, D], out: n, open: true },
    { p0: [W, D], p1: [W, -D], out: tg },
  ];
  const H = S.height;
  const jamb = 0.17;
  const lintel = 0.42;
  let u0 = 0;
  for (const f of faces) {
    const len = Math.hypot(f.p1[0] - f.p0[0], f.p1[1] - f.p0[1]);
    const du: P2 = [(f.p1[0] - f.p0[0]) / len, (f.p1[1] - f.p0[1]) / len];
    const at = (u: number, v: number): P3 => P(f.p0[0] + du[0] * (u - u0), f.p0[1] + du[1] * (u - u0), h0 + v);
    const out: P3 = [f.out[0], f.out[1], 0];
    // the open front keeps jambs and a lintel: draw only the bands' parts inside them
    const parts: [number, number, number, number][] = f.open
      ? [
          [u0, u0 + jamb, 0, H],
          [u0 + len - jamb, u0 + len, 0, H],
          [u0 + jamb, u0 + len - jamb, H - lintel, H],
        ]
      : [[u0, u0 + len, 0, H]];
    for (const [a0, a1, v0, v1] of parts) {
      for (const band of diagonalBands(u0, len, H, S.stripe)) {
        const poly = clipRect(band.poly, a0, a1, v0, v1);
        if (poly.length < 3) continue;
        g.polygonFacing(band.colour ? BLUE : WHITE, poly.map(([u, v]) => at(u, v)), out);
      }
    }
    u0 += len;
  }
  // inner faces (plain white) of back and side walls and the lintel soffit, with baked AO: the niche reads dark [I]
  const iw = W - S.wall;
  const id = D - S.wall;
  g.quadFacing(WHITE, P(-iw, -id, h0 + 0.08), P(iw, -id, h0 + 0.08), P(iw, -id, top - 0.02), P(-iw, -id, top - 0.02), [n[0], n[1], 0], [0.32, 0.32, 0.26, 0.26]);
  g.quadFacing(WHITE, P(-iw, -id, h0 + 0.08), P(-iw, D, h0 + 0.08), P(-iw, D, top - 0.02), P(-iw, -id, top - 0.02), [tg[0], tg[1], 0], [0.32, 0.62, 0.5, 0.26]);
  g.quadFacing(WHITE, P(iw, D, h0 + 0.08), P(iw, -id, h0 + 0.08), P(iw, -id, top - 0.02), P(iw, D, top - 0.02), [-tg[0], -tg[1], 0], [0.62, 0.32, 0.26, 0.5]);
  g.quadFacing(WHITE, P(-W + jamb, D, top - lintel), P(W - jamb, D, top - lintel), P(W - jamb, -id, top - lintel), P(-W + jamb, -id, top - lintel), [0, 0, -1], [0.5, 0.5, 0.3, 0.3]);
  // jamb returns (front opening edges)
  g.quadFacing(WHITE, P(-W + jamb, D, h0 + 0.08), P(-W + jamb, D - S.wall, h0 + 0.08), P(-W + jamb, D - S.wall, top - lintel), P(-W + jamb, D, top - lintel), [tg[0], tg[1], 0], [0.8, 0.7, 0.65, 0.75]);
  g.quadFacing(WHITE, P(W - jamb, D - S.wall, h0 + 0.08), P(W - jamb, D, h0 + 0.08), P(W - jamb, D, top - lintel), P(W - jamb, D - S.wall, top - lintel), [-tg[0], -tg[1], 0], [0.7, 0.8, 0.75, 0.65]);
  // cornice board and domed cap (cloister dome over the square, slight overhang)
  const ov = 0.07;
  g.orientedBox(WHITE, [q.p[0], q.p[1]], tg, n, -W - ov, W + ov, -D - ov, D + ov, top, top + 0.06, true);
  const steps = 6;
  const R = W + ov;
  const RD = D + ov;
  const base = top + 0.06;
  const ring = (k: number): { r: number; rd: number; h: number } => {
    const a = (k / steps) * (Math.PI / 2);
    return { r: R * Math.cos(a), rd: RD * Math.cos(a), h: base + (S.cap - 0.06) * Math.sin(a) };
  };
  for (let k = 0; k < steps; k++) {
    const A = ring(k);
    const B = ring(k + 1);
    const c = (r: { r: number; rd: number; h: number }): P3[] => [P(r.r, -r.rd, r.h), P(r.r, r.rd, r.h), P(-r.r, r.rd, r.h), P(-r.r, -r.rd, r.h)];
    const ca = c(A);
    const cb = c(B);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (k === steps - 1) g.polygonFacing(CAP, [ca[i], ca[j], cb[i]], [0, 0, 1]);
      else g.quadFacing(CAP, ca[i], ca[j], cb[j], cb[i], [(ca[i][0] + ca[j][0]) / 2 - q.p[0], (ca[i][1] + ca[j][1]) / 2 - q.p[1], 0.4]);
    }
  }
  // finial knob
  g.orientedBox(CAP, [q.p[0], q.p[1]], tg, n, -0.04, 0.04, -0.04, 0.04, top + S.cap - 0.02, top + S.cap + 0.12);
}

/** Keep the part of a polygon inside the rectangle [a0, a1] × [v0, v1]. */
function clipRect(poly: P2[], a0: number, a1: number, v0: number, v1: number): P2[] {
  const cut = (pts: P2[], f: (p: P2) => number): P2[] => {
    const out: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  let p = cut(poly, (x) => x[0] - a0);
  p = cut(p, (x) => a1 - x[0]);
  p = cut(p, (x) => x[1] - v0);
  return cut(p, (x) => v1 - x[1]);
}

/** Prellstein: an octagonal sandstone frustum with a rounded head, leaning slightly against the jamb. */
export function prellstein(g: GeoBuilder, k: MatKey, q: Placed): void {
  const T = COURT_FURNITURE.prellstein;
  const n = 8;
  const rows: [number, number][] = [
    [T.base / 2, q.ground - 0.2],
    [T.base / 2, q.ground],
    [T.top / 2, q.ground + T.height * 0.85],
    [T.top / 2.6, q.ground + T.height],
  ];
  for (let i = 1; i < rows.length; i++) {
    const [r0, h0] = rows[i - 1];
    const [r1, h1] = rows[i];
    for (let j = 0; j < n; j++) {
      const a0 = ((j + 0.5) / n) * Math.PI * 2;
      const a1 = ((j + 1.5) / n) * Math.PI * 2;
      const P = (r: number, a: number, h: number): P3 => [q.p[0] + r * Math.cos(a), q.p[1] + r * Math.sin(a), h];
      g.quadFacing(k, P(r0, a0, h0), P(r0, a1, h0), P(r1, a1, h1), P(r1, a0, h1), [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0]);
    }
  }
  const top = rows[rows.length - 1];
  g.polygonFacing(k, Array.from({ length: n }, (_, j): P3 => [q.p[0] + top[0] * Math.cos(((j + 0.5) / n) * Math.PI * 2), q.p[1] + top[0] * Math.sin(((j + 0.5) / n) * Math.PI * 2), top[1]]), [0, 0, 1]);
}

/**
 * Lane mesh: one flat quad per lane, flush with the court (lift + polygon offset in the material), carrying
 * `aLane` = (across m, along m, half width, length) for the procedural cobble shader (materials/cobbles.ts).
 */
export function laneGeometry(lanes: readonly Strip[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const lane: number[] = [];
  const idx: number[] = [];
  for (const s of lanes) {
    const d: P2 = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const l = Math.hypot(d[0], d[1]);
    if (l < 0.1) continue;
    const nx = -d[1] / l;
    const ny = d[0] / l;
    const hw = s.w / 2;
    const i0 = pos.length / 3;
    for (const [c, al] of [[-hw, 0], [hw, 0], [hw, l], [-hw, l]] as const) {
      const x = s.a[0] + (d[0] / l) * al + nx * c;
      const t = s.a[1] + (d[1] / l) * al + ny * c;
      pos.push(x, s.h, -t); // object = (s, h, −t)
      nor.push(0, 1, 0);
      uv.push(c, al);
      lane.push(c, al, hw, l);
    }
    // counter-clockwise seen from above (+y): the object-space normal of (v0, v1, v2) must point up
    const P = (i: number) => pos.slice((i0 + i) * 3, (i0 + i) * 3 + 3);
    const [a, b, c] = [P(0), P(1), P(2)];
    const ny3 = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny3 > 0) idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    else idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLane', new THREE.Float32BufferAttribute(lane, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A dished gutter (Rinne): two slopes down to a shallow channel along its centre line. */
function gutterStrip(g: GeoBuilder, k: MatKey, s: Strip): void {
  const d: P2 = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
  const l = Math.hypot(d[0], d[1]);
  if (l < 0.1) return;
  const nx = -d[1] / l;
  const ny = d[0] / l;
  const hw = s.w / 2;
  const dep = COURT_FURNITURE.gutter.depth;
  const at = (p: P2, o: number, h: number): P3 => [p[0] + nx * o, p[1] + ny * o, h];
  g.quadFacing(k, at(s.a, hw, s.h), at(s.a, 0, s.h - dep), at(s.b, 0, s.h - dep), at(s.b, hw, s.h), [0, 0, 1]);
  g.quadFacing(k, at(s.a, 0, s.h - dep), at(s.a, -hw, s.h), at(s.b, -hw, s.h), at(s.b, 0, s.h - dep), [0, 0, 1]);
  // kerb faces down to the gravel on both edges
  g.quadFacing(k, at(s.a, hw, s.h - 0.06), at(s.b, hw, s.h - 0.06), at(s.b, hw, s.h), at(s.a, hw, s.h), [nx, ny, 0]);
  g.quadFacing(k, at(s.b, -hw, s.h - 0.06), at(s.a, -hw, s.h - 0.06), at(s.a, -hw, s.h), at(s.b, -hw, s.h), [-nx, -ny, 0]);
}

/**
 * Build the Ehrenhof furniture (null when the catalogue has no Ehrenhof). Returns a group with the striped boxes,
 * stones and gutters (one GeoBuilder, merged per material) and the cobbled lanes (own mesh and material: procedural
 * Katzenkopf cobbles with sandstone edging, lit like the terrain).
 */
export function buildCourtFurniture(ctx: BuildContext): { group: THREE.Group; plan: CourtPlan } | null {
  const plan = courtPlan(ctx.spec, (b) => ctx.layout(b), (x, t) => ctx.terrain(x, -t), ctx.options.year, ctx.options.showHypothetical);
  if (!plan) return null;
  const group = new THREE.Group();
  group.name = `site/court/${plan.courtId}`;
  const g = new GeoBuilder({ bake: true });
  for (const q of plan.sentries) sentryBox(g, q);
  for (const q of plan.prellsteine) {
    const b = ctx.spec.buildings.find((x) => x.id === q.buildingId);
    const k = b ? palette(b, ctx).stone : matKey('stone.grey');
    prellstein(g, k, q);
  }
  for (const s of plan.gutters) gutterStrip(g, GUTTER, s);
  const ud = { part: 'feature', featureId: plan.courtId, lod: ctx.lod };
  for (const m of g.toMeshes(ctx.materials, `site/court/${plan.courtId}`, ud)) group.add(m);
  if (plan.lanes.length) {
    // procedural Katzenkopf cobbles with edging (wave-4 review; materials/cobbles.ts), own material instance
    const mat = (resolveMaterial(ctx.materials, matKey('ground.cobbles')) as THREE.MeshStandardMaterial).clone();
    mat.name = 'ground.cobbles';
    mat.userData.materialName = 'ground.cobbles';
    cobblePatch(mat);
    const m = new THREE.Mesh(laneGeometry(plan.lanes), mat);
    m.name = `site/court/${plan.courtId}/lanes/ground.cobbles`;
    m.userData = { ...ud, material: 'ground.cobbles' };
    m.castShadow = false;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, plan };
}

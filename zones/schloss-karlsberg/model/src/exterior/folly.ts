/**
 * KB-I31 / KB-I39 / KB-I30 follies (`facade.folly`, spec FollySpec): small garden structures drawn instead of the facade
 * and roof (catalogue roof `none`). Sizes from grammar FOLLY [N], placement helpers from layout/folly.ts. Every folly is
 * a hypothesis (placement 'hypothetical', confidence low), so the shapes stay modest and lean (≈ 0.3-2 k triangles at
 * LOD1, light layer): the reading "there was a Chinese pavilion / a tent / a hay wagon here" matters, not ornament.
 *
 * Object space: [s, t, h] of the building frame (origin = footprint centre); `court` side = the side the catalogue's
 * `court_toward` faces (Altan: the wall it stands against; round follies: their entrance).
 */
import * as THREE from 'three';
import type { BuildContext } from '../context.ts';
import { E0, N0 } from '../frame.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { altanPiers, polygonRing, skepCentres, upsweptRoofPoint } from '../layout/folly.ts';
import { stToEN } from '../layout/footprint.ts';
import { CHINESE_ROOF, FOLLY } from '../layout/grammar.ts';
import { type GeoBuilder, type MatKey, type P3, type ShadeFn, matKey } from './builder.ts';
import { sideFacing } from './glasshouse.ts';
import type { ExteriorPalette } from './index.ts';

type ST = [number, number];

export function buildFolly(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, ctx: BuildContext): void {
  const fo = L.building.facade.folly;
  if (!fo) return;
  const lod = ctx.lod;
  const f = L.frame;
  // terrain under a plan point (falls back to the catalogue base)
  const ground = (s: number, t: number): number => {
    const [E, N] = stToEN(f, [s, t]);
    const h = ctx.terrain(E - E0, -(N - N0));
    return Number.isFinite(h) ? h : L.stack.base_h;
  };
  switch (fo.kind) {
    case 'altan': {
      // the base courses run up to the plinth top of the wing the Altan stands against (its red band)
      const wing = ctx.spec.buildings.find((b) => b.id === L.building.court_toward);
      const wl = wing ? ctx.layout(wing) : null;
      const plinthTop = wl?.stack.levels.find((l) => l.kind === 'plinth')?.top_h;
      return altan(g, L, pal, lod, fo.gate_width ?? 0, plinthTop);
    }
    case 'chinese':
      return chinese(g, gr, L, pal, lod);
    case 'tent':
      return tent(g, gr, L, lod);
    case 'hay_wagon':
      return hayWagon(g, gr, lod, ground);
    case 'aviary':
      return aviary(g, gr, L, pal, lod);
    case 'monopteros':
      return monopteros(g, gr, L, pal, lod);
    case 'apiary':
      return apiary(g, gr, L, lod);
  }
}

// ------------------------------------------------------------------------------------------- primitives

/** Vertical prism over a plan polygon (CCW) from h0 to h1; top cap optional. Walls face outwards. */
function prism(g: GeoBuilder, k: MatKey, ring: ST[], h0: number, h1: number, top = true): void {
  const n = ring.length;
  let cs = 0;
  let ct = 0;
  for (const p of ring) {
    cs += p[0] / n;
    ct += p[1] / n;
  }
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    g.quadFacing(k, [a[0], a[1], h0], [b[0], b[1], h0], [b[0], b[1], h1], [a[0], a[1], h1], [(a[0] + b[0]) / 2 - cs, (a[1] + b[1]) / 2 - ct, 0]);
  }
  if (top) g.polygonFacing(k, ring.map((p): P3 => [p[0], p[1], h1]), [0, 0, 1]);
}

const offset = (ring: ST[], c: ST): ST[] => ring.map((p): ST => [p[0] + c[0], p[1] + c[1]]);

/** Round column (n-gon shaft) at c, radius r, h0..h1. */
function column(g: GeoBuilder, k: MatKey, c: ST, r: number, h0: number, h1: number, n: number): void {
  prism(g, k, offset(polygonRing(n, r, Math.PI / n), c), h0, h1, false);
}

/**
 * Surface of revolution between rings (radius, height) around `c` (default (0,0)); the profile runs bottom to top with
 * the outside on its outer side, so faces point away from the axis (or down where the profile steps outwards). Rings of
 * radius 0 close the surface (a point at either end).
 */
function lathe(g: GeoBuilder, k: MatKey, profile: [number, number][], n: number, phase: number, both = false, c: ST = [0, 0]): void {
  for (let j = 0; j + 1 < profile.length; j++) {
    const [r0, h0] = profile[j];
    const [r1, h1] = profile[j + 1];
    if (r0 < 1e-6 && r1 < 1e-6) continue;
    for (let i = 0; i < n; i++) {
      const a0 = phase + (i / n) * Math.PI * 2;
      const a1 = phase + ((i + 1) / n) * Math.PI * 2;
      const P = (r: number, a: number, h: number): P3 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), h];
      const am = (a0 + a1) / 2;
      // outward-and-up facing: radial component + vertical from the slope
      const dr = r1 - r0;
      const dh = h1 - h0;
      const dir: P3 = [Math.cos(am) * dh, Math.sin(am) * dh, -dr];
      const quad: [P3, P3, P3, P3] = [P(r0, a0, h0), P(r0, a1, h0), P(r1, a1, h1), P(r1, a0, h1)];
      const tri: P3[] | null = r1 < 1e-6 ? [quad[0], quad[1], quad[2]] : r0 < 1e-6 ? [quad[0], quad[2], quad[3]] : null;
      if (tri) g.polygonFacing(k, tri, dir);
      else g.quadFacing(k, ...quad, dir);
      if (both) {
        const inv: P3 = [-dir[0], -dir[1], -dir[2]];
        if (tri) g.polygonFacing(k, tri, inv);
        else g.quadFacing(k, ...quad, inv);
      }
    }
  }
}

/** Flat ribbon of width w between two points (double-sided), lying in the plane with normal `nrm` (fretwork, bars). */
function ribbon(g: GeoBuilder, k: MatKey, p: P3, q: P3, w: number, nrm: P3): void {
  const d: P3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  // in-plane perpendicular: nrm × d
  let x: P3 = [nrm[1] * d[2] - nrm[2] * d[1], nrm[2] * d[0] - nrm[0] * d[2], nrm[0] * d[1] - nrm[1] * d[0]];
  const l = Math.hypot(...x) || 1;
  x = [(x[0] / l) * (w / 2), (x[1] / l) * (w / 2), (x[2] / l) * (w / 2)];
  const a: P3 = [p[0] - x[0], p[1] - x[1], p[2] - x[2]];
  const b: P3 = [q[0] - x[0], q[1] - x[1], q[2] - x[2]];
  const cc: P3 = [q[0] + x[0], q[1] + x[1], q[2] + x[2]];
  const dd: P3 = [p[0] + x[0], p[1] + x[1], p[2] + x[2]];
  g.quadFacing(k, a, b, cc, dd, nrm);
  g.quadFacing(k, a, b, cc, dd, [-nrm[0], -nrm[1], -nrm[2]]);
}

/** Disc (wheel) in the s-h plane at plan (s, t), radius r, thickness w along t. */
function wheel(g: GeoBuilder, k: MatKey, s: number, t: number, h: number, r: number, w: number, n: number): void {
  const pts = (tt: number): P3[] => Array.from({ length: n }, (_, i): P3 => [s + r * Math.cos((i / n) * Math.PI * 2), tt, h + r * Math.sin((i / n) * Math.PI * 2)]);
  const a = pts(t - w / 2);
  const b = pts(t + w / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const m = ((i + 0.5) / n) * Math.PI * 2;
    g.quadFacing(k, a[i], a[j], b[j], b[i], [Math.cos(m), 0, Math.sin(m)]);
  }
  g.polygonFacing(k, a, [0, -1, 0]);
  g.polygonFacing(k, b, [0, 1, 0]);
}

/** Plan extents of a rect frame. */
function extents(L: BuildingLayout): { l: number; w: number } {
  return { l: L.frame.length / 2, w: L.frame.width / 2 };
}

// ------------------------------------------------------------------------------------------- Altan (KB-I31)

/**
 * Upper-floor terrace on piers against the wall on the `court` side: deck top = eaves (the Beletage floor), rendered
 * piers on red sandstone base courses (up to the wing's plinth top) with sandstone imposts, wall responds, a full
 * entablature on the open sides (architrave in two fasciae, rendered frieze, projecting cornice) and a stone
 * balustrade on three sides (balusters at LOD2, a solid rail at LOD0/1). The gate (Durchfahrt) mouth under it stays
 * clear. Wave-7 review fix: base courses and entablature [N]; access through portes-fenêtres in the wing (catalogue).
 */
function altan(g: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, lod: number, gate: number, plinthTop?: number): void {
  const A = FOLLY.altan;
  const front = L.frame.sides.garden; // open side; the wall is on the court side
  const len = front.length;
  const depth = L.frame.sides.end_a.length;
  const tan = front.tangent;
  const out: ST = front.normal;
  const inn: ST = [-out[0], -out[1]];
  const mid: ST = [front.p0[0] + tan[0] * (len / 2), front.p0[1] + tan[1] * (len / 2)];
  // a along the front from its middle, d inwards from the front face (0 front .. depth wall)
  const ob = (k: MatKey, a0: number, a1: number, d0: number, d1: number, h0: number, h1: number) =>
    g.orientedBox(k, [mid[0] + inn[0] * d1, mid[1] + inn[1] * d1], tan, out, a0, a1, 0, d1 - d0, h0, h1);
  const foot = L.stack.plinth.bottom_h;
  const top = L.stack.eaves_h; // walking surface of the deck
  const slab0 = top - A.deck; // underside of the entablature
  const P = A.pier;
  const piers = altanPiers(len, gate, P, A.maxSpan);
  const dP = P / 2 + 0.05; // pier centre line behind the front face
  const course = Math.min(slab0 - 2.5, Math.max(L.stack.base_h + A.baseCourse, plinthTop ?? 0));
  const stoneK = pal.stone;
  for (const a of piers) {
    // red Buntsandstein base course with a chamfered cap (two set-backs), then the rendered shaft and the impost
    ob(pal.plinth, a - P / 2 - 0.08, a + P / 2 + 0.08, dP - P / 2 - 0.08, dP + P / 2 + 0.08, foot, course - 0.12);
    ob(pal.plinth, a - P / 2 - 0.05, a + P / 2 + 0.05, dP - P / 2 - 0.05, dP + P / 2 + 0.05, course - 0.12, course - 0.04);
    ob(pal.plinth, a - P / 2 - 0.02, a + P / 2 + 0.02, dP - P / 2 - 0.02, dP + P / 2 + 0.02, course - 0.04, course);
    ob(pal.wall, a - P / 2, a + P / 2, dP - P / 2, dP + P / 2, course, slab0 - A.impost);
    ob(stoneK, a - P / 2 - 0.03, a + P / 2 + 0.03, dP - P / 2 - 0.03, dP + P / 2 + 0.03, slab0 - A.impost, slab0 - A.impost + 0.08);
    ob(stoneK, a - P / 2 - 0.07, a + P / 2 + 0.07, dP - P / 2 - 0.07, dP + P / 2 + 0.07, slab0 - A.impost + 0.08, slab0);
    // respond (pilaster) against the wall, on the same base course
    ob(pal.plinth, a - P / 2 + 0.04, a + P / 2 - 0.04, depth - A.respond - 0.05, depth + 0.02, foot, course);
    ob(pal.wall, a - P / 2 + 0.08, a + P / 2 - 0.08, depth - A.respond, depth + 0.02, course, slab0 - A.impost);
    ob(stoneK, a - P / 2 + 0.05, a + P / 2 - 0.05, depth - A.respond - 0.05, depth + 0.02, slab0 - A.impost, slab0);
  }
  // beams from pier to wall (under the slab)
  for (const a of piers) ob(pal.wall, a - P / 2 + 0.1, a + P / 2 - 0.1, dP, depth, slab0 - 0.3, slab0);
  // entablature on the front and both ends: rendered core (soffit + frieze), architrave in two stone fasciae, cornice
  // (bed moulding + corona) and the deck surface on top
  const l2 = len / 2;
  const a0h = slab0 + A.architrave / 2;
  const a1h = slab0 + A.architrave;
  const c0h = top - A.cornice;
  const pr = A.corniceProjection;
  ob(pal.wall, -l2 + 0.02, l2 - 0.02, 0.02, depth, slab0, top - 0.05);
  ob(stoneK, -l2, l2, 0, depth, slab0, a0h); // lower fascia
  ob(stoneK, -l2 - 0.025, l2 + 0.025, -0.025, depth, a0h, a1h); // upper fascia
  if (lod >= 1) ob(stoneK, -l2 - 0.04, l2 + 0.04, -0.04, depth, a1h - 0.03, a1h); // architrave crown (taenia)
  ob(stoneK, -l2 - pr * 0.45, l2 + pr * 0.45, -pr * 0.45, depth, c0h, c0h + 0.07); // bed moulding
  ob(stoneK, -l2 - pr, l2 + pr, -pr, depth, c0h + 0.07, top - 0.02); // corona
  ob(matKey('stone.grey', '#C9C2B4'), -l2, l2, 0, depth, top - 0.02, top); // deck surface
  // balustrade: front and both ends (the wall closes the back)
  const B = A.balustrade;
  const b0 = top;
  const rail = (a0: number, a1: number, d0: number, d1: number) => {
    ob(stoneK, a0, a1, d0, d1, b0, b0 + 0.14); // plinth course
    ob(stoneK, a0 - 0.03, a1 + 0.03, d0 - 0.03, d1 + 0.03, b0 + B - 0.13, b0 + B); // handrail
    if (lod >= 2) {
      const alongA = a1 - a0 > d1 - d0;
      const n = Math.max(1, Math.floor((alongA ? a1 - a0 : d1 - d0) / A.baluster));
      for (let i = 0; i < n; i++) {
        const x = (alongA ? a0 : d0) + ((i + 0.5) * (alongA ? a1 - a0 : d1 - d0)) / n;
        // baluster: square foot, a bellied middle (wider box), a slim neck under the rail
        const seg = (w: number, h0: number, h1: number) =>
          alongA ? ob(stoneK, x - w, x + w, d0 + 0.13 - w, d0 + 0.13 + w, h0, h1) : ob(stoneK, a0 + 0.13 - w, a0 + 0.13 + w, x - w, x + w, h0, h1);
        seg(0.07, b0 + 0.14, b0 + 0.24);
        seg(0.085, b0 + 0.24, b0 + 0.52);
        seg(0.05, b0 + 0.52, b0 + B - 0.21);
        seg(0.075, b0 + B - 0.21, b0 + B - 0.13);
      }
    } else ob(stoneK, a0 + 0.06, a1 - 0.06, d0 + 0.06, d1 - 0.06, b0 + 0.14, b0 + B - 0.13);
  };
  rail(-l2, l2, 0, 0.26);
  rail(-l2, -l2 + 0.26, 0.26, depth);
  rail(l2 - 0.26, l2, 0.26, depth);
  // balustrade piers over the front piers and against the wall
  for (const a of piers) ob(stoneK, a - 0.2, a + 0.2, -0.02, 0.3, b0, b0 + B + 0.06);
  for (const a of [-l2 + 0.13, l2 - 0.13]) ob(stoneK, a - 0.17, a + 0.17, depth - 0.34, depth, b0, b0 + B + 0.06);
}

// ------------------------------------------------------------------------------------------- Chinese pavilion (KB-I39)

function chinese(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, lod: number): void {
  const C = FOLLY.chinese;
  const R = (L.frame.radius ?? Math.min(L.frame.length, L.frame.width) / 2) - 0.3;
  const n = C.sides;
  const phase = Math.PI / n;
  const floor = L.stack.base_h + C.plinth;
  const red = matKey('wood.shutter', C.postColour);
  const green = matKey('wood.shutter', C.railColour);
  // plinth (octagon down to the foot) with a step ring
  prism(g, pal.plinth, polygonRing(n, R, phase), L.stack.plinth.bottom_h, floor);
  prism(g, pal.plinth, polygonRing(n, R + 0.35, phase), L.stack.plinth.bottom_h, floor - C.plinth / 2);
  if (lod >= 1) g.polygonFacing(matKey('stone.grey', C.floorColour), polygonRing(n, R - 0.02, phase).map((p): P3 => [p[0], p[1], floor + 0.01]), [0, 0, 1]);
  // posts at the corners, a frieze beam ring, and the lattice railing between the posts (open on the entrance side)
  const rp = R - 0.25;
  const corners = polygonRing(n, rp, phase);
  const eaves = floor + C.eaves;
  const entrance = entranceIndex(L, corners);
  for (const c of corners) column(g, red, c, C.post / 2, floor, eaves, lod >= 2 ? 8 : 4);
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    // frieze (green, red rim) and a fretwork panel under it
    beam(g, green, a, b, eaves - 0.45, eaves, 0.16);
    if (i === entrance) continue;
    beam(g, green, a, b, floor + C.railing - 0.08, floor + C.railing, 0.1);
    beam(g, red, a, b, floor, floor + 0.12, 0.12);
    if (lod >= 2) {
      // Chinese fret (wave-7 review fix): per cell a vertical frame and both diagonals, in the panel plane [N]
      const m: ST = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const ml = Math.hypot(m[0], m[1]) || 1;
      const nrm: P3 = [m[0] / ml, m[1] / ml, 0];
      const h0 = floor + 0.12;
      const h1 = floor + C.railing - 0.08;
      const at = (u: number, h: number): P3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, h];
      const cells = C.fretCells;
      for (let k = 0; k < cells; k++) {
        const u0 = (k + 0.08) / cells;
        const u1 = (k + 0.92) / cells;
        if (k > 0) ribbon(g, green, at(k / cells, h0), at(k / cells, h1), 0.04, nrm);
        ribbon(g, green, at(u0, h0 + 0.03), at(u1, h1 - 0.03), 0.03, nrm);
        ribbon(g, green, at(u0, h1 - 0.03), at(u1, h0 + 0.03), 0.03, nrm);
        ribbon(g, green, at(u0, (h0 + h1) / 2), at(u1, (h0 + h1) / 2), 0.03, nrm);
      }
    } else beam(g, green, a, b, floor + 0.12, floor + C.railing - 0.08, 0.04);
  }
  // wave-8 audit rank 11: double roof (skirt roof over the posts, lantern drum, upper roof), both with hips swept up and
  // out at the corners, bells at every corner tip, red hip ribs and gilt accents [N CHINESE_ROOF]; double-sided (soffit)
  const CR = CHINESE_ROOF;
  const roofMat = matKey('wood.shutter', C.roofColour);
  const gilt = matKey('metal.gilt');
  const rr = R + C.overhang;
  const rd = rp * CR.drum;
  const hDrum = eaves + CR.lowerRise;
  const hUp = hDrum + CR.drumHeight;
  const ru = rd + CR.upperOverhang;
  const tiers = [
    { ring: polygonRing(n, rr, phase), h: eaves, o: { top: rd / rr, rise: CR.lowerRise, upturn: C.upturn, cornerLift: CR.cornerLift, cornerOut: CR.cornerOut } },
    { ring: polygonRing(n, ru, phase), h: hUp, o: { top: 0, rise: ru * C.rise, upturn: C.upturn * 0.8, cornerLift: CR.cornerLift * 0.8, cornerOut: CR.cornerOut * 0.7 } },
  ];
  const nu = lod >= 2 ? 5 : 2;
  const nt = lod >= 2 ? 6 : 2;
  const tips: P3[] = [];
  for (const [ti, T] of tiers.entries()) {
    const P = (i: number, t: number, u: number): P3 => {
      const q = upsweptRoofPoint(T.ring[i], T.ring[(i + 1) % n], t, u, T.o);
      return [q[0], q[1], T.h + q[2]];
    };
    for (let i = 0; i < n; i++) {
      if (ti === 0 || lod >= 2) tips.push(P(i, 0, 0));
      for (let jt = 0; jt < nt; jt++)
        for (let ju = 0; ju < nu; ju++) {
          const q: [P3, P3, P3, P3] = [P(i, jt / nt, ju / nu), P(i, (jt + 1) / nt, ju / nu), P(i, (jt + 1) / nt, (ju + 1) / nu), P(i, jt / nt, (ju + 1) / nu)];
          // outward-and-up: cross of the eave and slope directions of the cell
          const e: P3 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
          const s: P3 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
          const dir: P3 = [e[1] * s[2] - e[2] * s[1], e[2] * s[0] - e[0] * s[2], e[0] * s[1] - e[1] * s[0]];
          if (dir[2] < 0) (dir[0] = -dir[0]), (dir[1] = -dir[1]), (dir[2] = -dir[2]);
          if (ju === nu - 1 && T.o.top === 0) {
            gr.polygonFacing(roofMat, [q[0], q[1], q[2]], dir);
            gr.polygonFacing(roofMat, [q[0], q[1], q[2]], [-dir[0], -dir[1], -dir[2]]);
          } else {
            gr.quadFacing(roofMat, ...q, dir);
            gr.quadFacing(roofMat, ...q, [-dir[0], -dir[1], -dir[2]]);
          }
        }
      // red hip rib along the corner (t = 0) from the swept tip to the top ring
      if (lod >= 1)
        for (let ju = 0; ju < nu; ju++) {
          const p0 = P(i, 0, ju / nu);
          const p1 = P(i, 0, (ju + 1) / nu);
          const rl = Math.hypot(p0[0], p0[1]) || 1;
          const nrm: P3 = [(p0[0] / rl) * (p1[2] - p0[2]), (p0[1] / rl) * (p1[2] - p0[2]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1])];
          ribbon(gr, red, [p0[0], p0[1], p0[2] + 0.04], [p1[0], p1[1], p1[2] + 0.04], 0.09, nrm);
        }
    }
  }
  // lantern drum between the roofs: green panels, red corner posts, a gilt band under the upper eave
  const drumRing = polygonRing(n, rd, phase);
  prism(g, green, drumRing, hDrum - 0.2, hUp, false);
  if (lod >= 1) {
    if (lod >= 2) for (const c of drumRing) column(g, red, c, 0.07, hDrum - 0.2, hUp, 4);
    prism(g, gilt, polygonRing(n, rd + 0.02, phase), hUp - 0.25, hUp - 0.25 + CR.giltBand, false);
  }
  // fretted valance board under the lower eave edge, scalloped at LOD2 (red)
  const eTop = eaves + C.upturn - 0.08;
  const eBot = eTop - C.valance;
  const ring = polygonRing(n, rr * 0.95, phase);
  const sc = lod >= 2 ? 4 : 1;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const m: ST = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ml = Math.hypot(m[0], m[1]) || 1;
    const nrm: P3 = [m[0] / ml, m[1] / ml, 0];
    for (let j = 0; j < sc * 2; j++) {
      const u0 = j / (sc * 2);
      const u1 = (j + 1) / (sc * 2);
      const lo = (k: number) => (sc === 1 ? eBot : k % 2 === 0 ? eBot : eBot + C.valance * 0.4);
      const p = (u: number, h: number): P3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, h];
      const q: [P3, P3, P3, P3] = [p(u0, lo(j)), p(u1, lo(j + 1)), p(u1, eTop), p(u0, eTop)];
      gr.quadFacing(red, ...q, nrm);
      gr.quadFacing(red, ...q, [-nrm[0], -nrm[1], 0]);
    }
  }
  // gilt bells hanging from the swept corner tips (lower roof; both roofs at LOD2) [N]
  if (lod >= 1) {
    const B = C.bell;
    for (const tp of tips) {
      const tip = tp[2] - 0.04;
      lathe(gr, gilt, [
        [0, tip - B.length],
        [B.radius, tip - B.length + 0.02],
        [B.radius * 0.75, tip - B.length * 0.5],
        [B.radius * 0.35, tip - 0.08],
        [0.012, tip - 0.04],
        [0.012, tip],
        [0, tip + 0.01],
      ], lod >= 2 ? 6 : 4, 0, false, [tp[0] * 0.97, tp[1] * 0.97]);
    }
  }
  // stacked gilt finial: knob, ball, two parasol tiers and a spike (wave-7 review fix: the old rod + prism read as a cross)
  const apex = hUp + tiers[1].o.rise;
  lathe(gr, gilt, C.finialProfile.map(([r, h]): [number, number] => [r, apex + h * (C.finial / 0.9)]), lod >= 1 ? 8 : 6, 0);
}

/** Index of the polygon edge (i → i+1) whose midpoint lies closest to the frame's court side (the entrance). */
function entranceIndex(L: BuildingLayout, ring: ST[]): number {
  const nrm = L.frame.sides.court.normal;
  let best = 0;
  let bd = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const d = ((a[0] + b[0]) / 2) * nrm[0] + ((a[1] + b[1]) / 2) * nrm[1];
    if (d > bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Horizontal beam of square-ish section w between plan points a and b, h0..h1. */
function beam(g: GeoBuilder, k: MatKey, a: ST, b: ST, h0: number, h1: number, w: number): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const tan: ST = [dx / l, dy / l];
  const nrm: ST = [tan[1], -tan[0]];
  g.orientedBox(k, a, tan, nrm, 0, l, -w / 2, w / 2, h0, h1);
}

// ------------------------------------------------------------------------------------------- Turkish tent (KB-I39)

function tent(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, lod: number): void {
  const T = FOLLY.tent;
  const R = (L.frame.radius ?? Math.min(L.frame.length, L.frame.width) / 2) - 0.2;
  const n = lod >= 1 ? T.segments : 8;
  const base = L.stack.base_h;
  const foot = L.stack.plinth.bottom_h;
  const wall = base + T.wall;
  const ring = polygonRing(n, R, 0);
  const A = matKey('wood.shutter', T.stripeA);
  const B = matKey('wood.shutter', T.stripeB);
  const door = entranceIndex(L, ring);
  // canvas drum in the light colour with a narrow blue band at every seam (wave-7 review fix: broad stripes on wall and
  // roof together read as a circus tent); the door bay is open (a dark tied-back gap), sunk to the ground
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const k = B;
    if (lod >= 1 && i !== door) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const w = Math.min(0.09, l * 0.1) / l;
      const ml = Math.hypot(a[0], a[1]) || 1;
      const o = 1 + 0.012 / ml;
      const p0: ST = [a[0] * o, a[1] * o];
      const p1: ST = [(a[0] + (b[0] - a[0]) * w) * o, (a[1] + (b[1] - a[1]) * w) * o];
      const pm: ST = [(a[0] - (b[0] - a[0]) * w) * o, (a[1] - (b[1] - a[1]) * w) * o];
      g.quadFacing(A, [pm[0], pm[1], base], [p1[0], p1[1], base], [p1[0], p1[1], wall], [pm[0], pm[1], wall], [p0[0], p0[1], 0]);
    }
    if (i === door) {
      g.quadFacing(matKey('stone.rubble', '#2E2924'), [a[0] * 0.98, a[1] * 0.98, foot], [b[0] * 0.98, b[1] * 0.98, foot], [b[0] * 0.98, b[1] * 0.98, base + T.door + 0.4], [a[0] * 0.98, a[1] * 0.98, base + T.door + 0.4], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
      g.quadFacing(k, [a[0], a[1], base + T.door + 0.4], [b[0], b[1], base + T.door + 0.4], [b[0], b[1], wall], [a[0], a[1], wall], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
      continue;
    }
    g.quadFacing(k, [a[0], a[1], foot], [b[0], b[1], foot], [b[0], b[1], wall], [a[0], a[1], wall], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
  }
  // slightly swelling cone in the same stripes (overhang), a deep scalloped valance with a gilt edge band, the pole with
  // a gilt knob and crescent (wave-7 review fix) [N]
  const ov = R + 0.35;
  const eave = wall - 0.05;
  const apex = wall + T.rise;
  // gently swelling cone: h(u) = u + swell·sin(πu) of the rise, u = 1 − r / ov (LOD ≥ 1: four rings)
  const nr = lod >= 1 ? 4 : 2;
  const roofProf: [number, number][] = Array.from({ length: nr + 1 }, (_, j): [number, number] => {
    const u = j / nr;
    return [ov * (1 - u), eave + (apex - eave) * Math.min(1, u + T.swell * Math.sin(Math.PI * u))];
  });
  const dip = lod >= 2 ? T.valance : T.valance * 0.75;
  const gilt = matKey('metal.gilt');
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const m = (a0 + a1) / 2;
    const k = i % 2 ? A : B;
    const P = (r: number, a: number, h: number): P3 => [r * Math.cos(a), r * Math.sin(a), h];
    for (let j = 0; j + 1 < roofProf.length; j++) {
      const [r0, h0] = roofProf[j];
      const [r1, h1] = roofProf[j + 1];
      const dir: P3 = [Math.cos(m) * (h1 - h0), Math.sin(m) * (h1 - h0), r0 - r1];
      const inv: P3 = [-dir[0], -dir[1], -dir[2]];
      if (r1 < 1e-6) {
        gr.polygonFacing(k, [P(r0, a0, h0), P(r0, a1, h0), [0, 0, h1]], dir);
        gr.polygonFacing(k, [P(r0, a0, h0), P(r0, a1, h0), [0, 0, h1]], inv);
      } else {
        gr.quadFacing(k, P(r0, a0, h0), P(r0, a1, h0), P(r1, a1, h1), P(r1, a0, h1), dir);
        gr.quadFacing(k, P(r0, a0, h0), P(r0, a1, h0), P(r1, a1, h1), P(r1, a0, h1), inv);
      }
    }
    // valance: a solid blue band, its lower edge dipping in the middle of each bay (scallop)
    const p0 = P(ov, a0, eave);
    const p1 = P(ov, a1, eave);
    const md: P3 = [ov * Math.cos(m), ov * Math.sin(m), eave - dip];
    const out: P3 = [Math.cos(m), Math.sin(m), 0];
    const val: P3[] = [[p0[0], p0[1], eave - dip * 0.45], md, [p1[0], p1[1], eave - dip * 0.45], p1, p0];
    gr.polygonFacing(A, val, out);
    gr.polygonFacing(A, val, [-out[0], -out[1], 0]);
    if (lod >= 1) gr.quadFacing(gilt, [p0[0] * 1.005, p0[1] * 1.005, eave - 0.08], [p1[0] * 1.005, p1[1] * 1.005, eave - 0.08], [p1[0] * 1.005, p1[1] * 1.005, eave], [p0[0] * 1.005, p0[1] * 1.005, eave], out);
  }
  column(gr, matKey('wood.door', '#5A4632'), [0, 0], 0.05, apex - 0.2, apex + T.pole, 6);
  const top = apex + T.pole;
  lathe(gr, gilt, [
    [0, top - 0.02],
    [0.1, top + 0.04],
    [0.12, top + 0.12],
    [0.08, top + 0.2],
    [0.03, top + 0.24],
    [0.03, top + 0.3],
    [0, top + 0.31],
  ], lod >= 1 ? 8 : 5, 0);
  // gilt crescent (opening upwards) in the s-h plane, double-sided
  const rc = T.crescent / 2;
  const hc = top + 0.3 + rc;
  const m = lod >= 1 ? 10 : 6;
  const pts: [P3, P3][] = [];
  for (let k = 0; k <= m; k++) {
    const th = Math.PI * (0.9 + (1.2 * k) / m);
    const thick = 0.45 * rc * Math.sin((Math.PI * k) / m);
    const o: P3 = [rc * Math.cos(th), 0, hc + rc * Math.sin(th)];
    pts.push([o, [o[0] - Math.cos(th) * thick, 0, o[2] - Math.sin(th) * thick]]);
  }
  for (let k = 0; k < m; k++) {
    const [o0, i0] = pts[k];
    const [o1, i1] = pts[k + 1];
    gr.quadFacing(gilt, o0, o1, i1, i0, [0, 1, 0]);
    gr.quadFacing(gilt, o0, o1, i1, i0, [0, -1, 0]);
  }
}

// ------------------------------------------------------------------------------------------- hay wagon (KB-I39)

function hayWagon(g: GeoBuilder, gr: GeoBuilder, lod: number, ground: (s: number, t: number) => number): void {
  const H = FOLLY.hayWagon;
  const wood = matKey('wood.door', H.wood);
  const hl = H.length / 2;
  const hb = H.bed / 2;
  const gc = ground(0, 0);
  const bed = gc + H.bedH;
  const n = lod >= 2 ? 14 : 8;
  // wheels: rear pair larger (s < 0), front pair smaller, outside the bed
  for (const [s, r] of [
    [-hl + 0.75, H.wheelRear / 2],
    [hl - 0.7, H.wheelFront / 2],
  ] as const)
    for (const t of [-hb - 0.1, hb + 0.1]) {
      const h = Math.min(ground(s, t), gc) + r;
      wheel(g, wood, s, t, h, r, H.wheelW, n);
      if (lod >= 2) wheel(g, matKey('metal.iron'), s, t, h, r * 0.18, H.wheelW + 0.08, 6); // hub
    }
  // axles, the bed frame and the ladder sides flaring outwards (Leiterwagen), their tops just under the load's bulge
  g.box(wood, -hl + 0.65, -hl + 0.85, -hb - 0.15, hb + 0.15, gc + H.wheelRear / 2 - 0.06, gc + H.wheelRear / 2 + 0.06);
  g.box(wood, hl - 0.8, hl - 0.6, -hb - 0.15, hb + 0.15, gc + H.wheelFront / 2 - 0.06, gc + H.wheelFront / 2 + 0.06);
  g.box(wood, -hl, hl, -hb, hb, bed - 0.12, bed, false);
  const F = H.ladderFlare;
  for (const sg of [-1, 1]) {
    const tb = sg * hb;
    const tt = sg * (hb + F);
    g.box(wood, -hl - 0.15, hl + 0.1, Math.min(tb, tb + sg * 0.08) - 0.0, Math.max(tb, tb + sg * 0.08), bed, bed + 0.08);
    g.box(wood, -hl - 0.3, hl + 0.25, tt - 0.045, tt + 0.045, bed + H.ladder - 0.09, bed + H.ladder);
    if (lod >= 1)
      for (let x = -hl + 0.15; x <= hl - 0.05; x += 0.45) {
        const n: P3 = [0, sg * H.ladder, -F];
        ribbon(g, wood, [x, tb, bed + 0.04], [x, tt, bed + H.ladder - 0.05], 0.05, n);
      }
  }
  // shaft (Deichsel) forward to the ground
  const tip = ground(hl + H.shaft, 0) + 0.25;
  g.quadFacing(wood, [hl, -0.05, bed - 0.2], [hl + H.shaft, -0.05, tip], [hl + H.shaft, 0.05, tip], [hl, 0.05, bed - 0.2], [0, 0, 1]);
  g.quadFacing(wood, [hl, -0.05, bed - 0.32], [hl + H.shaft, -0.05, tip - 0.1], [hl + H.shaft, -0.05, tip], [hl, -0.05, bed - 0.2], [0, -1, 0]);
  g.quadFacing(wood, [hl, 0.05, bed - 0.32], [hl + H.shaft, 0.05, tip - 0.1], [hl + H.shaft, 0.05, tip], [hl, 0.05, bed - 0.2], [0, 1, 0]);
  // the hay load (wave-7 review fix): a lofted mass that fills the ladders, bulges out over their tops, rises in near
  // vertical sides to a rounded crown and rounds off at both ends; smooth normals, a slight irregularity and a baked
  // straw mottling [N]
  // the meadow-grass texture set, tinted straw-gold, gives the load a fibrous surface (no straw set in the library) [I]
  const hay = matKey('ground.grass', H.hay);
  const lo = H.loadOver;
  const W = hb + lo;
  const LH = H.loadH;
  // half section (t >= 0) from the bed up to the crown as [h, t]; mirrored for t < 0
  const half: [number, number][] = [
    [0, hb - 0.05],
    [H.ladder * 0.95, hb + F - 0.05],
    [H.ladder + 0.25, W],
    [LH * 0.6, W * 0.97],
    [LH * 0.78, W * 0.84],
    [LH * 0.9, W * 0.62],
    [LH * 0.97, W * 0.33],
    [LH, 0],
  ];
  const sec: [number, number][] = [...half.map(([h, t]): [number, number] => [h, -t]), ...half.slice(0, -1).reverse()];
  const K = sec.length;
  const ns = lod >= 2 ? 9 : lod >= 1 ? 6 : 3;
  const s0 = -hl - 0.25;
  const s1 = hl + 0.2;
  // deterministic jitter in [-0.5, 0.5)
  const jit = (i: number, k: number) => {
    const x = Math.sin(i * 12.9898 + k * 78.233 + 4.1) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };
  const grid: P3[][] = [];
  for (let i = 0; i < ns; i++) {
    const u = i / (ns - 1);
    const e = Math.abs(2 * u - 1);
    // rounded ends: the section shrinks over the last ~15 % and the end stations lean in at the top
    const shrink = Math.sqrt(Math.max(0, 1 - Math.pow(e, 4))) * 0.35 + 0.65;
    const lean = e > 0.99 ? -Math.sign(2 * u - 1) * 0.35 : 0;
    const sx = s0 + (s1 - s0) * u;
    grid.push(
      sec.map(([h, t], k): P3 => {
        const r = 1 + (lod >= 1 && h > 0.2 ? 0.06 * jit(i, k) + 0.04 * Math.sin(i * 1.7 + k * 0.9) : 0);
        const hh = h > 0.2 ? h * (0.85 + 0.15 * shrink) * r : h;
        return [sx + lean * (h / LH), t * shrink * r, bed + hh];
      }),
    );
  }
  // smooth vertex normals from the grid's central differences, outward (three.js space for GeoBuilder.tri)
  const at = (i: number, k: number) => grid[Math.min(ns - 1, Math.max(0, i))][Math.min(K - 1, Math.max(0, k))];
  const nrm = (i: number, k: number): THREE.Vector3 => {
    const a = at(i + 1, k);
    const b = at(i - 1, k);
    const c = at(i, k + 1);
    const d = at(i, k - 1);
    const ds: P3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dk: P3 = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    let n: P3 = [ds[1] * dk[2] - ds[2] * dk[1], ds[2] * dk[0] - ds[0] * dk[2], ds[0] * dk[1] - ds[1] * dk[0]];
    const p = grid[i][k];
    const out: P3 = [0, p[1], p[2] - bed - 0.8];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    return new THREE.Vector3(n[0], n[2], -n[1]).normalize();
  };
  const mottle: ShadeFn = (p, _ny, o) => {
    const v = 0.82 + 0.3 * (Math.sin(p[0] * 9.1 + p[2] * 6.3) * 0.5 + 0.5) * (Math.sin(p[1] * 11.7 - p[0] * 4.1 + p[2] * 3.0) * 0.5 + 0.5);
    o[0] *= v;
    o[1] *= v;
    o[2] *= v * 0.96;
  };
  gr.withShade(mottle, () => {
    for (let i = 0; i + 1 < ns; i++)
      for (let k = 0; k + 1 < K; k++) {
        const a = grid[i][k];
        const b = grid[i][k + 1];
        const c = grid[i + 1][k + 1];
        const d = grid[i + 1][k];
        const na = nrm(i, k);
        const nb = nrm(i, k + 1);
        const nc = nrm(i + 1, k + 1);
        const nd = nrm(i + 1, k);
        // wind outwards: geometric normal of (a, d, c) against the averaged vertex normal
        const e1: P3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const e2: P3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const gn = new THREE.Vector3(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        const g3 = new THREE.Vector3(gn.x, gn.z, -gn.y);
        if (g3.dot(na.clone().add(nc)) >= 0) {
          gr.tri(hay, a, d, c, [na, nd, nc]);
          gr.tri(hay, a, c, b, [na, nc, nb]);
        } else {
          gr.tri(hay, a, c, d, [na, nc, nd]);
          gr.tri(hay, a, b, c, [na, nb, nc]);
        }
      }
    // end caps
    gr.polygonFacing(hay, grid[0], [-1, 0, 0]);
    gr.polygonFacing(hay, grid[ns - 1], [1, 0, 0]);
  });
  // a binding pole (Wiesbaum) along the crown
  if (lod >= 1) {
    const crown = bed + LH * 0.98;
    g.box(wood, s0 - 0.3, s1 + 0.3, -0.06, 0.06, crown - 0.04, crown + 0.08);
  }
}

// ------------------------------------------------------------------------------------------- aviary (KB-I39)

function aviary(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, lod: number): void {
  const V = FOLLY.aviary;
  const { l } = extents(L);
  const base = L.stack.base_h;
  const foot = L.stack.plinth.bottom_h;
  const rc = V.core / 2;
  const ring = polygonRing(8, rc, Math.PI / 8);
  // rendered octagonal core with a plinth and a slate pyramid, a door on the court side
  prism(g, pal.plinth, polygonRing(8, rc + 0.06, Math.PI / 8), foot, base + 0.3);
  prism(g, pal.wall, ring, base + 0.3, base + V.coreEaves, false);
  prism(g, pal.members, polygonRing(8, rc + 0.1, Math.PI / 8), base + V.coreEaves - 0.25, base + V.coreEaves, false);
  const apex = base + V.coreEaves + (rc + 0.3) * Math.tan((V.pitch * Math.PI) / 180);
  lathe(gr, matKey('roof.slate'), [
    [rc + 0.35, base + V.coreEaves - 0.05],
    [0, apex],
  ], 8, Math.PI / 8);
  gr.polygonFacing(matKey('roof.slate'), polygonRing(8, rc + 0.35, Math.PI / 8).map((p): P3 => [p[0], p[1], base + V.coreEaves - 0.05]), [0, 0, -1]);
  column(gr, matKey('metal.gilt'), [0, 0], 0.05, apex - 0.05, apex + 0.5, 6);
  const di = entranceIndex(L, ring);
  const a = ring[di];
  const b = ring[(di + 1) % 8];
  const m: ST = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ml = Math.hypot(m[0], m[1]) || 1;
  const nrm: ST = [m[0] / ml, m[1] / ml];
  const tan: ST = [-nrm[1], nrm[0]];
  g.orientedBox(matKey('wood.door', '#5A4632'), [m[0] + nrm[0] * 0.02, m[1] + nrm[1] * 0.02], tan, nrm, -0.55, 0.55, 0, 0.04, base + 0.3, base + 2.5);
  // two wire-cage wings along ±s: corner posts, top rails, a ridge; bars at LOD2 (iron: not in the light layer)
  const wire = matKey('metal.iron', V.wire);
  const w2 = Math.min(V.wing, l - rc);
  const hw = 1.5;
  for (const sg of [-1, 1]) {
    const s0 = sg * (rc - 0.2);
    const s1 = sg * (rc - 0.2 + w2);
    const sa = Math.min(s0, s1);
    const sb = Math.max(s0, s1);
    // low sandstone curb
    g.box(pal.plinth, sa, sb, -hw, hw, foot, base + 0.25);
    const posts: ST[] = [
      [s1, -hw],
      [s1, hw],
      [(s0 + s1) / 2, -hw],
      [(s0 + s1) / 2, hw],
    ];
    for (const p of posts) g.box(wire, p[0] - V.post / 2, p[0] + V.post / 2, p[1] - V.post / 2, p[1] + V.post / 2, base + 0.25, base + V.wingH);
    for (const t of [-hw, hw]) g.box(wire, sa, sb, t - V.post / 2, t + V.post / 2, base + V.wingH - V.post, base + V.wingH);
    g.box(wire, s1 - V.post / 2, s1 + V.post / 2, -hw, hw, base + V.wingH - V.post, base + V.wingH);
    g.box(wire, sa, sb, -V.post / 2, V.post / 2, base + V.wingH + 0.6 - V.post, base + V.wingH + 0.6);
    if (lod >= 2) {
      for (let s = sa + V.bars; s < sb; s += V.bars)
        for (const t of [-hw, hw]) g.box(wire, s - 0.012, s + 0.012, t - 0.012, t + 0.012, base + 0.25, base + V.wingH);
      for (let t = -hw + V.bars; t < hw; t += V.bars) g.box(wire, s1 - 0.012, s1 + 0.012, t - 0.012, t + 0.012, base + 0.25, base + V.wingH);
      // gable wires up to the ridge
      for (let s = sa + V.bars; s < sb; s += V.bars * 2)
        for (const t of [-hw, hw]) g.quadFacing(wire, [s - 0.012, t, base + V.wingH], [s + 0.012, t, base + V.wingH], [s + 0.012, 0, base + V.wingH + 0.6], [s - 0.012, 0, base + V.wingH + 0.6], [0, Math.sign(t), 1]);
    }
  }
}

// ------------------------------------------------------------------------------------------- Monopteros (KB-I30)

function monopteros(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, lod: number): void {
  const M = FOLLY.monopteros;
  const R = (L.frame.radius ?? Math.min(L.frame.length, L.frame.width) / 2) - 0.1;
  const seg = lod >= 2 ? 24 : lod >= 1 ? 16 : 8;
  const foot = L.stack.plinth.bottom_h;
  const stone = matKey('stone.grey', '#CFC8BA');
  // stylobate: steps from the foot up to the floor
  let h = L.stack.base_h;
  for (let k = 0; k < M.steps; k++) {
    const r = R - k * 0.35;
    prism(g, stone, polygonRing(seg, r, 0), k === 0 ? foot : h, h + M.step);
    h += M.step;
  }
  const floor = h;
  const r = M.column / 2;
  const rc = R - M.steps * 0.35 - r - 0.2;
  const top = floor + M.height; // top of the abacus = underside of the architrave
  const cn = lod >= 2 ? 12 : lod >= 1 ? 8 : 6;
  const B = M.base;
  const C = M.capital;
  const shaft0 = floor + B.plinth + B.torus;
  const capTop = top;
  const aba0 = capTop - C.abacus;
  const ech0 = aba0 - C.echinus;
  const neck0 = ech0 - C.necking;
  for (let i = 0; i < M.columns; i++) {
    const a = (i / M.columns) * Math.PI * 2 + Math.PI / M.columns;
    const c: ST = [rc * Math.cos(a), rc * Math.sin(a)];
    const sq = r * 1.25;
    // Tuscan base: square plinth and a torus
    g.box(stone, c[0] - sq, c[0] + sq, c[1] - sq, c[1] + sq, floor, floor + B.plinth);
    lathe(g, stone, lod >= 2 ? [
      [r * 1.2, floor + B.plinth],
      [r * 1.24, floor + B.plinth + B.torus * 0.45],
      [r * 1.12, floor + B.plinth + B.torus * 0.9],
      [r, shaft0],
    ] : [
      [r * 1.22, floor + B.plinth],
      [r * 1.15, floor + B.plinth + B.torus * 0.8],
      [r, shaft0],
    ], cn, 0, false, c);
    // shaft with a slight diminution in the upper two thirds (entasis) [N]
    lathe(g, pal.wall, [
      [r, shaft0],
      [r * 0.99, shaft0 + (neck0 - shaft0) / 3],
      [r * 0.86, neck0],
    ], cn, 0, false, c);
    // capital: necking (astragal) at LOD2, quarter-round echinus, square abacus
    if (lod >= 2)
      lathe(g, stone, [
        [r * 0.86, neck0],
        [r * 0.95, neck0 + C.necking * 0.5],
        [r * 0.88, ech0],
      ], cn, 0, false, c);
    else lathe(g, stone, [[r * 0.86, neck0], [r * 0.88, ech0]], cn, 0, false, c);
    lathe(g, stone, lod >= 1 ? [
      [r * 0.88, ech0],
      [r * 1.08, ech0 + C.echinus * 0.55],
      [r * 1.2, aba0],
    ] : [[r * 0.88, ech0], [r * 1.2, aba0]], cn, 0, false, c);
    g.box(stone, c[0] - sq, c[0] + sq, c[1] - sq, c[1] + sq, aba0, capTop);
  }
  // entablature: architrave in two fasciae, a recessed frieze, a cornice (bed moulding + projecting corona); the
  // inner face and the soffit close the ring
  const ro = rc + r * 1.2;
  const ri = rc - r * 1.2;
  const eA = top + M.architrave;
  const eF = eA + M.frieze;
  const eT = top + M.entablature;
  const pr = M.corniceProjection;
  prism(g, stone, polygonRing(seg, ro - 0.03, 0), top, top + M.architrave * 0.45, false);
  prism(g, stone, polygonRing(seg, ro, 0), top + M.architrave * 0.45, eA, false);
  prism(g, pal.wall, polygonRing(seg, ro - 0.05, 0), eA, eF, false);
  prism(g, stone, polygonRing(seg, ro + pr * 0.4, 0), eF, eF + 0.09, false);
  prism(g, stone, polygonRing(seg, ro + pr, 0), eF + 0.09, eT, false);
  // soffits under the bed moulding and the corona (annuli facing down)
  const annulus = (rIn: number, rOut: number, hh: number, up: boolean) => {
    const a = polygonRing(seg, rIn, 0);
    const b = polygonRing(seg, rOut, 0);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      g.quadFacing(stone, [a[i][0], a[i][1], hh], [a[j][0], a[j][1], hh], [b[j][0], b[j][1], hh], [b[i][0], b[i][1], hh], [0, 0, up ? 1 : -1]);
    }
  };
  annulus(ro - 0.05, ro + pr * 0.4, eF, false);
  annulus(ro + pr * 0.4, ro + pr, eF + 0.09, false);
  annulus(ri, ro, top, false);
  annulus(ro - 0.05, ro, eA, true); // ledge on the upper fascia
  g.polygonFacing(stone, polygonRing(seg, ri, 0).map((p): P3 => [p[0], p[1], eT]), [0, 0, -1]); // ceiling under the dome
  lathe(g, stone, [
    [ri, top],
    [ri, eT],
  ], seg, 0, true);
  // lead dome (rise 0.5 × radius) springing from a step behind the cornice edge, with a gilt ball finial on a neck
  const domeR = ro + 0.02;
  annulus(domeR, ro + pr, eT, true);
  const rise = domeR * M.domeRise;
  const ds = lod >= 2 ? M.domeSegments : lod >= 1 ? 20 : 12;
  const k = lod >= 2 ? 8 : lod >= 1 ? 5 : 3;
  const prof: [number, number][] = [];
  for (let j = 0; j <= k; j++) {
    const u = (j / k) * (Math.PI / 2);
    prof.push([domeR * Math.cos(u), eT + rise * Math.sin(u)]);
  }
  prof[prof.length - 1][0] = 0;
  lathe(gr, matKey('roof.lead', M.domeColour), prof, ds, 0);
  const apex = eT + rise;
  const b = M.finialBall / 2;
  const fin: [number, number][] = [
    [0.16, apex - 0.04],
    [0.07, apex + 0.08],
    [0.05, apex + 0.16],
    [0.1, apex + 0.2],
    [0.05, apex + 0.24],
  ];
  const nb = lod >= 1 ? 6 : 3;
  for (let j = 0; j <= nb; j++) {
    const u = -Math.PI / 2 + 0.35 + ((Math.PI - 0.35) * j) / nb;
    fin.push([Math.max(0, b * Math.cos(u)), apex + 0.24 + b + b * Math.sin(u)]);
  }
  fin[fin.length - 1][0] = 0;
  lathe(gr, matKey('metal.gilt'), fin, lod >= 2 ? 10 : lod >= 1 ? 8 : 6, 0);
}

// ------------------------------------------------------------------------------------------- Bienenhaus (KB-I30)

function apiary(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, lod: number): void {
  const B = FOLLY.apiary;
  const sd = L.frame.sides[sideFacing(L, 180)];
  const len = sd.length;
  const depth = sd.name === 'garden' || sd.name === 'court' ? L.frame.width : L.frame.length;
  const tan = sd.tangent;
  const out: ST = sd.normal;
  const inn: ST = [-out[0], -out[1]];
  const timber = matKey('wood.door', B.timber);
  const straw = matKey('roof.thatch', B.straw);
  const base = L.stack.base_h;
  const foot = L.stack.plinth.bottom_h;
  // a along the open front from p0, d inwards
  const ob = (k: MatKey, a0: number, a1: number, d0: number, d1: number, h0: number, h1: number) =>
    g.orientedBox(k, [sd.p0[0] + inn[0] * d1, sd.p0[1] + inn[1] * d1], tan, out, a0, a1, 0, d1 - d0, h0, h1);
  // back wall (boards), end walls, corner posts at the front, three shelves
  ob(timber, 0, len, depth - 0.08, depth, foot, base + B.back);
  for (const [a0, a1] of [
    [0, 0.08],
    [len - 0.08, len],
  ])
    g.orientedBox(timber, [sd.p0[0] + inn[0] * depth, sd.p0[1] + inn[1] * depth], tan, out, a0, a1, 0, depth, foot, base + B.front);
  for (const sh of B.shelves) ob(timber, 0.08, len - 0.08, 0.15, depth - 0.08, base + sh - 0.05, base + sh);
  // skeps (straw domes) on each shelf
  const cs = skepCentres(len - 0.3);
  const seg = lod >= 2 ? 8 : 5;
  if (lod >= 1)
    for (const sh of B.shelves)
      for (const a of cs) {
        const c: ST = [sd.p0[0] + tan[0] * (len / 2 + a) + inn[0] * (depth / 2), sd.p0[1] + tan[1] * (len / 2 + a) + inn[1] * (depth / 2)];
        const r = B.skep / 2;
        const prof: [number, number][] = [
          [r, base + sh],
          [r * 0.92, base + sh + B.skepH * 0.55],
          [r * 0.55, base + sh + B.skepH * 0.9],
          [0, base + sh + B.skepH],
        ];
        for (let j = 0; j + 1 < prof.length; j++)
          for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2;
            const a1 = ((i + 1) / seg) * Math.PI * 2;
            const P = (rr: number, an: number, hh: number): P3 => [c[0] + rr * Math.cos(an), c[1] + rr * Math.sin(an), hh];
            const am = (a0 + a1) / 2;
            const dir: P3 = [Math.cos(am), Math.sin(am), 0.6];
            if (prof[j + 1][0] < 1e-6) gr.polygonFacing(straw, [P(prof[j][0], a0, prof[j][1]), P(prof[j][0], a1, prof[j][1]), P(0, a0, prof[j + 1][1])], dir);
            else gr.quadFacing(straw, P(prof[j][0], a0, prof[j][1]), P(prof[j][0], a1, prof[j][1]), P(prof[j + 1][0], a1, prof[j + 1][1]), P(prof[j + 1][0], a0, prof[j + 1][1]), dir);
          }
      }
  // tiled lean-to roof falling to the open front (overhang 0.4 m)
  const Q = (a: number, d: number, h: number): P3 => [sd.p0[0] + tan[0] * a + inn[0] * d, sd.p0[1] + tan[1] * a + inn[1] * d, h];
  const k = matKey('roof.tile');
  const hb = base + B.back + 0.1;
  const hf = base + B.front - 0.1;
  gr.quadFacing(k, Q(-0.3, -0.45, hf - 0.08), Q(len + 0.3, -0.45, hf - 0.08), Q(len + 0.3, depth + 0.2, hb), Q(-0.3, depth + 0.2, hb), [out[0], out[1], 1]);
  gr.quadFacing(k, Q(-0.3, -0.45, hf - 0.14), Q(len + 0.3, -0.45, hf - 0.14), Q(len + 0.3, depth + 0.2, hb - 0.06), Q(-0.3, depth + 0.2, hb - 0.06), [-out[0], -out[1], -1]);
}

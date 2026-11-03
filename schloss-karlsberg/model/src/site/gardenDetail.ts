/**
 * Wave-5 garden detail (KB-I33, KB-I34, KB-I36; research/11 S6-S8, S11; GARDEN_DETAIL in layout/grammar.ts):
 * - parterre à l'angloise (lawn panels with cut corners, sanded sentiers, raised box-edged plates-bandes with border
 *   flowers, yew cones and standard roses) for a `parterre` / `terrace` feature with `parterre`,
 * - green treillage with arched portals round a feature with `fence`,
 * - citrus tubs (oak, painted green, iron bands) on the walk edges,
 * - garden furniture (`furniture` features: green benches, on slopes on a levelled platform; the Flora herm),
 * - the kitchen / forcing garden (`beds` features: beds in quarters with crop rows, hotbed frames, espaliered fruit).
 *
 * All layout numbers come from layout/garden.ts (pure, tested) and GARDEN_DETAIL; this file only turns them into
 * GeoBuilder geometry in the local frame (plan s = x = E − E0, t = −z = N − N0, h = absolute height).
 */
import * as THREE from 'three';
import type { BuildContext } from '../context.ts';
import { E0, N0, gridFrame } from '../frame.ts';
import { type P2, hashString, mulberry32, pointInPolygon } from '../layout/geom.ts';
import { type AngloiseLayout, distanceToLine, kitchenBeds, parterreAnglaise, type RectUV } from '../layout/garden.ts';
import { GARDEN_DETAIL, HOTBED_LIGHT } from '../layout/grammar.ts';
import { hotbedLightStates, lightSection } from './hotbed.ts';
import type { EN, GardenItem, SiteSpec, TerrainFeature } from '../spec.ts';
import { type GeoBuilder, type MatKey, matKey } from '../exterior/builder.ts';
import { type HedgeProfilePoint, hedgeProfile } from './hedgeProfile.ts';

type P3 = [number, number, number];

export interface GardenDetailEnv {
  gb: GeoBuilder;
  spec: SiteSpec;
  ctx: BuildContext;
  /** ground height at local (x, z); NaN outside the terrain */
  terr: (x: number, z: number) => number;
  /** add a tree instance (species key, local x, z, scale, optional base height instead of the ground) */
  addTree: (key: string, x: number, z: number, scale?: number, y?: number) => void;
  /** footprints (EN rings) of the buildings standing in this build */
  buildingRings: EN[][];
}

const plan = (E: number, N: number): P2 => [E - E0, N - N0];

const _hn: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

/**
 * KB-I45 (wave 7): a clipped hedge or box edging along `tan` from a0 to a1 (plan origin `o`, across `nrm`), with the
 * battered, bevelled cross-section of `hedgeProfile` (d across, h absolute) and smooth normals across the profile, so
 * the shoulder catches a soft light edge. `caps` closes the start / end (inner joins of a run stay open).
 */
export function extrudeHedge(gb: GeoBuilder, k: MatKey, o: P2, tan: P2, nrm: P2, a0: number, a1: number, prof: readonly HedgeProfilePoint[], caps: [boolean, boolean] = [true, true]): void {
  const at = (a: number, p: HedgeProfilePoint): P3 => [o[0] + tan[0] * a + nrm[0] * p.d, o[1] + tan[1] * a + nrm[1] * p.d, p.h];
  // object-space normal of a profile point (builder space [s, t, h] → three (s, h, −t))
  const nv = (v: THREE.Vector3, p: HedgeProfilePoint) => v.set(nrm[0] * p.nd, p.nh, -(nrm[1] * p.nd));
  const tri = (p0: P3, p1: P3, p2: P3, q0: HedgeProfilePoint, q1: HedgeProfilePoint, q2: HedgeProfilePoint) => {
    // wind counter-clockwise toward the mean of the smooth normals
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const n: P3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const ds = nrm[0] * (q0.nd + q1.nd + q2.nd);
    const dt = nrm[1] * (q0.nd + q1.nd + q2.nd);
    const dh = q0.nh + q1.nh + q2.nh;
    if (n[0] * ds + n[1] * dt + n[2] * dh >= 0) gb.tri(k, p0, p1, p2, [nv(_hn[0], q0), nv(_hn[1], q1), nv(_hn[2], q2)]);
    else gb.tri(k, p0, p2, p1, [nv(_hn[0], q0), nv(_hn[1], q2), nv(_hn[2], q1)]);
  };
  for (let i = 0; i + 1 < prof.length; i++) {
    const q0 = prof[i];
    const q1 = prof[i + 1];
    const A0 = at(a0, q0);
    const A1 = at(a1, q0);
    const B0 = at(a0, q1);
    const B1 = at(a1, q1);
    tri(A0, A1, B1, q0, q0, q1);
    tri(A0, B1, B0, q0, q1, q1);
  }
  for (const [end, on] of [
    [a0, caps[0]],
    [a1, caps[1]],
  ] as const) {
    if (!on) continue;
    const pts = prof.map((p) => at(end, p));
    const dir: P3 = end === a0 ? [-tan[0], -tan[1], 0] : [tan[0], tan[1], 0];
    gb.polygonFacing(k, pts, dir);
  }
}

/** Ground height at a plan point (s, t), with a fallback. */
function groundAt(env: GardenDetailEnv, s: number, t: number, fb: number): number {
  const y = env.terr(s, -t);
  return Number.isFinite(y) ? y : fb;
}

/**
 * A low rounded clump (wave-5 fix: border flowers read as cubes): an `n`-sided dome of radius `r` and height `h` on
 * (s, t, y0), two rings and an apex, with a slightly ragged rim [N; I].
 */
function dome(gb: GeoBuilder, k: MatKey, s: number, t: number, y0: number, r: number, h: number, n: number): void {
  const ring = (f: number, z: number, rot: number): P3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i + rot) / n) * Math.PI * 2;
      const j = 0.9 + 0.2 * (((i * 7 + n) % 5) / 4);
      return [s + Math.cos(a) * r * f * j, t + Math.sin(a) * r * f * j, z] as P3;
    });
  const r0 = ring(1, y0, 0);
  const r1 = ring(0.78, y0 + h * 0.62, 0.5);
  const top: P3 = [s, t, y0 + h];
  const tf = (a: P3, b: P3, c: P3) => {
    // face outward from the dome axis (centroid minus a point on the axis a little below)
    const m: P3 = [(a[0] + b[0] + c[0]) / 3 - s, (a[1] + b[1] + c[1]) / 3 - t, (a[2] + b[2] + c[2]) / 3 - (y0 + h * 0.2)];
    const n: P3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) gb.tri(k, a, b, c);
    else gb.tri(k, a, c, b);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tf(r0[i], r0[j], r1[i]);
    tf(r0[j], r1[j], r1[i]);
    tf(r1[i], r1[j], top);
  }
}

/** Axis-aligned (in u, v) rectangle of a feature ring in the palace grid. */
function ringRectUV(ringEN: readonly EN[], toUV: (E: number, N: number) => [number, number]): RectUV {
  const uv = ringEN.map(([E, N]) => toUV(E, N));
  return {
    u0: Math.min(...uv.map((p) => p[0])),
    u1: Math.max(...uv.map((p) => p[0])),
    v0: Math.min(...uv.map((p) => p[1])),
    v1: Math.max(...uv.map((p) => p[1])),
  };
}

// ------------------------------------------------------------------------------------------------ parterre à l'angloise

/**
 * Wave 6 (pose 30: the parterre read as a field of lollipops and dark cones): the plantings actually drawn from the
 * layout's marks. A parterre à l'angloise is lawn-dominated [N d'Argenville 1747, research/11 §4.3], so per compartment
 * only the four corner cones of the plate-bande stay (the side-middle cones go) and one standard rose midway on each long
 * side (the nearest mark to the side's middle) [N; I thinning]. Pure; tested in model/tests/garden-wave6.test.ts.
 */
export function sparsePlantings(lay: Pick<AngloiseLayout, 'compartments' | 'cones' | 'roses'>): { cones: P2[]; roses: P2[] } {
  const cones: P2[] = [];
  const roses: P2[] = [];
  const inside = (p: P2, r: RectUV) => p[0] >= r.u0 - 1e-6 && p[0] <= r.u1 + 1e-6 && p[1] >= r.v0 - 1e-6 && p[1] <= r.v1 + 1e-6;
  for (const c of lay.compartments) {
    const r = c.outer;
    const mine = lay.cones.filter((p) => inside(p, r));
    for (const [cu, cv] of [
      [r.u0, r.v0],
      [r.u1, r.v0],
      [r.u1, r.v1],
      [r.u0, r.v1],
    ]) {
      let best: P2 | null = null;
      let bd = Infinity;
      for (const p of mine) {
        const d = Math.hypot(p[0] - cu, p[1] - cv);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best && !cones.includes(best)) cones.push(best);
    }
    const mu = (r.u0 + r.u1) / 2;
    const mv = (r.v0 + r.v1) / 2;
    const longU = r.u1 - r.u0 >= r.v1 - r.v0;
    const rs = lay.roses.filter((p) => inside(p, r));
    for (const side of [-1, 1]) {
      const half = rs.filter((p) => (longU ? Math.sign(p[1] - mv) : Math.sign(p[0] - mu)) === side);
      half.sort((a, b) => (longU ? Math.abs(a[0] - mu) - Math.abs(b[0] - mu) : Math.abs(a[1] - mv) - Math.abs(b[1] - mv)));
      if (half.length) roses.push(half[0]);
    }
  }
  return { cones, roses };
}

/**
 * KB-I34: a parterre à l'angloise on the polygon of `f` (palace grid u, v), at the levelled ground (`f.level` or the
 * terrain). Lawn panels and the sanded field are thin draped plates; the plates-bandes are raised soil bands with box
 * edging on both sides, a speckle of July border flowers, yew cones (instanced trees) and standard roses.
 */
export function buildAngloise(env: GardenDetailEnv, f: TerrainFeature): void {
  const ringEN = f.geometry.type === 'Polygon' ? (f.geometry.coordinates[0] as EN[]) : null;
  if (!ringEN || !f.parterre) return;
  const { gb } = env;
  const A = GARDEN_DETAIL.angloise;
  const B = GARDEN_DETAIL.box;
  const grid = gridFrame(env.spec.palace_grid);
  const r = ringRectUV(ringEN, grid.toUV);
  const lay = parterreAnglaise(r, { panels: f.parterre.panels, crossWalk: f.parterre.cross_walk, tubs: f.parterre.tubs });
  const fb = f.level ?? groundAt(env, ...plan(...grid.toEN((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2)), 340);
  const P = (u: number, v: number): P2 => plan(...grid.toEN(u, v));
  const h = (u: number, v: number) => {
    const [s, t] = P(u, v);
    return groundAt(env, s, t, fb);
  };
  const lod = env.ctx.lod;
  const rnd = mulberry32(hashString(f.id) ^ env.ctx.options.seed);
  // wave 8 (KB-I14): sentier and ground in yellow sand, d'Argenville's "yellow-sanded" parterre (research/11 §4.3, S7) [N]; hue I
  const sandK = matKey('ground.gravel', '#D3BE8A');
  const lawnK = matKey('ground.grass', '#6E8E46');
  const soilK = matKey('ground.gravel', '#6A5443');
  const boxK = matKey('ground.grass', '#2F4A27');
  const flowerK = GARDEN_DETAIL.borderFlowers.colours.map((c) => matKey('ground.grass', c));
  const perennK = matKey('ground.grass', '#4E6B34');
  const up: P3 = [0, 0, 1];

  // sanded field (sentiers and walks): one plate over the whole parterre, 3 cm above the ground (the ground class under
  // it is the parterre sand too, this plate only keeps the colour crisp at the panel edges)
  const plate = (k: MatKey, ring: readonly P2[], lift: number) => {
    const pts = ring.slice(0, -1);
    // triangulate per edge as a fan around the centroid so a draped plate follows small slopes
    const c: P2 = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const pc = P(c[0], c[1]);
    const cc: P3 = [pc[0], pc[1], h(c[0], c[1]) + lift];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const pa = P(a[0], a[1]);
      const pb = P(b[0], b[1]);
      gb.polygonFacing(k, [cc, [pa[0], pa[1], h(a[0], a[1]) + lift], [pb[0], pb[1], h(b[0], b[1]) + lift]], up);
    }
  };
  const fieldRing: P2[] = [
    [lay.field.u0, lay.field.v0],
    [lay.field.u1, lay.field.v0],
    [lay.field.u1, lay.field.v1],
    [lay.field.u0, lay.field.v1],
    [lay.field.u0, lay.field.v0],
  ];
  plate(sandK, fieldRing, 0.03);
  for (const c of lay.compartments) {
    plate(lawnK, c.panel, 0.05);
    // plate-bande: four raised soil bands with box edging on both sides
    const o = c.outer;
    const bi = c.bandInner;
    const bands: [P2, P2, number][] = [
      // centre line from a to b, width
      [[o.u0, (o.v0 + bi.v0) / 2], [o.u1, (o.v0 + bi.v0) / 2], bi.v0 - o.v0],
      [[o.u0, (o.v1 + bi.v1) / 2], [o.u1, (o.v1 + bi.v1) / 2], o.v1 - bi.v1],
      [[(o.u0 + bi.u0) / 2, bi.v0], [(o.u0 + bi.u0) / 2, bi.v1], bi.u0 - o.u0],
      [[(o.u1 + bi.u1) / 2, bi.v0], [(o.u1 + bi.u1) / 2, bi.v1], o.u1 - bi.u1],
    ];
    for (const [a, b, w] of bands) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / 4));
      const tu: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      for (let k = 0; k < n; k++) {
        const m0: P2 = [a[0] + tu[0] * (L * k) / n, a[1] + tu[1] * (L * k) / n];
        const m1: P2 = [a[0] + tu[0] * (L * (k + 1)) / n, a[1] + tu[1] * (L * (k + 1)) / n];
        const p0 = P(m0[0], m0[1]);
        const p1 = P(m1[0], m1[1]);
        const tl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const tan: P2 = [(p1[0] - p0[0]) / tl, (p1[1] - p0[1]) / tl];
        const nrm: P2 = [tan[1], -tan[0]];
        const y = h((m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2);
        gb.orientedBox(soilK, p0, tan, nrm, 0, tl, -w / 2 + B.thickness, w / 2 - B.thickness, y - 0.05, y + A.raise);
        for (const side of [-1, 1]) {
          const d = (side * w) / 2;
          const d0 = side < 0 ? d : d - B.thickness;
          // KB-I45 (wave 7): battered, bevelled box edging with a rounded shoulder (was two stacked boxes)
          extrudeHedge(gb, boxK, p0, tan, nrm, 0, tl, hedgeProfile(d0, d0 + B.thickness, y - 0.05, y + A.raise + B.height, B.bevel), [k === 0, k === n - 1]);
        }
        // July border flowers (wave-5 fix): rounded leafy clumps with a flower cap, spaced out so the box edge and the
        // soil show; a few tall hollyhock / sunflower spires only on the band's centre line [HMS; N; I]
        if (lod <= 1) {
          const nf = Math.round((tl / 0.55) * GARDEN_DETAIL.borderFlowers.share);
          for (let q = 0; q < nf; q++) {
            const at = rnd() * tl;
            const dd = (rnd() - 0.5) * (w - 2 * B.thickness - 0.35);
            const k = flowerK[Math.floor(rnd() * flowerK.length)];
            const y0 = y + A.raise;
            const cs = p0[0] + tan[0] * at + nrm[0] * dd;
            const ct = p0[1] + tan[1] * at + nrm[1] * dd;
            if (rnd() < GARDEN_DETAIL.borderFlowers.tallShare) {
              const cs2 = p0[0] + tan[0] * at;
              const ct2 = p0[1] + tan[1] * at;
              const hh = 1.3 + rnd() * 0.4;
              // leafy lower spire, then flower rosettes up the top third
              dome(gb, perennK, cs2, ct2, y0, 0.2, 0.45, 6);
              gb.orientedBox(perennK, p0, tan, nrm, at - 0.025, at + 0.025, -0.025, 0.025, y0 + 0.3, y0 + hh, false, 'caps');
              for (let f = 0; f < 3; f++) dome(gb, k, cs2, ct2, y0 + hh * (0.66 + f * 0.11), 0.07 - f * 0.012, 0.09, 5);
              continue;
            }
            const rr = 0.13 + rnd() * 0.08;
            const hh = 0.2 + rnd() * 0.16;
            dome(gb, perennK, cs, ct, y0 - 0.02, rr, hh, 7);
            // two in five clumps are leafy perennials not in flower (July) [N]
            if (rnd() < 0.6) dome(gb, k, cs, ct, y0 + hh * 0.62, rr * 0.72, hh * 0.5, 6);
          }
        }
      }
    }
  }
  // yew cones on the plate-bande corners (instanced trees), one standard rose on each long side (sparsePlantings)
  const yew = 1.35 / 1.0; // cones ≈ 1.35 m ±20 % (SPECIES.taxus_cone is 1.0 m) [N d'Argenville: clipped yews, I height]
  const sparse = sparsePlantings(lay);
  for (const [u, v] of sparse.cones) {
    const [s, t] = P(u, v);
    env.addTree('taxus_cone', s, -t, yew, h(u, v) + A.raise);
  }
  // standard roses (instanced, SPECIES.rosa_standard: stem + a small head in bloom) between the cones
  const rose = (A.roseStem + A.roseCrown) / 1.55;
  for (const [u, v] of sparse.roses) {
    const [s, t] = P(u, v);
    env.addTree('rosa_standard', s, -t, rose, h(u, v) + A.raise);
  }
  for (const [u, v] of lay.tubs) {
    const [s, t] = P(u, v);
    citrusTub(env, s, t, h(u, v));
  }
}

/** One summer citrus tub (GARDEN_DETAIL.tub): green oak box with iron corner bands and top / bottom hoops, a standard. */
export function citrusTub(env: GardenDetailEnv, s: number, t: number, y: number): void {
  const T = GARDEN_DETAIL.tub;
  const { gb } = env;
  const wood = matKey('wood.shutter', T.colour);
  const iron = matKey('metal.iron', T.iron);
  const a = T.size / 2;
  gb.box(wood, s - a, s + a, t - a, t + a, y - 0.05, y + T.height);
  // corner bands (slightly proud) and two hoops
  for (const [cs, ct] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const e = T.band / 2 + 0.01;
    gb.box(iron, s + cs * a - e, s + cs * a + e, t + ct * a - e, t + ct * a + e, y - 0.04, y + T.height + 0.02);
  }
  for (const hh of [0.12, T.height - 0.14]) gb.box(iron, s - a - 0.012, s + a + 0.012, t - a - 0.012, t + a + 0.012, y + hh, y + hh + T.band);
  // knob feet at the top corners [N]: four small finials
  for (const [cs, ct] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    gb.box(wood, s + cs * a - 0.05, s + cs * a + 0.05, t + ct * a - 0.05, t + ct * a + 0.05, y + T.height, y + T.height + 0.09);
  // citrus standard: SPECIES.citrus is 2.2 m (stem 1.1); scaled to stem 1.2 + crown 1.6 = 2.8 m [N]
  env.addTree('citrus', s, -t, (T.citrusStem + T.citrusCrown) / 2.2, y + T.height - 0.05);
}

// ------------------------------------------------------------------------------------------------ treillage

/**
 * KB-I34: green treillage round the polygon of `f` (GARDEN_DETAIL.treillage), set `inset` m inside the edge, on every
 * edge that does not run against a building (`fence.open_edges` or a building footprint within 2.5 m outside), with an
 * arched portal at each `fence.portals` point (nearest edge). Wave 6: flat lattice pilasters (`pier`) every `post` m
 * and framed bays between them (bottom, dado, frieze and top rails, stiles, a projecting cornice), a close square
 * lattice below the dado, a square lattice (`mesh`) in the field and a diagonal frieze, laths `lath` wide; lattice
 * pilasters and an arched head at each portal. (Wave 5's unframed diagonal lattice on slim posts still read as a
 * modern mesh fence at pose 30.) [N period treillage; I dims]
 */
export function buildTreillage(env: GardenDetailEnv, f: TerrainFeature): void {
  const ringEN = f.geometry.type === 'Polygon' ? (f.geometry.coordinates[0] as EN[]) : null;
  const fence = f.fence;
  if (!ringEN || !fence) return;
  const T = GARDEN_DETAIL.treillage;
  const { gb } = env;
  const k = matKey('wood.frame', T.colour);
  const inset = 0.45;
  const pts = ringEN.slice(0, -1).map(([E, N]) => plan(E, N));
  // inward normal per edge: toward the polygon centroid
  const c: P2 = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const level = f.level;
  const H = fence.height;
    const portals = fence.portals.map(([E, N]) => plan(E, N));
  const blocked = (p: P2) => env.buildingRings.some((r) => pointInPolygon([p[0] + E0, p[1] + N0], r));
  for (let i = 0; i < pts.length; i++) {
    if (fence.open_edges?.includes(i)) continue;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    const tan: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let inn: P2 = [-tan[1], tan[0]];
    const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ((c[0] - mid[0]) * inn[0] + (c[1] - mid[1]) * inn[1] < 0) inn = [-inn[0], -inn[1]];
    const out: P2 = [-inn[0], -inn[1]];
    if (blocked([mid[0] + out[0] * 2.5, mid[1] + out[1] * 2.5])) continue;
    // the fence line, shortened at both ends by the inset so neighbouring edges meet at the corner
    const o: P2 = [a[0] + inn[0] * inset + tan[0] * inset, a[1] + inn[1] * inset + tan[1] * inset];
    const len = L - 2 * inset;
    const y = (d: number) => {
      const s = o[0] + tan[0] * d;
      const t = o[1] + tan[1] * d;
      return level ?? groundAt(env, s, t, 340);
    };
    // portal spans on this edge
    const spans: [number, number][] = [];
    for (const p of portals) {
      const d = (p[0] - o[0]) * tan[0] + (p[1] - o[1]) * tan[1];
      const off = Math.abs((p[0] - o[0]) * inn[0] + (p[1] - o[1]) * inn[1]);
      if (off < 2.5 && d > 0 && d < len) spans.push([d - T.portalWidth / 2, d + T.portalWidth / 2]);
    }
    const inPortal = (d: number, pad = 0) => spans.some(([s0, s1]) => d > s0 - pad && d < s1 + pad);
    const nPost = Math.max(1, Math.round(len / T.post));
    const step = len / nPost;
    // a lath in the fence plane from (a0, h0) to (a1, h1), `T.lath` wide, `off` m off the centre plane, both faces
    const lath = (a0: number, h0: number, a1: number, h1: number, off: number) => {
      const L2 = Math.hypot(a1 - a0, h1 - h0);
      if (L2 < 0.02) return;
      const pa = (-(h1 - h0) / L2) * (T.lath / 2);
      const ph = ((a1 - a0) / L2) * (T.lath / 2);
      const Q = (a: number, h: number): P3 => [o[0] + tan[0] * a + inn[0] * off, o[1] + tan[1] * a + inn[1] * off, h];
      const q = [Q(a0 - pa, h0 - ph), Q(a1 - pa, h1 - ph), Q(a1 + pa, h1 + ph), Q(a0 + pa, h0 + ph)] as const;
      gb.quadFacing(k, q[0], q[1], q[2], q[3], [out[0], out[1], 0]);
      gb.quadFacing(k, q[0], q[1], q[2], q[3], [inn[0], inn[1], 0]);
    };
    // Wave 6 (pose 30 still read as a green chain-link fence): period joinery. Flat lattice pilasters (two stiles with
    // cross laths and a cap) stand at the posts; each bay between them is a framed panel: bottom rail, a close square
    // lattice up to the dado rail, a square lattice in the field, a diagonal frieze under the top rail and a
    // projecting cornice along the whole run [N Le Clerc / d'Argenville treillage; I dims, GARDEN_DETAIL.treillage].
    const pier = T.pier;
    const fw = T.frame;
    for (let q = 0; q <= nPost; q++) {
      const d = q * step;
      if (inPortal(d, pier / 2)) continue;
      const y0 = y(d);
      const a0 = d - pier / 2;
      const a1 = d + pier / 2;
      gb.orientedBox(k, o, tan, inn, a0, a0 + fw, -0.05, 0.05, y0 - 0.1, y0 + H);
      gb.orientedBox(k, o, tan, inn, a1 - fw, a1, -0.05, 0.05, y0 - 0.1, y0 + H);
      for (let hh = 0.25; hh < H - 0.15; hh += T.mesh) lath(a0 + fw, y0 + hh, a1 - fw, y0 + hh, 0);
      // pier cap above the cornice
      gb.orientedBox(k, o, tan, inn, a0 - 0.02, a1 + 0.02, -0.06 - T.cornice, 0.06 + T.cornice, y0 + H + 0.05, y0 + H + 0.12);
    }
    const diag = T.mesh * Math.SQRT2; // along-the-fence spacing of diagonal laths whose perpendicular spacing is `mesh`
    for (let q = 0; q < nPost; q++) {
      const d0 = q * step + pier / 2;
      const d1 = (q + 1) * step - pier / 2;
      // bay cut by a portal: split into the parts outside it
      const parts: [number, number][] = [[d0, d1]];
      for (const [s0, s1] of spans) {
        for (let j = parts.length - 1; j >= 0; j--) {
          const [p0, p1] = parts[j];
          if (s1 <= p0 || s0 >= p1) continue;
          parts.splice(j, 1, ...([[p0, s0], [s1, p1]] as [number, number][]).filter(([x0, x1]) => x1 - x0 > 0.05));
        }
      }
      for (const [p0, p1] of parts) {
        const yb = y((p0 + p1) / 2);
        const hb = yb + 0.16;
        const yd = yb + T.dado;
        const ht = yb + H - 0.1;
        const fr = ht - T.frieze;
        // frame: bottom rail, dado rail, frieze rail, top rail with the cornice, stiles at both ends
        gb.orientedBox(k, o, tan, inn, p0, p1, -0.03, 0.03, yb + 0.04, hb);
        gb.orientedBox(k, o, tan, inn, p0, p1, -0.035, 0.035, yd - fw / 2, yd + fw / 2);
        gb.orientedBox(k, o, tan, inn, p0, p1, -0.03, 0.03, fr - fw, fr);
        gb.orientedBox(k, o, tan, inn, p0, p1, -0.04, 0.04, ht, yb + H);
        gb.orientedBox(k, o, tan, inn, p0, p1, -0.04 - T.cornice, 0.04 + T.cornice, yb + H, yb + H + 0.05);
        for (const a of [p0 + fw / 2, p1 - fw / 2]) gb.orientedBox(k, o, tan, inn, a - fw / 2, a + fw / 2, -0.03, 0.03, hb, ht);
        const ia0 = p0 + fw;
        const ia1 = p1 - fw;
        if (ia1 - ia0 < 0.1) continue;
        // square lattice: uprights on the outer face, horizontals on the inner face, so they cross
        const square = (h0: number, h1: number, pitch: number) => {
          const nu = Math.max(1, Math.round((ia1 - ia0) / pitch));
          for (let j = 1; j < nu; j++) {
            const a = ia0 + ((ia1 - ia0) * j) / nu;
            lath(a, h0, a, h1, 0.012);
          }
          const nh = Math.max(1, Math.round((h1 - h0) / pitch));
          for (let j = 1; j < nh; j++) {
            const hh = h0 + ((h1 - h0) * j) / nh;
            lath(ia0, hh, ia1, hh, -0.012);
          }
        };
        square(hb, yd - fw / 2, T.mesh / 2);
        square(yd + fw / 2, fr - fw, T.mesh);
        // diagonal frieze (treillage à losanges), the two families on either side of the centre plane
        const f0 = fr;
        const span = ht - f0;
        for (const sgn of [1, -1]) {
          const off = sgn * 0.012;
          for (let c = ia0 - span; c < ia1 + span; c += diag / 1.5) {
            // the line h - f0 = sgn · (a - c), clipped to [ia0, ia1] x [f0, ht]
            let aStart = sgn > 0 ? c : c - span;
            let aEnd = sgn > 0 ? c + span : c;
            aStart = Math.max(aStart, ia0);
            aEnd = Math.min(aEnd, ia1);
            if (aEnd - aStart < 0.02) continue;
            lath(aStart, f0 + sgn * (aStart - c), aEnd, f0 + sgn * (aEnd - c), off);
          }
        }
      }
    }
    // arched portals: lattice pilasters either side, a semicircular arch head, a crown rail at the portal height [N]
    for (const [s0, s1] of spans) {
      const dm = (s0 + s1) / 2;
      const yb = y(dm);
      const R = T.portalWidth / 2;
      const spring = fence.portal_height - R;
      const pw = T.pilaster;
      for (const [e0, e1] of [
        [s0 - pw, s0],
        [s1, s1 + pw],
      ]) {
        // pilaster frame (two stiles, a cap) with a few horizontal laths between
        gb.orientedBox(k, o, tan, inn, e0, e0 + 0.06, -0.07, 0.07, yb - 0.1, yb + spring + 0.05);
        gb.orientedBox(k, o, tan, inn, e1 - 0.06, e1, -0.07, 0.07, yb - 0.1, yb + spring + 0.05);
        gb.orientedBox(k, o, tan, inn, e0 - 0.03, e1 + 0.03, -0.09, 0.09, yb + spring + 0.05, yb + spring + 0.13);
        for (let hh = 0.3; hh < spring; hh += T.mesh * 1.5) lath(e0 + 0.06, yb + hh, e1 - 0.06, yb + hh, 0);
      }
      const n = 12;
      for (let j = 0; j < n; j++) {
        const a0 = Math.PI - (j / n) * Math.PI;
        const a1 = Math.PI - ((j + 1) / n) * Math.PI;
        const x0 = dm + Math.cos(a0) * R;
        const x1 = dm + Math.cos(a1) * R;
        const z0 = yb + spring + 0.13 + Math.sin(a0) * R;
        const z1 = yb + spring + 0.13 + Math.sin(a1) * R;
        const sx = Math.min(x0, x1) - 0.02;
        const ex = Math.max(x0, x1) + 0.02;
        gb.orientedBox(k, o, tan, inn, sx, ex, -0.05, 0.05, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.03);
      }
      // spandrel lattice between the arch and the crown rail
      const top = yb + fence.portal_height + 0.13;
      for (let x = s0 - pw + T.mesh; x < s1 + pw; x += T.mesh * 1.4) {
        const dx = Math.abs(x - dm);
        const zArch = dx < R ? yb + spring + 0.13 + Math.sqrt(R * R - dx * dx) : yb + spring + 0.13;
        if (top - zArch > 0.05) lath(x, zArch, x, top, 0);
      }
      gb.orientedBox(k, o, tan, inn, s0 - pw - 0.05, s1 + pw + 0.05, -0.06, 0.06, top, top + 0.1);
    }
  }
}

// ------------------------------------------------------------------------------------------------ furniture

/** KB-I33: benches (green, GARDEN_DETAIL.bench) and the Flora herm (GARDEN_DETAIL.sculpture) of a `furniture` feature. */
export function buildFurniture(env: GardenDetailEnv, f: TerrainFeature): void {
  for (const it of f.items ?? []) {
    if (it.type === 'bench') bench(env, it);
    else if (it.type === 'herm') herm(env, it);
  }
}

/** Unit vectors of a grid azimuth (deg) in plan (s, t) = (E, N): front, and the right-hand tangent. */
function facingVectors(az: number): { fwd: P2; tan: P2 } {
  const r = (az * Math.PI) / 180;
  const fwd: P2 = [Math.sin(r), Math.cos(r)];
  return { fwd, tan: [fwd[1], -fwd[0]] };
}

function bench(env: GardenDetailEnv, it: GardenItem): void {
  const Bn = GARDEN_DETAIL.bench;
  const { gb } = env;
  const k = matKey('wood.shutter', Bn.colour);
  const [s, t] = plan(it.at[0], it.at[1]);
  const { fwd, tan } = facingVectors(it.facing);
  const L = Bn.length / 2;
  const D = Bn.depth / 2;
  // ground under the bench corners; a platform levels a slope (D Schneider)
  const corners: P2[] = [];
  const [pw, pd] = Bn.platform;
  for (const a of [-pw / 2, pw / 2]) for (const d of [-pd / 2, pd / 2]) corners.push([s + tan[0] * a + fwd[0] * d, t + tan[1] * a + fwd[1] * d]);
  const gs = corners.map(([cs, ct]) => groundAt(env, cs, ct, NaN)).filter(Number.isFinite);
  const gc = groundAt(env, s, t, NaN);
  if (!Number.isFinite(gc) || !gs.length) return;
  const lo = Math.min(...gs);
  const hi = Math.max(...gs);
  let y = gc;
  if (it.platform || hi - lo > Bn.slopePlatform) {
    y = hi - 0.04;
    const gravel = matKey('ground.gravel', '#B79A84');
    gb.orientedBox(gravel, [s, t], tan, fwd, -pw / 2, pw / 2, -pd / 2, pd / 2, lo - 0.25, y + 0.04);
    y += 0.04;
  }
  const o: P2 = [s, t];
  const seat = Bn.seat;
  // seat (two planks), back (two planks), end frames with legs and arm rests [N]
  gb.orientedBox(k, o, tan, fwd, -L, L, -D + 0.02, -0.01, y + seat - 0.045, y + seat);
  gb.orientedBox(k, o, tan, fwd, -L, L, 0.01, D, y + seat - 0.045, y + seat);
  gb.orientedBox(k, o, tan, fwd, -L, L, -D + 0.02, -D + 0.06, y + seat + 0.12, y + seat + 0.25);
  gb.orientedBox(k, o, tan, fwd, -L, L, -D + 0.02, -D + 0.06, y + seat + 0.32, y + Bn.back);
  for (const a of [-L + 0.06, 0, L - 0.06]) {
    if (a === 0 && Bn.length < 1.6) continue;
    gb.orientedBox(k, o, tan, fwd, a - 0.035, a + 0.035, -D, -D + 0.06, y - 0.05, y + Bn.back); // back leg
    gb.orientedBox(k, o, tan, fwd, a - 0.035, a + 0.035, D - 0.07, D - 0.01, y - 0.05, y + seat); // front leg
    gb.orientedBox(k, o, tan, fwd, a - 0.03, a + 0.03, -D, D, y + seat - 0.09, y + seat - 0.045); // seat rail
  }
  for (const a of [-L + 0.03, L - 0.03]) gb.orientedBox(k, o, tan, fwd, a - 0.035, a + 0.035, -D, D - 0.01, y + seat + 0.2, y + seat + 0.25); // arm rests
}

/** A ring of a herm lathe: height, half-widths along the facing tangent and the front axis, forward offset. */
export interface HermRing {
  h: number;
  a: number;
  b: number;
  f?: number;
}

/**
 * Smooth lathe of elliptical rings (`segs` around) about the vertical axis at `o`, `tan` / `fwd` the section axes; caps
 * the top (and bottom if `capBottom`) with a fan. Normals from the surface tangents, so the stone reads rounded.
 */
function lathe(gb: GeoBuilder, k: MatKey, o: P2, tan: P2, fwd: P2, rings: readonly HermRing[], segs: number, capBottom = false): void {
  const P = (r: HermRing, j: number): P3 => {
    const t = (j / segs) * Math.PI * 2;
    const ca = Math.cos(t) * r.a;
    const sb = Math.sin(t) * r.b + (r.f ?? 0);
    return [o[0] + tan[0] * ca + fwd[0] * sb, o[1] + tan[1] * ca + fwd[1] * sb, r.h];
  };
  // object-space normal (x = s, y = h, z = −t) of the surface at ring i, segment j
  const N = (i: number, j: number) => {
    const r = rings[i];
    const t = (j / segs) * Math.PI * 2;
    // outward in the section plane: ellipse gradient (cos/a, sin/b)
    const gx = Math.cos(t) / Math.max(r.a, 1e-4);
    const gy = Math.sin(t) / Math.max(r.b, 1e-4);
    const gl = Math.hypot(gx, gy);
    const ns = (tan[0] * gx + fwd[0] * gy) / gl;
    const nt = (tan[1] * gx + fwd[1] * gy) / gl;
    // slope: radius change with height
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(rings.length - 1, i + 1);
    const dr = (Math.hypot(rings[i1].a * Math.cos(t), rings[i1].b * Math.sin(t)) - Math.hypot(rings[i0].a * Math.cos(t), rings[i0].b * Math.sin(t))) / Math.max(1e-4, rings[i1].h - rings[i0].h);
    const v = new THREE.Vector3(ns, -dr, -nt);
    return v.normalize();
  };
  for (let i = 0; i + 1 < rings.length; i++)
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      gb.tri(k, P(rings[i], j), P(rings[i], j1), P(rings[i + 1], j1), [N(i, j), N(i, j1), N(i + 1, j1)]);
      gb.tri(k, P(rings[i], j), P(rings[i + 1], j1), P(rings[i + 1], j), [N(i, j), N(i + 1, j1), N(i + 1, j)]);
    }
  const top = rings[rings.length - 1];
  const tc: P3 = [o[0] + fwd[0] * (top.f ?? 0), o[1] + fwd[1] * (top.f ?? 0), top.h];
  for (let j = 0; j < segs; j++) gb.tri(k, P(top, j), P(top, (j + 1) % segs), tc);
  if (capBottom) {
    const bot = rings[0];
    const bc: P3 = [o[0] + fwd[0] * (bot.f ?? 0), o[1] + fwd[1] * (bot.f ?? 0), bot.h];
    for (let j = 0; j < segs; j++) gb.tri(k, P(bot, (j + 1) % segs), P(bot, j), bc);
  }
}

/** Square-section frustum from half-sizes (a0, b0) at h0 to (a1, b1) at h1 (sides only, plus the top). */
function frustum(gb: GeoBuilder, k: MatKey, o: P2, tan: P2, fwd: P2, a0: number, b0: number, h0: number, a1: number, b1: number, h1: number, top = true): void {
  const Q = (a: number, b: number, h: number): P3 => [o[0] + tan[0] * a + fwd[0] * b, o[1] + tan[1] * a + fwd[1] * b, h];
  const lo = [Q(-a0, -b0, h0), Q(a0, -b0, h0), Q(a0, b0, h0), Q(-a0, b0, h0)];
  const hi = [Q(-a1, -b1, h1), Q(a1, -b1, h1), Q(a1, b1, h1), Q(-a1, b1, h1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mid: P3 = [(lo[i][0] + lo[j][0]) / 2 - o[0], (lo[i][1] + lo[j][1]) / 2 - o[1], 0];
    gb.quadFacing(k, lo[i], lo[j], hi[j], hi[i], mid);
  }
  if (top) gb.quadFacing(k, hi[0], hi[1], hi[2], hi[3], [0, 0, 1]);
}

/**
 * The Flora herm (GARDEN_DETAIL.sculpture), wave 6 (pose 33: "a stack of boxes"): a profiled pedestal (plinth, wash,
 * die, cyma cornice), a square herm shaft tapering toward the foot with two feet showing at its base and a moulded
 * neck band, and a rounded bust above it: chest and shoulders, neck, head with a flower wreath and a knot of hair at the
 * back [N 18th-c. garden herms; D Flora herm, yellowish sandstone; I proportions].
 */
function herm(env: GardenDetailEnv, it: GardenItem): void {
  const S = GARDEN_DETAIL.sculpture;
  const { gb } = env;
  const ped = matKey('stone.yellow', S.pedestalColour);
  const stone = matKey('stone.yellow', S.colour);
  const [s, t] = plan(it.at[0], it.at[1]);
  const { fwd, tan } = facingVectors(it.facing);
  const gc = groundAt(env, s, t, NaN);
  if (!Number.isFinite(gc)) return;
  const o: P2 = [s, t];
  const w = S.pedestalWidth / 2;
  // pedestal: plinth, sloped wash, die, cyma (two steps out) and the top slab
  gb.orientedBox(ped, o, tan, fwd, -w - 0.08, w + 0.08, -w - 0.08, w + 0.08, gc - 0.1, gc + 0.14);
  frustum(gb, ped, o, tan, fwd, w + 0.08, w + 0.08, gc + 0.14, w, w, gc + 0.22, false);
  gb.orientedBox(ped, o, tan, fwd, -w, w, -w, w, gc + 0.22, gc + S.pedestal - 0.16);
  frustum(gb, ped, o, tan, fwd, w, w, gc + S.pedestal - 0.16, w + 0.035, w + 0.035, gc + S.pedestal - 0.1, false);
  frustum(gb, ped, o, tan, fwd, w + 0.035, w + 0.035, gc + S.pedestal - 0.1, w + 0.07, w + 0.07, gc + S.pedestal - 0.05, false);
  gb.orientedBox(ped, o, tan, fwd, -w - 0.07, w + 0.07, -w - 0.07, w + 0.07, gc + S.pedestal - 0.05, gc + S.pedestal);
  let y = gc + S.pedestal;
  // shaft: a low base block, then one tapering square frustum (narrow at the foot), two feet in front of its base
  gb.orientedBox(stone, o, tan, fwd, -0.17, 0.17, -0.14, 0.14, y, y + 0.08);
  for (const side of [-1, 1]) gb.orientedBox(stone, o, tan, fwd, side * 0.075 - 0.045, side * 0.075 + 0.045, 0.02, 0.2, y + 0.08, y + 0.15);
  frustum(gb, stone, o, tan, fwd, 0.12, 0.095, y + 0.08, 0.2, 0.135, y + S.hermShaft - 0.06, false);
  // moulded band under the bust
  frustum(gb, stone, o, tan, fwd, 0.2, 0.135, y + S.hermShaft - 0.06, 0.225, 0.15, y + S.hermShaft - 0.02, false);
  gb.orientedBox(stone, o, tan, fwd, -0.225, 0.225, -0.15, 0.15, y + S.hermShaft - 0.02, y + S.hermShaft);
  y += S.hermShaft;
  // bust: chest rising into rounded shoulders, then the neck (one lathe), the head with wreath and hair knot
  const B = S.bust;
  lathe(gb, stone, o, tan, fwd, [
    { h: y, a: 0.2, b: 0.13 },
    { h: y + 0.1 * B, a: 0.215, b: 0.14, f: 0.01 },
    { h: y + 0.26 * B, a: 0.22, b: 0.13, f: 0.01 },
    { h: y + 0.36 * B, a: 0.19, b: 0.11 },
    { h: y + 0.42 * B, a: 0.11, b: 0.08 },
    { h: y + 0.46 * B, a: 0.055, b: 0.055 },
    { h: y + 0.54 * B, a: 0.05, b: 0.052, f: 0.008 },
  ], 14);
  const hy = y + 0.54 * B;
  const HH = B - 0.54 * B; // head height incl. wreath
  lathe(gb, stone, o, tan, fwd, [
    { h: hy, a: 0.045, b: 0.05, f: 0.012 },
    { h: hy + 0.12 * HH, a: 0.07, b: 0.08, f: 0.02 },
    { h: hy + 0.35 * HH, a: 0.085, b: 0.1, f: 0.015 },
    { h: hy + 0.6 * HH, a: 0.088, b: 0.104, f: 0.005 },
    // flower wreath: a swelling band round the crown of the head
    { h: hy + 0.7 * HH, a: 0.104, b: 0.118, f: 0.0 },
    { h: hy + 0.82 * HH, a: 0.1, b: 0.112, f: -0.005 },
    { h: hy + 0.92 * HH, a: 0.065, b: 0.075, f: -0.01 },
    { h: hy + HH, a: 0.02, b: 0.025, f: -0.012 },
  ], 14);
  // knot of hair at the back of the head
  const back: P2 = [o[0] - fwd[0] * 0.095, o[1] - fwd[1] * 0.095];
  lathe(gb, stone, back, tan, fwd, [
    { h: hy + 0.38 * HH, a: 0.02, b: 0.02 },
    { h: hy + 0.48 * HH, a: 0.045, b: 0.04 },
    { h: hy + 0.6 * HH, a: 0.04, b: 0.035 },
    { h: hy + 0.68 * HH, a: 0.01, b: 0.01 },
  ], 8);
}

// ------------------------------------------------------------------------------------------------ kitchen garden

/**
 * KB-I36: the kitchen / forcing garden of a `beds` feature: beds in quarters (layout/garden.ts kitchenBeds) along the
 * layout axis `beds.axis_deg`, raised soil with crop rows (beans and peas on sticks stand tall), hotbed frames
 * (Mistbeetkästen) along `beds.frame_rows` with glass lights tilted to the S, and espaliered fruit (palmettes) along
 * `beds.espaliers`. Beds keep 2 m off the polygon edges, 2 m off buildings inside it and 2.4 m off the frame rows.
 */
export function buildBeds(env: GardenDetailEnv, f: TerrainFeature): void {
  const ringEN = f.geometry.type === 'Polygon' ? (f.geometry.coordinates[0] as EN[]) : null;
  const bl = f.beds;
  if (!ringEN || !bl) return;
  const K = GARDEN_DETAIL.kitchen;
  const { gb } = env;
  const az = ((bl.axis_deg ?? env.spec.palace_grid.u_azimuth_grid_deg) * Math.PI) / 180;
  const eu: P2 = [Math.sin(az), Math.cos(az)];
  const ev: P2 = [-eu[1], eu[0]];
  const ring = ringEN.map(([E, N]) => plan(E, N));
  const open = ring.slice(0, -1);
  const c: P2 = [open.reduce((a, p) => a + p[0], 0) / open.length, open.reduce((a, p) => a + p[1], 0) / open.length];
  const toL = (p: P2): P2 => [(p[0] - c[0]) * eu[0] + (p[1] - c[1]) * eu[1], (p[0] - c[0]) * ev[0] + (p[1] - c[1]) * ev[1]];
  const toP = (u: number, v: number): P2 => [c[0] + eu[0] * u + ev[0] * v, c[1] + eu[1] * u + ev[1] * v];
  const loc = ring.map(toL);
  const r: RectUV = { u0: Math.min(...loc.map((p) => p[0])), u1: Math.max(...loc.map((p) => p[0])), v0: Math.min(...loc.map((p) => p[1])), v1: Math.max(...loc.map((p) => p[1])) };
  const inside = (u: number, v: number) => pointInPolygon([u, v], loc) && distanceToLine(loc, [u, v]) >= 2.0;
  const area = (rr: readonly P2[]) => {
    let a2 = 0;
    for (let i = 0; i < rr.length - 1; i++) a2 += rr[i][0] * rr[i + 1][1] - rr[i + 1][0] * rr[i][1];
    return Math.abs(a2) / 2;
  };
  // buildings inside the garden (glasshouses); the enclosing wall ring itself (same size as the garden) is not one
  const houses = env.buildingRings
    .map((rr) => rr.map(([E, N]) => toL(plan(E, N))))
    .filter((rr) => area(rr) < 0.5 * area(loc))
    .filter((rr) => {
      const cx = rr.slice(0, -1).reduce((a, p) => a + p[0], 0) / (rr.length - 1);
      const cy = rr.slice(0, -1).reduce((a, p) => a + p[1], 0) / (rr.length - 1);
      return pointInPolygon([cx, cy], loc);
    });
  const frames = (bl.frame_rows ?? []).map((row) => row.map(([E, N]) => toL(plan(E, N))));
  const blocked = (u: number, v: number) =>
    !inside(u, v) ||
    houses.some((h) => pointInPolygon([u, v], h) || distanceToLine(h, [u, v]) < 2) ||
    frames.some((fr) => distanceToLine(fr, [u, v]) < 2.4);
  // beds are clipped per 4 m piece (the walls are a parallelogram in the layout frame, so whole beds would vanish)
  const lay = kitchenBeds(r, bl.quarters, hashString(f.id) ^ env.ctx.options.seed, K.crops.length);
  const soilK = matKey('ground.gravel', K.soil); // dry July bed soil [I]
  const cropK = K.crops.map((col) => matKey('ground.grass', col));
  const stickK = matKey('wood.frame', '#7A6A55');
  const lod = env.ctx.lod;
  const rnd = mulberry32(hashString(f.id) ^ 0x5eed);
  const hAt = (u: number, v: number) => {
    const [s, t] = toP(u, v);
    return groundAt(env, s, t, NaN);
  };
  for (const bed of lay.beds) {
    const R = bed.rect;
    const alongU = bed.along === 'u';
    const L = alongU ? R.u1 - R.u0 : R.v1 - R.v0;
    const W = alongU ? R.v1 - R.v0 : R.u1 - R.u0;
    const a0: P2 = alongU ? [R.u0, (R.v0 + R.v1) / 2] : [(R.u0 + R.u1) / 2, R.v0];
    const dirL: P2 = alongU ? [1, 0] : [0, 1];
    const tanP: P2 = alongU ? eu : ev;
    const nrmP: P2 = alongU ? ev : [-eu[0], -eu[1]];
    const n = Math.max(1, Math.ceil(L / 4));
    const crop = bed.crop;
    const dug = crop === K.crops.length - 1; // the last hue is a bed just dug / sown (bare soil) [I]
    // beans and peas on sticks [N]; wave-5 fix: only about a third of those beds carry tall sticks (runner beans), the
    // rest are dwarf beans / peas in low rows, so the pole rows no longer dominate the quarters [N; I share]
    const tall = crop === 2 && hashString(`${f.id}:${R.u0.toFixed(1)}:${R.v0.toFixed(1)}`) % 3 === 0;
    for (let k = 0; k < n; k++) {
      const m0 = (L * k) / n;
      const m1 = (L * (k + 1)) / n;
      const mu = a0[0] + dirL[0] * (m0 + m1) / 2;
      const mv = a0[1] + dirL[1] * (m0 + m1) / 2;
      const across: P2 = alongU ? [0, W / 2] : [W / 2, 0];
      const e0: P2 = [a0[0] + dirL[0] * m0, a0[1] + dirL[1] * m0];
      const e1: P2 = [a0[0] + dirL[0] * m1, a0[1] + dirL[1] * m1];
      if ([[mu, mv], e0, e1].some(([pu, pv]) => blocked(pu + across[0], pv + across[1]) || blocked(pu - across[0], pv - across[1]))) continue;
      const y = hAt(mu, mv);
      if (!Number.isFinite(y)) continue;
      const o = toP(e0[0], e0[1]);
      gb.orientedBox(dug ? matKey('ground.gravel', K.crops[K.crops.length - 1]) : soilK, o, tanP, nrmP, 0, m1 - m0, -W / 2, W / 2, y - 0.08, y + K.bedRaise);
      if (dug || lod >= 2) continue;
      // crop rows across the bed width (wave-5 fix: narrower and lower, so soil shows between them): cabbages as single
      // heads in 2 rows, other crops 3 low rows, beans / peas 1 row of poles with a light, open leaf column round each
      if (crop === 0) {
        for (const d of [-W / 4, W / 4]) {
          for (let x = 0.35; x < m1 - m0 - 0.2; x += 0.55) {
            const hr = 0.16 + rnd() * 0.06;
            gb.orientedBox(cropK[crop], o, tanP, nrmP, x - hr, x + hr, d - hr, d + hr, y + K.bedRaise - 0.02, y + K.bedRaise + 0.12 + rnd() * 0.08);
          }
        }
        continue;
      }
      const rows = tall ? 1 : 3;
      for (let q = 0; q < rows; q++) {
        const d = -W / 2 + (W * (q + 0.5)) / rows;
        if (!tall) {
          const rw = 0.18 + rnd() * 0.08;
          const rh = 0.08 + rnd() * 0.12;
          gb.orientedBox(cropK[crop], o, tanP, nrmP, 0.15, m1 - m0 - 0.15, d - rw / 2, d + rw / 2, y + K.bedRaise - 0.02, y + K.bedRaise + rh);
          continue;
        }
        // beans / peas: one row of poles every beanSpacing m with a leafy column round each, gaps between [N]
        for (let x = 0.5; x < m1 - m0 - 0.3; x += K.beanSpacing) {
          const ph = K.beanHeight[0] + rnd() * (K.beanHeight[1] - K.beanHeight[0]);
          const top = y + K.bedRaise + ph;
          // leaf column: broad at the foot, narrower toward the top of the pole
          gb.orientedBox(cropK[crop], o, tanP, nrmP, x - 0.15, x + 0.15, d - 0.12, d + 0.12, y + K.bedRaise, top - 0.75);
          gb.orientedBox(cropK[crop], o, tanP, nrmP, x - 0.1, x + 0.1, d - 0.08, d + 0.08, top - 0.75, top - 0.2 - rnd() * 0.15);
          if (lod <= 1) gb.orientedBox(stickK, o, tanP, nrmP, x - 0.015, x + 0.015, d - 0.015, d + 0.015, y + K.bedRaise, top, false, 'caps');
        }
      }
    }
  }
  // hotbed frames: timber boxes 1.3 m deep (N-S), lights 1.0 m wide along the row, glass tilted to the S [D-> BSB 25r]
  // wave 10 (audit #11: the lights read as blue solar panels): small lapped panes of greenish crown glass in wooden
  // sash bars, a soft sheen instead of the facade glass's mirror (no room proxy, no SSR), and the July states:
  // propped up, taken off or limewashed (grammar HOTBED_LIGHT; hotbed.ts) [D-> BSB 25r; N]. The panes use the plain
  // painted-joinery material (roughness 0.6), not a `stone.*` one: the explorer light layer exports stone site meshes
  const woodK = matKey('wood.frame', '#6B5A45');
  const glassK = matKey('wood.frame', HOTBED_LIGHT.glass);
  const washK = matKey('wood.frame', HOTBED_LIGHT.whitewash);
  const seedK = matKey('ground.grass', '#3E5530');
  const grid = gridFrame(env.spec.palace_grid);
  for (const row of bl.frame_rows ?? []) {
    if (row.length < 2) continue;
    const p0 = plan(row[0][0], row[0][1]);
    const p1 = plan(row[1][0], row[1][1]);
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const tan: P2 = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
    // south = toward lower palace-grid v
    const [Ea, Na] = grid.toEN(0, 0);
    const [Eb, Nb] = grid.toEN(0, -1);
    let sth: P2 = [-tan[1], tan[0]];
    if (sth[0] * (Eb - Ea) + sth[1] * (Nb - Na) < 0) sth = [-sth[0], -sth[1]];
    const [lw, ld] = K.frameLight; // 1.3 along N-S, 1.0 along the row
    const n = Math.floor(L / ld);
    const states = hotbedLightStates(n, hashString(`${f.id}/${row[0][0].toFixed(1)},${row[0][1].toFixed(1)}`) ^ env.ctx.options.seed);
    for (let q = 0; q < n; q++) {
      const a = q * ld;
      const ms = p0[0] + tan[0] * (a + ld / 2);
      const mt = p0[1] + tan[1] * (a + ld / 2);
      const y = groundAt(env, ms, mt, NaN);
      if (!Number.isFinite(y)) continue;
      const D = lw / 2;
      const hiY = y + K.frameHigh;
      const loY = y + K.frameLow;
      // back (N) and front (S) boards, light bar between lights
      gb.orientedBox(woodK, p0, tan, sth, a, a + ld, -D, -D + 0.05, y - 0.05, hiY);
      gb.orientedBox(woodK, p0, tan, sth, a, a + ld, D - 0.05, D, y - 0.05, loY);
      gb.orientedBox(woodK, p0, tan, sth, a, a + 0.05, -D, D, y - 0.05, loY);
      // seedlings under the glass, then the sloped glass light and its frame bar
      gb.orientedBox(seedK, p0, tan, sth, a + 0.05, a + ld, -D + 0.05, D - 0.05, y - 0.05, y + 0.08);
      const P3 = (al: number, d: number, hh: number): P3 => [p0[0] + tan[0] * al + sth[0] * d, p0[1] + tan[1] * al + sth[1] * d, hh];
      gb.quad(woodK, P3(a - 0.02, D, loY + 0.03), P3(a + 0.04, D, loY + 0.03), P3(a + 0.04, -D, hiY + 0.03), P3(a - 0.02, -D, hiY + 0.03));
      const st = states[q];
      if (st.kind === 'removed') continue; // taken off: the seedlings show
      const [fd, fh, bd, bh] = lightSection(D, loY + 0.02, hiY + 0.02, st.kind === 'propped' ? st.deg : 0);
      const pane = st.kind === 'whitewashed' ? washK : glassK;
      gb.quad(pane, P3(a + 0.03, fd, fh), P3(a + ld - 0.03, fd, fh), P3(a + ld - 0.03, bd, bh), P3(a + 0.03, bd, bh));
      // sash frame (sides) and bars along the slope, 1 cm proud of the glass
      const bw = HOTBED_LIGHT.bar;
      for (let b = 0; b <= HOTBED_LIGHT.bars + 1; b++) {
        const x = a + 0.03 + ((ld - 0.06) * b) / (HOTBED_LIGHT.bars + 1);
        const x0 = Math.max(a + 0.03, x - bw / 2);
        const x1 = Math.min(a + ld - 0.03, x + bw / 2);
        gb.quad(woodK, P3(x0, fd, fh + 0.012), P3(x1, fd, fh + 0.012), P3(x1, bd, bh + 0.012), P3(x0, bd, bh + 0.012));
      }
      if (st.kind === 'propped') {
        // the prop: a short stick under the raised back edge
        const pd = bd + 0.08;
        gb.orientedBox(woodK, p0, tan, sth, a + ld / 2 - 0.02, a + ld / 2 + 0.02, pd - 0.02, pd + 0.02, hiY - 0.02, bh);
      }
    }
    // closing end board
    gb.orientedBox(woodK, p0, tan, sth, n * ld, n * ld + 0.05, -lw / 2, lw / 2, groundAt(env, p0[0] + tan[0] * n * ld, p0[1] + tan[1] * n * ld, 340) - 0.05, groundAt(env, p0[0] + tan[0] * n * ld, p0[1] + tan[1] * n * ld, 340) + K.frameLow);
  }
  // espaliers: horizontal palmettes every `espalierSpacing` m on the wall face [N]
  const trunkK = matKey('wood.frame', '#4A3A2A');
  const leafK = matKey('ground.grass', '#4F6B35');
  for (const line of bl.espaliers ?? []) {
    if (line.length < 2) continue;
    const p0 = plan(line[0][0], line[0][1]);
    const p1 = plan(line[1][0], line[1][1]);
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const tan: P2 = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
    const nrm: P2 = [tan[1], -tan[0]];
    const n = Math.floor(L / K.espalierSpacing);
    const pad = (L - (n - 1) * K.espalierSpacing) / 2;
    for (let q = 0; q < n; q++) {
      const a = pad + q * K.espalierSpacing;
      const y = groundAt(env, p0[0] + tan[0] * a, p0[1] + tan[1] * a, NaN);
      if (!Number.isFinite(y)) continue;
      const half = K.espalierSpacing / 2 - 0.2;
      gb.orientedBox(trunkK, p0, tan, nrm, a - 0.05, a + 0.05, -0.05, 0.05, y - 0.05, y + K.espalierHeight - 0.2);
      for (let tier = 0; tier < 4; tier++) {
        const hh = y + 0.45 + tier * ((K.espalierHeight - 0.55) / 3);
        const reach = half * (1 - tier * 0.08);
        gb.orientedBox(leafK, p0, tan, nrm, a - reach, a + reach, -0.11, 0.11, hh - 0.11, hh + 0.13);
      }
    }
  }
}

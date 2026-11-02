/**
 * KB-I29 menagerie houses (research/10 §b.4): extrudes layout/menagerie.ts for a building with `facade.menagerie`
 * instead of its GARD enclosure wall. Each house stands on its own ground (plinth down to the lowest corner), so the
 * ring and the terrace rows follow the 1789 terrain.
 *
 * LOD0/1 (light layer): one rendered block per house and its roof (slate pyramid on the ring [D T20], slate gable rows
 * [I cover by analogy]); grille posts and rails in iron (dropped from the explorer layer); terrace walls along the row
 * back lines (the ≈ 1 m LiDAR steps), trampled ground in the runs, the broad watercourse with its kerbs. LOD2: plinth
 * course, the open grille front (piers, lintel, bars), a stoke-hole door on the back [I "heated from outside", T1 p.
 * 383], the radial and run grilles bar by bar (square iron bars ≈ 25 mm at 0.2 m), the ≈ 3.6 m net posts with a coarse
 * cord net over each run.
 * Wave-6 review fix: ring yards closed behind the houses and their radial grilles run in to the water edge; 'island'
 * (KL-B41: sandstone-quayed square island with the documented foundations and spiral stair, D T20) and 'open_pavilion'
 * (KL-B41a: hypothetical light superstructure, posts + beam + slate pyramid) [I].
 * Never the modern Cor-Ten consolidation (research/10 §c.1).
 */
import type { BuildContext } from '../context.ts';
import { E0, N0 } from '../frame.ts';
import type { BuildingLayout } from '../layout/building.ts';
import { enToST } from '../layout/footprint.ts';
import { hashString } from '../layout/geom.ts';
import { MENAGERIE } from '../layout/grammar.ts';
import { type MenagerieHouse, type MenagerieTerrace, menagerieLayout } from '../layout/menagerie.ts';
import type { EN } from '../spec.ts';
import { type GeoBuilder, type MatKey, type P3, matKey } from './builder.ts';
import type { ExteriorPalette } from './index.ts';
import { blockTint } from './shade.ts';

type ST = [number, number];

const IRON = matKey('metal.iron');
// tarred yarn / wire net over the runs: a lighter, browner iron key so it reads faint against the sky
const NET = matKey('metal.iron', '#5C5650');
const DOOR = matKey('wood.door', '#5A4632');
const DARK = matKey('stone.rubble', '#2E2924');
const RUN = matKey('ground.grass', MENAGERIE.runGround);
const GRAVEL = matKey('ground.gravel');
const COPING = matKey('stone.grey', '#BDBAB2');

export function buildMenagerie(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, pal: ExteriorPalette, ctx: BuildContext): void {
  const b = L.building;
  const m = b.facade.menagerie;
  if (!m) return;
  const lod = ctx.lod;
  const f = L.frame;
  const st = (p: EN): ST => enToST(f, p);
  const fallback = L.stack.base_h;
  const ground = (p: EN): number => {
    const h = ctx.terrain(p[0] - E0, -(p[1] - N0));
    return Number.isFinite(h) ? h : fallback;
  };
  if (m.kind === 'island') return island(g, L, st, ground, pal, ctx);
  if (m.kind === 'open_pavilion') return openPavilion(g, gr, L, st, lod);
  const lay = menagerieLayout(m, hashString(b.id) ^ ctx.options.seed);
  const roofK = m.kind === 'ring' ? matKey('roof.slate') : matKey(`roof.${MENAGERIE.rowHouse.cover}`);
  // terrace walls first: the row houses put their stoke-holes above them
  const backTop = new Map<MenagerieHouse, number>();
  if (lod >= 1) for (const t of lay.terraces) terraceWall(g, t, st, ground, pal, b.id, ctx.options.seed, lod);
  for (const h of lay.houses) {
    if (m.kind === 'rows') backTop.set(h, ground([h.centre[0] - h.front[0] * (h.depth / 2 + 1.5), h.centre[1] - h.front[1] * (h.depth / 2 + 1.5)]));
    house(g, gr, h, st, ground, pal, roofK, lod, backTop.get(h));
  }
  // grilles: posts + rails at LOD0/1, every bar at LOD2; ring partitions run in to the water edge
  const G = MENAGERIE.grille;
  const water = m.kind === 'ring' && m.ring ? moatWater(m.ring.centre, m.ring.moat_radius ?? m.ring.radius - MENAGERIE.ringHouse.depth / 2 - MENAGERIE.ringYard, ground) : null;
  for (const gl of lay.grilles) {
    const end = gl.radial && water ? toWater(gl.a, gl.b, m.ring!.centre, water, ground) : gl.b;
    fence(g, st(gl.a), st(end), ground(gl.a), ground(end), G.height, lod >= 2 ? G.bar : 0);
  }
  if (lod >= 1) for (const r of lay.runs) runGround(g, r.ring, st, ground, lod);
  // net posts (≈ 11 Fuß) with a coarse cord net over each run
  if (lod >= 1) {
    const NH = MENAGERIE.run.netHeight;
    for (const p of lay.posts) {
      const q = st(p);
      const h0 = ground(p);
      post(g, q, h0 - 0.2, h0 + NH, lod >= 2 ? 0.07 : 0.1);
    }
    if (lod >= 2) for (const r of lay.runs) runNet(g, r.ring, st, ground, NH);
  }
  if (lay.channel && lod >= 1) channel(g, lay.channel, st, ground, lod);
}

/** Water level of the moat: its lowest outline terrain + 0.4 m (the plain-pond rule of site/features.ts). */
function moatWater(centre: EN, radius: number, ground: (p: EN) => number): number {
  let lo = Infinity;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    lo = Math.min(lo, ground([centre[0] + Math.sin(a) * radius, centre[1] + Math.cos(a) * radius]));
  }
  return lo + 0.4;
}

/** Inner end of a radial grille: from `b` on towards the centre to the first point under water (+0.3 m into it). */
function toWater(a: EN, b: EN, centre: EN, water: number, ground: (p: EN) => number): EN {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const u: EN = [dx / l, dy / l];
  const r0 = Math.hypot(b[0] - centre[0], b[1] - centre[1]);
  for (let k = 0; k * 0.25 < r0 * 0.4; k++) {
    const p: EN = [b[0] + u[0] * k * 0.25, b[1] + u[1] * k * 0.25];
    if (ground(p) <= water) return [p[0] + u[0] * 0.3, p[1] + u[1] * 0.3];
  }
  return b;
}

/**
 * Dry sandstone retaining wall on a row's back line (the ≈ 1 m terrace step): from the lower terrace in front up to
 * the upper terrace behind, with a grey coping; segments of ≈ 3 m follow the terrain. Low steps keep a minimum rise.
 */
function terraceWall(g: GeoBuilder, t: MenagerieTerrace, st: (p: EN) => ST, ground: (p: EN) => number, pal: ExteriorPalette, id: string, seed: number, lod: number): void {
  const W = MENAGERIE.terraceWall;
  const len = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
  if (len < 1) return;
  // LOD1 (light layer): 6 m segments, wall face and coping top only
  const n = Math.max(1, Math.round(len / (lod >= 2 ? W.step : W.step * 2)));
  const at = (k: number, d: number): EN => [t.a[0] + ((t.b[0] - t.a[0]) * k) / n + t.back[0] * d, t.a[1] + ((t.b[1] - t.a[1]) * k) / n + t.back[1] * d];
  const foot: number[] = [];
  const top: number[] = [];
  for (let k = 0; k <= n; k++) {
    const lo = Math.min(ground(at(k, -0.4)), ground(at(k, 0)));
    const hi = Math.max(ground(at(k, 1.6)), ground(at(k, 0.8)));
    const rise = Math.max(W.minRise, Math.min(W.maxRise, hi - lo));
    foot.push(lo - 0.25);
    top.push(lo + rise + 0.05);
  }
  const P = (p: EN, z: number): P3 => {
    const q = st(p);
    return [q[0], q[1], z];
  };
  const fr = st([t.a[0] - t.back[0], t.a[1] - t.back[1]]);
  const o = st(t.a);
  const frontDir: P3 = [fr[0] - o[0], fr[1] - o[1], 0];
  const backDir: P3 = [-frontDir[0], -frontDir[1], 0];
  for (let k = 0; k < n; k++) {
    // per-segment block hue (KB-I19 recycled-stone variation), keyed by building and segment
    const tint = blockTint(id, `tw${t.a[0].toFixed(0)}:${k}`, pal.colours.plinth, seed);
    g.withShade((_p, _ny, out) => {
      out[0] *= tint[0];
      out[1] *= tint[1];
      out[2] *= tint[2];
    }, () => {
      g.quadFacing(pal.plinth, P(at(k, 0), foot[k]), P(at(k + 1, 0), foot[k + 1]), P(at(k + 1, 0), top[k + 1] - W.coping), P(at(k, 0), top[k] - W.coping), frontDir);
    });
    // coping slab: top, front lip, and its back edge where the upper terrace is lower
    const c0 = P(at(k, -0.06), top[k]);
    const c1 = P(at(k + 1, -0.06), top[k + 1]);
    const c2 = P(at(k + 1, W.thickness), top[k + 1]);
    const c3 = P(at(k, W.thickness), top[k]);
    g.quadFacing(COPING, c0, c1, c2, c3, [0, 0, 1]);
    if (lod < 2) continue;
    g.quadFacing(COPING, P(at(k, -0.06), top[k] - W.coping), P(at(k + 1, -0.06), top[k + 1] - W.coping), c1, c0, frontDir);
    g.quadFacing(COPING, P(at(k, W.thickness), top[k] - W.coping - 0.3), P(at(k + 1, W.thickness), top[k + 1] - W.coping - 0.3), c2, c3, backDir);
  }
  // wall ends
  if (lod >= 2)
    for (const [k, s] of [[0, -1], [n, 1]] as [number, number][]) {
    const e = st([t.b[0] - t.a[0], t.b[1] - t.a[1]]);
    const z = st([0, 0]);
    const along: P3 = [(e[0] - z[0]) * s, (e[1] - z[1]) * s, 0];
    g.quadFacing(pal.plinth, P(at(k, 0), foot[k]), P(at(k, W.thickness), foot[k]), P(at(k, W.thickness), top[k]), P(at(k, 0), top[k]), along);
  }
}

/** Trampled grass and earth inside a run: a draped quad grid just above the terrain. */
function runGround(g: GeoBuilder, ring: EN[], st: (p: EN) => ST, ground: (p: EN) => number, lod: number): void {
  const [c0, c1, , c3] = ring;
  const na = lod >= 2 ? 2 : 1;
  const nd = lod >= 2 ? 6 : 2;
  const at = (i: number, j: number): EN => [c0[0] + ((c1[0] - c0[0]) * i) / na + ((c3[0] - c0[0]) * j) / nd, c0[1] + ((c1[1] - c0[1]) * i) / na + ((c3[1] - c0[1]) * j) / nd];
  const lift = lod >= 2 ? 0.05 : 0.09;
  const P = (p: EN): P3 => {
    const q = st(p);
    return [q[0], q[1], ground(p) + lift];
  };
  for (let i = 0; i < na; i++) for (let j = 0; j < nd; j++) g.quadFacing(RUN, P(at(i, j)), P(at(i + 1, j)), P(at(i + 1, j + 1)), P(at(i, j + 1)), [0, 0, 1]);
}

/** Coarse cord net over a run at the net height (D T1 "elf Fuß hohes Netz"; mesh I). */
function runNet(g: GeoBuilder, ring: EN[], st: (p: EN) => ST, ground: (p: EN) => number, NH: number): void {
  const [c0, c1, c2, c3] = ring;
  const cell = MENAGERIE.run.netCell;
  const w = MENAGERIE.run.cord;
  const lerp = (a: EN, b: EN, t: number): EN => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const sag = 0.25; // the net sags between its edges
  const depth = Math.hypot(c3[0] - c0[0], c3[1] - c0[1]);
  const width = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const nD = Math.max(1, Math.round(depth / cell));
  const nW = Math.max(1, Math.round(width / cell));
  for (let j = 0; j <= nD; j++) {
    const a = lerp(c0, c3, j / nD);
    const b = lerp(c1, c2, j / nD);
    const s = j === 0 || j === nD ? 0 : sag * Math.sin((Math.PI * j) / nD);
    rail(g, st(a), st(b), ground(a) + NH - s, ground(b) + NH - s, w, NET);
  }
  for (let i = 0; i <= nW; i++) {
    const a = lerp(c0, c1, i / nW);
    const b = lerp(c3, c2, i / nW);
    rail(g, st(a), st(b), ground(a) + NH, ground(b) + NH, w, NET);
  }
}

/**
 * KL-B41: the 10 m square island in the moat (LiDAR, D) with a sandstone quay wall and coping, a gravel top, the 2016
 * foundations of the pavilion as a low course on the building footprint and the spiral stair (D T20; its corner I).
 */
function island(g: GeoBuilder, L: BuildingLayout, st: (p: EN) => ST, ground: (p: EN) => number, pal: ExteriorPalette, ctx: BuildContext): void {
  const m = L.building.facade.menagerie!;
  const I = MENAGERIE.island;
  const spec = m.island!;
  const fp = L.ring.slice(0, -1).map(st);
  const s0 = Math.min(...fp.map((p) => p[0]));
  const s1 = Math.max(...fp.map((p) => p[0]));
  const t0 = Math.min(...fp.map((p) => p[1]));
  const t1 = Math.max(...fp.map((p) => p[1]));
  const sc = (s0 + s1) / 2;
  const tc = (t0 + t1) / 2;
  const hs = spec.size / 2;
  const top = spec.top_h;
  let floor = Infinity;
  for (const [ds, dt] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) floor = Math.min(floor, ground(stEN(L, sc + ds * hs, tc + dt * hs)));
  const foot = Math.min(floor, top - 1) - 0.4;
  const lod = ctx.lod;
  // quay wall (sandstone ashlar, per-face hue) and the coping ring
  const faces: [ST, ST, P3][] = [
    [[sc - hs, tc - hs], [sc + hs, tc - hs], [0, -1, 0]],
    [[sc + hs, tc - hs], [sc + hs, tc + hs], [1, 0, 0]],
    [[sc + hs, tc + hs], [sc - hs, tc + hs], [0, 1, 0]],
    [[sc - hs, tc + hs], [sc - hs, tc - hs], [-1, 0, 0]],
  ];
  faces.forEach(([a, b, n], i) => {
    const tint = blockTint(L.building.id, `quay${i}`, pal.colours.plinth, ctx.options.seed);
    g.withShade((_p, _ny, out) => {
      out[0] *= tint[0];
      out[1] *= tint[1];
      out[2] *= tint[2];
    }, () => g.quadFacing(pal.plinth, [a[0], a[1], foot], [b[0], b[1], foot], [b[0], b[1], top - I.coping], [a[0], a[1], top - I.coping], n));
  });
  const o = I.copingOver;
  const cw = 0.45;
  g.box(COPING, sc - hs - o, sc + hs + o, tc - hs - o, tc - hs + cw, top - I.coping, top);
  g.box(COPING, sc - hs - o, sc + hs + o, tc + hs - cw, tc + hs + o, top - I.coping, top);
  g.box(COPING, sc - hs - o, sc - hs + cw, tc - hs + cw, tc + hs - cw, top - I.coping, top);
  g.box(COPING, sc + hs - cw, sc + hs + o, tc - hs + cw, tc + hs - cw, top - I.coping, top);
  // gravel top inside the coping
  g.quadFacing(GRAVEL, [sc - hs + cw, tc - hs + cw, top - 0.02], [sc + hs - cw, tc - hs + cw, top - 0.02], [sc + hs - cw, tc + hs - cw, top - 0.02], [sc - hs + cw, tc + hs - cw, top - 0.02], [0, 0, 1]);
  // the documented foundations: a low course on the footprint (the 1 m quay walk round it)
  const fw = I.foundationWall;
  const fh = top + I.foundationH;
  const fk = matKey('stone.red', pal.colours.plinth);
  g.box(fk, s0, s1, t0, t0 + fw, top - 0.05, fh);
  g.box(fk, s0, s1, t1 - fw, t1, top - 0.05, fh);
  g.box(fk, s0, s0 + fw, t0 + fw, t1 - fw, top - 0.05, fh);
  g.box(fk, s1 - fw, s1, t0 + fw, t1 - fw, top - 0.05, fh);
  if (lod >= 1) g.quadFacing(matKey('floor.flags'), [s0 + fw, t0 + fw, fh - 0.02], [s1 - fw, t0 + fw, fh - 0.02], [s1 - fw, t1 - fw, fh - 0.02], [s0 + fw, t1 - fw, fh - 0.02], [0, 0, 1]);
  // the spiral stair (D T20): a newel with winding steps in one inner corner of the foundations [corner I]
  if (spec.stair !== false && lod >= 1) {
    const r = I.stairRadius;
    const cs = s1 - fw - r - 0.1;
    const ct = t1 - fw - r - 0.1;
    const n = I.stairSteps;
    const rise = I.stairRise / n;
    const sk = matKey('stone.red', pal.colours.plinth);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 1.75;
      const a1 = ((k + 1) / n) * Math.PI * 1.75;
      const z0 = fh;
      const z1 = fh + rise * (k + 1);
      const p0: P3 = [cs + Math.cos(a0) * r, ct + Math.sin(a0) * r, z1];
      const p1: P3 = [cs + Math.cos(a1) * r, ct + Math.sin(a1) * r, z1];
      g.polygonFacing(sk, [[cs, ct, z1], p0, p1], [0, 0, 1]);
      g.quadFacing(sk, [p0[0], p0[1], z0], [p1[0], p1[1], z0], p1, p0, [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0]);
      g.quadFacing(sk, [cs, ct, z0], [p0[0], p0[1], z0], p0, [cs, ct, z1], [-Math.sin(a0), Math.cos(a0), 0]);
    }
    g.box(sk, cs - 0.11, cs + 0.11, ct - 0.11, ct + 0.11, fh, fh + I.stairRise + 0.25);
  }
}

/** Building-local (s, t) of KL-B41 back to EN (for terrain samples). */
function stEN(L: BuildingLayout, s: number, t: number): EN {
  const f = L.frame;
  return [f.centreEN[0] + s * f.sDir[0] + t * f.tDir[0], f.centreEN[1] + s * f.sDir[1] + t * f.tDir[1]];
}

/**
 * KL-B41a (hypothesis, low): an open light structure on the island foundations: slender painted timber posts round
 * the footprint, a beam and a slate pyramid roof like the ring houses [I; superstructure U, T20].
 */
function openPavilion(g: GeoBuilder, gr: GeoBuilder, L: BuildingLayout, st: (p: EN) => ST, lod: number): void {
  const O = MENAGERIE.openPavilion;
  const fp = L.ring.slice(0, -1).map(st);
  const s0 = Math.min(...fp.map((p) => p[0])) + 0.2;
  const s1 = Math.max(...fp.map((p) => p[0])) - 0.2;
  const t0 = Math.min(...fp.map((p) => p[1])) + 0.2;
  const t1 = Math.max(...fp.map((p) => p[1])) - 0.2;
  const base = L.stack.base_h;
  const eaves = L.roof.eaves_h;
  const postK = matKey('wood.frame', '#D9D5CC');
  const n = O.postsPerSide;
  const w = O.post / 2;
  for (let i = 0; i < n; i++)
    for (const [a, b] of [
      [s0 + ((s1 - s0) * i) / (n - 1), t0],
      [s1, t0 + ((t1 - t0) * i) / (n - 1)],
      [s1 - ((s1 - s0) * i) / (n - 1), t1],
      [s0, t1 - ((t1 - t0) * i) / (n - 1)],
    ] as ST[]) {
      if (i === n - 1) continue; // corners once
      g.box(postK, a - w, a + w, b - w, b + w, base, eaves - O.beam);
      if (lod >= 1) g.box(postK, a - w - 0.06, a + w + 0.06, b - w - 0.06, b + w + 0.06, base, base + 0.18); // base block
    }
  const bw = O.post / 2 + 0.03;
  g.box(postK, s0 - bw, s1 + bw, t0 - bw, t0 + bw, eaves - O.beam, eaves);
  g.box(postK, s0 - bw, s1 + bw, t1 - bw, t1 + bw, eaves - O.beam, eaves);
  g.box(postK, s0 - bw, s0 + bw, t0 + bw, t1 - bw, eaves - O.beam, eaves);
  g.box(postK, s1 - bw, s1 + bw, t0 + bw, t1 - bw, eaves - O.beam, eaves);
  // slate pyramid with a small overhang (pitch from the catalogue roof), soffit at LOD2
  const pitch = L.roofSpec.pitch_lower ?? 35;
  const P = (s: number, t: number, z: number): P3 => [s, t, z];
  const sc = (s0 + s1) / 2;
  const tc = (t0 + t1) / 2;
  const hs = (s1 - s0) / 2 + 0.5;
  const ht = (t1 - t0) / 2 + 0.5;
  const apex = P(sc, tc, eaves + Math.min(hs, ht) * Math.tan((pitch * Math.PI) / 180));
  const eave = [P(sc - hs, tc - ht, eaves - 0.1), P(sc + hs, tc - ht, eaves - 0.1), P(sc + hs, tc + ht, eaves - 0.1), P(sc - hs, tc + ht, eaves - 0.1)];
  const roofK = matKey('roof.slate');
  for (let i = 0; i < 4; i++) {
    const p = eave[i];
    const q = eave[(i + 1) % 4];
    gr.polygonFacing(roofK, [p, q, apex], [(p[0] + q[0]) / 2 - sc, (p[1] + q[1]) / 2 - tc, 1]);
  }
  gr.polygonFacing(roofK, [...eave], [0, 0, -1]);
  if (lod >= 2) post(gr, [apex[0], apex[1]], apex[2] - 0.05, apex[2] + 0.4, 0.06, matKey('roof.lead'));
}

/** One house: block (LOD0/1) or plinth + walls round an open grille front (LOD2), and its roof. */
function house(g: GeoBuilder, gr: GeoBuilder, h: MenagerieHouse, st: (p: EN) => ST, ground: (p: EN) => number, pal: ExteriorPalette, roofK: MatKey, lod: number, backGround?: number): void {
  const fr = h.front;
  const tn: EN = [fr[1], -fr[0]]; // along the front, left to right seen from outside
  const at = (a: number, d: number): EN => [h.centre[0] + tn[0] * a + fr[0] * d, h.centre[1] + tn[1] * a + fr[1] * d];
  const W = h.width / 2;
  const D = h.depth / 2;
  const corners = [at(-W, D), at(W, D), at(W, -D), at(-W, -D)];
  const gs = corners.map(ground);
  const foot = Math.min(...gs) - 0.25;
  const floor = Math.max(...gs) + 0.15;
  const eaves = floor + h.eaves;
  // plan frame of the house in object space
  const c = st(h.centre);
  const ca = st(at(1, 0));
  const cd = st(at(0, 1));
  const tA: ST = [ca[0] - c[0], ca[1] - c[1]];
  const tD: ST = [cd[0] - c[0], cd[1] - c[1]];
  const P = (a: number, d: number, z: number): P3 => [c[0] + tA[0] * a + tD[0] * d, c[1] + tA[1] * a + tD[1] * d, z];
  const blk = (k: MatKey, a0: number, a1: number, d0: number, d1: number, z0: number, z1: number, top = true) => block(g, k, P, a0, a1, d0, d1, z0, z1, top);
  if (lod < 2) {
    blk(pal.wall, -W, W, -D, D, foot, eaves);
    if (lod >= 1) blk(pal.plinth, -W - 0.04, W + 0.04, -D - 0.04, D + 0.04, foot, floor, false);
  } else {
    const T = 0.3;
    const pier = Math.min(0.45, h.width * 0.13);
    blk(pal.plinth, -W - 0.04, W + 0.04, -D - 0.04, D + 0.04, foot, floor);
    blk(pal.wall, -W, W, -D, -D + T, floor, eaves); // back
    blk(pal.wall, -W, -W + T, -D + T, D, floor, eaves); // sides
    blk(pal.wall, W - T, W, -D + T, D, floor, eaves);
    blk(pal.wall, -W + T, -W + T + pier, D - T, D, floor, eaves); // front piers
    blk(pal.wall, W - T - pier, W - T, D - T, D, floor, eaves);
    const lintel = eaves - Math.min(0.55, h.eaves * 0.22);
    blk(pal.wall, -W + T + pier, W - T - pier, D - T, D, lintel, eaves);
    // dark inside (straw, soot) so the open front reads as a den
    g.quadFacing(DARK, P(-W + T, -D + T + 0.01, floor), P(W - T, -D + T + 0.01, floor), P(W - T, -D + T + 0.01, lintel), P(-W + T, -D + T + 0.01, lintel), dirOf(P, 0, 1));
    g.quadFacing(DARK, P(-W + T, -D + T, floor + 0.01), P(W - T, -D + T, floor + 0.01), P(W - T, D, floor + 0.01), P(-W + T, D, floor + 0.01), [0, 0, 1]);
    // iron grille in the front opening: bars + two rails
    const a0 = -W + T + pier;
    const a1 = W - T - pier;
    const bar = MENAGERIE.grille.bar;
    const n = Math.max(2, Math.round((a1 - a0) / bar));
    for (let i = 1; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      blk(IRON, a - 0.012, a + 0.012, D - 0.17, D - 0.14, floor, lintel, false);
    }
    for (const z of [floor + 0.12, lintel - 0.12]) blk(IRON, a0, a1, D - 0.18, D - 0.13, z - 0.025, z + 0.025, true);
    // stoke-hole door on the back: the den is heated from outside in winter (T1 p. 383) [I position]; a row house backs
    // onto its terrace wall, so the hole opens above the upper terrace
    const sb = Math.min(eaves - 1.0, Math.max(floor - 0.1, (backGround ?? -Infinity) + 0.15));
    if (h.kind === 'house') blk(DOOR, -0.35, 0.35, -D - 0.03, -D, sb, sb + 0.85, true);
    else blk(DOOR, -0.6, 0.6, -D - 0.03, -D, floor, floor + 2.3, true);
  }
  // roof with a small overhang
  const o = 0.25;
  const rw = W + o;
  const rd = D + o;
  const tanP = Math.tan((h.pitch * Math.PI) / 180);
  const ez = eaves - o * tanP * 0.5;
  if (h.roof === 'pyramid') {
    const apex = P(0, 0, eaves + Math.min(W, D) * tanP);
    const eave = [P(-rw, rd, ez), P(rw, rd, ez), P(rw, -rd, ez), P(-rw, -rd, ez)];
    for (let i = 0; i < 4; i++) {
      const p = eave[i];
      const q = eave[(i + 1) % 4];
      const mid: P3 = [(p[0] + q[0]) / 2 - apex[0], (p[1] + q[1]) / 2 - apex[1], 0];
      gr.polygonFacing(roofK, [p, q, apex], [mid[0], mid[1], 1]);
    }
    if (lod >= 2) gr.polygonFacing(roofK, [...eave], [0, 0, -1]);
    if (lod >= 2) post(gr, [apex[0], apex[1]], apex[2] - 0.05, apex[2] + 0.35, 0.05, matKey('roof.lead'));
  } else {
    // gable: ridge along the front (a), slopes to the front and the back
    const rz = eaves + D * tanP;
    const r0 = P(-rw, 0, rz);
    const r1 = P(rw, 0, rz);
    gr.polygonFacing(roofK, [P(-rw, rd, ez), P(rw, rd, ez), r1, r0], dirOf(P, 0, 1, 1));
    gr.polygonFacing(roofK, [P(rw, -rd, ez), P(-rw, -rd, ez), r0, r1], dirOf(P, 0, -1, 1));
    // gable triangles
    for (const s of [-1, 1]) g.polygonFacing(pal.wall, [P(s * W, D, eaves), P(s * W, -D, eaves), P(s * W, 0, rz)], dirOf(P, s, 0));
    if (lod >= 2) {
      gr.polygonFacing(roofK, [P(-rw, rd, ez), P(rw, rd, ez), P(rw, -rd, ez), P(-rw, -rd, ez)], [0, 0, -1]);
    }
  }
}

/** Outward direction (a, d[, up]) in object space. */
function dirOf(P: (a: number, d: number, z: number) => P3, a: number, d: number, up = 0): P3 {
  const o = P(0, 0, 0);
  const q = P(a, d, 0);
  return [q[0] - o[0], q[1] - o[1], up];
}

/** Box in a house frame; faces oriented outward with quadFacing (any handedness of the frame). */
function block(g: GeoBuilder, k: MatKey, P: (a: number, d: number, z: number) => P3, a0: number, a1: number, d0: number, d1: number, z0: number, z1: number, top = true): void {
  const am = (a0 + a1) / 2;
  const dm = (d0 + d1) / 2;
  const out = (a: number, d: number): P3 => dirOf(P, a - am, d - dm);
  g.quadFacing(k, P(a0, d1, z0), P(a1, d1, z0), P(a1, d1, z1), P(a0, d1, z1), out(am, d1));
  g.quadFacing(k, P(a0, d0, z0), P(a1, d0, z0), P(a1, d0, z1), P(a0, d0, z1), out(am, d0));
  g.quadFacing(k, P(a0, d0, z0), P(a0, d1, z0), P(a0, d1, z1), P(a0, d0, z1), out(a0, dm));
  g.quadFacing(k, P(a1, d0, z0), P(a1, d1, z0), P(a1, d1, z1), P(a1, d0, z1), out(a1, dm));
  if (top) g.quadFacing(k, P(a0, d0, z1), P(a1, d0, z1), P(a1, d1, z1), P(a0, d1, z1), [0, 0, 1]);
}

/** Square post centred on q. */
function post(g: GeoBuilder, q: ST, z0: number, z1: number, w: number, k: MatKey = IRON): void {
  g.box(k, q[0] - w / 2, q[0] + w / 2, q[1] - w / 2, q[1] + w / 2, z0, z1);
}

/** Thin rail from a to b (heights za, zb), square section w. */
function rail(g: GeoBuilder, a: ST, b: ST, za: number, zb: number, w: number, k: MatKey = IRON): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const n: ST = [(-dy / l) * (w / 2), (dx / l) * (w / 2)];
  const p = (q: ST, s: number, z: number): P3 => [q[0] + n[0] * s, q[1] + n[1] * s, z];
  g.quadFacing(k, p(a, -1, za + w / 2), p(b, -1, zb + w / 2), p(b, 1, zb + w / 2), p(a, 1, za + w / 2), [0, 0, 1]);
  g.quadFacing(k, p(a, 1, za - w / 2), p(b, 1, zb - w / 2), p(b, 1, zb + w / 2), p(a, 1, za + w / 2), [n[0], n[1], 0]);
  g.quadFacing(k, p(a, -1, za - w / 2), p(b, -1, zb - w / 2), p(b, -1, zb + w / 2), p(a, -1, za + w / 2), [-n[0], -n[1], 0]);
}

/** Iron fence a -> b: posts every ≈ 2 m and two rails; with `bar` > 0 every bar at that pitch. */
function fence(g: GeoBuilder, a: ST, b: ST, za: number, zb: number, height: number, bar: number): void {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < 0.2) return;
  const at = (t: number): ST => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const z = (t: number) => za + (zb - za) * t;
  const np = Math.max(1, Math.round(l / 2));
  for (let i = 0; i <= np; i++) post(g, at(i / np), z(i / np) - 0.2, z(i / np) + height, 0.07);
  for (const r of [0.15, height - 0.1]) rail(g, a, b, za + r, zb + r, 0.04);
  if (bar > 0) {
    // square wrought-iron bars (wave-6 review: not a mesh): 4 faces each, ≈ 25 mm at ≈ 0.2 m centres, LOD2 only
    const nb = Math.round(l / bar);
    const hw = MENAGERIE.grille.barWidth / 2;
    const u: ST = [((b[0] - a[0]) / l) * hw, ((b[1] - a[1]) / l) * hw];
    const v: ST = [(-(b[1] - a[1]) / l) * hw, ((b[0] - a[0]) / l) * hw];
    for (let i = 1; i < nb; i++) {
      const t = i / nb;
      const q = at(t);
      const z0 = z(t) + 0.1;
      const z1 = z(t) + height - 0.05;
      const c = [
        [q[0] - u[0] - v[0], q[1] - u[1] - v[1]],
        [q[0] + u[0] - v[0], q[1] + u[1] - v[1]],
        [q[0] + u[0] + v[0], q[1] + u[1] + v[1]],
        [q[0] - u[0] + v[0], q[1] - u[1] + v[1]],
      ];
      for (let e = 0; e < 4; e++) {
        const p = c[e];
        const r = c[(e + 1) % 4];
        g.quadFacing(IRON, [p[0], p[1], z0], [r[0], r[1], z0], [r[0], r[1], z1], [p[0], p[1], z1], [(p[0] + r[0]) / 2 - q[0], (p[1] + r[1]) / 2 - q[1], 0]);
      }
    }
  }
}

/** The watercourse through the runs: a water strip between two sandstone kerbs, following the ground. */
function channel(g: GeoBuilder, line: EN[], st: (p: EN) => ST, ground: (p: EN) => number, lod: number): void {
  const C = MENAGERIE.channel;
  const water = matKey('water');
  const kerb = matKey('stone.red', '#9C6A55');
  // resample every ≈ 4 m so the strip follows the terrace steps
  const pts: EN[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const e = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(e[0] - a[0], e[1] - a[1]) / 4));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + ((e[0] - a[0]) * k) / n, a[1] + ((e[1] - a[1]) * k) / n]);
  }
  const hw = C.width / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const e = pts[i];
    const l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const nE: EN = [-(e[1] - a[1]) / l, (e[0] - a[0]) / l];
    const side = (p: EN, s: number): EN => [p[0] + nE[0] * s, p[1] + nE[1] * s];
    const za = Math.min(ground(side(a, -hw)), ground(side(a, hw))) - 0.12;
    const ze = Math.min(ground(side(e, -hw)), ground(side(e, hw))) - 0.12;
    const P = (p: EN, z: number): P3 => {
      const q = st(p);
      return [q[0], q[1], z];
    };
    g.quadFacing(water, P(side(a, -hw), za), P(side(e, -hw), ze), P(side(e, hw), ze), P(side(a, hw), za), [0, 0, 1]);
    // kerbs at LOD1 too (wave-6 review: the watercourse must read from the air); inner faces only at LOD2
    if (lod >= 1)
      for (const s of [-1, 1]) {
        const i0 = side(a, s * hw);
        const i1 = side(e, s * hw);
        const o0 = side(a, s * (hw + C.kerb));
        const o1 = side(e, s * (hw + C.kerb));
        const ka = Math.max(ground(o0), za + 0.2) + 0.06;
        const ke = Math.max(ground(o1), ze + 0.2) + 0.06;
        g.quadFacing(kerb, P(i0, ka), P(i1, ke), P(o1, ke), P(o0, ka), [0, 0, 1]);
        if (lod < 2) continue;
        const inner = st(side(a, -s));
        const cq = st(a);
        g.quadFacing(kerb, P(i0, za - 0.1), P(i1, ze - 0.1), P(i1, ke), P(i0, ka), [inner[0] - cq[0], inner[1] - cq[1], 0]);
      }
  }
}

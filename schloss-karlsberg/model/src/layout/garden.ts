/**
 * Garden layout helpers (pure, no three.js; KB-I11..I13, research/11 §6.2 S2-S4, §6.5 tests):
 * smoothed walk lines and their ribbons, plants inside a clump, single trees, the formal basin ring and its rim
 * ornaments, and the avenue-tree blockers shared by the 3D site and the plans.
 *
 * Plan coordinates are any metric 2D frame (EN in practice). All randomness is seeded (mulberry32).
 */
import type { EN, PlantMix, SiteSpec, TerrainFeature } from '../spec.ts';
import { inEpoch, inScene, SCENE_YEAR } from './epoch.ts';
import { type P2, mulberry32, pointAlong, pointInPolygon, polylineLength } from './geom.ts';
import { GARDEN, GARDEN_DETAIL } from './grammar.ts';

// ------------------------------------------------------------------------------------------------ lines

/**
 * Chaikin corner cutting: `iterations` rounds of 1/4-3/4 cuts. Open lines keep their end points; closed lines
 * (first point = last point) stay closed. Gives the long continuous arcs Sckell asks for from a coarse polygon.
 */
export function chaikin(line: readonly P2[], iterations = 3): P2[] {
  let pts: P2[] = line.map((p) => [p[0], p[1]]);
  const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  for (let it = 0; it < iterations; it++) {
    const src = closed ? pts.slice(0, -1) : pts;
    const n = src.length;
    const out: P2[] = closed ? [] : [src[0]];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = src[i];
      const b = src[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (closed) out.push(out[0]);
    else out.push(src[n - 1]);
    pts = out;
  }
  return pts;
}

/** Points every `step` m along a polyline (both ends included). */
export function resample(line: readonly P2[], step: number): P2[] {
  const L = polylineLength(line);
  const n = Math.max(1, Math.ceil(L / step));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push(pointAlong(line, (L * i) / n).p);
  return out;
}

export interface Ribbon {
  /** Centre line as sampled. */
  centre: P2[];
  /** Left and right edges (left = +90° from the walking direction). */
  left: P2[];
  right: P2[];
  width: number;
}

/**
 * Ribbon of a walk: the centre line resampled every `step` m and offset by ±width/2 along the averaged normal
 * (miter, clamped to 2× the half width). Closed lines get a seamless join.
 */
export function walkRibbon(line: readonly P2[], width: number, step: number = GARDEN.ribbonStep): Ribbon {
  const closed = line.length > 2 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
  const c = resample(line, step);
  const n = c.length;
  const half = width / 2;
  const dirAt = (i: number): P2 => {
    const a = c[Math.max(0, i - 1)];
    const b = c[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    if (closed && (i === 0 || i === n - 1)) {
      dx = c[1][0] - c[n - 2][0];
      dy = c[1][1] - c[n - 2][1];
    }
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const left: P2[] = [];
  const right: P2[] = [];
  for (let i = 0; i < n; i++) {
    const d = dirAt(i);
    const nx = -d[1];
    const ny = d[0];
    left.push([c[i][0] + nx * half, c[i][1] + ny * half]);
    right.push([c[i][0] - nx * half, c[i][1] - ny * half]);
  }
  return { centre: c, left, right, width };
}

function segIntersect(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when a polyline crosses itself (non-adjacent segments; a closed line's first and last segments are adjacent). */
export function polylineSelfIntersects(pts: readonly P2[]): boolean {
  const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const m = pts.length - 1;
  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      if (closed && i === 0 && j === m - 1) continue;
      if (segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  }
  return false;
}

/** Distance from a point to a polyline. */
export function distanceToLine(line: readonly P2[], p: P2): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ plants

export interface Plant {
  E: number;
  N: number;
  /** Catalogue species text (resolve with site/trees.ts `speciesFor`). */
  species: string;
  /** Height in m. */
  height: number;
}

/** Integer counts per mix entry for `n` plants (largest remainder; every share > 0 gets ≥ 1 when n ≥ entries). */
export function allocateShares(mix: readonly PlantMix[], n: number): number[] {
  const tot = mix.reduce((a, m) => a + m.share, 0) || 1;
  const raw = mix.map((m) => (m.share / tot) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  if (n >= mix.length) {
    for (let i = 0; i < out.length; i++) {
      if (out[i] > 0) continue;
      const j = out.indexOf(Math.max(...out));
      out[j]--;
      out[i]++;
    }
  }
  return out;
}

/** Height range of a mix entry: its own, else the garden norm for shrubs / poplars / conifers / old trees / young trees. */
export function mixHeight(m: PlantMix): [number, number] {
  if (m.height) return m.height;
  const t = m.species.toLowerCase();
  if (/shrub|strauch|sträucher|syringa|philadelphus|viburnum|rosa\b/.test(t)) return [...GARDEN.shrub];
  if (/pappel|populus/.test(t)) return [...GARDEN.poplar.height];
  if (/retained|überhälter|beech_old/.test(t)) return [...GARDEN.retainedTree];
  return [...GARDEN.youngTree];
}

export interface ClumpOptions {
  seed?: number;
  /** Plants per m² inverse (default GARDEN.clump.areaPerPlant). */
  areaPerPlant?: number;
}

/**
 * Plants of one clump of radius `radius` around `centre`: count from the area, species counts from the mix shares
 * (exact to ±1 plant), heights inside each entry's range. Tall plants (> shrub height) stand in the core
 * (≤ coreFrac · R), shrubs in a staggered mantle (tall ones inside, low ones out to the rim, GARDEN.clump.shrubOuterFrac),
 * at least `minSpacing` apart when room allows. Deterministic per seed; every plant lies inside the radius.
 */
export function clumpPlants(centre: P2, radius: number, mix: readonly PlantMix[], opts: ClumpOptions = {}): Plant[] {
  const rnd = mulberry32(opts.seed ?? 1789);
  const n = clumpPlantCount(radius, opts.areaPerPlant);
  const counts = allocateShares(mix, n);
  const list: { species: string; height: number }[] = [];
  mix.forEach((m, i) => {
    const [h0, h1] = mixHeight(m);
    for (let k = 0; k < counts[i]; k++) list.push({ species: m.species, height: h0 + (h1 - h0) * rnd() });
  });
  list.sort((a, b) => b.height - a.height);
  const placed: Plant[] = [];
  const [shrubMin, shrubMax] = GARDEN.shrub;
  const [mantleIn, mantleOut] = GARDEN.clump.shrubOuterFrac;
  for (const p of list) {
    const tall = p.height > shrubMax;
    // staggered mantle: the tallest shrubs reach only mantleIn·R, the lowest the rim (mantleOut·R)
    const low = Math.min(1, Math.max(0, (shrubMax - p.height) / Math.max(1e-6, shrubMax - shrubMin)));
    const r0 = tall ? 0 : GARDEN.clump.shrubInnerFrac * radius;
    const r1 = tall ? GARDEN.clump.coreFrac * radius : radius * (mantleIn + (mantleOut - mantleIn) * low);
    let best: P2 = centre;
    let bestD = -1;
    for (let k = 0; k < 24; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + rnd() * (r1 * r1 - r0 * r0));
      const q: P2 = [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r];
      const d = placed.reduce((m, o) => Math.min(m, Math.hypot(o.E - q[0], o.N - q[1])), Infinity);
      if (d > bestD) {
        bestD = d;
        best = q;
      }
      if (d >= GARDEN.clump.minSpacing) break;
    }
    placed.push({ E: best[0], N: best[1], species: p.species, height: p.height });
  }
  return placed;
}

/** Number of plants `clumpPlants` sets in a clump of `radius` m (area / areaPerPlant, at least 1). */
export function clumpPlantCount(radius: number, areaPerPlant: number = GARDEN.clump.areaPerPlant): number {
  return Math.max(1, Math.round((Math.PI * radius * radius) / areaPerPlant));
}

/** Accent plants (a conifer or poplar) of a clump of diameter `d` m: one, two from GARDEN.clump.accents.largeFrom. */
export function clumpAccents(d: number): number {
  const a = GARDEN.clump.accents;
  return d >= a.largeFrom ? a.base + 1 : a.base;
}

/** Single trees at given points: species by the mix shares (shuffled deterministically), heights in range. */
export function singleTrees(points: readonly P2[], mix: readonly PlantMix[], seed = 1789): Plant[] {
  const rnd = mulberry32(seed);
  const counts = allocateShares(mix, points.length);
  const pool: number[] = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) pool.push(i);
  });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return points.map((p, i) => {
    const m = mix[pool[i]];
    const [h0, h1] = mixHeight(m);
    return { E: p[0], N: p[1], species: m.species, height: h0 + (h1 - h0) * rnd() };
  });
}

// ------------------------------------------------------------------------------------------------ edges

export interface EdgePiece {
  /** Start and end on the polygon edge. */
  a: P2;
  b: P2;
  /** Unit direction a -> b and unit outward normal. */
  tan: P2;
  out: P2;
  /** Index of the polygon edge the piece belongs to; first / last piece of that edge. */
  edge: number;
  first: boolean;
  last: boolean;
}

/**
 * The edges of a closed polygon cut into pieces of at most `maxLen` m, each with its outward normal (whatever the
 * ring's orientation). Used for terrace kerbs (features.ts) so that each piece can test what lies outside it.
 */
export function edgePieces(ring: readonly P2[], maxLen = 1): EdgePiece[] {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  const ccw = area2 > 0;
  const out: EdgePiece[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const tan: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    // CCW: the interior is on the left, so outward is the right-hand normal
    const o: P2 = ccw ? [tan[1], -tan[0]] : [-tan[1], tan[0]];
    const n = Math.max(1, Math.ceil(L / maxLen - 1e-9));
    for (let k = 0; k < n; k++) {
      const t0 = (L * k) / n;
      const t1 = (L * (k + 1)) / n;
      out.push({ a: [a[0] + tan[0] * t0, a[1] + tan[1] * t0], b: [a[0] + tan[0] * t1, a[1] + tan[1] * t1], tan, out: o, edge: i, first: k === 0, last: k === n - 1 });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ basin

/** Closed circle ring (n segments, first = last). */
export function circleRing(centre: P2, radius: number, n = 32): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * Math.PI * 2;
    out.push([centre[0] + Math.cos(a) * radius, centre[1] + Math.sin(a) * radius]);
  }
  return out;
}

export interface RimOrnament {
  /** Position on the coping centre line. */
  p: P2;
  /** Unit plan direction the sculpture looks at. */
  facing: P2;
}

/**
 * Rim ornaments of a round basin (e.g. the two stag heads, research/11 S3): `count` sculptures on the rim on the
 * side away from `toward`, spread ±rimAngle around that far point, each looking at `toward` (so both face the CdL
 * across the water).
 */
export function basinOrnaments(centre: P2, radius: number, count: number, toward: P2): RimOrnament[] {
  const dx = toward[0] - centre[0];
  const dy = toward[1] - centre[1];
  const base = Math.atan2(-dy, -dx); // far side
  const spread = (GARDEN.stagHead.rimAngle * Math.PI) / 180;
  const out: RimOrnament[] = [];
  for (let i = 0; i < count; i++) {
    const a = count === 1 ? base : base - spread + (2 * spread * i) / (count - 1);
    const p: P2 = [centre[0] + Math.cos(a) * radius, centre[1] + Math.sin(a) * radius];
    const fx = toward[0] - p[0];
    const fy = toward[1] - p[1];
    const l = Math.hypot(fx, fy) || 1;
    out.push({ p, facing: [fx / l, fy / l] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ avenue blockers

/** Feature kinds whose polygons stop avenue trees (± 3 m): courts, terraces, parterres, ponds and basins. */
export const TREE_BLOCKING_KINDS: ReadonlySet<TerrainFeature['kind']> = new Set(['court', 'terrace', 'parterre', 'pond']);
const OFFS: readonly P2[] = [
  [0, 0],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
];

/**
 * Polygons that stop the trees of avenue `f` in `year`: blocking features, building footprints and, for a
 * hypothetical avenue (TF-11, research/11 G4), the lawns: Petri's plan shows an open lawn behind the CdL [D], so an
 * avenue in no period plan is not drawn across it. Shared by model/src/site/features.ts and plans/src/geom/trees.ts.
 */
export function avenueBlockers(spec: SiteSpec, f: TerrainFeature | null, year: number = SCENE_YEAR): EN[][] {
  const out: EN[][] = [];
  const hypo = f?.placement === 'hypothetical';
  for (const x of inScene(spec.terrain_features, year)) {
    if (x.geometry.type !== 'Polygon') continue;
    if (TREE_BLOCKING_KINDS.has(x.kind) || (hypo && x.kind === 'lawn')) out.push(x.geometry.coordinates[0]);
  }
  for (const b of spec.buildings) if (b.footprint && b.base_h !== null && inEpoch(b.epoch, year)) out.push(b.footprint);
  return out;
}

/** True when a tree at (E, N) or 3 m around it falls into one of the blockers. */
export function treeBlocked(E: number, N: number, blockers: readonly (readonly P2[])[]): boolean {
  return blockers.some((r) => OFFS.some(([dx, dy]) => pointInPolygon([E + dx, N + dy], r)));
}

// ------------------------------------------------------------------------------------------------ wave 5 (KB-I33..I38)

/** Axis-aligned rectangle in the palace grid (u along the CdL axis, v toward N). */
export interface RectUV {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Closed ring of a rectangle (CCW in u, v). */
export function rectRing(r: RectUV): P2[] {
  return [
    [r.u0, r.v0],
    [r.u1, r.v0],
    [r.u1, r.v1],
    [r.u0, r.v1],
    [r.u0, r.v0],
  ];
}

/** Rectangle shrunk by d on every side (may become empty: u0 >= u1). */
export function insetRect(r: RectUV, d: number): RectUV {
  return { u0: r.u0 + d, u1: r.u1 - d, v0: r.v0 + d, v1: r.v1 - d };
}

/** Closed ring of a rectangle with its corners cut by legs of `c` m (an octagon; c = 0 gives the rectangle). */
export function cutCornerRing(r: RectUV, c: number): P2[] {
  const k = Math.max(0, Math.min(c, (r.u1 - r.u0) / 3, (r.v1 - r.v0) / 3));
  if (k <= 1e-6) return rectRing(r);
  return [
    [r.u0 + k, r.v0],
    [r.u1 - k, r.v0],
    [r.u1, r.v0 + k],
    [r.u1, r.v1 - k],
    [r.u1 - k, r.v1],
    [r.u0 + k, r.v1],
    [r.u0, r.v1 - k],
    [r.u0, r.v0 + k],
    [r.u0 + k, r.v0],
  ];
}

export interface AngloiseCompartment {
  /** Outer rectangle of the compartment (outer edge of the plate-bande). */
  outer: RectUV;
  /** Plate-bande: the band between `outer` and `bandInner`. */
  bandInner: RectUV;
  /** Lawn panel with cut corners (the sanded sentier lies between bandInner and the panel). */
  panel: P2[];
  panelRect: RectUV;
}

export interface AngloiseLayout {
  /** The whole parterre (inside the border walk). */
  field: RectUV;
  compartments: AngloiseCompartment[];
  /** Yew cones on the plate-bande centre lines (corners and axes) and standard roses between them on the long sides. */
  cones: P2[];
  roses: P2[];
  /** Citrus tub positions on the walk edges (empty unless `tubs`). */
  tubs: P2[];
}

export interface AngloiseOptions {
  panels: [number, number];
  crossWalk?: number;
  border?: number;
  tubs?: boolean;
}

/**
 * Parterre à l'angloise (d'Argenville 1747, research/11 §4.3, S7, S8; GARDEN_DETAIL.angloise) in the palace grid:
 * the area `r` minus a perimeter walk (`border`) is split into panels[0] × panels[1] compartments by cross walks;
 * each compartment is a box-edged plate-bande (width `plateBande`), a sanded sentier (`sentier`) and a lawn panel with
 * cut corners. Yew cones mark the corners and axes of the plate-bande centre line and standard roses stand midway
 * between them on the long sides (wave-5 fix: the type is lawn-dominant, research/11 §4.3). Tubs (S8) stand on the cross-walk and border edges every GARDEN_DETAIL.tub.spacing m,
 * `tub.size` from the plate-bande. Compartments narrower than 2 · (plate-bande + sentier) + panelMin are dropped.
 */
export function parterreAnglaise(r: RectUV, o: AngloiseOptions): AngloiseLayout {
  const A = GARDEN_DETAIL.angloise;
  const cw = o.crossWalk ?? A.crossWalk;
  const field = insetRect(r, o.border ?? A.border);
  const [nu, nv] = o.panels;
  const du = (field.u1 - field.u0 - (nu - 1) * cw) / nu;
  const dv = (field.v1 - field.v0 - (nv - 1) * cw) / nv;
  const compartments: AngloiseCompartment[] = [];
  const cones: P2[] = [];
  const roses: P2[] = [];
  const tubs: P2[] = [];
  const minSide = 2 * (A.plateBande + A.sentier) + A.panelMin;
  if (du >= minSide && dv >= minSide) {
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const outer: RectUV = { u0: field.u0 + i * (du + cw), u1: field.u0 + i * (du + cw) + du, v0: field.v0 + j * (dv + cw), v1: field.v0 + j * (dv + cw) + dv };
        const bandInner = insetRect(outer, A.plateBande);
        const panelRect = insetRect(bandInner, A.sentier);
        compartments.push({ outer, bandInner, panelRect, panel: cutCornerRing(panelRect, A.corner) });
        // wave-5 fix (lawn-dominant type, research/11 §4.3): cones mark only the corners and the axes (side middles) of
        // the plate-bande centre line; standard roses stand midway between corner and axis on the long sides only
        const m = insetRect(outer, A.plateBande / 2);
        const mu = (m.u0 + m.u1) / 2;
        const mv = (m.v0 + m.v1) / 2;
        cones.push([m.u0, m.v0], [mu, m.v0], [m.u1, m.v0], [m.u1, mv], [m.u1, m.v1], [mu, m.v1], [m.u0, m.v1], [m.u0, mv]);
        if (m.u1 - m.u0 >= m.v1 - m.v0) for (const v of [m.v0, m.v1]) roses.push([(m.u0 + mu) / 2, v], [(mu + m.u1) / 2, v]);
        else for (const u of [m.u0, m.u1]) roses.push([u, (m.v0 + mv) / 2], [u, (mv + m.v1) / 2]);
      }
    }
  }
  if (o.tubs && compartments.length) {
    const T = GARDEN_DETAIL.tub;
    // a row of tubs on the walk side of every compartment edge, `size` m out from the plate-bande
    for (const c of compartments) {
      const off = T.size * 0.5 + 0.35;
      const edges: [P2, P2][] = [
        [[c.outer.u0, c.outer.v0 - off], [c.outer.u1, c.outer.v0 - off]],
        [[c.outer.u0, c.outer.v1 + off], [c.outer.u1, c.outer.v1 + off]],
        [[c.outer.u0 - off, c.outer.v0], [c.outer.u0 - off, c.outer.v1]],
        [[c.outer.u1 + off, c.outer.v0], [c.outer.u1 + off, c.outer.v1]],
      ];
      for (const [a, b] of edges) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.floor(L / T.spacing));
        const pad = (L - (n - 1) * T.spacing) / 2;
        for (let k = 0; k < n; k++) {
          const t = (pad + k * T.spacing) / L;
          const p: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          if (p[0] < r.u0 + 0.5 || p[0] > r.u1 - 0.5 || p[1] < r.v0 + 0.5 || p[1] > r.v1 - 0.5) continue;
          if (tubs.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < T.spacing * 0.6)) continue; // shared cross walks
          tubs.push(p);
        }
      }
    }
  }
  return { field, compartments, cones, roses, tubs };
}

export interface KitchenBed {
  /** Bed rectangle (u, v). */
  rect: RectUV;
  /** Crop index 0..crops-1 (seeded; neighbouring beds differ). */
  crop: number;
  /** Rows run along u ('u') or v ('v'). */
  along: 'u' | 'v';
}

export interface KitchenLayout {
  quarters: RectUV[];
  beds: KitchenBed[];
}

/**
 * Kitchen / forcing garden (research/11 S11, GARDEN_DETAIL.kitchen): the area `r` minus a perimeter border (`edge`, the
 * wall border and walk) is split into quarters[0] × quarters[1] quarters by cross walks (`quarterWalk`); in each quarter
 * beds of `bed` m with `path` m paths run alternately along u and v (quarter by quarter, as the period plans draw the
 * quarters with crops in different directions [D-> BSB 25r; I]), each bed with a seeded crop that differs from its
 * neighbour. `blocked(u, v)` drops beds whose centre or any corner lies on it (glasshouses, frames).
 */
export function kitchenBeds(r: RectUV, quarters: [number, number], seed = 1789, crops = 6, blocked?: (u: number, v: number) => boolean): KitchenLayout {
  const K = GARDEN_DETAIL.kitchen;
  const rnd = mulberry32(seed);
  const f = insetRect(r, K.edge);
  const [nu, nv] = quarters;
  const du = (f.u1 - f.u0 - (nu - 1) * K.quarterWalk) / nu;
  const dv = (f.v1 - f.v0 - (nv - 1) * K.quarterWalk) / nv;
  const qs: RectUV[] = [];
  const beds: KitchenBed[] = [];
  if (du <= K.bed || dv <= K.bed) return { quarters: qs, beds };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const q: RectUV = { u0: f.u0 + i * (du + K.quarterWalk), u1: f.u0 + i * (du + K.quarterWalk) + du, v0: f.v0 + j * (dv + K.quarterWalk), v1: f.v0 + j * (dv + K.quarterWalk) + dv };
      qs.push(q);
      const along: 'u' | 'v' = (i + j) % 2 === 0 ? 'u' : 'v';
      const span = along === 'u' ? q.v1 - q.v0 : q.u1 - q.u0;
      const pitch = K.bed + K.path;
      const n = Math.max(1, Math.floor((span + K.path) / pitch));
      const pad = (span - (n * pitch - K.path)) / 2;
      let last = -1;
      for (let k = 0; k < n; k++) {
        const a = pad + k * pitch;
        const rect: RectUV = along === 'u' ? { u0: q.u0, u1: q.u1, v0: q.v0 + a, v1: q.v0 + a + K.bed } : { u0: q.u0 + a, u1: q.u0 + a + K.bed, v0: q.v0, v1: q.v1 };
        if (blocked) {
          const pts: P2[] = [[(rect.u0 + rect.u1) / 2, (rect.v0 + rect.v1) / 2], [rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]];
          if (pts.some(([u, v]) => blocked(u, v))) continue;
        }
        let crop = Math.floor(rnd() * crops);
        if (crop === last) crop = (crop + 1 + Math.floor(rnd() * (crops - 1))) % crops;
        last = crop;
        beds.push({ rect, crop, along });
      }
    }
  }
  return { quarters: qs, beds };
}

/**
 * A loose planted grid (Herzogskastanien, research/11 S13; GARDEN_DETAIL.grove): points on a `spacing` m grid over the
 * polygon `area`, the grid rotated by `rotation` rad, each point jittered by ±`jitter` m, every point inside `area`.
 * Deterministic per seed.
 */
export function groveGrid(area: readonly P2[], spacing: number, jitter: number, rotation = 0, seed = 1789): P2[] {
  const rnd = mulberry32(seed);
  const pts = area.slice(0, -1);
  const c: P2 = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const R = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  const cs = Math.cos(rotation);
  const sn = Math.sin(rotation);
  const out: P2[] = [];
  const n = Math.ceil(R / spacing) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      // alternate rows offset by half a spacing (a loose quincunx) [N orchard / grove planting]
      const a = (i + (j % 2 ? 0.5 : 0)) * spacing + (rnd() * 2 - 1) * jitter;
      const b = j * spacing * 0.92 + (rnd() * 2 - 1) * jitter;
      const p: P2 = [c[0] + a * cs - b * sn, c[1] + a * sn + b * cs];
      if (pointInPolygon(p, area)) out.push(p);
    }
  }
  return out;
}

/**
 * A spot beside a walk (benches, research/11 S6): the point `d` m along `line`, set `offset` m to its left (side +1) or
 * right (side −1); `facing` is the grid azimuth (deg, clockwise from N, frame = the line's E/N axes) from that point
 * back across the walk, so the bench has its back to the planting and looks over the walk to the view.
 */
export function walkSideSpot(line: readonly P2[], d: number, side: 1 | -1, offset: number): { at: P2; facing: number } {
  const { p, dir } = pointAlong(line, d);
  const nx = -dir[1] * side;
  const ny = dir[0] * side;
  const at: P2 = [p[0] + nx * offset, p[1] + ny * offset];
  const az = (Math.atan2(-nx, -ny) * 180) / Math.PI;
  return { at, facing: (az + 360) % 360 };
}

/**
 * Stepped garden wall (GARDEN_DETAIL.wall): top heights of consecutive bays from the ground under each bay
 * (`lo` = lowest, `hi` = highest ground along the bay, both faces). Each bay aims at `design` m over its mean ground,
 * never less than `minHeight` over its highest ground, and is rounded up to whole `step`s above `datum`, so the coping
 * runs level and steps in courses where the ground falls; a bay keeps its neighbour's course while that stays high
 * enough and within one step of its own aim [N stepped walls; I rule]. Pure.
 */
export function steppedWallTops(bays: readonly { lo: number; hi: number }[], design: number, minHeight: number, step: number, datum = 0): number[] {
  const out: number[] = [];
  for (const { lo, hi } of bays) {
    const want = Math.max((lo + hi) / 2 + design, hi + minHeight);
    const snapped = datum + Math.ceil((want - datum) / step - 1e-9) * step;
    const prev = out[out.length - 1];
    // keep the previous course while it is high enough and within one step of the aim (longer level runs, no
    // one-bay jitter of the coping on a gently undulating ground)
    out.push(prev !== undefined && prev >= hi + minHeight - 1e-9 && Math.abs(prev - want) < step ? prev : snapped);
  }
  return out;
}

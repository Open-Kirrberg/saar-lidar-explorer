/**
 * Pure helpers for the 1789 land cover in the viewer (backlog KB-I09, KB-I10; research/11 S1, S15):
 * ground class ids, the packing of the class grid into splat weight textures, the forest edge distance and the
 * deterministic forest plan (species mix, edge mantle of shrubs, taller standards near the edge).
 * No three.js here, so everything is unit-tested (viewer/tests/landcover.test.ts).
 */
import { hash12, mulberry32 } from '@model/layout/geom.ts';

/** Ground classes written by scripts/prepare-terrain.py (meta.json `ground.classes`). */
export const GROUND_CLASS = {
  meadow: 0,
  lawn: 1,
  gravel: 2,
  cobbles: 3,
  sand: 4,
  water: 5,
  forest: 6,
  building: 7,
  field: 8,
  vineyard: 9,
  kitchen_garden: 10,
  hay: 11,
  parterre_sand: 12,
} as const;

/** Ground grid as written by prepare-terrain.py: row 0 = north edge, col 0 = west edge, `cell` metres. */
export interface GroundGrid {
  ground: Uint8Array;
  cols: number;
  rows: number;
  cell: number;
}

export interface GroundPack {
  /** R lawn, G any hard surface, B forest, A water (meadow = the rest, with `cult`) */
  weights: Uint8Array;
  /** hard-surface split: R gravel / building ground, G cobbles, B court sand, A fine parterre sand */
  hard: Uint8Array;
  /** cultivated land: R hay meadow, G field, B vineyard, A kitchen garden */
  cult: Uint8Array;
  /** R macro factor / 2 (damp plinth edges, carriage lane; 128 = 1), G nearness to a building (255 = touching) */
  macro: Uint8Array;
  /**
   * distances for the land-cover bake, `DIST_SCALE` texels per metre (255 = far): R to the nearest hard surface or
   * building edge, G to the forest edge, B inward from the edge of the cell's own cultivated class (hay, field,
   * vineyard, kitchen garden, lawn; 0 elsewhere), A to the water edge
   */
  dist: Uint8Array;
}

/** Texels per metre of the `dist` channels (255 / 4 = 63.75 m reach). */
export const DIST_SCALE = 4;

/** Hard surfaces (any texture of the hard-surface branch). */
const HARD_CLASSES = [GROUND_CLASS.gravel, GROUND_CLASS.cobbles, GROUND_CLASS.sand, GROUND_CLASS.building, GROUND_CLASS.parterre_sand];

/**
 * Distance channels of `GroundPack.dist` (see there). Distances are to the class boundary (half a cell from the
 * nearest cell centre), so a bilinear lookup crosses 0 where the class edge lies.
 */
export function groundDistances(g: GroundGrid): Uint8Array {
  const C = GROUND_CLASS;
  const n = g.cols * g.rows;
  const out = new Uint8Array(n * 4);
  const half = g.cell / 2;
  const enc = (m: number) => Math.min(255, Math.round(Math.max(0, m - half) * DIST_SCALE));
  const toHard = distanceTo(g, HARD_CLASSES);
  const toForest = distanceTo(g, [C.forest]);
  const toWater = distanceTo(g, [C.water]);
  const inner = new Float32Array(n);
  for (const cls of [C.hay, C.field, C.vineyard, C.kitchen_garden, C.lawn]) {
    const d = edgeDistance(g, cls);
    for (let i = 0; i < n; i++) if (g.ground[i] === cls) inner[i] = d[i] >= 1e5 ? 1e5 : d[i];
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = enc(toHard[i]);
    out[o + 1] = enc(toForest[i]);
    out[o + 2] = inner[i] > 0 ? enc(inner[i]) : 0;
    out[o + 3] = enc(toWater[i]);
  }
  return out;
}

/** Error function (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function erf(x: number): number {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

const BAND_LUT = (() => {
  // m(w) = erf(w / (2√2 σ)) is the peak of a band of width w blurred with σ, T(w) = erf(w / (√2 σ)) / 2 its edge value
  const n = 1024;
  const lut = new Float32Array(n + 1);
  let w = 0;
  for (let k = 0; k <= n; k++) {
    const m = Math.min(k / n, 0.999999);
    while (erf(w / (2 * Math.SQRT2)) < m && w < 40) w += 0.001;
    lut[k] = erf(w / Math.SQRT2) / 2;
  }
  return lut;
})();

/** Blurred value on the true edge of a straight band whose blurred peak is `m` (0.5 for a wide class). */
export function bandEdge(m: number): number {
  const x = Math.min(1, Math.max(0, m)) * (BAND_LUT.length - 1);
  const i = Math.min(BAND_LUT.length - 2, Math.floor(x));
  return BAND_LUT[i] + (BAND_LUT[i + 1] - BAND_LUT[i]) * (x - i);
}

/**
 * Blurred-weight encoding of one-hot class weights (KB-I09 follow-up "soft natural edges"): each channel of an RGBA8
 * grid is gaussian-blurred (sigma in cells). A wide class then has its edge at 0.5, but a thin one (a one-cell path)
 * peaks below 0.5 and would vanish. With `normalise`, the blurred value b is divided by the value a straight band of
 * the same peak m (local maximum, radius 1.5 sigma) has on its true edge, 2 T(m) = erf(2 erfinv(m)) (`bandEdge`), so
 * every edge sits at 0.5 whatever the width and thin classes keep their width. A bilinear lookup of the result has
 * smooth iso-lines (no 2 m staircase); the shaders re-sharpen around 0.5 with a pixel-footprint width (fwidth), which
 * gives crisp curves near the camera and area coverage far away.
 */
export function smoothWeights(src: Uint8Array, cols: number, rows: number, sigma: number, normalise = false, channels: readonly number[] = [0, 1, 2, 3]): Uint8Array {
  const out = new Uint8Array(src);
  if (sigma <= 0) return out;
  // kernel truncated at ~2.2 sigma and renormalised (5 taps for sigma 1: the load-time cost matters, the tail does not)
  const R = Math.max(1, Math.round(2.2 * sigma));
  const k = new Float32Array(2 * R + 1);
  let ks = 0;
  for (let i = -R; i <= R; i++) ks += k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const n = cols * rows;
  const on = [false, false, false, false];
  for (let i = 0; i < n * 4; i++) if (src[i]) on[i & 3] = true;
  for (let ch = 0; ch < 4; ch++) on[ch] &&= channels.includes(ch);
  if (!on.some(Boolean)) return out;
  // all four channels interleaved, row-major inner loops (cache-friendly; ~4x faster than per-channel columns)
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) a[i] = src[i] / 255;
  for (let r = 0; r < rows; r++) {
    const o = r * cols * 4;
    for (let c = 0; c < cols; c++) {
      let v0 = 0, v1 = 0, v2 = 0, v3 = 0;
      for (let j = -R; j <= R; j++) {
        const q = o + Math.min(cols - 1, Math.max(0, c + j)) * 4;
        const w = k[j + R];
        v0 += w * a[q];
        v1 += w * a[q + 1];
        v2 += w * a[q + 2];
        v3 += w * a[q + 3];
      }
      const p = o + c * 4;
      b[p] = v0;
      b[p + 1] = v1;
      b[p + 2] = v2;
      b[p + 3] = v3;
    }
  }
  a.fill(0);
  const row = cols * 4;
  for (let r = 0; r < rows; r++) {
    const o = r * row;
    for (let j = -R; j <= R; j++) {
      const s = Math.min(rows - 1, Math.max(0, r + j)) * row;
      const w = k[j + R];
      for (let x = 0; x < row; x++) a[o + x] += w * b[s + x];
    }
  }
  if (normalise) {
    // local maximum (separable square max filter, radius 1.5 sigma) of the blurred channels
    const Rm = Math.max(1, Math.round(1.5 * sigma));
    for (let r = 0; r < rows; r++) {
      const o = r * row;
      for (let c = 0; c < cols; c++) {
        let m0 = 0, m1 = 0, m2 = 0, m3 = 0;
        for (let j = Math.max(0, c - Rm); j <= Math.min(cols - 1, c + Rm); j++) {
          const q = o + j * 4;
          if (a[q] > m0) m0 = a[q];
          if (a[q + 1] > m1) m1 = a[q + 1];
          if (a[q + 2] > m2) m2 = a[q + 2];
          if (a[q + 3] > m3) m3 = a[q + 3];
        }
        const p = o + c * 4;
        b[p] = m0;
        b[p + 1] = m1;
        b[p + 2] = m2;
        b[p + 3] = m3;
      }
    }
    const m = new Float32Array(n * 4);
    for (let r = 0; r < rows; r++) {
      const o = r * row;
      for (let j = Math.max(0, r - Rm); j <= Math.min(rows - 1, r + Rm); j++) {
        const s = j * row;
        for (let x = 0; x < row; x++) if (b[s + x] > m[o + x]) m[o + x] = b[s + x];
      }
    }
    for (let i = 0; i < n * 4; i++) if (on[i & 3]) out[i] = Math.round(255 * Math.min(1, a[i] / Math.max(0.02, 2 * bandEdge(m[i]))));
  } else for (let i = 0; i < n * 4; i++) if (on[i & 3]) out[i] = Math.round(255 * Math.min(1, a[i]));
  return out;
}

/**
 * Packs the class grid into four RGBA byte arrays (one texel per cell). `court(i)` returns the distance (m) from the
 * cell centre to the carriage lane of a sand court when gravel cell i lies in one (the Ehrenhof), else null; such
 * cells become court sand. `macro(nearCells, laneM)` is the hard-surface macro factor (terrain.ts courtMacro).
 */
export function packGround(
  g: GroundGrid,
  court: (i: number) => number | null = () => null,
  macro: (nearCells: number, laneM: number) => number = () => 1,
): GroundPack {
  const n = g.cols * g.rows;
  const weights = new Uint8Array(n * 4);
  const hard = new Uint8Array(n * 4);
  const cult = new Uint8Array(n * 4);
  const mac = new Uint8Array(n * 4);
  const near = nearBuilding(g);
  const C = GROUND_CLASS;
  for (let i = 0; i < n; i++) {
    const k = g.ground[i];
    const o = i * 4;
    mac[o] = 128;
    mac[o + 1] = near[i] ? Math.round(255 * (1 - (near[i] - 1) / 3)) : 0;
    switch (k) {
      case C.lawn:
        weights[o] = 255;
        break;
      case C.forest:
        weights[o + 2] = 255;
        break;
      case C.water:
        weights[o + 3] = 255;
        break;
      case C.hay:
        cult[o] = 255;
        break;
      case C.field:
        cult[o + 1] = 255;
        break;
      case C.vineyard:
        cult[o + 2] = 255;
        break;
      case C.kitchen_garden:
        cult[o + 3] = 255;
        break;
      case C.gravel:
      case C.cobbles:
      case C.sand:
      case C.building:
      case C.parterre_sand: {
        weights[o + 1] = 255;
        let kk: number = k;
        let lane = Infinity;
        if (k === C.gravel) {
          const d = court(i);
          if (d !== null) {
            kk = C.sand;
            lane = d;
          }
        }
        const ch = kk === C.cobbles ? 1 : kk === C.sand ? 2 : kk === C.parterre_sand ? 3 : 0;
        hard[o + ch] = 255;
        if (kk !== C.building) mac[o] = Math.round(127.5 * macro(near[i], lane));
        break;
      }
      default:
        break; // meadow and unknown classes: the rest
    }
  }
  return { weights, hard, cult, macro: mac, dist: groundDistances(g) };
}

/** Chebyshev distance in cells (1..3) from a building cell, 0 = farther (or a building cell itself). */
export function nearBuilding(g: GroundGrid, reach = 3): Uint8Array {
  const out = new Uint8Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      if (g.ground[r * g.cols + c] !== GROUND_CLASS.building) continue;
      for (let dr = -reach; dr <= reach; dr++)
        for (let dc = -reach; dc <= reach; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols) continue;
          const d = Math.max(Math.abs(dr), Math.abs(dc));
          const j = rr * g.cols + cc;
          if (d > 0 && g.ground[j] !== GROUND_CLASS.building && (out[j] === 0 || d < out[j])) out[j] = d;
        }
    }
  return out;
}

/**
 * Distance (m) from each cell of class `cls` to the nearest cell of another class (two-pass 3-4 chamfer, ≈ 2 %
 * error); 0 outside the class. Cells on the grid border count as edge only when the class touches another class
 * (the crop edge is not a forest edge).
 */
export function edgeDistance(g: GroundGrid, cls: number = GROUND_CLASS.forest): Float32Array {
  const d = new Float32Array(g.cols * g.rows);
  for (let i = 0; i < d.length; i++) d[i] = g.ground[i] === cls ? 1e9 : 0;
  return chamfer(g, d);
}

/** Distance (m) from each cell to the nearest cell of any of `classes` (0 on them; 1e6 when the grid has none). */
export function distanceTo(g: GroundGrid, classes: readonly number[]): Float32Array {
  const set = new Set(classes);
  const d = new Float32Array(g.cols * g.rows);
  for (let i = 0; i < d.length; i++) d[i] = set.has(g.ground[i]) ? 0 : 1e9;
  return chamfer(g, d);
}

/** Two-pass 3-4 chamfer distance in place: cells at 0 are seeds, cells at 1e9 get their distance (× cell, m). */
function chamfer(g: GroundGrid, d: Float32Array): Float32Array {
  const { cols, rows } = g;
  const BIG = 1e9;
  const a = 1;
  const b = Math.SQRT2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + a);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + a);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + b);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + b);
      }
      d[i] = v;
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + a);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + a);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + b);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + b);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= BIG / 2 ? 1e6 : d[i] * g.cell;
  return d;
}

/** Forest species of the 1789 belts and the E plateau [I from D place names, research/11 §6.3; planting.md]. */
export interface ForestSpecies {
  key: string;
  /** height (m) at scale 1, crown radius (m), crown vertical stretch, clear trunk fraction */
  height: number;
  crown: number;
  stretch: number;
  trunkFrac: number;
  leaf: string;
  bark: string;
}

export const FOREST_SPECIES: Record<string, ForestSpecies> = {
  // beech: dense dark canopy, light grey bark ≈ #8A8580 (planting.md; visual-audit V1 "black sticks") [I]
  fagus: { key: 'fagus', height: 24, crown: 6.6, stretch: 1.2, trunkFrac: 0.34, leaf: '#3E5C2C', bark: '#8A8580' },
  // oak: broader, more open, darker olive [I]
  quercus: { key: 'quercus', height: 22, crown: 7.2, stretch: 0.95, trunkFrac: 0.3, leaf: '#4B5E2B', bark: '#5E554B' },
  // hornbeam: lower, fresher mid-green [I]
  carpinus: { key: 'carpinus', height: 16, crown: 4.6, stretch: 1.1, trunkFrac: 0.3, leaf: '#55723A', bark: '#7B776F' },
  // edge mantle (Waldmantel): hazel, hawthorn, blackthorn, dogwood 3-5 m [N, research/11 S1]
  shrub: { key: 'shrub', height: 4.5, crown: 2.9, stretch: 0.8, trunkFrac: 0.06, leaf: '#5C7A3B', bark: '#5A4E40' },
  // single field trees (wave-2 review): field pear and walnut near farmsteads, open-grown oak [N; I hues]
  pyrus: { key: 'pyrus', height: 12, crown: 4.2, stretch: 1.25, trunkFrac: 0.28, leaf: '#4A6332', bark: '#4E463E' },
  juglans: { key: 'juglans', height: 15, crown: 6.8, stretch: 0.85, trunkFrac: 0.25, leaf: '#5B7440', bark: '#7A746A' },
  // hay cock (Heuhaufen) on a freshly cut parcel: ~1.6-1.8 m heap of drying hay [N; I hue = hayStraw, darker]
  haycock: { key: 'haycock', height: 1.8, crown: 0.85, stretch: 1, trunkFrac: 0, leaf: '#A89A62', bark: '#A89A62' },
};

/** Beech 70 %, oak 20 %, hornbeam 10 % (catalogue landcover `mix`, research/11 §6.3). */
export const DEFAULT_FOREST_MIX = [
  { species: 'fagus', share: 0.7 },
  { species: 'quercus', share: 0.2 },
  { species: 'carpinus', share: 0.1 },
];

export interface ForestTree {
  x: number;
  z: number;
  species: string;
  /** height scale (1 = species height) */
  scale: number;
  /**
   * 'canopy' | 'standard' (Überhälter near the edge) | 'mantle' (edge shrub) | 'field' (single tree in the open) |
   * 'hedge' (hedge shrub or hedge tree along a Gewann edge)
   */
  role: 'canopy' | 'standard' | 'mantle' | 'field' | 'hedge' | 'haycock';
  /** distance (m) to the forest edge: edge trees keep their branches low (sunny side) */
  edge: number;
}

export interface ForestPlanOptions {
  /** canopy grid spacing (m) */
  spacing?: number;
  /** mantle shrub spacing (m) */
  mantleSpacing?: number;
  /** depth of the shrub mantle from the edge (m) */
  mantleDepth?: number;
  /** band inside the edge where standards (Überhälter) are mixed in (m) and their share */
  standardBand?: number;
  standardShare?: number;
  seed?: number;
  mix?: { species: string; share: number }[];
}

/**
 * Deterministic forest plan on the class grid (local frame offsets: x = west + gx, z = −(north − gy) with the
 * caller's origin). Returns positions in grid metres (gx east of the west edge, gy south of the north edge).
 * Canopy trees on a jittered grid; a shrub mantle in the outer `mantleDepth` m; about `standardShare` of the trees
 * within `standardBand` m of the edge are taller standards (research/11 S1: 20 % Überhälter near edges, 1 row of
 * 3-5 m shrubs) [N].
 */
export function forestPlan(g: GroundGrid, opts: ForestPlanOptions = {}): (ForestTree & { gx: number; gy: number })[] {
  const spacing = opts.spacing ?? 11;
  const mSp = opts.mantleSpacing ?? 3.6;
  const mDepth = opts.mantleDepth ?? 6;
  const band = opts.standardBand ?? 20;
  const share = opts.standardShare ?? 0.2;
  const mix = opts.mix ?? DEFAULT_FOREST_MIX;
  const total = mix.reduce((s, m) => s + m.share, 0) || 1;
  const rnd = mulberry32(opts.seed ?? 1789);
  const dist = edgeDistance(g, GROUND_CLASS.forest);
  const W = g.cols * g.cell;
  const H = g.rows * g.cell;
  const at = (x: number, y: number) => {
    const c = Math.floor(x / g.cell);
    const r = Math.floor(y / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
    return r * g.cols + c;
  };
  const pick = (u: number) => {
    let acc = 0;
    for (const m of mix) {
      acc += m.share / total;
      if (u < acc) return m.species;
    }
    return mix[mix.length - 1].species;
  };
  const out: (ForestTree & { gx: number; gy: number })[] = [];
  for (let y = spacing / 2; y < H; y += spacing)
    for (let x = spacing / 2; x < W; x += spacing) {
      const jx = x + (rnd() - 0.5) * spacing * 0.8;
      const jy = y + (rnd() - 0.5) * spacing * 0.8;
      const u1 = rnd();
      const u2 = rnd();
      const u3 = rnd();
      const i = at(jx, jy);
      if (i < 0 || g.ground[i] !== GROUND_CLASS.forest) continue;
      const d = dist[i];
      if (d < mDepth * 0.6) continue; // the outer band belongs to the mantle
      const species = pick(u1);
      const standard = d < band && u2 < share;
      // 2-3 height classes: some understorey, most canopy, standards above
      const scale = standard ? 1.25 + u3 * 0.25 : u3 < 0.15 ? 0.5 + u2 * 0.15 : 0.72 + u3 * 0.38;
      out.push({ gx: jx, gy: jy, x: jx, z: jy, species, scale, role: standard ? 'standard' : 'canopy', edge: d });
    }
  // shrub mantle (wave-2 review: not a "pearl necklace"): groups of 3-7 shrubs 2-5 m high with gaps; the band is
  // one row deep in places and two to three rows elsewhere (smooth noise along the edge) [N research/11 S1; I]
  const lat = noiseLattice(256, (opts.seed ?? 1789) ^ 0x5bd1);
  const gSp = mSp * 1.5;
  for (let y = gSp / 2; y < H; y += gSp)
    for (let x = gSp / 2; x < W; x += gSp) {
      const cx = x + (rnd() - 0.5) * gSp * 0.8;
      const cy = y + (rnd() - 0.5) * gSp * 0.8;
      const u1 = rnd();
      const u2 = rnd();
      const i = at(cx, cy);
      if (i < 0 || g.ground[i] !== GROUND_CLASS.forest) continue;
      const d = dist[i];
      const depth = mDepth * (0.4 + 0.6 * latticeNoise(lat, cx / 45, cy / 45));
      if (d > depth) continue;
      if (latticeNoise(lat, cx / 23 + 50, cy / 23 + 50) < 0.15 || u1 < 0.05) continue; // gaps in the mantle
      const n = 3 + Math.floor(u2 * 5);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 2.4;
        const sx = cx + Math.cos(a) * r;
        const sy = cy + Math.sin(a) * r;
        const j = at(sx, sy);
        const u3 = rnd();
        if (j < 0 || g.ground[j] !== GROUND_CLASS.forest || dist[j] > mDepth) continue;
        // 2-5 m (species height 4.5 m), the taller ones toward the forest
        out.push({ gx: sx, gy: sy, x: sx, z: sy, species: 'shrub', scale: 0.45 + u3 * 0.45 + 0.2 * Math.min(1, dist[j] / mDepth), role: 'mantle', edge: dist[j] });
      }
    }
  return out;
}

/**
 * Value noise in [0, 1] from a `noiseLattice(256, …)` array, sampled like the shaders do (smoothstep-folded
 * coordinate, bilinear between lattice texels, red channel, repeating), so the CPU can reproduce GPU patterns.
 */
export function latticeNoise(lat: Uint8Array, x: number, y: number, size = 256): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (v: number) => ((v % size) + size) % size;
  const t = (a: number, b: number) => lat[(m(b) * size + m(a)) * 4] / 255;
  const a = t(ix, iy) + (t(ix + 1, iy) - t(ix, iy)) * sx;
  const b = t(ix, iy + 1) + (t(ix + 1, iy + 1) - t(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

/** Shader-compatible hash12 (Dave Hoskins, model/src/layout/geom.ts), used for the field blocks and hedge edges. */
export { hash12 };

/** Gewann blocks of the field pattern (landcoverBake.ts): block size (m) and the warp of the palace-grid frame. */
export const FIELD_BLOCK: readonly [number, number] = [190, 150];

/**
 * Field-block coordinate of a local point, as the bake shader computes it: palace-grid frame (u along `gridU`)
 * warped by 30 m of 160 m value noise from the shared lattice (`noiseLattice(256, 1789)`).
 */
export function fieldBlockCoord(lat: Uint8Array, x: number, z: number, gridU: readonly [number, number]): [number, number] {
  const [ux, uz] = gridU;
  return [x * ux + z * uz + 30 * latticeNoise(lat, x / 160, z / 160), x * -uz + z * ux + 30 * latticeNoise(lat, x / 160 + 7.3, z / 160 + 7.3)];
}

/** Ripe winter grain, summer grain, fallow / clover, stubble (crop index of `fieldStrip`). */
export type FieldCrop = 0 | 1 | 2 | 3;

/**
 * Gewann strip of a local point, mirroring landcoverBake.ts FIELD_GLSL `fieldFrame` / `fieldStripValue` / the crop
 * pick (wave-3 review fix: the strips must read from 450 m up) [N Gewannflur: 12-24 m strips, the length of the
 * block (150-190 m); I shares]:
 * - strips run along the block's u or v axis (hash per block), `sw` 12-24 m wide;
 * - `crop`: 40 % ripe winter grain, 24 % summer grain, 20 % fallow / clover, 16 % stubble (hash per strip);
 * - `value`: an alternating ±5.5 % value step with ±1.5 % jitter, so neighbouring strips differ by ≥ 8 % in value
 *   even when they carry the same crop (different sowing, variety, ploughing direction);
 * - `edge`: distance (m) to the nearest strip edge, where a balk (`balk`, half of the edges) or a furrow runs.
 */
export function fieldStrip(
  lat: Uint8Array,
  x: number,
  z: number,
  gridU: readonly [number, number],
): { block: [number, number]; sid: number; sw: number; crop: FieldCrop; value: number; edge: number; balk: boolean } {
  const p = fieldBlockCoord(lat, x, z, gridU);
  const [BX, BY] = FIELD_BLOCK;
  const bx = Math.floor(p[0] / BX);
  const by = Math.floor(p[1] / BY);
  const alongU = hash12(bx + 3.1, by + 3.1) < 0.55;
  const across = alongU ? p[1] : p[0];
  const sw = 12 + 12 * hash12(bx + 9.7, by + 9.7);
  const sid = Math.floor(across / sw);
  const fa = across - sid * sw;
  const h = hash12(sid, bx * 31 + by * 7);
  const crop: FieldCrop = h < 0.4 ? 0 : h < 0.64 ? 1 : h < 0.84 ? 2 : 3;
  const value = (((sid % 2) + 2) % 2 < 0.5 ? 1.055 : 0.945) * (1 + 0.03 * (hash12(sid, 7 + bx) - 0.5));
  const balk = hash12(Math.floor(across / sw + 0.5), bx * 5 + by + 0.5) >= 0.5;
  return { block: [bx, by], sid, sw, crop, value, edge: Math.min(fa, sw - fa), balk };
}

/** Most edge segments a parcel outline may pass to the bake shader (landcoverBake.ts `uVineSeg`). */
export const MAX_PARCEL_SEGMENTS = 64;

/**
 * Edge segments [ax, az, bx, bz] of closed local rings (a closing duplicate vertex is ignored), for the bake's exact
 * parcel outline (wave-3 review fix: the vineyard is a staked-out strip with a hard edge, not a blurred class
 * weight). Returns null when there are more than `max` segments (the caller falls back to the class raster).
 */
export function ringSegments(rings: readonly (readonly (readonly [number, number])[])[], max = MAX_PARCEL_SEGMENTS): Float32Array | null {
  const segs: number[] = [];
  for (const r of rings) {
    const n = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.length - 1 : r.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = r[i];
      const b = r[(i + 1) % n];
      segs.push(a[0], a[1], b[0], b[1]);
    }
  }
  if (segs.length / 4 > max) return null;
  return new Float32Array(segs);
}

/**
 * Signed distance (m) from (x, z) to the outline given by `ringSegments` (negative inside, even-odd rule), as the
 * bake shader computes it (`parcelSd`).
 */
export function parcelSignedDistance(segs: Float32Array, x: number, z: number): number {
  let d2 = Infinity;
  let inside = false;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i];
    const az = segs[i + 1];
    const ex = segs[i + 2] - ax;
    const ez = segs[i + 3] - az;
    const wx = x - ax;
    const wz = z - az;
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / Math.max(1e-9, ex * ex + ez * ez)));
    d2 = Math.min(d2, (wx - ex * t) ** 2 + (wz - ez * t) ** 2);
    if (az > z !== segs[i + 3] > z && x < (ex * (z - az)) / ez + ax) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d2);
}

/** Hay parcels of the bake (landcoverBake.ts): parcel size (m), warp 28 m of 90 m + 5 m of 23 m noise in the palace-grid frame. */
export const HAY_PARCEL: readonly [number, number] = [95, 70];

/**
 * Hay parcel of a local point as the bake computes it: parcel id, position in the parcel (m), the parcel state
 * ('standing' | 'cut' | 'regrowth', hash of the id: 50 / 28 / 22 %) and `cutTo`, the part of the parcel already mown
 * (m along f[1]): the whole parcel for most cut parcels, 30-80 % of it for the ones still being mown (hash < 0.6;
 * wave-3 review fix: mown and standing strips side by side) [N July haymaking, swath by swath], 0 when not cut.
 */
export function hayParcel(
  lat: Uint8Array,
  x: number,
  z: number,
  gridU: readonly [number, number],
): { id: [number, number]; f: [number, number]; state: 'standing' | 'cut' | 'regrowth'; cutTo: number } {
  const [ux, uz] = gridU;
  // same warp as the bake: 28 m of 90 m noise plus 5 m of 23 m noise (wave-3: no ruled parcel edges)
  const qx = x * ux + z * uz + 28 * latticeNoise(lat, x / 90, z / 90) + 5 * latticeNoise(lat, x / 23 + 41, z / 23 + 41);
  const qy = x * -uz + z * ux + 28 * latticeNoise(lat, x / 90 + 9.2, z / 90 + 9.2) + 5 * latticeNoise(lat, x / 23 + 47, z / 23 + 47);
  const [SX, SY] = HAY_PARCEL;
  const id: [number, number] = [Math.floor(qx / SX), Math.floor(qy / SY)];
  const ph = hash12(id[0] + 5.3, id[1] + 5.3);
  const state = ph < 0.5 ? 'standing' : ph < 0.78 ? 'cut' : 'regrowth';
  const cutTo = state !== 'cut' ? 0 : ph < 0.6 ? SY * (0.3 + 0.5 * hash12(id[0] + 21.7, id[1] + 21.7)) : SY;
  return { id, f: [qx - id[0] * SX, qy - id[1] * SY], state, cutTo };
}

/**
 * Hay cocks (Heuhaufen) on about `share` of the freshly cut hay parcels within `radius` m (650) of `centre` (local x, z):
 * on every second windrow line of the bake, every ~11 m, away from the parcel margin [N July haymaking; I density].
 */
export function hayCockPlan(
  g: GroundGrid,
  opts: { ox: number; oz: number; gridU: [number, number]; centre: [number, number]; radius?: number; share?: number; seed?: number },
): (ForestTree & { gx: number; gy: number })[] {
  const lat = noiseLattice(256, 1789);
  const rnd = mulberry32((opts.seed ?? 1789) ^ 0x4ac0);
  const R = opts.radius ?? 650;
  const share = opts.share ?? 0.3;
  const [SX, SY] = HAY_PARCEL;
  const out: (ForestTree & { gx: number; gy: number })[] = [];
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      if (g.ground[r * g.cols + c] !== GROUND_CLASS.hay) continue;
      const gx = (c + 0.5) * g.cell;
      const gy = (r + 0.5) * g.cell;
      const x = opts.ox + gx;
      const z = opts.oz + gy;
      if (Math.hypot(x - opts.centre[0], z - opts.centre[1]) > R) continue;
      const p = hayParcel(lat, x, z, opts.gridU);
      if (p.state !== 'cut' || hash12(p.id[0] + 13.1, p.id[1] + 13.1) >= share) continue;
      const [fx, fy] = p.f;
      if (Math.min(fx, SX - fx, fy, SY - fy) < 5 || fy > p.cutTo - 3) continue;
      // windrow spacing of this parcel (bake: 4 + 2 hash) and the cell nearest each windrow centre, every 2nd row
      const sp = 4 + 2 * hash12(p.id[0] + 7.7, p.id[1] + 7.7);
      const row = Math.floor(fy / sp);
      if (row % 2 || Math.abs(fy - (row + 0.5) * sp) > g.cell / 2) continue;
      if (Math.abs((fx % 11) - 5.5) > g.cell / 2) continue;
      const u = rnd();
      const hx = gx + (u - 0.5);
      const hy = gy + (rnd() - 0.5);
      out.push({ gx: hx, gy: hy, x: hx, z: hy, species: 'haycock', scale: 0.85 + u * 0.3, role: 'haycock', edge: 0 });
    }
  return out;
}

export interface OpenTreeOptions {
  seed?: number;
  /** local frame offsets of the grid's west / north edge (x = ox + gx, z = oz + gy) for the field pattern */
  ox?: number;
  oz?: number;
  /** palace-grid +u axis (local [x, z]); enables the hedges along the Gewann edges */
  gridU?: [number, number];
  /** share of Gewann block edges that carry a hedge */
  hedgeShare?: number;
}

/**
 * Trees and shrubs of the open 1789 landscape (wave-2 review: the hinterland read as an empty steppe) [N; I density]:
 * - Überhälter standing 5-15 m out in the meadow in front of a forest edge (oak or beech, 1.1-1.35 ×);
 * - single field trees on pasture, hay meadows and (fewer) fields: oak, field pear, walnut (walnut and pear mostly
 *   within 150 m of a farmstead), ~1 per 2 ha of meadow;
 * - hedges along about a third of the Gewann block edges (the bake's field pattern), shrubs 2.5-4 m with gaps and an
 *   occasional hedge tree.
 * Never on lawn, hard surfaces, water or buildings, nor within 8-10 m of them.
 */
export function openTreePlan(g: GroundGrid, opts: OpenTreeOptions = {}): (ForestTree & { gx: number; gy: number })[] {
  const C = GROUND_CLASS;
  const rnd = mulberry32((opts.seed ?? 1789) ^ 0x1f3a);
  const toForest = distanceTo(g, [C.forest]);
  const toHard = distanceTo(g, [C.gravel, C.cobbles, C.sand, C.water, C.building, C.parterre_sand, C.lawn, C.vineyard, C.kitchen_garden]);
  const toBuilding = distanceTo(g, [C.building]);
  const W = g.cols * g.cell;
  const H = g.rows * g.cell;
  const at = (x: number, y: number) => {
    const c = Math.floor(x / g.cell);
    const r = Math.floor(y / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
    return r * g.cols + c;
  };
  const out: (ForestTree & { gx: number; gy: number })[] = [];
  const meadowish = (k: number) => k === C.meadow || k === C.hay;
  // Überhälter out in the meadow
  for (let y = 4.5; y < H; y += 9)
    for (let x = 4.5; x < W; x += 9) {
      const jx = x + (rnd() - 0.5) * 7;
      const jy = y + (rnd() - 0.5) * 7;
      const u1 = rnd();
      const u2 = rnd();
      const i = at(jx, jy);
      if (i < 0 || !meadowish(g.ground[i]) || toForest[i] < 5 || toForest[i] > 15 || toHard[i] < 8 || u1 > 0.1) continue;
      out.push({ gx: jx, gy: jy, x: jx, z: jy, species: u2 < 0.55 ? 'quercus' : 'fagus', scale: 1.1 + u2 * 0.25, role: 'standard', edge: 0 });
    }
  // single field trees
  for (let y = 35; y < H; y += 70)
    for (let x = 35; x < W; x += 70) {
      const jx = x + (rnd() - 0.5) * 60;
      const jy = y + (rnd() - 0.5) * 60;
      const u1 = rnd();
      const u2 = rnd();
      const u3 = rnd();
      const i = at(jx, jy);
      if (i < 0) continue;
      const k = g.ground[i];
      const p = k === C.meadow ? 0.35 : k === C.hay ? 0.25 : k === C.field ? 0.12 : 0;
      if (u1 >= p || toForest[i] < 25 || toHard[i] < 10) continue;
      const farm = toBuilding[i] < 150;
      const species = farm ? (u2 < 0.45 ? 'juglans' : u2 < 0.8 ? 'pyrus' : 'quercus') : u2 < 0.6 ? 'quercus' : u2 < 0.9 ? 'pyrus' : 'juglans';
      out.push({ gx: jx, gy: jy, x: jx, z: jy, species, scale: 0.75 + u3 * 0.45, role: 'field', edge: 0 });
    }
  // hedges along Gewann block edges (same block pattern as the bake)
  if (opts.gridU) {
    const lat = noiseLattice(256, 1789);
    const [BX, BY] = FIELD_BLOCK;
    const share = opts.hedgeShare ?? 0.33;
    const ox = opts.ox ?? 0;
    const oz = opts.oz ?? 0;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (g.ground[i] !== C.field || toHard[i] < 6 || toForest[i] < 6) continue;
        const gx = (c + 0.5) * g.cell;
        const gy = (r + 0.5) * g.cell;
        const [px, py] = fieldBlockCoord(lat, ox + gx, oz + gy, opts.gridU);
        const ex = px - Math.round(px / BX) * BX;
        const ey = py - Math.round(py / BY) * BY;
        // one cell-wide band along the block edge; the edge id decides whether it carries a hedge
        let key: [number, number] | null = null;
        if (Math.abs(ex) < g.cell * 0.5) key = [Math.round(px / BX) * 3.1, Math.floor(py / BY) + 0.5];
        else if (Math.abs(ey) < g.cell * 0.5) key = [Math.floor(px / BX) + 0.5, Math.round(py / BY) * 3.1 + 100];
        if (!key || hash12(key[0] + 11.7, key[1] + 3.3) >= share) continue;
        const u1 = rnd();
        const u2 = rnd();
        const u3 = rnd();
        const u4 = rnd();
        // gaps: a smooth on / off along the hedge plus single misses
        if (latticeNoise(lat, (ox + gx) / 19 + 31, (oz + gy) / 19 + 17) < 0.3 || u1 < 0.2) continue;
        const hx = gx + (u2 - 0.5) * g.cell * 0.8;
        const hy = gy + (u3 - 0.5) * g.cell * 0.8;
        if (u4 < 0.05) out.push({ gx: hx, gy: hy, x: hx, z: hy, species: u2 < 0.6 ? 'quercus' : 'carpinus', scale: 0.7 + u3 * 0.3, role: 'hedge', edge: 0 });
        else out.push({ gx: hx, gy: hy, x: hx, z: hy, species: 'shrub', scale: 0.55 + u4 * 0.35, role: 'hedge', edge: 0 });
      }
  }
  return out;
}

/** Tile key of a point for spatial bucketing (tile size in m). */
export function tileKey(gx: number, gy: number, tile: number): string {
  return `${Math.floor(gx / tile)}_${Math.floor(gy / tile)}`;
}

/**
 * Mean down-slope direction (unit [dx, dz] in the local frame) over the cells of `cls`, from a height sampler on the
 * local frame (central differences, 2 m). Null when the class is absent or flat. Used for the vineyard rows, which
 * run down the slope (research/11 S10).
 */
export function meanDownslope(
  g: GroundGrid & { west: number; north: number },
  cls: number,
  sample: (x: number, z: number) => number,
  E0: number,
  N0: number,
): [number, number] | null {
  let sx = 0;
  let sz = 0;
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      if (g.ground[r * g.cols + c] !== cls) continue;
      const x = g.west + (c + 0.5) * g.cell - E0;
      const z = -(g.north - (r + 0.5) * g.cell - N0);
      const hx = sample(x + 2, z) - sample(x - 2, z);
      const hz = sample(x, z + 2) - sample(x, z - 2);
      if (!Number.isFinite(hx) || !Number.isFinite(hz)) continue;
      sx -= hx;
      sz -= hz;
    }
  const l = Math.hypot(sx, sz);
  return l > 1e-6 ? [sx / l, sz / l] : null;
}

/**
 * Texel grid of the land-cover bake (landcoverBake.ts): `cell` m texels over a `w` × `h` m crop, coarsened so neither
 * side exceeds the GPU's `maxTex`. Returns the texture size and the effective cell.
 */
export function bakeGrid(w: number, h: number, maxTex: number, cell = 1): { width: number; height: number; cell: number } {
  const c = Math.max(cell, w / maxTex, h / maxTex);
  return { width: Math.max(1, Math.min(maxTex, Math.ceil(w / c))), height: Math.max(1, Math.min(maxTex, Math.ceil(h / c))), cell: c };
}

/** Rec. 709 luminance of a linear RGB triple. */
export function luminance(c: readonly [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Normal of a height field at a grid vertex from central differences over `step` cells (clamped at the border), in
 * the local frame (x east, z south: row index grows with z). Neighbouring chunks and LOD levels get identical normals
 * at shared vertices, so chunk borders no longer show as dark seams (wave-2 review: "dotted black line").
 */
export function gridNormal(h: ArrayLike<number>, cols: number, rows: number, cell: number, r: number, c: number, step = 1): [number, number, number] {
  const c0 = Math.max(0, c - step);
  const c1 = Math.min(cols - 1, c + step);
  const r0 = Math.max(0, r - step);
  const r1 = Math.min(rows - 1, r + step);
  const dx = (h[r * cols + c1] - h[r * cols + c0]) / Math.max(1e-6, (c1 - c0) * cell);
  const dz = (h[r1 * cols + c] - h[r0 * cols + c]) / Math.max(1e-6, (r1 - r0) * cell);
  const l = Math.hypot(dx, 1, dz);
  return [-dx / l, 1 / l, -dz / l];
}

/**
 * Value-noise lattice for the splat shader (KB-I10 cost): `size`² RGBA texels of independent uniform bytes, one
 * noise per channel. The shader samples it with the smoothstep-coordinate trick (one bilinear fetch instead of four
 * ALU hashes) and mipmaps it, so fine noise fades instead of shimmering at a distance.
 */
export function noiseLattice(size = 256, seed = 1789): Uint8Array {
  const rnd = mulberry32(seed);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rnd() * 256);
  return out;
}

/**
 * Procedural leaf-cluster atlas for the near-tree leaf cards (wave 6, KB-I44 follow-up "tree look near the camera").
 * Pure (no three.js, no DOM), deterministic, unit-tested in viewer/tests/leafCards.test.ts.
 *
 * Generated here, not downloaded: no texture licence to record (the atlas is our own procedural output) [I].
 *
 * Layout: a 2 × 2 atlas of square tiles. Tiles 0-2 are broadleaf sprays (five twigs with ~75 ovate leaves of 9-19 % of the
 * tile, denser toward the middle so the card edge breaks up into single leaves); tile 3 is a conifer spray (radiating
 * needle tufts). RGB is a grey leaf shade (≈ 0.72-1.0, a lighter midrib, one half of each blade a little darker as if
 * folded), so the per-instance leaf colour stays the documented hue; alpha is the leaf mask (2 × 2 supersampled edges).
 * Transparent texels carry the mean leaf grey, so mipmaps do not darken the leaf rims.
 *
 * KB-I76 (wave 9, leaf scale): a second, **fine** 2 × 2 atlas (`rasterFineLeafAtlas`) with the same tile layout holds
 * sprays of many small leaves (blade 3.5-6 % of the tile instead of 12-19 %). The viewer stores it to the right of
 * the coarse atlas in one 2:1 texture (leafCards.ts `leafAtlasTexture`), and a card whose world size exceeds
 * `FINE_CARD.minSize` takes its fine twin within ~`FINE_CARD.dist` m of the camera (foliage.ts FOL_CARD), so a 1.9 m card
 * on an old beech shows 7-11 cm leaves instead of 25-35 cm ones (beech / lime leaf 6-10 cm [N]).
 */
import { mulberry32 } from '@model/layout/geom.ts';

export interface Leaf {
  /** centre of the blade in tile units (0..1) */
  x: number;
  y: number;
  /** blade direction (rad) */
  angle: number;
  /** blade length and half-width in tile units */
  len: number;
  wid: number;
  /** grey shade 0..1 */
  shade: number;
  /** needle (thin, straight) instead of an ovate blade */
  needle?: boolean;
}

/** Number of tiles per atlas side and the tile index of the conifer spray. */
export const ATLAS_TILES = 2;
export const NEEDLE_TILE = 3;
/**
 * KB-I76: the fine tiles. A card takes them when its world edge is at least `minSize` m (the coarse tiles' 12-19 %
 * leaves would read larger than ~11 cm) and its anchor lies within `dist` m (±25 % per card, so no band of switching
 * cards); beyond, the coarse sprays read as leaf clusters [N leaf 6-10 cm: Fagus, Tilia; I thresholds].
 */
export const FINE_CARD = { minSize: 0.9, dist: 32 } as const;
/** Mean grey of the leaf texels (used for the transparent texels and by the card shader's brightness match). */
export const LEAF_GREY = 0.86;

/**
 * Leaves of one broadleaf spray: a slightly curved twig from the lower edge toward the top, leaves alternating along it
 * on short petioles, plus a few loose leaves near the rim. Deterministic per seed.
 */
export function broadleafSpray(seed: number): Leaf[] {
  const rnd = mulberry32(seed ^ 0x1eaf);
  const leaves: Leaf[] = [];
  // five twigs from near the centre outward give a roughly round cluster; the card itself is rotated per card
  const twigs = 5;
  for (let t = 0; t < twigs; t++) {
    const a0 = (t / twigs) * Math.PI * 2 + rnd() * 0.7;
    const bend = (rnd() - 0.5) * 0.9;
    const n = 8 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.6) / n; // along the twig 0..1
      const a = a0 + bend * s;
      const r = 0.06 + 0.33 * s;
      const side = i % 2 ? 1 : -1;
      const la = a + side * (0.6 + rnd() * 0.6);
      const len = 0.13 + 0.06 * rnd() - 0.035 * s;
      const px = 0.5 + Math.cos(a) * r + Math.cos(la) * len * 0.45;
      const py = 0.5 + Math.sin(a) * r + Math.sin(la) * len * 0.45;
      leaves.push({ x: px, y: py, angle: la, len, wid: len * (0.27 + 0.08 * rnd()), shade: 0.74 + 0.26 * rnd() });
    }
  }
  // inner filler leaves (the cluster reads dense in the middle, open at the rim)
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.27 * Math.sqrt(rnd());
    const len = 0.12 + 0.06 * rnd();
    leaves.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, angle: rnd() * Math.PI * 2, len, wid: len * 0.3, shade: 0.68 + 0.24 * rnd() });
  }
  return leaves;
}

/**
 * KB-I76: a fine broadleaf spray, a twig cluster of many small leaves (blade 3.5-6 % of the tile; with the per-card
 * jitter a 1.9 m card shows 7-11 cm leaves): twelve twigs from near the centre with alternate leaves on short petioles,
 * shorter side shoots, and filler leaves that close the middle, so the card edge breaks up into single small leaves.
 */
export function fineBroadleafSpray(seed: number): Leaf[] {
  const rnd = mulberry32(seed ^ 0xf1e1);
  const leaves: Leaf[] = [];
  const twigs = 12;
  for (let t = 0; t < twigs; t++) {
    const a0 = (t / twigs) * Math.PI * 2 + rnd() * 0.5;
    const bend = (rnd() - 0.5) * 1.1;
    const reach = 0.3 + 0.13 * rnd();
    const n = 15 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const a = a0 + bend * s;
      const r = 0.03 + reach * s;
      const side = i % 2 ? 1 : -1;
      const la = a + side * (0.7 + rnd() * 0.6);
      const len = 0.048 + 0.016 * rnd() - 0.012 * s;
      const px = 0.5 + Math.cos(a) * r + Math.cos(la) * len * 0.5;
      const py = 0.5 + Math.sin(a) * r + Math.sin(la) * len * 0.5;
      leaves.push({ x: px, y: py, angle: la, len, wid: len * (0.3 + 0.08 * rnd()), shade: 0.72 + 0.28 * rnd() });
      // a short side shoot with three leaves every fourth node
      if (i % 4 === 2 && s < 0.85) {
        const sa = a + side * (0.5 + 0.3 * rnd());
        for (let k = 1; k <= 3; k++) {
          const sr = 0.02 * k;
          const lk = sa + (k % 2 ? 1 : -1) * (0.6 + 0.5 * rnd());
          const ll = 0.04 + 0.012 * rnd();
          leaves.push({
            x: px + Math.cos(sa) * sr + Math.cos(lk) * ll * 0.5,
            y: py + Math.sin(sa) * sr + Math.sin(lk) * ll * 0.5,
            angle: lk,
            len: ll,
            wid: ll * 0.32,
            shade: 0.7 + 0.28 * rnd(),
          });
        }
      }
    }
  }
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.3 * Math.sqrt(rnd());
    const len = 0.04 + 0.016 * rnd();
    leaves.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, angle: rnd() * Math.PI * 2, len, wid: len * 0.32, shade: 0.66 + 0.24 * rnd() });
  }
  return leaves.filter((l) => l.x > 0.03 && l.x < 0.97 && l.y > 0.03 && l.y < 0.97);
}

/** KB-I76: a fine conifer spray (needles 2-3 % of the tile; the fine twin of `needleSpray`). */
export function fineNeedleSpray(seed: number): Leaf[] {
  const rnd = mulberry32(seed ^ 0x9e3f);
  const leaves: Leaf[] = [];
  for (let t = 0; t < 14; t++) {
    const a0 = (t / 14) * Math.PI * 2 + rnd() * 0.4;
    for (let i = 0; i < 18; i++) {
      const s = (i + 0.5) / 18;
      const r = 0.03 + 0.4 * s;
      const cx = 0.5 + Math.cos(a0) * r;
      const cy = 0.5 + Math.sin(a0) * r;
      for (let k = 0; k < 6; k++) {
        const la = a0 + (k % 2 ? 1 : -1) * (0.5 + 0.7 * rnd());
        const len = 0.028 + 0.014 * rnd();
        leaves.push({ x: cx + Math.cos(la) * len * 0.5, y: cy + Math.sin(la) * len * 0.5, angle: la, len, wid: 0.004, shade: 0.7 + 0.3 * rnd(), needle: true });
      }
    }
  }
  return leaves;
}

/** Needle tufts of a conifer spray: short straight needles radiating from points along three twigs. */
export function needleSpray(seed: number): Leaf[] {
  const rnd = mulberry32(seed ^ 0x9ee1);
  const leaves: Leaf[] = [];
  for (let t = 0; t < 7; t++) {
    const a0 = (t / 7) * Math.PI * 2 + rnd() * 0.6;
    for (let i = 0; i < 10; i++) {
      const s = (i + 0.5) / 10;
      const r = 0.03 + 0.38 * s;
      const cx = 0.5 + Math.cos(a0) * r;
      const cy = 0.5 + Math.sin(a0) * r;
      for (let k = 0; k < 8; k++) {
        const la = a0 + (k % 2 ? 1 : -1) * (0.5 + 0.7 * rnd());
        const len = 0.07 + 0.04 * rnd();
        leaves.push({ x: cx + Math.cos(la) * len * 0.5, y: cy + Math.sin(la) * len * 0.5, angle: la, len, wid: 0.008, shade: 0.7 + 0.3 * rnd(), needle: true });
      }
    }
  }
  return leaves;
}

/**
 * Coverage of a leaf at tile point (u, v): 1 inside the blade. Ovate blade: half-width wid · sin(π · s)^0.8 · (1.15 −
 * 0.3 s) along s ∈ [0, 1] from the petiole to the pointed tip. Returns NaN outside, else the signed across-coordinate
 * (−1..1) for the fold shading.
 */
export function leafAt(l: Leaf, u: number, v: number): number {
  return leafAtCS(l, Math.cos(l.angle), Math.sin(l.angle), u, v);
}

function leafAtCS(l: Leaf, c: number, s: number, u: number, v: number): number {
  const dx = u - l.x;
  const dy = v - l.y;
  const along = (dx * c + dy * s) / l.len + 0.5; // 0 petiole … 1 tip
  if (along < 0 || along > 1) return Number.NaN;
  const across = -dx * s + dy * c;
  if (Math.abs(across) > l.wid) return Number.NaN;
  const hw = l.needle ? l.wid : l.wid * Math.pow(Math.sin(Math.PI * along), 0.8) * (1.15 - 0.3 * along);
  if (Math.abs(across) > hw || hw <= 0) return Number.NaN;
  return across / hw;
}

/**
 * RGBA8 atlas of `size` × `size` texels (ATLAS_TILES² tiles): broadleaf sprays in tiles 0-2, needles in tile 3. Rows
 * run bottom-up in v (WebGL texture convention with flipY false: row 0 = v 0).
 */
export function rasterLeafAtlas(size = 1024, seed = 1789): Uint8Array {
  return rasterAtlas(size, (ti) => (ti === NEEDLE_TILE ? needleSpray(seed + ti) : broadleafSpray(seed + ti * 7919)));
}

/** KB-I76: the fine atlas (same layout as `rasterLeafAtlas`: fine broadleaf sprays in tiles 0-2, fine needles in 3). */
export function rasterFineLeafAtlas(size = 1024, seed = 1789): Uint8Array {
  return rasterAtlas(size, (ti) => (ti === NEEDLE_TILE ? fineNeedleSpray(seed + ti) : fineBroadleafSpray(seed + ti * 7919)));
}

function rasterAtlas(size: number, spray: (ti: number) => Leaf[]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const grey = Math.round(LEAF_GREY * 255);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = grey;
    out[i * 4 + 1] = grey;
    out[i * 4 + 2] = Math.round(grey * 0.94);
    out[i * 4 + 3] = 0;
  }
  const tile = size / ATLAS_TILES;
  const SS = 2; // supersamples per axis
  for (let ti = 0; ti < ATLAS_TILES * ATLAS_TILES; ti++) {
    const tx = (ti % ATLAS_TILES) * tile;
    const ty = Math.floor(ti / ATLAS_TILES) * tile;
    const leaves = spray(ti);
    const acc = new Float32Array(tile * tile * 2); // coverage, shade-weighted coverage
    for (const l of leaves) {
      const lc = Math.cos(l.angle);
      const ls = Math.sin(l.angle);
      const r = l.len * 0.6 + l.wid;
      const x0 = Math.max(0, Math.floor((l.x - r) * tile));
      const x1 = Math.min(tile - 1, Math.ceil((l.x + r) * tile));
      const y0 = Math.max(0, Math.floor((l.y - r) * tile));
      const y1 = Math.min(tile - 1, Math.ceil((l.y + r) * tile));
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          let cov = 0;
          let sh = 0;
          for (let sy = 0; sy < SS; sy++)
            for (let sx = 0; sx < SS; sx++) {
              const u = (px + (sx + 0.5) / SS) / tile;
              const v = (py + (sy + 0.5) / SS) / tile;
              const a = leafAtCS(l, lc, ls, u, v);
              if (Number.isNaN(a)) continue;
              cov += 1;
              // fold: one half a little darker; lighter midrib
              const fold = a < 0 ? 0.88 : 1.0;
              const rib = l.needle ? 1 : Math.abs(a) < 0.12 ? 1.12 : 1;
              sh += Math.min(1, l.shade * fold * rib);
            }
          if (!cov) continue;
          const k = (py * tile + px) * 2;
          // later leaves lie on top: blend over what is there
          const c = cov / (SS * SS);
          const shade = sh / cov;
          const prevC = acc[k];
          acc[k] = prevC + c * (1 - prevC);
          acc[k + 1] = acc[k + 1] * (1 - c) + shade * c;
        }
    }
    for (let py = 0; py < tile; py++)
      for (let px = 0; px < tile; px++) {
        const k = (py * tile + px) * 2;
        const c = acc[k];
        if (c <= 0) continue;
        const shade = acc[k + 1] / Math.max(c, 1e-4); // un-premultiply
        const o = ((ty + py) * size + tx + px) * 4;
        const g = Math.round(Math.min(1, shade) * 255);
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = Math.round(g * 0.94);
        out[o + 3] = Math.round(Math.min(1, c) * 255);
      }
  }
  return out;
}

/** Share of the texels of tile `ti` with alpha ≥ 128 (tests: a spray covers about half of its tile). */
export function tileCoverage(atlas: Uint8Array, size: number, ti: number): number {
  const tile = size / ATLAS_TILES;
  const tx = (ti % ATLAS_TILES) * tile;
  const ty = Math.floor(ti / ATLAS_TILES) * tile;
  let n = 0;
  for (let py = 0; py < tile; py++) for (let px = 0; px < tile; px++) if (atlas[((ty + py) * size + tx + px) * 4 + 3] >= 128) n++;
  return n / (tile * tile);
}

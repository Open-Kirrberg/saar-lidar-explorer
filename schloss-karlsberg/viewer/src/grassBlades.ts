/**
 * Wave 9 (garden, visual audit #1): short grass-blade cards near the camera. The splat alone reads soft and flat at eye
 * level (16, 17, 33, 44); within GRASS.radius m of the camera the lawn and the meadows get instanced tuft cards:
 *
 * - **Placement on the GPU.** A static disc lattice of instances (spacing GRASS.spacing m) around the camera's lattice
 *   cell; the vertex shader moves it to the camera (`uSnap`), jitters each tuft by a hash of its world cell (so a tuft
 *   stays where it is as the camera moves), and reads the ground from a small CPU window texture (`GrassWindow`,
 *   GRASS.window m at 0.5 m texels, rebuilt when the camera has moved GRASS.recentre m): R the height of the terrain
 *   mesh's own triangulation (`triHeight`, so the roots neither float nor sink), G the lawn weight, B the meadow / hay
 *   weight, A free of walks (the draped walk ribbons of site/features.ts). Fields, vines, gardens, hard ground, water,
 *   forest and buildings take no tufts.
 * - **Look.** One camera-facing card per tuft from a procedural atlas (`grassTuftAtlas`: our own output, no licence)
 *   with a lawn tile (dense short blades; KB-I78: nearly flat shade within LAWN_SHADE, half-width cards, ±lawnJitter)
 *   and a meadow tile (fewer, longer blades and a few seed stems); alpha to coverage like the leaf cards. The card colour is the land-cover bake's albedo at the root (landcoverBake.ts), so
 *   the blades are the ground's own colour, with the atlas darkening toward the root (self-shading in the sward) and a
 *   per-tuft jitter; the shading normal is the ground's (up), so the tufts light like the ground they stand on. Heights
 *   from GRASS_SWARD (grammar.ts): scythed lawn 4.5-8.5 cm, July aftermath on the meadows 9-22 cm.
 * - **Cost.** Density thins beyond GRASS.dense m (kept share (dense / d)², survivors widen by the square root of the
 *   loss, `keepShare`), and (KB-I78) the outer GRASS.feather m of the disc dissolve per pixel (interleaved-gradient
 *   noise against a smooth fade, so no band and no per-tuft pop marks the edge); no shadow casting (they receive);
 *   wind as a vertex bend (foliage.ts clock, deterministic under `skb.step`). Hidden when the camera is high above the
 *   ground or inside a building. No flat varyings (KB-I65).
 */
import * as THREE from 'three';
import { E0, N0 } from '@model/frame.ts';
import { mulberry32 } from '@model/layout/geom.ts';
import { GRASS_SWARD } from '@model/layout/grammar.ts';
import { foliageUniforms } from './foliage.ts';
import { FIELD_GLSL, ZONE_GLSL } from './landcoverBake.ts';
import { GROUND_CLASS } from './landcover.ts';
import type { TerrainData } from './terrain.ts';

/** Blade field parameters [I]. */
export const GRASS = {
  /** radius (m) of the tuft field round the camera (3D distance) */
  radius: 22,
  /** lattice spacing (m) of the tuft cards */
  spacing: 0.2,
  /** full density within this distance (m); beyond, the kept share falls as (dense / d)² */
  dense: 6,
  /**
   * wave 11 (KB-I94, pose 39 retina over budget): the meadow and hay tufts thin from 4.5 m instead (the lawn keeps 6 m,
   * so the garden poses do not change): their 15-35 cm cards overlapped ~1.2× over the lower screen at eye height, and
   * every alpha-tested card fragment is shaded; the survivors widen as before (`keepShare`), ~24 % less card area [I]
   */
  meadowDense: 4.5,
  /** CPU window: side (m), texel (m), and how far (m) the camera may move before it is rebuilt */
  window: 64,
  texel: 0.5,
  recentre: 8,
  /** roots sit this much (m) below the ground so no gap shows on slopes */
  sink: 0.025,
  /** KB-I78: the outer `feather` m of the disc dissolve per pixel (screen-space dither), not per tuft */
  feather: 7,
  /** KB-I78: lawn tufts vary their albedo by ± lawnJitter around the ground's own (meadow ±10 %) */
  lawnJitter: 0.04,
  /**
   * KB-I78 (review fix, retina cost): lawn tufts stop at lawnRadius m (their outer lawnFeather m dissolving per pixel):
   * at ±4 % of the ground's albedo they add nothing visible farther out, and every alpha-tested card fragment costs
   * full shading on a tile GPU (discard defeats hidden-surface removal; measured: opaque cards are cheaper than none)
   */
  lawnRadius: 10,
  lawnFeather: 3,
  /**
   * wave-10 review fix: in the standing parcels and uncut margins of the meadow-lawn's aftermath meadow (lawnZones.ts),
   * this share of the tufts are seeding culms (atlas tile 2, GRASS_SWARD.seeding); the rest are leafy meadow tufts
   */
  seedShare: 0.14,
  /** wave-10 review fix: share of the leafy meadow tufts kept between the seeding culms of a standing parcel (retina fill) */
  leafKeep: 0.45,
  /** wave-10 review fix: the straw windrows of scythed parcels and their stubble reach this far (m; between lawn and meadow) */
  windrowRadius: 14,
} as const;

/**
 * KB-I78: lawn tile shade [root, transparent fill, least per-blade shade]: a scythed and rolled sward reads as an even
 * fine grain at 1:1, so the lawn blades darken only 3 % toward the root and vary 3 % per blade (the meadow tile keeps
 * 0.8 at the root) [I].
 */
export const LAWN_SHADE = [0.97, 0.985, 0.97] as const;

/** Kept share of the lattice tufts at distance d (m) and the width factor of the survivors (coverage kept). */
export function keepShare(d: number, dense: number = GRASS.dense): { keep: number; widen: number } {
  const keep = d <= dense ? 1 : Math.max(0.04, (dense / d) ** 2);
  return { keep, widen: Math.min(2.5, Math.sqrt(1 / keep)) };
}

/** Lattice offsets (integer cell units) of a disc of `radius` m at `spacing` m, farthest first (painter's order). */
export function discLattice(radius: number, spacing: number): Float32Array {
  const n = Math.ceil(radius / spacing) + 1;
  const pts: [number, number, number][] = [];
  for (let j = -n; j <= n; j++)
    for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i, j) * spacing;
      if (d <= radius + spacing) pts.push([i, j, d]);
    }
  pts.sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
  const out = new Float32Array(pts.length * 2);
  pts.forEach((p, k) => {
    out[k * 2] = p[0];
    out[k * 2 + 1] = p[1];
  });
  return out;
}

/**
 * Height of the terrain mesh at local (x, z), triangle by triangle as TerrainMesh draws its 1 m chunks (diagonal from
 * (col + 1, row) to (col, row + 1)); NaN outside the grid.
 */
export function triHeight(h: ArrayLike<number>, grid: { west: number; north: number; cell: number; cols: number; rows: number }, E0: number, N0: number, x: number, z: number): number {
  const c = (x + E0 - grid.west) / grid.cell - 0.5;
  const r = (grid.north - (N0 - z)) / grid.cell - 0.5;
  if (c < 0 || r < 0 || c > grid.cols - 1 || r > grid.rows - 1) return Number.NaN;
  const c0 = Math.min(grid.cols - 2, Math.floor(c));
  const r0 = Math.min(grid.rows - 2, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const i = r0 * grid.cols + c0;
  const a = h[i];
  const b = h[i + 1];
  const cc = h[i + grid.cols];
  const e = h[i + grid.cols + 1];
  if (fc + fr <= 1) return a + (b - a) * fc + (cc - a) * fr;
  return e + (cc - e) * (1 - fc) + (b - e) * (1 - fr);
}

/** Lawn and meadow weights of a ground class (blades only on grass classes). */
export function grassClassWeights(cls: number): [number, number] {
  if (cls === GROUND_CLASS.lawn) return [1, 0];
  if (cls === GROUND_CLASS.meadow || cls === GROUND_CLASS.hay) return [0, 1];
  return [0, 0];
}

/** A draped walk the tufts keep off: local [x, z] polyline and its width (m). */
export interface GrassWalk {
  line: [number, number][];
  width: number;
}

/** Distance (m) from a point to a polyline. */
function distToLine(line: readonly [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const ex = line[i + 1][0] - ax;
    const ez = line[i + 1][1] - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/**
 * Fill the window texels (row-major, `n` × `n`, texel centres at x0 + (i + 0.5)·texel, z0 + (j + 0.5)·texel):
 * R height (triHeight), G lawn, B meadow (bilinear over the 2 m class raster), A free of walks (0 on a walk, 1 from
 * 0.35 m beyond its edge). Pure.
 */
export function fillGrassWindow(
  out: Float32Array,
  n: number,
  x0: number,
  z0: number,
  texel: number,
  t: { h: ArrayLike<number>; grid: { west: number; north: number; cell: number; cols: number; rows: number }; ground: ArrayLike<number>; gcell: number; gcols: number; grows: number; E0: number; N0: number },
  walks: readonly GrassWalk[],
): void {
  const near = walks.filter((w) => w.line.some(([x, z]) => x > x0 - 60 && x < x0 + n * texel + 60 && z > z0 - 60 && z < z0 + n * texel + 60));
  const gx0 = t.grid.west - t.E0;
  const gz0 = -(t.grid.north - t.N0);
  const cls = (r: number, c: number) => t.ground[Math.max(0, Math.min(t.grows - 1, r)) * t.gcols + Math.max(0, Math.min(t.gcols - 1, c))];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * texel;
      const z = z0 + (j + 0.5) * texel;
      const k = (j * n + i) * 4;
      const hh = triHeight(t.h, t.grid, t.E0, t.N0, x, z);
      out[k] = Number.isFinite(hh) ? hh : -1e4;
      // bilinear over the class cell centres
      const fc = (x - gx0) / t.gcell - 0.5;
      const fr = (z - gz0) / t.gcell - 0.5;
      const c0 = Math.floor(fc);
      const r0 = Math.floor(fr);
      const u = fc - c0;
      const v = fr - r0;
      let lawn = 0;
      let mead = 0;
      for (const [dr, dc, w] of [
        [0, 0, (1 - u) * (1 - v)],
        [0, 1, u * (1 - v)],
        [1, 0, (1 - u) * v],
        [1, 1, u * v],
      ] as const) {
        const [l, m] = grassClassWeights(cls(r0 + dr, c0 + dc));
        lawn += l * w;
        mead += m * w;
      }
      out[k + 1] = lawn;
      out[k + 2] = mead;
      let free = 1;
      for (const w of near) {
        const d = distToLine(w.line, x, z) - w.width / 2;
        free = Math.min(free, Math.min(1, Math.max(0, d / 0.35)));
        if (free === 0) break;
      }
      out[k + 3] = free;
    }
}

/** Tiles of the tuft atlas, side by side: 0 lawn, 1 meadow, 2 seeding stems (wave-10 review fix). */
export const TUFT_TILES = 3;

/**
 * Procedural tuft atlas (RGBA8, TUFT_TILES tiles side by side, each `tw` × `th` texels, rows bottom-up): tile 0 a lawn
 * tuft (about 70 short, fine, mostly upright blades), tile 1 a meadow tuft (about 34 longer, leaning and curving blades
 * and three seed stems), tile 2 (wave-10 review fix) seeding grass: a few basal leaves and long thin culms with loose
 * panicles. RGB is a grey shade, darker toward the roots (0.5 → 1.0); transparent texels carry the mean grey. The
 * panicle texels of tile 2 carry G = 0.75 · R (a head marker the shader tints pinkish-buff, `headMark`); everywhere
 * else R = G = B. Deterministic; tiles 0 and 1 are drawn first, so they are unchanged by tile 2.
 */
export function grassTuftAtlas(tw = 256, th = 128, seed = 1789): Uint8Array {
  const W = tw * TUFT_TILES;
  const out = new Uint8Array(W * th * 4);
  // KB-I78: the lawn tile is nearly flat in shade (a scythed sward has no dark tuft bases at 1:1), the meadow keeps its
  // darker roots
  const MEAN = [LAWN_SHADE[1], 0.88, 0.88];
  for (let i = 0; i < W * th; i++) {
    const m = MEAN[Math.min(TUFT_TILES - 1, Math.floor((i % W) / tw))];
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.round(m * 255);
  }
  const cov = new Float32Array(W * th);
  const sh = new Float32Array(W * th);
  const hd = new Float32Array(W * th);
  const blade = (tile: number, root: number, height: number, lean: number, curve: number, hw: number, shade: number, head = 0) => {
    // centre line x(t) = root + lean·t + curve·t² (tile units), y = t·height; half-width tapers to the tip
    const rows = Math.max(2, Math.round(height * th));
    for (let ry = 0; ry < rows; ry++) {
      const tt = (ry + 0.5) / rows;
      const xc = root + lean * tt + curve * tt * tt;
      let w = hw * Math.pow(1 - tt, 0.6) + 0.0012;
      if (head && tt > 1 - head) w = Math.max(w, hw * (tile === 2 ? 2.8 : 1.6) * Math.sin((Math.PI * (tt - 1 + head)) / head));
      const xa = (xc - w) * tw;
      const xb = (xc + w) * tw;
      for (let px = Math.max(0, Math.floor(xa)); px <= Math.min(tw - 1, Math.ceil(xb)); px++) {
        // horizontal coverage of the texel (box filter)
        const c = Math.max(0, Math.min(px + 1, xb) - Math.max(px, xa));
        if (c <= 0) continue;
        const k = ry * W + tile * tw + px;
        const across = (px + 0.5 - xc * tw) / Math.max(1e-3, w * tw);
        const s =
          tile === 0
            ? Math.min(1, (LAWN_SHADE[0] + (1 - LAWN_SHADE[0]) * Math.pow(tt, 0.7)) * shade * (across < 0 ? 0.985 : 1))
            : Math.min(1, (0.8 + 0.2 * Math.pow(tt, 0.7)) * shade * (across < 0 ? 0.94 : 1));
        // KB-I78 (review fix): the lawn tile accumulates shade weighted by the coverage it adds and is normalised below,
        // so a partly covered edge texel keeps the blade's shade instead of fading toward black (dark fringes read as
        // speckle at 1:1); the meadow tile keeps its look (46 / 47)
        if (tile === 0) sh[k] += s * c * (1 - cov[k]);
        else sh[k] = sh[k] * (1 - c) + s * c;
        // the panicle of a seeding culm (tile 2): head marker, painted over what lies below
        if (tile === 2) hd[k] = hd[k] * (1 - c) + (head && tt > 1 - head ? c : 0);
        cov[k] = cov[k] + c * (1 - cov[k]);
      }
    }
  };
  const rnd = mulberry32(seed ^ 0x6a55);
  // lawn: the blades gather in five small tussocks with thinner sward between, so a card reads as a few tufts, not as
  // one even strip (wave-9 review of the first cut: rows of identical bands at 16 / 33)
  const tussock = Array.from({ length: 5 }, (_, k) => 0.1 + 0.8 * ((k + 0.2 + 0.6 * rnd()) / 5));
  for (let b = 0; b < 120; b++) {
    const c = tussock[b % 5];
    const g = (rnd() + rnd() + rnd() - 1.5) * 0.09;
    const root = b < 96 ? Math.min(0.96, Math.max(0.04, c + g)) : 0.04 + 0.92 * rnd();
    const tall = b < 96 ? 1 - Math.min(1, Math.abs(g) / 0.16) * 0.45 : 0.6;
    blade(0, root, (0.35 + 0.65 * rnd()) * tall, (rnd() - 0.5) * 0.14 + g * 0.5, (rnd() - 0.5) * 0.06, 0.0085 + 0.004 * rnd(), LAWN_SHADE[2] + (1 - LAWN_SHADE[2]) * rnd());
  }
  for (let b = 0; b < 52; b++) {
    const root = 0.06 + 0.88 * rnd();
    const side = rnd() < 0.5 ? -1 : 1;
    blade(1, root, 0.4 + 0.6 * rnd(), side * rnd() * 0.16, side * rnd() * 0.12, 0.011 + 0.005 * rnd(), 0.8 + 0.2 * rnd());
  }
  for (let b = 0; b < 3; b++) blade(1, 0.25 + 0.5 * rnd(), 0.92 + 0.08 * rnd(), (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.04, 0.004, 0.95, 0.16);
  // tile 2 (wave-10 review fix): seeding grass of the uncut aftermath meadow: basal leaves to ~40 % of the card, then
  // 9 culms from three tussocks, 70-100 % high, slightly nodding, each with a loose panicle over its top 18-30 %
  const rnd2 = mulberry32(seed ^ 0x5eed);
  for (let b = 0; b < 26; b++) {
    const side = rnd2() < 0.5 ? -1 : 1;
    blade(2, 0.15 + 0.7 * rnd2(), 0.18 + 0.24 * rnd2(), side * rnd2() * 0.2, side * rnd2() * 0.14, 0.012 + 0.006 * rnd2(), 0.8 + 0.2 * rnd2());
  }
  const tus = [0.25 + 0.1 * rnd2(), 0.5 + 0.08 * rnd2(), 0.72 + 0.1 * rnd2()];
  for (let b = 0; b < 9; b++) {
    const lean = (rnd2() - 0.5) * 0.22;
    blade(2, tus[b % 3] + (rnd2() - 0.5) * 0.08, 0.7 + 0.3 * rnd2(), lean, lean * 0.6 + (rnd2() - 0.5) * 0.05, 0.005, 0.9 + 0.1 * rnd2(), 0.2 + 0.12 * rnd2());
  }
  for (let k = 0; k < W * th; k++) {
    if (cov[k] <= 0) continue;
    const g = Math.round(Math.min(1, k % W < tw ? sh[k] / cov[k] : sh[k]) * 255);
    out[k * 4] = g;
    out[k * 4 + 1] = Math.round(g * (1 - 0.25 * Math.min(1, hd[k] / cov[k])));
    out[k * 4 + 2] = g;
    out[k * 4 + 3] = Math.round(Math.min(1, cov[k]) * 255);
  }
  return out;
}

/** Mean and least shade of the opaque texels (alpha ≥ 128) of tile `tile` (tests). */
export function tuftShade(atlas: Uint8Array, tw: number, th: number, tile: number): { mean: number; min: number } {
  let n = 0;
  let sum = 0;
  let min = 1;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const k = (y * tw * TUFT_TILES + tile * tw + x) * 4;
      if (atlas[k + 3] < 128) continue;
      const v = atlas[k] / 255;
      sum += v;
      min = Math.min(min, v);
      n++;
    }
  return { mean: n ? sum / n : 0, min };
}

/** Share of the opaque texels (alpha ≥ 128) of tile `tile` that carry the panicle marker G < R (tests). */
export function tuftHeadShare(atlas: Uint8Array, tw: number, th: number, tile: number): number {
  let n = 0;
  let h = 0;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const k = (y * tw * TUFT_TILES + tile * tw + x) * 4;
      if (atlas[k + 3] < 128) continue;
      n++;
      if (atlas[k + 1] < atlas[k] - 4) h++;
    }
  return n ? h / n : 0;
}

/** Share of the texels of tile `tile` with alpha ≥ 128 (tests). */
export function tuftCoverage(atlas: Uint8Array, tw: number, th: number, tile: number): number {
  let n = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (atlas[(y * tw * TUFT_TILES + tile * tw + x) * 4 + 3] >= 128) n++;
  return n / (tw * th);
}

const VERT = /* glsl */ `
attribute vec2 aCell;
uniform vec2 uSnap;
uniform float uGS;
uniform float uGR;
uniform float uGDense;
uniform float uGDenseM;
uniform vec3 uGCam;
uniform sampler2D tGWin;
uniform vec3 uGWin; // x0, z0 (texel 0 corner), texel
uniform float uGWinN;
uniform sampler2D tGLand;
uniform vec2 uGLandO;
uniform vec2 uGLandS;
uniform vec4 uGH; // lawn h0, h1, meadow h0, h1
uniform vec2 uGAspect; // card width : height (lawn, meadow)
uniform float uGOn;
uniform float uFolTime;
uniform float uFolWind;
uniform float uGFeather;
uniform vec2 uGLawnR; // lawn radius, lawn feather
uniform float uGLawnJ;
// wave-10 review fix: the meadow-lawn's aftermath meadow (macro B of the terrain, lawnZones.ts; ZONE_GLSL)
uniform sampler2D tGMacro;
uniform sampler2D tGNoise;
uniform vec2 uGGridU;
uniform vec3 uGStraw;
uniform float uGZone;
uniform vec4 uGSeed; // seeding height h0, h1, card aspect, share
uniform vec4 uGCut; // windrow h0, h1, stubble h0, h1
uniform float uGWindR;
uniform float uGLeafKeep;
varying vec3 vGCol;
varying vec3 vGSeed;
varying float vGFade;
float zn( vec2 p ) { vec2 i = floor( p ); vec2 f = fract( p ); return textureLod( tGNoise, ( i + f * f * ( 3.0 - 2.0 * f ) + 0.5 ) / 256.0, 0.0 ).r; }
${FIELD_GLSL}
${ZONE_GLSL}
vec4 gHash( vec2 p ) {
	vec4 p4 = fract( vec4( p.xyxy ) * vec4( 0.1031, 0.1030, 0.0973, 0.1099 ) );
	p4 += dot( p4, p4.wzxy + 33.33 );
	return fract( ( p4.xxyz + p4.yzzw ) * p4.zywx );
}
vec4 gWin( vec2 xz ) {
	vec2 f = ( xz - uGWin.xy ) / uGWin.z - 0.5;
	vec2 i0 = floor( f );
	vec2 t = f - i0;
	ivec2 a = ivec2( clamp( i0, vec2( 0.0 ), vec2( uGWinN - 1.0 ) ) );
	ivec2 b = ivec2( clamp( i0 + 1.0, vec2( 0.0 ), vec2( uGWinN - 1.0 ) ) );
	vec4 s00 = texelFetch( tGWin, ivec2( a.x, a.y ), 0 );
	vec4 s10 = texelFetch( tGWin, ivec2( b.x, a.y ), 0 );
	vec4 s01 = texelFetch( tGWin, ivec2( a.x, b.y ), 0 );
	vec4 s11 = texelFetch( tGWin, ivec2( b.x, b.y ), 0 );
	return mix( mix( s00, s10, t.x ), mix( s01, s11, t.x ), t.y );
}
`;

// (runs in place of beginnormal_vertex: the ground normal under the tuft becomes the shading normal, so the per-vertex
// terrain light of atmosphere.ts sees the same normal as the terrain mesh; begin_vertex is emptied)
const VERT_BEGIN = /* glsl */ `
vec3 transformed;
vec3 objectNormal;
{
	vec2 cellI = uSnap + aCell;
	vec4 hr = gHash( cellI );
	vec4 hr2 = gHash( cellI + 37.0 );
	vec2 xz = ( cellI + hr.xy ) * uGS;
	vec4 w = gWin( xz );
	objectNormal = normalize( vec3( w.r - gWin( xz + vec2( 0.5, 0.0 ) ).r, 0.5, w.r - gWin( xz + vec2( 0.0, 0.5 ) ).r ) );
	float dh = distance( vec3( xz.x, w.r, xz.y ), uGCam );
	float lawnF = w.g / max( w.g + w.b, 1e-3 );
	float isLawn = step( 0.5, lawnF );
	// wave 11 (KB-I94): meadow tufts thin from uGDenseM (GRASS.meadowDense), lawn tufts from uGDense
	float gDense = mix( uGDenseM, uGDense, isLawn );
	float keep = dh <= gDense ? 1.0 : max( 0.04, ( gDense / dh ) * ( gDense / dh ) );
	float widen = min( 2.5, sqrt( 1.0 / keep ) );
	float grassW = clamp( ( w.g + w.b ) * w.a, 0.0, 1.0 );
	// a tuft stands where its random is under the grass weight (soft class edges fray) and the density share
	float present = step( hr.z, smoothstep( 0.3, 0.7, grassW ) ) * step( hr2.x, keep ) * uGOn;
	float tile = 1.0 - isLawn; // atlas tile: 0 lawn, 1 meadow, 2 seeding culms
	vec2 hR = mix( uGH.zw, uGH.xy, isLawn );
	float aspect = mix( uGAspect.y, uGAspect.x, isLawn );
	float gR = mix( uGR, uGLawnR.x, isLawn );
	float gF = mix( uGFeather, uGLawnR.y, isLawn );
	float strawW = 0.0;
	// wave-10 review fix (04 / 16 / 33: no standing height, no swath within 30 m): on the meadow-lawn's aftermath meadow
	// the tufts follow the parcel's mowing state (aftermathSwath, the same frame as the bake and the terrain shader):
	// standing seeding grass in uncut parcels and along the uncut margins (leafy meadow tufts and seeding culms with
	// panicles), straw windrows and short stubble in scythed parcels, short regrowth elsewhere [N July aftermath, research/11 §3.1; I]
	if ( uGZone > 0.5 && isLawn > 0.5 && present > 0.0 ) {
		vec4 hr3 = gHash( cellI + 71.0 );
		float gm = lawnMeadowAt( textureLod( tGMacro, ( xz - uGLandO ) / uGLandS, 0.0 ).b, xz, zn( xz / 1.6 + 23.0 ), zn( xz / 7.0 + 5.0 ) );
		if ( hr3.x < gm ) {
			Swath S = aftermathSwath( xz, uGGridU );
			bool cut = S.st >= 0.45 && S.st < 0.8;
			float standing = S.st < 0.45 ? 1.0 : ( cut ? 1.0 - smoothstep( 0.6, 1.6, S.edge ) : 0.0 );
			if ( hr3.y < standing ) {
				isLawn = 0.0;
				gR = uGR;
				gF = uGFeather;
				if ( hr3.z < uGSeed.w ) {
					tile = 2.0;
					hR = uGSeed.xy;
					aspect = uGSeed.z;
				} else {
					// leafy meadow tufts, thinned to uGLeafKeep and only within uGWindR m (the bake's seeding tone and the
					// darker sward depth of the terrain shader fill between them; retina fill cost), the culms reach uGR
					tile = 1.0;
					hR = uGH.zw;
					aspect = uGAspect.y;
					gR = uGWindR;
					present *= step( hr3.z, uGSeed.w + uGLeafKeep * ( 1.0 - uGSeed.w ) );
				}
			} else if ( cut ) {
				gR = uGWindR;
				if ( hr3.w < S.wr * 1.6 ) {
					strawW = 1.0;
					tile = 1.0;
					hR = uGCut.xy;
					aspect = uGAspect.y;
				} else {
					hR = uGCut.zw;
				}
			} else {
				hR = uGH.xy * 1.35;
			}
		}
	}
	float H = mix( hR.x, hR.y, hr.w );
	// KB-I78: no shrinking band at the disc edge (it read as a ring at 39); the outer uGFeather m dissolve per pixel
	H *= present * step( dh, gR ) * smoothstep( 0.3, 0.6, grassW );
	vGFade = 1.0 - smoothstep( gR - gF, gR, dh );
	float Wd = H * aspect * widen * ( 0.85 + 0.3 * hr2.y );
	// camera-facing about the vertical, ±25° of jitter
	vec2 toC = uGCam.xz - xz;
	float ang = atan( toC.y, toC.x ) - 1.5708 + ( hr2.z - 0.5 ) * 0.87;
	vec2 right = vec2( cos( ang ), sin( ang ) );
	float cy = position.y; // 0 root .. 1 tip
	float cx = position.x; // -0.5 .. 0.5
	// wind: the tip bends toward the north-east (prevailing south-west wind), gusting per tuft
	float ph = dot( xz, vec2( 0.31, 0.23 ) );
	float bend = ( 0.55 * sin( uFolTime * 1.7 + ph ) + 0.35 * sin( uFolTime * 2.9 + ph * 1.3 ) + 0.3 ) * uFolWind * 0.35 * H * cy * cy;
	transformed = vec3( xz.x + right.x * cx * Wd, w.r - ${GRASS.sink.toFixed(3)} + cy * H, xz.y + right.y * cx * Wd );
	transformed.xz += vec2( 0.8, -0.6 ) * bend;
	#ifdef USE_MAP
		// tile 0 lawn, tile 1 meadow; mirrored per tuft
		float u = position.x + 0.5;
		u = hr2.w < 0.5 ? u : 1.0 - u;
		vMapUv = vec2( ( u + tile ) / ${TUFT_TILES.toFixed(1)}, cy );
	#endif
	// the ground's own albedo at the root (land-cover bake, sqrt-encoded linear), with a per-tuft jitter
	vec4 lc = textureLod( tGLand, ( xz - uGLandO ) / uGLandS, 0.0 );
	// (a touch greener than the ground: the green of the living blades over the browner, sun-faded thatch the splat sees)
	// KB-I78: on the lawn the blades keep the ground's own colour within ±uGLawnJ (no dark speckle at 1:1)
	vec3 meadowC = ( 0.88 + 0.2 * hr2.y ) * vec3( 0.93 + 0.06 * ( hr.w - 0.5 ), 1.0, 0.9 - 0.08 * ( hr2.z - 0.5 ) );
	vec3 lawnC = vec3( 1.0 + uGLawnJ * ( 2.0 * hr2.y - 1.0 ) ) * vec3( 0.99 + 0.02 * ( hr.w - 0.5 ), 1.0, 0.98 - 0.02 * ( hr2.z - 0.5 ) );
	vec3 g0 = lc.rgb * lc.rgb;
	vGCol = g0 * mix( meadowC, lawnC, isLawn );
	// wave-10 review fix: straw windrow tufts (pale, warm), and the panicle colour of the seeding culms: pinkish-buff
	// (Holcus), purplish-brown (Agrostis) or green-buff (Dactylis, Festuca) per tuft, muted [N July meadow grasses; I hues]
	float gL = dot( g0, vec3( 0.2126, 0.7152, 0.0722 ) );
	// (drying hay: straw with a grey-green cast, not a dead orange-brown)
	vec3 strawT = mix( uGStraw, g0 * ( dot( uGStraw, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( gL, 1e-4 ) ), 0.35 );
	vec3 strawC = strawT * ( gL * 1.28 / max( dot( strawT, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) ) * ( 0.9 + 0.2 * hr2.y );
	vGCol = mix( vGCol, strawC, strawW );
	vec3 seedC = hr.z < 0.3 ? vec3( 0.46, 0.38, 0.3 ) : hr.z < 0.55 ? vec3( 0.34, 0.26, 0.23 ) : vec3( 0.48, 0.45, 0.26 );
	float seedL = hr.z < 0.3 ? 1.15 : hr.z < 0.55 ? 0.95 : 1.12;
	vGSeed = seedC * ( gL * seedL / dot( seedC, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * ( 0.9 + 0.2 * hr2.y );
}
`;

let atlasTex: THREE.DataTexture | null = null;
function tuftTexture(): THREE.DataTexture {
  if (!atlasTex) {
    const tw = 256;
    const th = 128;
    atlasTex = new THREE.DataTexture(grassTuftAtlas(tw, th), tw * TUFT_TILES, th, THREE.RGBAFormat);
    atlasTex.colorSpace = THREE.NoColorSpace; // linear shade factors around 1
    atlasTex.generateMipmaps = true;
    atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;
    atlasTex.anisotropy = 4;
    atlasTex.name = 'grass-tuft-atlas (procedural)';
    atlasTex.needsUpdate = true;
  }
  return atlasTex;
}

export interface GrassOptions {
  /** land-cover bake (terrain material uniforms tLand / uGroundOrigin / uGroundSize) */
  land: {
    tLand: { value: THREE.Texture };
    uGroundOrigin: { value: THREE.Vector2 };
    uGroundSize: { value: THREE.Vector2 };
    /** wave-10 review fix: the meadow-lawn's mowing zones (macro B), the noise lattice, the palace grid and the straw colour */
    tMacro?: { value: THREE.Texture };
    tNoise?: { value: THREE.Texture };
    uGridU?: { value: THREE.Vector2 };
    uHayStraw?: { value: THREE.Vector3 };
  };
  walks?: GrassWalk[];
  /** extra material patch (sky SH diffuse) */
  patch?: (m: THREE.MeshStandardMaterial) => void;
  /** render order: after the terrain (RENDER_ORDER.terrain 1, whose depth the cards test against) and before the sky (2) */
  renderOrder?: number;
}

export class GrassBlades {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  /** master switch (A/B: `skb.grass.setEnabled(false)`) */
  enabled = true;
  /** set by the viewer each frame */
  indoor = false;
  private win: THREE.DataTexture;
  private winData: Float32Array;
  private winN: number;
  private winAt = new THREE.Vector2(1e9, 1e9);
  private epoch = '';
  readonly uniforms: Record<string, { value: unknown }>;

  constructor(
    private terrain: TerrainData,
    private opts: GrassOptions,
  ) {
    this.winN = Math.round(GRASS.window / GRASS.texel);
    this.winData = new Float32Array(this.winN * this.winN * 4);
    this.win = new THREE.DataTexture(this.winData, this.winN, this.winN, THREE.RGBAFormat, THREE.FloatType);
    this.win.minFilter = this.win.magFilter = THREE.NearestFilter;
    this.win.generateMipmaps = false;
    this.win.needsUpdate = true;
    const lat = discLattice(GRASS.radius, GRASS.spacing);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(lat, 2));
    geo.instanceCount = lat.length / 2;
    const S = GRASS_SWARD;
    this.uniforms = {
      uSnap: { value: new THREE.Vector2() },
      uGS: { value: GRASS.spacing },
      uGR: { value: GRASS.radius },
      uGDense: { value: GRASS.dense },
      uGDenseM: { value: GRASS.meadowDense },
      uGCam: { value: new THREE.Vector3() },
      tGWin: { value: this.win },
      uGWin: { value: new THREE.Vector3(0, 0, GRASS.texel) },
      uGWinN: { value: this.winN },
      tGLand: opts.land.tLand,
      uGLandO: opts.land.uGroundOrigin,
      uGLandS: opts.land.uGroundSize,
      uGH: { value: new THREE.Vector4(S.lawn.height[0], S.lawn.height[1], S.meadow.height[0], S.meadow.height[1]) },
      uGAspect: { value: new THREE.Vector2(S.lawn.card, S.meadow.card) },
      uGOn: { value: 1 },
      uGFeather: { value: GRASS.feather },
      uGLawnR: { value: new THREE.Vector2(GRASS.lawnRadius, GRASS.lawnFeather) },
      uGLawnJ: { value: GRASS.lawnJitter },
      tGMacro: opts.land.tMacro ?? { value: null },
      tGNoise: opts.land.tNoise ?? { value: null },
      uGGridU: opts.land.uGridU ?? { value: new THREE.Vector2(1, 0) },
      uGStraw: opts.land.uHayStraw ?? { value: new THREE.Vector3(0.485, 0.431, 0.195) },
      /** 1 = the aftermath meadow of the meadow-lawn shapes the tufts (A/B: `skb.grass.uniforms.uGZone.value = 0`) */
      uGZone: { value: opts.land.tMacro && opts.land.tNoise ? 1 : 0 },
      uGSeed: { value: new THREE.Vector4(S.seeding.height[0], S.seeding.height[1], S.seeding.card, GRASS.seedShare) },
      uGCut: { value: new THREE.Vector4(S.windrow.height[0], S.windrow.height[1], S.stubble.height[0], S.stubble.height[1]) },
      uGWindR: { value: GRASS.windrowRadius },
      uGLeafKeep: { value: GRASS.leafKeep },
      /** blade albedo gain against the land bake (the photo detail of the ground averages ~1) */
      uGGain: { value: 1.0 },
    };
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, map: tuftTexture(), alphaTest: 0.5, alphaToCoverage: true });
    m.name = 'vegetation.grass';
    const u = this.uniforms;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, { uFolTime: foliageUniforms.uFolTime, uFolWind: foliageUniforms.uFolWind });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT}`)
        .replace('#include <beginnormal_vertex>', VERT_BEGIN)
        .replace('#include <begin_vertex>', '');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGCol;\nvarying vec3 vGSeed;\nvarying float vGFade;\nuniform float uGGain;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
// wave-10 review fix: the panicle texels of the seeding tile carry G < R (grassTuftAtlas headMark); elsewhere R = G = B
float gHead = clamp( ( sampledDiffuseColor.r - sampledDiffuseColor.g ) / max( sampledDiffuseColor.r, 1e-3 ) * 4.0, 0.0, 1.0 );
diffuseColor.rgb = vec3( sampledDiffuseColor.r ) * mix( vGCol, vGSeed, gHead ) * uGGain;
// KB-I78: the disc edge dissolves per pixel (interleaved gradient noise), so no tuft-sized band marks it
if ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) > vGFade ) discard;
{
	// thin blades lose alpha in the coarser mips: compensate as the leaf cards do (atlas 512 × 128)
	vec2 gdx = dFdx( vMapUv * vec2( ${256 * TUFT_TILES}.0, 128.0 ) );
	vec2 gdy = dFdy( vMapUv * vec2( ${256 * TUFT_TILES}.0, 128.0 ) );
	float glod = 0.5 * log2( max( max( dot( gdx, gdx ), dot( gdy, gdy ) ), 1e-6 ) );
	diffuseColor.a *= 1.0 + max( 0.0, glod ) * 0.35;
}`,
        );
    };
    m.customProgramCacheKey = () => 'grass-blades-5';
    // no depth write: the screen-space AO (post.ts, ≥ 0.9 m radius) read the 5-20 cm cards as walls and drew each tuft
    // as a dark clump; the ground's depth stays in the buffer, and the cards draw far to near (discLattice order) over it
    m.depthWrite = false;
    opts.patch?.(m);
    this.material = m;
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.name = 'grass-blades';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = opts.renderOrder ?? 1.5;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData = { part: 'vegetation', lod: 'grass' };
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }


  /** Rebuild the ground window round (x, z). */
  private rebuild(x: number, z: number): void {
    const t = this.terrain;
    const n = this.winN;
    const x0 = Math.round(x / GRASS.texel) * GRASS.texel - (n / 2) * GRASS.texel;
    const z0 = Math.round(z / GRASS.texel) * GRASS.texel - (n / 2) * GRASS.texel;
    const g = t.meta.ground;
    fillGrassWindow(this.winData, n, x0, z0, GRASS.texel, { h: t.h, grid: t.meta.grid, ground: t.ground, gcell: g.cell, gcols: g.cols, grows: g.rows, E0, N0 }, this.opts.walks ?? []);
    this.win.needsUpdate = true;
    (this.uniforms.uGWin.value as THREE.Vector3).set(x0, z0, GRASS.texel);
    this.winAt.set(x, z);
    this.epoch = t.epoch;
  }

  /** Per frame. */
  update(camera: THREE.Camera): void {
    const p = camera.position;
    const gh = this.terrain.sample(p.x, p.z);
    const on = this.enabled && !this.indoor && Number.isFinite(gh) && p.y - gh < GRASS.radius * 0.85;
    this.mesh.visible = on;
    if (!on) return;
    if (Math.hypot(p.x - this.winAt.x, p.z - this.winAt.y) > GRASS.recentre || this.epoch !== this.terrain.epoch) this.rebuild(p.x, p.z);
    (this.uniforms.uSnap.value as THREE.Vector2).set(Math.round(p.x / GRASS.spacing), Math.round(p.z / GRASS.spacing));
    (this.uniforms.uGCam.value as THREE.Vector3).copy(p);
  }

  stats(): { instances: number; visible: boolean } {
    return { instances: (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount, visible: this.mesh.visible };
  }
}

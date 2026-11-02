/**
 * KB-I48 Festbeleuchtung: the light levels of the illumination lamps (pure: no three.js, no DOM; tests in
 * viewer/tests/festival.test.ts). Placement is `model/src/layout/festival.ts`; the three.js side is festival.ts.
 *
 * Light model [I]: a lampion (a small glass with an oil or tallow wick) ≈ one candle, ≈ 1 cd (look-and-period §5:
 * candles ≈ 13 lm); a pot-à-feu (an open fire pot of pitch or tallow on a post) ≈ a dozen candles. No point lights:
 * each lamp is a glowing point (minimum size on screen, energy kept for small ones) plus an additive pool on the wall
 * or ground next to it, so thousands cost a few draw calls.
 */

export type FestKind = 'lampion' | 'pot';

/** Luminous intensity (cd) per kind [I]. */
export const FEST_CD: Record<FestKind, number> = { lampion: 1, pot: 12 };

/** Diameter (m) of the glowing core drawn for one lamp (glass + flame glare) [I]. */
export const FEST_GLOW_M: Record<FestKind, number> = { lampion: 0.2, pot: 0.55 };

/** Minimum drawn size of a lamp on screen (px): a lit line of lampions stays a line of points from the air. */
export const FEST_MIN_PX = 2.6;

/** Share of a lamp's energy kept when it is drawn larger than its projected size (floor, so far lamps stay visible). */
export const FEST_FAR_FLOOR = 0.35;

/**
 * Luminance of the glowing core (cd/m²) per cd of intensity [I]: 1 cd through a 7 cm glass ≈ 260 cd/m² over its
 * projected area; the drawn core is larger (glare), so less.
 */
export const FEST_CORE_NITS = 60;

/** Display cap of the core before tone mapping: well above the night bloom threshold (0.95), below BLOOM_CLAMP. */
export const FEST_CORE_MAX = 5;

/** Pool diameter (m) on the surface next to the lamp per kind [I]. */
export const FEST_POOL_M: Record<FestKind, number> = { lampion: 1.8, pot: 7 };

/** Albedo assumed for the pool (limewash, sand) [I]. */
export const FEST_POOL_ALBEDO = 0.6;

/** Distance (m) at which the pool's centre illuminance is taken (the lamp's height above / offset from the surface). */
export const FEST_POOL_DIST: Record<FestKind, number> = { lampion: 0.35, pot: 1.4 };

/** Display cap of a pool centre: a warm wash, never a white patch [I]. */
export const FEST_POOL_MAX = 0.9;

/**
 * Display level of a lamp's core (multiplier on a luminance-1 colour): nits × pre-exposure × the fade-in, capped.
 * `on` is the festival factor 0…1 (toggle × darkness).
 */
export function festCoreLevel(kind: FestKind, pre: number, on: number): number {
  return Math.min(FEST_CD[kind] * FEST_CORE_NITS * pre, FEST_CORE_MAX) * Math.max(0, Math.min(1, on));
}

/**
 * Display level at the centre of a lamp's pool: E = I / d² (lux), L = E · ρ / π (cd/m²), × pre-exposure, capped.
 */
export function festPoolLevel(kind: FestKind, pre: number, on: number): number {
  const d = FEST_POOL_DIST[kind];
  const L = ((FEST_CD[kind] / (d * d)) * FEST_POOL_ALBEDO) / Math.PI;
  return Math.min(L * pre, FEST_POOL_MAX) * Math.max(0, Math.min(1, on));
}

/**
 * Drawn point size (px) and the energy factor for a lamp of world diameter `m` at view depth `depth` (m), with
 * `scale` = drawing-buffer height / (2 tan(fov / 2)). Mirrors the vertex shader in festival.ts.
 */
export function festPointSize(m: number, depth: number, scale: number): { px: number; k: number } {
  const proj = (m * scale) / Math.max(depth, 1e-3);
  const px = Math.max(proj, FEST_MIN_PX);
  return { px, k: Math.max(FEST_FAR_FLOOR, Math.min(1, (proj * proj) / (px * px))) };
}

/**
 * Festival factor over the sun's elevation: the lamps are lit from dusk (fully below −4°, none above +1°), like the
 * lit windows; × the toggle.
 */
export function festivalOn(enabled: boolean, elDeg: number): number {
  if (!enabled) return 0;
  const t = Math.max(0, Math.min(1, (1 - elDeg) / 5));
  return t * t * (3 - 2 * t);
}

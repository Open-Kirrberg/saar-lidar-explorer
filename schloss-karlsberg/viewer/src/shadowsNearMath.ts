/**
 * KB-I99 near sun shadow map: depth bias in metres, pure (no three.js; tests in viewer/tests/shadowsNear.test.ts).
 *
 * three's `shadow.bias` is added to the light-space depth, which for the sun's orthographic shadow camera is linear over
 * `far − near`. The near map (main.ts `updateShadowFrustum`) spans near 100 … far 3000 m, so the former fixed bias of
 * −0.0004 moved every receiver 1.16 m toward the sun before the depth test: under the Festsaal balcony (pose 66, 15) the
 * render within ≈ 1.2 m of the slab along the sun ray stayed lit, the shadow began 0.4 m below the brackets as a band,
 * and where the PCF taps straddled the 1.16 m threshold it broke into per-pixel noise (the Vogel disk is rotated by
 * interleaved gradient noise). The bias is now set in metres, as a few shadow texels (the depth step a texel can hide on
 * a sloped receiver; slopes beyond that are the normal bias' job), and converted to depth units for the camera's range.
 */

export const NEAR_SHADOW = {
  /** Depth bias in texels of the near map (world size 2 · ext / mapSize) [I]. */
  biasTexels: 2,
  /** Smallest depth bias (m), for walk mode's 120 m map (texel ≈ 3 cm) [I: the wall plaster's relief]. */
  minBiasM: 0.05,
} as const;

/** World size (m) of one texel of the near map: half-extent `ext` (m), `mapSize` texels per side. */
export function nearTexel(ext: number, mapSize: number): number {
  return (2 * ext) / Math.max(1, mapSize);
}

/** Depth bias in metres for the near map (≥ `minBiasM`, `biasTexels` texels). */
export function nearBiasMetres(ext: number, mapSize: number): number {
  return Math.max(NEAR_SHADOW.minBiasM, NEAR_SHADOW.biasTexels * nearTexel(ext, mapSize));
}

/**
 * three's `shadow.bias` (negative: toward the light) for the near map of half-extent `ext`, `mapSize` texels, and an
 * orthographic shadow camera from `near` to `far` (m).
 */
export function nearShadowBias(ext: number, mapSize: number, near: number, far: number): number {
  const range = Math.max(1e-3, far - near);
  return -nearBiasMetres(ext, mapSize) / range;
}

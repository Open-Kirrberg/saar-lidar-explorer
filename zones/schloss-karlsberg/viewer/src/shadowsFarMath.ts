/**
 * KB-I50 static far shadow map, pure part (no three.js, no DOM; tests in viewer/tests/shadowsFar.test.ts).
 *
 * The near map (main.ts `updateShadowFrustum`, KB-I04) covers 120–700 m ahead of the camera, so aerial views (poses 01,
 * 08, 12) lost the palace's and the trees' shadows beyond it. A second map, fixed over the whole residence and drawn
 * again only when the sun moves (hour) or the casters change (display toggles), supplies the sun's visibility outside
 * the near map; inside, the near map fades out over its outer `FAR_SHADOW.fade` and the far map takes over. Because
 * the far frustum never moves with the camera there is no swimming in flight, and it costs no redraw per frame.
 * Cheaper than cascades (one extra map, no per-frame renders; visual-audit §5.5 P19 "prefer a static far map").
 */

export const FAR_SHADOW = {
  /** Padding (m) around the box of the placed buildings. */
  pad: 220,
  /** Never smaller than this half-extent (m). */
  minHalf: 600,
  /** Map size per quality preset (texels per side). */
  mapSize: 4096,
  /** Share of the near map's half-width over which it fades into the far map. */
  fade: 0.12,
  /** Depth bias, normal bias (m) and PCF radius of the far map (texels ≈ 0.6 m). */
  bias: -0.0006,
  normalBias: 1.4,
  radius: 1.6,
  /** A sun change smaller than `maxStaleDeg` redraws the map once it has held for `settleFrames` frames (hour drag). */
  settleFrames: 6,
  maxStaleDeg: 2,
} as const;

export interface FarBox {
  /** Centre (local x, z) and half-extent (m) of the square the far map covers. */
  cx: number;
  cz: number;
  half: number;
}

/** Square box over the given local (x, z) points, padded; deterministic. */
export function farShadowBox(points: readonly (readonly [number, number])[], pad = FAR_SHADOW.pad, minHalf = FAR_SHADOW.minHalf): FarBox {
  if (!points.length) return { cx: 0, cz: 0, half: minHalf };
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, half: Math.max(minHalf, Math.max(x1 - x0, z1 - z0) / 2 + pad) };
}

/**
 * Light-space half-extents of the far map for a box and a sun with vertical direction component `sunY` (= sin el): the
 * camera looks along the sun with world up as its up vector, so its x axis runs across the sun's azimuth (the box
 * diagonal covers any azimuth) and its y axis sees the ground along the azimuth foreshortened by sin(el), plus the
 * relief (`relief` m from the lowest ground to the highest caster top) × cos(el). At low sun this keeps the texels on
 * the ground near-square instead of 1/sin(el) times longer along the shadows.
 */
export function farLightExtent(box: FarBox, sunY: number, relief = 140): { halfX: number; halfY: number } {
  const s = Math.max(0.03, Math.min(1, sunY));
  const c = Math.sqrt(1 - s * s);
  const diag = box.half * Math.SQRT2;
  return { halfX: diag, halfY: Math.min(diag, diag * s + 0.5 * relief * c) };
}

/** Ground texel size (m) of the far map across and along the sun's azimuth. */
export function farTexel(ext: { halfX: number; halfY: number }, sunY: number, size: number = FAR_SHADOW.mapSize): { across: number; along: number } {
  const s = Math.max(0.03, Math.min(1, sunY));
  return { across: (2 * ext.halfX) / size, along: (2 * ext.halfY) / size / s };
}

/**
 * Weight of the near map at a shadow coordinate (0…1 in x and y inside its frustum): 1 well inside, fading to 0 over
 * the outer `fade` of the half-width, 0 outside. GLSL twin in shadowsFar.ts.
 */
export function nearWeight(u: number, v: number, fade: number = FAR_SHADOW.fade): number {
  const e = Math.min(u, 1 - u, v, 1 - v);
  const t = Math.max(0, Math.min(1, e / (0.5 * fade)));
  return t * t * (3 - 2 * t);
}

/**
 * Redraw the far map this frame? `frames` = frames since the last sun or caster change, `angleDeg` = angle between the
 * sun direction the map was drawn for and the current one, `drawn` = a map exists. Never drawn: now. A jump of more
 * than `maxStaleDeg` (a POI with its own hour, a Rundflug cut): now. Otherwise once the change has held for
 * `settleFrames` frames, so dragging the hour slider does not redraw a 4096² map every frame.
 */
export function farRedrawDue(frames: number, angleDeg: number, drawn: boolean): boolean {
  if (!drawn) return true;
  if (angleDeg > FAR_SHADOW.maxStaleDeg) return true;
  return frames >= FAR_SHADOW.settleFrames;
}

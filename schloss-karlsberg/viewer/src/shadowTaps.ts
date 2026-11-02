/**
 * Cheaper PCF shadow taps (KB-I59), pure: three r187's `PCFShadowMap` takes 5 hardware-filtered taps on a Vogel disk
 * rotated per pixel by interleaved gradient noise, and evaluates `vogelDiskSample(k, 5, phi)` per tap: a sqrt, a cos
 * and a sin each, so 5 sin + 5 cos per shaded pixel and light. The rotation by `phi` is the same for all taps, so the
 * five unrotated offsets are constants and one cos / sin pair rotates them: the same samples (to float rounding) at a
 * fifth of the transcendental cost. Same-session A/B at 3024 × 1964 on the aerial poses: −0.6…−0.9 ms, pixel-identical
 * shots.
 */

/** The golden angle three's `vogelDiskSample` uses. */
export const GOLDEN_ANGLE = 2.399963229728653;

/** Unrotated Vogel disk offsets (phi = 0) for `n` samples, as three's `vogelDiskSample(k, n, 0)`. */
export function vogelDiskOffsets(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt((k + 0.5) / n);
    out.push([Math.cos(k * GOLDEN_ANGLE) * r, Math.sin(k * GOLDEN_ANGLE) * r]);
  }
  return out;
}

/** The 5-tap sum in three r187's `shadowmap_pars_fragment` (2D PCF), verbatim. */
export const PCF5_SOURCE = `				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;`;

const f = (v: number) => (Object.is(v, -0) ? 0 : v).toFixed(9);

/** The same sum with constant offsets and one rotation (GLSL). */
export function pcf5Rotated(): string {
  const taps = vogelDiskOffsets(5).map(
    ([x, y]) => `					texture( shadowMap, vec3( shadowCoord.xy + pcfRot * vec2( ${f(x)}, ${f(y)} ) * radius, shadowCoord.z ) )`,
  );
  return `				// KB-I59: three's Vogel taps with one cos / sin pair (offsets constant, rotated by phi)
				mat2 pcfRot = mat2( cos( phi ), sin( phi ), - sin( phi ), cos( phi ) );
				shadow = (
${taps.join(' +\n')}
				) * 0.2;`;
}

/** Patch three's `shadowmap_pars_fragment` chunk text; throws if the r187 source moved. */
export function patchShadowChunk(chunk: string): string {
  if (chunk.includes('pcfRot')) return chunk;
  if (!chunk.includes(PCF5_SOURCE)) throw new Error('[shadowTaps] three PCF 5-tap source not found (three version changed?)');
  return chunk.replace(PCF5_SOURCE, pcf5Rotated());
}

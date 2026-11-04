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

/**
 * The point-light (cube) PCF block of three r187 as in its build (blank lines stripped): five Vogel taps rotated per
 * pixel, one `vogelDiskSample` (sqrt, cos, sin) per tap. Wave-11 review fix: the candle pool's shadow light
 * (candleLight.ts) is the only point light that casts. Its five cube-compare taps cost ≈ 0.3 ms at 1080p and ≈ 0.9 ms
 * at 3024 × 1964 in the Festsaal (pose 07) whatever the radius, so a light with `shadow.radius` 0 (a single flame:
 * a 1 cm flame throws a near-hard shadow) takes one hardware-filtered tap; a cluster (radius > 0) keeps five, with
 * constant offsets and one cos / sin pair (as KB-I59 for the sun).
 */
export const POINT_PCF5_SOURCE = `			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			shadow = 0.0;
			for ( int i = 0; i < 5; i ++ ) {
				vec2 offset = vogelDiskSample( i, 5, phi );
				vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
				vec3 absDirection = abs( direction );
				float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
				shadow += texture( shadowMap, vec4( direction, dp ) );
			}
			shadow *= 0.2;`;

/** The point block: one tap for radius 0, else five with one rotation (GLSL). */
export function pointPcf5Rotated(): string {
  const taps = vogelDiskOffsets(5).map(([x, y]) => `vec2( ${f(x)}, ${f(y)} )`);
  return `			// wave-11 review fix (shadowTaps.ts): radius 0 = one hardware-filtered tap; else five, one cos / sin pair
			if ( shadowRadius <= 0.0 ) {
				vec3 absDir0 = abs( bd3D );
				shadow = texture( shadowMap, vec4( bd3D, depthA + depthB / max( max( absDir0.x, absDir0.y ), absDir0.z ) ) );
			} else {
				float texelSize = shadowRadius / shadowMapSize.x;
				vec3 absDir = abs( bd3D );
				vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
				tangent = normalize( cross( bd3D, tangent ) );
				vec3 bitangent = cross( bd3D, tangent );
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				mat2 pcfPRot = mat2( cos( phi ), sin( phi ), - sin( phi ), cos( phi ) );
				vec2 skbVogel5[ 5 ] = vec2[ 5 ]( ${taps.join(', ')} );
				shadow = 0.0;
				for ( int i = 0; i < 5; i ++ ) {
					vec2 offset = pcfPRot * skbVogel5[ i ];
					vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
					vec3 absDirection = abs( direction );
					float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
					shadow += texture( shadowMap, vec4( direction, dp ) );
				}
				shadow *= 0.2;
			}`;
}

/** Patch three's `shadowmap_pars_fragment` chunk text (directional and point PCF); throws if the r187 source moved. */
export function patchShadowChunk(chunk: string): string {
  let out = chunk;
  if (!out.includes('pcfRot')) {
    if (!out.includes(PCF5_SOURCE)) throw new Error('[shadowTaps] three PCF 5-tap source not found (three version changed?)');
    out = out.replace(PCF5_SOURCE, pcf5Rotated());
  }
  if (!out.includes('pcfPRot')) {
    if (!out.includes(POINT_PCF5_SOURCE)) throw new Error('[shadowTaps] three point PCF loop not found (three version changed?)');
    out = out.replace(POINT_PCF5_SOURCE, pointPcf5Rotated());
  }
  return out;
}

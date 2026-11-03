/**
 * Fair-weather cumulus and their shadows (audit wave 9, rank 7: "the sky is the weakest large surface"; the same
 * stretched streak in every eye-level shot, no cloud volumes, no light-and-shade rhythm on the meadows from the air).
 *
 * Model [N: a July high-pressure day over the Saar–Palatinate upland; the weather of 15 Jul 1789 is U]: cumulus
 * humilis / mediocris, ≈ 1–2/8 cover, bases at the condensation level ≈ 1.4 km above the plateau, tops up to ≈ 0.8 km
 * higher, cells 0.5–1.5 km across. They form with the morning thermals (none before 08:00, full by 10:30) and thin out
 * in the evening (≈ 2/3 at the 19:12 golden hour, gone by 21:00), so night skies stay clear for the stars [N].
 *
 * One coverage field drives both the sky and the shadows, so every cloud shadow on the land belongs to a cloud:
 * - `cloudTop(g)`: a two-octave value noise thresholded to the cover, in *shadow-ground* coordinates g (the point of
 *   the plateau a cloud shades); the residence keeps a sunny clearing (CLOUD.clear), so the documented façades of
 *   every standard pose stay in sun [I, art direction: a photographer waits for the sun];
 * - the sky (atmosphere.ts `patchSky`) marches the slab [base, base + thickness] from the residence, reading the field
 *   at g = p.xz − offset, where offset = (mid height − ground) · sun.xz / sun.y moves the field with the sun so a
 *   cloud's shadow falls where the field says, whatever the hour;
 * - the shadow (shadowsFar.ts, every lit material through `lights_fragment_begin`) reads the field at
 *   g = w.xz − (w.y − ground) · sun.xz / sun.y for the shaded point w.
 * The sky is cached in the KB-I65 sky cube (re-shaded only when the hour changes). The shadow reads the coverage noise
 * from a baked texture (`cloudGrid`, CLOUD_TEX: 512², 48 m texels over 24 km round the clearing, computed once
 * from the same `cloudNoise`): one texture fetch per lit pixel instead of two value-noise octaves (wave-10 bench: the
 * procedural lookup cost ≈ 0.75 ms at retina on the aerials).
 *
 * Pure: no three.js, no DOM (the GLSL is a string; `cloudTop` mirrors it for the tests).
 */
import { clamp, smoothstep } from '@model/layout/geom.ts';

export const CLOUD = {
  /** base of the cloud layer above the plateau (m) */
  base: 1400,
  /** largest cloud depth (m) */
  thickness: 800,
  /** horizontal scale of the coarse octave (m) */
  scale: 1300,
  /** threshold of the coverage noise for ≈ 1–2/8 cover (tests: 12–25 % of the open plateau in shade at full amount) */
  threshold: 0.64,
  /** softness of the cloud edge in noise units */
  soft: 0.12,
  /** how much direct sun a full cloud shadow removes [I: a cumulus 300–900 m deep transmits ≈ 10–25 % as diffuse light] */
  shadow: 0.8,
  /** sunny clearing round the residence: full sun within r0, full cover from r1 (m) */
  clear: { r0: 450, r1: 800 },
  /**
   * Offset of the coverage field (m), chosen once so that no standard pose stands in a cloud shadow at its hour
   * (viewer/tests/clouds.test.ts "standard poses in sun"); the clouds stay where weather would put them, only the
   * field's phase is picked [I].
   */
  seed: [-6254, 1013] as readonly [number, number],
  /** plateau height (m, DHHN2016) the field and the shadows are referred to */
  ground: 345,
  /** lowest sun height used for the parallax offset (deg): below it the offset stops growing */
  minSunDeg: 8,
  /**
   * Wave-10 review fix (eye-level shape): coverage margin (noise − threshold) at which a column reaches the full
   * thickness; the top is thickness · √(margin / dome), a dome over the footprint [I, art direction from photographs
   * of cumulus mediocris: flat bases, rounded tops, no overhangs].
   */
  dome: 0.6,
  /** amplitude (m) of the 3D billows that roughen the dome's surface (tops and sides; the base stays flat) */
  erode: 110,
  /**
   * wavelengths (m, horizontal) of the three billow octaves; vertically they are `billowStretch` times longer, so the
   * surface leans in by less than its height (no overhangs)
   */
  billow: [240, 95, 40] as readonly [number, number, number],
  billowStretch: 3,
} as const;

/**
 * The "Wolken" setting (wave-10 review fix): 'air' (default) shows the cumulus only from the air and in the Rundflug
 * shots that ask for them, 'on' always, 'off' never. At eye level the clouds are the most conspicuous hypothesis in
 * the frame (the weather of 15 Jul 1789 is U), so the documentary default keeps the ground views cloudless.
 */
export type CloudMode = 'off' | 'air' | 'on';
/** Height above the ground (m) at which 'air' shows the clouds, and below which it hides them again (hysteresis). */
export const CLOUD_ALOFT = { on: 80, off: 60 } as const;

/** Normalise a set value (`skb.set('clouds', true)` of older poses = 'on', false = 'off'). */
export function cloudMode(v: unknown): CloudMode {
  if (v === true || v === 'on') return 'on';
  if (v === false || v === 'off') return 'off';
  return 'air';
}

/** Whether the camera counts as aloft: above CLOUD_ALOFT.on, until it sinks below CLOUD_ALOFT.off; never when walking. */
export function cloudAloft(prev: boolean, agl: number, walking: boolean): boolean {
  if (walking) return false;
  return prev ? agl > CLOUD_ALOFT.off : agl > CLOUD_ALOFT.on;
}

/** Whether the cumulus show for a mode; `aloft` = from the air (or a tour shot that asks for them). */
export function cloudsShown(mode: CloudMode, aloft: boolean): boolean {
  return mode === 'on' || (mode === 'air' && aloft);
}

/** Cloud cover over the day (0…1) [N]: thermals from 08:00, full 10:30–18:00, ≈ 2/3 at 19:12, gone by 21:00. */
export function cumulusAmount(hour: number): number {
  const morning = smoothstep(8, 10.5, hour);
  const evening = 1 - smoothstep(18, 21, hour);
  return Math.min(morning, evening);
}

/**
 * Same hash as the GLSL (`skbCloudHash`): an integer hash of the lattice point (xxHash-style multiply / xor-shift on
 * 32-bit unsigned integers), exact in both float32 GLSL and double JS, so the tests see the field the GPU draws (a
 * float `fract` hash differed between the two by enough to move whole clouds).
 */
export function cloudHash(x: number, y: number): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = cloudHash(ix, iy);
  const b = cloudHash(ix + 1, iy);
  const c = cloudHash(ix, iy + 1);
  const d = cloudHash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Coverage noise in [0, 1] at shadow-ground coordinates (local x, z in m). */
export function cloudNoise(gx: number, gz: number, seed: readonly [number, number] = CLOUD.seed): number {
  const x = (gx + seed[0]) / CLOUD.scale;
  const z = (gz + seed[1]) / CLOUD.scale;
  return 0.62 * valueNoise(x, z) + 0.38 * valueNoise(x * 2.31 + 17, z * 2.31 + 17);
}

/** Cloud depth fraction (0…1) at g, for cover `amount` (0…1) and the clearing centre (cx, cz). */
export function cloudTop(gx: number, gz: number, amount: number, cx: number, cz: number): number {
  if (amount <= 0) return 0;
  // less cover raises the threshold (fewer, smaller clouds), not a thinner layer
  const th = 1 - (1 - CLOUD.threshold) * amount;
  const c = clamp((cloudNoise(gx, gz) - th) / CLOUD.soft, 0, 1);
  return c * smoothstep(CLOUD.clear.r0, CLOUD.clear.r1, Math.hypot(gx - cx, gz - cz));
}

/**
 * Column top above the cloud base (m) at g for cover `amount`, < 0 outside a cloud (mirrors GLSL `skbCloudColumn`):
 * thickness · √(margin / dome) with margin = (noise − threshold) · clearing. Same footprint as `cloudTop` > 0.
 */
export function cloudColumn(gx: number, gz: number, amount: number, cx: number, cz: number): number {
  if (amount <= 0) return -1;
  const th = 1 - (1 - CLOUD.threshold) * amount;
  const m = (cloudNoise(gx, gz) - th) * smoothstep(CLOUD.clear.r0, CLOUD.clear.r1, Math.hypot(gx - cx, gz - cz));
  if (m <= 0) return -1;
  return CLOUD.thickness * Math.sqrt(Math.min(m / CLOUD.dome, 1));
}

/** Parallax offset (m) of the field for a unit vector toward the sun (local frame). */
export function cloudOffset(sun: readonly [number, number, number]): [number, number] {
  const sy = Math.max(sun[1], Math.sin((CLOUD.minSunDeg * Math.PI) / 180));
  const h = CLOUD.base + CLOUD.thickness / 2;
  return [(h * sun[0]) / sy, (h * sun[2]) / sy];
}

/** Baked coverage field for the shadows: texels per side and the side length (m), centred on the clearing. */
export const CLOUD_TEX = { size: 512, extent: 24576 } as const;

/**
 * The shadows' lookup texture (RG, 0…255) on a CLOUD_TEX grid centred on the clearing (cx, cz): R = the coverage noise
 * (`cloudNoise`) at the texel centres, G = the clearing (`CLOUD.clear`, 0 at the residence … 1) times a fade over the
 * outer tenth of the grid (beyond it the haze rules). Row j runs along +z, column i along +x (texture u = x, v = z);
 * the shader's bilinear lookup of it stands for `cloudTop`'s two factors.
 */
export function cloudGrid(cx: number, cz: number, size: number = CLOUD_TEX.size, extent: number = CLOUD_TEX.extent): Uint8Array {
  const out = new Uint8Array(size * size * 2);
  const step = extent / size;
  const x0 = cx - extent / 2 + step / 2;
  const z0 = cz - extent / 2 + step / 2;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      const edge = smoothstep(0, 0.1, Math.min(u, 1 - u, v, 1 - v));
      const k = (j * size + i) * 2;
      out[k] = Math.round(clamp(cloudNoise(x, z), 0, 1) * 255);
      out[k + 1] = Math.round(edge * smoothstep(CLOUD.clear.r0, CLOUD.clear.r1, Math.hypot(x - cx, z - cz)) * 255);
    }
  return out;
}

/**
 * The shared uniform block `uCloud[20]` (one Float32Array, by reference in every material, as the fog's `uFog`):
 * 0 amount (0 = off), 1–2 offset x / z, 3 shadow strength, 4 base y, 5 thickness, 6–7 clearing centre x / z,
 * 8–9 clearing r0 / r1, 10 view origin y (the sky is marched from the residence), 11 ground y; for the shadows:
 * 12–13 the texture's corner x / z, 14 its 1 / extent, 15–16 sun.xz / sun.y (parallax per metre of height),
 * 17–18 the cover ramp c = clamp(n · [17] + [18]) for the amount, 19 unused.
 */
export const cloudData = new Float32Array(20);

/** Fill `cloudData` for an hour and a sun direction; `on` = the UI's "Wolken" switch. Returns the amount. */
export function setClouds(on: boolean, hour: number, sun: readonly [number, number, number], centre: [number, number]): number {
  const amount = on && sun[1] > 0 ? cumulusAmount(hour) : 0;
  const off = cloudOffset(sun);
  const sy = Math.max(sun[1], Math.sin((CLOUD.minSunDeg * Math.PI) / 180));
  const th = 1 - (1 - CLOUD.threshold) * amount;
  cloudData.set([
    amount, off[0], off[1], CLOUD.shadow, CLOUD.ground + CLOUD.base, CLOUD.thickness, centre[0], centre[1], CLOUD.clear.r0, CLOUD.clear.r1, CLOUD.ground + 5, CLOUD.ground,
    centre[0] - CLOUD_TEX.extent / 2, centre[1] - CLOUD_TEX.extent / 2, 1 / CLOUD_TEX.extent, sun[0] / sy, sun[2] / sy, 1 / CLOUD.soft, -th / CLOUD.soft, 0,
  ]);
  return amount;
}

/** GLSL: the coverage field (mirrors `cloudTop`). Guarded, so it can sit in a chunk included more than once. */
export const CLOUD_PARS_GLSL = /* glsl */ `
#ifndef SKB_CLOUD_PARS
#define SKB_CLOUD_PARS
uniform float uCloud[ 20 ];
float skbCloudHash( vec2 p ) {
	uint n = uint( int( p.x ) ) * 374761393u + uint( int( p.y ) ) * 668265263u;
	n = ( n ^ ( n >> 13u ) ) * 1274126177u;
	n = n ^ ( n >> 16u );
	return float( n ) * ( 1.0 / 4294967296.0 );
}
float skbCloudVNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = skbCloudHash( i );
	float b = skbCloudHash( i + vec2( 1.0, 0.0 ) );
	float c = skbCloudHash( i + vec2( 0.0, 1.0 ) );
	float d = skbCloudHash( i + vec2( 1.0, 1.0 ) );
	return a + ( b - a ) * u.x + ( c - a ) * u.y + ( a - b - c + d ) * u.x * u.y;
}
// cover (0…1) from the coverage noise n at g: threshold by the amount, the residence's clearing
float skbCloudCover( float n, vec2 g ) {
	float th = 1.0 - ${(1 - CLOUD.threshold).toFixed(4)} * uCloud[ 0 ];
	float c = clamp( ( n - th ) * ${(1 / CLOUD.soft).toFixed(4)}, 0.0, 1.0 );
	return c * smoothstep( uCloud[ 8 ], uCloud[ 9 ], length( g - vec2( uCloud[ 6 ], uCloud[ 7 ] ) ) );
}
float skbCloudTop( vec2 g ) {
	// the coarse octave alone decides most cloud-free samples (the fine one adds at most 0.38): skip the second
	vec2 q = ( g + vec2( ${CLOUD.seed[0].toFixed(1)}, ${CLOUD.seed[1].toFixed(1)} ) ) * ${(1 / CLOUD.scale).toExponential(6)};
	float n1 = 0.62 * skbCloudVNoise( q );
	if ( n1 + 0.38 <= 1.0 - ${(1 - CLOUD.threshold).toFixed(4)} * uCloud[ 0 ] ) return 0.0;
	return skbCloudCover( n1 + 0.38 * skbCloudVNoise( q * 2.31 + 17.0 ), g );
}
// sky only (wave-10 review fix): the column top above the base (m) at g, < 0 = no cloud. The top follows the square
// root of the coverage margin, so a cloud is a dome (rounded where the margin peaks, a steep shoulder at its rim) and
// never a flat-topped prism or a tent; the residence's clearing shrinks the clouds toward it (cloudColumn mirrors it)
float skbCloudColumn( vec2 g ) {
	vec2 q = ( g + vec2( ${CLOUD.seed[0].toFixed(1)}, ${CLOUD.seed[1].toFixed(1)} ) ) * ${(1 / CLOUD.scale).toExponential(6)};
	float th = 1.0 - ${(1 - CLOUD.threshold).toFixed(4)} * uCloud[ 0 ];
	float n1 = 0.62 * skbCloudVNoise( q );
	if ( n1 + 0.38 <= th ) return -1.0;
	float m = ( n1 + 0.38 * skbCloudVNoise( q * 2.31 + 17.0 ) - th ) * smoothstep( uCloud[ 8 ], uCloud[ 9 ], length( g - vec2( uCloud[ 6 ], uCloud[ 7 ] ) ) );
	if ( m <= 0.0 ) return -1.0;
	return uCloud[ 5 ] * sqrt( min( m * ${(1 / CLOUD.dome).toFixed(4)}, 1.0 ) );
}
float skbCloudHash3( vec3 p ) {
	uint n = uint( int( p.x ) ) * 374761393u + uint( int( p.y ) ) * 668265263u + uint( int( p.z ) ) * 2246822519u;
	n = ( n ^ ( n >> 13u ) ) * 1274126177u;
	n = n ^ ( n >> 16u );
	return float( n ) * ( 1.0 / 4294967296.0 );
}
float skbCloudVNoise3( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 u = f * f * ( 3.0 - 2.0 * f );
	float a = mix( skbCloudHash3( i ), skbCloudHash3( i + vec3( 1.0, 0.0, 0.0 ) ), u.x );
	float b = mix( skbCloudHash3( i + vec3( 0.0, 1.0, 0.0 ) ), skbCloudHash3( i + vec3( 1.0, 1.0, 0.0 ) ), u.x );
	float c = mix( skbCloudHash3( i + vec3( 0.0, 0.0, 1.0 ) ), skbCloudHash3( i + vec3( 1.0, 0.0, 1.0 ) ), u.x );
	float d = mix( skbCloudHash3( i + vec3( 0.0, 1.0, 1.0 ) ), skbCloudHash3( i + vec3( 1.0, 1.0, 1.0 ) ), u.x );
	return mix( mix( a, b, u.y ), mix( c, d, u.y ), u.z );
}
// sky only: the billows (m, about ±CLOUD.erode): three octaves of 3D noise that push the dome's surface in and out, so
// the tops turn to cauliflower and the sides lose the vertical extrusion of a 2D field
float skbCloudBillow( vec3 p ) {
	vec3 q = p * vec3( 1.0, ${(1 / CLOUD.billowStretch).toFixed(4)}, 1.0 );
	float n = 0.58 * skbCloudVNoise3( q * ${(1 / CLOUD.billow[0]).toExponential(6)} ) + 0.28 * skbCloudVNoise3( q * ${(1 / CLOUD.billow[1]).toExponential(6)} + 7.0 ) + 0.14 * skbCloudVNoise3( q * ${(1 / CLOUD.billow[2]).toExponential(6)} + 13.0 );
	return ${(2 * CLOUD.erode).toFixed(1)} * ( n - 0.5 );
}
#endif
`;

/**
 * GLSL for lit materials: the share of the direct sun reaching world point w (1 = no cloud), from the baked texture
 * `uCloudTex` (`cloudGrid`): one fetch and a few multiply-adds per pixel; the sun's parallax and the cover ramp come
 * precomputed in `uCloud` (15–18).
 */
export const CLOUD_SUN_PARS_GLSL = /* glsl */ `
#ifndef SKB_CLOUD_SUN
#define SKB_CLOUD_SUN
uniform sampler2D uCloudTex;
float skbCloudSun( vec3 w ) {
	if ( uCloud[ 0 ] <= 0.0 ) return 1.0;
	vec2 uv = ( w.xz - ( w.y - uCloud[ 11 ] ) * vec2( uCloud[ 15 ], uCloud[ 16 ] ) - vec2( uCloud[ 12 ], uCloud[ 13 ] ) ) * uCloud[ 14 ];
	vec2 t = texture2D( uCloudTex, uv ).rg;
	float c = clamp( t.r * uCloud[ 17 ] + uCloud[ 18 ], 0.0, 1.0 ) * t.g;
	return 1.0 - uCloud[ 3 ] * smoothstep( 0.0, 0.45, c );
}
#endif
`;

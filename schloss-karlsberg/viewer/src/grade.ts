/**
 * Display grade applied in every material's tone-mapping chunk (wave-5 review fix, experience):
 *
 * - **Night vision (scotopic / Purkinje shift).** Below about 0.1 cd/m² the rods take over: colour fades, reds darken
 *   and greens and blues lighten relative to them, and the dim scene reads grey-blue. Per pixel, from its absolute
 *   luminance Y (cd/m², the pre-exposed radiance divided by the pre-exposure): the scotopic luminance V after Larson,
 *   Rushmeier & Piatko 1997 ("A visibility matching tone reproduction operator for high dynamic range scenes", IEEE
 *   TVCG 3(4), https://doi.org/10.1109/2945.646233), V = Y · (1.33 · (1 + (Y + Z) / X) − 1.68), normalised so a D65
 *   white keeps its luminance, tinted blue and blended in by σ(Y) = s · K / (K + Y), the blend of Krawczyk, Myszkowski
 *   & Seidel 2005 ("Perceptual effects in real-time tone mapping", SCCG, https://doi.org/10.1145/1090122.1090154),
 *   with a cooler tint than theirs. K and the tint are [I]. Candle flames, lit windows and the
 *   lantern panes are far brighter than K and keep their amber; moonlit grass and limewash go grey-blue.
 *   `s` is the night factor of the light state (0 above −2°, 1 below −6°), so day frames are unchanged.
 * - **Kino look.** An ASC CDL look inside three's AgX (at the `agxLook` hook Filament and Blender use), like Blender's
 *   "Punchy" look (power 1.35, saturation 1.4) but milder [I]: the AgX base is flat and grey for a fly-around
 *   (wave-5 review: the golden-hour shot read as grey-beige haze). Dokumentation (Neutral) is never graded.
 *
 * Uniform `uGrade[3]`: [strength, 1 / pre-exposure, K, 0], [slope rgb, look on], [power rgb, saturation]. One
 * Float32Array, shared by reference through every ShaderLib entry (like `uFog`), so one write drives all materials;
 * shaders without the uniform (custom ShaderMaterials) read zeros and stay ungraded.
 */
import * as THREE from 'three';

export type RGB = [number, number, number];

/** Luminance (cd/m²) at which the night vision is half scotopic [I; mesopic range ≈ 0.005–5 cd/m²]. */
export const SCOTOPIC_HALF_CD = 0.04;
/**
 * Blue tint of the scotopic image, normalised to luminance 1 [I]. Krawczyk et al.'s (1.05, 0.97, 1.27) has red above
 * green and read violet on the night aerial (pose 26); the moonlit blue-grey of night photography keeps green above red.
 */
export const SCOTOPIC_TINT: RGB = (() => {
  const t: RGB = [0.86, 0.98, 1.22];
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  return [t[0] / l, t[1] / l, t[2] / l];
})();
/** Larson's factor 1.33 · (1 + (Y + Z) / X) − 1.68 for a D65 white (X 0.9505, Y 1, Z 1.089): V(white) = this · Y. */
export const SCOTOPIC_WHITE = 1.33 * (1 + (1 + 1.089) / 0.9505) - 1.68;
/** Cap of V / Y (a saturated blue would otherwise brighten without bound). */
export const SCOTOPIC_MAX = 4;

/** Kino look in AgX (ASC CDL slope, power, saturation) [I, tuned on the Rundflug and poses 08, 14]. */
// wave-6 review (golden hour muddy olive): power 1.18 → 1.12 lifts the midtones, saturation 1.22 → 1.28
export const KINO_LOOK = { slope: [1.03, 1.0, 0.95] as RGB, power: [1.12, 1.12, 1.12] as RGB, sat: 1.28 };

/**
 * Kino look at the golden hour (wave-7 KB-I06: the Rundflug's 'Goldene Stunde' and 'Galerie' read olive and muddy):
 * lighter midtones, more saturation and a smaller warm slope (the low sun is warm already; the slope on top of it
 * turned the greens olive), so warm light on grass reads golden instead of brown [I, art direction].
 * `kinoLookAt(g)` blends KINO_LOOK toward it by the low-sun grade weight g (light.ts kinoLowSun).
 */
export const KINO_GOLDEN_LOOK = { slope: [1.01, 1.0, 0.96] as RGB, power: [1.04, 1.04, 1.06] as RGB, sat: 1.38 };
export function kinoLookAt(w: number): typeof KINO_LOOK {
  const t = Math.min(1, Math.max(0, w));
  const mix = (a: number, b: number) => a + (b - a) * t;
  const mix3 = (a: RGB, b: RGB): RGB => [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
  return { slope: mix3(KINO_LOOK.slope, KINO_GOLDEN_LOOK.slope), power: mix3(KINO_LOOK.power, KINO_GOLDEN_LOOK.power), sat: mix(KINO_LOOK.sat, KINO_GOLDEN_LOOK.sat) };
}

/**
 * Blue protection of the Kino slope [I, wave-6 review]: a pixel whose blue exceeds its red and green by 1/8 (in AgX's
 * display-referred space) keeps a neutral slope, so the warm shift does not turn the sky beige.
 */
export const KINO_BLUE_KEEP = 8;

/** CPU twin of the GLSL Kino look (AgX display-referred `v` in, graded out). */
export function kinoLook(v: RGB, look = KINO_LOOK): RGB {
  const bl = Math.min(1, Math.max(0, (v[2] - Math.max(v[0], v[1])) * KINO_BLUE_KEEP));
  const g = [0, 1, 2].map((i) => Math.max(0, v[i] * (look.slope[i] + (1 - look.slope[i]) * bl)) ** look.power[i]) as RGB;
  const l = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  return g.map((x) => l + look.sat * (x - l)) as RGB;
}

function xyz(c: RGB): RGB {
  return [
    0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2],
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2],
    0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2],
  ];
}

/** Scotopic luminance relative to the D65-normalised photopic one (V / Y / SCOTOPIC_WHITE), capped. */
export function scotopicRatio(c: RGB): number {
  const [X, Y, Z] = xyz(c);
  if (!(Y > 0)) return 0;
  const k = 1.33 * (1 + (Y + Z) / Math.max(X, 1e-6)) - 1.68;
  return Math.min(SCOTOPIC_MAX, Math.max(0, k / SCOTOPIC_WHITE));
}

/** Blend weight σ of the scotopic image for a pixel of luminance `cd` (cd/m²) at night strength `s` (0…1). */
export function scotopicWeight(cd: number, s: number, half = SCOTOPIC_HALF_CD): number {
  return Math.min(1, Math.max(0, s)) * (half / (half + Math.max(0, cd)));
}

/** CPU twin of the GLSL night vision: linear (pre-exposed) colour `c`, `invPre` = 1 / pre-exposure. */
export function nightVision(c: RGB, invPre: number, s: number): RGB {
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const w = scotopicWeight(Y * invPre, s);
  const V = Y * scotopicRatio(c);
  return [0, 1, 2].map((i) => c[i] + (V * SCOTOPIC_TINT[i] - c[i]) * w) as RGB;
}

/** The shared uniform block (see the header). */
export const gradeData = new Float32Array(12);
gradeData[2] = SCOTOPIC_HALF_CD;

/** Night vision strength (0 = off) and the pre-exposure that converts display values back to cd/m². */
export function setNightVision(strength: number, pre: number): void {
  gradeData[0] = Math.min(1, Math.max(0, strength));
  gradeData[1] = pre > 0 ? 1 / pre : 0;
}

/** Kino look on (AgX only; the GLSL hook sits inside AgXToneMapping) or off. */
export function setKinoLook(on: boolean, look = KINO_LOOK): void {
  gradeData.set([...look.slope, on ? 1 : 0, ...look.power, look.sat], 4);
}

const PARS = /* glsl */ `
uniform vec4 uGrade[ 3 ];
vec3 skbNightVision( vec3 c ) {
  float X = dot( c, vec3( 0.4124, 0.3576, 0.1805 ) );
  float Y = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float Z = dot( c, vec3( 0.0193, 0.1192, 0.9505 ) );
  float k = 1.33 * ( 1.0 + ( Y + Z ) / max( X, 1e-6 ) ) - 1.68;
  float V = Y * clamp( k / ${SCOTOPIC_WHITE.toFixed(5)}, 0.0, ${SCOTOPIC_MAX.toFixed(1)} );
  float w = uGrade[ 0 ].x * uGrade[ 0 ].z / ( uGrade[ 0 ].z + Y * uGrade[ 0 ].y );
  return mix( c, V * vec3( ${SCOTOPIC_TINT.map((v) => v.toFixed(5)).join(', ')} ), w );
}
vec3 skbAgxLook( vec3 v ) {
  // wave-6 review: the warm slope lands on warm and neutral pixels only; clear blues (sky, far hills) keep their hue
  float bl = clamp( ( v.b - max( v.r, v.g ) ) * ${KINO_BLUE_KEEP.toFixed(1)}, 0.0, 1.0 );
  v = pow( max( v * mix( uGrade[ 1 ].rgb, vec3( 1.0 ), bl ), vec3( 0.0 ) ), uGrade[ 2 ].rgb );
  float l = dot( v, vec3( 0.2126, 0.7152, 0.0722 ) );
  return l + uGrade[ 2 ].w * ( v - l );
}
`;

/** Patch three's tone-mapping chunks (once, before any material compiles) and register `uGrade` everywhere. */
export function installGrade(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  if (chunks.tonemapping_pars_fragment.includes('uGrade')) return;
  // the look goes right after AgX's sigmoid (three's "Apply AgX look" hook; comments are stripped in the build)
  const hook = 'color = agxDefaultContrastApprox( color );';
  if (chunks.tonemapping_pars_fragment.split(hook).length !== 2) throw new Error('[grade] AgX sigmoid call not found once in three');
  chunks.tonemapping_pars_fragment = PARS + chunks.tonemapping_pars_fragment.replace(hook, `${hook}\n\tif ( uGrade[ 1 ].w > 0.5 ) color = skbAgxLook( color );`);
  const tm = 'gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );';
  if (!chunks.tonemapping_fragment.includes(tm)) throw new Error('[grade] tone-mapping call missing in three');
  // inside `#if defined( TONE_MAPPING )`, where the pars (and uGrade) exist
  chunks.tonemapping_fragment = chunks.tonemapping_fragment.replace(tm, `if ( uGrade[ 0 ].x > 0.0 ) gl_FragColor.rgb = skbNightVision( gl_FragColor.rgb );\n\t${tm}`);
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, THREE.IUniform> }[]) lib.uniforms.uGrade = { value: gradeData };
}

/**
 * Sky, image-based light, sun, height fog and room light for the viewer (backlog KB-I06, KB-I07; visual-audit §5.2,
 * §5.4 level 1). The physical model and its evidence live in the pure modules light.ts, preetham.ts and fog.ts; this
 * file only wires them into three.js:
 *
 * - One sky radiance: the visible `Sky` and the environment twin share the Preetham uniforms, so reflections and the
 *   background agree in shape. The twin hides the sun disc (the directional light carries the sun), shows a ground of
 *   albedo ≈ 0.17 below the horizon, and is desaturated to a plausible clear-sky light colour (`ENV_SKY_SAT`); the
 *   visible sky is shown `SKY_VIEW_EV` brighter and whitens toward the horizon (wave-1 review: navy, teal cast).
 *   Wave-2 review fix (low-sun shade 15:1 / 29:1, olive shaded sand): the twin is blended toward its hemispherical
 *   mean (`envSkyIso`, a multiply-scattered hazy sky instead of the single-scattering aureole), normalised to the same
 *   sky lux, and its mean colour is moved onto the CIE daylight locus (`skylightColour`); the visible sky is unchanged.
 * - The sky is normalised to `skyIlluminance(el)` on the CPU (preetham.ts), the sun gets `sunIlluminance(el)` with a
 *   blackbody colour, everything is pre-exposed by the outdoor EV curve, and a von Kries white balance (gains on every
 *   light) adapts to the sun + sky mix.
 * - Clouds are lit by the sun colour × sun illuminance and the (desaturated) sky irradiance in the same units as the
 *   sky, so they read white at noon instead of grey-lavender.
 * - Height fog replaces `FogExp2`: the fog chunks are overridden once (before any material compiles) and applied before
 *   tone mapping, with the haze colour taken from the visible sky toward and away from the sun.
 * - Terrain and vegetation (most of the overdraw) take their diffuse sky light from a 9-coefficient SH probe instead of
 *   a PMREM lookup (wave-1 review: fill-rate regression at retina); the terrain evaluates all its smooth light terms
 *   per vertex (`useTerrainVertexLight`), is drawn after the other opaque objects and the sky dome last
 *   (`RENDER_ORDER`), and every shadow receiver takes cheaper PCF taps (`installShadowTaps`) (KB-I59).
 * - Interiors get their own room environment (`roomEnvironment('day' | 'night')`), dimmed to the room's light level,
 *   so the outdoor sky does not light the rooms (the "mint Festsaal" of the audit's A/B).
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { roomEnvironment, roomEnvironmentGrid } from '@model/interior/materials.ts';
import { warmRoomGrid } from './interiorGrade.ts';
import { sprayColour } from '@model/site/water.ts';
import { FOG_GLSL, fogFor } from './fog.ts';
import { type CandleKind, roomLightShare } from './nightlights.ts';
import { gradeData, installGrade, kinoLookAt, setKinoLook, setNightVision } from './grade.ts';
import { patchShadowChunk } from './shadowTaps.ts';
import { CLOUD, CLOUD_PARS_GLSL, cloudData, setClouds } from './clouds.ts';
import { setCloudTexture } from './shadowsFar.ts';
import {
  type RGB,
  CANDLE_K,
  HORIZON_SAT,
  NIGHT_FLOOR_LUX,
  NIGHT_GROUND_FILL,
  nightGroundFill,
  adaptationDegree,
  envSkyIso,
  envSkySat,
  evIndoor,
  evOutdoor,
  horizonSoftness,
  kelvinLinear,
  kinoLowSun,
  lowSunHazeWarm,
  lowSunSkyFill,
  luminance,
  normalise,
  preExposure,
  roomIlluminance,
  saturate,
  sceneIlluminant,
  skylightColour,
  skylightWeight,
  skyViewEv,
  skyIlluminance,
  skyTint,
  sunColour,
  sunIlluminance,
  viewSkySat,
  visibleSkySat,
  whiteBalance,
} from './light.ts';
import { type SkyParams, type V3, horizonRadiance, irradiance, meanSkyRadiance, projectSH, skyRadiance } from './preetham.ts';

/**
 * Linear albedo of the surroundings seen by the environment below the horizon: the one-bounce stand-in for the July
 * ground around the palace [I]. Wave-2 review: the old meadow value [0.2, 0.19, 0.12] gave shaded façades an olive
 * bounce and too little of it (grey-card sun:shade 15 at 17:30). Mixed surroundings of the 1789 ridge: hay meadow
 * and lawn ≈ 0.20–0.25, sanded courts ≈ 0.35, limewashed walls ≈ 0.7 [I] → a warm-neutral 0.275 (kept near grey: an orange bounce plus blue sky read mauve).
 */
export const GROUND_ALBEDO: RGB = [0.285, 0.275, 0.215];
/** Luminance (cd/m²) of an emissive intensity of 1 on the interior candle and ember materials [I]. */
export const EMISSIVE_NITS = 1000;
/**
 * Global calibration of the exposure [I, tuned on poses 03, 14]. 1 = Frostbite's saturation-based 1.2 · 2^EV, which
 * renders an 18 % card in full sun at 0.12 (sRGB ≈ 97): ≈ 0.6 EV darker than a camera's standard output
 * sensitivity (18 % → sRGB ≈ 118, ISO 12232). 1.5 puts a horizontal sunlit surface at its albedo, so the court sand
 * #C9B48E in sun reads ≈ #C4B08C (wave-1 review: the 10:30 frames were underexposed).
 */
export const EXPOSURE_K = 1.5;
/** Albedo of the fair-weather cumulus tops in the sky shader [I]. */
export const CLOUD_ALBEDO = 0.8;
/** Soft cap of the visible sky's display luminance (knee, max): the circumsolar glow and sun-side haze stay ≤ #F0E8DA [I]. */
export const SKY_CAP: [number, number] = [0.6, 0.92];
/**
 * Haze density in the Kino look relative to Dokumentation [I; wave-5 review: the 18:45 tour shot read as grey haze;
 * wave-6 review: still washing out the hills, −30 % again].
 */
export const KINO_HAZE = 0.42;
/**
 * Kino sky (wave-6 review: beige-grey skies with almost no blue in the Rundflug; look §7.2–7.3 asks for blue layered
 * hills with warm haze only toward the sun) [I, art direction]:
 * - `sat`: saturation of the visible sky relative to Dokumentation (may exceed the Doku cap of 1);
 * - `horizon`: saturation at the horizon (Doku `HORIZON_SAT` 0.35);
 * - `coolAway`: least share of the cool earth-shadow blue in the anti-solar haze at any sun height (Doku: low sun only).
 * The sky and the anti-solar haze are white-balanced as in Dokumentation (the eye adapts to the sky), so the Kino's
 * warmer key (less adaptation) lands on the lit landscape and the sun-side haze only.
 */
export const KINO_SKY = { sat: 1.3, horizon: 0.55, coolAway: 0.45 } as const;
/** Foliage saturation in Kino relative to Dokumentation (wave-6 review: a little saturation back in the midtones) [I]. */
export const KINO_LEAF_SAT = 1.08;

const fogData = new Float32Array(16);

/**
 * Override three's fog chunks with the height fog (once, before any material compiles). The uniform array `uFog` is
 * added to every built-in shader that has fog, by reference, so one Float32Array drives all materials.
 */
export function installHeightFog(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  if (chunks.fog_vertex.includes('vFogRay')) return;
  chunks.fog_pars_vertex = FOG_GLSL.pars_vertex;
  chunks.fog_vertex = FOG_GLSL.vertex;
  chunks.fog_pars_fragment = FOG_GLSL.pars_fragment;
  chunks.fog_fragment = '';
  chunks.tonemapping_fragment = FOG_GLSL.apply + chunks.tonemapping_fragment;
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, THREE.IUniform> }[]) {
    if (lib.uniforms.fogColor) lib.uniforms.uFog = { value: fogData };
  }
  // wave-5 review fix: night vision and the Kino look sit in the same tone-mapping chunk (grade.ts)
  installGrade();
}

/**
 * Cheaper PCF taps for every shadow receiver (KB-I59, shadowTaps.ts): three's 5 Vogel taps with one cos / sin pair
 * instead of five. Once, before any material compiles.
 */
export function installShadowTaps(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.shadowmap_pars_fragment = patchShadowChunk(chunks.shadowmap_pars_fragment);
}

const SKY_UNIFORMS = `
uniform float uSkyScale;
uniform vec3 uSkyTint;
uniform vec3 uGround;
uniform float uGroundMix;
uniform float uSkySat;
uniform float uHorizonSat;
uniform vec2 uSkyCap;
uniform vec3 uCloudSun;
uniform vec3 uCloudAmb;
uniform float uIso;
uniform vec3 uSkyAvg;
uniform float uCloudFast;
`;

function replaceOnce(src: string, a: string, b: string): string {
  if (!src.includes(a)) throw new Error(`[atmosphere] Sky shader patch target missing: ${a.slice(0, 60)}`);
  return src.replace(a, b);
}

/**
 * Wave 10 (clouds.ts): the cumulus layer, marched from the residence through the slab [base, base + thickness +
 * billows] over the shared coverage field. Wave-10 review fix (eye level: tents, prisms, vertical streaks, flat white):
 * each cloud is a dome over its footprint (`skbCloudColumn`: top = thickness · √margin) whose surface the 3D billows
 * push in and out (`skbCloudBillow`, near the surface only), over a flat base. Light: Beer–Lambert optical depth toward
 * the sun from two samples of the smooth dome plus the point's own skin, a multiple-scattering octave (bases grey,
 * not black), a powder term (the skin facing away from the sun darker when the sun is behind the viewer), a two-lobe
 * Henyey–Greenstein phase (silver lining toward the sun), the sky's light falling off toward the base and the ground
 * bounce on it; distant clouds sink into the haze. 64 steps crowded toward the base, with per-pixel jitter; the result is cached in the sky
 * cube (post.ts, refreshed a tile at a time), so the march costs nothing in a steady view. Lit in the same Preetham
 * units as three's clouds (uCloudSun, uCloudAmb), so the scale, tint and saturation that follow treat both alike.
 */
const CUMULUS_GLSL = /* glsl */ `
      if ( direction.y > 0.004 && uCloud[ 0 ] > 0.0 ) {
        vec3 co = vec3( uCloud[ 6 ], uCloud[ 10 ], uCloud[ 7 ] );
        float cb = uCloud[ 4 ];
        float ct = uCloud[ 5 ];
        vec2 off = vec2( uCloud[ 1 ], uCloud[ 2 ] );
        const float ER = ${CLOUD.erode.toFixed(1)};
        float t0 = ( cb - co.y ) / direction.y;
        float t1 = min( ( cb + ct + ER - co.y ) / direction.y, t0 + 20000.0 );
        if ( t0 < 30000.0 ) {
          // steps crowd toward the base entry (t ∝ u^1.7), where a cloud seen from below shows its edge
          // uCloudFast: the per-frame small sky shown while the cube refreshes after a jump (post.ts) takes a cheaper
          // march (24 steps, no billows); the cube itself always gets the full one
          const int STEPS = 64;
          bool fast = uCloudFast > 0.5;
          int nSteps = fast ? 24 : STEPS;
          float span = t1 - t0;
          // per-pixel start offset (interleaved gradient noise) against step banding
          float jit = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
          vec3 sd = normalize( vSunDirection );
          float dayK = max( smoothstep( -0.05, 0.12, sd.y ), 0.05 );
          // two-lobe Henyey–Greenstein, 1 at 90° from the sun: forward lobe = silver lining, back lobe = soft glow
          float hgF = 0.64 / pow( 1.36 - 1.2 * cosTheta, 1.5 );
          float hgB = 0.96 / pow( 1.04 + 0.4 * cosTheta, 1.5 );
          float phase = min( ( 0.7 * hgF + 0.3 * hgB ) / 0.554, 4.0 );
          float powderK = 0.5 - 0.5 * cosTheta;
          float bounce = 0.17 * max( sd.y, 0.0 );
          float aerY = smoothstep( 0.004, 0.06, direction.y );
          float trans = 1.0;
          vec3 acc = vec3( 0.0 );
          for ( int i = 0; i < STEPS; i ++ ) {
            if ( i >= nSteps ) break;
            float u = ( float( i ) + jit ) / float( nSteps );
            float t = t0 + span * pow( u, 1.7 );
            float dt = max( span * 1.7 * pow( u, 0.7 ) / float( nSteps ), 2.0 );
            vec3 p = co + direction * t;
            float h = p.y - cb;
            float top = skbCloudColumn( p.xz - off );
            if ( top < 0.0 || h > top + ER ) continue;
            float s = top - h;
            // billows only near the surface (deep inside a dome the density is full anyway)
            if ( s < ER + 90.0 && ! fast ) s += skbCloudBillow( p );
            float dens = smoothstep( 0.0, 60.0, s ) * smoothstep( 0.0, 40.0, h );
            if ( dens < 0.003 ) continue;
            // optical depth toward the sun: the point's own skin and two samples of the smooth dome (90 m, 320 m)
            float od = 45.0 * dens;
            vec3 q = p + sd * 90.0;
            float hq = q.y - cb;
            od += 130.0 * smoothstep( 0.0, 90.0, skbCloudColumn( q.xz - off ) - hq ) * step( 0.0, hq );
            q = p + sd * 320.0;
            hq = q.y - cb;
            od += 330.0 * smoothstep( 0.0, 90.0, skbCloudColumn( q.xz - off ) - hq ) * step( 0.0, hq );
            float sunT = ( exp( -0.01 * od ) + 0.5 * exp( -0.0022 * od ) ) * ( 1.0 / 1.5 );
            float powder = 1.0 - 0.45 * powderK * exp( -0.04 * od );
            float hn = clamp( h / max( top, 150.0 ), 0.0, 1.0 );
            vec3 cc = uCloudAmb * mix( 0.5, 1.1, hn ) + uCloudSun * ( sunT * phase * powder + bounce * ( 1.0 - hn ) );
            // aerial perspective: far clouds sink into the haze
            cc = mix( texColor, cc * dayK, exp( -t / 15000.0 ) * aerY );
            float a = 1.0 - exp( -0.012 * dens * dt );
            acc += trans * a * cc;
            trans *= 1.0 - a;
            if ( trans < 0.02 ) break;
          }
          texColor = texColor * trans + acc;
        }
      }
`;

function patchSky(s: Sky): void {
  const m = s.material;
  let f = m.fragmentShader;
  f = replaceOnce(f, 'uniform float time;', `uniform float time;${SKY_UNIFORMS}\nuniform float uHorizonSoft;\n${CLOUD_PARS_GLSL}`);
  // wave-8 review (52): a smooth horizon clamp at night (light.ts horizonSoftness); 0 by day = three's clamp
  f = replaceOnce(f, 'float zenithAngle = acos( max( 0.0, direction.y ) );', 'float zenithAngle = acos( min( 1.0, 0.5 * ( direction.y + sqrt( direction.y * direction.y + uHorizonSoft * uHorizonSoft ) ) ) );');
  // clouds lit in the same units as the normalised sky: sun colour × illuminance × albedo / π, plus the sky irradiance
  f = replaceOnce(f, 'vec3 sunColor = vSunE * Fex * 0.22 * 0.04;', 'vec3 sunColor = uCloudSun;');
  f = replaceOnce(f, 'vec3 skyAmbient = Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 );', 'vec3 skyAmbient = uCloudAmb;');
  f = replaceOnce(
    f,
    'gl_FragColor = vec4( texColor, 1.0 );',
    `${CUMULUS_GLSL}
      if ( direction.y > 0.0 ) texColor = mix( texColor, uSkyAvg, uIso );
      {
        float skyL = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
        float hz = pow( 1.0 - clamp( direction.y, 0.0, 1.0 ), 3.0 );
        texColor = mix( vec3( skyL ), texColor, uSkySat * mix( 1.0, uHorizonSat, hz ) );
      }
      texColor *= uSkyScale * uSkyTint;
      texColor = mix( texColor, uGround, uGroundMix * smoothstep( 0.0, -0.06, direction.y ) );
      {
        // soft knee on the display luminance (not on the sun disc)
        float dl = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
        if ( dl > uSkyCap.x && sundisc < 0.5 ) {
          float over = dl - uSkyCap.x;
          float span = uSkyCap.y - uSkyCap.x;
          texColor *= ( uSkyCap.x + over / ( 1.0 + over / span ) ) / dl;
        }
      }
      gl_FragColor = vec4( texColor, 1.0 );`,
  );
  m.fragmentShader = f;
  m.uniforms.uSkyScale = { value: 1 };
  m.uniforms.uHorizonSoft = { value: 0 };
  m.uniforms.uSkyTint = { value: new THREE.Vector3(1, 1, 1) };
  m.uniforms.uGround = { value: new THREE.Vector3() };
  m.uniforms.uGroundMix = { value: 0 };
  m.uniforms.uSkySat = { value: 1 };
  m.uniforms.uHorizonSat = { value: 1 };
  m.uniforms.uSkyCap = { value: new THREE.Vector2(1e6, 2e6) };
  m.uniforms.uCloudSun = { value: new THREE.Vector3() };
  m.uniforms.uCloudAmb = { value: new THREE.Vector3() };
  m.uniforms.uIso = { value: 0 };
  m.uniforms.uSkyAvg = { value: new THREE.Vector3() };
  m.uniforms.uCloudFast = { value: 0 };
  // wave 10: fair-weather cumulus (clouds.ts), one shared block with the cloud shadows
  m.uniforms.uCloud = { value: cloudData };
  // the display grade (night vision, Kino look) reaches the sky's tone mapping too (grade.ts)
  m.uniforms.uGrade = { value: gradeData };
  m.needsUpdate = true;
}

/** Uniforms each sky keeps for itself (all others are shared between the visible sky and the environment twin). */
const OWN_UNIFORMS = new Set(['showSunDisc', 'uGroundMix', 'uSkyScale', 'uSkySat', 'uHorizonSat', 'uSkyCap', 'uSkyTint', 'uIso', 'uSkyAvg']);

export interface LightState {
  elevation: number;
  azimuthGrid: number;
  /** unit vector toward the sun (local frame) */
  dir: THREE.Vector3;
  evOut: number;
  evIn: number;
  /** pre-exposure (display value per cd/m²) */
  pre: number;
  /** pre-exposed room radiance (display units) for the interior environment: daylight only / with candles */
  room: number;
  roomCandles: number;
  sunLux: number;
  skyLux: number;
  /** white-balance gains applied to every outdoor light (linear RGB) */
  gains: RGB;
  /** 0 by day … 1 at night: candle look of the rooms, lit windows */
  night: number;
  /** Kino golden hour: exposure lift outdoors (EV, light.ts kinoLowSun); 0 in Dokumentation */
  kinoEv: number;
  /** moonlight on a surface facing the moon (lux) while it carries the directional light; 0 otherwise */
  moonLux: number;
}

/**
 * Colour temperature of moonlight (K): sunlight reflected by the slightly reddening regolith, ≈ 4100 K [I; the moon's
 * spectrum is the solar one tilted toward red, CCT ≈ 4000–4300 K]. The scotopic night grade (grade.ts) turns it
 * grey-blue on screen, as the eye sees it.
 */
export const MOON_K = 4100;

/** The moon for `Atmosphere.update`: unit vector toward it (local frame) and its illuminance (lux, ephemeris.ts). */
export interface MoonLight {
  dir: V3;
  lux: number;
}

/** Shared uniform blocks for materials patched by `useSkyShDiffuse` (terrain, vegetation). */
const shCoefficients = Array.from({ length: 9 }, () => new THREE.Vector3());
const shUniforms = {
  uSkySH: { value: shCoefficients },
  uLeafSat: { value: 1 },
};

/**
 * Diffuse sky light from the SH probe instead of the PMREM environment (wave-1 review, KB-I55 widened): the material
 * compiles without `USE_ENVMAP`, so neither the irradiance nor the (for rough terrain and leaves invisible) specular
 * lookup runs per fragment. `leaf` adds the low-sun foliage desaturation. Chains any existing `onBeforeCompile`.
 */
export function useSkyShDiffuse(m: THREE.MeshStandardMaterial, opts: { leaf?: boolean } = {}): void {
  if (m.userData.skySh) return;
  m.userData.skySh = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uSkySH = shUniforms.uSkySH;
    sh.uniforms.uLeafSat = shUniforms.uLeafSat;
    sh.fragmentShader = `#undef USE_ENVMAP\nuniform vec3 uSkySH[ 9 ];\nuniform float uLeafSat;\n${sh.fragmentShader}`;
    sh.fragmentShader = replaceOnce(
      sh.fragmentShader,
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse )
  iblIrradiance += shGetIrradianceAt( inverseTransformDirection( geometryNormal, viewMatrix ), uSkySH );
#endif`,
    );
    if (opts.leaf) {
      sh.fragmentShader = replaceOnce(
        sh.fragmentShader,
        '#include <color_fragment>',
        `#include <color_fragment>
  diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, uLeafSat );`,
      );
    }
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|skysh${opts.leaf ? '-leaf' : ''}`;
  m.needsUpdate = true;
}

/**
 * Terrain lighting per vertex (KB-I59): the terrain is a rough (0.95), non-metallic, unbumped surface whose normals are
 * smooth per vertex (1-8 m LOD grid), so every smooth term of three's physical model (sun Lambert × (1 − F), the GGX
 * sun specular with the multi-scatter compensation, the SH sky diffuse and its multi-scatter share) is evaluated per
 * vertex with three's own formulas and DFG table, and interpolated. Per pixel stay the albedo (the land-cover splat),
 * the sun shadow, any point lights (interior candles at night) and the height fog. Same-session A/B on a retina aerial:
 * −2.5…−3 ms GPU, no visible change (the per-pixel `geometryRoughness` widening of far, sub-pixel normals is dropped;
 * at roughness 0.95 it moved the specular by < 1 % of the radiance).
 */
export const TERRAIN_LIGHT_GLSL = {
  vertexPars: /* glsl */ `
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
#endif
uniform sampler2D dfgLUT;
uniform float roughness;
uniform vec3 uSkySH[ 9 ];
// x sun diffuse, y sun specular (× sun colour × shadow), z sky diffuse, w sky specular (× vTerrSky)
varying vec4 vTerrLight;
varying vec3 vTerrSky;
`,
  vertexMain: /* glsl */ `
{
	vec3 tn = normalize( transformedNormal );
	vec3 tv = normalize( - mvPosition.xyz );
	float r = max( roughness, 0.045 );
	float nv = saturate( dot( tn, tv ) );
	vec2 fab = textureLod( dfgLUT, vec2( r, nv ), 0.0 ).rg;
	// dielectric F0 0.04, F90 1 (three's computeMultiscattering and multiScatteringCompensation)
	float fssEss = 0.04 * fab.x + fab.y;
	float ess = fab.x + fab.y;
	float favg = 0.04 + 0.96 * 0.047619;
	float ms = fssEss * favg / ( 1.0 - ( 1.0 - ess ) * favg ) * ( 1.0 - ess );
	float sunD = 0.0;
	float sunS = 0.0;
	#if NUM_DIR_LIGHTS > 0
		vec3 l = directionalLights[ 0 ].direction;
		vec3 h = normalize( l + tv );
		float nl = saturate( dot( tn, l ) );
		float nh = saturate( dot( tn, h ) );
		float fr = F_Schlick( 0.04, 1.0, saturate( dot( tv, h ) ) );
		float a2 = pow2( pow2( r ) );
		float gv = nl * sqrt( a2 + ( 1.0 - a2 ) * pow2( nv ) );
		float gl = nv * sqrt( a2 + ( 1.0 - a2 ) * pow2( nl ) );
		float vis = 0.5 / max( gv + gl, EPSILON );
		float dn = RECIPROCAL_PI * a2 / pow2( pow2( nh ) * ( a2 - 1.0 ) + 1.0 );
		sunD = nl * ( 1.0 - fr ) * RECIPROCAL_PI;
		sunS = nl * fr * vis * dn * ( 1.0 + 0.04 * ( 1.0 / ess - 1.0 ) );
	#endif
	vec3 wn = inverseTransformDirection( tn, viewMatrix );
	float x = wn.x, y = wn.y, z = wn.z;
	vec3 e = uSkySH[ 0 ] * 0.886227;
	e += uSkySH[ 1 ] * 2.0 * 0.511664 * y;
	e += uSkySH[ 2 ] * 2.0 * 0.511664 * z;
	e += uSkySH[ 3 ] * 2.0 * 0.511664 * x;
	e += uSkySH[ 4 ] * 2.0 * 0.429043 * x * y;
	e += uSkySH[ 5 ] * 2.0 * 0.429043 * y * z;
	e += uSkySH[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	e += uSkySH[ 7 ] * 2.0 * 0.429043 * x * z;
	e += uSkySH[ 8 ] * 0.429043 * ( x * x - y * y );
	vTerrSky = e;
	vTerrLight = vec4( sunD, sunS, ( 1.0 - fssEss - ms ) * RECIPROCAL_PI, ms * RECIPROCAL_PI );
}
`,
  fragmentPars: /* glsl */ `
#undef USE_ENVMAP
varying vec4 vTerrLight;
varying vec3 vTerrSky;
`,
  /** the sun (directional light 0) takes the vertex terms; its shadow stays per pixel */
  sunDirect: /* glsl */ `
		#if UNROLLED_LOOP_INDEX == 0
			reflectedLight.directDiffuse += directLight.color * vTerrLight.x * material.diffuseContribution;
			reflectedLight.directSpecular += directLight.color * vTerrLight.y;
		#else
			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#endif
`,
  /** replaces lights_fragment_end: SH sky per vertex; `irradiance` is the (outdoors zero) ambient term */
  indirect: /* glsl */ `
#if defined( RE_IndirectDiffuse )
	reflectedLight.indirectDiffuse += material.diffuseContribution * ( vTerrSky * vTerrLight.z + irradiance * RECIPROCAL_PI );
#endif
#if defined( RE_IndirectSpecular )
	reflectedLight.indirectSpecular += vTerrSky * vTerrLight.w;
#endif
`,
};

const RE_DIRECT_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/**
 * three's `lights_fragment_begin` with the directional light's `RE_Direct` replaced by the vertex terms (the chunk
 * text of the pinned three r187; throws when the patch target moves, so a three update fails loudly, not darkly).
 */
export function terrainLightsBegin(chunk: string): string {
  const at = chunk.indexOf('directionalLights[ i ]');
  if (at < 0) throw new Error('[atmosphere] lights_fragment_begin: directional loop not found');
  const call = chunk.indexOf(RE_DIRECT_CALL, at);
  if (call < 0) throw new Error('[atmosphere] lights_fragment_begin: directional RE_Direct not found');
  return chunk.slice(0, call) + TERRAIN_LIGHT_GLSL.sunDirect + chunk.slice(call + RE_DIRECT_CALL.length);
}

/**
 * Light the terrain per vertex (TERRAIN_LIGHT_GLSL) instead of `useSkyShDiffuse`'s per-pixel SH and BRDF. Chains the
 * material's own `onBeforeCompile` (the land-cover splat).
 */
export function useTerrainVertexLight(m: THREE.MeshStandardMaterial): void {
  if (m.userData.terrainVertexLight) return;
  m.userData.terrainVertexLight = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  let perVertex = true;
  /** A/B hook: false = the per-pixel path (three's BRDF + per-pixel SH, as `useSkyShDiffuse`) */
  m.userData.setVertexLight = (on: boolean) => {
    perVertex = on;
    m.needsUpdate = true;
  };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uSkySH = shUniforms.uSkySH;
    if (!perVertex) {
      sh.fragmentShader = `#undef USE_ENVMAP\nuniform vec3 uSkySH[ 9 ];\n${sh.fragmentShader}`;
      sh.fragmentShader = replaceOnce(
        sh.fragmentShader,
        '#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\n#if defined( RE_IndirectDiffuse )\n  iblIrradiance += shGetIrradianceAt( inverseTransformDirection( geometryNormal, viewMatrix ), uSkySH );\n#endif',
      );
      return;
    }
    sh.vertexShader = replaceOnce(sh.vertexShader, '#include <common>', `#include <common>\n${TERRAIN_LIGHT_GLSL.vertexPars}`);
    sh.vertexShader = replaceOnce(sh.vertexShader, '#include <fog_vertex>', `#include <fog_vertex>\n${TERRAIN_LIGHT_GLSL.vertexMain}`);
    sh.fragmentShader = `${TERRAIN_LIGHT_GLSL.fragmentPars}${sh.fragmentShader}`;
    sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <lights_fragment_begin>', terrainLightsBegin(THREE.ShaderChunk.lights_fragment_begin));
    sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <lights_fragment_end>', TERRAIN_LIGHT_GLSL.indirect);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|terrain-${perVertex ? 'vlight' : 'plight'}`;
  m.needsUpdate = true;
}

/**
 * Draw order (KB-I59): three sorts opaque objects front to back by object centre, so the sky dome (centred on the
 * camera) was drawn first and the 128 m terrain chunks interleaved with the trees and buildings standing on them. The
 * terrain is drawn after every other opaque object (its covered pixels fail the early depth test instead of being
 * shaded) and the sky last (it only fills what is still at the far plane). Same-session A/B at 3024 × 1964: −3…−8 ms
 * on the aerial poses (−6…−12 ms with the terrain depth pre-pass of TerrainMesh, which keeps hills hiding what stands
 * behind them). Transparent objects are a separate list and keep their order.
 */
export const RENDER_ORDER = { terrain: 1, sky: 2 } as const;

export class Atmosphere {
  readonly sky = new Sky();
  private readonly envSky = new Sky();
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;

  // a clear, slightly hazy July sky: turbidity 4 whitens the horizon and calms the zenith blue [I, wave-1 review]
  readonly params: SkyParams = { turbidity: 4, rayleigh: 1, mieCoefficient: 0.005, mieDirectionalG: 0.8 };
  state: LightState | null = null;
  /** height-fog master switch (KB-I07); false = no haze */
  fog = true;
  /** display look (degree of chromatic adaptation; 'kino' adds the AgX look and less haze, grade.ts) */
  look: 'doku' | 'kino' = 'doku';
  /** Strength of the scotopic night vision at full night (grade.ts); 0 switches it off for an A/B. */
  nightVision = 1;
  /** Wave 10: fair-weather cumulus and their shadows (clouds.ts); false = cloudless ("klar"). */
  clouds = true;
  /** Wave 10: centre of the residence (local x, z): the cloud field's sunny clearing and the sky's march origin. */
  cloudCentre: [number, number] = [0, 0];
  /** Cloud cover of the last update (0…1). */
  cloudAmount = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
  ) {
    this.sky.scale.setScalar(20000);
    this.sky.renderOrder = RENDER_ORDER.sky;
    this.envSky.scale.setScalar(1000);
    patchSky(this.sky);
    patchSky(this.envSky);
    const su = this.sky.material.uniforms;
    su.turbidity.value = this.params.turbidity;
    su.rayleigh.value = this.params.rayleigh;
    su.mieCoefficient.value = this.params.mieCoefficient;
    su.mieDirectionalG.value = this.params.mieDirectionalG;
    // wave 10: three's flat cloud streaks are replaced by the cumulus layer (clouds.ts); "klar" shows no clouds
    if (su.cloudCoverage) su.cloudCoverage.value = 0;
    su.uHorizonSat.value = HORIZON_SAT;
    su.uSkyCap.value.set(SKY_CAP[0], SKY_CAP[1]);
    // the environment twin shares the Preetham and cloud uniforms with the visible sky; scale, saturation, sun disc,
    // ground and cap are its own
    const eu = this.envSky.material.uniforms;
    for (const k of Object.keys(su)) if (!OWN_UNIFORMS.has(k)) eu[k] = su[k];
    eu.showSunDisc.value = 0;
    eu.uGroundMix.value = 1;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.add(this.sky);
    // the fog object only switches USE_FOG on; colour and density come from uFog
    scene.fog = new THREE.FogExp2(0x000000, 1e-9);
  }

  /** Recompute sun, sky, environment, haze and exposure for a sun position (degrees; azimuth from GRID north). */
  update(elevation: number, azimuthGrid: number, moon?: MoonLight): LightState {
    const az = (azimuthGrid * Math.PI) / 180;
    const dirAt = (elDeg: number): V3 => {
      const e = (elDeg * Math.PI) / 180;
      return [Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)];
    };
    const sunDir = dirAt(elevation);
    // below the horizon the sky keeps its sunset shape (sun clamped to 0°); tint and level carry the twilight
    const skyDir = dirAt(Math.max(0, elevation));
    const p = this.params;

    const evOut = evOutdoor(elevation);
    const pre = preExposure(evOut) * EXPOSURE_K;
    const skyLux = Math.max(skyIlluminance(elevation), NIGHT_FLOOR_LUX);
    const sunLux = sunIlluminance(elevation);
    const skyIrrRaw = irradiance([0, 1, 0], skyDir, p);
    const unit = skyLux / Math.max(1e-9, luminance(skyIrrRaw)); // cd/m² per Preetham unit
    const envSat = envSkySat(elevation);
    const skyIrr = saturate(skyIrrRaw, envSat); // (desaturated) sky irradiance, for the visible clouds
    const tint = skyTint(elevation);
    const sc = sunColour(elevation);
    const viewGain = 2 ** skyViewEv(elevation);

    // image-based light (wave-2 review fix): the env sky is blended toward its hemispherical mean (flatter, multiply
    // scattered hazy sky), normalised to the same sky lux, and its mean colour moved onto the daylight locus
    const iso = envSkyIso(elevation);
    const avg = meanSkyRadiance(skyDir, p);
    const envIrrRaw: RGB = [0, 1, 2].map((i) => skyIrrRaw[i] * (1 - iso) + Math.PI * avg[i] * iso) as RGB;
    const unitEnv = skyLux / Math.max(1e-9, luminance(envIrrRaw));
    const envCol = normalise(saturate(envIrrRaw, envSat));
    const target = skylightColour(elevation);
    const w = skylightWeight(elevation);
    let corr: RGB = [0, 1, 2].map((i) => 1 + w * (target[i] / Math.max(1e-6, envCol[i]) - 1)) as RGB;
    const cl = luminance([corr[0] * envCol[0], corr[1] * envCol[1], corr[2] * envCol[2]]);
    corr = [corr[0] / cl, corr[1] / cl, corr[2] / cl];

    // white balance: adapt (partly) to the sun + sky mix
    const skyRgb = normalise([envCol[0] * corr[0] * tint[0], envCol[1] * corr[1] * tint[1], envCol[2] * corr[2] * tint[2]]);
    // Kino at low sun (wave-5 review, 'Goldene Stunde'): warmer key, less sky fill, a less milky sky, clearer air
    const kl = this.look === 'kino' ? kinoLowSun(elevation) : { w: 0, adapt: 1, fill: 1, skySat: 1, haze: 1, g: 0, ev: 0 };
    const kino = this.look === 'kino';
    // KB-I74: less sky fill at low sun in both looks (Kino keeps its deeper fill where that is lower)
    const fill = Math.min(kl.fill, lowSunSkyFill(elevation));
    const illum = sceneIlluminant(elevation, sc, skyRgb);
    const gains = whiteBalance(illum, adaptationDegree(elevation, this.look) * kl.adapt);
    const tintWB: RGB = [tint[0] * gains[0], tint[1] * gains[1], tint[2] * gains[2]];
    // Kino: the visible sky and the anti-solar haze keep the Dokumentation white balance (KINO_SKY)
    const skyGains = kino ? whiteBalance(illum, adaptationDegree(elevation, 'doku')) : gains;
    const tintSky: RGB = [tint[0] * skyGains[0], tint[1] * skyGains[1], tint[2] * skyGains[2]];
    const envTint: RGB = [tintWB[0] * corr[0], tintWB[1] * corr[1], tintWB[2] * corr[2]];

    // sky (visible + environment twin share the Preetham uniforms; each has its own scale)
    const su = this.sky.material.uniforms;
    const eu = this.envSky.material.uniforms;
    su.sunPosition.value.set(...skyDir);
    su.showSunDisc.value = elevation > 0 ? 1 : 0;
    su.uHorizonSoft.value = horizonSoftness(elevation);
    // Kino golden hour: the exposure lift (kl.ev, main.ts) is for the land; the sky keeps its level (a graduated filter)
    su.uSkyScale.value = unit * pre * viewGain * Math.pow(2, -kl.ev);
    eu.uSkyScale.value = unitEnv * pre * fill;
    eu.uSkySat.value = envSat;
    eu.uIso.value = iso;
    eu.uSkyAvg.value.set(...avg);
    eu.uSkyTint.value.set(...envTint);
    su.uSkySat.value = kino ? Math.min(KINO_SKY.sat, viewSkySat(elevation) * kl.skySat * KINO_SKY.sat) : Math.min(1, viewSkySat(elevation) * kl.skySat);
    su.uHorizonSat.value = kino ? KINO_SKY.horizon : HORIZON_SAT;
    su.uSkyTint.value.set(...tintSky);
    // clouds in Preetham units (the shader multiplies by uSkyScale · uSkyTint afterwards)
    const cs = (sunLux * CLOUD_ALBEDO) / Math.PI / unit;
    su.uCloudSun.value.set(sc[0] * cs, sc[1] * cs, sc[2] * cs);
    const ca = CLOUD_ALBEDO / Math.PI;
    su.uCloudAmb.value.set(skyIrr[0] * ca, skyIrr[1] * ca, skyIrr[2] * ca);

    // sun: blackbody colour, illuminance on the normal plane, white-balanced
    this.sun.color.setRGB(sc[0] * gains[0], sc[1] * gains[1], sc[2] * gains[2], THREE.LinearSRGBColorSpace);
    this.sun.intensity = sunLux * pre;
    this.sun.visible = sunLux > 0;
    this.sun.userData.dir = new THREE.Vector3(...sunDir);
    // wave 10 (night sky): once the sun has set its light is the moon's (one directional light, so the moonlight casts
    // shadows through the near and far maps); never while the sun's disc is up, so every day frame stays the same
    const moonLux = sunLux <= 0 && moon && moon.lux > 0 && moon.dir[1] > -0.02 ? moon.lux : 0;
    if (moonLux > 0) {
      const mc = normalise(kelvinLinear(MOON_K));
      this.sun.color.setRGB(mc[0] * gains[0], mc[1] * gains[1], mc[2] * gains[2], THREE.LinearSRGBColorSpace);
      this.sun.intensity = moonLux * pre;
      this.sun.visible = true;
      this.sun.userData.dir = new THREE.Vector3(...moon!.dir);
    }

    // ground below the horizon in the environment: albedo × (sun + sky) / π
    const sinEl = Math.max(0, Math.sin((elevation * Math.PI) / 180));
    const ground = [0, 1, 2].map((i) => (GROUND_ALBEDO[i] * (sc[i] * sunLux * sinEl + skyLux * skyRgb[i]) * gains[i] * pre) / Math.PI) as RGB;
    eu.uGround.value.set(ground[0], ground[1], ground[2]);
    // fountain spray (KB-I37): small droplets scatter the sun broadly plus the sky [I: albedo 0.6, a third of the sun]
    const spray = [0, 1, 2].map((i) => (0.6 * (sc[i] * sunLux * 0.35 + skyLux * skyRgb[i]) * gains[i] * pre) / Math.PI) as RGB;
    sprayColour.setRGB(spray[0], spray[1], spray[2], THREE.LinearSRGBColorSpace);
    su.uGround.value.set(ground[0], ground[1], ground[2]);

    // haze colour from the visible sky near the horizon: away from the sun and toward it
    const hz = Math.hypot(sunDir[0], sunDir[2]) || 1;
    const toward: V3 = [sunDir[0] / hz, 0, sunDir[2] / hz];
    const away: V3 = [-toward[0], 0, -toward[2]];
    const bandSat = (kino ? Math.min(KINO_SKY.sat, viewSkySat(elevation) * kl.skySat * KINO_SKY.sat) : Math.min(1, viewSkySat(elevation) * kl.skySat)) * visibleSkySat(Math.sin((2 * Math.PI) / 180), kino ? KINO_SKY.horizon : HORIZON_SAT);
    let hAway = saturate(horizonRadiance(away, skyDir, p, [0.5, 2, 4]), bandSat);
    let hSun = saturate(horizonRadiance(toward, skyDir, p, [0.5, 2, 4]), bandSat);
    // KB-I74: warm haze toward the low sun (forward scattering of the reddened beam), same luminance
    const warm = lowSunHazeWarm(elevation);
    if (warm > 0) {
      const l = luminance(hSun);
      hSun = [0, 1, 2].map((i) => hSun[i] + (sc[i] * l - hSun[i]) * warm) as RGB;
    }
    // at low sun the anti-solar haze is the cool earth shadow, not a tan wall (wave-1 review, pose 08) [I]
    let cool = elevation > -2 ? 1 - Math.min(1, Math.max(0, (elevation - 4) / 16)) : 0;
    // Kino: blue layered hills away from the sun at any height (look §7.2), warm haze toward the sun only
    if (kino && elevation > -2) cool = Math.max(cool, KINO_SKY.coolAway);
    if (cool > 0) {
      const l = luminance(hAway);
      const blue: RGB = [0.8 * l, 0.98 * l, 1.32 * l];
      const s = luminance(blue) > 0 ? l / luminance(blue) : 1;
      hAway = [0, 1, 2].map((i) => hAway[i] + (blue[i] * s - hAway[i]) * 0.55 * cool) as RGB;
    }
    this.cloudAmount = setClouds(this.clouds, this.hour, sunDir, this.cloudCentre);
    if (this.cloudAmount > 0) setCloudTexture(this.cloudCentre);
    const f = fogFor(this.hour);
    // Kino (Rundflug, stills): a clearer evening air than the documentary haze, so the golden hour keeps its contrast
    if (this.look === 'kino') f.a *= KINO_HAZE * kl.haze;
    fogData.set([f.a, f.b, this.fog ? 1 : 0, f.h0, sunDir[0], sunDir[1], sunDir[2], 8], 0);
    fogData[11] = f.grow;
    const k = unit * pre * viewGain;
    const capLum = (c: RGB): RGB => {
      const l = luminance(c);
      if (l <= SKY_CAP[0]) return c;
      const over = l - SKY_CAP[0];
      const t = (SKY_CAP[0] + over / (1 + over / (SKY_CAP[1] - SKY_CAP[0]))) / l;
      return [c[0] * t, c[1] * t, c[2] * t];
    };
    const fa = capLum([0, 1, 2].map((i) => hAway[i] * k * tintSky[i]) as RGB);
    const fs = capLum([0, 1, 2].map((i) => hSun[i] * k * tintWB[i]) as RGB);
    for (let i = 0; i < 3; i++) {
      fogData[8 + i] = fa[i];
      fogData[12 + i] = fs[i];
    }

    // environment (PMREM of the twin), rebuilt per sun position
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    const night = 1 - Math.min(1, Math.max(0, (elevation + 6) / 4)); // 0 above −2°, 1 below −6°
    // wave-10 review fix: the night fill on the buildings' sky light too (light.ts NIGHT_GROUND_FILL.env)
    this.scene.environmentIntensity = 1 + NIGHT_GROUND_FILL.env * night;

    // SH twin of the environment's diffuse part for terrain and vegetation (no clouds; they barely change E)
    const envScale = unitEnv * pre * fill;
    const sh = projectSH((d) => {
      if (d[1] <= 0) return ground;
      const r = skyRadiance(d, skyDir, p);
      const L = saturate([0, 1, 2].map((i) => r[i] * (1 - iso) + avg[i] * iso) as RGB, envSat);
      return [L[0] * envScale * envTint[0], L[1] * envScale * envTint[1], L[2] * envScale * envTint[2]];
    });
    // wave-10 review fix: the dark-adapted eye's fill on the land at night (light.ts NIGHT_GROUND_FILL)
    const nf = nightGroundFill(night);
    for (let i = 0; i < 9; i++) shCoefficients[i].set(sh[i][0] * nf[0], sh[i][1] * nf[1], sh[i][2] * nf[2]);
    // golden light pushes greens toward olive, not neon lime: −15 % foliage saturation at low sun [I]
    shUniforms.uLeafSat.value = (1 - (kino ? 0.08 : 0.15) * (1 - Math.min(1, Math.max(0, (elevation - 4) / 16))) * (elevation > -4 ? 1 : 0)) * (kino ? KINO_LEAF_SAT : 1);

    setNightVision(night * this.nightVision, pre);
    setKinoLook(this.look === 'kino', kinoLookAt(kl.g));
    this.state = {
      elevation,
      azimuthGrid,
      dir: new THREE.Vector3(...sunDir),
      evOut,
      evIn: evIndoor(elevation),
      pre,
      room: (roomIlluminance(elevation, false) / Math.PI) * pre,
      roomCandles: (roomIlluminance(elevation, true) / Math.PI) * pre,
      sunLux,
      skyLux,
      gains,
      night,
      kinoEv: kl.ev,
      moonLux,
    };
    return this.state;
  }

  /** Hour of the last update (for the morning/evening haze); set by the caller before update(). */
  hour = 12;

  setFog(on: boolean): void {
    this.fog = on;
    fogData[2] = on ? 1 : 0;
  }

  /** Debug: current fog uniform block (a, b, on, h0 | sun dir, power | haze rgb | sun-side rgb). */
  fogUniforms(): number[] {
    return [...fogData];
  }

  /** The live SH coefficient vectors (uniform values; debug / A-B only). */
  readonly sh = shCoefficients;

  /** Debug: SH coefficients of the diffuse sky probe (linear RGB, pre-exposed). */
  shUniforms(): number[][] {
    return shCoefficients.map((v) => v.toArray());
  }
}

// ---------------------------------------------------------------- interiors

/**
 * KB-I75: the day room environment with the parquet bounce (interiorGrade.ts `warmRoomGrid`): the model's grid with its
 * floor rows warmed to the waxed oak, as a 16 × 8 half-float equirect like `roomEnvironment('day')`.
 */
function warmRoomEnvironment(): THREE.DataTexture {
  const g = roomEnvironmentGrid('day');
  const warm = warmRoomGrid(g.w, g.h, g.rgb);
  const data = new Uint16Array(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = THREE.DataUtils.toHalfFloat(warm.rgb[i * 3 + c]);
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, g.w, g.h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = true;
  tex.userData.meanLuminance = warm.meanLuminance;
  tex.needsUpdate = true;
  return tex;
}

/** Mean linear luminance of a room environment (set by `roomEnvironment`; 1 if missing). */
function meanLinearLuminance(tex: THREE.DataTexture): number {
  return (tex.userData.meanLuminance as number | undefined) ?? 1;
}

interface ClonedLook {
  m: THREE.MeshStandardMaterial;
  envI: number;
  emissiveI: number;
  /** authored roughness and colour (night widening and the crystal's night albedo start from these) */
  rough: number;
  colour: THREE.Color;
}

/**
 * Candle light at night (wave-6 review fix: an odd specular hotspot on the table and floor under the Fest chandelier,
 * shards brighter than the flames) [I]:
 * - `widen`: the room lights are point lights standing for clusters of 8–14 flames ≈ 0.5–1 m across, so the specular
 *   lobes of polished floors and table tops are widened as for a sphere light (Karis 2013, "Real shading in Unreal
 *   Engine 4": α' = α + r / 2d; r ≈ 0.6 m at d ≈ 2.5 m → +0.12 on α = roughness²), scaled by the night factor;
 * - `crystal`: the cut-glass drops are clear glass: at candle light their diffuse share drops to this fraction of the
 *   daylight albedo (which stands in for the window light they scatter by day), the clearcoat glints stay, so the
 *   flames are the brightest thing in the chandelier.
 */
export const CANDLE_NIGHT = { widen: 0.12, crystal: 0.45 } as const;

/** Candle light colour (linear RGB, luminance 1): 1850 K as the eye, mostly adapted, sees it (≈ amber, not orange) [I]. */
export function candleColour(): RGB {
  // Helland's fit has no blue at 1850 K; a trace keeps the adapted colour amber instead of a pure yellow
  const c = kelvinLinear(CANDLE_K).map((v) => Math.max(v, 0.03)) as RGB;
  const g = whiteBalance(c, 0.75);
  return [c[0] * g[0], c[1] * g[1], c[2] * g[2]];
}

/**
 * Interior look: every material under `<id>/interior` gets a clone that uses the room environment instead of the
 * sky, scaled to the room's ambient level: the neutral daylight room by day, the dark candle room at night (wave-1
 * review: the warm env at 10:30 gave pose 06 a cream/orange cast). Candle and ember emissives and the room point
 * lights are scaled by the same pre-exposure as everything else; at night the lights take the candle colour.
 */
export class InteriorLook {
  private readonly clones = new Map<THREE.Material, THREE.Material>();
  private readonly looks: ClonedLook[] = [];
  private readonly lights: { l: THREE.Light; base: number; colour: THREE.Color }[] = [];
  readonly envDay = warmRoomEnvironment();
  readonly envNight = roomEnvironment('night');
  private readonly meanDay = meanLinearLuminance(this.envDay);
  private readonly meanNight = meanLinearLuminance(this.envNight);
  private room = 0;
  private pre = 1;
  private night = 0;
  /** Chandeliers lit at night (a celebration; UI "Fest: Kronleuchter brennen"), see `roomLightShare`. */
  fest = false;
  private readonly candle = new THREE.Color().setRGB(...candleColour(), THREE.LinearSRGBColorSpace);

  private cloneOf(src: THREE.Material): THREE.Material {
    let c = this.clones.get(src);
    if (c) return c;
    const s = src as THREE.MeshStandardMaterial;
    if (!s.isMeshStandardMaterial) {
      this.clones.set(src, src);
      return src;
    }
    const m = s.clone();
    // Material.copy does not carry the shader patches (lumaPatch): keep them, they read the shared uniforms
    m.onBeforeCompile = s.onBeforeCompile;
    m.customProgramCacheKey = s.customProgramCacheKey;
    m.envMap = this.envDay;
    m.name = s.name;
    m.userData = { ...s.userData, interiorClone: true };
    const look = { m, envI: s.envMapIntensity ?? 1, emissiveI: s.emissiveIntensity ?? 1, rough: s.roughness ?? 1, colour: s.color.clone() };
    this.looks.push(look);
    this.apply(look);
    this.clones.set(src, m);
    return m;
  }

  /** Swap the materials of an interior group to room-lit clones and register its point lights. */
  adopt(inner: THREE.Object3D): void {
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        // shadow flags come from the model (interiorShadows in model/src/interior/index.ts)
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((x) => this.cloneOf(x));
        else mesh.material = this.cloneOf(mesh.material);
      }
    });
    for (const l of (inner.userData.lights ?? []) as THREE.Light[]) {
      if (this.lights.some((x) => x.l === l)) continue;
      const x = { l, base: l.intensity, colour: l.color.clone() };
      this.lights.push(x);
      this.applyLight(x);
    }
  }

  private apply(x: ClonedLook): void {
    const nightEnv = this.night >= 0.5;
    const env = nightEnv ? this.envNight : this.envDay;
    if (x.m.envMap !== env) x.m.envMap = env;
    x.m.envMapIntensity = (x.envI * this.room) / (nightEnv ? this.meanNight : this.meanDay);
    const glowing = x.emissiveI > 0 && x.m.emissive && (x.m.emissive.r > 0 || x.m.emissive.g > 0 || x.m.emissive.b > 0);
    if (glowing) x.m.emissiveIntensity = x.emissiveI * EMISSIVE_NITS * this.pre;
    // night: candle clusters, not points (CANDLE_NIGHT); crystal keeps its glints but loses its daylight albedo
    if (x.m.name === 'interior.crystal') x.m.color.copy(x.colour).multiplyScalar(1 - (1 - CANDLE_NIGHT.crystal) * this.night);
    else if (!glowing) x.m.roughness = Math.min(1, Math.sqrt(x.rough * x.rough + CANDLE_NIGHT.widen * this.night));
  }

  private applyLight(x: { l: THREE.Light; base: number; colour: THREE.Color }): void {
    // wave-5 review fix: candelabra (night.ts) burn only at night; the model's light at a chandelier burns at night
    // only for a celebration (`fest`), an ordinary evening is lit by the candelabra and sconces (nightlights.ts)
    const kind: CandleKind = x.l.userData.nightOnly ? 'candelabrum' : x.l.userData.chandelier ? 'chandelier' : 'other';
    const k = roomLightShare(kind, this.night, this.fest);
    x.l.intensity = x.base * this.pre * k;
    x.l.color.copy(x.colour).lerp(this.candle, this.night);
  }

  /** Candle colour as a three.js colour (linear). */
  get candleColour(): THREE.Color {
    return this.candle;
  }

  /** Room radiance (pre-exposed display units), pre-exposure (for lights in cd and emissives in nits), night 0…1. */
  update(room: number, pre: number, night = 0): void {
    this.room = room;
    this.pre = pre;
    this.night = night;
    for (const x of this.looks) this.apply(x);
    for (const x of this.lights) this.applyLight(x);
  }
}

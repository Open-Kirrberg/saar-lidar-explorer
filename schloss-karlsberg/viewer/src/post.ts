/**
 * Post chain (backlog KB-I41, visual-audit P5) and the screen-space water reflection (KB-I37). Built on three r187's
 * own render targets and ShaderMaterials plus its `SMAAPass` addon; no new dependency.
 *
 *   scene ──► half-float target, 4× MSAA, depth texture (resolved)
 *     ├─ AO      half resolution, depth-only (normals from depth), N spiral taps; 2 bilateral blur passes
 *     ├─ bloom   threshold prefilter → 5-level dual-filter pyramid (Bjørge 2015) → upsampled back
 *     └─ grade   one full-screen pass: water SSR · lantern light · AO · bloom · night vision · Neutral / AgX (+ Kino
 *                look, grade.ts) · vignette (Kino) · sRGB  ──► canvas (or an 8-bit target for SMAA ──► canvas)
 *
 * - Every material renders into the target without tone mapping (three does that for render targets), so the HDR
 *   values reach AO and bloom; the tone mapping, the Kino look and the scotopic night vision (grade.ts) run once,
 *   here, with the same functions and the same `toneMappingExposure` as before. Dokumentation stays Neutral: apart from
 *   AO and the MSAA resolve now happening in linear light, the colours are unchanged.
 * - AO is depth-only (no normal pass, so no extra draw calls), after the obscurance estimators of McGuire et al.
 *   ("The Alchemy screen-space ambient obscurance algorithm", HPG 2011; "Scalable ambient obscurance", HPG 2012) with
 *   a cosine-weighted hemisphere term, acting mostly on shaded pixels (postMath.aoLightWeight).
 * - Still water writes alpha 0 into the scene target (materials/index.ts `waterPatch`); the grade pass reflects the
 *   view ray about the (rippled) water normal and marches it through the depth buffer. Hits take the scene colour,
 *   weighted by Schlick's Fresnel; misses keep the material's own sky (environment) reflection. Only water pixels
 *   pay for it, and it needs no second scene render.
 * - Portal lanterns (night.ts) light their surroundings in screen space: inverse-square, Lambert, cut off behind the
 *   wall they hang on, with a fixed grey albedo (postMath.LANTERN_*). Zero lamps by day.
 * - `renderer.info` is reset once per frame here (autoReset off), so the draw calls of all passes add up.
 * - KB-I65: the sky dome (`sky`) is shaded into a small target (postMath.skyScale); in the scene pass the dome swaps
 *   to a stand-in material that reads that target per pixel (still drawn last, so covered pixels cost nothing and no
 *   extra pass touches the MSAA target); stills keep the full-resolution sky. Wave 7: the dome depends on the view
 *   direction and its uniforms only, so it is cached in a cube map (postMath.SKY_CUBE_SIZE), re-shaded one face per
 *   frame when a uniform changes (hour, look, haze; the per-frame small target shows meanwhile), and the scene pass
 *   reads the cube: no sky pass at all in a steady view. The AO buffer
 *   drops to quarter resolution on drawing buffers above ≈ 4.2 Mpx (postMath.aoDivisor); inside a building it uses a
 *   small radius and less strength (postMath.AO_INDOOR).
 * - No temporal history: every frame is a function of the scene, the camera and `time` only (KB-I64).
 */
import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { WATER_RIPPLE_GLSL, waterTime } from '@model/materials/index.ts';
import { gradeData } from './grade.ts';
import type { PostSettings } from './quality.ts';
import { AO_INDOOR, KINO_SKY_BLUE, KINO_SKY_GOLD, KINO_SKY_GOLD_MAX, kinoSkyGold, BLOOM_CLAMP, LANTERN_ALBEDO, LANTERN_CD, LANTERN_REACH, SKY_CUBE_FACES_PER_FRAME, SKY_CUBE_SIZE, SKY_CUBE_TILES, skyCubeTile, SSR_GROWTH, SSR_STEPS, SSR_T0, aoDivisor, marchReach, aoRadius, kinoSkyStrength, bloomStrength, bloomThreshold, sceneMsaa, skyScale, smallUniformChange, uniformNumbers, uniformSignature, vignetteFor } from './postMath.ts';
import { advanceClock } from './clock.ts';
import { AO_BRIGHT_FADE_GLSL, INDOOR_SHOULDER_GLSL, INDOOR_TONE, indoorToneParams } from './interiorGrade.ts';

export type PostLook = 'doku' | 'kino';

/** Maximum number of screen-space lantern lights. */
export const MAX_LAMPS = 8;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

const VIEWPOS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProjInv;
vec3 viewPos( vec2 uv, float d ) {
  vec4 v = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return v.xyz / v.w;
}
vec3 viewPosAt( vec2 uv ) { return viewPos( uv, texture2D( tDepth, uv ).x ); }
// normal from the depth buffer: of the two neighbours per axis the one closer in depth (no smearing across edges)
vec3 viewNormal( vec2 uv, vec3 P, vec2 texel ) {
  vec3 pr = viewPosAt( uv + vec2( texel.x, 0.0 ) );
  vec3 pl = viewPosAt( uv - vec2( texel.x, 0.0 ) );
  vec3 pu = viewPosAt( uv + vec2( 0.0, texel.y ) );
  vec3 pd = viewPosAt( uv - vec2( 0.0, texel.y ) );
  vec3 dx = abs( pr.z - P.z ) < abs( P.z - pl.z ) ? pr - P : P - pl;
  vec3 dy = abs( pu.z - P.z ) < abs( P.z - pd.z ) ? pu - P : P - pd;
  vec3 n = normalize( cross( dx, dy ) );
  return dot( n, P ) > 0.0 ? -n : n;
}
`;

const AO_FRAG = /* glsl */ `
${VIEWPOS}
uniform vec2 uTexel;       // full-resolution texel
uniform float uProjScale;  // full-resolution pixels per metre at 1 m
uniform vec4 uRadius;      // r0, r per metre of distance, r min, r max (m)
uniform float uMaxPx;
uniform float uIntensity;
uniform vec2 uFade;        // distance fade start, end (m)
varying vec2 vUv;
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
vec2 snap( vec2 uv ) { return ( floor( uv / uTexel ) + 0.5 ) * uTexel; }
void main() {
  // positions are reconstructed at full-resolution texel centres: a sub-texel uv with the texel's depth puts the
  // point off the surface, which near the centre reads as occlusion (banding on the terrain)
  vec2 uv = snap( vUv );
  float d = texture2D( tDepth, uv ).x;
  if ( d >= 1.0 ) { gl_FragColor = vec4( 1.0, 65000.0, 0.0, 1.0 ); return; }
  vec3 P = viewPos( uv, d );
  float z = -P.z;
  float fade = 1.0 - smoothstep( uFade.x, uFade.y, z );
  float r = clamp( uRadius.x + uRadius.y * z, uRadius.z, uRadius.w );
  float rPx = r * uProjScale / z;
  if ( fade <= 0.0 || rPx < 1.0 ) { gl_FragColor = vec4( 1.0, z, 0.0, 1.0 ); return; }
  rPx = min( rPx, uMaxPx );
  vec3 n = viewNormal( uv, P, uTexel );
  float rot = ign( gl_FragCoord.xy ) * 6.2831853;
  float jit = ign( gl_FragCoord.yx + 17.0 );
  float sum = 0.0;
  float r2 = r * r;
  for ( int i = 0; i < AO_SAMPLES; i ++ ) {
    float t = ( float( i ) + jit ) / float( AO_SAMPLES );
    float a = rot + t * 6.2831853 * 7.0;
    vec2 uv2 = snap( uv + vec2( cos( a ), sin( a ) ) * ( 1.0 + t * rPx ) * uTexel );
    if ( uv2.x < 0.0 || uv2.x > 1.0 || uv2.y < 0.0 || uv2.y > 1.0 ) continue;
    vec3 S = viewPosAt( uv2 );
    vec3 v = S - P;
    float vv = dot( v, v );
    float c = dot( v, n ) * inversesqrt( vv + 1e-6 );
    // a 0.3 cosine bias (≈ 17°) ignores the creases of the 1 m terrain facets and gentle relief; walls, steps, trunks and
    // furniture stand far steeper
    sum += max( c - 0.3, 0.0 ) * max( 1.0 - vv / r2, 0.0 );
  }
  float ao = clamp( 1.0 - uIntensity * sum / ( float( AO_SAMPLES ) * 0.7 ), 0.0, 1.0 );
  gl_FragColor = vec4( mix( 1.0, ao, fade ), z, 0.0, 1.0 );
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tAO;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec2 c = texture2D( tAO, vUv ).xy;
  float z = c.y;
  float tol = 0.04 * z + 0.15;
  float sum = c.x * 0.2;
  float wsum = 0.2;
  for ( int i = 1; i <= 3; i ++ ) {
    float g = i == 1 ? 0.18 : ( i == 2 ? 0.12 : 0.06 );
    vec2 a = texture2D( tAO, vUv + uStep * float( i ) ).xy;
    vec2 b = texture2D( tAO, vUv - uStep * float( i ) ).xy;
    float wa = g * max( 0.0, 1.0 - abs( a.y - z ) / tol );
    float wb = g * max( 0.0, 1.0 - abs( b.y - z ) / tol );
    sum += a.x * wa + b.x * wb;
    wsum += wa + wb;
  }
  gl_FragColor = vec4( sum / wsum, z, 0.0, 1.0 );
}`;

/** Bloom prefilter: 4 bilinear taps (a 4×4 box), Karis-weighted against fireflies, soft threshold. */
const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;   // full-resolution texel
uniform vec3 uThr;     // threshold, knee, exposure
varying vec2 vUv;
vec3 tap( vec2 uv ) {
  vec3 c = texture2D( tScene, uv ).rgb * uThr.z;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c *= min( l, ${BLOOM_CLAMP.toFixed(1)} ) / max( l, 1e-4 );
  l = min( l, ${BLOOM_CLAMP.toFixed(1)} );
  float soft = clamp( l - uThr.x + uThr.y, 0.0, 2.0 * uThr.y );
  soft = soft * soft / ( 4.0 * uThr.y + 1e-4 );
  float w = max( soft, l - uThr.x ) / max( l, 1e-4 );
  return c * w / ( 1.0 + l );
}
void main() {
  vec3 s = tap( vUv + vec2( -1.0, -1.0 ) * uTexel ) + tap( vUv + vec2( 1.0, -1.0 ) * uTexel ) + tap( vUv + vec2( -1.0, 1.0 ) * uTexel ) + tap( vUv + vec2( 1.0, 1.0 ) * uTexel );
  s *= 0.25;
  // undo the Karis weight on the average (keeps energy, kills single hot pixels)
  float l = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor = vec4( s / max( 1.0 - l, 0.05 ), 1.0 );
}`;

/** Dual-filter downsample (Bjørge, "Bandwidth-efficient rendering", SIGGRAPH 2015). */
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;   // source texel
varying vec2 vUv;
void main() {
  vec3 s = texture2D( tSrc, vUv ).rgb * 4.0;
  s += texture2D( tSrc, vUv + vec2( -1.0, -1.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( 1.0, -1.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( -1.0, 1.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( 1.0, 1.0 ) * uTexel ).rgb;
  gl_FragColor = vec4( s / 8.0, 1.0 );
}`;

/** Dual-filter upsample, added onto the next larger level (additive blending). */
const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;   // source texel
varying vec2 vUv;
void main() {
  vec3 s = texture2D( tSrc, vUv + vec2( -2.0, 0.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( 2.0, 0.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( 0.0, -2.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( 0.0, 2.0 ) * uTexel ).rgb;
  s += texture2D( tSrc, vUv + vec2( -1.0, -1.0 ) * uTexel ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 1.0, -1.0 ) * uTexel ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( -1.0, 1.0 ) * uTexel ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 1.0, 1.0 ) * uTexel ).rgb * 2.0;
  gl_FragColor = vec4( s / 12.0, 1.0 );
}`;

/**
 * Stand-in material of the sky dome in the scene pass (KB-I65): reads the low-resolution sky at the pixel instead of
 * shading Preetham and the clouds. Drawn where the dome was (last, at the far plane), so covered pixels cost nothing.
 */
const SKY_PROXY_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w; // far plane, as the Sky addon
}`;
const SKY_PROXY_FRAG = /* glsl */ `
uniform sampler2D tSky;
uniform vec2 uInvRes;
void main() {
  gl_FragColor = vec4( texture2D( tSky, gl_FragCoord.xy * uInvRes ).rgb, 1.0 );
}`;

/** Stand-in of the dome that reads the cached sky cube (KB-I65 wave 7): one cube tap per uncovered pixel. */
const SKY_CUBE_VERT = /* glsl */ `
varying vec3 vSkyDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vSkyDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // far plane, as the Sky addon
}`;
const SKY_CUBE_FRAG = /* glsl */ `
uniform samplerCube tSkyCube;
varying vec3 vSkyDir;
void main() {
  gl_FragColor = vec4( textureCube( tSkyCube, normalize( vSkyDir ) ).rgb, 1.0 );
}`;

/** Gentle ripples of still garden water: the water material's own GLSL, so reflection and shading agree. */
export const RIPPLE_GLSL = WATER_RIPPLE_GLSL;

const GRADE_FRAG = /* glsl */ `
#include <tonemapping_pars_fragment>
${VIEWPOS}
${RIPPLE_GLSL}
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uAoOn;
uniform float uAoStrength;
uniform float uBloom;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uViewInv;
uniform float uTime;
uniform float uSsrOn;
uniform vec4 uLamp[ ${MAX_LAMPS} ];
uniform vec4 uLampN[ ${MAX_LAMPS} ];
uniform int uLampCount;
uniform vec3 uLampRgb;
uniform float uVignette;
uniform float uAspect;
uniform float uEncode;
uniform float uDebug;
uniform vec4 uSkyGrade;    // Kino sky: strength, unit vector to the sun (world)
uniform float uSkyGold;    // Kino golden glow round the low sun (KB-I06)
uniform vec3 uIndoorTone;  // KB-I75 indoor highlight shoulder: knee, s, weight (0 = off)
uniform vec3 uIndoorTone2; // KB-I92 second stage: knee2, s2; wave-11 review fix: measure (0 luminance, 1 peak)
varying vec2 vUv;
${INDOOR_SHOULDER_GLSL}
${AO_BRIGHT_FADE_GLSL}

const vec3 LUMW = vec3( 0.2126, 0.7152, 0.0722 );

vec3 waterReflect( vec3 c, vec3 P ) {
  vec3 Pw = ( uViewInv * vec4( P, 1.0 ) ).xyz;
  vec3 V = normalize( P );
  // KB-I69: pixel footprint on the water (m): view distance × pixel angle / sine of the grazing angle; waves finer than
  // it fade (WATER_RIPPLE_GLSL skbRippleLod), as the water material does with its derivatives
  vec3 upV = mat3( uView ) * vec3( 0.0, 1.0, 0.0 );
  float fp = length( P ) * 2.0 * uTexel.y / uProj[ 1 ][ 1 ] / max( abs( dot( V, upV ) ), 0.02 );
  vec2 g = skbRippleLod( Pw.xz, uTime, fp );
  vec3 Nv = normalize( mat3( uView ) * normalize( vec3( -g.x, 1.0, -g.y ) ) );
  vec3 R = reflect( V, Nv );
  // KB-I69: march in screen space (McGuire & Mara 2014, "Efficient GPU screen-space ray tracing", JCGT 3(4)): the
  // reflected ray from P to its reach is projected, cut at the near plane and the screen edge, and sampled at even
  // screen steps with the view depth interpolated perspective-correctly (1/w is linear on screen). The former
  // exponential world steps jumped tens of pixels per step far out, skipped thin crowns row by row and drew the
  // horizontal comb stripes. The start is jittered per pixel (interleaved gradient noise, Jimenez 2014; static, so
  // frames stay deterministic) and every crossing is refined by bisection.
  float reach = ${marchReach(SSR_T0, SSR_GROWTH, SSR_STEPS).toFixed(1)};
  if ( R.z > 0.0 ) reach = min( reach, ( -0.31 - P.z ) / R.z );
  vec4 h0 = uProj * vec4( P, 1.0 );
  vec4 h1 = uProj * vec4( P + R * reach, 1.0 );
  float k0 = 1.0 / h0.w;
  float k1 = 1.0 / h1.w;
  vec2 s0 = h0.xy * k0 * 0.5 + 0.5;
  vec2 sd = h1.xy * k1 * 0.5 + 0.5 - s0;
  float umax = 1.0;
  if ( sd.x > 1e-6 ) umax = min( umax, ( 1.0 - s0.x ) / sd.x ); else if ( sd.x < -1e-6 ) umax = min( umax, -s0.x / sd.x );
  if ( sd.y > 1e-6 ) umax = min( umax, ( 1.0 - s0.y ) / sd.y ); else if ( sd.y < -1e-6 ) umax = min( umax, -s0.y / sd.y );
  float px = length( sd * umax / uTexel );
  float n = clamp( px / 2.0, 1.0, ${SSR_STEPS.toFixed(1)} );
  float du = umax / n;
  float jit = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  float u = du * ( 0.25 + 0.75 * jit );
  float uPrev = 0.0;
  bool hit = false;
  vec2 huv = vec2( 0.0 );
  for ( int i = 0; i < ${SSR_STEPS}; i ++ ) {
    if ( u > umax ) break;
    vec2 suv = s0 + sd * u;
    float zr = -1.0 / mix( k0, k1, u );
    float zp = -1.0 / mix( k0, k1, uPrev );
    float dep = texture2D( tDepth, suv ).x;
    if ( dep < 1.0 ) {
      float sz = viewPos( suv, dep ).z;
      float thick = max( 0.6, abs( zr - zp ) * 1.5 );
      if ( sz > zr && sz - zr < thick ) {
        // bisect between the last two samples
        float a = uPrev;
        float b = u;
        for ( int k = 0; k < 5; k ++ ) {
          float m = 0.5 * ( a + b );
          vec2 um = s0 + sd * m;
          if ( viewPos( um, texture2D( tDepth, um ).x ).z > -1.0 / mix( k0, k1, m ) ) b = m; else a = m;
        }
        huv = s0 + sd * b;
        hit = true;
        break;
      }
    }
    uPrev = u;
    u += du;
  }
  if ( !hit ) return c;
  vec4 hs = texture2D( tScene, huv );
  if ( hs.a < 0.25 ) return c; // reflected water: keep the sky reflection
  // KB-I69: a 3-tap blur across the ripple direction (screen vertical): 1.5 px near, up to 4.5 px where the waves
  // finer than the pixel footprint were faded (the smear a rippled pond gives at grazing views)
  float smear = ( 1.5 + 3.0 * smoothstep( 0.1, 0.6, fp ) ) * uTexel.y;
  hs.rgb = 0.5 * hs.rgb + 0.25 * ( texture2D( tScene, huv + vec2( 0.0, smear ) ).rgb + texture2D( tScene, huv - vec2( 0.0, smear ) ).rgb );
  vec2 e = min( huv, 1.0 - huv );
  float edge = smoothstep( 0.0, 0.06, min( e.x, e.y ) );
  float cosv = clamp( dot( -V, Nv ), 0.0, 1.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - cosv, 5.0 );
  // the material already shows the sky with its own Fresnel; the hit replaces that share of the pixel [I]
  float w = edge * clamp( F * 1.6 + 0.06, 0.0, 0.85 );
  return mix( c, hs.rgb * 0.92, w );
}

vec3 lanternLight( vec3 P ) {
  vec3 Pw = ( uViewInv * vec4( P, 1.0 ) ).xyz;
  bool near = false;
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    if ( i >= uLampCount ) break;
    vec3 L = uLamp[ i ].xyz - Pw;
    if ( dot( L, L ) < ${(LANTERN_REACH * LANTERN_REACH).toFixed(1)} ) near = true;
  }
  if ( !near ) return vec3( 0.0 );
  vec3 n = normalize( mat3( uViewInv ) * viewNormal( vUv, P, uTexel ) );
  float E = 0.0;
  for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
    if ( i >= uLampCount ) break;
    vec3 L = uLamp[ i ].xyz - Pw;
    float dist = length( L );
    if ( dist > ${LANTERN_REACH.toFixed(1)} ) continue;
    // nothing behind the wall the lantern hangs on (its bracket reaches uLampN.w out of the wall)
    float side = dot( Pw - ( uLamp[ i ].xyz - uLampN[ i ].xyz * uLampN[ i ].w ), uLampN[ i ].xyz );
    if ( side < -0.03 ) continue;
    float cosl = max( dot( n, L / max( dist, 1e-3 ) ), 0.0 );
    float w = 1.0 - smoothstep( ${(LANTERN_REACH * 0.6).toFixed(2)}, ${LANTERN_REACH.toFixed(1)}, dist );
    E += uLamp[ i ].w * cosl * w / ( dist * dist + 0.04 );
  }
  return uLampRgb * E;
}

void main() {
  vec4 sc = texture2D( tScene, vUv );
  vec3 c = sc.rgb;
  float skyW = 0.0;
  float goldW = 0.0;
  float d = texture2D( tDepth, vUv ).x;
  if ( d < 1.0 ) {
    vec3 P = viewPos( vUv, d );
    if ( uSsrOn > 0.5 && sc.a < 0.25 ) c = waterReflect( c, P );
    if ( uLampCount > 0 ) c += lanternLight( P );
    if ( uAoOn > 0.5 ) {
      float ao = texture2D( tAO, vUv ).x;
      float l = dot( c, LUMW ) * toneMappingExposure;
      // KB-I92: indoors by day the sky-lit reveals keep more AO (interiorGrade.ts aoBrightFade)
      // (by candle light as before the wave-11 review fix: the indoor weight fades with the night, uIndoorTone2.z)
      float k = uAoStrength * ( 1.0 - skbAoBrightFade( l, uIndoorTone.z * ( 1.0 - uIndoorTone2.z ) ) );
      c *= mix( 1.0, ao, k );
    }
  } else if ( uSkyGrade.x > 0.0 ) {
    // Kino sky (wave-6 review): weight of a luminance-keeping shift toward a clear July blue after the tone mapping
    // (AgX greys bright blues), strongest high up and away from the sun; the sun side keeps its warm glow. From the air
    // the haze below the mathematical horizon (down to ≈ −6°) is sky too, so the base weight reaches below it
    vec3 Vw = normalize( mat3( uViewInv ) * viewPos( vUv, 1.0 ) );
    float anti = 0.5 - 0.5 * dot( Vw, uSkyGrade.yzw );
    // KB-I06: at the golden hour the sky toward the sun glows gold low down instead of bleaching beige-grey, and the
    // high sky on the sun side keeps the full blue (the low sun is far below it)
    float toward = 1.0 - anti;
    float golden = uSkyGold * ${(1 / KINO_SKY_GOLD_MAX).toFixed(4)};
    float sunSide = mix( mix( 0.25, 1.0, anti * anti ), 1.0, golden * smoothstep( 0.12, 0.4, Vw.y ) );
    skyW = uSkyGrade.x * smoothstep( -0.16, -0.06, Vw.y ) * mix( 0.45, 1.0, smoothstep( 0.0, 0.14, Vw.y ) ) * sunSide;
    goldW = uSkyGold * toward * toward * toward * smoothstep( -0.16, -0.04, Vw.y ) * ( 1.0 - smoothstep( 0.03, 0.3, Vw.y ) );
    skyW *= 1.0 - goldW;
  }
  c += texture2D( tBloom, vUv ).rgb * uBloom;
  // KB-I75: indoors by day the sun pools and the window light roll off before the tone mapping (interiorGrade.ts)
  if ( uIndoorTone.z > 0.0 ) c = skbIndoorShoulder( c, toneMappingExposure, uIndoorTone, uIndoorTone2 );
  if ( uGrade[ 0 ].x > 0.0 ) c = skbNightVision( c );
#ifdef TM_AGX
  c = AgXToneMapping( c );
#else
  c = NeutralToneMapping( c );
#endif
  if ( skyW > 0.0 ) c = mix( c, dot( c, LUMW ) * vec3( ${KINO_SKY_BLUE.map((v) => v.toFixed(4)).join(', ')} ), skyW );
  if ( goldW > 0.0 ) c = mix( c, dot( c, LUMW ) * vec3( ${KINO_SKY_GOLD.map((v) => v.toFixed(4)).join(', ')} ), goldW );
  if ( uVignette > 0.0 ) {
    vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
    c *= 1.0 - uVignette * smoothstep( 0.35, 1.05, length( q ) );
  }
  gl_FragColor = vec4( c, 1.0 );
  if ( uDebug > 0.5 ) gl_FragColor = vec4( vec3( texture2D( tAO, vUv ).x ), 1.0 );
  if ( uDebug > 1.5 && d < 1.0 ) {
    vec3 P = viewPos( vUv, d );
    gl_FragColor = uDebug > 2.5 ? vec4( viewNormal( vUv, P, uTexel ) * 0.5 + 0.5, 1.0 ) : vec4( vec3( fract( -P.z / 2.0 ) ), 1.0 );
  }
  if ( uEncode > 0.5 ) gl_FragColor = sRGBTransferOETF( gl_FragColor );
  else gl_FragColor = linearToOutputTexel( gl_FragColor );
}`;

function quadMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
}

function halfTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
}

export interface LampSpot {
  /** lamp centre (local frame) */
  p: THREE.Vector3;
  /** outward wall normal (horizontal) */
  n: THREE.Vector3;
  /** distance of the lamp centre from the wall plane (m) */
  out: number;
  /** luminous intensity (cd); default LANTERN_CD (wave-10 review fix: the table candles indoors are 1–3 cd) */
  cd?: number;
}

export class PostChain {
  settings: PostSettings;
  look: PostLook = 'doku';
  /** night factor 0…1 (bloom threshold) */
  night = 0;
  /** pre-exposure of the current light (cd/m² → display), for the lantern light */
  pre = 1;
  /** lantern level 0…1 (0 by day) */
  lampLevel = 0;
  /** linear colour of the lantern light (luminance ≈ 1) */
  readonly lampColour = new THREE.Color(1, 0.6, 0.3);
  /** a still is being exposed: no SMAA (the accumulation antialiases), no MSAA */
  still = false;
  /** AO strength (A/B: 0) and intensity */
  aoStrength = 0.85;
  aoIntensity = 4.5;
  /** debug view: 1 = the AO buffer */
  debug = 0;
  /**
   * Bench only (`skb.post.bypass = true`): render straight to the canvas with the tone mapping in the materials, as
   * before KB-I41 (but without MSAA: the canvas has none now), so the chain's cost can be measured in one session.
   * Switching recompiles every material once.
   */
  bypass = false;
  /** water time (s) for the ripples; advanced by `tick` */
  time = 0;
  /** The camera stands inside a building: small-radius AO (AO_INDOOR) and the indoor highlight shoulder by day (KB-I75). Set by the viewer per frame. */
  indoor = false;
  /** KB-I75 A/B switch for the indoor highlight shoulder (`skb.post.indoorShoulder = false`). */
  indoorShoulder = true;
  /** The sky dome; when set, it is shaded at reduced resolution as the scene's background (KB-I65). */
  sky: THREE.Object3D | null = null;
  /** Unit vector toward the sun (local frame), for the Kino sky grade. */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** A/B switch of the reduced-resolution sky (`skb.post.skyLowRes = false`). */
  skyLowRes = true;
  /** A/B switch of the cached sky cube (`skb.post.skyCache = false`: the per-frame small target, as in wave 6). */
  skyCache = true;
  /** Sky cube strips shaded so far (SKY_CUBE_TILES per face; debug / bench: re-shading must be rare). */
  skyCubeRenders = 0;

  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private sceneSamples = -1;
  private aoA: THREE.WebGLRenderTarget | null = null;
  private aoB: THREE.WebGLRenderTarget | null = null;
  private bloomRT: THREE.WebGLRenderTarget[] = [];
  private ldrRT: THREE.WebGLRenderTarget | null = null;
  private skyRT: THREE.WebGLRenderTarget | null = null;
  private readonly skyProxy: THREE.ShaderMaterial;
  private readonly skyCubeProxy: THREE.ShaderMaterial;
  private skyCube: THREE.WebGLCubeRenderTarget | null = null;
  private skyCubeCam: THREE.CubeCamera | null = null;
  /** signature of the sky uniforms the cube holds ('' = none) */
  private skyCubeKey = '';
  /** signature being shaded, and its faces done */
  private skyCubePending = '';
  private skyCubeFaces = 0; // strips done (0 … 6 · SKY_CUBE_TILES)
  /** uniform numbers of the complete cube (for the small-change test) */
  private skyCubeNumbers: number[] = [];
  private readonly texel = new THREE.Vector2();
  private smaa: SMAAPass | null = null;
  private readonly white: THREE.DataTexture;
  private readonly black: THREE.DataTexture;
  private w = 0;
  private h = 0;
  private aoSamples = -1;
  private aoMat: THREE.ShaderMaterial | null = null;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly prefilterMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly gradeMat: THREE.ShaderMaterial;
  private lamps: LampSpot[] = [];
  private readonly size = new THREE.Vector2();
  /** GPU passes of the last frame (debug) */
  passes = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    settings: PostSettings,
  ) {
    this.settings = { ...settings };
    renderer.info.autoReset = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.skyProxy = new THREE.ShaderMaterial({ vertexShader: SKY_PROXY_VERT, fragmentShader: SKY_PROXY_FRAG, uniforms: { tSky: { value: null }, uInvRes: { value: new THREE.Vector2() } }, side: THREE.BackSide, depthWrite: false, toneMapped: false });
    this.skyCubeProxy = new THREE.ShaderMaterial({ vertexShader: SKY_CUBE_VERT, fragmentShader: SKY_CUBE_FRAG, uniforms: { tSkyCube: { value: null } }, side: THREE.BackSide, depthWrite: false, toneMapped: false });
    this.blurMat = quadMaterial(BLUR_FRAG, { tAO: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.prefilterMat = quadMaterial(PREFILTER_FRAG, { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: new THREE.Vector3() } });
    this.downMat = quadMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = quadMaterial(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat.blending = THREE.AdditiveBlending;
    this.upMat.transparent = true;
    const lampP = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4());
    const lampN = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4());
    this.gradeMat = quadMaterial(GRADE_FRAG, {
      tScene: { value: null },
      tDepth: { value: null },
      tAO: { value: this.white },
      tBloom: { value: this.black },
      uTexel: { value: new THREE.Vector2() },
      uProjInv: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uAoOn: { value: 0 },
      uAoStrength: { value: 0 },
      uBloom: { value: 0 },
      uTime: { value: 0 },
      uSsrOn: { value: 0 },
      uLamp: { value: lampP },
      uLampN: { value: lampN },
      uLampCount: { value: 0 },
      uLampRgb: { value: new THREE.Vector3() },
      uVignette: { value: 0 },
      uAspect: { value: 1 },
      uEncode: { value: 0 },
      uDebug: { value: 0 },
      uSkyGrade: { value: new THREE.Vector4() },
      uSkyGold: { value: 0 },
      uIndoorTone: { value: new THREE.Vector3() },
      uIndoorTone2: { value: new THREE.Vector3(INDOOR_TONE.knee2, INDOOR_TONE.s2, 0) },
      uGrade: { value: gradeData },
      toneMappingExposure: { value: 1 },
    });
  }

  /** Lanterns that light their surroundings at night (night.ts). At most MAX_LAMPS are used. */
  setLamps(spots: LampSpot[]): void {
    this.lamps = spots.slice(0, MAX_LAMPS);
    const u = this.gradeMat.uniforms;
    this.lamps.forEach((s, i) => {
      (u.uLamp.value as THREE.Vector4[])[i].set(s.p.x, s.p.y, s.p.z, s.cd ?? LANTERN_CD);
      (u.uLampN.value as THREE.Vector4[])[i].set(s.n.x, s.n.y, s.n.z, s.out);
    });
  }

  /** Advance the water ripples (only by the frame's dt: deterministic under `skb.step`, KB-I64). */
  tick(dt: number): void {
    this.time = advanceClock(this.time, dt);
    waterTime.value = this.time;
  }

  /** Restart the water clock (a new place: the same pose renders the same frame whatever ran before, KB-I64). */
  resetTime(): void {
    this.time = 0;
    waterTime.value = 0;
  }

  private ensure(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    const samples = this.still ? 0 : sceneMsaa(this.settings.msaa, w * h);
    if (!this.sceneRT || this.sceneSamples !== samples) {
      this.sceneRT?.dispose();
      this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      // 32-bit float depth: 24-bit depth quantises the terrain at aerial distances into steps the AO and the water
      // reflection would read as relief
      this.sceneRT.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
      this.sceneSamples = samples;
      this.w = 0;
    }
    if (this.aoSamples !== this.settings.aoSamples) {
      this.aoMat?.dispose();
      this.aoMat = null;
      this.aoSamples = this.settings.aoSamples;
    }
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.sceneRT.setSize(w, h);
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    const ad = aoDivisor(w * h);
    const aw = Math.max(1, Math.round(w / ad));
    const ah = Math.max(1, Math.round(h / ad));
    if (!this.aoA) {
      this.aoA = halfTarget(aw, ah);
      this.aoB = halfTarget(aw, ah);
    } else {
      this.aoA.setSize(aw, ah);
      this.aoB!.setSize(aw, ah);
    }
    const ss = skyScale(w * h);
    const sw = Math.max(1, Math.round(w * ss));
    const sh = Math.max(1, Math.round(h * ss));
    if (!this.skyRT) this.skyRT = halfTarget(sw, sh);
    else this.skyRT.setSize(sw, sh);
    for (const t of this.bloomRT) t.dispose();
    this.bloomRT = [];
    let bw = hw;
    let bh = hh;
    for (let i = 0; i < 5; i++) {
      this.bloomRT.push(halfTarget(bw, bh));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    this.ldrRT?.setSize(w, h);
    this.smaa?.setSize(w, h);
  }

  private pass(mat: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
    this.passes++;
  }

  private aoMaterial(): THREE.ShaderMaterial {
    if (!this.aoMat) {
      this.aoMat = quadMaterial(
        AO_FRAG,
        {
          tDepth: { value: null },
          uProjInv: { value: new THREE.Matrix4() },
          uTexel: { value: new THREE.Vector2() },
          uProjScale: { value: 1 },
          uRadius: { value: new THREE.Vector4() },
          uMaxPx: { value: 64 },
          uIntensity: { value: 1 },
          uFade: { value: new THREE.Vector2(900, 1600) },
        },
        { AO_SAMPLES: Math.max(4, this.settings.aoSamples) },
      );
    }
    return this.aoMat;
  }

  /** Render the scene through the chain to the canvas (or the current photo frame). */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const r = this.renderer;
    r.info.reset();
    this.passes = 0;
    const toneMap = this.bypass ? (this.look === 'kino' ? THREE.AgXToneMapping : THREE.NeutralToneMapping) : THREE.NoToneMapping;
    if (r.toneMapping !== toneMap) r.toneMapping = toneMap;
    if (this.bypass) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    this.ensure();
    const s = this.settings;
    const sceneRT = this.sceneRT!;
    const autoClear = r.autoClear;
    const clearAlpha = r.getClearAlpha();
    r.setClearAlpha(1);
    const sky = this.sky as THREE.Mesh | null;
    // indoors the dome is hidden behind the walls: drawn last at full resolution it costs nothing, a sky pass would
    const lowSky = !!sky && sky.visible && this.skyLowRes && !this.still && !this.indoor;
    if (lowSky && this.skyCubeReady(sky)) {
      // KB-I65 wave 7: the dome reads the cached cube; no sky shading this frame
      const skyMat = sky.material;
      this.skyCubeProxy.uniforms.tSkyCube.value = this.skyCube!.texture;
      sky.material = this.skyCubeProxy;
      r.setRenderTarget(sceneRT);
      r.render(scene, camera);
      sky.material = skyMat;
    } else if (lowSky) {
      // KB-I65: the sky alone into its small target; in the scene pass the dome reads it back per pixel
      r.setRenderTarget(this.skyRT);
      // wave-10 review fix: the cumulus take a cheaper march here (atmosphere.ts uCloudFast); only while a jump refreshes
      // the cube (or with the cache off), and set after the cube's key was taken, so the key never sees it
      const fast = (sky.material as THREE.ShaderMaterial).uniforms?.uCloudFast;
      if (fast) fast.value = 1;
      r.render(sky, camera);
      if (fast) fast.value = 0;
      this.passes++;
      const skyMat = sky.material;
      this.skyProxy.uniforms.tSky.value = this.skyRT!.texture;
      this.skyProxy.uniforms.uInvRes.value.set(1 / this.w, 1 / this.h);
      sky.material = this.skyProxy;
      r.setRenderTarget(sceneRT);
      r.render(scene, camera);
      sky.material = skyMat;
    } else {
      r.setRenderTarget(sceneRT);
      r.render(scene, camera);
    }
    r.setClearAlpha(clearAlpha);
    const depth = sceneRT.depthTexture!;
    camera.updateMatrixWorld();
    const projInv = camera.projectionMatrixInverse;
    const exposure = r.toneMappingExposure;
    const texel = this.texel.set(1 / this.w, 1 / this.h);

    // ---- AO
    const ao = s.ao && this.aoStrength > 0;
    if (ao) {
      const m = this.aoMaterial();
      const u = m.uniforms;
      u.tDepth.value = depth;
      u.uProjInv.value.copy(projInv);
      u.uTexel.value.copy(texel);
      u.uProjScale.value = camera.projectionMatrix.elements[5] * 0.5 * this.h;
      const r0 = aoRadius(0);
      if (this.indoor) u.uRadius.value.set(AO_INDOOR.radius, 0, AO_INDOOR.radius, AO_INDOOR.radius);
      else u.uRadius.value.set(r0, (aoRadius(100) - r0) / 100, aoRadius(0), aoRadius(1e6));
      u.uMaxPx.value = Math.max(24, 0.06 * this.h);
      u.uIntensity.value = this.aoIntensity;
      this.pass(m, this.aoA);
      const bu = this.blurMat.uniforms;
      bu.tAO.value = this.aoA!.texture;
      bu.uStep.value.set(1 / this.aoA!.width, 0);
      this.pass(this.blurMat, this.aoB);
      bu.tAO.value = this.aoB!.texture;
      bu.uStep.value.set(0, 1 / this.aoA!.height);
      this.pass(this.blurMat, this.aoA);
    }

    // ---- bloom
    const bloom = s.bloom;
    if (bloom) {
      const pu = this.prefilterMat.uniforms;
      pu.tScene.value = sceneRT.texture;
      pu.uTexel.value.copy(texel);
      const thr = bloomThreshold(this.night);
      pu.uThr.value.set(thr, thr * 0.25, exposure);
      this.pass(this.prefilterMat, this.bloomRT[0]);
      const du = this.downMat.uniforms;
      for (let i = 1; i < this.bloomRT.length; i++) {
        const src = this.bloomRT[i - 1];
        du.tSrc.value = src.texture;
        du.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.downMat, this.bloomRT[i]);
      }
      r.autoClear = false;
      const uu = this.upMat.uniforms;
      for (let i = this.bloomRT.length - 1; i > 0; i--) {
        const src = this.bloomRT[i];
        uu.tSrc.value = src.texture;
        uu.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.upMat, this.bloomRT[i - 1]);
      }
      r.autoClear = autoClear;
    }

    // ---- grade (+ water, lanterns, AO, bloom, tone mapping)
    const smaa = s.smaa && !this.still;
    const g = this.gradeMat.uniforms;
    g.tScene.value = sceneRT.texture;
    g.tDepth.value = depth;
    g.tAO.value = ao ? this.aoA!.texture : this.white;
    g.tBloom.value = bloom ? this.bloomRT[0].texture : this.black;
    g.uTexel.value.copy(texel);
    g.uProjInv.value.copy(projInv);
    g.uProj.value.copy(camera.projectionMatrix);
    g.uView.value.copy(camera.matrixWorldInverse);
    g.uViewInv.value.copy(camera.matrixWorld);
    g.uAoOn.value = ao ? 1 : 0;
    g.uAoStrength.value = this.indoor ? Math.min(this.aoStrength, AO_INDOOR.strength) : this.aoStrength;
    // bloom is accumulated in exposed units; the grade adds it before the exposure
    g.uBloom.value = bloom ? bloomStrength(this.night, this.indoor) / Math.max(exposure, 1e-6) : 0;
    g.uTime.value = this.time;
    g.uSsrOn.value = s.ssr ? 1 : 0;
    const lampOn = this.lampLevel > 0.01 && this.lamps.length > 0;
    g.uLampCount.value = lampOn ? this.lamps.length : 0;
    // luminance = E · ρ / π, pre-exposed
    const k = (this.lampLevel * this.pre * LANTERN_ALBEDO) / Math.PI;
    g.uLampRgb.value.set(this.lampColour.r * k, this.lampColour.g * k, this.lampColour.b * k);
    g.uVignette.value = vignetteFor(this.look);
    g.uAspect.value = this.w / this.h;
    g.uEncode.value = smaa ? 1 : 0;
    g.uDebug.value = this.debug;
    g.uSkyGrade.value.set(kinoSkyStrength(this.look, this.sunDir.y), this.sunDir.x, this.sunDir.y, this.sunDir.z);
    g.uSkyGold.value = kinoSkyGold(this.look, this.sunDir.y);
    g.toneMappingExposure.value = exposure;
    // KB-I75: the indoor shoulder; wave-11 review fix: also by candle light, as one softer stage (indoorToneParams), so
    // the lit marble next to a flame keeps its falloff and the flames still reach near white
    const tone = indoorToneParams(this.night);
    g.uIndoorTone.value.set(tone.knee, tone.s, this.indoor && this.indoorShoulder ? 1 : 0);
    g.uIndoorTone2.value.set(tone.knee2, tone.s2, tone.peak);
    const tm = this.look === 'kino' ? 'TM_AGX' : 'TM_NEUTRAL';
    if (!(tm in this.gradeMat.defines)) {
      this.gradeMat.defines = { [tm]: '' };
      this.gradeMat.needsUpdate = true;
    }
    if (smaa) {
      if (!this.ldrRT) this.ldrRT = new THREE.WebGLRenderTarget(this.w, this.h, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      if (!this.smaa) {
        this.smaa = new SMAAPass();
        this.smaa.setSize(this.w, this.h);
        this.smaa.renderToScreen = true;
      }
      this.pass(this.gradeMat, this.ldrRT);
      this.smaa.render(r, this.ldrRT, this.ldrRT, 0, false);
      this.passes += 3;
    } else this.pass(this.gradeMat, null);
    r.setRenderTarget(null);
  }

  /**
   * KB-I65 wave 7: true when the sky cube may stand for the dome this frame. When the uniforms changed, shade the next
   * face(s) of the new state (SKY_CUBE_FACES_PER_FRAME); a small change (running clock, tour) keeps showing the
   * complete previous cube meanwhile, a jump uses the per-frame sky until all six faces are done. A steady view never
   * shades the sky.
   */
  private skyCubeReady(sky: THREE.Mesh): boolean {
    if (!this.skyCache) return false;
    const mat = sky.material as THREE.ShaderMaterial;
    const values = Object.values(mat.uniforms).map((u) => u.value);
    const key = uniformSignature(values);
    if (key === this.skyCubeKey) return true;
    const numbers = uniformNumbers(values);
    const stale = this.skyCubeKey !== '' && smallUniformChange(this.skyCubeNumbers, numbers);
    if (key !== this.skyCubePending && !(stale && this.skyCubeFaces > 0 && this.skyCubeFaces < 6 * SKY_CUBE_TILES)) {
      // a new state; a refresh under way for a small change runs on (its faces differ by less than the tolerance)
      this.skyCubePending = key;
      this.skyCubeFaces = 0;
    }
    if (!this.skyCube) {
      this.skyCube = new THREE.WebGLCubeRenderTarget(SKY_CUBE_SIZE, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.skyCubeCam = new THREE.CubeCamera(1, 40000, this.skyCube);
    }
    const r = this.renderer;
    const cc = this.skyCubeCam!;
    if (cc.coordinateSystem !== r.coordinateSystem) {
      cc.coordinateSystem = r.coordinateSystem;
      cc.updateCoordinateSystem();
    }
    // the dome is centred on the camera and direction-only: shade it from its own centre
    cc.position.copy(sky.position);
    cc.updateMatrixWorld(true);
    // wave-10 review fix: one scissored strip of a face per frame (SKY_CUBE_TILES), so a refresh never spikes
    const steps = 6 * SKY_CUBE_TILES;
    const rt = this.skyCube;
    for (let k = 0; k < SKY_CUBE_FACES_PER_FRAME && this.skyCubeFaces < steps; k++) {
      const tile = skyCubeTile(this.skyCubeFaces);
      rt.scissor.set(0, tile.y, SKY_CUBE_SIZE, tile.h);
      rt.scissorTest = true;
      r.setRenderTarget(rt, tile.face);
      r.render(sky, cc.children[tile.face] as THREE.Camera);
      rt.scissorTest = false;
      this.skyCubeFaces++;
      this.skyCubeRenders++;
      this.passes++;
    }
    if (this.skyCubeFaces < steps) return stale;
    this.skyCubeKey = key;
    this.skyCubeNumbers = numbers;
    this.skyCubeFaces = 0;
    this.skyCubePending = '';
    return true;
  }

  /** Read back the pre-exposed HDR value at a canvas pixel of the last frame (debug / tests in the browser). */
  probe(x: number, y: number): number[] {
    const px = new Uint16Array(4);
    if (!this.sceneRT) return [];
    this.renderer.readRenderTargetPixels(this.sceneRT, Math.floor(x), Math.floor(this.h - 1 - y), 1, 1, px);
    return [...px].map((v) => THREE.DataUtils.fromHalfFloat(v));
  }

  dispose(): void {
    this.sceneRT?.dispose();
    this.aoA?.dispose();
    this.aoB?.dispose();
    for (const t of this.bloomRT) t.dispose();
    this.ldrRT?.dispose();
    this.skyRT?.dispose();
    this.skyCube?.dispose();
    this.smaa?.dispose();
    this.aoMat?.dispose();
    for (const m of [this.skyProxy, this.skyCubeProxy, this.blurMat, this.prefilterMat, this.downMat, this.upMat, this.gradeMat]) m.dispose();
  }
}

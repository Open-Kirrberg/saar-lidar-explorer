/**
 * Foliage shading for every 'vegetation.leaf' material (backlog KB-I44; visual-audit §5.6 V1/V2, P10;
 * skb-visual-wow materials-vegetation-water.md §5). One `onBeforeCompile` patch, chained onto any earlier one
 * (sky-SH diffuse, leaf saturation), cheap at every LOD:
 *
 * - **crown occlusion** from the per-vertex `crown` attribute (xyz = position in the crown envelope, about −1..1;
 *   w = clump random 0..0.98, −1 on branch limbs): darker toward the crown's inside and underside, on the sky light
 *   in full and on the sun in part (the shadow map is too coarse for self-shadowing inside a crown) [I];
 * - **per-clump variation**: brightness and a yellower top (young shoots) on top of the per-instance hue jitter [I];
 * - **leaf clusters near the camera**: a value noise in crown-envelope space (about 1/9 of the crown radius, offset
 *   per instance, continuous across clumps) darkens gaps between leaf clusters; faded out by its screen-space
 *   derivative so it never shimmers at a distance [I]. Wave-3 review: the noise was offset per clump and the rim
 *   terms used the clump normal, so every clump repeated the same dark-centre / bright-rim spot ("polka dots");
 * - **crown-level shading**: the rim (back-light, silhouette weighting) uses the crown envelope normal (`vFolEnvN`,
 *   transformed like a normal through the instance matrix), and the shading normal leans a further 45 % toward it,
 *   so a crown reads as one mass with clumps, not as a pile of separately lit balls [I];
 * - **wrap diffuse** `max(0, (N·L + w) / (1 + w))` and **back-light** `pow(V·−L, 4)` weighted toward the silhouette,
 *   which gives the golden-hour glow of a crown seen against the sun (GPU Gems 3 ch. 16; Barré-Brisebois & Bouchard,
 *   "Approximating translucency for a fast, cheap and convincing subsurface scattering look", GDC 2011);
 * - **wind**: a gentle bend of the crown by height plus a small per-clump flutter, in the vertex shader after the
 *   instance transform (Sousa, GPU Gems 3 ch. 16). Time comes from `tickFoliage(dt)` in the frame loop, so
 *   `skb.step` stays deterministic. The shadow pass does not sway (amplitude ≤ ~10 cm; the shadow map is cached).
 *
 * Geometry without the `crown` attribute reads WebGL's default (0, 0, 0, 1): w = 1 switches every term off.
 *
 * **Leaf cards** (wave 6, leafCards.ts): materials with the define `FOL_CARD` expand each quad around its anchor in view
 * space (attribute `card` = corner xy, size in crown object units × the instance's horizontal scale, rotation), shrink
 * it away between 0.78 and 1 × its fade distance (× `uCardFar`), bulge the shading normal toward the card's corners (each card shades as a
 * small rounded leaf cluster), keep the alpha of distant mip levels (alpha to coverage would thin them out; Golus,
 * "Anti-aliased alpha test: the esoteric alpha to coverage", 2017) and take a little more back-light (thin leaves).
 */
import * as THREE from 'three';
import { FINE_CARD } from './leafAtlas.ts';

/** Shared uniforms (one set for all leaf materials). */
export const foliageUniforms = {
  uFolTime: { value: 0 },
  /** wind strength 0..1 (0 = calm) */
  uFolWind: { value: 0.55 },
  /** wrap width w of the wrapped diffuse */
  uFolWrap: { value: 0.45 },
  /** back-light (translucency) strength */
  uFolTrans: { value: 1.1 },
  /** 0 = plain leaves (A/B switch for reviews), 1 = foliage shading */
  uFolOn: { value: 1 },
  /** leaf cards: scale of the per-card fade distance (leafCards.ts LEAF_CARD_FAR / FOREST_CARD_FAR); 0 = no cards */
  uCardFar: { value: 1 },
  /**
   * KB-I76 leaf cards: x = card edge (m) from which a card takes the fine atlas half, y = distance (m, ±25 % per card)
   * within which it does (leafAtlas.ts FINE_CARD); x = 1e9 switches the fine tiles off (A/B)
   */
  uCardFine: { value: new THREE.Vector2(FINE_CARD.minSize, FINE_CARD.dist) },
  /** leaf cards: brightness match of the atlas grey to the crown albedo */
  uCardGain: { value: 1.22 },
  /** KB-I66 residual (wave 7): leaf-cluster relief of the mid / far forest domes (FOL_MID); 0 = off (A/B) */
  uFolMid: { value: 1 },
  /** FOL_MID: relief height (m) of the leaf clusters (bumped normal) */
  uFolBump: { value: 0.4 },
  /** FOL_MID: cluster frequency (per crown-envelope unit) of the finest of three octaves (x; y, z unused) */
  uFolMidFreq: { value: new THREE.Vector3(18, 0, 0) },
  /** FOL_MID: weights of the three octaves (fine, middle, coarse) */
  uFolMidOct: { value: new THREE.Vector3(0.55, 0.35, 0.15) },
  /** FOL_MID: gap darkening: albedo at the gaps, smoothstep half width, and the cluster height where gaps end */
  uFolMidGap: { value: new THREE.Vector3(0.55, 0.18, 0.42) },
};

/** Advance the wind clock (seconds). Called once per rendered frame with the frame's dt. */
export function tickFoliage(dt: number): void {
  foliageUniforms.uFolTime.value = (foliageUniforms.uFolTime.value + dt) % 3600;
}

/** Wrapped diffuse factor (energy-normalised Lambert wrap), mirrored by the shader. */
export function wrapDiffuse(nl: number, w: number): number {
  return Math.max(0, (nl + w) / (1 + w));
}

/**
 * Crown occlusion of a point at `o` in the crown envelope (|o| ≈ 1 on the surface, o.y up), mirrored by the shader:
 * 0.32 deep inside, 1 on the outer surface; ×0.62 at the underside.
 */
export function crownOcclusion(o: readonly [number, number, number]): number {
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const r = Math.hypot(o[0], o[1], o[2]);
  return (0.32 + 0.68 * s(0.25, 1.0, r)) * (0.62 + 0.38 * s(-0.9, 0.5, o[1]));
}

const VERT_PARS = /* glsl */ `
attribute vec4 crown;
varying vec4 vCrown;
varying vec3 vFolEnvN;
varying float vFolSeed;
uniform float uFolTime;
uniform float uFolWind;
uniform float uFolOn;
#ifdef FOL_CARD
attribute vec4 card;
varying vec2 vCardC;
uniform float uCardFar;
uniform vec2 uCardFine;
#endif
`;

/** project_vertex of three r187 with the wind added after the instance transform. */
const VERT_PROJECT = /* glsl */ `
vCrown = crown;
vec3 folEnv = crown.xyz + vec3( 0.0, 1e-3, 0.0 );
vFolSeed = 0.0;
#ifdef USE_INSTANCING
	// envelope normal through the instance matrix like a normal (inverse-transpose of rotation · scale)
	mat3 folIm = mat3( instanceMatrix );
	folEnv = folIm * ( folEnv / vec3( dot( folIm[ 0 ], folIm[ 0 ] ), dot( folIm[ 1 ], folIm[ 1 ] ), dot( folIm[ 2 ], folIm[ 2 ] ) ) );
	vFolSeed = fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
#endif
vFolEnvN = normalize( normalMatrix * folEnv );
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	if ( crown.w < 0.999 && uFolOn > 0.5 ) {
		// height in the crown 0 (base) .. 1 (top); branches (w < 0) bend with the crown
		float fh = clamp( crown.y * 0.5 + 0.5, 0.0, 1.0 );
		vec3 ic = instanceMatrix[ 3 ].xyz;
		float fr = length( mvPosition.xyz - ic ); // ~ crown radius (m): big trees bend more
		float ph = dot( ic.xz, vec2( 0.071, 0.053 ) );
		float t = uFolTime;
		float bend = ( 0.6 * sin( t * 1.1 + ph ) + 0.4 * sin( t * 1.9 + ph * 1.7 ) + 0.35 ) * uFolWind * 0.011 * fr * fh * fh;
		float flutter = sin( t * 6.3 + crown.w * 61.0 + ph ) * uFolWind * 0.025 * fh;
		// prevailing south-west wind [N Saarland climate]: toward the north-east (local +x, −z)
		mvPosition.xyz += vec3( 0.8, 0.0, -0.6 ) * bend + vec3( flutter, flutter * 0.5, -flutter * 0.7 );
	}
	#ifdef FOL_FADE
	{
		// KB-I35 (wave 7): camera-following sets (vines.ts) shrink into their instance origin over the last FOL_FADE_W m
		// of FOL_FADE m (wave-7 review fix: 60 m instead of 34 m, while the ground paints their far cover)
		#ifndef FOL_FADE_W
			#define FOL_FADE_W ( FOL_FADE * 0.2 )
		#endif
		vec3 fio = instanceMatrix[ 3 ].xyz;
		float ff = 1.0 - smoothstep( FOL_FADE - FOL_FADE_W, FOL_FADE, distance( ( modelMatrix * vec4( fio, 1.0 ) ).xyz, cameraPosition ) );
		mvPosition.xyz = fio + ( mvPosition.xyz - fio ) * ff;
	}
	#endif
#endif
mvPosition = modelViewMatrix * mvPosition;
#ifdef FOL_CARD
{
	// camera-facing leaf card around its anchor: size in crown object units × the horizontal instance scale
	float cs = card.z * sqrt( length( modelMatrix[ 0 ].xyz ) * length( modelMatrix[ 2 ].xyz ) );
	#ifdef USE_INSTANCING
		cs *= sqrt( length( instanceMatrix[ 0 ].xyz ) * length( instanceMatrix[ 2 ].xyz ) );
	#endif
	// card.xy = corner (±1) × fade distance / 100 m (leafCards.ts); uCardFar scales it (A/B)
	float cfar = abs( card.x ) * 100.0 * uCardFar;
	vec2 cc = sign( card.xy );
	float cdist = length( mvPosition.xyz ); // of the anchor (all four corners alike)
	float cfade = 1.0 - smoothstep( cfar * 0.78, cfar, cdist );
	#ifdef FOL_FRINGE
		// KB-I66 residual (wave 7): fringe cards of the mid domes open only on the silhouette (anchor normal across the
		// view ray), and not within ~50 m (the close and hero tiers are there)
		cfade *= smoothstep( 0.45, 0.8, 1.0 - abs( dot( normalize( transformedNormal ), normalize( - mvPosition.xyz ) ) ) ) * smoothstep( 40.0, 70.0, length( mvPosition.xyz ) );
	#endif
	float ca = cos( card.w );
	float sa = sin( card.w );
	vec2 cr = vec2( ca * cc.x - sa * cc.y, sa * cc.x + ca * cc.y );
	mvPosition.xy += cr * ( 0.5 * cs * cfade );
	vCardC = cr;
	#ifdef USE_MAP
	{
		// KB-I76: big cards near the camera take the fine twin of their spray (right half of the 2:1 atlas), so their
		// leaves stay hand-sized; the switch distance varies ±25 % per card (its rotation as the random), so no band of
		// switching cards. Every vertex of a card shares the anchor and the rotation: a smooth varying stays constant
		// over the card (no flat varyings, KB-I65)
		float fineD = uCardFine.y * ( 0.75 + 0.5 * fract( card.w * 7.31 ) );
		float fine = step( uCardFine.x, cs ) * ( 1.0 - step( fineD, cdist ) );
		vMapUv.x = vMapUv.x * 0.5 + 0.5 * fine;
	}
	#endif
}
#endif
gl_Position = projectionMatrix * mvPosition;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vCrown;
varying vec3 vFolEnvN;
varying float vFolSeed;
vec3 folEnvN = vec3( 0.0, 0.0, 1.0 );
uniform float uFolWrap;
uniform float uFolTrans;
uniform float uFolOn;
uniform float uCardFar;
#ifdef FOL_CARD
varying vec2 vCardC;
uniform float uCardGain;
#endif
#ifdef FOL_MID
uniform float uFolMid;
uniform float uFolBump;
uniform vec3 uFolMidFreq;
uniform vec3 uFolMidOct;
uniform vec3 uFolMidGap;
float folMidH = 0.5;
float folMidF = 0.0;
float folMidB = 0.0;
// wave 8: weight of the mean-albedo stand-in of the relief (on wherever FOL_MID is, independent of its far fade)
float folMidW = 0.0;
#endif
float folOccDirect = 1.0;
float folLeaf = 1.0;
float folHash( vec3 p ) {
	p = fract( p * 0.1031 );
	p += dot( p, p.zyx + 31.32 );
	return fract( ( p.x + p.y ) * p.z );
}
float folNoise( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( mix( folHash( i ), folHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( folHash( i + vec3( 0, 1, 0 ) ), folHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( folHash( i + vec3( 0, 0, 1 ) ), folHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( folHash( i + vec3( 0, 1, 1 ) ), folHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
		f.z );
}
`;

/** RE_Direct for leaves: wrapped diffuse, a weak sheen, and back-light toward the silhouette. */
const FRAG_DIRECT = /* glsl */ `
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	if ( folLeaf < 0.5 ) {
		RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		return;
	}
	float nl = dot( geometryNormal, directLight.direction );
	float wnl = max( 0.0, ( nl + uFolWrap ) / ( 1.0 + uFolWrap ) );
	reflectedLight.directDiffuse += wnl * folOccDirect * directLight.color * BRDF_Lambert( material.diffuseContribution );
	#if ! defined( FOL_CARD ) || defined( FOL_GLOSS )
	// (cards: no GGX lobe; at roughness 0.9 it is invisible on a leaf cluster and the cards are the overdraw; glossy
	// citrus cards keep it)
	reflectedLight.directSpecular += saturate( nl ) * folOccDirect * directLight.color * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ) * material.multiScatteringCompensation;
	#endif
	// back-light: light scattered through the outer leaves toward the viewer, strongest at the silhouette. The shadow
	// map darkens the crown's far side, so the rim also takes part of the unshadowed sun.
	vec3 lightC = directLight.color;
	#if NUM_DIR_LIGHTS > 0
		vec3 sunC = directionalLights[ 0 ].color;
		float sh = dot( directLight.color, vec3( 1.0 ) ) / max( 1e-5, dot( sunC, vec3( 1.0 ) ) );
		float rimV = 1.0 - saturate( abs( dot( folEnvN, geometryViewDir ) ) );
		lightC = sunC * mix( 0.45 * rimV, 1.0, saturate( sh ) );
	#endif
	float vl = saturate( dot( geometryViewDir, - directLight.direction ) );
	float rim = 1.0 - saturate( abs( dot( folEnvN, geometryViewDir ) ) );
	float tr = vl * vl * vl * vl * ( 0.3 + 0.7 * rim ) * uFolTrans;
	#ifdef FOL_CARD
		tr *= 1.35; // single leaf layers let more light through
	#endif
	reflectedLight.directDiffuse += tr * lightC * BRDF_Lambert( material.diffuseContribution * vec3( 1.05, 1.08, 0.55 ) );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`;

/** After color_fragment: occlusion, per-clump colour, leaf clusters, branch colour. */
const FRAG_COLOUR = /* glsl */ `
float folOcc = 1.0;
#ifdef FOL_MID
{
	// KB-I66 residual (wave 7): leaf clusters on the mid / far domes as an anti-aliased three-octave value noise in
	// crown-envelope space (uFolMidFreq.x, / 2, / 4 per envelope unit, i.e. ≈ 0.4, 0.8 and 1.6 m on a beech crown). Each
	// octave fades out where it falls under ~3 px and the sum is renormalised, so the canopy keeps a leafy grain of a
	// few pixels at every distance until even the coarse octave is unresolved (no shimmer, no camouflage blotches).
	// In uniform control flow, so the relief (FRAG_MID_BUMP) can take screen derivatives of it [I]
	float fwb = length( fwidth( vCrown.xyz ) );
	vec3 bp = vCrown.xyz * uFolMidFreq.x + vFolSeed * 23.0;
	vec3 oa = vec3( 1.0 ) - smoothstep( vec3( 0.3 ), vec3( 0.7 ), fwb * uFolMidFreq.x * vec3( 1.0, 0.5, 0.25 ) );
	// octave weights (fine to coarse) and relief heights ∝ wavelength
	vec3 ow = oa * uFolMidOct;
	float wsum = ow.x + ow.y + ow.z;
	float dd0 = length( vViewPosition );
	// wave 8 (review low, the band at ~320 m in 01 / 08 / Rundflug): the relief fades over 360-640 m (the pixel-footprint
	// fade of the octaves does most of it), and beyond it the domes keep the relief's mean albedo and occlusion
	// (folMidW), so no light, smooth band follows the dappled crowns [I]
	folMidW = smoothstep( 30.0, 60.0, dd0 ) * uFolMid * uFolOn;
	folMidF = smoothstep( 0.04, 0.2, wsum ) * ( 1.0 - smoothstep( 360.0, 640.0, dd0 ) ) * folMidW;
	if ( folMidF > 0.0 ) {
		vec3 n3 = vec3( ow.x > 0.0 ? folNoise( bp ) : 0.5, ow.y > 0.0 ? folNoise( bp * 0.5 + 5.1 ) : 0.5, folNoise( bp * 0.25 + 11.7 ) ) - 0.5;
		// renormalised: the grain keeps its contrast while the finer octaves fade
		folMidH = 0.5 + dot( n3, ow ) / max( wsum, 0.12 ) * 1.25;
		folMidB = dot( n3, ow * vec3( 1.0, 2.0, 4.0 ) ) / max( wsum, 0.12 );
	}
}
#endif
if ( vCrown.w < 0.999 && uFolOn > 0.5 ) {
	vec3 fo = vCrown.xyz;
	if ( vCrown.w < -0.5 ) {
		// branch limbs inside the crown: grey-brown bark in shade, no leaf terms (wave 6: 0.105 read as black stilts)
		folLeaf = 0.0;
		diffuseColor.rgb = vec3( 0.16, 0.14, 0.118 );
		folOcc = 0.55;
		#ifdef FOL_FADE
			// vine stakes (vines.ts) stand in the open: weathered split oak, silver-grey (wave-7 review fix: the
			// grey-brown 0.25 / 0.22 / 0.185 at 0.85 read as dark fence posts) [I]
			diffuseColor.rgb = vec3( 0.21, 0.2, 0.18 );
			folOcc = 1.0;
		#endif
	} else {
		float fr = length( fo );
		folOcc = mix( 0.32, 1.0, smoothstep( 0.25, 1.0, fr ) ) * mix( 0.62, 1.0, smoothstep( -0.9, 0.5, fo.y ) );
		float cv = fract( vCrown.w * 7.31 );
		diffuseColor.rgb *= 0.95 + 0.09 * cv;
		// sunlit top: fresher, yellower shoots
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.08, 1.06, 0.8 ), 0.4 * smoothstep( 0.15, 1.0, fo.y ) );
		// leaf clusters: gaps between them read darker, only where the pattern is resolved on screen
		vec3 np = fo * 9.0 + vFolSeed * 37.0;
		float fade = 1.0 - smoothstep( 0.15, 0.4, length( fwidth( np ) ) );
		if ( fade > 0.0 ) {
			float n = folNoise( np );
			float k = mix( 1.0, 0.7 + 0.4 * smoothstep( 0.2, 0.8, n ), fade );
			diffuseColor.rgb *= k;
			folOcc *= mix( 1.0, 0.75 + 0.25 * k, fade );
		}
		// KB-I66: leaf masses at a distance (≳ 150 m, where the clusters above have faded and the mid / far crowns are
		// single lumpy domes): a coarser noise of about a third of the crown radius darkens the hollows between masses
		// (not on the cards: their anchor is constant per card, and they are the overdraw)
		#ifndef FOL_CARD
		// (and only out to ~400 m: beyond, the domes are a few pixels and the forest floor of an aerial view is millions
		// of fragments, so the noise would cost ~0.5 ms there for nothing visible)
		float dd = length( vViewPosition );
		float dIn = smoothstep( 120.0, 200.0, dd );
		float dfar = dIn * ( 1.0 - smoothstep( 330.0, 420.0, dd ) );
		float dW = dIn;
		#ifdef FOL_MID
			// the leaf-cluster relief carries most of the structure: the broad blotches only at a third (they made the
			// soft "broccoli" look) [I]
			dfar *= 1.0 - 0.65 * folMidF;
			dW *= 1.0 - 0.65 * folMidW;
		#endif
		if ( dW > 0.0 ) {
			// wave 8: where the blotches fade (far, or unresolved) their mean (≈ 0.87) stays, so the fade leaves no band
			vec3 mp = fo * 3.2 + vFolSeed * 19.0;
			float mfade = dfar * ( 1.0 - smoothstep( 0.45, 1.1, length( fwidth( mp ) ) ) ) / max( dW, 1e-4 );
			float k2 = 0.87;
			if ( mfade > 0.0 ) k2 = mix( k2, 0.6 + 0.52 * smoothstep( 0.2, 0.75, folNoise( mp ) ), clamp( mfade, 0.0, 1.0 ) );
			k2 = mix( 1.0, k2, dW );
			diffuseColor.rgb *= k2;
			folOcc *= 0.7 + 0.3 * k2;
		}
		#endif
		#ifdef FOL_MID
			// gaps between the leaf clusters: darker and occluded, sunlit clusters a little fresher; the mean (≈ 0.86) matches
			// the shaded shells under the close tier's cards, so the tier step at the card cap is small [I]
			float gk = smoothstep( uFolMidGap.z - uFolMidGap.y, uFolMidGap.z + uFolMidGap.y, folMidH );
			// wave 8: beyond the relief's fade its mean (gk ≈ 0.54) stays (folMidW), see FOL_MID above
			gk = mix( 0.54, gk, folMidW > 0.0 ? folMidF / folMidW : 0.0 );
			diffuseColor.rgb *= mix( 1.0, uFolMidGap.x + ( 1.12 - uFolMidGap.x ) * gk, folMidW );
			folOcc *= mix( 1.0, 0.55 + 0.45 * gk, folMidW );
		#endif
	}
	#if ! defined( FOL_CARD ) && ! defined( FOL_MID )
		// wave 6: where leaf cards cover the crown (≲ 140 m), the clump shell between them is the shaded inside of the
		// foliage, a little darker, so the cards read in front of it [I]
		// (w ≥ 0.985: clipped surfaces, e.g. yew cones, keep their shade under the fine card skin, KB-I66)
		// KB-I66: the forest crowns carry cards out to FOREST_CARD_FAR (define FOL_SHELL_FAR on the forest material); their
		// detail-0 clumps showed through the cards as bright hexagons (tour Anflug), so a stronger darkening there
		#ifdef FOL_SHELL_FAR
			if ( folLeaf > 0.5 && vCrown.w < 0.985 ) diffuseColor.rgb *= mix( 0.7, 1.0, smoothstep( FOL_SHELL_FAR * 0.75, FOL_SHELL_FAR, length( vViewPosition ) ) * step( 0.5, uCardFar ) + step( uCardFar, 0.5 ) );
		#else
			if ( folLeaf > 0.5 && vCrown.w < 0.985 ) diffuseColor.rgb *= mix( 0.84, 1.0, smoothstep( 100.0, 150.0, length( vViewPosition ) ) * step( 0.5, uCardFar ) + step( uCardFar, 0.5 ) );
		#endif
	#endif
	folOccDirect = mix( 1.0, folOcc, 0.55 );
}
`;

/**
 * FOL_MID (KB-I66 residual, wave 7): the leaf clusters as relief. The cluster height (m) is differentiated in screen
 * space and bends the normal (surface-gradient bump, Mikkelsen, "Bump mapping unparametrized surfaces on the GPU",
 * 2010), so each cluster catches the sun on one side and shades on the other, like the carded crowns nearer the camera.
 * One noise evaluation per pixel (above), no texture; derivatives in uniform control flow.
 */
const FRAG_MID_BUMP = /* glsl */ `
#ifdef FOL_MID
{
	// relief height in metres-ish: wavelength-proportional octaves (equal slopes), × the instance scale is not needed
	// at the crown sizes of the forest (R 4-8 m) [I]
	float hb = folMidB * uFolBump * folMidF;
	vec3 bsx = dFdx( - vViewPosition );
	vec3 bsy = dFdy( - vViewPosition );
	vec3 br1 = cross( bsy, normal );
	vec3 br2 = cross( normal, bsx );
	float bdet = dot( bsx, br1 );
	vec3 bgrad = sign( bdet ) * ( dFdx( hb ) * br1 + dFdy( hb ) * br2 );
	normal = normalize( abs( bdet ) * normal - bgrad );
}
#endif
`;

/** After map_fragment (cards only): brightness match and mip-level alpha compensation (atlas 2048 × 1024 texels). */
const FRAG_CARD_MAP = /* glsl */ `
#ifdef FOL_CARD
{
	diffuseColor.rgb *= uCardGain;
	vec2 cdx = dFdx( vMapUv * vec2( 2048.0, 1024.0 ) );
	vec2 cdy = dFdy( vMapUv * vec2( 2048.0, 1024.0 ) );
	float clod = 0.5 * log2( max( max( dot( cdx, cdx ), dot( cdy, cdy ) ), 1e-6 ) );
	diffuseColor.a *= 1.0 + max( 0.0, clod ) * 0.25;
}
#endif
`;

/** Install the foliage patch on a leaf material (idempotent; chains any earlier onBeforeCompile). */
export function useFoliage(m: THREE.MeshStandardMaterial): void {
  if (m.userData.foliage) return;
  m.userData.foliage = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, foliageUniforms);
    sh.vertexShader = replaceOnce(sh.vertexShader, '#include <common>', `#include <common>\n${VERT_PARS}`);
    sh.vertexShader = replaceOnce(sh.vertexShader, '#include <project_vertex>', VERT_PROJECT);
    sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <common>', `#include <common>\n${FRAG_PARS}`);
    sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${FRAG_DIRECT}`);
    sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOUR}`);
    if (m.defines && 'FOL_CARD' in m.defines) sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <map_fragment>', `#include <map_fragment>\n${FRAG_CARD_MAP}`);
    sh.fragmentShader = replaceOnce(
      sh.fragmentShader,
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n#ifdef FOL_CARD\nnormal = normalize( normal + vec3( vCardC * 0.6, 0.0 ) );\n#endif\nfolEnvN = normalize( vFolEnvN );\nif ( folLeaf > 0.5 && vCrown.w < 0.999 && uFolOn > 0.5 ) normal = normalize( mix( normal, folEnvN, 0.45 ) );\n${FRAG_MID_BUMP}`,
    );
    sh.fragmentShader = replaceOnce(sh.fragmentShader, '#include <aomap_fragment>', `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= folOcc;`);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|foliage2`;
  m.needsUpdate = true;
}

function replaceOnce(src: string, find: string, repl: string): string {
  const i = src.indexOf(find);
  if (i < 0) throw new Error(`[foliage] shader chunk not found: ${find}`);
  return src.slice(0, i) + repl + src.slice(i + find.length);
}

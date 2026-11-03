/**
 * KB-I50 static far shadow map (maths and rationale in shadowsFarMath.ts).
 *
 * three.js has no second shadow map per light, so the far map belongs to a second DirectionalLight (`FarShadow.light`)
 * that casts shadows but carries no light (colour 0). `installFarShadowChunk` patches three's `lights_fragment_begin`
 * once, before any program compiles:
 * - directional light 0 (the sun) takes its visibility from the near map where that covers the pixel and fades into
 *   the far map (directional light 1) outside it;
 * - directional light 1 is skipped (no BRDF, no own shadow lookup), so the far light costs one shadow lookup only
 *   where the near map does not reach and a few vertex instructions for its shadow coordinate.
 * The terrain's per-vertex sun (atmosphere.ts `terrainLightsBegin`) is derived from the patched chunk, so it gets the
 * same visibility. The scene must hold no other shadow-casting directional light (it holds the sun and this one).
 */
import * as THREE from 'three';
import { FAR_SHADOW, type FarBox, farLightExtent, farRedrawDue } from './shadowsFarMath.ts';
import { CLOUD_PARS_GLSL, CLOUD_SUN_PARS_GLSL, CLOUD_TEX, cloudData, cloudGrid } from './clouds.ts';

/**
 * Wave 10 (clouds.ts): the cumulus shadow on the sun (directional light 0), for every material that lights through
 * `lights_fragment_begin` (the terrain's per-vertex sun included). World position from the view-space fragment.
 */
const CLOUD_SUN_GLSL = `
		#if UNROLLED_LOOP_INDEX == 0
		// only where the sun still reaches (rooms and shaded ground skip the lookup)
		if ( directLight.color.r + directLight.color.g + directLight.color.b > 0.0 ) directLight.color *= skbCloudSun( ( vec4( geometryPosition - viewMatrix[ 3 ].xyz, 0.0 ) * viewMatrix ).xyz );
		#endif`;

const SHADOW_LINE =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const RE_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/** GLSL: the sun's visibility from the near map (index 0) faded into the far map (index 1); nearWeight's twin. */
function sunShadowGlsl(fade: number): string {
  const f = (0.5 * fade).toFixed(4);
  return `
		#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 0 )
		{
			// KB-I50: near map where it reaches (fading over its rim), the static far map beyond
			vec3 skbNc = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
			float skbE = min( min( skbNc.x, 1.0 - skbNc.x ), min( skbNc.y, 1.0 - skbNc.y ) );
			float skbW = skbNc.z <= 1.0 ? smoothstep( 0.0, 1.0, clamp( skbE / ${f}, 0.0, 1.0 ) ) : 0.0;
			float skbS = 1.0;
			if ( directLight.visible && receiveShadow ) {
				float skbNear = skbW > 0.0 ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
				float skbFar = skbW < 1.0 ? getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] ) : 1.0;
				skbS = mix( skbFar, skbNear, skbW );
			}
			directLight.color *= skbS;
		}
		#elif ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 )
		// KB-I50: the far light carries no light; its map is read through light 0
		#else
		${SHADOW_LINE}
		#endif${CLOUD_SUN_GLSL}`;
}

/** Patch a `lights_fragment_begin` chunk text (pure string work; throws if three's source moved). */
export function patchFarShadowChunk(chunk: string, fade: number = FAR_SHADOW.fade): string {
  if (chunk.includes('KB-I50')) return chunk;
  const at = chunk.indexOf('directionalLights[ i ]');
  if (at < 0) throw new Error('[shadowsFar] lights_fragment_begin: directional loop not found');
  const s = chunk.indexOf(SHADOW_LINE, at);
  if (s < 0) throw new Error('[shadowsFar] lights_fragment_begin: directional shadow line not found');
  let out = chunk.slice(0, s) + sunShadowGlsl(fade) + chunk.slice(s + SHADOW_LINE.length);
  const r = out.indexOf(RE_DIRECT, out.indexOf('directionalLights[ i ]'));
  if (r < 0) throw new Error('[shadowsFar] lights_fragment_begin: directional RE_Direct not found');
  // the far light (index 1 while it casts) adds nothing: skip its BRDF. RE_DIRECT stays verbatim for terrainLightsBegin.
  out = `${out.slice(0, r)}#if !( ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 ) )\n\t\t${RE_DIRECT}\n\t\t#endif${out.slice(r + RE_DIRECT.length)}`;
  return out;
}

/** Install the patch into three's shared chunk (once, before the first compile). */
export function installFarShadowChunk(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.lights_fragment_begin = patchFarShadowChunk(chunks.lights_fragment_begin);
  // wave 10: the cloud field and its uniform block (shared by reference, as the fog's uFog) for every lit material
  if (!chunks.lights_pars_begin.includes('SKB_CLOUD_PARS')) chunks.lights_pars_begin = `${chunks.lights_pars_begin}\n${CLOUD_PARS_GLSL}\n${CLOUD_SUN_PARS_GLSL}`;
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, THREE.IUniform> }[]) {
    if (lib.uniforms.directionalLights) {
      lib.uniforms.uCloud = { value: cloudData };
      lib.uniforms.uCloudTex = cloudTexUniform;
    }
  }
}

/** The baked coverage noise of the cloud shadows (clouds.ts CLOUD_TEX), shared by reference; a 1² placeholder until set. */
const cloudTexUniform: { value: THREE.Texture } = { value: new THREE.DataTexture(new Uint8Array([0, 0]), 1, 1, THREE.RGFormat) };
let cloudTexKey = '';

/**
 * Bake the coverage field round the clearing centre (once per centre; ≈ 20–40 ms of CPU). The shadows read it with
 * one bilinear fetch (`skbCloudSun`).
 */
export function setCloudTexture(centre: readonly [number, number]): void {
  const key = `${centre[0]},${centre[1]}`;
  if (key === cloudTexKey) return;
  cloudTexKey = key;
  const n = CLOUD_TEX.size;
  const t = new THREE.DataTexture(cloudGrid(centre[0], centre[1]), n, n, THREE.RGFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  cloudTexUniform.value.dispose();
  cloudTexUniform.value = t;
}

/**
 * The far light and its map: drawn again only after the sun moved (`setSun`) or the casters changed (`invalidate`),
 * through `tick()` once per frame (farRedrawDue: at once for a jump, after a few settled frames for a drag), never as a
 * per-frame shadow pass. The light keeps the frustum its map was drawn with, so map and lookup always agree.
 */
export class FarShadow {
  readonly light = new THREE.DirectionalLight('#000000', 0);
  private box: FarBox = { cx: 0, cz: 0, half: FAR_SHADOW.minHalf };
  private groundY = 345;
  private readonly want = new THREE.Vector3(0, 1, 0);
  private readonly drawnDir = new THREE.Vector3(0, 1, 0);
  private drawn = false;
  private pending = true;
  private settled = 0;
  /** maps drawn so far (debug, tests, skb.farShadow) */
  renders = 0;

  constructor(size: number = FAR_SHADOW.mapSize) {
    const l = this.light;
    l.name = 'sun/far-shadow';
    l.castShadow = true;
    l.shadow.mapSize.set(size, size);
    l.shadow.bias = FAR_SHADOW.bias;
    l.shadow.normalBias = FAR_SHADOW.normalBias;
    l.shadow.radius = FAR_SHADOW.radius;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = false;
  }

  /** The square of ground the map covers (local x, z, half-extent) and its mean ground height. */
  setBox(box: FarBox, groundY: number): void {
    this.box = box;
    this.groundY = groundY;
    this.drawn = false;
    this.pending = true;
  }

  setMapSize(size: number): void {
    const sh = this.light.shadow;
    if (sh.mapSize.x === size) return;
    sh.mapSize.set(size, size);
    sh.map?.dispose();
    sh.map = null;
    this.drawn = false;
    this.pending = true;
  }

  /** The sun moved (unit direction toward the sun). */
  setSun(dir: THREE.Vector3): void {
    if (dir.equals(this.want) && this.drawn) return;
    this.want.copy(dir);
    this.pending = true;
    this.settled = 0;
  }

  /** Casters changed (display toggles, epoch): redraw once things settle. */
  invalidate(): void {
    this.pending = true;
    this.settled = 0;
  }

  /**
   * Once per frame, before rendering: refit and mark the map for one redraw when due. Returns true if it will redraw
   * this frame. `nearRedraw` = the near map redraws this frame: the far draw waits one frame, so casters enabled only
   * for the far map (main.ts: the far forest impostors) never land in the near map.
   */
  tick(nearRedraw = false): boolean {
    if (!this.pending) return false;
    if (nearRedraw && this.drawn) {
      this.settled++;
      return false;
    }
    const angle = THREE.MathUtils.radToDeg(this.drawnDir.angleTo(this.want));
    if (!farRedrawDue(this.settled++, angle, this.drawn)) return false;
    this.fit(this.want);
    this.drawnDir.copy(this.want);
    this.drawn = true;
    this.pending = false;
    this.renders++;
    return true;
  }

  private fit(dir: THREE.Vector3): void {
    const l = this.light;
    const c = new THREE.Vector3(this.box.cx, this.groundY, this.box.cz);
    l.target.position.copy(c);
    l.position.copy(c).addScaledVector(dir, 4000);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
    const ext = farLightExtent(this.box, dir.y);
    const cam = l.shadow.camera;
    cam.left = -ext.halfX;
    cam.right = ext.halfX;
    cam.top = ext.halfY;
    cam.bottom = -ext.halfY;
    cam.near = 4000 - 2600;
    cam.far = 4000 + 2600;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }
}

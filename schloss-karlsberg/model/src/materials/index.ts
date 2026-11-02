/**
 * PBR material library (exterior + viewer package).
 *
 * - One MeshStandardMaterial (MeshPhysicalMaterial for glass/water) per MaterialName, `material.name` = the name,
 *   so a glb keeps it and the explorer can swap materials (docs/architecture.md §3.6).
 * - Geometry carries UVs in METRES (world-scale mapping: walls u = along-wall, v = height; roofs along the slope;
 *   ground planar x/z). The library sets `texture.repeat = 1 / real_size_m` from viewer/textures.json, so a
 *   plaster tile is 2 m, slate 3 m, ashlar 3 × 1.8 m (5 courses of 0.36 m, TEXTURE_SIZE), clay tile 3.65 × 1.84 m
 *   (0.15 m Biberschwanz courses, KB-I18) etc.
 * - Colour comes from the catalogue: textured materials use the map as a LUMINANCE modulation around 1
 *   (shader patch), so the final albedo is exactly the catalogue tint (#ECE8DF render, #A65E4A plinth …).
 * - Colour maps are sRGB, normal / ARM maps linear. Missing textures (Node export, failed loads) fall back to the
 *   plain colour (procedural fallback = flat PBR values), never to a pink error.
 */
import * as THREE from 'three';
import { PARQUET_GLSL } from './parquet.ts';
import { granitePatch } from './granite.ts';
import { MATERIAL_NAMES, MATERIAL_TEXTURE, type MaterialLibrary, type MaterialName } from '../context.ts';
import { ASHLAR, SHADE_RGB_MAX } from '../exterior/shade.ts';
import { ROOF_COVER } from '../layout/grammar.ts';

export interface TextureSetInfo {
  name: string;
  real_size_m: [number, number];
}

export interface MaterialLibraryOptions {
  /** URL prefix of the texture sets, e.g. './textures/' (browser only). Omit for no textures (Node). */
  textureBase?: string;
  /** Texture sets from viewer/textures.json (`sets`). */
  sets?: TextureSetInfo[];
  /** Max anisotropy for loaded textures. */
  anisotropy?: number;
  /** Load normal + ARM maps as well (default true). */
  detailMaps?: boolean;
}

interface Base {
  color: string;
  roughness: number;
  metalness?: number;
  /** Normal map strength. */
  normal?: number;
  physical?: Partial<THREE.MeshPhysicalMaterialParameters>;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  emissive?: string;
}

/** Period colours and PBR values (research/02 §3.1, catalogue defaults). */
export const MATERIAL_BASE: Record<MaterialName, Base> = {
  'render.lime': { color: '#ECE8DF', roughness: 0.92, normal: 0.6 },
  'render.farm': { color: '#E8DFC8', roughness: 0.94, normal: 0.8 },
  // KB-I15 painted-render members (Lisenen, bands, surrounds, cornices): grey #B9B8B2 [D-> Koblenz 1998 'Grau für die
  // Architekturglieder'; I for Karlsberg: rushed, painter-led site, research/09 §1.2-1.3, §2.5, M4]; render normal, not ashlar
  'render.member': { color: '#B9B8B2', roughness: 0.9, normal: 0.6 },
  // sandstone is matt (wave-1 review: plinths read glossy oxblood); the ARM map only varies it around this value
  'stone.red': { color: '#A65E4A', roughness: 0.88, normal: 1 },
  'stone.grey': { color: '#BDBAB2', roughness: 0.88, normal: 0.8 },
  'stone.yellow': { color: '#C9B48E', roughness: 0.88, normal: 1 },
  'stone.rubble': { color: '#8E7A68', roughness: 0.95, normal: 1 },
  'stone.marble': { color: '#E6E1D8', roughness: 0.3 },
  // KB-I15: bluer slate [D PV 1791 colour code "blue", research/09 §6.2 M2]. Roughness 0.65 [I, wave-1 review]: split
  // slate has a soft sheen, so the slopes catch a grey sky highlight instead of reading near-black from the air
  'roof.slate': { color: '#4A525C', roughness: 0.65, normal: 1 },
  'roof.tile': { color: '#A8573A', roughness: 0.86, normal: 1 },
  // weathered sheet lead: dull blue-grey carbonate patina, not bright metal (wave-4 review: the KB-B07 dome read as
  // stainless steel at metalness 0.6) [N lead patina; I values]; env reflections damped like the other roofs
  'roof.lead': { color: '#6F757B', roughness: 0.66, metalness: 0.1 },
  'roof.copper': { color: '#5F9E85', roughness: 0.55, metalness: 0.3 },
  'roof.thatch': { color: '#8F7A52', roughness: 1 },
  'roof.earth': { color: '#5E7343', roughness: 1 },
  // KB-I16: blown glass with a slight green-grey tint (research/09 §3 Glass, M6 '#22302C') [N]
  'glass.crown': {
    color: '#22302C',
    roughness: 0.06,
    metalness: 0.0,
    physical: { transmission: 0.0, reflectivity: 0.6, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.52 },
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
  },
  'wood.frame': { color: '#E9E6DE', roughness: 0.6 },
  // KB-I15: blue-grey Jalousieläden [D-> Baunetz Klassizismus; HMS] (research/09 §3.2, M1). Matt oil paint on wood,
  // dielectric (roughness 0.85 [I], wave-1 review: at 0.7 the louvres mirrored the blue sky and read cornflower)
  'wood.shutter': { color: '#5F6F7A', roughness: 0.85, metalness: 0 },
  'wood.door': { color: '#6B4A33', roughness: 0.6 },
  'metal.iron': { color: '#2E3439', roughness: 0.5, metalness: 0.7 }, // KB-I15: blue-grey black [N; LC 1790 dark] (research/09 §6.2 M7)
  // water/oil gilding on carved wood: a pale, slightly greenish gold F0, burnished [I, wave-1 review]; it reflects
  // whatever env the scene/interior gives it (viewer InteriorLook: the room env). Roughness 0.25 [I, Festsaal review
  // wave 2]: at 0.3 the flat faces of frames and furniture blurred the room into one even yellow (read as paint)
  'metal.gilt': { color: '#D4AF6A', roughness: 0.25, metalness: 1 },
  // waxed oak parquet de Versailles: honey oak #9B7448 [N research/02 §3 finish table "Oak parquet, waxed"; pattern
  // D research/09 I4], a thin wax clearcoat. Festsaal review (wave 2): the wave-1 #8A5E3C read grey-brown under the
  // room light; the documented value is restored. Roughness is the true mean - the ARM map only varies it
  // (normaliseRoughness), it no longer pulls the floor down to ~0.05 (mirror)
  'floor.parquet': {
    color: '#9B7448',
    roughness: 0.45,
    normal: 0.6,
    // wax film: a crisp candle glint at night and window reflections by day. Clearcoat 0.15 and the base layer's broad
    // F0 0.04 lobe at 0.3 [I, Festsaal review wave 2]: at 0.3 / 1.0 the two lobes spread the bright room into a grey
    // veil over the oak (A/B pose 06: specular off moved the floor from #806B57 to #6B4B23; each lobe ≈ half the veil)
    physical: { clearcoat: 0.15, clearcoatRoughness: 0.12, specularIntensity: 0.3 },
  },
  'floor.flags': { color: '#B48C78', roughness: 0.8, normal: 0.8 },
  'floor.planks': { color: '#8D6C4C', roughness: 0.75 },
  'floor.brick': { color: '#9A5040', roughness: 0.9 },
  // painted Louis-seize boiserie, white #F1EFE8 [N research/02 §3 finish table; D white-and-gold research/09 I2].
  // Festsaal review (wave 2): the wave-1 #E8E2D2 turned to cream under the warm room light; documented value restored
  'wall.boiserie': { color: '#F1EFE8', roughness: 0.55 },
  'wall.silk.crimson': { color: '#8E2A2E', roughness: 0.7 },
  'wall.silk.blue': { color: '#5B7798', roughness: 0.7 },
  'wall.silk.green': { color: '#5E7F5E', roughness: 0.7 },
  // KB-I27: yellow silk of the Gelber Salon [D room name R12 / room guide; hue I research/09 §6.2 M8 #C9A94E; the N
  // alternative research/10 §c.2 #D9B95B reads too close to the gilt]
  'wall.silk.yellow': { color: '#C9A94E', roughness: 0.7 },
  'wall.silk.grey': { color: '#A7A9A4', roughness: 0.7 }, // KB-I27: Grauer Salon [D R12 name; hue N research/10 §c.2]
  'wall.limewash': { color: '#EEEAE0', roughness: 0.95, normal: 0.4 },
  // KB-I70: faux-granite paper of the Granitsaal (KB-B07): grey ground under dark, white and rose flecks (granite.ts);
  // mean ≈ #9B938B [D T5/T7 "Granit von Papier" 1789; N colours, research/10 §c.2 suggested #8D8580]
  'wall.granite': { color: '#96928A', roughness: 0.6 },
  'ceiling.stucco': { color: '#F2EEE6', roughness: 0.9 },
  'ground.gravel': { color: '#ABA393', roughness: 0.95, normal: 1 }, // albedo ≈ 0.45 (fix round 1: was #C8BFAE, near-white from the air)
  'ground.grass': { color: '#6E8A45', roughness: 0.95, normal: 0.8 },
  'ground.cobbles': { color: '#9C8A7A', roughness: 0.9, normal: 1 },
  water: {
    color: '#3E5A62',
    roughness: 0.08,
    physical: { clearcoat: 1, clearcoatRoughness: 0.08, ior: 1.33 },
  },
  hypothesis: { color: '#D9C9A3', roughness: 0.9, transparent: true, opacity: 0.45, side: THREE.DoubleSide },
};

/**
 * KB-I18: repeat of the CC0 clay-tile set (viewer/textures.json `clay_tile_roof` = Poly Haven `ceramic_roof_01`),
 * measured on the 2k colour map by autocorrelation of the row / column luminance means: 12.26 tile courses along v (one
 * per ≈ 167 px) and 20.25 tiles along u (≈ 101 px) [measured]. The texture's own tiles are 1.6 times taller than wide,
 * so it is stretched to the south-German Biberschwanz: one course = ROOF_COVER.biberschwanz.course (0.15 m), one tile
 * = its width (0.18 m) [D format; research/09 G10].
 */
export const CLAY_TILE_TEXTURE = { courses: 12.26, tiles: 20.25 } as const;

/** Real size (u along the eaves, v up the slope; metres per image) of the clay-tile texture after KB-I18. */
export function clayTileSize(): [number, number] {
  const b = ROOF_COVER.biberschwanz;
  return [CLAY_TILE_TEXTURE.tiles * b.width, CLAY_TILE_TEXTURE.courses * b.course];
}

/**
 * Texture sets mapped to another size than viewer/textures.json's `real_size_m` (u, v metres per tile). The ashlar
 * image has 5 courses: at 3 × 1.8 m they are 0.36 m high (research/09 §2.2 [N]; wave-3 review), and the per-block stone
 * hues (exterior/shade.ts ASHLAR) follow the same grid.
 */
export const TEXTURE_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  sandstone_ashlar: [ASHLAR.tile, ASHLAR.tileV],
  clay_tile_roof: clayTileSize(),
};

/** Roof covers without the ARM roughness map (matt, roughness >= 0.85). */
const ROUGH_ROOFS: ReadonlySet<MaterialName> = new Set<MaterialName>(['roof.slate', 'roof.tile', 'roof.thatch', 'roof.earth', 'roof.lead']);

/** Mean of a texture weighted over its RGB channels (luminance of a colour map, G of an ARM map). */
function meanChannel(img: CanvasImageSource & { width: number; height: number }, w: [number, number, number] = [0.299, 0.587, 0.114]): number {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return 0.5;
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (w[0] * d[i] + w[1] * d[i + 1] + w[2] * d[i + 2]) / 255;
    return Math.max(0.05, s / (d.length / 4));
  } catch {
    return 0.5;
  }
}

/** Ratio clamp and contrast of the ARM roughness variation around the material's roughness (see roughnessScale). */
export const ROUGHNESS_VARIATION = { min: 0.5, max: 1.6, contrast: 0.5 } as const;

/**
 * Factor the ARM roughness map applies to `material.roughness` (CPU twin of the shader patch in lumaPatch).
 * three.js multiplies roughness by the map's G channel, so a set whose G averages 0.10 (Poly Haven parquet) turned a
 * 0.45 floor into a 0.05 mirror, and sandstone (G ≈ 0.51) went glossy (wave-1 review). Normalised to the map's mean,
 * the material's roughness is the true average and the map only adds variation.
 */
export function roughnessScale(g: number, mean: number): number {
  const { min, max, contrast } = ROUGHNESS_VARIATION;
  const ratio = Math.min(max, Math.max(min, g / Math.max(mean, 0.01)));
  return 1 + (ratio - 1) * contrast;
}

/**
 * Patch a standard material so its colour map only modulates luminance around 1 (the albedo = material.color), and its
 * ARM roughness only varies roughness around material.roughness (roughnessScale). `uMapMean` / `uRoughMean` are set
 * once the images have loaded.
 */
function lumaPatch(m: THREE.MeshStandardMaterial, mean: { value: number }, roughMean: { value: number }, contrast = 1, parquetTile = 0): void {
  const parquet = parquetTile > 0;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMapMean = mean;
    shader.uniforms.uMapContrast = { value: contrast };
    shader.uniforms.uRoughMean = roughMean;
    shader.uniforms.uParqTile = { value: parquetTile };
    const v = ROUGHNESS_VARIATION;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMapMean;\nuniform float uMapContrast;\nuniform float uRoughMean;\nuniform float uParqTile;')
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
  float roughRatio = clamp( texelRoughness.g / max( uRoughMean, 0.01 ), ${v.min.toFixed(2)}, ${v.max.toFixed(2)} );
  roughnessFactor = clamp( roughness * ( 1.0 + ( roughRatio - 1.0 ) * ${v.contrast.toFixed(2)} ), 0.04, 1.0 );
#endif${parquet ? '\n  roughnessFactor = clamp( roughnessFactor * ( 0.85 + 0.3 * parqH ) + 0.3 * parqJoint, 0.04, 1.0 );' : ''}`,
      )
      .replace(
        '#include <map_fragment>',
        parquet
          ? PARQUET_GLSL
          : `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float lum = dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) / uMapMean;
  diffuseColor.rgb *= clamp( mix( 1.0, lum, uMapContrast ), 0.0, 2.0 );
#endif`,
      );
  };
  m.customProgramCacheKey = () => `luma${contrast}|rough${parquet ? '|parquet' : ''}`;
}

/**
 * Share of the baked AO applied to direct sunlight [I render]: the shadow map cannot resolve 0.2-1 m reveals and
 * cornice soffits, so a little contact darkening stands in for the missing sub-texel shadow; full AO acts on the
 * indirect (sky / environment) light only, as three's aoMap does.
 */
export const BAKED_AO_DIRECT = 0.3;

/**
 * KB-I19/I20: make a material read the per-vertex `aShade` attribute (exterior/shade.ts): rgb multiplies the albedo
 * (limewash age and grime, stone block hues, roof jitter), a is ambient occlusion on the indirect light (+ a share of
 * the direct light). Chains any existing onBeforeCompile (lumaPatch). Missing attribute = white, AO 1
 * (`defaultAttributeValues`).
 */
export function shadePatch(m: THREE.Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  (m as THREE.Material & { defaultAttributeValues?: Record<string, number[]> }).defaultAttributeValues = { aShade: [0.25, 0.25, 0.25, 1] };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aShade;\nvarying vec4 vShade;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvShade = vec4( aShade.rgb * ${SHADE_RGB_MAX.toFixed(1)}, aShade.a );`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vShade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vShade.rgb;')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  {
    float bakedAO = vShade.a;
    reflectedLight.indirectDiffuse *= bakedAO;
    reflectedLight.directDiffuse *= mix( 1.0, bakedAO, ${BAKED_AO_DIRECT.toFixed(2)} );
#if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= bakedAO;
#endif
#if defined( USE_ENVMAP ) && defined( STANDARD )
    float bakedNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( bakedNV, bakedAO, material.roughness );
#endif
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|shade`;
}

/**
 * Exterior look of the window glass seen from OUTSIDE (wave-3 review, KB-I42) [I render]. A daylit room is only ~2 %
 * of the outdoor light (daylight factor), so from the court a window reads as sky reflection over a dark room, never
 * brighter than the wall. Rendering the real room behind 62 % transparent glass made the panes depend on whatever was
 * behind: the inner faces of the outer walls (sky-lit, cream) when the interior is beyond INTERIOR_DIST or not built
 * yet, so shaded windows glowed brighter than the render. Seen from outside, the pane now covers
 * `outsideAlpha` of the view with a "room proxy": a dark, glass-tinted albedo `roomColour` lit by the facade's own
 * irradiance (sky × AO, plus `roomDirect` of the sun, both through the shadow map), so the room follows the wall's
 * light (≈ 15-30 % of the wall value); the remaining 15 % shows the real interior. Reflections (sky env, sun glint,
 * clearcoat; Fresnel from the physical BRDF) are no longer dimmed by the alpha. Seen from inside (back side of the
 * normals) the glass keeps its plain transparent look.
 */
export const GLASS_LOOK = {
  outsideAlpha: 0.85,
  /** dim room behind green-grey crown glass (linear albedo ≈ 0.07) */
  roomColour: '#4A4D47',
  roomDirect: 0.3,
  /**
   * KB-I42 interior mapping (LOD2 windows seen from outside; viewer/src/windowRooms.ts derives the room behind each
   * window from the catalogue and night.ts writes the `aWin` / `aRoom` / `aRoom2` attributes): a box room behind the
   * glass, cast per pixel (van Dongen 2008), shaded by the same facade irradiance as the flat proxy. Without the
   * attributes (LOD0/1, other consumers) the flat proxy stays.
   */
  interior: {
    /** wall of a window with no catalogue room behind it [I: the plain painted walls of interior/index.ts] */
    fallbackWall: '#E6E1D5',
    /** dark neutral cavity behind dormers, roof oculi and service rooms [I: unpainted roof space / unlit hall] */
    cavity: '#5C5852',
    /**
     * Curtains: white and cream muslin [N: summer curtains of muslin; I which rooms], or the room's own silk (packed per
     * window, windowRooms.ts CURTAIN_KIND). Wave-7 review: no free palette colours (violet read).
     */
    curtains: ['#F2EEE4', '#E3D8BE'],
    /** share of the (non-service) rooms with drawn curtains [I, wave-7 review: 30–40 %] */
    curtainShare: 0.35,
    /** parquet [N research/02 §3, as the state-room floors] and a stucco-white ceiling [I] */
    floor: '#9B7448',
    ceiling: '#EEEBE2',
    /**
     * Room albedo × gain (linear): a daylit room is a few per cent of the outdoor light, so from outside the window stays
     * darker than the wall; at 0.2 a white room is ≤ 20 % of the limewash under the same light (wave-7 review: ≤ 25 %,
     * no window may read as lit by day), tinted by the green-grey crown glass [I].
     */
    gain: 0.2,
    /** daylight falloff into the room: brightness mix( far, 1, exp( −depth / length ) ) [I] */
    falloffFar: 0.3,
    falloffLength: 2.6,
    /** curtains hang this far behind the glass (m) [I] */
    curtainGap: 0.12,
    /** fallback rooms only: lights at least this tall are French windows reaching the floor (m) [I] */
    frenchWindow: 3.3,
    /** fallback rooms only: floor below the window bottom (ordinary / French window) and ceiling above the head (m) [I] */
    sill: 0.85,
    frenchSill: 0.15,
    lintel: 0.7,
    /** picture rooms: a framed picture every `picturePitch` m along the back wall, in room coordinates [I] */
    picturePitch: 2.6,
    /**
     * Colour kept of the room albedo (rest → its luminance): a dim room seen through green-grey crown glass reads muted,
     * and a crimson or blue silk room under the blue sky reflection otherwise turned violet (wave-7 review) [I].
     */
    saturation: 0.5,
  },
} as const;

/**
 * GLSL of the KB-I42 interior mapping (inside the glass patch; needs glassOutside, vNormal, vViewPosition, vWin, vRoom,
 * vRoom2). aRoom = (depth, mode 1 room / 2 room with pictures / 3 dark cavity, open share, rgb565 + 65536 · curtain
 * kind), aRoom2 = (left, right, sill, ceiling above the window bottom) (viewer/src/windowRooms.ts).
 */
function interiorMapGlsl(): string {
  const I = GLASS_LOOK.interior;
  const f = (x: number) => x.toFixed(4);
  return `
  float skbRoomGlow = 1.0;
  float skbMapped = 0.0;
  if ( glassOutside > 0.5 && vWin.z > 0.0 && vRoom.x > 0.5 && vRoom.y > 0.5 ) {
    // window frame in view space: T along the facade (up × N, as night.ts), U up, N out of the facade
    vec3 skbU = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
    vec3 skbT = normalize( cross( skbU, skbGlassN ) );
    vec3 skbN = cross( skbT, skbU );
    vec3 skbV = normalize( -vViewPosition );
    vec3 d = vec3( dot( skbV, skbT ), dot( skbV, skbU ), min( dot( skbV, skbN ), -1e-3 ) );
    vec2 p = vWin.xy;
    float mode = floor( vRoom.y + 0.5 );
    float packed = floor( vRoom.w + 0.5 );
    float kind = floor( packed / 65536.0 + 1e-4 );
    float rgb = packed - 65536.0 * kind;
    float pr = floor( rgb / 2048.0 + 1e-4 );
    float pg = floor( ( rgb - 2048.0 * pr ) / 32.0 + 1e-4 );
    float pb = rgb - 2048.0 * pr - 32.0 * pg;
    vec3 wall = pow( vec3( pr / 31.0, pg / 63.0, pb / 31.0 ), vec3( 2.2 ) );
    vec3 alb;
    float glow;
    float tc = ${f(I.curtainGap)} / -d.z;
    vec2 pc = p + d.xy * tc;
    if ( vRoom.z < 0.99 && abs( pc.x ) > vRoom.z * vWin.z && pc.y > -0.2 && pc.y < vWin.w + 0.3 ) {
      // half-drawn curtain: folds every ≈ 0.24 m, lit through the glass
      float fold = 0.78 + 0.22 * cos( pc.x * 26.0 );
      alb = ( kind > 1.5 ? wall : uRoomCurtain[ int( kind + 0.5 ) ] ) * fold;
      glow = 0.75 * fold;
    } else {
      float tb = vRoom.x / -d.z;
      float tx = abs( d.x ) > 1e-5 ? ( ( d.x > 0.0 ? vRoom2.y : -vRoom2.x ) - p.x ) / d.x : 1e6;
      float ty = abs( d.y ) > 1e-5 ? ( ( d.y > 0.0 ? vRoom2.w : -vRoom2.z ) - p.y ) / d.y : 1e6;
      float t = min( tb, min( tx, ty ) );
      vec3 h = vec3( p, 0.0 ) + d * t;
      if ( mode > 2.5 ) {
        // dark neutral cavity (roof space, service hall): one tone, a little darker toward the back
        alb = wall * mix( 0.55, 1.0, exp( h.z / 1.5 ) );
        glow = 0.5;
      } else {
        if ( t >= tb ) {
          // back wall: a slightly darker dado up to 0.9 m; picture rooms hang a frame every pitch along the room
          float yf = h.y + vRoom2.z;
          alb = wall * ( yf < 0.9 ? 0.8 : 1.0 );
          float xr = h.x + vRoom2.x;
          float pitch = ${f(I.picturePitch)};
          vec2 q = abs( vec2( mod( xr, pitch ) - 0.5 * pitch, yf - 1.85 ) ) - vec2( 0.5, 0.4 );
          if ( mode > 1.5 && xr > 0.6 && xr < vRoom2.x + vRoom2.y - 0.6 && max( q.x, q.y ) < 0.0 ) alb = max( q.x, q.y ) > -0.06 ? vec3( 0.42, 0.31, 0.12 ) : vec3( 0.12, 0.09, 0.06 );
        } else if ( t >= tx ) alb = wall * 0.86;
        else if ( d.y > 0.0 ) alb = uRoomCeiling;
        else alb = uRoomFloor * ( 0.88 + 0.12 * step( 0.5, fract( h.x * 1.5 ) ) );
        // candle light at night: the room glows from within, a little brighter toward the window
        glow = dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.55 * mix( 0.75, 1.15, exp( h.z / 3.0 ) );
      }
      alb *= mix( ${f(I.falloffFar)}, 1.0, exp( h.z / ${f(I.falloffLength)} ) );
    }
    alb = mix( vec3( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), alb, ${f(I.saturation)} );
    diffuseColor.rgb = mix( diffuseColor.rgb, alb * uRoomGain, glassOutside );
    skbRoomGlow = glow;
    skbMapped = 1.0;
  }`;
}

/**
 * KB-I75 window pull (wave-8 audit #5): what a visitor inside a daylit room sees through the panes is ≈ 5 EV above the
 * room, so at the indoor exposure the windows and the court beyond clipped to a flat white. The eye adapts locally and
 * an interior photographer "pulls" the windows the same way. `glassView.value` is the transmittance (1 = off) of the
 * view through a pane seen from its room side; the viewer sets it from the exposure gap (viewer/src/interiorGrade.ts)
 * while the camera is inside, and 1 elsewhere, so every outdoor frame is unchanged [I].
 */
export const glassView = { value: 1 };

/** Patch `glass.crown`: room proxy + unattenuated reflections from outside (GLASS_LOOK). Chains onBeforeCompile. */
export function glassPatch(m: THREE.Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const room = new THREE.Color(GLASS_LOOK.roomColour);
  const I = GLASS_LOOK.interior;
  const lin = (hex: string) => new THREE.Color(hex);
  // KB-I42: room albedo gain tinted by the crown glass (the proxy colour's hue, luminance 1)
  const tint = new THREE.Color(GLASS_LOOK.roomColour);
  const tl = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
  const gain = new THREE.Vector3(tint.r / tl, tint.g / tl, tint.b / tl).multiplyScalar(I.gain);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uGlassRoom = { value: room };
    sh.uniforms.uGlassOut = { value: new THREE.Vector2(GLASS_LOOK.outsideAlpha, GLASS_LOOK.roomDirect) };
    sh.uniforms.uRoomCurtain = { value: I.curtains.map(lin) };
    sh.uniforms.uRoomFloor = { value: lin(I.floor) };
    sh.uniforms.uRoomCeiling = { value: lin(I.ceiling) };
    sh.uniforms.uRoomGain = { value: gain };
    sh.uniforms.uGlassView = glassView;
    // KB-I65 wave 8: vRoom / vRoom2 are constant per window (every vertex of a pane carries its window's values), so
    // plain varyings interpolate to the same numbers (the packed integers are rounded below). No `flat` qualifier:
    // ANGLE's Metal backend emulates GL's last-vertex provoking convention for flat varyings by rewriting the index
    // buffer of every such draw, which cost ≈ 10 ms per frame at 3024×1964 for ~150 glass draws (pose 12: 18–24 → 6–8 ms).
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nattribute vec4 aRoom;\nattribute vec4 aRoom2;\nvarying vec4 vWin;\nvarying vec4 vRoom;\nvarying vec4 vRoom2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvRoom = aRoom;\nvRoom2 = aRoom2;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uGlassRoom;\nuniform vec2 uGlassOut;\nvarying vec4 vWin;\nvarying vec4 vRoom;\nvarying vec4 vRoom2;\nuniform vec3 uRoomCurtain[ ${I.curtains.length} ];\nuniform vec3 uRoomFloor;\nuniform vec3 uRoomCeiling;\nuniform vec3 uRoomGain;\nuniform float uGlassView;`,
      )
      // camera on the side the (outward) vertex normals point to = outside; lit windows (night.ts) keep their alpha.
      // Wave-7 review: a transparent double-sided material is drawn in two passes, and the back-face pass defines
      // FLIP_SIDED, which negates vNormal: from inside a room its own panes then tested as "outside" and showed the
      // mapped room (an opaque pale pane instead of the court). The outward normal is the unflipped one.
      .replace(
        '#include <alphatest_fragment>',
        `#ifdef FLIP_SIDED
  vec3 skbGlassN = - normalize( vNormal );
#else
  vec3 skbGlassN = normalize( vNormal );
#endif
  // KB-I70: the room-side face of box-shaped glass (night.ts aWin.z = −2) is never seen "from outside"
  float glassOutside = step( 0.0, dot( skbGlassN, vViewPosition ) ) * step( -1.5, vWin.z );
  diffuseColor.rgb = mix( diffuseColor.rgb, uGlassRoom, glassOutside );
  diffuseColor.a = mix( diffuseColor.a, max( diffuseColor.a, uGlassOut.x ), glassOutside );${interiorMapGlsl()}
  // the mapped room covers the whole pane (the real interior is drawn only for a visitor inside)
  diffuseColor.a = mix( diffuseColor.a, 1.0, skbMapped );
#include <alphatest_fragment>`,
      )
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n  reflectedLight.directDiffuse *= mix( 1.0, uGlassOut.y, glassOutside );`)
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
  {
#ifdef USE_CLEARCOAT
    vec3 glassSpec = totalSpecular * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
#else
    vec3 glassSpec = totalSpecular;
#endif
    gl_FragColor.rgb += glassSpec * ( 1.0 / max( gl_FragColor.a, 0.05 ) - 1.0 ) * glassOutside;
  }
  // KB-I75 window pull: from the room side the whole pane (its own shading and the view behind) is scaled by
  // uGlassView: alpha a' = 1 − T (1 − a), colour T · c · a / a'
  if ( uGlassView < 0.999 && glassOutside < 0.5 ) {
    float skbA = 1.0 - uGlassView * ( 1.0 - gl_FragColor.a );
    gl_FragColor.rgb *= uGlassView * gl_FragColor.a / max( skbA, 1e-3 );
    gl_FragColor.a = skbA;
  }`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|glass|imap3|pull`;
}

/**
 * Water look (KB-I37). `waterTime` drives gentle ripples (seconds; the viewer advances it, post.ts), a small tilt of
 * the up normal by three travelling cosines [I: still garden ponds, not the sea; materials-vegetation-water.md §7].
 * The viewer's screen-space reflection (post.ts) evaluates the same `WATER_RIPPLE_GLSL`.
 */
export const waterTime = { value: 0 };
/**
 * GLSL `vec2 skbRipple(vec2 xz, float t)`: the normal tilt of the water ripples (shared with the viewer's SSR), and
 * `vec2 skbRippleLod(vec2 xz, float t, float fp)`: the same with each wave faded out where the pixel footprint `fp` (m on
 * the water) exceeds 1/12–1/5 of its wavelength (KB-I69, wave-7 review: at grazing views a wave spans only a few pixel
 * rows, and over the long lever arm to the far bank the reflected trees broke into horizontal comb stripes; the viewer
 * smears the reflection vertically instead, post.ts). Wavelengths
 * 2π / k = 3.0, 1.9 and 1.1 m [I: still garden ponds].
 */
export const WATER_RIPPLE_GLSL = `
vec2 skbRippleLod( vec2 p, float t, float fp ) {
  vec3 w = vec3( 1.0 ) - smoothstep( vec3( 0.08 ), vec3( 0.2 ), fp * vec3( 2.1, 3.3, 5.9 ) / 6.2832 );
  vec2 g = vec2( 0.0 );
  g += vec2( 0.83, 0.56 ) * cos( dot( p, vec2( 0.83, 0.56 ) ) * 2.1 + t * 1.3 ) * w.x;
  g += vec2( -0.42, 0.91 ) * cos( dot( p, vec2( -0.42, 0.91 ) ) * 3.3 + t * 1.7 + 1.3 ) * w.y;
  g += vec2( 0.97, -0.24 ) * cos( dot( p, vec2( 0.97, -0.24 ) ) * 5.9 + t * 2.3 + 4.1 ) * 0.5 * w.z;
  return g * 0.006;
}
vec2 skbRipple( vec2 p, float t ) {
  return skbRippleLod( p, t, 0.0 );
}
`;
const waterPatched = new WeakSet<THREE.Material>();

/**
 * Patch a still-water material (KB-I37): rippled normal (`waterTime`) and **alpha 0** in the output, the marker by
 * which the viewer's post chain finds water pixels for its screen-space reflection (post.ts). The material is opaque,
 * so the alpha only reaches the render target. Chains onBeforeCompile; idempotent per material (clones need their own
 * call: `Material.copy` does not copy the hooks).
 */
export function waterPatch(m: THREE.Material): void {
  if (waterPatched.has(m)) return;
  waterPatched.add(m);
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uWaterTime = waterTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vWaterXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWaterTime;\nvarying vec2 vWaterXZ;\n${WATER_RIPPLE_GLSL}`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    // KB-I69: fade the waves finer than the pixel footprint (no row-by-row aliasing at grazing views)
    vec2 fw = fwidth( vWaterXZ );
    vec2 rg = skbRippleLod( vWaterXZ, uWaterTime, max( fw.x, fw.y ) );
    normal = normalize( mat3( viewMatrix ) * normalize( vec3( -rg.x, 1.0, -rg.y ) ) );
  }`,
      )
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a = 0.0;');
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|water`;
}

export class Materials implements MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  private tex = new Map<string, { map?: THREE.Texture; normal?: THREE.Texture; arm?: THREE.Texture; mean: { value: number }; roughMean: { value: number } }>();
  private loader: THREE.TextureLoader | null = null;
  constructor(private opts: MaterialLibraryOptions = {}) {
    if (opts.textureBase && typeof document !== 'undefined') this.loader = new THREE.TextureLoader();
  }

  private textureSet(setName: string) {
    let t = this.tex.get(setName);
    if (t) return t;
    t = { mean: { value: 0.5 }, roughMean: { value: 0.5 } };
    this.tex.set(setName, t);
    const info = this.opts.sets?.find((s) => s.name === setName);
    if (!this.loader || !info) return t;
    const base = `${this.opts.textureBase}${setName}/`;
    const size = TEXTURE_SIZE[setName] ?? info.real_size_m;
    const rep = new THREE.Vector2(1 / size[0], 1 / size[1]);
    const setup = (x: THREE.Texture, srgb: boolean) => {
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      x.repeat.copy(rep);
      x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      x.anisotropy = this.opts.anisotropy ?? 8;
      return x;
    };
    const mean = t.mean;
    const roughMean = t.roughMean;
    t.map = setup(
      this.loader.load(`${base}diff.jpg`, (x) => {
        mean.value = meanChannel(x.image as HTMLImageElement);
      }),
      true,
    );
    if (this.opts.detailMaps !== false) {
      t.normal = setup(this.loader.load(`${base}nor_gl.jpg`), false);
      t.arm = setup(
        this.loader.load(`${base}arm.jpg`, (x) => {
          roughMean.value = meanChannel(x.image as HTMLImageElement, [0, 1, 0]);
        }),
        false,
      );
    }
    return t;
  }

  private make(name: MaterialName, colour?: string): THREE.Material {
    const b = MATERIAL_BASE[name];
    const params: THREE.MeshStandardMaterialParameters = {
      name,
      color: new THREE.Color(colour ?? b.color),
      roughness: b.roughness,
      metalness: b.metalness ?? 0,
      side: b.side ?? THREE.FrontSide,
      transparent: b.transparent ?? false,
      opacity: b.opacity ?? 1,
    };
    const m: THREE.MeshStandardMaterial = b.physical ? new THREE.MeshPhysicalMaterial({ ...params, ...b.physical }) : new THREE.MeshStandardMaterial(params);
    if (b.transparent) m.depthWrite = name !== 'glass.crown' && name !== 'hypothesis';
    const setName = MATERIAL_TEXTURE[name];
    if (setName && this.loader) {
      const t = this.textureSet(setName);
      const info = this.opts.sets?.find((s) => s.name === setName);
      // the photo parquet's own ≈ 10 cm strips read as laminate: the Versailles panels are drawn procedurally
      // (parquet.ts) and the set only supplies wood grain; its normal and ARM maps would print the strips back
      const parquetTile = name === 'floor.parquet' && info ? info.real_size_m[0] : 0;
      if (t.map) {
        m.map = t.map;
        lumaPatch(m, t.mean, t.roughMean, name.startsWith('ground.') ? 1.2 : 1, parquetTile);
      }
      if (t.normal && !parquetTile) {
        m.normalMap = t.normal;
        const k = b.normal ?? 1;
        m.normalScale = new THREE.Vector2(k, k);
      }
      // roofs: no ARM roughness map (it pushed the slate down to ~0.3 and the main roof read white/metallic at
      // grazing sun; fix round 1) - one rough, matt cover for main and raised roofs
      if (t.arm && !ROUGH_ROOFS.has(name) && !parquetTile) {
        m.roughnessMap = t.arm;
        m.aoMap = null; // ARM's AO needs uv1; we keep AO from lighting only
      }
    }
    if (ROUGH_ROOFS.has(name)) m.envMapIntensity = 0.45;
    if (name === 'glass.crown') glassPatch(m);
    if (name === 'water') waterPatch(m);
    if (name === 'wall.granite') granitePatch(m); // KB-I70
    m.userData.materialName = name;
    return m;
  }

  get(name: MaterialName): THREE.Material {
    let m = this.cache.get(name);
    if (!m) {
      m = this.make(name);
      this.cache.set(name, m);
    }
    return m;
  }

  tinted(name: MaterialName, colour: string): THREE.Material {
    const c = normaliseColour(colour) ?? MATERIAL_BASE[name].color;
    const key = `${name}|${c}`;
    let m = this.cache.get(key);
    if (!m) {
      m = this.make(name, c);
      this.cache.set(key, m);
    }
    return m;
  }

  baked(name: MaterialName, colour?: string): THREE.Material {
    const c = colour ? (normaliseColour(colour) ?? MATERIAL_BASE[name].color) : MATERIAL_BASE[name].color;
    const key = `${name}|${c}|shade`;
    let m = this.cache.get(key);
    if (!m) {
      m = this.make(name, c);
      shadePatch(m);
      m.userData.bakedShade = true;
      this.cache.set(key, m);
    }
    return m;
  }

  /** All materials created so far (for toggles such as wireframe / evidence colours). */
  all(): THREE.Material[] {
    return [...this.cache.values()];
  }
}

/**
 * Catalogue colours come as '#ECE8DF', '#9C4A30-#B5653F' (a range → its midpoint), or free text with a hex inside.
 * Returns null when no hex colour is found.
 */
export function normaliseColour(s: string | undefined): string | null {
  if (!s) return null;
  const hex = s.match(/#[0-9a-fA-F]{6}/g);
  if (!hex) return null;
  if (hex.length === 1) return hex[0].toUpperCase();
  const a = new THREE.Color(hex[0]);
  const b = new THREE.Color(hex[1]);
  return `#${a.lerp(b, 0.5).getHexString().toUpperCase()}`;
}

export function createMaterials(opts: MaterialLibraryOptions = {}): Materials {
  return new Materials(opts);
}

export { MATERIAL_NAMES };

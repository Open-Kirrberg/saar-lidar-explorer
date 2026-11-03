/**
 * Materials for the interiors.
 *
 * The builders take every surface from `ctx.materials` (the shared library, model/src/materials
 * once it exists). Three interior-only looks are not in MATERIAL_NAMES and are created here,
 * once per library: mirror glass, candle flames and hearth embers (names `interior.*`, so the
 * glb keeps them swappable). `createFallbackMaterials()` is a plain-colour MaterialLibrary for
 * tests and previews when no library is supplied. Colours follow research/02 §2.12 / §3.
 */
import * as THREE from 'three';
import { MATERIAL_NAMES, type MaterialLibrary, type MaterialName } from '../context.ts';
import { STATE_ROOM } from '../layout/grammar.ts';
import { DAMASK_GLSL, type DamaskFigure } from './finish.ts';
import { paintingPatch } from './painting.ts';
import { paintingAtlas } from './paintingArt.ts';

const FALLBACK: Record<MaterialName, { color: string; roughness?: number; metalness?: number; opacity?: number }> = {
  'render.lime': { color: '#ECE8DF', roughness: 0.92 },
  'render.farm': { color: '#E8DFC8', roughness: 0.92 },
  'render.member': { color: '#B9B8B2', roughness: 0.9 },
  'stone.red': { color: '#A65E4A', roughness: 0.85 },
  'stone.grey': { color: '#BDBAB2', roughness: 0.8 },
  'stone.yellow': { color: '#C8B38C', roughness: 0.85 },
  'stone.rubble': { color: '#9a8f80', roughness: 0.95 },
  'stone.marble': { color: '#E6E1D8', roughness: 0.25 },
  'roof.slate': { color: '#4a5560', roughness: 0.7 },
  'roof.tile': { color: '#9c4a32', roughness: 0.8 },
  'roof.lead': { color: '#7d8287', roughness: 0.5, metalness: 0.4 },
  'roof.copper': { color: '#5f8f7c', roughness: 0.6, metalness: 0.3 },
  'roof.thatch': { color: '#a08a5a', roughness: 1 },
  'roof.earth': { color: '#5d6b3a', roughness: 1 },
  'glass.crown': { color: '#E9F2EA', roughness: 0.05, opacity: 0.25 },
  'wood.frame': { color: '#E6E3DA', roughness: 0.6 },
  'wood.shutter': { color: '#BDBAB2', roughness: 0.7 },
  'wood.door': { color: '#E9E6DE', roughness: 0.55 },
  'metal.iron': { color: '#2c2c2e', roughness: 0.5, metalness: 0.6 },
  'metal.gilt': { color: '#D4AF37', roughness: 0.3, metalness: 1 },
  'floor.parquet': { color: '#8a5a32', roughness: 0.45 },
  'floor.flags': { color: '#a8705a', roughness: 0.6 },
  'floor.planks': { color: '#9b7b55', roughness: 0.7 },
  'floor.brick': { color: '#9c5a44', roughness: 0.9 },
  'wall.boiserie': { color: '#F1EFE8', roughness: 0.5 },
  'wall.silk.crimson': { color: '#8e1f2a', roughness: 0.6 },
  'wall.silk.blue': { color: '#3b5b8a', roughness: 0.6 },
  'wall.silk.green': { color: '#5f7f55', roughness: 0.6 },
  'wall.silk.yellow': { color: '#C9A94E', roughness: 0.6 },
  'wall.silk.grey': { color: '#A7A9A4', roughness: 0.6 },
  'wall.limewash': { color: '#ECE8DF', roughness: 0.95 },
  'wall.granite': { color: '#9B938B', roughness: 0.6 },
  'ceiling.stucco': { color: '#F3F1EA', roughness: 0.9 },
  'ground.gravel': { color: '#C8BFAE', roughness: 1 },
  'ground.grass': { color: '#6b8a45', roughness: 1 },
  'ground.cobbles': { color: '#9d8f7d', roughness: 0.95 },
  water: { color: '#4d6b73', roughness: 0.1 },
  hypothesis: { color: '#d9a441', roughness: 0.8, opacity: 0.6 },
};

/** Plain-colour library (no textures) with the same names as the shared one. */
export function createFallbackMaterials(): MaterialLibrary {
  const cache = new Map<string, THREE.Material>();
  const make = (name: MaterialName, colour?: string): THREE.Material => {
    const f = FALLBACK[name];
    const m = new THREE.MeshStandardMaterial({
      color: colour ?? f.color,
      roughness: f.roughness ?? 0.8,
      metalness: f.metalness ?? 0,
      transparent: f.opacity !== undefined,
      opacity: f.opacity ?? 1,
    });
    m.name = name;
    return m;
  };
  return {
    get(name) {
      if (!MATERIAL_NAMES.includes(name)) throw new Error(`unknown material ${name}`);
      let m = cache.get(name);
      if (!m) cache.set(name, (m = make(name)));
      return m;
    },
    tinted(name, colour) {
      const key = `${name}|${colour}`;
      let m = cache.get(key);
      if (!m) cache.set(key, (m = make(name, colour)));
      return m;
    },
  };
}

export type InteriorExtra = 'interior.mirror' | 'interior.candle' | 'interior.embers' | 'interior.crystal' | 'interior.canvas' | 'interior.vitrine';

const extras = new WeakMap<MaterialLibrary, Map<string, THREE.Material>>();

/** Interior-only materials (one set per library). */
export function interiorMaterial(lib: MaterialLibrary, name: InteriorExtra): THREE.Material {
  let map = extras.get(lib);
  if (!map) extras.set(lib, (map = new Map()));
  let m = map.get(name);
  if (!m) {
    if (name === 'interior.mirror') {
      // aged mercury glass. Wave-5 review: half-metallic glass (metalness 0.45) over the baked image went near-black
      // where the tiny room env had no window, far darker than the room it reflects. Now the reflected room is the
      // vertex-colour image (finish.ts mirrorGrid, in the room's own colours, mean ≥ 0.6 × the wall's albedo) lit like
      // the walls, so its brightness follows the room, and a glossy clearcoat adds the glass's view-dependent sheen of
      // the windows and candles from the room environment [I].
      m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, metalness: 0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1, envMap: roomEnvironment() });
    }
    else if (name === 'interior.canvas') {
      // KB-I26/I27: varnished oil canvas, colours per vertex (finish.ts canvasGrid); the varnish gives a soft sheen [N]
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, metalness: 0, roughness: 0.42 });
      // wave 10 (audit #4) review fix: the compositions painted once into an atlas (paintingArt.ts), fetched per pixel
      const atlas = paintingAtlas();
      if (atlas) paintingPatch(m, atlas);
    }
    else if (name === 'interior.vitrine') {
      // KB-I27: display-case glass seen from inside the room: clear and thin (the facade's green crown glass at
      // opacity 0.38 hid the contents of the Naturalienkabinett cases) [I]
      m = new THREE.MeshPhysicalMaterial({ color: '#E8EFEC', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03 });
    }
    else if (name === 'interior.crystal') {
      // cut rock-crystal / glass drops of the chandeliers (programme: "Bergkristall" [N research/02 §2.12]). Festsaal
      // review (wave 2): the shared crown glass (opacity 0.38) read as dark grey octahedra against the white ceiling.
      // An opaque, near-white dielectric with a high-index facet glint (quartz n ≈ 1.54, lead glass up to ≈ 1.7 [I])
      // and a clearcoat reads as clear cut crystal catching the windows by day and the candles at night; no
      // transmission pass (cost) [I].
      m = new THREE.MeshPhysicalMaterial({ color: '#F4F6F7', roughness: 0.08, metalness: 0, ior: 1.6, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.03 });
    }
    else if (name === 'interior.candle') m = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffcf80', emissiveIntensity: 2.2, roughness: 0.6 });
    else m = new THREE.MeshStandardMaterial({ color: '#3a1a0c', emissive: '#ff6a1c', emissiveIntensity: 1.6, roughness: 0.9 });
    m.name = name;
    map.set(name, m);
  }
  return m;
}

/** A room environment as linear radiance (relative units), row 0 = ceiling (zenith), `w × h` texels, RGB per texel. */
export interface RoomEnvGrid {
  w: number;
  h: number;
  /** linear RGB, row-major from the zenith row down, length w · h · 3 */
  rgb: Float32Array;
  /** mean linear luminance over all texels (the viewer scales envMapIntensity by room level / mean) */
  meanLuminance: number;
}

const srgbToLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lumOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Equirect columns that hold the windows of the 'day' room: west (u ≈ 0/1 → x 15, 0) and east (u ≈ 0.5 → x 7, 8),
 * three.js `equirectUv` convention. The palace's state rooms run along the west court front and the east garden
 * front, so their windows face W and E [I]; rooms of other orientations get the same env (one env for all rooms).
 */
export const ROOM_WINDOW_COLUMNS: readonly number[] = [15, 0, 7, 8];

/**
 * Pure twin of `roomEnvironment` (testable without WebGL): the linear radiance of the room environment.
 *
 * - 'day' (Festsaal review, wave 2): a side-lit room has a strong vertical gradient, which is what makes gilding read
 *   as metal and keeps whites from turning into an even beige [I; daylit interiors: window luminance ≈ 10–20× the
 *   lower walls, CIBSE LG10 daylighting guide gives room-surface/window ratios of this order]. Window columns
 *   (W and E) ≈ 4.4 (diffuse sky, slightly cool), the ceiling ≈ 0.6 and the upper walls ≈ 0.5 (warm off-white bounce),
 *   the dado ≈ 0.18 and the waxed-oak floor ≈ 0.15 warm brown, with two brighter floor columns for sun pools. Burnished
 *   gilt then mirrors a bright band above a dark floor (gold highlight, brown shadow), and the parquet's wax film
 *   reflects the warm lower walls instead of a grey-white room (wave-1 06: the floor read grey-mauve).
 * - 'night': candle light, mostly dark warm surroundings with bright warm texels where the candles are (the
 *   chandelier overhead, two candelabra at mid height), so gilding and parquet catch highlights (pose 07); the values
 *   are the wave-1 sRGB rows, linearised.
 */
export function roomEnvironmentGrid(kind: 'day' | 'night' = 'day'): RoomEnvGrid {
  const w = 16;
  const h = 8;
  const rgb = new Float32Array(w * h * 3);
  const win = new Set(ROOM_WINDOW_COLUMNS);
  type C = [number, number, number];
  const at = (x: number, y: number): C => {
    if (kind === 'day') {
      // [wall/ceiling, window] per row, linear relative radiance [I]
      const rows: [C, C][] = [
        [[0.78, 0.75, 0.69], [0.78, 0.75, 0.69]], // ceiling (stucco, lit by the floor and the sun pools)
        [[0.74, 0.71, 0.65], [0.74, 0.71, 0.65]],
        [[0.55, 0.52, 0.47], [2.5, 2.55, 2.7]], // cornice / upper wall, window heads
        [[0.36, 0.34, 0.31], [4.3, 4.4, 4.6]], // window band (walls: the piers between the windows, in shade): diffuse sky through the glazing
        [[0.28, 0.27, 0.25], [1.8, 1.7, 1.5]], // boiserie; lower panes see the sunlit court / parterre
        [[0.36, 0.35, 0.33], [0.36, 0.35, 0.33]], // dado (lambris d'appui)
        [[0.3, 0.28, 0.25], [0.3, 0.28, 0.25]], // waxed oak parquet
        [[0.27, 0.25, 0.22], [0.27, 0.25, 0.22]],
      ];
      // sun pools on the floor near the windows: ≈ 30× the ambient in reality, the main source of the ceiling's light
      // (no GI here), so they stand in for the bounce that keeps the stucco light
      if (y === 6 && [4, 5, 10, 11].includes(x)) return [2.5, 2.36, 2.1];
      return rows[y][win.has(x) ? 1 : 0];
    }
    const rows: C[] = [
      [104, 92, 78], // ceiling around the chandelier
      [88, 78, 66],
      [74, 66, 56], // cornice / upper wall
      [66, 59, 50],
      [58, 52, 44], // boiserie
      [50, 45, 38],
      [44, 39, 33], // floor
      [38, 34, 29],
    ];
    let c = rows[y];
    if (y === 0 && x % 4 === 0) c = [255, 222, 176]; // the chandelier's candles overhead
    if (y === 3 && (x === 3 || x === 11)) c = [255, 216, 166]; // candelabra at mid height
    return [srgbToLin(c[0]), srgbToLin(c[1]), srgbToLin(c[2])];
  };
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      rgb.set(c, (y * w + x) * 3);
      sum += lumOf(c[0], c[1], c[2]);
    }
  }
  return { w, h, rgb, meanLuminance: sum / (w * h) };
}

/**
 * Diffuse irradiance (cosine-weighted mean radiance, relative units) that a surface with unit normal `n` receives
 * from a room environment grid; rows are equal-angle latitude bands, columns follow three's `equirectUv`
 * (u = atan2(z, x) / 2π + 0.5). Used by the tests to keep the ceiling from going dark.
 */
export function roomEnvIrradiance(g: RoomEnvGrid, n: [number, number, number]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  let wsum = 0;
  for (let y = 0; y < g.h; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / g.h) * Math.PI;
    for (let x = 0; x < g.w; x++) {
      const phi = ((x + 0.5) / g.w - 0.5) * 2 * Math.PI;
      const d = [Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)];
      const solid = Math.cos(lat);
      wsum += solid;
      const cos = Math.max(0, d[0] * n[0] + d[1] * n[1] + d[2] * n[2]);
      const o = (y * g.w + x) * 3;
      for (let i = 0; i < 3; i++) out[i] += g.rgb[o + i] * cos * solid;
    }
  }
  // normalised so that a uniform environment of radiance L gives L (the π of the Lambert integral cancels)
  const k = 4 / wsum;
  return [out[0] * k, out[1] * k, out[2] * k];
}

const roomEnvs = new Map<'day' | 'night', THREE.DataTexture>();
/**
 * Tiny equirectangular "room" environment (16 × 8 half-float, linear, row 0 = ceiling): the image-based light of every
 * interior material in the viewer (KB-I06) and the reflection of the indoor mirrors (no sun hotspot in every trumeau)
 * [I]. Values from `roomEnvironmentGrid`; `userData.meanLuminance` carries the mean for the viewer's normalisation.
 */
export function roomEnvironment(kind: 'day' | 'night' = 'day'): THREE.DataTexture {
  const cached = roomEnvs.get(kind);
  if (cached) return cached;
  const g = roomEnvironmentGrid(kind);
  const data = new Uint16Array(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) {
    data[i * 4] = THREE.DataUtils.toHalfFloat(g.rgb[i * 3]);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(g.rgb[i * 3 + 1]);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(g.rgb[i * 3 + 2]);
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, g.w, g.h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = true; // row 0 = ceiling at the top
  tex.userData.meanLuminance = g.meanLuminance;
  tex.needsUpdate = true;
  roomEnvs.set(kind, tex);
  return tex;
}

/**
 * Tinted material with a per-build cache, so 100 picture fields of 8 colours make 8 materials.
 * Uses the library's `tinted` (which may or may not cache).
 */
export class Tints {
  private cache = new Map<string, THREE.Material>();
  constructor(private lib: MaterialLibrary) {}
  get(name: MaterialName, colour: string): THREE.Material {
    const key = `${name}|${colour}`;
    let m = this.cache.get(key);
    if (!m) this.cache.set(key, (m = this.lib.tinted(name, colour)));
    return m;
  }
}

const damasks = new WeakMap<MaterialLibrary, Map<string, THREE.Material>>();

/**
 * KB-I26/I27: a silk wall material with the woven damask figure (finish.ts DAMASK_GLSL). Wave-5 review: the figure is
 * a value and sheen difference only, as in a Lyon damask: the warp-faced satin ground is the glossier surface
 * (roughness × STATE_ROOM.damask.sheen[0]), the weft-faced figure matte (× sheen[1]) and ≈ 4 % lighter
 * (STATE_ROOM.damask.contrast) [N]. `figure` picks the floral palmette or the arabesque (KB-B06). A clone of the
 * library's tinted silk (same name, so exports and toggles see `wall.silk.*`), patched once per library, colour and
 * figure. UVs are metres on the wall (mesh.ts), so the repeat is true size. Chains any existing onBeforeCompile.
 */
export function damaskMaterial(lib: MaterialLibrary, name: MaterialName, colour: string, figure: DamaskFigure = 'floral'): THREE.Material {
  let map = damasks.get(lib);
  if (!map) damasks.set(lib, (map = new Map()));
  const key = `${name}|${colour}|${figure}`;
  let m = map.get(key);
  if (m) return m;
  const base = lib.tinted(name, colour);
  m = base.clone();
  m.name = base.name;
  m.userData = { ...base.userData, damask: figure };
  const prev = base.onBeforeCompile;
  const prevKey = base.customProgramCacheKey;
  const k = STATE_ROOM.damask.contrast.toFixed(3);
  const [g0, g1] = STATE_ROOM.damask.sheen.map((x) => x.toFixed(3));
  const def = figure === 'arabesque' ? '#define DAMASK_ARABESQUE\n' : '';
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDamaskUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDamaskUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vDamaskUv;\n${def}${DAMASK_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n  float damask = damaskMotif( vDamaskUv );\n  diffuseColor.rgb *= 1.0 + ${k} * ( damask - 0.3 );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = min( 1.0, roughnessFactor * mix( ${g0}, ${g1}, damask ) );`);
  };
  m.customProgramCacheKey = () => `${prevKey.call(base)}|damask-${figure}`;
  map.set(key, m);
  return m;
}

const marbles = new WeakMap<MaterialLibrary, Map<string, THREE.Material>>();

/** GLSL: soft value noise and a folded-sine vein field on the face UVs (metres) [N]. */
const MARBLE_GLSL = /* glsl */ `
float mbHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float mbNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mbHash( i ), mbHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( mbHash( i + vec2( 0.0, 1.0 ) ), mbHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float marbleVein( vec2 p, out float cloud ) {
  cloud = mbNoise( p * 2.3 ) * 0.6 + mbNoise( p * 6.1 ) * 0.3 + mbNoise( p * 15.7 ) * 0.1;
  float s = abs( sin( ( p.x * 1.1 + p.y * 1.9 ) * 2.6 + cloud * 7.0 ) );
  float aa = max( 0.03, 1.5 * fwidth( s ) );
  return ( 1.0 - smoothstep( 0.0, 0.05 + aa, s ) ) * ( 1.0 - smoothstep( 0.02, 0.08, aa ) );
}
`;

/**
 * Wave-5 review (chimneypieces read as plain white boxes): a veined marble, a clone of the library's tinted
 * `stone.marble` (same name) with a procedural vein and cloud pattern on the face UVs in metres. `vein` is the vein
 * colour (white statuary: grey veins; grey Sainte-Anne: white veins) [N research/09 §4.2 cheminée à la française].
 */
export function marbleMaterial(lib: MaterialLibrary, colour: string, vein: string): THREE.Material {
  let map = marbles.get(lib);
  if (!map) marbles.set(lib, (map = new Map()));
  const key = `${colour}|${vein}`;
  let m = map.get(key);
  if (m) return m;
  const base = lib.tinted('stone.marble', colour);
  m = base.clone();
  m.name = base.name;
  m.userData = { ...base.userData, marble: true };
  const prev = base.onBeforeCompile;
  const prevKey = base.customProgramCacheKey;
  const vc = new THREE.Color(vein);
  vc.convertSRGBToLinear();
  const v3 = `vec3( ${vc.r.toFixed(4)}, ${vc.g.toFixed(4)}, ${vc.b.toFixed(4)} )`;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMarbleUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarbleUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vMarbleUv;\n${MARBLE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n  float mbCloud;\n  float mbVein = marbleVein( vMarbleUv, mbCloud );\n  diffuseColor.rgb *= 0.94 + 0.1 * mbCloud;\n  diffuseColor.rgb = mix( diffuseColor.rgb, ${v3}, 0.55 * mbVein );`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(base)}|marble`;
  map.set(key, m);
  return m;
}

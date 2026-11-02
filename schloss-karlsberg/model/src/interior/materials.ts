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

const FALLBACK: Record<MaterialName, { color: string; roughness?: number; metalness?: number; opacity?: number }> = {
  'render.lime': { color: '#ECE8DF', roughness: 0.92 },
  'render.farm': { color: '#E8DFC8', roughness: 0.92 },
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
  'wall.limewash': { color: '#ECE8DF', roughness: 0.95 },
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

export type InteriorExtra = 'interior.mirror' | 'interior.candle' | 'interior.embers';

const extras = new WeakMap<MaterialLibrary, Map<string, THREE.Material>>();

/** Interior-only materials (one set per library). */
export function interiorMaterial(lib: MaterialLibrary, name: InteriorExtra): THREE.Material {
  let map = extras.get(lib);
  if (!map) extras.set(lib, (map = new Map()));
  let m = map.get(name);
  if (!m) {
    if (name === 'interior.mirror') {
      // aged, slightly dull mercury glass; reflects a neutral ROOM environment (no sky, no sun disc) - fix round 1
      m = new THREE.MeshStandardMaterial({ color: '#8f9692', metalness: 0.85, roughness: 0.35, envMapIntensity: 0.7, envMap: roomEnvironment() });
    }
    else if (name === 'interior.candle') m = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffcf80', emissiveIntensity: 2.2, roughness: 0.6 });
    else m = new THREE.MeshStandardMaterial({ color: '#3a1a0c', emissive: '#ff6a1c', emissiveIntensity: 1.6, roughness: 0.9 });
    m.name = name;
    map.set(name, m);
  }
  return m;
}

let roomEnv: THREE.DataTexture | null = null;
/**
 * Tiny equirectangular "room" environment for indoor mirrors: warm stucco ceiling, boiserie walls with a brighter
 * window band, parquet floor. Replaces the outdoor sky env (whose sun gave a hotspot in every trumeau).
 */
export function roomEnvironment(): THREE.DataTexture {
  if (roomEnv) return roomEnv;
  const w = 16;
  const h = 8;
  const data = new Uint8Array(w * h * 4);
  const rows: [number, number, number][] = [
    [214, 208, 196], // ceiling
    [205, 199, 186],
    [190, 182, 166], // cornice / upper wall
    [196, 194, 186], // window band (diffuse daylight, no sun)
    [176, 166, 148], // boiserie
    [150, 138, 118],
    [112, 86, 60], // parquet
    [92, 70, 50],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const win = y === 3 && x % 4 === 1 ? 18 : 0; // a few brighter window panels around the room
      data[o] = Math.min(255, rows[y][0] + win);
      data[o + 1] = Math.min(255, rows[y][1] + win);
      data[o + 2] = Math.min(255, rows[y][2] + win);
      data[o + 3] = 255;
    }
  }
  roomEnv = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  roomEnv.mapping = THREE.EquirectangularReflectionMapping;
  roomEnv.colorSpace = THREE.SRGBColorSpace;
  roomEnv.magFilter = THREE.LinearFilter;
  roomEnv.flipY = true; // row 0 = ceiling at the top
  roomEnv.needsUpdate = true;
  return roomEnv;
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

/**
 * PBR material library (exterior + viewer package).
 *
 * - One MeshStandardMaterial (MeshPhysicalMaterial for glass/water) per MaterialName, `material.name` = the name,
 *   so a glb keeps it and the explorer can swap materials (docs/architecture.md §3.6).
 * - Geometry carries UVs in METRES (world-scale mapping: walls u = along-wall, v = height; roofs along the slope;
 *   ground planar x/z). The library sets `texture.repeat = 1 / real_size_m` from viewer/textures.json, so a
 *   plaster tile is 2 m, slate 3 m, ashlar 3 m (≈ 8 courses of 0.37 m) etc.
 * - Colour comes from the catalogue: textured materials use the map as a LUMINANCE modulation around 1
 *   (shader patch), so the final albedo is exactly the catalogue tint (#ECE8DF render, #A65E4A plinth …).
 * - Colour maps are sRGB, normal / ARM maps linear. Missing textures (Node export, failed loads) fall back to the
 *   plain colour (procedural fallback = flat PBR values), never to a pink error.
 */
import * as THREE from 'three';
import { MATERIAL_NAMES, MATERIAL_TEXTURE, type MaterialLibrary, type MaterialName } from '../context.ts';

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
  'stone.red': { color: '#A65E4A', roughness: 0.85, normal: 1 },
  'stone.grey': { color: '#BDBAB2', roughness: 0.85, normal: 0.8 },
  'stone.yellow': { color: '#C9B48E', roughness: 0.85, normal: 1 },
  'stone.rubble': { color: '#8E7A68', roughness: 0.95, normal: 1 },
  'stone.marble': { color: '#E6E1D8', roughness: 0.3 },
  'roof.slate': { color: '#4B5057', roughness: 0.88, normal: 1 },
  'roof.tile': { color: '#A8573A', roughness: 0.86, normal: 1 },
  'roof.lead': { color: '#7D838A', roughness: 0.5, metalness: 0.6 },
  'roof.copper': { color: '#5F9E85', roughness: 0.55, metalness: 0.3 },
  'roof.thatch': { color: '#8F7A52', roughness: 1 },
  'roof.earth': { color: '#5E7343', roughness: 1 },
  'glass.crown': {
    color: '#1d2a30',
    roughness: 0.06,
    metalness: 0.0,
    physical: { transmission: 0.0, reflectivity: 0.6, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.52 },
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
  },
  'wood.frame': { color: '#E9E6DE', roughness: 0.6 },
  'wood.shutter': { color: '#7D8A78', roughness: 0.7 },
  'wood.door': { color: '#6B4A33', roughness: 0.6 },
  'metal.iron': { color: '#2B2D30', roughness: 0.5, metalness: 0.7 },
  'metal.gilt': { color: '#C9A24A', roughness: 0.3, metalness: 1 },
  'floor.parquet': { color: '#9A6E45', roughness: 0.45, normal: 0.6 },
  'floor.flags': { color: '#B48C78', roughness: 0.8, normal: 0.8 },
  'floor.planks': { color: '#8D6C4C', roughness: 0.75 },
  'floor.brick': { color: '#9A5040', roughness: 0.9 },
  'wall.boiserie': { color: '#E8E2D2', roughness: 0.55 },
  'wall.silk.crimson': { color: '#8E2A2E', roughness: 0.7 },
  'wall.silk.blue': { color: '#5B7798', roughness: 0.7 },
  'wall.silk.green': { color: '#5E7F5E', roughness: 0.7 },
  'wall.limewash': { color: '#EEEAE0', roughness: 0.95, normal: 0.4 },
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

/** Roof covers without the ARM roughness map (matt, roughness >= 0.85). */
const ROUGH_ROOFS: ReadonlySet<MaterialName> = new Set<MaterialName>(['roof.slate', 'roof.tile', 'roof.thatch', 'roof.earth']);

/** Mean luminance of a texture's colour map (for the luminance-modulation patch). */
function meanLuminance(img: CanvasImageSource & { width: number; height: number }): number {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return 0.5;
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    return Math.max(0.05, s / (d.length / 4));
  } catch {
    return 0.5;
  }
}

/**
 * Patch a standard material so its colour map only modulates luminance around 1 (the albedo = material.color).
 * `uMapMean` is set once the image has loaded.
 */
function lumaPatch(m: THREE.MeshStandardMaterial, mean: { value: number }, contrast = 1): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMapMean = mean;
    shader.uniforms.uMapContrast = { value: contrast };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMapMean;\nuniform float uMapContrast;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float lum = dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) / uMapMean;
  diffuseColor.rgb *= clamp( mix( 1.0, lum, uMapContrast ), 0.0, 2.0 );
#endif`,
      );
  };
  m.customProgramCacheKey = () => `luma${contrast}`;
}

export class Materials implements MaterialLibrary {
  private cache = new Map<string, THREE.Material>();
  private tex = new Map<string, { map?: THREE.Texture; normal?: THREE.Texture; arm?: THREE.Texture; mean: { value: number } }>();
  private loader: THREE.TextureLoader | null = null;
  constructor(private opts: MaterialLibraryOptions = {}) {
    if (opts.textureBase && typeof document !== 'undefined') this.loader = new THREE.TextureLoader();
  }

  private textureSet(setName: string) {
    let t = this.tex.get(setName);
    if (t) return t;
    t = { mean: { value: 0.5 } };
    this.tex.set(setName, t);
    const info = this.opts.sets?.find((s) => s.name === setName);
    if (!this.loader || !info) return t;
    const base = `${this.opts.textureBase}${setName}/`;
    const rep = new THREE.Vector2(1 / info.real_size_m[0], 1 / info.real_size_m[1]);
    const setup = (x: THREE.Texture, srgb: boolean) => {
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      x.repeat.copy(rep);
      x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      x.anisotropy = this.opts.anisotropy ?? 8;
      return x;
    };
    const mean = t.mean;
    t.map = setup(
      this.loader.load(`${base}diff.jpg`, (x) => {
        mean.value = meanLuminance(x.image as HTMLImageElement);
      }),
      true,
    );
    if (this.opts.detailMaps !== false) {
      t.normal = setup(this.loader.load(`${base}nor_gl.jpg`), false);
      t.arm = setup(this.loader.load(`${base}arm.jpg`), false);
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
      if (t.map) {
        m.map = t.map;
        lumaPatch(m, t.mean, name.startsWith('ground.') ? 1.2 : 1);
      }
      if (t.normal) {
        m.normalMap = t.normal;
        const k = b.normal ?? 1;
        m.normalScale = new THREE.Vector2(k, k);
      }
      // roofs: no ARM roughness map (it pushed the slate down to ~0.3 and the main roof read white/metallic at
      // grazing sun; fix round 1) - one rough, matt cover for main and raised roofs
      if (t.arm && !ROUGH_ROOFS.has(name)) {
        m.roughnessMap = t.arm;
        m.aoMap = null; // ARM's AO needs uv1; we keep AO from lighting only
      }
    }
    if (ROUGH_ROOFS.has(name)) m.envMapIntensity = 0.45;
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

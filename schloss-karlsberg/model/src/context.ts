/**
 * Contract between the pure core and the three.js builders (exterior, interior, site).
 * Only TYPE imports from three here, so pure code and tests can import this module.
 * See docs/architecture.md §API for the functions that consume it.
 */
import type * as THREE from 'three';
import type { Vec3 } from './frame.ts';
import { type BuildingLayout, type LayoutOptions, type RoofVariant, layoutBuilding } from './layout/building.ts';
import type { Building, Confidence, SiteSpec } from './spec.ts';

/** LOD0 massing (blocks + roof volumes) · LOD1 facades (openings, cornices, dormers) · LOD2 detail + interiors. */
export type Lod = 0 | 1 | 2;

/** Terrain height (m DHHN2016, true) at local (x, z); NaN outside the loaded terrain. */
export type TerrainSampler = (x: number, z: number) => number;

/**
 * Material names: `<surface>.<variant>`. The viewer's material library maps them to
 * MeshStandardMaterial / MeshPhysicalMaterial (research/02 §3.1) with textures from
 * viewer/textures.json; glTF export keeps the name as the material name.
 */
export const MATERIAL_NAMES = [
  'render.lime', // court buildings, #ECE8DF
  'render.farm', // Nutzbauten, #E8DFC8
  'stone.red', // red Buntsandstein: plinths, surrounds, terrace walls
  'stone.grey', // grey-painted / grey members
  'stone.yellow', // yellow-grey Buntsandstein
  'stone.rubble', // unrendered rubble (portal panels HMS, ruins)
  'stone.marble', // chimneypieces
  'roof.slate',
  'roof.tile',
  'roof.lead', // ridges, flashings, decks
  'roof.copper',
  'roof.thatch',
  'roof.earth',
  'glass.crown',
  'wood.frame', // window frames and glazing bars
  'wood.shutter',
  'wood.door',
  'metal.iron', // balconets, railings, lightning rods
  'metal.gilt',
  'floor.parquet',
  'floor.flags',
  'floor.planks',
  'floor.brick',
  'wall.boiserie',
  'wall.silk.crimson',
  'wall.silk.blue',
  'wall.silk.green',
  'wall.limewash',
  'ceiling.stucco',
  'ground.gravel',
  'ground.grass',
  'ground.cobbles',
  'water',
  'hypothesis', // evidence-style overlay for low-confidence parts
] as const;
export type MaterialName = (typeof MATERIAL_NAMES)[number];

/** Which texture set (viewer/textures.json `name`) backs a material; colour tints on top. */
export const MATERIAL_TEXTURE: Partial<Record<MaterialName, string>> = {
  'render.lime': 'lime_plaster',
  'render.farm': 'lime_plaster',
  'wall.limewash': 'lime_plaster',
  'stone.red': 'sandstone_ashlar',
  'stone.grey': 'sandstone_ashlar',
  'stone.yellow': 'sandstone_ashlar',
  'roof.slate': 'slate_roof',
  'roof.tile': 'clay_tile_roof',
  'floor.flags': 'sandstone_flags',
  'floor.parquet': 'parquet',
  'ground.gravel': 'gravel',
  'ground.grass': 'grass',
  'ground.cobbles': 'sandstone_flags',
};

export interface MaterialLibrary {
  get(name: MaterialName): THREE.Material;
  /** Same material with a different base colour (e.g. a facade colour from the catalogue). */
  tinted(name: MaterialName, colour: string): THREE.Material;
}

export interface BuildOptions {
  roofVariant: RoofVariant;
  /** realistic = period materials; evidence = colour by confidence / evidence tag. */
  style: 'realistic' | 'evidence';
  /** Include placement 'hypothetical' buildings. */
  showHypothetical: boolean;
  /** Seed for jitter (trees, weathering). */
  seed: number;
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  roofVariant: 'catalogue',
  style: 'realistic',
  showHypothetical: true,
  seed: 1789,
};

export interface BuildContext {
  spec: SiteSpec;
  lod: Lod;
  materials: MaterialLibrary;
  terrain: TerrainSampler;
  options: BuildOptions;
  /** Memoised layoutBuilding() - exterior, interior and plans all read the SAME layout. */
  layout(b: Building): BuildingLayout;
}

/** Point of interest for fly-to / walk-start (German labels). */
export interface Poi {
  id: string;
  name_de: string;
  kind: 'building' | 'room' | 'feature' | 'view' | 'entrance';
  /** Camera / walk start position in the local frame (true heights). */
  position: Vec3;
  lookAt?: Vec3;
  buildingId?: string;
  roomId?: string;
  text_de?: string;
  confidence?: Confidence;
  tags?: string;
  /** Entrances: false when the generated walls or a first step > 0.35 m block the way from the POI to the threshold. */
  walkable?: boolean;
}

export interface SiteBuildResult {
  group: THREE.Group;
  /** Meshes for walk-mode collision (three-mesh-bvh): walls, floors, stairs, terrain patches. */
  colliders: THREE.Mesh[];
  pois: Poi[];
}

/**
 * userData convention on every Object3D the builders create:
 *   { buildingId?: string; part: string; lod: Lod; confidence?: Confidence; tag?: string;
 *     collider?: boolean; roomId?: string }
 * Object names: `<buildingId>/<part>[/<detail>]`, e.g. "KB-B01/roof", "KB-B01/R-2-salon/floor".
 */
export interface PartUserData {
  buildingId?: string;
  part: string;
  lod: Lod;
  confidence?: Confidence;
  tag?: string;
  collider?: boolean;
  roomId?: string;
}

/** Layout memo shared by all builders of one context. */
export function makeLayoutFn(spec: SiteSpec, opts: LayoutOptions = {}): (b: Building) => BuildingLayout {
  const cache = new Map<string, BuildingLayout>();
  return (b) => {
    let l = cache.get(b.id);
    if (!l) {
      l = layoutBuilding(b, spec, opts);
      cache.set(b.id, l);
    }
    return l;
  };
}

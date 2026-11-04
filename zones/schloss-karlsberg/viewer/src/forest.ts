/**
 * Forest and open-land trees of the current terrain epoch (backlog KB-I09, KB-I10, KB-I44).
 *
 * - 1789: ground class 6 from the catalogue land cover (belts around Petri's lawn, the E plateau, the Hirschwürzloch,
 *   steep valley sides; research/11 S1), with a beech / oak / hornbeam mix, a shrub mantle at the edge and taller
 *   standards (Überhälter) near it [N]. 2025: today's canopy (CHM) as before.
 * - Placement is the pure `forestPlan` (landcover.ts), deterministic for the seed; in 1789 also `openTreePlan`
 *   (Überhälter out in the meadow, single field trees; its Gewann-edge hedges are not used: open strip fields had no
 *   hedges [N]), hay cocks, and the hinterland (`hinterlandPlan`, hinterland.ts): hedgerows on the land-cover parcel
 *   edges and fruit-tree meadows at the farmsteads [D PV hedges; N; I placement].
 * - Look (KB-I44): crowns are clusters of leaf clumps with smooth normals and a `crown` attribute (model
 *   site/trees.ts `unitCrown`), shaded by viewer/src/foliage.ts (inner-crown occlusion, wrap and back-light, leaf
 *   clusters near the camera, wind). Shrubs (mantle, hedges) have their own low, wide clump masses and a per-instance
 *   species colour (hawthorn, blackthorn, hazel, dog rose), so the forest edge is no longer a string of equal beads.
 * - Rendering (KB-I10): instances bucketed into FOREST_TILE m tiles, each with its own tight bounding sphere, so three's
 *   per-object frustum culling works in the main and the shadow pass. Per tile two levels:
 *   near = trunks + clump crowns (3 tree + 2 shrub variants), casting shadows;
 *   far  = crown-only small clump clusters (1 draw call), solitary trunks, no shadow casting.
 */
import * as THREE from 'three';
import { hashString, mulberry32, pointInPolygon } from '@model/layout/geom.ts';
import { unitCrown, unitDome } from '@model/site/trees.ts';
import { EDGE_BAND, edgeWeight, forestCrownForm, isForestStandSpecies } from './crownForm.ts';
import { DEFAULT_FOREST_MIX, FOREST_SPECIES, GROUND_CLASS, forestPlan, hayCockPlan, openTreePlan, plannerBaseGround, tileKey, type ForestSpecies, type ForestTree } from './landcover.ts';
import { HINTERLAND_SPECIES, hinterlandPlan, type HinterlandKind, type HinterlandPlan, type LandcoverParcel } from './hinterland.ts';
import type { TerrainData } from './terrain.ts';
import { type LocalSharedTree, type Ring, sharedScale, sharedSpecies } from './sharedTrees.ts';
import { CARD_ORDER, FOREST_CARD_CAP, FOREST_CARD_FAR, FOREST_FRINGE, fringeMaterial, leafCardGeometry } from './leafCards.ts';

/** Tile edge (m): 256-512 m per skb-schlossgarten performance.md; 320 m keeps ~35 forest tiles in the crop. */
export const FOREST_TILE = 320;
/** Distance (m, camera to the tile's box) below which a tile draws its near level. */
export const FOREST_NEAR = 420;
/** Trunk thickness factor of solitary trees at the far level (KB-I66). */
export const FAR_TRUNK = 1.8;

const ALL_SPECIES: Record<string, ForestSpecies> = { ...FOREST_SPECIES, ...HINTERLAND_SPECIES };
/** Species drawn as shrub masses (no trunk, low wide clumps). */
const SHRUBS = new Set(['shrub', 'crataegus', 'prunus_spinosa', 'corylus', 'rosa_canina']);
/** Mantle shrubs take one of the hedge shrubs' colours (hawthorn, blackthorn, hazel, dog rose) [N]. */
const MANTLE_LOOK = ['crataegus', 'prunus_spinosa', 'corylus', 'shrub', 'rosa_canina'];

const mats = new Map<string, THREE.MeshStandardMaterial>();
/** Shared materials named like the site trees, so main.ts patches them once (sky SH diffuse, foliage). */
function material(name: 'vegetation.leaf' | 'vegetation.bark' | 'vegetation.hay' | 'vegetation.leaf.mid'): THREE.MeshStandardMaterial {
  let m = mats.get(name);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: name === 'vegetation.bark' ? 0.95 : 0.92 });
    m.name = name === 'vegetation.hay' || name === 'vegetation.leaf.mid' ? 'vegetation.leaf' : name;
    // KB-I66: the crown shells under the forest's leaf cards darken out to the cards' fade distance (foliage.ts)
    if (name === 'vegetation.leaf') m.defines = { ...(m.defines ?? {}), FOL_SHELL_FAR: FOREST_CARD_FAR.toFixed(1) };
    // KB-I66 residual (wave 7): the lumpy mid / far domes of the tile meshes take the leaf-cluster relief (foliage.ts
    // FOL_MID: a bumped normal and dark gaps between leaf clusters, so the dome reads as canopy, not as "broccoli")
    if (name === 'vegetation.leaf.mid') m.defines = { ...(m.defines ?? {}), FOL_MID: '' };
    mats.set(name, m);
  }
  return m;
}

export interface Geos {
  trunk: THREE.BufferGeometry;
  crowns: THREE.BufferGeometry[];
  shrubs: THREE.BufferGeometry[];
  far: THREE.BufferGeometry;
  hay: THREE.BufferGeometry;
  /** silhouette fringe cards per mid crown variant (KB-I66 residual, wave 7); empty for 'lite' */
  fringe: THREE.BufferGeometry[];
}

/**
 * Crown tiers by camera distance (KB-I44), chosen per instance inside the near tiles. The tile meshes draw a cheap
 * 3-clump "mid" crown; within CLOSE_DIST m a 10-clump crown takes over, within HERO_DIST m its detail-1 twin (rounder
 * silhouettes at eye level). Where forest fills the screen (pose 12) the many overlapping clumps of the close crown
 * cost ~4 ms if drawn out to the 420 m near radius (A/B), so only the few hundred to ~2000 crowns near the camera
 * get them. KB-I66: the close tier reaches 300 m (was 250) but takes only the nearest FOREST_CARD_CAP.close crowns per
 * variant, all of them with leaf cards; the rest stay lumpy mid domes.
 */
export const CLOSE_DIST = 300;
export const HERO_DIST = 100;
/** Camera travel (m) before the tiers are recomputed. */
const TIER_STEP = 8;
/**
 * KB-I105: the tiers take only crowns in view. A crown out of view stays a mid dome in its tile mesh, so the tier
 * meshes (drawn without frustum culling: the set surrounds the camera) no longer submit the ~2/3 of their crowns and
 * cards behind and beside the camera. The view test widens the frustum by TIER_MARGIN_DEG (and the crown radius), and
 * the tiers are recomputed when the view has turned TIER_TURN_DEG, so a crown entering the screen is already tiered.
 * The caps are applied before the view test (nearest first over all directions), so every crown in view gets exactly
 * the tier it had before; only crowns out of view change.
 */
export const TIER_MARGIN_DEG = 14;
const TIER_TURN_DEG = 6;
/** Bounding radius of a unit tier crown (clumps scatter past the unit envelope). */
const TIER_CROWN_R = 1.5;

/**
 * Whether a crown (centre `c`, radius `r`) seen from `p` lies in the frustum widened by the angle with tangent
 * `tanMargin` (the sphere grows by its distance × tanMargin). Pure.
 */
export function tierInView(frustum: THREE.Frustum, c: THREE.Vector3, r: number, p: THREE.Vector3, tanMargin: number, sphere = new THREE.Sphere()): boolean {
  sphere.center.copy(c);
  sphere.radius = r + c.distanceTo(p) * tanMargin;
  return frustum.intersectsSphere(sphere);
}
/** Instance caps of the close tier (per variant) and of the hero tier (all variants together, nearest first). */
const TIER_CAP = 4000;
export const HERO_CAP = 700;
// stretch 1: the unit crown is about as tall as wide, so the instance scale (radius, crown height / 2) of a domed
// forest crown does not turn the clumps into upright eggs (wave-3 review: "poplar wall")
const CLOSE_CROWN = { clumps: 10, clumpR: 0.4, stretch: 1, shell: 0.7, scatter: 0.15, bottom: -0.7, core: true, limbs: 3, blend: 0.62, jitter: [0.9, 1.08] as [number, number], sizes: [0.6, 1.3] as [number, number], twigs: 2 };
const CLOSE_SHRUB = { clumps: 7, clumpR: 0.44, stretch: 0.8, shell: 0.6, scatter: 0.35, bottom: -0.3, core: true, blend: 0.55, sizes: [0.6, 1.3] as [number, number], twigs: 2 };
const SEEDS_TREE = [1789, 1789 + 7919, 1789 + 2 * 7919];
const SEEDS_SHRUB = [4242, 4242 + 7919];
let tierGeos: { crowns: THREE.BufferGeometry[]; shrubs: THREE.BufferGeometry[] }[] | null = null;
/** Geometries of the dynamic tiers: [close (detail 0, ~300 / 200 triangles), hero (detail 1, ~1400 / 760)]. */
export function tierGeometries(): NonNullable<typeof tierGeos> {
  if (!tierGeos) {
    tierGeos = [0, 1].map((detail) => ({
      // more, smaller clumps than wave 3 (9-10 clumps of 0.4-0.43 R read as metre-sized hexagonal plates on a 16 m
      // beech crown at 60-100 m, review pose 13): close 11 detail-0 clumps of mixed size, hero 16 detail-1 clumps
      crowns: SEEDS_TREE.map((s) => unitCrown(s, { ...CLOSE_CROWN, clumps: detail ? 16 : 11, clumpR: detail ? 0.31 : 0.35, jitter: detail ? [0.92, 1.06] : CLOSE_CROWN.jitter, twigs: detail ? 5 : 2, detail: detail as 0 | 1 })),
      shrubs: SEEDS_SHRUB.map((s) => unitCrown(s, { ...CLOSE_SHRUB, detail: detail as 0 | 1 })),
    }));
  }
  return tierGeos;
}

/** A crown instance of a near tile, kept so the hero level can take it over. */
interface CrownItem {
  m: THREE.Matrix4;
  c: THREE.Color;
  v: number;
  shrub: boolean;
  /** tier drawing it now: −1 tile mesh, 0 close, 1 hero */
  tier: number;
  /** state last written to the tile meshes: tier · 2 + (1 within the fringe's reach); NaN = build order */
  drawn: number;
}

/**
 * KB-I105: the fringe cards (no shadows) are drawn only on mid crowns in view (the tiers' widened frustum) and within
 * this distance (m). They shrink away by FOREST_FRINGE.far, but a near tile reaches ~870 m from the camera (box within
 * 420 m, 320 m wide), and a tile mesh is culled only as a whole, so most of its crowns can lie out of view. The tile
 * meshes list those crowns first and the fringe draws only them (+ TIER_STEP: the camera moves that far between
 * updates). The opaque mid crowns keep every instance (they cast the cached shadows).
 */
export const FRINGE_REACH = FOREST_FRINGE.far + TIER_STEP;
/**
 * Crown detail (KB-I44, KB-I66). 'full': tile meshes draw lumpy mid domes, plus the close and hero tiers near the
 * camera. 'lite': about the wave-2 budget (20-face domes everywhere, no tiers) for low-end presets and A/B benches
 * (`skb.forest.setDetail('lite')`). Far tiles draw the 28-face lumpy dome in both.
 */
export const CROWN_DETAIL = {
  // lumpy 11-meridian dome (MID_DOME, 88 triangles; KB-I66, was a 4-clump dome of 80)
  full: { tiers: true },
  // the 5-meridian dome (20 triangles) in the near tiles too
  lite: { tiers: false },
} as const;
export type CrownDetail = keyof typeof CROWN_DETAIL;

/** Mid and far forest crowns (KB-I66): lumpy domes, see `unitDome` [I]. */
export const MID_DOME = { rings: [0, 0.5, 1.0, 1.5, 2.1, Math.PI], lumps: 7, lump: 0.2, jitter: 0.13 } as const;
export const FAR_DOME = { rings: [0, 0.52, 1.5, Math.PI], lumps: 4, lump: 0.16, jitter: 0.05 } as const;

const sharedBy = new Map<CrownDetail, Geos>();
/** Shared tile geometries. Triangles: mid crown 88 (lite 20), shrub 40, far 28, hay cock 32. */
export function geometries(detail: CrownDetail): Geos {
  let shared = sharedBy.get(detail);
  if (!shared) {
    const trunk = new THREE.CylinderGeometry(1, 1.5, 1, 6, 1, true);
    trunk.translate(0, 0.5, 0);
    // far: a rounded dome with a pole on top (wave-3 review: the stretched icosahedron's flat top edge read as
    // "buckets" on the skyline)
    // KB-I66: a lumpy 7-meridian dome (28 triangles): the 5-meridian one read as pentagons and hexagons on the
    // skyline at 400-900 m (goldene-stunde u0.9)
    const far = unitDome(7, 97, FAR_DOME);
    // KB-I66: the mid crown (beyond the carded close crowns, ≲ 420 m) is one lumpy dome with a few broad leaf masses (88
    // triangles, 11 meridians: 9 read as polygons at 150 m): the 4-clump dome's
    // detail-0 clumps read as hexagonal plates at 150-400 m (tour Anflug, goldene-stunde)
    const crowns = detail === 'lite' ? SEEDS_TREE.map((s) => unitDome(5, s)) : SEEDS_TREE.map((s) => unitDome(11, s, MID_DOME));
    const shrubs = SEEDS_SHRUB.map((s) => unitCrown(s, { clumps: 2, clumpR: 0.7, stretch: 0.8, shell: 0.42, bottom: 0, core: false, blend: 0.6 }));
    // hay cock: a smooth round heap on the ground (no crown attribute: plain shading, no wind)
    const hay = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    hay.deleteAttribute('uv');
    // w = 1 switches the foliage terms off (a generic attribute default is not guaranteed per location)
    hay.setAttribute('crown', new THREE.Float32BufferAttribute(new Float32Array(hay.attributes.position.count * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)), 4));
    const fringe = detail === 'lite' ? [] : crowns.map((g, v) => leafCardGeometry(g, { ...FOREST_FRINGE, seed: 0xf1e + v * 7919 }));
    shared = { trunk, crowns, shrubs, far, hay, fringe };
    sharedBy.set(detail, shared);
  }
  return shared;
}

interface Tile {
  key: string;
  near: THREE.Group;
  far: THREE.Group;
  box: THREE.Box3;
  level: 0 | 1 | -1;
  items: CrownItem[];
  crowns: THREE.InstancedMesh[];
  shrubs: THREE.InstancedMesh[];
  /** silhouette fringe cards of the mid crowns, sharing the crown meshes' instance buffers (wave 7) */
  fringe: (THREE.InstancedMesh | null)[];
  /** number of items currently drawn by the close / hero tiers */
  tiered: number;
}

/** `out`: unit direction (grid metres) toward the nearest open land, for forest-edge trees (crown lean). */
type Planned = ForestTree & { gx: number; gy: number; kind?: HinterlandKind; out?: [number, number] };

export interface ForestOptions {
  /** palace-grid +u axis (local [x, z]) of the field pattern (hay cocks follow the baked parcels) */
  gridU?: [number, number];
  /** palace centre (local x, z) */
  centre?: [number, number];
  /** catalogue land-cover parcels (hedgerows on their edges) */
  parcels?: readonly LandcoverParcel[];
  /** farmstead buildings (local x, z) that get a fruit-tree meadow */
  farms?: readonly { id: string; x: number; z: number }[];
}

export class Forest {
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  count = 0;
  /** distance (m) camera → tile box below which the near level draws */
  nearDistance = FOREST_NEAR;
  /** hinterland counts and evidence tags of the current epoch (null in 2025) */
  hinterland: HinterlandPlan['summary'] | null = null;
  /** crown detail of the instanced crowns (KB-I44) */
  detail: CrownDetail = 'full';
  /** tier distances (m): close 10-clump crowns and detail-1 hero crowns; 0 switches a tier off */
  closeDistance = CLOSE_DIST;
  heroDistance = HERO_DIST;
  /** close-tier crowns per variant (nearest first; KB-I66: as many as carry leaf cards) */
  closeCap: number = FOREST_CARD_CAP.close;
  /** KB-I105: frustum margin (deg) of the tier view test; < 0 = tiers in all directions (A/B `skb.forest.tierMargin = -1`) */
  tierMargin = TIER_MARGIN_DEG;
  private tiers: { crowns: THREE.InstancedMesh[]; shrubs: THREE.InstancedMesh[] }[] | null = null;
  private tierAt = new THREE.Vector3(1e9, 1e9, 1e9);
  private tierDir = new THREE.Vector3();
  private tierMarginAt = NaN;
  /**
   * Camera inside a building (set by the viewer each frame): the forest is not drawn. Seen from a room the windows
   * are over-exposed for the indoor EV (KB-I06), so the forest behind them does not read; drawn, its crowns cost
   * ~0.26 M triangles in the Festsaal (wave-3 review, poses 06/07). The viewer culls the site trees likewise.
   */
  indoor = false;
  private drawnIndoor = false;
  /** Called when the close / hero tier meshes are (re)created: [close, hero] (leaf cards follow the hero tier). */
  onTiers: ((tiers: { crowns: THREE.InstancedMesh[]; shrubs: THREE.InstancedMesh[] }[]) => void) | null = null;
  constructor(
    private terrain: TerrainData,
    private opts: ForestOptions = {},
  ) {
    this.group.name = 'forest';
    this.rebuild();
  }

  /** Draw the hinterland hedgerows and orchards (A/B benches: `skb.forest.setHinterland(false)`). */
  showHinterland = true;
  setHinterland(on: boolean): void {
    if (on === this.showHinterland) return;
    this.showHinterland = on;
    this.rebuild();
  }

  /**
   * V2.7 zone mode: the explorer's shared CHM trees outside the modelled area (sharedTrees.ts selectSharedTrees). The
   * castle's own canopy / standard trees outside the rings become ghosts (they keep their tile stream, so every other
   * tree keeps its looks) and the shared trees are added with their own streams (`own`). null = the own forest only.
   */
  private shared: { trees: readonly LocalSharedTree[]; rings: readonly Ring[] } | null = null;
  setShared(trees: readonly LocalSharedTree[] | null, modelledRings: readonly Ring[] = []): void {
    if (!trees && !this.shared) return;
    this.shared = trees ? { trees, rings: modelledRings } : null;
    this.rebuild();
  }
  /** Shared trees drawn (diagnostics: `skb.forest.sharedCount`). */
  sharedCount = 0;

  /** The last tree plan in grid metres, ghosts included (diagnostics: `skb.forest.plan`). */
  plan: Planned[] = [];

  /** Wave 11 (KB-I84): thinned, clustered field trees; false = the wave-2 scatter (A/B: `skb.forest.setClustered(false)`). */
  clusteredFieldTrees = true;
  setClustered(on: boolean): void {
    if (on === this.clusteredFieldTrees) return;
    this.clusteredFieldTrees = on;
    this.rebuild();
  }

  /** Silhouette fringe cards on the mid crowns (KB-I66 residual, wave 7; A/B: `skb.forest.setFringe(false)`). */
  showFringe = true;
  setFringe(on: boolean): void {
    this.showFringe = on;
    for (const t of this.tiles) for (const fm of t.fringe) if (fm) fm.visible = on;
  }

  /** Switch the crown detail and rebuild (quality presets, A/B benches). */
  setDetail(detail: CrownDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.rebuild();
  }

  /** (Re)build the instances from the terrain's current epoch (ground classes and heights). */
  rebuild(): void {
    for (const t of this.tiles) {
      for (const g of [t.near, t.far])
        g.traverse((o) => {
          if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        });
    }
    for (const t of this.tiers ?? []) for (const im of [...t.crowns, ...t.shrubs]) im.dispose();
    this.group.clear();
    this.tiles = [];
    this.tiers = null;
    this.tierAt.set(1e9, 1e9, 1e9);
    this.hinterland = null;
    const t = this.terrain;
    const gm = t.meta.ground;
    const grid = t.meta.grid;
    const gg = { ground: t.ground, cols: gm.cols, rows: gm.rows, cell: gm.cell };
    const ox = grid.west - 381000;
    const oz = -(grid.north - 5465000);
    const plan: Planned[] = forestPlan(gg, { mix: DEFAULT_FOREST_MIX, seed: 1789 });
    // forest-edge trees: direction toward the open land (their crowns lean out, crownForm.ts)
    for (const p of plan) if ((p.role === 'canopy' || p.role === 'standard') && p.edge < EDGE_BAND) p.out = outward(gg, p.gx, p.gy, p.edge);
    const shared = this.shared;
    if (shared) {
      const rings = shared.rings.filter((r) => r.length >= 3) as [number, number][][];
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if ((p.role === 'canopy' || p.role === 'standard') && !rings.some((r) => pointInPolygon([ox + p.gx, oz + p.gy], r))) plan[i] = { ...p, ghost: true };
      }
    }
    if (t.epoch === '1789') {
      // KB-I96 (wave-11 review fix): the open-land planners take their seeded order from the base ground (without the
      // land cover painted over it since, e.g. the wave-11 Gewann fill); a tree whose cell changed is kept as a `ghost`
      // (drawn from the tile stream, not shown), so no land-cover edit re-rolls another tree's looks
      const base = plannerBaseGround(t.ground, gm.cols, gm.plannerBase?.runs);
      const gb = { ...gg, ground: base };
      const cellOf = (p: Planned) => {
        const c = Math.floor(p.gx / gm.cell);
        const r = Math.floor(p.gy / gm.cell);
        return c < 0 || r < 0 || c >= gm.cols || r >= gm.rows ? -1 : r * gm.cols + c;
      };
      const ghostIfRepainted = (list: Planned[]): Planned[] =>
        base === t.ground
          ? list
          : list.map((p) => {
              const i = cellOf(p);
              return i >= 0 && base[i] !== t.ground[i] ? { ...p, ghost: true as const } : p;
            });
      // no gridU: the Gewann-edge hedges are replaced by the hinterland hedgerows (open strip fields, KB-I44)
      // wave 11 (KB-I84): field trees thinned to farmsteads, ways, field edges and banks, plus seeded groups there
      plan.push(...openTreePlan(gg, { seed: 1789, ox, oz, base, farms: (this.opts.farms ?? []).map((f) => ({ gx: f.x - ox, gy: f.z - oz })), clustered: this.clusteredFieldTrees, ghosts: true, core: this.opts.centre ? [this.opts.centre[0] - ox, this.opts.centre[1] - oz] : undefined }));
      // hay cocks on cut parcels near the palace (wave-2 review wow cue)
      if (this.opts.gridU && this.opts.centre) plan.push(...ghostIfRepainted(hayCockPlan(gb, { ox, oz, gridU: this.opts.gridU, centre: this.opts.centre })));
      if (this.opts.parcels?.length && this.showHinterland) {
        const h = hinterlandPlan(gb, {
          west: grid.west,
          north: grid.north,
          parcels: this.opts.parcels,
          farms: (this.opts.farms ?? []).map((f) => ({ id: f.id, gx: f.x - ox, gy: f.z - oz })),
          core: this.opts.centre ? [this.opts.centre[0] - ox, this.opts.centre[1] - oz] : undefined,
          height: (gx, gy) => t.sample(ox + gx, oz + gy),
          seed: 1789,
        });
        plan.push(...ghostIfRepainted(h.trees));
        this.hinterland = h.summary;
      }
    }
    this.sharedCount = 0;
    if (shared) {
      for (const st of shared.trees) {
        const species = sharedSpecies(st.id);
        const gx = st.x - ox;
        const gy = st.z - oz;
        plan.push({ gx, gy, x: gx, z: gy, species, scale: sharedScale(species, st.h), role: 'canopy', edge: EDGE_BAND * 4, own: true });
      }
      this.sharedCount = shared.trees.length;
    }
    this.plan = plan;
    const buckets = new Map<string, Planned[]>();
    for (const p of plan) {
      const k = tileKey(p.gx, p.gy, FOREST_TILE);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(p);
    }
    let count = 0;
    for (const [key, list] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const placed: { x: number; y: number; z: number; tree: Planned }[] = [];
      for (const p of list) {
        const x = ox + p.gx;
        const z = oz + p.gy;
        const y = t.sample(x, z);
        if (Number.isFinite(y)) placed.push({ x, y, z, tree: p });
      }
      // wave 11: a tile left with thinned-away (ghost) field trees only is not built
      const nDrawn = placed.filter((p) => !p.tree.ghost).length;
      if (!nDrawn) continue;
      const tile = this.buildTile(key, placed);
      this.tiles.push(tile);
      this.group.add(tile.near, tile.far);
      count += nDrawn;
    }
    this.count = count;
    this.group.userData.count = count;
    this.group.userData.tiles = this.tiles.length;
  }

  private buildTile(key: string, placed: { x: number; y: number; z: number; tree: Planned }[]): Tile {
    const geo = geometries(this.detail);
    const rnd = mulberry32(hashString(key) ^ 0x2545f491);
    const isHay = (p: { tree: Planned }) => p.tree.species === 'haycock';
    const isShrub = (p: { tree: Planned }) => SHRUBS.has(p.tree.species);
    const hasTrunk = (p: { tree: Planned }) => !isShrub(p) && !isHay(p);
    // wave 11 (KB-I84): the plan's trees in their order take the tile stream, thinned-away field trees (`ghost`) included
    // (they draw their values but are not drawn, so every other tree of the tile keeps its looks); the seeded field-tree
    // groups (`own`) come last, each with its own stream from its position
    const mainP = placed.filter((p) => !p.tree.own);
    const ownP = placed.filter((p) => p.tree.own);
    const order = [...mainP, ...ownP];
    const streams = [...mainP.map(() => rnd), ...ownP.map((p) => mulberry32(hashString(`${p.tree.gx.toFixed(2)},${p.tree.gy.toFixed(2)}`) ^ 0x51ed27))];
    const drawn = (p: { tree: Planned }) => !p.tree.ghost;
    const nTrunk = order.filter((p) => drawn(p) && hasTrunk(p)).length;
    const trunks = new THREE.InstancedMesh(geo.trunk, material('vegetation.bark'), Math.max(1, nTrunk));
    trunks.count = nTrunk;
    // variant per instance: trees 0..2 → crowns, shrubs 0..1 → shrubs
    const which = order.map((p, i) => (isShrub(p) ? Math.floor(streams[i]() * geo.shrubs.length) : Math.floor(streams[i]() * geo.crowns.length)));
    const mk = (g: THREE.BufferGeometry, n: number, m = material('vegetation.leaf')) => {
      const im = new THREE.InstancedMesh(g, m, Math.max(1, n));
      im.count = n;
      return im;
    };
    // the tile crowns (lumpy mid domes; 'lite' 20-face domes) take the leaf-cluster relief (FOL_MID, wave 7)
    const crowns = geo.crowns.map((g, v) => mk(g, order.filter((p, i) => drawn(p) && hasTrunk(p) && which[i] === v).length, material('vegetation.leaf.mid')));
    const shrubs = geo.shrubs.map((g, v) => mk(g, order.filter((p, i) => drawn(p) && isShrub(p) && which[i] === v).length));
    const nHay = order.filter((p) => drawn(p) && isHay(p)).length;
    const hay = mk(geo.hay, nHay, material('vegetation.hay'));
    // solitary trees in the open keep their trunk at the far level too (a crown alone reads as a floating ball)
    const solitary = (p: { tree: Planned }) => hasTrunk(p) && (p.tree.role === 'field' || p.tree.role === 'hedge' || (p.tree.role === 'standard' && p.tree.edge === 0));
    const nSol = order.filter((p) => drawn(p) && solitary(p)).length;
    const nFar = order.filter(drawn).length - nHay - nSol;
    const far = mk(geo.far, nFar, material('vegetation.leaf.mid'));
    // KB-I66: their far crowns cast shadows too (a shadow on the meadow anchors a crown seen at 400-900 m)
    const farSolo = mk(geo.far, nSol, material('vegetation.leaf.mid'));
    let si = 0;
    const farTrunks = new THREE.InstancedMesh(geo.trunk, material('vegetation.bark'), Math.max(1, nSol));
    farTrunks.count = nSol;
    let fi = 0;
    let ri = 0;
    let hi = 0;
    const fillC = [0, 0, 0];
    const fillS = [0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const ax = new THREE.Vector3();
    const c = new THREE.Color();
    const bark = new THREE.Color();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let ti = 0;
    const box = new THREE.Box3();
    const items: CrownItem[] = [];
    order.forEach((p, i) => {
      const rnd = streams[i];
      const tr = p.tree;
      // mantle shrubs borrow a hedge shrub's look (species colour and size), hashed per shrub
      const lookKey = tr.role === 'mantle' ? MANTLE_LOOK[Math.floor(rnd() * MANTLE_LOOK.length)] : tr.species;
      const sp = ALL_SPECIES[lookKey] ?? ALL_SPECIES[tr.species] ?? FOREST_SPECIES.fagus;
      const shrub = isShrub(p);
      // per-instance size: shrubs vary more (2-5 m mantle, irregular hedges) [I]
      // mantle shrubs 2.5-6 m with wide masses that close the gaps under the edge trees [N Waldmantel; I]
      // hedge shrubs come with their final height from the hinterland plan (1.5-5 m, smooth along the line)
      const s = tr.scale * (shrub ? (tr.role === 'hedge' ? 1 : 0.75 + rnd() * 0.5) : 0.9 + rnd() * 0.2) * (tr.role === 'mantle' ? 1.25 : 1);
      const h = sp.height * s;
      const orchard = tr.kind === 'orchard';
      // beech / oak / hornbeam of the stand: broad domed crowns (aspect 0.9-1.3, depth ~0.55 of the height); at the
      // edge the crown comes lower and leans toward the open land (crownForm.ts; wave-3 review "poplar wall") [N; I]
      const stand = (tr.role === 'canopy' || tr.role === 'standard') && isForestStandSpecies(tr.species);
      const openGrown = tr.role === 'standard' && tr.edge === 0; // Überhälter out in the meadow (openTreePlan)
      const form = stand ? forestCrownForm(tr.species, h, tr.edge, rnd(), rnd(), !!tr.out, openGrown) : null;
      // open-grown field trees: broad crowns down to ~1/5 of the height; standard fruit trees keep their 1.8 m stem
      const trunkFrac = form ? form.trunkFrac : orchard ? sp.trunkFrac : tr.role === 'field' ? 0.12 : sp.trunkFrac;
      const crownH = h * (1 - trunkFrac);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      // a slight lean (≤ 4°, field and hedge trees and orchards up to 7°) breaks the regular look [I]
      const lean = ((tr.role === 'field' || tr.role === 'hedge' ? 7 : 4) * Math.PI) / 180;
      const la = rnd() * Math.PI * 2;
      const lr = (rnd() - 0.5) * 2;
      if (form && form.lean > 0 && tr.out) {
        // tilt the crown top toward the open land: axis = up × out
        qt.setFromAxisAngle(ax.set(tr.out[1], 0, -tr.out[0]), form.lean + lr * 0.03);
      } else qt.setFromAxisAngle(ax.set(Math.cos(la), 0, Math.sin(la)), lr * lean * (shrub || isHay(p) ? 0 : 1));
      q.premultiply(qt);
      const crr = rnd();
      const cr = form ? form.radius : sp.crown * Math.sqrt(s) * (0.85 + crr * 0.3) * ((tr.role === 'field' && !orchard) || tr.role === 'mantle' ? 1.2 : 1);
      // crowns are not round: ±12 % between the two horizontal axes
      const ell = 0.88 + rnd() * 0.24;
      // per-instance hue / saturation / lightness; the clumps add their own variation in the shader (KB-I44) [I]
      c.set(sp.leaf).offsetHSL((rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.14, (rnd() - 0.45) * 0.08);
      // a thinned-away tree: its last draw (the bark tone) and nothing on screen
      if (tr.ghost) {
        if (hasTrunk(p) || isHay(p)) rnd();
        return;
      }
      if (isHay(p)) {
        m.compose(pos.set(p.x, p.y - 0.1, p.z), q, scl.set(sp.crown * s, h + 0.1, sp.crown * s));
        hay.setMatrixAt(hi, m);
        hay.setColorAt(hi, c.set(sp.leaf).offsetHSL(0, 0, (rnd() - 0.5) * 0.06));
        hi++;
        box.expandByPoint(pos.set(p.x - 2, p.y - 1, p.z - 2));
        box.expandByPoint(pos.set(p.x + 2, p.y + 3, p.z + 2));
        return;
      }
      if (hasTrunk(p)) {
        const r = 0.12 * (h / 6) ** 0.7;
        const top = h * trunkFrac + crownH * 0.3;
        m.compose(pos.set(p.x, p.y - 0.2, p.z), q, scl.set(r, top + 0.2, r));
        bark.set(sp.bark).offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
        // stems under the closed canopy stand in deep shade: the light beech grey read as stilts behind the edge row
        // (wave-3 review, pose 12); the edge row and solitary trees keep their bark colour [I]
        if (form && !openGrown) bark.multiplyScalar(0.5 + 0.5 * edgeWeight(tr.edge + 6));
        trunks.setMatrixAt(ti, m);
        trunks.setColorAt(ti, bark);
        ti++;
        if (solitary(p)) {
          // KB-I66: a stub 1.8× as thick at the far level (≥ 420 m), so the stem stays about a pixel wide [I]
          m.compose(pos.set(p.x, p.y - 0.2, p.z), q, scl.set(r * FAR_TRUNK, top + 0.2, r * FAR_TRUNK));
          farTrunks.setMatrixAt(fi, m);
          farTrunks.setColorAt(fi, bark);
          fi++;
        }
      }
      // crown centre follows the lean; edge crowns also shift toward the open land
      const cy = h - crownH / 2;
      pos.set(0, cy, 0).applyQuaternion(qt).add(ax.set(p.x, p.y, p.z));
      if (form && tr.out) pos.add(ax.set(tr.out[0] * form.shift, 0, tr.out[1] * form.shift));
      m.compose(pos, q, scl.set(cr * ell, crownH / 2, cr / ell));
      if (shrub) {
        const im = shrubs[which[i]];
        const j = fillS[which[i]]++;
        im.setMatrixAt(j, m);
        im.setColorAt(j, c);
      } else {
        const im = crowns[which[i]];
        const j = fillC[which[i]]++;
        im.setMatrixAt(j, m);
        im.setColorAt(j, c);
      }
      items.push({ m: m.clone(), c: c.clone(), v: which[i], shrub, tier: -1, drawn: NaN });
      if (solitary(p)) {
        farSolo.setMatrixAt(si, m);
        farSolo.setColorAt(si, c);
        si++;
      } else {
        far.setMatrixAt(ri, m);
        far.setColorAt(ri, c);
        ri++;
      }
      const reach = cr * 1.15 + (form ? form.shift + crownH * Math.sin(form.lean) : 0) + 1;
      box.expandByPoint(pos.set(p.x - reach, p.y - 1, p.z - reach));
      box.expandByPoint(pos.set(p.x + reach, p.y + h + 1, p.z + reach));
    });
    const near = new THREE.Group();
    near.name = `forest/${key}/near`;
    trunks.name = `forest/${key}/trunks`;
    crowns.forEach((im, v) => (im.name = `forest/${key}/crowns${v ? `-${v}` : ''}`));
    shrubs.forEach((im, v) => (im.name = `forest/${key}/shrubs${v ? `-${v}` : ''}`));
    hay.name = `forest/${key}/haycocks`;
    for (const im of [trunks, ...crowns, ...shrubs]) {
      if (!im.count) continue;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.userData = { part: 'vegetation', species: 'forest' };
      near.add(im);
    }
    // KB-I66 residual (wave 7): leaf-card fringe on the mid domes' silhouettes, sharing the crown instance buffers
    // (their order and count follow the tier updates); drawn with the near level, after the opaque crowns
    const fringe = crowns.map((im, v) => {
      if (!im.count || !geo.fringe[v]) return null;
      const fm = new THREE.InstancedMesh(geo.fringe[v], fringeMaterial(), 1);
      fm.instanceMatrix = im.instanceMatrix;
      fm.instanceColor = im.instanceColor;
      fm.count = im.count;
      fm.boundingSphere = im.boundingSphere!.clone();
      fm.boundingSphere.radius += 4;
      fm.name = `forest/${key}/fringe${v ? `-${v}` : ''}`;
      fm.castShadow = false;
      fm.receiveShadow = true;
      fm.renderOrder = CARD_ORDER;
      fm.userData = { part: 'vegetation', species: 'forest', lod: 'fringe' };
      fm.visible = this.showFringe;
      near.add(fm);
      return fm;
    });
    const farG = new THREE.Group();
    farG.name = `forest/${key}/far`;
    far.name = `forest/${key}/impostors`;
    far.castShadow = false;
    far.receiveShadow = true;
    far.userData = { part: 'vegetation', species: 'forest' };
    if (far.count) {
      far.computeBoundingSphere();
      farG.add(far);
    }
    if (nSol) {
      farSolo.name = `forest/${key}/impostors-solitary`;
      farSolo.castShadow = true;
      farSolo.receiveShadow = true;
      farSolo.userData = { part: 'vegetation', species: 'forest' };
      farSolo.computeBoundingSphere();
      farG.add(farSolo);
      farTrunks.name = `forest/${key}/far-trunks`;
      farTrunks.castShadow = true;
      farTrunks.receiveShadow = true;
      farTrunks.computeBoundingSphere();
      farTrunks.userData = { part: 'vegetation', species: 'forest' };
      farG.add(farTrunks);
    }
    if (nHay) {
      // hay cocks: one mesh shared by both levels (tiny), no shadow casting beyond the near level
      hay.castShadow = true;
      hay.receiveShadow = true;
      hay.computeBoundingSphere();
      hay.userData = { part: 'vegetation', species: 'haycock' };
      near.add(hay);
      const hayFar = new THREE.InstancedMesh(hay.geometry, hay.material, nHay);
      hayFar.instanceMatrix.copy(hay.instanceMatrix);
      if (hay.instanceColor) hayFar.instanceColor = hay.instanceColor;
      hayFar.name = `forest/${key}/haycocks-far`;
      hayFar.castShadow = false;
      hayFar.receiveShadow = true;
      hayFar.computeBoundingSphere();
      hayFar.userData = { part: 'vegetation', species: 'haycock' };
      farG.add(hayFar);
    }
    near.visible = false;
    farG.visible = true;
    return { key, near, far: farG, box, level: -1, items, crowns, shrubs, fringe, tiered: 0 };
  }

  /**
   * Pick each tile's level by the camera distance to its box (`detail` scales the near distance). Returns true when
   * any tile changed level, so the caller can redraw the cached shadow map.
   */
  update(camera: THREE.Camera, detail = 1): boolean {
    const p = camera.position;
    let changed = false;
    if (this.indoor !== this.drawnIndoor) {
      this.drawnIndoor = this.indoor;
      this.group.visible = !this.indoor;
      changed = true;
    }
    if (this.indoor) return changed;
    for (const t of this.tiles) {
      const level: 0 | 1 = t.box.distanceToPoint(p) < this.nearDistance * detail ? 0 : 1;
      if (level === t.level) continue;
      t.level = level;
      t.near.visible = level === 0;
      t.far.visible = level === 1;
      changed = true;
    }
    if (CROWN_DETAIL[this.detail].tiers && (changed || p.distanceToSquared(this.tierAt) > TIER_STEP * TIER_STEP || this.turned(camera))) this.updateTiers(camera);
    return changed;
  }

  /** Force a tier update now (after changing the tier distances). */
  refreshTiers(camera: THREE.Camera): void {
    this.tierAt.set(1e9, 1e9, 1e9);
    this.updateTiers(camera);
  }

  /** The view turned TIER_TURN_DEG since the last tier update (or the margin changed). */
  private turned(camera: THREE.Camera): boolean {
    if (this.tierMargin !== this.tierMarginAt) return true;
    if (this.tierMargin < 0) return false;
    return camera.getWorldDirection(new THREE.Vector3()).dot(this.tierDir) < Math.cos((TIER_TURN_DEG * Math.PI) / 180);
  }

  /**
   * Close and hero tiers: crowns of near tiles within `closeDistance` / `heroDistance` of the camera move from the tile
   * meshes (mid crowns) to shared tier meshes. Only matrices are rewritten, when the camera has moved TIER_STEP m. The
   * shadow map is not marked dirty: all tiers share the crown envelope.
   */
  private updateTiers(camera: THREE.Camera): void {
    const p = camera.position;
    this.tierAt.copy(p);
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.tierDir);
    this.tierMarginAt = this.tierMargin;
    const viewTest = this.tierMargin >= 0;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const tanMargin = Math.tan((Math.max(0, this.tierMargin) * Math.PI) / 180);
    const sphere = new THREE.Sphere();
    if (!this.tiers) {
      this.tiers = tierGeometries().map((g, k) => {
        const name = k ? 'hero' : 'close';
        const mk = (geo: THREE.BufferGeometry, n: string) => {
          const im = new THREE.InstancedMesh(geo, material('vegetation.leaf'), TIER_CAP);
          im.count = 0;
          im.name = n;
          im.castShadow = true;
          im.receiveShadow = true;
          im.frustumCulled = false; // the set changes with the camera and is always around it
          im.userData = { part: 'vegetation', species: 'forest', lod: name };
          im.setColorAt(0, new THREE.Color());
          this.group.add(im);
          return im;
        };
        return { crowns: g.crowns.map((geo, v) => mk(geo, `forest/${name}/crowns-${v}`)), shrubs: g.shrubs.map((geo, v) => mk(geo, `forest/${name}/shrubs-${v}`)) };
      });
      this.onTiers?.(this.tiers);
    }
    const tiers = this.tiers;
    const close2 = this.closeDistance * this.closeDistance;
    const hero2 = this.heroDistance * this.heroDistance;
    const reach = Math.max(this.closeDistance, this.heroDistance);
    const e = new THREE.Vector3();
    // 1. candidates within the tier radii, nearest first: the caps keep the nearest crowns, and drawing the tier
    //    instances front to back lets early depth rejection skip the hidden clumps behind them (desktop GPUs; tile-
    //    based GPUs remove hidden opaque fragments anyway)
    const cand: { it: CrownItem; d2: number }[] = [];
    for (const t of this.tiles) {
      const inRange = t.level === 0 && t.box.distanceToPoint(p) < reach;
      if (!inRange && !t.tiered) continue;
      for (const it of t.items) it.tier = -1;
      if (!inRange) continue;
      for (const it of t.items) {
        const d2 = e.setFromMatrixPosition(it.m).distanceToSquared(p);
        if (d2 < close2 || d2 < hero2) cand.push({ it, d2 });
      }
    }
    cand.sort((x, y) => x.d2 - y.d2);
    const fills = tiers.map((t) => ({ c: t.crowns.map(() => 0), s: t.shrubs.map(() => 0) }));
    // cap accounting over all directions (nearest first), so a crown in view keeps the tier it would have without the view test
    const used = tiers.map((t) => ({ c: t.crowns.map(() => 0), s: t.shrubs.map(() => 0) }));
    let heroN = 0;
    // KB-I66: the close tier only takes the crowns that get cards (FOREST_CARD_CAP per variant, nearest first)
    const caps = [Math.min(TIER_CAP, this.closeCap), TIER_CAP];
    for (const { it, d2 } of cand) {
      let k = d2 < hero2 && heroN < HERO_CAP ? 1 : d2 < close2 ? 0 : -1;
      if (k < 0) continue;
      let u = it.shrub ? used[k].s : used[k].c;
      if (u[it.v] >= caps[k]) {
        if (k === 1 && d2 < close2) k = 0;
        else continue;
        u = it.shrub ? used[k].s : used[k].c;
        if (u[it.v] >= caps[k]) continue;
      }
      if (k === 1) heroN++;
      u[it.v]++;
      if (viewTest && !tierInView(frustum, e.setFromMatrixPosition(it.m), TIER_CROWN_R * it.m.getMaxScaleOnAxis(), p, tanMargin, sphere)) continue;
      const f = it.shrub ? fills[k].s : fills[k].c;
      const im = it.shrub ? tiers[k].shrubs[it.v] : tiers[k].crowns[it.v];
      im.setMatrixAt(f[it.v], it.m);
      im.setColorAt(f[it.v], it.c);
      f[it.v]++;
      it.tier = k;
    }
    // 2. the tile meshes draw the rest (mid crowns): near tiles list the crowns in view within FRINGE_REACH first, and
    //    their fringe draws only those; a tile is rewritten only when an item changed tier or fringe state
    const reach2 = FRINGE_REACH * FRINGE_REACH;
    for (const t of this.tiles) {
      if (t.level !== 0 && !t.tiered) continue;
      let tiered = 0;
      let dirty = false;
      for (const it of t.items) {
        if (it.tier >= 0) tiered++;
        let ring = 1;
        if (t.level === 0 && it.tier < 0 && !it.shrub) {
          e.setFromMatrixPosition(it.m);
          ring = e.distanceToSquared(p) < reach2 && (!viewTest || tierInView(frustum, e, TIER_CROWN_R * it.m.getMaxScaleOnAxis(), p, tanMargin, sphere)) ? 1 : 0;
        }
        const st = it.tier * 2 + ring;
        if (st !== it.drawn) {
          it.drawn = st;
          dirty = true;
        }
      }
      t.tiered = tiered;
      if (!dirty) continue;
      // per variant: the crowns within reach from 0, the others after them
      const inC = t.crowns.map(() => 0);
      const inS = t.shrubs.map(() => 0);
      for (const it of t.items) if (it.tier < 0 && it.drawn & 1) (it.shrub ? inS : inC)[it.v]++;
      const fc = t.crowns.map(() => 0);
      const fs = t.shrubs.map(() => 0);
      const gc = [...inC];
      const gs = [...inS];
      for (const it of t.items) {
        if (it.tier >= 0) continue;
        const im = it.shrub ? t.shrubs[it.v] : t.crowns[it.v];
        const g = it.drawn & 1 ? (it.shrub ? fs : fc) : it.shrub ? gs : gc;
        im.setMatrixAt(g[it.v], it.m);
        im.setColorAt(g[it.v], it.c);
        g[it.v]++;
      }
      [...t.crowns, ...t.shrubs].forEach((im, k) => {
        im.count = k < t.crowns.length ? gc[k] : gs[k - t.crowns.length];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      });
      t.fringe.forEach((fm, k) => {
        if (fm) fm.count = fc[k];
      });
    }
    tiers.forEach((tier, k) =>
      [...tier.crowns, ...tier.shrubs].forEach((im, j) => {
        im.count = j < tier.crowns.length ? fills[k].c[j] : fills[k].s[j - tier.crowns.length];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }),
    );
  }

  /** Counts for the test hooks and the backlog log: trees, tiles, tiles drawn near, hinterland by kind. */
  stats(): { trees: number; tiles: number; near: number; close: number; hero: number; hinterland: Record<string, number> | null } {
    const h = this.hinterland ? Object.fromEntries(Object.entries(this.hinterland).map(([k, v]) => [k, v.count])) : null;
    const n = (k: number) => (this.tiers ? [...this.tiers[k].crowns, ...this.tiers[k].shrubs].reduce((a, im) => a + im.count, 0) : 0);
    return { trees: this.count, tiles: this.tiles.length, near: this.tiles.filter((t) => t.level === 0).length, close: n(0), hero: n(1), hinterland: h };
  }
}

/**
 * Unit direction (grid metres) from a forest tree toward the open land: the mean of 12 directions whose sample at
 * `edge + 8` m is not forest; undefined deep in the stand or when open land lies all around.
 */
function outward(g: { ground: Uint8Array; cols: number; rows: number; cell: number }, gx: number, gy: number, edge: number): [number, number] | undefined {
  const r = edge + 8;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const c = Math.floor((gx + Math.cos(a) * r) / g.cell);
    const w = Math.floor((gy + Math.sin(a) * r) / g.cell);
    if (c < 0 || w < 0 || c >= g.cols || w >= g.rows) continue;
    if (g.ground[w * g.cols + c] === GROUND_CLASS.forest) continue;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const l = Math.hypot(sx, sy);
  return l > 0.8 ? [sx / l, sy / l] : undefined;
}


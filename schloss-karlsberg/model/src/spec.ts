/**
 * Catalogue v2 types: the single description of the Karlsberg residence that the generator,
 * the viewer, the interiors and the plan drawings all consume.
 *
 * v2 is a SUPERSET of model/catalogue.json v1: every v1 field keeps its name and meaning;
 * v2 adds structured fields (risalits, portals, rooms, openings, stairs, court_toward...)
 * next to the v1 free-text fields. `upgradeV1()` (validate.ts) turns a v1 document into v2.
 *
 * Units: metres, degrees, heights in m DHHN2016 (true heights, no exaggeration).
 * Plan coordinates: EN = [E, N] in EPSG:25832. Building-local plan coordinates: [s, t] in
 * metres, see layout/footprint.ts (s = long axis, t = towards the court side).
 *
 * Evidence: every number that is not trivially derived carries a tag string. Tag letters:
 *   D documented · D-> derived from documented numbers · I inferred · N period norm ·
 *   U unknown · HMS secondary (HMS/Matzerath 2022 video, copyrighted, interpretation only).
 * v1 tags are free text ("N; HMS shows plinth ..."); use parseEvidenceTags() to get the letters.
 */

// ---------------------------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------------------------

/** [E, N] in EPSG:25832 (metres). */
export type EN = [number, number];
/** Closed ring of EN points (first == last), CCW after upgrade. */
export type RingEN = EN[];
/** Building-local plan point [s, t] in metres (see layout/footprint.ts). */
export type ST = [number, number];
/** Polygon in building-local metres; NOT closed (first != last), CCW. */
export type PolygonST = ST[];

export const EVIDENCE_TAGS = ['D', 'D->', 'I', 'N', 'U', 'HMS'] as const;
export type EvidenceTag = (typeof EVIDENCE_TAGS)[number];
/** Free-text evidence note that starts with / contains tag letters, e.g. "N; HMS shows plinth". */
export type TagNote = string;

export type Confidence = 'high' | 'med' | 'low';
export type Placement =
  | 'lidar'
  | 'lidar+hms'
  | 'map+lidar'
  /** v2: placed from a georeferenced plan only (2006 Lageplan, research/07), no own LiDAR remains. */
  | 'map'
  | 'existing'
  | 'relative'
  | 'hypothetical'
  | 'unplaced';

/** Template classes of research/02 §2.1 ('?' = unplaced, class unknown). */
export type BuildingClass =
  | 'CDL'
  | 'WING2'
  | 'RANGE1'
  | 'PAV'
  | 'STABLE'
  | 'RIDE'
  | 'ORANG'
  | 'FARM'
  | 'FARM_GROUP'
  | 'GARD'
  | 'WALL'
  | '?';

export type InteriorLevel = 'detailed' | 'simple' | 'none';

/** Side roles of a building's oriented rectangle (layout/footprint.ts). */
export type SideName = 'court' | 'garden' | 'end_a' | 'end_b';
export const SIDE_NAMES: readonly SideName[] = ['garden', 'end_b', 'court', 'end_a'];

// ---------------------------------------------------------------------------------------------
// Storeys
// ---------------------------------------------------------------------------------------------

/**
 * plinth   : Sockel / Souterrain strip below the first floor (cellar windows), not a walkable floor
 * basement : full-height lower storey with real openings (Orangerie "hohes Kellergeschoss")
 * floor    : a normal storey (EG, Beletage, OG, Saal, Halle, Galerie ...)
 * mezzanine: low storey (entresol), square / lying windows
 * kneewall : Kniestock / Heuboden strip below the eaves
 * wall     : free-standing wall height (garden wall, cage wall, terrace wall, ruin wall)
 * mound    : earth mound over a vault (Eiskeller)
 */
export type StoreyKind = 'plinth' | 'basement' | 'floor' | 'mezzanine' | 'kneewall' | 'wall' | 'mound';

export interface Storey {
  /** German/French name as in the catalogue ("Erdgeschoss (rez-de-chaussee)"). */
  name: string;
  /** Floor-to-floor height in m (for plinth: height of the plinth above base_h). */
  height: number;
  tag: TagNote;
  /** v2. Inferred from `name` by upgradeV1() when absent. */
  kind?: StoreyKind;
  /** v2. Floor build-up (joists + pugging + boards) in m; default per class in grammar.ts. */
  floor_build_up?: number;
}

// ---------------------------------------------------------------------------------------------
// Roof
// ---------------------------------------------------------------------------------------------

/**
 * mansard : gebrochenes Dach (lower Brisis pitch_lower, upper Terrasson pitch_upper; 0 = flat deck)
 * hip     : Walmdach (pitch_lower on all four sides)
 * gable   : Satteldach (pitch_lower on the long sides, vertical gables at the ends)
 * flat    : flat roof / terrace
 * pavilion: Zeltdach (pyramid to one apex)
 * cone    : conical roof on a round plan
 * dome    : dome on a round or square plan (rise = dome_rise_ratio * depth)
 * mound   : earth mound (Eiskeller)
 * none    : no roof (walls, cages, terraces)
 */
export const ROOF_TYPES = ['mansard', 'hip', 'gable', 'flat', 'pavilion', 'cone', 'dome', 'mound', 'none'] as const;
export type RoofType = (typeof ROOF_TYPES)[number];

export type RoofCover = 'slate' | 'tile' | 'lead' | 'copper' | 'thatch' | 'earth' | 'none';

export interface RaisedRoofSection {
  /** Facade side whose axis numbering defines the range (axes are 0-based, left to right seen from outside). */
  side: SideName;
  first_axis: number;
  axis_count: number;
  /** Extra eaves / ridge height of the raised part in m. */
  extra_h?: number;
  type?: RoofType;
  turret?: { kind: 'dachreiter' | 'lantern'; height?: number; tag?: TagNote };
  tag?: TagNote;
}

export interface ChimneySpec {
  /** One stack every n axes (02 §2.8: 2-3). */
  every_axes?: number;
  section?: [number, number];
  above_roof?: number;
  tag?: TagNote;
}

export interface DormerSpec {
  /** Dormers in the lower roof: 'every' axis, 'alternate' axes or 'none'. */
  lower?: 'every' | 'alternate' | 'none';
  /** Oculi (oeil-de-boeuf) in the upper roof. */
  upper?: 'every' | 'alternate' | 'none';
  head?: 'segmental' | 'straight' | 'triangular' | 'alternating';
  tag?: TagNote;
}

export interface Roof {
  /** v1 also has free-text values ("dome", "earth mound", "none (iron grilles / net domes)"); normalised by upgradeV1(). */
  type: RoofType;
  /** Degrees. mansard: lower slope (Brisis); hip/gable/pavilion/cone: the roof pitch. */
  pitch_lower?: number;
  /** Degrees. mansard only: upper slope (Terrasson); 0 = flat deck (HMS reading). */
  pitch_upper?: number;
  /** m DHHN2016; v1 stores it, equal to base_h + sum(storeys). */
  eaves_h?: number;
  /** m DHHN2016; v1 stores it, computed from type + depth + pitches (layout/roof.ts reproduces it). */
  ridge_h?: number;
  /** Building depth used for the roof section (m). */
  depth_m?: number;
  /** v2. Mansard break height as a fraction of depth/2 (default 0.4, research/02 §2.7). */
  break_ratio?: number;
  /** v2. Dome rise as a fraction of the depth/diameter (default 0.3). */
  dome_rise_ratio?: number;
  /** v2. Hipped ends for mansard (default true) - gable roofs never have them. */
  hipped_ends?: boolean;
  /** Free-text material ("slate (rectangular French cover)"). */
  material?: string;
  /** v2. Normalised cover, derived from `material` by upgradeV1(). */
  cover?: RoofCover;
  /** v1 free text about a raised centre; v2 structured version in `raised`. */
  centre?: string;
  raised?: RaisedRoofSection[];
  /** v1 free text or v2 structured. */
  chimneys?: string | ChimneySpec;
  dormers?: DormerSpec;
  tags?: TagNote;
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------------------------

export type OpeningKind =
  | 'window'
  | 'porte_fenetre'
  | 'portal'
  | 'durchfahrt'
  | 'door'
  | 'double_door'
  | 'jib_door'
  | 'carriage_gate'
  | 'passage'
  | 'oculus'
  | 'dormer'
  | 'cellar_window'
  | 'stall_window'
  | 'blind';

export type HeadForm = 'straight' | 'segmental' | 'round' | 'triangular';

export interface Risalit {
  side: SideName;
  /** 0-based axis index of the first axis in the risalit (left to right seen from outside). */
  first_axis: number;
  axis_count: number;
  kind: 'centre' | 'corner' | 'side';
  /** Projection in front of the wall plane in m (02 §2.6: 0.3-0.8). */
  projection?: number;
  pediment?: boolean;
  tag?: TagNote;
}

/** Axis layout of one facade side. */
export interface FacadeSideSpec {
  axes: number;
  /** m; default = facade.axis_spacing, else grammar default per class. */
  spacing?: number;
  /** Axis groups left to right, e.g. [6, 7, 6]. Sum must equal `axes`. */
  groups?: number[];
  /**
   * Part of the side carrying axes, measured from the side's left end (p0) in metres
   * (e.g. the CdL court face between the arms). Default: the whole side.
   */
  from?: number;
  to?: number;
  /** Side is blind (gallery north wall) or hidden by an adjoining wing. */
  blind?: boolean;
  /**
   * Window type of the side's main storeys (fix round 1): 'window' forces sill windows where the class default
   * would give portes-fenêtres (Orangerie W front: two window tiers above the high basement). Default: class.
   */
  window_kind?: 'window' | 'porte_fenetre';
  tag?: TagNote;
}

export interface PortalSpec {
  side: SideName;
  /** 0-based axis index or 'centre'. Durchfahrten may span two axes (`span_axes`). */
  axis: number | 'centre';
  kind: 'portal' | 'durchfahrt' | 'porte_fenetre' | 'door' | 'carriage_gate';
  /** Storey index into Building.storeys (default: first non-plinth storey). */
  storey?: number;
  span_axes?: number;
  width?: number;
  height?: number;
  /** Number of steps of an exterior Freitreppe (portal) or perron (door) in front of it. */
  steps?: number;
  /**
   * Grade in front of the opening (m DHHN2016) the steps start from; default: base_h (fix round 1: CdL garden
   * door on the parterre TF-09).
   */
  grade_h?: number;
  /** Columned portico in front of a portal (fix round 1, B02 W head D LC 1790): columns, balcony on top. */
  portico?: { columns: number; balcony: boolean; depth?: number; tag?: TagNote };
  tag?: TagNote;
}

export interface Facade {
  // ---- v1 fields ----
  axes?: number;
  axes_garden_east?: number;
  axes_court_west?: number;
  axis_spacing?: number;
  /** v1 free text, e.g. "6 + 7 (centre risalit = Louisenhof core) + 6". */
  rhythm?: string;
  material?: string;
  colour?: string;
  dressings?: string;
  /** v1 free text; v2 structured version in `portals`. */
  portal?: string;
  shutters?: string;
  windows?: string;
  content?: string;
  height_m?: number;
  lightning_rods?: boolean;
  tags?: TagNote;
  axis_tags?: TagNote;
  // ---- v2 fields ----
  sides?: Partial<Record<SideName, FacadeSideSpec>>;
  risalits?: Risalit[];
  portals?: PortalSpec[];
  /** Normalised shutter type for the generator. */
  shutter_type?: 'louvred' | 'plank' | 'inside' | 'none';
  shutter_colour?: string;
  members_colour?: string;
  plinth_colour?: string;
}

// ---------------------------------------------------------------------------------------------
// Interiors (v2)
// ---------------------------------------------------------------------------------------------

export interface Finish {
  /** Material names from context.ts MATERIAL_NAMES (e.g. 'floor.parquet', 'wall.boiserie'). */
  floor: string;
  walls: string;
  ceiling: string;
}

export interface Room {
  id: string;
  name_de: string;
  function?: string;
  /** Index into Building.storeys. */
  storey: number;
  /** Clear interior polygon in building-local [s, t] metres (CCW, not closed). */
  polygon: PolygonST;
  /** Absolute floor height (m DHHN2016); default from the storey stack. */
  floor_h?: number;
  /** Absolute clear ceiling height (m DHHN2016); default floor of the next storey - build-up. */
  ceiling_h?: number;
  finish?: Finish;
  tag: TagNote;
  sources?: string[];
}

/**
 * Wall reference of an opening:
 *  - side   : exterior facade side; `a` runs from the side's left end p0 (seen from outside)
 *  - room   : edge `edge` (vertex edge -> edge+1) of room polygon `room`; `a` from that vertex
 *  - segment: explicit wall line in [s, t]; `a` from p0
 */
export type WallRef =
  | { kind: 'side'; side: SideName }
  | { kind: 'room'; room: string; edge: number }
  | { kind: 'segment'; p0: ST; p1: ST; rooms?: [string, string] };

export interface Opening {
  id?: string;
  kind: OpeningKind;
  storey: number;
  wall: WallRef;
  /** Centre position along the wall in m. */
  a: number;
  width: number;
  height: number;
  /** Sill above the storey floor in m (0 for doors). */
  sill: number;
  head?: HeadForm;
  tag: TagNote;
}

export type StairKind = 'imperial' | 'dogleg' | 'straight' | 'spiral' | 'freitreppe';

export interface Stair {
  id: string;
  kind: StairKind;
  storey_from: number;
  storey_to: number;
  /** Stair-hall polygon in [s, t]. */
  polygon: PolygonST;
  /** Direction of the first flight going up, unit vector in [s, t]. */
  up_dir?: ST;
  riser?: number;
  tread?: number;
  flight_width?: number;
  tag: TagNote;
}

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

export interface GroundDtm {
  min: number;
  median: number;
  max: number;
  n_cells: number;
}

export interface Building {
  id: string;
  name_de: string;
  cls: BuildingClass;
  function: string;
  built: string;
  priority: number;
  confidence: Confidence;
  placement: Placement;
  /** Closed EN ring (CCW) or null when unplaced (or for WALL with `line`). */
  footprint: RingEN | null;
  /** WALL class: centre line instead of a footprint. */
  line?: EN[];
  /** Level the storey stack starts from (m DHHN2016); null when unplaced. */
  base_h: number | null;
  base_h_note?: string;
  storeys: Storey[];
  /** Empty object `{}` in v1 for unplaced buildings; upgradeV1() turns that into {type:'none'}. */
  roof: Roof;
  facade: Facade;
  interior: InteriorLevel;
  lidar_ids?: string[];
  sources?: string[];
  notes?: string;
  alternatives?: string[];
  ground_dtm: GroundDtm | null;
  footprint_area_m2?: number;
  // ---- v2 fields ----
  /**
   * What the "court" side faces: an EN point, or the id of a terrain feature (its centroid).
   * Default: the palace grid origin (Ehrenhof centre).
   */
  court_toward?: EN | string;
  rooms?: Room[];
  openings?: Opening[];
  stairs?: Stair[];
}

// ---------------------------------------------------------------------------------------------
// Terrain features
// ---------------------------------------------------------------------------------------------

export type TerrainKind =
  | 'court'
  | 'terrace'
  | 'scarp'
  | 'avenue'
  | 'rondell'
  | 'pond'
  | 'island'
  | 'dam'
  | 'cascade'
  | 'moat'
  | 'enclosure'
  | 'well'
  | 'wall'
  | 'parterre'
  | 'path';

export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: EN[][] }
  | { type: 'LineString'; coordinates: EN[] }
  | { type: 'MultiPoint'; coordinates: EN[] }
  | { type: 'Point'; coordinates: EN };

export interface AvenueTrees {
  species: string;
  rows: number;
  /** Spacing within a row (m). */
  spacing: number;
  /** Distance between the two outer rows (m). */
  row_distance?: number;
  age_1793?: string;
  /** v2: crown height in 1789 (m), default from grammar (young avenues). */
  height?: number;
}

export interface CascadeSteps {
  count: number;
  riser_m: number;
  tread_area_m?: [number, number | string];
  tag?: TagNote;
}

export interface TerrainFeature {
  id: string;
  kind: TerrainKind;
  name: string;
  geometry: GeoJsonGeometry;
  confidence: Confidence;
  lidar_ids?: string[];
  notes?: string;
  /** Surface level (court, terrace, island, rondell). */
  level?: number;
  surface?: string;
  /** Scarp / cascade top and foot. */
  top?: number;
  foot?: number;
  /** Avenue / cascade width (m). */
  width?: number;
  trees?: AvenueTrees;
  water_level?: number;
  crest?: number;
  steps?: CascadeSteps;
  /** v2: wall height for 'wall' / retaining wall for 'scarp'. */
  wall_height?: number;
  tag?: TagNote;
}

// ---------------------------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------------------------

export interface PalaceGrid {
  origin_EN: EN;
  u_azimuth_grid_deg: number;
  u_azimuth_true_deg?: number;
  grid_convergence_deg?: number;
  note?: string;
}

export interface SiteDefaults {
  unit?: { name: string; m: number };
  eaves_continuous?: boolean;
  lightning_rods?: boolean;
  render?: string;
  members?: string;
  plinth?: string;
  slate?: string;
  tile?: string;
  shutters?: string;
  time_slice?: string;
  [k: string]: unknown;
}

export interface SiteSpec {
  version: 1 | 2;
  status?: string;
  crs: 'EPSG:25832';
  height_datum: 'DHHN2016';
  origin: { E0: number; N0: number; local_frame?: string };
  palace_grid: PalaceGrid;
  conventions?: Record<string, string>;
  defaults: SiteDefaults;
  buildings: Building[];
  terrain_features: TerrainFeature[];
  open_questions?: string[];
}

// ---------------------------------------------------------------------------------------------
// Small helpers on the spec (pure)
// ---------------------------------------------------------------------------------------------

/** Extract evidence tag letters from a free-text note ("N; HMS shows ..." -> ['N', 'HMS']). */
export function parseEvidenceTags(note: string | undefined): EvidenceTag[] {
  if (!note) return [];
  const found = new Set<EvidenceTag>();
  // Order matters: match D-> before D.
  const re = /(?:^|[^A-Za-z])(D->|D→|HMS|D|I|N|U)(?![A-Za-z])/g;
  for (const m of note.matchAll(re)) {
    const t = m[1] === 'D→' ? 'D->' : (m[1] as EvidenceTag);
    found.add(t);
  }
  return EVIDENCE_TAGS.filter((t) => found.has(t));
}

/** Buildings that have geometry (placed, with footprint or line, and base_h). */
export function isPlaced(b: Building): boolean {
  return b.placement !== 'unplaced' && b.base_h !== null && (b.footprint !== null || (b.line?.length ?? 0) >= 2);
}

export function buildingById(spec: SiteSpec, id: string): Building | undefined {
  return spec.buildings.find((b) => b.id === id);
}

export function featureById(spec: SiteSpec, id: string): TerrainFeature | undefined {
  return spec.terrain_features.find((f) => f.id === id);
}

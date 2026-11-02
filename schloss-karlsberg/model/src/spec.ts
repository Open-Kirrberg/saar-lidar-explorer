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
  /**
   * KB-I21: `fachwerk` = the turret is a rendered or boarded timber frame (research/09 §6.5 C1 "Dachreiter" [I]); a
   * record only, the drum looks the same.
   */
  turret?: { kind: 'dachreiter' | 'lantern'; height?: number; fachwerk?: boolean; tag?: TagNote };
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
  /** v2. Dome only: 2 = double-stepped dome with drum-head cornice and lantern (GARDEN_DETAIL.steppedDome); default 1. */
  dome_tiers?: number;
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
  /**
   * Wave-6 review fix (KB-I28): storey indices `window_kind` applies to; absent = every main storey of the side (Orangerie
   * parterre front: portes-fenêtres on the Saalgeschoss, sill windows on the courtiers' upper tier).
   */
  window_kind_storeys?: number[];
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
  /**
   * Wave-7 review fix (KB-I31): an upper-storey porte-fenêtre gets an iron balconet unless this is false, e.g. where it
   * opens onto a terrace or an Altan that is drawn as its own building (KB-B02a). Default true.
   */
  balconet?: boolean;
  /**
   * Wave-8 review fix (KB-I72): one continuous balcony (stone slab on consoles, iron railing; grammar BALCONY) across
   * all portes-fenêtres of this entry instead of a balconet per door, e.g. the Festsaal garden balcony. Only on a
   * `porte_fenetre` entry above the entrance storey; `depth` overrides BALCONY.depth.
   */
  balcony_run?: { depth?: number; tag?: TagNote };
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
  /**
   * KB-I15: how Lisenen, bands, surrounds, sills and cornices are made. 'render' = painted render (material
   * `render.member`, research/09 E7/M4); 'stone' = dressed sandstone (`stone.grey`, or `stone.red` for a red hex).
   * Default by class in exterior palette(): FARM / FARM_GROUP / RIDE / STABLE 'stone', all others 'render'.
   */
  members_material?: 'render' | 'stone';
  /**
   * KB-I15: colour of the exposed sandstone dressings at portals, Durchfahrten and porticos (`stone.grey`); steps and
   * plinths keep `plinth_colour`. Default: `members_colour`.
   */
  portal_colour?: string;
  /**
   * KB-I19: year the facade was finished (last limewash before 1789), from the dated building history (research/01
   * §1.2, research/10 §b). Drives the limewash age: warm, weathered for 1778-82 work, cool and fresh for 1785-88
   * (research/09 §1.3.6, M3, C2). Absent = undated (neutral render colour).
   */
  build_year?: number;
  /** Evidence for `build_year`. */
  build_year_tag?: TagNote;
  /**
   * KB-I24: a round temple pavilion (Tempelzimmer / Rotunde, research/10 §b.1 KB-B07). Only on a round footprint; read
   * by `layout/rotunda.ts` (one layout for the 3D exterior and the plan sheets). Absent = the plain round facade.
   */
  rotunda?: RotundaSpec;
  /**
   * Wave-5 fix (KB-I36): a lean-to forcing house (solid N back wall, glazing sloped to the S, tiled strip over the back;
   * GARDEN_DETAIL.glasshouse, exterior/glasshouse.ts). Only on a rect footprint with roof type `none`.
   */
  glasshouse?: { tag?: TagNote };
  /**
   * KB-I28: colour of the window and door joinery ('#RRGGBB'). Default: `wood.frame` #E9E6DE for frames and glazing
   * bars, `wood.door` for door leaves. Orangerie: white-painted windows and doors (T5) #F2F0EA [N hue].
   */
  joinery_colour?: string;
  /**
   * KB-I28: storey indices (Building.storeys, plinth included) whose windows get no shutters although the building has
   * `shutter_type` louvred / plank (Orangerie hall tier [I]).
   */
  shutters_omit_storeys?: number[];
  /**
   * KB-I21: rendered timber frame (Fachwerk) instead of rubble masonry: a 0.30 m wall and a 0.12-0.15 m reveal on the
   * flagged storeys, same render outside (grammar FACHWERK, layout/fachwerk.ts; research/09 §2.3, G4, C1).
   */
  fachwerk?: FachwerkSpec;
  /**
   * KB-I29: menagerie animal houses drawn instead of the GARD enclosure wall (layout/menagerie.ts,
   * exterior/menagerie.ts; research/10 §b.4).
   */
  menagerie?: MenagerieSpec;
  /**
   * KB-I31 / KB-I39 / KB-I30: a garden folly or a small structure drawn by `exterior/folly.ts` from `layout/folly.ts`
   * instead of the facade and roof (the catalogue roof is `none`). Sizes come from grammar FOLLY [N]; every folly is a
   * low-confidence hypothesis (placement 'hypothetical').
   */
  folly?: FollySpec;
}

/**
 * KB-I31 / KB-I39 / KB-I30 follies (research/10 §b.1, §b.6; research/11 §0 item 5, S14):
 * 'altan' = an upper-floor terrace on piers against a wall (footprint side `court` against the wall, `garden` the open
 * front); 'chinese' = an open octagonal pavilion with a concave tent roof; 'tent' = a striped round Turkish tent;
 * 'hay_wagon' = a full-size hay-wagon folly; 'aviary' = a small pavilion with two wire-cage wings; 'monopteros' = an
 * open round temple (columns, entablature ring, shallow dome); 'apiary' = a timber bee shelter (Bienenhaus) with skeps
 * on shelves under a lean-to roof, open to the S.
 */
export type FollyKind = 'altan' | 'chinese' | 'tent' | 'hay_wagon' | 'aviary' | 'monopteros' | 'apiary';
export const FOLLY_KINDS: readonly FollyKind[] = ['altan', 'chinese', 'tent', 'hay_wagon', 'aviary', 'monopteros', 'apiary'];

export interface FollySpec {
  kind: FollyKind;
  /** 'altan': the gate (Durchfahrt) under the deck that the piers keep clear (m, centred on the footprint). */
  gate_width?: number;
  tag?: TagNote;
}

/** KB-I21: which storeys of a building are rendered Fachwerk. */
export interface FachwerkSpec {
  /** Storey indices (plinth included). Absent = every storey above the plinth / basement. */
  storeys?: number[];
  tag: TagNote;
}

/**
 * KB-I29: menagerie houses. 'ring' = `houses` square houses evenly on a circle (centre, radius of the house centres),
 * fronts facing the centre, iron grilles between them and an optional larger loge on the axis `loge_azimuth`; 'rows' =
 * straight rows of single-storey houses along `rows` (p0 -> p1, houses fronting to the left of p0 -> p1 seen from
 * above, i.e. towards `front`), each with a fenced run in front under a net, and a water channel along `channel`.
 * Sizes come from grammar MENAGERIE.
 * Wave-6 review fix: 'island' = the square island in the ring's moat with a sandstone quay round the building footprint
 * (the documented foundations, a low course) and the spiral stair; 'open_pavilion' = a hypothetical light open
 * superstructure (posts and a beam under the catalogue roof) on a footprint. 'ring' yards are closed behind the houses
 * and their radial grilles run in to the water edge inside `moat_radius`; 'rows' get terrace walls along the back lines
 * and trampled ground in the runs.
 */
export interface MenagerieSpec {
  kind: 'ring' | 'rows' | 'island' | 'open_pavilion';
  ring?: { centre: EN; radius: number; houses: number; loge_azimuth?: number; roof: 'pyramid'; cover: RoofCover; moat_radius?: number };
  /** 'island': side of the square island (m, centred on the footprint and aligned with it), quay top (abs. m). */
  island?: { size: number; top_h: number; stair?: boolean };
  rows?: { p0: EN; p1: EN; houses: number }[];
  /** Grid azimuth (deg) the row fronts and runs face. */
  front_azimuth?: number;
  /** Run depth in front of each row (m), cut short by the next row; default grammar. */
  run_depth?: number;
  /** Centre line of the watercourse through the runs. */
  channel?: EN[];
  tag: TagNote;
}

/** One bay of a rotunda drum between two pilasters: glazed door, blind niche, or the opening to a linked colonnade. */
export type RotundaBayKind = 'door' | 'niche' | 'link';

/**
 * KB-I24: round temple pavilion. Bays run counter-clockwise seen from above, bay 0 centred on the portico axis.
 * The order's proportions (shaft diameters, entablature, steps) are period norms in `layout/grammar.ts` (ROTUNDA).
 */
export interface RotundaSpec {
  order: 'ionic' | 'doric' | 'tuscan';
  /** Grid azimuth (deg) of the portico axis, pointing out of the building (towards the garden). */
  axis_azimuth: number;
  /** One entry per bay (= pilaster count), bay 0 on the portico axis. */
  bays: RotundaBayKind[];
  /** Pedimented column portico on the axis, with steps down to the grade in front of it. */
  portico?: { columns: number; width: number; depth: number; steps: number; pediment: boolean; tag?: TagNote };
  /**
   * Open colonnade from the bay opposite the portico to a neighbouring range (`to`, a building id): `length` from the
   * drum face, `width` overall, its own floor (`floor_h`, steps up to the rotunda floor inside it) and entablature top
   * (`eaves_h`), both m DHHN2016.
   */
  colonnade?: { length: number; width: number; columns_per_side: number; floor_h: number; eaves_h: number; to?: string; tag?: TagNote };
  tag?: TagNote;
}

// ---------------------------------------------------------------------------------------------
// Interiors (v2)
// ---------------------------------------------------------------------------------------------

export interface Finish {
  /** Material names from context.ts MATERIAL_NAMES (e.g. 'floor.parquet', 'wall.boiserie'). */
  floor: string;
  walls: string;
  ceiling: string;
  /**
   * KB-I27: hue of a silk / damask wall ('#RRGGBB', N) where the room's name carries a colour (Gelber Salon, Grauer
   * Salon …); tints the `walls` material and the upholstery. Absent = the material's own colour.
   */
  colour?: string;
  /**
   * KB-I26/I27: contrasting colour of the broad damask border inside the gilt Tapetenleisten ('#RRGGBB', N; Mannlich
   * T1 p. 365: damask in three contrasting colours with broad borders). Absent = derived from the ground colour.
   */
  border?: string;
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

/**
 * Time span in which an object stood (KB-I03; research/11 §6.1): years, `to` inclusive, both optional (open ends).
 * Absent = stood throughout the residence period (no restriction). The default scene year is 1789 (summer 1789,
 * `SCENE_YEAR` in layout/epoch.ts); `inEpoch(epoch, year)` is the only test consumers use. Tag the dates in `epoch_tag`.
 * Not the same as placement 'hypothetical' (= uncertain existence or position).
 */
export interface Epoch {
  from?: number;
  to?: number;
}

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
  /** KB-I03: years in which the building stood; out of the scene year it is skipped by every consumer. */
  epoch?: Epoch;
  /** Evidence for `epoch` (tag + source). */
  epoch_tag?: TagNote;
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
  | 'path'
  /** KB-I12: open landscape lawn on the natural slope (no level), e.g. Petri's Herzogsgarten. */
  | 'lawn'
  /** KB-I12: a planted clump (Point + `radius`) or single trees (MultiPoint), composition in `mix`. */
  | 'clump'
  /** KB-I33: garden furniture (benches, sculpture) listed in `items` (geometry: MultiPoint of the item positions). */
  | 'furniture'
  /** KB-I36: kitchen / forcing garden beds in a Polygon, layout in `beds`. */
  | 'beds'
  /** KB-I68: a free-standing fence or barrier along a LineString, form in `fence_line`. */
  | 'fence';

/**
 * KB-I68: form of a `fence` feature. 'post_rail' = posts with horizontal rails along the whole line (Le Clerc 1790);
 * 'barriere' = a turnpike beam (Schlagbaum) on a pivot post across the middle of a 2-point line, the rest of the line
 * closed by post-and-rail runs (PV 1791 l. 1). Sizes default to layout/grammar.ts FENCE.
 */
export interface FenceLine {
  type: 'post_rail' | 'barriere';
  /** post top / rail fence height above ground (m) */
  height: number;
  /** post spacing (m), default FENCE.postRail.spacing */
  post_spacing?: number;
  /** number of rails, default FENCE.postRail.rails */
  rails?: number;
  tag?: TagNote;
}

/** KB-I33: one piece of garden furniture at `at`, its front facing `facing` (grid azimuth, deg clockwise from grid N). */
export interface GardenItem {
  type: 'bench' | 'herm';
  at: EN;
  facing: number;
  /** a bench on a slope stands on a small levelled gravel platform (GARDEN_DETAIL.bench.platform) */
  platform?: boolean;
  name_de?: string;
  tag?: TagNote;
}

/** KB-I34: parterre layout of a `parterre` or `terrace` polygon (palace grid u, v). */
export interface ParterreLayout {
  type: 'angloise';
  /** lawn panels along u and along v */
  panels: [number, number];
  /** width (m) of the centre walk(s) between the panels (default GARDEN_DETAIL.angloise.crossWalk) */
  cross_walk?: number;
  /** citrus tubs on the walk edges every GARDEN_DETAIL.tub.spacing m (summer) */
  tubs?: boolean;
  tag?: TagNote;
}

/** KB-I34: enclosure of a garden polygon (green treillage with arched portals at `portals`). */
export interface GardenFence {
  type: 'treillage';
  height: number;
  portal_height: number;
  /** portal centres on the polygon edge (EN) */
  portals: EN[];
  /** polygon edges (index i = ring[i] -> ring[i+1]) that stand against a building and get no fence */
  open_edges?: number[];
  tag?: TagNote;
}

/** KB-I36: kitchen / forcing garden layout (beds in quarters along the palace grid u axis, frames, espaliers). */
export interface BedsLayout {
  /** quarters along the layout's own axes, divided by cross walks */
  quarters: [number, number];
  /** grid azimuth (deg) of the layout's first axis (default 80.5 = the palace grid u axis) */
  axis_deg?: number;
  /** rows of hotbed frames (Mistbeetkästen), each a 2-point line in EN; the lights face S */
  frame_rows?: EN[][];
  /** espaliered fruit trees on wall faces, each a 2-point line in EN (the side the trees stand on is the S side) */
  espaliers?: EN[][];
  tag?: TagNote;
}

/** KB-I12: one share of a clump / grove composition (`speciesFor` text, share 0..1, optional height range in m). */
export interface PlantMix {
  species: string;
  share: number;
  height?: [number, number];
}

/**
 * KB-I13: kerb of a formal basin (pond with `coping`): width x height (m) and material. Wave-2 fix: a gravel `terrace`
 * with a `coping` gets a stone kerb of that width round its free edges and a broad perron at its doors (GARDEN.terraceKerb).
 */
export interface BasinCoping {
  width: number;
  height: number;
  material: string;
}

/** KB-I13: sculpture on a basin rim (e.g. two stag heads), facing a point or a feature / building id. */
export interface BasinOrnaments {
  kind: 'stag_head';
  count: number;
  facing?: EN | string;
}

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
  /** KB-I03: years in which the feature existed (e.g. the axial basin 1783–1790); see `Epoch`. */
  epoch?: Epoch;
  /** Evidence for `epoch` (tag + source). */
  epoch_tag?: TagNote;
  /**
   * KB-I12: 'hypothetical' = existence or form doubtful (same rule as buildings: skipped only when
   * `ctx.options.showHypothetical` is false; give it confidence 'low' so the viewer's low-confidence select hides it).
   */
  placement?: 'hypothetical';
  /** KB-I12: clump radius (m) when the geometry is a Point. */
  radius?: number;
  /** KB-I12: clump / single-tree composition. */
  mix?: PlantMix[];
  /** KB-I13: fountain jet height (m) of a basin. */
  fountain_h?: number;
  /** KB-I13: a pond with a coping is a formal basin (stone kerb on the water edge). */
  coping?: BasinCoping;
  /** KB-I33: garden furniture of a `furniture` feature. */
  items?: GardenItem[];
  /** KB-I34: parterre à l'angloise layout of a `parterre` / `terrace` polygon. */
  parterre?: ParterreLayout;
  /** KB-I34: treillage round the polygon. */
  fence?: GardenFence;
  /** KB-I36: kitchen-garden layout of a `beds` polygon. */
  beds?: BedsLayout;
  /** KB-I13: rim sculpture of a basin. */
  ornaments?: BasinOrnaments;
  /** KB-I68: form of a `fence` feature. */
  fence_line?: FenceLine;
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

/** 1789 land cover classes (backlog KB-I09, research/11 S1); scripts/prepare-terrain.py maps them to ground classes. */
export const LANDCOVER_COVERS = ['forest', 'meadow', 'hay', 'field', 'vineyard', 'kitchen_garden', 'lawn'] as const;
export type LandcoverCover = (typeof LANDCOVER_COVERS)[number];

/**
 * One land cover polygon of the top-level `landcover` list (built by scripts/catalogue-v2/landcover.ts). Painted in
 * array order (later wins) by scripts/prepare-terrain.py; terrain features and buildings are painted over it.
 */
export interface LandcoverArea {
  /** LC-nn */
  id: string;
  cover: LandcoverCover;
  name_de: string;
  /** closed CCW ring in EPSG:25832 */
  geometry: { type: 'Polygon'; coordinates: [RingEN] };
  /** only cells at least this steep (rise / run on the smoothed 1789 DTM) take the cover (steep valley sides) */
  min_slope?: number;
  /** forest composition (shares sum to 1) [N/I]; read by viewer/src/forest.ts */
  mix?: { species: string; share: number }[];
  confidence: Confidence;
  /** evidence tags (D, D->, I, N, U, HMS) and sources */
  tag: string;
  notes?: string;
  epoch?: Epoch;
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
  /** KB-I09: 1789 land cover polygons (paint order = array order) */
  landcover?: LandcoverArea[];
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

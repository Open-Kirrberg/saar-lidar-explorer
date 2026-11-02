/**
 * Manifest types + loader for docs/data-contract.md (v2; v1 manifests load as a single level).
 * Optional additive keys: `vectors` (F10/F12), `rgb` image layers → `imageLayers` (F13/F14),
 * `layers.bldg` mask (R0.7), `models.buildings` (F11), `xyz.hist_*` (F14), `candidates` (F15),
 * `pointclouds` (F16).
 */

export type HeightEncoding = 'terrarium';
export type LayerEncoding = 'u8';

export interface HeightSource {
  path: string; // template with {i} and {j}
  encoding: HeightEncoding;
  apron: number;
}

export interface LayerSource {
  path: string;
  encoding: LayerEncoding;
  min: number;
  max: number;
  unit?: string;
  label_de?: string;
  description?: string;
}

/**
 * Colour image layer (contract "Image layers", F13/F14): `encoding: 'rgb'` entries of `layers` /
 * `levels[k].layers`. One RGB8 image per chunk, pixelsPerChunk² px covering exactly the chunk's
 * 500×500 cells, row 0 = north; decode WITH sRGB colour management (unlike u8/terrarium data).
 */
export interface ImageLayerSource {
  path: string; // template with {i}, {j}; {level} already substituted
  encoding: 'rgb';
  format: 'webp' | 'jpg' | 'png';
  /** Pixels per chunk side: 1000 (0.5 m/px at level 0) or 500. */
  pixelsPerChunk: number;
  kind: 'image';
  label_de: string;
  attribution?: string;
  source?: string;
}

export interface XyzSource {
  url: string;
  minZoom: number;
  maxZoom: number;
  /** WGS84 [[south, west], [north, east]]. */
  bounds?: [[number, number], [number, number]];
  /** 'image' for colour map tiles (historic maps); absent for relief overlays. */
  kind?: 'image';
  label_de?: string;
  attribution?: string;
}

/** LoD2 building meshes per level-0 chunk (contract "Models", F11). */
export interface BuildingModels {
  /** Template 'models/buildings/{i}_{j}.glb'. */
  path: string;
  /** [i, j] of the level-0 chunks that have a file (only those are fetched). */
  chunks: Array<[number, number]>;
  /** Positions: x = E − E0, y = absolute height (m, no exaggeration), z = −(N − N0). */
  frame: 'local';
  featureCount: number;
  label_de: string;
  attribution?: string;
  source?: string;
}

/**
 * glb vertex attribute `_SURFACE` (three.js geometry attribute `_surface`):
 * 0 = ground/closure/other, 1 = wall, 2 = roof.
 */
export const SURFACE_GROUND = 0;
export const SURFACE_WALL = 1;
export const SURFACE_ROOF = 2;
export const SURFACE_ATTRIBUTE = '_surface';

export interface ManifestModels {
  buildings?: BuildingModels;
}

/**
 * One resolution level of the chunk pyramid (contract v2 `levels[k]`). Level 0 is the 1 m data
 * (always synthesised from the top-level keys); level k has cellSize = cellSize0 · 2^k, the same
 * chunkSize (cells), a chunk grid anchored at the AOI's north-west corner, and level-k chunk (i, j)
 * covers level-(k−1) chunks (2i…2i+1, 2j…2j+1). Paths are resolved (`{level}` substituted).
 */
export interface ManifestLevel {
  level: number;
  /** Metres per cell. */
  cellSize: number;
  /** Cells per chunk side (= top-level chunkSize). */
  chunkSize: number;
  /** Level raster in cells: ceil(AOI size / 2^k). May extend past the AOI by < cellSize. */
  size: { width: number; height: number };
  chunks: { nx: number; ny: number };
  height: { dtm: HeightSource; dsm?: HeightSource };
  /** u8 data layers only (rgb entries are split off into `imageLayers`). */
  layers: Record<string, LayerSource>;
  /** `rgb` image layers of this level (absent/empty when none). */
  imageLayers?: Record<string, ImageLayerSource>;
}

export interface Manifest {
  /** 1 or 2. */
  version: number;
  aoi: string;
  name: string;
  crs: string;
  origin: { E0: number; N0: number };
  size: { width: number; height: number };
  cellSize: number;
  chunkSize: number;
  chunks: { nx: number; ny: number };
  heightRange: { min: number; max: number };
  wgs84Bounds?: [[number, number], [number, number]];
  height: { dtm: HeightSource; dsm?: HeightSource };
  /** u8 data layers of level 0 (incl. optional `bldg` mask); `rgb` entries are in `imageLayers`. */
  layers: Record<string, LayerSource>;
  /** Level-0 `rgb` image layers (`ortho`, `hist_1840`, …), split off from the file's `layers`; {} if none. */
  imageLayers: Record<string, ImageLayerSource>;
  xyz?: Record<string, XyzSource>;
  sources?: Array<Record<string, unknown>>;
  /** Optional draped vector layers (F10/F12); see "Vectors" in docs/data-contract.md. */
  vectors?: ManifestVectors;
  /** Optional 3D models (F11 LoD2 buildings); see "Models" in docs/data-contract.md. */
  models?: ManifestModels;
  /** Optional relict candidates (F15, private/local data); see "Candidates" in docs/data-contract.md. */
  candidates?: ManifestCandidates;
  /** Optional point clouds for focus areas (F16, 'sle-pts-v1'); see "Point clouds" in docs/data-contract.md. */
  pointclouds?: ManifestPointClouds;
  /**
   * Resolution levels fine → coarse, contiguous from level 0 (always ≥ 1 entry after
   * validateManifest; v1 manifests and v2 manifests without valid coarse levels give [level 0]).
   */
  levels: ManifestLevel[];
  attribution: string;
}

/** A GeoJSON FeatureCollection in EPSG:25832 metres (not local frame), densified to ≤ 2 m. */
export interface VectorLayer {
  path: string; // relative to the AOI dir
  crs: 'EPSG:25832';
  featureCount: number;
  label_de: string;
  source: string;
  /**
   * 'baked': every coordinate in this layer's file(s) (incl. `labels`) is [E, N, z] with z = true DTM
   * height (bilinear, 1 m DTM, 0.01 m). Absent → 2D coordinates, the app samples HeightQuery.
   * Either way the app uses z per coordinate when it is present and finite.
   */
  heights?: 'baked';
}

export interface ManifestVectors {
  osm?: VectorLayer;
  /**
   * Parcel boundaries + `labels` (relative path to Point FeatureCollection with Flurnummern)
   * + optional `polygons` (relative path to Polygon/MultiPolygon FeatureCollection for
   * point-in-polygon parcel lookup; 2D, not densified, not clipped). Absent → label-nearest fallback.
   */
  flurstuecke?: VectorLayer & { labels: string; polygons?: string };
}

/** OSM feature properties in `vectors.osm` (LineString / MultiLineString). */
export type OsmKind = 'road' | 'track' | 'path' | 'rail' | 'water' | 'barrier';
export interface OsmFeatureProps {
  kind: OsmKind;
  name?: string;
  highway?: string;
  tracktype?: string;
  osm_id: string;
}

/** Parcel boundary properties in `vectors.flurstuecke` (LineString). */
export interface ParcelFeatureProps {
  kind: 'parcel';
}

/** Label point properties in `vectors.flurstuecke.labels` (Point). */
export interface ParcelLabelProps {
  text: string; // Flurnummer "ZAE" or "ZAE/NEN"
  flstkennz: string;
  gemarkung: string;
  flur: string;
  lage?: string;
}

/** Parcel polygon properties in `vectors.flurstuecke.polygons` (Polygon / MultiPolygon, [E, N] only). */
export interface ParcelPolygonProps {
  flstkennz: string;
  gemarkung: string;
  flur: string; // RLP: "Flur 0" → do not display
  zae: string;
  nen?: string;
  text: string; // Flurnummer "ZAE" or "ZAE/NEN"
  lage?: string;
  flaeche_m2?: number; // amtliche Fläche (ALKIS), m²
}

function parseVectorLayer(key: string, v: unknown): VectorLayer | undefined {
  const x = v as Partial<Record<keyof VectorLayer, unknown>> | null;
  if (!x || typeof x !== 'object' || typeof x.path !== 'string' || !x.path) {
    console.warn(`[manifest] vectors.${key}: missing path, ignored`);
    return undefined;
  }
  if (x.crs !== 'EPSG:25832') {
    console.warn(`[manifest] vectors.${key}: unsupported crs ${String(x.crs)}, ignored`);
    return undefined;
  }
  return {
    path: x.path,
    crs: 'EPSG:25832',
    featureCount: typeof x.featureCount === 'number' && Number.isFinite(x.featureCount) ? x.featureCount : 0,
    label_de: typeof x.label_de === 'string' ? x.label_de : '',
    source: typeof x.source === 'string' ? x.source : '',
    ...(x.heights === 'baked' ? { heights: 'baked' as const } : {}),
  };
}

/** Tolerant parse of the optional `vectors` key: absent/invalid → undefined, bad entries dropped. */
export function parseVectors(v: unknown): ManifestVectors | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const raw = v as Record<string, unknown>;
  const out: ManifestVectors = {};
  if (raw.osm !== undefined) {
    const osm = parseVectorLayer('osm', raw.osm);
    if (osm) out.osm = osm;
  }
  if (raw.flurstuecke !== undefined) {
    const fl = parseVectorLayer('flurstuecke', raw.flurstuecke);
    const labels = (raw.flurstuecke as { labels?: unknown }).labels;
    const polygons = (raw.flurstuecke as { polygons?: unknown }).polygons;
    if (polygons !== undefined && (typeof polygons !== 'string' || !polygons)) {
      console.warn('[manifest] vectors.flurstuecke.polygons: not a path, ignored');
    }
    if (fl && typeof labels === 'string' && labels) {
      out.flurstuecke = { ...fl, labels, ...(typeof polygons === 'string' && polygons ? { polygons } : {}) };
    } else if (fl) console.warn('[manifest] vectors.flurstuecke: missing labels, ignored');
  }
  return out.osm || out.flurstuecke ? out : undefined;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseHeightSource(v: unknown, level: number): HeightSource | undefined {
  const x = v as Partial<HeightSource> | null;
  if (!x || typeof x !== 'object' || typeof x.path !== 'string' || !x.path) return undefined;
  if (x.encoding !== 'terrarium') return undefined;
  return { path: x.path.replaceAll('{level}', String(level)), encoding: 'terrarium', apron: isNum(x.apron) ? x.apron : 1 };
}

const IMAGE_FORMATS = ['webp', 'jpg', 'png'] as const;

/**
 * Tolerant parse of one `encoding: 'rgb'` layer entry; undefined (with a warning) when malformed
 * (no string path, pixelsPerChunk not a positive integer). `format` falls back to the path
 * extension ('jpeg' → 'jpg'), `label_de` to the key.
 */
export function parseImageLayer(key: string, v: unknown, level = 0): ImageLayerSource | undefined {
  const x = v as Partial<Record<keyof ImageLayerSource, unknown>> | null;
  const where = level === 0 ? `layers.${key}` : `levels[${level}].layers.${key}`;
  if (!x || typeof x !== 'object' || x.encoding !== 'rgb' || typeof x.path !== 'string' || !x.path) {
    console.warn(`[manifest] ${where}: malformed rgb layer, ignored`);
    return undefined;
  }
  const ppc = x.pixelsPerChunk;
  if (!isNum(ppc) || !Number.isInteger(ppc) || ppc <= 0) {
    console.warn(`[manifest] ${where}: pixelsPerChunk ${String(ppc)} invalid, ignored`);
    return undefined;
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(x.path)?.[1] ?? '').toLowerCase();
  const fmtRaw = typeof x.format === 'string' ? x.format.toLowerCase() : ext;
  const fmt = fmtRaw === 'jpeg' ? 'jpg' : fmtRaw;
  return {
    path: x.path.replaceAll('{level}', String(level)),
    encoding: 'rgb',
    format: (IMAGE_FORMATS as readonly string[]).includes(fmt) ? (fmt as ImageLayerSource['format']) : 'webp',
    pixelsPerChunk: ppc,
    kind: 'image',
    label_de: typeof x.label_de === 'string' && x.label_de ? x.label_de : key,
    ...(typeof x.attribution === 'string' ? { attribution: x.attribution } : {}),
    ...(typeof x.source === 'string' ? { source: x.source } : {}),
  };
}

const isRgbEntry = (raw: unknown): boolean =>
  !!raw && typeof raw === 'object' && (raw as { encoding?: unknown }).encoding === 'rgb';

/** `rgb` entries of a `layers` object, parsed (malformed ones dropped). */
export function parseImageLayers(v: unknown, level = 0): Record<string, ImageLayerSource> {
  const out: Record<string, ImageLayerSource> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!isRgbEntry(raw)) continue;
    const img = parseImageLayer(key, raw, level);
    if (img) out[key] = img;
  }
  return out;
}

/** Top-level `layers` without the `rgb` entries (other entries pass through as before). */
function nonImageLayers(v: unknown): Record<string, LayerSource> {
  const out: Record<string, LayerSource> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!isRgbEntry(raw)) out[key] = raw as LayerSource;
  }
  return out;
}

function parseLayerSources(v: unknown, level: number): Record<string, LayerSource> {
  const out: Record<string, LayerSource> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (isRgbEntry(raw)) continue; // → parseImageLayers
    const x = raw as Partial<LayerSource> | null;
    if (!x || typeof x !== 'object' || typeof x.path !== 'string' || !x.path || x.encoding !== 'u8' || !isNum(x.min) || !isNum(x.max)) {
      console.warn(`[manifest] levels[${level}].layers.${key}: malformed, ignored`);
      continue;
    }
    out[key] = { ...x, path: x.path.replaceAll('{level}', String(level)) } as LayerSource;
  }
  return out;
}

/** [i, j] pairs that are integers inside the level-0 chunk grid (others skipped with a warning, duplicates removed). */
function parseChunkList(list: unknown[], grid: { nx: number; ny: number }, where: string): Array<[number, number]> {
  const seen = new Set<string>();
  const chunks: Array<[number, number]> = [];
  for (const c of list) {
    const ok = Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n))
      && c[0] >= 0 && c[0] < grid.nx && c[1] >= 0 && c[1] < grid.ny;
    if (!ok) {
      console.warn(`[manifest] ${where}: chunk ${JSON.stringify(c)} invalid, skipped`);
      continue;
    }
    const id = `${c[0]}_${c[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    chunks.push([c[0] as number, c[1] as number]);
  }
  return chunks;
}

// ---------------------------------------------------------------------------------------------
// Relict candidates (F15) — contract "Candidates". PRIVATE/local data: hypotheses, never published.

export type CandidateClass = 'pit' | 'mound' | 'linear' | 'rect' | 'platform';
export const CANDIDATE_CLASSES: readonly CandidateClass[] = ['pit', 'mound', 'linear', 'rect', 'platform'];
/** Default German class labels (manifest `candidates.classes` overrides per class). */
export const CANDIDATE_CLASS_LABELS_DE: Readonly<Record<CandidateClass, string>> = {
  pit: 'Grube/Trichter',
  mound: 'Hügel',
  linear: 'Graben/Wall/Weg',
  rect: 'Rechteckstruktur',
  platform: 'Plattform',
};
/** Label for a `linear` candidate with `along_path: true` (known path). */
export const CANDIDATE_KNOWN_PATH_LABEL_DE = 'Weg (bekannt)';
/** `class8` mask byte → class (0 = none). */
export const CANDIDATE_MASK_CODES: Readonly<Record<number, CandidateClass>> = {
  1: 'pit', 2: 'mound', 3: 'linear', 4: 'rect', 5: 'platform',
};
export const isCandidateClass = (v: unknown): v is CandidateClass =>
  typeof v === 'string' && (CANDIDATE_CLASSES as readonly string[]).includes(v);

/** Optional u8 class raster per level-0 chunk (500², no apron); raw byte = class code. */
export interface CandidateMask {
  path: string; // 'candidates/mask/{i}_{j}.png'
  encoding: 'class8';
  /** Only candidates with score ≥ minScore are in the mask. */
  minScore: number;
  /** [i, j] of chunks that have a file; undefined = every level-0 chunk. */
  chunks?: Array<[number, number]>;
}

export interface ManifestCandidates {
  path: string; // 'candidates/candidates.geojson', relative to the AOI dir
  crs: 'EPSG:25832';
  featureCount: number;
  counts: Partial<Record<CandidateClass, number>>;
  /** Full label table: defaults merged with the manifest's `classes`. */
  classes: Record<CandidateClass, string>;
  /** 'baked': every coordinate (point and outline) is [E, N, z], z = true DTM height. */
  heights?: 'baked';
  method: string;
  version: number;
  generated?: string;
  params: Record<string, unknown>;
  weights?: Record<string, number>;
  mask?: CandidateMask;
  label_de: string;
  evaluation?: Record<string, unknown>;
}

/** `metrics` of a candidate feature; all optional, metres / m² / degrees, rounded to 0.01. */
export interface CandidateMetrics {
  depth_m?: number;
  height_m?: number;
  area_m2?: number;
  diameter_m?: number;
  circularity?: number;
  rectangularity?: number;
  length_m?: number;
  width_m?: number;
  /** Long axis, 0..180, clockwise from grid north. */
  orientation_deg?: number;
  slope_in_deg?: number;
  rim_m?: number;
  [key: string]: number | undefined;
}

type Pos = [number, number] | [number, number, number];
export type CandidateOutline =
  | { type: 'Polygon'; coordinates: Pos[][] }
  | { type: 'LineString'; coordinates: Pos[] };

/** Properties of a feature in `candidates.geojson` (geometry: Point = centre, EPSG:25832). */
export interface CandidateProps {
  /** `${class}-${round(E)}-${round(N)}` (+ '-2', '-3' on collisions). */
  id: string;
  class: CandidateClass;
  /** 0..1. */
  score: number;
  metrics: CandidateMetrics;
  /** Short German reasons. */
  reasons: string[];
  /** Under canopy. */
  forest: boolean;
  /** Any OSM feature (incl. water/barrier) within 5 m — informative only. */
  near_path: boolean;
  /** Linear only: ≥ 50 % along an OSM road/track/path → "Weg (bekannt)". Missing → false. */
  along_path?: boolean;
  /** pois.geojson id within 50 m, else null. */
  near_known: string | null;
  outline?: CandidateOutline;
}

/** Review decisions — localStorage only (`candidatesStorageKey(aoi)`), never in data files. */
export type CandidateReviewStatus = 'confirmed' | 'rejected' | 'unsure';
export interface CandidateDecision {
  status: CandidateReviewStatus;
  at: string; // ISO 8601
  class: CandidateClass;
  E: number;
  N: number;
  score: number;
  markerId?: string;
}
export interface CandidateReviewStore {
  version: 1;
  decisions: Record<string, CandidateDecision>;
}
export const candidatesStorageKey = (aoi: string): string => `sle.candidates.v1.${aoi}`;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Tolerant parse of the optional `candidates` key (F15): absent/invalid (no path, crs ≠ EPSG:25832)
 * → undefined; optional fields get defaults; a malformed `mask` is dropped.
 */
export function parseCandidates(v: unknown, grid: { nx: number; ny: number }): ManifestCandidates | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v) || typeof v.path !== 'string' || !v.path) {
    console.warn('[manifest] candidates: missing path, ignored');
    return undefined;
  }
  if (v.crs !== 'EPSG:25832') {
    console.warn(`[manifest] candidates: unsupported crs ${String(v.crs)}, ignored`);
    return undefined;
  }
  const counts: Partial<Record<CandidateClass, number>> = {};
  if (isPlainObject(v.counts)) {
    for (const [k, n] of Object.entries(v.counts)) if (isCandidateClass(k) && isNum(n)) counts[k] = n;
  }
  const classes: Record<CandidateClass, string> = { ...CANDIDATE_CLASS_LABELS_DE };
  if (isPlainObject(v.classes)) {
    for (const [k, l] of Object.entries(v.classes)) if (isCandidateClass(k) && typeof l === 'string' && l) classes[k] = l;
  }
  let mask: CandidateMask | undefined;
  if (v.mask !== undefined) {
    const m = v.mask;
    if (isPlainObject(m) && typeof m.path === 'string' && m.path && m.encoding === 'class8') {
      mask = { path: m.path, encoding: 'class8', minScore: isNum(m.minScore) ? m.minScore : 0 };
      if (Array.isArray(m.chunks)) mask.chunks = parseChunkList(m.chunks, grid, 'candidates.mask');
    } else {
      console.warn('[manifest] candidates.mask: malformed (path/encoding), ignored');
    }
  }
  let weights: Record<string, number> | undefined;
  if (isPlainObject(v.weights)) {
    weights = {};
    for (const [k, n] of Object.entries(v.weights)) if (isNum(n)) weights[k] = n;
  }
  return {
    path: v.path,
    crs: 'EPSG:25832',
    featureCount: isNum(v.featureCount) ? v.featureCount : 0,
    counts,
    classes,
    ...(v.heights === 'baked' ? { heights: 'baked' as const } : {}),
    method: typeof v.method === 'string' ? v.method : '',
    version: isNum(v.version) ? v.version : 0,
    ...(typeof v.generated === 'string' ? { generated: v.generated } : {}),
    params: isPlainObject(v.params) ? v.params : {},
    ...(weights ? { weights } : {}),
    ...(mask ? { mask } : {}),
    label_de: typeof v.label_de === 'string' && v.label_de ? v.label_de : 'Verdachtsflächen',
    ...(isPlainObject(v.evaluation) ? { evaluation: v.evaluation } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Point clouds (F16) — contract "Point clouds", format 'sle-pts-v1' (tiled binary, no Potree).

export const POINTCLOUD_FORMAT = 'sle-pts-v1';
/** ASCII magic at byte 0 of every tile. */
export const SLEP_MAGIC = 'SLEP';
export const SLEP_VERSION = 1;
export const SLEP_HEADER_BYTES = 16;
/** Record stride: x u16, y u16, h u16, agl i16, cls u8, intensity u8 (little-endian). */
export const SLEP_RECORD_BYTES = 10;
/** Byte offsets inside a record. */
export const SLEP_OFFSET = { x: 0, y: 2, h: 4, agl: 6, cls: 8, intensity: 9 } as const;

/** Default German labels per LAS class code (LVGL ALS 2025 code list); manifest `classes` overrides/extends. */
export const POINT_CLASS_LABELS_DE: Readonly<Record<string, string>> = {
  '1': 'Unklassifiziert',
  '2': 'Boden',
  '6': 'Gebäude',
  '8': 'Wasser (synthetisch)',
  '9': 'Wasser',
  '14': 'Leitungen',
  '17': 'Brücke',
  '20': 'Sonstige',
  '24': 'Keller',
  '30': 'Füllpunkte (synthetisch)',
};

/** Label for a LAS class code: manifest/default table, else `Klasse <n>`. */
export function pointClassLabel(classes: Readonly<Record<string, string>>, code: number): string {
  return classes[String(code)] ?? `Klasse ${code}`;
}

export interface PointCloudArea {
  /** /^[\w-]+$/, unique within the manifest. */
  id: string;
  name_de: string;
  /** [Emin, Nmin, Emax, Nmax], EPSG:25832, multiples of tileSize. */
  bbox: [number, number, number, number];
  /** Tile grid size: (Emax − Emin) / tileSize × (Nmax − Nmin) / tileSize. */
  grid: { nx: number; ny: number };
  /** [tx, ty, count] of tiles that have a file; ty counts northwards from Nmin. */
  tiles: Array<[number, number, number]>;
  /** Template 'pointclouds/<id>/{tx}_{ty}.bin', relative to the AOI dir. */
  path: string;
  pointCount: number;
  density_per_m2: number;
  classCounts?: Record<string, number>;
  heightRange?: { min: number; max: number };
  intensityMax?: number;
  source?: string[];
}

export interface ManifestPointClouds {
  format: typeof POINTCLOUD_FORMAT;
  /** Tile side in metres (default 100). */
  tileSize: number;
  crs: 'EPSG:25832';
  areas: PointCloudArea[];
  /** Full label table: defaults merged with the manifest's `classes`. */
  classes: Record<string, string>;
  attribution?: string;
}

/** Lower-left corner (EPSG:25832) of tile (tx, ty) of an area. */
export function pointTileOrigin(area: PointCloudArea, tileSize: number, tx: number, ty: number): { E: number; N: number } {
  return { E: area.bbox[0] + tx * tileSize, N: area.bbox[1] + ty * tileSize };
}

/** Expand the `{tx}_{ty}` template of an area and resolve it against the AOI base URL. */
export function pointTileUrl(baseUrl: string, area: PointCloudArea, tx: number, ty: number): string {
  return baseUrl + area.path.replaceAll('{tx}', String(tx)).replaceAll('{ty}', String(ty));
}

/**
 * Check a tile's header (magic, version 1, size = 16 + 10·count) and return count + hBase (m).
 * Throws on a malformed buffer (caller skips the tile).
 */
export function parseSlepHeader(buf: ArrayBuffer): { count: number; hBase: number } {
  if (buf.byteLength < SLEP_HEADER_BYTES) throw new Error('sle-pts: file shorter than header');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== SLEP_MAGIC) throw new Error(`sle-pts: bad magic ${JSON.stringify(magic)}`);
  const version = dv.getUint16(4, true);
  if (version !== SLEP_VERSION) throw new Error(`sle-pts: unsupported version ${version}`);
  const count = dv.getUint32(8, true);
  const hBase = dv.getFloat32(12, true);
  if (buf.byteLength !== SLEP_HEADER_BYTES + SLEP_RECORD_BYTES * count) {
    throw new Error(`sle-pts: size ${buf.byteLength} ≠ 16 + 10·${count}`);
  }
  if (!Number.isFinite(hBase)) throw new Error('sle-pts: hBase not finite');
  return { count, hBase };
}

const isWholeMultiple = (len: number, step: number): boolean => {
  const n = len / step;
  return Math.abs(n - Math.round(n)) < 1e-9 && Math.round(n) >= 1;
};

function parsePointCloudArea(v: unknown, tileSize: number, seen: Set<string>): PointCloudArea | undefined {
  if (!isPlainObject(v) || typeof v.id !== 'string' || !/^[\w-]+$/.test(v.id)) {
    console.warn('[manifest] pointclouds.areas: entry without valid id, ignored');
    return undefined;
  }
  const where = `pointclouds.areas[${v.id}]`;
  if (seen.has(v.id)) {
    console.warn(`[manifest] ${where}: duplicate id, ignored`);
    return undefined;
  }
  const b = v.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum) || !(b[0] < b[2]) || !(b[1] < b[3])
    || !isWholeMultiple(b[2] - b[0], tileSize) || !isWholeMultiple(b[3] - b[1], tileSize)) {
    console.warn(`[manifest] ${where}: bbox ${JSON.stringify(b)} invalid, ignored`);
    return undefined;
  }
  if (typeof v.path !== 'string' || !v.path.includes('{tx}') || !v.path.includes('{ty}')) {
    console.warn(`[manifest] ${where}: path needs {tx} and {ty}, ignored`);
    return undefined;
  }
  const bbox = b as [number, number, number, number];
  const grid = { nx: Math.round((bbox[2] - bbox[0]) / tileSize), ny: Math.round((bbox[3] - bbox[1]) / tileSize) };
  const tiles: Array<[number, number, number]> = [];
  const ids = new Set<string>();
  for (const t of Array.isArray(v.tiles) ? v.tiles : []) {
    const ok = Array.isArray(t) && t.length === 3 && t.every((n) => Number.isInteger(n))
      && t[0] >= 0 && t[0] < grid.nx && t[1] >= 0 && t[1] < grid.ny && t[2] >= 1;
    if (!ok) {
      console.warn(`[manifest] ${where}: tile ${JSON.stringify(t)} invalid, skipped`);
      continue;
    }
    const key = `${t[0]}_${t[1]}`;
    if (ids.has(key)) continue;
    ids.add(key);
    tiles.push([t[0] as number, t[1] as number, t[2] as number]);
  }
  seen.add(v.id);
  const sum = tiles.reduce((s, t) => s + t[2], 0);
  const pointCount = isNum(v.pointCount) && v.pointCount >= 0 ? v.pointCount : sum;
  const areaM2 = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  let classCounts: Record<string, number> | undefined;
  if (isPlainObject(v.classCounts)) {
    classCounts = {};
    for (const [k, n] of Object.entries(v.classCounts)) if (isNum(n)) classCounts[k] = n;
  }
  const hr = v.heightRange as { min?: unknown; max?: unknown } | undefined;
  return {
    id: v.id,
    name_de: typeof v.name_de === 'string' && v.name_de ? v.name_de : v.id,
    bbox,
    grid,
    tiles,
    path: v.path,
    pointCount,
    density_per_m2: isNum(v.density_per_m2) && v.density_per_m2 >= 0 ? v.density_per_m2 : pointCount / areaM2,
    ...(classCounts ? { classCounts } : {}),
    ...(isPlainObject(hr) && isNum(hr.min) && isNum(hr.max) ? { heightRange: { min: hr.min, max: hr.max } } : {}),
    ...(isNum(v.intensityMax) && v.intensityMax > 0 ? { intensityMax: v.intensityMax } : {}),
    ...(Array.isArray(v.source) ? { source: v.source.filter((s): s is string => typeof s === 'string') } : {}),
  };
}

/**
 * Tolerant parse of the optional `pointclouds` key (F16): absent, non-object or `format` ≠
 * 'sle-pts-v1' → undefined; malformed areas dropped, invalid tiles skipped; no valid area → undefined.
 */
export function parsePointClouds(v: unknown): ManifestPointClouds | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) {
    console.warn('[manifest] pointclouds: not an object, ignored');
    return undefined;
  }
  if (v.format !== POINTCLOUD_FORMAT) {
    console.warn(`[manifest] pointclouds: unsupported format ${String(v.format)}, ignored`);
    return undefined;
  }
  if (v.crs !== undefined && v.crs !== 'EPSG:25832') {
    console.warn(`[manifest] pointclouds: unsupported crs ${String(v.crs)}, ignored`);
    return undefined;
  }
  let tileSize = 100;
  if (v.tileSize !== undefined) {
    if (!isNum(v.tileSize) || v.tileSize <= 0) {
      console.warn(`[manifest] pointclouds: tileSize ${String(v.tileSize)} invalid, ignored`);
      return undefined;
    }
    tileSize = v.tileSize;
  }
  const seen = new Set<string>();
  const areas: PointCloudArea[] = [];
  for (const a of Array.isArray(v.areas) ? v.areas : []) {
    const area = parsePointCloudArea(a, tileSize, seen);
    if (area) areas.push(area);
  }
  if (!areas.length) {
    console.warn('[manifest] pointclouds: no valid area, ignored');
    return undefined;
  }
  const classes: Record<string, string> = { ...POINT_CLASS_LABELS_DE };
  if (isPlainObject(v.classes)) {
    for (const [k, l] of Object.entries(v.classes)) {
      const code = Number(k);
      if (/^\d+$/.test(k) && code <= 255 && typeof l === 'string' && l) classes[String(code)] = l;
    }
  }
  return {
    format: POINTCLOUD_FORMAT,
    tileSize,
    crs: 'EPSG:25832',
    areas,
    classes,
    ...(typeof v.attribution === 'string' ? { attribution: v.attribution } : {}),
  };
}

/**
 * Tolerant parse of the optional `models` key (F11): absent/invalid → undefined. `buildings` needs a
 * string `path`, `frame: 'local'` and a `chunks` array; [i, j] pairs that are not integers inside the
 * level-0 chunk grid are skipped (duplicates removed).
 */
export function parseModels(v: unknown, grid: { nx: number; ny: number }): ManifestModels | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const b = (v as { buildings?: unknown }).buildings as Partial<Record<keyof BuildingModels, unknown>> | null | undefined;
  if (b === undefined) return undefined;
  if (!b || typeof b !== 'object' || typeof b.path !== 'string' || !b.path || b.frame !== 'local' || !Array.isArray(b.chunks)) {
    console.warn('[manifest] models.buildings: malformed (path/frame/chunks), ignored');
    return undefined;
  }
  const chunks = parseChunkList(b.chunks as unknown[], grid, 'models.buildings');
  return {
    buildings: {
      path: b.path,
      chunks,
      frame: 'local',
      featureCount: isNum(b.featureCount) ? b.featureCount : 0,
      label_de: typeof b.label_de === 'string' && b.label_de ? b.label_de : 'buildings',
      ...(typeof b.attribution === 'string' ? { attribution: b.attribution } : {}),
      ...(typeof b.source === 'string' ? { source: b.source } : {}),
    },
  };
}

type LevelBase = Pick<Manifest, 'cellSize' | 'chunkSize' | 'size' | 'chunks' | 'height' | 'layers'> &
  Partial<Pick<Manifest, 'imageLayers'>>;

/** Level 0 from the top-level (v1) keys. */
export function baseLevel(m: LevelBase): ManifestLevel {
  return {
    level: 0,
    cellSize: m.cellSize,
    chunkSize: m.chunkSize,
    size: { width: m.size.width, height: m.size.height },
    chunks: { nx: m.chunks.nx, ny: m.chunks.ny },
    height: m.height,
    layers: m.layers,
    imageLayers: m.imageLayers ?? {},
  };
}

/** Expected geometry of level k (contract v2): raster ceil(size/2^k) cells, ceil(…/chunkSize) chunks. */
export function levelGrid(m: LevelBase, k: number): Pick<ManifestLevel, 'cellSize' | 'size' | 'chunks'> {
  const f = 2 ** k;
  const width = Math.ceil(m.size.width / f);
  const height = Math.ceil(m.size.height / f);
  return {
    cellSize: m.cellSize * f,
    size: { width, height },
    chunks: { nx: Math.ceil(width / m.chunkSize), ny: Math.ceil(height / m.chunkSize) },
  };
}

/**
 * Tolerant parse of v2 `levels`: level 0 always comes from the top-level keys (`levels[0]` in the
 * file is informative); coarse levels are kept while valid and contiguous — the first malformed
 * entry (wrong `level`/`cellSize`/`chunks`/`size`, no terrarium `height.dtm`) ends the list.
 */
export function parseLevels(m: LevelBase, raw: unknown): ManifestLevel[] {
  const levels = [baseLevel(m)];
  if (raw === undefined) return levels;
  if (!Array.isArray(raw)) {
    console.warn('[manifest] levels: not an array, using level 0 only');
    return levels;
  }
  for (let k = 1; k < raw.length; k++) {
    const e = raw[k] as Partial<Record<keyof ManifestLevel, unknown>> | null;
    const g = levelGrid(m, k);
    const bad = (why: string): void => console.warn(`[manifest] levels[${k}]: ${why}; coarser levels ignored`);
    if (!e || typeof e !== 'object') { bad('not an object'); break; }
    if (e.level !== k) { bad(`level ${String(e.level)} ≠ ${k}`); break; }
    if (!isNum(e.cellSize) || Math.abs(e.cellSize - g.cellSize) > 1e-9) { bad(`cellSize ${String(e.cellSize)} ≠ ${g.cellSize}`); break; }
    if (e.chunkSize !== undefined && e.chunkSize !== m.chunkSize) { bad('chunkSize differs from top level'); break; }
    const ch = e.chunks as { nx?: unknown; ny?: unknown } | undefined;
    if (!ch || ch.nx !== g.chunks.nx || ch.ny !== g.chunks.ny) { bad(`chunks ≠ ${g.chunks.nx}×${g.chunks.ny}`); break; }
    const sz = e.size as { width?: unknown; height?: unknown } | undefined;
    if (sz !== undefined && (sz.width !== g.size.width || sz.height !== g.size.height)) { bad('size mismatch'); break; }
    const hs = e.height as { dtm?: unknown } | undefined;
    const dtm = parseHeightSource(hs?.dtm, k);
    if (!dtm) { bad('height.dtm missing or not terrarium'); break; }
    levels.push({
      level: k, chunkSize: m.chunkSize, ...g, height: { dtm },
      layers: parseLayerSources(e.layers, k), imageLayers: parseImageLayers(e.layers, k),
    });
  }
  return levels;
}

/** A manifest plus the base URL (ending in '/') its relative paths resolve against. */
export interface LoadedManifest {
  manifest: Manifest;
  baseUrl: string;
  /** True if the requested AOI was not found and the fixture was loaded instead. */
  fellBack: boolean;
}

export const DEFAULT_AOI = 'karlsberg';
export const FALLBACK_AOI = 'fixture';

/** Expand a `{i}_{j}` path template and resolve it against the AOI base URL. */
export function chunkUrl(baseUrl: string, template: string, i: number, j: number): string {
  return baseUrl + template.replace('{i}', String(i)).replace('{j}', String(j));
}

/**
 * Root URL of the AOI datasets: `VITE_DATA_URL` (build-time env, e.g. a separate static host)
 * or `<BASE_URL>data/` (served from public/data by `pnpm dev` / `pnpm preview`).
 */
export function dataRootUrl(): string {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const custom = env?.VITE_DATA_URL;
  const root = custom ? (custom.endsWith('/') ? custom : `${custom}/`) : `${env?.BASE_URL ?? './'}data/`;
  // Absolute URL: the decode/vector workers resolve relative URLs against their own script URL
  // (`assets/…`), so the build's relative base ('./') would otherwise fetch `assets/data/…`.
  return typeof location !== 'undefined' && location.href ? new URL(root, location.href).href : root;
}

export function aoiBaseUrl(aoi: string): string {
  return `${dataRootUrl()}${encodeURIComponent(aoi)}/`;
}

export function aoiFromUrl(search: string = location.search): string {
  const v = new URLSearchParams(search).get('aoi');
  return v && /^[\w-]+$/.test(v) ? v : DEFAULT_AOI;
}

export function validateManifest(m: unknown): Manifest {
  const x = m as Partial<Manifest>;
  const fail = (what: string): never => {
    throw new Error(`manifest.json: ${what}`);
  };
  if (!x || typeof x !== 'object') fail('not an object');
  if (x.version !== 1 && x.version !== 2) fail(`unsupported version ${String(x.version)}`);
  if (!x.origin || !Number.isFinite(x.origin.E0) || !Number.isFinite(x.origin.N0)) fail('origin');
  if (!x.size || !x.chunks || !x.chunkSize) fail('size/chunks/chunkSize');
  if (!x.height?.dtm?.path) fail('height.dtm.path');
  if (x.height!.dtm.encoding !== 'terrarium') fail('height.dtm.encoding must be terrarium');
  // `rgb` image layers (F13/F14) are split off so `layers` keeps only data (u8) entries.
  const top = {
    ...(x as Manifest),
    cellSize: x.cellSize ?? 1,
    layers: nonImageLayers(x.layers),
    imageLayers: parseImageLayers(x.layers, 0),
  };
  // v1: single level. v2: `levels` (fine → coarse); a v1 manifest carrying `levels` is not trusted.
  const rawLevels = x.version === 2 ? (x as { levels?: unknown }).levels : undefined;
  const models = parseModels((x as { models?: unknown }).models, top.chunks);
  const out: Manifest = {
    ...top,
    levels: parseLevels(top, rawLevels),
    vectors: parseVectors((x as { vectors?: unknown }).vectors),
    attribution: x.attribution ?? '',
  };
  if (models) out.models = models;
  else delete out.models;
  const candidates = parseCandidates((x as { candidates?: unknown }).candidates, top.chunks);
  if (candidates) out.candidates = candidates;
  else delete out.candidates;
  const pointclouds = parsePointClouds((x as { pointclouds?: unknown }).pointclouds);
  if (pointclouds) out.pointclouds = pointclouds;
  else delete out.pointclouds;
  return out;
}

async function tryFetchManifest(baseUrl: string): Promise<Manifest | null> {
  try {
    const res = await fetch(baseUrl + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    // Vite's dev server answers unknown paths with index.html (200) — guard on content.
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return null;
    return validateManifest(JSON.parse(text));
  } catch (err) {
    console.warn(`[manifest] ${baseUrl}: ${String(err)}`);
    return null;
  }
}

/** Load the manifest for `aoi`; fall back to the synthetic fixture if not found. */
export async function loadManifest(aoi: string = aoiFromUrl()): Promise<LoadedManifest> {
  const baseUrl = aoiBaseUrl(aoi);
  const m = await tryFetchManifest(baseUrl);
  if (m) return { manifest: m, baseUrl, fellBack: false };
  if (aoi !== FALLBACK_AOI) {
    const fbUrl = aoiBaseUrl(FALLBACK_AOI);
    const fb = await tryFetchManifest(fbUrl);
    if (fb) {
      console.warn(`[manifest] AOI "${aoi}" not found, using "${FALLBACK_AOI}"`);
      return { manifest: fb, baseUrl: fbUrl, fellBack: true };
    }
  }
  throw new Error(
    `Kein Datensatz gefunden für "${aoi}" (auch kein Fixture). Bitte "pnpm fixture" ausführen.`,
  );
}

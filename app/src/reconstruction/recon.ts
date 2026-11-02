/**
 * F19: pure logic for shared reconstruction datasets (contract "Shared datasets", sle-recon-v1) and
 * the camera handover to the castle viewer. No three/DOM imports — unit-tested in
 * tests/reconstruction.test.ts.
 */

export const RECON_FORMAT = 'sle-recon-v1';
/** The one shared dataset the app looks for (path under the data root). */
export const KARLSBERG_RECON_PATH = 'shared/karlsberg1789/';
export const DEFAULT_VIEWER_URL = 'http://localhost:5260/';
export const DEFAULT_EXPLORER_URL = 'http://localhost:5240/';
export const DEFAULT_RECON_LABEL = 'Rekonstruktion (Hypothese)';
export const DEFAULT_RECON_DISCLAIMER = 'Hypothetische Rekonstruktion, kein Befund. Schauen, nicht graben.';
export const DEFAULT_ENTER_RADIUS = 300;

export type ReconConfidence = 'high' | 'med' | 'low';
export const RECON_CONFIDENCES: readonly ReconConfidence[] = ['high', 'med', 'low'];

/** `_CONF` vertex values (contract): 0 = low, 1 = med, 2 = high. */
export const CONF_CODE: Readonly<Record<ReconConfidence, number>> = { low: 0, med: 1, high: 2 };

export const CONF_LABELS_DE: Readonly<Record<ReconConfidence, string>> = {
  high: 'hoch',
  med: 'mittel',
  low: 'niedrig',
};

/**
 * Colour mode *Konfidenz* (display-space sRGB). Okabe–Ito colours (bluish green, orange, reddish
 * purple): distinguishable with the common colour-vision deficiencies and close in hue to the POI
 * confidence dots (green / yellow); the legend always names them, the minimap also dashes "low".
 */
export const CONF_COLORS: Readonly<Record<ReconConfidence, number>> = {
  high: 0x009e73,
  med: 0xe69f00,
  low: 0xcc79a7,
};

export interface ReconBuilding {
  id: string;
  name_de: string;
  cls: string;
  confidence: ReconConfidence;
  eaves_h?: number;
  ridge_h?: number;
  bbox_local?: [[number, number, number], [number, number, number]];
  sources_de: string[];
}

export interface ReconIndex {
  format: typeof RECON_FORMAT;
  id: string;
  label_de: string;
  name_de: string;
  crs: 'EPSG:25832';
  heightDatum: string;
  origin: { E0: number; N0: number };
  anchor: { E: number; N: number; enterRadius_m: number };
  bboxEN: [[number, number], [number, number]];
  files: { model: string; footprints?: string };
  viewer: { url: string };
  attribution: string;
  disclaimer_de: string;
  generated?: string;
  catalogueVersion?: number;
  buildings: ReconBuilding[];
}

export interface ParseResult<T> {
  value: T | null;
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 500): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** A plain relative file path (no scheme, no `..`, no leading `/`). */
export function isSafeRelativePath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length <= 200 &&
    /^[A-Za-z0-9_./-]+$/.test(p) &&
    !p.startsWith('/') &&
    !p.split('/').some((seg) => seg === '..' || seg === '')
  );
}

/**
 * True for http(s) URLs on a local host (localhost, 127.0.0.1, [::1], *.localhost, *.test) without
 * credentials. Guards both the viewer URL from the (untrusted) dataset and the viewer's `back`.
 */
export function isLocalHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.test');
}

/** Origin of the current page, if any (browser), for the same-origin handover rule. */
function currentOrigin(): string | undefined {
  return typeof location !== 'undefined' && location?.origin && location.origin !== 'null' ? location.origin : undefined;
}

/**
 * Handover target guard (explorer → viewer URL and viewer → explorer `back`): a local http(s) URL
 * ({@link isLocalHttpUrl}) or an http(s) URL on the **same origin** as the current page — the public
 * build serves the viewer under `<site>/castle/` next to the explorer (no open redirect either way).
 */
export function isTrustedHandoverUrl(url: unknown, pageOrigin: string | undefined = currentOrigin()): url is string {
  if (isLocalHttpUrl(url)) return true;
  if (typeof url !== 'string' || !url || !pageOrigin) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && u.origin === pageOrigin;
  } catch {
    return false;
  }
}

function parseBuilding(raw: unknown, seen: Set<string>, warn: (m: string) => void): ReconBuilding | null {
  if (!isObj(raw)) {
    warn('building entry is not an object – skipped');
    return null;
  }
  const id = str(raw.id, 64);
  if (!id) {
    warn('building entry without id – skipped');
    return null;
  }
  if (seen.has(id)) {
    warn(`duplicate building id ${id} – skipped`);
    return null;
  }
  seen.add(id);
  let confidence: ReconConfidence = 'low';
  if (RECON_CONFIDENCES.includes(raw.confidence as ReconConfidence)) confidence = raw.confidence as ReconConfidence;
  else warn(`building ${id}: invalid confidence → low`);
  const b: ReconBuilding = {
    id,
    name_de: str(raw.name_de, 200) ?? id,
    cls: str(raw.cls, 40) ?? '',
    confidence,
    sources_de: Array.isArray(raw.sources_de)
      ? raw.sources_de.map((s) => str(s, 200)).filter((s): s is string => !!s).slice(0, 3)
      : [],
  };
  if (fin(raw.eaves_h)) b.eaves_h = raw.eaves_h;
  if (fin(raw.ridge_h)) b.ridge_h = raw.ridge_h;
  const bb = raw.bbox_local;
  if (Array.isArray(bb) && bb.length === 2 && bb.every((p) => Array.isArray(p) && p.length === 3 && p.every(fin))) {
    b.bbox_local = bb as ReconBuilding['bbox_local'];
  }
  return b;
}

/**
 * Validate a parsed `index.json` (contract "App tolerance"). `value` is null when the dataset must
 * be treated as absent; `warnings` lists everything that was dropped or defaulted.
 */
export function parseReconIndex(raw: unknown): ParseResult<ReconIndex> {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const absent = (m: string): ParseResult<ReconIndex> => ({ value: null, warnings: [...warnings, m] });
  if (!isObj(raw)) return absent('index.json is not an object');
  if (raw.format !== RECON_FORMAT) return absent(`format ${JSON.stringify(raw.format)} ≠ ${RECON_FORMAT}`);
  const id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : null;
  if (!id) return absent('missing/invalid id');
  if (raw.crs !== 'EPSG:25832') return absent(`crs ${JSON.stringify(raw.crs)} ≠ EPSG:25832`);
  const o = raw.origin;
  if (!isObj(o) || !fin(o.E0) || !fin(o.N0)) return absent('missing/invalid origin');
  const a = raw.anchor;
  if (!isObj(a) || !fin(a.E) || !fin(a.N)) return absent('missing/invalid anchor');
  let radius = DEFAULT_ENTER_RADIUS;
  if (a.enterRadius_m !== undefined) {
    if (fin(a.enterRadius_m) && a.enterRadius_m > 0) radius = Math.min(2000, Math.max(1, a.enterRadius_m));
    else warn('invalid anchor.enterRadius_m → 300');
  }
  const bb = raw.bboxEN;
  if (
    !Array.isArray(bb) ||
    bb.length !== 2 ||
    !bb.every((p) => Array.isArray(p) && p.length === 2 && p.every(fin)) ||
    !(bb[0][0] < bb[1][0] && bb[0][1] < bb[1][1])
  ) {
    return absent('missing/invalid bboxEN');
  }
  const files = isObj(raw.files) ? raw.files : {};
  if (!isSafeRelativePath(files.model)) return absent('missing/unsafe files.model');
  let footprints: string | undefined;
  if (files.footprints !== undefined) {
    if (isSafeRelativePath(files.footprints)) footprints = files.footprints;
    else warn('unsafe files.footprints – ignored');
  }
  const viewerRaw = isObj(raw.viewer) ? raw.viewer.url : undefined;
  let viewerUrl = DEFAULT_VIEWER_URL;
  if (isLocalHttpUrl(viewerRaw)) viewerUrl = viewerRaw;
  else if (viewerRaw !== undefined) warn(`viewer.url not a local http(s) URL → ${DEFAULT_VIEWER_URL}`);

  const seen = new Set<string>();
  const buildings: ReconBuilding[] = [];
  if (Array.isArray(raw.buildings)) {
    for (const b of raw.buildings) {
      const p = parseBuilding(b, seen, warn);
      if (p) buildings.push(p);
    }
  } else if (raw.buildings !== undefined) warn('buildings is not an array – ignored');

  const label = str(raw.label_de, 120) ?? DEFAULT_RECON_LABEL;
  const index: ReconIndex = {
    format: RECON_FORMAT,
    id,
    label_de: label,
    name_de: str(raw.name_de, 200) ?? label,
    crs: 'EPSG:25832',
    heightDatum: str(raw.heightDatum, 40) ?? 'DHHN2016',
    origin: { E0: o.E0, N0: o.N0 },
    anchor: { E: a.E, N: a.N, enterRadius_m: radius },
    bboxEN: [
      [bb[0][0], bb[0][1]],
      [bb[1][0], bb[1][1]],
    ],
    files: footprints ? { model: files.model, footprints } : { model: files.model },
    viewer: { url: viewerUrl },
    attribution: str(raw.attribution, 2000) ?? '',
    disclaimer_de: str(raw.disclaimer_de, 500) ?? DEFAULT_RECON_DISCLAIMER,
    buildings,
  };
  const gen = str(raw.generated, 40);
  if (gen) index.generated = gen;
  if (fin(raw.catalogueVersion)) index.catalogueVersion = raw.catalogueVersion;
  return { value: index, warnings };
}

/** Attribution entries (`"; "`-joined string → list, empty entries dropped). */
export function attributionEntries(attribution: string): string[] {
  return attribution
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Footer credit for the layer: "Rekonstruktion 1789 (Hypothese): <entries>", but without that label when the first
 * entry already names the reconstruction (the exported index starts with "Rekonstruktion Schloss Karlsberg 1789 …").
 */
export function reconFooterText(entries: readonly string[]): string {
  const label = 'Rekonstruktion 1789 (Hypothese)';
  if (entries.length === 0) return label;
  return /^Rekonstruktion\b/i.test(entries[0]) ? entries.join(', ') : `${label}: ${entries.join(', ')}`;
}

export interface AoiRect {
  origin: { E0: number; N0: number };
  /** Metres (cells · cellSize). */
  width: number;
  height: number;
}

/** True if the model's bbox intersects the AOI rectangle (else the layer is not offered). */
export function reconOverlapsAoi(index: Pick<ReconIndex, 'bboxEN'>, aoi: AoiRect): boolean {
  const [[e0, n0], [e1, n1]] = index.bboxEN;
  const a0 = aoi.origin.E0;
  const b0 = aoi.origin.N0;
  return e0 < a0 + aoi.width && e1 > a0 && n0 < b0 + aoi.height && n1 > b0;
}

/** x/z bounds in the model (layer-local) frame. */
export interface XZBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The AOI terrain rectangle in the model frame (AOI world x ∈ [0, w], z ∈ [−h, 0], minus the model offset). */
export function aoiExtentInModel(model: { E0: number; N0: number }, aoi: AoiRect): XZBounds {
  const off = modelOffset(model, aoi.origin);
  return { x0: -off.x, x1: aoi.width - off.x, z0: -aoi.height - off.z, z1: -off.z };
}

/**
 * Contract "Placement in an AOI": a building node is shown only when its bbox lies fully on the AOI terrain (else it
 * hangs past the edge, e.g. Karlslust KL-B40–49 in AOI karlsberg); `site:` nodes only need to overlap it.
 */
export function partShownOnAoi(id: string, b: XZBounds, e: XZBounds): boolean {
  return id.startsWith('site:')
    ? b.x1 > e.x0 && b.x0 < e.x1 && b.z1 > e.z0 && b.z0 < e.z1
    : b.x0 >= e.x0 && b.x1 <= e.x1 && b.z0 >= e.z0 && b.z1 <= e.z1;
}

/** Translation of the model frame into the AOI's world frame (contract "Placement"). */
export function modelOffset(model: { E0: number; N0: number }, aoi: { E0: number; N0: number }): { x: number; y: number; z: number } {
  return { x: model.E0 - aoi.E0, y: 0, z: -(model.N0 - aoi.N0) };
}

/** Horizontal distance (m) from E/N to the anchor. */
export function anchorDistance(E: number, N: number, anchor: { E: number; N: number }): number {
  return Math.hypot(E - anchor.E, N - anchor.N);
}

export function withinEnterRadius(E: number, N: number, anchor: ReconIndex['anchor']): boolean {
  return Number.isFinite(E) && Number.isFinite(N) && anchorDistance(E, N, anchor) <= anchor.enterRadius_m;
}

/** Confidence from a `_CONF` value (rounded, clamped). */
export function confFromCode(v: number): ReconConfidence {
  const c = Math.round(v);
  return c >= 2 ? 'high' : c === 1 ? 'med' : 'low';
}

// ---- footprints -------------------------------------------------------------------------------

export interface ReconFootprint {
  id: string;
  name_de: string;
  confidence: ReconConfidence;
  /** Polygons → rings → [E, N] (EPSG:25832). */
  polygons: Array<Array<Array<[number, number]>>>;
}

const utmLike = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1]) && p[0] > 100_000 && p[0] < 900_000 && p[1] > 1_000_000 && p[1] < 9_500_000;

function parseRings(rings: unknown): Array<Array<[number, number]>> | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const out: Array<Array<[number, number]>> = [];
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < 4 || !r.every(utmLike)) return null;
    out.push(r.map((p) => [p[0], p[1]] as [number, number]));
  }
  return out;
}

/** Parse `footprints.geojson` (EPSG:25832); invalid features are skipped. */
export function parseFootprints(raw: unknown, buildings: readonly ReconBuilding[] = []): ReconFootprint[] {
  if (!isObj(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) return [];
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const out: ReconFootprint[] = [];
  for (const f of raw.features) {
    if (!isObj(f) || !isObj(f.geometry)) continue;
    const props = isObj(f.properties) ? f.properties : {};
    const id = str(props.id, 64);
    if (!id) continue;
    const g = f.geometry;
    let polygons: ReconFootprint['polygons'] = [];
    if (g.type === 'Polygon') {
      const p = parseRings(g.coordinates);
      if (p) polygons = [p];
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      polygons = g.coordinates.map(parseRings).filter((p): p is Array<Array<[number, number]>> => !!p);
    }
    if (polygons.length === 0) continue;
    const b = byId.get(id);
    const conf = RECON_CONFIDENCES.includes(props.confidence as ReconConfidence)
      ? (props.confidence as ReconConfidence)
      : (b?.confidence ?? 'low');
    out.push({ id, name_de: str(props.name_de, 200) ?? b?.name_de ?? id, confidence: conf, polygons });
  }
  return out;
}

/**
 * Minimap: draw a footprint only where its building is shown in 3D. `layerShown` is the loaded layer's own decision
 * (ReconLayer.partShown); before the glb is loaded (null/undefined) the same AOI rule is applied to the footprint's
 * EN bbox.
 */
export function footprintShownOnAoi(f: ReconFootprint, aoi: AoiRect, layerShown?: boolean | null): boolean {
  if (layerShown === true || layerShown === false) return layerShown;
  let E0 = Infinity;
  let E1 = -Infinity;
  let N0 = Infinity;
  let N1 = -Infinity;
  for (const poly of f.polygons)
    for (const ring of poly)
      for (const [E, N] of ring) {
        E0 = Math.min(E0, E);
        E1 = Math.max(E1, E);
        N0 = Math.min(N0, N);
        N1 = Math.max(N1, N);
      }
  // EN bbox in the AOI's own frame (model origin = AOI origin): x = E − E0, z = −(N − N0)
  const o = aoi.origin;
  return partShownOnAoi(f.id, { x0: E0 - o.E0, x1: E1 - o.E0, z0: -(N1 - o.N0), z1: -(N0 - o.N0) }, aoiExtentInModel(o, aoi));
}

/** Centroid (vertex mean of the outer ring of the first polygon) — good enough for fly-to. */
export function footprintCentre(f: ReconFootprint): { E: number; N: number } {
  const ring = f.polygons[0][0];
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  let E = 0;
  let N = 0;
  for (let k = 0; k < n; k++) {
    E += ring[k][0];
    N += ring[k][1];
  }
  return { E: E / n, N: N / n };
}

// ---- camera handover ----------------------------------------------------------------------------

export type HandoverMode = 'fliegen' | 'gehen';

export interface HandoverPose {
  E: number;
  N: number;
  /** True height, m DHHN2016. */
  h: number;
  /** Degrees clockwise from grid north. */
  heading: number;
  /** Degrees, negative = down. */
  pitch: number;
}

/** True height of a displayed y (inverse of `y = hRef + (h − hRef) · exag`). */
export function trueHeightFromDisplay(y: number, hRef: number, exag: number): number {
  return hRef + (y - hRef) / (exag > 0 ? exag : 1);
}

const r1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r; // no "-0"
};

/** Heading normalised to [0, 360) after rounding to 0.1°. */
export function roundHeading(deg: number): number {
  const r = r1(((deg % 360) + 360) % 360);
  return r >= 360 ? 0 : r;
}

/** Pose rounded per contract (0.1 m, 0.1°), pitch clamped to ±89°. */
export function roundPose(p: HandoverPose): HandoverPose {
  return {
    E: r1(p.E),
    N: r1(p.N),
    h: r1(p.h),
    heading: roundHeading(p.heading),
    pitch: r1(Math.max(-89, Math.min(89, p.pitch))),
  };
}

/**
 * Explorer → viewer URL (contract "Camera handover"): `<viewerUrl>?src=explorer&E=…&N=…&h=…&heading=…
 * &pitch=…&mode=…&back=<encodeURIComponent(back)>`. Existing query parameters of the viewer URL
 * are kept (ours replace same-named ones); its hash is dropped. Throws on non-finite pose values.
 */
export function buildViewerUrl(viewerUrl: string, pose: HandoverPose, mode: HandoverMode, back: string): string {
  const p = roundPose(pose);
  if (![p.E, p.N, p.h, p.heading, p.pitch].every(Number.isFinite)) throw new Error('handover pose is not finite');
  const base = isTrustedHandoverUrl(viewerUrl) ? viewerUrl : DEFAULT_VIEWER_URL;
  const u = new URL(base);
  u.hash = '';
  const ours = ['src', 'E', 'N', 'h', 'heading', 'pitch', 'mode', 'back'];
  for (const k of ours) u.searchParams.delete(k);
  const keep = u.search.replace(/^\?/, '');
  const params: Array<[string, string]> = [
    ['src', 'explorer'],
    ['E', String(p.E)],
    ['N', String(p.N)],
    ['h', String(p.h)],
    ['heading', String(p.heading)],
    ['pitch', String(p.pitch)],
    ['mode', mode],
    ['back', back],
  ];
  const q = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${u.origin}${u.pathname}?${keep ? `${keep}&` : ''}${q}`;
}

/**
 * Viewer → explorer target (the viewer implements the same rule; kept here as the executable form
 * of the contract): the validated `back` URL (else `fallback`) with the first five hash fields
 * replaced by the pose and all further fields kept.
 */
export function backTargetUrl(back: string | null | undefined, pose: HandoverPose, fallback = DEFAULT_EXPLORER_URL): string {
  const target = back && isTrustedHandoverUrl(back) ? back : fallback;
  const u = new URL(target);
  const p = roundPose(pose);
  const five = [p.E, p.N, p.h, p.heading, p.pitch].map(String);
  const rest = u.hash.replace(/^#/, '').split(',').slice(5);
  const fields = u.hash.length > 1 ? [...five, ...rest] : five;
  u.hash = fields.join(',');
  return u.href;
}

// ---- prefs ------------------------------------------------------------------------------------

export const RECON_PREFS_KEY = 'sle.reconstruction.v1';

export interface ReconPrefs {
  /** Layer shown (default OFF: the model covers the ruins the explorer is about). */
  on: boolean;
  mode: 'material' | 'confidence';
  /** 0.15–1; < 1 = *Geister-Modus*. */
  opacity: number;
}

export const OPACITY_RANGE = { min: 0.15, max: 1, step: 0.05 } as const;

export const DEFAULT_RECON_PREFS: Readonly<ReconPrefs> = { on: false, mode: 'material', opacity: 1 };

/** Parse stored prefs (`sle.reconstruction.v1`); anything invalid falls back to the default. */
export function parseReconPrefs(raw: unknown): ReconPrefs {
  const p = isObj(raw) ? raw : {};
  return {
    on: typeof p.on === 'boolean' ? p.on : DEFAULT_RECON_PREFS.on,
    mode: p.mode === 'confidence' || p.mode === 'material' ? p.mode : DEFAULT_RECON_PREFS.mode,
    opacity: fin(p.opacity) ? Math.max(OPACITY_RANGE.min, Math.min(OPACITY_RANGE.max, p.opacity)) : DEFAULT_RECON_PREFS.opacity,
  };
}

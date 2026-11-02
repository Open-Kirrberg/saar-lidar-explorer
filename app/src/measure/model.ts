/**
 * Measurement model (F17): kinds, metrics, German formatting and GeoJSON export. Pure (geo.ts
 * uses proj4 only) — unit-tested in tests/measure.test.ts.
 */
import { utmToWgs84 } from '../geo';
import type { Origin } from '../geo';
import { centroidOfVertices, groundFactor, gridScaleFactor, polygonArea, polylineLength, ringPerimeter, ringSelfIntersects } from './geometry';
import { profileStats, sampleProfile } from './profile';
import type { LevelHeight, Profile } from './profile';

export type MeasureKind = 'distance' | 'area' | 'profile' | 'point';
export const MEASURE_KINDS: readonly MeasureKind[] = ['distance', 'area', 'profile', 'point'];
export const MEASURE_LABELS_DE: Readonly<Record<MeasureKind, string>> = {
  distance: 'Strecke',
  area: 'Fläche',
  profile: 'Höhenprofil',
  point: 'Punkt',
};

/** Vertices needed before a measurement can be finished. */
export function minVertices(kind: MeasureKind): number {
  return kind === 'point' ? 1 : kind === 'area' ? 3 : 2;
}

/** Profile / 3D-length sampling step (m): two samples per 1 m DTM cell. */
export const PROFILE_STEP = 0.5;

export interface Vertex {
  E: number;
  N: number;
  /** True DTM height at the vertex (m ü. NN), null if unknown. */
  h: number | null;
}

export interface MeasureMetrics {
  /** Horizontal UTM length (distance/profile) or perimeter (area), m. */
  length_m?: number;
  /** Length along the true DTM surface (distance/profile), m. */
  length_3d_m?: number;
  /** Horizontal ground length ("Naturmaß") = length_m · ground_factor, m. */
  ground_length_m?: number;
  /** Height difference end − start (DTM), m. */
  dh_m?: number;
  ascent_m?: number;
  descent_m?: number;
  h_min_m?: number;
  h_max_m?: number;
  h_avg_m?: number;
  slope_avg_deg?: number;
  slope_max_deg?: number;
  /** Horizontal UTM area (area), m². */
  area_m2?: number;
  perimeter_m?: number;
  /** Area polygon edges cross each other (area value not meaningful). */
  self_intersecting?: boolean;
  /** Point: DSM (surface/canopy) height and height above ground, m. */
  dsm_h_m?: number;
  above_ground_m?: number;
  /** UTM point scale factor at the measurement and grid → ground factor (incl. height). */
  grid_scale_factor: number;
  ground_factor: number;
  /** Share (0..1) of height samples not taken from the 1 m level (coarser or missing). */
  coarse_fraction: number;
  /** Share (0..1) of samples with a DSM height (profile). */
  dsm_fraction?: number;
}

export interface Measurement {
  id: string;
  kind: MeasureKind;
  created: string;
  vertices: Vertex[];
  metrics: MeasureMetrics;
  /** Point: Flurstück label (undefined = not queried yet, null = none / failed). */
  parcel?: string | null;
  /** Profile samples (runtime; exported compactly). */
  profile?: Profile;
}

export interface HeightProvider {
  /** True DTM height with its source level at world x/z. */
  dtmAt(x: number, z: number): LevelHeight;
  /** True DSM height (NaN where unavailable). */
  dsmAt?(x: number, z: number): number;
}

let seq = 0;
export function newMeasureId(now = Date.now()): string {
  seq = (seq + 1) % 1296;
  return `m-${now.toString(36)}-${seq.toString(36).padStart(2, '0')}`;
}

const round = (v: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const finite = (v: number) => (Number.isFinite(v) ? v : undefined);

/**
 * Metrics of a measurement from its vertices: lengths/areas in the UTM grid, surface length and
 * height statistics from DTM samples every 0.5 m along the line (profile kept for the chart).
 */
export function computeMetrics(
  kind: MeasureKind,
  vertices: readonly Vertex[],
  origin: Origin,
  heights: HeightProvider,
): { metrics: MeasureMetrics; profile?: Profile } {
  const c = centroidOfVertices(vertices);
  const lat = vertices.length ? utmToWgs84(c.E, c.N).lat : 49.3;
  const k = gridScaleFactor(c.E, lat);
  const toXZ = (v: Vertex) => ({ x: v.E - origin.E0, z: -(v.N - origin.N0) });

  if (kind === 'point') {
    const v = vertices[0];
    const p = v ? toXZ(v) : { x: 0, z: 0 };
    const r = v ? heights.dtmAt(p.x, p.z) : { h: NaN, level: -1 };
    const dsm = v && heights.dsmAt ? heights.dsmAt(p.x, p.z) : NaN;
    const h = Number.isFinite(r.h) ? r.h : (v?.h ?? NaN);
    return {
      metrics: {
        h_min_m: finite(h),
        h_max_m: finite(h),
        h_avg_m: finite(h),
        dsm_h_m: finite(dsm),
        above_ground_m: Number.isFinite(dsm) && Number.isFinite(h) ? Math.max(0, dsm - h) : undefined,
        grid_scale_factor: k,
        ground_factor: groundFactor(c.E, lat, h),
        coarse_fraction: r.level === 0 ? 0 : 1,
      },
    };
  }

  if (kind === 'area') {
    const area = polygonArea(vertices);
    const perim = ringPerimeter(vertices);
    const hs = vertices.map((v) => v.h).filter((h): h is number => h !== null && Number.isFinite(h));
    const hAvg = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : NaN;
    const gf = groundFactor(c.E, lat, hAvg);
    // Share of corners whose height is not from the 1 m DTM (coarser level, or missing/failed).
    const coarse = vertices.filter((v) => {
      const p = toXZ(v);
      return heights.dtmAt(p.x, p.z).level !== 0;
    }).length;
    return {
      metrics: {
        area_m2: area,
        perimeter_m: perim,
        length_m: perim,
        ground_length_m: perim * gf,
        self_intersecting: ringSelfIntersects(vertices) || undefined,
        h_min_m: hs.length ? Math.min(...hs) : undefined,
        h_max_m: hs.length ? Math.max(...hs) : undefined,
        grid_scale_factor: k,
        ground_factor: gf,
        coarse_fraction: vertices.length ? coarse / vertices.length : 0,
      },
    };
  }

  // distance / profile: sample along the line
  const profile = sampleProfile(
    vertices.map(toXZ),
    (x, z) => heights.dtmAt(x, z),
    kind === 'profile' && heights.dsmAt ? (x, z) => heights.dsmAt!(x, z) : undefined,
    PROFILE_STEP,
  );
  const st = profileStats(profile.d, profile.dtm);
  const len = polylineLength(vertices);
  const gf = groundFactor(c.E, lat, st.hAvg);
  const n = Math.max(profile.d.length, 1);
  const metrics: MeasureMetrics = {
    length_m: len,
    length_3d_m: st.valid >= 2 && profile.missing === 0 ? st.length3d : undefined,
    ground_length_m: len * gf,
    dh_m: finite(st.dh),
    ascent_m: st.valid >= 2 ? st.ascent : undefined,
    descent_m: st.valid >= 2 ? st.descent : undefined,
    h_min_m: finite(st.hMin),
    h_max_m: finite(st.hMax),
    h_avg_m: finite(st.hAvg),
    slope_avg_deg: finite(st.slopeAvgDeg),
    slope_max_deg: finite(st.slopeMaxDeg),
    grid_scale_factor: k,
    ground_factor: gf,
    coarse_fraction: profile.coarse / n,
    ...(kind === 'profile' ? { dsm_fraction: profile.dsmCount / n } : {}),
  };
  return { metrics, ...(kind === 'profile' ? { profile } : {}) };
}

// ---- formatting (German) ------------------------------------------------------------------------

const nf = (digits: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const NF = [0, 1, 2, 3, 4, 5, 6, 7].map(nf);

/** German number with fixed decimals ("1.234,56"); "–" for non-finite. */
export function fmtNum(v: number | undefined | null, digits = 2): string {
  return v !== undefined && v !== null && Number.isFinite(v) ? NF[Math.min(Math.max(digits, 0), 7)].format(v) : '–';
}

/** Length: "0,52 m", "123,4 m", "1,235 km". */
export function fmtLength(m: number | undefined): string {
  if (m === undefined || !Number.isFinite(m)) return '–';
  if (Math.abs(m) >= 1000) return `${fmtNum(m / 1000, 3)} km`;
  return `${fmtNum(m, Math.abs(m) < 100 ? 2 : 1)} m`;
}

/** Area: "12,3 m²", "1.234 m²", "1,234 ha" (≥ 1 ha), "1,23 km²" (≥ 1 km²). */
export function fmtArea(m2: number | undefined): string {
  if (m2 === undefined || !Number.isFinite(m2)) return '–';
  if (m2 >= 1e6) return `${fmtNum(m2 / 1e6, 2)} km²`;
  if (m2 >= 1e4) return `${fmtNum(m2 / 1e4, 3)} ha`;
  return `${fmtNum(m2, m2 < 100 ? 1 : 0)} m²`;
}

/** Signed height difference: "+1,23 m" / "−0,40 m". */
export function fmtSigned(m: number | undefined, digits = 2): string {
  if (m === undefined || !Number.isFinite(m)) return '–';
  const s = fmtNum(Math.abs(m), digits);
  return `${m > 0 ? '+' : m < 0 ? '−' : '±'}${s} m`;
}

/** Short summary for the 3D tag / list row. */
export function summary(m: Pick<Measurement, 'kind' | 'metrics' | 'vertices'>): string {
  const x = m.metrics;
  switch (m.kind) {
    case 'distance':
      return `${fmtLength(x.length_m)}${x.dh_m !== undefined ? ` · Δh ${fmtSigned(x.dh_m, 1)}` : ''}`;
    case 'area':
      return `${fmtArea(x.area_m2)}`;
    case 'profile':
      return `${fmtLength(x.length_m)} · ${fmtNum(x.h_min_m, 1)}–${fmtNum(x.h_max_m, 1)} m`;
    case 'point':
      return `${fmtNum(x.h_avg_m, 2)} m ü. NN`;
  }
}

// ---- GeoJSON export -------------------------------------------------------------------------------

export interface MeasureFeature {
  type: 'Feature';
  geometry:
    | { type: 'Point'; coordinates: number[] }
    | { type: 'LineString'; coordinates: number[][] }
    | { type: 'Polygon'; coordinates: number[][][] };
  properties: Record<string, unknown>;
}
export interface MeasureFeatureCollection {
  type: 'FeatureCollection';
  name: string;
  crs_note: string;
  generated: string;
  features: MeasureFeature[];
}

function lonLatH(v: Vertex): number[] {
  const { lat, lon } = utmToWgs84(v.E, v.N);
  return v.h !== null && Number.isFinite(v.h) ? [round(lon, 7), round(lat, 7), round(v.h, 2)] : [round(lon, 7), round(lat, 7)];
}

function cleanMetrics(x: MeasureMetrics): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = k.endsWith('factor') ? round(v, 7) : k === 'coarse_fraction' || k === 'dsm_fraction' ? round(v, 3) : round(v, 2);
  }
  return out;
}

/**
 * Measurements → GeoJSON FeatureCollection in WGS84 (lon, lat, h) like the marker export, with
 * E/N/h per vertex (EPSG:25832) and the metrics as properties. Profiles carry their DTM/DSM
 * samples (step 0.5 m, cm-rounded, null where unavailable).
 */
export function measurementsToGeoJSON(list: readonly Measurement[], now = new Date()): MeasureFeatureCollection {
  const features: MeasureFeature[] = [];
  for (const m of list) {
    if (m.vertices.length < minVertices(m.kind)) continue;
    const coords = m.vertices.map(lonLatH);
    const geometry: MeasureFeature['geometry'] =
      m.kind === 'point'
        ? { type: 'Point', coordinates: coords[0] }
        : m.kind === 'area'
          ? { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
          : { type: 'LineString', coordinates: coords };
    const props: Record<string, unknown> = {
      id: m.id,
      kind: m.kind,
      label_de: MEASURE_LABELS_DE[m.kind],
      created: m.created,
      summary_de: summary(m),
      vertices_utm: m.vertices.map((v) => [round(v.E, 2), round(v.N, 2), v.h !== null && Number.isFinite(v.h) ? round(v.h, 2) : null]),
      metrics: cleanMetrics(m.metrics),
    };
    if (m.kind === 'point') {
      const v = m.vertices[0];
      const { lat, lon } = utmToWgs84(v.E, v.N);
      Object.assign(props, { E: round(v.E, 2), N: round(v.N, 2), h: v.h !== null ? round(v.h, 2) : null, lat: round(lat, 7), lon: round(lon, 7) });
      if (m.parcel) props.parcel = m.parcel;
    }
    if (m.kind === 'profile' && m.profile) {
      const p = m.profile;
      const arr = (a: Float64Array) => Array.from(a, (v) => (Number.isFinite(v) ? round(v, 2) : null));
      props.profile = { step_max_m: PROFILE_STEP, d_m: arr(p.d), dtm_m: arr(p.dtm), ...(p.dsmCount ? { dsm_m: arr(p.dsm) } : {}) };
    }
    features.push({ type: 'Feature', geometry, properties: props });
  }
  return {
    type: 'FeatureCollection',
    name: 'Saar LiDAR Explorer – Messungen',
    crs_note:
      'Koordinaten WGS84 (lon, lat, Höhe m ü. NN); vertices_utm E/N/h in EPSG:25832. Längen/Flächen horizontal im UTM-Gitter (ground_factor → Naturmaß); length_3d_m entlang des DGM (Abtastung ≤ 0,5 m).',
    generated: now.toISOString(),
    features,
  };
}

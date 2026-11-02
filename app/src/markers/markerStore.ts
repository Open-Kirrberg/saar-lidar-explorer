/**
 * User find markers ("Fundmarker"): persistence (localStorage `sle.markers.v1`) and
 * GeoJSON export/import per docs/data-contract.md. Pure apart from the injected Storage.
 */
import { utmToWgs84, wgs84ToUtm } from '../geo';

export const MARKER_STORAGE_KEY = 'sle.markers.v1';

export const MARKER_CATEGORIES = [
  'Bunker',
  'Mauer',
  'Graben',
  'Grube/Trichter',
  'Hügel',
  'Weg',
  'Gebäude',
  'Sonstiges',
] as const;
export type MarkerCategory = (typeof MARKER_CATEGORIES)[number];

export interface Marker {
  id: string;
  title: string;
  note: string;
  category: MarkerCategory;
  /** ISO 8601 timestamp. */
  created: string;
  /** EPSG:25832 metres. */
  E: number;
  N: number;
  /** Terrain height m ü. NN (NaN/null if unknown). */
  h: number | null;
  /** Optional Flurstück label from the ALKIS WFS, e.g. "Bruchhof-Sanddorf, Flur 22, 5419/2". */
  parcel?: string;
}

/** Minimal Storage subset (localStorage-compatible), injectable for tests. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CATS = new Set<string>(MARKER_CATEGORIES);

export function newMarkerId(now = Date.now()): string {
  return `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Strict numeric coercion for untrusted input: finite numbers and non-blank numeric strings only.
 * `Number(null)`, `Number('')`, `Number(false)` and `Number([])` are all 0 — which would put a
 * marker at UTM (0, 0) — so everything else becomes NaN.
 */
export function toFiniteNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** Normalise an untrusted object into a Marker, or null if it lacks a valid position. */
export function sanitizeMarker(x: unknown): Marker | null {
  const m = x as Record<string, unknown>;
  if (!m || typeof m !== 'object') return null;
  const E = toFiniteNumber(m.E);
  const N = toFiniteNumber(m.N);
  if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
  const h = toFiniteNumber(m.h);
  const created = typeof m.created === 'string' && !Number.isNaN(Date.parse(m.created)) ? m.created : new Date().toISOString();
  return {
    id: typeof m.id === 'string' && m.id ? m.id.slice(0, 64) : newMarkerId(),
    title: String(m.title ?? '').slice(0, 200) || 'Ohne Titel',
    note: String(m.note ?? '').slice(0, 5000),
    category: (CATS.has(String(m.category)) ? m.category : 'Sonstiges') as MarkerCategory,
    created,
    E: round(E, 2),
    N: round(N, 2),
    h: Number.isFinite(h) ? round(h, 2) : null,
    ...(typeof m.parcel === 'string' && m.parcel ? { parcel: m.parcel.slice(0, 200) } : {}),
  };
}

export function loadMarkers(kv: KV | null | undefined): Marker[] {
  try {
    const raw = kv?.getItem(MARKER_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    const arr = Array.isArray(data) ? data : Array.isArray((data as { markers?: unknown[] })?.markers) ? (data as { markers: unknown[] }).markers : [];
    return arr.map(sanitizeMarker).filter((m): m is Marker => m !== null);
  } catch (err) {
    console.warn('[markers] could not load', err);
    return [];
  }
}

/** Returns false if storage is unavailable/full. */
export function saveMarkers(kv: KV | null | undefined, markers: Marker[]): boolean {
  try {
    if (!kv) return false;
    kv.setItem(MARKER_STORAGE_KEY, JSON.stringify({ version: 1, markers }));
    return true;
  } catch (err) {
    console.warn('[markers] could not save', err);
    return false;
  }
}

// ---- GeoJSON ------------------------------------------------------------------------------

export interface MarkerFeatureCollection {
  type: 'FeatureCollection';
  name: string;
  crs_note: string;
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] | [number, number, number] };
    properties: Omit<Marker, 'h'> & { h: number | null };
  }>;
}

/** WGS84 GeoJSON with properties `id, title, note, category, created, E, N, h` (+ optional `parcel`). */
export function markersToGeoJSON(markers: Marker[]): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    name: 'Saar LiDAR Explorer – Fundmarker',
    crs_note: 'Koordinaten WGS84 (lon, lat, Höhe m ü. NN); E/N in EPSG:25832. Hypothesen – Schauen, nicht graben.',
    features: markers.map((m) => {
      const { lat, lon } = utmToWgs84(m.E, m.N);
      const coords: [number, number] | [number, number, number] =
        m.h !== null ? [round(lon, 7), round(lat, 7), m.h] : [round(lon, 7), round(lat, 7)];
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: coords },
        properties: { ...m },
      };
    }),
  };
}

export interface ImportResult {
  markers: Marker[];
  skipped: number;
  errors: string[];
}

/**
 * Validate + import a GeoJSON FeatureCollection (or a single Feature).
 * Position comes from properties E/N if present, else from WGS84 coordinates.
 */
export function markersFromGeoJSON(input: unknown): ImportResult {
  const errors: string[] = [];
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { markers: [], skipped: 0, errors: ['Keine gültige JSON-Datei.'] };
    }
  }
  const obj = data as { type?: string; features?: unknown[] };
  const feats = obj?.type === 'FeatureCollection' && Array.isArray(obj.features) ? obj.features : obj?.type === 'Feature' ? [obj] : null;
  if (!feats) return { markers: [], skipped: 0, errors: ['Keine GeoJSON-FeatureCollection.'] };
  const markers: Marker[] = [];
  let skipped = 0;
  feats.forEach((f, i) => {
    const ft = f as { type?: string; geometry?: { type?: string; coordinates?: unknown[] }; properties?: Record<string, unknown> };
    const props = { ...(ft?.properties ?? {}) };
    if (ft?.type !== 'Feature' || ft.geometry?.type !== 'Point' || !Array.isArray(ft.geometry.coordinates)) {
      skipped++;
      errors.push(`Objekt ${i + 1}: kein Punkt.`);
      return;
    }
    const [lon, lat, z] = ft.geometry.coordinates.map(toFiniteNumber);
    // QGIS & co. export missing attributes as null or '': only real numbers count, else use the geometry.
    if (!Number.isFinite(toFiniteNumber(props.E)) || !Number.isFinite(toFiniteNumber(props.N))) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        skipped++;
        errors.push(`Objekt ${i + 1}: ungültige Koordinaten.`);
        return;
      }
      const u = wgs84ToUtm(lat, lon);
      props.E = u.E;
      props.N = u.N;
    }
    if (!Number.isFinite(toFiniteNumber(props.h)) && Number.isFinite(z)) props.h = z;
    const m = sanitizeMarker(props);
    if (!m) {
      skipped++;
      errors.push(`Objekt ${i + 1}: ungültig.`);
      return;
    }
    markers.push(m);
  });
  return { markers, skipped, errors };
}

/** Merge imported markers into existing ones: same id → replaced, new ids appended. */
export function mergeMarkers(existing: Marker[], incoming: Marker[]): Marker[] {
  const map = new Map(existing.map((m) => [m.id, m] as const));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()];
}

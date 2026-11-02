/** Known sites ("Bekannte Orte") from public/data/pois.geojson — parsing, grouping, filtering (pure). */

export type PoiType =
  | 'castle'
  | 'palace'
  | 'garden'
  | 'bunker'
  | 'burial_mound'
  | 'cave'
  | 'boundary_stone'
  | 'mine'
  | 'other';

export interface Poi {
  id: string;
  name: string;
  type: PoiType;
  confidence: 'high' | 'med' | 'low';
  source?: string;
  note?: string;
  lat: number;
  lon: number;
}

export const POI_TYPE_LABELS: Record<PoiType, string> = {
  castle: 'Burgen & Festungen',
  palace: 'Schlösser & Ruinen',
  garden: 'Gärten & Weiher',
  bunker: 'Bunker',
  burial_mound: 'Grabhügel',
  cave: 'Höhlen & Keller',
  boundary_stone: 'Grenzsteine',
  mine: 'Stollen & Gruben',
  other: 'Sonstiges',
};

export const POI_TYPE_ORDER: PoiType[] = [
  'palace',
  'castle',
  'garden',
  'burial_mound',
  'bunker',
  'cave',
  'mine',
  'boundary_stone',
  'other',
];

export const CONFIDENCE_LABELS: Record<Poi['confidence'], string> = {
  high: 'gesichert',
  med: 'wahrscheinlich',
  low: 'unsicher',
};

const TYPES = new Set<string>(POI_TYPE_ORDER);

/** Parse a GeoJSON FeatureCollection of Point features; invalid features are skipped. */
export function parsePois(geojson: unknown): Poi[] {
  const fc = geojson as { type?: string; features?: unknown[] };
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return [];
  const out: Poi[] = [];
  const seen = new Set<string>();
  for (const f of fc.features as Array<Record<string, any>>) {
    const g = f?.geometry;
    const p = f?.properties ?? {};
    if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
    const [lon, lat] = g.coordinates.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let id = String(p.id ?? `poi-${out.length}`);
    while (seen.has(id)) id += '_';
    seen.add(id);
    out.push({
      id,
      name: String(p.name ?? id),
      type: (TYPES.has(p.type) ? p.type : 'other') as PoiType,
      confidence: p.confidence === 'high' || p.confidence === 'low' ? p.confidence : 'med',
      source: typeof p.source === 'string' ? p.source : undefined,
      note: typeof p.note === 'string' ? p.note : undefined,
      lat,
      lon,
    });
  }
  return out;
}

/** Lower-case, strip diacritics, ß → ss — for forgiving search. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export interface PoiFilter {
  query?: string;
  types?: ReadonlySet<PoiType>;
  /** Only POIs for which this returns true (e.g. inside the loaded AOI). */
  where?: (p: Poi) => boolean;
}

export function filterPois(pois: Poi[], f: PoiFilter = {}): Poi[] {
  const words = foldText(f.query ?? '')
    .split(/\s+/)
    .filter(Boolean);
  return pois.filter((p) => {
    if (f.types && f.types.size > 0 && !f.types.has(p.type)) return false;
    if (f.where && !f.where(p)) return false;
    if (words.length === 0) return true;
    const hay = foldText(`${p.name} ${p.note ?? ''} ${POI_TYPE_LABELS[p.type]}`);
    return words.every((w) => hay.includes(w));
  });
}

export interface PoiGroup {
  type: PoiType;
  label: string;
  items: Poi[];
}

/** Group by type in POI_TYPE_ORDER; items sorted by German name; empty groups omitted. */
export function groupPois(pois: Poi[]): PoiGroup[] {
  const by = new Map<PoiType, Poi[]>();
  for (const p of pois) {
    const arr = by.get(p.type) ?? [];
    arr.push(p);
    by.set(p.type, arr);
  }
  const coll = new Intl.Collator('de');
  return POI_TYPE_ORDER.filter((t) => by.has(t)).map((t) => ({
    type: t,
    label: POI_TYPE_LABELS[t],
    items: by.get(t)!.sort((a, b) => coll.compare(a.name, b.name)),
  }));
}

/**
 * Oblique viewing pose for a site: camera `dist` metres horizontally away, `agl` above ground,
 * looking at the target. Returns heading/pitch for DroneController.flyTo(…, { lookAt: true }).
 */
export function obliqueView(dist = 120, agl = 60, heading = 0): { heading: number; pitch: number; agl: number } {
  const pitch = -(Math.atan2(agl, dist) * 180) / Math.PI;
  return { heading, pitch, agl };
}

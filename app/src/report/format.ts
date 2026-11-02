/**
 * Pure helpers for the F18 report ("Meldung"): coordinate formatting (UTM, WGS84 decimal + DMS),
 * HTML escaping, parcel label parsing, Web-Mercator tile math, scale-bar lengths, file names.
 * No DOM / three imports — unit-tested in app/tests/report.test.ts.
 */

/** Escape text for HTML element content *and* quoted attribute values. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Escaped multi-line text: line breaks become `<br>` (after escaping). */
export function escapeMultiline(s: unknown): string {
  return escapeHtml(String(s ?? '').replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

/** Only inline raster images are allowed in the report (keeps it self-contained, no remote loads). */
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export function isInlineImage(url: unknown): url is string {
  return typeof url === 'string' && DATA_IMAGE.test(url);
}

/** Fixed decimals with a German decimal comma and no digit grouping (e.g. coordinates). */
export function fixedDe(v: number, decimals: number): string {
  return v.toFixed(decimals).replace('.', ',');
}

export interface Dms {
  deg: number;
  min: number;
  sec: number;
  hemi: string;
}

/**
 * Decimal degrees → degrees/minutes/seconds with seconds rounded to `secDecimals`; carries
 * 59.995″ → 60″ into the next minute/degree so the output never shows 60″ or 60′.
 */
export function toDms(value: number, axis: 'lat' | 'lon', secDecimals = 2): Dms {
  const hemi = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  const f = 10 ** secDecimals;
  // Work in integer units of (1/f) arc-seconds to avoid float drift.
  let units = Math.round(Math.abs(value) * 3600 * f);
  const perMin = 60 * f;
  const perDeg = 3600 * f;
  const deg = Math.floor(units / perDeg);
  units -= deg * perDeg;
  const min = Math.floor(units / perMin);
  units -= min * perMin;
  return { deg, min, sec: units / f, hemi };
}

/** 49° 20′ 06,44″ N */
export function formatDms(value: number, axis: 'lat' | 'lon', secDecimals = 2): string {
  const d = toDms(value, axis, secDecimals);
  const secStr = fixedDe(d.sec, secDecimals).padStart(secDecimals > 0 ? 3 + secDecimals : 2, '0');
  return `${d.deg}° ${String(d.min).padStart(2, '0')}′ ${secStr}″ ${d.hemi}`;
}

/** "49.335123° N, 7.378456° E" (decimal point: the form GPS devices and map apps accept). */
export function formatWgs84Decimal(lat: number, lon: number, decimals = 6): string {
  return `${Math.abs(lat).toFixed(decimals)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(decimals)}° ${lon < 0 ? 'W' : 'E'}`;
}

/** "49.335123, 7.378456" — copy-paste form for map search fields. */
export function formatLatLonPlain(lat: number, lon: number, decimals = 6): string {
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}

/** "E 380123,45 m · N 5463210,12 m" */
export function formatUtm(E: number, N: number, decimals = 2): { E: string; N: string } {
  return { E: `${fixedDe(E, decimals)} m`, N: `${fixedDe(N, decimals)} m` };
}

export function formatHeight(h: number | null | undefined): string {
  return typeof h === 'number' && Number.isFinite(h) ? `${fixedDe(h, 2)} m ü. NHN (DHHN2016)` : '–';
}

/** Local date/time "01.11.2026, 14:05" for an ISO timestamp (or '–' if invalid). */
export function formatDateDe(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

export interface ParcelParts {
  gemarkung: string;
  flur: string;
  flurstueck: string;
  lage: string;
  raw: string;
}

/**
 * Split a parcel label as produced by `parcelLabel` (WFS) / `formatParcel` (local data):
 * "Gemarkung, Flur 22, Flurstück 5419/2 („Lage“)". Unrecognised parts stay in `gemarkung`.
 */
export function parseParcelLabel(label: string | null | undefined): ParcelParts | null {
  const raw = String(label ?? '').trim();
  if (!raw) return null;
  let rest = raw;
  let lage = '';
  const m = /\s*\(„(.*)“\)\s*$/.exec(rest);
  if (m) {
    lage = m[1].trim();
    rest = rest.slice(0, m.index);
  }
  let flur = '';
  let flurstueck = '';
  const other: string[] = [];
  for (const part of rest.split(/,\s*/).map((p) => p.trim()).filter(Boolean)) {
    if (/^Flurstück\s+/i.test(part)) flurstueck = part.replace(/^Flurstück\s+/i, '');
    else if (/^Flur\s+/i.test(part)) flur = part.replace(/^Flur\s+/i, '');
    else other.push(part);
  }
  return { gemarkung: other.join(', '), flur, flurstueck, lage, raw };
}

// ---- Web Mercator tiles -------------------------------------------------------------------

export const TILE_SIZE = 256;
const EARTH_CIRC = 2 * Math.PI * 6378137;

/** Global pixel position (256 px tiles) of a WGS84 point at zoom z. */
export function lonLatToPixel(lat: number, lon: number, z: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Ground metres per Web-Mercator pixel at latitude `lat`, zoom z. */
export function metersPerPixel(lat: number, z: number): number {
  return (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** z);
}

export interface TilePlacement {
  x: number;
  y: number;
  z: number;
  /** Canvas position of the tile's top-left corner (px). */
  dx: number;
  dy: number;
}

/** Tiles covering a `width`×`height` canvas centred on (lat, lon) at zoom z, with draw offsets. */
export function tilesForView(lat: number, lon: number, z: number, width: number, height: number): TilePlacement[] {
  const c = lonLatToPixel(lat, lon, z);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const n = 2 ** z;
  const out: TilePlacement[] = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + height - 1) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + width - 1) / TILE_SIZE); tx++) {
      out.push({ x: ((tx % n) + n) % n, y: ty, z, dx: Math.round(tx * TILE_SIZE - left), dy: Math.round(ty * TILE_SIZE - top) });
    }
  }
  return out;
}

/** Does tile (x, y, z) intersect WGS84 bounds [[south, west], [north, east]]? */
export function tileIntersectsBounds(x: number, y: number, z: number, bounds?: [[number, number], [number, number]]): boolean {
  if (!bounds) return true;
  const [[s, w], [nLat, e]] = bounds;
  const a = lonLatToPixel(nLat, w, z);
  const b = lonLatToPixel(s, e, z);
  const x0 = x * TILE_SIZE;
  const y0 = y * TILE_SIZE;
  return x0 + TILE_SIZE > a.x && x0 < b.x && y0 + TILE_SIZE > a.y && y0 < b.y;
}

/** Largest "nice" length (1, 2, 5 · 10ⁿ m) not exceeding `maxMeters`. */
export function niceScaleLength(maxMeters: number): number {
  if (!(maxMeters > 0) || !Number.isFinite(maxMeters)) return 0;
  const p = 10 ** Math.floor(Math.log10(maxMeters));
  for (const k of [5, 2, 1]) if (k * p <= maxMeters + 1e-9) return k * p;
  return p;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${fixedDe(m / 1000, m % 1000 === 0 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

// ---- misc ---------------------------------------------------------------------------------

/** Safe ASCII slug for file names: "Graben am Hang (Süd)" → "graben-am-hang-sued". */
export function slugify(s: string, max = 40): string {
  const t = s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return t || 'marker';
}

export function reportFileName(title: string, date: Date): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `meldung-${slugify(title)}-${d}.html`;
}

/**
 * Attribution lines from the manifest string ("a; b; c") plus extras, de-duplicated (case- and
 * whitespace-insensitive), order kept.
 */
export function attributionLines(...parts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    for (const line of String(p ?? '').split(/\s*;\s*/)) {
      const t = line.trim();
      const k = t.toLowerCase().replace(/\s+/g, ' ');
      if (!t || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

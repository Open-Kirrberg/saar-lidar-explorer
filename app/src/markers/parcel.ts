/**
 * Flurstück lookup for a point via the Saarland ALKIS WFS 414 (CORS *, dl-de/by-2-0).
 * Only EPSG:25832 works for BBOX and SRSNAME (research/04 §2a). No owner data is involved.
 */

export const WFS_414 = 'https://geoportal.saarland.de/registry/wfs/414';
export const PARCEL_ATTRIBUTION = 'Flurstücke: © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0';

type Ring = number[][];

/** Ray-casting point-in-polygon for one ring. */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in (Multi)Polygon geometry (outer ring minus holes). */
export function pointInGeometry(x: number, y: number, g: { type: string; coordinates: unknown }): boolean {
  const polys: Ring[][] =
    g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : [];
  return polys.some((rings) => rings.length > 0 && pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h)));
}

/** "Gemarkung, Flur 22, Flurstück 5419/2" from WFS 414 properties (FLSTNRNEN may be the string 'null'). */
export function parcelLabel(p: Record<string, unknown>): string {
  const zae = String(p.FLSTNRZAE ?? '').trim();
  const nenRaw = String(p.FLSTNRNEN ?? '').trim();
  const nen = nenRaw && nenRaw !== 'null' ? nenRaw : '';
  const nr = nen ? `${zae}/${nen}` : zae;
  const parts = [p.GEMARKUNG, p.FLUR, nr ? `Flurstück ${nr}` : ''].map((v) => String(v ?? '').trim()).filter(Boolean);
  const lage = String(p.LAGEBEZTXT ?? '').trim();
  return parts.join(', ') + (lage ? ` („${lage}“)` : '');
}

export function parcelUrl(E: number, N: number, half = 0.5): string {
  const bbox = [E - half, N - half, E + half, N + half].map((v) => v.toFixed(2)).join(',');
  const q = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'ALKIS_ALKIS_WFS_ohne_Eig:Flurstueck',
    BBOX: `${bbox},urn:ogc:def:crs:EPSG::25832`,
    SRSNAME: 'urn:ogc:def:crs:EPSG::25832',
    COUNT: '10',
    OUTPUTFORMAT: 'GEOJSON',
  });
  return `${WFS_414}?${q.toString()}`;
}

/** Optional local parcel lookup (F12: AOI `vectors.flurstuecke`), tried before the live WFS. */
export type LocalParcelLookup = (E: number, N: number) => Promise<string | null>;
let localLookup: LocalParcelLookup | null = null;

/** Register (or clear with null) a local lookup; `lookupParcel` prefers it and falls back to the WFS. */
export function setLocalParcelLookup(fn: LocalParcelLookup | null): void {
  localLookup = fn;
}

/** Local AOI parcel data only (no network); null if no local lookup is registered or nothing found. */
export async function lookupParcelLocal(E: number, N: number): Promise<string | null> {
  if (!localLookup) return null;
  try {
    return await localLookup(E, N);
  } catch (err) {
    console.warn('[parcel] local lookup failed', err);
    return null;
  }
}

/**
 * Look up the parcel containing (E, N): local AOI data first (if registered and it finds one),
 * else the live WFS. Resolves null if none / on error; the WFS times out after `timeoutMs`.
 */
export async function lookupParcel(E: number, N: number, timeoutMs = 25000): Promise<string | null> {
  if (localLookup) {
    try {
      const hit = await localLookup(E, N);
      if (hit) return hit;
    } catch (err) {
      console.warn('[parcel] local lookup failed, using WFS', err);
    }
  }
  return lookupParcelWfs(E, N, timeoutMs);
}

/** Live lookup via ALKIS WFS 414 (point-in-polygon on the returned parcels). */
export async function lookupParcelWfs(E: number, N: number, timeoutMs = 25000): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(parcelUrl(E, N), { signal: ac.signal });
    if (!res.ok) return null;
    // Content-Type is the non-standard "geojson" → parse manually.
    const data = JSON.parse(await res.text()) as { features?: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };
    const feats = data.features ?? [];
    const hit = feats.find((f) => f.geometry && pointInGeometry(E, N, f.geometry)) ?? feats[0];
    return hit ? parcelLabel(hit.properties ?? {}) : null;
  } catch (err) {
    console.warn('[parcel] lookup failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Catalog mode (S2): the 🏆 *Orte im Vergleich* source. The catalog's `leaderboard` names a
 * stats-only manifest (kind 'stats-only', Gemeinde level, contract "Catalog"); its `stats` key and
 * `stats_levels` drive the same panel as in single-AOI mode. Level AOIs of `stats_levels` (e.g. the
 * Ortsteile of `overall`) resolve next to the leaderboard's own directory (`../<aoi>/`). The
 * catalog `status` overrides the stats `status` (joined on AGS, ADR 0051 / contract "Catalog"), and
 * the single-AOI fields `place_aoi` / `aoi_share_pct` are ignored. Pure apart from `loadLeaderboard`.
 */
import type { Catalog } from '../data/catalog';
import { tileIdAt } from '../data/globalGrid';
import type { ManifestStats, PlacesData, StatsLevels } from '../places/placesData';
import { parseManifestStats, parseStatsLevels } from '../places/placesData';

export interface CatalogLeaderboard {
  /** Absolute URL of the stats-only manifest. */
  url: string;
  /** Its directory (ends in '/'): `meta.url` / `meta.geometry` resolve against it. */
  baseUrl: string;
  meta: ManifestStats;
  levels?: StatsLevels;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Parse the leaderboard manifest: null without a valid `stats` key. */
export function parseLeaderboard(raw: unknown, url: string): CatalogLeaderboard | null {
  if (!isObj(raw)) return null;
  const meta = parseManifestStats(raw.stats);
  if (!meta) return null;
  const levels = parseStatsLevels(raw.stats_levels);
  return { url, baseUrl: url.replace(/[^/]*$/, ''), meta, ...(levels ? { levels } : {}) };
}

/** Base URL of a level AOI of `stats_levels`: a sibling directory of the leaderboard's own. */
export function levelBaseUrl(lb: Pick<CatalogLeaderboard, 'url'>, aoi: string): string {
  return new URL(`../${encodeURIComponent(aoi)}/`, lb.url).href;
}

/**
 * Catalog status wins over the stats status (join on AGS, Gemeinde-level places only); `place_aoi`
 * and `aoi_share_pct` are single-AOI fields → null. Mutates `data`; returns the number of places
 * whose status changed.
 */
export function applyCatalogStatus(data: PlacesData, cat: Pick<Catalog, 'places'>): number {
  const byAgs = new Map(cat.places.map((p) => [p.ags, p.status] as const));
  let changed = 0;
  for (const p of data.places) {
    p.place_aoi = null;
    p.aoi_share_pct = null;
    if (!p.ags) continue;
    const st = byAgs.get(p.ags);
    if (st && st !== p.status) {
      p.status = st;
      changed++;
    }
  }
  return changed;
}

/** Fetch + parse (CORS without credentials); null on any failure (the panel then stays hidden). */
export async function loadLeaderboard(url: string, fetchFn: typeof fetch = fetch): Promise<CatalogLeaderboard | null> {
  try {
    const res = await fetchFn(url, { cache: 'no-cache', mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) throw new Error('not JSON');
    const lb = parseLeaderboard(JSON.parse(text), res.url || url);
    if (!lb) console.warn('[catalog] leaderboard manifest has no valid stats → no „Orte im Vergleich“');
    return lb;
  } catch (err) {
    console.warn(`[catalog] leaderboard: ${String(err)} → no „Orte im Vergleich“`);
    return null;
  }
}

/**
 * Catalog mode: is (E, N) in the 3D area — a tile owned by a place with detailed 3D (`'3d'` /
 * `'building'`)? Riesen collecting counts only Riesen there („Nur Riesen im 3D-Gebiet“), as in
 * single-AOI mode where the AOI rectangle is the 3D area; Gemeinde-level Riesen in 'stats' places
 * have no 3D trees to fly to.
 */
export function inCatalog3d(cat: Pick<Catalog, 'owners' | 'byId'>, E: number, N: number): boolean {
  const id = cat.owners.get(tileIdAt(E, N));
  const p = id ? cat.byId.get(id) : undefined;
  return !!p && p.status !== 'stats';
}

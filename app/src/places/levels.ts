/**
 * 🗺️ Leaderboard levels (S1 Saarland leaderboard; contract „Gemeinde level“, ADR 0051): which levels
 * the switch offers (`stats_levels` of the current AOI's manifest) and the lazy loader of another
 * level's stats from its AOI (e.g. the stats-only AOI `saarland`). Pure apart from the injected fetch.
 *
 * Tolerance (R9): no / invalid `stats_levels`, the own level missing from it, fewer than two levels,
 * an unreachable level AOI or a file of the wrong level → no switch, only the AOI's own stats.
 */
import { resolveDataPath } from '../data/urls';
import { parseManifestStats, parseOutlines, parsePlacesFile, statsLevelOf } from './placesData';
import type { ManifestStats, Outlines, PlacesData, StatsLevel, StatsLevelEntry, StatsLevels } from './placesData';

export interface LevelChoice extends StatsLevelEntry {
  /** The level of the current AOI's own `stats` (loaded with the panel, never fetched twice). */
  own: boolean;
}

/** The levels of the switch in display order, or null when there is nothing to switch. */
export function levelChoices(meta: ManifestStats | undefined, levels: StatsLevels | undefined): LevelChoice[] | null {
  if (!meta || !levels || levels.levels.length < 2) return null;
  const own = statsLevelOf(meta);
  if (!levels.levels.some((l) => l.level === own)) return null;
  return levels.levels.map((l) => ({ ...l, own: l.level === own }));
}

export type FetchJson = (url: string) => Promise<unknown | null>;

export interface LoadedLevel {
  level: StatsLevel;
  aoi: string;
  baseUrl: string;
  meta: ManifestStats;
  data: PlacesData;
  outlines: Outlines;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Step 1 (cheap, at start): the level AOI's manifest. Its `stats` must be valid and of the expected
 * level (a stats-only manifest is fine: only `stats` is read). null → the level is not offered.
 */
export async function probeLevel(choice: StatsLevelEntry, baseUrl: string, fetchJson: FetchJson): Promise<ManifestStats | null> {
  try {
    const m = await fetchJson(`${baseUrl}manifest.json`);
    if (!isObj(m)) return null;
    const meta = parseManifestStats(m.stats);
    if (!meta || statsLevelOf(meta) !== choice.level) {
      console.warn(`[places] level ${choice.level}: ${choice.aoi}/manifest.json has no stats of that level`);
      return null;
    }
    return meta;
  } catch (err) {
    console.warn(`[places] level ${choice.level}: ${choice.aoi} not reachable`, err);
    return null;
  }
}

/**
 * Step 2 (lazy, on the first switch): places.json (must be `sle-stats-v1` of the expected level with
 * at least one place) and the outlines (optional: without them fly-to uses label / bbox).
 */
export async function loadLevelData(choice: StatsLevelEntry, baseUrl: string, meta: ManifestStats, fetchJson: FetchJson): Promise<LoadedLevel | null> {
  let data: PlacesData | null = null;
  try {
    data = parsePlacesFile(await fetchJson(resolveDataPath(baseUrl, meta.url)));
  } catch (err) {
    console.warn(`[places] level ${choice.level}: places.json not loaded`, err);
    return null;
  }
  if (!data || !data.places.length || data.level !== choice.level) {
    console.warn(`[places] level ${choice.level}: places.json missing, empty or of another level`);
    return null;
  }
  let outlines: Outlines = new Map();
  if (meta.geometry) {
    try {
      outlines = parseOutlines(await fetchJson(resolveDataPath(baseUrl, meta.geometry)));
    } catch (err) {
      console.warn(`[places] level ${choice.level}: outlines not loaded (fly-to uses label/bbox)`, err);
    }
  }
  return { level: choice.level, aoi: choice.aoi, baseUrl, meta, data, outlines };
}

/**
 * Catalog mode (S2): open a session from `VITE_CATALOG_URL` — catalog, overview, the start place's
 * manifest, the resolver and the session manifest. Any failure of the catalog itself throws (the
 * caller falls back to single-AOI mode); a failing overview or start place only degrades.
 */
import type { Catalog, CatalogPlace } from '../data/catalog';
import { loadCatalog, placeAt } from '../data/catalog';
import { distanceToBbox } from '../data/globalGrid';
import type { Manifest } from '../data/manifest';
import { isAvifPath } from '../data/manifest';
import type { Overview } from '../data/overview';
import { loadOverview } from '../data/overview';
import { CatalogResolver, sessionRect } from '../terrain/sources';
import type { CoverageGrid } from '../terrain/coverage';
import { coverageGrid } from '../terrain/coverage';
import type { CatalogLeaderboard } from './leaderboard';
import { loadLeaderboard } from './leaderboard';
import { PlaceManager } from './PlaceManager';
import { buildSessionManifest } from './session';

export interface CatalogSession {
  catalog: Catalog;
  overview: Overview | null;
  resolver: CatalogResolver;
  places: PlaceManager;
  /** The session manifest (`ctx.manifest` in catalog mode). */
  manifest: Manifest;
  /** Base URL of the catalog (session-level relative paths). */
  baseUrl: string;
  /** Catalog `height_ref_m`: the single hRef of the exaggeration rule. */
  hRef: number;
  /** Start ground point (hash position or the first 3D place's centre). */
  start: { E: number; N: number };
  /** Owned tiles of all places (any status) over the session rectangle: the terrain is clipped to it. */
  coverage: CoverageGrid;
  /** The catalog's `leaderboard` stats-only manifest (🏆 Orte im Vergleich), when it loaded. */
  leaderboard: CatalogLeaderboard | null;
}

/** The 3D place under (E, N), else the nearest 3D place by bbox. */
export function startPlace(cat: Catalog, E: number, N: number): CatalogPlace | undefined {
  const at = placeAt(cat, E, N);
  if (at && at.status !== 'stats') return at;
  let best: CatalogPlace | undefined;
  let bd = Infinity;
  for (const p of cat.places) {
    if (p.status === 'stats') continue;
    const d = distanceToBbox(E, N, p.bbox);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Without AVIF: drop `.avif` layers of the overview levels (vat, ortho). Returns the count. */
function stripOverviewAvif(o: Overview): number {
  let n = 0;
  for (const lv of o.levels) {
    for (const [k, l] of Object.entries(lv.layers)) if (isAvifPath(l.path)) { delete lv.layers[k]; n++; }
    for (const [k, l] of Object.entries(lv.imageLayers)) if (l.format === 'avif' || isAvifPath(l.path)) { delete lv.imageLayers[k]; n++; }
  }
  return n;
}

export async function openCatalogSession(
  url: string,
  opts: { avif: boolean; start?: { E: number; N: number }; onAvifMissing?: () => void },
): Promise<CatalogSession> {
  const catalog = await loadCatalog(url);
  // The leaderboard manifest is tiny; fetched alongside the overview.
  const leaderboardP = catalog.leaderboardUrl ? loadLeaderboard(catalog.leaderboardUrl) : Promise.resolve(null);
  let overview: Overview | null = null;
  if (catalog.overviewUrl) {
    try {
      overview = await loadOverview(catalog.overviewUrl);
      if (!opts.avif && stripOverviewAvif(overview) > 0) opts.onAvifMissing?.();
      if (!overview.levels.length) overview = null;
    } catch (err) {
      console.warn(`[catalog] overview: ${String(err)} → no levels ≥ 2`);
    }
  }
  const { rect, topLevel } = sessionRect(catalog, overview);
  const resolver = new CatalogResolver(catalog, overview, rect);
  const places = new PlaceManager(catalog, resolver, { avif: opts.avif, onAvifMissing: opts.onAvifMissing });
  let start = opts.start;
  const sp = startPlace(catalog, start?.E ?? NaN, start?.N ?? NaN) ?? catalog.places.find((p) => p.status !== 'stats');
  if (!start || !Number.isFinite(start.E)) {
    const b = sp?.bbox ?? [rect.E0, rect.N0, rect.E0 + rect.W, rect.N0 + rect.H];
    start = { E: (b[0] + b[2]) / 2, N: (b[1] + b[3]) / 2 };
  }
  let first: Manifest | undefined;
  if (sp) {
    await places.ensure(sp.id);
    const l = resolver.placeLoad(sp.id);
    if (l.state === 'ready') first = l.manifest;
  }
  places.update(start.E, start.N);
  const manifest = buildSessionManifest(catalog, overview, rect, topLevel, first);
  const coverage = coverageGrid(catalog.owners.keys(), rect);
  const leaderboard = await leaderboardP;
  return { catalog, overview, resolver, places, manifest, baseUrl: url.replace(/[^/]*$/, ''), hRef: catalog.height_ref_m, start, coverage, leaderboard };
}

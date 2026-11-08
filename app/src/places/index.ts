/**
 * 🏆 Orte im Vergleich (plan docs/plans/orte-im-vergleich.md §8 Phase 0, ADR 0049).
 *
 *   registerPlaceStats(ctx);   // main.ts, after registerZones (card order in the „Orte“ drawer)
 *
 * Tier (ADR 0019 / 0032): 🟢 Standard feature `place-stats`, available only when the manifest has a
 * valid `stats` key. It lives in the Standard „Orte“ drawer (phones: bottom sheet, ADR 0014), as a
 * card between „Nachbauten zum Betreten“ (zones) and „Bekannte Orte“ (POIs): it is about places too,
 * needs no tools and is the playful entry point to the data, so it is not hidden in Labor.
 * S1: with a valid `stats_levels` key the card and the full view get a level switch Gemeinden / Ortsteile
 * (levels.ts loads the other level lazily from its AOI, e.g. the stats-only AOI `saarland`).
 */
import { applyCatalogStatus, inCatalog3d, levelBaseUrl } from '../catalog/leaderboard';
import type { AppContext } from '../main';
import { mountPlaceStats } from './PlacesPanel';

export { parseManifestStats } from './placesData';
export type { ManifestStats } from './placesData';

export function registerPlaceStats(ctx: AppContext): () => void {
  // S2 catalog mode: the catalog's `leaderboard` stats-only manifest (Gemeinde level, its
  // `stats_levels` resolved next to it), catalog status over stats status (join on AGS).
  const cat = ctx.catalog;
  const lb = cat?.leaderboard;
  if (cat && lb) {
    return ctx.shell.registerFeature({
      id: 'place-stats',
      tier: 'standard',
      label: 'Orte im Vergleich',
      mount: (h) =>
        mountPlaceStats(h, lb.meta, lb.levels, {
          baseUrl: lb.baseUrl,
          levelBaseUrl: (aoi) => levelBaseUrl(lb, aoi),
          adjust: (d) => void applyCatalogStatus(d, cat.catalog),
          riesenScope: (E, N) => inCatalog3d(cat.catalog, E, N),
        }),
    });
  }
  return ctx.shell.registerFeature({
    id: 'place-stats',
    tier: 'standard',
    label: 'Orte im Vergleich',
    available: () => !!ctx.manifest.stats,
    mount: (h) => mountPlaceStats(h, ctx.manifest.stats!, ctx.manifest.stats_levels),
  });
}

/**
 * 🏆 Orte im Vergleich (plan docs/plans/orte-im-vergleich.md §8 Phase 0, ADR 0049).
 *
 *   registerPlaceStats(ctx);   // main.ts, after registerZones (card order in the „Orte“ drawer)
 *
 * Tier (ADR 0019 / 0032): 🟢 Standard feature `place-stats`, available only when the manifest has a
 * valid `stats` key. It lives in the Standard „Orte“ drawer (phones: bottom sheet, ADR 0014), as a
 * card between „Nachbauten zum Betreten“ (zones) and „Bekannte Orte“ (POIs): it is about places too,
 * needs no tools and is the playful entry point to the data, so it is not hidden in Labor.
 */
import type { AppContext } from '../main';
import { mountPlaceStats } from './PlacesPanel';

export { parseManifestStats } from './placesData';
export type { ManifestStats } from './placesData';

export function registerPlaceStats(ctx: AppContext): () => void {
  return ctx.shell.registerFeature({
    id: 'place-stats',
    tier: 'standard',
    label: 'Orte im Vergleich',
    available: () => !!ctx.manifest.stats,
    mount: (h) => mountPlaceStats(h, ctx.manifest.stats!),
  });
}

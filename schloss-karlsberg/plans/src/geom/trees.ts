/**
 * Avenue trees exactly as the 3D site builds them (model/src/site/features.ts): layout
 * avenueTrees() with seed hashString(feature id) ^ model seed (1789), dropped where a tree
 * (± 3 m) falls into a court, terrace, parterre, pond or building footprint (hypothetical avenues: also lawns). Kept in sync by
 * plans/tests/trees.test.ts.
 */
import { avenueBlockers, treeBlocked } from '../../../model/src/layout/garden.ts';
import { hashString } from '../../../model/src/layout/geom.ts';
import { type TreePosition, avenueTrees } from '../../../model/src/layout/site.ts';
import type { EN, SiteSpec, TerrainFeature } from '../../../model/src/spec.ts';

export const MODEL_SEED = 1789;

/**
 * Polygons that stop avenue trees, the same rule as model/src/site/features.ts (shared helper
 * model/src/layout/garden.ts `avenueBlockers`, scene year 1789): courts, terraces, parterres, ponds,
 * buildings and, for a hypothetical avenue `f`, lawns.
 */
export function treeBlockers(spec: SiteSpec, f: TerrainFeature | null = null): EN[][] {
  return avenueBlockers(spec, f);
}

export function isBlocked(E: number, N: number, blockers: EN[][]): boolean {
  return treeBlocked(E, N, blockers);
}

const cache = new WeakMap<SiteSpec, Map<string, TreePosition[]>>();

/** Trees of one avenue feature as built in 3D. */
export function builtAvenueTrees(spec: SiteSpec, f: TerrainFeature): TreePosition[] {
  let m = cache.get(spec);
  if (!m) cache.set(spec, (m = new Map()));
  const hit = m.get(f.id);
  if (hit) return hit;
  if (f.kind !== 'avenue' || !f.trees || f.geometry.type !== 'LineString') return [];
  const blockers = treeBlockers(spec, f);
  const out = avenueTrees(f.geometry.coordinates, f.trees, { seed: hashString(f.id) ^ MODEL_SEED }).filter((p) => !isBlocked(p.E, p.N, blockers));
  m.set(f.id, out);
  return out;
}

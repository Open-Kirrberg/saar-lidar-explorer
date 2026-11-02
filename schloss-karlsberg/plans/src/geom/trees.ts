/**
 * Avenue trees exactly as the 3D site builds them (model/src/site/features.ts): layout
 * avenueTrees() with seed hashString(feature id) ^ model seed (1789), dropped where a tree
 * (± 3 m) falls into a court, terrace, parterre or building footprint. Kept in sync by
 * plans/tests/trees.test.ts.
 */
import { hashString, pointInPolygon } from '../../../model/src/layout/geom.ts';
import { type TreePosition, avenueTrees } from '../../../model/src/layout/site.ts';
import type { EN, SiteSpec, TerrainFeature } from '../../../model/src/spec.ts';

export const MODEL_SEED = 1789;
const BLOCKING = new Set(['court', 'terrace', 'parterre']);

function rings(f: TerrainFeature): EN[][] {
  const g = f.geometry;
  if (g.type === 'Polygon') return [g.coordinates[0]];
  return [];
}

export function treeBlockers(spec: SiteSpec): EN[][] {
  const out: EN[][] = [];
  for (const f of spec.terrain_features) if (BLOCKING.has(f.kind)) out.push(...rings(f));
  for (const b of spec.buildings) if (b.footprint && b.base_h !== null) out.push(b.footprint as EN[]);
  return out;
}

const OFFS = [
  [0, 0],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
];

export function isBlocked(E: number, N: number, blockers: EN[][]): boolean {
  return blockers.some((r) => OFFS.some(([dx, dy]) => pointInPolygon([E + dx, N + dy], r)));
}

const cache = new WeakMap<SiteSpec, Map<string, TreePosition[]>>();

/** Trees of one avenue feature as built in 3D. */
export function builtAvenueTrees(spec: SiteSpec, f: TerrainFeature): TreePosition[] {
  let m = cache.get(spec);
  if (!m) cache.set(spec, (m = new Map()));
  const hit = m.get(f.id);
  if (hit) return hit;
  if (f.kind !== 'avenue' || !f.trees || f.geometry.type !== 'LineString') return [];
  const blockers = treeBlockers(spec);
  const out = avenueTrees(f.geometry.coordinates, f.trees, { seed: hashString(f.id) ^ MODEL_SEED }).filter((p) => !isBlocked(p.E, p.N, blockers));
  m.set(f.id, out);
  return out;
}

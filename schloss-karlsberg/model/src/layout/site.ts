/** Site-level layout helpers (pure): feature centroids, avenue tree positions. */
import type { AvenueTrees, EN, GeoJsonGeometry, SiteSpec, TerrainFeature } from '../spec.ts';
import { AVENUE } from './grammar.ts';
import { centroid, mulberry32, pointAlong, polylineLength } from './geom.ts';

/** Representative EN point of a geometry (polygon centroid, line midpoint, point mean). */
export function geometryCentroid(g: GeoJsonGeometry): EN {
  switch (g.type) {
    case 'Polygon':
      return centroid(g.coordinates[0]) as EN;
    case 'LineString':
      return pointAlong(g.coordinates, polylineLength(g.coordinates) / 2).p as EN;
    case 'MultiPoint': {
      const n = g.coordinates.length;
      return [g.coordinates.reduce((s, p) => s + p[0], 0) / n, g.coordinates.reduce((s, p) => s + p[1], 0) / n];
    }
    case 'Point':
      return [g.coordinates[0], g.coordinates[1]];
  }
}

/**
 * Resolve a Building.court_toward value (EN or terrain-feature / building id) to an EN point;
 * default: the palace grid origin. For line features (avenues, roads) the point of the line
 * nearest to `from` is used, so a building beside a long avenue faces the avenue.
 */
export function resolveCourtToward(spec: SiteSpec, v: EN | string | undefined, from?: EN): EN {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const f = spec.terrain_features.find((x) => x.id === v);
    if (f) return f.geometry.type === 'LineString' && from ? nearestOnLine(f.geometry.coordinates, from) : geometryCentroid(f.geometry);
    const b = spec.buildings.find((x) => x.id === v);
    if (b?.footprint) return centroid(b.footprint) as EN;
  }
  return spec.palace_grid.origin_EN;
}

/** Nearest point on a polyline. */
export function nearestOnLine(line: EN[], p: EN): EN {
  let best: EN = line[0];
  let bd = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    const q: EN = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

export interface TreePosition {
  E: number;
  N: number;
  row: number;
  /** Index along the row. */
  index: number;
}

export interface AvenueOptions {
  seed?: number;
  /** ± jitter in metres (default AVENUE.jitter). */
  jitter?: number;
  /** Skip trees closer than this to the line ends (m), default half a spacing. */
  endClearance?: number;
}

/**
 * Tree positions along an avenue centre line: `rows` rows (2 = one each side at ±row_distance/2;
 * 4 = two per side, inner rows at ±row_distance/6 … outer at ±row_distance/2), `spacing` in the row.
 */
export function avenueTrees(line: EN[], trees: AvenueTrees, opts: AvenueOptions = {}): TreePosition[] {
  const L = polylineLength(line);
  const spacing = trees.spacing || AVENUE.spacing;
  const rd = trees.row_distance ?? AVENUE.rowDistance;
  const rows = Math.max(1, trees.rows);
  const offsets: number[] =
    rows === 1 ? [0] : Array.from({ length: rows }, (_, i) => -rd / 2 + (rd * i) / (rows - 1));
  const rnd = mulberry32(opts.seed ?? 1789);
  const jitter = opts.jitter ?? AVENUE.jitter;
  const clear = opts.endClearance ?? spacing / 2;
  const n = Math.max(0, Math.floor((L - 2 * clear) / spacing + 1e-9) + 1);
  const start = (L - (n - 1) * spacing) / 2;
  const out: TreePosition[] = [];
  for (let i = 0; i < n; i++) {
    const { p, dir } = pointAlong(line, start + i * spacing);
    const nx = -dir[1];
    const ny = dir[0];
    offsets.forEach((off, row) => {
      const j1 = (rnd() * 2 - 1) * jitter;
      const j2 = (rnd() * 2 - 1) * jitter;
      out.push({ E: p[0] + nx * off + dir[0] * j1 + nx * j2, N: p[1] + ny * off + dir[1] * j1 + ny * j2, row, index: i });
    });
  }
  return out;
}

/** Terrain features of a kind. */
export function featuresOfKind(spec: SiteSpec, kind: TerrainFeature['kind']): TerrainFeature[] {
  return spec.terrain_features.filter((f) => f.kind === kind);
}

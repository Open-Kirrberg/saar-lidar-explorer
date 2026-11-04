/**
 * Shared CHM trees around the castle zone (V2.7; zone.json preset `trees: "shared"`, ADR 0017). Pure: no three, no DOM.
 *
 * The explorer streams today's trees (CHM peaks, stable ids). Inside the modelled area (the zone footprint) the castle
 * keeps its own 1789 forest; outside it a shared tree is drawn only where the 1789 land cover is forest (a 2025 tree
 * on a 1789 field or meadow is dropped). Its species is drawn from the 1789 mix by its id (beech / oak / hornbeam,
 * landcover.ts DEFAULT_FOREST_MIX), so a conifer of today becomes a broadleaf of 1789 [I]; its size follows the
 * measured height.
 */
import { mulberry32, pointInPolygon } from '@model/layout/geom.ts';
import { E0, N0 } from '@model/frame.ts';
import { DEFAULT_FOREST_MIX, FOREST_SPECIES, GROUND_CLASS } from './landcover.ts';
import type { ZoneSharedTree } from './zone/api.ts';

export type Ring = readonly (readonly [number, number])[];

export interface SharedTreeSelect {
  /** modelled area as local [x, z] rings (footprintToLocal) */
  footprintLocal: readonly Ring[];
  /** 1789 ground class at local (x, z) (landcover.ts GROUND_CLASS); NaN / −1 outside the terrain */
  groundClassAt(x: number, z: number): number;
}

/** A selected shared tree in the local frame. */
export interface LocalSharedTree {
  id: number;
  x: number;
  z: number;
  /** height above the ground (m) */
  h: number;
  /** crown radius (m) */
  r: number;
}

/** EN ring → local [x, z]. */
export function footprintToLocal(ring: readonly (readonly [number, number])[]): [number, number][] {
  return ring.map(([E, N]) => [E - E0, -(N - N0)] as [number, number]);
}

/** Keep a tree only outside every footprint ring and on a 1789 forest cell. */
export function selectSharedTrees(trees: readonly ZoneSharedTree[], o: SharedTreeSelect): LocalSharedTree[] {
  const out: LocalSharedTree[] = [];
  for (const t of trees) {
    if (!Number.isFinite(t.E) || !Number.isFinite(t.N) || !(t.h > 0)) continue;
    const x = t.E - E0;
    const z = -(t.N - N0);
    if (o.footprintLocal.some((r) => r.length >= 3 && pointInPolygon([x, z], r as [number, number][]))) continue;
    if (o.groundClassAt(x, z) !== GROUND_CLASS.forest) continue;
    out.push({ id: t.id, x, z, h: t.h, r: t.r });
  }
  return out;
}

/** Species of a shared tree from its stable id, by the shares of the 1789 mix. */
export function sharedSpecies(id: number, mix: readonly { species: string; share: number }[] = DEFAULT_FOREST_MIX): string {
  const total = mix.reduce((a, m) => a + m.share, 0);
  let u = mulberry32((id ^ 0x1789) >>> 0)() * total;
  for (const m of mix) {
    u -= m.share;
    if (u < 0) return m.species;
  }
  return mix[mix.length - 1].species;
}

/** Height scale of a shared tree (1 = the species height), clamped to the forest's range. */
export function sharedScale(species: string, h: number): number {
  const sp = FOREST_SPECIES[species] ?? FOREST_SPECIES.fagus;
  return Math.max(0.35, Math.min(1.6, h / sp.height));
}

/** EN bounding box of the terrain crop around the footprint, for `ZoneTreeSource.treesIn`. */
export function treeBbox(grid: { west: number; east: number; south: number; north: number }): [[number, number], [number, number]] {
  return [
    [grid.west, grid.south],
    [grid.east, grid.north],
  ];
}

/** Ground class lookup on the terrain's class grid (cell centres, north-up rows). */
export function groundClassLookup(ground: ArrayLike<number>, g: { cols: number; rows: number; cell: number }, grid: { west: number; north: number }): (x: number, z: number) => number {
  return (x, z) => {
    const c = Math.floor((x + E0 - grid.west) / g.cell);
    const r = Math.floor((grid.north - (N0 - z)) / g.cell);
    return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : ground[r * g.cols + c];
  };
}

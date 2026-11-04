/**
 * Castle zone geometry from the catalogue (no hand-placed numbers): footprint, the Ehrenhof portal and spawn.
 * Pure apart from three being pulled in by the layout's context module; no fs.
 *
 *   portal: on the palace axis west of the Ehrenhofgitter (KB-B39), PORTAL_OUTSIDE_GATE_M outside the gate or at
 *           the footprint edge if that is further out, facing the visitor coming from the west (axis azimuth + 180°)
 *   spawn:  on the axis SPAWN_INSIDE_GATE_M inside the gate, eye height above the Ehrenhof (TF-01) level,
 *           looking along the axis towards the Corps de logis
 */
import { gridFrame, type EN, type SiteSpec } from '../../model/src/index.ts';
import type { Building } from '../../model/src/spec.ts';
import type { BuildingLayout } from '../../model/src/layout/building.ts';
import { DEFAULT_BUILD_OPTIONS } from '../../model/src/context.ts';
import { siteBuildings, siteFeatures } from '../../model/src/site/access.ts';
import {
  type Crop,
  type FootprintGeom,
  type FootprintOptions,
  type FootprintResult,
  pointInRing,
  zoneFootprint,
} from './footprint.ts';

/** The castle terrain crop (scripts/prepare-terrain.py WEST/EAST/SOUTH/NORTH; viewer/public/terrain/meta.json grid). */
export const CASTLE_CROP: Readonly<Crop> = { west: 381150, south: 5464500, east: 383300, north: 5467150 };

/**
 * Footprint parameters. `close` = 125 m merges nearby parts but keeps the ~330 m wide open approach west of the
 * Ehrenhof outside; the remaining islands (farms, Karlslust) are joined by MST corridors. `clearance` / `grow` bound
 * how far the 64-vertex simplification may cut towards placed geometry (≥ 10 m) or bulge into open land (≤ 60 m).
 */
export const CASTLE_FOOTPRINT: Readonly<Omit<FootprintOptions, 'crop'>> = {
  buffer: 20,
  close: 125,
  cell: 5,
  inset: 5,
  maxVertices: 64,
  clearance: 10,
  grow: 60,
};

export const ENTRY_GATE_ID = 'KB-B39';
export const ENTRY_COURT_ID = 'TF-01';
export const PORTAL_OUTSIDE_GATE_M = 60;
export const SPAWN_INSIDE_GATE_M = 6;
export const PORTAL_RADIUS_M = 250;
export const SPAWN_PITCH_DEG = 2;
/** Walk-mode eye height (m); = viewer/src/controls.ts EYE (a test keeps them equal; not imported: that module pulls in three). */
export const WALK_EYE_M = 1.65;

export const round1 = (v: number): number => Math.round(v * 10) / 10 + 0;
export const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const norm360 = (d: number): number => ((d % 360) + 360) % 360;

/** Everything the generator places in the scene year: building outlines + terrain-feature geometries. */
export function castleGeoms(spec: SiteSpec, layout: (b: Building) => BuildingLayout): FootprintGeom[] {
  const out: FootprintGeom[] = [];
  for (const b of siteBuildings(spec, { options: DEFAULT_BUILD_OPTIONS })) out.push({ kind: 'ring', pts: layout(b).ring as EN[] });
  for (const f of siteFeatures(spec, DEFAULT_BUILD_OPTIONS.year)) {
    const g = f.geometry;
    if (g.type === 'Polygon') out.push({ kind: 'ring', pts: g.coordinates[0]! });
    else if (g.type === 'LineString') out.push({ kind: 'line', pts: g.coordinates });
    else if (g.type === 'MultiPoint') out.push({ kind: 'point', pts: g.coordinates });
    else out.push({ kind: 'point', pts: [g.coordinates] });
  }
  return out;
}

export function castleFootprint(spec: SiteSpec, layout: (b: Building) => BuildingLayout): FootprintResult {
  return zoneFootprint(castleGeoms(spec, layout), { ...CASTLE_FOOTPRINT, crop: CASTLE_CROP });
}

export interface EntryPose {
  /** Palace grid u of the gate centre on the axis (m). */
  gateU: number;
  axisDeg: number;
  /** Distance of the portal west of the gate along the axis (m). */
  portalOffset: number;
  portal: { E: number; N: number; facing_deg: number };
  spawn: { E: number; N: number; h: number; heading_deg: number; pitch_deg: number };
}

/**
 * Where the palace axis, walked west from the gate, first leaves `ring` (distance from the gate in m), or 0 if the
 * gate is not inside the ring.
 */
export function axisExit(spec: SiteSpec, gateU: number, ring: readonly EN[]): number {
  const g = gridFrame(spec.palace_grid);
  if (!pointInRing(g.toEN(gateU, 0), ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ua, va] = g.toUV(ring[i]![0], ring[i]![1]);
    const [ub, vb] = g.toUV(ring[(i + 1) % ring.length]![0], ring[(i + 1) % ring.length]![1]);
    if (va === vb || (va > 0) === (vb > 0)) continue; // edge does not cross v = 0
    const u = ua + ((ub - ua) * (0 - va)) / (vb - va);
    if (u <= gateU) best = Math.min(best, gateU - u);
  }
  if (!Number.isFinite(best)) throw new Error('palace axis never leaves the footprint west of the gate');
  return best;
}

/**
 * Portal and spawn on the palace axis around the Ehrenhof gate. `eye`: walk-mode eye height (viewer controls EYE).
 * With `ring` the portal moves out to where the axis leaves the footprint if that is further than
 * PORTAL_OUTSIDE_GATE_M, so it is never inside the zone (contract: portals sit in the overworld).
 */
export function castleEntry(spec: SiteSpec, eye: number, ring?: readonly EN[]): EntryPose {
  const g = gridFrame(spec.palace_grid);
  const gate = spec.buildings.find((b) => b.id === ENTRY_GATE_ID);
  const line = gate?.line;
  if (!line || line.length < 2) throw new Error(`${ENTRY_GATE_ID}: no gate line in the catalogue`);
  // where the gate line crosses the axis (v = 0)
  const [ua, va] = g.toUV(line[0]![0], line[0]![1]);
  const [ub, vb] = g.toUV(line[line.length - 1]![0], line[line.length - 1]![1]);
  if (Math.sign(va) === Math.sign(vb)) throw new Error(`${ENTRY_GATE_ID}: gate line does not cross the palace axis`);
  const gateU = ua + ((ub - ua) * (0 - va)) / (vb - va);
  const court = spec.terrain_features.find((f) => f.id === ENTRY_COURT_ID);
  if (court?.level === undefined) throw new Error(`${ENTRY_COURT_ID}: no court level`);
  const axisDeg = spec.palace_grid.u_azimuth_grid_deg;
  let offset = Math.max(PORTAL_OUTSIDE_GATE_M, ring ? axisExit(spec, gateU, ring) : 0);
  const portalAt = (d: number): EN => {
    const [E, N] = g.toEN(gateU - d, 0);
    return [round1(E), round1(N)];
  };
  // 0.1 m rounding may pull an on-edge portal back inside: step out in 0.1 m until it is not
  while (ring && pointInRing(portalAt(offset), ring)) offset += 0.1;
  const [pE, pN] = portalAt(offset);
  const [sE, sN] = g.toEN(gateU + SPAWN_INSIDE_GATE_M, 0);
  return {
    gateU,
    axisDeg,
    portalOffset: offset,
    portal: { E: pE, N: pN, facing_deg: norm360(axisDeg + 180) },
    spawn: { E: round1(sE), N: round1(sN), h: round2(court.level + eye), heading_deg: axisDeg, pitch_deg: SPAWN_PITCH_DEG },
  };
}

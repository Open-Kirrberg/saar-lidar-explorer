/**
 * Shared helpers of the catalogue v2 build (scripts/catalogue-v2/build.ts).
 * Pure functions plus file loaders; nothing here writes files.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gridFrame, type GridFrame } from '../../model/src/frame.ts';
import { closeRing, ensureCCW, minAreaRect, openRing, signedArea, type P2 } from '../../model/src/layout/geom.ts';
import type { EN, GeoJsonGeometry, GroundDtm, PalaceGrid, RingEN } from '../../model/src/spec.ts';

export const ROOT = resolve(import.meta.dirname, '..', '..');

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const rEN = (p: P2): EN => [r2(p[0]), r2(p[1])];

/** Closed CCW ring, rounded to 1 cm. */
export function ring(pts: P2[]): RingEN {
  return closeRing(ensureCCW(openRing(pts.map(rEN))));
}

export function ringArea(r: RingEN): number {
  return Math.abs(signedArea(openRing(r)));
}

/** Rectangle in the palace grid (u0..u1, v0..v1) as a closed CCW EN ring. */
export function uvRect(g: GridFrame, u0: number, u1: number, v0: number, v1: number): RingEN {
  return ring([g.toEN(u0, v0), g.toEN(u1, v0), g.toEN(u1, v1), g.toEN(u0, v1)]);
}

/** Minimum-area rectangle around a ring (closed, CCW) + its rectangularity (ring area / rect area). */
export function minRect(r: RingEN): { ring: RingEN; rectangularity: number; length: number; width: number } {
  const pts = openRing(r);
  const ref: P2 = [pts[0][0], pts[0][1]];
  const rel = pts.map((p) => [p[0] - ref[0], p[1] - ref[1]] as P2);
  const m = minAreaRect(rel);
  const [ax, ay] = m.axis;
  const [cx, cy] = m.centre;
  const hl = m.length / 2;
  const hw = m.width / 2;
  const nx = -ay;
  const ny = ax;
  const corners: P2[] = [
    [cx - ax * hl - nx * hw, cy - ay * hl - ny * hw],
    [cx + ax * hl - nx * hw, cy + ay * hl - ny * hw],
    [cx + ax * hl + nx * hw, cy + ay * hl + ny * hw],
    [cx - ax * hl + nx * hw, cy - ay * hl + ny * hw],
  ].map((p) => [p[0] + ref[0], p[1] + ref[1]] as P2);
  return { ring: ring(corners), rectangularity: ringArea(r) / m.area, length: m.length, width: m.width };
}

export function ringHash(r: RingEN | EN[]): string {
  return createHash('sha1').update(JSON.stringify(r)).digest('hex').slice(0, 12);
}

export function palaceGrid(pg: PalaceGrid): GridFrame {
  return gridFrame(pg);
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export interface Lp06Building {
  plan_no: string;
  name_de: string;
  transform: string;
  rings: RingEN[];
}

/**
 * LP06 footprints (2006 Lageplan, schloss-carlsberg.de, CC BY-SA 2.0 DE - derived coordinates,
 * research/07 Appendix A). Parsed from the committed markdown so there is one copy of the data.
 */
export function loadLp06(): Map<string, Lp06Building> {
  const md = readFileSync(resolve(ROOT, 'research/07-period-sources.md'), 'utf8');
  const out = new Map<string, Lp06Building>();
  for (const line of md.split('\n')) {
    if (!line.startsWith('{"plan_no"')) continue;
    const o = JSON.parse(line) as { plan_no: string; name_de: string; transform: string; rings: [number, number][][] };
    out.set(o.plan_no, { plan_no: o.plan_no, name_de: o.name_de, transform: o.transform, rings: o.rings.map((r) => ring(r)) });
  }
  if (out.size < 50) throw new Error(`LP06 appendix: only ${out.size} plan buildings parsed`);
  return out;
}

export interface LidarFeature {
  id: string;
  geometry: GeoJsonGeometry;
  props: Record<string, unknown>;
}

export function loadLidarFeatures(): Map<string, LidarFeature> {
  const g = JSON.parse(readFileSync(resolve(ROOT, 'research/lidar_features.geojson'), 'utf8')) as {
    features: { properties: Record<string, unknown>; geometry: GeoJsonGeometry }[];
  };
  const out = new Map<string, LidarFeature>();
  for (const f of g.features) out.set(String(f.properties.id), { id: String(f.properties.id), geometry: f.geometry, props: f.properties });
  return out;
}

export interface DtmSample extends GroundDtm {
  hash: string;
}

/** DTM statistics written by sample_dtm.py (model/v2/dtm-samples.json); empty on the first pass. */
export function loadDtmSamples(): Map<string, DtmSample> {
  const p = resolve(ROOT, 'model/v2/dtm-samples.json');
  if (!existsSync(p)) return new Map();
  const o = JSON.parse(readFileSync(p, 'utf8')) as { samples: Record<string, DtmSample> };
  return new Map(Object.entries(o.samples));
}

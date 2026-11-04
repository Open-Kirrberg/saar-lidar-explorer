// The castle's committed zone manifest (zones/schloss-karlsberg/zone.json, generated geometry via its export:zone)
// against the app's strict validator and the portal / spawn rules of docs/zone-contract.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseZoneManifest, validateZoneStrict } from '../src/zones/contract';
import type { EN } from '../src/zones/contract';
import { normaliseRing, pointInRing } from '../src/zones/geometry';
import { zoneModuleNames } from '../src/zones/runtime/modules';

const CASTLE = join(import.meta.dirname, '../../zones/schloss-karlsberg');
const raw = JSON.parse(readFileSync(join(CASTLE, 'zone.json'), 'utf8'));
const axisDeg: number = JSON.parse(readFileSync(join(CASTLE, 'model/catalogue.json'), 'utf8')).palace_grid.u_azimuth_grid_deg;
/** The app build's registry (src/zones/runtime/modules.ts): the castle must be in it. */
const modules = zoneModuleNames();

/** Horizontal distance from p to the nearest ring edge. */
function distToEdge([E, N]: EN, ring: readonly EN[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((E - ax) * (bx - ax) + (N - ay) * (by - ay)) / l2)) : 0;
    d = Math.min(d, Math.hypot(E - (ax + t * (bx - ax)), N - (ay + t * (by - ay))));
  }
  return d;
}

describe('zones/schloss-karlsberg/zone.json', () => {
  const m = parseZoneManifest(raw, { modules }).value!;

  it('passes the strict validator with the castle module registered (ADR 0040: no triangle waiver)', () => {
    expect(validateZoneStrict(raw, { modules })).toEqual([]);
    expect(m.budget!.triangles).toBeLessThanOrEqual(1_500_000);
    expect(m.runtime).toEqual({ kind: 'module', module: 'schloss-karlsberg' });
    expect(m.kind).toBe('reconstructed');
    expect(m.evidence.kind).toBe('hypothesis');
  });

  it('is absent when the module is not registered', () => {
    expect(parseZoneManifest(raw, { modules: new Set(['other']) }).value).toBeNull();
  });

  it('spawns inside the footprint; the portal stands outside or on its edge, within its radius of the spawn', () => {
    const ring = normaliseRing(m.footprint)!;
    expect(m.portals).toHaveLength(1);
    const p = m.portals[0]!;
    const s = m.spawns[p.spawn]!;
    expect(pointInRing(s.E, s.N, ring)).toBe(true);
    expect(!pointInRing(p.E, p.N, ring) || distToEdge([p.E, p.N], ring) < 0.5).toBe(true);
    expect(Math.hypot(p.E - s.E, p.N - s.N)).toBeLessThanOrEqual(p.radius_m);
    expect(s.mode).toBe('gehen');
  });

  it('faces the visitor coming along the palace axis', () => {
    const p = m.portals[0]!;
    expect(p.facing_deg).toBeCloseTo((axisDeg + 180) % 360, 9);
    expect(m.spawns[p.spawn]!.heading_deg).toBeCloseTo(axisDeg, 9);
  });

  it('credits Lageplan 2006, LVGL, Poly Haven and HYG, one source per entry without ";"', () => {
    for (const s of ['Lageplan 2006', 'LVGL', 'Poly Haven', 'HYG']) expect(m.attribution.some((a) => a.includes(s))).toBe(true);
    for (const a of m.attribution) expect(a).not.toContain(';');
  });
});

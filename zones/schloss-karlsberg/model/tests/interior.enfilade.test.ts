import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS } from '../src/context.ts';
import { layoutBuilding } from '../src/layout/index.ts';
import { interiorModel } from '../src/interior/model.ts';
import { enfiladeSpread } from '../src/interior/openings.ts';
import { blocksDoor, doorZones } from '../src/interior/programme.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const model = (id: string) => {
  const b = spec.buildings.find((x) => x.id === id)!;
  return interiorModel(b, layoutBuilding(b, spec), DEFAULT_BUILD_OPTIONS.seed);
};

describe('enfilade alignment (Corps de logis, OG)', () => {
  const m = model('KB-B01');
  const OG = 2;

  it('the state doors lie on one line from the Kabinett to the Wintergarten', () => {
    const lines = enfiladeSpread(m.openings, OG).filter((l) => l.doors >= 3);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const l of lines) expect(l.spread).toBeLessThan(0.02);
    const main = lines.sort((a, b) => b.doors - a.doors)[0];
    expect(main.doors).toBeGreaterThanOrEqual(4);
  });

  it('partition doors sit on piers, between the window axes', () => {
    const windows = m.openings.filter((o) => o.facade && o.storey === OG && Math.abs(o.dir[0]) > 0.98);
    const doors = m.openings.filter((o) => o.kind === 'double_door' && o.storey === OG && Math.abs(o.dir[1]) > 0.98);
    expect(windows.length).toBeGreaterThan(10);
    expect(doors.length).toBeGreaterThanOrEqual(4);
    for (const d of doors) {
      const gap = Math.min(...windows.map((w) => Math.abs(w.centre[0] - d.centre[0]) - w.width / 2));
      expect(gap, d.id).toBeGreaterThan(0.3);
    }
  });

  it('every interior door of a room cuts its wall, and facade reveals match the exterior openings', () => {
    for (const r of m.rooms) {
      for (const w of r.walls) {
        for (const h of w.hits) {
          expect(h.hole.u1 - h.hole.u0).toBeCloseTo(Math.min(h.opening.width, w.len), 1);
          if (h.opening.facade) expect(h.depth).toBeLessThanOrEqual(1.45);
        }
      }
    }
    // a garden window of the Festsaal hits exactly one wall of the Festsaal
    const fest = m.rooms.find((r) => r.room.id === 'B01.2.og-festsaal')!;
    const pf = m.openings.filter((o) => o.kind === 'porte_fenetre' && o.storey === OG && Math.abs(o.centre[0]) < 3.5);
    expect(pf.length).toBe(3);
    const hits = fest.walls.flatMap((w) => w.hits).filter((h) => h.opening.kind === 'porte_fenetre');
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});

describe('furnishing keeps doors free', () => {
  for (const id of ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B10']) {
    it(`${id}: no floor item stands in a door approach`, () => {
      const m = model(id);
      for (const r of m.rooms) {
        const zones = doorZones(r.walls);
        // the alcove / dais are walkable platforms (doors inside the alcove are reached through
        // the balustrade gate); vestibule columns stand between the doors by design
        const walkable = new Set(['column', 'alcove', 'dais']);
        const bad = r.items.filter((it) => !walkable.has(it.kind) && blocksDoor(it, zones));
        expect(bad.map((it) => `${r.room.id}:${it.kind}`)).toEqual([]);
      }
    });
  }
});

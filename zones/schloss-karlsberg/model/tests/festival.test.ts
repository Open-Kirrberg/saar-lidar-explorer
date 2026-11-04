import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { enToLocal } from '../src/frame.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { distanceToRing, festRotundaRings, festivalCounts, festivalLamps, ringPoints } from '../src/layout/festival.ts';
import { pointInPolygon } from '../src/layout/geom.ts';
import { FESTIVAL } from '../src/layout/grammar.ts';
import { isPlaced } from '../src/spec.ts';
import { readCatalogue } from './helpers.ts';

const { spec } = loadSite(readCatalogue());
const layouts = spec.buildings.filter(isPlaced).map((b) => layoutBuilding(b, spec));

describe('KB-I48 Festbeleuchtung placement (layout/festival.ts)', () => {
  it('ringPoints walks a square at the spacing with outward normals, both windings', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    for (const ring of [sq, [...sq].reverse()]) {
      const pts = ringPoints(ring, 2.5, 1);
      expect(pts.length).toBe(16);
      for (const { p, n } of pts) {
        // offset 1 m outward: every point lies outside, 1 m from the square
        expect(pointInPolygon(p, sq)).toBe(false);
        expect(distanceToRing(p, sq)).toBeCloseTo(1, 6);
        expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 9);
      }
      // inward: inside (a corner point lands on the neighbouring edge)
      for (const { p } of ringPoints(ring, 2.5, -1)) expect(pointInPolygon(p, sq) || distanceToRing(p, sq) < 1e-9).toBe(true);
    }
  });

  it('is deterministic and places lamps on every line of the arrangement', () => {
    const a = festivalLamps(spec, layouts);
    const b = festivalLamps(spec, layouts);
    expect(b).toEqual(a);
    const c = festivalCounts(a);
    console.info('[festival] lamps', a.length, JSON.stringify(c));
    expect(c.cornice).toBeGreaterThan(300);
    expect(c.sill).toBeGreaterThan(300);
    // the dense rotunda rings belong to the 1785 fête (KB-B13), not to the 1789 scene
    expect(c.rotunda).toBe(0);
    expect(c.court).toBeGreaterThan(8);
    expect(c.parterre).toBeGreaterThan(40);
    expect(c.rim).toBeGreaterThan(10);
    // cheap enough to draw as one instanced set
    expect(a.length).toBeLessThan(8000);
  });

  it('keeps flames warm (1800-1900 K) with finite positions and unit normals', () => {
    for (const l of festivalLamps(spec, layouts)) {
      expect(l.kelvin).toBeGreaterThanOrEqual(FESTIVAL.kelvin[0]);
      expect(l.kelvin).toBeLessThanOrEqual(FESTIVAL.kelvin[1]);
      expect(l.p.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...l.n)).toBeCloseTo(1, 6);
      if (l.wall) expect(Math.hypot(...l.wall)).toBeCloseTo(1, 6);
    }
  });

  it('cornice lamps sit on the eaves and just outside their own wall, never inside another building', () => {
    const lamps = festivalLamps(spec, layouts);
    const byId = new Map(layouts.map((L) => [L.id, L]));
    const rings = layouts.map((L) => ({ id: L.id, ring: L.ring.map((p) => [p[0], p[1]] as [number, number]) }));
    for (const l of lamps.filter((x) => x.group === 'cornice')) {
      const L = byId.get(l.src)!;
      expect(l.p[1]).toBeCloseTo(L.stack.eaves_h + FESTIVAL.cornice.lift, 6);
      const en: [number, number] = [l.p[0] + 381000, -l.p[2] + 5465000];
      expect(pointInPolygon(en, rings.find((r) => r.id === l.src)!.ring)).toBe(false);
      expect(distanceToRing(en, rings.find((r) => r.id === l.src)!.ring)).toBeLessThan(1.0);
      for (const r of rings) if (r.id !== l.src) expect(pointInPolygon(en, r.ring), `${l.src} lamp inside ${r.id}`).toBe(false);
    }
  });

  it('court pots stay inside the Ehrenhof and clear of the building faces', () => {
    const court = spec.terrain_features.find((t) => t.id === 'TF-01')!;
    const ring = (court.geometry as { coordinates: [number, number][][] }).coordinates[0];
    const pots = festivalLamps(spec, layouts).filter((l) => l.group === 'court');
    for (const l of pots) {
      expect(l.kind).toBe('pot');
      const en: [number, number] = [l.p[0] + 381000, -l.p[2] + 5465000];
      expect(pointInPolygon(en, ring)).toBe(true);
      expect(l.p[1]).toBeCloseTo((court.level ?? 0) + FESTIVAL.court.height, 6);
    }
  });

  it('the 1785 rotunda KB-B13 is lit only in a 1785 scene year (inEpoch)', () => {
    const b13 = spec.buildings.find((b) => b.id === 'KB-B13');
    if (!b13 || !isPlaced(b13)) return;
    expect(festivalLamps(spec, layouts).some((l) => l.src === 'KB-B13')).toBe(false);
    expect(festivalLamps(spec, layouts, { year: 1785 }).some((l) => l.src === 'KB-B13')).toBe(true);
  });

  it('the dense rotunda rings apply only to the 1785 event building in its year (wave-8 review)', () => {
    const ev = FESTIVAL.rotunda.event;
    for (const b of spec.buildings) {
      for (const year of [1785, 1789]) {
        // rings only where the building's epoch contains the event year and the scene is that year
        if (festRotundaRings(b, year)) {
          expect(year).toBe(ev.year);
          expect(ev.buildings).toContain(b.id);
          expect(!b.epoch || ((b.epoch.from ?? -Infinity) <= ev.year && ev.year <= (b.epoch.to ?? Infinity))).toBe(true);
        }
      }
    }
    expect(festRotundaRings({ id: 'KB-B07' }, 1789)).toBe(false);
    expect(festRotundaRings({ id: 'KB-B07' }, 1785)).toBe(false);
    expect(festRotundaRings({ id: 'KB-B13', epoch: { from: 1785, to: 1785 } }, 1789)).toBe(false);
    expect(festRotundaRings({ id: 'KB-B13', epoch: { from: 1785, to: 1785 } }, 1785)).toBe(true);
    expect(festRotundaRings({ id: 'KB-B13', epoch: { from: 1786 } }, 1785)).toBe(false);
    // 1789: the Tempelzimmer KB-B07 gets the ordinary cornice line and door lampions, no rings
    const l89 = festivalLamps(spec, layouts).filter((l) => l.src === 'KB-B07');
    if (layouts.some((L) => L.id === 'KB-B07')) {
      expect(l89.some((l) => l.group === 'rotunda')).toBe(false);
      expect(l89.some((l) => l.group === 'cornice')).toBe(true);
      expect(l89.some((l) => l.group === 'sill')).toBe(true);
    }
    // 1785: only the event building carries rings
    const l85 = festivalLamps(spec, layouts, { year: 1785 }).filter((l) => l.group === 'rotunda');
    for (const l of l85) expect(ev.buildings).toContain(l.src);
    if (layouts.some((L) => L.id === 'KB-B13' && L.building.placement !== 'hypothetical')) expect(l85.length).toBeGreaterThan(40);
    // and none of them on the 1789 Tempelzimmer
    expect(l85.some((l) => l.src === 'KB-B07')).toBe(false);
  });

  it('local frame: a lamp converted back lands on its catalogue coordinates', () => {
    const l = festivalLamps(spec, layouts)[0];
    const back = enToLocal(l.p[0] + 381000, -l.p[2] + 5465000, l.p[1]);
    expect(back.x).toBeCloseTo(l.p[0], 6);
    expect(back.z).toBeCloseTo(l.p[2], 6);
  });
});

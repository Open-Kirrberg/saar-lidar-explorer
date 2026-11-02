import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { layoutBuilding, lineFootprint } from '../src/layout/building.ts';
import { polylineLength } from '../src/layout/geom.ts';
import { INTERIOR_DOOR, PARTITION_WALL } from '../src/layout/grammar.ts';
import { axisSCoordinates, enfiladeDoors, enfiladeRooms, pileBands, rectST, roomArea, widthsBetweenAxes } from '../src/layout/rooms.ts';
import { avenueTrees, geometryCentroid, nearestOnLine } from '../src/layout/site.ts';
import { stairRun } from '../src/layout/stairs.ts';
import { isPlaced, type EN } from '../src/spec.ts';
import { readCatalogueV1 } from './helpers.ts';

const { spec } = loadSite(readCatalogueV1());

describe('rooms', () => {
  it('pileBands: CdL double pile with a 6 m court pile (research/05 §e.1)', () => {
    const p = pileBands(18, { outerWall: 1.0, spineWall: 0.6, courtPileClear: 6 });
    expect(p.map((b) => b.name)).toEqual(['garden', 'court']);
    expect(p[1].t1 - p[1].t0).toBeCloseTo(6, 9);
    expect(p[0].t1 - p[0].t0).toBeCloseTo(18 - 2 - 0.6 - 6, 9);
    expect(p[1].t0 - p[0].t1).toBeCloseTo(0.6, 9); // spine
    const c = pileBands(14, { outerWall: 0.7, layout: 'double_corridor', corridorClear: 2.2 });
    expect(c.map((b) => b.name)).toEqual(['garden', 'corridor', 'court']);
    expect(c[1].t1 - c[1].t0).toBeCloseTo(2.2, 9);
    expect(() => pileBands(5, { outerWall: 1, courtPileClear: 4 })).toThrow();
  });

  it('enfiladeRooms lays rooms edge to edge with partitions', () => {
    const band = { t0: -8, t1: 1 };
    const { rooms, partitions, end } = enfiladeRooms({
      storey: 2,
      s0: -38,
      direction: 1,
      band,
      items: [
        { id: 'A', name_de: 'Antichambre', width: 8, tag: 'N' },
        { id: 'B', name_de: 'Audienzzimmer', width: 8, tag: 'N' },
        { id: 'C', name_de: 'Paradeschlafzimmer', width: 9, tag: 'N' },
      ],
    });
    expect(rooms.map((r) => roomArea(r))).toEqual([72, 72, 81]);
    expect(partitions.map((p) => p.between)).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ]);
    expect(partitions[0].s).toBeCloseTo(-30 + PARTITION_WALL / 2, 9);
    expect(end).toBeCloseTo(-38 + 25 + 2 * PARTITION_WALL, 9);
    expect(rooms[1].polygon[0][0]).toBeCloseTo(-30 + PARTITION_WALL, 9);
    // direction −1 mirrors
    const m = enfiladeRooms({ storey: 2, s0: 38, direction: -1, band, items: [{ id: 'X', name_de: 'X', width: 5, tag: 'N' }] });
    expect(m.rooms[0].polygon[0][0]).toBeCloseTo(33, 9);
  });

  it('enfiladeDoors are aligned on one line near the window wall', () => {
    const band = { t0: -8, t1: 1 };
    const { partitions } = enfiladeRooms({
      storey: 2,
      s0: 0,
      direction: 1,
      band,
      items: ['A', 'B', 'C', 'D'].map((id) => ({ id, name_de: id, width: 8, tag: 'N' })),
    });
    const doors = enfiladeDoors(partitions, { storey: 2, windowWallT: -8, into: 1 });
    expect(doors).toHaveLength(3);
    const lineT = doors.map((d) => (d.wall.kind === 'segment' ? d.wall.p0[1] + d.a : NaN));
    for (const t of lineT) expect(t).toBeCloseTo(-8 + INTERIOR_DOOR.offsetFromWindowWall + INTERIOR_DOOR.enfilade.width / 2, 9);
    for (const d of doors) {
      expect(d.kind).toBe('double_door');
      expect(d.a - d.width / 2).toBeGreaterThan(0);
      expect(d.a + d.width / 2).toBeLessThan(band.t1 - band.t0);
    }
  });

  it('widthsBetweenAxes puts partitions on pier centres', () => {
    const L = layoutBuilding(spec.buildings.find((b) => b.id === 'KB-B01')!, spec);
    const g = L.sides.garden;
    const s = axisSCoordinates(g.bays.map((b) => b.a), 'garden', L.frame.length);
    expect(s[0]).toBeLessThan(s[1]);
    const s0 = -L.frame.length / 2 + 1.0;
    const s1 = L.frame.length / 2 - 1.0;
    const counts = [2, 2, 2, 7, 2, 2, 2];
    const w = widthsBetweenAxes(s, counts, s0, s1);
    const sum = w.reduce((a, b) => a + b, 0) + (counts.length - 1) * PARTITION_WALL;
    expect(sum).toBeCloseTo(s1 - s0, 9);
    // first partition centre = midpoint between axis 1 and 2
    expect(s0 + w[0] + PARTITION_WALL / 2).toBeCloseTo((s[1] + s[2]) / 2, 9);
    expect(() => widthsBetweenAxes(s, [1, 2], s0, s1)).toThrow();
    expect(roomArea({ polygon: rectST(2, 0, 3, 0) })).toBe(6);
  });
});

describe('stairs', () => {
  it('Blondel 2R + T = 0.65 for every class; Freitreppe of the CdL plinth', () => {
    for (const cls of ['prunk', 'secondary', 'service', 'freitreppe'] as const) {
      const r = stairRun(4.8, cls);
      expect(r.blondel).toBeCloseTo(0.65, 9);
      expect(r.risers * r.riser).toBeCloseTo(4.8, 9);
    }
    const p = stairRun(4.8, 'prunk');
    expect(p.riser).toBeLessThanOrEqual(0.14 + 1e-9);
    expect(p.tread).toBeGreaterThanOrEqual(0.36);
    expect(p.landings).toBe(2);
    const f = stairRun(1.2, 'freitreppe');
    expect(f.risers).toBe(9);
    expect(f.landings).toBe(0);
    expect(stairRun(0, 'service').risers).toBe(0);
  });
});

describe('site helpers', () => {
  it('avenueTrees: two rows at ±row_distance/2, spacing along the line, deterministic', () => {
    const tf = spec.terrain_features.find((f) => f.id === 'TF-11')!;
    const line = tf.geometry.coordinates as EN[];
    const t = avenueTrees(line, tf.trees!, { jitter: 0 });
    const L = polylineLength(line);
    const n = Math.floor((L - 7) / 7 + 1e-9) + 1;
    expect(t).toHaveLength(2 * n);
    const r0 = t.filter((x) => x.row === 0);
    expect(Math.hypot(r0[1].E - r0[0].E, r0[1].N - r0[0].N)).toBeCloseTo(7, 6);
    const pair = t.filter((x) => x.index === 0);
    expect(Math.hypot(pair[1].E - pair[0].E, pair[1].N - pair[0].N)).toBeCloseTo(16, 6);
    expect(avenueTrees(line, tf.trees!, { seed: 5 })).toEqual(avenueTrees(line, tf.trees!, { seed: 5 }));
  });

  it('nearestOnLine and geometryCentroid', () => {
    expect(nearestOnLine([[0, 0], [10, 0]], [3, 5])).toEqual([3, 0]);
    expect(nearestOnLine([[0, 0], [10, 0]], [15, 5])).toEqual([10, 0]);
    expect(geometryCentroid({ type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] })).toEqual([2, 1]);
    expect(geometryCentroid({ type: 'LineString', coordinates: [[0, 0], [10, 0]] })).toEqual([5, 0]);
  });
});

describe('layoutBuilding over the whole catalogue', () => {
  it('lays out every placed building; WALL uses its centre line', () => {
    const placed = spec.buildings.filter(isPlaced);
    expect(placed).toHaveLength(29);
    for (const b of placed) {
      const L = layoutBuilding(b, spec);
      expect(L.stack.eaves_h).toBeGreaterThan(L.stack.base_h - 1e-9);
      expect(L.roof.ridge_h).toBeGreaterThanOrEqual(L.stack.eaves_h - 1e-9);
      if (b.roof.ridge_h !== undefined) expect(L.roof.ridge_h, b.id).toBeCloseTo(b.roof.ridge_h, 2);
    }
    const wall = layoutBuilding(spec.buildings.find((b) => b.id === 'KB-B14')!, spec);
    expect(wall.frame.length).toBeCloseTo(81, 0);
    expect(wall.stack.eaves_h).toBeCloseTo(335.1 + 5.6, 9);
    expect(lineFootprint([[0, 0], [10, 0]], 1)).toEqual([[0, -0.5], [10, -0.5], [10, 0.5], [0, 0.5], [0, -0.5]]);
  });

  it('CdL raised centre covers the 7-axis Louisenhof core (v −14.4…+14.4)', () => {
    const L = layoutBuilding(spec.buildings.find((b) => b.id === 'KB-B01')!, spec);
    expect(L.raised).toHaveLength(1);
    expect(L.raised[0].s1 - L.raised[0].s0).toBeCloseTo(7 * 4.1, 1);
    expect((L.raised[0].s0 + L.raised[0].s1) / 2).toBeCloseTo(0, 0);
  });

  it('enwp-gabled variant turns wing mansards into hipped roofs but keeps the CdL mansard', () => {
    const wing = layoutBuilding(spec.buildings.find((b) => b.id === 'KB-B02')!, spec, { roofVariant: 'enwp-gabled' });
    expect(wing.roof.type).toBe('hip');
    expect(wing.roof.pitch_lower).toBeCloseTo(45, 9);
    const cdl = layoutBuilding(spec.buildings.find((b) => b.id === 'KB-B01')!, spec, { roofVariant: 'enwp-gabled' });
    expect(cdl.roof.type).toBe('mansard');
  });

  it('makeLayoutFn memoises per building', () => {
    const fn = makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant });
    const b = spec.buildings[0];
    expect(fn(b)).toBe(fn(b));
  });
});

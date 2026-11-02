import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import {
  axesThatFit,
  centreAxes,
  cullBuriedOpenings,
  facadeOpenings,
  layoutBays,
  parseRhythm,
  portalAxes,
  risalitsFromGroups,
  roofOpenings,
} from '../src/layout/facade.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { roofSection } from '../src/layout/roof.ts';
import { storeyStack } from '../src/layout/storeys.ts';
import { readCatalogueV1 } from './helpers.ts';

const { spec } = loadSite(readCatalogueV1());
const B = (id: string) => spec.buildings.find((b) => b.id === id)!;

describe('rhythm and risalits', () => {
  it('parses v1 rhythm text', () => {
    expect(parseRhythm('6 + 7 (centre risalit = Louisenhof core) + 6')).toEqual([6, 7, 6]);
    expect(parseRhythm('4+7+4')).toEqual([4, 7, 4]);
    expect(parseRhythm('19 axes')).toBeNull();
    expect(parseRhythm(undefined)).toBeNull();
  });

  it('derives centre and corner risalits', () => {
    expect(risalitsFromGroups('garden', [6, 7, 6])).toEqual([expect.objectContaining({ kind: 'centre', first_axis: 6, axis_count: 7 })]);
    const five = risalitsFromGroups('court', [2, 4, 3, 4, 2]);
    expect(five.map((r) => [r.kind, r.first_axis, r.axis_count])).toEqual([
      ['centre', 6, 3],
      ['corner', 0, 2],
      ['corner', 13, 2],
    ]);
    expect(risalitsFromGroups('court', [8, 8])).toEqual([]);
  });

  it('centre axes and portal axes', () => {
    expect(centreAxes(9)).toEqual([4]);
    expect(centreAxes(10)).toEqual([4, 5]);
    expect(portalAxes({ side: 'court', axis: 'centre', kind: 'porte_fenetre', span_axes: 3 }, 19)).toEqual([8, 9, 10]);
    expect(portalAxes({ side: 'court', axis: 2, kind: 'durchfahrt', span_axes: 2 }, 19)).toEqual([2, 3]);
  });
});

describe('layoutBays', () => {
  it('centres the axes with equal margins', () => {
    const l = layoutBays({ side: 'garden', length: 64, axes: 17, spacing: 3.75 });
    expect(l.margin).toBeCloseTo((64 - 17 * 3.75) / 2, 9);
    expect(l.bays[0].a).toBeCloseTo(l.margin + 3.75 / 2, 9);
    expect(l.bays[16].a).toBeCloseTo(64 - l.margin - 3.75 / 2, 9);
    expect(l.bays[8].a).toBeCloseTo(32, 9);
    expect(l.compressed).toBe(false);
  });

  it('respects a sub-range (from/to) and compresses when axes do not fit', () => {
    const l = layoutBays({ side: 'court', length: 78, axes: 9, spacing: 4.1, from: 18.5, to: 59.4 });
    expect((l.bays[0].a + l.bays[8].a) / 2).toBeCloseTo((18.5 + 59.4) / 2, 9);
    const c = layoutBays({ side: 'court', length: 38, axes: 12, spacing: 3.4 });
    expect(c.compressed).toBe(true);
    expect(c.spacing).toBeCloseTo(38 / 12, 9);
  });

  it('marks risalit bays and spans', () => {
    const r = risalitsFromGroups('garden', [6, 7, 6]);
    const l = layoutBays({ side: 'garden', length: 78, axes: 19, spacing: 4.1, groups: [6, 7, 6], risalits: r });
    expect(l.bays.filter((b) => b.risalit).map((b) => b.index)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(l.risalits[0].a1 - l.risalits[0].a0).toBeCloseTo(7 * 4.1, 9);
    expect(l.bays.map((b) => b.group)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  });

  it('axesThatFit keeps 1 m end piers', () => {
    expect(axesThatFit(18, 4.1)).toBe(3);
    expect(axesThatFit(2, 3.6)).toBe(0);
  });
});

describe('facadeOpenings', () => {
  it('South arm: windows per storey, Durchfahrt replaces the centre axis incl. its cellar window', () => {
    const b = B('KB-B02');
    const L = layoutBuilding(b, spec);
    const court = L.openings.filter((o) => o.side === 'court');
    expect(court.filter((o) => o.kind === 'durchfahrt')).toHaveLength(1);
    const df = court.find((o) => o.kind === 'durchfahrt')!;
    expect(df.axis).toBe(8);
    expect(df.bottom_h).toBeCloseTo(344.8, 9); // court level, through the plinth
    expect(df.top_h).toBeLessThan(L.stack.levels[1].top_h);
    expect(court.filter((o) => o.kind === 'cellar_window')).toHaveLength(16);
    expect(court.filter((o) => o.kind === 'window' && o.storey === 1)).toHaveLength(16);
    expect(court.filter((o) => o.kind === 'window' && o.storey === 2)).toHaveLength(17);
  });

  it('every opening fits inside its storey and side', () => {
    for (const b of spec.buildings) {
      if (b.base_h === null || !(b.footprint || b.line)) continue;
      const L = layoutBuilding(b, spec);
      for (const o of L.openings) {
        const lev = L.stack.levels[o.storey];
        expect(o.top_h, `${b.id} ${o.kind}`).toBeLessThanOrEqual(lev.top_h + 1e-9);
        if (o.kind !== 'durchfahrt') expect(o.bottom_h, `${b.id} ${o.kind}`).toBeGreaterThanOrEqual(lev.floor_h - 1e-9);
        const len = L.frame.sides[o.side].length;
        expect(o.a - o.width / 2, `${b.id} ${o.side}`).toBeGreaterThan(0);
        expect(o.a + o.width / 2, `${b.id} ${o.side}`).toBeLessThan(len);
      }
    }
  });

  it('CdL: court portal with Freitreppe, garden portes-fenetres on the Beletage', () => {
    const L = layoutBuilding(B('KB-B01'), spec);
    const portal = L.openings.find((o) => o.kind === 'portal')!;
    expect(portal.side).toBe('court');
    expect(portal.axis).toBe(4);
    expect(portal.steps).toBe(7);
    expect(portal.bottom_h).toBeCloseTo(346.0, 9);
    const pf = L.openings.filter((o) => o.kind === 'porte_fenetre');
    expect(pf.map((o) => [o.side, o.storey, o.axis])).toEqual([
      ['garden', 2, 8],
      ['garden', 2, 9],
      ['garden', 2, 10],
    ]);
    expect(pf[0].sill).toBe(0);
  });

  it('Orangerie hall has floor-length openings (D) and a basement row', () => {
    const L = layoutBuilding(B('KB-B10'), spec);
    const hall = L.openings.filter((o) => o.storey === 1 && o.side === 'court');
    expect(hall.every((o) => o.kind === 'porte_fenetre' && o.sill === 0)).toBe(true);
    expect(L.openings.some((o) => o.storey === 0 && o.kind === 'window')).toBe(true);
  });

  it('stables get high stall windows', () => {
    const L = layoutBuilding(B('KB-B20'), spec);
    const sw = L.openings.filter((o) => o.kind === 'stall_window');
    expect(sw.length).toBeGreaterThan(80);
    expect(sw.every((o) => o.sill >= 1.6)).toBe(true);
  });

  it('cullBuriedOpenings drops openings below the terrain in front', () => {
    const L = layoutBuilding(B('KB-B10'), spec);
    // fake terrain: parterre level 340.8 on the court (E) side, lower bench elsewhere
    const f = L.frame;
    const ground = (E: number, N: number) => {
      const t = (E - f.centreEN[0]) * f.tDir[0] + (N - f.centreEN[1]) * f.tDir[1];
      return t > 0 ? 340.8 : 335.2;
    };
    const kept = cullBuriedOpenings(L.openings, f, ground);
    expect(kept.some((o) => o.side === 'court' && o.storey === 0)).toBe(false);
    expect(kept.some((o) => o.side === 'garden' && o.storey === 0)).toBe(true);
    expect(kept.filter((o) => o.side === 'court' && o.storey === 1)).toHaveLength(21);
  });

  it('facadeOpenings returns nothing for a blind side', () => {
    const stack = storeyStack(B('KB-B06'));
    const lay = layoutBays({ side: 'garden', length: 62, axes: 16, spacing: 3.85, blind: true });
    expect(facadeOpenings({ cls: 'RANGE1', side: 'garden', layout: lay, stack })).toEqual([]);
  });
});

describe('roofOpenings', () => {
  it('mansard: one dormer per axis, oculi on every second axis (HMS)', () => {
    const lay = layoutBays({ side: 'court', length: 64, axes: 17, spacing: 3.75 });
    const sec = roofSection({ type: 'mansard', depth: 17, eaves_h: 355, pitch_lower: 70, pitch_upper: 30 });
    const ro = roofOpenings(lay, sec);
    expect(ro.filter((o) => o.kind === 'dormer')).toHaveLength(17);
    expect(ro.filter((o) => o.kind === 'oculus')).toHaveLength(9);
    for (const d of ro.filter((o) => o.kind === 'dormer')) {
      expect(d.bottom_h + d.height).toBeLessThanOrEqual(sec.break_h! + 1e-9);
      expect(d.inset).toBeLessThan(sec.break_inset!);
    }
  });

  it('flat-deck mansard has no oculi; ends get no roof openings', () => {
    const sec = roofSection({ type: 'mansard', depth: 17, eaves_h: 355, pitch_lower: 70, pitch_upper: 0 });
    expect(roofOpenings(layoutBays({ side: 'garden', length: 64, axes: 17, spacing: 3.75 }), sec).every((o) => o.kind === 'dormer')).toBe(true);
    expect(roofOpenings(layoutBays({ side: 'end_a', length: 17, axes: 4, spacing: 3.75 }), sec)).toEqual([]);
  });
});

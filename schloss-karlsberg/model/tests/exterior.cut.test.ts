import { describe, expect, it } from 'vitest';
import { archCurve, archRise, archSpandrels, area, signedArea2, wallPieces } from '../src/exterior/cut.ts';
import { CASEMENT, GLAZING, glazingClass, glazingLayout } from '../src/layout/grammar.ts';

const band = { a0: 0, a1: 20, h0: 346, h1: 351 };

describe('wallPieces', () => {
  it('keeps a plain wall as one piece', () => {
    expect(wallPieces(band, [])).toEqual([band]);
  });

  it('subtracts holes exactly (area and no overlap)', () => {
    const holes = [
      { a0: 2, a1: 3.3, h0: 347, h1: 349.6 },
      { a0: 6.4, a1: 7.7, h0: 347, h1: 349.6 },
      { a0: 10, a1: 12, h0: 345, h1: 350 }, // portal reaching below the band
    ];
    const pieces = wallPieces(band, holes);
    const holeArea = 1.3 * 2.6 * 2 + 2 * 4; // portal clipped to 346..350
    const sum = pieces.reduce((s, p) => s + area(p), 0);
    expect(sum).toBeCloseTo(20 * 5 - holeArea, 6);
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        const ov = Math.max(0, Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0)) * Math.max(0, Math.min(a.h1, b.h1) - Math.max(a.h0, b.h0));
        expect(ov).toBeLessThan(1e-9);
      }
    // no piece covers a hole centre
    for (const h of holes) {
      const c = [(h.a0 + h.a1) / 2, (Math.max(h.h0, 346) + h.h1) / 2];
      expect(pieces.some((p) => c[0] > p.a0 && c[0] < p.a1 && c[1] > p.h0 && c[1] < p.h1)).toBe(false);
    }
  });

  it('merges slabs with identical free intervals', () => {
    const pieces = wallPieces(band, [{ a0: 5, a1: 6, h0: 347, h1: 348 }]);
    // left of hole (1), above + below hole (2), right of hole (1)
    expect(pieces.length).toBe(4);
  });

  it('ignores holes outside the band', () => {
    expect(wallPieces(band, [{ a0: 25, a1: 26, h0: 347, h1: 348 }])).toEqual([band]);
  });
});

describe('arches', () => {
  it('rise: segmental w/6, round w/2, straight 0', () => {
    expect(archRise('segmental', 1.2)).toBeCloseTo(0.2);
    expect(archRise('round', 1.2)).toBeCloseTo(0.6);
    expect(archRise('straight', 1.2)).toBe(0);
  });

  it('round arch passes through springers and crown on a semicircle', () => {
    const c = archCurve(0, 2, 10, 'round', 8);
    expect(c[0]).toEqual([0, 9]);
    expect(c[8]).toEqual([2, 9]);
    expect(c[4][0]).toBeCloseTo(1);
    expect(c[4][1]).toBeCloseTo(10);
    for (const [a, h] of c) expect(Math.hypot(a - 1, h - 9)).toBeCloseTo(1, 6);
  });

  it('segmental crown reaches the top', () => {
    const c = archCurve(3, 4.2, 350, 'segmental', 8);
    const crown = c.reduce((m, p) => Math.max(m, p[1]), -Infinity);
    expect(crown).toBeCloseTo(350, 6);
  });

  it('spandrels fill the rectangle minus the arch area (round)', () => {
    const sp = archSpandrels(0, 2, 10, 'round', 64);
    expect(sp.length).toBe(2);
    const a = sp.reduce((s, p) => s + signedArea2(p), 0);
    // rectangle 2 x 1 minus a half disk of r = 1
    expect(a).toBeCloseTo(2 - Math.PI / 2, 2);
    for (const p of sp) expect(signedArea2(p)).toBeGreaterThan(0);
  });

  it('straight heads have no spandrels', () => {
    expect(archSpandrels(0, 1, 2, 'straight')).toEqual([]);
  });
});

describe('glazingLayout (KB-I16 French casements)', () => {
  const paneW = (w: number, cols: number) => (w - 2 * CASEMENT.frame) / cols;
  it('maps classes and rows to glazing rules', () => {
    expect(glazingClass('CDL', 'upper')).toBe('state');
    expect(glazingClass('CDL', 'ground')).toBe('court');
    expect(glazingClass('WING2', 'upper')).toBe('court');
    expect(glazingClass('ORANG', 'ground')).toBe('court');
    expect(glazingClass('STABLE', 'ground')).toBe('farm');
    expect(glazingClass('FARM', null)).toBe('farm');
  });
  it('CdL state floor: two leaves, one pane per leaf, panes about 0.55 m tall', () => {
    const g = glazingLayout('CDL', 'upper', 1.3, 2.4);
    expect(g.leaves).toBe(2);
    expect(g.cols).toBe(2);
    expect(g.transom).toBeNull();
    expect(2.4 / g.rowsLow).toBeGreaterThan(0.45);
    expect(2.4 / g.rowsLow).toBeLessThan(0.65);
  });
  it('wings, CdL ground, Orangerie: two panes per leaf of about 0.25 x 0.33 m', () => {
    for (const cls of ['WING2', 'RANGE1', 'ORANG'] as const) {
      const g = glazingLayout(cls, 'ground', 1.2, 2.3);
      expect(g.cols).toBe(4);
      expect(paneW(1.2, g.cols)).toBeCloseTo(0.265, 2);
      const ph = 2.3 / g.rowsLow;
      expect(ph).toBeGreaterThan(0.3);
      expect(ph).toBeLessThan(0.4);
      expect(g.bar).toBe(0.03);
    }
    expect(glazingLayout('CDL', 'ground', 1.2, 2.3).cols).toBe(4);
  });
  it('stables and farm buildings: two per leaf in 3-4 rows', () => {
    for (const h of [0.8, 1.4, 3.0]) {
      const g = glazingLayout('STABLE', 'ground', 1.0, h);
      expect(g.cols).toBe(4);
      expect(g.rowsLow).toBeGreaterThanOrEqual(3);
      expect(g.rowsLow).toBeLessThanOrEqual(4);
    }
  });
  it('a transom only on windows of 2.6 m or more, at 3/4 of the height', () => {
    expect(glazingLayout('WING2', 'ground', 1.2, 2.5).transom).toBeNull();
    const g = glazingLayout('WING2', 'ground', 1.2, 2.8);
    expect(g.transom).toBeCloseTo(2.1, 6);
    expect(g.rowsTop).toBeGreaterThanOrEqual(1);
    // arched heads: the springer is the transom when the whole opening reaches 2.6 m
    const a = glazingLayout('ORANG', 'ground', 1.5, 2.8, 0.75);
    expect(a.transom).toBe(2.8);
    expect(a.rowsTop).toBe(0);
    expect(glazingLayout('ORANG', 'ground', 1.5, 1.8, 0.3).transom).toBeNull();
  });
  it('narrow windows have a single leaf', () => {
    const g = glazingLayout('WING2', 'mezz', 0.6, 0.9);
    expect(g.leaves).toBe(1);
    expect(g.cols).toBe(GLAZING.court.perLeaf);
  });
});

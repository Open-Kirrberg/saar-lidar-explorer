import { describe, expect, it } from 'vitest';
import { archCurve, archRise, archSpandrels, area, glazingGrid, signedArea2, wallPieces } from '../src/exterior/cut.ts';

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

describe('glazingGrid', () => {
  it('gives an even number of columns for casement pairs and ~0.48 m rows', () => {
    const g = glazingGrid(1.3, 2.6);
    expect(g.cols % 2).toBe(0);
    expect(g.rows).toBe(5);
  });
});

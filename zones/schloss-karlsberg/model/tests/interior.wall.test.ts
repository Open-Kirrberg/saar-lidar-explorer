import { describe, expect, it } from 'vitest';
import { DEFAULT_BOISERIE, archPoints, archRise, boiseriePanels, clipHole, freeIntervals, type Hole, rectsArea, rectsOverlap, solidRects } from '../src/interior/wall.ts';

const L = 9.25;
const H = 4.1;
// two windows and a door, as in a typical Louis-seize room wall
const holes: Hole[] = [
  { u0: 1.2, u1: 2.45, v0: 0.85, v1: 3.6 },
  { u0: 3.85, u1: 5.1, v0: 0.85, v1: 3.6 },
  { u0: 6.6, u1: 8.0, v0: 0, v1: 2.9 },
];

describe('interior wall subdivision', () => {
  it('solid rects cover exactly the wall minus the holes', () => {
    const rs = solidRects(L, H, holes);
    const holeArea = holes.reduce((a, h) => a + (h.u1 - h.u0) * (h.v1 - h.v0), 0);
    expect(rectsArea(rs)).toBeCloseTo(L * H - holeArea, 6);
    for (const r of rs) for (const h of holes) expect(rectsOverlap(r, h)).toBe(false);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(rectsOverlap(rs[i], rs[j])).toBe(false);
  });

  it('a wall without holes is one rect; holes beyond the wall are clipped', () => {
    expect(solidRects(5, 3, [])).toEqual([{ u0: 0, u1: 5, v0: 0, v1: 3 }]);
    expect(clipHole({ u0: -1, u1: 1, v0: 0, v1: 5 }, 5, 3)).toEqual({ u0: 0, u1: 1, v0: 0, v1: 3 });
    expect(clipHole({ u0: 6, u1: 7, v0: 0, v1: 1 }, 5, 3)).toBeNull();
    expect(rectsArea(solidRects(5, 3, [{ u0: -1, u1: 1, v0: 0, v1: 5 }]))).toBeCloseTo(12, 6);
  });

  it('free intervals skip taken ranges', () => {
    expect(freeIntervals(0, 10, [[2, 3], [5, 6]])).toEqual([[0, 2], [3, 5], [6, 10]]);
    expect(freeIntervals(0, 10, [[-1, 11]])).toEqual([]);
  });

  it('boiserie panels stay inside the wall, outside every opening, and never overlap', () => {
    const ps = boiseriePanels(L, holes, { ...DEFAULT_BOISERIE, top: H - 0.3 });
    expect(ps.length).toBeGreaterThan(4);
    for (const p of ps) {
      expect(p.u0).toBeGreaterThanOrEqual(0);
      expect(p.u1).toBeLessThanOrEqual(L);
      expect(p.v1).toBeLessThanOrEqual(H);
      expect(p.u1 - p.u0).toBeGreaterThan(0.25);
      for (const h of holes) expect(rectsOverlap(p, h)).toBe(false);
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(rectsOverlap(ps[i], ps[j])).toBe(false);
    // upper fields respect the maximum width
    for (const p of ps.filter((q) => q.kind === 'upper')) expect(p.u1 - p.u0).toBeLessThanOrEqual(DEFAULT_BOISERIE.maxUpper + 1e-9);
  });

  it('arch heads: round rise = w/2, segmental = w/6, flat none', () => {
    expect(archRise('round', 3)).toBeCloseTo(1.5, 6);
    expect(archRise('segmental', 3)).toBeCloseTo(0.5, 6);
    expect(archRise(undefined, 3)).toBe(0);
    const pts = archPoints('round', 3, 4, 8);
    expect(pts[0][0]).toBeCloseTo(0, 6);
    expect(pts[pts.length - 1][0]).toBeCloseTo(3, 6);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(4, 6);
  });
});

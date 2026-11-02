import { describe, expect, it } from 'vitest';
import { dimChain } from '../src/geom/dims.ts';
import { type Rect, coverAlong, gaps, mergeRects, offsetPolygon, planCells, rectArea, rectOf, wallDepth } from '../src/geom/plan.ts';
import { elevView, paperArea, planView, scaleBarSteps } from '../src/geom/transform.ts';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('planView (scale transform)', () => {
  it('north up: east to the right, north up, k = 1000 / scale', () => {
    const v = planView(500, [382000, 5466000], [100, 100], 0);
    expect(v.k).toBe(2);
    const e = v.toPaper(382010, 5466000);
    const n = v.toPaper(382000, 5466010);
    close(e[0], 120);
    close(e[1], 100);
    close(n[0], 100);
    close(n[1], 80);
  });

  it('round trip and never mirrored for any up azimuth', () => {
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ];
    const ref = Math.sign(paperArea(ring.map(([x, y]) => planView(200, [0, 0], [0, 0], 0).toPaper(x, y))));
    for (const up of [0, 80.5, 170.5, 260.5, 350.5, 33]) {
      const v = planView(200, [382226, 5466120], [210, 148], up);
      for (const [E, N] of [
        [382230, 5466100],
        [382100, 5466300],
      ]) {
        const p = v.toPaper(E, N);
        const q = v.toEN(p[0], p[1]);
        close(q[0], E, 1e-6);
        close(q[1], N, 1e-6);
      }
      // orientation of a CCW ring is preserved (rotation only, no reflection)
      const area = paperArea(ring.map(([x, y]) => v.toPaper(382226 + x, 5466120 + y)));
      expect(Math.sign(area)).toBe(ref);
      close(Math.abs(area), 50 * v.k * v.k, 1e-6);
      // the up azimuth points up on the paper
      const d = v.dirOfAzimuth(up);
      close(d[0], 0);
      close(d[1], -1);
    }
  });
});

describe('elevView', () => {
  it('looking east (80.5): the viewer’s right hand is south-ish, heights go up', () => {
    const v = elevView(200, [382226, 5466120], 80.5, 340, [50, 200]);
    // a point 10 m towards azimuth 170.5 is 10 m to the right
    const a = (170.5 * Math.PI) / 180;
    const p = v.toPaper(382226 + 10 * Math.sin(a), 5466120 + 10 * Math.cos(a), 345);
    close(p[0], 50 + 50);
    close(p[1], 200 - 25);
    // depth grows in the viewing direction
    const b = (80.5 * Math.PI) / 180;
    close(v.depthOf(382226 + 7 * Math.sin(b), 5466120 + 7 * Math.cos(b)), 7);
  });
});

describe('scaleBarSteps', () => {
  it('fits the requested length', () => {
    for (const s of [200, 500, 1000, 2000, 5000]) {
      const [step, count] = scaleBarSteps(s, 80);
      expect(step * count * (1000 / s)).toBeLessThanOrEqual(80 + 1e-9);
      expect(count).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('planCells (wall poché from room rectangles)', () => {
  const outline: Rect = { s0: 0, s1: 20, t0: 0, t1: 10 };
  const rooms: Rect[] = [
    { s0: 1, s1: 9.9, t0: 1, t1: 9 },
    { s0: 10.1, s1: 19, t0: 1, t1: 5 },
  ];
  const cells = planCells(outline, rooms, { outerThickness: 1, outerWall: 1 });

  it('outline area = spaces + walls + voids', () => {
    const a = cells.areas;
    close(a.spaces + a.walls + a.voids, a.outline, 1e-9);
    close(a.spaces, 8.9 * 8 + 8.9 * 4, 1e-9);
  });

  it('outer walls are flagged, the 0.2 m partition is inner, corners are walls (not voids)', () => {
    const inner = cells.walls.filter((w) => !w.outer);
    expect(inner.some((w) => Math.abs(w.s0 - 9.9) < 1e-9 && Math.abs(w.s1 - 10.1) < 1e-9)).toBe(true);
    const corner = (s: number, t: number) => cells.walls.some((w) => s > w.s0 && s < w.s1 && t > w.t0 && t < w.t1);
    expect(corner(0.5, 0.5)).toBe(true);
    expect(corner(19.5, 9.5)).toBe(true);
    expect(cells.voids.some((v) => 0.5 > v.s0 && 0.5 < v.s1 && 0.5 > v.t0 && 0.5 < v.t1)).toBe(false);
  });

  it('the outer wall band stays wall next to an unassigned area', () => {
    const at = (s: number, t: number) => cells.walls.some((w) => w.outer && s > w.s0 && s < w.s1 && t > w.t0 && t < w.t1);
    expect(at(19.5, 7)).toBe(true);
    expect(at(15, 9.5)).toBe(true);
  });

  it('an unassigned area wider than maxWall in both directions is a void', () => {
    // free block s 10.1..19, t 5..9 (8.9 x 4 m) has no room
    const inVoid = cells.voids.some((v) => 15 > v.s0 && 15 < v.s1 && 7 > v.t0 && 7 < v.t1);
    expect(inVoid).toBe(true);
    const asWall = cells.walls.some((w) => 15 > w.s0 && 15 < w.s1 && 7 > w.t0 && 7 < w.t1);
    expect(asWall).toBe(false);
  });

  it('rectOf recognises axis-aligned rectangles only', () => {
    expect(
      rectOf([
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
      ]),
    ).toEqual({ s0: 0, s1: 2, t0: 0, t1: 1 });
    expect(
      rectOf([
        [0, 0],
        [2, 0],
        [3, 1],
        [0, 1],
      ]),
    ).toBeNull();
  });

  it('mergeRects keeps the area', () => {
    const m = mergeRects([
      { s0: 0, s1: 1, t0: 0, t1: 1 },
      { s0: 1, s1: 2, t0: 0, t1: 1 },
      { s0: 0, s1: 1, t0: 1, t1: 2 },
    ]);
    expect(m.length).toBe(2);
    close(
      m.reduce((s, r) => s + rectArea(r), 0),
      3,
    );
  });
});

describe('wallDepth / coverAlong / gaps / offsetPolygon', () => {
  it('wallDepth measures to the first room face', () => {
    const rooms: Rect[] = [{ s0: 1, s1: 5, t0: 0.9, t1: 4 }];
    close(wallDepth([3, 0], [0, 1], rooms), 0.9);
    // nothing hit -> fallback
    close(wallDepth([3, 0], [0, -1], rooms, 2.5, 0.7), 0.7);
  });

  it('coverAlong merges intervals on a cut line, gaps returns the complement', () => {
    const rs: Rect[] = [
      { s0: 0, s1: 1, t0: 0, t1: 10 },
      { s0: 0.5, s1: 2, t0: 0, t1: 10 },
      { s0: 5, s1: 6, t0: 0, t1: 10 },
    ];
    expect(coverAlong(rs, 's', 3)).toEqual([
      [0, 2],
      [5, 6],
    ]);
    expect(gaps(coverAlong(rs, 's', 3), 0, 8)).toEqual([
      [2, 5],
      [6, 8],
    ]);
  });

  it('offsetPolygon shrinks a CCW square evenly', () => {
    const o = offsetPolygon(
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      1,
    );
    expect(o.map((p) => p.map((x) => Math.round(x * 1e6) / 1e6))).toEqual([
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]);
  });
});

describe('dimChain', () => {
  it('labels segments in German format and sums to the total', () => {
    const ch = dimChain([0, 1.9, 4.55, 7.2, 9.1], 5);
    expect(ch.segments.map((s) => s.label)).toEqual(['1,90', '2,65', '2,65', '1,90']);
    close(ch.total, 9.1);
  });

  it('sorts, de-duplicates and staggers labels that do not fit', () => {
    const ch = dimChain([3, 0, 0.005, 0.16, 3], 5);
    expect(ch.positions).toEqual([0, 0.16, 3]);
    expect(ch.segments[0].row).toBe(1); // 0,16 m = 0.8 mm at 1:200: no room on the line
    expect(ch.segments[1].row).toBe(0);
  });
});

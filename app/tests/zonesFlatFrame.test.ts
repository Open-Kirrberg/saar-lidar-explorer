/**
 * Built twins: the picture-frame highlight of flat, wall-mounted targets (the gable mural) — pure parts.
 */
import { describe, expect, it } from 'vitest';
import { FLAT_THICK_M, flatPanel, frameRing, frameWidth } from '../src/zones/flatFrame';
import type { P3 } from '../src/zones/flatFrame';

type Tri = [P3, P3, P3];
/** Axis-aligned quad facing +z (two triangles), optionally reversed (facing −z). */
const quadZ = (x0: number, y0: number, x1: number, y1: number, z: number, back = false): Tri[] => {
  const a: P3 = [x0, y0, z];
  const b: P3 = [x1, y0, z];
  const c: P3 = [x1, y1, z];
  const d: P3 = [x0, y1, z];
  return back ? [[a, c, b], [a, d, c]] : [[a, b, c], [a, c, d]];
};
/** A closed box [x0..x1] × [y0..y1] × [z0..z1] with outward faces. */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Tri[] => {
  const t: Tri[] = [...quadZ(x0, y0, x1, y1, z1), ...quadZ(x0, y0, x1, y1, z0, true)];
  const p = (x: number, y: number, z: number): P3 => [x, y, z];
  t.push([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1)], [p(x1, y0, z0), p(x1, y1, z1), p(x1, y0, z1)]);
  t.push([p(x0, y0, z0), p(x0, y1, z1), p(x0, y1, z0)], [p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)]);
  t.push([p(x0, y1, z0), p(x1, y1, z1), p(x1, y1, z0)], [p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)]);
  t.push([p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1)], [p(x0, y0, z0), p(x1, y0, z1), p(x0, y0, z1)]);
  return t;
};

describe('flat frame', () => {
  it('a mural (panel + decals on top, all facing out) is flat: axis, rectangle, one side', () => {
    const tris = [...box(0, 0, 0, 1.85, 2.65, 0.025), ...quadZ(0.4, 1.4, 1.4, 2.2, 0.026), ...quadZ(0.2, 0.3, 1.6, 0.6, 0.028)];
    // only the front and decals, no back face (a decal on a wall)
    const noBack = tris.filter(([a, b, c]) => !(a[2] === 0 && b[2] === 0 && c[2] === 0));
    const p = flatPanel(noBack)!;
    expect(p).not.toBeNull();
    expect(p.n.map((x) => Math.round(x * 1000) / 1000)).toEqual([0, 0, 1]);
    expect(p.u0).toBeCloseTo(0); // u = up × n = +x, v = n × u = +y
    expect(p.u1).toBeCloseTo(1.85);
    expect(p.v0).toBeCloseTo(0);
    expect(p.v1).toBeCloseTo(2.65);
    expect(p.d1).toBeCloseTo(0.028);
    expect(p.twoSided).toBe(false);
  });

  it('a hanging sign (both faces) is two-sided; a loaf, a shelf or a thick block is not flat', () => {
    const sign = [...quadZ(0, 0, 0.6, 0.9, 0.02), ...quadZ(0, 0, 0.6, 0.9, 0, true)];
    expect(flatPanel(sign)!.twoSided).toBe(true);
    expect(flatPanel(box(0, 0, 0, 0.2, 0.13, 0.22))).toBeNull();
    expect(flatPanel(box(0, 0, 0, 3.6, 2.0, 0.6))).toBeNull();
    // flat in area but thicker than FLAT_THICK_M (a panel and a far-away decal)
    expect(flatPanel([...quadZ(0, 0, 2, 2, 0), ...quadZ(0, 0, 0.1, 0.1, FLAT_THICK_M + 0.05)])).toBeNull();
    expect(flatPanel([])).toBeNull();
  });

  it('works for a rotated panel (the gable faces SSW)', () => {
    const r = (Math.PI / 180) * 25.7;
    const rot = (p: P3): P3 => [p[0] * Math.cos(r) + p[2] * Math.sin(r), p[1], -p[0] * Math.sin(r) + p[2] * Math.cos(r)];
    const tris = quadZ(0, 0, 1.85, 2.65, 0).map((t) => t.map(rot) as Tri);
    const p = flatPanel(tris)!;
    expect(p.u1 - p.u0).toBeCloseTo(1.85);
    expect(p.v1 - p.v0).toBeCloseTo(2.65);
    expect(Math.hypot(...p.n)).toBeCloseTo(1);
  });

  it('the ring: 8 triangles around the rectangle at the given depth', () => {
    const p = flatPanel(quadZ(0, 0, 2, 1, 0))!;
    const ring = frameRing(p, 0.012, 0.01, 0.05);
    expect(ring).toHaveLength(8 * 3 * 3);
    const zs = new Set(ring.filter((_, i) => i % 3 === 2).map((z) => z.toFixed(6)));
    expect([...zs]).toEqual(['0.012000']);
    const xs = ring.filter((_, i) => i % 3 === 0);
    const ys = ring.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-0.06);
    expect(Math.max(...xs)).toBeCloseTo(2.06);
    expect(Math.min(...ys)).toBeCloseTo(-0.06);
    expect(Math.max(...ys)).toBeCloseTo(1.06);
    expect(frameWidth(1.85, 2.65)).toBeCloseTo(0.0925);
    expect(frameWidth(0.1, 0.1)).toBe(0.02);
    expect(frameWidth(10, 10)).toBe(0.1);
  });
});

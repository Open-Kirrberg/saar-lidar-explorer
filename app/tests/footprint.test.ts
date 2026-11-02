import { describe, expect, it } from 'vitest';
import { borderNdc, footprintFromRays, groundPoint, planeHit, polygonArea } from '../src/map/footprint';
import type { V3 } from '../src/map/footprint';

const deg = Math.PI / 180;

/** Ray direction for a simple pinhole camera looking along heading 0 (−z) with pitch, at NDC (u,v). */
function rayDir(u: number, v: number, pitchDeg: number, vfovDeg: number, aspect: number): V3 {
  const ty = Math.tan((vfovDeg / 2) * deg);
  // camera space: x right, y up, −z forward
  const cx = u * ty * aspect;
  const cy = v * ty;
  const cz = -1;
  const p = pitchDeg * deg; // rotate about x
  const y = cy * Math.cos(p) - cz * Math.sin(p);
  const z = cy * Math.sin(p) + cz * Math.cos(p);
  return { x: cx, y, z };
}

describe('borderNdc', () => {
  it('returns 4·n points starting at the bottom-left corner, counter-clockwise', () => {
    const pts = borderNdc(2);
    expect(pts).toHaveLength(8);
    expect(pts[0]).toEqual([-1, -1]);
    expect(pts[1]).toEqual([0, -1]);
    expect(pts[2]).toEqual([1, -1]);
    expect(pts[4]).toEqual([1, 1]);
    expect(pts[6]).toEqual([-1, 1]);
    expect(borderNdc(1)).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  });
});

describe('groundPoint', () => {
  const o = { x: 0, y: 100, z: 0 };
  it('hits a flat plane at the analytic position', () => {
    // 45° down towards −z (north) → hits 100 m ahead
    const p = groundPoint(o, { x: 0, y: -1, z: -1 }, planeHit(0), 5000);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(-100, 6);
  });
  it('clamps rays above the horizon to maxDist along their horizontal direction', () => {
    const p = groundPoint(o, { x: 3, y: 1, z: -4 }, planeHit(0), 1000);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1000, 6);
    expect(p.x / p.z).toBeCloseTo(3 / -4, 6);
  });
  it('clamps far hits (shallow rays) to maxDist', () => {
    const p = groundPoint(o, { x: 0, y: -0.01, z: -1 }, planeHit(0), 2000); // would hit at 10 km
    expect(p.z).toBeCloseTo(-2000, 6);
  });
  it('returns the nadir for a straight-down ray', () => {
    expect(groundPoint(o, { x: 0, y: -1, z: 0 }, planeHit(0), 1000)).toEqual({ x: 0, z: 0 });
  });
});

describe('footprintFromRays', () => {
  it('is a symmetric trapezoid for a pitched camera over flat ground', () => {
    const origin = { x: 0, y: 100, z: 0 };
    const dirs = borderNdc(1).map(([u, v]) => rayDir(u, v, -45, 40, 1.5));
    const fp = footprintFromRays(origin, dirs, planeHit(0), 100000);
    const [bl, br, tr, tl] = fp;
    // Symmetric about x = 0
    expect(bl.x).toBeCloseTo(-br.x, 6);
    expect(tl.x).toBeCloseTo(-tr.x, 6);
    expect(bl.z).toBeCloseTo(br.z, 6);
    // Bottom edge nearer and narrower than the top edge; all in front (−z)
    expect(bl.z).toBeGreaterThan(tl.z);
    expect(Math.abs(tr.x - tl.x)).toBeGreaterThan(Math.abs(br.x - bl.x));
    expect(Math.max(...fp.map((p) => p.z))).toBeLessThan(0);
    // Bottom-centre ray at pitch −45−20 = −65° → z = −100/tan(65°)
    const mid = groundPoint(origin, rayDir(0, -1, -45, 40, 1.5), planeHit(0), 1e5);
    expect(mid.z).toBeCloseTo(-100 / Math.tan(65 * deg), 6);
  });

  it('looking straight down gives a rectangle of the expected area', () => {
    const origin = { x: 10, y: 200, z: -5 };
    const dirs = borderNdc(1).map(([u, v]) => rayDir(u, v, -90, 60, 2));
    const fp = footprintFromRays(origin, dirs, planeHit(0), 1e5);
    const h = 200 * Math.tan(30 * deg) * 2;
    expect(polygonArea(fp)).toBeCloseTo(h * h * 2, 3);
  });

  it('stays bounded when the camera looks at the horizon', () => {
    const origin = { x: 0, y: 50, z: 0 };
    const dirs = borderNdc(2).map(([u, v]) => rayDir(u, v, 0, 60, 1.6));
    const fp = footprintFromRays(origin, dirs, planeHit(0), 2500);
    for (const p of fp) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(2500 + 1e-6);
    expect(polygonArea(fp)).toBeGreaterThan(0);
  });
});

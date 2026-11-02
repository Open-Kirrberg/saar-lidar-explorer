/** Wave-8 review fix (KB-I71, KB-W8 Felsenpfad): the pure helpers of model/src/site/rockPath.ts. */
import { describe, expect, it } from 'vitest';
import { distanceToLine } from '../src/layout/garden.ts';
import type { P2 } from '../src/layout/geom.ts';
import { isTroddenPath, outcropPlan, outcropShape, pathWidthFactor, smoothNoise1 } from '../src/site/rockPath.ts';

const line: P2[] = [
  [0, 0],
  [40, 5],
  [80, 0],
  [130, -8],
];

describe('rockPath', () => {
  it('recognises a trodden earth path only', () => {
    expect(isTroddenPath({ kind: 'path', surface: 'Trodden earth (Buntsandstein), rock outcrops' })).toBe(true);
    expect(isTroddenPath({ kind: 'path', surface: 'gravel' })).toBe(false);
    expect(isTroddenPath({ kind: 'path' })).toBe(false);
    expect(isTroddenPath({ kind: 'avenue', surface: 'trodden earth' })).toBe(false);
  });

  it('smooth noise is deterministic, in [0, 1] and continuous', () => {
    const a = smoothNoise1(7, 5);
    const b = smoothNoise1(7, 5);
    for (let s = 0; s < 50; s += 0.37) {
      expect(a(s)).toBe(b(s));
      expect(a(s)).toBeGreaterThanOrEqual(0);
      expect(a(s)).toBeLessThanOrEqual(1);
      expect(Math.abs(a(s + 0.01) - a(s))).toBeLessThan(0.02);
    }
  });

  it('the width factor breathes within 0.7-1.2 and tapers to 0.75 at the ends', () => {
    const L = 120;
    const w = pathWidthFactor(42, L);
    expect(w(0)).toBeCloseTo(0.75, 6);
    expect(w(L)).toBeCloseTo(0.75, 6);
    let lo = 9;
    let hi = 0;
    for (let s = 0; s <= L; s += 0.5) {
      lo = Math.min(lo, w(s));
      hi = Math.max(hi, w(s));
    }
    expect(lo).toBeGreaterThanOrEqual(0.7);
    expect(hi).toBeLessThanOrEqual(1.2);
    expect(hi - lo).toBeGreaterThan(0.1); // it does vary
  });

  it('outcrops are deterministic, mostly uphill and keep clear of the path', () => {
    const height = (_x: number, z: number) => z * 0.2; // ground rises towards +z: the left of the line (normal (−dz, dx))
    const a = outcropPlan(line, 1789, { width: 1.4, height });
    const b = outcropPlan(line, 1789, { width: 1.4, height });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(4);
    for (const o of a) {
      expect(distanceToLine(line, [o.x, o.z])).toBeGreaterThan(0.7 + 0.6);
      expect(o.h).toBeGreaterThan(0);
      expect(o.h).toBeLessThanOrEqual(0.9);
      expect(o.len).toBeLessThanOrEqual(3.4);
    }
    const up = a.filter((o) => o.side === 1).length;
    expect(up / a.length).toBeGreaterThan(0.6);
  });

  it('avoid() rejects stone centres', () => {
    const all = outcropPlan(line, 3, { width: 1.4 });
    const none = outcropPlan(line, 3, { width: 1.4, avoid: () => true });
    expect(all.length).toBeGreaterThan(0);
    expect(none).toHaveLength(0);
  });

  it('the outcrop shape is a closed, outward-wound, flattened solid', () => {
    const { v, f } = outcropShape(11);
    expect(v).toHaveLength(12);
    expect(f).toHaveLength(20);
    // every edge is shared by exactly two faces in opposite directions (closed, consistently wound)
    const edges = new Map<string, number>();
    for (const [i, j, k] of f) for (const [p, q] of [[i, j], [j, k], [k, i]]) edges.set(`${p}-${q}`, (edges.get(`${p}-${q}`) ?? 0) + 1);
    for (const [e, n] of edges) {
      expect(n).toBe(1);
      const [p, q] = e.split('-');
      expect(edges.get(`${q}-${p}`)).toBe(1);
    }
    // outward: every face normal points away from the centre
    for (const [i, j, k] of f) {
      const [a, b, c] = [v[i], v[j], v[k]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      expect(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]).toBeGreaterThan(0);
    }
    // the top is flattened: lower than the widest extent
    const top = Math.max(...v.map((p) => p[1]));
    const wide = Math.max(...v.map((p) => Math.abs(p[0])));
    expect(top).toBeLessThan(wide);
  });
});

describe('rockPath edge stones (wave 9)', () => {
  it('sets loose stones along both edges, beyond the tread, deterministic, off the ends and avoided spots', async () => {
    const { EDGE_STONES, edgeStonePlan } = await import('../src/site/rockPath.ts');
    const width = 1.2;
    const a = edgeStonePlan(line, 42, { width });
    expect(edgeStonePlan(line, 42, { width })).toEqual(a);
    expect(a.length).toBeGreaterThan(20);
    expect(new Set(a.map((s) => s.side))).toEqual(new Set([1, -1]));
    for (const s of a) {
      const d = distanceToLine(line, [s.x, s.z]);
      expect(d).toBeGreaterThan(width / 2 + EDGE_STONES.out[0] - 0.01);
      expect(d).toBeLessThan(width / 2 + EDGE_STONES.out[1] + EDGE_STONES.len[1]);
      expect(s.h).toBeGreaterThanOrEqual(EDGE_STONES.h[0]);
      expect(s.h).toBeLessThanOrEqual(EDGE_STONES.h[1]);
    }
    const kept = edgeStonePlan(line, 42, { width, avoid: (x) => x < 40 });
    expect(kept.every((s) => s.x >= 40)).toBe(true);
    expect(kept.length).toBeLessThan(a.length);
  });
});

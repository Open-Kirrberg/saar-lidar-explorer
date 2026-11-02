import { describe, expect, it } from 'vitest';
import { edgeDeviation, maxEdgeDeviation, terrainSkirtDepth } from '../src/terrain/skirts';

const cs = 20;
const apron = 1;
const side = cs + 2 * apron;

function image(f: (x: number, y: number) => number): Float32Array {
  const a = new Float32Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) a[y * side + x] = f(x, y);
  return a;
}

/** Brute-force: vertical gap between two polylines (spacings sa, sb) along the north edge. */
function seamGap(h: Float32Array, sa: number, sb: number): number {
  const row = apron;
  const at = (k: number) => h[row * side + k];
  const poly = (s: number, k: number) => {
    const k0 = apron + Math.floor((k - apron) / s) * s;
    const k1 = Math.min(k0 + s, apron + cs);
    return k1 === k0 ? at(k0) : at(k0) + ((at(k1) - at(k0)) * (k - k0)) / (k1 - k0);
  };
  let g = 0;
  for (let k = apron; k <= apron + cs; k++) g = Math.max(g, Math.abs(poly(sa, k) - poly(sb, k)));
  return g;
}

describe('edgeDeviation', () => {
  it('is 0 for planar terrain and for spacing 1', () => {
    const plane = image((x, y) => 300 + 0.7 * x - 0.3 * y);
    expect(edgeDeviation(plane, side, apron, cs, 4)).toBeCloseTo(0, 4);
    expect(edgeDeviation(plane, side, apron, cs, 10)).toBeCloseTo(0, 4);
    const bumpy = image((x, y) => Math.sin(x) * 5 + Math.cos(y) * 5);
    expect(edgeDeviation(bumpy, side, apron, cs, 1)).toBe(0);
  });

  it('finds a single spike on an edge (between coarse vertices)', () => {
    const h = image(() => 100);
    h[apron * side + apron + 3] = 112; // north edge, sample 3 (not a vertex at spacing 2/4/10)
    expect(edgeDeviation(h, side, apron, cs, 2)).toBeCloseTo(12);
    expect(edgeDeviation(h, side, apron, cs, 10)).toBeCloseTo(12);
    // A spike inside the chunk (not on an edge) doesn't open seams.
    const inner = image(() => 100);
    inner[10 * side + 10] = 150;
    expect(edgeDeviation(inner, side, apron, cs, 10)).toBe(0);
  });

  it('covers all four edges', () => {
    for (const [x, y] of [
      [apron + 3, apron],
      [apron + 3, apron + cs],
      [apron, apron + 7],
      [apron + cs, apron + 7],
    ]) {
      const h = image(() => 0);
      h[y * side + x] = -8;
      expect(edgeDeviation(h, side, apron, cs, 4)).toBeCloseTo(8);
    }
  });

  it('ignores non-finite samples', () => {
    const h = image(() => 50);
    h[apron * side + apron + 5] = NaN;
    expect(edgeDeviation(h, side, apron, cs, 4)).toBe(0);
  });

  it('2 × max deviation bounds the seam gap between any two LOD spacings', () => {
    // Steep, curved slope (Schlossberg-like) with high-frequency roughness.
    const h = image((x, y) => 250 + 0.02 * (x - 5) ** 2 * 3 + 4 * Math.sin(x * 1.7) + 0.5 * y);
    const spacings = [1, 2, 4, 10];
    const dev = maxEdgeDeviation(h, side, apron, cs, spacings);
    expect(dev).toBeGreaterThan(1);
    for (const a of spacings) for (const b of spacings) expect(seamGap(h, a, b)).toBeLessThanOrEqual(2 * dev + 1e-4);
  });
});

describe('terrainSkirtDepth', () => {
  it('keeps the old 1× depth on smooth terrain', () => {
    expect(terrainSkirtDepth(10, 1, 0)).toBe(22);
    expect(terrainSkirtDepth(1, 1, 0)).toBe(4);
  });

  it('scales linearly with exaggeration but never below 1×', () => {
    expect(terrainSkirtDepth(4, 5, 0)).toBe(5 * terrainSkirtDepth(4, 1, 0));
    expect(terrainSkirtDepth(4, 0.5, 0)).toBe(terrainSkirtDepth(4, 1, 0));
  });

  it('covers the worst seam gap (2 × edge deviation) at any exaggeration', () => {
    for (const exag of [1, 2, 5, 10]) {
      const dev = 15;
      expect(terrainSkirtDepth(2, exag, dev)).toBeGreaterThanOrEqual(2 * dev * exag);
    }
  });
});

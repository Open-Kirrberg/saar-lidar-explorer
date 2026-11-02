import { describe, expect, it } from 'vitest';
import { boxBlur } from '../src/data/boxBlur';
import type { GridSpec } from '../src/data/grid';
import { cellToWorld, heightImageSize } from '../src/data/grid';
import { HeightQuery, raycastHeightField } from '../src/terrain/HeightQuery';

/** Build chunks (with edge-clamped apron) from an analytic function of cell coords. */
function makeQuery(g: GridSpec, f: (c: number, r: number) => number): HeightQuery {
  const nx = Math.ceil(g.width / g.chunkSize);
  const ny = Math.ceil(g.height / g.chunkSize);
  const q = new HeightQuery(g, nx, ny);
  const s = heightImageSize(g);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const data = new Float32Array(s * s);
      for (let py = 0; py < s; py++) {
        for (let px = 0; px < s; px++) {
          const c = Math.min(Math.max(i * g.chunkSize - 1 + px, 0), g.width - 1);
          const r = Math.min(Math.max(j * g.chunkSize - 1 + py, 0), g.height - 1);
          data[py * s + px] = f(c, r);
        }
      }
      q.add(i, j, data);
    }
  }
  return q;
}

const g: GridSpec = { width: 40, height: 30, chunkSize: 10, apron: 1 };
// A plane is reproduced exactly by bilinear interpolation.
const plane = (c: number, r: number) => 100 + 0.5 * c - 0.25 * r;

describe('HeightQuery', () => {
  const q = makeQuery(g, plane);

  it('returns exact values at cell centres', () => {
    for (const [c, r] of [
      [0, 0],
      [9, 9],
      [10, 10],
      [39, 29],
      [17, 4],
    ]) {
      const w = cellToWorld(c, r, g);
      expect(q.heightAt(w.x, w.z)).toBeCloseTo(plane(c, r), 5);
    }
  });

  it('interpolates bilinearly, including across chunk borders (apron)', () => {
    for (const [c, r] of [
      [9.5, 3.25],
      [19.9, 9.1],
      [10.0001, 19.999],
      [29.5, 25.75],
    ]) {
      const w = cellToWorld(c, r, g);
      expect(q.heightAt(w.x, w.z)).toBeCloseTo(plane(c, r), 4);
    }
  });

  it('bilinear on a non-planar surface matches the hand-computed value', () => {
    const qq = makeQuery(g, (c, r) => c * r);
    const w = cellToWorld(12.25, 7.5, g);
    // corners (12,7)=84, (13,7)=91, (12,8)=96, (13,8)=104
    const top = 84 + (91 - 84) * 0.25;
    const bot = 96 + (104 - 96) * 0.25;
    expect(qq.heightAt(w.x, w.z)).toBeCloseTo(top + (bot - top) * 0.5, 5);
  });

  it('edge-clamps outside the AOI and reports missing chunks as NaN', () => {
    expect(q.heightAt(-50, -1000)).toBeCloseTo(plane(0, 0), 5);
    const empty = new HeightQuery(g, 4, 3);
    expect(Number.isNaN(empty.heightAt(5, -5))).toBe(true);
  });

  it('mosaic reassembles the AOI raster', () => {
    const m = q.mosaic();
    expect(m.length).toBe(40 * 30);
    expect(m[7 * 40 + 23]).toBeCloseTo(plane(23, 7), 5);
  });

  it('raycast hits a flat surface where expected', () => {
    // From (0, 110, 0) looking 45° down along +x onto y = 100 → hit at distance 10·√2.
    const d = Math.SQRT1_2;
    const t = raycastHeightField(() => 100, 0, 110, 0, d, -d, 0);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(10 * Math.SQRT2, 3);
  });
});

describe('boxBlur', () => {
  it('keeps constants and planes (interior) unchanged and averages a spike', () => {
    const w = 21;
    const h = 21;
    const src = new Float32Array(w * h).fill(5);
    src[10 * w + 10] = 5 + 9 * 9;
    const out = boxBlur(src, w, h, 4);
    expect(out[10 * w + 10]).toBeCloseTo(5 + 81 / 81, 5);
    expect(out[0]).toBeCloseTo(5, 5);
  });
});

// Soft class edges (wave-3 ground review): blurred-weight encoding of the class raster and the distance channels of
// the land-cover bake (viewer/src/landcover.ts smoothWeights, groundDistances, packGround().dist).
import { describe, expect, it } from 'vitest';
import { DIST_SCALE, GROUND_CLASS, bandEdge, erf, groundDistances, hayParcel, noiseLattice, packGround, smoothWeights, type GroundGrid } from '../src/landcover.ts';

/** One-hot RGBA8 grid with channel 0 = 255 where `on(r, c)`. */
function oneHot(cols: number, rows: number, on: (r: number, c: number) => boolean): Uint8Array {
  const d = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (on(r, c)) d[(r * cols + c) * 4] = 255;
  return d;
}
/** Bilinear lookup of channel 0 at a continuous cell position (cell centres at integer + 0.5). */
function bilinear(d: Uint8Array, cols: number, rows: number, x: number, y: number): number {
  const fx = Math.min(cols - 1, Math.max(0, x - 0.5));
  const fy = Math.min(rows - 1, Math.max(0, y - 0.5));
  const c0 = Math.min(cols - 2, Math.floor(fx));
  const r0 = Math.min(rows - 2, Math.floor(fy));
  const tx = fx - c0;
  const ty = fy - r0;
  const v = (r: number, c: number) => d[(r * cols + c) * 4] / 255;
  return (v(r0, c0) * (1 - tx) + v(r0, c0 + 1) * tx) * (1 - ty) + (v(r0 + 1, c0) * (1 - tx) + v(r0 + 1, c0 + 1) * tx) * ty;
}
/** Position (cells) along a horizontal line y where the bilinear field crosses 0.5, scanning +x. */
function crossing(d: Uint8Array, cols: number, rows: number, y: number): number {
  let prev = bilinear(d, cols, rows, 0.5, y);
  for (let x = 0.5; x < cols; x += 0.01) {
    const v = bilinear(d, cols, rows, x, y);
    if ((prev >= 0.5) !== (v >= 0.5)) return x;
    prev = v;
  }
  return NaN;
}

describe('smoothWeights (blurred-weight encoding)', () => {
  it('keeps a straight edge at the 0.5 iso-line and leaves the interior at 1 and the far outside at 0', () => {
    const cols = 40;
    const rows = 20;
    const d = smoothWeights(oneHot(cols, rows, (_r, c) => c < 20), cols, rows, 1, true);
    expect(crossing(d, cols, rows, 10)).toBeCloseTo(20, 1);
    expect(d[(10 * cols + 5) * 4]).toBe(255);
    expect(d[(10 * cols + 35) * 4]).toBe(0);
  });

  it('turns the staircase of a 10° edge (the palace grid is ~9.5° off the raster) into a smooth curve', () => {
    const t = Math.tan((10 * Math.PI) / 180);
    const C = 80;
    const R = 40;
    const raw = oneHot(C, R, (r, c) => r + 0.5 < 10 + t * (c + 0.5));
    const sm = smoothWeights(raw, C, R, 1, true);
    /** y where the field drops below 0.5 at column position x */
    const yAt = (d: Uint8Array, x: number) => {
      for (let y = 0.5; y < R; y += 0.005) if (bilinear(d, C, R, x, y) < 0.5) return y;
      return NaN;
    };
    const stats = (d: Uint8Array) => {
      let dev = 0;
      let kink = 0;
      for (let x = 10; x < 70; x += 0.25) {
        const y0 = yAt(d, x);
        dev = Math.max(dev, Math.abs(y0 - (10 + t * x)));
        // slope error over 0.25 cells: a staircase has near-flat treads and steep risers
        kink = Math.max(kink, Math.abs((yAt(d, x + 0.25) - y0) / 0.25 - t));
      }
      return { dev, kink };
    };
    const r0 = stats(raw);
    const r1 = stats(sm);
    expect(r0.dev).toBeGreaterThan(0.4);
    expect(r1.dev).toBeLessThan(0.3);
    expect(r0.kink).toBeGreaterThan(1);
    expect(r1.kink).toBeLessThan(r0.kink / 3);
  });

  it('keeps the width of one- and two-cell paths at the 0.5 iso-line when normalised', () => {
    const cols = 30;
    const rows = 10;
    for (const wCells of [1, 2, 3]) {
      const d = smoothWeights(oneHot(cols, rows, (_r, c) => c >= 15 && c < 15 + wCells), cols, rows, 1, true);
      expect(d[(5 * cols + 15 + Math.floor(wCells / 2)) * 4]).toBeGreaterThan(128);
      const a = crossing(d, cols, rows, 5);
      let b = NaN;
      for (let x = a + 0.05; x < cols; x += 0.01)
        if (bilinear(d, cols, rows, x, 5) < 0.5) {
          b = x;
          break;
        }
      // two cells and more keep their width; a one-cell path stays visible but renders a little narrower
      if (wCells > 1) expect(Math.abs(b - a - wCells)).toBeLessThan(0.1);
      else expect(b - a).toBeGreaterThan(0.5);
      expect(Math.abs((a + b) / 2 - (15 + wCells / 2))).toBeLessThan(0.05);
    }
    // without the normalisation a one-cell path would fall below 0.5 and vanish
    const plain = smoothWeights(oneHot(cols, rows, (_r, c) => c === 15), cols, rows, 1, false);
    expect(plain[(5 * cols + 15) * 4]).toBeLessThan(128);
  });

  it('only touches the requested channels and is deterministic', () => {
    const src = oneHot(8, 8, (r, c) => r < 4 && c < 4);
    for (let i = 0; i < 64; i++) src[i * 4 + 2] = 77;
    const a = smoothWeights(src, 8, 8, 1, true, [0]);
    expect(Array.from({ length: 64 }, (_, i) => a[i * 4 + 2])).toEqual(new Array(64).fill(77));
    expect(smoothWeights(src, 8, 8, 1, true, [0])).toEqual(a);
  });
});

describe('bandEdge and erf', () => {
  it('erf matches known values; a wide band has its edge at 0.5, thin bands lower', () => {
    expect(erf(0)).toBeCloseTo(0, 7);
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
    expect(erf(-0.5)).toBeCloseTo(-0.5204999, 6);
    expect(bandEdge(1)).toBeCloseTo(0.5, 3);
    // one-cell band, sigma 1 cell: peak 0.383, edge value 0.341
    expect(bandEdge(0.3829)).toBeCloseTo(0.3413, 2);
    expect(bandEdge(0.2)).toBeLessThan(bandEdge(0.6));
  });
});

describe('groundDistances (bake distance channels)', () => {
  const C = GROUND_CLASS;
  // 2 m cells: a gravel path in column 10, a field from column 14, forest from column 24, water in row 0
  const cols = 30;
  const rows = 12;
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) ground[r * cols + c] = r === 0 ? C.water : c === 10 ? C.gravel : c >= 24 ? C.forest : c >= 14 ? C.field : C.meadow;
  const g: GroundGrid = { ground, cols, rows, cell: 2 };
  const d = groundDistances(g);
  const at = (r: number, c: number, ch: number) => d[(r * cols + c) * 4 + ch] / DIST_SCALE;

  it('measures metres to the hard surface, the forest and the water from the class edge', () => {
    expect(at(6, 11, 0)).toBe(1); // next cell: 2 m between centres, 1 m from the edge
    expect(at(6, 13, 0)).toBe(5);
    expect(at(6, 22, 1)).toBe(3);
    expect(at(3, 5, 3)).toBe(5);
    expect(at(6, 10, 0)).toBe(0);
  });

  it('measures inward from the edge of the cell’s own cultivated class and is 0 on meadow', () => {
    expect(at(6, 14, 2)).toBe(1);
    expect(at(6, 18, 2)).toBe(9);
    expect(at(6, 5, 2)).toBe(0);
  });

  it('is part of packGround and saturates at 255 (63.75 m)', () => {
    expect(packGround(g).dist).toEqual(d);
    const big = new Uint8Array(100 * 4).fill(0);
    big[0] = C.forest;
    const far = groundDistances({ ground: big.subarray(0, 400), cols: 400, rows: 1, cell: 2 });
    expect(far[399 * 4 + 1]).toBe(255);
  });
});

describe('hayParcel mirror of the bake warp', () => {
  it('stays deterministic and keeps the 50 / 28 / 22 % state shares', () => {
    const lat = noiseLattice(256, 1789);
    const n: Record<string, number> = { standing: 0, cut: 0, regrowth: 0 };
    const seen = new Set<string>();
    for (let x = -4000; x < 4000; x += 37)
      for (let z = -4000; z < 4000; z += 41) {
        const p = hayParcel(lat, x, z, [0.98629, -0.16505]);
        const k = p.id.join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        n[p.state]++;
      }
    const tot = n.standing + n.cut + n.regrowth;
    expect(tot).toBeGreaterThan(1500);
    expect(n.standing / tot).toBeCloseTo(0.5, 1);
    expect(n.cut / tot).toBeCloseTo(0.28, 1);
    expect(hayParcel(lat, 123.4, -567.8, [1, 0])).toEqual(hayParcel(lat, 123.4, -567.8, [1, 0]));
  });
});

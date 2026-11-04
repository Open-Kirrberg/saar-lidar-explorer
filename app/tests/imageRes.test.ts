import { describe, expect, it } from 'vitest';
import { imageGpuBytes } from '../src/terrain/budget';
import { imageTiers, resampleStrip, resizeTarget, screenPxPerMetre, tierFor } from '../src/terrain/imageRes';
import { apronImageUv } from '../src/terrain/imageSides';

describe('image decode tiers (perf pass)', () => {
  it('halves the native size down to the minimum', () => {
    expect(imageTiers(1000)).toEqual([1000, 500, 250, 125]);
    expect(imageTiers(500)).toEqual([500, 250, 125]);
    expect(imageTiers(300)).toEqual([300, 150]);
    expect(imageTiers(100)).toEqual([100]);
  });

  it('screen px per metre follows the perspective projection', () => {
    // 1080 px, 60° fov: 935.3 px per metre at 1 m → 1.87 px/m at 500 m.
    expect(screenPxPerMetre(1080, 60, 500)).toBeCloseTo(1080 / (2 * Math.tan(Math.PI / 6)) / 500, 9);
    expect(screenPxPerMetre(1080, 60, 0)).toBeCloseTo(935.3, 1); // clamped to 1 m
  });

  it('picks the smallest tier with ≥ 1 texel per screen px', () => {
    const t = imageTiers(1000);
    expect(tierFor(t, 1200)).toBe(1000); // more than native: native
    expect(tierFor(t, 1000)).toBe(1000);
    expect(tierFor(t, 501)).toBe(1000);
    expect(tierFor(t, 500)).toBe(500);
    expect(tierFor(t, 251)).toBe(500);
    expect(tierFor(t, 10)).toBe(125);
    expect(tierFor(t, Infinity)).toBe(1000);
  });

  it('level-0 ortho (2 px/m) on a 1800 px buffer at 1 texel/px: full res only within ≈ 1560 m', () => {
    const t = imageTiers(1000);
    const need = (d: number) => screenPxPerMetre(1800, 60, d) * 500;
    expect(tierFor(t, need(300))).toBe(1000);
    expect(tierFor(t, need(1550))).toBe(1000);
    expect(tierFor(t, need(1570))).toBe(500);
    expect(tierFor(t, need(3150))).toBe(250);
    // GPU bytes per tier (+ apron, mipmaps): ≈ 5.4 / 1.35 / 0.34 MB.
    expect(imageGpuBytes(1002) / 1e6).toBeCloseTo(5.35, 2);
    expect(imageGpuBytes(502) / 1e6).toBeCloseTo(1.34, 2);
    expect(imageGpuBytes(252) / 1e6).toBeCloseTo(0.34, 2);
  });

  it('resizes up at once, down with a 20 % band or straight to need under pressure', () => {
    const t = imageTiers(1000);
    expect(resizeTarget(t, 250, 600)).toBe(1000); // approaching: straight to the needed tier
    expect(resizeTarget(t, 500, 400)).toBeNull();
    expect(resizeTarget(t, 1000, 450)).toBeNull(); // want 500, but inside the band (> 400)
    expect(resizeTarget(t, 1000, 400)).toBe(500);
    expect(resizeTarget(t, 1000, 150)).toBe(250);
    expect(resizeTarget(t, 1000, 450, true)).toBe(500); // budget pressure: straight to need
    expect(resizeTarget(t, 1000, 100, true)).toBe(125);
    expect(resizeTarget(t, 125, 100, true)).toBeNull();
    // No oscillation: after a downgrade the need must exceed the new tier to go back up.
    expect(resizeTarget(t, 500, 499)).toBeNull();
    expect(resizeTarget(t, 500, 501)).toBe(1000);
    for (let need = 1; need < 1200; need += 7) {
      const down = resizeTarget(t, 1000, need);
      if (down !== null) expect(resizeTarget(t, down, need)).toBeNull(); // stable after one step
    }
  });
});

describe('resampleStrip (apron between decode tiers)', () => {
  const strip = (vals: number[]) => {
    const a = new Uint8ClampedArray(vals.length * 4);
    vals.forEach((v, k) => a.set([v, 255 - v, v >> 1, 255], 4 * k));
    return a;
  };
  const red = (a: Uint8ClampedArray) => [...a].filter((_, k) => k % 4 === 0);

  it('is the identity for equal sizes', () => {
    const s = strip([1, 2, 3]);
    expect(resampleStrip(s, 3, 3)).toBe(s);
  });

  it('box-averages when shrinking (incl. non-integer ratios)', () => {
    const s = strip([0, 20, 40, 60, 80, 100, 120, 140]);
    expect(red(resampleStrip(s, 8, 4))).toEqual([10, 50, 90, 130]);
    expect(red(resampleStrip(s, 8, 2))).toEqual([30, 110]);
    // 3 → 2: [0, 1.5) and [1.5, 3)
    expect(red(resampleStrip(strip([0, 30, 60]), 3, 2))).toEqual([10, 50]);
    // alpha stays opaque, other channels follow
    const out = resampleStrip(s, 8, 4);
    expect(out[3]).toBe(255);
    expect(out[1]).toBe(245);
  });

  it('interpolates between pixel centres when growing (half-pixel aligned)', () => {
    // f(u) = 80·u sampled at 4 centres (u = 0.125 …) → 8 centres (u = 0.0625 …), ends clamped.
    const s = strip([10, 30, 50, 70]);
    expect(red(resampleStrip(s, 4, 8))).toEqual([10, 15, 25, 35, 45, 55, 65, 70]);
  });

  it('down(up(x)) ≈ x', () => {
    const vals = Array.from({ length: 250 }, (_, k) => Math.round(128 + 100 * Math.sin(k / 9)));
    const back = red(resampleStrip(resampleStrip(strip(vals), 250, 1000), 1000, 250));
    for (let k = 1; k < 249; k++) expect(Math.abs(back[k] - vals[k])).toBeLessThanOrEqual(1);
  });

  /**
   * Seam check across two chunks decoded at different tiers: a smooth field f(x, y) over chunk A
   * (x ∈ [0, 1]) and its east neighbour B (x ∈ [1, 2]), each "decoded" as P² pixel-centre samples.
   * A's east apron (B's west column resampled to A's P) must equal f at the apron texel centre
   * apronImageUv says the shader samples there, up to the column offset between tiers.
   */
  it('apron from a neighbour at another tier matches the field at the apron texel', () => {
    const f = (x: number, y: number) => 60 + 40 * x + 100 * y; // 0…255 over the two chunks
    const westColumn = (x0: number, P: number) => strip(Array.from({ length: P }, (_, k) => f(x0 + 0.5 / P, (k + 0.5) / P)));
    for (const [PA, PB] of [
      [1000, 250],
      [250, 1000],
      [500, 500],
    ]) {
      const apron = red(resampleStrip(westColumn(1, PB), PB, PA));
      // The apron texel sits half a texel outside A's east edge: texture u = (P + 1.5)/(P + 2) ↔ chunk u.
      const uApron = ((PA + 1.5) / (PA + 2) * (PA + 2) - 1) / PA;
      expect(uApron).toBeCloseTo(1 + 0.5 / PA, 12);
      expect(apronImageUv(uApron, PA)).toBeCloseTo((PA + 1.5) / (PA + 2), 12);
      // x mismatch: B's first column centre (1 + 0.5/PB) vs A's apron centre (1 + 0.5/PA).
      const tolX = 40 * Math.abs(0.5 / PB - 0.5 / PA) + 1;
      for (const k of [1, 7, Math.floor(PA / 2), PA - 2]) {
        expect(Math.abs(apron[k] - f(uApron, (k + 0.5) / PA))).toBeLessThanOrEqual(tolX);
      }
    }
  });
});

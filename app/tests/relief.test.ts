import { describe, expect, it } from 'vitest';
import type { LayerSource } from '../src/data/manifest';
import {
  availableModes,
  blendColor,
  BlendMode,
  canopyRamp,
  Colormap,
  colorFor,
  defaultColormap,
  defaultStretch,
  diverging,
  legendGradient,
  MODE_TABLE,
  normalise,
  percentileSorted,
  percentileStretch,
  PRESETS,
  sourceRange,
  viridis,
} from '../src/terrain/relief';

const layer = (min: number, max: number, extra: Partial<LayerSource> = {}): LayerSource => ({
  path: 'x/{i}_{j}.png',
  encoding: 'u8',
  min,
  max,
  ...extra,
});

describe('percentile stretch', () => {
  const ramp = Float32Array.from({ length: 101 }, (_, k) => k); // 0..100

  it('interpolates percentiles of a sorted array', () => {
    expect(percentileSorted(ramp, 0)).toBe(0);
    expect(percentileSorted(ramp, 100)).toBe(100);
    expect(percentileSorted(ramp, 50)).toBe(50);
    expect(percentileSorted([0, 10], 25)).toBeCloseTo(2.5);
    expect(Number.isNaN(percentileSorted([], 50))).toBe(true);
  });

  it('clips the requested tails', () => {
    const r = percentileStretch(ramp, { low: 2, high: 98 })!;
    expect(r.lo).toBeCloseTo(2);
    expect(r.hi).toBeCloseTo(98);
    expect(r.count).toBe(101);
  });

  it('ignores NaN / infinite values (sky, missing layers)', () => {
    const v = new Float32Array(200).fill(NaN);
    v.set(ramp, 50);
    v[0] = Infinity;
    const r = percentileStretch(v, { low: 0, high: 100 })!;
    expect(r).toMatchObject({ lo: 0, hi: 100, count: 101 });
  });

  it('is symmetric about 0 for diverging data', () => {
    const v = Float32Array.from({ length: 100 }, (_, k) => -0.2 + (k / 99) * 1.2); // −0.2 … 1.0
    const r = percentileStretch(v, { low: 0, high: 100, symmetric: true })!;
    expect(r.lo).toBeCloseTo(-1);
    expect(r.hi).toBeCloseTo(1);
  });

  it('returns null for too few or constant values', () => {
    expect(percentileStretch(new Float32Array(10))).toBeNull();
    expect(percentileStretch(new Float32Array(100).fill(3))).toBeNull();
  });

  it('subsamples large inputs', () => {
    const big = Float32Array.from({ length: 1_000_000 }, (_, k) => k / 1e6);
    const r = percentileStretch(big, { low: 10, high: 90, maxSamples: 10_000 })!;
    expect(r.count).toBeLessThanOrEqual(10_000);
    expect(r.lo).toBeCloseTo(0.1, 2);
    expect(r.hi).toBeCloseTo(0.9, 2);
  });
});

describe('colormap ranges', () => {
  it('normalises sequential maps to [0, 1] and clamps', () => {
    const st = { lo: 10, hi: 20, gamma: 1 };
    expect(normalise(10, st, Colormap.Gray)).toBe(0);
    expect(normalise(20, st, Colormap.Gray)).toBe(1);
    expect(normalise(15, st, Colormap.Gray)).toBeCloseTo(0.5);
    expect(normalise(-5, st, Colormap.Gray)).toBe(0);
    expect(normalise(99, st, Colormap.Gray)).toBe(1);
  });

  it('applies gamma as t^(1/γ)', () => {
    expect(normalise(0.25, { lo: 0, hi: 1, gamma: 2 }, Colormap.Gray)).toBeCloseTo(0.5);
  });

  it('centres diverging maps on physical 0, each side scaled separately', () => {
    const st = { lo: -0.5, hi: 2, gamma: 1 };
    expect(normalise(0, st, Colormap.Diverging)).toBe(0);
    expect(normalise(-0.5, st, Colormap.Diverging)).toBe(-1);
    expect(normalise(-0.25, st, Colormap.Diverging)).toBeCloseTo(-0.5);
    expect(normalise(1, st, Colormap.Diverging)).toBeCloseTo(0.5);
    expect(normalise(5, st, Colormap.Diverging)).toBe(1);
    // Gamma keeps the sign.
    expect(normalise(-0.125, { lo: -0.5, hi: 0.5, gamma: 2 }, Colormap.Diverging)).toBeCloseTo(-0.5);
  });

  it('maps endpoints to the expected colours', () => {
    const st = { lo: 0, hi: 1, gamma: 1 };
    expect(colorFor(0, st, Colormap.Gray)).toEqual([0, 0, 0]);
    expect(colorFor(1, st, Colormap.GrayInv)).toEqual([0, 0, 0]);
    expect(diverging(0)[0]).toBeGreaterThan(0.9); // near white
    expect(diverging(-1)[2]).toBeGreaterThan(diverging(-1)[0]); // blue
    expect(diverging(1)[0]).toBeGreaterThan(diverging(1)[2]); // red
    const v0 = viridis(0);
    const v1 = viridis(1);
    expect(v0[2]).toBeGreaterThan(v0[1]); // dark purple
    expect(v1[0]).toBeGreaterThan(0.9); // yellow
    expect(canopyRamp(1)[1]).toBeLessThan(canopyRamp(0)[1]); // tall = darker green
  });

  it('colours the mask categorically', () => {
    const st = { lo: 0, hi: 1, gamma: 1 };
    const a = colorFor(0, st, Colormap.Mask);
    const b = colorFor(0.5, st, Colormap.Mask);
    const c = colorFor(1, st, Colormap.Mask);
    expect(new Set([a, b, c].map((x) => x.join())).size).toBe(3);
  });

  it('builds a CSS legend gradient', () => {
    const g = legendGradient({ lo: -1, hi: 1, gamma: 1 }, Colormap.Diverging, 4);
    expect(g.startsWith('linear-gradient(90deg,')).toBe(true);
    expect(g.match(/rgb\(/g)).toHaveLength(5);
  });
});

describe('modes & defaults', () => {
  it('has unique shortcuts 1–9, 0', () => {
    const keys = MODE_TABLE.map((m) => m.shortcut);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  });

  it('hides manifest layers that are missing', () => {
    const modes = availableModes({ vat: layer(0, 1), slrm: layer(-2, 2) }).map((m) => m.key);
    expect(modes).toEqual(['vat', 'live-hillshade', 'live-slope', 'slrm', 'live-lrm']);
  });

  it('derives colormaps and stretches from the manifest', () => {
    expect(defaultColormap('slrm', layer(-2.1, 2.1))).toBe(Colormap.Diverging);
    expect(defaultColormap('chm', layer(0, 40))).toBe(Colormap.Canopy);
    expect(defaultColormap('mask', layer(0, 1))).toBe(Colormap.Mask);
    expect(defaultColormap('opns_neg', layer(75, 92))).toBe(Colormap.GrayInv);
    expect(defaultColormap('svf', layer(0.7, 1))).toBe(Colormap.Gray);
    const s = defaultStretch('slrm', layer(-2.1, 2.1));
    expect(s.lo).toBeCloseTo(-0.63);
    expect(s.hi).toBeCloseTo(0.63);
    expect(defaultStretch('svf', layer(0.71, 1))).toEqual({ lo: 0.71, hi: 1, gamma: 1 });
    expect(sourceRange('opns_pos', layer(74, 92, { unit: 'deg' }))).toEqual({ min: 74, max: 92, unit: '°' });
  });

  it('presets reference known modes', () => {
    const keys = new Set(MODE_TABLE.map((m) => m.key));
    for (const p of PRESETS) {
      expect(keys.has(p.base)).toBe(true);
      if (p.overlay) expect(keys.has(p.overlay.key)).toBe(true);
    }
  });
});

describe('blend modes', () => {
  it('behaves like the usual image-editor modes', () => {
    expect(blendColor(0.3, 0.8, BlendMode.Normal)).toBe(0.8);
    expect(blendColor(0.5, 0.5, BlendMode.Multiply)).toBe(0.25);
    expect(blendColor(0.5, 0.5, BlendMode.Screen)).toBe(0.75);
    // Multiply / soft light with white / mid-grey leave the base unchanged.
    expect(blendColor(0.42, 1, BlendMode.Multiply)).toBeCloseTo(0.42);
    expect(blendColor(0.42, 0.5, BlendMode.SoftLight)).toBeCloseTo(0.42);
    expect(blendColor(0.2, 0.5, BlendMode.Overlay)).toBeCloseTo(0.2);
  });
});

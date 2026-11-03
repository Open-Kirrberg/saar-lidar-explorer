/**
 * Wave 9 (garden): the near-camera grass blades (viewer/src/grassBlades.ts), pure parts.
 */
import { describe, expect, it } from 'vitest';
import { GRASS_SWARD } from '@model/layout/grammar.ts';
import { GRASS, LAWN_SHADE, TUFT_TILES, discLattice, fillGrassWindow, grassClassWeights, grassTuftAtlas, keepShare, triHeight, tuftCoverage, tuftHeadShare, tuftShade } from '../src/grassBlades.ts';
import { GROUND_CLASS } from '../src/landcover.ts';

describe('grass blade field', () => {
  it('keeps every tuft near the camera and thins with (dense / d)² beyond, widening the survivors', () => {
    expect(keepShare(2)).toEqual({ keep: 1, widen: 1 });
    expect(keepShare(GRASS.dense).keep).toBe(1);
    const k = keepShare(GRASS.dense * 2);
    expect(k.keep).toBeCloseTo(0.25, 6);
    expect(k.widen).toBeCloseTo(2, 6);
    expect(keepShare(1000).keep).toBe(0.04);
    expect(keepShare(1000).widen).toBeLessThanOrEqual(2.5);
  });

  it('lays the lattice farthest first (painter order for the alpha cards), covering the disc once', () => {
    const r = 3;
    const s = 0.5;
    const L = discLattice(r, s);
    const seen = new Set<string>();
    let last = Infinity;
    for (let k = 0; k < L.length / 2; k++) {
      const d = Math.hypot(L[k * 2], L[k * 2 + 1]) * s;
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      expect(d).toBeLessThanOrEqual(r + s);
      last = d;
      seen.add(`${L[k * 2]},${L[k * 2 + 1]}`);
    }
    expect(seen.size).toBe(L.length / 2);
    expect(L[L.length - 2]).toBe(0);
    expect(L[L.length - 1]).toBe(0);
    expect(discLattice(r, s)).toEqual(L);
  });

  it('samples the terrain mesh triangle by triangle (diagonal (col + 1, row) to (col, row + 1)), NaN outside', () => {
    // 2 x 2 cells of 1 m, cell centres at local x = 0.5, 1.5 and z = 0.5, 1.5 (north row first)
    const grid = { west: 0, north: 2, cell: 1, cols: 2, rows: 2 };
    const h = [0, 1, 1, 0]; // saddle: the diagonal decides the height in the middle
    const at = (x: number, z: number) => triHeight(h, grid, 0, 0, x, z);
    // local z = −(N − N0): row 0 (N 1.5) is z = −1.5
    expect(at(0.5, -1.5)).toBeCloseTo(0, 9);
    expect(at(1.5, -1.5)).toBeCloseTo(1, 9);
    expect(at(0.5, -0.5)).toBeCloseTo(1, 9);
    // the centre lies on the diagonal from (col 1, row 0) to (col 0, row 1), both at height 1
    expect(at(1.0, -1.0)).toBeCloseTo(1, 9);
    expect(at(1.2, -0.8)).toBeCloseTo(0.6, 9); // lower-right triangle toward (col 1, row 1) = 0
    expect(at(-1, -1)).toBeNaN();
  });

  it('draws blades on lawn and meadow / hay only', () => {
    expect(grassClassWeights(GROUND_CLASS.lawn)).toEqual([1, 0]);
    expect(grassClassWeights(GROUND_CLASS.meadow)).toEqual([0, 1]);
    expect(grassClassWeights(GROUND_CLASS.hay)).toEqual([0, 1]);
    for (const c of [GROUND_CLASS.gravel, GROUND_CLASS.sand, GROUND_CLASS.water, GROUND_CLASS.forest, GROUND_CLASS.building, GROUND_CLASS.field, GROUND_CLASS.parterre_sand])
      expect(grassClassWeights(c)).toEqual([0, 0]);
  });

  it('fills the window with height, class weights and a walk mask that frees the tread', () => {
    const cols = 20;
    const rows = 20;
    const t = {
      h: new Float32Array(cols * rows).fill(300),
      grid: { west: 0, north: 20, cell: 1, cols, rows },
      ground: new Uint8Array(10 * 10).fill(GROUND_CLASS.lawn),
      gcell: 2,
      gcols: 10,
      grows: 10,
      E0: 0,
      N0: 0,
    };
    const n = 8;
    const out = new Float32Array(n * n * 4);
    // a 1 m walk along x at z = −10
    fillGrassWindow(out, n, 2, -14, 1, t, [{ line: [[-5, -10], [30, -10]], width: 1 }]);
    const px = (i: number, j: number) => out.subarray((j * n + i) * 4, (j * n + i) * 4 + 4);
    expect(px(3, 3)[0]).toBeCloseTo(300, 6);
    expect(px(3, 3)[1]).toBeCloseTo(1, 6);
    expect(px(3, 3)[2]).toBeCloseTo(0, 6);
    expect(px(3, 3)[3]).toBe(0); // texel centre z = −10.5: on the tread
    expect(px(3, 7)[3]).toBe(1); // z = −6.5: well off it
  });

  it('builds a deterministic tuft atlas with sparse lawn and meadow tufts', () => {
    const tw = 128;
    const th = 64;
    const a = grassTuftAtlas(tw, th);
    expect(grassTuftAtlas(tw, th)).toEqual(a);
    const lawn = tuftCoverage(a, tw, th, 0);
    const meadow = tuftCoverage(a, tw, th, 1);
    expect(lawn).toBeGreaterThan(0.05);
    expect(lawn).toBeLessThan(0.6);
    expect(meadow).toBeGreaterThan(0.05);
    expect(meadow).toBeLessThan(0.6);
  });

  it('KB-I78: lawn tufts stay within about ±8 % of the ground albedo (no dark bases), the meadow keeps its self-shading', () => {
    const tw = 128;
    const th = 64;
    const a = grassTuftAtlas(tw, th);
    const lawn = tuftShade(a, tw, th, 0);
    const meadow = tuftShade(a, tw, th, 1);
    expect(lawn.min).toBeGreaterThanOrEqual(0.9);
    expect(lawn.mean).toBeGreaterThan(0.93);
    expect(meadow.min).toBeLessThan(lawn.min);
    for (const c of LAWN_SHADE) expect(Math.abs(c - 1)).toBeLessThanOrEqual(0.08);
    expect(GRASS.lawnJitter).toBeLessThanOrEqual(0.08);
    // the disc edge dissolves over the last 6-8 m, per pixel
    expect(GRASS.feather).toBeGreaterThanOrEqual(6);
    expect(GRASS.feather).toBeLessThanOrEqual(8);
    // lawn cards half as wide as before (3.4), and the lawn tufts stop well inside the disc (retina cost)
    expect(GRASS_SWARD.lawn.card).toBeLessThanOrEqual(1.7);
    expect(GRASS.lawnRadius).toBeLessThan(GRASS.radius);
    expect(GRASS.lawnFeather).toBeLessThan(GRASS.lawnRadius);
  });

  it('takes its sward heights from the grammar (lawn short, meadow taller)', () => {
    expect(GRASS_SWARD.lawn.height[1]).toBeLessThan(GRASS_SWARD.meadow.height[1]);
    expect(GRASS_SWARD.lawn.height[0]).toBeGreaterThan(0.02);
    expect(GRASS_SWARD.meadow.height[1]).toBeLessThan(0.3);
  });
  it('wave-10 review fix: a third tile of seeding culms with marked panicles; the lawn and meadow tiles carry no marker', () => {
    const tw = 128;
    const th = 64;
    const a = grassTuftAtlas(tw, th);
    expect(a.length).toBe(tw * TUFT_TILES * th * 4);
    expect(tuftHeadShare(a, tw, th, 0)).toBe(0);
    expect(tuftHeadShare(a, tw, th, 1)).toBe(0);
    const heads = tuftHeadShare(a, tw, th, 2);
    expect(heads).toBeGreaterThan(0.03);
    expect(heads).toBeLessThan(0.6);
    // sparse culms: less coverage than the meadow tile
    expect(tuftCoverage(a, tw, th, 2)).toBeGreaterThan(0.02);
    expect(tuftCoverage(a, tw, th, 2)).toBeLessThan(tuftCoverage(a, tw, th, 1));
    // seeding grass stands well above the aftermath sward, windrows above the stubble
    expect(GRASS_SWARD.seeding.height[0]).toBeGreaterThan(GRASS_SWARD.meadow.height[1]);
    expect(GRASS_SWARD.windrow.height[0]).toBeGreaterThan(GRASS_SWARD.stubble.height[1]);
    expect(GRASS.seedShare).toBeLessThan(0.3);
    expect(GRASS.windrowRadius).toBeGreaterThan(GRASS.lawnRadius);
    expect(GRASS.windrowRadius).toBeLessThan(GRASS.radius);
  });
});

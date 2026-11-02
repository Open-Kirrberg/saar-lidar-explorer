import { describe, expect, it } from 'vitest';
import { SLEP_HEADER_BYTES, SLEP_OFFSET, SLEP_RECORD_BYTES, parseSlepHeader } from '../src/data/manifest';
import {
  DEFAULT_LOD,
  allocatePoints,
  desiredFraction,
  distanceToBox,
  distanceToRect,
  planStreaming,
  pointSpacing,
} from '../src/pointcloud/lod';
import type { LodTile } from '../src/pointcloud/lod';
import { SLEP_WORDS, aglFromWord, decodeSlep, encodeSlep, readSlepPoint, slepClassCounts } from '../src/pointcloud/slep';
import type { SlepPoint } from '../src/pointcloud/slep';
import {
  DEFAULT_PREFS,
  classColor,
  formatPoints,
  heightRangeOf,
  OTHER_CLASS_COLOR,
  parsePrefs,
  presentClasses,
} from '../src/pointcloud/style';
import { FIXTURE } from '../scripts/fixture-terrain';
import { FIXTURE_POINT_AREAS, bilinearDtm, fixturePointTiles } from '../scripts/fixture-points';

const pts: SlepPoint[] = [
  { dE: 0, dN: 0, h: 312.345, agl: 0.02, cls: 2, intensity: 120 },
  { dE: 99.99, dN: 50.5, h: 340.1, agl: 27.75, cls: 20, intensity: 33 },
  { dE: 12.34, dN: 99.99, h: 311.2, agl: -1.25, cls: 6, intensity: 255 },
  { dE: 50, dN: 50, h: 315, agl: -327.67, cls: 30, intensity: 0 },
];

describe('sle-pts-v1 codec', () => {
  it('round-trips records at cm precision with hBase floored to 0.01 m', () => {
    const buf = encodeSlep(pts);
    expect(buf.byteLength).toBe(SLEP_HEADER_BYTES + SLEP_RECORD_BYTES * pts.length);
    const t = decodeSlep(buf);
    expect(t.count).toBe(4);
    expect(t.hBase).toBeCloseTo(311.2, 4);
    expect(t.words.length).toBe(4 * SLEP_WORDS);
    pts.forEach((p, k) => {
      const q = readSlepPoint(t, k);
      expect(q.dE).toBeCloseTo(p.dE, 2);
      expect(q.dN).toBeCloseTo(p.dN, 2);
      expect(Math.abs(q.h - p.h)).toBeLessThan(0.006);
      expect(q.agl).toBeCloseTo(p.agl, 2);
      expect(q.cls).toBe(p.cls);
      expect(q.intensity).toBe(p.intensity);
    });
  });

  it('matches the contract byte layout (little-endian, i16 agl at +6)', () => {
    const buf = encodeSlep(pts);
    const dv = new DataView(buf);
    const o = SLEP_HEADER_BYTES + SLEP_RECORD_BYTES * 2; // third record
    expect(dv.getUint16(o + SLEP_OFFSET.x, true)).toBe(1234);
    expect(dv.getUint16(o + SLEP_OFFSET.y, true)).toBe(9999);
    expect(dv.getUint16(o + SLEP_OFFSET.h, true)).toBe(0);
    expect(dv.getInt16(o + SLEP_OFFSET.agl, true)).toBe(-125);
    expect(dv.getUint8(o + SLEP_OFFSET.cls)).toBe(6);
    expect(dv.getUint8(o + SLEP_OFFSET.intensity)).toBe(255);
    expect(parseSlepHeader(buf)).toEqual({ count: 4, hBase: Math.fround(311.2) });
  });

  it('GPU view: word 3 is the i16 agl seen as u16, word 4 = cls | intensity << 8', () => {
    const t = decodeSlep(encodeSlep(pts));
    expect(t.words[3 * SLEP_WORDS + 3]).toBe(65536 - 32767);
    expect(aglFromWord(t.words[3 * SLEP_WORDS + 3])).toBe(-32767);
    expect(aglFromWord(125)).toBe(125);
    expect(t.words[1 * SLEP_WORDS + 4]).toBe(20 | (33 << 8));
  });

  it('views the body without copying and rejects malformed tiles', () => {
    const buf = encodeSlep(pts);
    const t = decodeSlep(buf);
    expect(t.words.buffer).toBe(buf);
    expect(t.words.byteOffset).toBe(16);
    expect(() => decodeSlep(buf.slice(0, buf.byteLength - 1))).toThrow();
    const bad = buf.slice(0);
    new Uint8Array(bad)[0] = 0x58;
    expect(() => decodeSlep(bad)).toThrow(/magic/);
  });

  it('drops points more than 655.35 m above hBase; empty tile is valid', () => {
    const t = decodeSlep(encodeSlep([...pts, { dE: 1, dN: 1, h: 311.2 + 700, agl: 0, cls: 1, intensity: 0 }]));
    expect(t.count).toBe(4);
    expect(decodeSlep(encodeSlep([])).count).toBe(0);
  });

  it('counts classes over a prefix', () => {
    const t = decodeSlep(encodeSlep(pts));
    expect(Object.fromEntries(slepClassCounts(t))).toEqual({ 2: 1, 20: 1, 6: 1, 30: 1 });
    expect(Object.fromEntries(slepClassCounts(t, 2))).toEqual({ 2: 1, 20: 1 });
  });
});

describe('point LOD + budget', () => {
  it('distances to boxes and rectangles', () => {
    const b = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 5, maxZ: 10 };
    expect(distanceToBox(5, 2, 5, b)).toBe(0);
    expect(distanceToBox(13, 9, 5, b)).toBe(5);
    expect(distanceToRect(-3, -4, 0, 10, 0, 10)).toBe(5);
  });

  it('wanted fraction: full up close, ∝ 1/d² further out, floored', () => {
    const p = { fullDetailDist: 100, minFraction: 0.05 };
    expect(desiredFraction(50, p)).toBe(1);
    expect(desiredFraction(200, p)).toBeCloseTo(0.25);
    expect(desiredFraction(10_000, p)).toBe(0.05);
  });

  it('fits the budget, thins every tile alike, never exceeds a tile', () => {
    const tiles: LodTile[] = [
      { count: 40_000, dist: 50, visible: true },
      { count: 40_000, dist: 400, visible: true },
      { count: 40_000, dist: 400, visible: true },
      { count: 40_000, dist: 10, visible: false },
    ];
    const n = allocatePoints(tiles, { budget: 30_000, fullDetailDist: 100, minFraction: 0.01 });
    expect(n.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(30_000);
    expect(n.reduce((s, x) => s + x, 0)).toBeGreaterThan(29_990);
    expect(n[3]).toBe(0);
    expect(n[1]).toBe(n[2]); // same distance → same density
    expect(n[0] / n[1]).toBeCloseTo(16, 0); // (400/100)² ratio kept
  });

  it('spends a spare budget on far tiles until full', () => {
    const tiles: LodTile[] = [
      { count: 1000, dist: 10, visible: true },
      { count: 1000, dist: 1000, visible: true },
    ];
    expect(allocatePoints(tiles, { budget: 1500, fullDetailDist: 100, minFraction: 0.01 })).toEqual([1000, 500]);
    expect(allocatePoints(tiles, { budget: 1e6, fullDetailDist: 100, minFraction: 0.01 })).toEqual([1000, 1000]);
  });

  it('handles zero budget / empty input / default params', () => {
    expect(allocatePoints([], DEFAULT_LOD)).toEqual([]);
    const n = allocatePoints([{ count: 10, dist: 1, visible: true }, { count: 10, dist: 1, visible: true }], { ...DEFAULT_LOD, budget: 1 });
    expect(n.reduce((s, x) => s + x, 0)).toBe(1);
    expect(allocatePoints([{ count: 10, dist: 1, visible: true }], { ...DEFAULT_LOD, budget: 0 })).toEqual([0]);
  });

  it('point spacing grows as the subsample thins', () => {
    expect(pointSpacing(100, 40_000)).toBeCloseTo(0.5);
    expect(pointSpacing(100, 10_000)).toBeCloseTo(1);
    expect(pointSpacing(100, 0)).toBe(100);
  });

  it('streaming plan: nearest first within the load radius, dispose beyond the dispose radius', () => {
    const t = (key: string, dist: number, s: Partial<{ resident: boolean; loading: boolean; failed: boolean }> = {}) => ({
      key,
      dist,
      resident: false,
      loading: false,
      failed: false,
      ...s,
    });
    const plan = planStreaming(
      [t('far', 1400), t('b', 300), t('a', 100), t('c', 900), t('res', 50, { resident: true }), t('bad', 10, { failed: true }), t('gone', 1600, { resident: true }), t('fly', 1700, { loading: true }), t('edge', 1450, { resident: true })],
      1300,
      1500,
      2,
    );
    expect(plan.load).toEqual(['a', 'b']);
    expect(plan.dispose).toEqual(['gone', 'fly']);
  });

  it('streaming plan: residency cap disposes the farthest tiles and stops loading near the cap', () => {
    const t = (key: string, dist: number, count: number, resident = false) => ({ key, dist, count, resident, loading: false, failed: false });
    // cap 100: running sums 40 (r1), 80 (n1), 120 (r2) → r2 over cap; n2 (160) not loaded.
    const plan = planStreaming([t('r2', 300, 40, true), t('n2', 400, 40), t('r1', 10, 40, true), t('n1', 50, 40)], 1300, 1500, 4, 100);
    expect(plan.load).toEqual(['n1']);
    expect(plan.dispose).toEqual(['r2']);
    // Hysteresis: a tile that brings the sum to 95 (> 0.9 · cap) is kept if resident but not loaded.
    const keep = planStreaming([t('a', 10, 50, true), t('b', 20, 45, true)], 1300, 1500, 4, 100);
    expect(keep.dispose).toEqual([]);
    const noLoad = planStreaming([t('a', 10, 50, true), t('b', 20, 45)], 1300, 1500, 4, 100);
    expect(noLoad.load).toEqual([]);
    // The nearest tile is always allowed, even if alone over the cap; farthest over-cap first.
    const big = planStreaming([t('x', 5, 500), t('y', 9, 60, true), t('z', 30, 60, true)], 1300, 1500, 4, 100);
    expect(big.load).toEqual(['x']);
    expect(big.dispose).toEqual(['z', 'y']);
  });
});

describe('point styles + prefs', () => {
  it('class palette with a fallback colour', () => {
    expect(classColor(2)).not.toEqual(classColor(20));
    expect(classColor(99)).toEqual(OTHER_CLASS_COLOR);
  });

  it('offers the classes present in the areas (or the whole table)', () => {
    const table = { '2': 'Boden', '6': 'Gebäude', '20': 'Sonstige' };
    expect(presentClasses([{ classCounts: { '20': 5, '2': 3, '9': 0, x: 1 } }, {}], table)).toEqual([2, 20]);
    expect(presentClasses([{}], table)).toEqual([2, 6, 20]);
  });

  it('parses stored prefs tolerantly', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ on: true, mode: 'agl', hidden: [20, 20, -1, 'x', 300, 2], budget: 99e6, size: 0.1, aglMax: 2, hideTerrain: 1 })).toEqual({
      ...DEFAULT_PREFS,
      on: true,
      mode: 'agl',
      hidden: [20, 2],
      budget: 8_000_000,
      budgetUser: true, // legacy prefs: 99 M is no preset value → the user's own
      size: 0.5,
      aglMax: 2,
    });
    // v1.0 prefs without the flag: a preset value stays preset-controlled.
    expect(parsePrefs({ budget: 2_000_000 }).budgetUser).toBe(false);
    expect(parsePrefs({ budget: 2_500_000 }).budgetUser).toBe(true);
    expect(parsePrefs({ budget: 2_500_000, budgetUser: false }).budgetUser).toBe(false);
    expect(parsePrefs({ mode: 'bogus', aglMax: null }).mode).toBe('class');
    expect(parsePrefs({ aglMax: null }).aglMax).toBeNull();
  });

  it('German point counts and height ranges', () => {
    expect(formatPoints(3_000_000)).toBe('3 Mio.');
    expect(formatPoints(3_450_000)).toBe('3,5 Mio.');
    expect(formatPoints(820_400)).toBe('820 Tsd.');
    expect(formatPoints(940)).toBe('940');
    expect(heightRangeOf([{ heightRange: { min: 290, max: 330 } }, { heightRange: { min: 280, max: 300 } }], { min: 0, max: 1 })).toEqual({ min: 280, max: 330 });
    expect(heightRangeOf([{}], { min: 0, max: 1 })).toEqual({ min: 0, max: 1 });
  });
});

describe('fixture point clouds', () => {
  it('ground points sit on the DTM (agl ≈ 0) and agl matches h − bilinear DTM', () => {
    // A planar DTM stand-in (agl is checked against whatever raster the generator gets).
    const W = FIXTURE.width;
    const H = FIXTURE.height;
    const dtm = new Float32Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) dtm[r * W + c] = 300 + 0.01 * c - 0.02 * r;
    const tiles = fixturePointTiles({ ...FIXTURE_POINT_AREAS[0], u1: 200, v1: 200 }, dtm);
    expect(tiles).toHaveLength(1);
    const t = decodeSlep(tiles[0].buf);
    expect(t.count).toBe(tiles[0].count);
    expect(t.count).toBeGreaterThan(37_000);
    for (let k = 0; k < 500; k++) {
      const p = readSlepPoint(t, k);
      const u = 100 + p.dE;
      const v = 100 + p.dN;
      expect(Math.abs(p.h - bilinearDtm(dtm, W, H, u, v) - p.agl)).toBeLessThan(0.02);
    }
  });

  it('bilinear DTM sample hits cell centres exactly (PixelIsArea)', () => {
    const W = 3;
    const H = 2;
    const dtm = Float32Array.from([1, 2, 3, 4, 5, 6]); // row 0 = north
    expect(bilinearDtm(dtm, W, H, 0.5, 1.5)).toBe(1); // NW cell centre
    expect(bilinearDtm(dtm, W, H, 2.5, 0.5)).toBe(6); // SE cell centre
    expect(bilinearDtm(dtm, W, H, 1, 1)).toBeCloseTo(3); // between four centres
  });
});

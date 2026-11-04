/**
 * Wave 10 (garden, audit #1): mowing zones of Petri's lawn (viewer/src/lawnZones.ts): a close-mown pleasure ground
 * near the house and along the walks, an aftermath hay meadow beyond.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '@model/catalogue.ts';
import { PLEASURE_GROUND } from '@model/layout/grammar.ts';
import { siteFeatures } from '@model/site/access.ts';
import { GROUND_CLASS } from '../src/landcover.ts';
import { ZONE_RANGE, encodeZone, inRing, lawnZoneField, lawnZoneInput, lineDistance, ringArea, ringDistance } from '../src/lawnZones.ts';
import { GARDEN } from '@model/layout/grammar.ts';
import { gridFrame } from '@model/frame.ts';

const C = GROUND_CLASS;

/** 100 × 60 m lawn (2 m cells) with a gravel walk along row 10 and a terrace ring at its W end. */
function toy() {
  const cols = 60;
  const rows = 40;
  const ground = new Uint8Array(cols * rows).fill(C.lawn);
  for (let c = 0; c < cols; c++) ground[10 * cols + c] = C.gravel;
  // another lawn beyond the outline (a parterre panel): rows 36..39
  const g = { ground, cols, rows, cell: 2, x0: 1, z0: 1 };
  const lawn: [number, number][] = [
    [0, 0],
    [120, 0],
    [120, 70],
    [0, 70],
  ];
  const terrace: [number, number][] = [
    [0, 30],
    [6, 30],
    [6, 60],
    [0, 60],
  ];
  return { g, lawn, terrace };
}

describe('lawn mowing zones', () => {
  it('geometry helpers', () => {
    const sq: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(inRing(5, 5, sq)).toBe(true);
    expect(inRing(15, 5, sq)).toBe(false);
    expect(ringDistance(5, 5, sq)).toBe(0);
    expect(ringDistance(13, 5, sq)).toBeCloseTo(3, 9);
    expect(ringArea(sq)).toBe(100);
    expect(encodeZone(0)).toBe(128);
    expect(encodeZone(-100)).toBe(0);
    expect(encodeZone(100)).toBe(255);
    expect(encodeZone(-2)).toBe(112);
  });

  it('mows the verge along a walk and the band beyond the terrace; the open lawn beyond is meadow', () => {
    const { g, lawn, terrace } = toy();
    const f = lawnZoneField(g, { lawn, rings: [{ ring: terrace, band: 22 }], walkVerge: 3.5 });
    const at = (x: number, z: number) => f[Math.round((z - g.z0) / g.cell) * g.cols + Math.round((x - g.x0) / g.cell)];
    // walk at z = 21 (row 10): its boundary 1 m off the centre; 3.5 m verge → mown to ≈ 4.5 m off the centre
    expect(at(81, 25)).toBeLessThan(0);
    expect(at(81, 29)).toBeGreaterThan(0);
    // terrace band: 22 m beyond x = 6
    expect(at(25, 45)).toBeLessThan(0);
    expect(at(33, 45)).toBeGreaterThan(0);
    // far out on the open lawn: meadow, clamped to the encoding range
    expect(at(101, 55)).toBeGreaterThan(10);
    expect(Math.max(...f)).toBeLessThanOrEqual(ZONE_RANGE);
  });

  it('keeps other lawns close-mown and leaves cells outside the bounding box mown', () => {
    const { g, lawn, terrace } = toy();
    const small = lawn.map(([x, z]) => [x * 0.5, z * 0.5] as [number, number]);
    const f = lawnZoneField(g, { lawn: small, rings: [{ ring: terrace, band: 22 }] });
    // a lawn cell outside the outline (x 101, z 55)
    expect(f[27 * g.cols + 50]).toBe(-ZONE_RANGE);
  });

  it("finds Petri's lawn, its garden terrace, the basin's rondell and the benches in the catalogue", () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../model/catalogue.json'), 'utf8'));
    const { spec } = loadSite(raw);
    const feats = siteFeatures(spec, 1789);
    const z = lawnZoneInput(feats)!;
    expect(z).not.toBeNull();
    expect(ringArea(z.lawn)).toBeGreaterThan(PLEASURE_GROUND.minArea);
    // HG-01 is the only lawn of that size
    const big = feats.filter((f) => f.kind === 'lawn' && f.geometry.type === 'Polygon');
    expect(big.length).toBeGreaterThan(1);
    expect(z.rings.filter((r) => r.band === PLEASURE_GROUND.frontBand).length).toBeGreaterThanOrEqual(1); // TF-09
    expect(z.rings.some((r) => r.band === PLEASURE_GROUND.rondell)).toBe(true); // HG-05
    expect(z.spots!.length).toBeGreaterThanOrEqual(10); // HG-40 benches + HG-41 herm
    for (const s of z.spots!) expect(inRing(s.x, s.z, z.lawn)).toBe(true);
  });
  it('wave-10 review fix: mows a verge along the draped walks the class raster paints over with lawn', () => {
    const { g, lawn } = toy();
    g.ground.fill(C.lawn); // no gravel row: the walk lives only as a draped ribbon
    const walk = { line: [[0, 41], [120, 41]] as [number, number][], width: 3 };
    const without = lawnZoneField(g, { lawn, rings: [], walkVerge: 3.5 });
    const f = lawnZoneField(g, { lawn, rings: [], walkVerge: 3.5, walks: [walk] });
    const at = (a: Float32Array, x: number, z: number) => a[Math.round((z - g.z0) / g.cell) * g.cols + Math.round((x - g.x0) / g.cell)];
    expect(at(without, 61, 45)).toBeGreaterThan(0); // no verge without the walk line
    // 1.5 m half width + 3.5 m verge: mown to 5 m off the centre line, meadow beyond
    expect(at(f, 61, 45)).toBeLessThan(0);
    expect(at(f, 61, 37)).toBeLessThan(0);
    expect(at(f, 61, 49)).toBeGreaterThan(0);
    expect(lineDistance(5, 3, [[0, 0], [10, 0]])).toBeCloseTo(3, 9);
  });

  it('wave-10 review fix: takes the belt walk and the garden-front walk HG-07 from the catalogue; HG-07 is 8-12 Fuß wide inside the lawn and meets both belt-walk ends', () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../model/catalogue.json'), 'utf8'));
    const { spec } = loadSite(raw);
    const feats = siteFeatures(spec, 1789);
    const z = lawnZoneInput(feats)!;
    const front = feats.find((f) => f.id === 'HG-07')!;
    const belt = feats.find((f) => f.id === 'HG-02')!;
    expect(front.kind).toBe('path');
    expect(front.width).toBe(GARDEN.path.frontWalk);
    // 8-12 Fuß (Sckell): 2.3-3.9 m
    expect(front.width!).toBeGreaterThanOrEqual(2.3);
    expect(front.width!).toBeLessThanOrEqual(3.9);
    const loc = (c: number[][]) => c.map(([E, N]) => [E - 381000, -(N - 5465000)] as [number, number]);
    const fl = loc(front.geometry.coordinates as number[][]);
    const bl = loc(belt.geometry.coordinates as number[][]);
    // both ends of the belt walk lie on the front walk's tread
    for (const end of [bl[0], bl[bl.length - 1]]) expect(lineDistance(end[0], end[1], fl)).toBeLessThanOrEqual(front.width! / 2);
    // the whole tread lies inside Petri's lawn (so the class raster, and every seeded tree, stays as it was)
    const g = gridFrame(spec.palace_grid);
    for (const [E, N] of front.geometry.coordinates as number[][]) {
      const [u, v] = g.toUV(E, N);
      for (const du of [-front.width! / 2, front.width! / 2]) {
        const [E2, N2] = g.toEN(u + du, v);
        expect(inRing(E2 - 381000, -(N2 - 5465000), z.lawn)).toBe(true);
      }
    }
    expect(z.walks!.some((w) => w.width === front.width && lineDistance(fl[0][0], fl[0][1], w.line) < 0.01)).toBe(true);
    expect(z.walks!.some((w) => w.width === belt.width)).toBe(true);
  });
});

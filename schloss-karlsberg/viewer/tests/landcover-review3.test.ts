// Wave-3 review fixes (ground): Gewann strips that read from the air, the staked-out vineyard edge, hay parcels being
// mown, and the vineyard tone (viewer/src/landcover.ts fieldStrip, ringSegments, parcelSignedDistance, hayParcel;
// viewer/src/terrain.ts GROUND_COLOURS).
import { describe, expect, it } from 'vitest';
import {
  FIELD_BLOCK,
  GROUND_CLASS,
  HAY_PARCEL,
  MAX_PARCEL_SEGMENTS,
  fieldBlockCoord,
  fieldStrip,
  hayCockPlan,
  hayParcel,
  luminance,
  noiseLattice,
  parcelSignedDistance,
  ringSegments,
  type GroundGrid,
} from '../src/landcover.ts';
import { GROUND_COLOURS } from '../src/terrain.ts';

const lat = noiseLattice(256, 1789);
const GU: [number, number] = [0.98629, -0.16505];

describe('fieldStrip (Gewann strips, mirror of FIELD_GLSL)', () => {
  it('neighbouring strips of a block differ by at least 8 % in value', () => {
    let pairs = 0;
    // walk across many blocks along both axes; compare each strip with the next one in the same block
    for (let z = -3000; z < 3000; z += 211)
      for (const dir of [
        [1, 0],
        [0, 1],
      ] as const) {
        let prev: ReturnType<typeof fieldStrip> | null = null;
        for (let s = -1500; s < 1500; s += 0.5) {
          const x = dir[0] ? s : z;
          const zz = dir[0] ? z : s;
          const f = fieldStrip(lat, x, zz, GU);
          if (prev && prev.block[0] === f.block[0] && prev.block[1] === f.block[1] && prev.sid !== f.sid && Math.abs(prev.sid - f.sid) === 1) {
            const r = Math.max(prev.value, f.value) / Math.min(prev.value, f.value);
            expect(r).toBeGreaterThanOrEqual(1.08);
            pairs++;
          }
          prev = f;
        }
      }
    expect(pairs).toBeGreaterThan(500);
  });
  it('strips are 12-24 m wide, crops keep the rotation shares, half the edges carry a balk', () => {
    const crops = [0, 0, 0, 0];
    let balks = 0;
    let n = 0;
    for (let x = -4000; x < 4000; x += 13.7)
      for (let z = -4000; z < 4000; z += 97.3) {
        const f = fieldStrip(lat, x, z, GU);
        expect(f.sw).toBeGreaterThanOrEqual(12);
        expect(f.sw).toBeLessThanOrEqual(24);
        expect(f.edge).toBeGreaterThanOrEqual(0);
        expect(f.edge).toBeLessThanOrEqual(f.sw / 2 + 1e-9);
        crops[f.crop]++;
        if (f.balk) balks++;
        n++;
      }
    expect(crops[0] / n).toBeCloseTo(0.4, 1);
    expect(crops[1] / n).toBeCloseTo(0.24, 1);
    expect(crops[2] / n).toBeCloseTo(0.2, 1);
    expect(crops[3] / n).toBeCloseTo(0.16, 1);
    expect(balks / n).toBeCloseTo(0.5, 1);
  });
  it('uses the block frame of fieldBlockCoord and is deterministic', () => {
    for (const [x, z] of [
      [123.4, -567.8],
      [1650, -560],
      [-900, 2100],
    ]) {
      const p = fieldBlockCoord(lat, x, z, GU);
      const f = fieldStrip(lat, x, z, GU);
      expect(f.block).toEqual([Math.floor(p[0] / FIELD_BLOCK[0]), Math.floor(p[1] / FIELD_BLOCK[1])]);
      expect(fieldStrip(lat, x, z, GU)).toEqual(f);
    }
  });
});

describe('vineyard outline (ringSegments, parcelSignedDistance)', () => {
  const sq: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 40],
    [0, 40],
    [0, 0],
  ];
  it('packs the edges of closed rings, ignoring a closing duplicate', () => {
    const s = ringSegments([sq])!;
    expect(s.length).toBe(16);
    expect(Array.from(s.slice(12))).toEqual([0, 40, 0, 0]);
  });
  it('refuses outlines with more edges than the shader array', () => {
    const big = Array.from({ length: MAX_PARCEL_SEGMENTS + 1 }, (_, i) => {
      const a = (i / (MAX_PARCEL_SEGMENTS + 1)) * Math.PI * 2;
      return [50 * Math.cos(a), 50 * Math.sin(a)] as [number, number];
    });
    expect(ringSegments([big])).toBeNull();
    expect(ringSegments([big.slice(0, MAX_PARCEL_SEGMENTS)])).not.toBeNull();
  });
  it('is negative inside, positive outside, and metric to the nearest edge', () => {
    const s = ringSegments([sq])!;
    expect(parcelSignedDistance(s, 50, 20)).toBeCloseTo(-20, 6);
    expect(parcelSignedDistance(s, 50, 1)).toBeCloseTo(-1, 6);
    expect(parcelSignedDistance(s, 50, -3)).toBeCloseTo(3, 6);
    expect(parcelSignedDistance(s, 103, 43)).toBeCloseTo(Math.SQRT2 * 3, 6);
    // the edge zone the bake antialiases (±0.25 m) is the only soft part: 1 m in, fully inside
    expect(parcelSignedDistance(s, 99, 20)).toBeLessThan(-0.25);
  });
  it('even-odd rule with a second ring (a hole)', () => {
    const hole: [number, number][] = [
      [40, 10],
      [60, 10],
      [60, 30],
      [40, 30],
    ];
    const s = ringSegments([sq, hole])!;
    expect(parcelSignedDistance(s, 50, 20)).toBeGreaterThan(0);
    expect(parcelSignedDistance(s, 20, 20)).toBeLessThan(0);
  });
});

describe('hay parcels being mown (hayParcel cutTo, hayCockPlan)', () => {
  it('cut parcels are mown to 30-100 % of their depth; about a third of them are still being mown', () => {
    let cut = 0;
    let partial = 0;
    const seen = new Set<string>();
    for (let x = -4000; x < 4000; x += 37)
      for (let z = -4000; z < 4000; z += 41) {
        const p = hayParcel(lat, x, z, GU);
        const k = p.id.join(',');
        if (seen.has(k)) continue;
        seen.add(k);
        if (p.state !== 'cut') {
          expect(p.cutTo).toBe(0);
          continue;
        }
        cut++;
        expect(p.cutTo).toBeGreaterThanOrEqual(0.3 * HAY_PARCEL[1] - 1e-9);
        expect(p.cutTo).toBeLessThanOrEqual(HAY_PARCEL[1]);
        if (p.cutTo < HAY_PARCEL[1]) partial++;
      }
    expect(cut).toBeGreaterThan(300);
    expect(partial / cut).toBeGreaterThan(0.25);
    expect(partial / cut).toBeLessThan(0.5);
  });
  it('hay cocks stand only on the mown part', () => {
    const g: GroundGrid = { ground: new Uint8Array(300 * 300).fill(GROUND_CLASS.hay), cols: 300, rows: 300, cell: 2 };
    const cocks = hayCockPlan(g, { ox: 0, oz: 0, gridU: [1, 0], centre: [300, 300], radius: 300, share: 1 });
    expect(cocks.length).toBeGreaterThan(10);
    for (const t of cocks) {
      const p = hayParcel(lat, Math.floor(t.gx / 2) * 2 + 1, Math.floor(t.gy / 2) * 2 + 1, [1, 0]);
      expect(p.f[1]).toBeLessThanOrEqual(p.cutTo - 2);
    }
  });
});

describe('vineyard tone (GROUND_COLOURS)', () => {
  const lin = (hex: string): [number, number, number] =>
    [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
  it('the July area average reads lighter than the pasture and warmer than the hay (no cloud-shadow blob)', () => {
    // landcoverBake.ts vineAverage: mix(vineSoil(soil) * 0.897, vineLeaf(vine) * 0.877, 0.583) with (wave 5)
    // vineSoil = 35 % toward grey × (0.92, 0.96, 0.78) (wave-7 review fix: brown, not pink) and vineLeaf = 28 % toward
    // its luminance × (1, 1, 0.68), × 1.06
    const soil = lin(GROUND_COLOURS.soil);
    const Ls = luminance(soil);
    const vs = soil.map((v, k) => (v + (Ls - v) * 0.35) * [0.92, 0.96, 0.78][k]);
    const vine0 = lin(GROUND_COLOURS.vine);
    const Lv = luminance(vine0);
    const vine = vine0.map((v, k) => (v + (Lv * [1, 1, 0.68][k] - v) * 0.28) * 1.06);
    const avg = [0, 1, 2].map((k) => vs[k] * 0.897 * (1 - 0.583) + vine[k] * 0.877 * 0.583) as [number, number, number];
    const meadow = luminance(lin(GROUND_COLOURS.meadow));
    const hay = luminance(lin(GROUND_COLOURS.hayGreen));
    expect(luminance(avg)).toBeGreaterThan(meadow * 1.05);
    expect(luminance(avg)).toBeGreaterThan(hay * 0.6);
    // red-brown soil between the rows: the average is redder than the hay green
    expect(avg[0] / avg[1]).toBeGreaterThan(lin(GROUND_COLOURS.hayGreen)[0] / lin(GROUND_COLOURS.hayGreen)[1]);
  });
});

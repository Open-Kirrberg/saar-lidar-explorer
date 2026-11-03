// Wave 11 (KB-I84, audit #2): contour-following Gewann strips and the three-field rotation (viewer/src/landcover.ts
// fieldBlockDirs, fieldAcross, fieldZelge, fieldCropOf, fieldStrip; mirrored by landcoverBake.ts FIELD_GLSL).
import { describe, expect, it } from 'vitest';
import { FIELD_BLOCK, FIELD_DIR, GROUND_CLASS, fieldAcross, fieldBlockCoord, fieldBlockDirs, fieldStrip, fieldZelge, noiseLattice } from '../src/landcover.ts';

const lat = noiseLattice(256, 1789);
const GU: [number, number] = [0.98629, -0.16505];
const GV: [number, number] = [-GU[1], GU[0]];

// 1.2 × 1.2 km of field land; local x = west - E0 + gx, z = -(north - gy - N0) with E0 = west, N0 = north → z = gy
const W = 600;
const grid = (cls: number) => ({ ground: new Uint8Array(W * W).fill(cls), cols: W, rows: W, cell: 2, west: 0, north: 0 });

describe('fieldBlockDirs (contour strips)', () => {
  it('turns the across-strip direction of every sloping block into its fall line', () => {
    // a plane rising along an oblique direction d (local x, z)
    const ang = 0.7;
    const d: [number, number] = [Math.cos(ang), Math.sin(ang)];
    const plane = (x: number, z: number) => 0.12 * (x * d[0] + z * d[1]);
    const dirs = fieldBlockDirs(grid(GROUND_CLASS.field), plane, GU, 0, 0, lat);
    let blocks = 0;
    for (let x = 100; x < 1100; x += 97)
      for (let z = 100; z < 1100; z += 89) {
        const f = fieldStrip(lat, x, z, GU, dirs);
        // across (u, v) → local x, z; parallel to d up to the 8-bit angle
        const ax = f.across[0] * GU[0] + f.across[1] * GV[0];
        const az = f.across[0] * GU[1] + f.across[1] * GV[1];
        expect(Math.abs(ax * d[0] + az * d[1])).toBeGreaterThan(0.999);
        blocks++;
      }
    expect(blocks).toBeGreaterThan(50);
  });
  it('keeps the wave-3 hash axis on flat or field-less blocks', () => {
    const flat = fieldBlockDirs(grid(GROUND_CLASS.field), () => 300, GU, 0, 0, lat);
    const none = fieldBlockDirs(grid(GROUND_CLASS.meadow), (x) => 0.2 * x, GU, 0, 0, lat);
    for (const dirs of [flat, none]) {
      for (let i = 1; i < FIELD_DIR * FIELD_DIR * 4; i += 4) expect(dirs[i]).toBe(0);
      for (const [bx, by] of [[0, 0], [3, -2], [-5, 4]]) expect(fieldAcross(dirs, bx, by)).toEqual(fieldAcross(null, bx, by));
    }
  });
});

describe('three-field rotation (fieldZelge, fieldCropOf)', () => {
  it('every strip of a block carries a crop of the block Zelge', () => {
    const allowed = [[0, 1, 2], [3, 4], [5, 6, 7]];
    const seen = new Set<number>();
    for (let x = -2000; x < 2000; x += 7.3)
      for (let z = -2000; z < 2000; z += 151) {
        const f = fieldStrip(lat, x, z, GU);
        expect(f.zelge).toBe(fieldZelge(f.block[0], f.block[1]));
        expect(allowed[f.zelge]).toContain(f.crop);
        seen.add(f.crop);
        const p = fieldBlockCoord(lat, x, z, GU);
        expect(f.block).toEqual([Math.floor(p[0] / FIELD_BLOCK[0]), Math.floor(p[1] / FIELD_BLOCK[1])]);
      }
    expect(seen.size).toBe(8);
  });
  it('mixes the Zelgen over neighbouring blocks (no single-tone field land)', () => {
    const n = [0, 0, 0];
    for (let bx = -6; bx <= 6; bx++) for (let by = -6; by <= 6; by++) n[fieldZelge(bx, by)]++;
    for (const k of n) expect(k / 169).toBeGreaterThan(0.2);
  });
});

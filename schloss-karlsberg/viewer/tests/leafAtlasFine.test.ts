/**
 * Wave 9 (garden, KB-I76 leaf scale): the fine leaf tiles beside the coarse ones in one atlas.
 */
import { describe, expect, it } from 'vitest';
import { ATLAS_TILES, FINE_CARD, NEEDLE_TILE, broadleafSpray, fineBroadleafSpray, fineNeedleSpray, needleSpray, rasterFineLeafAtlas, rasterLeafAtlas, tileCoverage } from '../src/leafAtlas.ts';
import { combinedLeafAtlas } from '../src/leafCards.ts';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('fine leaf atlas', () => {
  it('draws leaves about a third of the coarse size, so a ≥ 0.9 m card shows leaves of ~6-11 cm', () => {
    const coarse = median(broadleafSpray(1789).map((l) => l.len));
    const fine = median(fineBroadleafSpray(1789).map((l) => l.len));
    expect(fine).toBeLessThan(coarse * 0.6);
    // a leaf on the smallest fine card (FINE_CARD.minSize m across) stays within 3-12 cm
    expect(fine * FINE_CARD.minSize).toBeGreaterThan(0.03);
    expect(fine * 2 * FINE_CARD.minSize).toBeLessThan(0.12);
    expect(median(fineNeedleSpray(1789).map((l) => l.len))).toBeLessThanOrEqual(median(needleSpray(1789).map((l) => l.len)));
    expect(fineNeedleSpray(1789).every((l) => l.needle)).toBe(true);
  });

  it('keeps every fine tile as dense as a spray, deterministic, with the needle tile in the same place', () => {
    const size = 256;
    const f = rasterFineLeafAtlas(size);
    expect(rasterFineLeafAtlas(size)).toEqual(f);
    for (let t = 0; t < ATLAS_TILES * ATLAS_TILES; t++) {
      const c = tileCoverage(f, size, t);
      expect(c, `tile ${t}`).toBeGreaterThan(0.2);
      expect(c, `tile ${t}`).toBeLessThan(0.75);
    }
    expect(NEEDLE_TILE).toBe(3);
  });

  it('packs coarse | fine side by side, row by row', () => {
    const size = 64;
    const a = rasterLeafAtlas(size);
    const f = rasterFineLeafAtlas(size);
    const c = combinedLeafAtlas(size);
    expect(c.length).toBe(size * size * 8);
    for (const y of [0, 17, size - 1]) {
      expect(c.subarray(y * size * 8, y * size * 8 + size * 4)).toEqual(a.subarray(y * size * 4, (y + 1) * size * 4));
      expect(c.subarray(y * size * 8 + size * 4, (y + 1) * size * 8)).toEqual(f.subarray(y * size * 4, (y + 1) * size * 4));
    }
  });
});

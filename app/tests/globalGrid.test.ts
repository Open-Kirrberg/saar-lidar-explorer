import { describe, expect, it } from 'vitest';
import {
  bitAt,
  chunkPresent,
  chunkSide,
  decodeBitmap,
  distanceToBbox,
  encodeBitmap,
  GLOBAL_GRID,
  globalChunkEdges,
  isAligned,
  isGlobalGrid,
  parseTileId,
  tileId,
  tileIdAt,
  tileOfChunk,
  toGlobal,
  toLocal,
} from '../src/data/globalGrid';

describe('global grid sle-grid-25832-v1', () => {
  it('declares the constant grid and rejects anything else', () => {
    expect(isGlobalGrid({ id: 'sle-grid-25832-v1', origin: { E: 300000, N: 5400000 }, extent_m: 256000, tile_m: 1000, chunk_m: 500 })).toBe(true);
    expect(isGlobalGrid(GLOBAL_GRID)).toBe(true);
    expect(isGlobalGrid({ ...GLOBAL_GRID, chunk_m: 1000 })).toBe(false);
    expect(isGlobalGrid({ ...GLOBAL_GRID, origin: { E: 300000, N: 5400001 } })).toBe(false);
    expect(isGlobalGrid({ ...GLOBAL_GRID, id: 'sle-grid-25832-v2' })).toBe(false);
    expect(isGlobalGrid(null)).toBe(false);
  });

  it('chunk sides S_k = 500 · 2^k', () => {
    expect([0, 1, 2, 9].map(chunkSide)).toEqual([500, 1000, 2000, 256000]);
  });

  it('tile ids of SW corners and of points; parse round trip', () => {
    expect(tileId(382000, 5466000)).toBe('382_5466');
    expect(tileIdAt(382999.9, 5466000.1)).toBe('382_5466');
    expect(parseTileId('382_5466')).toEqual({ E: 382000, N: 5466000 });
    expect(parseTileId('299_5466')).toBeNull(); // west of the grid
    expect(parseTileId('382_5656')).toBeNull(); // north of the grid
    expect(parseTileId('x')).toBeNull();
  });

  it('alignment of rectangles (contract table)', () => {
    const km = 1000;
    expect(isAligned(381000, 5465000, 3000, 3000, km)).toBe(true); // karlsberg
    expect(isAligned(378000, 5460000, 6000, 8000, km)).toBe(true); // overall
    expect(isAligned(374000, 5456000, 11000, 16000, km)).toBe(true); // homburg-gemeinde
    expect(isAligned(380000, 5460000, 3000, 3500, km)).toBe(false); // kirrberg (north edge on 500 m)
    expect(isAligned(380000, 5460000, 3000, 3500, 500)).toBe(true);
  });

  it('address conversion (aoi i, j) ↔ (k, I, J), counted from the NW corner', () => {
    const homburg = { E0: 374000, N0: 5456000, W: 11000, H: 16000 };
    expect(toGlobal(0, 0, 0, homburg)).toEqual({ I: 148, J: 368 });
    expect(toGlobal(1, 0, 0, homburg)).toEqual({ I: 74, J: 184 });
    expect(toGlobal(0, 21, 31, homburg)).toEqual({ I: 169, J: 399 });
    expect(toLocal(0, 169, 399, homburg)).toEqual({ i: 21, j: 31 });
    // Edges of the global chunk agree with the rectangle.
    const e = globalChunkEdges(0, 148, 368);
    expect(e).toEqual({ Ew: 374000, Nn: 5472000, S: 500 });
    // Level-0 chunk → its tile; level-1 chunk = one tile.
    expect(tileOfChunk(0, 148, 368)).toBe('374_5471');
    expect(tileOfChunk(0, 149, 369)).toBe('374_5471');
    expect(tileOfChunk(1, 74, 184)).toBe('374_5471');
    expect(tileOfChunk(2, 37, 92)).toBeNull();
  });

  it('distance from a point to a bbox', () => {
    const b: [number, number, number, number] = [0, 0, 10, 10];
    expect(distanceToBbox(5, 5, b)).toBe(0);
    expect(distanceToBbox(13, 14, b)).toBe(5);
  });
});

describe('presence bitmap', () => {
  it('contract example: w 3, h 2, cells (0,0) (2,0) (1,1) → "FQ==", count 3', () => {
    const cells = [1, 0, 1, 0, 1, 0];
    expect(encodeBitmap(cells, 3, 2)).toEqual({ w: 3, h: 2, bits: 'FQ==', count: 3 });
    const b = decodeBitmap({ w: 3, h: 2, bits: 'FQ==', count: 3 })!;
    expect(Array.from(b.cells)).toEqual(cells);
    expect(bitAt(b, 0, 0)).toBe(1);
    expect(bitAt(b, 1, 0)).toBe(0);
    expect(bitAt(b, 1, 1)).toBe(1);
    expect(bitAt(b, 5, 5)).toBe(0);
  });

  it('round trips larger bitmaps (LSB first, row 0 = north)', () => {
    const w = 22;
    const h = 18;
    const cells = Array.from({ length: w * h }, (_, k) => ((k * 7919) % 5 === 0 ? 1 : 0));
    const decl = encodeBitmap(cells, w, h);
    expect(decl.bits.length).toBe(68); // contract: Saarbrücken 50 bytes = 68 characters
    expect(Array.from(decodeBitmap(decl)!.cells)).toEqual(cells);
  });

  it('rejects wrong size, bad base64, count mismatch, trailing bits', () => {
    const why: string[] = [];
    const log = (m: string) => why.push(m);
    expect(decodeBitmap({ w: 3, h: 2, bits: 'FQ==', count: 3 }, { w: 2, h: 3 }, log)).toBeNull();
    expect(decodeBitmap({ w: 3, h: 2, bits: 'FQ=', count: 3 }, undefined, log)).toBeNull();
    expect(decodeBitmap({ w: 3, h: 2, bits: 'F_==', count: 3 }, undefined, log)).toBeNull();
    expect(decodeBitmap({ w: 3, h: 2, bits: 'FQ==', count: 2 }, undefined, log)).toBeNull();
    expect(decodeBitmap({ w: 3, h: 2, bits: 'VQ==', count: 4 }, undefined, log)).toBeNull(); // 0x55: bit 6 set after w·h
    expect(decodeBitmap({ w: 3, h: 2, bits: 'FQAA', count: 3 }, undefined, log)).toBeNull(); // 3 bytes, needs 1
    expect(decodeBitmap({ w: 0, h: 2, bits: '', count: 0 }, undefined, log)).toBeNull();
    expect(why.length).toBe(7);
  });

  it('chunk presence: level 0 by tile (⌊i/2⌋, ⌊j/2⌋), level 1 by (i, j); absent bitmap = all', () => {
    const p = decodeBitmap({ w: 3, h: 2, bits: 'FQ==', count: 3 })!;
    expect(chunkPresent(p, 0, 0, 0)).toBe(true);
    expect(chunkPresent(p, 0, 1, 1)).toBe(true);
    expect(chunkPresent(p, 0, 2, 0)).toBe(false); // tile (1, 0)
    expect(chunkPresent(p, 0, 3, 3)).toBe(true); // tile (1, 1)
    expect(chunkPresent(p, 1, 1, 0)).toBe(false);
    expect(chunkPresent(p, 1, 2, 0)).toBe(true);
    expect(chunkPresent(undefined, 0, 9, 9)).toBe(true);
  });
});

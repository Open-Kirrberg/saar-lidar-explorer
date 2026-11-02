import { describe, expect, it } from 'vitest';
import {
  cellToHeightPixel,
  cellToWorld,
  heightImageSize,
  heightPixelOrigin,
  heightPixelToCell,
  layerPixelToCell,
  worldToCell,
} from '../src/data/grid';
import type { GridSpec } from '../src/data/grid';
import { chunkUrl } from '../src/data/manifest';

const g: GridSpec = { width: 3000, height: 3000, chunkSize: 500, apron: 1 };

describe('chunk / apron indexing (data contract)', () => {
  it('height image is 502×502 with pixel (1,1) = first owned cell', () => {
    expect(heightImageSize(g)).toBe(502);
    expect(heightPixelToCell(0, 0, 1, 1, g)).toEqual({ c: 0, r: 0 });
    expect(heightPixelToCell(2, 3, 0, 0, g)).toEqual({ c: 999, r: 1499 });
    expect(heightPixelToCell(2, 3, 501, 501, g)).toEqual({ c: 1500, r: 2000 });
    expect(cellToHeightPixel(2, 3, 1000, 1500, g)).toEqual({ px: 1, py: 1 });
  });

  it('apron pixels duplicate the neighbour chunk’s owned cells', () => {
    // East apron of chunk (0,0) = first column of chunk (1,0).
    const a = heightPixelToCell(0, 0, 501, 10, g);
    const b = heightPixelToCell(1, 0, 1, 10, g);
    expect(a).toEqual(b);
    // South apron of chunk (0,0) = first row of chunk (0,1).
    expect(heightPixelToCell(0, 0, 10, 501, g)).toEqual(heightPixelToCell(0, 1, 10, 1, g));
  });

  it('layer images have no apron', () => {
    expect(layerPixelToCell(1, 2, 0, 0, g)).toEqual({ c: 500, r: 1000 });
    expect(layerPixelToCell(1, 2, 499, 499, g)).toEqual({ c: 999, r: 1499 });
  });

  it('cell centres map to the world frame (row 0 = north edge)', () => {
    // Cell (0,0) is the NW corner cell: centre E0+0.5, N0+3000−0.5 → x 0.5, z −2999.5
    expect(cellToWorld(0, 0, g)).toEqual({ x: 0.5, z: -2999.5 });
    // Last row is the south edge, just north of N0.
    expect(cellToWorld(2999, 2999, g)).toEqual({ x: 2999.5, z: -0.5 });
    expect(worldToCell(0.5, -2999.5, g)).toEqual({ c: 0, r: 0 });
  });

  it('height pixel origin places pixel (1,1) at the first owned cell centre', () => {
    const o = heightPixelOrigin(2, 3, g);
    const first = cellToWorld(1000, 1500, g);
    expect(o.x + 1).toBe(first.x);
    expect(o.z + 1).toBe(first.z);
  });

  it('expands chunk URL templates', () => {
    expect(chunkUrl('data/k/', 'dtm/{i}_{j}.png', 4, 5)).toBe('data/k/dtm/4_5.png');
  });
});

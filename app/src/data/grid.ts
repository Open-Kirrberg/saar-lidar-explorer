/**
 * Grid / chunk / apron indexing per docs/data-contract.md.
 *
 * AOI cell (c, r): c east, r south (row 0 = north edge); centre at
 *   world x = c + 0.5,   world z = r + 0.5 − height      (cellSize 1 m)
 * Chunk (i, j) owns cells c ∈ [i·cs, i·cs+cs), r ∈ [j·cs, j·cs+cs).
 * Height image pixel (px, py) (size cs+2, apron 1) ↔ cell (i·cs − 1 + px, j·cs − 1 + py).
 * Layer image pixel (px, py) (size cs, no apron)   ↔ cell (i·cs + px, j·cs + py).
 *
 * Overview levels (contract v2): a level-k grid has `cellSize` = 2^k m, the same chunkSize and is
 * anchored at the AOI's north-west corner, so its cell (c, r) centre is
 *   world x = (c + 0.5)·cellSize,   world z = (r + 0.5)·cellSize − extentZ
 * with extentZ = the AOI height in metres (level 0: height·1).
 */

export interface GridSpec {
  width: number; // cells east (level raster)
  height: number; // cells south (level raster)
  chunkSize: number;
  apron: number;
  /** Metres per cell (default 1). */
  cellSize?: number;
  /** AOI height in metres = world z of the north edge, negated (default height · cellSize). */
  extentZ?: number;
}

/** Metres per cell of a grid (default 1). */
export function cellSizeOf(g: GridSpec): number {
  return g.cellSize ?? 1;
}

/** AOI height in metres (world z of the north edge is −extentZ). */
export function extentZOf(g: GridSpec): number {
  return g.extentZ ?? g.height * cellSizeOf(g);
}

export function chunkKey(i: number, j: number): string {
  return `${i}_${j}`;
}

/** Continuous cell coordinates (integer = cell centre) of a world position. */
export function worldToCell(x: number, z: number, g: GridSpec): { c: number; r: number } {
  const s = cellSizeOf(g);
  return { c: x / s - 0.5, r: (z + extentZOf(g)) / s - 0.5 };
}

/** World x/z of a (continuous) cell coordinate. */
export function cellToWorld(c: number, r: number, g: GridSpec): { x: number; z: number } {
  const s = cellSizeOf(g);
  return { x: (c + 0.5) * s, z: (r + 0.5) * s - extentZOf(g) };
}

export function heightPixelToCell(i: number, j: number, px: number, py: number, g: GridSpec) {
  return { c: i * g.chunkSize - g.apron + px, r: j * g.chunkSize - g.apron + py };
}

export function cellToHeightPixel(i: number, j: number, c: number, r: number, g: GridSpec) {
  return { px: c - i * g.chunkSize + g.apron, py: r - j * g.chunkSize + g.apron };
}

export function layerPixelToCell(i: number, j: number, px: number, py: number, g: GridSpec) {
  return { c: i * g.chunkSize + px, r: j * g.chunkSize + py };
}

/**
 * World-space offset of height-image pixel (0, 0) of chunk (i, j):
 * world.xz = offset + (px, py) · cellSize   (pixel coordinates are continuous, integer = centre).
 */
export function heightPixelOrigin(i: number, j: number, g: GridSpec): { x: number; z: number } {
  const { c, r } = heightPixelToCell(i, j, 0, 0, g);
  return cellToWorld(c, r, g);
}

/** Side length (pixels) of a height image. */
export function heightImageSize(g: GridSpec): number {
  return g.chunkSize + 2 * g.apron;
}

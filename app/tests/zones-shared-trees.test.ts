// V2.7: the host's tree source for zones (`trees: "shared"`) over the AOI `trees` layer.
import { describe, expect, it, vi } from 'vitest';
import { overworldTreeSource } from '../src/zones/runtime/sharedTrees';
import { TREE_FILL_FLAG, TreeKind, encodeTrees, treeChunkRef, treeId } from '../src/trees/treeData';
import type { ManifestTrees } from '../src/trees/treeData';

/** 2 × 2 chunks of 500 m from 381000/5465000 (the grid's north edge is N0 + height). */
const GRID = { origin: { E0: 381000, N0: 5465000 }, size: { width: 1000, height: 1000 }, chunkSize: 500, cellSize: 1 };
const ref00 = treeChunkRef(GRID, 0, 0); // north-west chunk: west 381000, south 5465500
const ref11 = treeChunkRef(GRID, 1, 1); // south-east chunk: west 381500, south 5465000

const BUFS: Record<string, ArrayBuffer> = {
  'trees/0_0.bin': encodeTrees(
    [
      { E: ref00.west + 10.5, N: ref00.south + 20.5, ground: 330.25, height: 24, radius: 4.5, type: TreeKind.Broadleaf },
      { E: ref00.west + 400.5, N: ref00.south + 400.5, ground: 340, height: 12, radius: 2, type: TreeKind.Conifer | TREE_FILL_FLAG },
    ],
    ref00,
  ),
  'trees/1_1.bin': encodeTrees([{ E: ref11.west + 5.5, N: ref11.south + 5.5, ground: 300, height: 8, radius: 1.5, type: TreeKind.Unknown }], ref11),
};
const layer: ManifestTrees = {
  format: 'sle-trees-v1',
  path: 'trees/{i}_{j}.bin',
  chunks: [
    [0, 0, 2],
    [1, 1, 1],
  ],
  count: 3,
  fill: 1,
  fillFlag: TREE_FILL_FLAG,
} as ManifestTrees;

function source(trees: ManifestTrees = layer) {
  const urls: string[] = [];
  const load = vi.fn(async (url: string) => {
    urls.push(url);
    const key = url.replace('https://x/aoi/', '');
    if (!BUFS[key]) throw new Error('404');
    return BUFS[key]!;
  });
  return { src: overworldTreeSource({ ...GRID, trees } as never, 'https://x/aoi/', load), urls };
}

describe('overworldTreeSource', () => {
  it('is absent without a trees layer', () => {
    expect(overworldTreeSource({ ...GRID } as never, 'https://x/aoi/')).toBeUndefined();
  });

  it('loads only the chunks that touch the box and keeps the trees inside it', async () => {
    const { src, urls } = source();
    const got = await src!.treesIn([
      [381000, 5465500],
      [381100, 5465600],
    ]);
    expect(urls).toEqual(['https://x/aoi/trees/0_0.bin']);
    expect(got).toEqual([
      { id: treeId(381010.5, 5465520.5), E: 381010.5, N: 5465520.5, g: expect.closeTo(330.25, 2), h: expect.closeTo(24, 1), r: expect.closeTo(4.5, 1), type: 'broadleaf', fill: false },
    ]);
  });

  it('maps kind and fill flag, and merges chunks', async () => {
    const { src, urls } = source();
    const got = await src!.treesIn([
      [380000, 5464000],
      [383000, 5467000],
    ]);
    expect(urls.sort()).toEqual(['https://x/aoi/trees/0_0.bin', 'https://x/aoi/trees/1_1.bin']);
    expect(got.map((t) => `${t.type}/${t.fill}`).sort()).toEqual(['broadleaf/false', 'conifer/true', 'unknown/false']);
  });

  it('skips a chunk that fails to load (warning), keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { src } = source({ ...layer, chunks: [...layer.chunks, [1, 0, 5]] });
    const got = await src!.treesIn([
      [380000, 5464000],
      [383000, 5467000],
    ]);
    expect(got).toHaveLength(3);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

/**
 * Today's CHM trees for zones (V2.7, ADR 0017 / 0033): a zone whose preset says `trees: "shared"` gets a tree
 * source on its mount context and asks it for the trees around its footprint (the castle keeps its own 1789
 * forest inside, see zones/schloss-karlsberg/viewer/src/sharedTrees.ts). Reads the AOI's `trees` layer
 * (sle-trees-v1, docs/data-contract.md) chunk by chunk. No three, no DOM.
 */
import { chunkUrl } from '../../data/manifest';
import type { Manifest } from '../../data/manifest';
import { TreeKind, decodeTrees, isFillTree, treeChunkRef, treeKind } from '../../trees/treeData';

/** One tree of the overworld layer, EPSG:25832 and true heights (DHHN2016). */
export interface ZoneSharedTree {
  /** Stable id (contract `treeId`). */
  id: number;
  E: number;
  N: number;
  /** Ground height (m). */
  g: number;
  /** Height above ground (m). */
  h: number;
  /** Crown radius (m). */
  r: number;
  type: 'unknown' | 'conifer' | 'broadleaf';
  /** Estimated position (ADR 0030). */
  fill: boolean;
}

export interface ZoneTreeSource {
  /** Trees inside the EN box [[Emin, Nmin], [Emax, Nmax]]. Chunks that fail to load are skipped (warning). */
  treesIn(bboxEN: [[number, number], [number, number]]): Promise<ZoneSharedTree[]>;
}

const KIND: Record<TreeKind, ZoneSharedTree['type']> = {
  [TreeKind.Unknown]: 'unknown',
  [TreeKind.Conifer]: 'conifer',
  [TreeKind.Broadleaf]: 'broadleaf',
};

export type FetchBuffer = (url: string) => Promise<ArrayBuffer>;

const fetchBuffer: FetchBuffer = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
};

/** Tree source over the AOI's `trees` layer; `undefined` when the manifest has none. */
export function overworldTreeSource(
  manifest: Pick<Manifest, 'trees' | 'origin' | 'size' | 'chunkSize' | 'cellSize'>,
  aoiBaseUrl: string,
  load: FetchBuffer = fetchBuffer,
): ZoneTreeSource | undefined {
  const layer = manifest.trees;
  if (!layer) return undefined;
  const L = manifest.chunkSize * manifest.cellSize;
  return {
    async treesIn([[e0, n0], [e1, n1]]) {
      const refs = layer.chunks
        .map(([i, j]) => treeChunkRef(manifest, i, j))
        .filter((c) => c.west < e1 && c.west + L > e0 && c.south < n1 && c.south + L > n0);
      const out: ZoneSharedTree[] = [];
      const parts = await Promise.all(
        refs.map(async (ref) => {
          try {
            return decodeTrees(await load(chunkUrl(aoiBaseUrl, layer.path, ref.i, ref.j)), ref);
          } catch (err) {
            console.warn(`[zones] shared trees ${ref.i}_${ref.j} skipped:`, err);
            return null;
          }
        }),
      );
      for (const d of parts) {
        if (!d) continue;
        for (let k = 0; k < d.count; k++) {
          const E = d.E[k]!;
          const N = d.N[k]!;
          if (E < e0 || E > e1 || N < n0 || N > n1) continue;
          const t = d.type[k]!;
          out.push({ id: d.id[k]!, E, N, g: d.ground[k]!, h: d.height[k]!, r: d.radius[k]!, type: KIND[treeKind(t)], fill: isFillTree(t) });
        }
      }
      return out;
    },
  };
}

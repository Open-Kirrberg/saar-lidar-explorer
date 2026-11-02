/**
 * Pure quadtree selection over the level pyramid (no three.js).
 *
 * Starting from the coarsest level's chunks, a node is refined when its screen-space error
 * (cellSize · projFactor / distance) exceeds the threshold. Children replace their parent only
 * when **all** existing children can be drawn (no holes); until then the parent is drawn and the
 * missing children are requested. Hysteresis: once children are drawn, they stay until the error
 * falls below `threshold · hysteresis`.
 */
import type { LevelDims, NodeId } from './levels';
import { childrenOf, nodeKey, rootNodes, screenSpaceError } from './levels';

export interface SelectParams {
  levels: readonly LevelDims[];
  /** Pixels per metre at distance 1 (see projectionFactor). */
  projFactor: number;
  /** Refinement threshold in pixels of screen-space error. */
  threshold: number;
  /** Multiplier (< 1) on the threshold for coarsening already refined nodes. Default 0.8. */
  hysteresis?: number;
  /** Error multiplier for nodes outside the view frustum (< 1 = coarser off-screen). Default 0.5. */
  offscreenScale?: number;
  /** Distance (m) from the camera to the node's (displayed) bounding box. */
  distance(n: NodeId): number;
  inView(n: NodeId): boolean;
  /** The node's height data is resident (it can be drawn). */
  hasData(n: NodeId): boolean;
  /** The node is complete enough to replace its parent (data + layers, or already drawn). */
  canReplace(n: NodeId): boolean;
  /** The node was active (drawn or refined) in the previous selection (for hysteresis). */
  wasActive(n: NodeId): boolean;
}

export interface WantedNode {
  node: NodeId;
  /** Lower = sooner. */
  priority: number;
}

export interface Selection {
  /** Nodes to draw (a hole-free cover of the AOI where roots are loaded). */
  draw: NodeId[];
  /** Nodes to make resident/complete, with priorities (not sorted). */
  want: WantedNode[];
  /** Keys of nodes that must not be evicted: drawn, their ancestors, and wanted nodes. */
  keep: Set<string>;
  /** Keys of drawn nodes and their ancestors (pass back as `wasActive` next time). */
  active: Set<string>;
}

/** Priority: visible first, then by distance. */
export function nodePriority(dist: number, inView: boolean): number {
  return (inView ? 0 : 1e7) + dist;
}

export function selectNodes(p: SelectParams): Selection {
  const draw: NodeId[] = [];
  const want: WantedNode[] = [];
  const keep = new Set<string>();
  const active = new Set<string>();
  const hyst = p.hysteresis ?? 0.8;
  const off = p.offscreenScale ?? 0.5;

  const request = (n: NodeId) => {
    keep.add(nodeKey(n.level, n.i, n.j));
    const v = p.inView(n);
    want.push({ node: n, priority: nodePriority(p.distance(n), v) });
  };

  const visit = (n: NodeId): void => {
    const key = nodeKey(n.level, n.i, n.j);
    keep.add(key);
    active.add(key);
    const kids = childrenOf(p.levels, n);
    if (kids.length > 0) {
      const d = p.distance(n);
      const v = p.inView(n);
      const sse = screenSpaceError(p.levels[n.level].cellSize, d, p.projFactor) * (v ? 1 : off);
      const refined = kids.some((c) => p.wasActive(c));
      const thr = refined ? p.threshold * hyst : p.threshold;
      if (sse > thr) {
        if (kids.every((c) => p.hasData(c) && (p.canReplace(c) || refined))) {
          for (const c of kids) visit(c);
          return;
        }
        // Keep every sibling (also the already complete ones) so the LRU does not evict them
        // while the slowest sibling is still loading — otherwise refinement can stall in a
        // fetch/evict loop under budget pressure. Only incomplete children are wanted.
        for (const c of kids) {
          if (!p.hasData(c) || !p.canReplace(c)) request(c);
          else keep.add(nodeKey(c.level, c.i, c.j));
        }
      }
    }
    draw.push(n);
  };

  for (const r of rootNodes(p.levels)) {
    if (p.hasData(r)) visit(r);
    else request(r);
  }
  return { draw, want, keep, active };
}

import { describe, expect, it } from 'vitest';
import { boxBlur, cropRaster } from '../src/data/boxBlur';
import type { GridSpec } from '../src/data/grid';
import { cellToWorld, heightImageSize, heightPixelOrigin, worldToCell } from '../src/data/grid';
import { assembleRegion, clampOutside, lowpassWindow } from '../src/data/lowpassRegion';
import { levelGrid } from '../src/data/manifest';
import { blockMean } from '../src/data/pyramid';
import { adaptThreshold, chunkGpuBytes, clampBudget, HARD_CAP, MiB, planEviction } from '../src/terrain/budget';
import { createGridGeometry } from '../src/terrain/gridGeometry';
import { HeightQuery, LevelHeights } from '../src/terrain/HeightQuery';
import type { LevelDims, NodeId } from '../src/terrain/levels';
import {
  aoiPixelMax,
  childrenOf,
  distanceToBox,
  levelGridSpec,
  nodeKey,
  nodeRect,
  parentOf,
  parseNodeKey,
  pixelSpacingFor,
  pixelSpacings,
  projectionFactor,
  rootNodes,
  screenSpaceError,
} from '../src/terrain/levels';
import { nodePriority, selectNodes } from '../src/terrain/quadtree';
import type { SelectParams } from '../src/terrain/quadtree';

/** Level dims of a W×H m AOI (1 m cells, 500-cell chunks) with `n` levels, like parseLevels. */
function pyramid(W: number, H: number, n: number, cs = 500): LevelDims[] {
  const dtm = { path: 'dtm/{i}_{j}.png', encoding: 'terrarium' as const, apron: 1 };
  const base = { cellSize: 1, chunkSize: cs, size: { width: W, height: H }, chunks: { nx: Math.ceil(W / cs), ny: Math.ceil(H / cs) }, height: { dtm }, layers: {} };
  return Array.from({ length: n }, (_, k) => ({ level: k, chunkSize: cs, ...levelGrid(base, k) }));
}

const overall = pyramid(6000, 8000, 5);
const aoi = { width: 6000, height: 8000 };

describe('level / node math', () => {
  it('matches the contract sizes for the overall AOI', () => {
    expect(overall.map((l) => [l.chunks.nx, l.chunks.ny])).toEqual([[12, 16], [6, 8], [3, 4], [2, 2], [1, 1]]);
    expect(overall.map((l) => l.cellSize)).toEqual([1, 2, 4, 8, 16]);
    expect(overall[3].size).toEqual({ width: 750, height: 1000 });
    expect(rootNodes(overall)).toEqual([{ level: 4, i: 0, j: 0 }]);
  });

  it('children are the 2×2 finer chunks that exist; parent inverts', () => {
    expect(childrenOf(overall, { level: 1, i: 2, j: 3 })).toEqual([
      { level: 0, i: 4, j: 6 },
      { level: 0, i: 5, j: 6 },
      { level: 0, i: 4, j: 7 },
      { level: 0, i: 5, j: 7 },
    ]);
    // Level 3 has 2×2 chunks; level-4 root (0,0) → all four.
    expect(childrenOf(overall, { level: 4, i: 0, j: 0 })).toHaveLength(4);
    // Level 2 is 3×4: level-3 chunk (1, 1) has only children i = 2 (i = 3 is beyond the grid).
    expect(childrenOf(overall, { level: 3, i: 1, j: 1 })).toEqual([
      { level: 2, i: 2, j: 2 },
      { level: 2, i: 2, j: 3 },
    ]);
    expect(childrenOf(overall, { level: 0, i: 0, j: 0 })).toEqual([]);
    expect(parentOf(overall, { level: 0, i: 5, j: 7 })).toEqual({ level: 1, i: 2, j: 3 });
    expect(parentOf(overall, { level: 4, i: 0, j: 0 })).toBeNull();
    expect(parseNodeKey(nodeKey(3, 1, 0))).toEqual({ level: 3, i: 1, j: 0 });
  });

  it('children cover their parent’s AOI area exactly (no holes)', () => {
    for (let k = 1; k < overall.length; k++) {
      for (let j = 0; j < overall[k].chunks.ny; j++) {
        for (let i = 0; i < overall[k].chunks.nx; i++) {
          const p = nodeRect(overall[k], i, j, aoi);
          const area = (p.x1 - p.x0) * (p.z1 - p.z0);
          const kids = childrenOf(overall, { level: k, i, j }).map((c) => nodeRect(overall[k - 1], c.i, c.j, aoi));
          expect(kids.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0)).toBeCloseTo(area, 6);
          for (const r of kids) {
            expect(r.x0).toBeGreaterThanOrEqual(p.x0);
            expect(r.x1).toBeLessThanOrEqual(p.x1);
            expect(r.z0).toBeGreaterThanOrEqual(p.z0);
            expect(r.z1).toBeLessThanOrEqual(p.z1);
          }
        }
      }
    }
  });

  it('node rects are anchored at the NW corner and clamped to the AOI', () => {
    expect(nodeRect(overall[0], 0, 0, aoi)).toEqual({ x0: 0, x1: 500, z0: -8000, z1: -7500 });
    expect(nodeRect(overall[3], 1, 1, aoi)).toEqual({ x0: 4000, x1: 6000, z0: -4000, z1: 0 });
    expect(nodeRect(overall[4], 0, 0, aoi)).toEqual({ x0: 0, x1: 6000, z0: -8000, z1: 0 });
  });

  it('level grids place cell centres per contract (E0+(c+.5)·cs, N0+H−(r+.5)·cs)', () => {
    const g = levelGridSpec(overall[2], 1, aoi); // 4 m
    expect(cellToWorld(0, 0, g)).toEqual({ x: 2, z: -7998 });
    expect(cellToWorld(10, 3, g)).toEqual({ x: 42, z: -8000 + 14 });
    expect(worldToCell(42, -7986, g)).toEqual({ c: 10, r: 3 });
    // Height pixel (1,1) of chunk (1,0) = level cell (500, 0).
    const o = heightPixelOrigin(1, 0, g);
    const first = cellToWorld(500, 0, g);
    expect(o.x + 1 * 4).toBe(first.x);
    expect(o.z + 1 * 4).toBe(first.z);
    // Level 0 unchanged.
    const g0 = levelGridSpec(overall[0], 1, aoi);
    expect(cellToWorld(0, 0, g0)).toEqual({ x: 0.5, z: -7999.5 });
  });

  it('AOI pixel clamp: edge chunk meshes end at the AOI edge', () => {
    // Level 3 (8 m): chunk (1, 0) starts at x = 4000; AOI edge 6000 → 250 cells in.
    const pm = aoiPixelMax(overall[3], 1, 0, 1, aoi);
    expect(pm.x).toBe(250 + 1 - 0.5);
    // Pixel p ↔ x = (i·cs − apron + p + 0.5)·s → p = pm.x ↔ x = 6000.
    expect((500 - 1 + pm.x + 0.5) * 8).toBe(6000);
    // An interior level-0 chunk does not clamp (≥ the mesh's last edge apron + cs − 0.5).
    expect(aoiPixelMax(overall[0], 3, 3, 1, aoi).x).toBeGreaterThanOrEqual(500.5);
  });

  it('picks pixel spacings from metres per level', () => {
    const allowed = pixelSpacings(500);
    expect(allowed.slice(0, 6)).toEqual([1, 2, 4, 5, 10, 20]);
    expect(pixelSpacingFor(1, 1, allowed)).toBe(1);
    expect(pixelSpacingFor(10, 1, allowed)).toBe(10);
    expect(pixelSpacingFor(10, 2, allowed)).toBe(5);
    expect(pixelSpacingFor(4, 8, allowed)).toBe(1); // never finer than a cell
    expect(pixelSpacingFor(20, 8, allowed)).toBe(2);
  });

  it('screen-space error and distance', () => {
    const pf = projectionFactor(60, 1080);
    expect(pf).toBeCloseTo(935.3, 1);
    expect(screenSpaceError(2, 1870.6, pf)).toBeCloseTo(1, 3);
    expect(distanceToBox(0, 0, 0, 1, 2, -1, 1, -5, 5)).toBe(1);
    expect(distanceToBox(1.5, 0, 0, 1, 2, -1, 1, -5, 5)).toBe(0);
    expect(distanceToBox(5, 4, 0, 1, 2, -1, 1, -5, 5)).toBeCloseTo(Math.hypot(3, 3), 12);
  });
});

describe('grid geometry', () => {
  it('outer ring lies on cell edges, interior on texel centres', () => {
    const g = createGridGeometry(500, 10, 1);
    const pos = g.getAttribute('position');
    let mn = Infinity;
    let mx = -Infinity;
    for (let k = 0; k < pos.count; k++) {
      mn = Math.min(mn, pos.getX(k));
      mx = Math.max(mx, pos.getX(k));
    }
    expect(mn).toBe(0.5);
    expect(mx).toBe(500.5);
    expect(pos.getX(1)).toBe(11); // apron + 1·spacing
  });
});

// ---- quadtree ------------------------------------------------------------------------------

interface World {
  cam: { x: number; y: number; z: number };
  resident: Set<string>;
  complete?: Set<string>;
  prevActive?: Set<string>;
}

function params(levels: LevelDims[], w: World, threshold = 1): SelectParams {
  const ex = { width: levels[0].size.width * levels[0].cellSize, height: levels[0].size.height * levels[0].cellSize };
  const k = (n: NodeId) => nodeKey(n.level, n.i, n.j);
  return {
    levels,
    projFactor: projectionFactor(60),
    threshold,
    distance: (n) => {
      const r = nodeRect(levels[n.level], n.i, n.j, ex);
      return distanceToBox(w.cam.x, w.cam.y, w.cam.z, r.x0, r.x1, 0, 0, r.z0, r.z1);
    },
    inView: () => true,
    hasData: (n) => w.resident.has(k(n)),
    canReplace: (n) => (w.complete ?? w.resident).has(k(n)),
    wasActive: (n) => w.prevActive?.has(k(n)) ?? false,
  };
}

const allKeys = (levels: LevelDims[]) => {
  const s = new Set<string>();
  for (const l of levels) for (let j = 0; j < l.chunks.ny; j++) for (let i = 0; i < l.chunks.nx; i++) s.add(nodeKey(l.level, i, j));
  return s;
};

/** Total AOI area covered by drawn nodes (must equal the AOI: no holes, no overlaps). */
function coveredArea(levels: LevelDims[], draw: NodeId[]): number {
  const ex = { width: levels[0].size.width, height: levels[0].size.height };
  return draw.reduce((s, n) => {
    const r = nodeRect(levels[n.level], n.i, n.j, ex);
    return s + (r.x1 - r.x0) * (r.z1 - r.z0);
  }, 0);
}

describe('selectNodes', () => {
  it('requests the root first when nothing is resident', () => {
    const sel = selectNodes(params(overall, { cam: { x: 3000, y: 500, z: -4000 }, resident: new Set() }));
    expect(sel.draw).toEqual([]);
    expect(sel.want.map((w) => w.node)).toEqual([{ level: 4, i: 0, j: 0 }]);
  });

  it('draws the root and requests children until all four are ready', () => {
    const w: World = { cam: { x: 3000, y: 300, z: -4000 }, resident: new Set(['4/0_0', '3/0_0', '3/1_0']) };
    const sel = selectNodes(params(overall, w));
    expect(sel.draw).toEqual([{ level: 4, i: 0, j: 0 }]);
    expect(sel.want.map((x) => nodeKey(x.node.level, x.node.i, x.node.j)).sort()).toEqual(['3/0_1', '3/1_1']);
  });

  it('with everything resident refines near the camera to level 0 and covers the AOI exactly', () => {
    const cam = { x: 1200, y: 400, z: -6800 };
    const sel = selectNodes(params(overall, { cam, resident: allKeys(overall) }));
    expect(sel.want).toEqual([]);
    expect(coveredArea(overall, sel.draw)).toBeCloseTo(6000 * 8000, 3);
    const levelUnder = sel.draw.find((n) => {
      const r = nodeRect(overall[n.level], n.i, n.j, aoi);
      return cam.x >= r.x0 && cam.x < r.x1 && cam.z >= r.z0 && cam.z < r.z1;
    });
    expect(levelUnder?.level).toBe(0);
    // Far corner stays coarse.
    const far = sel.draw.find((n) => {
      const r = nodeRect(overall[n.level], n.i, n.j, aoi);
      return 5900 >= r.x0 && 5900 < r.x1 && -100 >= r.z0 && -100 < r.z1;
    });
    expect(far!.level).toBeGreaterThanOrEqual(2);
    // Drawn chunks and their ancestors are kept.
    for (const n of sel.draw) expect(sel.keep.has(nodeKey(n.level, n.i, n.j))).toBe(true);
    expect(sel.keep.has('4/0_0')).toBe(true);
  });

  it('no holes: a partially loaded child set keeps the parent', () => {
    const resident = allKeys(overall);
    resident.delete('0/2_2'); // one level-0 child of 1/1_1 (under the camera) missing
    const sel = selectNodes(params(overall, { cam: { x: 1200, y: 400, z: -6800 }, resident }));
    expect(coveredArea(overall, sel.draw)).toBeCloseTo(6000 * 8000, 3);
    expect(sel.draw.some((n) => nodeKey(n.level, n.i, n.j) === '1/1_1')).toBe(true);
    expect(sel.draw.some((n) => nodeKey(n.level, n.i, n.j) === '0/3_2')).toBe(false); // sibling waits
    expect(sel.want.map((x) => nodeKey(x.node.level, x.node.i, x.node.j))).toContain('0/2_2');
  });

  it('keeps the already loaded siblings while the parent waits for a missing child (audit terrain-1)', () => {
    const two = pyramid(1000, 1000, 2); // level 0: 2×2, level 1: 1×1
    const resident = new Set(['1/0_0', '0/0_0', '0/1_0', '0/0_1']);
    const sel = selectNodes(params(two, { cam: { x: 500, y: 100, z: -500 }, resident }));
    expect(sel.draw).toEqual([{ level: 1, i: 0, j: 0 }]);
    expect(sel.want.map((x) => nodeKey(x.node.level, x.node.i, x.node.j))).toEqual(['0/1_1']);
    for (const k of ['1/0_0', '0/0_0', '0/1_0', '0/0_1', '0/1_1']) expect(sel.keep.has(k)).toBe(true);
  });

  it('children wait for their layers unless already drawn (hysteresis)', () => {
    const resident = allKeys(overall);
    const complete = new Set([...resident].filter((k) => !k.startsWith('0/')));
    const cam = { x: 1200, y: 400, z: -6800 };
    const a = selectNodes(params(overall, { cam, resident, complete }));
    expect(a.draw.every((n) => n.level >= 1)).toBe(true);
    expect(a.want.length).toBeGreaterThan(0);
    // Once drawn, incomplete children stay drawn (e.g. while a new display layer loads).
    const full = selectNodes(params(overall, { cam, resident }));
    const b = selectNodes(params(overall, { cam, resident, complete, prevActive: full.active }));
    expect(b.draw.filter((n) => n.level === 0).length).toBe(full.draw.filter((n) => n.level === 0).length);
  });

  it('a higher threshold selects coarser levels (fewer chunks)', () => {
    const w: World = { cam: { x: 3000, y: 600, z: -4000 }, resident: allKeys(overall) };
    const fine = selectNodes(params(overall, w, 1)).draw.length;
    const coarse = selectNodes(params(overall, w, 4)).draw.length;
    expect(coarse).toBeLessThan(fine);
  });

  it('v1 manifest = single level: all chunks are roots and drawn', () => {
    const one = pyramid(3000, 3000, 1);
    const sel = selectNodes(params(one, { cam: { x: 0, y: 0, z: 0 }, resident: allKeys(one) }));
    expect(sel.draw).toHaveLength(36);
  });

  it('priority: visible before hidden, then nearer', () => {
    expect(nodePriority(10, true)).toBeLessThan(nodePriority(5, false));
    expect(nodePriority(10, true)).toBeLessThan(nodePriority(20, true));
  });
});

// ---- budget --------------------------------------------------------------------------------

describe('GPU budget + LRU', () => {
  it('estimates chunk bytes per the contract table', () => {
    expect(chunkGpuBytes({ heightSide: 502, layerSide: 500, layers: 0, canopy: false, lowpass: false })).toBe(1008016);
    expect(chunkGpuBytes({ heightSide: 502, layerSide: 500, layers: 2, canopy: false, lowpass: false })).toBe(1508016);
    expect(chunkGpuBytes({ heightSide: 502, layerSide: 500, layers: 9, canopy: true, lowpass: true })).toBe(3 * 1008016 + 9 * 250000);
  });

  it('evicts least-recently-used first, never kept or pinned entries', () => {
    const e = [
      { key: 'a', bytes: 100, lastUsed: 5 },
      { key: 'b', bytes: 100, lastUsed: 1 },
      { key: 'c', bytes: 100, lastUsed: 2 },
      { key: 'd', bytes: 100, lastUsed: 0, pinned: true },
      { key: 'e', bytes: 100, lastUsed: 0 },
    ];
    expect(planEviction(e, 500, new Set())).toEqual([]);
    expect(planEviction(e, 300, new Set(['e']))).toEqual(['b', 'c']);
    expect(planEviction(e, 0, new Set(['a']))).toEqual(['e', 'b', 'c']);
  });

  it('clamps the budget below the hard cap and adapts the threshold', () => {
    expect(clampBudget(10 * 1024 * MiB)).toBe(HARD_CAP);
    expect(HARD_CAP).toBeLessThan(1.5e9);
    expect(adaptThreshold(1, 1, 700, 600)).toBe(1.25);
    expect(adaptThreshold(1.25, 1, 300, 600)).toBeCloseTo(1.25 / 1.1);
    expect(adaptThreshold(1, 1, 300, 600)).toBe(1);
    expect(adaptThreshold(1.2, 1, 500, 600)).toBe(1.2);
  });
});

// ---- heights over levels ----------------------------------------------------------------------

/** Chunk images (edge-clamped apron) of a raster for grid g. */
function chunkImages(g: GridSpec, raster: Float32Array): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  const s = heightImageSize(g);
  const nx = Math.ceil(g.width / g.chunkSize);
  const ny = Math.ceil(g.height / g.chunkSize);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const d = new Float32Array(s * s);
      for (let py = 0; py < s; py++) {
        for (let px = 0; px < s; px++) {
          const c = Math.min(Math.max(i * g.chunkSize - g.apron + px, 0), g.width - 1);
          const r = Math.min(Math.max(j * g.chunkSize - g.apron + py, 0), g.height - 1);
          d[py * s + px] = raster[r * g.width + c];
        }
      }
      out.set(`${i}_${j}`, d);
    }
  }
  return out;
}

describe('LevelHeights', () => {
  // 40×40 m AOI, 10-cell chunks; level 1 = 2 m (20×20 cells, 2×2 chunks).
  const W = 40;
  const f = (c: number, r: number) => 100 + 0.5 * c - 0.25 * r + 0.01 * c * r;
  const l0 = new Float32Array(W * W).map((_, k) => f(k % W, Math.floor(k / W)));
  const l1 = blockMean(l0, W, W, 2);
  const ex = { width: W, height: W };
  const g0: GridSpec = { width: W, height: W, chunkSize: 10, apron: 1, cellSize: 1, extentZ: W };
  const g1: GridSpec = { width: l1.width, height: l1.height, chunkSize: 10, apron: 1, cellSize: 2, extentZ: W };

  it('answers from the finest resident level, falling back to coarser ones', () => {
    const q0 = new HeightQuery(g0, 4, 4);
    const q1 = new HeightQuery(g1, 2, 2);
    const lh = new LevelHeights([q0, q1]);
    expect(Number.isNaN(lh.heightAt(5, -5))).toBe(true);
    for (const [k, d] of chunkImages(g1, l1.data)) {
      const [i, j] = k.split('_').map(Number);
      lh.add(1, i, j, d);
    }
    const v0 = lh.version;
    // Level 1 at a level-1 cell centre = block mean.
    const p = cellToWorld(3, 4, g1);
    expect(lh.heightAt(p.x, p.z)).toBeCloseTo(l1.data[4 * l1.width + 3], 4);
    expect(lh.levelAt(p.x, p.z)).toBe(1);
    const i0 = chunkImages(g0, l0);
    lh.add(0, 0, 0, i0.get('0_0')!);
    expect(lh.version).toBe(v0 + 1);
    const c = cellToWorld(4, 6, g0);
    expect(lh.heightAt(c.x, c.z)).toBeCloseTo(f(4, 6), 4); // finest
    expect(lh.levelAt(c.x, c.z)).toBe(0);
    expect(lh.heightAt(c.x, c.z, 1)).toBe(q1.heightAt(c.x, c.z)); // coarse only
    expect(lh.levelAt(30, -5)).toBe(1); // level-0 chunk there not resident
    lh.remove(0, 0, 0);
    expect(lh.levelAt(c.x, c.z)).toBe(1);
    expect(lh.loadedCount).toBe(4);
    expect(ex.width).toBe(40);
  });

  it('heightAtDisplayed samples the level of the drawn chunk, not the finest resident one', () => {
    const q0 = new HeightQuery(g0, 4, 4);
    const q1 = new HeightQuery(g1, 2, 2);
    const lh = new LevelHeights([q0, q1]);
    for (const [k, d] of chunkImages(g1, l1.data)) {
      const [i, j] = k.split('_').map(Number);
      lh.add(1, i, j, d);
    }
    lh.add(0, 0, 0, chunkImages(g0, l0).get('0_0')!);
    const c = cellToWorld(4, 6, g0); // inside level-0 chunk 0_0 and level-1 chunk 0_0
    // Before any frame: finest resident.
    expect(lh.heightAtDisplayed(c.x, c.z)).toBe(lh.heightAt(c.x, c.z));
    // Coarse parent drawn although the fine chunk is still resident → coarse surface.
    lh.setDisplayed([{ level: 1, i: 0, j: 0 }, { level: 1, i: 1, j: 0 }]);
    expect(lh.heightAtDisplayed(c.x, c.z)).toBe(q1.heightAt(c.x, c.z));
    expect(lh.heightAt(c.x, c.z)).toBeCloseTo(f(4, 6), 4); // true readout stays finest
    // Fine chunk drawn → fine surface.
    lh.setDisplayed([{ level: 0, i: 0, j: 0 }]);
    expect(lh.heightAtDisplayed(c.x, c.z)).toBe(q0.heightAt(c.x, c.z));
    // Nothing drawn at the position → finest resident fallback.
    expect(lh.heightAtDisplayed(30, -35)).toBe(lh.heightAt(30, -35));
  });

  it('heightAtDisplayed uses the node rectangle at a west edge with a non-drawn neighbour (audit terrain-3)', () => {
    const q0 = new HeightQuery(g0, 4, 4);
    const q1 = new HeightQuery(g1, 2, 2);
    const lh = new LevelHeights([q0, q1]);
    // Coarse level offset by +10 m so a fall-through to it is unmistakable.
    for (const [k, d] of chunkImages(g1, l1.data.map((v) => v + 10))) {
      const [i, j] = k.split('_').map(Number);
      lh.add(1, i, j, d);
    }
    lh.add(0, 1, 0, chunkImages(g0, l0).get('1_0')!); // west neighbour 0_0 neither resident nor drawn
    lh.setDisplayed([{ level: 0, i: 1, j: 0 }, { level: 1, i: 0, j: 0 }]);
    // x = 10.3 lies in level-0 chunk 1 (x ∈ [10, 20)), but its bilinear base cell (c = 9.8 → 9) is in chunk 0.
    const x = 10.3;
    const z = -40 + 4.5;
    expect(q0.chunkKeyAt(x, z)).toBe('0_0');
    expect(q0.nodeAt(x, z)).toEqual({ i: 1, j: 0 });
    expect(lh.heightAtDisplayed(x, z)).toBeCloseTo(f(9.8, 4), 4); // apron of 1_0, not the coarse level
    expect(q1.heightAt(x, z) - lh.heightAtDisplayed(x, z)).toBeGreaterThan(9);
  });
});

describe('blockMean (contract level downsampling)', () => {
  it('averages 2^k blocks with edge padding', () => {
    const src = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]); // 3×3
    const r = blockMean(src, 3, 3, 2);
    expect(r.width).toBe(2);
    expect(Array.from(r.data)).toEqual([(1 + 2 + 4 + 5) / 4, (3 + 3 + 6 + 6) / 4, (7 + 8 + 7 + 8) / 4, 9]);
  });
});

// ---- per-chunk low-pass ---------------------------------------------------------------------

describe('per-chunk low-pass (live local relief)', () => {
  const W = 50;
  const H = 40;
  const g: GridSpec = { width: W, height: H, chunkSize: 10, apron: 1 };
  const side = heightImageSize(g);
  const raster = new Float32Array(W * H).map((_, k) => {
    const c = k % W;
    const r = Math.floor(k / W);
    return 200 + Math.sin(c * 0.7) * 3 + Math.cos(r * 0.45) * 2 + ((c * 7 + r * 13) % 5) * 0.3;
  });
  const imgs = chunkImages(g, raster);
  const aoiBlur = (R: number) => boxBlur(raster, W, H, R);
  /** AOI-wide low-pass sampled on chunk (i, j)'s height-image grid (edge-clamped like the shader). */
  const expected = (lp: Float32Array, i: number, j: number) => {
    const out = new Float32Array(side * side);
    for (let py = 0; py < side; py++) {
      for (let px = 0; px < side; px++) {
        const c = Math.min(Math.max(i * 10 - 1 + px, 0), W - 1);
        const r = Math.min(Math.max(j * 10 - 1 + py, 0), H - 1);
        out[py * side + px] = lp[r * W + c];
      }
    }
    return out;
  };
  const perChunk = (i: number, j: number, R: number, chunk: (i: number, j: number) => Float32Array | undefined, fb: (c: number, r: number) => number = () => 0) => {
    const w = lowpassWindow(g, i, j, R);
    const reg = assembleRegion(g, w.c0, w.r0, w.size, w.size, chunk, fb);
    const lp = cropRaster(boxBlur(reg.data, w.size, w.size, R), w.size, R, R, side, side);
    clampOutside(lp, side, i * 10 - 1, j * 10 - 1, W, H);
    return { lp, approx: reg.approx };
  };

  it('equals the AOI-wide blur exactly when neighbours are resident (interior, edge and corner chunks)', () => {
    for (const R of [2, 7, 15]) {
      const lp = aoiBlur(R);
      for (const [i, j] of [[2, 1], [0, 0], [4, 3], [0, 2]]) {
        const { lp: got, approx } = perChunk(i, j, R, (a, b) => imgs.get(`${a}_${b}`));
        expect(approx).toBe(0);
        const want = expected(lp, i, j);
        let maxErr = 0;
        for (let k = 0; k < got.length; k++) maxErr = Math.max(maxErr, Math.abs(got[k] - want[k]));
        expect(maxErr).toBeLessThan(1e-3);
      }
    }
  });

  it('with missing neighbours only the band within R of that side is approximate', () => {
    const R = 4;
    const lp = aoiBlur(R);
    const coarse = blockMean(raster, W, H, 2);
    const fb = (c: number, r: number) => coarse.data[Math.floor(r / 2) * coarse.width + Math.floor(c / 2)];
    const { lp: got, approx } = perChunk(2, 1, R, (a, b) => (a === 2 && b === 1 ? imgs.get('2_1') : undefined), fb);
    expect(approx).toBeGreaterThan(0);
    const want = expected(lp, 2, 1);
    // Pixels ≥ R + 1 from the image border only see the chunk's own cells → exact.
    for (let py = R + 1; py < side - R - 1; py++) {
      for (let px = R + 1; px < side - R - 1; px++) expect(got[py * side + px]).toBeCloseTo(want[py * side + px], 3);
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { parseCatalog } from '../src/data/catalog';
import { encodeBitmap } from '../src/data/globalGrid';
import { validateManifest } from '../src/data/manifest';
import { parseOverview } from '../src/data/overview';
import type { LevelDims, NodeId } from '../src/terrain/levels';
import { nodeKey } from '../src/terrain/levels';
import { quadrantBit, selectNodes } from '../src/terrain/quadtree';
import type { NodeStatus } from '../src/terrain/quadtree';
import type { ChunkSource } from '../src/terrain/sources';
import { AoiResolver, CatalogResolver, placeManifestProblem, sessionRect } from '../src/terrain/sources';
import { overviewRaw, twoPlaceCatalog, v3Manifest } from './fixtures/v3';

const quiet = () => {};
const CAT_URL = 'http://localhost:5299/data/fixture-v3/catalog.json';

function setup() {
  const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
  const ov = parseOverview(overviewRaw(), 'http://localhost:5299/data/fixture-v3/overview/overview.json', quiet);
  const { rect, topLevel } = sessionRect(cat, ov);
  return { cat, ov, rect, topLevel, res: new CatalogResolver(cat, ov, rect) };
}

const src = (r: unknown) => r as ChunkSource;

describe('session rectangle', () => {
  it('= overview bbox ∪ 3D place bboxes, aligned at S_K', () => {
    const { rect, topLevel } = setup();
    expect(topLevel).toBe(3);
    expect(rect).toEqual({ E0: 380000, N0: 5460000, W: 8000, H: 4000 });
  });
  it('without an overview: places only, aligned at 1 km, top level 1', () => {
    const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    expect(sessionRect(cat, null)).toEqual({ rect: { E0: 380000, N0: 5460000, W: 4000, H: 2000 }, topLevel: 1 });
  });
});

describe('source resolver table (catalog mode)', () => {
  it('k ≥ 2 → overview by presence; k ∈ {0, 1} → pending until the owner manifest is ready', () => {
    const { res } = setup();
    // Session rect NW corner = (380000, 5464000). Level 2 (2 km): chunk (0, 1) = 380–382 km × 5460–5462 km.
    expect(src(res.resolve(2, 0, 1)).id).toBe('overview');
    expect(res.resolve(2, 0, 0)).toBe('none'); // presence bit 0 (no owned tile)
    expect(res.resolve(2, 3, 1)).toBe('none');
    expect(src(res.resolve(3, 1, 0)).id).toBe('overview');
    // Level 1 (1 km): chunk (0, 3) = tile 380_5460 → owner ort-a, manifest not loaded → pending.
    expect(res.resolve(1, 0, 3)).toBe('pending');
    expect(res.resolve(0, 0, 6)).toBe('pending');
    // Tile 383_5461 has no owner; tile 384_5460 belongs to a 'stats' place; 386_5463 is outside → none.
    expect(res.resolve(1, 3, 2)).toBe('none');
    expect(res.resolve(1, 4, 3)).toBe('none');
    expect(res.resolve(1, 6, 0)).toBe('none');
  });

  it('ready owner → its chunk in its own (i, j); absent presence bit → none; failed → none', () => {
    const { res } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mb = validateManifest(v3Manifest());
    expect(placeManifestProblem(mb, res.catalog.byId.get('ort-b')!)).toBeNull();
    const v0 = res.version;
    res.setPlace('ort-b', { state: 'ready', manifest: mb, baseUrl: 'http://localhost:5299/data/ort-b/' });
    expect(res.version).toBe(v0 + 1);
    // Tile 382_5461 = B's NW tile → B level-1 chunk (0, 0); session level-1 chunk (2, 2).
    const s = src(res.resolve(1, 2, 2));
    expect([s.id, s.i, s.j, s.baseUrl]).toEqual(['ort-b', 0, 0, 'http://localhost:5299/data/ort-b/']);
    expect(s.level.height.dtm.path).toBe('levels/1/dtm/{i}_{j}.webp');
    // Level 0, session (5, 7) = B level-0 (1, 3) → tile (0, 1) of B = 382_5460.
    const s0 = src(res.resolve(0, 5, 7));
    expect([s0.i, s0.j, s0.derived?.vat?.method]).toEqual([1, 3, 'rvt-vat-combined-v1']);
    expect(s0.level.layers.svf.min).toBe(0.6);
    // The manifest's presence lacks B's NE tile — that tile has no catalog owner either → none.
    expect(res.resolve(1, 3, 2)).toBe('none');
    // A manifest presence bit 0 on an owned tile → none ("not mine").
    const sparse = validateManifest(v3Manifest({ presence: encodeBitmap([1, 0, 0, 1], 2, 2) }));
    res.setPlace('ort-b', { state: 'ready', manifest: sparse, baseUrl: 'x/' });
    expect(res.resolve(1, 2, 3)).toBe('none'); // tile 382_5460: owned by B, not published
    expect(src(res.resolve(1, 3, 3)).id).toBe('ort-b');
    res.setPlace('ort-a', { state: 'failed', reason: 'HTTP 404' });
    expect(res.resolve(1, 0, 3)).toBe('none');
    warn.mockRestore();
  });

  it('a place manifest that is not v3 / wrong id / bad grid is not placeable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { res } = setup();
    const b = res.catalog.byId.get('ort-b')!;
    expect(placeManifestProblem(validateManifest({ ...v3Manifest(), version: 2 }), b)).toMatch(/not v3/);
    expect(placeManifestProblem(validateManifest(v3Manifest({ place: { id: 'ort-a', ags: '10000001' } })), b)).toMatch(/place id/);
    expect(placeManifestProblem(validateManifest(v3Manifest({ grid: {} })), b)).toMatch(/grid/);
    expect(placeManifestProblem(validateManifest(v3Manifest({ presence: { w: 2, h: 2, bits: 'AA==', count: 3 } })), b)).toMatch(/presence/);
    warn.mockRestore();
  });

  it('single-AOI mode: every chunk from the manifest; a v3 manifest’s absent tiles are none', () => {
    const m = validateManifest(v3Manifest());
    const r = new AoiResolver(m, 'http://h/data/ort-b/');
    expect(src(r.resolve(0, 0, 0)).id).toBe('aoi');
    expect(r.resolve(0, 2, 0)).toBe('none'); // NE tile absent
    expect(r.resolve(1, 1, 0)).toBe('none');
    expect(src(r.resolve(1, 1, 1)).i).toBe(1);
    expect(r.resolve(0, 2, 0)).toBe(r.resolve(0, 2, 0)); // cached, no allocation per call
    const v2 = validateManifest({ ...v3Manifest(), version: 2 });
    expect(src(new AoiResolver(v2, 'x/').resolve(0, 2, 0)).id).toBe('aoi');
  });
});

describe('quadtree with none / pending nodes', () => {
  // 2 km × 2 km, levels 0 (500 m chunks), 1 (1 km).
  const levels: LevelDims[] = [
    { level: 0, cellSize: 1, chunkSize: 500, size: { width: 2000, height: 2000 }, chunks: { nx: 4, ny: 4 } },
    { level: 1, cellSize: 2, chunkSize: 500, size: { width: 1000, height: 1000 }, chunks: { nx: 2, ny: 2 } },
  ];
  const run = (status: (n: NodeId) => NodeStatus) =>
    selectNodes({
      levels, projFactor: 1000, threshold: 1, distance: () => 10, inView: () => true,
      hasData: () => true, canReplace: () => true, wasActive: () => false, status,
    });

  it('a node with some none children refines into the others and keeps the none quadrants', () => {
    // Level-1 node (0, 0): its child (1, 0) (NE quadrant) has no source.
    const sel = run((n) => (n.level === 0 && n.i === 1 && n.j === 0 ? 'none' : 'ok'));
    const keys = sel.draw.map((n) => nodeKey(n.level, n.i, n.j));
    expect(keys).toContain('1/0_0');
    expect(keys).not.toContain('0/1_0');
    const k = keys.indexOf('1/0_0');
    expect(sel.drawMask[k]).toBe(quadrantBit({ level: 0, i: 0, j: 0 }) | quadrantBit({ level: 0, i: 0, j: 1 }) | quadrantBit({ level: 0, i: 1, j: 1 }));
    expect(sel.drawMask[k]).toBe(0b1101);
    // Other level-1 nodes are fully replaced by their four children.
    expect(keys.filter((x) => x.startsWith('0/')).length).toBe(3 + 12);
    expect(sel.want.some((w) => w.node.level === 0 && w.node.i === 1 && w.node.j === 0)).toBe(false);
  });

  it('pending children stop refinement (parent drawn whole, nothing requested there)', () => {
    const sel = run((n) => (n.level === 0 && n.i < 2 && n.j < 2 && n.i + n.j === 1 ? 'pending' : 'ok'));
    const k = sel.draw.findIndex((n) => n.level === 1 && n.i === 0 && n.j === 0);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(sel.drawMask[k]).toBe(0);
    expect(sel.draw.some((n) => n.level === 0 && n.i < 2 && n.j < 2)).toBe(false);
  });

  it('none / pending roots are skipped; all-none children leave the parent whole', () => {
    const sel = run((n) => (n.level === 1 && n.i === 1 ? 'none' : n.level === 0 && n.j >= 2 ? 'none' : 'ok'));
    const keys = sel.draw.map((n) => nodeKey(n.level, n.i, n.j));
    expect(keys.some((x) => x.startsWith('1/1_'))).toBe(false);
    expect(keys).toContain('1/0_1');
    expect(sel.drawMask[keys.indexOf('1/0_1')]).toBe(0);
    expect(sel.want.length).toBe(0);
  });

  it('without status every node is ok (old behaviour)', () => {
    const sel = selectNodes({
      levels, projFactor: 1000, threshold: 1, distance: () => 10, inView: () => true,
      hasData: () => true, canReplace: () => true, wasActive: () => false,
    });
    expect(sel.draw.length).toBe(16);
    expect(sel.drawMask.every((m) => m === 0)).toBe(true);
  });
});

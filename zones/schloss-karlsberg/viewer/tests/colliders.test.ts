/** KB-I106: cached walk-collider pieces and the shader warm-up's program inputs (pure parts). */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LruCache, TILE, mergeWorld, pieceFrom, pushOutPieces, raycastPieces, terrainTileGeometry, tilesAround } from '../src/colliders.ts';
import { programInputKey, programProxies } from '../src/precompile.ts';

// a 100 × 70 grid of 1 m cells, west 1000 / north 2000 (local = E − e0, −(N − n0) with e0 = 1000, n0 = 2000)
const g = { west: 1000, north: 2000, cell: 1, cols: 100, rows: 70 };
const e0 = 1000;
const n0 = 2000;
const cellX = (c: number) => g.west + (c + 0.5) * g.cell - e0;
const cellZ = (r: number) => -(g.north - (r + 0.5) * g.cell - n0);
const plane = (x: number, z: number) => 300 + 0.1 * x - 0.05 * z;
const h = new Float32Array(g.cols * g.rows);
for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) h[r * g.cols + c] = plane(cellX(c), cellZ(r));

const down = (x: number, z: number) => new THREE.Ray(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));

describe('terrain collider tiles', () => {
  it('tilesAround covers the radius in TILE steps, clamped to the grid', () => {
    expect(tilesAround(cellX(40), cellZ(40), 1, g, e0, n0)).toEqual([[32, 32]]);
    const t = tilesAround(cellX(31.5), cellZ(31.5), 2, g, e0, n0);
    expect(t).toEqual([[0, 0], [0, 32], [32, 0], [32, 32]]);
    // far outside on the south-east: only the last tiles (the last full cell row/col is rows−2 / cols−2)
    expect(tilesAround(cellX(500), cellZ(500), 10, g, e0, n0)).toEqual([]);
    const all = tilesAround(cellX(50), cellZ(35), 1000, g, e0, n0);
    expect(all.length).toBe(Math.ceil((g.rows - 1) / TILE) * Math.ceil((g.cols - 1) / TILE));
  });

  it('a tile mesh reproduces the grid heights and seams with its neighbour', () => {
    const a = pieceFrom('a', terrainTileGeometry(h, g, 0, 0, cellX, cellZ)!);
    const b = pieceFrom('b', terrainTileGeometry(h, g, 0, 32, cellX, cellZ)!);
    expect(a.triangles).toBe(TILE * TILE * 2);
    for (const [x, z] of [[cellX(5.3), cellZ(7.8)], [cellX(31.99), cellZ(3)], [cellX(32), cellZ(3)]] as const) {
      const hit = raycastPieces([a, b], down(x, z), 200);
      expect(hit).not.toBeNull();
      expect(hit!.point.y).toBeCloseTo(plane(x, z), 3);
    }
    // the seam column belongs to both tiles: no gap between them
    expect(a.box.max.x).toBeCloseTo(b.box.min.x, 4);
  });

  it('leaves out cells with a NaN corner, and returns null for an all-NaN tile', () => {
    const holed = h.slice();
    holed[5 * g.cols + 5] = NaN;
    const p = pieceFrom('h', terrainTileGeometry(holed, g, 0, 0, cellX, cellZ)!);
    expect(p.triangles).toBe(TILE * TILE * 2 - 8);
    expect(raycastPieces([p], down(cellX(5), cellZ(5)), 200)).toBeNull();
    expect(terrainTileGeometry(new Float32Array(h.length).fill(NaN), g, 0, 0, cellX, cellZ)).toBeNull();
  });
});

describe('collider pieces', () => {
  const wall = () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 10));
    m.position.set(5, 2, 0);
    m.updateMatrixWorld(true);
    return m;
  };

  it('mergeWorld bakes the world matrices; raycast picks the nearest piece within range', () => {
    const geo = mergeWorld([wall()])!;
    expect(geo.attributes.position.count).toBe(36);
    const w = pieceFrom('w', geo);
    expect(w.box.min.x).toBeCloseTo(4.8, 6);
    const floor = pieceFrom('f', mergeWorld([Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2)), {})])!);
    const ray = new THREE.Ray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    expect(raycastPieces([floor, w], ray, 10)!.distance).toBeCloseTo(4.8, 5);
    expect(raycastPieces([floor, w], ray, 3)).toBeNull();
    expect(raycastPieces([floor], down(0, 0), 500)!.point.y).toBeCloseTo(0, 6);
    expect(mergeWorld([])).toBeNull();
  });

  it('pushOutPieces moves a capsule horizontally out of a wall', () => {
    const w = pieceFrom('w', mergeWorld([wall()])!);
    const seg = new THREE.Line3(new THREE.Vector3(4.6, 0.5, 0), new THREE.Vector3(4.6, 1.6, 0));
    const box = new THREE.Box3().setFromPoints([seg.start, seg.end]).expandByScalar(0.35);
    pushOutPieces([w], seg, box, 0.35);
    expect(seg.start.x).toBeLessThanOrEqual(4.8 - 0.35 + 1e-4);
    expect(seg.start.y).toBe(0.5);
    expect(seg.end.z).toBe(0);
  });
});

describe('LruCache', () => {
  it('get refreshes, prune keeps the wanted and drops the oldest beyond max, evicting each once', () => {
    const evicted: string[] = [];
    const c = new LruCache<string>(2, (v) => evicted.push(v));
    c.set('a', 'A');
    c.set('b', 'B');
    c.set('c', 'C');
    c.get('a'); // order: b, c, a
    c.prune(new Set(['b']));
    expect(evicted).toEqual(['C']);
    expect([c.has('a'), c.has('b'), c.has('c')]).toEqual([true, true, false]);
    c.prune(new Set());
    expect(c.size).toBe(2);
    c.delete('a');
    c.delete('a');
    c.clear();
    expect(evicted).toEqual(['C', 'A', 'B']);
    expect(c.size).toBe(0);
  });
});

describe('shader warm-up program inputs', () => {
  it('programInputKey tells instancing, instance colours and attribute sets apart, order-free', () => {
    expect(programInputKey(1, {}, ['uv', 'position'], [])).toBe(programInputKey(1, {}, ['position', 'uv'], []));
    const keys = new Set([
      programInputKey(1, {}, ['position'], []),
      programInputKey(1, { isInstancedMesh: true }, ['position'], []),
      programInputKey(1, { isInstancedMesh: true, instanceColor: {} }, ['position'], []),
      programInputKey(1, {}, ['position', 'color'], []),
      programInputKey(2, {}, ['position'], []),
      programInputKey(1, { isLine: true, isLineSegments: true }, ['position'], []),
    ]);
    expect(keys.size).toBe(6);
  });

  it('programProxies: one never-culled proxy per input across roots and calls, multi-materials split', () => {
    const geo = new THREE.BoxGeometry();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, a), new THREE.Mesh(geo, a), new THREE.Mesh(geo, [a, b]));
    const inst = new THREE.InstancedMesh(geo, a, 5);
    inst.visible = false; // hidden LODs warm too
    root.add(inst);
    const seen = new Set<string>();
    const p = programProxies([root, root], seen);
    expect(p.length).toBe(3); // a mesh, b mesh, a instanced
    expect(p.every((o) => o.frustumCulled === false)).toBe(true);
    const im = p.find((o) => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    expect(im.count).toBe(1);
    expect(programProxies([root], seen)).toEqual([]);
    for (const o of p) if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
});

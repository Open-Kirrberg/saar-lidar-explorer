import { describe, expect, it } from 'vitest';
import type { BufferGeometry, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FIXTURE_HOUSES, buildingMesh, encodeGlb, houseChunk } from '../scripts/fixture-buildings';
import { FIXTURE, fixtureHeight } from '../scripts/fixture-terrain';
import {
  buildingChunkKey,
  chunkRects,
  classifySurfaceByNormal,
  displayHeight,
  planChunks,
  rectDistance,
} from '../src/buildings/select';
import type { ChunkPlanInput } from '../src/buildings/select';
import { SURFACE_ATTRIBUTE } from '../src/data/manifest';

const grid = { chunkSize: 500, cellSize: 1, extentZ: 1000 };

describe('buildings: chunk rects', () => {
  it('maps (i, j) to x east and z = −(N − N0) with row 0 at the north edge', () => {
    const [nw, se] = chunkRects([[0, 0], [1, 1]], grid);
    expect(nw).toMatchObject({ key: '0_0', xMin: 0, xMax: 500, zMin: -1000, zMax: -500 });
    expect(se).toMatchObject({ key: '1_1', xMin: 500, xMax: 1000, zMin: -500, zMax: 0 });
    // A point 10 m north of the AOI's south-west corner (u = 10, v = 10) → x = 10, z = −10 → chunk (0, 1).
    const [sw] = chunkRects([[0, 1]], grid);
    expect(rectDistance(sw, 10, -10)).toBe(0);
  });

  it('honours cellSize and the margin', () => {
    const [r] = chunkRects([[2, 3]], { chunkSize: 500, cellSize: 2, extentZ: 8000 }, 50);
    expect(r).toMatchObject({ xMin: 1950, xMax: 3050, zMin: 3000 - 8000 - 50, zMax: 4000 - 8000 + 50 });
  });

  it('rectDistance is horizontal Euclidean distance, 0 inside', () => {
    const [r] = chunkRects([[0, 0]], grid);
    expect(rectDistance(r, 250, -750)).toBe(0);
    expect(rectDistance(r, 503, -750)).toBeCloseTo(3);
    expect(rectDistance(r, 503, -1004)).toBeCloseTo(5);
  });

  it('fixture houses land in the chunk their centroid lies in', () => {
    for (const h of FIXTURE_HOUSES) {
      const [i, j] = houseChunk(h);
      const [r] = chunkRects([[i, j]], { chunkSize: FIXTURE.chunkSize, cellSize: 1, extentZ: FIXTURE.height });
      expect(rectDistance(r, h.u, -h.v)).toBe(0);
    }
  });
});

describe('buildings: planChunks', () => {
  // A row of 10 chunks along x at z ∈ [−1000, −500].
  const rects = chunkRects(Array.from({ length: 10 }, (_, i) => [i, 0] as [number, number]), grid);
  const base = (over: Partial<ChunkPlanInput> = {}): ChunkPlanInput => ({
    rects,
    x: 250,
    z: -750,
    resident: new Set(),
    loading: new Set(),
    failed: new Set(),
    loadRadius: 1000,
    dropRadius: 1600,
    maxInFlight: 3,
    ...over,
  });

  it('loads the nearest chunks first, capped by free in-flight slots', () => {
    const p = planChunks(base());
    // Within 1000 m: chunks 0 (0 m), 1 (250 m), 2 (750 m) — chunk 3 is 1250 m away.
    expect(p.load).toEqual(['0_0', '1_0', '2_0']);
    expect(p.pending).toBe(3);
    const busy = planChunks(base({ loading: new Set(['0_0', '1_0']) }));
    expect(busy.load).toEqual(['2_0']);
    expect(planChunks(base({ loading: new Set(['5_0', '6_0', '7_0']) })).load).toEqual([]);
  });

  it('skips resident and failed chunks', () => {
    const p = planChunks(base({ resident: new Set(['0_0']), failed: new Set(['1_0']), maxInFlight: 6 }));
    expect(p.load).toEqual(['2_0']);
    expect(p.pending).toBe(1);
  });

  it('keeps chunks in the hysteresis band and drops them beyond dropRadius', () => {
    const resident = new Set(['3_0', '4_0']); // 1250 m, 1750 m away
    const p = planChunks(base({ resident, loading: new Set(['5_0']) })); // 2250 m
    expect(p.drop.sort()).toEqual(['4_0', '5_0']);
    expect(p.load).not.toContain('3_0');
    // Camera moves east: chunk 3 is now near and stays; chunk 0 falls out.
    const q = planChunks(base({ x: 2250, resident: new Set(['0_0', '3_0']) }));
    expect(q.drop).toEqual(['0_0']);
  });

  it('a drop radius smaller than the load radius is treated as equal (no load/drop flapping)', () => {
    const p = planChunks(base({ dropRadius: 100, resident: new Set(['2_0']) }));
    expect(p.drop).toEqual([]);
  });

  it('key format matches the manifest path template indices', () => {
    expect(buildingChunkKey(3, 7)).toBe('3_7');
  });
});

describe('buildings: surface classes and exaggeration', () => {
  it('classifies normals into ground / wall / roof', () => {
    const n = [0, -1, 0, 1, 0, 0, 0, 1, 0, 0.6, 0.8, 0, 0, 0.1, -0.995];
    expect([...classifySurfaceByNormal(n)]).toEqual([0, 1, 2, 2, 1]);
  });

  it('displayHeight is the terrain formula hRef + (h − hRef)·exag', () => {
    expect(displayHeight(300, 250, 1)).toBe(300);
    expect(displayHeight(300, 250, 3)).toBe(400);
    expect(displayHeight(250, 250, 5)).toBe(250);
  });
});

describe('buildings: fixture glb (contract "Models")', () => {
  it('fixture houses stand on the fixture terrain (base = lowest footprint corner)', () => {
    for (const h of FIXTURE_HOUSES) {
      const m = buildingMesh([h]);
      let minY = Infinity;
      for (let k = 1; k < m.positions.length; k += 3) minY = Math.min(minY, m.positions[k]);
      const g = fixtureHeight(h.u, h.v);
      expect(minY).toBeLessThanOrEqual(g + 1e-3); // walls reach the ground at the centre (no floating)
      expect(g - minY).toBeLessThan(3); // and don't sink deep (sloped fixture terrain)
    }
  });

  it('flat normals point outward and match the surface classes', () => {
    const m = buildingMesh([FIXTURE_HOUSES[0]]);
    const cls = classifySurfaceByNormal(m.normals);
    expect([...cls]).toEqual([...m.surface]);
    const h = FIXTURE_HOUSES[0];
    for (let t = 0; t < m.surface.length; t += 3) {
      if (m.surface[t] !== 1) continue; // walls: horizontal normal away from the footprint centre
      const cx = (m.positions[t * 3] + m.positions[t * 3 + 3] + m.positions[t * 3 + 6]) / 3;
      const cz = (m.positions[t * 3 + 2] + m.positions[t * 3 + 5] + m.positions[t * 3 + 8]) / 3;
      expect((cx - h.u) * m.normals[t * 3] + (cz + h.v) * m.normals[t * 3 + 2]).toBeGreaterThan(0);
    }
  });

  it('round-trips through three GLTFLoader with `_SURFACE` → `_surface`', async () => {
    const m = buildingMesh(FIXTURE_HOUSES.slice(0, 2));
    const glb = encodeGlb(m);
    expect(glb.byteLength % 4).toBe(0);
    const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '');
    const meshes: Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes).toHaveLength(1);
    const g = meshes[0].geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    const surf = g.getAttribute(SURFACE_ATTRIBUTE);
    expect(pos.count).toBe(m.surface.length);
    expect(surf.count).toBe(m.surface.length);
    for (let k = 0; k < surf.count; k += 7) {
      expect(surf.getX(k)).toBe(m.surface[k]);
      expect(pos.getY(k)).toBeCloseTo(m.positions[k * 3 + 1], 4);
      expect(g.getAttribute('normal').getZ(k)).toBeCloseTo(m.normals[k * 3 + 2], 5);
    }
    expect(meshes[0].matrixWorld.equals(meshes[0].matrix)).toBe(true);
  });
});

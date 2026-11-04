import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { parseCaptureScale } from '../src/zones/contract';
import type { ZoneAsset } from '../src/zones/contract';
import { colliderPlan, firstViewWeights, LodSwitcher, sceneAssets, scaleAbout, spawnLocal, wantedLod } from '../src/zones/runtime/gltfPlan';
import { buildCollider, EYE_M, STEP_UP, Walker } from '../src/zones/runtime/walk';

const asset = (role: ZoneAsset['role'], id: string = role): ZoneAsset => ({
  id,
  role,
  bboxLocal: [
    [0, 240, -10],
    [20, 250, 10],
  ],
  lods: [
    { path: `${id}/medium.glb`, until_m: 60, bytes: 2_000_000 },
    { path: `${id}/reduced.glb`, until_m: null, bytes: 1_000_000 },
  ],
});

describe('gltf plan', () => {
  it('collides with collider assets, else the scene coarsest LOD', () => {
    expect(colliderPlan({ assets: [asset('scene')] })).toEqual([{ asset: asset('scene'), lod: 1, drawn: true }]);
    const plan = colliderPlan({ assets: [asset('scene'), asset('collider')] });
    expect(plan.map((p) => [p.asset.role, p.lod, p.drawn])).toEqual([['collider', 1, false]]);
    expect(sceneAssets({ assets: [asset('collider')] })).toEqual([]);
  });

  it('wants the fine LOD near the bbox, the coarse one far or on „niedrig“', () => {
    const a = asset('scene');
    expect(wantedLod(a, [5, 245, 0])).toBe(0);
    expect(wantedLod(a, [100, 245, 0])).toBe(1);
    expect(wantedLod(a, [5, 245, 0], 'niedrig')).toBe(1);
  });

  it('swaps LODs without a hole: load → show → drop, one load at a time', () => {
    const sw = new LodSwitcher(2);
    expect(sw.want(1)).toEqual([{ type: 'load', lod: 1 }]);
    expect(sw.want(0)).toEqual([]); // busy
    expect(sw.loaded(1)).toEqual([{ type: 'show', lod: 1, hide: null }]);
    expect(sw.want(0)).toEqual([{ type: 'load', lod: 0 }]);
    expect(sw.shown).toBe(1); // coarse stays until fine is ready
    expect(sw.loaded(0)).toEqual([
      { type: 'show', lod: 0, hide: 1 },
      { type: 'drop', lod: 1 },
    ]);
    expect(sw.want(0)).toEqual([]);
    // a failed level is not retried
    expect(sw.want(1)).toEqual([{ type: 'load', lod: 1 }]);
    sw.failed(1);
    expect(sw.want(1)).toEqual([]);
    expect(sw.shown).toBe(0);
  });

  it('scales about the pivot and keeps the pivot fixed', () => {
    const s = { factor: 1.1, pivotLocal: [8, 243, -5] as [number, number, number] };
    expect(scaleAbout([8, 243, -5], s)).toEqual([8, 243, -5]);
    const p = scaleAbout([18, 244, -5], s);
    expect(p[0]).toBeCloseTo(19, 9);
    expect(p[1]).toBeCloseTo(244.1, 9);
    expect(scaleAbout([1, 2, 3], undefined)).toEqual([1, 2, 3]);
    const spawn = { E: 381010, N: 5460005, h: 245, heading_deg: 0, pitch_deg: 0, mode: 'gehen' as const };
    expect(spawnLocal(spawn, { E0: 381000, N0: 5460000 })).toEqual([10, 245, -5]);
  });

  it('parses capture.scale and rejects bad factors', () => {
    expect(parseCaptureScale({ factor: 1.05, pivotLocal: [1, 2, 3], source: 'camera-height' })).toMatchObject({ factor: 1.05, pivotLocal: [1, 2, 3] });
    expect(parseCaptureScale({ factor: 3, pivotLocal: [1, 2, 3] })).toBeNull();
    expect(parseCaptureScale({ factor: 1, pivotLocal: [1, 2] })).toBeNull();
  });

  it('weights the first-view progress by declared bytes', () => {
    expect(firstViewWeights([asset('scene', 'a'), { ...asset('scene', 'b'), lods: [{ path: 'b.glb', until_m: null, bytes: 3_000_000 }] }])).toEqual([0.25, 0.75]);
  });
});

/** A 10 × 10 m room (floor y = 100, walls 3 m) with a door gap in the south wall, a 0.2 m step, a 1 m counter. */
function room(): Group {
  const g = new Group();
  const m = new MeshBasicMaterial();
  const add = (geo: BoxGeometry | PlaneGeometry, x: number, y: number, z: number, rotX = 0) => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    g.add(mesh);
  };
  add(new PlaneGeometry(30, 30), 0, 100, 0, -Math.PI / 2); // floor + street
  add(new BoxGeometry(10, 3, 0.2), 0, 101.5, -5); // north wall
  add(new BoxGeometry(0.2, 3, 10), -5, 101.5, 0); // west
  add(new BoxGeometry(0.2, 3, 10), 5, 101.5, 0); // east
  add(new BoxGeometry(4, 3, 0.2), -3, 101.5, 5); // south, left of the door (door x ∈ [-1, 1])
  add(new BoxGeometry(4, 3, 0.2), 3, 101.5, 5); // south, right
  add(new BoxGeometry(4, 0.2, 2), 0, 100.1, 2.5); // step: top at 100.2 inside the door
  add(new BoxGeometry(2, 0.4, 2), 0, 100.2, 0.5); // second step: top at 100.4 (riser 0.2 m above the first)
  add(new BoxGeometry(4, 1, 1), 0, 100.5, -3); // counter: top at 101
  g.updateMatrixWorld(true);
  return g;
}

describe('walk on a mesh', () => {
  const bvh = buildCollider(room())!;

  it('merges meshes into one collider', () => {
    expect(bvh.geometry.index!.count / 3).toBeGreaterThan(50);
  });

  it('finds the floor below the knees and settles the spawn', () => {
    const w = new Walker(bvh, 0);
    expect(w.settle(0, 10, 101.6)).toBeCloseTo(100, 5);
    expect(w.groundAt(0, 2.5, 100 + STEP_UP)).toBeCloseTo(100.2, 5);
    // spawn beyond the mesh edge (first camera of a capture): feet one eye height below the spawn
    expect(w.settle(40, 40, 101.6)).toBeCloseTo(100, 5);
  });

  it('walks in through the door, climbs the step, stops at the counter', () => {
    const w = new Walker(bvh, 0);
    w.settle(0, 10, 100 + EYE_M);
    let x = 0;
    let z = 10;
    let maxY = 0;
    for (let i = 0; i < 400; i++) {
      const q = w.step(x, z, x, z - 0.05);
      x = q.x;
      z = q.z;
      maxY = Math.max(maxY, q.y);
    }
    expect(maxY).toBeCloseTo(100.4, 5); // climbed both steps (risers are not walls)
    expect(z).toBeGreaterThan(-2.5); // counter front at z = -2.5
    expect(z).toBeLessThan(-2.5 + 0.3);
    expect(w.groundY).toBeCloseTo(100, 5);
  });

  it('a wall blocks off the door', () => {
    const w = new Walker(bvh, 0);
    w.settle(3, 10, 101.6);
    let x = 3;
    let z = 10;
    for (let i = 0; i < 200; i++) ({ x, z } = w.step(x, z, x, z - 0.05));
    expect(z).toBeGreaterThan(5.1 + 0.2); // south wall outer face at z = 5.1, body radius 0.25
    expect(z).toBeLessThan(5.1 + 0.3);
  });

  it('does not drop into a mirror world under the floor', () => {
    const g = new Group();
    const m = new MeshBasicMaterial();
    const floor = new Mesh(new PlaneGeometry(2, 2), m); // floor x ∈ [-1, 1], hole beyond
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 50;
    const ghost = new Mesh(new PlaneGeometry(10, 10), m); // reflection 1.5 m below
    ghost.rotation.x = -Math.PI / 2;
    ghost.position.y = 48.5;
    g.add(floor, ghost);
    g.updateMatrixWorld(true);
    const w = new Walker(buildCollider(g)!, 0);
    w.settle(0, 0, 51.6);
    let x = 0;
    for (let i = 0; i < 60; i++) x = w.step(x, 0, x + 0.05, 0).x;
    expect(x).toBeGreaterThan(2.5);
    expect(w.groundY).toBeCloseTo(50, 5);
  });

  it('keeps the height over a hole', () => {
    const g = new Group();
    const floor = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 50;
    g.add(floor);
    g.updateMatrixWorld(true);
    const w = new Walker(buildCollider(g)!, 0);
    w.settle(0, 0, 51.6);
    let x = 0;
    for (let i = 0; i < 100; i++) x = w.step(x, 0, x + 0.05, 0).x;
    expect(w.groundY).toBeCloseTo(50, 5);
    expect(x).toBeGreaterThan(4); // walked off the edge at the same height
  });
});

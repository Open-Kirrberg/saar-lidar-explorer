// Wave-5 review (experience): the Rundflug opened skimming tree crowns that filled the frame, and a near crown blocked
// about a third of the Galerie shot. This builds the real vegetation (1789 forest, hinterland and the site / garden
// trees of the catalogue) in node, takes every crown as a sphere and checks each shot at u = 0.05 … 0.95: at most 15 %
// of a 16 × 7 ray grid through the letterboxed frame may hit a crown within 30 m (and within 60 m) of the camera,
// and the approach stays ≥ 25 m above the canopy.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '@model/context.ts';
import { loadSite } from '@model/catalogue.ts';
import { gridFrame } from '@model/frame.ts';
import { createMaterials } from '@model/materials/index.ts';
import { buildFeatures } from '@model/site/features.ts';
import { Forest } from '../src/forest.ts';
import { TerrainData, type TerrainMeta } from '../src/terrain.ts';
import { type Sphere, type TourAnchors, nearOcclusion, resolveTour, rundflugSpec, shotAt } from '../src/tour.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const f32 = (p: string) => {
  const b = read(p);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const u8 = (p: string) => new Uint8Array(read(p));

const MAX_SHARE = 0.15;
let crowns: Sphere[] = [];
let tour: ReturnType<typeof resolveTour>;
let ground: (x: number, z: number) => number;

beforeAll(() => {
  const meta = JSON.parse(read('viewer/public/terrain/meta.json').toString('utf8')) as TerrainMeta;
  const T = 'viewer/public/terrain/';
  const terrain = new TerrainData(meta, f32(T + meta.files.dtm1789), f32(T + meta.files.dtm2025), u8(T + meta.files.ground), meta.files.ground2025 ? u8(T + meta.files.ground2025) : undefined);
  ground = terrain.sample;
  const { spec } = loadSite(JSON.parse(read('model/catalogue.json').toString('utf8')));
  const layout = makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant });
  const ctx: BuildContext = { spec, materials: createMaterials(), terrain: terrain.sample, options: { ...DEFAULT_BUILD_OPTIONS }, layout, lod: 1 };
  // anchors as the viewer measures them (building origin at its base height)
  const anchors: TourAnchors = {};
  const centres: { id: string; x: number; z: number; cls: string; fn: string }[] = [];
  for (const b of spec.buildings) {
    try {
      const L = layout(b);
      anchors[b.id] = { x: L.frame.originLocal.x, y: L.stack.base_h, z: L.frame.originLocal.z };
      centres.push({ id: b.id, x: L.frame.originLocal.x, z: L.frame.originLocal.z, cls: b.cls, fn: String((b as { function?: string }).function ?? '') });
    } catch {
      /* unplaced */
    }
  }
  const gridU = gridFrame(spec.palace_grid).uDir;
  const cdl = anchors['KB-B01'];
  const forest = new Forest(terrain, {
    gridU: [gridU[0], -gridU[1]],
    centre: cdl ? [cdl.x, cdl.z] : undefined,
    parcels: (spec as unknown as { landcover?: import('../src/hinterland.ts').LandcoverParcel[] }).landcover ?? [],
    farms: centres.filter((e) => (e.cls === 'FARM' || e.cls === 'FARM_GROUP') && /farm|cense|sheep|bergerie|village|hameau|barn/i.test(e.fn)).map((e) => ({ id: e.id, x: e.x, z: e.z })),
  });
  const features = buildFeatures(spec, ctx);
  const m = new THREE.Matrix4();
  const c = new THREE.Vector3();
  for (const root of [forest.group, features.group]) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      const mat = im.material as THREE.Material;
      if (!im.isInstancedMesh || Array.isArray(mat) || mat?.name !== 'vegetation.leaf') return;
      im.geometry.computeBoundingSphere();
      const bs = im.geometry.boundingSphere!;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        m.premultiply(im.matrixWorld);
        c.copy(bs.center).applyMatrix4(m);
        // the bounding sphere encloses the crown envelope; 0.9 of it is still at least the crown's silhouette
        crowns.push({ x: c.x, y: c.y, z: c.z, r: 0.9 * bs.radius * m.getMaxScaleOnAxis() });
      }
    });
  }
  tour = resolveTour(rundflugSpec(anchors), terrain.sample);
}, 120_000);

describe('Rundflug: no near crowns filling the frame (wave-5 review)', () => {
  it('found the vegetation', () => {
    expect(crowns.length).toBeGreaterThan(5000);
  });

  it('every shot keeps near crowns below 15 % of the frame', () => {
    const worst: Record<string, number> = {};
    for (const s of tour.shots) {
      let w = 0;
      for (let k = 1; k <= 19; k++) {
        const f = shotAt(tour, s.spec.id, k / 20, ground)!;
        // the review's 30 m, and 60 m for the big garden crowns that fill an edge from further away
        w = Math.max(w, nearOcclusion(f.pos, f.look, crowns), nearOcclusion(f.pos, f.look, crowns, { maxDist: 60 }));
      }
      worst[s.spec.id] = Math.round(w * 1000) / 1000;
    }
    console.info('[tour] worst near-crown share per shot', worst);
    for (const [id, w] of Object.entries(worst)) expect(w, id).toBeLessThanOrEqual(MAX_SHARE);
  });
});

/** Height of the camera above the highest crown top within `radius` metres horizontally (Infinity: none). */
function canopyClearance(pos: readonly number[], radius = 50): number {
  let top = -Infinity;
  for (const c of crowns) if (Math.hypot(c.x - pos[0], c.z - pos[2]) < radius + c.r) top = Math.max(top, c.y + c.r);
  return pos[1] - top;
}

describe('Rundflug: the approach flies well above the canopy (wave-5 review)', () => {
  it('anflug keeps ≥ 25 m over every crown within 50 m', () => {
    let worst = Infinity;
    for (let k = 0; k <= 20; k++) worst = Math.min(worst, canopyClearance(shotAt(tour, 'anflug', k / 20, ground)!.pos));
    console.info('[tour] anflug canopy clearance (m)', worst.toFixed(1));
    expect(worst).toBeGreaterThanOrEqual(25);
  });
});

describe('nearOcclusion', () => {
  it('counts a crown in front of the camera and ignores one behind or beyond the range', () => {
    const pos: [number, number, number] = [0, 10, 0];
    const look: [number, number, number] = [0, 10, -100];
    expect(nearOcclusion(pos, look, [])).toBe(0);
    // a 6 m crown 10 m ahead fills much of the frame
    expect(nearOcclusion(pos, look, [{ x: 0, y: 10, z: -10, r: 6 }])).toBeGreaterThan(0.3);
    expect(nearOcclusion(pos, look, [{ x: 0, y: 10, z: 10, r: 6 }])).toBe(0);
    expect(nearOcclusion(pos, look, [{ x: 0, y: 10, z: -60, r: 6 }])).toBe(0);
    // camera inside a crown: everything blocked
    expect(nearOcclusion(pos, look, [{ x: 0, y: 10, z: 0, r: 3 }])).toBe(1);
  });
});

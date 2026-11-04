import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { isPlaced } from '../src/spec.ts';
import { roofSection } from '../src/layout/roof.ts';
import { createMaterials } from '../src/materials/index.ts';
import { buildExterior, wallSpansS } from '../src/exterior/index.ts';
import { GeoBuilder } from '../src/exterior/builder.ts';
import { halfProfile, rectRoof } from '../src/exterior/roof.ts';
import { outlineWithRisalits } from '../src/exterior/facade.ts';
import { signedArea } from '../src/layout/geom.ts';
import { inEpoch } from '../src/layout/epoch.ts';
import { buildFeatures } from '../src/site/features.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const base = { spec, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ ...base, lod });

function bounds(g: THREE.Object3D): THREE.Box3 {
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g);
}

describe('roof geometry', () => {
  it('half profile of a mansard runs eaves -> break -> deck/ridge', () => {
    const s = roofSection({ type: 'mansard', depth: 18, eaves_h: 356, pitch_lower: 70, pitch_upper: 21, ridge_h: 362.72 });
    const p = halfProfile(s);
    expect(p[0]).toEqual([0, 356]);
    expect(p[p.length - 1][1]).toBeCloseTo(362.72, 2);
    for (let i = 1; i < p.length; i++) expect(p[i][1]).toBeGreaterThanOrEqual(p[i - 1][1]);
  });

  it('a hip roof reaches the section ridge and stays inside the footprint', () => {
    const s = roofSection({ type: 'hip', depth: 10, eaves_h: 300, pitch_lower: 45 });
    const g = new GeoBuilder();
    rectRoof(g, s, { length: 20, depth: 10, hipped: true, roofKey: 'roof.slate', gableKey: 'render.lime' });
    const meshes = g.toMeshes(createMaterials(), 'x', {});
    const grp = new THREE.Group();
    meshes.forEach((m) => grp.add(m));
    const bb = bounds(grp);
    expect(bb.max.y).toBeCloseTo(305, 5);
    expect(bb.min.y).toBeCloseTo(300, 5);
    expect(bb.max.x).toBeCloseTo(10, 5);
    expect(-bb.min.z).toBeCloseTo(5, 5); // t = -z
    // all roof normals point up-ish (no inverted faces)
    const n = meshes[0].geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.5);
  });

  it('a gable roof adds two gable walls facing ±s', () => {
    const s = roofSection({ type: 'gable', depth: 8, eaves_h: 0, pitch_lower: 45 });
    const g = new GeoBuilder();
    rectRoof(g, s, { length: 12, depth: 8, hipped: false, roofKey: 'roof.tile', gableKey: 'render.farm' });
    const wall = g.toMeshes(createMaterials(), 'x', {}).find((m) => m.name.endsWith('render.farm'))!;
    const nx = wall.geometry.attributes.normal;
    const signs = new Set<number>();
    for (let i = 0; i < nx.count; i++) signs.add(Math.sign(Math.round(nx.getX(i))));
    expect(signs).toEqual(new Set([1, -1]));
  });
});

describe('buildExterior on the catalogue', () => {
  it('builds every placed building at LOD0 and LOD1 without throwing, at the building heights', () => {
    for (const b of spec.buildings.filter(isPlaced)) {
      for (const lod of [0, 1] as const) {
        const g = buildExterior(b, ctx(lod));
        expect(g.name).toBe(`${b.id}/exterior`);
        const bb = bounds(g);
        // KB-I03: buildings outside the scene year (1785 fair rotunda, Hymen temple) build nothing (epoch.test.ts)
        if (!inEpoch(b.epoch, ctx(lod).options.year)) {
          expect(bb.isEmpty()).toBe(true);
          continue;
        }
        const L = base.layout(b);
        // a wall that is entirely another building's face (KB-B14 = KB-B10 basement front) builds nothing
        if (b.cls === 'WALL' && wallSpansS(L, ctx(lod))?.length === 0) {
          expect(bb.isEmpty()).toBe(true);
          continue;
        }
        expect(bb.isEmpty()).toBe(false);
        expect(bb.max.y).toBeGreaterThanOrEqual(L.stack.eaves_h - 0.01);
        expect(bb.max.y).toBeLessThan(L.roof.ridge_h + 12);
        expect(bb.min.y).toBeLessThanOrEqual(L.stack.base_h + 0.01);
      }
    }
  });

  it('CdL LOD1 has real holes: glass panes, frames, members and its raised centre roof', () => {
    const b = spec.buildings.find((x) => x.id === 'KB-B01')!;
    const g = buildExterior(b, ctx(1));
    const names = new Set<string>();
    g.traverse((o) => names.add(o.name.split('/').slice(1).join('/')));
    for (const n of ['exterior/glass.crown', 'exterior/wood.frame', 'exterior/stone.grey', 'exterior/render.lime', 'roof/roof.slate']) expect(names.has(n)).toBe(true);
    const L = base.layout(b);
    const bb = bounds(g);
    // lantern above the raised hip roof
    expect(bb.max.y).toBeGreaterThan(L.roof.ridge_h + 3);
  });

  it('the risalit outline is CCW and wraps the footprint', () => {
    const b = spec.buildings.find((x) => x.id === 'KB-B01')!;
    const L = base.layout(b);
    const ring = outlineWithRisalits(L);
    expect(signedArea(ring)).toBeGreaterThan(L.frame.length * L.frame.width);
    expect(ring.length).toBeGreaterThanOrEqual(12); // 4 corners + 2 risalits x 4 points
  });

  it('site features build (walls, trees, water) with a flat sampler', () => {
    const f = buildFeatures(spec, { ...ctx(1), terrain: () => 344 });
    let water = 0;
    let trees = 0;
    f.group.traverse((o) => {
      if (o.userData.part === 'water') water++;
      if ((o as THREE.InstancedMesh).isInstancedMesh) trees += (o as THREE.InstancedMesh).count;
    });
    expect(water).toBeGreaterThan(3);
    expect(trees).toBeGreaterThan(100);
  });
});

describe('Durchfahrt through the plinth (walk-through)', () => {
  // the plinth top ledge and the plinth course used to run across the arch at EG floor level (1.4 m above the
  // passage floor): a thin floating stone strip that also stopped the walker in the doorway
  it.each([1, 2] as const)('leaves the arch open at LOD %i (no surface between 0.3 and 2.5 m above the passage floor)', (lod) => {
    for (const id of ['KB-B02', 'KB-B03', 'KB-B04']) {
      const b = spec.buildings.find((x) => x.id === id)!;
      const L = base.layout(b);
      const g = buildExterior(b, ctx(lod));
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      g.updateMatrixWorld(true);
      // all triangles in object space (s, h, −t)
      const tris: THREE.Vector3[][] = [];
      g.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.getAttribute('position');
        const idx = mesh.geometry.index;
        const n = idx ? idx.count : pos.count;
        const at = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(mesh.matrixWorld);
        for (let k = 0; k + 2 < n; k += 3) tris.push([at(k), at(k + 1), at(k + 2)]);
      });
      const ds = L.openings.filter((o) => o.kind === 'durchfahrt');
      expect(ds.length).toBe(2);
      const hit = new THREE.Vector3();
      for (const o of ds) {
        const sd = L.frame.sides[o.side];
        const blocked: string[] = [];
        // vertical probes over the threshold zone (just inside to just outside the facade plane)
        for (let along = -(o.width / 2 - 0.2); along <= o.width / 2 - 0.2 + 1e-9; along += 0.25) {
          for (const out of [-0.3, -0.1, 0.02, 0.06, 0.12, 0.3]) {
            const sP = sd.p0[0] + sd.tangent[0] * (o.a + along) + sd.normal[0] * out;
            const tP = sd.p0[1] + sd.tangent[1] * (o.a + along) + sd.normal[1] * out;
            const ray = new THREE.Ray(new THREE.Vector3(sP, o.bottom_h + 2.5, -tP), new THREE.Vector3(0, -1, 0));
            for (const [a, b2, c] of tris) {
              if (ray.intersectTriangle(a, b2, c, false, hit) && hit.y > o.bottom_h + 0.3) blocked.push(`${along.toFixed(2)}/${out}: y ${hit.y.toFixed(2)}`);
            }
          }
        }
        expect(blocked.slice(0, 4), `${id} ${o.side}`).toEqual([]);
      }
    }
  });
});

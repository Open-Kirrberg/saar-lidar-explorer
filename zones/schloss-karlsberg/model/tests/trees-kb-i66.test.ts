import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GARDEN_DETAIL } from '../src/layout/grammar.ts';
import { CONIFER_FORM, SPECIES, crownGeometry, crownHeight, treeMeshes, unitDome } from '../src/site/trees.ts';

// Wave-6 review fixes (vegetation): KB-I66 conifer form and lumpy far domes; the Orangerie citrus standards.

/** Largest horizontal radius of the vertices within ±band of height y (geometry units). */
function sectionRadius(g: THREE.BufferGeometry, y: number, band = 0.08): number {
  const p = g.attributes.position;
  let r = 0;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < band) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
  return r;
}

function meshes(key: string, n: number): THREE.InstancedMesh[] {
  const trees = Array.from({ length: n }, (_, i) => ({ x: i * 5, y: 0, z: 0, scale: 2.8 / 2.2 }));
  const out: THREE.InstancedMesh[] = [];
  treeMeshes(SPECIES[key], trees, 7, 'test').traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

describe('KB-I66 conifer: a spruce / fir cone of drooping branch whorls', () => {
  it('narrows steadily from base to tip (a cone, not stacked balls), with a leader on top', () => {
    const sp = SPECIES.conifer;
    const g = crownGeometry(sp, 2);
    const H = crownHeight(sp);
    const at = (f: number) => sectionRadius(g, -H / 2 + f * H, H * 0.06);
    expect(at(0.15)).toBeGreaterThan(0.75 * sp.crown);
    expect(at(0.5)).toBeLessThan(at(0.15));
    expect(at(0.8)).toBeLessThan(0.55 * at(0.15));
    expect(at(0.97)).toBeLessThan(0.15 * sp.crown);
  });

  it('is made of CONIFER_FORM.whorls whorls of 5-7 flat sprays, an inner cone and a leader (~1.1 k triangles)', () => {
    const tris = crownGeometry(SPECIES.conifer, 2).attributes.position.count / 3;
    const W = CONIFER_FORM.whorls;
    // inner cone 7, sprays 20 each (6-7 per whorl, 5 in the top two), leader 10
    expect(tris).toBeGreaterThanOrEqual(7 + 20 * (6 * (W - 2) + 5 * 2) + 10);
    expect(tris).toBeLessThanOrEqual(7 + 20 * (7 * (W - 2) + 5 * 2) + 10);
    expect(CONIFER_FORM.tag).toMatch(/N/);
  });

  it('sprays are flat (thin vertically) and hang down a little at the base', () => {
    expect(CONIFER_FORM.thick).toBeLessThan(0.5);
    expect(CONIFER_FORM.droop).toBeGreaterThan(0.2);
    expect(CONIFER_FORM.droop).toBeLessThan(0.6);
  });
});

describe('KB-I66 lumpy domes (forest mid and far crowns)', () => {
  it('defaults are unchanged (20 triangles, as the wave-3 far dome)', () => {
    const a = unitDome(5, 97);
    expect(a.attributes.position.count / 3).toBe(20);
  });

  it('lumps break the regular polygon outline but keep the pole on top and the unit envelope', () => {
    const g = unitDome(7, 97, { rings: [0, 0.72, 1.5, Math.PI], lumps: 4, lump: 0.16, jitter: 0.06 });
    expect(g.attributes.position.count / 3).toBe(7 + 2 * 7 + 7);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(2, 5);
    // ring radii vary (not all vertices of a ring at the same distance from the axis)
    const p = g.attributes.position;
    const radii = new Set<string>();
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i)) < 0.2) radii.add(Math.hypot(p.getX(i), p.getZ(i)).toFixed(3));
    expect(radii.size).toBeGreaterThan(4);
    // the top is one point on the axis
    let top = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.999) expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThan(1e-6), top++;
    expect(top).toBeGreaterThan(0);
    // deterministic
    expect(unitDome(7, 97, { rings: [0, 0.72, 1.5, Math.PI], lumps: 4, lump: 0.16, jitter: 0.06 }).attributes.position.array).toEqual(p.array);
  });
});

describe('wave-6 review: citrus standards in Versailles tubs', () => {
  it('a clipped round head, dark glossy green, a slim 1.2 m stem at the tub scale, evidence tagged', () => {
    const sp = SPECIES.citrus;
    expect(sp.shape).toBe('clipped');
    expect(sp.leaf.toUpperCase()).toBe('#2E4A2B');
    expect(sp.gloss).toBe(true);
    expect(sp.tag).toMatch(/D tubs/);
    const T = GARDEN_DETAIL.tub;
    const s = (T.citrusStem + T.citrusCrown) / sp.height;
    expect(sp.height * s * sp.trunkFrac).toBeCloseTo(T.citrusStem, 1);
    // head 1.4-1.8 m across (GARDEN_DETAIL.tub, research/11 S8)
    expect(2 * sp.crown * s).toBeGreaterThanOrEqual(1.4);
    expect(2 * sp.crown * s).toBeLessThanOrEqual(1.8);
    // nearly round: height / width 0.9-1.2
    const g = crownGeometry(sp, 3);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const ratio = (b.max.y - b.min.y) / (b.max.x - b.min.x);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.25);
  });

  it('one size per row: crown scales vary by at most ±3 %', () => {
    const crowns = meshes('citrus', 24).filter((im) => /crowns/.test(im.name));
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const ys: number[] = [];
    for (const im of crowns)
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        m.decompose(pos, q, scl);
        ys.push(scl.y);
      }
    expect(ys.length).toBe(24);
    expect(Math.max(...ys) / Math.min(...ys)).toBeLessThan(1.065);
  });

  it('carries a few orange and green fruits on the head surface and glossy leaf material', () => {
    const ims = meshes('citrus', 10);
    const fruit = ims.find((im) => /fruit/.test(im.name))!;
    expect(fruit).toBeDefined();
    expect(fruit.count).toBe(10 * SPECIES.citrus.fruit!.perTree);
    expect(SPECIES.citrus.fruit!.perTree).toBeLessThanOrEqual(12);
    expect(fruit.castShadow).toBe(false);
    const leaves = ims.filter((im) => /crowns/.test(im.name));
    const mat = leaves[0].material as THREE.MeshStandardMaterial;
    expect(mat.name).toBe('vegetation.leaf');
    expect(mat.userData.gloss).toBe(true);
    // fruit hangs on the outer surface of a head (not inside it, not floating off it)
    const centres: THREE.Vector3[] = [];
    const m = new THREE.Matrix4();
    for (const leaf of leaves) for (let i = 0; i < leaf.count; i++) centres.push(new THREE.Vector3().setFromMatrixPosition((leaf.getMatrixAt(i, m), m)));
    expect(centres.length).toBe(10);
    const p = new THREE.Vector3();
    for (let i = 0; i < fruit.count; i++) {
      p.setFromMatrixPosition((fruit.getMatrixAt(i, m), m));
      const d = Math.min(...centres.map((c) => c.distanceTo(p)));
      expect(d).toBeLessThan(SPECIES.citrus.crown * (2.8 / 2.2) * 1.4);
      expect(d).toBeGreaterThan(SPECIES.citrus.crown * (2.8 / 2.2) * 0.5);
    }
  });

  it('other species keep their per-instance size jitter', () => {
    expect(SPECIES.tilia.jitter).toBeUndefined();
    expect(SPECIES.tilia.gloss).toBeUndefined();
  });
});

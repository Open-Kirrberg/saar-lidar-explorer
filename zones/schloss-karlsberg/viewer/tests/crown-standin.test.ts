/**
 * KB-I105: hull stand-ins of the garden crowns (crownStandIn.ts) and their distance selection (siteTreeLod.ts).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SPECIES, crownGeometry, treeMeshes } from '@model/site/trees.ts';
import { HULL_DEFAULT, crownHull, hullDirections, hullTriangles } from '../src/crownStandIn.ts';
import { LEAF_CARD_FAR, siteCardOptions } from '../src/leafCards.ts';
import { SITE_STANDIN_NEAR, STANDIN_HYST, STANDIN_RADII, SiteCrownLod, selectNear } from '../src/siteTreeLod.ts';
import { TIER_MARGIN_DEG, tierInView } from '../src/forest.ts';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe('crown hull', () => {
  it('a closed staggered sphere: every edge shared by two faces, normals outward', () => {
    const { dirs, index } = hullDirections(HULL_DEFAULT.meridians, HULL_DEFAULT.rings);
    expect(index.length / 3).toBe(hullTriangles(HULL_DEFAULT.meridians, HULL_DEFAULT.rings.length));
    const edges = new Map<string, number>();
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) edges.set(`${u},${v}`, (edges.get(`${u},${v}`) ?? 0) + 1);
      const n = new THREE.Vector3().crossVectors(dirs[b].clone().sub(dirs[a]), dirs[c].clone().sub(dirs[a]));
      const centre = dirs[a].clone().add(dirs[b]).add(dirs[c]);
      expect(n.dot(centre), `face ${t / 3}`).toBeGreaterThan(0);
    }
    // closed and consistently wound: each directed edge once, its reverse once
    for (const [k, c] of edges) {
      expect(c).toBe(1);
      const [u, v] = k.split(',');
      expect(edges.get(`${v},${u}`), k).toBe(1);
    }
  });

  for (const key of ['tilia_young', 'beech_old', 'shrub_flowering', 'malus', 'populus_italica', 'conifer', 'citrus', 'castanea']) {
    it(`${key}: ≤ 1/4 of the crown's triangles, inside its foliage bounds, same size within 15 %`, () => {
      const sp = SPECIES[key];
      const g = crownGeometry(sp, 1789, 0);
      const h = crownHull(g);
      expect(tris(h)).toBeLessThanOrEqual(Math.max(90, tris(g) / 4));
      // foliage bounds: the limbs (crown.w < 0) are not part of the hull
      const a = new THREE.Box3();
      const p = g.getAttribute('position');
      const cg = g.getAttribute('crown');
      for (let i = 0; i < p.count; i++) if (cg.getW(i) >= 0) a.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i));
      h.computeBoundingBox();
      const b = h.boundingBox!;
      const size = a.getSize(new THREE.Vector3());
      expect(a.clone().expandByScalar(1e-4).containsBox(b)).toBe(true);
      const hs = b.getSize(new THREE.Vector3());
      expect(hs.x / size.x).toBeGreaterThan(0.85);
      expect(hs.y / size.y).toBeGreaterThan(0.85);
      expect(hs.z / size.z).toBeGreaterThan(0.85);
      // the foliage attributes come along (crown envelope inside |xyz| ≤ 1.2, clump randoms, bloom tint)
      const cw = h.getAttribute('crown');
      for (let i = 0; i < cw.count; i++) {
        expect(Math.hypot(cw.getX(i), cw.getY(i), cw.getZ(i))).toBeLessThan(1.25);
        expect(cw.getW(i)).toBeGreaterThanOrEqual(0);
      }
      expect(!!h.getAttribute('color')).toBe(!!g.getAttribute('color'));
      // the hull is deterministic
      expect(Array.from(crownHull(g).attributes.position.array)).toEqual(Array.from(h.attributes.position.array));
    });
  }
});

describe('stand-in distance selection', () => {
  it('near within the distance, hysteresis keeps a near crown until near + hyst', () => {
    const c = new Float32Array([0, 0, 100, 0, 0, 165, 0, 0, 175, 0, 0, 400]);
    const was = new Uint8Array([0, 1, 1, 1]);
    const out = new Uint8Array(4);
    expect(selectNear(c, 4, { x: 0, y: 0, z: 0 }, 160, 12, was, out)).toBe(2);
    expect(Array.from(out)).toEqual([1, 1, 0, 0]);
    expect(selectNear(c, 4, { x: 0, y: 0, z: 0 }, 160, 12, new Uint8Array(4), out)).toBe(1);
    // per-instance distances (crown size): the 400 m crown is near with a 420 m threshold
    expect(selectNear(c, 4, { x: 0, y: 0, z: 0 }, [160, 160, 160, 420], 12, new Uint8Array(4), out)).toBe(2);
    expect(Array.from(out)).toEqual([1, 0, 0, 1]);
  });

  it('the swap lies beyond the leaf cards', () => {
    expect(SITE_STANDIN_NEAR).toBeGreaterThanOrEqual(LEAF_CARD_FAR + 10);
    expect(STANDIN_HYST).toBeGreaterThan(0);
  });

  it('every instance is drawn exactly once, near ones in full, with its own matrix and colour', () => {
    const sp = SPECIES.tilia_young;
    const trees = Array.from({ length: 40 }, (_, i) => ({ x: i * 10, y: 0, z: 0 }));
    const group = treeMeshes(sp, trees, 7);
    const root = new THREE.Group();
    root.add(group);
    const crowns = group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh && o.name.includes('crowns')) as THREE.InstancedMesh[];
    const before = crowns.map((im) => ({ m: Array.from(im.instanceMatrix.array.slice(0, im.count * 16)), n: im.count }));
    const lod = new SiteCrownLod();
    const hulls = crowns.map((im) => lod.register(im)!);
    expect(hulls.every((h) => h && h.userData.lod === 'far' && siteCardOptions(h) === null)).toBe(true);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 2, 0);
    lod.radii = 0; // the plain distance first (the crown-size term below)
    lod.update(cam);
    const s = lod.stats();
    expect(s.full + s.hull).toBe(40);
    // in full: the crowns whose centre lies within SITE_STANDIN_NEAR of the camera
    const wm = new THREE.Matrix4();
    const want = crowns.reduce((k, im) => {
      let c = 0;
      for (let i = 0; i < before[crowns.indexOf(im)].n; i++) {
        const v = new THREE.Vector3().setFromMatrixPosition(wm.fromArray(before[crowns.indexOf(im)].m, i * 16)).applyMatrix4(im.matrixWorld);
        if (v.distanceTo(cam.position) < SITE_STANDIN_NEAR) c++;
      }
      return k + c;
    }, 0);
    expect(want).toBeGreaterThan(10);
    expect(want).toBeLessThan(30);
    expect(s.full).toBe(want);
    crowns.forEach((im, k) => {
      const all = new Set<string>();
      const key = (a: ArrayLike<number>, i: number) => Array.from(a).slice(i * 16, i * 16 + 16).map((v) => v.toFixed(4)).join();
      for (let i = 0; i < im.count; i++) all.add(key(im.instanceMatrix.array, i));
      for (let i = 0; i < hulls[k].count; i++) all.add(key(hulls[k].instanceMatrix.array, i));
      const want = new Set<string>();
      for (let i = 0; i < before[k].n; i++) want.add(key(before[k].m, i));
      expect(all).toEqual(want);
    });
    // a big crown keeps its clumps further out: within `radii` crown radii
    lod.radii = STANDIN_RADII;
    lod.update(cam);
    expect(lod.stats().full).toBeGreaterThanOrEqual(want);
    lod.radii = 1e6;
    lod.update(cam);
    expect(lod.stats().hull).toBe(0);
    lod.radii = 0;
    // A/B: everything in full again
    lod.near = 1e9;
    lod.update(cam);
    expect(lod.stats().hull).toBe(0);
    lod.indoor = true;
    lod.update(cam);
    expect([...crowns, ...hulls].every((im) => !im.visible)).toBe(true);
  });

  it('already cheap crowns (yew cones) get no stand-in', () => {
    const group = treeMeshes(SPECIES.taxus_cone, [{ x: 0, y: 0, z: 0 }], 7);
    new THREE.Group().add(group);
    const crowns = group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh && o.name.includes('crowns')) as THREE.InstancedMesh[];
    expect(crowns.length).toBeGreaterThan(0);
    for (const im of crowns) expect(new SiteCrownLod().register(im)).toBeNull();
  });
});

describe('forest tiers in view only (KB-I105)', () => {
  it('a crown counts as in view inside the frustum widened by the margin, not behind or far beside', () => {
    const cam = new THREE.PerspectiveCamera(60, 390 / 844, 1, 5000);
    cam.position.set(0, 10, 0);
    cam.lookAt(0, 10, -100); // looking down −z
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const p = cam.position;
    const tan = Math.tan((TIER_MARGIN_DEG * Math.PI) / 180);
    const at = (x: number, z: number) => new THREE.Vector3(x, 10, z);
    expect(tierInView(fr, at(0, -100), 5, p, tan)).toBe(true);
    expect(tierInView(fr, at(0, 100), 5, p, tan)).toBe(false); // behind
    // horizontal half-fov of a portrait phone ≈ 14.8°: a crown at 20° is out of the frustum but inside the margin
    const deg = (a: number, d = 150) => at(Math.sin((a * Math.PI) / 180) * d, -Math.cos((a * Math.PI) / 180) * d);
    expect(tierInView(fr, deg(20), 0, p, 0)).toBe(false);
    expect(tierInView(fr, deg(20), 0, p, tan)).toBe(true);
    expect(tierInView(fr, deg(45), 5, p, tan)).toBe(false);
    // a big crown right beside the camera still counts (its radius reaches into the view)
    expect(tierInView(fr, at(10, -3), 8, p, tan)).toBe(true);
    // the turn trigger lies well inside the margin
    expect(TIER_MARGIN_DEG).toBeGreaterThanOrEqual(10);
  });
});

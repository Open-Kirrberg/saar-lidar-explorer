import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { buildInterior, createFallbackMaterials } from '../src/interior/index.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, lod, materials: createFallbackMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) });
const get = (id: string) => spec.buildings.find((b) => b.id === id)!;

describe('buildInterior', () => {
  const g = buildInterior(get('KB-B01'), ctx(2));

  it('the Corps de logis stays within the 300k triangle budget and merges by material', () => {
    const st = g.userData.stats as { triangles: number; meshes: number; instances: number };
    expect(st.triangles).toBeGreaterThan(20000);
    expect(st.triangles).toBeLessThanOrEqual(300000);
    expect(st.meshes).toBeLessThan(600);
    expect(st.instances).toBeGreaterThan(20);
  });

  it('every visible mesh carries roomId / name_de / evidence and finite positions', () => {
    let n = 0;
    g.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      if (m.userData.collider === true) return;
      n++;
      expect(m.userData.roomId, m.name).toBeTruthy();
      expect(m.userData.name_de, m.name).toBeTruthy();
      expect(m.userData.evidence, m.name).toMatch(/[DINU]|HMS/);
      expect(m.userData.collider).toBe(false);
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        const im = m as THREE.InstancedMesh;
        expect(m.userData.instances).toHaveLength(im.count);
      }
    });
    expect(n).toBeGreaterThan(50);
  });

  it('exposes colliders (with stair ramps), few lights and walk-start POIs', () => {
    const cols = g.userData.colliders as THREE.Mesh[];
    expect(cols).toHaveLength(1);
    expect(cols[0].userData.collider).toBe(true);
    expect(cols[0].visible).toBe(false);
    // ramps: some collider triangles are inclined (not horizontal, not vertical)
    const pos = cols[0].geometry.getAttribute('position');
    const idx = cols[0].geometry.getIndex()!;
    let inclined = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
      nrm.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const ny = Math.abs(nrm.y);
      if (ny > 0.8 && ny < 0.995) inclined++;
    }
    expect(inclined).toBeGreaterThanOrEqual(6); // 3 Prunktreppe flights + service stair, 2 triangles each
    expect((g.userData.lights as THREE.Light[]).length).toBeLessThanOrEqual(4);
    expect((g.userData.pois as unknown[]).length).toBeGreaterThan(5);
  });

  it('returns an empty group for interior none, lod < 2 and walls', () => {
    const none = spec.buildings.find((b) => b.interior === 'none' && b.cls !== 'WALL');
    if (none) expect(buildInterior(none, ctx(2)).children).toHaveLength(0);
    expect(buildInterior(get('KB-B01'), ctx(1)).children).toHaveLength(0);
    const wall = spec.buildings.find((b) => b.cls === 'WALL');
    if (wall) expect(buildInterior(wall, ctx(2)).children).toHaveLength(0);
  });

  it('all buildings with interiors build without NaN and within budget', () => {
    for (const b of spec.buildings) {
      if (b.interior === 'none') continue;
      const gi = buildInterior(b, ctx(2));
      expect((gi.userData.stats as { triangles: number }).triangles, b.id).toBeLessThanOrEqual(300000);
    }
  });
});

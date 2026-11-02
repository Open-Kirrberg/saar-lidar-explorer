/**
 * KB-I66 residual (wave 7): the mid forest crowns get a leaf-mass relief (foliage.ts FOL_MID) and a silhouette fringe
 * of leaf cards (leafCards.ts FOREST_FRINGE); the far crowns (> 460 m) stay smooth domes. Pins the patch on a real
 * material and the fringe card budget.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { foliageUniforms, useFoliage } from '../src/foliage.ts';
import { FOREST_FRINGE, fringeMaterial, leafCardGeometry } from '../src/leafCards.ts';

/** run onBeforeCompile on a bare shader and return the patched sources */
function patched(defines: Record<string, string>): { vertex: string; fragment: string } {
  const m = new THREE.MeshStandardMaterial();
  m.name = 'vegetation.leaf';
  m.defines = { ...defines };
  useFoliage(m);
  const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown>, defines: m.defines };
  (m.onBeforeCompile as (s: typeof sh, r: unknown) => void)(sh, null);
  return { vertex: sh.vertexShader, fragment: sh.fragmentShader };
}

describe('mid forest crowns (FOL_MID, FOREST_FRINGE)', () => {
  it('exposes the A/B uniforms with the shipped defaults', () => {
    expect(foliageUniforms.uFolMid.value).toBe(1);
    expect(foliageUniforms.uFolBump.value).toBeGreaterThan(0);
    expect(foliageUniforms.uFolBump.value).toBeLessThanOrEqual(0.6);
  });

  it('patches the mid-crown relief, the fringe and the vine fade into the leaf shader', () => {
    const s = patched({ FOL_MID: '' });
    expect(s.fragment).toContain('#ifdef FOL_MID');
    expect(s.fragment).toContain('uFolMidFreq');
    expect(s.vertex).toContain('#ifdef FOL_FRINGE');
    expect(s.vertex).toContain('#ifdef FOL_FADE');
  });

  it('fringe cards are small, few and gone at the far crowns', () => {
    expect(FOREST_FRINGE.far).toBeLessThanOrEqual(460);
    expect(FOREST_FRINGE.count).toBeLessThanOrEqual(48);
    const m = fringeMaterial();
    expect(m.alphaToCoverage).toBe(true);
    expect(Object.keys(m.defines ?? {})).toEqual(expect.arrayContaining(['FOL_CARD', 'FOL_FRINGE']));
    const dome = new THREE.IcosahedronGeometry(3, 1).toNonIndexed();
    const n = dome.attributes.position.count;
    const crown = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) crown.set([dome.attributes.position.getX(i) / 3, dome.attributes.position.getY(i) / 3, dome.attributes.position.getZ(i) / 3, 0.5], i * 4);
    dome.setAttribute('crown', new THREE.BufferAttribute(crown, 4));
    const g = leafCardGeometry(dome, { ...FOREST_FRINGE, seed: 1 });
    expect(g.attributes.position.count / 4).toBeLessThanOrEqual(FOREST_FRINGE.count);
  });
});

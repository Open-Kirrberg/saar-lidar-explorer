/**
 * Wave 6 (tree look near the camera): the procedural leaf atlas and the leaf-card geometry on the clump crowns.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SPECIES, crownGeometry, treeMeshes, unitCrown } from '@model/site/trees.ts';
import { ATLAS_TILES, LEAF_GREY, NEEDLE_TILE, broadleafSpray, leafAt, rasterLeafAtlas, tileCoverage } from '../src/leafAtlas.ts';
import { CLOSE_DIST } from '../src/forest.ts';
import { FOREST_CARDS, FOREST_CARD_FAR, LEAF_CARD_FAR, cardBudget, ellipsoidArea, leafCardGeometry, siteCardOptions } from '../src/leafCards.ts';

describe('procedural leaf atlas (no texture licence: our own output)', () => {
  const size = 256;
  const a = rasterLeafAtlas(size);
  it('is deterministic and every tile is a spray covering roughly a third to a half of it', () => {
    expect(rasterLeafAtlas(size)).toEqual(a);
    for (let t = 0; t < ATLAS_TILES * ATLAS_TILES; t++) {
      const c = tileCoverage(a, size, t);
      expect(c, `tile ${t}`).toBeGreaterThan(0.25);
      expect(c, `tile ${t}`).toBeLessThan(0.6);
    }
  });
  it('transparent texels carry the leaf grey (mipmaps do not darken the rims) and leaves stay grey (colour from the instance)', () => {
    let clear = 0;
    for (let i = 0; i < size * size; i++) {
      const [r, g, b, al] = [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]];
      if (al === 0) {
        clear++;
        expect(r).toBe(Math.round(LEAF_GREY * 255));
      }
      expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(g);
      expect(b).toBeGreaterThanOrEqual(g * 0.9);
    }
    expect(clear).toBeGreaterThan(size * size * 0.3);
  });
  it('an ovate blade is solid along its midrib and empty beyond its tip', () => {
    const l = { x: 0.5, y: 0.5, angle: 0.3, len: 0.2, wid: 0.05, shade: 1 };
    expect(leafAt(l, 0.5, 0.5)).toBeCloseTo(0, 6);
    expect(Number.isNaN(leafAt(l, 0.5 + Math.cos(0.3) * 0.12, 0.5 + Math.sin(0.3) * 0.12))).toBe(true);
    // broadleaf sprays stay inside their tile
    for (const s of broadleafSpray(1789)) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(1);
    }
  });
});

describe('leaf cards on the clump crowns', () => {
  const sp = SPECIES.tilia_young;
  const crown = crownGeometry(sp, 11);
  const g = leafCardGeometry(crown, { count: 120, size: 0.6, seed: 5, far: 140 });
  it('builds `count` quads of four vertices at one anchor, with the crown attribute of a leaf clump (never a limb)', () => {
    const pos = g.getAttribute('position');
    const cw = g.getAttribute('crown');
    const card = g.getAttribute('card');
    expect(pos.count).toBe(120 * 4);
    expect(g.index!.count).toBe(120 * 6);
    let outer = 0;
    for (let k = 0; k < 120; k++) {
      const i = k * 4;
      for (let j = 1; j < 4; j++) {
        expect(pos.getX(i + j)).toBe(pos.getX(i));
        expect(pos.getY(i + j)).toBe(pos.getY(i));
        expect(cw.getW(i + j)).toBe(cw.getW(i));
      }
      expect(cw.getW(i)).toBeGreaterThanOrEqual(0);
      outer += Math.hypot(cw.getX(i), cw.getY(i), cw.getZ(i));
      // corners ±far/100, size around 0.6 (±25 %, smaller toward the base)
      expect(Math.abs(card.getX(i))).toBeCloseTo(1.4, 6);
      expect(card.getZ(i)).toBeGreaterThan(0.6 * 0.75 * 0.85 - 1e-6);
      expect(card.getZ(i)).toBeLessThan(0.6 * 1.25 + 1e-6);
    }
    // anchors sit on the outer clump surface, not in the core
    expect(outer / 120).toBeGreaterThan(0.7);
  });
  it('uvs stay inside one atlas tile per card, and the geometry is deterministic', () => {
    const uv = g.getAttribute('uv');
    for (let k = 0; k < 120; k++) {
      const us = [0, 1, 2, 3].map((j) => uv.getX(k * 4 + j));
      const vs = [0, 1, 2, 3].map((j) => uv.getY(k * 4 + j));
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1 / ATLAS_TILES, 6);
      expect(Math.floor(Math.min(...us) * ATLAS_TILES + 1e-6)).toBe(Math.floor(Math.max(...us) * ATLAS_TILES - 1e-6));
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(1 / ATLAS_TILES, 6);
    }
    const g2 = leafCardGeometry(crown, { count: 120, size: 0.6, seed: 5, far: 140 });
    expect(Array.from(g2.getAttribute('position').array)).toEqual(Array.from(g.getAttribute('position').array));
  });
  it('bloom species carry the per-vertex flower tint over to their cards', () => {
    const sh = crownGeometry(SPECIES.shrub_flowering, 4, 1);
    const c = leafCardGeometry(sh, { count: 40, size: 0.5, seed: 1 });
    expect(c.getAttribute('color')).toBeDefined();
  });
  it('site card options: a fine skin on clipped yews and citrus, none on bark, needle sprays on conifers, budgets bounded', () => {
    const group = (key: string) => treeMeshes(SPECIES[key], [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], 3, 'test');
    const ims = (key: string) => {
      const out: THREE.InstancedMesh[] = [];
      group(key).traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
      });
      return out;
    };
    // clipped surfaces (KB-I66 / wave-6 review): many small cards close to the surface, needles on yew, glossy citrus
    for (const im of ims('taxus_cone').filter((m) => (m.material as THREE.Material).name === 'vegetation.leaf')) {
      const o = siteCardOptions(im)!;
      expect(o.size).toBeLessThanOrEqual(0.12);
      expect(o.push).toBe(0);
      expect(o.tiles).toEqual([NEEDLE_TILE]);
    }
    for (const im of ims('citrus').filter((m) => /crowns/.test(m.name))) {
      const o = siteCardOptions(im)!;
      expect(o.size).toBeLessThan(0.2);
      expect(o.gloss).toBe(true);
    }
    expect(ims('citrus').some((im) => /fruit/.test(im.name) && siteCardOptions(im) === null)).toBe(true);
    const tilia = ims('tilia_young');
    expect(tilia.some((im) => (im.material as THREE.Material).name === 'vegetation.bark' && siteCardOptions(im) === null)).toBe(true);
    const leafy = tilia.filter((im) => siteCardOptions(im));
    expect(leafy.length).toBeGreaterThan(0);
    for (const im of leafy) {
      const o = siteCardOptions(im)!;
      expect(o.count).toBeGreaterThanOrEqual(16);
      expect(o.count).toBeLessThanOrEqual(220);
      expect(o.tiles).toEqual([0, 1, 2]);
    }
    for (const im of ims('conifer').filter((m) => siteCardOptions(m))) expect(siteCardOptions(im)!.tiles).toEqual([NEEDLE_TILE]);
  });
  it('card budgets: size ≈ 0.3 R within limits, about 1.5 × the envelope covered; forest tiers fade further than garden trees', () => {
    const b = cardBudget(2.4, 1.9);
    expect(b.size).toBeCloseTo(0.72, 6);
    expect((b.count * b.size * b.size) / ellipsoidArea(2.4, 1.9)).toBeGreaterThan(1.2);
    expect(cardBudget(0.2, 0.2).count).toBe(16);
    expect(cardBudget(10, 10).count).toBe(220);
    expect(ellipsoidArea(1, 1)).toBeCloseTo(4 * Math.PI, 6);
    expect(FOREST_CARD_FAR).toBeGreaterThan(LEAF_CARD_FAR);
    // KB-I66: the forest cards reach the end of the close tier (no bare detail-0 clumps at 220-300 m)
    expect(FOREST_CARD_FAR).toBeGreaterThanOrEqual(CLOSE_DIST);
    // forest unit crowns: the hero cards are smaller and denser than the close tier's
    expect(FOREST_CARDS.hero.tree.count).toBeGreaterThan(FOREST_CARDS.close.tree.count);
    expect(FOREST_CARDS.hero.tree.size).toBeLessThan(FOREST_CARDS.close.tree.size);
    const u = leafCardGeometry(unitCrown(1789, { clumps: 16, clumpR: 0.31, shell: 0.7, core: true, limbs: 3 }), { ...FOREST_CARDS.hero.tree, seed: 2 });
    expect(u.getAttribute('position').count).toBe(FOREST_CARDS.hero.tree.count * 4);
  });
});

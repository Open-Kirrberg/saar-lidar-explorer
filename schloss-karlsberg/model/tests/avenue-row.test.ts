/**
 * Wave 10 (garden, audit #12): young avenue trees vary tree by tree (model/src/site/trees.ts rowVariation, grammar
 * AVENUE_ROW), without changing the other trees of their group.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AVENUE_ROW } from '../src/layout/grammar.ts';
import { SPECIES, rowVariation, treeMeshes } from '../src/site/trees.ts';

describe('avenue row variation', () => {
  it('is deterministic and within the grammar ranges; about one tree in replantEvery is a replacement', () => {
    const n = 3000;
    let replants = 0;
    for (let i = 0; i < n; i++) {
      const v = rowVariation(100 + i * 7, -40 - i * 1.3);
      expect(rowVariation(100 + i * 7, -40 - i * 1.3)).toEqual(v);
      const h = v.replant ? v.height / AVENUE_ROW.replantScale : v.height;
      expect(Math.abs(h - 1)).toBeLessThanOrEqual(AVENUE_ROW.height + 1e-9);
      expect(Math.abs(v.width - 1)).toBeLessThanOrEqual(AVENUE_ROW.width + 1e-9);
      expect(Math.abs(v.depth - 1)).toBeLessThanOrEqual(AVENUE_ROW.depth + 1e-9);
      expect(v.lean).toBeLessThanOrEqual(AVENUE_ROW.lean);
      expect([0, 1, 2]).toContain(v.variant);
      expect(Math.abs(v.aniso - 1)).toBeLessThanOrEqual(AVENUE_ROW.aniso + 1e-9);
      expect(Math.abs(v.tone)).toBeLessThanOrEqual(AVENUE_ROW.tone + 1e-9);
      expect(Math.abs(v.hue)).toBeLessThanOrEqual(AVENUE_ROW.hue + 1e-9);
      if (v.replant) replants++;
    }
    expect(replants / n).toBeGreaterThan(0.5 / AVENUE_ROW.replantEvery);
    expect(replants / n).toBeLessThan(2 / AVENUE_ROW.replantEvery);
  });

  it('gives neighbours 7 m apart different sizes', () => {
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const a = rowVariation(i * 7, 0);
      const b = rowVariation((i + 1) * 7, 0);
      if (Math.abs(a.height - b.height) < 0.01 && Math.abs(a.width - b.width) < 0.01) same++;
    }
    expect(same).toBe(0);
  });

  it('leaves the other trees of the group unchanged (the random stream is consumed all the same)', () => {
    const base = Array.from({ length: 12 }, (_, i) => ({ x: i * 7, y: 300, z: 5 }));
    const flagged = base.map((t, i) => (i % 3 === 0 ? { ...t, row: true } : t));
    const mats = (g: THREE.Group) => {
      const out: number[][] = [];
      const trunks = g.children.find((c) => c.name.endsWith('/trunks')) as THREE.InstancedMesh;
      const m = new THREE.Matrix4();
      for (let i = 0; i < trunks.count; i++) {
        trunks.getMatrixAt(i, m);
        out.push(m.elements.slice());
      }
      return out;
    };
    const a = mats(treeMeshes(SPECIES.tilia, base, 99, 't'));
    const b = mats(treeMeshes(SPECIES.tilia, flagged, 99, 't'));
    base.forEach((_, i) => {
      if (i % 3 === 0) expect(b[i]).not.toEqual(a[i]);
      else expect(b[i]).toEqual(a[i]);
    });
  });
});

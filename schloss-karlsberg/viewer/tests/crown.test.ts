import { describe, expect, it } from 'vitest';
import { SPECIES, crownGeometry, crownHeight, unitCrown } from '@model/site/trees.ts';

// KB-I44: clump crowns carry the `crown` attribute the foliage shading reads; species silhouettes stay recognisable

describe('crown geometry for the foliage shading (KB-I44)', () => {
  it('every species crown has a crown attribute: |xyz| ≈ 1 on the surface, w a clump random or −1 on limbs', () => {
    for (const sp of Object.values(SPECIES)) {
      const g = crownGeometry(sp, 11);
      const a = g.attributes.crown;
      expect(a, sp.key).toBeDefined();
      expect(a.itemSize).toBe(4);
      expect(a.count).toBe(g.attributes.position.count);
      let maxR = 0;
      let maxY = -Infinity;
      for (let i = 0; i < a.count; i++) {
        const w = a.getW(i);
        // w = 0.99 marks a clipped surface (yew cone, wave 6): foliage shading, no shell darkening under its card skin
        expect(w === -1 || (w >= 0 && w < 0.99) || (sp.key === 'taxus_cone' && Math.abs(w - 0.99) < 1e-6)).toBe(true);
        maxR = Math.max(maxR, Math.hypot(a.getX(i), a.getZ(i)));
        maxY = Math.max(maxY, a.getY(i));
      }
      expect(maxR).toBeLessThanOrEqual(1 + 1e-5);
      expect(maxY).toBeCloseTo(1, 4);
    }
  });

  it('normals are smooth per clump (no flat facets): shared positions of a clump share one normal', () => {
    const g = crownGeometry(SPECIES.tilia, 5);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const seen = new Map<string, [number, number, number]>();
    let shared = 0;
    let same = 0;
    // within the first clump (60 vertices of a detail-0 icosahedron)
    for (let i = 0; i < 60; i++) {
      const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
      const v: [number, number, number] = [n.getX(i), n.getY(i), n.getZ(i)];
      const s = seen.get(k);
      if (s) {
        shared++;
        if (Math.hypot(s[0] - v[0], s[1] - v[1], s[2] - v[2]) < 1e-5) same++;
      } else seen.set(k, v);
    }
    expect(shared).toBeGreaterThan(20);
    expect(same).toBe(shared);
  });

  it('the Lombardy poplar stays a narrow column and the yew a smooth cone; limbs only on broadleaf trees', () => {
    const pop = SPECIES.populus_italica;
    expect(crownHeight(pop) / (2 * pop.crown)).toBeGreaterThan(2.5);
    const limbs = (k: string) => {
      const a = crownGeometry(SPECIES[k], 3).attributes.crown;
      let n = 0;
      for (let i = 0; i < a.count; i++) if (a.getW(i) === -1) n++;
      return n;
    };
    expect(limbs('tilia')).toBeGreaterThan(0);
    expect(limbs('populus_italica')).toBe(0);
    expect(limbs('taxus_cone')).toBe(0);
    // wave 6: shrubs are branched from the ground; their limbs read as black stilts under a hovering mass (pose 33)
    expect(limbs('shrub_flowering')).toBe(0);
  });

  it('unitCrown spans height 2 with a mean silhouette radius of 1 and is deterministic', () => {
    const o = { clumps: 11, clumpR: 0.4, core: true, limbs: 3 };
    const g = unitCrown(9, o);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.y - b.min.y).toBeCloseTo(2, 5);
    expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z)).toBeLessThanOrEqual(1.25);
    expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z)).toBeGreaterThan(0.95);
    expect(unitCrown(9, o).attributes.position.array).toEqual(g.attributes.position.array);
    // ~11 clumps + core of 20 triangles + 3 limbs of 6: a near tree stays below 260 triangles
    expect(g.attributes.position.count / 3).toBeLessThan(260);
  });
});

// wave-3 review of KB-I44: forest crowns read as poplar columns, far blobs as flat-topped "buckets", clumps as
// polka dots, pink blossom triangles

import * as THREE from 'three';
import { BLOOM_TINT_MAX } from '@model/site/trees.ts';
import { EDGE_BAND, FOREST_ASPECT, edgeWeight, forestCrownForm } from '../src/crownForm.ts';
import { geometries, tierGeometries } from '../src/forest.ts';

/** Projected silhouette of a geometry seen horizontally from azimuth a: width (m) and height (m). */
function silhouette(g: THREE.BufferGeometry, a: number): { w: number; h: number } {
  const p = g.attributes.position;
  const cx = Math.cos(a);
  const cz = Math.sin(a);
  let u0 = Infinity;
  let u1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const u = -p.getX(i) * cz + p.getZ(i) * cx;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    y0 = Math.min(y0, p.getY(i));
    y1 = Math.max(y1, p.getY(i));
  }
  return { w: u1 - u0, h: y1 - y0 };
}
/** Largest radius of the cross-section at height y (edges crossing the plane). */
function sectionRadius(g: THREE.BufferGeometry, y: number): number {
  const p = g.attributes.position;
  let r = 0;
  for (let t = 0; t < p.count; t += 3)
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const j = t + ((k + 1) % 3);
      const ya = p.getY(i);
      const yb = p.getY(j);
      if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
      const f = (y - ya) / (yb - ya);
      r = Math.max(r, Math.hypot(p.getX(i) + f * (p.getX(j) - p.getX(i)), p.getZ(i) + f * (p.getZ(j) - p.getZ(i))));
    }
  return r;
}
const minAspect = (g: THREE.BufferGeometry) => Math.min(...Array.from({ length: 16 }, (_, k) => silhouette(g, (k / 16) * Math.PI)).map((s) => s.w / s.h));

describe('forest crown proportions (wave-3 review)', () => {
  it('beech / oak / hornbeam crowns are broad domes: aspect ≥ 0.8, depth 0.5-0.6 inside, ≤ 0.85 at the edge', () => {
    for (const sp of Object.keys(FOREST_ASPECT))
      for (const edge of [0, 5, 10, 15, 25, 60])
        for (const u of [0, 0.5, 0.999]) {
          const h = 22;
          const f = forestCrownForm(sp, h, edge, u, 1 - u);
          const aspect = (2 * f.radius) / f.crownH;
          expect(aspect, `${sp} edge ${edge}`).toBeGreaterThanOrEqual(0.8);
          expect(aspect).toBeLessThanOrEqual(1.4);
          expect(f.crownH / h).toBeGreaterThanOrEqual(0.5);
          expect(f.crownH / h).toBeLessThanOrEqual(edge > 26 ? 0.6 : 0.85);
        }
  });

  it('the edge form is an outward lean, not a vertical stretch; none inside the stand or without open land', () => {
    expect(edgeWeight(0)).toBe(1);
    expect(edgeWeight(EDGE_BAND + 1)).toBe(0);
    const edge = forestCrownForm('fagus', 24, 3, 0.5, 0.5);
    const inner = forestCrownForm('fagus', 24, 50, 0.5, 0.5);
    expect(edge.lean).toBeGreaterThan(0);
    expect(edge.shift).toBeGreaterThan(0);
    expect(inner.lean).toBe(0);
    expect(inner.shift).toBe(0);
    expect(forestCrownForm('fagus', 24, 3, 0.5, 0.5, false).lean).toBe(0);
    // an open-grown standard in the meadow: low crown all round, no lean, still a dome
    const solo = forestCrownForm('fagus', 24, 0, 0.5, 0.5, true, true);
    expect(solo.lean).toBe(0);
    expect(solo.crownH / 24).toBeGreaterThan(0.7);
    expect((2 * solo.radius) / solo.crownH).toBeGreaterThanOrEqual(0.8);
    // the lower crown base at the edge comes with a wider crown (aspect stays ≥ 0.8, checked above)
    expect(edge.crownH).toBeGreaterThan(inner.crownH * 1.2);
    expect(edge.radius).toBeGreaterThan(inner.radius * 1.15);
  });

  it('the unit crowns of every tier fill their envelope from every side (no column silhouettes)', () => {
    const geos = geometries('full');
    const tiers = tierGeometries();
    for (const g of [...geos.crowns, geos.far, ...tiers[0].crowns, ...tiers[1].crowns]) {
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y - g.boundingBox!.min.y).toBeCloseTo(2, 4);
      // unit envelope: width 2, height 2 → horizontal silhouettes ≥ 0.85 of the envelope's aspect
      expect(minAspect(g)).toBeGreaterThan(0.85);
    }
    // the mid crown (KB-I66: a lumpy dome, was a 4-clump dome) stays cheap
    for (const g of geos.crowns) expect(g.attributes.position.count / 3).toBeLessThanOrEqual(88);
    // hero clumps keep a sane budget
    for (const g of tiers[1].crowns) expect(g.attributes.position.count / 3).toBeLessThan(1500);
    for (const g of tiers[0].crowns) expect(g.attributes.position.count / 3).toBeLessThan(420);
  });

  it('the far tier is a rounded dome, not a flat-topped bucket (KB-I66: 7 lumpy meridians, 28 triangles)', () => {
    const far = geometries('full').far;
    expect(far.attributes.position.count / 3).toBeLessThanOrEqual(28);
    // widest section (the lumps of KB-I66 move it a little off the middle)
    const rMax = Math.max(...[-0.3, -0.15, 0, 0.15, 0.3].map((y) => sectionRadius(far, y)));
    // a dome narrows toward its top: at 85 % of the half-height the section is well under the full radius
    expect(sectionRadius(far, 0.85)).toBeLessThan(0.6 * rMax);
    expect(sectionRadius(far, 0.5)).toBeGreaterThan(0.6 * rMax);
    // the top is one point (a pole), not an edge
    const p = far.attributes.position;
    let top = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.999) expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThan(1e-6), top++;
    expect(top).toBeGreaterThan(0);
  });
});

describe('crown surface (wave-3 review: polka dots, blossom triangles, lumpy poplar)', () => {
  it('flower tint is per vertex, ≤ BLOOM_TINT_MAX toward the flower colour, and only on some clump tips', () => {
    const sp = SPECIES.shrub_flowering;
    const leaf = new THREE.Color(sp.leaf);
    for (let v = 0; v < 3; v++) {
      const g = crownGeometry(sp, 4, v);
      const col = g.getAttribute('color');
      const fl = new THREE.Color(sp.bloom!.colours[v]);
      const ratioR = fl.r / leaf.r;
      let tinted = 0;
      for (let i = 0; i < col.count; i++) {
        const a = (col.getX(i) - 1) / (ratioR - 1);
        expect(a).toBeGreaterThanOrEqual(-1e-6);
        expect(a).toBeLessThanOrEqual(BLOOM_TINT_MAX + 1e-6);
        if (a > 0.01) tinted++;
      }
      expect(tinted / col.count).toBeLessThan(0.4);
    }
  });

  it('clump sizes vary (0.6-1.3) and outline twigs break the silhouette of the close forest crowns', () => {
    // vertical extent of each clump (vertices grouped by their clump random w), sorted
    const clumpSizes = (g: THREE.BufferGeometry) => {
      const a = g.attributes.crown;
      const p = g.attributes.position;
      const ext = new Map<number, [number, number]>();
      for (let i = 0; i < a.count; i++) {
        const w = a.getW(i);
        if (w < 0) continue;
        const e = ext.get(w) ?? [Infinity, -Infinity];
        e[0] = Math.min(e[0], p.getY(i));
        e[1] = Math.max(e[1], p.getY(i));
        ext.set(w, e);
      }
      return [...ext.values()].map(([a0, a1]) => a1 - a0).sort((x, y) => x - y);
    };
    const site = clumpSizes(crownGeometry(SPECIES.tilia_young, 9));
    expect(site[site.length - 2] / site[1]).toBeGreaterThan(1.4);
    const close = clumpSizes(tierGeometries()[0].crowns[0]);
    // twigs are ≤ half a clump
    expect(close[close.length - 2] / close[0]).toBeGreaterThan(2);
  });

  it('the Lombardy poplar is one tapered column with fine surface clumps (outward normals, < 900 triangles)', () => {
    const g = crownGeometry(SPECIES.populus_italica, 5);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    let out = 0;
    for (let i = 0; i < p.count; i++) if (p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i) > 0) out++;
    expect(out / p.count).toBeGreaterThan(0.85);
    expect(p.count / 3).toBeLessThan(900);
    expect(minAspect(g)).toBeLessThan(0.45);
  });
});

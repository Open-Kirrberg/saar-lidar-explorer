/**
 * KB-I11..I13 garden tests (research/11 §6.5): species and crowns, clump and walk layout, the basin and its epoch,
 * the Herzogsgarten facts in the catalogue and the avenue blockers.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { gridFrame } from '../src/frame.ts';
import { createMaterials } from '../src/materials/index.ts';
import { inScene } from '../src/layout/epoch.ts';
import {
  allocateShares,
  avenueBlockers,
  basinOrnaments,
  chaikin,
  circleRing,
  clumpPlants,
  distanceToLine,
  polylineSelfIntersects,
  singleTrees,
  treeBlocked,
  walkRibbon,
} from '../src/layout/garden.ts';
import { hashString, type P2 } from '../src/layout/geom.ts';
import { GARDEN } from '../src/layout/grammar.ts';
import { avenueTrees } from '../src/layout/site.ts';
import { buildFeatures } from '../src/site/features.ts';
import { SPECIES, crownGeometry, crownHeight, speciesFor, treeMeshes } from '../src/site/trees.ts';
import type { EN, PlantMix, TerrainFeature } from '../src/spec.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const grid = gridFrame(spec.palace_grid);
const tf = (id: string) => spec.terrain_features.find((f) => f.id === id)!;
const ctx = (year = 1789): BuildContext => ({
  spec,
  materials: createMaterials(),
  terrain: () => 349,
  options: { ...DEFAULT_BUILD_OPTIONS, year },
  layout: makeLayoutFn(spec),
  lod: 1,
});

describe('KB-I11 species', () => {
  it('speciesFor: Herzogskastanien are Castanea, Rosskastanie Aesculus, bare Kastanie warns', () => {
    expect(speciesFor('Castanea sativa (D: Esskastanien)').key).toBe('castanea');
    expect(speciesFor('Edelkastanie').key).toBe('castanea');
    expect(speciesFor('Rosskastanie (Aesculus hippocastanum)').key).toBe('aesculus');
    expect(speciesFor('allée des marronniers sauvages').key).toBe('aesculus');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(speciesFor('Kastanie').key).toBe('aesculus');
    warn.mockRestore();
    expect(speciesFor('Populus nigra Italica').key).toBe('populus_italica');
    expect(speciesFor('Pyramidenpappel').key).toBe('populus_italica');
    expect(speciesFor('Malus domestica').key).toBe('malus');
    expect(speciesFor('Taxus baccata').key).toBe('taxus_cone');
    expect(speciesFor('Conifer (Pinus strobus, Picea, Larix)').key).toBe('conifer');
    expect(speciesFor('Flowering shrubs (Syringa, Philadelphus)').key).toBe('shrub_flowering');
    expect(speciesFor('beech_old (retained)').key).toBe('beech_old');
    expect(speciesFor('Carpinus betulus (Hainbuche)').key).toBe('tilia'); // not the old beech
    expect(speciesFor('Tilia (N)').key).toBe('tilia');
    expect(speciesFor(undefined).key).toBe('tilia');
  });

  it('the research/11 S4 palette exists with 1789 sizes', () => {
    for (const k of ['castanea', 'populus_italica', 'conifer', 'shrub_flowering', 'taxus_cone', 'beech_old']) expect(SPECIES[k]?.key).toBe(k);
    // young avenue and clump trees 5-8 m, retained trees 18-25 m (research/11 §3.2)
    for (const k of ['tilia', 'aesculus', 'castanea']) expect(SPECIES[k].height).toBeGreaterThanOrEqual(GARDEN.youngTree[0]);
    for (const k of ['tilia', 'aesculus', 'castanea']) expect(SPECIES[k].height).toBeLessThanOrEqual(GARDEN.youngTree[1]);
    expect(SPECIES.beech_old.height).toBeGreaterThanOrEqual(GARDEN.retainedTree[0]);
    expect(SPECIES.taxus_cone.height).toBeLessThanOrEqual(1.0);
  });

  it('crowns are built in true proportions per shape (column narrow and tall, cone pointed)', () => {
    for (const sp of Object.values(SPECIES)) {
      const g = crownGeometry(sp, 7);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.max.y - b.min.y).toBeCloseTo(crownHeight(sp), 3);
      expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z)).toBeLessThanOrEqual(sp.crown + 1e-6);
      expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z)).toBeGreaterThan(sp.crown * 0.8);
    }
    const pop = SPECIES.populus_italica;
    expect(crownHeight(pop) / (2 * pop.crown)).toBeGreaterThan(2.5);
    expect(crownGeometry(SPECIES.tilia, 3).attributes.position.array).toEqual(crownGeometry(SPECIES.tilia, 3).attributes.position.array);
  });

  it('young avenue trees get stakes; shrubs and yews have no trunk', () => {
    const t = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
    const g = treeMeshes(SPECIES.tilia, t, 1, 'x', { stakes: 1 });
    const stakes = g.children.find((o) => o.name.endsWith('/stakes')) as THREE.InstancedMesh;
    expect(stakes.count).toBe(2);
    expect(stakes.castShadow).toBe(false);
    expect(treeMeshes(SPECIES.shrub_flowering, t).children.some((o) => o.name.endsWith('/trunks'))).toBe(false);
    expect(treeMeshes(SPECIES.taxus_cone, t).children.some((o) => o.name.endsWith('/trunks'))).toBe(false);
  });

  it('the avenue TF-10 is built with stakes in the 3D site (young lime avenue, S9)', () => {
    const f = buildFeatures(spec, ctx());
    let stakes = 0;
    f.group.traverse((o) => {
      if (o.name.endsWith('tilia/stakes')) stakes += (o as THREE.InstancedMesh).count;
    });
    expect(stakes).toBeGreaterThan(20);
  });
});

describe('KB-I12 garden layout helpers', () => {
  const mix: PlantMix[] = [
    { species: 'shrub', share: 0.6, height: [2, 4] },
    { species: 'tilia', share: 0.3, height: [5, 8] },
    { species: 'conifer', share: 0.1, height: [8, 11] },
  ];

  it('allocateShares is exact to ±1 and gives every share a plant', () => {
    expect(allocateShares(mix, 10)).toEqual([6, 3, 1]);
    expect(allocateShares(mix, 3).every((n) => n >= 1)).toBe(true);
    expect(allocateShares(mix, 37).reduce((a, b) => a + b)).toBe(37);
  });

  it('clumpPlants: deterministic, inside the radius, shares within ±5 %, tall plants in the core', () => {
    const c: P2 = [1000, 2000];
    const R = 10;
    const a = clumpPlants(c, R, mix, { seed: 5 });
    expect(a).toEqual(clumpPlants(c, R, mix, { seed: 5 }));
    expect(a).not.toEqual(clumpPlants(c, R, mix, { seed: 6 }));
    expect(a.length).toBe(Math.round((Math.PI * R * R) / GARDEN.clump.areaPerPlant));
    for (const p of a) expect(Math.hypot(p.E - c[0], p.N - c[1])).toBeLessThanOrEqual(R);
    for (const [i, m] of mix.entries()) {
      const share = a.filter((p) => p.species === m.species).length / a.length;
      expect(Math.abs(share - m.share)).toBeLessThanOrEqual(0.05);
      void i;
    }
    for (const p of a.filter((x) => x.height > GARDEN.shrub[1])) expect(Math.hypot(p.E - c[0], p.N - c[1])).toBeLessThanOrEqual(GARDEN.clump.coreFrac * R + 1e-9);
  });

  it('singleTrees keeps the points and the shares', () => {
    const pts: P2[] = Array.from({ length: 40 }, (_, i) => [i * 10, 0]);
    const t = singleTrees(pts, mix, 3);
    expect(t.map((p) => [p.E, p.N])).toEqual(pts);
    expect(t.filter((p) => p.species === 'shrub').length).toBe(24);
  });

  it('chaikin keeps the ends of open lines and closes closed ones', () => {
    const open: P2[] = [[0, 0], [10, 0], [10, 10]];
    const s = chaikin(open, 3);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([10, 10]);
    const closed: P2[] = [[0, 0], [10, 0], [10, 10], [0, 0]];
    const z = chaikin(closed, 2);
    expect(z[0]).toEqual(z[z.length - 1]);
  });

  it('walkRibbon: edges at ±width/2, no self-intersection for the HG-02 belt walk and HG-03 serpentine', () => {
    for (const id of ['HG-02', 'HG-03']) {
      const f = tf(id);
      expect(f.kind).toBe('path');
      const line = f.geometry.coordinates as EN[];
      const rb = walkRibbon(line, f.width!);
      expect(polylineSelfIntersects(rb.centre)).toBe(false);
      expect(polylineSelfIntersects(rb.left)).toBe(false);
      expect(polylineSelfIntersects(rb.right)).toBe(false);
      for (let i = 0; i < rb.centre.length; i += 7) {
        expect(Math.hypot(rb.left[i][0] - rb.right[i][0], rb.left[i][1] - rb.right[i][1])).toBeCloseTo(f.width!, 6);
      }
    }
    expect(tf('HG-02').width).toBe(GARDEN.path.beltWalk);
    expect(polylineSelfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true);
  });

  it('basinOrnaments: two heads on the far rim, both facing the CdL', () => {
    const o = basinOrnaments([0, 0], 7, 2, [-60, 0]);
    expect(o).toHaveLength(2);
    for (const h of o) {
      expect(Math.hypot(...h.p)).toBeCloseTo(7, 6);
      expect(h.p[0]).toBeGreaterThan(0); // far side from the CdL
      expect(h.facing[0]).toBeLessThan(-0.9); // looking west
    }
    expect(o[0].p[1]).toBeCloseTo(-o[1].p[1], 6);
  });
});

describe('KB-I12 / KB-I13 catalogue facts', () => {
  it('TF-09 is now a 7 m gravel garden terrace at 345.9 (no parterre, no levelled lawn)', () => {
    const f = tf('TF-09');
    expect(f.kind).toBe('terrace');
    expect(f.level).toBe(345.9);
    expect(f.wall_height).toBeUndefined();
    const us = (f.geometry.coordinates as EN[][])[0].map(([E, N]) => grid.toUV(E, N)[0]);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(GARDEN.gardenTerrace.depth, 1);
    expect(spec.terrain_features.some((x) => x.kind === 'parterre' && x.id === 'TF-09')).toBe(false);
  });

  it('Herzogsgarten: lawn without level, 12-20 clumps of D 8-25 m, 30-60 single trees, all tagged', () => {
    const lawn = tf('HG-01');
    expect(lawn.kind).toBe('lawn');
    expect(lawn.level).toBeUndefined();
    const clumps = spec.terrain_features.filter((f) => f.kind === 'clump' && f.geometry.type === 'Point' && f.id.startsWith('HG-'));
    expect(clumps.length).toBeGreaterThanOrEqual(12);
    expect(clumps.length).toBeLessThanOrEqual(20);
    for (const c of clumps) {
      expect(2 * c.radius!).toBeGreaterThanOrEqual(GARDEN.clump.diameter[0]);
      expect(2 * c.radius!).toBeLessThanOrEqual(GARDEN.clump.diameter[1]);
      expect(c.mix!.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 6);
    }
    const singles = tf('HG-30');
    expect(singles.geometry.type).toBe('MultiPoint');
    const n = (singles.geometry.coordinates as EN[]).length;
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(60);
    for (const f of spec.terrain_features.filter((x) => x.id.startsWith('HG-'))) {
      expect(f.tag, f.id).toMatch(/\b(D|I|N|U)\b/);
      expect(f.confidence).toBe('low');
    }
  });

  it('the axis vista stays open: no clump crown or single tree within 15 m of the axis between the terrace and the basin', () => {
    for (const f of spec.terrain_features.filter((x) => x.kind === 'clump')) {
      const pts = f.geometry.type === 'Point' ? [f.geometry.coordinates] : (f.geometry.coordinates as EN[]);
      for (const [E, N] of pts) {
        const [u, v] = grid.toUV(E, N);
        if (u < 130) expect(Math.abs(v) - (f.radius ?? 0), f.id).toBeGreaterThan(15);
      }
    }
  });

  it('TF-11 is hypothetical and low; its trees are not drawn across the lawn', () => {
    const f = tf('TF-11');
    expect(f.placement).toBe('hypothetical');
    expect(f.confidence).toBe('low');
    const lawn = (tf('HG-01').geometry.coordinates as EN[][])[0];
    const blockers = avenueBlockers(spec, f);
    expect(blockers).toContainEqual(lawn);
    expect(avenueBlockers(spec, tf('TF-10'))).not.toContainEqual(lawn);
    const kept = avenueTrees(f.geometry.coordinates as EN[], f.trees!, { seed: hashString(f.id) ^ 1789 }).filter((p) => !treeBlocked(p.E, p.N, blockers));
    for (const p of kept) expect(treeBlocked(p.E, p.N, [lawn])).toBe(false);
  });

  it('the stag basin sits on the CdL axis 60-80 m E of the garden front, D ≈ 14 m, coping 0.4 x 0.25, jet 5 m, 1783-1790', () => {
    const b = tf('HG-04');
    expect(b.kind).toBe('pond');
    const r = (b.geometry.coordinates as EN[][])[0].slice(0, -1);
    const c: P2 = [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
    const [u, v] = grid.toUV(c[0], c[1]);
    expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
    expect(u - 46.2).toBeGreaterThanOrEqual(60);
    expect(u - 46.2).toBeLessThanOrEqual(80);
    const D = 2 * (r.reduce((a, p) => a + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / r.length);
    expect(D).toBeGreaterThan(13.5);
    expect(D).toBeLessThan(14.5);
    expect(b.coping).toMatchObject({ width: 0.4, height: 0.25 });
    expect(b.fountain_h).toBe(5);
    expect(b.ornaments).toMatchObject({ kind: 'stag_head', count: 2 });
    expect(b.epoch).toEqual({ from: 1783, to: 1790 });
    // its levelled rondell carries the water: water above the platform, coping on it
    expect(b.water_level!).toBeGreaterThan(tf('HG-05').level!);
    // the circle helper closes the ring
    const cr = circleRing([0, 0], 1, 8);
    expect(cr[0]).toEqual(cr[cr.length - 1]);
  });

  it('epoch: the basin stands in 1789 and is gone in 1791; the lawn is absent before 1788', () => {
    expect(inScene(spec.terrain_features, 1789).some((f) => f.id === 'HG-04')).toBe(true);
    expect(inScene(spec.terrain_features, 1791).some((f) => f.id === 'HG-04')).toBe(false);
    expect(inScene(spec.terrain_features, 1785).some((f) => f.id === 'HG-01')).toBe(false);
    const has = (year: number, re: RegExp) => {
      let n = 0;
      buildFeatures(spec, ctx(year)).group.traverse((o) => {
        if (re.test(o.name)) n++;
      });
      return n;
    };
    expect(has(1789, /^feature\/HG-04\/jet$/)).toBe(1);
    expect(has(1789, /^feature\/HG-04$/)).toBe(1); // water disc
    expect(has(1791, /HG-04/)).toBe(0);
  });

  it('the 3D site builds the walks, the clump plants and the hypothetical TF-11 trees in their own group', () => {
    const g = buildFeatures(spec, ctx()).group;
    const walks = g.children.filter((o) => /^feature\/HG-0[23]\/walk$/.test(o.name));
    expect(walks).toHaveLength(2);
    let shrubs = 0;
    let hypo = 0;
    g.traverse((o) => {
      if (/^site\/trees\/shrub_flowering\/crowns/.test(o.name)) shrubs += (o as THREE.InstancedMesh).count;
      if (o.name.startsWith('site/trees-hypothetical/')) hypo++;
    });
    expect(shrubs).toBeGreaterThan(300);
    expect(hypo).toBeGreaterThan(0);
    // hidden when hypotheses are switched off
    const off = buildFeatures(spec, { ...ctx(), options: { ...ctx().options, showHypothetical: false } }).group;
    let hypoOff = 0;
    off.traverse((o) => {
      if (o.name.startsWith('site/trees-hypothetical/')) hypoOff++;
    });
    expect(hypoOff).toBe(0);
  });

  it('walk and clump layout stays clear: no clump touches a walk', () => {
    const walks = ['HG-02', 'HG-03'].map((id) => (tf(id).geometry.coordinates as EN[]) as P2[]);
    for (const c of spec.terrain_features.filter((f): f is TerrainFeature & { radius: number } => f.kind === 'clump' && f.geometry.type === 'Point' && !!f.radius)) {
      const p = c.geometry.coordinates as P2;
      for (const w of walks) expect(distanceToLine(w, p), c.id).toBeGreaterThan(c.radius + GARDEN.path.beltWalk / 2);
    }
  });
});

describe('KB-I11 crown meshes are triangle soups', () => {
  it('every crown has a whole number of triangles and cones are closed (indexed cones expanded)', () => {
    for (const sp of Object.values(SPECIES)) {
      const g = crownGeometry(sp, 2);
      expect(g.index).toBeNull();
      expect(g.attributes.position.count % 3).toBe(0);
    }
    // a spruce / fir of drooping branch whorls (KB-I66; was 4 tiers of 3 lobes): an open inner cone (7), 9 whorls of
    // 5-7 icosahedral sprays and a 5-sided leader cone (10); exact counts in trees-kb-i66.test.ts
    const con = crownGeometry(SPECIES.conifer, 2).attributes.position.count / 3;
    expect((con - 7 - 10) % 20).toBe(0);
  });
});

/**
 * Wave-2 review fixes of the Herzogsgarten (garden owner): terrace kerb and perron, walk verges, clump masses and
 * accents, July bloom speckles, young lawn trees, the basin look and the jet's minimum screen width.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { gridFrame } from '../src/frame.ts';
import { createMaterials } from '../src/materials/index.ts';
import { allocateShares, clumpAccents, clumpPlantCount, clumpPlants, edgePieces } from '../src/layout/garden.ts';
import type { P2 } from '../src/layout/geom.ts';
import { GARDEN } from '../src/layout/grammar.ts';
import { buildFeatures, keepMinScreenWidth } from '../src/site/features.ts';
import { SPECIES, bloomColours, crownGeometry, speciesFor } from '../src/site/trees.ts';
import type { EN, PlantMix } from '../src/spec.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const grid = gridFrame(spec.palace_grid);
const tf = (id: string) => spec.terrain_features.find((f) => f.id === id)!;
const ctx = (terrain: (x: number, z: number) => number = () => 345.5): BuildContext => ({
  spec,
  materials: createMaterials(),
  terrain,
  options: { ...DEFAULT_BUILD_OPTIONS, year: 1789 },
  layout: makeLayoutFn(spec),
  lod: 1,
});
const meshes = (g: THREE.Object3D, re: RegExp) => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && re.test(o.name)) out.push(o as THREE.Mesh);
  });
  return out;
};
const bbox = (ms: THREE.Mesh[]) => {
  const b = new THREE.Box3();
  for (const m of ms) {
    m.geometry.computeBoundingBox();
    b.union(m.geometry.boundingBox!);
  }
  return b;
};

describe('edgePieces', () => {
  it('cuts every edge into pieces <= maxLen with outward normals, for either ring orientation', () => {
    const ccw: P2[] = [[0, 0], [10, 0], [10, 4], [0, 4], [0, 0]];
    for (const ring of [ccw, [...ccw].reverse()]) {
      const ps = edgePieces(ring, 1);
      expect(ps.length).toBe(10 + 4 + 10 + 4);
      for (const p of ps) {
        expect(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1])).toBeLessThanOrEqual(1 + 1e-9);
        const mid: P2 = [(p.a[0] + p.b[0]) / 2 + p.out[0], (p.a[1] + p.b[1]) / 2 + p.out[1]];
        // one metre outward is outside the rectangle
        expect(mid[0] < 0 || mid[0] > 10 || mid[1] < 0 || mid[1] > 4).toBe(true);
      }
      expect(ps.filter((p) => p.first)).toHaveLength(4);
      expect(ps.filter((p) => p.last)).toHaveLength(4);
    }
  });
});

describe('TF-09 gravel terrace: kerb and perron', () => {
  const only = { ...spec, terrain_features: [tf('TF-09')] };

  it('the catalogue gives TF-09 a 0.3 m kerb (coping)', () => {
    expect(tf('TF-09').coping).toMatchObject({ width: 0.3 });
  });

  it('builds a level gravel surface, a pale kerb round the free edges and a red Buntsandstein perron', () => {
    const g = buildFeatures(only, ctx()).group;
    const gravel = meshes(g, /^site\/features\/ground\.gravel$/);
    expect(gravel.length).toBe(1);
    const bg = bbox(gravel);
    // flat at level + 4 cm
    expect(bg.min.y).toBeCloseTo(345.94, 3);
    expect(bg.max.y).toBeCloseTo(345.94, 3);
    const kerb = meshes(g, /^site\/features\/stone\.grey$/);
    expect(kerb.length).toBe(1);
    const bk = bbox(kerb);
    expect(bk.max.y).toBeGreaterThanOrEqual(345.9 + GARDEN.terraceKerb.proud - 1e-4);
    expect(bk.min.y).toBeLessThanOrEqual(345.5 - GARDEN.terraceKerb.footDepth + 1e-4);
    // the kerb runs on the garden (E) side, beyond the 7 m polygon by up to edgeOut
    const uMax = Math.max(...[bk.min, bk.max].flatMap((p) => [grid.toUV(p.x + 381000, -p.z + 5465000)[0]]));
    expect(uMax).toBeGreaterThan(53.2);
    const perron = meshes(g, /^site\/features\/stone\.red$/);
    expect(perron.length).toBe(1);
    const bp = bbox(perron);
    // landing just above the EG garden door sill (346.2), steps down to the terrace
    expect(bp.max.y).toBeCloseTo(346.2 + GARDEN.perron.overThreshold, 2);
    // three axes wide (> 7 m), in front of the CdL garden front (u ≈ 46-50)
    const corners = [bp.min, bp.max].map((p) => grid.toUV(p.x + 381000, -p.z + 5465000));
    expect(Math.max(...corners.map((c) => c[0]))).toBeLessThan(50);
    const span = bp.max.clone().sub(bp.min);
    expect(Math.hypot(span.x, span.z)).toBeGreaterThan(7);
  });

  it('where the lawn outside is higher than the terrace, the kerb holds it (top above the outer ground)', () => {
    const level = 345.9;
    // ground rises 0.5 m right outside the polygon on the E side
    const terr = (x: number, z: number) => (grid.toUV(x + 381000, -z + 5465000)[0] > 53.2 ? level + 0.5 : level);
    const kerb = meshes(buildFeatures(only, ctx(terr)).group, /^site\/features\/stone\.grey$/);
    expect(bbox(kerb).max.y).toBeGreaterThanOrEqual(level + 0.5);
  });
});

describe('walk verges', () => {
  it('walk ribbons fade into the lawn: an aEdge attribute 0 at the verge, 1 on the gravel; transparent overlay', () => {
    const g = buildFeatures({ ...spec, terrain_features: [tf('HG-02')] }, ctx(() => 350)).group;
    const [w] = meshes(g, /^feature\/HG-02\/walk$/);
    const e = w.geometry.getAttribute('aEdge');
    expect(e.count).toBe(w.geometry.getAttribute('position').count);
    const vals = new Set(Array.from(e.array as Float32Array));
    expect([...vals].sort()).toEqual([0, 1]);
    const m = w.material as THREE.MeshStandardMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    // the gravel colour is the S15 Buntsandstein grit (the library's luma-normalised tint)
    expect(m.color.getHexString()).toBe(new THREE.Color('#B79A84').getHexString());
  });
});

describe('clumps: dense masses with one accent', () => {
  it('every catalogue clump has exactly clumpAccents(d) conifer / poplar accents and at most one retained beech', () => {
    // Herzogsgarten clumps (the KB-I71 folly backdrops are shrubberies without an accent)
    for (const f of spec.terrain_features.filter((x) => x.kind === 'clump' && x.geometry.type === 'Point' && x.id.startsWith('HG-'))) {
      const n = clumpPlantCount(f.radius!);
      const counts = allocateShares(f.mix!, n);
      const acc = f.mix!.findIndex((m) => /conifer|populus/i.test(m.species));
      expect(counts[acc], f.id).toBe(clumpAccents(2 * f.radius!));
      const old = f.mix!.findIndex((m) => /beech_old/.test(m.species));
      if (old >= 0) expect(counts[old], f.id).toBe(1);
      expect(clumpPlants(f.geometry.coordinates as P2, f.radius!, f.mix!, { seed: 1 }).length).toBe(n);
    }
    expect(clumpAccents(12)).toBe(1);
    expect(clumpAccents(20)).toBe(2);
  });

  it('clumpPlants staggers the shrub mantle: tall shrubs inside, low shrubs out to the rim', () => {
    const mix: PlantMix[] = [
      { species: 'shrub', share: 0.7, height: [2, 4] },
      { species: 'tilia', share: 0.3, height: [5, 8] },
    ];
    const R = 10;
    const p = clumpPlants([0, 0], R, mix, { seed: 3 });
    const shrubs = p.filter((x) => x.species === 'shrub');
    for (const s of shrubs) {
      const low = (GARDEN.shrub[1] - s.height) / (GARDEN.shrub[1] - GARDEN.shrub[0]);
      const rMax = R * (GARDEN.clump.shrubOuterFrac[0] + (GARDEN.clump.shrubOuterFrac[1] - GARDEN.clump.shrubOuterFrac[0]) * low);
      expect(Math.hypot(s.E, s.N)).toBeLessThanOrEqual(rMax + 1e-9);
    }
    const r = (xs: typeof shrubs) => xs.reduce((a, s) => a + Math.hypot(s.E, s.N), 0) / xs.length;
    const tall = shrubs.filter((s) => s.height > 3.3);
    const low = shrubs.filter((s) => s.height < 2.7);
    expect(r(low)).toBeGreaterThan(r(tall));
  });
});

describe('planting look', () => {
  it('flowering shrubs carry ~5 % flower speckles as vertex colours, not whole-crown colour', () => {
    const sp = SPECIES.shrub_flowering;
    expect(sp.flowers).toBeUndefined();
    expect(sp.bloom).toBeDefined();
    const faces = 4000;
    let flower = 0;
    for (let v = 0; v < 3; v++) {
      const c = bloomColours(sp, sp.bloom!, faces, v, 7);
      for (let f = 0; f < faces; f++) if (c[f * 9] !== 1) flower++;
      // flower face colour x leaf colour = the flower colour (linear)
      const i = c.findIndex((x) => x !== 1);
      const leaf = new THREE.Color(sp.leaf);
      expect(c[i] * leaf.r).toBeCloseTo(new THREE.Color(sp.bloom!.colours[v]).lerp(leaf, 1 - (sp.bloom!.strength ?? 1)).r, 5);
    }
    const share = flower / (3 * faces);
    expect(share).toBeGreaterThan(0.025);
    expect(share).toBeLessThan(0.06);
    const g = crownGeometry(sp, 1, 0);
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });

  it('young lawn and clump limes are nursery standards (wave 5) with a broad crown; retained beeches are open-grown; few on the lawn', () => {
    expect(speciesFor('Tilia (young feathered solitary)').key).toBe('tilia_young');
    expect(speciesFor('Tilia / Carpinus (young feathered trees)').key).toBe('tilia_young');
    expect(speciesFor('Tilia (N)').key).toBe('tilia'); // avenue standards keep their clear stem
    // wave 5 supersedes the wave-2 feathered form: clear stem 2-2.5 m (GARDEN_DETAIL.standard), crown 4-6 m
    expect(SPECIES.tilia_young.standard?.clearStem[0]).toBeGreaterThanOrEqual(2);
    expect(SPECIES.tilia_young.standard?.clearStem[1]).toBeLessThanOrEqual(2.5);
    expect(2 * SPECIES.tilia_young.crown).toBeGreaterThanOrEqual(4);
    expect(SPECIES.beech_old.trunkFrac).toBeLessThanOrEqual(0.22);
    const singles = tf('HG-30');
    const old = singles.mix!.filter((m) => /beech_old/.test(m.species)).reduce((a, m) => a + m.share, 0);
    expect(old).toBeLessThanOrEqual(0.1);
    // no clipped yew (taxus_cone) in the landscape lawn: it belongs to formal work only
    for (const f of spec.terrain_features.filter((x) => x.id.startsWith('HG-') && x.mix)) for (const m of f.mix!) expect(speciesFor(m.species).key, f.id).not.toBe('taxus_cone');
  });

  it('conifer crowns are irregular (different per seed, not a smooth stacked cone)', () => {
    const a = crownGeometry(SPECIES.conifer, 1).getAttribute('position').array;
    const b = crownGeometry(SPECIES.conifer, 2).getAttribute('position').array;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('basin look', () => {
  const g = buildFeatures({ ...spec, terrain_features: [tf('HG-04'), tf('HG-05')] }, ctx(() => 349.5)).group;

  it('pale coping, a gravel band round it and dark glassy water', () => {
    const [water] = meshes(g, /^feature\/HG-04$/);
    const wm = water.material as THREE.MeshPhysicalMaterial;
    expect(wm.color.getHexString()).toBe(new THREE.Color(GARDEN.basinLook.water).getHexString());
    expect(wm.roughness).toBeLessThan(0.05);
    const stone = meshes(g, /^site\/features\/stone\.grey$/);
    expect((stone[0].material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color(GARDEN.basinLook.coping).getHexString());
    const band = meshes(g, /^site\/features\/ground\.gravel$/);
    expect(band).toHaveLength(1);
    const b = bbox(band);
    // ring outer radius = R + coping + surround, centred on the basin
    expect((b.max.x - b.min.x) / 2).toBeCloseTo(7 + 0.4 + GARDEN.basinLook.surround, 1);
  });

  it('the jet column keeps a minimum screen width from afar and its natural size up close', () => {
    const col = meshes(g, /jet-column$/)[0];
    expect(col.onBeforeRender).toBeTypeOf('function');
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5));
    keepMinScreenWidth(m, 0.1, 2.5);
    const renderer = { getContext: () => ({ drawingBufferHeight: 1080 }) } as unknown as THREE.WebGLRenderer;
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
    const run = (d: number) => {
      cam.position.set(0, 0, d);
      m.onBeforeRender(renderer, new THREE.Scene(), cam, m.geometry, m.material as THREE.Material, null as unknown as THREE.Group);
      return m.scale.x;
    };
    const far = run(450);
    const px = (2 * 0.1 * far) / ((2 * 450 * Math.tan((25 * Math.PI) / 180)) / 1080);
    expect(px).toBeCloseTo(2.5, 3);
    expect(run(10)).toBe(1);
  });
});

void ({} as EN);

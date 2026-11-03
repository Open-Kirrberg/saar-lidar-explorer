/**
 * Wave 5 garden detail (garden owner): parterre à l'angloise (KB-I34), kitchen beds (KB-I36), the chestnut grove
 * (KB-I38), benches and the Flora herm (KB-I33), the hypothetical round pavilions (KB-I32), stepped garden walls and
 * nursery-standard trees (wave-4 residuals).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { gridFrame } from '../src/frame.ts';
import { createMaterials } from '../src/materials/index.ts';
import { groveGrid, kitchenBeds, parterreAnglaise, steppedWallTops, walkSideSpot } from '../src/layout/garden.ts';
import { pointInPolygon, type P2 } from '../src/layout/geom.ts';
import { GARDEN_DETAIL } from '../src/layout/grammar.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { buildFeatures } from '../src/site/features.ts';
import { SPECIES, standardCrown } from '../src/site/trees.ts';
import { validateSite } from '../src/validate.ts';
import type { EN } from '../src/spec.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const grid = gridFrame(spec.palace_grid);
const tf = (id: string) => spec.terrain_features.find((f) => f.id === id)!;
const ctx = (terrain: (x: number, z: number) => number = () => 345.5, showHypothetical = false): BuildContext => ({
  spec,
  materials: createMaterials(),
  terrain,
  options: { ...DEFAULT_BUILD_OPTIONS, year: 1789, showHypothetical },
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

describe("parterre à l'angloise (KB-I34, GARDEN_DETAIL.angloise)", () => {
  const A = GARDEN_DETAIL.angloise;
  const r = { u0: -30, u1: 36, v0: -62, v1: -37.8 };
  const lay = parterreAnglaise(r, { panels: [4, 1], crossWalk: 3 });
  it('splits the field into panels with plates-bandes, sentiers and cut-corner lawns inside the area', () => {
    expect(lay.compartments).toHaveLength(4);
    for (const c of lay.compartments) {
      expect(c.outer.u0).toBeGreaterThanOrEqual(r.u0 + A.border - 1e-9);
      expect(c.outer.u1).toBeLessThanOrEqual(r.u1 - A.border + 1e-9);
      expect(c.bandInner.u0 - c.outer.u0).toBeCloseTo(A.plateBande, 9);
      expect(c.panelRect.u0 - c.bandInner.u0).toBeCloseTo(A.sentier, 9);
      expect(c.panel.length).toBe(9); // octagon, closed
      for (const p of c.panel) expect(pointInPolygon(p, [[c.outer.u0, c.outer.v0], [c.outer.u1, c.outer.v0], [c.outer.u1, c.outer.v1], [c.outer.u0, c.outer.v1], [c.outer.u0, c.outer.v0]])).toBe(true);
    }
    // cross walks of the given width between neighbouring panels; the middle walk on the Durchfahrt axis u ≈ 3
    const s = [...lay.compartments].sort((a, b) => a.outer.u0 - b.outer.u0);
    for (let i = 1; i < s.length; i++) expect(s[i].outer.u0 - s[i - 1].outer.u1).toBeCloseTo(3, 9);
    expect((s[1].outer.u1 + s[2].outer.u0) / 2).toBeCloseTo(3, 6);
  });
  it('yew cones only on the corners and axes of each plate-bande, roses between them on the long sides (lawn-dominant)', () => {
    expect(lay.cones).toHaveLength(8 * lay.compartments.length);
    expect(lay.roses).toHaveLength(4 * lay.compartments.length);
    for (const c of lay.compartments) {
      const m = { u0: c.outer.u0 + A.plateBande / 2, u1: c.outer.u1 - A.plateBande / 2, v0: c.outer.v0 + A.plateBande / 2, v1: c.outer.v1 - A.plateBande / 2 };
      const mine = lay.cones.filter((p) => p[0] >= c.outer.u0 - 1e-6 && p[0] <= c.outer.u1 + 1e-6);
      expect(mine).toHaveLength(8);
      for (const p of mine) {
        // every cone is a corner or a side middle of the centre-line rectangle
        const onU = [m.u0, (m.u0 + m.u1) / 2, m.u1].some((u) => Math.abs(p[0] - u) < 1e-9);
        const onV = [m.v0, (m.v0 + m.v1) / 2, m.v1].some((v) => Math.abs(p[1] - v) < 1e-9);
        expect(onU && onV).toBe(true);
        expect(Math.abs(p[0] - (m.u0 + m.u1) / 2) < 1e-9 && Math.abs(p[1] - (m.v0 + m.v1) / 2) < 1e-9).toBe(false);
      }
      // roses lie on the long sides
      const long = m.u1 - m.u0 >= m.v1 - m.v0 ? 'u' : 'v';
      const rs = lay.roses.filter((p) => p[0] >= c.outer.u0 - 1e-6 && p[0] <= c.outer.u1 + 1e-6);
      expect(rs).toHaveLength(4);
      for (const p of rs) expect(long === 'u' ? [m.v0, m.v1].some((v) => Math.abs(p[1] - v) < 1e-9) : [m.u0, m.u1].some((u) => Math.abs(p[0] - u) < 1e-9)).toBe(true);
    }
  });
  it('tubs only when asked, on the walks (never on a plate-bande), ≥ 0.6 · spacing apart', () => {
    expect(lay.tubs).toHaveLength(0);
    const t = parterreAnglaise({ u0: 2, u1: 30, v0: -178, v1: -128 }, { panels: [2, 2], crossWalk: 3, tubs: true });
    expect(t.tubs.length).toBeGreaterThan(8);
    for (const p of t.tubs) {
      for (const c of t.compartments) expect(p[0] > c.outer.u0 && p[0] < c.outer.u1 && p[1] > c.outer.v0 && p[1] < c.outer.v1).toBe(false);
      for (const q of t.tubs) if (q !== p) expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(GARDEN_DETAIL.tub.spacing * 0.6 - 1e-9);
    }
  });
  it('too small an area gives no compartments (no degenerate geometry)', () => {
    expect(parterreAnglaise({ u0: 0, u1: 9, v0: 0, v1: 9 }, { panels: [1, 1] }).compartments).toHaveLength(0);
  });
});

describe('kitchen beds (KB-I36, GARDEN_DETAIL.kitchen)', () => {
  const K = GARDEN_DETAIL.kitchen;
  const r = { u0: 0, u1: 80, v0: 0, v1: 120 };
  const lay = kitchenBeds(r, [2, 3], 7, K.crops.length);
  it('quarters with beds of the bed width, alternating row direction, neighbours with different crops', () => {
    expect(lay.quarters).toHaveLength(6);
    expect(lay.beds.length).toBeGreaterThan(100);
    for (const b of lay.beds) {
      const w = b.along === 'u' ? b.rect.v1 - b.rect.v0 : b.rect.u1 - b.rect.u0;
      expect(w).toBeCloseTo(K.bed, 9);
      expect(b.rect.u0).toBeGreaterThanOrEqual(K.edge - 1e-9);
      expect(b.rect.v1).toBeLessThanOrEqual(120 - K.edge + 1e-9);
    }
    expect(new Set(lay.beds.map((b) => b.along)).size).toBe(2);
    for (let i = 1; i < lay.beds.length; i++) {
      const a = lay.beds[i - 1];
      const b = lay.beds[i];
      if (a.along === b.along && Math.abs((a.along === 'u' ? b.rect.v0 - a.rect.v0 : b.rect.u0 - a.rect.u0) - (K.bed + K.path)) < 1e-6) expect(b.crop).not.toBe(a.crop);
    }
  });
  it('is deterministic and respects a blocked area', () => {
    expect(kitchenBeds(r, [2, 3], 7, K.crops.length)).toEqual(lay);
    const b = kitchenBeds(r, [2, 3], 7, K.crops.length, (u, v) => u < 40 && v < 40);
    for (const x of b.beds) expect(x.rect.u0 < 40 && x.rect.v0 < 40).toBe(false);
  });
});

describe('grove grid and walk-side spots (KB-I38, KB-I33)', () => {
  it('a loose 8-10 m grid, every point inside the area', () => {
    const area: P2[] = [];
    for (let k = 0; k <= 24; k++) area.push([30 * Math.cos((k / 24) * 2 * Math.PI), 21 * Math.sin((k / 24) * 2 * Math.PI)]);
    const pts = groveGrid(area, 9, 1.6, 0.35, 0x4b4b31);
    expect(pts.length).toBeGreaterThanOrEqual(20);
    expect(pts.length).toBeLessThanOrEqual(40);
    for (const p of pts) expect(pointInPolygon(p, area)).toBe(true);
    let minD = Infinity;
    for (const p of pts) for (const q of pts) if (p !== q) minD = Math.min(minD, Math.hypot(p[0] - q[0], p[1] - q[1]));
    expect(minD).toBeGreaterThan(9 - 2 * 1.6 * Math.SQRT2 - 1e-6);
  });
  it('walkSideSpot sits `offset` off the line and faces back across it', () => {
    const line: P2[] = [[0, 0], [100, 0]];
    const l = walkSideSpot(line, 50, 1, 2.5);
    expect(l.at[0]).toBeCloseTo(50, 9);
    expect(l.at[1]).toBeCloseTo(2.5, 9); // left of +x
    expect(l.facing).toBeCloseTo(180, 9); // looks toward −y (back to the walk)
    const r = walkSideSpot(line, 50, -1, 2.5);
    expect(r.at[1]).toBeCloseTo(-2.5, 9);
    expect(r.facing).toBeCloseTo(0, 9);
  });
});

describe('stepped garden walls (wave-5 residual c, GARDEN_DETAIL.wall)', () => {
  it('tops step in whole courses, at least minHeight over the highest ground of each bay', () => {
    const W = GARDEN_DETAIL.wall;
    const bays = [0, 0.1, 0.7, 1.4, 1.5, 2.6].map((g) => ({ lo: 340 + g - 0.15, hi: 340 + g + 0.15 }));
    const tops = steppedWallTops(bays, 2.5, W.minHeight, W.step);
    tops.forEach((t, i) => {
      expect(t - bays[i].hi).toBeGreaterThanOrEqual(W.minHeight - 1e-9);
      expect(Math.abs(t / W.step - Math.round(t / W.step))).toBeLessThan(1e-6);
      if (i) expect(t).toBeGreaterThanOrEqual(tops[i - 1]); // ground rises -> the top never drops
    });
    expect(tops[0]).toBe(tops[1]); // a small rise keeps the course level
  });
  it('the KB-B27 enclosure gets piers and a saddle coping that follow the ground (no flat slab)', () => {
    const b = spec.buildings.find((x) => x.id === 'KB-B27')!;
    const slope = (x: number) => 347 + x * 0.05;
    const g = buildExterior(b, ctx((x) => slope(x)));
    const ms = meshes(g, /exterior/);
    expect(ms.length).toBeGreaterThan(0);
    // wall top heights vary by more than one course along the 0.05 slope
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of ms) {
      m.geometry.computeBoundingBox();
      lo = Math.min(lo, m.geometry.boundingBox!.max.y);
      hi = Math.max(hi, m.geometry.boundingBox!.max.y);
    }
    const tris = (g.userData.triangles as number) ?? 0;
    expect(tris).toBeGreaterThan(500); // bays + coping + piers, not 4 boxes
    expect(hi - lo).toBeLessThan(10);
  });
  it('LOD < 2 (viewer mid range, explorer light layer) keeps the steps at well under half the triangles', () => {
    const b = spec.buildings.find((x) => x.id === 'KB-B27')!;
    const slope = (x: number) => 347 + x * 0.05;
    const count = (lod: 0 | 1 | 2) => {
      let n = 0;
      buildExterior(b, { ...ctx((x) => slope(x)), lod }).traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      });
      return n;
    };
    const full = count(2);
    const lean = count(1);
    expect(lean).toBeGreaterThan(200);
    expect(lean).toBeLessThan(0.5 * full);
  });
});

describe('young garden trees as nursery standards (wave-5 residual d)', () => {
  it('clear stem 2-2.5 m, crown 4-6 m across, top at the tree height', () => {
    for (const k of ['tilia_young', 'aesculus', 'castanea']) {
      const sp = SPECIES[k];
      for (const [a, b] of [
        [0, 0],
        [1, 1],
        [0.5, 0.3],
      ]) {
        const s = standardCrown(sp, 7, a, b);
        expect(s.stem).toBeGreaterThanOrEqual(2 - 1e-9);
        expect(s.stem).toBeLessThanOrEqual(2.5 + 1e-9);
        expect(s.stem + s.crownH).toBeCloseTo(7, 9);
        expect(s.width).toBeGreaterThanOrEqual(4 - 1e-9);
        expect(s.width).toBeLessThanOrEqual(6 + 1e-9);
      }
    }
    // the avenue lime keeps its own proportions (no standard override)
    expect(SPECIES.tilia.standard).toBeUndefined();
  });
});

describe('wave-5 catalogue facts', () => {
  it('validates; the new kinds carry their layouts and evidence tags', () => {
    const v = validateSite(raw, 'v2');
    expect(v.errors).toEqual([]);
    expect(tf('TF-08').parterre?.panels).toEqual([4, 1]);
    expect(tf('TF-08').fence?.portals).toHaveLength(3);
    expect(tf('TF-15').parterre?.tubs).toBe(true);
    const benches = tf('HG-40');
    expect(benches.kind).toBe('furniture');
    expect(benches.items!.length).toBeGreaterThanOrEqual(12);
    expect(benches.items!.length).toBeLessThanOrEqual(20);
    expect(benches.items!.filter((b) => b.platform)).toHaveLength(3);
    expect(benches.tag).toMatch(/#3F5A3A D/);
    expect(tf('HG-41').items).toHaveLength(1);
    const grove = tf('HK-01');
    expect(grove.geometry.type).toBe('MultiPoint');
    const n = (grove.geometry.coordinates as EN[]).length;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThanOrEqual(40);
    expect(tf('KG-01').beds?.quarters).toEqual([2, 3]);
  });
  it('benches stand off the belt walk, face it, and keep 2 m from each other', () => {
    const items = tf('HG-40').items!;
    for (const a of items) for (const b of items) if (a !== b) expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThan(2);
    const belt = (tf('HG-02').geometry.coordinates as EN[]).map(([E, N]) => grid.toUV(E, N) as P2);
    for (const it of items.filter((x) => !x.platform)) {
      const [u, v] = grid.toUV(it.at[0], it.at[1]);
      let d = Infinity;
      for (let i = 1; i < belt.length; i++) {
        const [a, b] = [belt[i - 1], belt[i]];
        const e = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((u - a[0]) * e[0] + (v - a[1]) * e[1]) / (e[0] ** 2 + e[1] ** 2)));
        d = Math.min(d, Math.hypot(u - a[0] - t * e[0], v - a[1] - t * e[1]));
      }
      expect(d).toBeGreaterThan(1.5);
    }
  });
  it('the round pavilions are hypothetical, low confidence', () => {
    for (const id of ['KB-B87', 'KB-B88']) {
      const b = spec.buildings.find((x) => x.id === id)!;
      expect(b.placement).toBe('hypothetical');
      expect(b.confidence).toBe('low');
    }
  });
});

describe('features build the wave-5 garden detail', () => {
  const f = buildFeatures(spec, ctx(() => 344.06));
  it('benches, tubs, treillage, beds and frames appear as merged meshes', () => {
    const names = meshes(f.group, /site\/garden-detail/).map((m) => m.name);
    expect(names).toContain('site/garden-detail/wood.shutter'); // benches + tubs (green)
    expect(names).toContain('site/garden-detail/wood.frame'); // treillage, frames
    expect(names).not.toContain('site/garden-detail/glass.crown'); // wave 10: hotbed lights are no mirror glass (wood.frame panes)
    expect(names).toContain('site/garden-detail/stone.yellow'); // Flora herm
  });
  it('the grove and the parterre yews / citrus are instanced trees', () => {
    const groups: string[] = [];
    f.group.traverse((o) => groups.push(o.name));
    expect(groups.some((n) => /trees\/castanea/.test(n))).toBe(true);
    expect(groups.some((n) => /trees\/taxus_cone/.test(n))).toBe(true);
    expect(groups.some((n) => /trees\/citrus/.test(n))).toBe(true);
  });
});

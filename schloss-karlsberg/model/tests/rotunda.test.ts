// KB-I24: the gallery end - Tempelzimmer rotunda, colonnade, Bibliothekspavillon (research/10 §0.1-0.2, §b.1)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { gridFrame } from '../src/frame.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { stToEN } from '../src/layout/footprint.ts';
import { openRing } from '../src/layout/geom.ts';
import { ROTUNDA } from '../src/layout/grammar.ts';
import { orderFor, rotundaLayout, stepsBetween } from '../src/layout/rotunda.ts';
import { createMaterials } from '../src/materials/index.ts';
import { validateSite } from '../src/validate.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const B = (id: string) => spec.buildings.find((b) => b.id === id)!;
const grid = gridFrame(spec.palace_grid);
const uv = (p: [number, number]) => grid.toUV(p[0], p[1]);

describe('KB-I24 rotunda layout (pure)', () => {
  it('orderFor: Vignola Ionic, column 9 D, entablature 1/4 of the column', () => {
    const o = orderFor('ionic', 100, 6.6);
    expect(o.columnH).toBeCloseTo(5.28, 2);
    expect(o.D).toBeCloseTo(5.28 / 9, 3);
    expect(o.entablature[0]).toBeCloseTo(105.28, 2);
    expect(o.entablature[1]).toBeCloseTo(106.6, 6);
  });

  it('stepsBetween keeps every riser at or under the limit', () => {
    expect(stepsBetween(0)).toEqual({ count: 0, riser: 0 });
    const s = stepsBetween(0.9, 0.17);
    expect(s.count).toBe(6);
    expect(s.riser).toBeCloseTo(0.15, 6);
    expect(stepsBetween(0.48, 0.16).count).toBe(3);
  });

  it('KB-B07 is a round Ionic temple room with a pedimented tetrastyle portico and three steps facing the garden (E)', () => {
    const b = B('KB-B07');
    expect(b.name_de).toBe('Tempelzimmer / Rotunde am Gartenende der Galerie (Granitsaal)');
    expect(b.roof.type).toBe('dome');
    const L = layoutBuilding(b, spec);
    expect(L.frame.shape).toBe('round');
    const R = rotundaLayout(L)!;
    expect(R).not.toBeNull();
    expect(R.order.name).toBe('ionic');
    expect(R.bays).toHaveLength(8);
    expect(R.bays[0].kind).toBe('door');
    expect(R.bays.filter((x) => x.kind === 'link')).toHaveLength(1);
    // portico axis points along +u (towards the Herzogsgarten, E)
    const c = uv(stToEN(L.frame, [0, 0]));
    const tip = uv(stToEN(L.frame, R.axis));
    expect(tip[0] - c[0]).toBeGreaterThan(0.99);
    expect(Math.abs(tip[1] - c[1])).toBeLessThan(0.02);
    const P = R.portico!;
    expect(P.columns).toHaveLength(4);
    expect(P.steps.count).toBe(3);
    expect(P.steps.riser).toBe(ROTUNDA.step.riser);
    expect(P.pediment!.apex_h).toBeGreaterThan(P.entablature[1]);
    expect(P.front).toBeGreaterThan(R.radius);
    // columns stand on the floor and carry the entablature
    for (const col of P.columns) {
      expect(col.foot_h).toBeCloseTo(R.floor_h, 6);
      expect(col.top_h).toBeCloseTo(R.order.entablature[0], 6);
    }
    // the glazed openings fit between the pilasters
    for (const bay of R.bays) expect(bay.opening.half).toBeLessThan(bay.half - Math.asin(R.order.D / 2 / R.radius));
  });

  it('hall + colonnade + rotunda ≈ 95-97 m from the Sammlungsflügel ("cent pas", Schwan 2012 n. 47)', () => {
    const g6 = openRing(B('KB-B06').footprint!).map((p) => uv(p as [number, number]));
    const g4 = openRing(B('KB-B04').footprint!).map((p) => uv(p as [number, number]));
    const sammlungFace = Math.max(...g4.map((p) => p[0]));
    const L7 = layoutBuilding(B('KB-B07'), spec);
    const R = rotundaLayout(L7)!;
    const outer = uv(stToEN(L7.frame, [R.axis[0] * R.radius, R.axis[1] * R.radius]))[0];
    expect(outer - sammlungFace).toBeGreaterThan(95);
    expect(outer - sammlungFace).toBeLessThan(97.5);
    // the colonnade closes the gap between the gallery's E end and the drum
    const hallEnd = Math.max(...g6.map((p) => p[0]));
    const C = R.colonnade!;
    const colEnd = uv(stToEN(L7.frame, [-R.axis[0] * C.to, -R.axis[1] * C.to]))[0];
    expect(Math.abs(colEnd - hallEnd)).toBeLessThan(0.05);
    expect(C.to_id).toBe('KB-B06');
    // steps inside the colonnade climb from the gallery floor to the rotunda floor
    expect(C.floor_h).toBeCloseTo(layoutBuilding(B('KB-B06'), spec).stack.floors[0].floor_h, 2);
    expect(C.floor_h + C.steps!.count * C.steps!.riser).toBeCloseTo(R.floor_h, 6);
  });

  it('keeps the 81 m and LP06-square readings as documented alternatives', () => {
    expect(B('KB-B06').alternatives!.some((a) => /81 m/.test(a))).toBe(true);
    expect(B('KB-B07').alternatives!.some((a) => /LP06.*square/i.test(a))).toBe(true);
  });

  it('KB-B06a Bibliothekspavillon: hypothetical, low confidence, on the gallery N wall at the glass door', () => {
    const p = B('KB-B06a');
    expect(p.placement).toBe('hypothetical');
    expect(p.confidence).toBe('low');
    const Lg = layoutBuilding(B('KB-B06'), spec);
    const door = Lg.openings.find((o) => o.side === 'garden' && o.kind === 'porte_fenetre')!;
    expect(door).toBeDefined();
    const sd = Lg.frame.sides.garden;
    const doorUV = uv(stToEN(Lg.frame, [sd.p0[0] + sd.tangent[0] * door.a, sd.p0[1] + sd.tangent[1] * door.a]));
    const fp = openRing(p.footprint!).map((q) => uv(q as [number, number]));
    expect(doorUV[0]).toBeGreaterThan(Math.min(...fp.map((q) => q[0])));
    expect(doorUV[0]).toBeLessThan(Math.max(...fp.map((q) => q[0])));
    expect(Math.min(...fp.map((q) => q[1]))).toBeCloseTo(doorUV[1], 1);
  });

  it('validation rejects a rotunda without bays', () => {
    const bad = structuredClone(raw);
    const b = bad.buildings.find((x: { id: string }) => x.id === 'KB-B07');
    b.facade.rotunda.bays = ['door'];
    expect(validateSite(bad, 'v2').errors.some((e) => /rotunda\.bays/.test(e.path))).toBe(true);
  });
});

describe('KB-I24 rotunda exterior', () => {
  const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec), lod });
  it('builds the drum, portico and colonnade at LOD1/2 within a small triangle budget', () => {
    const b = B('KB-B07');
    const g1 = buildExterior(b, ctx(1));
    const g2 = buildExterior(b, ctx(2));
    const t1 = g1.userData.triangles as number;
    const t2 = g2.userData.triangles as number;
    expect(t1).toBeGreaterThan(1500);
    expect(t1).toBeLessThan(12000);
    expect(t2).toBeGreaterThan(t1);
    expect(t2).toBeLessThan(30000);
    g1.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g1);
    // the dome top (attic + low dome) and the portico steps reach beyond the drum
    expect(box.max.y).toBeGreaterThan(359);
    expect(box.max.y).toBeLessThan(361);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThan(10.5 + 3);
    // no NaN vertices
    g1.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    });
  });
});

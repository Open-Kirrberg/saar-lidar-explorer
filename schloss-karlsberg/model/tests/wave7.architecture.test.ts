// Wave 7 (architecture): KB-I31 S-wing Altan, KB-I39 Karlslust follies, KB-I30 zone items, KB-I36/UP-06 Treibhäuser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { altanPiers, concaveRoofProfile, polygonRing, skepCentres } from '../src/layout/folly.ts';
import { enToST, sidePoint, stToEN } from '../src/layout/footprint.ts';
import { FOLLY, GLASSHOUSE } from '../src/layout/grammar.ts';
import { createMaterials } from '../src/materials/index.ts';
import { FOLLY_KINDS, isPlaced } from '../src/spec.ts';
import { validateSite } from '../src/validate.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const byId = (id: string) => spec.buildings.find((b) => b.id === id);
const base = { spec, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS, showHypothetical: true }, layout: makeLayoutFn(spec) };
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ ...base, lod });

function triangles(g: THREE.Object3D): number {
  let n = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return n;
}

describe('layout/folly pure helpers', () => {
  it('altanPiers keeps the gate clear, is symmetric and keeps every clear span within maxSpan', () => {
    const P = FOLLY.altan.pier;
    for (const [w, gate] of [
      [12.6, 3.4],
      [20, 3.4],
      [8, 0],
      [16, 0],
    ]) {
      const p = altanPiers(w, gate);
      expect(p[0]).toBeCloseTo(-(w / 2 - P / 2), 6);
      expect(p[p.length - 1]).toBeCloseTo(w / 2 - P / 2, 6);
      for (let i = 0; i < p.length; i++) expect(p[i]).toBeCloseTo(-p[p.length - 1 - i], 6);
      for (let i = 0; i + 1 < p.length; i++) expect(p[i + 1] - p[i] - P).toBeLessThanOrEqual(Math.max(FOLLY.altan.maxSpan, gate) + 1e-9);
      if (gate > 0) for (const x of p) expect(Math.abs(x) - P / 2).toBeGreaterThanOrEqual(gate / 2 - 1e-9);
    }
    // 4 axes of the S wing over the 3.4 m Durchfahrt: four piers, the inner pair flanking the gate
    expect(altanPiers(12.6, 3.4).length).toBe(4);
  });

  it('concaveRoofProfile runs from the eave to the apex, sags below the chord and lifts the eave', () => {
    const r = 4.5;
    const rise = 2.8;
    const up = 0.55;
    const p = concaveRoofProfile(r, rise, up, 6);
    expect(p[0]).toEqual([r, up]);
    expect(p[p.length - 1][0]).toBeCloseTo(0, 9);
    expect(p[p.length - 1][1]).toBeCloseTo(rise, 9);
    for (let k = 1; k + 1 < p.length; k++) {
      const u = k / 6;
      expect(p[k][1]).toBeLessThan(up + (rise - up) * u); // below the straight eave-apex line
      expect(p[k][0]).toBeLessThan(p[k - 1][0]);
    }
  });

  it('polygonRing and skepCentres', () => {
    const o = polygonRing(8, 2, Math.PI / 8);
    expect(o).toHaveLength(8);
    for (const [s, t] of o) expect(Math.hypot(s, t)).toBeCloseTo(2, 9);
    const c = skepCentres(3.9);
    expect(c.length).toBeGreaterThan(3);
    expect(c[0]).toBeCloseTo(-c[c.length - 1], 9);
    expect(c[c.length - 1] + FOLLY.apiary.skep / 2).toBeLessThanOrEqual(3.9 / 2 + 1e-9);
  });
});

describe('catalogue: follies and zone items are hypotheses', () => {
  const follies = spec.buildings.filter((b) => b.facade.folly);
  it('every folly is hypothetical, low, roof none, with an evidence tag and a known kind', () => {
    expect(follies.map((b) => b.id).sort()).toEqual(['KB-B02a', 'KB-B89', 'KB-B90', 'KL-B50', 'KL-B51', 'KL-B52', 'KL-B53']);
    for (const b of follies) {
      expect(b.placement).toBe('hypothetical');
      expect(b.confidence).toBe('low');
      expect(b.roof.type).toBe('none');
      expect(FOLLY_KINDS).toContain(b.facade.folly!.kind);
      expect(b.facade.folly!.tag).toMatch(/\b(D|D->|N|I)\b/);
      expect(b.notes).toMatch(/± 50-100 m|I\]/);
    }
    const kw = byId('KB-B91')!;
    expect([kw.placement, kw.confidence]).toEqual(['hypothetical', 'low']);
  });

  it('KB-I39: Karlslust follies cover the documented list; no Eremitage stands in 1789', () => {
    const kinds = new Set(follies.map((b) => b.facade.folly!.kind));
    for (const k of ['chinese', 'tent', 'hay_wagon', 'aviary'] as const) expect(kinds.has(k)).toBe(true);
    // the Turkish pavilion is the Tschifflik KL-B46 (placed from LP06)
    expect(byId('KL-B46')?.name_de).toMatch(/Tschifflik/);
    // Eremitage: only the CdL round pavilion moved there in 1792; it must end before 1792
    expect(byId('KB-B87')!.epoch?.to).toBeLessThan(1792);
    const erem = spec.buildings.filter((b) => /Eremitage/i.test(b.name_de) && b.id !== 'KB-B87');
    for (const b of erem) expect(!isPlaced(b) || (b.epoch?.from ?? 0) >= 1792).toBe(true);
  });

  it('KB-I30: merged UPs are gone, new unplaced entries carry their V23 zone note', () => {
    for (const id of ['UP-05', 'UP-06', 'UP-08']) expect(byId(id)).toBeUndefined();
    for (const id of ['UP-19', 'UP-20', 'UP-21', 'UP-22', 'UP-23', 'UP-24', 'UP-25']) {
      const b = byId(id)!;
      expect(b.placement).toBe('unplaced');
      expect(b.footprint).toBeNull();
    }
    expect(byId('UP-20')!.notes).toMatch(/V23 no\. 11/);
    expect(byId('KB-B54')!.function).toMatch(/UP-06/);
    expect(byId('KB-B54')!.name_de).toMatch(/Ananas/);
  });

  it('the Altan stands against the S wing garden face at the Beletage floor', () => {
    const a = base.layout(byId('KB-B02a')!);
    const w = base.layout(byId('KB-B02')!);
    expect(a.stack.eaves_h).toBeCloseTo(w.stack.levels[2].floor_h!, 2);
    expect(Math.abs(a.frame.sides.court.normalAzimuth - 350.5)).toBeLessThan(1);
  });

  it('validation stays clean', () => {
    const r = validateSite(raw);
    expect(r.errors).toEqual([]);
  });
});

describe('exterior/folly builds lean geometry at every LOD', () => {
  it('each folly builds, stays modest at LOD1 and adds detail at LOD2', () => {
    for (const id of ['KB-B02a', 'KB-B89', 'KB-B90', 'KL-B50', 'KL-B51', 'KL-B52', 'KL-B53']) {
      const b = byId(id)!;
      const t1 = triangles(buildExterior(b, ctx(1)));
      const t2 = triangles(buildExterior(b, ctx(2)));
      expect(t1, id).toBeGreaterThan(50);
      expect(t1, id).toBeLessThan(2000);
      expect(t2, id).toBeGreaterThanOrEqual(t1);
    }
  });

  it('hidden with the hypothesis switch', () => {
    const g = buildExterior(byId('KL-B50')!, { ...ctx(1), options: { ...base.options, showHypothetical: false } });
    expect(triangles(g)).toBe(0);
  });
});

describe('wave-7 review fix (architecture)', () => {
  it('Altan KB-B02a: two piers clear of the gate, entered through portes-fenêtres, crossing no window', () => {
    const a = base.layout(byId('KB-B02a')!);
    const w = base.layout(byId('KB-B02')!);
    const len = a.frame.sides.garden.length;
    const piers = altanPiers(len, 3.4);
    expect(piers).toHaveLength(2);
    for (const x of piers) expect(Math.abs(x) - FOLLY.altan.pier / 2).toBeGreaterThanOrEqual(1.7);
    // every OG garden opening of the wing whose centre lies within the Altan front (+ cornice) is a porte-fenêtre at
    // deck level without an iron balconet; the neighbouring windows stay clear of the balustrade
    const og = w.openings.filter((o) => o.side === 'garden' && o.storey === 2);
    const behind = og.filter((o) => {
      const [s] = enToST(a.frame, stToEN(w.frame, sidePoint(w.frame, 'garden', o.a)));
      return Math.abs(s) - o.width / 2 - 0.2 < len / 2 + FOLLY.altan.corniceProjection;
    });
    expect(behind.length).toBe(2);
    for (const o of behind) {
      expect(o.kind).toBe('porte_fenetre');
      expect(o.balcony).toBeFalsy();
      expect(o.bottom_h).toBeCloseTo(a.stack.eaves_h, 2);
    }
    // other upper portes-fenêtres keep a balcony (CdL Festsaal: one continuous balcony since the wave-8 review fix)
    const cdl = base.layout(byId('KB-B01')!);
    expect(cdl.openings.some((o) => o.kind === 'porte_fenetre' && (o.balcony || o.balconyRun))).toBe(true);
  });

  it('folly grammar: finial stacks upwards, Monopteros dome rise 0.5, tent not red', () => {
    const fp = FOLLY.chinese.finialProfile;
    for (let i = 1; i < fp.length; i++) expect(fp[i][1]).toBeGreaterThan(fp[i - 1][1]);
    expect(fp[fp.length - 1][0]).toBe(0);
    expect(FOLLY.monopteros.domeRise).toBe(0.5);
    expect(FOLLY.monopteros.architrave + FOLLY.monopteros.frieze).toBeLessThan(FOLLY.monopteros.entablature);
    expect(FOLLY.tent.stripeA).not.toBe('#A8392C');
    expect(FOLLY.hayWagon.loadOver).toBeGreaterThanOrEqual(0.5);
  });

  it('forcing houses: small lapped panes at LOD2, more glass pieces than LOD0, chimneys and night-mats', () => {
    const gh = byId('KB-B54')!;
    const glass = (lod: 0 | 1 | 2) => {
      let n = 0;
      buildExterior(gh, ctx(lod)).traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (mats.some((x) => x.name.startsWith('glass.'))) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      });
      return n;
    };
    const g0 = glass(0);
    const g2 = glass(2);
    expect(g0).toBeGreaterThan(0);
    expect(g2).toBeGreaterThan(g0 * 50); // hundreds of panes instead of one sheet
    expect(GLASSHOUSE.pane[0] * GLASSHOUSE.pane[1]).toBeLessThan(0.2);
    expect(triangles(buildExterior(gh, ctx(2)))).toBeLessThan(12000);
  });
});

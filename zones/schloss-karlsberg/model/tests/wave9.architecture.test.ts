// Wave 9 (architecture): the rest of audit #3 (CdL court perron in the portal sandstone; the review fix narrows it back
// to the portal frame + 0.9 m with darker risers and the sentries on the piers),
// the apse side of the Pavillon zu Carlsberg, and the Tempelzimmer's inner pilaster bases and capitals. The Hemmer head
// and mast rules are tested in wave8.architecture.test.ts next to the earlier rod tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { freitreppePlan, perronSentryAlong } from '../src/layout/facade.ts';
import { ARTICULATION, COURT_FURNITURE, MAIN_PERRON, PORTAL_FRAME } from '../src/layout/grammar.ts';
import { courtPlan } from '../src/site/courtPlan.ts';
import { createMaterials } from '../src/materials/index.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);
const byId = (id: string) => spec.buildings.find((b) => b.id === id)!;
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, lod, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS, showHypothetical: true }, layout });

describe('wave-9 review fix: CdL court perron (portal frame + 0.9 m, HMS-close) with sentries on the piers', () => {
  const L = layout(byId('KB-B01'));
  const p = L.openings.find((o) => o.side === 'court' && o.kind === 'portal')!;
  const fp = freitreppePlan(p)!;
  const eg = L.openings.filter((o) => o.side === 'court' && o.storey === p.storey && o.kind === 'window').sort((a, b) => Math.abs(a.a - p.a) - Math.abs(b.a - p.a));
  it('the flight is the portal frame + 0.9 m wide (not the three central axes), 10 steps ≈ 3.5 m deep below the EG sills', () => {
    const s = ARTICULATION.surround.face;
    expect(fp.halfWidth).toBeCloseTo(p.width / 2 + s + PORTAL_FRAME.pilaster + 0.9, 6);
    // the cheeks stay short of the pier beyond the neighbouring EG window (the wave-9 three-axis flight reached it)
    const near = eg[0];
    expect(fp.halfWidth + fp.cheek).toBeLessThan(Math.abs(near.a - p.a) + near.width / 2 + s);
    expect(p.steps).toBe(10);
    expect(fp.depth).toBeCloseTo(3.48, 2);
    for (const w of eg.slice(0, 4)) expect(w.bottom_h).toBeGreaterThan(p.bottom_h + fp.cheekAbove);
  });
  it('carries no Le Clerc tag (LC shows the broad Freitreppe at the KB-B02 head pavilion), the HMS conflict is named', () => {
    for (const tag of [MAIN_PERRON.tag, p.tag]) {
      expect(tag).not.toMatch(/\bLC\b/);
      expect(tag).toMatch(/D->/);
      expect(tag).toMatch(/HMS/);
      expect(tag).toMatch(/low/);
    }
  });
  it('the sentry pair stands on the first piers beside the cheek pedestals, clear of every EG window and of the stair', () => {
    const plan = courtPlan(spec, layout, () => NaN, 1789)!;
    const q = plan.portals.find((x) => x.buildingId === 'KB-B01' && x.kind === 'portal')!;
    const mine = plan.sentries.filter((x) => x.buildingId === 'KB-B01');
    expect(mine).toHaveLength(2);
    const S = COURT_FURNITURE.sentry;
    const near = eg[0];
    const next = eg.find((o) => Math.abs(o.a - p.a) > Math.abs(near.a - p.a) + 0.5)!;
    const pier = (Math.abs(near.a - p.a) + near.width / 2 + Math.abs(next.a - p.a) - next.width / 2) / 2;
    for (const x of mine) {
      const v = [x.p[0] - q.p[0], x.p[1] - q.p[1]];
      const along = Math.abs(v[0] * q.tan[0] + v[1] * q.tan[1]);
      expect(along).toBeCloseTo(pier, 2);
      expect(along - S.width / 2).toBeGreaterThan(q.clear);
      for (const w of eg) expect(Math.abs(Math.abs(w.a - p.a) - along)).toBeGreaterThan(w.width / 2 + S.width / 2 - 1e-6);
    }
  });
  it('perronSentryAlong keeps the unsnapped place when no pier is near, and is null without a main perron', () => {
    const o = { kind: 'portal' as const, width: 2, steps: 10, portico: undefined, side: 'court' as const, storey: 1, a: 0 };
    expect(perronSentryAlong(o, [], 3, 1, 0.35)).toEqual([-3.85, 3.85]);
    const win = (a: number) => ({ side: 'court' as const, storey: 1, a, width: 1.3 });
    const r = perronSentryAlong(o, [win(-2.65), win(2.65), win(-5.3), win(5.3)], 3, 1, 0.35)!;
    expect(r[0]).toBeCloseTo(-3.975, 6);
    expect(r[1]).toBeCloseTo(3.975, 6);
    expect(perronSentryAlong({ ...o, kind: 'door' }, [], 3, 1, 0.35)).toBeNull();
  });
  it('treads in the grey-pink portal sandstone, risers the same stone darker, paler nosings across the flight', () => {
    expect(MAIN_PERRON.stoneTreads).toBe(true);
    const grey: THREE.Mesh[] = [];
    const g = buildExterior(byId('KB-B01'), ctx(1));
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.material === 'stone.grey') grey.push(m);
    });
    const lum = (m: THREE.Mesh) => {
      const c = (m.material as THREE.MeshStandardMaterial).color;
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    };
    const tread = grey.find((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString() === 'bfaea5')!;
    expect(tread).toBeTruthy();
    const others = grey.filter((m) => m !== tread);
    const riser = others.find((m) => lum(m) < lum(tread))!;
    const nosing = others.find((m) => lum(m) > lum(tread))!;
    expect(riser).toBeTruthy();
    expect(nosing).toBeTruthy();
    expect(lum(riser) / lum(tread)).toBeCloseTo(MAIN_PERRON.riser, 2);
    const size = new THREE.Box3().setFromObject(nosing).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThan(2 * fp.halfWidth - 0.05);
  });
});

describe('wave 9: Tempelzimmer inner pilasters carry bases and Ionic capitals (LOD2)', () => {
  it('the marble members gain the base, capital and volute geometry', () => {
    let marble = 0;
    buildExterior(byId('KB-B07'), ctx(2)).traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /marble/i.test(String(m.userData.material ?? o.name))) marble += m.geometry.attributes.position.count;
    });
    // 6 boxes (≈ 36 vertices each incl. caps) + 2 volute discs per pilaster: well above the plain-strip count
    expect(marble).toBeGreaterThan(8 * 150);
  });
});

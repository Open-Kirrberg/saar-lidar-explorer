// Wave 8 (architecture): KB-I70 Tempelzimmer doors and granite, KB-I52 review-1 leftovers, honest folly facades,
// KB-I32 Pavillon zu Carlsberg with its apse, audit rank 11 (Chinese double roof), rank 10 (Hemmer rods), rank 3
// (CdL portal frame).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, MATERIAL_NAMES, makeLayoutFn } from '../src/context.ts';
import { GeoBuilder } from '../src/exterior/builder.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { hemmerMast } from '../src/exterior/hardware.ts';
import { chimneyStations, hemmerMastHeight, hemmerMasts, rodMasts } from '../src/exterior/hardwarePlan.ts';
import { glazedDoor } from '../src/exterior/rotunda.ts';
import { interiorModel } from '../src/interior/model.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { stToEN } from '../src/layout/footprint.ts';
import { polygonRing, upsweptRoofPoint } from '../src/layout/folly.ts';
import { CHINESE_ROOF, COURT_FURNITURE, HEMMER_ROD, PASSAGE_PORTICO, PORTAL_FRAME } from '../src/layout/grammar.ts';
import { freitreppePlan } from '../src/layout/facade.ts';
import { courtPlan } from '../src/site/courtPlan.ts';
import { portalExtrasElev, stepsElev } from '../../plans/src/sheets/elevation.ts';
import { GRANITE, GRANITE_GLSL, graniteShares } from '../src/materials/granite.ts';
import { MATERIAL_BASE, createMaterials } from '../src/materials/index.ts';
import { ATTACHED, footprintOverlaps } from '../../scripts/catalogue-v2/checks.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);
const byId = (id: string) => spec.buildings.find((b) => b.id === id)!;
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, lod, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS, showHypothetical: true }, layout });

/** Meshes of a GeoBuilder whose material name starts with `prefix`. */
function meshesOf(g: GeoBuilder, prefix: string): THREE.Mesh[] {
  return g.toMeshes(createMaterials(), 'test', {}).filter((m) => (m.userData.material as string).startsWith(prefix));
}

describe('KB-I70 Tempelzimmer: glazed doors', () => {
  const a = 0.7;
  const w = 1.5;
  const depth = 6.2;
  const H0 = 100;
  for (const lod of [1, 2]) {
    it(`LOD${lod}: one outward-facing glass plane per leaf (single-sided), filling the opening width`, () => {
      const g = new GeoBuilder();
      glazedDoor(g, a, w, depth, H0, H0 + 3.2, lod);
      const glass = meshesOf(g, 'glass');
      expect(glass).toHaveLength(1);
      const pos = glass[0].geometry.attributes.position;
      const nor = glass[0].geometry.attributes.normal;
      // two leaves x one quad (2 triangles, 6 vertices): no back faces
      expect(pos.count).toBe(12);
      // the vertical axis is the one holding the heights (≈ 100 m)
      const v = [pos.getX(0), pos.getY(0), pos.getZ(0)].findIndex((x) => x > 50);
      for (let i = 0; i < pos.count; i++) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const n = [nor.getX(i), nor.getY(i), nor.getZ(i)];
        p[v] = 0;
        expect(Math.abs(n[v])).toBeLessThan(1e-6);
        const len = Math.hypot(p[0], p[1], p[2]);
        // normal = radial outward direction of the bay (away from the rotunda centre)
        expect((n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / len).toBeGreaterThan(0.95);
      }
      // the frame spans the full clear width: lateral extent of the frame = w (stiles meet the reveals)
      const frame = meshesOf(g, 'wood.frame');
      expect(frame.length).toBeGreaterThan(0);
      const fp = frame[0].geometry.attributes.position;
      const tanX = -Math.sin(a);
      const tanY = Math.cos(a);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < fp.count; i++) {
        const p = [fp.getX(i), fp.getY(i), fp.getZ(i)];
        p.splice(v, 1);
        // plan coordinates in mesh space: (s, t) or (x, -z); project on both sign conventions and keep the one that fits
        const u = Math.abs(p[0] * tanX + p[1] * tanY - 0) <= w / 2 + 1e-6 ? p[0] * tanX + p[1] * tanY : p[0] * tanX - p[1] * tanY;
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
      }
      expect(hi - lo).toBeCloseTo(w, 2);
    });
  }
});

describe('KB-I70 Tempelzimmer: faux-granite wall finish', () => {
  it('wall.granite is a registered material name with a tagged base', () => {
    expect(MATERIAL_NAMES).toContain('wall.granite');
    expect(MATERIAL_BASE['wall.granite']).toBeDefined();
    expect(GRANITE.tag).toMatch(/D T5/);
  });
  it('the CPU twin reproduces the documented fleck shares (used for the far fade)', () => {
    const s = graniteShares(160);
    for (let i = 0; i < 3; i++) expect(Math.abs(s[i] - GRANITE.shares[i])).toBeLessThan(0.03);
    // the GLSL hash has no sin() (float32 precision at ~350 m face UVs)
    expect(GRANITE_GLSL.replace(/\/\/.*$/gm, '')).not.toMatch(/\bsin\s*\(/);
  });
  it('the Tempelzimmer exterior keeps its draw: buildExterior(KB-B07) builds at every LOD', () => {
    for (const lod of [0, 1, 2] as const) expect(buildExterior(byId('KB-B07'), ctx(lod)).children.length).toBeGreaterThan(0);
  });
});

describe('KB-I52 review-1 leftovers', () => {
  it('every detailed building has no interior warnings (B04 and B05 doors served by their stairs)', () => {
    for (const b of spec.buildings.filter((x) => x.interior === 'detailed' && x.rooms?.length)) {
      expect(interiorModel(b, layoutBuilding(b, spec)).warnings, b.id).toEqual([]);
    }
  });
});

describe('wave 8: honest folly facades', () => {
  const follies = spec.buildings.filter((b) => b.facade.folly);
  it('covers the seven follies', () => {
    expect(follies.map((b) => b.id).sort()).toEqual(['KB-B02a', 'KB-B89', 'KB-B90', 'KL-B50', 'KL-B51', 'KL-B52', 'KL-B53'].sort());
  });
  for (const id of ['KB-B02a', 'KB-B89', 'KB-B90', 'KL-B50', 'KL-B51', 'KL-B52', 'KL-B53']) {
    it(`${id}: no palace shutters or rods, own material text and tags`, () => {
      const f = byId(id).facade;
      expect(f.shutter_type).toBe('none');
      expect(f.lightning_rods).toBe(false);
      expect(f.material).not.toBe(byId('KB-B01').facade.material);
      expect(f.tags).not.toBe(byId('KB-B01').facade.tags);
      expect(String(f.tags)).toMatch(/\b(D|N|I|U)\b/);
    });
  }
});

describe('KB-I32: Pavillon zu Carlsberg with its E apse', () => {
  it('KB-B28 is the square two-storey pavilion hypothesis, KB-B28a its round apse on the E wall', () => {
    const p = byId('KB-B28');
    const apse = byId('KB-B28a');
    expect(p.cls).toBe('PAV');
    expect(p.placement).toBe('hypothetical');
    expect(p.confidence).toBe('low');
    expect(p.storeys.filter((s) => s.kind === 'floor')).toHaveLength(2);
    expect((p.alternatives ?? []).some((a) => /Eiskeller/.test(a))).toBe(true);
    const L = layout(p);
    expect(L.frame.length).toBeCloseTo(10, 1);
    expect(L.frame.width).toBeCloseTo(10, 1);
    // the E side is blind behind the apse; the door is in the W side (wave 9: checked in EN, the s axis of this
    // footprint points W, so end_a is the E side)
    const midEN = (side: 'end_a' | 'end_b') => {
      const sd = L.frame.sides[side]!;
      return stToEN(L.frame, [sd.p0[0] + (sd.tangent[0] * sd.length) / 2, sd.p0[1] + (sd.tangent[1] * sd.length) / 2]);
    };
    const east = midEN('end_a')[0] > midEN('end_b')[0] ? 'end_a' : 'end_b';
    const west = east === 'end_a' ? 'end_b' : 'end_a';
    const apseEN = stToEN(layout(apse).frame, [0, 0]);
    expect(Math.hypot(midEN(east)[0] - apseEN[0], midEN(east)[1] - apseEN[1])).toBeLessThan(0.5);
    expect(L.openings.filter((o) => o.side === east)).toHaveLength(0);
    expect(L.openings.some((o) => o.side === west && o.kind === 'door')).toBe(true);
    const A = layout(apse);
    expect(A.frame.shape).toBe('round');
    expect(apse.placement).toBe('hypothetical');
    // the apse dome stays under the pavilion eaves (its inner half is hidden inside KB-B28)
    expect(apse.roof.eaves_h! + 0.5 * 5.6).toBeLessThan(p.roof.eaves_h!);
  });
  it('the intended apse overlap is whitelisted, so the catalogue keeps 0 footprint overlaps', () => {
    expect(ATTACHED.some(([a, b]) => a === 'KB-B28' && b === 'KB-B28a')).toBe(true);
    expect(footprintOverlaps(spec)).toEqual([]);
  });
});

describe('audit rank 11: Chinese pavilion double roof with up-swept corners', () => {
  const ring = polygonRing(8, 4, Math.PI / 8);
  const o = { top: 0.4, rise: 0.8, upturn: 0.5, cornerLift: CHINESE_ROOF.cornerLift, cornerOut: CHINESE_ROOF.cornerOut };
  it('the hip tip at the eave rises and reaches out beyond the side midpoint', () => {
    const tip = upsweptRoofPoint(ring[0], ring[1], 0, 0, o);
    const mid = upsweptRoofPoint(ring[0], ring[1], 0.5, 0, o);
    expect(tip[2]).toBeCloseTo(o.upturn + o.cornerLift, 9);
    expect(mid[2]).toBeCloseTo(o.upturn, 9);
    expect(Math.hypot(tip[0], tip[1])).toBeCloseTo(4 + o.cornerOut, 9);
  });
  it('the top ring is a plain scaled polygon at the full rise (the sweep fades out), and sectors meet at the hips', () => {
    for (const t of [0, 0.3, 1]) {
      const p = upsweptRoofPoint(ring[0], ring[1], t, 1, o);
      expect(p[2]).toBeCloseTo(o.rise, 9);
    }
    const end = upsweptRoofPoint(ring[0], ring[1], 1, 0.4, o);
    const start = upsweptRoofPoint(ring[1], ring[2], 0, 0.4, o);
    for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(start[i], 9);
    const apex = upsweptRoofPoint(ring[0], ring[1], 0.5, 1, { ...o, top: 0 });
    expect(Math.hypot(apex[0], apex[1])).toBeLessThan(1e-9);
  });
  it('KL-B50 roof reaches above the lower roof by the drum and the upper roof (two tiers)', () => {
    const L = layout(byId('KL-B50'));
    const g = buildExterior(byId('KL-B50'), ctx(1));
    g.updateMatrixWorld(true);
    let top = -Infinity;
    const v = new THREE.Vector3();
    g.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh || !String(mesh.userData.material).startsWith('wood.shutter')) return;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) top = Math.max(top, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).y);
    });
    // floor + eaves + lower rise + drum: the upper roof sits above that
    const lowerTop = L.stack.base_h + 0.45 + 3.4 + CHINESE_ROOF.lowerRise;
    expect(top).toBeGreaterThan(lowerTop + CHINESE_ROOF.drumHeight);
  });
});

describe('audit rank 10: Hemmer rods on the high points', () => {
  it('a short ridge gets one central mast', () => {
    expect(hemmerMasts(10, 3)).toEqual([3]);
  });
  it('a long ridge gets one mast near each end and no intermediates (wave-8 review fix); fewer than the old rule', () => {
    for (const len of [20, 40, 75, 140]) {
      const m = hemmerMasts(len, 5);
      expect(m).toHaveLength(2);
      expect(m[0]).toBeCloseTo(5 - len / 2 + HEMMER_ROD.endInset, 9);
      expect(m[1]).toBeCloseTo(5 + len / 2 - HEMMER_ROD.endInset, 9);
      if (len >= 75) expect(m.length).toBeLessThan(rodMasts(len, 5).length);
    }
  });
  it('a mast never stands on a chimney: it moves clear toward the ridge centre', () => {
    const len = 40;
    const end = len / 2 - HEMMER_ROD.endInset;
    const m = hemmerMasts(len, 0, HEMMER_ROD, [{ s: end - 0.2, half: 0.45 }, { s: 0.3, half: 0.45 }]);
    expect(m[1]).toBeLessThan(end);
    expect(Math.abs(m[1] - (end - 0.2))).toBeGreaterThanOrEqual(0.45 + HEMMER_ROD.chimneyClear - 1e-9);
    // a central mast on a short ridge moves off a central stack
    const c = hemmerMasts(10, 0, HEMMER_ROD, [{ s: 0, half: 0.45 }]);
    expect(Math.abs(c[0])).toBeGreaterThanOrEqual(0.45 + HEMMER_ROD.chimneyClear - 1e-9);
  });
  it('the mast scales with the building: palace roofs 3.0 m, small guard houses only a short point (wave 9)', () => {
    expect(hemmerMastHeight(5)).toBeCloseTo(2.0, 9);
    expect(hemmerMastHeight(1)).toBe(HEMMER_ROD.mastMin);
    expect(hemmerMastHeight(10)).toBe(HEMMER_ROD.mast);
    for (const id of ['KB-B37', 'KB-B38', 'KB-B63', 'KB-B64']) {
      const L = layout(byId(id));
      const area = L.frame.length * L.frame.width;
      expect(area).toBeLessThan(HEMMER_ROD.pointArea);
      expect(hemmerMastHeight(L.roof.ridge_h - L.stack.eaves_h, HEMMER_ROD, area)).toBe(HEMMER_ROD.pointMast);
    }
    const B02 = layout(byId('KB-B02'));
    expect(hemmerMastHeight(B02.roof.ridge_h - B02.stack.eaves_h, HEMMER_ROD, B02.frame.length * B02.frame.width)).toBe(HEMMER_ROD.mast);
  });
  it('the head is the Fünfspitz of the NDB: a gilt knob with a dominant vertical spike and four short level points (no aerial cross)', () => {
    // the level points reach little beyond the knob; the vertical spike is the longest part
    expect(HEMMER_ROD.point).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(HEMMER_ROD.spike).toBeGreaterThan(2 * HEMMER_ROD.point);
    const g = new GeoBuilder();
    hemmerMast(g, 0, 0, 100, [[1, 0], [0, 1]], 2, 3);
    let lo = Infinity;
    let hi = -Infinity;
    let span = 0;
    for (const m of meshesOf(g, 'metal.gilt')) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const v = p.findIndex((x) => x > 50);
        lo = Math.min(lo, p[v]);
        hi = Math.max(hi, p[v]);
        p[v] = 0;
        span = Math.max(span, Math.hypot(p[0], p[1], p[2]));
      }
    }
    // the gilt head sits on the mast top and is taller than wide (a point, not a crossbar)
    expect(lo).toBeGreaterThan(103 - 0.1);
    expect(hi - lo).toBeGreaterThan(2 * span);
  });
  it('no masts on the chimneys of the palace group, none on huts under the area limit', () => {
    const rodTops = (id: string) => {
      const pts: THREE.Vector3[] = [];
      const grp = buildExterior(byId(id), ctx(1));
      grp.updateMatrixWorld(true);
      grp.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !o.name.includes('metal.gilt')) return;
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
      });
      return pts;
    };
    expect(rodTops('KB-B91').length).toBe(0);
    for (const id of ['KB-B02', 'KB-B03', 'KB-B37']) {
      const L = layout(byId(id));
      const stacks = chimneyStations(L).filter((c) => Math.abs(c.t) < 0.6);
      const masts = hemmerMasts(L.roofPlan.ridgeLength, 0, HEMMER_ROD, stacks.map((c) => ({ s: c.s, half: c.section[0] / 2 })));
      for (const s of masts) for (const c of stacks) expect(Math.abs(s - c.s)).toBeGreaterThanOrEqual(c.section[0] / 2 + HEMMER_ROD.chimneyClear - 1e-9);
    }
  });
  it('the gilt five-point head is drawn from LOD1 (masts at LOD1, the down-conductor only at LOD2)', () => {
    const gilt = (lod: 1 | 2) => {
      let n = 0;
      buildExterior(byId('KB-B03'), ctx(lod)).traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name.includes('metal.gilt')) n += (o as THREE.Mesh).geometry.attributes.position.count;
      });
      return n;
    };
    expect(gilt(1)).toBeGreaterThan(0);
  });
});

describe('audit rank 3: CdL court portal frame', () => {
  it('the pilaster frame and entablature fit between the portal and its neighbouring windows and under the Beletage sill', () => {
    const L = layout(byId('KB-B01'));
    const p = L.openings.find((o) => o.side === 'court' && o.kind === 'portal')!;
    expect(p.portico).toBeFalsy();
    const half = p.width / 2 + 0.2 + PORTAL_FRAME.pilaster;
    const near = L.openings.filter((o) => o.side === 'court' && o.storey === 1 && o.kind === 'window' && Math.abs(o.a - p.a) < 4);
    for (const w of near) expect(Math.abs(w.a - p.a) - w.width / 2 - 0.2).toBeGreaterThan(half);
    const top = p.top_h + 0.2 + PORTAL_FRAME.above + PORTAL_FRAME.frieze + PORTAL_FRAME.cornice;
    const above = L.openings.find((o) => o.side === 'court' && o.storey === 2 && Math.abs(o.a - p.a) < 0.1)!;
    expect(top).toBeLessThan(above.bottom_h - 0.13);
  });
});

describe('wave-8 review fix KB-I72: perron, porch and balconies', () => {
  it('the CdL court perron is broad (portal frame + margin), ≈ 3.5 m deep, with cheeks and pedestals below the EG sills', () => {
    const L = layout(byId('KB-B01'));
    const p = L.openings.find((o) => o.side === 'court' && o.kind === 'portal')!;
    const fp = freitreppePlan(p)!;
    expect(fp.main).toBe(true);
    expect(p.steps).toBe(10);
    expect(fp.depth).toBeGreaterThan(3.3);
    expect(fp.depth).toBeLessThan(3.7);
    expect(fp.halfWidth).toBeGreaterThan(p.width / 2 + 0.2 + PORTAL_FRAME.pilaster);
    const near = L.openings.filter((o) => o.side === 'court' && o.storey === 1 && o.kind === 'window' && Math.abs(o.a - p.a) < fp.halfWidth + fp.cheek + 1);
    for (const w of near) expect(w.bottom_h).toBeGreaterThan(p.bottom_h + fp.cheekAbove);
    // the perron covers the neighbouring cellar windows: none behind it
    const cellar = L.openings.filter((o) => o.side === 'court' && o.kind === 'cellar_window' && Math.abs(o.a - p.a) < fp.halfWidth + fp.cheek);
    expect(cellar).toHaveLength(0);
  });
  it('the CdL sentry boxes flank the perron foot (not its cheeks)', () => {
    const plan = courtPlan(spec, layout, () => NaN, 1789)!;
    const q = plan.portals.find((x) => x.buildingId === 'KB-B01' && x.kind === 'portal')!;
    const fp = freitreppePlan(layout(byId('KB-B01')).openings.find((o) => o.side === 'court' && o.kind === 'portal')!)!;
    const mine = plan.sentries.filter((s) => s.buildingId === 'KB-B01');
    expect(mine).toHaveLength(2);
    for (const s of mine) {
      const v = [s.p[0] - q.p[0], s.p[1] - q.p[1]];
      const along = Math.abs(v[0] * q.tan[0] + v[1] * q.tan[1]);
      const out = v[0] * q.n[0] + v[1] * q.n[1];
      expect(along - COURT_FURNITURE.sentry.width / 2).toBeGreaterThan(fp.halfWidth + fp.cheek);
      expect(out).toBeGreaterThan(fp.depth - 1);
    }
  });
  it('the Festsaal has one continuous garden balcony across its three portes-fenêtres (no balconets)', () => {
    const L = layout(byId('KB-B01'));
    const pf = L.openings.filter((o) => o.side === 'garden' && o.kind === 'porte_fenetre' && o.storey === 2);
    expect(pf).toHaveLength(3);
    expect(pf.some((o) => o.balcony)).toBe(false);
    const runs = pf.filter((o) => o.balconyRun);
    expect(runs).toHaveLength(1);
    const r = runs[0].balconyRun!;
    for (const o of pf) {
      expect(o.a - o.width / 2).toBeGreaterThan(r.a0);
      expect(o.a + o.width / 2).toBeLessThan(r.a1);
    }
    expect(r.depth).toBeCloseTo(1.2, 9);
  });
  it('the N wing court Durchfahrt has a columned porch whose balcony deck is the Beletage floor, clear of the neighbouring windows', () => {
    const L = layout(byId('KB-B03'));
    const d = L.openings.find((o) => o.side === 'court' && o.kind === 'durchfahrt')!;
    expect(d.portico?.columns).toBe(4);
    const beletage = L.stack.levels.find((l) => l.index === d.storey + 1)!;
    expect(d.portico!.deck_h).toBeCloseTo(beletage.floor_h, 9);
    const P = PASSAGE_PORTICO;
    const outer = d.width / 2 + P.inner + P.columnDiameter + P.pair + 0.15;
    for (const w of L.openings.filter((o) => o.side === 'court' && o.kind === 'window' && Math.abs(o.a - d.a) < 6)) expect(Math.abs(w.a - d.a) - w.width / 2 - 0.2).toBeGreaterThan(outer);
    // the Beletage opens onto the porch balcony through portes-fenêtres without balconets
    const doors = L.openings.filter((o) => o.side === 'court' && o.storey === beletage.index && o.kind === 'porte_fenetre');
    expect(doors).toHaveLength(2);
    expect(doors.some((o) => o.balcony)).toBe(false);
  });
  it('the S wing court centre carries a balcony run over the Durchfahrt (PL, low)', () => {
    const L = layout(byId('KB-B02'));
    const run = L.openings.find((o) => o.side === 'court' && o.balconyRun);
    expect(run).toBeTruthy();
    const d = L.openings.find((o) => o.side === 'court' && o.kind === 'durchfahrt')!;
    expect(run!.balconyRun!.a0).toBeLessThan(d.a);
    expect(run!.balconyRun!.a1).toBeGreaterThan(d.a);
  });
  it('the plan elevation draws the portal frame, the porch and the balconies (plans agree with 3D)', () => {
    const P3 = (s: number, t: number, h: number): [number, number] => [s + t * 0.01, -h];
    const cdl = layout(byId('KB-B01'));
    const portal = cdl.openings.find((o) => o.side === 'court' && o.kind === 'portal')!;
    expect(portalExtrasElev(cdl, 'court', portal, P3)).toContain('<path');
    expect(stepsElev(cdl, 'court', portal, P3)).toContain('<path');
    const fest = cdl.openings.find((o) => o.side === 'garden' && o.balconyRun)!;
    expect(portalExtrasElev(cdl, 'garden', fest, P3)).toContain('<path');
    const n = layout(byId('KB-B03'));
    const d = n.openings.find((o) => o.side === 'court' && o.kind === 'durchfahrt')!;
    expect(portalExtrasElev(n, 'court', d, P3)).toContain('<path');
  });
  it('the porch and balconies build (stone, iron) at LOD1 and LOD2', () => {
    for (const lod of [1, 2] as const) {
      let iron = 0;
      buildExterior(byId('KB-B03'), ctx(lod)).traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name.includes('metal.iron')) iron += (o as THREE.Mesh).geometry.attributes.position.count;
      });
      expect(iron).toBeGreaterThan(0);
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { leafSpan, shutterLeafFit } from '../src/layout/facade.ts';
import { channelReaches, menagerieLayout } from '../src/layout/menagerie.ts';
import { polylineLength } from '../src/layout/geom.ts';
import { MENAGERIE } from '../src/layout/grammar.ts';
import type { EN, MenagerieSpec } from '../src/spec.ts';
import { wallCoverSpans } from '../src/interior/shell.ts';
import { ARTICULATION, CDL_CENTRE, ROOM_ORDER } from '../src/layout/grammar.ts';
import { createMaterials } from '../src/materials/index.ts';
import { carvedFields, corniceProfile, roomOrder, rosetteRadius } from '../src/interior/finish.ts';
import { MEDALLION_SECTION, ovalMoulding } from '../src/interior/furniture.ts';
import { Bucket, beadProfile, beadProfileLite, carvedHead } from '../src/interior/mesh.ts';

// Wave 11 (architecture): garden front relief of the CdL centre, room hierarchy of the panelled rooms, carved heads,
// fine seat ovals.

describe('wave 11: CdL centre grammar (audit #8)', () => {
  it('stays inside the documented ranges of research/02 §2.3 / §2.6', () => {
    expect(CDL_CENTRE.lisene.width).toBeGreaterThanOrEqual(0.6);
    expect(CDL_CENTRE.lisene.width).toBeLessThanOrEqual(0.9);
    expect(CDL_CENTRE.lisene.projection).toBeGreaterThanOrEqual(0.03);
    expect(CDL_CENTRE.lisene.projection).toBeLessThanOrEqual(0.06);
    expect(CDL_CENTRE.surround.projection).toBeGreaterThanOrEqual(0.05);
    expect(CDL_CENTRE.surround.projection).toBeLessThanOrEqual(0.08);
    expect(CDL_CENTRE.door.meetingStile).toBeLessThan(CDL_CENTRE.door.stile);
    expect(CDL_CENTRE.tag).toMatch(/02 §2\.3/);
  });

  it('the Corps de Logis exterior builds at every LOD without NaN', () => {
    const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
    const b = spec.buildings.find((x) => x.id === 'KB-B01')!;
    for (const lod of [0, 1, 2] as const) {
      const ctx: BuildContext = { spec, lod, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
      const g = buildExterior(b, ctx);
      let bad = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) bad++;
      });
      expect(bad).toBe(0);
    }
  });
});

describe('wave-11 review fix: shutter leaves sized to the pier beside the Lisenen', () => {
  it('shutterLeafFit: full without a guard, folded beside a return, none beside a Lisene on a narrow pier', () => {
    expect(shutterLeafFit(10, 1.3, -1, [])).toBe('full');
    expect(shutterLeafFit(10, 1.3, 1, [])).toBe('full');
    // the KB-B01 centre risalit edge at 11.18: a base-plane window at 9.85 folds its right leaf short of the return
    expect(shutterLeafFit(9.85, 1.3, 1, [[11.18, 29.73]])).toBe('folded');
    const f = leafSpan(9.85, 1.3, 1, 'folded')!;
    expect(f[1]).toBeLessThanOrEqual(11.18 - CDL_CENTRE.shutter.clear + 1e-9);
    expect(f[1] - f[0]).toBeCloseTo(0.65 * CDL_CENTRE.shutter.fold, 9);
    // the risalit window at 12.50: its outer pier (0.67 m incl. the surround) holds only the Lisene
    expect(shutterLeafFit(12.5, 1.3, -1, [[11.18 - 50, 11.18 + CDL_CENTRE.lisene.width]])).toBe('none');
    expect(shutterLeafFit(12.5, 1.3, 1, [[11.18 - 50, 11.18 + CDL_CENTRE.lisene.width]])).toBe('full');
    expect(leafSpan(12.5, 1.3, 1, 'none')).toBeNull();
    expect(leafSpan(12.5, 1.3, -1, 'full')![1]).toBeCloseTo(12.5 - 0.65 - ARTICULATION.surround.face - 0.02, 9);
  });

  it('KB-B01: no open shutter leaf overlaps a centre-risalit Lisene, crosses a risalit edge or runs into its return', () => {
    const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
    const b = spec.buildings.find((x) => x.id === 'KB-B01')!;
    const ctx: BuildContext = { spec, lod: 2, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
    const L = ctx.layout(b);
    const g = buildExterior(b, ctx);
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.material !== 'wood.shutter') return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld));
    });
    expect(pts.length).toBeGreaterThan(0);
    const lw = CDL_CENTRE.lisene.width;
    let checked = 0;
    for (const side of ['garden', 'court'] as const) {
      const sd = L.frame.sides[side];
      for (const r of L.sides[side].risalits.filter((x) => x.risalit.kind === 'centre')) {
        const pj = r.risalit.projection ?? ARTICULATION.risalitProjection;
        for (const v of pts) {
          // object space (s, h, -t) -> facade a along the side and offset d out of the base plane
          const ds = v.x - sd.p0[0];
          const dt = -v.z - sd.p0[1];
          const a = ds * sd.tangent[0] + dt * sd.tangent[1];
          const d = ds * sd.normal[0] + dt * sd.normal[1];
          if (d < -0.05 || d > pj + 0.3 || v.y > L.roof.eaves_h) continue;
          checked++;
          const onRisalitPlane = d > pj - 0.05;
          if (onRisalitPlane) {
            // on the risalit plane: inside its edges and clear of both Lisenen
            expect(a).toBeGreaterThan(r.a0 + lw - 1e-6);
            expect(a).toBeLessThan(r.a1 - lw + 1e-6);
          } else {
            // on the base plane: never inside the risalit span (its returns), clear by the rule's gap
            expect(a < r.a0 - CDL_CENTRE.shutter.clear + 1e-6 || a > r.a1 + CDL_CENTRE.shutter.clear - 1e-6).toBe(true);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('wave 11: room hierarchy (audit #9)', () => {
  it('ranks salles grand, antichambres plain/gris, salons pearl', () => {
    expect(roomOrder('festsaal')).toEqual({ cornice: 'grand', tone: 'blanc' });
    expect(roomOrder('dining').cornice).toBe('grand');
    expect(roomOrder('antichambre')).toEqual({ cornice: 'plain', tone: 'gris' });
    expect(roomOrder('salon')).toEqual({ cornice: 'state', tone: 'perle' });
    expect(roomOrder('armoury').tone).toBe('blanc');
    for (const t of ['blanc', 'perle', 'gris'] as const) expect(ROOM_ORDER.boiserie[t]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('cornice sections run from the wall to the ceiling without folds, grand richer, plain shorter', () => {
    const ch = 360;
    const c = 0.6;
    const reach = 0.57;
    const secs = { grand: corniceProfile('grand', c, reach, ch), state: corniceProfile('state', c, reach, ch), plain: corniceProfile('plain', c, reach, ch) };
    for (const p of Object.values(secs)) {
      expect(p[0]).toEqual([0, ch - c]);
      expect(p[p.length - 1][1]).toBeCloseTo(ch, 9);
      for (let i = 1; i < p.length; i++) {
        expect(p[i][0]).toBeGreaterThanOrEqual(p[i - 1][0] - 1e-12);
        expect(p[i][1]).toBeGreaterThanOrEqual(p[i - 1][1] - 1e-12);
      }
    }
    expect(secs.grand.length).toBeGreaterThan(secs.state.length);
    expect(secs.plain.length).toBeLessThan(secs.state.length);
    expect(secs.plain[secs.plain.length - 1][0]).toBeLessThan(secs.state[secs.state.length - 1][0]);
    // a low cornice never takes the grand section
    expect(corniceProfile('grand', 0.2, 0.3, ch)).toEqual(corniceProfile('state', 0.2, 0.3, ch));
  });

  it('rosettes follow the room size within the clamp', () => {
    expect(rosetteRadius(3)).toBe(ROOM_ORDER.rosette.min);
    expect(rosetteRadius(30)).toBe(ROOM_ORDER.rosette.max);
    expect(rosetteRadius(9)).toBeCloseTo(9 * ROOM_ORDER.rosette.share, 9);
  });

  it('carved heads go on every second field, symmetric along the wall', () => {
    expect(carvedFields(0)).toEqual([]);
    expect(carvedFields(1)).toEqual([true]);
    expect(carvedFields(2)).toEqual([true, true]);
    expect(carvedFields(3)).toEqual([true, false, true]);
    expect(carvedFields(4)).toEqual([true, false, false, true]);
    expect(carvedFields(5)).toEqual([true, false, true, false, true]);
    for (let n = 1; n < 12; n++) {
      const f = carvedFields(n);
      expect(f).toEqual([...f].reverse());
    }
  });
});

describe('wave 11: carved heads and mouldings', () => {
  const tris = (b: Bucket) => b.idx.length / 3;

  it('carved heads stay within their triangle budget and in front of the wall', () => {
    const full = new Bucket();
    carvedHead(full, new THREE.Matrix4(), 0.8, ROOM_ORDER.carved.bead, ROOM_ORDER.carved.sag);
    const lite = new Bucket();
    carvedHead(lite, new THREE.Matrix4(), 0.5, ROOM_ORDER.carved.bead, ROOM_ORDER.carved.sag, true);
    expect(tris(full)).toBeLessThanOrEqual(300);
    expect(tris(lite)).toBeLessThanOrEqual(120);
    for (const b of [full, lite]) {
      let zMin = Infinity;
      let xMax = 0;
      for (let i = 0; i < b.pos.length; i += 3) {
        zMin = Math.min(zMin, b.pos[i + 2]);
        xMax = Math.max(xMax, Math.abs(b.pos[i]));
      }
      expect(zMin).toBeGreaterThan(-0.01);
      // the end bows reach ≈ 2.3 beads past the tie points
      expect(xMax).toBeLessThan(0.8 / 2 + 3 * ROOM_ORDER.carved.bead);
    }
  });

  it('the lite bead has half the facets of the full one', () => {
    expect(beadProfileLite(0.035, 0.024).length - 1).toBe(5);
    expect(beadProfile(0.035, 0.024).length - 1).toBe(10);
  });

  it('the seat medallion oval is a fine closed bead with unit normals', () => {
    const g = ovalMoulding(0.2, 0.26, 18, MEDALLION_SECTION);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    // the section is ≈ 22 mm × 16 mm: a fine ring, not a thick torus
    expect(bb.max.z - bb.min.z).toBeLessThanOrEqual(0.02);
    expect((g.getIndex()?.count ?? 0) / 3).toBeLessThanOrEqual(18 * MEDALLION_SECTION.length * 2);
  });
});

describe('KB-I97: the broad menagerie watercourse', () => {
  // a channel running S down three 1 m terrace steps (at N = -20, -40, -60) with a gentle fall on each terrace
  const line: EN[] = [[0, 0], [0, -80]];
  const ground = (p: EN) => {
    const d = -p[1];
    const step = d < 20 ? 0 : d < 22 ? (d - 20) / 2 : d < 40 ? 1 : d < 42 ? 1 + (d - 40) / 2 : d < 60 ? 2 : d < 62 ? 2 + (d - 60) / 2 : 3;
    return 100 - step - 0.01 * (d % 20) + 0.05 * p[0];
  };

  it('is 4-6 m wide [I] with level reaches, one per terrace, the weirs at the foot of each step', () => {
    expect(MENAGERIE.channel.width).toBeGreaterThanOrEqual(4);
    expect(MENAGERIE.channel.width).toBeLessThanOrEqual(6);
    const r = channelReaches(line, ground);
    expect(r).toHaveLength(4);
    expect(r[0].s0).toBe(0);
    expect(r[r.length - 1].s1).toBeCloseTo(80, 6);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].s0).toBeCloseTo(r[i - 1].s1, 9); // contiguous
      expect(r[i].level).toBeLessThan(r[i - 1].level); // never uphill
      expect(r[i].s0).toBeGreaterThanOrEqual(20 * i + 1.5); // at the foot of the step
      expect(r[i].s0).toBeLessThanOrEqual(20 * i + 2.5);
    }
    // the water is never buried: at every station it stands over the bed ground across the whole width
    const hw = MENAGERIE.channel.width / 2;
    for (const x of r)
      for (let s = x.s0; s <= x.s1; s += 0.5) for (const k of [-1, 0, 1]) expect(x.level).toBeGreaterThanOrEqual(ground([k * hw, -s]) + MENAGERIE.channel.over - 1e-9);
  });

  it('flows from the higher end whichever way the line is drawn', () => {
    const a = channelReaches(line, ground);
    const b = channelReaches([...line].reverse(), ground);
    const L = polylineLength(line);
    expect(b.map((x) => [L - x.s1, L - x.s0, x.level]).reverse()).toEqual(a.map((x) => [x.s0, x.s1, x.level]));
  });

  it('rows: the terrace walls stop at the trough, the slots on it stay open', () => {
    const m: MenagerieSpec = { kind: 'rows', rows: [{ p0: [-30, -20], p1: [30, -20], houses: 10 }], front_azimuth: 180, run_depth: 9, channel: line, tag: 'test' };
    const L = menagerieLayout(m);
    expect(L.terraces).toHaveLength(2);
    const ko = MENAGERIE.channel.width / 2 + MENAGERIE.channel.kerb;
    for (const t of L.terraces) for (const p of [t.a, t.b]) expect(Math.abs(p[0])).toBeGreaterThan(ko);
    for (const h of L.houses) expect(Math.abs(h.centre[0]) - h.width / 2).toBeGreaterThan(ko);
  });

  it('KL-B43 builds the trough at LOD1 and LOD2 with water, coping and limewash houses', () => {
    const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
    const b = spec.buildings.find((x) => x.id === 'KL-B43')!;
    for (const lod of [1, 2] as const) {
      const ctx: BuildContext = { spec, lod, materials: createMaterials(), terrain: (x, z) => 300 + z * 0.02 + Math.sin(x) * 0.1, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
      const g = buildExterior(b, ctx);
      const mats = new Set<string>();
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        mats.add(String(m.userData.material));
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.array.length; i++) expect(Number.isFinite(p.array[i])).toBe(true);
      });
      expect(mats.has('water')).toBe(true);
      expect(mats.has('render.farm')).toBe(true);
    }
  });
});

describe('wave-11 review fix: carved heads stay clear of wall-hung items', () => {
  it('wallCoverSpans keeps only the items on this wall, facing into the room', () => {
    const w = { p0: [0, 0] as [number, number], d: [1, 0] as [number, number], nIn: [0, 1] as [number, number], len: 10 };
    const spans = wallCoverSpans(
      [
        { pos: [3, 0.03], facing: [0, 1], width: 1.2, z0: 1, z1: 3.6 },
        { pos: [3, 5], facing: [0, 1], width: 1, z0: 0, z1: 2 }, // free-standing, off the wall
        { pos: [6, 0.03], facing: [0, -1], width: 1, z0: 0, z1: 2 }, // the other face
      ],
      w,
    );
    expect(spans).toEqual([[2.4, 3.6, 1, 3.6]]);
  });
});

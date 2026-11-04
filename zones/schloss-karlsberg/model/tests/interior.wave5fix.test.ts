// Wave-5 review fixes (interiors): mirrors in the room's colours, supraportes vs the picture hang, sconces vs the
// library cases, the wire-door library room, damask figures and panels, the contrasting suite cover, chandelier and
// curule prototypes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { PEARL_COVER, silkColour } from '../src/interior/evidence.ts';
import {
  corniceHeight, damaskFigureOf, damaskMotif, gridLuminance, luminance, mirrorGrid, splitField, supraportePanels,
} from '../src/interior/finish.ts';
import { prototypeParts } from '../src/interior/furniture.ts';
import { Tints, createFallbackMaterials } from '../src/interior/materials.ts';
import { Bucket } from '../src/interior/mesh.ts';
import { interiorModel } from '../src/interior/model.ts';
import { type Item, type RoomWall, fitSconces, wallOverlap } from '../src/interior/programme.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { STATE_ROOM } from '../src/layout/grammar.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const modelOf = (bid: string) => {
  const b = spec.buildings.find((x) => x.id === bid)!;
  return interiorModel(b, layoutBuilding(b, spec));
};
const roomOf = (bid: string, rid: string) => {
  const r = modelOf(bid).rooms.find((x) => x.room.id === rid);
  if (!r) throw new Error(`${bid}/${rid} missing`);
  return r;
};

describe('mirrors reflect the room (wave-5 review)', () => {
  it('mean luminance ≥ 0.6 × the reflected wall albedo, in light and dark rooms', () => {
    for (const wall of ['#C9A94E', '#F1EFE8', '#9B2D2A', '#4E6B4F', '#A7A9A4']) {
      for (const [w, h] of [[1.3, 2.5], [0.66, 2.9], [1.1, 1.6]] as [number, number][]) {
        const g = mirrorGrid(11, w, h, { wall });
        expect(gridLuminance(g), `${wall} ${w}x${h}`).toBeGreaterThanOrEqual(0.6 * luminance(wall));
      }
    }
  });

  it('takes the hue of its room (a yellow room gives a yellow mirror)', () => {
    const y = mirrorGrid(3, 1.2, 2.4, { wall: '#C9A94E' });
    const mid = y.colours[Math.floor(y.ny * 0.45) * y.nx + 0];
    expect(mid[0]).toBeGreaterThan(mid[2] * 1.5);
  });
});

describe('damask figures', () => {
  const [W, H] = STATE_ROOM.damask.repeat;
  for (const fig of ['floral', 'arabesque'] as const) {
    it(`${fig}: in [0, 1], repeats, mirrored, and a field of separate motifs (figure share 8-35 %)`, () => {
      let on = 0;
      const N = 60;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const u = (i / N) * W;
          const v = (j / N) * H;
          const d = damaskMotif(u, v, 0.02, fig);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(1);
          expect(damaskMotif(u + 2 * W, v + 3 * H, 0.02, fig)).toBeCloseTo(d, 6);
          expect(damaskMotif(W - u, v, 0.02, fig)).toBeCloseTo(d, 6);
          if (d > 0.5) on++;
        }
      }
      const share = on / (N * N);
      expect(share).toBeGreaterThan(0.08);
      expect(share).toBeLessThan(0.35);
    });
  }

  it('no continuous lattice: a horizontal line through the repeat crosses ground', () => {
    // the former ogee trellis had a vine on every row; a palmette field leaves ground rows between the motifs
    let groundRows = 0;
    for (let j = 0; j < 40; j++) {
      let max = 0;
      for (let i = 0; i < 40; i++) max = Math.max(max, damaskMotif((i / 40) * W, (j / 40) * H, 0.02, 'floral'));
      if (max < 0.5) groundRows++;
    }
    expect(groundRows).toBeGreaterThan(0);
  });

  it('the Bildergalerie gets its documented arabesques, other rooms the floral figure', () => {
    expect(damaskFigureOf(roomOf('KB-B06', 'B06.1.bildergalerie').room.function)).toBe('arabesque');
    expect(damaskFigureOf(roomOf('KB-B01', 'B01.1.eg-gelber-salon').room.function)).toBe('floral');
  });

  it('silk fields split into panels ≤ panelMax, in order, without overlap', () => {
    const f = { u0: 2.7, u1: 9.81, v0: 0.93, v1: 4.1 };
    const ps = splitField(f);
    expect(ps.length).toBe(Math.ceil((f.u1 - f.u0 + 0.08) / (STATE_ROOM.panelMax + 0.08)));
    for (const p of ps) expect(p.u1 - p.u0).toBeLessThanOrEqual(STATE_ROOM.panelMax + 1e-9);
    for (let i = 1; i < ps.length; i++) expect(ps[i].u0).toBeGreaterThan(ps[i - 1].u1);
    expect(ps[0].u0).toBeCloseTo(f.u0, 9);
    expect(ps[ps.length - 1].u1).toBeCloseTo(f.u1, 9);
    expect(splitField({ u0: 0, u1: 1.5, v0: 1, v1: 3 })).toHaveLength(1);
  });
});

describe('gallery hang and supraportes (wave-5 review, pose 22)', () => {
  /** Wall rectangle [u0, u1] × [v0, v1] of a hung item on wall w. */
  const rectOn = (w: RoomWall, it: Item) => {
    const u = (it.pos[0] - w.p0[0]) * w.d[0] + (it.pos[1] - w.p0[1]) * w.d[1];
    const [wd, , ht] = it.size!;
    return { u0: u - wd / 2, u1: u + wd / 2, v0: it.z ?? 0, v1: (it.z ?? 0) + ht };
  };
  const hit = (a: { u0: number; u1: number; v0: number; v1: number }, b: typeof a) => a.u0 < b.u1 - 1e-6 && b.u0 < a.u1 - 1e-6 && a.v0 < b.v1 - 1e-6 && b.v0 < a.v1 - 1e-6;
  const rooms: [string, string][] = [
    ['KB-B03', 'B03.2.og-grosser-bildersaal'],
    ['KB-B06', 'B06.1.bildergalerie'],
  ];
  for (const [bid, rid] of rooms) {
    it(`${rid}: no two frames on a wall intersect, supraportes included`, () => {
      const r = roomOf(bid, rid);
      const fin = r.room.finish?.walls ?? '';
      const fancy = fin === 'wall.boiserie' || fin.startsWith('wall.silk');
      const clear = r.ceiling_h - r.floor_h;
      const ch = corniceHeight(r.walls.flatMap((w) => [...w.holes, ...(w.niches ?? [])]), clear, fancy, r.vault);
      let supraCount = 0;
      for (const w of r.walls) {
        const on = r.items.filter((it) => (it.kind === 'picture' || it.kind === 'pier_glass') && Math.abs(it.facing[0] - w.nIn[0]) + Math.abs(it.facing[1] - w.nIn[1]) < 1e-6 && Math.abs((it.pos[0] - w.p0[0]) * w.nIn[0] + (it.pos[1] - w.p0[1]) * w.nIn[1]) < 0.3);
        const rects = on.map((it) => rectOn(w, it));
        const supra = supraportePanels(w.len, w.holes, clear, ch, { state: r.grade === 'state', fancy });
        supraCount += supra.length;
        const all = [...rects, ...supra.map((p) => ({ u0: p.u0 - 0.03, u1: p.u1 + 0.03, v0: p.v0 - 0.03, v1: p.v1 + 0.03 }))];
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(hit(all[i], all[j]), `${rid} wall ${w.index}: ${i}/${j}`).toBe(false);
      }
      if (r.grade === 'state' && fancy) expect(supraCount).toBeGreaterThan(0);
    });
  }
});

describe('sconces and the library (wave-5 review, pose 21)', () => {
  it('Hofbibliothek: the sconces sit on the trumeau frame, clear of the oak cases', () => {
    const r = roomOf('KB-B04', 'B04.1.eg-bibliothek');
    const sconces = r.items.filter((it) => it.kind === 'sconce');
    const cases = r.items.filter((it) => it.kind === 'bookcase');
    expect(sconces.length).toBe(2);
    expect(cases.length).toBeGreaterThan(3);
    for (const sc of sconces) for (const c of cases) expect(wallOverlap(sc, c), `${sc.pos} vs ${c.pos}`).toBe(false);
  });

  it('no sconce overlaps a case or a hung frame in any palace room', () => {
    for (const bid of ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05']) {
      for (const r of modelOf(bid).rooms) {
        const tall = r.items.filter((it) => ['bookcase', 'shelf', 'wardrobe', 'vitrine', 'weapon_rack', 'pier_glass', 'picture'].includes(it.kind));
        for (const sc of r.items.filter((it) => it.kind === 'sconce')) for (const t of tall) expect(wallOverlap(sc, t), `${r.room.id}`).toBe(false);
      }
    }
  });

  it('fitSconces moves a clashing sconce onto the trumeau frame, or drops it', () => {
    const base = { name_de: 'x', evidence: 'N' as const, tag: 'N' };
    const tr: Item = { kind: 'trumeau', pos: [0, 0.03], facing: [0, 1], size: [1.3, 0.06, 2.5], z: 1.2, ...base };
    const sc: Item = { kind: 'sconce', pos: [1.1, 0.02], facing: [0, 1], size: [0.5, 0.32, 0.62], z: 1.75, ...base };
    const bc: Item = { kind: 'bookcase', pos: [1.6, 0.24], facing: [0, 1], size: [1.0, 0.46, 3.5], ...base };
    const out = fitSconces([tr, sc, bc]);
    const moved = out.find((it) => it.kind === 'sconce')!;
    expect(moved.pos[0]).toBeCloseTo(0.65 - 0.04, 6);
    expect(wallOverlap(moved, bc)).toBe(false);
    const blocked = fitSconces([sc, bc]);
    expect(blocked.some((it) => it.kind === 'sconce')).toBe(false);
  });

  it('exactly one Hofbibliothek room has the brass-wire doors on crimson taffeta (D T5, room I)', () => {
    const m = modelOf('KB-B04');
    const lib = m.rooms.filter((r) => /eg-bibliothek/.test(r.room.id));
    expect(lib).toHaveLength(4);
    const withDoors = lib.filter((r) => r.items.some((it) => it.kind === 'bookcase' && it.style?.wireDoors));
    expect(withDoors.map((r) => r.room.id)).toEqual(['B04.1.eg-bibliothek']);
    for (const r of lib) for (const c of r.items.filter((it) => it.kind === 'bookcase')) expect(c.style?.oak && c.style?.frieze, r.room.id).toBe(true);
    expect(withDoors[0].room.tag).toMatch(/wire/);
  });
});

describe('seat covers and prototypes', () => {
  it('light silk grounds get a contrasting pearl cover; dark and named grounds keep theirs', () => {
    expect(silkColour('wall.silk.yellow')).toBe(PEARL_COVER);
    expect(Math.abs(luminance(PEARL_COVER) - luminance('#C9A94E'))).toBeGreaterThan(0.2);
    expect(silkColour('wall.silk.green', '#4E6B4F')).toBe('#4E6B4F');
    expect(silkColour('wall.silk.crimson', '#9B2D2A')).toBe('#9B2D2A');
  });

  const lib = createFallbackMaterials();
  const tris = (kind: 'curule' | 'chandelier') =>
    prototypeParts(kind, lib, new Tints(lib)).map((p) => {
      const b = new Bucket();
      p.build(b);
      const ys: number[] = [];
      for (let i = 1; i < b.pos.length; i += 3) ys.push(b.pos[i]);
      return { label: p.label, tris: b.idx.length / 3, maxY: Math.max(...ys), minY: Math.min(...ys) };
    });

  it('curule armchair: carved frame, a stuffed cover part and a fringe, under the 0.8 m sills, ≤ 700 triangles', () => {
    const parts = tris('curule');
    expect(parts.map((p) => p.label)).toEqual(['Gestell (vergoldet, geschnitzt)', 'Bezug (Damast mit Arabesken)', 'Goldfransen']);
    expect(Math.max(...parts.map((p) => p.maxY))).toBeLessThanOrEqual(0.8);
    expect(parts[1].minY).toBeGreaterThanOrEqual(0.43); // the cover sits on the rails: no sling
    expect(parts.reduce((s, p) => s + p.tris, 0)).toBeLessThanOrEqual(700);
  });

  it('chandelier: glass dominates the gilt armature, ≤ 2,500 triangles in three parts', () => {
    const parts = tris('chandelier');
    expect(parts).toHaveLength(3);
    const glass = parts.find((p) => /Behang/.test(p.label))!;
    const gilt = parts.find((p) => /Gestell/.test(p.label))!;
    expect(glass.tris).toBeGreaterThan(gilt.tris);
    expect(parts.reduce((s, p) => s + p.tris, 0)).toBeLessThanOrEqual(2500);
  });

  it('curule covers use the damask figure material', () => {
    const cover = prototypeParts('curule', lib, new Tints(lib))[1].mat as THREE.Material;
    expect(cover.userData.damask).toBe('arabesque');
  });
});

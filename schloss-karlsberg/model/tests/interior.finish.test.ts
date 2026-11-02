// KB-I26 / KB-I27: state-room finish helpers (finish.ts), the profiled gilt frames (mesh.ts) and the programme's
// documented counts (Bildergalerie, Hofbibliothek, Antichambre Nr. 8).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { buildInterior, createFallbackMaterials } from '../src/interior/index.ts';
import {
  SILK_BASE, borderColour, borderRects, canvasGrid, countIn, damaskMotif, hexToRgb, luminance, meanderRects, mirrorGrid, rgbToHex, silkFields, silkHue,
} from '../src/interior/finish.ts';
import { Bucket, beadProfile, mouldFrame, type V3 } from '../src/interior/mesh.ts';
import { interiorModel } from '../src/interior/model.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { STATE_ROOM } from '../src/layout/grammar.ts';
import { MATERIAL_BASE } from '../src/materials/index.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const get = (id: string) => spec.buildings.find((b) => b.id === id)!;
const roomOf = (bid: string, rid: string) => {
  const b = get(bid);
  const m = interiorModel(b, layoutBuilding(b, spec));
  const r = m.rooms.find((x) => x.room.id === rid);
  if (!r) throw new Error(`${bid}/${rid} missing`);
  return r;
};
const inside = (r: { u0: number; u1: number; v0: number; v1: number }, o: { u0: number; u1: number; v0: number; v1: number }) =>
  r.u0 >= o.u0 - 1e-9 && r.u1 <= o.u1 + 1e-9 && r.v0 >= o.v0 - 1e-9 && r.v1 <= o.v1 + 1e-9;

describe('finish colours', () => {
  it('SILK_BASE is the twin of MATERIAL_BASE for every silk', () => {
    for (const [name, hex] of Object.entries(SILK_BASE)) expect((MATERIAL_BASE as Record<string, { color: string }>)[name]?.color.toUpperCase(), name).toBe(hex.toUpperCase());
    for (const name of Object.keys(MATERIAL_BASE).filter((n) => n.startsWith('wall.silk.'))) expect(SILK_BASE[name], name).toBeTruthy();
  });

  it('hex round trip and the catalogue colour override', () => {
    expect(rgbToHex(hexToRgb('#9B2D2A'))).toBe('#9B2D2A');
    expect(silkHue({ walls: 'wall.silk.crimson', colour: '#8E2F3A' })).toBe('#8E2F3A');
    expect(silkHue({ walls: 'wall.silk.yellow' })).toBe(SILK_BASE['wall.silk.yellow']);
    expect(silkHue({ walls: 'wall.plaster.white' as never })).toBeNull();
  });

  it('the default border contrasts with its ground', () => {
    for (const g of Object.values(SILK_BASE)) {
      const b = borderColour(g);
      expect(b).toMatch(/^#[0-9A-F]{6}$/i);
      expect(Math.abs(luminance(b) - luminance(g))).toBeGreaterThan(0.05);
    }
  });
});

describe('silk fields and borders', () => {
  const holes = [
    { u0: 1.0, u1: 2.2, v0: 0, v1: 2.8 },
    { u0: 4.0, u1: 5.3, v0: 0.85, v1: 3.6 },
  ];
  const v0 = STATE_ROOM.dado;
  const v1 = 4.4;
  const fields = silkFields(7.5, holes, v0, v1);

  it('fields cover the wall between dado and cornice and never overlap a hole', () => {
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const f of fields) {
      expect(f.v0).toBeGreaterThanOrEqual(v0 - 1e-9);
      expect(f.v1).toBeLessThanOrEqual(v1 + 1e-9);
      expect(f.u0).toBeGreaterThanOrEqual(-1e-9);
      expect(f.u1).toBeLessThanOrEqual(7.5 + 1e-9);
      for (const h of holes) {
        const ov = Math.min(f.u1, h.u1) - Math.max(f.u0, h.u0) > 1e-6 && Math.min(f.v1, h.v1) - Math.max(f.v0, h.v0) > 1e-6;
        expect(ov, JSON.stringify([f, h])).toBe(false);
      }
    }
  });

  it('border rects lie inside their field, inside the Leiste', () => {
    for (const f of fields) {
      const rs = borderRects(f);
      for (const r of rs) {
        expect(inside(r, f)).toBe(true);
        expect(r.u0 - f.u0 >= STATE_ROOM.leiste.width - 1e-9 || r.v0 - f.v0 >= STATE_ROOM.leiste.width - 1e-9).toBe(true);
      }
    }
  });
});

describe('damask motif', () => {
  it('stays in [0, 1], repeats on the grammar repeat and is mirrored about the repeat axis', () => {
    const [W, H] = STATE_ROOM.damask.repeat;
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const u = (i / 40) * W;
        const v = (j / 40) * H;
        const d = damaskMotif(u, v);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        expect(damaskMotif(u + 3 * W, v + 2 * H)).toBeCloseTo(d, 6);
        expect(damaskMotif(W - u, v)).toBeCloseTo(d, 6);
      }
    }
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });
});

describe('canvases and mirrors', () => {
  it('canvasGrid is deterministic, small and reads as a darkened old master', () => {
    const a = canvasGrid(42, 1.2, 0.9);
    const b = canvasGrid(42, 1.2, 0.9);
    expect(a).toEqual(b);
    expect(a.nx).toBeLessThanOrEqual(14);
    expect(a.ny).toBeLessThanOrEqual(14);
    expect(a.colours).toHaveLength(a.nx * a.ny);
    let mean = 0;
    for (let s = 1; s <= 40; s++) {
      const g = canvasGrid(s, 0.6 + (s % 5) * 0.3, 0.7 + (s % 3) * 0.3);
      const ls = g.colours.map(([r, gg, bb]) => 0.2126 * r + 0.7152 * gg + 0.0722 * bb);
      mean += ls.reduce((x, y) => x + y, 0) / ls.length / 40;
      // tonal variation inside one picture (not a flat swatch)
      expect(Math.max(...ls) - Math.min(...ls)).toBeGreaterThan(0.1);
      for (const c of g.colours) for (const x of c) expect(x >= 0 && x <= 1).toBe(true);
    }
    expect(mean).toBeLessThan(0.45);
    expect(new Set(Array.from({ length: 30 }, (_, s) => canvasGrid(s, 1, 1).kind)).size).toBeGreaterThanOrEqual(3);
  });

  it('mirrorGrid is a bright, low-saturation glass with darker edges', () => {
    const g = mirrorGrid(7, 1.1, 2.4);
    expect(g.colours).toHaveLength(g.nx * g.ny);
    const L = (i: number, j: number) => {
      const [r, gg, bb] = g.colours[j * g.nx + i];
      return 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
    };
    const mid = L(Math.floor(g.nx / 2), Math.floor(g.ny * 0.55));
    expect(mid).toBeGreaterThan(0.45);
    expect(L(0, 0)).toBeLessThan(mid);
  });
});

describe('meander frieze', () => {
  it('every strip lies inside the band', () => {
    const band = { u0: 0, u1: 3.3, v0: 0, v1: STATE_ROOM.library.frieze };
    const rs = meanderRects(band.u1, band.v1);
    expect(rs.length).toBeGreaterThan(20);
    for (const r of rs) expect(inside(r, band)).toBe(true);
  });
});

describe('countIn', () => {
  it('reads documented counts from function text', () => {
    expect(countIn('20 crystal chandeliers, 104 gilt curule armchairs', /crystal chandeliers?/)).toBe(20);
    expect(countIn('20 crystal chandeliers, 104 gilt curule armchairs', /curule (?:arm)?chairs?/)).toBe(104);
    expect(countIn('two bergères', /bergères?/)).toBeNull();
    expect(countIn(undefined, /x/)).toBeNull();
  });
});

describe('mouldFrame', () => {
  it('sweeps (profile segments × sides) quads, three sides when open, nothing when too small', () => {
    const F = (x: number, y: number, z: number): V3 => [x, y, z];
    const prof = beadProfile(0.05, 0.02);
    const tris = (open: boolean, w = 1) => {
      const b = new Bucket();
      mouldFrame(b, F, F, 0, 0, w, 1, prof, open);
      return b.idx.length / 3;
    };
    expect(tris(false)).toBe((prof.length - 1) * 4 * 2);
    expect(tris(true)).toBe((prof.length - 1) * 3 * 2);
    expect(tris(false, 0.08)).toBe(0);
  });
});

describe('state-room programme (KB-I26 / KB-I27)', () => {
  it('Bildergalerie KB-B06: the documented 20 chandeliers and 104 curule armchairs, side tables with candelabra, a dense hang on both long walls', () => {
    const r = roomOf('KB-B06', 'B06.1.bildergalerie');
    const n = (k: string) => r.items.filter((it) => it.kind === k).length;
    expect(n('chandelier')).toBe(20);
    expect(n('curule')).toBe(104);
    expect(n('console')).toBeGreaterThan(5);
    expect(n('candelabrum')).toBe(n('console'));
    expect(n('picture')).toBeGreaterThan(150);
    const long = r.walls.filter((w) => w.len > 30);
    expect(long).toHaveLength(2);
    // pictures face into the room from both long walls
    for (const w of long) {
      const on = r.items.filter((it) => it.kind === 'picture' && Math.abs(it.facing[0] - w.nIn[0]) + Math.abs(it.facing[1] - w.nIn[1]) < 1e-6);
      expect(on.length, `wall ${w.index}`).toBeGreaterThan(40);
    }
  });

  it('Hofbibliothek: oak cases with Greek-key frieze and wire doors (D T5), not white shelving', () => {
    const r = roomOf('KB-B04', 'B04.1.eg-bibliothek');
    const cases = r.items.filter((it) => it.kind === 'bookcase');
    expect(cases.length).toBeGreaterThan(3);
    for (const c of cases) {
      expect(c.style?.oak).toBe(true);
      expect(c.style?.frieze).toBe(true);
      expect(c.evidence).toBe('D');
    }
  });

  it('Antichambre Nr. 8: canapé and the two bergères of the Jacob suite', () => {
    const r = roomOf('KB-B01', 'B01.2.og-antichambre');
    expect(r.room.name_de).toMatch(/Nr\. 8/);
    expect(r.items.filter((it) => it.kind === 'bergere')).toHaveLength(2);
  });

  it('named room colours reach the model', () => {
    expect(roomOf('KB-B01', 'B01.1.eg-gelber-salon').room.finish?.walls).toBe('wall.silk.yellow');
    expect(roomOf('KB-B03', 'B03.2.og-antichambre').room.finish?.colour).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('ceiling rosettes only where a chandelier hangs (no flat discs)', () => {
    const b = get('KB-B01');
    const ctx: BuildContext = { spec, lod: 2, materials: createFallbackMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
    const g = buildInterior(b, ctx);
    const withRosette = new Set<string>();
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /\/rosette\//.test(o.name)) withRosette.add(o.userData.roomId as string);
    });
    const m = interiorModel(b, layoutBuilding(b, spec));
    const withChandelier = new Set(m.rooms.filter((r) => r.items.some((it) => it.kind === 'chandelier')).map((r) => r.room.id));
    expect(withRosette.size).toBeGreaterThan(3);
    for (const id of withRosette) expect(withChandelier.has(id), id).toBe(true);
  });
});

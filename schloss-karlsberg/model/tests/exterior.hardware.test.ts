// KB-I18 roof detail, KB-I22 roof hardware and the wave-3 reveal residual (cellar-window reveals in the plinth).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { roofSection } from '../src/layout/roof.ts';
import { ARTICULATION, DOWNPIPE, LIGHTNING_ROD, ROOF_COVER } from '../src/layout/grammar.ts';
import { CLAY_TILE_TEXTURE, TEXTURE_SIZE, clayTileSize, createMaterials } from '../src/materials/index.ts';
import { buildExterior, exteriorInfo } from '../src/exterior/index.ts';
import { GeoBuilder } from '../src/exterior/builder.ts';
import { isLeadDeckSegment, rectRoof } from '../src/exterior/roof.ts';
import { CORNER_ORDER, conductorCorner, conductorPath, downpipePositions, openingBlock, rodMasts, sideDownpipes } from '../src/exterior/hardwarePlan.ts';
import { AO, SHADE_ATTRIBUTE, decodeShade, plinthAO, revealAO, revealCornerAO, wallAO } from '../src/exterior/shade.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);
const ctx = (lod: 0 | 1 | 2): BuildContext => ({ spec, lod, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout });
const byId = (id: string) => spec.buildings.find((b) => b.id === id)!;

describe('KB-I18 roof cover', () => {
  it('the clay-tile texture repeats at the Biberschwanz course (0.15 m) and tile width (0.18 m)', () => {
    const [w, h] = clayTileSize();
    expect(h / CLAY_TILE_TEXTURE.courses).toBeCloseTo(ROOF_COVER.biberschwanz.course, 6);
    expect(w / CLAY_TILE_TEXTURE.tiles).toBeCloseTo(ROOF_COVER.biberschwanz.width, 6);
    expect(TEXTURE_SIZE.clay_tile_roof).toEqual([w, h]);
  });

  it('a mansard deck flatter than leadDeckMaxPitch is lead, a 21° deck stays slate; the lower slope is never lead', () => {
    const flat = roofSection({ type: 'mansard', depth: 18, eaves_h: 356, pitch_lower: 70, pitch_upper: 5 });
    const steep = roofSection({ type: 'mansard', depth: 18, eaves_h: 356, pitch_lower: 70, pitch_upper: 21 });
    expect(isLeadDeckSegment(flat, flat.break_inset!)).toBe(true);
    expect(isLeadDeckSegment(flat, 0)).toBe(false);
    expect(isLeadDeckSegment(steep, steep.break_inset!)).toBe(false);
    expect(isLeadDeckSegment(roofSection({ type: 'hip', depth: 10, eaves_h: 0, pitch_lower: 45 }), 1)).toBe(false);
    const g = new GeoBuilder();
    rectRoof(g, flat, { length: 20, depth: 18, hipped: true, roofKey: 'roof.slate', gableKey: 'render.lime', deckKey: 'roof.lead' });
    const names = g.toMeshes(createMaterials(), 'x', {}).map((m) => m.name);
    expect(names.some((n) => n.endsWith('roof.lead'))).toBe(true);
    expect(names.some((n) => n.endsWith('roof.slate'))).toBe(true);
  });
});

describe('KB-I22 roof hardware plan', () => {
  it('spreads rod masts at most `spacing` apart, centred on the ridge; an apex gets one', () => {
    const m = rodMasts(60, 5);
    expect(m).toHaveLength(Math.ceil(60 / LIGHTNING_ROD.spacing));
    expect((m[0] + m[m.length - 1]) / 2).toBeCloseTo(5, 6);
    for (let i = 1; i < m.length; i++) expect(m[i] - m[i - 1]).toBeLessThanOrEqual(LIGHTNING_ROD.spacing);
    expect(rodMasts(0.2, 3)).toEqual([3]);
  });

  it('downpipes: corners first, ≤ maxSpacing apart, never on an opening, corners only where free', () => {
    const openings = Array.from({ length: 15 }, (_, i) => ({ a: 2.5 + i * 3.5, width: 1.3 }));
    const len = 54;
    const p = downpipePositions(len, openings, [true, true], 0, 0.4);
    expect(p[0]).toBeCloseTo(0.4, 6);
    expect(p[p.length - 1]).toBeCloseTo(len - 0.4, 6);
    for (let i = 1; i < p.length; i++) expect(p[i] - p[i - 1]).toBeLessThanOrEqual(DOWNPIPE.maxSpacing);
    for (const x of p) for (const o of openings) expect(Math.abs(x - o.a)).toBeGreaterThanOrEqual(openingBlock(o) - 1e-9);
    // a junction corner gets no pipe; a short side gets one at its free corner
    expect(downpipePositions(len, openings, [false, true], 0, 0.4)[0]).toBeGreaterThan(1);
    expect(downpipePositions(12, [], [false, true], 0, 0.4)).toEqual([12 - 0.4]);
  });

  it('downpipes (wave-4 review): never inside a risalit, at its flanks first, never on an open shutter leaf', () => {
    // 60 m front, windows 1.3 m on 3.5 m axes with 0.65 m leaves (piers too narrow), a central risalit 24-36 m
    const openings = Array.from({ length: 17 }, (_, i) => ({ a: 2 + i * 3.5, width: 1.3, leaf: 0.65 })).filter((o) => o.a < 22 || o.a > 38);
    const risalits: [number, number][] = [[24, 36]];
    const p = downpipePositions(60, openings, [true, true], 0, 0.4, { risalits });
    for (const x of p) {
      expect(x < 24 || x > 36).toBe(true);
      for (const o of openings) expect(Math.abs(x - o.a)).toBeGreaterThanOrEqual(openingBlock(o) - 1e-9);
    }
    // the middle runs are drained at the risalit flanks
    expect(p.some((x) => x > 23 && x < 24)).toBe(true);
    expect(p.some((x) => x > 36 && x < 37)).toBe(true);
    for (let i = 1; i < p.length; i++) expect(p[i] - p[i - 1]).toBeLessThanOrEqual(DOWNPIPE.maxSpacing);
  });

  for (const id of ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B10']) {
    it(`${id}: no downpipe inside a risalit span or on an open shutter leaf`, () => {
      const L = layout(byId(id));
      const f = L.building.facade;
      const shutters = ['louvred', 'plank'].includes(f.shutter_type ?? (f.shutters ? 'louvred' : 'none'));
      for (const side of ['garden', 'court'] as const) {
        const lay = L.sides[side];
        if (!lay) continue;
        const pipes = sideDownpipes(L, side, [true, true], 0, 0.85);
        const len = L.frame.sides[side].length;
        for (const a of pipes) {
          const atCorner = a < 1 || a > len - 1;
          if (!atCorner) for (const r of lay.risalits) expect(a <= r.a0 - 0.2 || a >= r.a1 + 0.2).toBe(true);
          for (const o of L.openings.filter((x) => x.side === side)) {
            const leaf = shutters && o.kind === 'window' ? o.width / 2 : 0;
            expect(Math.abs(a - o.a)).toBeGreaterThan(o.width / 2 + ARTICULATION.surround.face + leaf + DOWNPIPE.diameter / 2);
          }
        }
      }
    });
  }

  it('the down-conductor runs from the ridge over the cornice to the ground at a free corner', () => {
    const L = layout(byId('KB-B20'));
    const c = conductorCorner(L, () => true);
    expect(c).not.toBeNull();
    expect(CORNER_ORDER).toContainEqual(c);
    const path = conductorPath(L, c!, 0, L.stack.base_h);
    expect(path[0][2]).toBeGreaterThan(L.roof.ridge_h);
    expect(path[path.length - 1][2]).toBe(L.stack.base_h);
    // monotone descent after the ridge run; ends outside the wall corner
    for (let i = 1; i < path.length; i++) expect(path[i][2]).toBeLessThanOrEqual(path[i - 1][2] + 1e-9);
    const end = path[path.length - 1];
    expect(Math.abs(end[0])).toBeGreaterThan(L.frame.length / 2);
    expect(Math.abs(end[1])).toBeGreaterThan(L.frame.width / 2);
    expect(conductorCorner(L, () => false)).toBeNull();
  });

  it('LOD1 adds downpipes and LOD2 adds lightning rods; LOD0 has neither', () => {
    const count = (lod: 0 | 1 | 2) => {
      let n = 0;
      buildExterior(byId('KB-B03'), ctx(lod)).traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name.includes('metal.iron')) n += (o as THREE.Mesh).geometry.attributes.position.count;
      });
      return n;
    };
    const [c0, c1, c2] = [count(0), count(1), count(2)];
    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);
  });
});

describe('wave-3 residual: reveals are never lighter than the wall they are cut into', () => {
  it('revealCornerAO multiplies the depth AO by the zone AO', () => {
    for (const t of [0, 0.5, 1]) {
      const r = revealCornerAO(revealAO(t, 'jamb'), revealAO(t, 'jamb'), AO.foot.ao, 0.9);
      expect(Math.max(r[0], r[3])).toBeLessThanOrEqual(AO.foot.ao);
      expect(Math.max(r[1], r[2])).toBeLessThanOrEqual(0.9);
    }
  });

  for (const id of ['KB-B01', 'KB-B02', 'KB-B03']) {
    it(`${id}: every shaded plinth / wall vertex has AO ≤ the zone AO at its height (reveal AO ≤ wall AO)`, () => {
      const b = byId(id);
      const L = layout(b);
      const c = ctx(1);
      const info = exteriorInfo(L, c);
      const z = { grade: L.stack.base_h, plinthTop: info.plinthTop, corniceFoot: info.eaves - L.members.cornice.height };
      let plinthChecked = 0;
      let darker = 0;
      buildExterior(b, c).traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !/\/exterior\/(stone\.red|render\.lime)$/.test(m.name)) return;
        const isPlinth = m.name.endsWith('stone.red');
        const a = m.geometry.getAttribute(SHADE_ATTRIBUTE);
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          const inZone = isPlinth ? y >= z.grade - 1e-3 && y <= z.plinthTop + 1e-3 : y >= z.plinthTop + 1e-3 && y <= z.corniceFoot;
          if (!inZone) continue;
          const w = decodeShade(a.array as Uint16Array, i * 4)[3];
          if (w > 0.999) continue; // unshaded blocks (steps, pedestals) are no reveals
          const ref = isPlinth ? plinthAO(y, z) : wallAO(y, z);
          expect(w).toBeLessThanOrEqual(ref + 0.005);
          if (isPlinth) {
            plinthChecked++;
            if (w < ref - 0.02) darker++;
          }
        }
      });
      expect(plinthChecked).toBeGreaterThan(100);
      expect(darker).toBeGreaterThan(0); // the cellar-window reveals darken below the plinth face
    });
  }
});

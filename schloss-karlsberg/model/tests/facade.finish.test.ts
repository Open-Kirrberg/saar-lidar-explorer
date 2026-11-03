/**
 * KB-I16/I17/I19/I20: facade members, finish variation and baked shading (pure parts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { finishYear } from '../../scripts/catalogue-v2/buildings.ts';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { buildExterior } from '../src/exterior/index.ts';
import {
  AO,
  ASHLAR,
  ashlarBlocks,
  blockTint,
  buildingLum,
  decodeShade,
  encodeShade,
  LIMEWASH,
  limewashColour,
  plinthAO,
  revealAO,
  roofTint,
  SHADE_ATTRIBUTE,
  STONE_HUES,
  sillGrime,
  wallAO,
  wallBreaks,
  wallGrime,
} from '../src/exterior/shade.ts';
import { CORNICE, corniceFor } from '../src/layout/grammar.ts';
import { createMaterials } from '../src/materials/index.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);
const byId = (id: string) => {
  const b = spec.buildings.find((x) => x.id === id);
  if (!b) throw new Error(id);
  return b;
};

describe('facade members (KB-I17)', () => {
  it('the palace group shares one continuous cornice; other buildings keep their class cornice', () => {
    for (const id of ['KB-B01', 'KB-B02', 'KB-B03']) expect(layout(byId(id)).members.cornice).toEqual(CORNICE.palace);
    expect(corniceFor('WING2', 340, spec.defaults)).toEqual(CORNICE.WING2);
    expect(corniceFor('WING2', 356, { eaves_continuous: false, eaves_palace: 356 })).toEqual(CORNICE.WING2);
  });
  it('string courses only on the Corps de logis; no corner Lisenen on farm buildings', () => {
    expect(layout(byId('KB-B01')).members.stringCourse).toBe(true);
    expect(layout(byId('KB-B02')).members.stringCourse).toBe(false);
    expect(layout(byId('KB-B06')).members.stringCourse).toBe(false);
    expect(layout(byId('KB-B02')).members.risalitLisenen).toBe('portico');
    expect(layout(byId('KB-B01')).members.risalitLisenen).toBe('all');
    expect(layout(byId('KB-B30')).members.cornerLisenen).toBe(false);
  });
  it('window caps only on the CdL centre axes of the Beletage', () => {
    for (const b of spec.buildings) {
      if (b.placement === 'unplaced') continue;
      for (const o of layout(b).openings) if (o.hood) expect(b.cls).toBe('CDL');
    }
    const cdl = layout(byId('KB-B01')).openings;
    expect(cdl.some((o) => o.hood)).toBe(true);
    expect(cdl.filter((o) => o.hood).every((o) => o.row === 'upper')).toBe(true);
  });
  it('balconets only before upper portes-fenetres above a portal', () => {
    for (const b of spec.buildings) {
      if (b.placement === 'unplaced') continue;
      for (const o of layout(b).openings) if (o.balcony) expect(o.kind).toBe('porte_fenetre');
    }
  });
});

describe('finish variation (KB-I19)', () => {
  it('limewash moves from warm (by 1780) to cool (from 1786)', () => {
    const warm = limewashColour('#ECE8DF', 1778);
    const cool = limewashColour('#ECE8DF', 1788);
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [wr, , wb] = rgb(warm);
    const [cr, , cb] = rgb(cool);
    expect(wr - wb).toBeGreaterThan(cr - cb); // warmer = more red than blue
    expect(limewashColour('#ECE8DF', undefined)).toBe('#ECE8DF');
    expect(limewashColour('#ECE8DF', 1770)).toBe(limewashColour('#ECE8DF', LIMEWASH.warmUntil));
  });
  it('per-building luminance stays within +-3 % and is deterministic', () => {
    for (const id of ['KB-B01', 'KB-B02', 'KB-B24', 'KB-B49']) {
      const l = buildingLum(id, 1789);
      expect(Math.abs(l - 1)).toBeLessThanOrEqual(LIMEWASH.lumJitter);
      expect(buildingLum(id, 1789)).toBe(l);
    }
    const r = roofTint('KB-B02', 'slate', 1789);
    for (const c of r) expect(Math.abs(c - 1)).toBeLessThan(0.08);
  });
  it('ashlar blocks tile the span without gaps and keep keys across split pieces', () => {
    const blocks = ashlarBlocks(1.3, 7.9, 0.2, 1.9);
    const courses = new Map<number, typeof blocks>();
    for (const b of blocks) courses.set(b.h0, [...(courses.get(b.h0) ?? []), b]);
    expect(courses.size).toBe(Math.ceil(1.9 / ASHLAR.course) - Math.floor(0.2 / ASHLAR.course));
    for (const row of courses.values()) {
      expect(row[0].u0).toBeCloseTo(1.3, 9);
      expect(row[row.length - 1].u1).toBeCloseTo(7.9, 9);
      for (let i = 1; i < row.length; i++) expect(row[i].u0).toBeCloseTo(row[i - 1].u1, 9);
    }
    // a block cut by a window keeps its key on both sides
    const left = ashlarBlocks(0, 1.0, 0, 0.3);
    const right = ashlarBlocks(1.0, 2.0, 0, 0.3);
    expect(left[left.length - 1].key).toBe(right[0].key);
  });
  it('block tints are deterministic, vary every block by <= 5 % value and only shift red toward yellow-grey', () => {
    const t = blockTint('KB-B01', '0|0:1', '#A65E4A', 1789);
    expect(blockTint('KB-B01', '0|0:1', '#A65E4A', 1789)).toEqual(t);
    const base = new THREE.Color('#A65E4A'); // linear
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const y0 = lum(base.r, base.g, base.b);
    let nearRed = 0;
    let spread = 0;
    for (let i = 0; i < 300; i++) {
      const c = blockTint('KB-B01', `k${i}`, '#A65E4A', 1789);
      const y = lum(base.r * c[0], base.g * c[1], base.b * c[2]) / y0;
      expect(Math.abs(y - 1)).toBeLessThanOrEqual(0.0501); // ±5 % value
      spread = Math.max(spread, Math.abs(y - 1));
      // hue moves only toward yellow-grey: green/red never below the base, never past a 12 % blend
      const gr = c[1] / c[0];
      expect(gr).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(gr).toBeLessThan(1.35);
      expect(c[2] / c[0]).toBeGreaterThanOrEqual(1 - 1e-9); // no mauve: blue never lifts more than green
      expect(c[2] / c[0]).toBeLessThanOrEqual(gr * 1.3);
      if (gr < 1.15) nearRed++;
    }
    // every block varies across (nearly) the full ±lumJitter (wave-10 review: 0.03, the mixed stones carry the rest)
    expect(spread).toBeGreaterThan(STONE_HUES.lumJitter * 0.8);
    expect(nearRed).toBeGreaterThan(150); // most blocks stay close to the base red
  });
  it('ashlar course grid matches the texture mapping (0.30-0.40 m courses, 5 per tile)', () => {
    expect(ASHLAR.course).toBeGreaterThanOrEqual(0.3);
    expect(ASHLAR.course).toBeLessThanOrEqual(0.4);
    expect(ASHLAR.course * ASHLAR.joints.length).toBeCloseTo(ASHLAR.tileV, 9);
    // block lengths along a long wall: mostly 0.6-1.2 m, none under 0.25 m except where cut by the span ends
    const blocks = ashlarBlocks(0, 30, 0, ASHLAR.tileV).filter((b) => b.u0 > 0 && b.u1 < 30);
    const len = blocks.map((b) => b.u1 - b.u0);
    expect(Math.min(...len)).toBeGreaterThan(0.25);
    expect(len.filter((l) => l >= 0.6 && l <= 1.2).length / len.length).toBeGreaterThan(0.6);
  });
  it('facade finish year parser takes the last year of the built text', () => {
    expect(finishYear('1781-82')).toBe(1782);
    expect(finishYear('1785')).toBe(1785);
    expect(finishYear('before 1780')).toBeUndefined();
    expect(finishYear('1780s')).toBeUndefined();
    expect(finishYear(undefined)).toBeUndefined();
    expect(byId('KB-B01').facade.build_year).toBe(1782);
  });
});

describe('baked shading (KB-I20)', () => {
  const z = { grade: 0, plinthTop: 0.8, corniceFoot: 9 };
  it('encodes and decodes shades within the 16-bit step', () => {
    const rawS = [1, 1.2, 0.8, 0.5, 4, 0, 1, 1];
    const out = new Uint16Array(8);
    encodeShade(rawS, out);
    for (const i of [0, 4]) {
      const d = decodeShade(out, i);
      for (let k = 0; k < 4; k++) expect(d[k]).toBeCloseTo(rawS[i + k], 3);
    }
  });
  it('walls darken at the plinth ledge and under the cornice, not in the middle', () => {
    expect(wallAO(z.plinthTop, z)).toBeCloseTo(AO.plinthLedge.ao, 6);
    expect(wallAO(5, z)).toBe(1);
    expect(wallAO(z.corniceFoot, z)).toBeCloseTo(AO.underCornice.ao, 6);
    expect(plinthAO(z.grade, z)).toBeCloseTo(AO.foot.ao, 6);
    expect(plinthAO(z.grade + 2, z)).toBe(1);
    expect(wallGrime(z.corniceFoot, z)).toBeLessThan(1);
    expect(wallGrime(4, z)).toBe(1);
    expect(sillGrime(0)).toBeLessThan(sillGrime(0.5));
    expect(sillGrime(5)).toBe(1);
    const br = wallBreaks(z);
    expect(br).toContain(z.corniceFoot);
  });
  it('reveals darken toward the joinery; soffits most', () => {
    expect(revealAO(0, 'jamb')).toBeGreaterThan(revealAO(1, 'jamb'));
    expect(revealAO(1, 'soffit')).toBeLessThan(revealAO(1, 'jamb'));
  });
  it('the exterior builder writes the aShade attribute on facade meshes', () => {
    const ctx: BuildContext = { spec, lod: 1, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout };
    const g = buildExterior(byId('KB-B03'), ctx);
    let shaded = 0;
    let dark = 0;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const a = m.geometry.getAttribute(SHADE_ATTRIBUTE);
      if (!a) return;
      shaded++;
      for (let i = 0; i < a.count; i++) if (a.getW(i) < 0.8) dark++;
    });
    expect(shaded).toBeGreaterThan(3);
    expect(dark).toBeGreaterThan(0);
  });
});

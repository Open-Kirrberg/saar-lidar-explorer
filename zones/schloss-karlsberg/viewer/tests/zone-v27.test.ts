/**
 * V2.7 zone runtime (ADR 0029): the pure parts of the castle zone - highlights, overview POIs, zone pose round trip,
 * quality mapping, Gewissheit select and the shared-tree selection.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '@model/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '@model/context.ts';
import { E0, N0 } from '@model/frame.ts';
import { sitePois } from '@model/site/index.ts';
import { DEFAULT_HIGHLIGHT, HIGHLIGHTS } from '../src/highlights.ts';
import { poiWalks, viewPois } from '../src/views.ts';
import { localToZonePose, zonePoseToLocal } from '../src/zone/pose.ts';
import type { ZonePose, ZoneSharedTree } from '../src/zone/api.ts';
import { QUALITY, castleQuality, isZoneQuality } from '../src/quality.ts';
import { GEWISSHEIT_OPTIONS, gewissheit, gewissheitOf, isGewissheit } from '../src/gewissheit.ts';
import { footprintToLocal, groundClassLookup, selectSharedTrees, sharedScale, sharedSpecies, treeBbox } from '../src/sharedTrees.ts';
import { DEFAULT_FOREST_MIX, GROUND_CLASS } from '../src/landcover.ts';
import { letterboxBar } from '../src/hud.ts';

const ROOT = resolve(import.meta.dirname, '../..');

describe('highlights (V2.7 „Gehe zu“)', () => {
  const { spec } = loadSite(JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')) as unknown);
  const ctx = { spec, lod: 1 as const, terrain: () => 345, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec), materials: undefined as never };
  const pois = [...viewPois(spec), ...sitePois(spec, ctx)];
  const ids = new Set(pois.map((p) => p.id));

  it('has the eight highlights in order, view-west first and default', () => {
    expect(HIGHLIGHTS.map((h) => h.id)).toEqual([
      'view-west',
      'view-ehrenhof',
      'KB-B01/B01.1.eg-prunktreppe',
      'KB-B01/B01.2.og-festsaal',
      'KB-B06/B06.1.bildergalerie',
      'view-east',
      'KB-B10/B10.1.s-pfeilersaal',
      'view-karlslust',
    ]);
    expect(DEFAULT_HIGHLIGHT).toBe('view-west');
  });

  it('every id resolves to a POI (views + site POIs), labels are short German strings', () => {
    for (const h of HIGHLIGHTS) {
      expect(ids.has(h.id), h.id).toBe(true);
      expect(h.label_de.length, h.label_de).toBeLessThanOrEqual(24);
      expect(h.label_de.length).toBeGreaterThan(0);
    }
    expect(HIGHLIGHTS.some((h) => h.label_de === 'Festsaal')).toBe(true);
  });

  it('rooms and the Ehrenhof view start walking, the overviews flying', () => {
    const byId = new Map(pois.map((p) => [p.id, p]));
    expect(poiWalks(byId.get('KB-B01/B01.2.og-festsaal')!)).toBe(true);
    expect(poiWalks(byId.get('view-ehrenhof')!)).toBe(true);
    expect(poiWalks(byId.get('view-west')!)).toBe(false);
    expect(poiWalks(byId.get('view-karlslust')!)).toBe(false);
  });
});

describe('zone pose ↔ local camera', () => {
  const poses: ZonePose[] = [
    { E: 382226.25, N: 5466120.5, h: 352.4, heading_deg: 80.5, pitch_deg: -12, mode: 'fliegen' },
    { E: 381900.004, N: 5465800.996, h: 346.1, heading_deg: 359.99, pitch_deg: 0, mode: 'gehen' },
    { E: 383500, N: 5464900, h: 420, heading_deg: 0, pitch_deg: 45, mode: 'fliegen' },
    { E: 382000, N: 5466000, h: 400, heading_deg: 190.25, pitch_deg: -89, mode: 'fliegen' },
  ];
  it('round-trips within 1 mm and 0.01°', () => {
    for (const p of poses) {
      const l = zonePoseToLocal(p);
      expect(l.walk).toBe(p.mode === 'gehen');
      expect(l.x).toBeCloseTo(p.E - E0, 6);
      expect(l.z).toBeCloseTo(-(p.N - N0), 6);
      const q = localToZonePose(l, l.yaw, l.pitch, l.walk);
      expect(Math.abs(q.E - p.E)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(q.N - p.N)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(q.h - p.h)).toBeLessThanOrEqual(0.001);
      const dh = (((q.heading_deg - p.heading_deg) % 360) + 540) % 360 - 180;
      expect(Math.abs(dh)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(q.pitch_deg - p.pitch_deg)).toBeLessThanOrEqual(0.01);
      expect(q.mode).toBe(p.mode);
    }
  });
  it('heading 0 looks grid north (−z), 90 east (+x)', () => {
    const n = zonePoseToLocal({ ...poses[0], heading_deg: 0, pitch_deg: 0 });
    expect(-Math.sin(n.yaw)).toBeCloseTo(0, 9);
    expect(-Math.cos(n.yaw)).toBeCloseTo(-1, 9);
    const e = zonePoseToLocal({ ...poses[0], heading_deg: 90, pitch_deg: 0 });
    expect(-Math.sin(e.yaw)).toBeCloseTo(1, 9);
  });
});

describe('castle quality (ADR 0020: shadows and clouds in the preset)', () => {
  it('maps the explorer levels', () => {
    const desk = { coarsePointer: false, dpr: 2 };
    const phone = { coarsePointer: true, dpr: 3 };
    expect(castleQuality('hoch', phone)).toBe('hoch');
    expect(castleQuality('mittel', desk)).toBe('mittel');
    expect(castleQuality('niedrig', desk)).toBe('mobil');
    expect(castleQuality('mobil', desk)).toBe('mobil');
    expect(castleQuality('auto', desk)).toBe('mittel');
    expect(castleQuality('auto', phone)).toBe('mobil');
    expect(isZoneQuality('auto')).toBe(true);
    expect(isZoneQuality('ultra')).toBe(false);
  });
  it('carries shadows and clouds per preset', () => {
    for (const q of Object.values(QUALITY)) expect(q.shadows).toBe(true);
    expect(QUALITY.hoch.clouds).toBe('air');
    expect(QUALITY.mobil.clouds).toBe('off');
  });
});

describe('Gewissheit select', () => {
  it('maps each option to the display state and back', () => {
    for (const { value } of GEWISSHEIT_OPTIONS) {
      expect(isGewissheit(value)).toBe(true);
      expect(gewissheitOf(gewissheit(value))).toBe(value);
    }
    expect(gewissheit('aus')).toEqual({ confidenceColours: false, lowConfidence: 'show' });
    expect(gewissheit('farben').confidenceColours).toBe(true);
    expect(gewissheit('ausblenden').lowConfidence).toBe('hide');
    expect(gewissheitOf({ confidenceColours: true, lowConfidence: 'hide' })).toBe('farben');
    expect(isGewissheit('bunt')).toBe(false);
  });
});

describe('shared CHM trees (zone preset trees: "shared")', () => {
  // 10 × 10 class grid, 10 m cells, NW corner at E 382000 / N 5466000: west half forest, east half field
  const grid = { west: 382000, north: 5466000, east: 382100, south: 5465900 };
  const g = { cols: 10, rows: 10, cell: 10 };
  const ground = new Uint8Array(100).map((_, i) => (i % 10 < 5 ? GROUND_CLASS.forest : GROUND_CLASS.field));
  const classAt = groundClassLookup(ground, g, grid);
  const footprint: [number, number][] = [
    [382000, 5466000],
    [382020, 5466000],
    [382020, 5465980],
    [382000, 5465980],
  ];
  const tree = (id: number, E: number, N: number, h = 20): ZoneSharedTree => ({ id, E, N, g: 340, h, r: 4, type: 'broadleaf', fill: false });

  it('looks up the class grid by cell (north-up rows)', () => {
    expect(classAt(382005 - E0, -(5465995 - N0))).toBe(GROUND_CLASS.forest);
    expect(classAt(382095 - E0, -(5465905 - N0))).toBe(GROUND_CLASS.field);
    expect(classAt(381995 - E0, -(5465995 - N0))).toBe(-1);
    expect(classAt(382005 - E0, -(5466005 - N0))).toBe(-1);
    // row 9 (south), column 2 → index 92
    const g2 = new Uint8Array(100);
    g2[92] = 7;
    expect(groundClassLookup(g2, g, grid)(382025 - E0, -(5465905 - N0))).toBe(7);
  });

  it('drops trees inside the footprint, off 1789 forest or invalid; keeps the rest in the local frame', () => {
    const trees = [tree(1, 382010, 5465990), tree(2, 382030, 5465950), tree(3, 382080, 5465950), tree(4, 382030, 5465950, 0), tree(5, NaN, 5465950)];
    const sel = selectSharedTrees(trees, { footprintLocal: [footprintToLocal(footprint)], groundClassAt: classAt });
    expect(sel.map((t) => t.id)).toEqual([2]);
    expect(sel[0].x).toBeCloseTo(382030 - E0, 9);
    expect(sel[0].z).toBeCloseTo(-(5465950 - N0), 9);
    expect(sel[0].h).toBe(20);
  });

  it('picks a deterministic 1789 species per id with the mix shares, and clamps the scale', () => {
    const allowed = new Set(DEFAULT_FOREST_MIX.map((m) => m.species));
    const counts = new Map<string, number>();
    for (let id = 0; id < 4000; id++) {
      const s = sharedSpecies(id);
      expect(allowed.has(s)).toBe(true);
      expect(sharedSpecies(id)).toBe(s);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    for (const m of DEFAULT_FOREST_MIX) expect(Math.abs((counts.get(m.species) ?? 0) / 4000 - m.share)).toBeLessThan(0.04);
    expect(sharedScale('fagus', 1)).toBe(0.35);
    expect(sharedScale('fagus', 100)).toBe(1.6);
    expect(sharedScale('fagus', 24)).toBeCloseTo(1, 9);
    expect(treeBbox(grid)).toEqual([
      [382000, 5465900],
      [382100, 5466000],
    ]);
  });
});

describe('HUD letterbox', () => {
  it('is a 2.2:1 frame, at most 12 % of a portrait height', () => {
    expect(letterboxBar(2200, 1200)).toBeCloseTo(100, 6);
    expect(letterboxBar(390, 844)).toBeLessThanOrEqual(0.12 * 844 + 1e-9);
    expect(letterboxBar(3000, 1000)).toBe(0);
  });
});

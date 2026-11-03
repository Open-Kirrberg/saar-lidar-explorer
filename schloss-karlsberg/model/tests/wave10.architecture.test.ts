// Wave 10 (architecture): mixed dressed sandstone (audit #3), the glazed garden door of the Corps de logis (audit #8),
// and the procedural canvases (audit #4). The Tempelzimmer collar is tested in rotunda.exterior.test.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { isPlaced } from '../src/spec.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { PLINTH_DAMP, RETAINING_ASHLAR, STONE_MIX, STONE_HUES, plinthDamp, stoneMixTints } from '../src/exterior/shade.ts';
import { buildInterior, createFallbackMaterials } from '../src/interior/index.ts';
import { ROTUNDA, STATE_ROOM } from '../src/layout/grammar.ts';
import { MATERIAL_BASE } from '../src/materials/index.ts';
import { CANVAS_KINDS, canvasParams } from '../src/interior/painting.ts';
import { isMixedAshlar } from '../src/materials/ashlar.ts';
import { validateSite } from '../src/validate.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);

const lin = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const Y = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('wave 10: mixed dressed sandstone (audit #3)', () => {
  const base = STONE_HUES.red;
  const b = lin(base);
  const t = stoneMixTints(base);

  it('the stone shares add up to one and the plinth red is drawn mixed', () => {
    const s = STONE_MIX.shares;
    expect(s.red + s.yellowGrey + s.greyWhite).toBeCloseTo(1, 9);
    // the red stays the largest share (D KB-B02); the review mixed in more pale blocks, so it no longer is a majority
    expect(s.red).toBeGreaterThan(s.yellowGrey);
    expect(s.red).toBeGreaterThan(s.greyWhite);
    expect(isMixedAshlar(base)).toBe(true);
    expect(isMixedAshlar(base.toLowerCase())).toBe(true);
    expect(isMixedAshlar('#CFC8BA')).toBe(false);
    expect(isMixedAshlar(undefined)).toBe(false);
  });

  it('pale blocks stay warm (R > G > B: neither mauve nor olive) and lie between the red and their stone in value', () => {
    for (const [stone, m] of [
      [STONE_HUES.yellowGrey, t.yellowGrey],
      [STONE_MIX.greyWhite, t.greyWhite],
    ] as const) {
      const c = b.map((v, i) => v * m[i]);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
      // red clearly leads green, so the block does not read khaki/olive in blue shade
      expect(c[0] / c[1]).toBeGreaterThan(1.3);
      const yc = Y(c);
      expect(yc).toBeGreaterThan(Y(b));
      expect(yc).toBeLessThan(Y(lin(stone)));
    }
  });

  it('the plinth foot is damp-darkened at grade and clean after the fade height', () => {
    const z = { grade: 340, plinthTop: 341.2 } as unknown as Parameters<typeof plinthDamp>[1];
    expect(plinthDamp(340, z)).toBeCloseTo(PLINTH_DAMP.albedo, 9);
    expect(plinthDamp(339, z)).toBeCloseTo(PLINTH_DAMP.albedo, 9);
    expect(plinthDamp(340 + PLINTH_DAMP.fade, z)).toBeCloseTo(1, 9);
    expect(plinthDamp(345, z)).toBe(1);
    expect(plinthDamp(340.1, z)).toBeLessThan(plinthDamp(340.3, z));
  });
});

describe('wave 10: glazed garden door of the Corps de logis (audit #8)', () => {
  it('the CdL garden door is a glazed door of window width with its head on the window line', () => {
    const L = layout(spec.buildings.find((b) => b.id === 'KB-B01')!);
    const door = L.openings.find((o) => o.side === 'garden' && o.kind === 'door' && o.glazed);
    expect(door).toBeDefined();
    const win = L.openings.filter((o) => o.side === 'garden' && o.kind === 'window' && o.storey === door!.storey);
    expect(win.length).toBeGreaterThan(0);
    const w0 = win.sort((a, c) => Math.abs(a.a - door!.a) - Math.abs(c.a - door!.a))[0];
    expect(Math.abs(door!.width - w0.width)).toBeLessThan(0.15);
    expect(Math.abs(door!.top_h - w0.top_h)).toBeLessThan(0.1);
    // no other building carries the flag by accident
    for (const b of spec.buildings) if (b.id !== 'KB-B01' && isPlaced(b)) for (const o of layout(b).openings) expect(o.glazed ?? false).toBe(false);
  });

  it('the validator accepts glazed only as a boolean on a door entry', () => {
    const bad = structuredClone(raw);
    const b = bad.buildings.find((x: { id: string }) => x.id === 'KB-B01');
    const portals = b.facade.portals as { kind: string; glazed?: unknown }[];
    const i = portals.findIndex((p) => p.glazed === true);
    expect(i).toBeGreaterThanOrEqual(0);
    portals[i].glazed = 'ja';
    expect(validateSite(bad, 'v2').errors.some((e) => e.path.endsWith(`.facade.portals[${i}].glazed`))).toBe(true);
    const bad2 = structuredClone(raw);
    const p2 = (bad2.buildings.find((x: { id: string }) => x.id === 'KB-B01').facade.portals as { kind: string; glazed?: unknown }[]).find((p) => p.kind !== 'door')!;
    p2.glazed = true;
    expect(validateSite(bad2, 'v2').ok).toBe(false);
    expect(validateSite(raw, 'v2').errors).toEqual([]);
  });
});

describe('wave 10: procedural canvases (audit #4)', () => {
  it('canvasParams encodes the atlas tile + 1, the signed tile aspect and the canvas size (more in painting.test.ts)', () => {
    CANVAS_KINDS.forEach((k, i) => {
      const p = canvasParams(k, i, false, 1.2, 0.9);
      expect(p[0]).toBe(i + 1);
      expect(p[1]).toBeGreaterThan(0);
      expect(p.slice(2)).toEqual([1.2, 0.9]);
    });
  });
});

describe('wave 10 review fixes (architecture)', () => {
  it('retaining walls: coarser courses and a pale coping slab that overhangs the face', () => {
    expect(RETAINING_ASHLAR.courseScale).toBeGreaterThan(1);
    const c = RETAINING_ASHLAR.coping;
    expect(c.height).toBeGreaterThan(0.15);
    expect(c.overhang).toBeGreaterThan(0.03);
    expect(Y(lin(c.colour))).toBeGreaterThan(Y(lin(RETAINING_ASHLAR.colour)));
  });

  it('Tempelzimmer: the lead dome alternates two gore shades and stands on a pale stone base', () => {
    const [a, b] = ROTUNDA.leadGores.map((h) => Y(lin(h)));
    expect(Math.abs(a - b)).toBeGreaterThan(0.02);
    expect(Y(lin(ROTUNDA.leadSeam))).toBeGreaterThan(Math.max(a, b));
    expect(Y(lin(ROTUNDA.baseStone))).toBeGreaterThan(Y(lin(STONE_HUES.red)));
    expect(ROTUNDA.orders.ionic.taper).toBeCloseTo(5 / 6, 9);
  });

  it('panelled embrasures: the reveal boiserie is darker than the room and the deep state-room windows are panelled', () => {
    expect(Y(lin(STATE_ROOM.reveal.colour))).toBeLessThan(Y(lin(MATERIAL_BASE['wall.boiserie'].color)));
    expect(STATE_ROOM.coveReach).toBeGreaterThan(0.09);
    const b = spec.buildings.find((x) => x.id === 'KB-B01')!;
    const ctx: BuildContext = { spec, lod: 2, materials: createFallbackMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout };
    const g = buildInterior(b, ctx);
    let panelled = 0;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /Laibung \(Felder\)/.test(String(o.userData.name_de))) panelled++;
    });
    expect(panelled).toBeGreaterThan(3);
  });
});

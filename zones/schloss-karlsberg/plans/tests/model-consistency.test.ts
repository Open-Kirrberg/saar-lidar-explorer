/**
 * Plans vs. 3D model: the plan geometry helpers read the same layout as the generator.
 * These tests pin the shared pieces (raised roofs, roof heights, stairs, trees, sections) and
 * smoke-render every sheet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../../model/src/layout/geom.ts';
import { raisedRoofs } from '../../model/src/layout/raised.ts';
import { loadSite, makeLayoutFn } from '../../model/src/index.ts';
import { buildingRoof, roofLevelSet } from '../src/geom/roof3d.ts';
import { stairPlans } from '../src/geom/stairs.ts';
import { builtAvenueTrees, treeBlockers } from '../src/geom/trees.ts';
import { sheetList } from '../src/index.ts';
import { sectionDefs, sectionLineEN } from '../src/sections.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const { spec } = loadSite(JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')));
const layoutOf = makeLayoutFn(spec);
const B01 = spec.buildings.find((b) => b.id === 'KB-B01')!;
const L01 = layoutOf(B01);

describe('raised roofs (model/src/layout/raised.ts)', () => {
  it('the Corps de logis has one raised centre pavilion with a lantern above its ridge', () => {
    const rr = raisedRoofs(L01);
    expect(rr.length).toBe(1);
    expect(rr[0].section.ridge_h).toBeGreaterThan(L01.roof.ridge_h);
    expect(Math.abs(rr[0].sMid)).toBeLessThan(L01.frame.length / 2);
    expect(rr[0].length).toBeLessThan(L01.frame.length);
    expect(rr[0].turret).toBeDefined();
    expect(rr[0].turret!.top_h).toBeGreaterThan(rr[0].section.ridge_h);
  });
});

describe('roof solids', () => {
  const roof = buildingRoof(L01);
  it('heightAt is the union (max) of the main roof and the raised pavilion', () => {
    const raised = roof.raised[0];
    const mid = raised.rr.sMid;
    expect(roof.heightAt(mid, 0)).toBeCloseTo(raised.rr.section.ridge_h, 2);
    // outside the raised range: main roof, never below the eaves inside the footprint
    const sOut = L01.frame.length / 2 - 3;
    expect(roof.heightAt(sOut, 0)).toBeLessThanOrEqual(L01.roof.ridge_h + 1e-6);
    expect(roof.heightAt(sOut, 0)).toBeGreaterThan(L01.stack.eaves_h);
    // at the ends of the raised range the main roof still carries (no valley down to the eaves)
    expect(roof.heightAt(raised.solid.s0 + 0.05, 0)).toBeGreaterThan(L01.roof.break_h ?? L01.stack.eaves_h);
  });

  it('the level set at the eaves covers the whole main roof rectangle', () => {
    const ls = roofLevelSet(roof.main, L01.roof, L01.frame.length, 0, L01.stack.eaves_h + 1e-6);
    let a = 0;
    for (let i = 0; i < ls.length; i++) a += ls[i][0] * ls[(i + 1) % ls.length][1] - ls[(i + 1) % ls.length][0] * ls[i][1];
    expect(Math.abs(a / 2)).toBeGreaterThan(0.97 * L01.frame.length * L01.roof.depth);
  });
});

describe('stairs adapter', () => {
  it('every planned stair climbs exactly from storey_from to storey_to', () => {
    for (const b of spec.buildings) {
      if (!b.stairs?.length || b.base_h === null) continue;
      const L = layoutOf(b);
      for (const st of b.stairs) {
        const p = stairPlans(b, L).get(st.id)!;
        const rise = L.stack.levels[st.storey_to].floor_h - L.stack.levels[st.storey_from].floor_h;
        expect(p.risers * p.riser).toBeCloseTo(rise, 3);
      }
    }
  });
});

describe('avenue trees as built in 3D', () => {
  it('no tree stands in a court, terrace, parterre or building', () => {
    const blockers = treeBlockers(spec);
    let n = 0;
    for (const f of spec.terrain_features) {
      for (const t of builtAvenueTrees(spec, f)) {
        n++;
        expect(blockers.some((r) => pointInPolygon([t.E, t.N], r))).toBe(false);
      }
    }
    expect(n).toBeGreaterThan(50);
  });
});

describe('section definitions', () => {
  it('cut lines are perpendicular to the viewing direction and pass through the Corps de logis', () => {
    for (const d of sectionDefs(spec)) {
      const [a, b] = sectionLineEN(L01, d, -5, 5);
      const dir = [b[0] - a[0], b[1] - a[1]];
      const look = [Math.sin((d.lookAz * Math.PI) / 180), Math.cos((d.lookAz * Math.PI) / 180)];
      expect(Math.abs(dir[0] * look[0] + dir[1] * look[1]) / Math.hypot(dir[0], dir[1])).toBeLessThan(1e-3);
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      expect(pointInPolygon(mid, L01.ring)).toBe(true);
    }
  });
});

describe('sheets', () => {
  const sheets = sheetList(spec);
  it('lists Lagepläne, Grundrisse, Ansichten and Schnitte with unique files', () => {
    const ids = sheets.map((s) => s.id);
    for (const p of ['LP-', 'GR-', 'AN-', 'SC-']) expect(ids.some((x) => x.startsWith(p))).toBe(true);
    expect(new Set(sheets.map((s) => s.file)).size).toBe(sheets.length);
  });

  it('every sheet renders a complete SVG without NaN and with title block and hypothesis note', { timeout: 60000 }, () => {
    for (const s of sheets) {
      const svg = s.build().toSVG().replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, 'data:');
      expect(svg.startsWith('<?xml')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).toContain('Schloss Karlsberg um 1789');
      expect(svg).toContain('HYPOTHESE');
    }
  });
});

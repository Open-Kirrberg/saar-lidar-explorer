// KB-I25: room programme moves after research/10 (§0.4, §0.5, §b.1; history-check H05-H08)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { interiorModel } from '../src/interior/model.ts';
import { classifyRoom } from '../src/interior/programme.ts';
import { functionIssues } from '../../scripts/catalogue-v2/checks.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const B = (id: string) => spec.buildings.find((b) => b.id === id)!;
const rooms = (id: string, storey: number) => (B(id).rooms ?? []).filter((r) => r.storey === storey);
const named = (id: string, storey: number, re: RegExp) => rooms(id, storey).filter((r) => re.test(r.name_de));
const len = (r: { polygon: [number, number][] }) => Math.max(...r.polygon.map((p) => p[0])) - Math.min(...r.polygon.map((p) => p[0]));

describe('KB-I25 room programme', () => {
  it('B02 S wing: EG guest apartments, vestibule + stair, Durchfahrt; no silver chamber or dining room; OG Pfalzgraf apartment', () => {
    expect(named('KB-B02', 1, /silber|speisesaal|anrichte/i)).toHaveLength(0);
    expect(named('KB-B02', 1, /Gästeappartement/).length).toBeGreaterThanOrEqual(6);
    expect(named('KB-B02', 1, /Vestibül/)).toHaveLength(1);
    expect(named('KB-B02', 1, /Durchfahrt/)).toHaveLength(1);
    expect(named('KB-B02', 2, /Pfalzgraf/).length).toBeGreaterThanOrEqual(3);
    expect(named('KB-B02', 2, /Herzogin/).length).toBeGreaterThanOrEqual(4);
  });

  it('B03 N wing: OG großer + kleiner Bildersaal, Tanzsaal, Salon Mannlich; EG Silberkammer', () => {
    expect(named('KB-B03', 2, /Großer Bildersaal|Kleiner Bildersaal/)).toHaveLength(2);
    expect(named('KB-B03', 2, /Tanzsaal/)).toHaveLength(1);
    expect(named('KB-B03', 2, /Salon Mannlich/)).toHaveLength(1);
    expect(named('KB-B03', 1, /Silberkammer/)).toHaveLength(1);
    expect(classifyRoom({ id: 'B03.2.og-grosser-bildersaal', name_de: 'Großer Bildersaal' })).toBe('gallery');
    expect(classifyRoom({ id: 'B03.2.og-tanzsaal', name_de: 'Tanzsaal' })).toBe('festsaal');
  });

  it('B04: EG four library rooms in a row (≥ 30 m) with the Wachtstube; OG Naturalienkabinett + Waffensammlung', () => {
    const lib = named('KB-B04', 1, /Hofbibliothek/);
    expect(lib).toHaveLength(4);
    expect(lib.reduce((a, r) => a + len(r), 0)).toBeGreaterThan(30);
    expect(named('KB-B04', 1, /Wachtstube/)).toHaveLength(1);
    expect(named('KB-B04', 1, /Waffen|Büchsenmacher/)).toHaveLength(0);
    expect(named('KB-B04', 2, /Naturalienkabinett/)).toHaveLength(1);
    expect(named('KB-B04', 2, /Waffensammlung/)).toHaveLength(1);
    for (const r of lib) expect(classifyRoom(r)).toBe('library');
  });

  it('B05 kitchen wing OG: Großer Speisesaal with two niche stoves (no fireplace)', () => {
    const b = B('KB-B05');
    const hall = named('KB-B05', 2, /Großer Speisesaal/);
    expect(hall).toHaveLength(1);
    const m = interiorModel(b, layoutBuilding(b, spec));
    const rm = m.rooms.find((r) => r.room.id === hall[0].id)!;
    expect(rm.type).toBe('dining');
    const stoves = rm.items.filter((i) => i.kind === 'altar_stove');
    expect(stoves).toHaveLength(2);
    expect(stoves.every((s) => /T1 p\. 341/.test(s.tag) && /T26/.test(s.tag))).toBe(true);
    expect(rm.items.some((i) => i.kind === 'fireplace' || i.kind === 'stove')).toBe(false);
    // the two stoves stand apart (two niches, not one)
    const [a, c] = stoves.map((s) => s.pos);
    expect(Math.hypot(a[0] - c[0], a[1] - c[1])).toBeGreaterThan(2);
  });

  it('B05 Speisesaal stoves (fix wave 4): two round-headed 0.4 m niches, symmetric on one blind outer wall', () => {
    const b = B('KB-B05');
    const m = interiorModel(b, layoutBuilding(b, spec));
    const rm = m.rooms.find((r) => /Großer Speisesaal/.test(r.room.name_de))!;
    const walls = rm.walls.filter((w) => w.niches?.length);
    expect(walls).toHaveLength(1);
    const w = walls[0];
    expect(w.exterior).toBe(true);
    expect(w.windows).toBe(0);
    const ns = w.niches!;
    expect(ns).toHaveLength(2);
    for (const n of ns) {
      expect(n.depth).toBeCloseTo(0.4, 6);
      expect(n.head).toBe('round');
      expect(n.v1).toBeLessThan(rm.ceiling_h - rm.floor_h - 0.5);
      // no door or window in the niche
      expect(w.hits.some((h) => h.hole.u1 > n.u0 && h.hole.u0 < n.u1)).toBe(false);
    }
    // symmetric about the middle of the wall
    expect(ns[0].u0 + ns[1].u1).toBeCloseTo(w.len, 6);
    // each stove stands in its niche: centre within the niche span, back inside the wall
    for (const s of rm.items.filter((i) => i.kind === 'altar_stove')) {
      const u = (s.pos[0] - w.p0[0]) * w.d[0] + (s.pos[1] - w.p0[1]) * w.d[1];
      const off = (s.pos[0] - w.p0[0]) * w.nIn[0] + (s.pos[1] - w.p0[1]) * w.nIn[1];
      expect(ns.some((n) => u > n.u0 && u < n.u1)).toBe(true);
      expect(off - s.size![1] / 2).toBeLessThan(0);
      expect(off - (s.size![1] + 0.1) / 2).toBeGreaterThan(-0.4);
    }
  });

  it('B05 OG (fix wave 4): the vestibule adjoins both the dining hall and the Küchenbautreppe', () => {
    const b = B('KB-B05');
    const vest = named('KB-B05', 2, /Vestibül/)[0];
    const doors = (b.openings ?? []).filter((o) => o.storey === 2 && o.wall.kind === 'segment' && o.wall.rooms?.includes(vest.id));
    const others = doors.flatMap((o) => (o.wall.kind === 'segment' ? (o.wall.rooms ?? []) : [])).filter((r) => r !== vest.id);
    expect(others.some((r) => /speisesaal/.test(r))).toBe(true);
    expect(others.some((r) => /treppe/.test(r))).toBe(true);
  });
});

describe('fix wave 4: building texts follow the room programme (checks.ts functionIssues)', () => {
  it('the four wings have no function / storey-name term without a room', () => {
    for (const id of ['KB-B02', 'KB-B03', 'KB-B04', 'KB-B05']) expect(functionIssues(B(id))).toEqual([]);
  });

  it('the pre-fix texts would have been caught', () => {
    const old = (id: string, fn: string, upper?: string) => {
      const b = structuredClone(B(id));
      b.function = fn;
      if (upper) b.storeys[2].name = upper;
      return functionIssues(b).map((i) => i.message);
    };
    expect(old('KB-B04', 'collections: armoury and gunsmith on the EG, library, natural-history and physics cabinets on the OG').length).toBeGreaterThanOrEqual(2);
    expect(old('KB-B02', "Duchess's apartment on the OG; EG: dining rooms, buffet, silver chamber").length).toBe(3);
    expect(old('KB-B05', 'court kitchen', 'Obergeschoss (Wohnungen der Küchenbediensteten, Speisesaal)')).toEqual([]);
    expect(old('KB-B03', 'EG: dining room')).toHaveLength(1);
    // the old B05 text: cooks' lodgings on the OG are a Mundkoch room there, so only the OG check matters
    expect(old('KB-B05', "court kitchen; cooks' lodgings on the OG")).toEqual([]);
  });

  it('pinned wing texts name the moved rooms', () => {
    expect(B('KB-B03').function).toMatch(/Bildersaal.*Tanzsaal.*EG: Silberkammer/);
    expect(B('KB-B04').function).toMatch(/EG: the Hofbibliothek.*OG: Naturalienkabinett with the Waffensammlung/);
    expect(B('KB-B05').storeys[2].name).toBe('Obergeschoss (Großer Speisesaal)');
    expect(B('KB-B02').function).not.toMatch(/silver|dining|buffet/i);
  });
});

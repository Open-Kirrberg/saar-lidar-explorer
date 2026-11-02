import { describe, expect, it } from 'vitest';
import { checkProgramme, footprintOverlaps } from '../../scripts/catalogue-v2/checks.ts';
import { buildV2, REMOVED_V1 } from '../../scripts/catalogue-v2/pipeline.ts';
import { PROGRAMMES } from '../../scripts/catalogue-v2/programme.ts';
import { loadSite } from '../src/catalogue.ts';
import { layoutBuilding } from '../src/layout/building.ts';
import { isPlaced, parseEvidenceTags } from '../src/spec.ts';
import { validateSite } from '../src/validate.ts';
import { readCatalogue, readCatalogueV1 } from './helpers.ts';

const DETAILED = ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B10'];

describe('catalogue v2 (model/catalogue.json)', () => {
  it('is version 2 and valid in strict v2 mode without warnings', () => {
    const raw = readCatalogue();
    expect(raw.version).toBe(2);
    const r = validateSite(raw, 'v2');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(() => loadSite(raw)).not.toThrow();
  });

  it('is reproduced exactly by scripts/catalogue-v2 (build is deterministic)', () => {
    expect(JSON.parse(JSON.stringify(buildV2().spec))).toEqual(readCatalogue());
  });

  it('keeps every v1 id or records where it went', () => {
    const v2 = new Set(readCatalogue().buildings.map((b) => b.id));
    for (const b of readCatalogueV1().buildings) expect(v2.has(b.id) || b.id in REMOVED_V1, b.id).toBe(true);
    for (const id of Object.keys(REMOVED_V1)) expect(v2.has(id)).toBe(false);
  });

  it('every placed building lays out and carries confidence, placement and evidence', () => {
    const { spec } = loadSite(readCatalogue());
    for (const b of spec.buildings) {
      expect(['high', 'med', 'low']).toContain(b.confidence);
      if (!isPlaced(b)) continue;
      expect(() => layoutBuilding(b, spec), b.id).not.toThrow();
      expect(b.ground_dtm, `${b.id} ground_dtm`).not.toBeNull();
      expect(b.sources?.length ?? 0, `${b.id} sources`).toBeGreaterThan(0);
    }
  });

  it('room programmes: detailed buildings have rooms on every walkable storey with evidence tags', () => {
    const { spec } = loadSite(readCatalogue());
    expect(PROGRAMMES.map((p) => p.id).sort()).toEqual([...DETAILED].sort());
    for (const id of DETAILED) {
      const b = spec.buildings.find((x) => x.id === id)!;
      const lay = layoutBuilding(b, spec);
      expect(b.interior).toBe('detailed');
      const withRooms = new Set(b.rooms!.map((r) => r.storey));
      for (const f of lay.stack.floors) expect(withRooms.has(f.index), `${id} storey ${f.index}`).toBe(true);
      for (const r of b.rooms!) expect(parseEvidenceTags(r.tag).length, `${r.id} tag`).toBeGreaterThan(0);
      for (const o of b.openings!) expect(parseEvidenceTags(o.tag).length, `${o.id} tag`).toBeGreaterThan(0);
    }
  });

  it('no interior wall meets a window and every window lights a room', () => {
    const { spec } = loadSite(readCatalogue());
    const issues = DETAILED.flatMap((id) => checkProgramme(spec, spec.buildings.find((b) => b.id === id)!));
    expect(issues).toEqual([]);
  });

  it('the checker catches a partition moved onto a window', () => {
    const { spec } = loadSite(readCatalogue());
    const b = spec.buildings.find((x) => x.id === 'KB-B01')!;
    const r = b.rooms!.find((x) => x.id === 'B01.1.eg-kabinett')!;
    // move the Kabinett / Schlafzimmer partition onto garden axis 2 (s = -13.25)
    r.polygon = r.polygon.map(([s, t]) => [s > -15 ? -13.25 : s, t]);
    expect(checkProgramme(spec, b).some((i) => /meets an interior wall/.test(i.message))).toBe(true);
  });

  it('the CdL has an imperial Prunktreppe that obeys Blondel and fits its hall', () => {
    const b = readCatalogue().buildings.find((x) => x.id === 'KB-B01')!;
    const st = b.stairs!.find((s) => s.kind === 'imperial')!;
    expect(st.storey_from).toBe(1);
    expect(st.storey_to).toBe(2);
    expect(2 * st.riser! + st.tread!).toBeCloseTo(0.65, 2);
    const ss = st.polygon.map((p) => p[0]);
    // 38 risers: central flight + landing + return flights within the 13 m hall
    expect(Math.max(...ss) - Math.min(...ss)).toBeGreaterThan(19 * st.tread! + 3.6);
  });

  it('one continuous cornice: all palace wings share eaves 356.0 and the floor levels', () => {
    const { spec } = loadSite(readCatalogue());
    for (const id of ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05']) {
      const lay = layoutBuilding(spec.buildings.find((b) => b.id === id)!, spec);
      expect(lay.stack.eaves_h, id).toBeCloseTo(356.0, 6);
      expect(lay.stack.floors.map((f) => +f.floor_h.toFixed(2)), id).toEqual([346.2, 351.4]);
    }
  });

  it('no footprint overlaps between buildings', () => {
    expect(footprintOverlaps(readCatalogue())).toEqual([]);
  });

  it('terrain: cascade re-identified, avenues with species and 1789 heights, ponds with water levels', () => {
    const tf = new Map(readCatalogue().terrain_features.map((t) => [t.id, t]));
    const c = tf.get('TF-30')!;
    expect(c.lidar_ids).toContain('KL-08');
    expect(c.top! - c.foot!).toBeCloseTo(c.steps!.count * c.steps!.riser_m, 0);
    for (const id of ['TF-10', 'TF-11', 'TF-14']) expect(tf.get(id)!.trees!.height).toBeGreaterThan(0);
    for (const t of tf.values()) if (t.kind === 'pond') expect(typeof t.water_level).toBe('number');
    for (const id of ['TF-01', 'TF-02']) expect(tf.get(id)!.surface).toBeTruthy();
    expect(tf.get('TF-03')!.wall_height).toBeGreaterThan(0);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gridFrame } from '../src/frame.ts';
import { pointInPolygon, signedArea, openRing } from '../src/layout/geom.ts';
import type { EN, SiteSpec } from '../src/spec.ts';
import { LANDCOVER_COVERS, landcoverAreas, organic, type LandcoverArea } from '../../scripts/catalogue-v2/landcover.ts';

const cat = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')) as SiteSpec & { landcover: LandcoverArea[] };
const grid = gridFrame(cat.palace_grid);
const areas = landcoverAreas(grid);
const at = (p: EN) => {
  // the cover a point gets: last area in paint order that contains it (min_slope areas skipped: terrain-dependent)
  let cover: string = 'meadow';
  for (const a of areas) if (!a.min_slope && pointInPolygon(p, openRing(a.geometry.coordinates[0]))) cover = a.cover;
  return cover;
};
const centre = (id: string): EN => {
  const b = cat.buildings.find((x) => x.id === id)!;
  const r = openRing(b.footprint!);
  return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
};

describe('1789 land cover (KB-I09, research/11 S1)', () => {
  it('is in the catalogue as built (top-level landcover)', () => {
    expect(JSON.parse(JSON.stringify(areas))).toEqual(cat.landcover);
  });

  it('has unique ids, known covers, tags with evidence letters, closed CCW rings and mixes summing to 1', () => {
    expect(new Set(areas.map((a) => a.id)).size).toBe(areas.length);
    for (const a of areas) {
      expect(LANDCOVER_COVERS).toContain(a.cover);
      expect(a.tag).toMatch(/(^|[^A-Za-z])(D->|D|I|N|U|HMS)([^A-Za-z]|$)/);
      expect(['high', 'med', 'low']).toContain(a.confidence);
      const r = a.geometry.coordinates[0];
      expect(r[0]).toEqual(r[r.length - 1]);
      expect(signedArea(openRing(r))).toBeGreaterThan(0);
      if (a.mix) expect(a.mix.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 9);
    }
  });

  it('opens the ridge: lawn behind the palace, hay on the W slopes, forest only in belts and on the E plateau', () => {
    expect(at(grid.toEN(200, 0))).toBe('lawn'); // Herzogsgarten (Petri)
    expect(at(grid.toEN(250, 200))).toBe('forest'); // N belt
    expect(at(grid.toEN(240, -165))).toBe('forest'); // S belt
    expect(at(grid.toEN(325, -148))).toBe('meadow'); // wave 5: clearing of the Herzogskastanien grove (LC-31) in it
    expect(at([383100, 5466300])).toBe('forest'); // E plateau toward the Lambsbach
    expect(at([381950, 5466300])).toBe('hay'); // W slope below the service row
    expect(at([382000, 5466010])).toBe('vineyard'); // LP06 30
    expect(at(centre('KB-B27'))).toBe('kitchen_garden'); // Holländische Gärtnerei
    expect(at([382550, 5466700])).toBe('field'); // plateau N/NE of the service row
    // the palace core and the Ehrenhof are not wooded
    for (const id of ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B10', 'KB-B20']) expect(at(centre(id))).not.toBe('forest');
  });

  it('organic outlines are deterministic, keep the drawn vertices and stay within the amplitude', () => {
    const sq: EN[] = [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ];
    const a = organic(sq, 7);
    expect(organic(sq, 7)).toEqual(a);
    expect(a.length).toBeGreaterThan(16);
    for (const p of sq) expect(a).toContainEqual(p);
    for (const [x, y] of a) {
      const d = Math.min(Math.abs(x), Math.abs(x - 200), Math.abs(y), Math.abs(y - 200));
      expect(d).toBeLessThanOrEqual(14 + 1e-9);
    }
  });
});

/**
 * Fix round 1 (docs/review/review-1.md #10, #19, #20, #1): plan sheets read the same model pieces as the 3D.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite, makeLayoutFn } from '../../model/src/index.ts';
import { columnsOf, stairPlans } from '../src/geom/stairs.ts';
import { sheetList } from '../src/index.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const { spec } = loadSite(JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')));
const layoutOf = makeLayoutFn(spec);
const B01 = spec.buildings.find((b) => b.id === 'KB-B01')!;
const L01 = layoutOf(B01);
const sheets = sheetList(spec);
const svgOf = (id: string) => sheets.find((s) => s.id === id)!.build().toSVG().replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, 'data:');

describe('#19 Grundriss: Vestibül columns and stair flights above the cut', () => {
  it('columnsOf returns the 8 vestibule columns of the interior programme on the EG', () => {
    const vest = B01.rooms!.find((r) => /Vestib/.test(r.name_de))!;
    const cols = columnsOf(B01, L01, vest.storey);
    expect(cols.length).toBe(8);
  });
  it('GR-01 draws 8 cut column shafts and dashed return flights', () => {
    const svg = svgOf('GR-01');
    expect((svg.match(/<circle[^>]*class="poche-d"/g) ?? []).length).toBeGreaterThanOrEqual(8);
    const plan = [...stairPlans(B01, L01).values()].find((p) => p.flights.length >= 3)!;
    const cut = plan.h0 + 1.2;
    const overhead = plan.flights.filter((f) => f.h0 + f.riser > cut).length;
    expect(overhead).toBeGreaterThan(0);
    // one dashed outline (no fill) per overhead flight
    expect((svg.match(/class="pen-s hid" style="fill:none;"/g) ?? []).length).toBeGreaterThanOrEqual(overhead);
  });
});

describe('#20 LP-03: avenues have their own style', () => {
  it('reconstructed avenue axes are green bands, LiDAR traces blue double-dash', () => {
    const svg = svgOf('LP-03');
    expect(svg).toMatch(/stroke:#3f8a3a;stroke-opacity:\.22/);
    expect(svg).toMatch(/stroke:#1f5fa8;stroke-dasharray:2\.4 \.7 \.7 \.7/);
    expect(svg).toContain('Allee: Achse und Bäume (Rekonstruktion');
  });
});

describe('#10 / #1 Ansichten', () => {
  it('AN-01 draws the Freitreppen of portals with steps and the B02 portico', () => {
    const steps = L01.openings.filter((o) => o.steps && o.side === 'court');
    expect(steps.length).toBeGreaterThan(0);
    const svg = svgOf('AN-01');
    // CdL court portal + B02 head portico (at least 2 step groups)
    expect((svg.match(/<g class="steps">/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('AN-04 labels the Stützmauer KB-B14 as the Kellerfront of KB-B10', () => {
    expect(svgOf('AN-04')).toContain('(KB-B14) = Kellerfront');
  });
});

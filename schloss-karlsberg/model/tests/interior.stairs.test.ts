import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS } from '../src/context.ts';
import { layoutBuilding } from '../src/layout/index.ts';
import { interiorModel } from '../src/interior/model.ts';
import { MAX_RISER, flightGoing, flightRect, rampLine, riserFor, treadHeight } from '../src/interior/stairPlan.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const models = spec.buildings
  .filter((b) => b.stairs?.length && b.interior !== 'none')
  .map((b) => ({ b, m: interiorModel(b, layoutBuilding(b, spec), DEFAULT_BUILD_OPTIONS.seed) }));

describe('stair math', () => {
  it('riserFor keeps R <= target and Blondel 2R + T = 0.65', () => {
    for (const rise of [0.5, 2.6, 5.2, 4.37]) {
      const r = riserFor(rise, 0.17);
      expect(r.riser).toBeLessThanOrEqual(0.17 + 1e-9);
      expect(r.riser * r.risers).toBeCloseTo(rise, 9);
      expect(2 * r.riser + r.tread).toBeCloseTo(0.65, 9);
    }
  });

  it('the ramp collider passes through every nosing', () => {
    const f = { risers: 19, riser: 0.1368, tread: 0.376, h0: 346.2 };
    const [[x0, h0], [x1, h1]] = rampLine(f);
    expect(x1).toBeCloseTo(flightGoing(19, 0.376), 9);
    const at = (x: number) => h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
    for (let k = 1; k <= f.risers; k++) expect(at((k - 1) * f.tread)).toBeCloseTo(f.h0 + k * f.riser, 9);
    expect(treadHeight(f, -0.1)).toBe(346.2);
    expect(treadHeight(f, 0.01)).toBeCloseTo(346.2 + 0.1368, 9);
    expect(treadHeight(f, 100)).toBeCloseTo(346.2 + 19 * 0.1368, 9);
  });
});

describe('catalogue stairs', () => {
  it('every stair has risers <= 0.18 m, near-Blondel treads and climbs exactly to the upper floor', () => {
    let n = 0;
    for (const { m } of models) {
      for (const s of m.stairs) {
        n++;
        const p = s.plan;
        expect(p.riser).toBeLessThanOrEqual(MAX_RISER + 1e-9);
        expect(Math.abs(2 * p.riser + p.tread - 0.65)).toBeLessThan(0.01); // catalogue treads may round Blondel
        const total = p.flights.reduce((a, f) => a + f.risers * f.riser, 0);
        const parallel = p.kind === 'imperial' ? p.flights[1].risers * p.flights[1].riser : 0; // twin side flights count once
        expect(total - parallel).toBeCloseTo(p.h1 - p.h0, 6);
        for (const f of p.flights) expect(f.risers).toBeGreaterThanOrEqual(2);
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  it('flights stay inside a stair hall of their building', () => {
    for (const { b, m } of models) {
      const halls = b.stairs!.map((st) => {
        const ss = st.polygon.map((p) => p[0]);
        const ts = st.polygon.map((p) => p[1]);
        return { s0: Math.min(...ss) - 0.05, s1: Math.max(...ss) + 0.05, t0: Math.min(...ts) - 0.05, t1: Math.max(...ts) + 0.05 };
      });
      for (const s of m.stairs) {
        for (const f of s.plan.flights) {
          const r = flightRect(f);
          expect(halls.some((h) => r.s0 >= h.s0 && r.s1 <= h.s1 && r.t0 >= h.t0 && r.t1 <= h.t1), `${b.id} ${f.id}`).toBe(true);
        }
      }
    }
  });

  it('the Corps de logis Prunktreppe is an imperial stair that serves every door of its hall', () => {
    const cdl = models.find(({ b }) => b.id === 'KB-B01')!;
    const prunk = cdl.m.stairs.find((s) => s.prunk && /prunktreppe/.test(s.roomId))!;
    expect(prunk.plan.kind).toBe('imperial');
    expect(prunk.plan.blocked).toEqual([]);
    expect(prunk.plan.flights).toHaveLength(3);
    expect(prunk.plan.riser).toBeLessThanOrEqual(0.15);
  });

  it('no stoop climbs a whole storey (gallery doors are served by the stair landings)', () => {
    for (const { m } of models) for (const st of m.stoops) expect(st.h - st.flight.h0).toBeLessThanOrEqual(1.6);
  });
});

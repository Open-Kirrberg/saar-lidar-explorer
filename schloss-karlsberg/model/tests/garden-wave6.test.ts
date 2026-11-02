/**
 * Wave 6 garden residuals (vegetation owner): sparser cones and roses in the parterre à l'angloise, the treillage as
 * framed period joinery (square lattice, diagonal only in the frieze), the Flora herm as a tapered shaft with a rounded
 * bust, thin standard-rose stems, and flowering shrubs without limbs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { createMaterials } from '../src/materials/index.ts';
import { parterreAnglaise } from '../src/layout/garden.ts';
import { GARDEN_DETAIL } from '../src/layout/grammar.ts';
import { GeoBuilder } from '../src/exterior/builder.ts';
import { buildFurniture, buildTreillage, sparsePlantings, type GardenDetailEnv } from '../src/site/gardenDetail.ts';
import { SPECIES, crownGeometry } from '../src/site/trees.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const tf = (id: string) => spec.terrain_features.find((f) => f.id === id)!;
const GROUND = 344.06;
const ctx: BuildContext = { spec, materials: createMaterials(), terrain: () => GROUND, options: { ...DEFAULT_BUILD_OPTIONS, year: 1789 }, layout: makeLayoutFn(spec), lod: 1 };
const env = (): GardenDetailEnv => ({ gb: new GeoBuilder(), spec, ctx, terr: () => GROUND, addTree: () => {}, buildingRings: [] });
/** All triangles of the builder's buckets whose material key starts with `mat` (three frame: x = s, y = h, z = −t). */
const tris = (gb: GeoBuilder, mat: string): number[][] => {
  const out: number[][] = [];
  for (const [k, b] of gb.buckets) {
    if (!k.startsWith(mat)) continue;
    for (let i = 0; i < b.pos.length; i += 9) out.push(b.pos.slice(i, i + 9));
  }
  return out;
};

describe("parterre à l'angloise plantings (wave 6: lawn-dominant, fewer lollipops)", () => {
  const lay = parterreAnglaise({ u0: -30, u1: 36, v0: -62, v1: -37.8 }, { panels: [4, 1], crossWalk: 3 });
  const sp = sparsePlantings(lay);
  it('keeps the four corner cones and one rose per long side of each compartment', () => {
    expect(sp.cones).toHaveLength(4 * lay.compartments.length);
    expect(sp.roses).toHaveLength(2 * lay.compartments.length);
    for (const p of [...sp.cones, ...sp.roses]) expect([...lay.cones, ...lay.roses]).toContainEqual(p);
    for (const c of lay.compartments) {
      const r = c.outer;
      const mine = sp.cones.filter((p) => p[0] >= r.u0 - 1e-6 && p[0] <= r.u1 + 1e-6);
      // corners: every kept cone is at the min or max of the compartment's marks in both u and v
      const us = lay.cones.filter((p) => p[0] >= r.u0 - 1e-6 && p[0] <= r.u1 + 1e-6).map((p) => p[0]);
      const vs = lay.cones.filter((p) => p[0] >= r.u0 - 1e-6 && p[0] <= r.u1 + 1e-6).map((p) => p[1]);
      for (const p of mine) {
        expect([Math.min(...us), Math.max(...us)]).toContain(p[0]);
        expect([Math.min(...vs), Math.max(...vs)]).toContain(p[1]);
      }
      const rs = sp.roses.filter((p) => p[0] >= r.u0 - 1e-6 && p[0] <= r.u1 + 1e-6);
      // one on each long side: opposite signs across the short axis
      const longU = r.u1 - r.u0 >= r.v1 - r.v0;
      expect(new Set(rs.map((p) => (longU ? Math.sign(p[1] - (r.v0 + r.v1) / 2) : Math.sign(p[0] - (r.u0 + r.u1) / 2)))).size).toBe(2);
    }
  });
});

describe('treillage as framed period joinery (wave 6: no mesh fence)', () => {
  const T = GARDEN_DETAIL.treillage;
  const f = tf('TF-08');
  const e = env();
  buildTreillage(e, f);
  const t = tris(e.gb, 'wood.frame');
  const base = f.level ?? GROUND;
  it('draws a run of panels', () => {
    expect(t.length).toBeGreaterThan(2000);
  });
  it('diagonal laths appear only in the frieze under the top rail; the field is a square lattice', () => {
    let diag = 0;
    let square = 0;
    const frieze = base + f.fence!.height - 0.1 - T.frieze - T.frame - 0.01;
    for (const p of t) {
      // longest edge of the triangle
      let best = [0, 0, 0];
      let bl = 0;
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const d = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        if (l > bl) {
          bl = l;
          best = d;
        }
      }
      if (bl < 0.15) continue;
      const vert = Math.abs(best[1]) / bl;
      // a lath quad's long diagonal is near its axis; laths at 45° have a height share of ~0.7
      if (vert > 0.5 && vert < 0.85) {
        diag++;
        expect(Math.min(p[1], p[4], p[7])).toBeGreaterThan(frieze);
      } else square++;
    }
    expect(diag).toBeGreaterThan(0);
    expect(square).toBeGreaterThan(diag);
  });
  it('has a cornice wider than the frame along the top', () => {
    const top = base + f.fence!.height;
    const atTop = t.filter((p) => Math.min(p[1], p[4], p[7]) >= top - 1e-3 && Math.max(p[1], p[4], p[7]) <= top + 0.06);
    expect(atTop.length).toBeGreaterThan(10);
  });
});

describe('Flora herm (wave 6: tapered shaft and rounded bust instead of a stack of boxes)', () => {
  const S = GARDEN_DETAIL.sculpture;
  const f = tf('HG-41');
  const e = env();
  buildFurniture(e, f);
  const t = tris(e.gb, 'stone.yellow');
  const ys = t.flatMap((p) => [p[1], p[4], p[7]]);
  it('stands pedestal + shaft + bust high and is modelled finer than boxes', () => {
    expect(Math.max(...ys)).toBeCloseTo(GROUND + S.pedestal + S.hermShaft + S.bust, 2);
    expect(t.length).toBeGreaterThan(300);
  });
  it('the shaft widens upward (a herm tapers toward the foot)', () => {
    const it0 = f.items![0];
    const [s0, t0] = [it0.at[0] - 381000, it0.at[1] - 5465000];
    // largest distance from the herm axis where a triangle edge crosses height h
    const width = (h: number) => {
      let w = 0;
      for (const p of t)
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ]) {
          const ya = p[a * 3 + 1];
          const yb = p[b * 3 + 1];
          if ((ya - h) * (yb - h) > 0 || ya === yb) continue;
          const u = (h - ya) / (yb - ya);
          const x = p[a * 3] + (p[b * 3] - p[a * 3]) * u;
          const z = p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * u;
          w = Math.max(w, Math.hypot(x - s0, -z - t0));
        }
      return w;
    };
    const y0 = GROUND + S.pedestal;
    expect(width(y0 + 0.3)).toBeLessThan(width(y0 + S.hermShaft - 0.1));
  });
  it('the bust has smooth (non-axis) normals: a rounded form', () => {
    let smooth = 0;
    for (const [k, b] of e.gb.buckets) {
      if (!k.startsWith('stone.yellow')) continue;
      for (let i = 0; i < b.nor.length; i += 3) {
        const n = [Math.abs(b.nor[i]), Math.abs(b.nor[i + 1]), Math.abs(b.nor[i + 2])];
        if (Math.max(...n) < 0.95 && b.pos[i + 1] > GROUND + S.pedestal + S.hermShaft) smooth++;
      }
    }
    expect(smooth).toBeGreaterThan(200);
  });
});

describe('garden plants at eye level (wave 6)', () => {
  it('standard roses stand on thin grafted stems, not poles', () => {
    expect(SPECIES.rosa_standard.trunkR).toBeLessThanOrEqual(0.025);
  });
  it('flowering shrubs have no limbs and reach the ground (no hovering mass)', () => {
    const g = crownGeometry(SPECIES.shrub_flowering, 7);
    const cw = g.getAttribute('crown');
    let limbs = 0;
    for (let i = 0; i < cw.count; i++) if (cw.getW(i) < 0) limbs++;
    expect(limbs).toBe(0);
    // the lowest clumps come within 10 % of the crown height of its base
    const pos = g.getAttribute('position');
    let y0 = Infinity;
    let y1 = -Infinity;
    let xLow = 0;
    for (let i = 0; i < pos.count; i++) {
      y0 = Math.min(y0, pos.getY(i));
      y1 = Math.max(y1, pos.getY(i));
    }
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < y0 + 0.15 * (y1 - y0)) xLow = Math.max(xLow, Math.hypot(pos.getX(i), pos.getZ(i)));
    // the skirt is wide: at least half the crown radius near the base
    expect(xLow).toBeGreaterThan(0.5 * SPECIES.shrub_flowering.crown);
  });
});

/**
 * Wave 9 garden (audit #1): Petri's graded framing groups TF-45..49 in the Herzogsgarten and the low July shrub.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { E0, N0, gridFrame } from '../src/frame.ts';
import { distanceToLine } from '../src/layout/garden.ts';
import { GARDEN, GARDEN_GRADED } from '../src/layout/grammar.ts';
import { SPECIES, speciesFor } from '../src/site/trees.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const tf = (id: string) => spec.terrain_features.find((f) => f.id === id)!;
const g = gridFrame(spec.palace_grid);
const uvOf = (id: string): [number, number][] => {
  const geo = tf(id).geometry;
  if (geo.type !== 'MultiPoint') throw new Error(`${id} is not a MultiPoint`);
  return (geo.coordinates as [number, number][]).map(([E, N]) => g.toUV(E, N) as [number, number]);
};
const LAYERS = ['TF-45', 'TF-46', 'TF-47', 'TF-48', 'TF-49'];

describe('Herzogsgarten framing groups (wave 9)', () => {
  it('are the last terrain features, so the seeded tree streams of the older plantings keep their places', () => {
    const ids = spec.terrain_features.map((f) => f.id);
    expect(ids.slice(-LAYERS.length)).toEqual(LAYERS);
  });

  it('are hypotheses: low confidence, hypothetical, tagged with the Petri plan, from 1788', () => {
    for (const id of LAYERS) {
      const f = tf(id);
      expect(f.kind).toBe('clump');
      expect(f.confidence).toBe('low');
      expect(f.placement).toBe('hypothetical');
      expect(f.tag).toMatch(/Petri plan/);
      expect(f.epoch?.from).toBe(1788);
    }
  });

  it('grade low July shrubs in front, tall shrubs behind, trees at the back', () => {
    expect(speciesFor(tf('TF-45').mix![0].species)).toBe(SPECIES.shrub_july);
    // wave-9 review fix: tall shrubs out of flower in July (no autumn cast), young feathered limes (Heister)
    expect(speciesFor(tf('TF-46').mix![0].species)).toBe(SPECIES.shrub_green);
    expect(speciesFor(tf('TF-47').mix![0].species)).toBe(SPECIES.tilia_heister);
    expect(speciesFor(tf('TF-48').mix![0].species)).toBe(SPECIES.populus_italica);
    expect(speciesFor(tf('TF-49').mix![0].species)).toBe(SPECIES.conifer);
    expect(tf('TF-45').mix![0].height![1]).toBeLessThan(tf('TF-46').mix![0].height![0]);
    expect(tf('TF-46').mix![0].height![1]).toBeLessThan(tf('TF-47').mix![0].height![0]);
    expect(uvOf('TF-45').length).toBeGreaterThanOrEqual(12);
    expect(uvOf('TF-46').length).toBeGreaterThanOrEqual(8);
    expect(uvOf('TF-47').length + uvOf('TF-48').length + uvOf('TF-49').length).toBe(7);
    // in each group the front layer lies nearer the lawn point it faces (u 150, v 25) than the back trees
    const back = [...uvOf('TF-47'), ...uvOf('TF-48'), ...uvOf('TF-49')];
    const dist = (p: [number, number]) => Math.hypot(p[0] - 150, p[1] - 25);
    for (const side of [1, -1]) {
      const mean = (ps: [number, number][]) => ps.filter((p) => Math.sign(p[1]) === side).reduce((s, p) => s + dist(p), 0) / ps.filter((p) => Math.sign(p[1]) === side).length;
      expect(mean(uvOf('TF-45'))).toBeLessThan(mean(uvOf('TF-46')));
      expect(mean(uvOf('TF-46'))).toBeLessThan(mean(back));
    }
  });

  it('keep the axis vista, the walks and the basin free and keep their layer spacing', () => {
    const belt = tf('HG-02').geometry;
    const beltUV = (belt.coordinates as [number, number][]).map(([E, N]) => g.toUV(E, N) as [number, number]);
    const spacing: Record<string, number> = { 'TF-45': GARDEN_GRADED.front.spacing, 'TF-46': GARDEN_GRADED.mid.spacing };
    for (const id of LAYERS) {
      const pts = uvOf(id);
      for (const [u, v] of pts) {
        expect(u < 470 && Math.abs(v) < 12, `${id} (${u.toFixed(1)}, ${v.toFixed(1)}) in the axis vista`).toBe(false);
        expect(distanceToLine(beltUV, [u, v])).toBeGreaterThanOrEqual(GARDEN.path.beltWalk / 2 + 1.5 - 0.02);
        expect(Math.hypot(u - 112, v)).toBeGreaterThanOrEqual(7 + 6 - 0.02);
      }
      const s = spacing[id];
      if (s) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThan(s - 0.03);
    }
  });

  it('gives the low July shrub more bloom than the mixed clumps', () => {
    const j = SPECIES.shrub_july.bloom!;
    const m = SPECIES.shrub_flowering.bloom!;
    expect(j.faceShare.reduce((a, b) => a + b, 0)).toBeGreaterThan(m.faceShare.reduce((a, b) => a + b, 0));
    expect(SPECIES.shrub_july.height).toBeLessThan(SPECIES.shrub_flowering.height);
    expect(speciesFor('Flowering shrubs (Syringa, Philadelphus, Rosa, Viburnum, Cornus mas)')).toBe(SPECIES.shrub_flowering);
  });

  it('wave-9 review fix: young feathered limes, green tall shrubs, no yellow bloom in the July shrub', () => {
    const h = SPECIES.tilia_heister;
    expect(tf('TF-47').mix![0].height).toEqual([...GARDEN_GRADED.heister.height]);
    // narrow ovoid crown branched from low on the stem (≈ 1.2-1.5 m), not a ball on a 3 m trunk
    expect(h.trunkFrac * h.height).toBeGreaterThanOrEqual(1.2);
    expect(h.trunkFrac * h.height).toBeLessThanOrEqual(1.5);
    expect(h.crown / h.height).toBeLessThan(SPECIES.tilia_young.crown / SPECIES.tilia_young.height);
    expect(SPECIES.shrub_green.bloom).toBeUndefined();
    // rose and white only: no yellow (R and G high, B low) in the July shrub
    for (const c of SPECIES.shrub_july.bloom!.colours) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      expect(r > 180 && g > 160 && b < 110, c).toBe(false);
    }
  });

  // pose 16 / 17 (shots.mjs): eye at local (1369.8, ·, -1169.4), 1.7 m above the lawn, looking at (1282.2, 349.8,
  // -1147.7), vertical fov 55°, 16:9
  const EYE: [number, number, number] = [1369.8, 349.8 + 1.7, -1169.4];
  const AT: [number, number, number] = [1282.2, 349.8, -1147.7];
  const jet = (() => {
    const r = tf('HG-04').geometry.coordinates[0] as [number, number][];
    const E = r.reduce((s, p) => s + p[0], 0) / r.length;
    const N = r.reduce((s, p) => s + p[1], 0) / r.length;
    return { x: E - E0, z: -(N - N0), y0: tf('HG-04').water_level!, y1: tf('HG-04').water_level! + tf('HG-04').fountain_h! };
  })();

  it('wave-9 review fix: the Pyramidenpappeln keep GARDEN_GRADED.sightClear m off the line of sight from the 16/17 eye to the jet', () => {
    const eyeUV = g.toUV(EYE[0] + E0, N0 - EYE[2]);
    const jetUV = g.toUV(jet.x + E0, N0 - jet.z);
    const dx = jetUV[0] - eyeUV[0];
    const dy = jetUV[1] - eyeUV[1];
    const L = Math.hypot(dx, dy);
    for (const [u, v] of uvOf('TF-48')) {
      const t = ((u - eyeUV[0]) * dx + (v - eyeUV[1]) * dy) / L;
      const d = t <= 0 ? Math.hypot(u - eyeUV[0], v - eyeUV[1]) : Math.abs((u - eyeUV[0]) * dy - (v - eyeUV[1]) * dx) / L;
      expect(d, `TF-48 (${u.toFixed(1)}, ${v.toFixed(1)})`).toBeGreaterThanOrEqual(GARDEN_GRADED.sightClear - 0.05);
    }
  });

  it("wave-9 review fix: at pose 16/17 the jet's screen box overlaps no Pyramidenpappel", () => {
    const f = [AT[0] - EYE[0], AT[1] - EYE[1], AT[2] - EYE[2]];
    const fl = Math.hypot(...f);
    const fw = f.map((x) => x / fl);
    const rl = Math.hypot(fw[2], fw[0]);
    const rt = [-fw[2] / rl, 0, fw[0] / rl];
    const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    const T = Math.tan((55 / 2) * (Math.PI / 180));
    const proj = (x: number, y: number, z: number): [number, number] => {
      const d = [x - EYE[0], y - EYE[1], z - EYE[2]];
      const zc = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
      return [(d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2]) / zc / T / (16 / 9), (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / zc / T];
    };
    // a box in NDC from the corners of an upright cylinder (radius r, y0..y1)
    const box = (x: number, z: number, r: number, y0: number, y1: number) => {
      const pts = [-r, r].flatMap((ox) => [-r, r].flatMap((oz) => [y0, y1].map((y) => proj(x + ox, y, z + oz))));
      return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
    };
    const j = box(jet.x, jet.z, 0.6, jet.y0, jet.y1);
    expect(j.x0 > -1 && j.x1 < 1, 'jet in view').toBe(true);
    const [, hMax] = tf('TF-48').mix![0].height!;
    for (const [E, N] of tf('TF-48').geometry.coordinates as [number, number][]) {
      // the poplar's column: SPECIES.populus_italica crown radius at its tallest, from the lawn to the top
      const p = box(E - E0, -(N - N0), (SPECIES.populus_italica.crown * hMax) / SPECIES.populus_italica.height, 349.5, 349.5 + hMax);
      const overlap = p.x0 < j.x1 && p.x1 > j.x0 && p.y0 < j.y1 && p.y1 > j.y0;
      expect(overlap, `TF-48 at ${E}, ${N}`).toBe(false);
    }
  });
});

/**
 * KB-I68: the 'fence' terrain feature kind (post-and-rail at the court-mouth guard houses, Le Clerc 1790; the barrière at
 * the valley entrance, PV 1791 l. 1). Pure layout (site/fence.ts), validation, and the catalogue entries.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import type { P2 } from '../src/layout/geom.ts';
import { FENCE } from '../src/layout/grammar.ts';
import { barriereLayout, postRailLayout } from '../src/site/fence.ts';
import { validateSite } from '../src/validate.ts';

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('postRailLayout', () => {
  it('puts posts at both ends and at most `spacing` apart, two rails per bay', () => {
    const line: P2[] = [
      [0, 0],
      [11, 0],
    ];
    const r = postRailLayout(line, 1.2, { spacing: 2.5, rails: 2, seed: 7 });
    expect(r.posts[0].p).toEqual([0, 0]);
    expect(r.posts[r.posts.length - 1].p[0]).toBeCloseTo(11, 9);
    for (let i = 1; i < r.posts.length; i++) expect(dist(r.posts[i].p, r.posts[i - 1].p)).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(r.posts.length).toBe(Math.ceil(11 / 2.5) + 1);
    expect(r.rails.length).toBe((r.posts.length - 1) * 2);
    // rails under the post tops, posts near the nominal height and nearly plumb
    for (const q of r.posts) {
      expect(q.h).toBeGreaterThan(1.1);
      expect(q.h).toBeLessThan(1.3);
      expect(Math.hypot(...q.lean)).toBeLessThanOrEqual(FENCE.postRail.lean * 1.2 + 1e-9);
    }
    for (const rl of r.rails) {
      expect(rl.z).toBeGreaterThan(0.2);
      expect(rl.z).toBeLessThan(1.2);
    }
  });

  it('follows a polyline and is deterministic per seed', () => {
    const line: P2[] = [
      [0, 0],
      [6, 0],
      [6, 6],
    ];
    const a = postRailLayout(line, 1, { seed: 3 });
    expect(a).toEqual(postRailLayout(line, 1, { seed: 3 }));
    expect(a.posts.every((q) => Math.abs(q.p[1]) < 1e-9 || Math.abs(q.p[0] - 6) < 1e-9)).toBe(true);
    expect(postRailLayout([[0, 0]], 1).posts).toEqual([]);
  });
});

describe('barriereLayout', () => {
  const a: P2 = [0, 0];
  const b: P2 = [0, 19.5];

  it('centres the beam on the gap, pivot on the a side, rest on the b side', () => {
    const r = barriereLayout(a, b, 1.1, { seed: 1 });
    const bm = r.beam!;
    expect(bm.length).toBeCloseTo(FENCE.barriere.beam, 9);
    expect((bm.pivot[1] + bm.rest[1]) / 2).toBeCloseTo(19.5 / 2, 9);
    expect(bm.pivot[1]).toBeLessThan(bm.rest[1]);
    expect(dist(bm.heel, bm.pivot)).toBeCloseTo(FENCE.barriere.counter, 9);
    expect(bm.dir).toEqual([0, 1]);
  });

  it('closes the rest of the gap with rails that keep clear of the heel, the rest post and the houses', () => {
    const r = barriereLayout(a, b, 1.1, { seed: 1 });
    const bm = r.beam!;
    expect(r.posts.length).toBeGreaterThan(3);
    for (const q of r.posts) {
      const y = q.p[1];
      expect(y).toBeGreaterThanOrEqual(FENCE.clear - 1e-9);
      expect(y).toBeLessThanOrEqual(19.5 - FENCE.clear + 1e-9);
      // nothing between the heel and the rest post (the beam swings there)
      expect(y < bm.heel[1] - FENCE.clear + 1e-9 || y > bm.rest[1] + FENCE.clear - 1e-9).toBe(true);
    }
    expect(barriereLayout(a, b, 1.1, { beamOnly: true }).posts).toEqual([]);
  });

  it('shortens the beam in a narrow gap and gives up below 1 m', () => {
    const r = barriereLayout([0, 0], [5, 0], 1);
    expect(r.beam!.length).toBeLessThan(5);
    expect(barriereLayout([0, 0], [1, 0], 1).beam).toBeUndefined();
  });
});

describe('fence features in the catalogue (KB-I68)', () => {
  const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
  const { spec } = loadSite(raw);
  const fences = spec.terrain_features.filter((f) => f.kind === 'fence');

  it('has the court-mouth post-and-rail and the valley barrière, both low confidence with tags', () => {
    expect(fences.map((f) => f.id).sort()).toEqual(['KB-F1', 'KB-F2']);
    for (const f of fences) {
      expect(f.confidence).toBe('low');
      expect(f.tag).toMatch(/\bD\b/);
      expect(f.fence_line?.tag).toBeTruthy();
      expect(f.geometry.type).toBe('LineString');
    }
    expect(fences.find((f) => f.id === 'KB-F2')!.fence_line!.type).toBe('barriere');
  });

  it('the barrière spans only the gap between KB-B63 and KB-B64, the rails only between KB-B37 and KB-B38', () => {
    const cen = (id: string): P2 => {
      const r = spec.buildings.find((b) => b.id === id)!.footprint!;
      const n = r.length - 1;
      return [r.slice(0, n).reduce((s, p) => s + p[0], 0) / n, r.slice(0, n).reduce((s, p) => s + p[1], 0) / n];
    };
    const span = (id: string) => {
      const c = (fences.find((f) => f.id === id)!.geometry as { coordinates: P2[] }).coordinates;
      return c;
    };
    const [p, q] = span('KB-F2');
    const [s, n] = [cen('KB-B64'), cen('KB-B63')];
    expect(dist(p, q)).toBeLessThan(dist(s, n));
    expect(dist(p, s) + dist(p, n)).toBeLessThan(dist(s, n) + 1);
    const [f0, f1] = span('KB-F1');
    expect(dist(f0, f1)).toBeLessThan(dist(cen('KB-B37'), cen('KB-B38')));
  });

  it('validation rejects a fence without a form or a barrière with more than two points', () => {
    const bad = structuredClone(raw);
    const f1 = bad.terrain_features.find((f: { id: string }) => f.id === 'KB-F1');
    delete f1.fence_line;
    const f2 = bad.terrain_features.find((f: { id: string }) => f.id === 'KB-F2');
    f2.geometry.coordinates.push([381497, 5465920]);
    const r = validateSite(bad, 'v2');
    expect(r.errors.some((e) => e.path.includes('KB-F1') && e.path.endsWith('.fence_line'))).toBe(true);
    expect(r.errors.some((e) => e.path.includes('KB-F2') && e.path.endsWith('.geometry'))).toBe(true);
  });
});

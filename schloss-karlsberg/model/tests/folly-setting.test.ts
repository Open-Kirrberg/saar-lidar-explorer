/**
 * KB-I71 (wave-7 review fix): winding walks to the wave-7 follies, their shrub backdrops, the Monopteros lawn and the
 * Wassermaschine's well and track. The pure walk generator, and the catalogue: each walk still ends at the building it
 * serves and crosses no building, and every new item is a low-confidence hypothesis with a tag.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { pointInPolygon, type P2 } from '../src/layout/geom.ts';
import { blocked, serpentineWalk, walkLength } from '../src/site/follyWalks.ts';

describe('serpentineWalk', () => {
  const a: P2 = [0, 0];
  const b: P2 = [100, 0];

  it('keeps both end points and winds a little (one bend per ~35 m, ≤ 7 m off the line)', () => {
    const w = serpentineWalk(a, b);
    expect(w[0]).toEqual(a);
    expect(w[w.length - 1]).toEqual(b);
    const L = walkLength(w);
    expect(L).toBeGreaterThan(100.5);
    expect(L).toBeLessThan(115);
    const off = Math.max(...w.map((p) => Math.abs(p[1])));
    expect(off).toBeGreaterThan(2);
    expect(off).toBeLessThanOrEqual(7);
    // it swings to both sides
    expect(w.some((p) => p[1] > 1)).toBe(true);
    expect(w.some((p) => p[1] < -1)).toBe(true);
  });

  it('is deterministic and straight with amp 0', () => {
    expect(serpentineWalk(a, b, { side: -1 })).toEqual(serpentineWalk(a, b, { side: -1 }));
    expect(Math.max(...serpentineWalk(a, b, { amp: 0 }).map((p) => Math.abs(p[1])))).toBeLessThan(1e-9);
  });

  it('swings away from an obstacle on the first side', () => {
    const box: P2[] = [
      [40, 2],
      [60, 2],
      [60, 12],
      [40, 12],
    ];
    const w = serpentineWalk(a, b, { bendEvery: 100, side: 1, avoid: [box], clear: 1 });
    for (const p of w) expect(pointInPolygon(p, box)).toBe(false);
    expect(Math.min(...w.map((p) => p[1]))).toBeLessThan(-2);
    expect(blocked([50, 5], [box], 1)).toBe(true);
    expect(blocked([50, 1.5], [box], 1)).toBe(true);
    expect(blocked([50, -2], [box], 1)).toBe(false);
  });
});

describe('catalogue: the setting of the wave-7 follies (KB-I71)', () => {
  const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
  const { spec } = loadSite(raw);
  const tf = (id: string) => spec.terrain_features.find((f) => f.id === id);
  const fp = (id: string): P2[] => {
    const b = spec.buildings.find((x) => x.id === id);
    expect(b?.footprint, id).toBeTruthy();
    return b!.footprint!.map(([E, N]) => [E, N] as P2);
  };
  const dist = (p: P2, ring: P2[]) => {
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const q = ring[i];
      const r = ring[(i + 1) % ring.length];
      const dx = r[0] - q[0];
      const dy = r[1] - q[1];
      const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(q[0] + dx * t - p[0], q[1] + dy * t - p[1]));
    }
    return d;
  };
  const walks: [string, string][] = [
    ['KL-W1', 'KL-B53'],
    ['KL-W2', 'KL-B51'],
    ['KL-W3', 'KL-B52'],
    ['KL-W4', 'KL-B50'],
    ['KB-W5', 'KB-B89'],
    ['KB-W6', 'KB-B90'],
    ['KB-W7', 'KB-B91'],
  ];

  it.each(walks)('%s leads to %s and crosses no building', (wid, bid) => {
    const w = tf(wid);
    expect(w?.kind).toBe('path');
    expect(w!.geometry.type).toBe('LineString');
    const line = w!.geometry.coordinates as P2[];
    const target = fp(bid);
    // the end (or, for the volière on the through walk, the nearest point) is at the building
    const near = Math.min(...line.map((p) => dist(p, target)));
    expect(near).toBeLessThan(3.5);
    expect(dist(line[line.length - 1], target) < 3.5 || wid === 'KL-W1').toBe(true);
    for (const b of spec.buildings) {
      if (!b.footprint || b.placement === 'unplaced') continue;
      const ring = b.footprint.map(([E, N]) => [E, N] as P2);
      for (const p of line) expect(pointInPolygon(p, ring), `${wid} vertex in ${b.id}`).toBe(false);
    }
  });

  it('every new item is a low-confidence hypothesis with an evidence tag', () => {
    const ids = [...walks.map((w) => w[0]), 'KL-C1', 'KL-C2', 'KL-C3', 'KB-C4', 'KB-C5', 'KB-L1', 'KB-WB1'];
    for (const id of ids) {
      const f = tf(id);
      expect(f, id).toBeTruthy();
      expect(f!.confidence).toBe('low');
      expect(f!.placement).toBe('hypothetical');
      expect(f!.tag).toMatch(/\b(N|I|D→)\b/);
    }
    // the walks are garden walks (≤ 4 m: drawn as gravel ribbons) and the Monopteros sits inside its lawn
    for (const [id] of walks) expect(tf(id)!.width).toBeLessThanOrEqual(2.5);
    const lawn = tf('KB-L1')!.geometry.coordinates[0] as P2[];
    const mono = fp('KB-B89');
    const c: P2 = [mono.reduce((s, p) => s + p[0], 0) / mono.length, mono.reduce((s, p) => s + p[1], 0) / mono.length];
    expect(pointInPolygon(c, lawn)).toBe(true);
    // the well stands outside the machine house, within 6 m of it
    const well = tf('KB-WB1')!.geometry.coordinates as P2;
    const house = fp('KB-B91');
    expect(pointInPolygon(well, house)).toBe(false);
    expect(dist(well, house)).toBeLessThan(6);
  });

  it('the Felsenpfad KB-W8 (V23 no. 3) runs along the S shore of the Karlsbergweiher, dry and close to the water', () => {
    const w = tf('KB-W8')!;
    expect(w.kind).toBe('path');
    expect(w.confidence).toBe('low');
    expect(w.placement).toBe('hypothetical');
    expect(w.tag).toMatch(/V23 no\. 3/);
    const pond = tf('TF-20')!.geometry.coordinates[0] as P2[];
    const line = w.geometry.coordinates as P2[];
    const pondS = Math.min(...pond.map((p) => p[1]));
    for (const p of line) {
      expect(pointInPolygon(p, pond)).toBe(false);
      expect(dist(p, pond)).toBeLessThan(16);
      expect(p[1]).toBeLessThan(pondS + 5); // on the S side (N smaller than the pond's S edge + a little)
    }
  });
});

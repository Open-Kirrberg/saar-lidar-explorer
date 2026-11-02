/**
 * Fix round 1 (docs/review/review-1.md): regression tests for the review issues that have a testable core.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { type BuildContext, DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { buildExterior, wallSpansS } from '../src/exterior/index.ts';
import { createFallbackMaterials } from '../src/interior/index.ts';
import { interiorModel } from '../src/interior/model.ts';
import { cullBuriedOpenings } from '../src/layout/facade.ts';
import { sidePoint } from '../src/layout/footprint.ts';
import { wallFreeSpans } from '../src/layout/walls.ts';
import { CHIMNEY } from '../src/layout/grammar.ts';
import type { RingEN } from '../src/spec.ts';

const { spec } = loadSite(JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8')));
const layout = makeLayoutFn(spec);
const ctx = (lod: 0 | 1 | 2, terrain: (x: number, z: number) => number = () => NaN): BuildContext => ({ spec, lod, materials: createFallbackMaterials(), terrain, options: { ...DEFAULT_BUILD_OPTIONS }, layout });
const get = (id: string) => spec.buildings.find((b) => b.id === id)!;
const DETAILED = ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B10'];

describe('#1 Orangerie-Stützmauer = KB-B10 basement front', () => {
  it('wallFreeSpans drops a wall line that runs along a footprint face and keeps a free one', () => {
    const sq: RingEN = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(wallFreeSpans([[0.2, -0.3], [9.8, -0.3]], [sq])).toEqual([]);
    const free = wallFreeSpans([[0, -5], [10, -5]], [sq]);
    expect(free).toHaveLength(1);
    expect(free[0][1] - free[0][0]).toBeCloseTo(10, 5);
    // half covered: only the free half remains
    const half = wallFreeSpans([[5, 0.2], [20, 0.2]], [sq]);
    expect(half).toHaveLength(1);
    expect(half[0][0]).toBeGreaterThan(5);
  });

  it('KB-B14 builds nothing; KB-B10 has basement windows and the basement door on the W (garden) side', () => {
    const b14 = get('KB-B14');
    expect(wallSpansS(layout(b14), ctx(1))).toEqual([]);
    const L = layout(get('KB-B10'));
    const w = L.openings.filter((o) => o.side === 'garden' && o.storey === 0);
    expect(w.filter((o) => o.kind === 'window').length).toBeGreaterThanOrEqual(20);
    expect(w.some((o) => o.kind === 'door')).toBe(true);
  });
});

describe('#11 Orangerie W front: sill windows, portes-fenêtres only on the parterre side', () => {
  it('garden (W) storeys 1-2 are windows with sills; court (E) storey 1 keeps portes-fenêtres', () => {
    const L = layout(get('KB-B10'));
    const west = L.openings.filter((o) => o.side === 'garden' && o.storey >= 1);
    expect(west.length).toBeGreaterThan(40);
    expect(west.every((o) => o.kind === 'window' && o.sill >= 0.5)).toBe(true);
    const east = L.openings.filter((o) => o.side === 'court' && o.storey === 1);
    expect(east.some((o) => o.kind === 'porte_fenetre')).toBe(true);
  });
});

describe('#2 garden perron and #6 portico', () => {
  it('the CdL garden door has a 2-step perron from the parterre level 345.9 below the EG floor', () => {
    const tf09 = spec.terrain_features.find((f) => f.id === 'TF-09')!;
    expect(tf09.level).toBeLessThanOrEqual(346.0);
    const L = layout(get('KB-B01'));
    const door = L.openings.find((o) => o.side === 'garden' && o.kind === 'door')!;
    expect(door.steps).toBe(2);
    expect(door.grade_h).toBe(tf09.level);
    expect(door.bottom_h).toBeGreaterThan(tf09.level!);
  });

  it('the S arm W head portal carries a 4-column portico with balcony and 11 steps', () => {
    const L = layout(get('KB-B02'));
    const p = L.openings.find((o) => o.side === 'end_a' && o.kind === 'portal')!;
    expect(p.portico).toMatchObject({ columns: 4, balcony: true });
    expect(p.steps).toBe(11);
    // the portico geometry exists at LOD1: something stands in front of the end_a face above the threshold
    const g = buildExterior(get('KB-B02'), ctx(1));
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const sd = L.frame.sides.end_a;
    const q = sidePoint(L.frame, 'end_a', p.a, 2.0);
    const rc = new THREE.Raycaster(new THREE.Vector3(q[0] + sd.normal[0] * 20, p.top_h + 1.5, -(q[1] + sd.normal[1] * 20)), new THREE.Vector3(-sd.normal[0], 0, sd.normal[1]).normalize());
    const hit = rc.intersectObject(g, true)[0];
    expect(hit).toBeDefined();
    expect(hit.distance).toBeLessThan(20 - 1.0); // entablature / balcony stands > 1 m in front of the wall
  });
});

describe('#4 interior reveals lie inside exterior holes', () => {
  it.each(DETAILED)('%s: every facade reveal (after the shared terrain cull) is inside an exterior opening', (id) => {
    const b = get(id);
    const L = layout(b);
    const groundAt = (E: number, N: number) => {
      // ground 3 m above base_h on the garden half (t < 0): buries the garden EG windows, NaN elsewhere
      const dx = E - L.frame.centreEN[0];
      const dy = N - L.frame.centreEN[1];
      const t = dx * L.frame.tDir[0] + dy * L.frame.tDir[1];
      return t < 0 ? L.stack.base_h + 3.0 : NaN;
    };
    const exterior = cullBuriedOpenings(L.openings, L.frame, groundAt);
    const culled = L.openings.filter((o) => o.kind === 'window' && !exterior.includes(o));
    if (id === 'KB-B01') expect(culled.length).toBeGreaterThan(5);
    const m = interiorModel(b, L, 1789, groundAt);
    let n = 0;
    for (const r of m.rooms) {
      for (const w of r.walls) {
        for (const h of w.hits) {
          if (!h.opening.facade || h.opening.source !== 'facade') continue;
          n++;
          // centre of the reveal in absolute height and position along the side
          const hc = r.floor_h + (h.hole.v0 + h.hole.v1) / 2;
          const match = exterior.find((o) => {
            const c = sidePoint(L.frame, o.side, o.a, 0);
            return Math.hypot(c[0] - h.opening.centre[0], c[1] - h.opening.centre[1]) < 0.02 && hc > o.bottom_h - 0.01 && hc < o.top_h + 0.01;
          });
          expect(match, `${id} ${r.room.id} ${h.opening.id}`).toBeDefined();
          if (!match) continue;
          // the reveal (both ends along the wall) lies within the exterior hole width
          expect(h.hole.u1 - h.hole.u0).toBeLessThanOrEqual(match.width + 0.02);
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('deep facade reveals are splayed (ébrasement) and the CdL stair hall court wall gets them', () => {
    const b = get('KB-B01');
    const m = interiorModel(b, layout(b));
    const hall = m.rooms.find((r) => r.room.id === 'B01.1.eg-prunktreppe')!;
    const hits = hall.walls.flatMap((w) => w.hits).filter((h) => h.opening.facade);
    expect(hits.length).toBeGreaterThanOrEqual(10); // 5 axes x 2 storeys on the court + garden walls
    for (const h of hits) {
      expect(h.depth).toBeGreaterThan(0.45);
      expect(h.hole.splay ?? 0).toBeGreaterThan(0.1);
    }
  });

  it('negative check: a reveal moved by 0.5 m would not be inside any exterior hole', () => {
    const b = get('KB-B01');
    const L = layout(b);
    const o = L.openings.find((x) => x.side === 'court' && x.kind === 'window')!;
    const c = sidePoint(L.frame, 'court', o.a + 0.5 + o.width, 0);
    const inside = L.openings.some((x) => {
      const cc = sidePoint(L.frame, x.side, x.a, 0);
      return Math.hypot(cc[0] - c[0], cc[1] - c[1]) < x.width / 2;
    });
    expect(inside).toBe(false);
  });
});

describe('#18 Dienertreppe Süd serves all its doors', () => {
  it('no CdL stair leaves a door unserved', () => {
    const b = get('KB-B01');
    const m = interiorModel(b, layout(b));
    expect(m.warnings.filter((w) => /not served/.test(w))).toEqual([]);
  });
});

describe('#15 chimneys', () => {
  it('stacks are about 0.9 x 0.6 m', () => {
    expect(CHIMNEY.section[0] * CHIMNEY.section[1]).toBeLessThanOrEqual(0.6);
  });
});

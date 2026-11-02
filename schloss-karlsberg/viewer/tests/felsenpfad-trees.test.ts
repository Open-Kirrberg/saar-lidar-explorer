/**
 * Wave-8 review fix (KB-I71, KB-W8 Felsenpfad): a new hypothetical walk must not move existing trees (wave-5 rule).
 * The Felsenpfad is a trodden earth path that prepare-terrain.py does not paint into the ground classes, so every tree
 * planner of the viewer (forest, open land, hinterland) sees the same ground as before the walk existed; its route
 * passes the old walnut on the bank instead of cutting it.
 *
 * The planner check needs the generated terrain (viewer/public/terrain/, git-ignored): it is skipped without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distanceToLine } from '@model/layout/garden.ts';
import type { P2 } from '@model/layout/geom.ts';
import { isTroddenPath } from '@model/site/rockPath.ts';
import { DEFAULT_FOREST_MIX, GROUND_CLASS, forestPlan, openTreePlan } from '../src/landcover.ts';
import { hinterlandPlan } from '../src/hinterland.ts';
import { TerrainData, type TerrainMeta } from '../src/terrain.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const cat = JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8'));
const w8 = cat.terrain_features.find((f: { id: string }) => f.id === 'KB-W8');
const line: P2[] = w8.geometry.coordinates.map(([E, N]: number[]) => [E - 381000, -(N - 5465000)]);

/**
 * Every tree the planners put within 30 m of KB-W8, as in `wave7-final` (before the walk; generated with the walk
 * removed from the catalogue): forest and open-land trees and the hinterland hedge (local x, z, species).
 */
const BEFORE_W8: { x: number; z: number; species: string }[] = [
  { x: 804.56, z: -833.97, species: 'juglans' },
  { x: 901.02, z: -842.07, species: 'juglans' },
  { x: 801.8, z: -871.44, species: 'rosa_canina' },
  { x: 804.06, z: -871.61, species: 'crataegus' },
  { x: 807.81, z: -870.78, species: 'corylus' },
];
const WALNUT = BEFORE_W8[1];

describe('KB-W8 Felsenpfad (catalogue)', () => {
  it('is a hypothetical trodden earth footpath, so the ground classes do not carry it', () => {
    expect(isTroddenPath(w8)).toBe(true);
    expect(w8.placement).toBe('hypothetical');
    expect(w8.confidence).toBe('low');
    expect(w8.width).toBeLessThanOrEqual(1.6); // Sckell footpaths 0.9-1.6 m (research/11 §4.4)
  });
  it('passes the walnut on the bank at ≥ 6 m', () => {
    expect(distanceToLine(line, [WALNUT.x, WALNUT.z])).toBeGreaterThan(6);
  });
});

const TERRAIN = resolve(ROOT, 'viewer/public/terrain');
const haveTerrain = existsSync(resolve(TERRAIN, 'meta.json')) && existsSync(resolve(TERRAIN, 'ground.u8'));

describe.skipIf(!haveTerrain)('KB-W8 moves no tree (generated terrain)', () => {
  const meta = haveTerrain ? (JSON.parse(readFileSync(resolve(TERRAIN, 'meta.json'), 'utf8')) as TerrainMeta & { ground: { cols: number; rows: number; cell: number } }) : null;
  const f32 = (f: string) => {
    const b = readFileSync(resolve(TERRAIN, f));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };

  it('no ground cell along the walk is painted as a hard surface', () => {
    const m = meta!;
    const g = new Uint8Array(readFileSync(resolve(TERRAIN, 'ground.u8')));
    const gm = m.ground;
    const others = cat.terrain_features
      .filter((f: { id: string; kind: string; surface?: string; geometry: { type: string } }) => f.id !== 'KB-W8' && ['path', 'avenue'].includes(f.kind) && f.geometry.type === 'LineString')
      .map((f: { width?: number; geometry: { coordinates: number[][] } }) => ({ half: (f.width ?? 4) / 2, line: f.geometry.coordinates.map(([E, N]) => [E - 381000, -(N - 5465000)] as P2) }));
    let n = 0;
    for (let r = 0; r < gm.rows; r++)
      for (let c = 0; c < gm.cols; c++) {
        const x = m.grid.west + (c + 0.5) * gm.cell - 381000;
        const z = -(m.grid.north - (r + 0.5) * gm.cell - 5465000);
        if (x < 800 || x > 980 || z < -880 || z > -820) continue;
        if (distanceToLine(line, [x, z]) > w8.width / 2 + 1) continue;
        // where it meets the gravel dam walk KB-W5 the gravel is that walk's
        if (others.some((o) => distanceToLine(o.line, [x, z]) < o.half + 1.5)) continue;
        n++;
        expect(g[r * gm.cols + c]).not.toBe(GROUND_CLASS.gravel);
      }
    expect(n).toBeGreaterThan(50);
  });

  it('the tree planners keep every tree within 30 m of the walk where it stood before the walk existed', () => {
    const m = meta!;
    const h = f32('dtm1789.f32');
    const ground = new Uint8Array(readFileSync(resolve(TERRAIN, 'ground.u8')));
    const t = new TerrainData(m, h, h, ground);
    const gm = m.ground;
    const gg = { ground, cols: gm.cols, rows: gm.rows, cell: gm.cell };
    const ox = m.grid.west - 381000;
    const oz = -(m.grid.north - 5465000);
    const trees = [
      ...forestPlan(gg, { mix: DEFAULT_FOREST_MIX, seed: 1789 }),
      ...openTreePlan(gg, { seed: 1789, ox, oz }),
      ...hinterlandPlan(gg, { west: m.grid.west, north: m.grid.north, parcels: cat.landcover, height: (gx, gy) => t.sample(ox + gx, oz + gy), seed: 1789 }).trees,
    ];
    const near = trees
      .map((p) => ({ x: +(ox + p.gx).toFixed(2), z: +(oz + p.gy).toFixed(2), species: p.species }))
      .filter((p) => distanceToLine(line, [p.x, p.z]) < 30);
    const key = (p: { x: number; z: number; species: string }) => `${p.species}@${p.x.toFixed(2)},${p.z.toFixed(2)}`;
    expect(near.map(key).sort()).toEqual(BEFORE_W8.map(key).sort());
    // and none stands on the walk
    for (const p of near) expect(distanceToLine(line, [p.x, p.z])).toBeGreaterThan(w8.width / 2 + 1);
  });
});

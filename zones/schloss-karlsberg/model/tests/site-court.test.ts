// KB-I23 Ehrenhof furniture: sentry boxes, Prellsteine, cobbled lanes and gutters (site/courtPlan.ts, site/court.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { loadSite } from '../src/catalogue.ts';
import { E0, N0 } from '../src/frame.ts';
import { pointInPolygon } from '../src/layout/geom.ts';
import { COURT_FURNITURE } from '../src/layout/grammar.ts';
import { createMaterials } from '../src/materials/index.ts';
import { courtPlan, diagonalBands, ehrenhof, polyArea } from '../src/site/courtPlan.ts';
import { buildCourtFurniture, laneGeometry } from '../src/site/court.ts';
import { cobblePatch, laneZone } from '../src/materials/cobbles.ts';
import type { EN } from '../src/spec.ts';

const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../catalogue.json'), 'utf8'));
const { spec } = loadSite(raw);
const layout = makeLayoutFn(spec);
const year = DEFAULT_BUILD_OPTIONS.year;
const plan = courtPlan(spec, layout, () => NaN, year)!;
// KB-I31 (wave 7): open follies (the S-wing Altan stands on piers over the garden Durchfahrt) are not closed buildings
const footprints = spec.buildings.filter((b) => b.footprint && b.cls !== 'WALL' && b.cls !== 'GARD' && !b.facade.folly).map((b) => b.footprint as EN[]);
const inBuilding = (p: [number, number]) => footprints.some((r) => pointInPolygon([p[0] + E0, p[1] + N0], r));

describe('diagonalBands', () => {
  it('tiles the face exactly with alternating colours', () => {
    const bands = diagonalBands(1.0, 1.0, 2.4, 0.24);
    const area = bands.reduce((s, b) => s + Math.abs(polyArea(b.poly)), 0);
    expect(area).toBeCloseTo(2.4, 9);
    for (let i = 1; i < bands.length; i++) expect(bands[i].colour).not.toBe(bands[i - 1].colour);
  });
});

describe('courtPlan (Ehrenhof)', () => {
  it('finds the Ehrenhof', () => {
    expect(ehrenhof(spec, year)?.id).toBe(plan.courtId);
  });

  it('posts sentry boxes in pairs, one each side of a qualifying portal, outside every building', () => {
    expect(plan.sentries.length).toBeGreaterThanOrEqual(4);
    expect(plan.sentries.length % 2).toBe(0);
    const byBuilding = new Map<string, number>();
    for (const s of plan.sentries) byBuilding.set(s.buildingId, (byBuilding.get(s.buildingId) ?? 0) + 1);
    for (const n of byBuilding.values()) expect(n % 2).toBe(0);
    const W = COURT_FURNITURE.sentry.width;
    for (const s of plan.sentries) {
      expect(Math.hypot(...s.n)).toBeCloseTo(1, 6);
      expect(Number.isFinite(s.ground)).toBe(true);
      // the box's footprint corners stay out of the buildings
      const tg: [number, number] = [s.n[1], -s.n[0]];
      for (const [u, v] of [[-W / 2, -W / 2], [W / 2, -W / 2], [W / 2, W / 2], [-W / 2, W / 2]])
        expect(inBuilding([s.p[0] + tg[0] * u + s.n[0] * v, s.p[1] + tg[1] * u + s.n[1] * v])).toBe(false);
    }
    // no two boxes overlap
    for (let i = 0; i < plan.sentries.length; i++)
      for (let j = i + 1; j < plan.sentries.length; j++) expect(Math.hypot(plan.sentries[i].p[0] - plan.sentries[j].p[0], plan.sentries[i].p[1] - plan.sentries[j].p[1])).toBeGreaterThan(W);
  });

  it('flanks the passages with Prellsteine and runs a carriage lane into the court', () => {
    expect(plan.prellsteine.length).toBeGreaterThan(0);
    expect(plan.prellsteine.length % 2).toBe(0);
    for (const q of plan.prellsteine) expect(inBuilding(q.p)).toBe(false);
    expect(plan.lanes.length).toBeGreaterThan(0);
    const court = ehrenhof(spec, year)!;
    const ring = (court.geometry.coordinates as number[][][])[0] as EN[];
    for (const l of plan.lanes) {
      const mid: EN = [(l.a[0] + l.b[0]) / 2 + E0, (l.a[1] + l.b[1]) / 2 + N0];
      expect(pointInPolygon(mid, ring)).toBe(true);
    }
    // wave-4 review: the axis lane one carriage track wide, the cross lanes narrower, all flush with the court
    expect(plan.lanes[0].w).toBe(COURT_FURNITURE.lane.width);
    for (const l of plan.lanes.slice(1)) expect(l.w).toBe(COURT_FURNITURE.lane.crossWidth);
    expect(COURT_FURNITURE.lane.crossWidth).toBeLessThan(COURT_FURNITURE.lane.width);
    const level = ehrenhof(spec, year)!.level!;
    for (const l of plan.lanes) expect(l.h - level).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it('lane mesh: one upward quad per lane with the cobble frame attribute; material lit like the terrain', () => {
    const g = laneGeometry(plan.lanes);
    const pos = g.attributes.position;
    const lane = g.attributes.aLane;
    expect(pos.count).toBe(plan.lanes.length * 4);
    expect(lane.itemSize).toBe(4);
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)].map((k) => new THREE.Vector3().fromBufferAttribute(pos, k));
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      expect(n.y).toBeGreaterThan(0);
    }
    // across spans ±half width, half width = w / 2
    for (let k = 0; k < plan.lanes.length; k++) {
      expect(Math.abs(lane.getX(k * 4))).toBeCloseTo(plan.lanes[k].w / 2, 6);
      expect(lane.getZ(k * 4)).toBeCloseTo(plan.lanes[k].w / 2, 6);
    }
    expect(laneZone(0, 5, 1.6, 20)).toBe('cobble');
    expect(laneZone(1.5, 5, 1.6, 20)).toBe('edge');
    expect(laneZone(0, 0.1, 1.6, 20)).toBe('edge');
    const m = new THREE.MeshStandardMaterial();
    cobblePatch(m);
    expect(m.userData.groundLit).toBe(true);
    expect(m.roughness).toBeGreaterThanOrEqual(0.9);
    expect(m.metalness).toBe(0);
    expect(m.polygonOffset).toBe(true);
  });

  it('builds the furniture as meshes (striped boxes, stones, lanes) with a modest triangle count', () => {
    const ctx: BuildContext = { spec, lod: 1, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout };
    const r = buildCourtFurniture(ctx)!;
    expect(r).not.toBeNull();
    let tris = 0;
    const names = new Set<string>();
    r.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      names.add(m.name.split('/').pop()!);
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    expect([...names]).toEqual(expect.arrayContaining(['wood.shutter', 'roof.slate', 'ground.cobbles']));
    expect(tris).toBeLessThan(5000);
  });
});

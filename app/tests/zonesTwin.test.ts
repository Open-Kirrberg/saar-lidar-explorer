/**
 * Built twins (ADR 0042, contract „twin“): the `reference` role, the `twin` block, the badge, and the runtime's pure
 * twin plan (reference assets, nav hole policy, radial context fade, *Referenz* switch), plus the blocking walker.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { discoverableIn, parseZoneCatalogue } from '../src/zones/catalogue';
import { parseTwin, parseZoneManifest, validateZoneStrict, zoneBadge_de } from '../src/zones/contract';
import type { ZoneManifest } from '../src/zones/contract';
import { colliderPlan, fadeAt, referenceAssets, referenceMode, sceneAssets, twinFade, walkHoles } from '../src/zones/runtime/gltfPlan';
import { buildCollider, Walker } from '../src/zones/runtime/walk';

const dir = join(import.meta.dirname, 'fixtures/zones');
const read = (name: string): Record<string, any> => JSON.parse(readFileSync(join(dir, name, 'zone.json'), 'utf8'));
const parse = (json: unknown) => parseZoneManifest(json);
const twin = (): ZoneManifest => {
  const r = parse(read('twin'));
  expect(r.warnings).toEqual([]);
  return r.value!;
};

describe('zone contract: built twin', () => {
  it('the twin fixture is strictly valid; reference + twin parsed', () => {
    expect(validateZoneStrict(read('twin'))).toEqual([]);
    const m = twin();
    expect(m.assets.map((a) => [a.id, a.role])).toEqual([
      ['twin', 'scene'],
      ['nav', 'collider'],
      ['referenz', 'reference'],
    ]);
    expect(m.twin).toEqual({
      method: 'built-from-plan',
      plan: 'sle-raumplan/0.1',
      planVersion: 'v0',
      catalogue: 'bh-catalogue-v1',
      scaleFactor: 1,
      nav: 'nav',
      referenceScale: { factor: 1.04, pivotLocal: [600, 300, -600] },
    });
  });

  it('zones without a twin block parse as before (twin null)', () => {
    const r = parse(read('fixture'));
    expect(r.warnings).toEqual([]);
    expect(r.value!.twin).toBeNull();
  });

  it('drops invalid twin blocks with a warning, keeps the zone', () => {
    const j = read('twin');
    j.twin.method = 'guessed';
    const r = parse(j);
    expect(r.value).not.toBeNull();
    expect(r.value!.twin).toBeNull();
    expect(r.warnings.join()).toMatch(/twin: invalid/);
    const m = twin();
    const warns: string[] = [];
    expect(parseTwin({ ...read('twin').twin }, 'reconstructed', m.assets, null, (w) => warns.push(w))).toBeNull();
    expect(warns).toEqual(['twin: only for captured zones, ignored']);
  });

  it('twin.nav must name a collider; a bad referenceScale falls back to factor 1', () => {
    const j = read('twin');
    j.twin.nav = 'twin';
    j.twin.referenceScale = { factor: 9, pivotLocal: [0, 0, 0] };
    const r = parse(j);
    expect(r.value!.twin!.nav).toBeUndefined();
    expect(r.value!.twin!.referenceScale).toBeUndefined();
    expect(r.warnings).toHaveLength(2);
    expect(validateZoneStrict(j)).toHaveLength(2);
  });

  it('a twin with capture.scale ≠ 1 is flagged (built at true scale)', () => {
    const j = read('twin');
    j.capture.scale.factor = 1.1;
    expect(validateZoneStrict(j).join()).toMatch(/capture.scale.factor must be 1/);
  });

  it('badge: Nachbau for twins, else Aufnahme / Hypothese', () => {
    expect(zoneBadge_de(twin())).toBe('Nachbau');
    const cap = twin();
    expect(zoneBadge_de({ ...cap, twin: null })).toBe('Aufnahme');
    expect(zoneBadge_de(parse(read('fixture')).value!)).toBe('Hypothese');
  });

  // the generated package is git-ignored: checked only where it was built
  const pkg = join(import.meta.dirname, '../public/data/zones/baeckerei-heusser/zone.json');
  it.skipIf(!existsSync(pkg))('the generated bakery package parses without warnings', () => {
    const j = JSON.parse(readFileSync(pkg, 'utf8'));
    const r = parse(j);
    expect(r.warnings).toEqual([]);
    expect(validateZoneStrict(j)).toEqual([]);
    expect(zoneBadge_de(r.value!)).toBe('Nachbau');
    expect(walkHoles(r.value!)).toBe('block');
  });
  const catFile = join(import.meta.dirname, '../public/data/zones/baeckerei-heusser/built/catalogue.json');
  it.skipIf(!existsSync(catFile))('the generated bakery catalogue offers Morgens / Feierabend', () => {
    const warns: string[] = [];
    const c = parseZoneCatalogue(JSON.parse(readFileSync(catFile, 'utf8')), (w) => warns.push(w))!;
    expect(warns).toEqual([]);
    expect(c.fills!.states.map((s) => s.name_de)).toEqual(['Morgens', 'Feierabend']);
    const morning = discoverableIn(c, 'morgens');
    const evening = discoverableIn(c, 'feierabend');
    expect(morning.length).toBe(c.discoverable.length);
    expect(evening.every((id) => c.objects.has(id))).toBe(true);
    expect(evening.length).toBeGreaterThan(10);
  });
});

describe('gltf plan: built twin', () => {
  it('reference assets are neither drawn nor collide', () => {
    const m = twin();
    expect(sceneAssets(m).map((a) => a.id)).toEqual(['twin']);
    expect(colliderPlan(m).map((c) => c.asset.id)).toEqual(['nav']);
    expect(referenceAssets(m).map((a) => a.id)).toEqual(['referenz']);
  });

  it('blocks at holes only on a twin nav floor', () => {
    const m = twin();
    expect(walkHoles(m)).toBe('block');
    expect(walkHoles({ ...m, twin: null })).toBe('keep');
    expect(walkHoles({ ...m, twin: { ...m.twin!, nav: undefined } })).toBe('keep');
    // nav named but no collider asset: the scene collides, so keep
    expect(walkHoles({ assets: m.assets.filter((a) => a.role !== 'collider'), twin: m.twin })).toBe('keep');
  });

  it('fades radially inside the ground patch, only for twins', () => {
    const m = twin();
    const f = twinFade(m)!;
    expect(f.cx).toBeCloseTo(600, 9);
    expect(f.cz).toBeCloseTo(-600, 9);
    expect(f.r1).toBeCloseTo(28.5, 9); // 95 % of the 30 m half extent
    expect(f.r0).toBeCloseTo(28.5 - 11.4, 9);
    expect(fadeAt(f, 600, -600)).toBe(0);
    expect(fadeAt(f, 600 + f.r0, -600)).toBeCloseTo(0, 9);
    expect(fadeAt(f, 600 + (f.r0 + f.r1) / 2, -600)).toBeCloseTo(0.5, 9);
    expect(fadeAt(f, 630, -600)).toBe(1); // the patch edge is full haze
    expect(twinFade({ ...m, twin: null })).toBeNull();
    expect(twinFade({ ...m, assets: m.assets.map((a) => ({ ...a, bboxLocal: undefined })) })).toBeNull();
  });

  it('Referenz switch only behind ?referenz and only with a reference asset', () => {
    expect(referenceMode('', true)).toBe('off');
    expect(referenceMode('?referenz', true)).toBe('hidden');
    expect(referenceMode('?aoi=kirrberg&referenz=an', true)).toBe('shown');
    expect(referenceMode('?referenz=1', false)).toBe('off');
  });
});

describe('walk: exact nav floor (holes block)', () => {
  // a 4 × 4 m floor at y = 50, nothing around it
  const floor = () => {
    const g = new Group();
    const f = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    f.rotation.x = -Math.PI / 2;
    f.position.y = 50;
    g.add(f);
    g.updateMatrixWorld(true);
    return buildCollider(g)!;
  };

  it('stops at the edge instead of walking on in the air', () => {
    const w = new Walker(floor(), 0, undefined, 'block');
    w.settle(0, 0, 51.6);
    let x = 0;
    for (let i = 0; i < 100; i++) x = w.step(x, 0, x + 0.05, 0).x;
    expect(x).toBeLessThanOrEqual(2);
    expect(x).toBeGreaterThan(1.9);
    expect(w.groundY).toBeCloseTo(50, 5);
  });

  it('slides along the edge on a diagonal move', () => {
    const w = new Walker(floor(), 0, undefined, 'block');
    w.settle(1.98, 0, 51.6);
    let x = 1.98;
    let z = 0;
    for (let i = 0; i < 20; i++) ({ x, z } = w.step(x, z, x + 0.05, z - 0.05));
    expect(x).toBeLessThanOrEqual(2);
    expect(z).toBeCloseTo(-1, 5); // kept moving along z
  });

  it('the default (captures) still walks on over holes', () => {
    const w = new Walker(floor(), 0);
    expect(w.holes).toBe('keep');
    w.settle(0, 0, 51.6);
    let x = 0;
    for (let i = 0; i < 100; i++) x = w.step(x, 0, x + 0.05, 0).x;
    expect(x).toBeGreaterThan(4);
  });
});

describe('walk: the generated bakery nav floor', () => {
  const base = join(import.meta.dirname, '../public/data/zones/baeckerei-heusser/');
  const have = existsSync(join(base, 'built/nav.glb')) && existsSync(join(base, 'zone.json'));
  it.skipIf(!have)('random walks from the spawn never leave the floor; W from the spawn reaches the shop', async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    const { spawnLocal } = await import('../src/zones/runtime/gltfPlan');
    const m = parseZoneManifest(JSON.parse(readFileSync(join(base, 'zone.json'), 'utf8'))).value!;
    const buf = readFileSync(join(base, 'built/nav.glb'));
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const g = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    g.scene.updateMatrixWorld(true);
    const bvh = buildCollider(g.scene)!;
    const sp = m.spawns[m.portals[0]!.spawn]!;
    const [sx, sy, sz] = spawnLocal(sp, m.origin);
    const probe = new Walker(bvh, 0, undefined, 'block');
    // W from the spawn: up the steps into the shop (the floor rises ≥ 0.5 m)
    const w = new Walker(bvh, 0, undefined, 'block');
    const g0 = w.settle(sx, sz, sy);
    expect(Number.isNaN(probe.floorAt(sx, sz, g0))).toBe(false);
    const hr = (sp.heading_deg * Math.PI) / 180;
    let x = sx;
    let z = sz;
    for (let i = 0; i < 400; i++) ({ x, z } = w.step(x, z, x + Math.sin(hr) * 0.03, z - Math.cos(hr) * 0.03));
    expect(w.groundY - g0).toBeGreaterThan(0.5);
    // seeded random walks: every position keeps a floor under the feet
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 12; run++) {
      const v = new Walker(bvh, 0, undefined, 'block');
      v.settle(sx, sz, sy);
      let px = sx;
      let pz = sz;
      let dir = rnd() * Math.PI * 2;
      for (let i = 0; i < 1500; i++) {
        if (rnd() < 0.02) dir = rnd() * Math.PI * 2;
        ({ x: px, z: pz } = v.step(px, pz, px + Math.sin(dir) * 0.04, pz - Math.cos(dir) * 0.04));
        expect(Number.isNaN(probe.groundAt(px, pz, v.groundY + 0.5, 1.2))).toBe(false);
      }
    }
  });
});

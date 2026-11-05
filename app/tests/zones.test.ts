import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ZONE_BUDGET_LIMITS,
  budgetViolations,
  isSafeRelativePath,
  loadZones,
  parseZoneIndex,
  parseZoneManifest,
  validateZoneStrict,
} from '../src/zones/contract';
import type { Pose, ZoneManifest } from '../src/zones/contract';
import { normaliseRing, pointInRing, ringIsSimple, ringSignedArea } from '../src/zones/geometry';
import { PORTAL_HYSTERESIS, fallbackExitPose, pickLod, portalsInRange, updatePortalFocus } from '../src/zones/portal';
import { MSG_LOAD_FAILED, initialZoneSession, zoneSession } from '../src/zones/session';
import { FIXTURE } from '../scripts/fixture-terrain';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/zones/fixture/zone.json');
const raw = (): Record<string, any> => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const fixture = (): ZoneManifest => {
  const r = parseZoneManifest(raw());
  expect(r.warnings).toEqual([]);
  return r.value!;
};
const overworldPose: Pose = { E: 382640.5, N: 5466500.25, h: 355.3, heading_deg: 12.5, pitch_deg: -20, mode: 'fliegen' };

describe('zone contract: fixture', () => {
  it('is strictly valid (no warnings, budget within limits)', () => {
    expect(validateZoneStrict(raw())).toEqual([]);
  });

  it('lies inside the fixture AOI, with spawn inside the footprint', () => {
    const z = fixture();
    const inAoi = ([E, N]: [number, number]) => E > FIXTURE.E0 && E < FIXTURE.E0 + FIXTURE.width && N > FIXTURE.N0 && N < FIXTURE.N0 + FIXTURE.height;
    expect(z.footprint.every(inAoi)).toBe(true);
    expect(z.portals.every((p) => inAoi([p.E, p.N]))).toBe(true);
    const s = z.spawns.eingang!;
    expect(pointInRing(s.E, s.N, z.footprint)).toBe(true);
  });

  it('normalises the footprint (closing vertex dropped, CCW)', () => {
    const z = fixture();
    expect(z.footprint).toHaveLength(4);
    expect(ringSignedArea(z.footprint)).toBeCloseTo(1600);
  });
});

describe('zone contract: tolerance', () => {
  const bad = (mut: (j: Record<string, any>) => void) => {
    const j = raw();
    mut(j);
    return parseZoneManifest(j);
  };

  it.each([
    ['wrong format', (j: any) => (j.format = 'sle-zone-v2')],
    ['wrong crs', (j: any) => (j.crs = 'EPSG:4326')],
    ['invalid id', (j: any) => (j.id = 'Bad Id')],
    ['invalid kind', (j: any) => (j.kind = 'dream')],
    ['non-integer origin', (j: any) => (j.origin = { E0: 382000.5, N0: 5466000 })],
    ['footprint < 3 vertices', (j: any) => (j.footprint = [[382580, 5466580], [382620, 5466580]])],
    ['self-intersecting footprint', (j: any) => (j.footprint = [[382580, 5466580], [382640, 5466620], [382640, 5466580], [382580, 5466600]])],
    ['WGS84 footprint', (j: any) => (j.footprint = [[7.3, 49.3], [7.4, 49.3], [7.4, 49.4]])],
    ['no spawn', (j: any) => (j.spawns = {})],
    ['portal with unknown spawn', (j: any) => (j.portals[0].spawn = 'nirgends')],
    ['unknown runtime', (j: any) => (j.runtime = { kind: 'iframe' })],
    ['gltf without scene asset', (j: any) => (j.assets = j.assets.filter((a: any) => a.role !== 'scene'))],
    ['not an object', (j: any) => Object.keys(j).forEach((k) => delete j[k])],
  ])('%s → zone absent', (_name, mut) => {
    const r = bad(mut);
    expect(r.value).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
    if (_name === 'self-intersecting footprint') expect(r.warnings).toEqual(['footprint: self-intersecting']);
  });

  it('drops a bad portal but keeps the zone; duplicate ids drop', () => {
    const r = bad((j) => j.portals.push({ ...j.portals[0] }, { ...j.portals[0], id: 'x', radius_m: -1 }));
    expect(r.value!.portals.map((p) => p.id)).toEqual(['tuer']);
    expect(r.warnings).toHaveLength(2);
  });

  it('clamps radius, normalises facing, defaults label', () => {
    const r = bad((j) => Object.assign(j.portals[0], { radius_m: 5000, facing_deg: -90, label_de: undefined }));
    const p = r.value!.portals[0]!;
    expect([p.radius_m, p.facing_deg, p.label_de]).toEqual([2000, 270, 'Betreten']);
  });

  it('rejects unsafe asset paths and broken LOD chains per asset', () => {
    for (const path of ['../x.glb', '/abs.glb', 'https://evil/x.glb', 'a//b.glb', 'x.gltf']) expect(isSafeRelativePath(path) && path.endsWith('.glb')).toBe(false);
    const r = bad((j) => {
      j.assets[0].lods[0].path = '../escape.glb';
      j.assets[1].lods = [{ path: 'c.glb', until_m: 10 }]; // last level must be null
    });
    expect(r.value).toBeNull(); // no scene asset left → absent
    const r2 = bad((j) => (j.assets[1].lods = [{ path: 'c.glb', until_m: 10 }]));
    expect(r2.value!.assets.map((a) => a.id)).toEqual(['huette']);
  });

  it('skips unknown asset roles (forward compatible, e.g. splats)', () => {
    const r = bad((j) => j.assets.push({ id: 'spl', role: 'splat', lods: [{ path: 's.spz', until_m: null }] }));
    expect(r.value!.assets).toHaveLength(2);
  });

  it('module runtime needs a registered module when a registry is given', () => {
    const mod = (j: Record<string, any>) => (j.runtime = { kind: 'module', module: 'schloss-karlsberg' });
    expect(bad(mod).value!.runtime).toEqual({ kind: 'module', module: 'schloss-karlsberg' });
    const j = raw();
    mod(j);
    expect(parseZoneManifest(j, { modules: new Set(['other-module']) }).value).toBeNull();
    expect(parseZoneManifest(j, { modules: new Set(['schloss-karlsberg']) }).value).not.toBeNull();
  });

  it('defaults preset and evidence; ignores unknown keys', () => {
    const r = bad((j) => {
      delete j.preset;
      j.evidence = { kind: 'hypothesis', confidence: 'med' };
      j.extra = { anything: true };
    });
    expect(r.value!.preset).toEqual({ look: 'kino', sky: 'shared', trees: 'shared', timeOfDay: 'now' });
    expect(r.value!.evidence).toMatchObject({ perPart: 'none', disclaimer_de: 'Schauen, nicht graben.' });
    expect(r.warnings).toEqual([]);
  });

  it('captured zones need a capture block; reconstructed ones ignore it', () => {
    const cap = { date: '2026-10-30', method: 'photogrammetry-mesh', georef: { method: 'lod2+ortho', controlPoints: 8, rmsError_m: 0.15 }, privacy: 'keine Personen; Kennzeichen verpixelt' };
    const missing = bad((j) => {
      j.kind = 'captured';
      j.evidence.kind = 'capture';
    });
    expect(missing.value!.capture).toBeNull();
    expect(missing.warnings).toContain('capture: missing for a captured zone');
    const ok = bad((j) => {
      j.kind = 'captured';
      j.evidence.kind = 'capture';
      j.capture = cap;
    });
    expect(ok.value!.capture).toEqual(cap);
    expect(validateZoneStrict({ ...raw(), kind: 'captured', evidence: { ...raw().evidence, kind: 'capture' }, capture: cap })).toEqual([]);
  });

  it('attribution entries with ";" are dropped (display joins with "; ")', () => {
    const r = bad((j) => (j.attribution = ['A; B', 'C']));
    expect(r.value!.attribution).toEqual(['C']);
  });
});

describe('zone contract: budget', () => {
  it('flags limits and a first view larger than declared', () => {
    const z = fixture();
    expect(budgetViolations(z)).toEqual([]);
    z.budget = { ...z.budget!, triangles: ZONE_BUDGET_LIMITS.triangles + 1, downloadBytes: 10 };
    expect(budgetViolations(z)).toEqual([
      `budget.triangles ${ZONE_BUDGET_LIMITS.triangles + 1} > ${ZONE_BUDGET_LIMITS.triangles}`,
      'coarsest LODs (20000 B) exceed budget.downloadBytes',
    ]);
    expect(budgetViolations({ ...z, budget: null })).toEqual(['budget: missing']);
  });
});

describe('zone index + loader', () => {
  const index = { format: 'sle-zones-v1', zones: [{ id: 'fixture', bboxEN: [[382580, 5466560], [382620, 5466620]] }, { id: 'far', bboxEN: [[390000, 5470000], [390100, 5470100]] }, { id: 'fixture' }] };
  const aoi: [[number, number], [number, number]] = [[FIXTURE.E0, FIXTURE.N0], [FIXTURE.E0 + FIXTURE.width, FIXTURE.N0 + FIXTURE.height]];

  it('parses the index, dropping invalid and duplicate entries', () => {
    const r = parseZoneIndex(index);
    expect(r.value!.map((z) => z.id)).toEqual(['fixture', 'far']);
    expect(r.warnings).toHaveLength(1);
    expect(parseZoneIndex({ format: 'x' }).value).toBeNull();
  });

  it('loads only zones touching the AOI; 404s are not fatal', async () => {
    const requested: string[] = [];
    const files: Record<string, unknown> = { 'zones/index.json': index, 'zones/fixture/zone.json': raw() };
    const fetchJson = async (p: string) => {
      requested.push(p);
      if (!(p in files)) throw new Error('404');
      return files[p];
    };
    const zones = await loadZones(fetchJson, aoi);
    expect(zones.map((z) => [z.base, z.manifest.id])).toEqual([['zones/fixture/', 'fixture']]);
    expect(requested).toEqual(['zones/index.json', 'zones/fixture/zone.json']);
    expect(await loadZones(async () => Promise.reject(new Error('404')), aoi)).toEqual([]);
  });

  it('rejects a zone whose id does not match its folder', async () => {
    const warnings: string[] = [];
    const files: Record<string, unknown> = { 'zones/index.json': { format: 'sle-zones-v1', zones: [{ id: 'other', bboxEN: index.zones[0]!.bboxEN }] }, 'zones/other/zone.json': raw() };
    expect(await loadZones(async (p) => files[p], aoi, { warn: (m) => warnings.push(m) })).toEqual([]);
    expect(warnings).toEqual(['[zone other] id does not match its folder']);
  });
});

describe('geometry', () => {
  it('normalises orientation and rejects degenerate rings', () => {
    const cw: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(ringSignedArea(normaliseRing(cw)!)).toBeCloseTo(1);
    expect(normaliseRing([[0, 0], [1, 1], [2, 2]])).toBeNull();
    expect(normaliseRing([[0, 0], [0, 0], [1, 0]])).toBeNull();
  });
  it('detects self-intersection and point inclusion', () => {
    expect(ringIsSimple([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(true);
    expect(ringIsSimple([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(false);
    const L: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(pointInRing(0.5, 1.5, L)).toBe(true);
    expect(pointInRing(1.5, 1.5, L)).toBe(false);
  });
});

describe('portal proximity', () => {
  it('offers within radius, keeps it to radius × hysteresis, then drops it', () => {
    const zones = [fixture()];
    const p = zones[0]!.portals[0]!; // radius 60 at (382600, 5466570)
    expect(updatePortalFocus(null, zones, p.E, p.N - 61)).toBeNull();
    const f = updatePortalFocus(null, zones, p.E, p.N - 59)!;
    expect(f).toMatchObject({ zoneId: 'fixture', portalId: 'tuer', label_de: 'Hütte betreten' });
    expect(f.distance_m).toBeCloseTo(59);
    const kept = updatePortalFocus(f, zones, p.E, p.N - 60 * PORTAL_HYSTERESIS + 0.5);
    expect(kept?.portalId).toBe('tuer');
    expect(updatePortalFocus(kept, zones, p.E, p.N - 60 * PORTAL_HYSTERESIS - 0.5)).toBeNull();
  });

  it('sorts overlapping portals nearest first and sticks to the focused one', () => {
    const z = fixture();
    z.portals.push({ ...z.portals[0]!, id: 'hinten', N: z.portals[0]!.N + 50 });
    const at = (N: number) => portalsInRange([z], 382600, N).map((h) => h.portalId);
    expect(at(5466600)).toEqual(['hinten', 'tuer']);
    const f = updatePortalFocus(null, [z], 382600, 5466590)!;
    expect(f.portalId).toBe('tuer');
    expect(updatePortalFocus(f, [z], 382600, 5466610)!.portalId).toBe('tuer'); // no hopping
  });

  it('fallback exit pose stands in front of the portal looking back', () => {
    const z = fixture();
    const p = z.portals[0]!; // facing south (180°)
    const pose = fallbackExitPose(z, p, 300);
    expect(pose.E).toBeCloseTo(p.E);
    expect(pose.N).toBeCloseTo(p.N - 20); // max(20, 60/3)
    expect(pose).toMatchObject({ h: 330, heading_deg: 0, pitch_deg: -15, mode: 'fliegen' });
    expect(fallbackExitPose(z, p).h).toBeCloseTo(301.7 + 30); // no ground, portal h null → spawn h
  });

  it('picks the LOD by distance to the asset bbox', () => {
    const a = fixture().assets[0]!;
    expect(pickLod(a, [600, 300, -600]).path).toBe('huette/lod0.glb'); // inside
    expect(pickLod(a, [655, 300, -600]).path).toBe('huette/lod0.glb'); // 40 m
    expect(pickLod(a, [656, 300, -600]).path).toBe('huette/lod1.glb');
  });
});

describe('zone session: enter and leave the fixture zone', () => {
  it('overworld → loading → zone → exit restores the exact overworld pose and snapshot', () => {
    const z = fixture();
    let s = initialZoneSession<{ layers: string[] }>();
    const focus = updatePortalFocus(null, [z], overworldPose.E - 40, z.portals[0]!.N);
    expect(focus?.portalId).toBe('tuer');

    s = zoneSession(s, { type: 'enter', zone: z, portalId: focus!.portalId, pose: overworldPose, snapshot: { layers: ['ortho'] } });
    expect(s).toMatchObject({ phase: 'loading', zoneId: 'fixture', spawn: z.spawns.eingang });
    s = zoneSession(s, { type: 'loaded', zoneId: 'fixture' });
    expect(s.phase).toBe('zone');
    s = zoneSession(s, { type: 'exit' });
    expect(s).toEqual({ phase: 'overworld', restorePose: overworldPose, restoreSnapshot: { layers: ['ortho'] }, message: null });
    s = zoneSession(s, { type: 'restored' });
    expect(s).toEqual(initialZoneSession());
  });

  it('saved pose is a copy (later camera moves do not leak in)', () => {
    const z = fixture();
    const pose = { ...overworldPose };
    let s = zoneSession(initialZoneSession(), { type: 'enter', zone: z, portalId: 'tuer', pose });
    pose.E = 0;
    s = zoneSession(zoneSession(s, { type: 'loaded', zoneId: 'fixture' }), { type: 'exit' });
    expect(s.phase === 'overworld' && s.restorePose!.E).toBe(overworldPose.E);
  });

  it('load failure and cancel return to the saved pose', () => {
    const z = fixture();
    const loading = zoneSession(initialZoneSession(), { type: 'enter', zone: z, portalId: 'tuer', pose: overworldPose });
    expect(zoneSession(loading, { type: 'failed', zoneId: 'fixture' })).toMatchObject({ phase: 'overworld', restorePose: overworldPose, message: MSG_LOAD_FAILED });
    expect(zoneSession(loading, { type: 'cancel' })).toMatchObject({ phase: 'overworld', restorePose: overworldPose, message: null });
    expect(zoneSession(loading, { type: 'failed', zoneId: 'other' })).toBe(loading);
  });

  it('deep link (no saved pose) exits to the fallback pose', () => {
    const z = fixture();
    let s = zoneSession(initialZoneSession(), { type: 'enter', zone: z, portalId: 'tuer', pose: null, groundH: 300 });
    s = zoneSession(zoneSession(s, { type: 'loaded', zoneId: 'fixture' }), { type: 'exit' });
    expect(s).toMatchObject({ phase: 'overworld', restorePose: fallbackExitPose(z, z.portals[0]!, 300) });
  });

  it('ignores events that do not apply (same object back)', () => {
    const z = fixture();
    const o = initialZoneSession();
    for (const ev of [{ type: 'loaded', zoneId: 'fixture' }, { type: 'exit' }, { type: 'cancel' }, { type: 'restored' }] as const) {
      expect(zoneSession(o, ev)).toBe(o);
    }
    expect(zoneSession(o, { type: 'enter', zone: z, portalId: 'nope', pose: overworldPose })).toBe(o);
    const loading = zoneSession(o, { type: 'enter', zone: z, portalId: 'tuer', pose: overworldPose });
    expect(zoneSession(loading, { type: 'enter', zone: z, portalId: 'tuer', pose: overworldPose })).toBe(loading);
    expect(zoneSession(loading, { type: 'loaded', zoneId: 'other' })).toBe(loading);
  });
});

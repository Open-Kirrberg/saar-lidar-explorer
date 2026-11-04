/** V2.6b: overworld ↔ zone flow (portal prompt, loading, mount, exit, cancel, errors), built-in Testraum, restore. */
import { describe, expect, it, vi } from 'vitest';
import type { Pose, ZoneManifest } from '../src/zones/contract';
import { pointInRing } from '../src/zones/geometry';
import { validateZoneStrict } from '../src/zones/contract';
import { PORTAL_HYSTERESIS } from '../src/zones/portal';
import { MSG_LOAD_FAILED } from '../src/zones/session';
import type { ZoneHandle, ZoneModule, ZoneMountContext } from '../src/zones/runtime/api';
import { TESTRAUM_JSON, builtinZones, builtinZonesEnabled } from '../src/zones/runtime/builtin';
import { collideCircle } from '../src/zones/runtime/collide';
import { mergeZones, portalInfos, promptText } from '../src/zones/runtime/feature';
import { MSG_FRAME_FAILED, MSG_NO_RUNTIME, createPortalPrompter, createZoneFlow } from '../src/zones/runtime/flow';
import type { ZoneFlowDeps } from '../src/zones/runtime/flow';
import { markerScale, portalDisplayY } from '../src/zones/runtime/marker';
import { zoneModuleNames } from '../src/zones/runtime/modules';
import { overworldPose, restoreRig, rigSnapshot } from '../src/zones/runtime/overworld';
import type { CameraRig, RawPose } from '../src/zones/runtime/overworld';
import { testRoomWalls } from '../src/zones/runtime/testRoom';

const zone = (): ZoneManifest => builtinZones()[0]!;
const PORTAL = 'tuer';

/** Deferred promise. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

function fakeHandle(over: Partial<ZoneHandle> = {}) {
  const h = { enter: vi.fn(), exit: vi.fn(), frame: vi.fn(), resize: vi.fn(), dispose: vi.fn(), ...over };
  return h as typeof h & ZoneHandle;
}

/** Fake host: a mutable overworld camera pose + a log of every side effect. */
function host(mod: () => Promise<ZoneModule>) {
  const log: string[] = [];
  let cam: Pose = { E: 382460.25, N: 5466230.5, h: 331.75, heading_deg: 17.5, pitch_deg: -12, mode: 'fliegen' };
  let frameFn: ((dt: number) => void) | null = null;
  const restored: Array<{ pose: Pose; snap: unknown }> = [];
  const messages: string[] = [];
  const progress: Array<number | null> = [];
  let loadingOpen = 0;
  let chromeOpen = 0;
  let size: [number, number] = [800, 600];
  const deps: ZoneFlowDeps<{ tag: string }> = {
    overworld: {
      pose: () => ({ ...cam }),
      snapshot: () => ({ tag: 'layers' }),
      restore: (pose, snap) => {
        restored.push({ pose, snap });
        cam = { ...pose };
      },
      freeze: (on) => log.push(`freeze:${on}`),
    },
    loadModule: () => mod(),
    mountContext: () => ({
      container: {} as HTMLElement,
      renderer: {} as ZoneMountContext['renderer'],
      baseUrl: 'data/zones/testraum/',
      manifest: zone(),
      release: () => log.push('release'),
    }),
    loading: () => {
      loadingOpen++;
      return { progress: (p) => void progress.push(p), close: () => void loadingOpen-- };
    },
    chrome: () => {
      chromeOpen++;
      return { close: () => void chromeOpen-- };
    },
    ownFrames: (fn) => {
      frameFn = fn;
      log.push(fn ? 'own' : 'release-frames');
    },
    viewSize: () => size,
    message: (t) => void messages.push(t),
    warn: () => {},
  };
  return {
    deps,
    log,
    restored,
    messages,
    progress,
    get cam() {
      return cam;
    },
    moveCamera: (p: Partial<Pose>) => (cam = { ...cam, ...p }),
    tick: (dt = 1 / 60) => frameFn?.(dt),
    get frameOwned() {
      return frameFn !== null;
    },
    setSize: (s: [number, number]) => (size = s),
    get loadingOpen() {
      return loadingOpen;
    },
    get chromeOpen() {
      return chromeOpen;
    },
  };
}

describe('zone flow: enter and leave restores the overworld pose', () => {
  it('portal → loading → zone → Verlassen → overworld at the exact saved pose', async () => {
    const handle = fakeHandle();
    let ctx: ZoneMountContext | null = null;
    const h = host(async () => ({
      mountZone: async (c) => {
        ctx = c;
        c.onProgress('Wände', 0.5);
        return handle;
      },
    }));
    const flow = createZoneFlow(h.deps);
    const saved = { ...h.cam };
    const entering = flow.enter(zone(), PORTAL);
    expect(flow.state().phase).toBe('loading');
    expect(h.log).toEqual(['freeze:true', 'own']);
    expect(h.loadingOpen).toBe(1);
    await entering;

    expect(flow.state().phase).toBe('zone');
    expect(h.loadingOpen).toBe(0);
    expect(h.chromeOpen).toBe(1);
    expect(h.progress[0]).toBe(0);
    expect(h.progress).toContain(0.1 + 0.9 * 0.5);
    expect(ctx!.signal.aborted).toBe(false);
    expect(handle.resize).toHaveBeenCalledWith(800, 600);
    expect(handle.enter).toHaveBeenCalledWith(zone().spawns.eingang);

    // Zone frames: the handle renders; a viewport change resizes once.
    h.tick();
    h.setSize([390, 844]);
    h.tick();
    h.tick();
    expect(handle.frame).toHaveBeenCalledTimes(3);
    expect(handle.resize).toHaveBeenLastCalledWith(390, 844);
    expect(handle.resize).toHaveBeenCalledTimes(2);

    // Something moves the overworld camera meanwhile (touch, hash) — restore still wins.
    h.moveCamera({ E: 1, N: 2, h: 3 });
    flow.exit();
    expect(flow.state()).toEqual({ phase: 'overworld', restorePose: null, restoreSnapshot: null, message: null });
    expect(h.restored).toEqual([{ pose: saved, snap: { tag: 'layers' } }]);
    expect(h.cam).toEqual(saved);
    expect(handle.exit).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(h.chromeOpen).toBe(0);
    expect(h.frameOwned).toBe(false);
    expect(h.log.slice(-3)).toEqual(['release-frames', 'release', 'freeze:false']);
    expect(h.messages).toEqual([]);
  });

  it('a zone can ask to leave (ctx.onExit) and can be entered again', async () => {
    let ctx: ZoneMountContext | null = null;
    const h = host(async () => ({ mountZone: async (c) => ((ctx = c), fakeHandle()) }));
    const flow = createZoneFlow(h.deps);
    await flow.enter(zone(), PORTAL);
    ctx!.onExit();
    expect(flow.state().phase).toBe('overworld');
    await flow.enter(zone(), PORTAL);
    expect(flow.state().phase).toBe('zone');
    expect(h.restored).toHaveLength(1);
  });

  it('ignores enter while busy and unknown portals', async () => {
    const h = host(async () => ({ mountZone: async () => fakeHandle() }));
    const flow = createZoneFlow(h.deps);
    await flow.enter(zone(), 'nope');
    expect(flow.state().phase).toBe('overworld');
    const p = flow.enter(zone(), PORTAL);
    await flow.enter(zone(), PORTAL); // second press while loading: no-op
    await p;
    expect(h.log.filter((l) => l === 'freeze:true')).toHaveLength(1);
  });

  it('module zones without chrome (hostChrome false) get none', async () => {
    const h = host(async () => ({ mountZone: async () => fakeHandle(), hostChrome: false }));
    const flow = createZoneFlow(h.deps);
    await flow.enter(zone(), PORTAL);
    expect(h.chromeOpen).toBe(0);
  });
});

describe('zone flow: cancel and errors go back to the overworld', () => {
  it('Abbrechen while the module chunk loads: back at the pose, mount never runs', async () => {
    const chunk = later<ZoneModule>();
    const mount = vi.fn(async () => fakeHandle());
    const h = host(() => chunk.promise);
    const flow = createZoneFlow(h.deps);
    const saved = { ...h.cam };
    const p = flow.enter(zone(), PORTAL);
    flow.cancel();
    expect(flow.state().phase).toBe('overworld');
    expect(h.restored[0]!.pose).toEqual(saved);
    expect(h.loadingOpen).toBe(0);
    expect(h.frameOwned).toBe(false);
    chunk.resolve({ mountZone: mount });
    await p;
    expect(mount).not.toHaveBeenCalled();
    expect(h.messages).toEqual([]);
  });

  it('cancel while mounting aborts the signal and disposes the late handle', async () => {
    const mounted = later<ZoneHandle>();
    const handle = fakeHandle();
    let signal: AbortSignal | null = null;
    const h = host(async () => ({ mountZone: (c) => ((signal = c.signal), mounted.promise) }));
    const flow = createZoneFlow(h.deps);
    const p = flow.enter(zone(), PORTAL);
    await Promise.resolve();
    await Promise.resolve();
    flow.exit(); // Esc during loading = cancel
    expect(signal!.aborted).toBe(true);
    mounted.resolve(handle);
    await p;
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(handle.enter).not.toHaveBeenCalled();
    expect(flow.state().phase).toBe('overworld');
  });

  it('a failing chunk import shows one German message and restores the pose', async () => {
    const h = host(() => Promise.reject(new Error('chunk 404')));
    const flow = createZoneFlow(h.deps);
    const saved = { ...h.cam };
    await flow.enter(zone(), PORTAL);
    expect(flow.state().phase).toBe('overworld');
    expect(h.messages).toEqual([MSG_LOAD_FAILED]);
    expect(h.restored[0]!.pose).toEqual(saved);
    expect(h.log.slice(-2)).toEqual(['release-frames', 'freeze:false']);
  });

  it('a missing runtime uses its own message; mount errors release the container', async () => {
    const h = host(() => Promise.reject(Object.assign(new Error('x'), { userMessage: MSG_NO_RUNTIME })));
    await createZoneFlow(h.deps).enter(zone(), PORTAL);
    expect(h.messages).toEqual([MSG_NO_RUNTIME]);

    const h2 = host(async () => ({ mountZone: () => Promise.reject(new Error('glb broken')) }));
    await createZoneFlow(h2.deps).enter(zone(), PORTAL);
    expect(h2.messages).toEqual([MSG_LOAD_FAILED]);
    expect(h2.log).toContain('release');
  });

  it('a zone that throws in frame() is left with a message, never stuck', async () => {
    const handle = fakeHandle({
      frame: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    const h = host(async () => ({ mountZone: async () => handle }));
    const flow = createZoneFlow(h.deps);
    const saved = { ...h.cam };
    await flow.enter(zone(), PORTAL);
    h.tick();
    expect(flow.state().phase).toBe('overworld');
    expect(h.messages).toEqual([MSG_FRAME_FAILED]);
    expect(h.cam).toEqual(saved);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('portal prompt (hysteresis)', () => {
  it('offers within radius, keeps it to radius × 1.1, closes beyond, never auto-enters', () => {
    const z = zone();
    const p = z.portals[0]!;
    const shown: string[] = [];
    let open = 0;
    const prompter = createPortalPrompter(
      () => [z],
      (f) => {
        shown.push(f.portalId);
        open++;
        return { close: () => void open-- };
      },
    );
    const at = (d: number) => prompter.update(p.E, p.N - d); // walk in from the south
    expect(at(p.radius_m * 2)).toBeNull();
    expect(at(p.radius_m * 1.05)).toBeNull(); // inside the hysteresis band but never offered
    expect(at(p.radius_m)?.portalId).toBe(PORTAL);
    expect(at(p.radius_m * 0.2)?.portalId).toBe(PORTAL);
    expect(at(p.radius_m * 1.08)?.portalId).toBe(PORTAL); // kept
    expect(shown).toHaveLength(1);
    expect(open).toBe(1);
    expect(at(p.radius_m * PORTAL_HYSTERESIS + 0.5)).toBeNull();
    expect(open).toBe(0);
    at(p.radius_m * 0.5);
    expect(shown).toHaveLength(2);
    prompter.close(); // entering
    expect(open).toBe(0);
    at(p.radius_m * 0.5); // back from the zone, still in range: offered again
    expect(open).toBe(1);
  });
});

describe('overworld pose save/restore', () => {
  const origin = { E0: 378000, N0: 5460000 };
  const rig = (raw: RawPose): CameraRig & { raw: RawPose } => ({
    raw: { ...raw },
    speedMultiplier: 2,
    getPose() {
      return { ...this.raw };
    },
    setPose(p) {
      this.raw = { ...this.raw, ...p };
    },
  });
  const exagT = (exag: number, hRef = 300) => ({
    toDisplayY: (h: number) => hRef + (h - hRef) * exag,
    fromDisplayY: (y: number) => hRef + (y - hRef) / exag,
  });

  it('restores the raw camera bit-exactly when the exaggeration is unchanged', () => {
    const r = rig({ x: 4450.123456789, y: 412.987654321, z: -6230.5, heading: 33.3, pitch: -21.7 });
    const t = exagT(1.7);
    const pose = overworldPose(r, t, origin, true);
    expect(pose.mode).toBe('gehen');
    const snap = rigSnapshot(r, 1.7);
    r.setPose({ x: 0, y: 0, z: 0, heading: 0, pitch: 0 });
    r.speedMultiplier = 9;
    restoreRig(r, t, origin, pose, snap, 1.7);
    expect(r.raw).toStrictEqual(snap.raw);
    expect(r.speedMultiplier).toBe(2);
  });

  it('keeps the true height when the exaggeration changed meanwhile', () => {
    const r = rig({ x: 4450, y: 500, z: -6230, heading: 10, pitch: -5 });
    const pose = overworldPose(r, exagT(2), origin, false);
    restoreRig(r, exagT(1), origin, pose, rigSnapshot(r, 2), 1);
    expect(r.raw.y).toBeCloseTo(pose.h, 9);
    expect(r.raw.x).toBeCloseTo(4450, 9);
    expect(r.raw.z).toBeCloseTo(-6230, 9);
  });
});

describe('built-in Testraum + portal markers', () => {
  it('is a strictly valid sle-zone-v1 package with a registered module', () => {
    expect(validateZoneStrict(TESTRAUM_JSON, { modules: zoneModuleNames() })).toEqual([]);
    expect(builtinZones()).toHaveLength(1);
  });

  it('lies inside the fixture and the overall AOI; spawn inside the footprint, portal outside', () => {
    const z = zone();
    const p = z.portals[0]!;
    for (const a of [
      { E0: 382000, N0: 5466000, w: 1000, h: 1000 },
      { E0: 378000, N0: 5460000, w: 6000, h: 8000 },
    ]) {
      expect(p.E > a.E0 && p.E < a.E0 + a.w && p.N > a.N0 && p.N < a.N0 + a.h).toBe(true);
    }
    expect(pointInRing(z.spawns.eingang!.E, z.spawns.eingang!.N + 6, z.footprint)).toBe(true); // 6 m in through the door
    expect(pointInRing(p.E, p.N, z.footprint)).toBe(false);
  });

  it('shows in dev, with ?aoi=fixture or ?testraum only', () => {
    expect(builtinZonesEnabled({ dev: false, aoi: 'overall', search: '' })).toBe(false);
    expect(builtinZonesEnabled({ dev: true, aoi: 'overall', search: '' })).toBe(true);
    expect(builtinZonesEnabled({ dev: false, aoi: 'fixture', search: '' })).toBe(true);
    expect(builtinZonesEnabled({ dev: false, aoi: 'overall', search: '?testraum' })).toBe(true);
  });

  it('merges built-ins with fetched zones (fetched wins) and drops zones without a runtime', () => {
    const warn = vi.fn();
    const fetched = { ...zone(), name_de: 'Aus dem Paket' };
    const gltf = { ...zone(), id: 'laden', runtime: { kind: 'gltf' as const } };
    const merged = mergeZones([zone()], [fetched, gltf], warn);
    expect(merged.map((z) => z.name_de)).toEqual(['Aus dem Paket']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(promptText(zone())).toBe('Testraum betreten');
    expect(portalInfos(merged)[0]).toMatchObject({ zoneId: 'testraum', portalId: PORTAL, radius_m: 40, facing_deg: 180 });
  });

  it('walls stop the visitor; the door lets them in', () => {
    const walls = testRoomWalls();
    // Spawn is 13 m south of the room centre (z = +13); walk straight north through the door.
    let pos = { x: 0, z: 13 };
    for (let i = 0; i < 400; i++) pos = collideCircle(pos.x, pos.z - 0.05, 0.35, walls);
    expect(pos.z).toBeCloseTo(-1.6 + 0.35, 6); // inside, stopped by the table
    // Off-centre (x = 3) the south wall blocks.
    pos = { x: 3, z: 13 };
    for (let i = 0; i < 400; i++) pos = collideCircle(pos.x, pos.z - 0.05, 0.35, walls);
    expect(pos.z).toBeGreaterThan(8);
  });

  it('marker height follows the exaggeration rule; scale grows with distance', () => {
    const t = { surfaceY: () => 777, toDisplayY: (h: number) => 300 + (h - 300) * 2 };
    expect(portalDisplayY({ h: null }, 0, 0, t)).toBe(777);
    expect(portalDisplayY({ h: 310 }, 0, 0, t)).toBe(320);
    expect(markerScale(10)).toBe(1);
    expect(markerScale(1000)).toBe(4);
    expect(markerScale(1e6)).toBe(8);
  });
});

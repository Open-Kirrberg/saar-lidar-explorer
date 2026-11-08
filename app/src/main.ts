import { PerspectiveCamera, Raycaster, Scene, Timer, Vector2, WebGLRenderer } from 'three';
import type { Vector3 } from 'three';
import { DroneController } from './controls/DroneController';
import type { FlyToOptions } from './controls/DroneController';
import { TouchController } from './controls/TouchController';
import type { NavigationMode } from './controls/TouchController';
import { DecodePool } from './data/DecodePool';
import { loadManifest, stripAvif } from './data/manifest';
import { catalogUrl } from './data/urls';
import { openCatalogSession, startPlace } from './catalog';
import type { CatalogSession } from './catalog';
import type { Manifest } from './data/manifest';
import { utmToWorld, worldToUtm } from './geo';
import { getLocate } from './locate';
import { bindHash, createStore, hashDisplayPatch, normDeg, parseHash } from './state';
import type { AppState, Store } from './state';
import { createSky } from './terrain/Sky';
import { installTrees } from './trees';
import { installPlaceContent } from './catalog/placeContent';
import { registerPlaceHint } from './catalog/placeHint';
import { Terrain } from './terrain/Terrain';
import type { StreamStats } from './terrain/Terrain';
import { resolveStartAoi } from './ui/startAoi';
import { bindDisplayState } from './ui/displayState';
import { createRefinedFlyTo } from './ui/flyTo';
import { browserStorage, loadSettings, saveSettings, settingsStatePatch } from './ui/settings';
import type { LoadProgressLike } from './ui/streaming';
import { createSettingsRuntime, createShell } from './shell/Shell';
import { registerLens } from './lens';
import type { ShellApi } from './shell/types';
import { registerZones } from './zones/runtime/feature';
import { registerPlaceStats } from './places';
import { installTutorial } from './tutorial/Tutorial';
import type { ZonesApi } from './zones/runtime/feature';
import './ui/style.css';

/** Everything other modules (minimap, markers, POIs) need. Also exposed as `window.sle`. */
export interface AppContext {
  manifest: Manifest;
  store: Store<AppState>;
  terrain: Terrain;
  controller: DroneController;
  camera: PerspectiveCamera;
  scene: Scene;
  renderer: WebGLRenderer;
  /** Fly the camera to UTM E/N (see DroneController.flyTo). */
  flyTo(E: number, N: number, opts?: FlyToOptions): Promise<boolean>;
  /** Terrain hit under a client (CSS px) position, with UTM + true height. */
  pickAt(clientX: number, clientY: number): { point: Vector3; E: number; N: number; h: number } | null;
  /**
   * Debug/verification: advance `frames` frames of `dt` seconds synchronously (controller, LOD,
   * render, store sync). Lets automated checks render while the tab is hidden and rAF is paused.
   */
  step(frames?: number, dt?: number): void;
  /** F9 streaming stats: chunks per level (resident/drawn), est. GPU MiB, queue, in flight. */
  terrainStats(): StreamStats;
  /** F20 touch navigation (map gestures for touch pointers; long-press context action). */
  touch: TouchController;
  /** F20: 'touch' = map gestures for fingers (default), 'drone' = fingers drag-look like the mouse. */
  setNavigationMode(mode: NavigationMode): void;
  /**
   * v2 shell (ADR 0032): tiers, feature registry, slots (minimap, lens, overlay, tutorial),
   * dialogs, prompt / loading screen. See app/README.md „Shell“.
   */
  shell: ShellApi;
  /** Run `cb(dt)` every frame right after the controller update (before render). Returns an unsubscribe. */
  onFrame(cb: (dt: number) => void): () => void;
  /**
   * V2.6b zones: while set, `owner(dt)` runs instead of the overworld frame (no controller, streaming,
   * frame hooks, render or store sync), on the same rAF / `step()`. null = overworld again.
   */
  setFrameOwner(owner: ((dt: number) => void) | null): void;
  /** True once the first terrain is on screen (`sle:ready` fired). */
  ready?: boolean;
  /** V2.6b: zone portals + enter/exit (src/zones/runtime/feature.ts); set while the feature is mounted. */
  zones?: ZonesApi;
  /** S2 catalog mode (many places): catalog, overview, place manifests; absent in single-AOI mode. */
  catalog?: CatalogSession;
}

/** Shown once when the browser cannot decode AVIF (contract "Slim formats", ADR 0056). */
export const AVIF_HINT_DE = 'Dieser Browser kann AVIF nicht anzeigen – Luftbild und einige Reliefansichten fehlen.';

declare global {
  interface Window {
    sle?: AppContext;
  }
}

const START_AGL = 150;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

async function main(): Promise<void> {
  const loading = $('#loading');
  // Decode workers first: the AVIF probe decides which `.avif` layers exist (S2, ADR 0056).
  const pool = new DecodePool();
  const avif = await pool.avifSupported();
  let avifMissing = false;
  const noteAvif = () => {
    avifMissing = true;
  };
  // S2: catalog mode when VITE_CATALOG_URL is set and the URL has no ?aoi= (contract "Many places").
  let catalog: CatalogSession | undefined;
  const catUrl = catalogUrl();
  if (catUrl) {
    try {
      const h = parseHash(location.hash);
      catalog = await openCatalogSession(catUrl, { avif, start: h ? { E: h.E, N: h.N } : undefined, onAvifMissing: noteAvif });
    } catch (err) {
      console.warn(`[catalog] ${String(err)} → single-AOI mode`);
    }
  }
  let loaded;
  try {
    loaded = catalog
      ? { manifest: catalog.manifest, baseUrl: catalog.baseUrl, fellBack: false }
      : await loadManifest(await resolveStartAoi()); // F9: 'overall' if present, ?aoi= wins
  } catch (err) {
    loading.textContent = String(err instanceof Error ? err.message : err);
    loading.classList.add('error');
    return;
  }
  const { manifest, baseUrl, fellBack } = loaded;
  if (!catalog && !avif && stripAvif(manifest) > 0) noteAvif();
  const origin = manifest.origin;

  // ---- renderer / scene -------------------------------------------------------------------
  const viewport = $('#viewport');
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewport.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;

  const camera = new PerspectiveCamera(60, 1, 0.5, 40000);
  const scene = new Scene();
  const sky = createSky(30000);
  scene.add(sky);

  // Catalog mode: one session origin (= manifest.origin of the session rectangle), places placed by
  // their offset through the resolver, one hRef = catalog height_ref_m.
  const terrain = new Terrain(manifest, baseUrl, pool, catalog ? { resolver: catalog.resolver, hRef: catalog.hRef, coverage: catalog.coverage } : {});
  terrain.imageAnisotropy = renderer.capabilities.getMaxAnisotropy();
  terrain.renderer = renderer; // GPU apron patches for image layers (seam fix), all tiers
  scene.add(terrain);

  const store = createStore({ layer: terrain.defaultDisplay() });
  // collisionGround = DTM: flying passes through the canopy (ADR 0020).
  const controller = new DroneController(camera, renderer.domElement, terrain.collisionGround, origin, {
    fallbackGround: manifest.heightRange.min,
  });

  const resize = () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(viewport);
  resize();

  // ---- store → terrain ----------------------------------------------------------------------
  const deg = Math.PI / 180;
  const applyRender = (s: Readonly<AppState>) => {
    terrain.setDisplay(s.layer, s.colormap);
    terrain.uniforms.uSunAz.value = s.sunAzimuth * deg;
    terrain.uniforms.uSunEl.value = s.sunElevation * deg;
    terrain.uniforms.uSunDirs.value = Math.round(s.sunDirections);
  };
  store.subscribe(applyRender, ['layer', 'colormap', 'sunAzimuth', 'sunElevation', 'sunDirections']);
  store.subscribe(
    (s) => {
      // Keep the camera's true height when the exaggeration changes.
      const trueH = terrain.fromDisplayY(camera.position.y);
      terrain.uniforms.uExag.value = s.exaggeration;
      controller.setPose({ y: terrain.toDisplayY(trueH) });
    },
    ['exaggeration'],
  );

  // ---- initial pose: URL hash or AOI centre ----------------------------------------------------
  const startW = catalog ? utmToWorld(catalog.start.E, catalog.start.N, origin) : null;
  const cx = startW ? startW.x : manifest.size.width / 2;
  const cz = startW ? startW.z : -manifest.size.height / 2;
  const fromHash = parseHash(location.hash);
  // Overlay/forest live in Terrain; mirror them into the store (URL hash) and back (R0.6).
  bindDisplayState(store, terrain);
  const isValidLayer = (key: string) => terrain.isValidDisplay(key);
  // Saved settings (final polish) are the start-up defaults; the URL hash wins over them.
  const kv = browserStorage();
  const settings = createSettingsRuntime(kv, loadSettings(kv), saveSettings);
  store.set(settingsStatePatch(settings.get(), isValidLayer), 'settings');
  if (settings.get().baseSpeed !== undefined) controller.opts.baseSpeed = settings.get().baseSpeed!;
  if (settings.get().minClearance !== undefined) controller.opts.minClearance = settings.get().minClearance!;
  if (fromHash) store.set(hashDisplayPatch(fromHash, { isValidLayer }), 'hash');
  applyRender(store.get());

  const applyHashPose = (p: { E: number; N: number; h: number; heading: number; pitch: number }) => {
    const w = utmToWorld(p.E, p.N, origin);
    controller.setPose({ x: w.x, z: w.z, y: terrain.toDisplayY(p.h), heading: p.heading, pitch: p.pitch });
  };
  // Provisional pose until heights are known.
  if (fromHash) applyHashPose(fromHash);
  else controller.setPose({ x: cx, z: cz, y: manifest.heightRange.max + START_AGL, heading: 0, pitch: -25 });

  store.subscribe(
    (s, _changed, source) => {
      if (source === 'hash') applyHashPose(s);
    },
    ['E', 'N', 'h', 'heading', 'pitch'],
  );

  // F9: loading never blocks once the first terrain is drawable; the rest shows in the HUD.
  let loadProgress: LoadProgressLike | null = null;
  let loadDone = false;

  const lockHint = $('#lock-hint');
  const crosshair = document.createElement('div');
  crosshair.id = 'crosshair';
  crosshair.hidden = true;
  $('#app').appendChild(crosshair);
  controller.onLockChange((locked) => {
    lockHint.hidden = !locked;
    crosshair.hidden = !locked;
  });

  // ---- picking --------------------------------------------------------------------------------
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const pickAt: AppContext['pickAt'] = (clientX, clientY) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const point = terrain.intersectRay(raycaster.ray);
    if (!point) return null;
    const { E, N } = worldToUtm(point.x, point.z, origin);
    return { point, E, N, h: terrain.heightAt(point.x, point.z) };
  };

  // F20: touch gestures drive the same controller pose (exaggeration-aware picks via pickAt).
  const touch = new TouchController(controller, renderer.domElement, (x, y) => pickAt(x, y)?.point ?? null, terrain);

  const frameHooks = new Set<(dt: number) => void>();
  let frameOwner: ((dt: number) => void) | null = null;
  const ctx: AppContext = {
    setFrameOwner(owner) {
      frameOwner = owner;
    },
    shell: null as unknown as ShellApi, // set right below, before any feature mounts
    onFrame(cb) {
      frameHooks.add(cb);
      return () => frameHooks.delete(cb);
    },
    manifest,
    store,
    terrain,
    controller,
    camera,
    scene,
    renderer,
    pickAt,
    terrainStats: () => terrain.streamStats(),
    touch,
    setNavigationMode: (mode) => touch.setNavigationMode(mode),
    flyTo: catalogFlyTo(catalog, createRefinedFlyTo(controller, terrain, origin)), // re-aims when finer terrain arrives (F9)
    step: (frames = 1, dt = 1 / 60) => {
      for (let i = 0; i < frames; i++) frame(dt);
      window.dispatchEvent(new Event('sle:step')); // rAF-driven overlays (Labels3D) refresh too
    },
  };
  if (catalog) ctx.catalog = catalog;
  window.sle = ctx;
  // v2 shell: HUD, action bar, drawers, dialogs, „© Quellen“ and the tier-gated feature registry
  // (minimap, places, markers, OSM paths, buildings … see src/shell/builtins.ts).
  ctx.shell = createShell(ctx, {
    settings,
    kv,
    resize,
    loadProgress: () => ({ progress: loadProgress, done: loadDone }),
    areaNote: `Gebiet: ${manifest.name}${fellBack ? ' (Fixture – angeforderte Daten nicht gefunden)' : ''}`,
  });
  if (avifMissing) ctx.shell.toast(AVIF_HINT_DE);
  let avifShown = avifMissing;
  if (catalog) {
    const places = catalog.places;
    places.onChange(() => {
      if (avifMissing && !avifShown) {
        avifShown = true;
        ctx.shell.toast(AVIF_HINT_DE);
      }
    });
    // Places around the camera: ≤ 8 km load, > 12 km drop (planned twice a second).
    let acc = 0;
    ctx.onFrame((dt) => {
      acc += dt;
      if (acc < 0.5) return;
      acc = 0;
      const s = store.get();
      places.update(s.E, s.N);
    });
  }
  registerZones(ctx); // V2.6b: zone portals (Standard), loading screen, enter / leave
  registerPlaceStats(ctx); // 🏆 Orte im Vergleich: card in the „Orte“ drawer (Standard, when manifest.stats)
  installTutorial(ctx); // V2.9 first-flight tutorial: 🟢 Standard, once per profile (ADR 0038)
  // S2 catalog mode: per-place trees + buildings at their offsets, with the Bäume / Gebäude switches and
  // the Baum-Steckbrief (catalog/placeContent.ts); single-AOI mode: the AOI's trees.
  if (!installPlaceContent(ctx)) installTrees(ctx);
  else registerPlaceHint(ctx); // S2: „Ortspate gesucht“ in the HUD over places without detailed 3D // V2.4 CHM trees: 🟢 Standard feature `trees`, updated via ctx.onFrame (app/README „Bäume“)
  registerLens(ctx); // V2.5: game look + Relikt-Blick lens (src/lens, ADR 0035)

  // ---- frame loop -----------------------------------------------------------------------------
  const timer = new Timer();
  timer.connect(document);
  const r1 = (v: number) => Math.round(v * 10) / 10;

  const syncStore = () => {
    const p = camera.position;
    const { E, N } = worldToUtm(p.x, p.z, origin);
    const exag = terrain.uniforms.uExag.value;
    store.set(
      {
        E: r1(E),
        N: r1(N),
        h: r1(terrain.fromDisplayY(p.y)),
        agl: r1(controller.agl / exag),
        heading: r1(normDeg(controller.heading)),
        pitch: r1(controller.pitch),
        speed: r1(controller.speed),
      },
      'camera',
    );
  };

  function frame(dt: number): void {
    if (frameOwner) return frameOwner(dt); // inside a zone (V2.6b): the zone renders
    touch.update(dt); // F20: touch inertia / double-tap zoom (before terrain following)
    controller.update(dt);
    for (const h of frameHooks) h(dt);
    sky.position.copy(camera.position);
    terrain.update(camera);
    renderer.render(scene, camera);
    syncStore();
  }

  renderer.setAnimationLoop((t) => {
    timer.update(t);
    frame(timer.getDelta());
  });

  // ---- load terrain ---------------------------------------------------------------------------
  const startXZ = fromHash ? utmToWorld(fromHash.E, fromHash.N, origin) : { x: cx, z: cz };
  // Start as soon as the ground under the start point is known and a first batch is in (or load()
  // resolved); further chunks keep streaming with the HUD's "Lade Details … n".
  const FIRST_BATCH = 9;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    loading.hidden = true;
    if (!fromHash) {
      const g = terrain.surfaceY(cx, cz);
      controller.setPose({ x: cx, z: cz, y: g + START_AGL, heading: 0, pitch: -25 });
    }
    // Seed the store's pose before the hash binds: in a hidden tab rAF may not have run yet, and a
    // display write (overlay/forest/layer) would otherwise serialise the default pose (#0,0,0,…).
    syncStore();
    bindHash(store, { isValidLayer, suspend: (s) => getLocate()?.revealsPosition(s) ?? false }); // F20 privacy
    ctx.ready = true;
    window.dispatchEvent(new CustomEvent('sle:ready', { detail: ctx }));
  };
  const result = await terrain.load(startXZ.x, startXZ.z, (pr) => {
    loadProgress = { ...pr };
    if (started) return;
    loading.textContent = `Lade Gelände … ${pr.loaded}/${pr.total}${pr.failed ? ` (${pr.failed} fehlgeschlagen)` : ''}`;
    if (pr.loaded >= Math.min(pr.total, FIRST_BATCH) && Number.isFinite(terrain.heightAt(startXZ.x, startXZ.z))) start();
  });
  loadDone = true;
  if (result.loaded === 0 && !started) {
    loading.textContent = 'Keine Geländekacheln geladen – siehe Konsole.';
    loading.classList.add('error');
    return;
  }
  start();
}

void main();

/** Catalog mode: a fly-to target loads its place first (contract "Which places load"). */
function catalogFlyTo(catalog: CatalogSession | undefined, inner: AppContext['flyTo']): AppContext['flyTo'] {
  if (!catalog) return inner;
  return (E, N, opts) => {
    const p = startPlace(catalog.catalog, E, N);
    if (p) void catalog.places.ensure(p.id);
    return inner(E, N, opts);
  };
}

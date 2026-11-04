/**
 * V2.8b (ADR 0041): generic runtime for `runtime.kind: "gltf"` zone packages (zone contract „Runtime API“).
 * Draws the `scene` assets' LOD chains (coarsest during mount, finer ones swapped in when ready), walks on the
 * mesh (walk.ts: ground ray + wall capsule against the coarsest LOD or `collider` assets), spawns from the
 * package, applies `capture.scale`. Host chrome (title, *Verlassen*, attribution, Esc) comes from feature.ts.
 * Lazy chunk: imported only on *Betreten* (modules.ts `GLTF_RUNTIME`).
 */
import { Color, Group, LoadingManager, NoToneMapping, PerspectiveCamera, Scene, SRGBColorSpace } from 'three';
import type { ColorSpace, Material, Mesh, Object3D, Texture, ToneMapping } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import basisJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import basisWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import type { MeshBVH } from 'three-mesh-bvh';
import { DroneController } from '../../controls/DroneController';
import { createSky } from '../../terrain/Sky';
import type { ZoneAsset } from '../contract';
import type { ZoneHandle, ZoneModule, ZoneMountContext, ZonePose, ZoneQuality, ZoneTier } from './api';
import { localToEN } from './collide';
import { colliderPlan, firstViewWeights, LodSwitcher, sceneAssets, spawnLocal, wantedLod } from './gltfPlan';
import type { LodAction } from './gltfPlan';
import { buildCollider, EYE_M, Walker } from './walk';

const abortError = () => new DOMException('Zone mount aborted', 'AbortError');
const WALK_SPEED = 7.5; // DroneController base speed: × 0.2 near the ground ≈ 1.5 m/s
const LOD_TICK_S = 0.25;
const BASIS_DIR = 'sle-basis/';

/** GET with byte progress (Content-Length, else the declared size). */
async function fetchBytes(url: string, signal: AbortSignal, declared: number | undefined, onBytes: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const total = Number(res.headers.get('content-length')) || declared || 0;
  if (!res.body || !total) {
    const b = await res.arrayBuffer();
    onBytes(1);
    return b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onBytes(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) (out.set(c, o), (o += c.byteLength));
  return out.buffer;
}

/** One loader set per renderer (KTX2 transcoder worker pool). The transcoder files come from Vite `?url`. */
function makeLoader(ctx: ZoneMountContext): { gltf: GLTFLoader; ktx2: KTX2Loader } {
  const manager = new LoadingManager();
  manager.setURLModifier((u) => (u.endsWith(`${BASIS_DIR}basis_transcoder.js`) ? basisJsUrl : u.endsWith(`${BASIS_DIR}basis_transcoder.wasm`) ? basisWasmUrl : u));
  const ktx2 = new KTX2Loader(manager).setTranscoderPath(BASIS_DIR).detectSupport(ctx.renderer);
  const gltf = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  return { gltf, ktx2 };
}

function disposeTree(o: Object3D): void {
  o.traverse((n) => {
    const m = n as Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of ([] as Material[]).concat(m.material ?? [])) {
      for (const v of Object.values(mat)) if ((v as Texture)?.isTexture) (v as Texture).dispose();
      mat.dispose();
    }
  });
}

const countTriangles = (o: Object3D): number => {
  let t = 0;
  o.traverse((n) => {
    const m = n as Mesh;
    if (m.isMesh) t += (m.geometry.index?.count ?? m.geometry.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(t);
};

interface AssetSlot {
  asset: ZoneAsset;
  sw: LodSwitcher;
  lods: Map<number, Object3D>;
}

class GltfZone implements ZoneHandle {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.05, 3000);
  /** Zone-frame content with the `capture.scale` correction (about its pivot). */
  readonly root = new Group();
  private controls: DroneController | null = null;
  private walker: Walker | null;
  private walking = true;
  private quality: ZoneQuality;
  private lodClock = 0;
  private readonly ac = new AbortController();
  private readonly sky: ReturnType<typeof createSky> | null;
  private readonly hold = { fwd: 0 };
  private saved: { toneMapping: ToneMapping; exposure: number; clear: Color; alpha: number; colorSpace: ColorSpace } | null = null;
  private readonly ui: HTMLElement;
  private floatBtn: HTMLButtonElement | null = null;
  private hintTimer = 0;

  constructor(
    private readonly ctx: ZoneMountContext,
    private readonly loader: { gltf: GLTFLoader; ktx2: KTX2Loader },
    private readonly slots: AssetSlot[],
    private readonly bvh: MeshBVH | null,
    private readonly scaleTransform: Group,
  ) {
    this.quality = ctx.quality ?? 'auto';
    this.walker = bvh ? new Walker(bvh, 0) : null;
    this.walking = !!bvh;
    const sky = ctx.manifest.preset.sky === 'shared';
    this.scene.background = new Color(sky ? '#aebfcf' : '#20242a');
    this.sky = sky ? createSky(1000) : null;
    if (this.sky) this.scene.add(this.sky);
    this.scene.add(this.root);
    this.root.add(scaleTransform);
    for (const s of slots) for (const o of s.lods.values()) scaleTransform.add(o);
    this.ui = this.buildUi();
  }

  // ---- UI: walk pad (coarse pointers), float toggle, first hint -------------------------------------------
  private buildUi(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sle-zone-gltf-ui';
    const pad = document.createElement('div');
    pad.className = 'sle-zone-walkpad';
    const hold = (label: string, aria: string, v: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sle-btn';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      const on = (e: Event) => (e.preventDefault(), (this.hold.fwd = v));
      const off = () => (this.hold.fwd = 0);
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    pad.append(hold('▲ Vor', 'Vorwärts gehen (gedrückt halten)', 1), hold('▼ Zurück', 'Rückwärts gehen (gedrückt halten)', -1));
    if (this.walker) {
      const f = document.createElement('button');
      f.type = 'button';
      f.className = 'sle-btn sle-zone-float';
      f.setAttribute('aria-pressed', 'false');
      f.textContent = 'Schweben';
      f.title = 'Schweben: ohne Boden und Wände (Q/E runter/hoch)';
      f.addEventListener('click', () => this.setWalking(!this.walking));
      this.floatBtn = f;
      wrap.append(f);
    }
    const hint = document.createElement('p');
    hint.className = 'sle-zone-hint';
    hint.textContent = matchMedia?.('(pointer: coarse)').matches ? 'Ziehen: umsehen · ▲ gedrückt halten: gehen' : 'WASD: gehen · Maus ziehen: umsehen';
    wrap.append(pad, hint);
    this.ctx.container.appendChild(wrap);
    this.hintTimer = window.setTimeout(() => hint.classList.add('sle-zone-hint-off'), 7000);
    return wrap;
  }

  setWalking(on: boolean): void {
    if (!this.walker) on = false;
    if (on === this.walking) return;
    this.walking = on;
    this.floatBtn?.setAttribute('aria-pressed', String(!on));
    if (on && this.walker && this.controls) {
      const p = this.camera.position;
      this.walker.settle(p.x, p.z, p.y);
      p.y = this.walker.groundY + EYE_M;
    }
  }

  // ---- ZoneHandle -----------------------------------------------------------------------------------------
  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  enter(spawn: ZonePose): void {
    const r = this.ctx.renderer;
    this.saved = { toneMapping: r.toneMapping, exposure: r.toneMappingExposure, clear: r.getClearColor(new Color()), alpha: r.getClearAlpha(), colorSpace: r.outputColorSpace as ColorSpace };
    // Captured textures carry their light: no tone mapping, sRGB out.
    r.toneMapping = NoToneMapping;
    r.toneMappingExposure = 1;
    r.outputColorSpace = SRGBColorSpace;
    const m = this.ctx.manifest;
    // walking: the floor under the feet; floating: always one eye height below (no clamp, walking speed)
    const ground = { surfaceY: () => (this.walking && this.walker ? this.walker.groundY : this.camera.position.y - EYE_M) };
    this.controls = new DroneController(this.camera, r.domElement, ground, { E0: m.origin.E0, N0: m.origin.N0 }, {
      fallbackGround: -1e6,
      minClearance: EYE_M,
      baseSpeed: WALK_SPEED,
    });
    const [x, y, z] = spawnLocal(spawn, m.origin, m.capture?.scale);
    this.walking = !!this.walker && spawn.mode === 'gehen';
    this.floatBtn?.setAttribute('aria-pressed', String(!this.walking));
    let cy = y;
    if (this.walking && this.walker) cy = this.walker.settle(x, z, y) + EYE_M;
    this.controls.setPose({ x, y: cy, z, heading: spawn.heading_deg, pitch: spawn.pitch_deg });
    this.camera.updateMatrixWorld();
    this.tickLods(true);
  }

  pose(): ZonePose {
    const p = this.camera.position;
    const s = this.ctx.manifest.capture?.scale;
    // back to the unscaled zone frame (the pose contract is the package's frame)
    const f = s?.factor ?? 1;
    const c = s?.pivotLocal ?? [0, 0, 0];
    const ux = c[0] + (p.x - c[0]) / f;
    const uy = c[1] + (p.y - c[1]) / f;
    const uz = c[2] + (p.z - c[2]) / f;
    const { E, N } = localToEN(ux, uz, this.ctx.manifest.origin);
    return { E, N, h: uy, heading_deg: this.controls?.heading ?? 0, pitch_deg: this.controls?.pitch ?? 0, mode: this.walking ? 'gehen' : 'fliegen' };
  }

  frame(dt: number): void {
    const c = this.controls;
    if (!c) return;
    const p = this.camera.position;
    const x0 = p.x;
    const z0 = p.z;
    c.update(dt);
    if (this.hold.fwd) {
      const hr = (c.heading * Math.PI) / 180;
      const v = 1.5 * Math.min(dt, 0.1) * this.hold.fwd;
      p.x += Math.sin(hr) * v;
      p.z -= Math.cos(hr) * v;
    }
    if (this.walking && this.walker) {
      const q = this.walker.step(x0, z0, p.x, p.z);
      p.x = q.x;
      p.z = q.z;
      // Feet follow the floor; ease the eye so kerbs and noisy floors do not jolt.
      const target = q.y + EYE_M;
      p.y += (target - p.y) * (1 - Math.exp(-14 * Math.min(dt, 0.1)));
      if (Math.abs(target - p.y) > 1) p.y = target;
    }
    this.lodClock += dt;
    if (this.lodClock >= LOD_TICK_S) this.tickLods(false);
    if (this.sky) this.sky.position.copy(p);
    this.ctx.renderer.render(this.scene, this.camera);
  }

  exit(): ZonePose {
    const pose = this.pose();
    this.controls?.dispose();
    this.controls = null;
    const r = this.ctx.renderer;
    if (this.saved) {
      r.toneMapping = this.saved.toneMapping;
      r.toneMappingExposure = this.saved.exposure;
      r.outputColorSpace = this.saved.colorSpace;
      r.setClearColor(this.saved.clear, this.saved.alpha);
      this.saved = null;
    }
    return pose;
  }

  setTier(_t: ZoneTier): void {
    /* no tiered HUD in captured zones */
  }

  setQuality(q: ZoneQuality): void {
    this.quality = q;
    this.tickLods(true);
  }

  dispose(): void {
    if (this.controls) this.exit();
    this.ac.abort();
    clearTimeout(this.hintTimer);
    for (const s of this.slots) for (const o of s.lods.values()) disposeTree(o);
    this.slots.length = 0;
    this.bvh?.geometry.dispose();
    if (this.sky) {
      this.sky.geometry.dispose();
      (this.sky.material as Material).dispose();
    }
    this.loader.ktx2.dispose();
    this.ui.remove();
    this.scene.clear();
  }

  // ---- LODs -----------------------------------------------------------------------------------------------
  private tickLods(force: boolean): void {
    if (!force && this.lodClock < LOD_TICK_S) return;
    this.lodClock = 0;
    const p = this.camera.position;
    const s = this.ctx.manifest.capture?.scale;
    const f = s?.factor ?? 1;
    const c = s?.pivotLocal ?? [0, 0, 0];
    // LOD distances are in the package frame (bboxLocal unscaled)
    const cam: [number, number, number] = [c[0] + (p.x - c[0]) / f, c[1] + (p.y - c[1]) / f, c[2] + (p.z - c[2]) / f];
    for (const slot of this.slots) this.apply(slot, slot.sw.want(wantedLod(slot.asset, cam, this.quality)));
  }

  private apply(slot: AssetSlot, actions: LodAction[]): void {
    for (const a of actions) {
      if (a.type === 'show') {
        const o = slot.lods.get(a.lod);
        if (o) o.visible = true;
        if (a.hide !== null) {
          const h = slot.lods.get(a.hide);
          if (h) h.visible = false;
        }
      } else if (a.type === 'drop') {
        const o = slot.lods.get(a.lod);
        // the collider BVH is a copy, so the drawn coarse level can go
        if (o) (o.removeFromParent(), disposeTree(o), slot.lods.delete(a.lod));
      } else {
        const lod = slot.asset.lods[a.lod]!;
        loadScene(this.loader.gltf, this.ctx.baseUrl + lod.path, this.ac.signal, lod.bytes, () => {})
          .then((o) => {
            if (this.ac.signal.aborted) return disposeTree(o);
            o.visible = false;
            slot.lods.set(a.lod, o);
            this.scaleTransform.add(o);
            this.apply(slot, slot.sw.loaded(a.lod));
          })
          .catch((err) => {
            if (this.ac.signal.aborted) return;
            console.warn(`[zone ${this.ctx.manifest.id}] LOD ${lod.path} failed`, err);
            slot.sw.failed(a.lod);
          });
      }
    }
  }

  /** Debug / perf hook (`sle.zones.flow.handle().debug()`). */
  debug(): { lods: Record<string, number | null>; triangles: number; walking: boolean; pose: ZonePose } {
    const lods: Record<string, number | null> = {};
    for (const s of this.slots) lods[s.asset.id] = s.sw.shown;
    return { lods, triangles: countTriangles(this.root), walking: this.walking, pose: this.pose() };
  }
}

async function loadScene(gltf: GLTFLoader, url: string, signal: AbortSignal, declared: number | undefined, onBytes: (f: number) => void): Promise<Object3D> {
  const buf = await fetchBytes(url, signal, declared, onBytes);
  if (signal.aborted) throw abortError();
  const g = await gltf.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
  const root = g.scene;
  root.traverse((n) => {
    const m = n as Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = true;
    for (const mat of ([] as Material[]).concat(m.material)) {
      const map = (mat as Material & { map?: Texture | null }).map;
      if (map) map.anisotropy = 4;
    }
  });
  return root;
}

export async function mountZone(ctx: ZoneMountContext): Promise<ZoneHandle> {
  const m = ctx.manifest;
  const assets = sceneAssets(m);
  if (!assets.length) throw new Error(`zone ${m.id}: no scene asset`);
  const loader = makeLoader(ctx);
  const plan = colliderPlan(m);
  const weights = firstViewWeights(assets);
  const done = assets.map(() => 0);
  const report = () => ctx.onProgress('Laden', 0.9 * done.reduce((s, d, i) => s + d * weights[i]!, 0));
  report();
  let first: Object3D[] = [];
  try {
    // first view: every scene asset's coarsest LOD (parallel), then extra collider assets
    first = await Promise.all(
      assets.map((a, i) => {
        const lod = a.lods[a.lods.length - 1]!;
        return loadScene(loader.gltf, ctx.baseUrl + lod.path, ctx.signal, lod.bytes, (f) => ((done[i] = f), report()));
      }),
    );
    if (ctx.signal.aborted) throw abortError();
    const slots: AssetSlot[] = assets.map((asset, i) => {
      const sw = new LodSwitcher(asset.lods.length);
      const last = asset.lods.length - 1;
      sw.want(last);
      sw.loaded(last);
      return { asset, sw, lods: new Map([[last, first[i]!]]) };
    });
    ctx.onProgress('Boden und Wände', 0.92);
    // scale correction: p' = pivot + f · (p − pivot) ⇔ translate pivot·(1 − f), scale f
    const scaleT = new Group();
    const s = m.capture?.scale;
    if (s && s.factor !== 1) {
      scaleT.scale.setScalar(s.factor);
      scaleT.position.set(s.pivotLocal[0] * (1 - s.factor), s.pivotLocal[1] * (1 - s.factor), s.pivotLocal[2] * (1 - s.factor));
    }
    const colRoot = new Group();
    colRoot.add(scaleT);
    const extra: Object3D[] = [];
    for (const c of plan) {
      if (c.drawn) {
        const i = assets.indexOf(c.asset);
        if (i >= 0) scaleT.add(first[i]!);
      } else {
        const lod = c.asset.lods[c.lod]!;
        const o = await loadScene(loader.gltf, ctx.baseUrl + lod.path, ctx.signal, lod.bytes, () => {});
        extra.push(o);
        scaleT.add(o);
      }
    }
    colRoot.updateMatrixWorld(true);
    const bvh = buildCollider(scaleT);
    for (const o of extra) disposeTree(o);
    for (const o of [...scaleT.children]) scaleT.remove(o);
    colRoot.remove(scaleT);
    if (ctx.signal.aborted) throw abortError();
    ctx.onProgress('Fertig', 1);
    return new GltfZone(ctx, loader, slots, bvh, scaleT);
  } catch (err) {
    for (const o of first) disposeTree(o);
    loader.ktx2.dispose();
    throw err;
  }
}

const mod: ZoneModule = { mountZone, hostChrome: true };
export default mod;

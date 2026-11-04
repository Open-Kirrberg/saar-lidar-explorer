/**
 * Shader warm-up (KB-I106). three compiles a program the first time a material is drawn under a new light state, and
 * the driver (ANGLE on Metal: the render pipeline) finishes it only at the first draw. On the phone proxy the first
 * Rundflug frame took 5–7 s and the first room visit 0.4–2.2 s (getProgramInfoLog waiting on the GPU process). The
 * castle warms its programs ahead instead, for each light state the visitor meets by day (outdoors: no point light,
 * indoors: the room-light slots): during the loading screen for everything built, and after each LOD2 build for the new
 * group.
 *
 * 1. compile one proxy per distinct program input (material × instancing × geometry attributes, `programInputKey`;
 *    the castle has tens of thousands of meshes, a few hundred inputs): the driver links them in parallel
 *    (KHR_parallel_shader_compile), `programsReady` waits without blocking;
 * 2. draw the proxies once into a 1×1 target of the scene target's format (half float, its MSAA, float depth), so the
 *    driver builds its pipelines and the buffers and textures are uploaded; `gpuIdle` waits on a fence.
 */
import * as THREE from 'three';

/** The object-side inputs of three's program parameters (WebGLPrograms.getParameters, r187) for one material. */
export function programInputKey(materialId: number, o: { isInstancedMesh?: boolean; instanceColor?: unknown; isSkinnedMesh?: boolean; isPoints?: boolean; isSprite?: boolean; isLine?: boolean; isLineSegments?: boolean }, attributes: readonly string[], morph: readonly string[]): string {
  const kind = o.isInstancedMesh ? (o.instanceColor ? 'ic' : 'i') : o.isSkinnedMesh ? 's' : o.isPoints ? 'p' : o.isSprite ? 'sp' : o.isLineSegments ? 'ls' : o.isLine ? 'l' : 'm';
  return `${materialId}|${kind}|${[...attributes].sort().join(',')}|${[...morph].sort().join(',')}`;
}

/** Proxies drawn per task in the warm draw (≈ 50–150 ms each on the phone proxy). */
const WARM_SLICE = 24;

type Drawable = THREE.Mesh | THREE.InstancedMesh | THREE.Points | THREE.Line | THREE.Sprite;

/** A stand-in drawn once: same geometry and material, the same kind of object (1 instance), never culled. */
function proxyOf(o: Drawable, m: THREE.Material): THREE.Object3D | null {
  const geo = o.geometry as THREE.BufferGeometry;
  let p: THREE.Object3D;
  if ((o as THREE.InstancedMesh).isInstancedMesh) {
    const src = o as THREE.InstancedMesh;
    const im = new THREE.InstancedMesh(geo, m, 1);
    im.setMatrixAt(0, new THREE.Matrix4());
    if (src.instanceColor) im.setColorAt(0, new THREE.Color(1, 1, 1));
    p = im;
  } else if ((o as THREE.Sprite).isSprite) p = new THREE.Sprite(m as THREE.SpriteMaterial);
  else if ((o as THREE.Points).isPoints) p = new THREE.Points(geo, m);
  else if ((o as THREE.LineSegments).isLineSegments) p = new THREE.LineSegments(geo, m);
  else if ((o as THREE.Line).isLine) p = new THREE.Line(geo, m);
  else if ((o as THREE.SkinnedMesh).isSkinnedMesh) return null;
  else p = new THREE.Mesh(geo, m);
  p.frustumCulled = false;
  return p;
}

/**
 * Proxies for the program inputs below `roots` not yet in `seen` (visible or not: LOD levels and interiors switch
 * later). `seen` is per light state and filled here.
 */
export function programProxies(roots: readonly THREE.Object3D[], seen: Set<string>): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const root of roots)
    root.traverse((obj) => {
      const o = obj as Drawable;
      if (!((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) return;
      const geo = o.geometry as THREE.BufferGeometry;
      if (!geo?.attributes) return;
      const attrs = Object.keys(geo.attributes);
      const morph = Object.keys(geo.morphAttributes ?? {});
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        const key = programInputKey(m.id, o as never, attrs, morph);
        if (seen.has(key)) continue;
        seen.add(key);
        const p = proxyOf(o, m);
        if (p) out.push(p);
      }
    });
  return out;
}

/** A light state to warm for: sets the scene's lights as the visitor will meet them and returns the undo. */
export type WarmLightState = { id: string; apply: () => () => void };

export interface WarmHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The light states (built on demand: the scene's lights change as LOD2 groups are added). */
  states: () => readonly WarmLightState[];
  /** MSAA samples of the scene target the castle draws into (post.ts `sceneMsaa`). */
  samples: () => number;
  /** Shadow maps on (castle quality); the warm draw never redraws them. */
  shadows: () => boolean;
}

/** Stand-ins for the scene's visible lights (same type and shadow flag: the program inputs), for the warm scene. */
function lightStandIns(scene: THREE.Scene): THREE.Light[] {
  const out: THREE.Light[] = [];
  scene.traverseVisible((o) => {
    const l = o as THREE.Light;
    if (!l.isLight) return;
    let c: THREE.Light;
    if ((l as THREE.DirectionalLight).isDirectionalLight) c = new THREE.DirectionalLight();
    else if ((l as THREE.PointLight).isPointLight) c = new THREE.PointLight();
    else if ((l as THREE.SpotLight).isSpotLight) c = new THREE.SpotLight();
    else if ((l as THREE.HemisphereLight).isHemisphereLight) c = new THREE.HemisphereLight();
    else if ((l as THREE.AmbientLight).isAmbientLight) c = new THREE.AmbientLight();
    else return;
    c.castShadow = l.castShadow;
    c.intensity = 0;
    out.push(c);
  });
  return out;
}

export class ShaderWarmer {
  private readonly seen = new Map<string, Set<string>>();
  private target: THREE.WebGLRenderTarget | null = null;
  readonly stats = { batches: 0, proxies: 0, compileMs: 0, drawMs: 0 };
  constructor(private readonly host: WarmHost) {}

  /** Warm the programs of `roots` (compile, wait for the links, draw once, wait for the GPU). */
  async warm(roots: readonly THREE.Object3D[], signal?: AbortSignal): Promise<void> {
    if (this.disposed) return;
    const batch = this.compile(roots);
    if (!batch.length) return;
    await programsReady(this.host.renderer, new Set(batch.flatMap((b) => b.materials)), signal);
    // draw in slices (each a task of its own: the loading screen stays alive), then wait for the GPU
    for (const b of batch) {
      const proxies = b.scene.children.filter((o) => !(o as THREE.Light).isLight);
      const lights = b.scene.children.filter((o) => (o as THREE.Light).isLight);
      for (let i = 0; i < proxies.length; i += WARM_SLICE) {
        if (signal?.aborted || this.disposed) return;
        const ws = new THREE.Scene();
        ws.environment = b.scene.environment;
        ws.environmentRotation.copy(b.scene.environmentRotation);
        ws.fog = b.scene.fog;
        // the stand-ins move to the slice's scene (an object has one parent); the same lights → the same programs
        ws.add(...lights, ...proxies.slice(i, i + WARM_SLICE));
        this.draw(ws);
        await gpuIdle(this.host.renderer, signal);
      }
    }
  }

  private compile(roots: readonly THREE.Object3D[]): { scene: THREE.Scene; materials: THREE.Material[] }[] {
    const { renderer, scene, camera } = this.host;
    const t = performance.now();
    const out: { scene: THREE.Scene; materials: THREE.Material[] }[] = [];
    const undoR = this.bind();
    try {
      for (const st of this.host.states()) {
        let keys = this.seen.get(st.id);
        if (!keys) this.seen.set(st.id, (keys = new Set()));
        const proxies = programProxies(roots, keys);
        if (!proxies.length) continue;
        const undo = st.apply();
        try {
          // the warm scene: the proxies under stand-ins of the lights of this state, the scene's environment and fog
          const ws = new THREE.Scene();
          ws.environment = scene.environment;
          ws.environmentRotation.copy(scene.environmentRotation);
          ws.fog = scene.fog;
          ws.add(...lightStandIns(scene), ...proxies);
          const materials = [...renderer.compile(ws, camera)] as THREE.Material[];
          out.push({ scene: ws, materials });
          this.stats.proxies += proxies.length;
        } finally {
          undo();
        }
      }
    } finally {
      undoR();
    }
    this.stats.batches++;
    this.stats.compileMs += performance.now() - t;
    return out;
  }

  private draw(ws: THREE.Scene): void {
    const { renderer, camera } = this.host;
    const t = performance.now();
    const undoR = this.bind();
    const sm = renderer.shadowMap;
    const prevSm = { auto: sm.autoUpdate, needs: sm.needsUpdate };
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    try {
      renderer.render(ws, camera);
    } finally {
      sm.autoUpdate = prevSm.auto;
      sm.needsUpdate = prevSm.needs;
      renderer.autoClear = autoClear;
      undoR();
      for (const o of ws.children) if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      ws.clear();
    }
    this.stats.drawMs += performance.now() - t;
  }

  /** Bind the warm target (the scene target's format) and the castle's shadow setting; returns the undo. */
  private bind(): () => void {
    const r = this.host.renderer;
    const samples = this.host.samples();
    if (!this.target || this.target.samples !== samples) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true, generateMipmaps: false });
      this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    }
    const prev = { target: r.getRenderTarget(), shadow: r.shadowMap.enabled, type: r.shadowMap.type };
    r.setRenderTarget(this.target);
    r.shadowMap.enabled = this.host.shadows();
    r.shadowMap.type = THREE.PCFShadowMap;
    return () => {
      r.setRenderTarget(prev.target);
      r.shadowMap.enabled = prev.shadow;
      r.shadowMap.type = prev.type;
    };
  }

  private disposed = false;
  dispose(): void {
    this.disposed = true;
    this.target?.dispose();
    this.target = null;
  }
}

/** Resolve once every material's programs have linked (KHR_parallel_shader_compile; without it: at once). */
export function programsReady(renderer: THREE.WebGLRenderer, materials: Set<THREE.Material>, signal?: AbortSignal, timeoutMs = 20000): Promise<void> {
  const props = (renderer as unknown as { properties: { get(m: THREE.Material): { programs?: Map<string, { isReady(): boolean }> } } }).properties;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (signal?.aborted || performance.now() - t0 > timeoutMs) return resolve();
      for (const m of [...materials]) {
        let ready = true;
        for (const prog of props.get(m).programs?.values() ?? []) if (!prog.isReady()) ready = false;
        if (ready) materials.delete(m);
      }
      if (!materials.size) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

/** Resolve once the GPU has finished the commands issued so far (fence, polled without blocking). */
export function gpuIdle(renderer: THREE.WebGLRenderer, signal?: AbortSignal, timeoutMs = 20000): Promise<void> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (typeof gl.fenceSync !== 'function') return Promise.resolve();
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return Promise.resolve();
  gl.flush();
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const st = gl.clientWaitSync(sync, 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED || signal?.aborted || performance.now() - t0 > timeoutMs) {
        gl.deleteSync(sync);
        return resolve();
      }
      setTimeout(check, 16);
    };
    check();
  });
}

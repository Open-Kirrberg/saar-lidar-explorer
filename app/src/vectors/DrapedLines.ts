import {
  Box3,
  Color,
  DoubleSide,
  GLSL3,
  Group,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
  Sphere,
  Uint16BufferAttribute,
  Float32BufferAttribute,
  Vector2,
  Vector3,
} from 'three';
import type { Camera, IUniform, WebGLRenderer } from 'three';
import type { Terrain } from '../terrain/Terrain';
import { SEG_STRIDE, bucketDist2, buildBuckets, displayY, resampleBucket } from './drape';
import type { LocalLine, SegmentBucket } from './drape';
import { MAX_STYLES, STYLES } from './styles';

/**
 * Draped vector lines as screen-space ribbons: one instance per 2 m segment, a quad expanded in
 * the vertex shader to a constant pixel width (with a dark casing drawn in the same pass).
 * Vertices carry the TRUE height; the shader applies the terrain's exaggeration with the shared
 * `uExag`/`uHRef` uniform objects: y = hRef + (h − hRef)·exag + lift·exag.
 * Against z-fighting: lift (0.3 m × exag), a view-space pull toward the camera proportional to
 * the distance (covers coarse terrain LODs far away) and polygonOffset.
 *
 * Scaling (F9, overall AOI): segments live in 500 m buckets (CPU Float32Arrays); GPU meshes exist
 * only for buckets within `buildRadius` of the camera and are disposed beyond it (+ hysteresis).
 * Terrain-sampled heights (layers without baked z) are re-sampled a few buckets per frame when the
 * loaded height data changes; baked heights are never touched.
 */

const vertexShader = /* glsl */ `
uniform float uExag;
uniform float uHRef;
uniform float uLift;
uniform float uDepthBias;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform vec3 uColors[${MAX_STYLES}];
uniform float uWidths[${MAX_STYLES}];
uniform float uWidthScale;
uniform float uCasingPx;
uniform vec2 uFade;
in vec3 aStart;
in vec3 aEnd;
in float aStyle;
out vec3 vColor;
out float vAcross;
out float vCore;
out float vHalfW;
out float vFade;
out vec3 vWorld;

vec3 displayPos(vec3 p) {
  return vec3(p.x, uHRef + (p.y - uHRef) * uExag + uLift * max(uExag, 1.0), p.z);
}

void main() {
  int s = int(aStyle + 0.5);
  vec3 wS = displayPos(aStart);
  vec3 wE = displayPos(aEnd);
  vec4 vS = modelViewMatrix * vec4(wS, 1.0);
  vec4 vE = modelViewMatrix * vec4(wE, 1.0);
  // Depth bias: move toward the camera along the view ray (screen position unchanged).
  float pull = 1.0 - uDepthBias * max(uExag, 1.0);
  vS.xyz *= pull;
  vE.xyz *= pull;
  // Trim segments that cross the camera plane (as three's LineMaterial does).
  float a = projectionMatrix[2][2];
  float b = projectionMatrix[3][2];
  float nearEst = -0.5 * b / a;
  if (vS.z < 0.0 && vE.z >= 0.0) vE.xyz = mix(vS.xyz, vE.xyz, (nearEst - vS.z) / (vE.z - vS.z));
  else if (vE.z < 0.0 && vS.z >= 0.0) vS.xyz = mix(vE.xyz, vS.xyz, (nearEst - vE.z) / (vS.z - vE.z));

  vec4 cS = projectionMatrix * vS;
  vec4 cE = projectionMatrix * vE;
  vec2 halfRes = 0.5 * uResolution;
  vec2 sS = cS.xy / cS.w * halfRes;
  vec2 sE = cE.xy / cE.w * halfRes;
  vec2 d = sE - sS;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  bool atEnd = position.y > 0.5;
  vec4 c = atEnd ? cE : cS;
  float dist = length(atEnd ? vE.xyz : vS.xyz);
  float w = max(uWidths[s] * uWidthScale * mix(1.0, 0.55, smoothstep(250.0, 1500.0, dist)), 0.9) * uPixelRatio;
  float hw = 0.5 * w + uCasingPx * uPixelRatio;
  // Extend along the segment by half the core width so consecutive segments overlap at joints.
  vec2 off = nrm * position.x * hw + dir * (atEnd ? 0.5 : -0.5) * w;
  c.xy += off / halfRes * c.w;
  gl_Position = c;

  vColor = uColors[s];
  vAcross = position.x * hw;
  vCore = 0.5 * w;
  vHalfW = hw;
  vFade = 1.0 - smoothstep(uFade.x, uFade.y, dist);
  vWorld = atEnd ? wE : wS;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCasingColor;
uniform float uCasingAlpha;
uniform float uOpacity;
in vec3 vColor;
in float vAcross;
in float vCore;
in float vHalfW;
in float vFade;
in vec3 vWorld;
out vec4 fragColor;

void main() {
  float d = abs(vAcross);
  float core = 1.0 - smoothstep(vCore - 0.5, vCore + 0.5, d);
  vec3 col = mix(uCasingColor, vColor, core);
  float edge = 1.0 - smoothstep(vHalfW - 1.0, vHalfW, d);
  float alpha = edge * mix(uCasingAlpha, 1.0, core) * vFade * uOpacity;
  if (alpha < 0.02) discard;
  float fd = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-pow(fd * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.85));
  fragColor = vec4(col, alpha);
}
`;

export interface DrapedLinesOptions {
  /** Distance fade (m from the camera): fully visible below [0], hidden beyond [1]. */
  fade: [number, number];
  widthScale?: number;
  casingPx?: number;
  casingAlpha?: number;
  /** Lift above the true ground (m, multiplied by exaggeration). */
  lift?: number;
  /** Fraction of the camera distance to pull vertices toward the camera (× exaggeration). */
  depthBias?: number;
  renderOrder?: number;
  /** Build GPU meshes for buckets within this horizontal distance (m). Default fade[1] + 500. */
  buildRadius?: number;
  /** Max buckets re-sampled / built per update (spreads the work over frames). Default 4. */
  perFrameBudget?: number;
}

interface BucketItem {
  bucket: SegmentBucket;
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null;
  buffer: InstancedInterleavedBuffer | null;
  /** Height-data signature the sampled heights were taken at ('' = never). */
  sampledAt: string;
  boundsKey: string;
}

// Unit quad: x = side (−1/+1), y = 0 at segment start, 1 at segment end.
const QUAD_POS = new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
const QUAD_IDX = [0, 1, 2, 2, 1, 3];
/** Extra distance beyond buildRadius before a mesh is disposed (avoids churn at the edge). */
const HYSTERESIS = 750;

const _box = new Box3();
const _v = new Vector3();
const _size = new Vector2();

/** Signature of the terrain's loaded height data; changes whenever chunks/levels arrive or leave. */
function heightsSignature(terrain: Terrain): string {
  const h = terrain.heights as unknown as { version?: number; loadedCount: number };
  return typeof h.version === 'number' ? `v${h.version}` : `n${h.loadedCount}`;
}

export class DrapedLines extends Group {
  readonly material: ShaderMaterial;
  private readonly items: BucketItem[] = [];
  private readonly fallbackH: number;
  private readonly buildRadius: number;
  readonly segmentCount: number;

  /** From already-bucketed segments (worker output), or from lines (bucketed + sampled here). */
  constructor(
    input: SegmentBucket[] | { lines: LocalLine[] },
    private readonly terrain: Terrain,
    private readonly opts: DrapedLinesOptions,
  ) {
    super();
    this.name = 'DrapedLines';
    const u = terrain.uniforms;
    const colors = Array.from({ length: MAX_STYLES }, (_, k) => {
      const c = STYLES[k]?.color ?? [1, 1, 1];
      return new Vector3(c[0], c[1], c[2]);
    });
    const widths = Array.from({ length: MAX_STYLES }, (_, k) => STYLES[k]?.width ?? 1);
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        // Shared uniform objects: the terrain's exaggeration / reference height / fog.
        uExag: u.uExag,
        uHRef: u.uHRef,
        uFogColor: u.uFogColor,
        uFogDensity: u.uFogDensity,
        uLift: { value: opts.lift ?? 0.3 },
        uDepthBias: { value: opts.depthBias ?? 0.0015 },
        uResolution: { value: new Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uColors: { value: colors },
        uWidths: { value: widths },
        uWidthScale: { value: opts.widthScale ?? 1 },
        uCasingPx: { value: opts.casingPx ?? 0.8 },
        uCasingColor: { value: new Color(0.06, 0.06, 0.08) },
        uCasingAlpha: { value: opts.casingAlpha ?? 0.75 },
        uFade: { value: new Vector2(opts.fade[0], opts.fade[1]) },
        uOpacity: { value: 1 },
      } satisfies Record<string, IUniform>,
      // MSAA alpha-to-coverage: order-independent soft edges/fade; overlapping segment ends
      // don't double-blend.
      alphaToCoverage: true,
      side: DoubleSide, // the ribbon's winding flips with the segment's screen direction
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    this.fallbackH = terrain.manifest.heightRange.min;
    this.buildRadius = opts.buildRadius ?? opts.fade[1] + 500;
    const buckets = Array.isArray(input)
      ? input
      : buildBuckets(input.lines, (x, z) => terrain.heightAt(x, z), terrain.manifest.chunkSize, this.fallbackH);
    const sig = Array.isArray(input) ? '' : heightsSignature(terrain);
    let n = 0;
    for (const b of buckets) {
      if (b.count === 0) continue;
      n += b.count;
      this.items.push({ bucket: b, mesh: null, buffer: null, sampledAt: sig, boundsKey: '' });
    }
    this.segmentCount = n;
    this.matrixAutoUpdate = false;
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
  }

  /** Buckets that currently own a GPU mesh / total buckets (for checks and the debug handle). */
  get meshStats(): { meshes: number; buckets: number; gpuSegments: number } {
    let meshes = 0;
    let gpuSegments = 0;
    for (const it of this.items) {
      if (!it.mesh) continue;
      meshes++;
      gpuSegments += it.bucket.count;
    }
    return { meshes, buckets: this.items.length, gpuSegments };
  }

  /** All buckets (CPU data), e.g. for a boundary index. */
  get buckets(): SegmentBucket[] {
    return this.items.map((it) => it.bucket);
  }

  /** Per frame (before render): resolution, mesh build/dispose by distance, re-sampling, bounds, culling. */
  update(camera: Camera, renderer: WebGLRenderer): void {
    if (!this.visible) return;
    renderer.getDrawingBufferSize(_size);
    this.material.uniforms.uResolution.value.copy(_size);
    this.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();

    const u = this.terrain.uniforms;
    const exag = u.uExag.value;
    const hRef = u.uHRef.value;
    const boundsKey = `${exag}|${hRef}`;
    const sig = heightsSignature(this.terrain);
    const cam = camera.position;
    const far = this.opts.fade[1];
    const build2 = this.buildRadius ** 2;
    const drop2 = (this.buildRadius + HYSTERESIS) ** 2;
    let budget = this.opts.perFrameBudget ?? 4;

    // Nearest buckets first, so the budget goes where the camera is.
    const order = this.items.map((it) => [bucketDist2(it.bucket, cam.x, cam.z), it] as const).sort((a, b) => a[0] - b[0]);
    for (const [d2, it] of order) {
      const b = it.bucket;
      if (it.mesh && d2 > drop2) {
        this.disposeItem(it);
        continue;
      }
      if (d2 > build2 && !it.mesh) continue;
      const needsSample = b.sampled > 0 && it.sampledAt !== sig;
      if (!it.mesh || needsSample) {
        if (budget <= 0) continue; // next frame
        budget--;
        if (needsSample) {
          resampleBucket(b, (x, z) => this.terrain.heightAt(x, z), this.fallbackH);
          it.sampledAt = sig;
          it.boundsKey = '';
          if (it.buffer) it.buffer.needsUpdate = true;
        }
        if (!it.mesh) this.buildItem(it);
      }
      const mesh = it.mesh!;
      if (it.boundsKey !== boundsKey) {
        it.boundsKey = boundsKey;
        const lo = Number.isFinite(b.hMin) ? b.hMin : this.fallbackH;
        const hi = Number.isFinite(b.hMax) ? b.hMax : this.fallbackH;
        const lift = (this.opts.lift ?? 0.3) * Math.max(exag, 1);
        _box.min.set(b.xMin, displayY(lo, hRef, exag), b.zMin);
        _box.max.set(b.xMax, displayY(hi, hRef, exag) + lift + 1, b.zMax);
        _box.getBoundingSphere(mesh.geometry.boundingSphere!);
      }
      _v.set(Math.min(Math.max(cam.x, b.xMin), b.xMax), cam.y, Math.min(Math.max(cam.z, b.zMin), b.zMax));
      const dy = Math.max(0, cam.y - displayY(Number.isFinite(b.hMax) ? b.hMax : this.fallbackH, hRef, exag));
      mesh.visible = Math.hypot(_v.x - cam.x, _v.z - cam.z, dy) < far;
    }
  }

  private buildItem(it: BucketItem): void {
    const b = it.bucket;
    const g = new InstancedBufferGeometry();
    // Own quad attributes per geometry: disposing one bucket must not free buffers others use.
    g.setIndex(new Uint16BufferAttribute(QUAD_IDX, 1));
    g.setAttribute('position', new Float32BufferAttribute(QUAD_POS, 3));
    const buf = new InstancedInterleavedBuffer(b.data, SEG_STRIDE, 1);
    g.setAttribute('aStart', new InterleavedBufferAttribute(buf, 3, 0));
    g.setAttribute('aEnd', new InterleavedBufferAttribute(buf, 3, 3));
    g.setAttribute('aStyle', new InterleavedBufferAttribute(buf, 1, 6));
    g.instanceCount = b.count;
    g.boundingSphere = new Sphere();
    const mesh = new Mesh(g, this.material);
    mesh.renderOrder = this.opts.renderOrder ?? 5;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {}; // picking goes through Terrain.raycast
    mesh.visible = false;
    this.add(mesh);
    it.mesh = mesh;
    it.buffer = buf;
    it.boundsKey = '';
  }

  private disposeItem(it: BucketItem): void {
    if (!it.mesh) return;
    this.remove(it.mesh);
    it.mesh.geometry.dispose();
    it.mesh = null;
    it.buffer = null;
  }

  dispose(): void {
    for (const it of this.items) this.disposeItem(it);
    this.material.dispose();
    this.clear();
    this.items.length = 0;
  }
}

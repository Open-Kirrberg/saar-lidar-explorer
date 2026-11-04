/**
 * KB-I48 Festbeleuchtung in three.js: the lamps of `festivalLamps` (model/src/layout/festival.ts) as one point cloud
 * (a glowing core per lamp, at least FEST_MIN_PX wide, energy kept for small ones) plus one instanced set of additive
 * light pools on the wall or ground beside each lamp. No point lights and no shadow casters: 2 draw calls for every
 * lamp of the site, nothing drawn while the mode is off or by day. Levels: festivalMath.ts. Hypothesis (UI label
 * "Festbeleuchtung (Muster 1785, auf 1789 übertragen; Hypothese)").
 */
import * as THREE from 'three';
import type { FestLamp } from '@model/layout/festival.ts';
import { FEST_GLOW_M, FEST_MIN_PX, FEST_FAR_FLOOR, FEST_POOL_M, festCoreLevel, festPoolLevel } from './festivalMath.ts';
import { kelvinLinear, whiteBalance } from './light.ts';
import { WINDOW_ADAPT, windowCandleColour } from './nightlights.ts';

/** Additive blending that keeps the destination alpha (alpha < 0.25 marks water for the SSR, architecture §3.6). */
function additive(m: THREE.Material): void {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.transparent = true;
  m.depthWrite = false;
}

const POINT_VS = /* glsl */ `
attribute vec3 aCol;
attribute float aSize;
uniform float uScale;
uniform float uMinPx;
uniform float uFloor;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float proj = aSize * uScale / max(-mv.z, 1e-3);
  float px = max(proj, uMinPx);
  gl_PointSize = px;
  // a lamp drawn larger than it projects keeps (most of) its energy, not its radiance
  vCol = aCol * clamp(proj * proj / (px * px), uFloor, 1.0);
}`;

const POINT_FS = /* glsl */ `
uniform float uLevel;
varying vec3 vCol;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // bright flame core inside a soft glare
  float g = exp(-r2 * 5.0) * (1.0 - r2) + 0.6 * exp(-r2 * 40.0);
  gl_FragColor = vec4(vCol * uLevel * g, 1.0);
}`;

const POOL_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv * 2.0 - 1.0;
  vCol = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const POOL_FS = /* glsl */ `
uniform float uLevel;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  // inverse-square-like pool with a soft rim (as the portal lanterns' pools, night.ts)
  float v = (1.0 / (1.0 + (r / 0.2) * (r / 0.2))) * (1.0 - r * r);
  gl_FragColor = vec4(vCol * uLevel * v, 1.0);
}`;

export class Festival {
  readonly group = new THREE.Group();
  readonly count: number;
  private readonly pointsMat: THREE.ShaderMaterial;
  private readonly potsMat: THREE.ShaderMaterial;
  private readonly poolsMat: THREE.ShaderMaterial;
  private readonly potPoolsMat: THREE.ShaderMaterial;
  /** current festival factor (0 = hidden) */
  on = 0;

  constructor(lamps: readonly FestLamp[]) {
    this.group.name = 'night/festival';
    this.group.userData = { part: 'night/festival', evidence: 'I', tag: 'D illuminations 1785 (Fürstenwärther 1786); D-> period fête lamps (SPSG); I arrangement (KB-I48)' };
    this.count = lamps.length;
    const colour = (k: number) => windowCandleColour(kelvinLinear, whiteBalance, k, WINDOW_ADAPT);
    const mkPointsMat = () =>
      new THREE.ShaderMaterial({
        name: 'festival.lamp',
        uniforms: { uScale: { value: 1000 }, uMinPx: { value: FEST_MIN_PX }, uFloor: { value: FEST_FAR_FLOOR }, uLevel: { value: 0 } },
        vertexShader: POINT_VS,
        fragmentShader: POINT_FS,
      });
    this.pointsMat = mkPointsMat();
    this.potsMat = mkPointsMat();
    additive(this.pointsMat);
    additive(this.potsMat);
    const mkPoints = (list: readonly FestLamp[], mat: THREE.ShaderMaterial) => {
      if (!list.length) return null;
      const pos = new Float32Array(list.length * 3);
      const col = new Float32Array(list.length * 3);
      const size = new Float32Array(list.length);
      list.forEach((l, i) => {
        pos.set(l.p, 3 * i);
        col.set(colour(l.kelvin), 3 * i);
        size[i] = FEST_GLOW_M[l.kind];
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.computeBoundingSphere();
      const p = new THREE.Points(g, mat);
      p.frustumCulled = false; // one cloud over the whole residence
      p.renderOrder = 3;
      this.group.add(p);
      return p;
    };
    const lampions = lamps.filter((l) => l.kind === 'lampion');
    const pots = lamps.filter((l) => l.kind === 'pot');
    mkPoints(lampions, this.pointsMat);
    mkPoints(pots, this.potsMat);

    // pools: on the wall behind sill and rotunda lamps (cornice lamps light upward, their wall is in the cornice's
    // shadow), on the ground under court, parterre and rim lamps
    const mkPoolMat = () =>
      new THREE.ShaderMaterial({ name: 'festival.pool', uniforms: { uLevel: { value: 0 } }, vertexShader: POOL_VS, fragmentShader: POOL_FS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.poolsMat = mkPoolMat();
    this.potPoolsMat = mkPoolMat();
    additive(this.poolsMat);
    additive(this.potPoolsMat);
    const plane = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const mkPools = (list: readonly FestLamp[], mat: THREE.ShaderMaterial) => {
      const pools = list.filter((l) => l.group !== 'cornice');
      const im = new THREE.InstancedMesh(plane, mat, Math.max(1, pools.length));
      im.count = pools.length;
      pools.forEach((l, i) => {
        const d = FEST_POOL_M[l.kind];
        if (l.wall && l.group !== 'rim') {
          // onto the wall plane behind the lamp, a little above it
          const back = l.group === 'sill' ? 0.16 : 0.35;
          v.set(l.p[0] - l.wall[0] * (back - 0.02), l.p[1] + d * 0.15, l.p[2] - l.wall[2] * (back - 0.02));
          q.setFromUnitVectors(zAxis, new THREE.Vector3(l.wall[0], 0, l.wall[2]).normalize());
        } else {
          // on the ground under the lamp (court and parterre levels are flat; the rim lamp sits on the coping)
          const drop = l.kind === 'pot' ? 1.13 : l.group === 'rim' ? 0.02 : 0.08;
          v.set(l.p[0], l.p[1] - drop, l.p[2]);
          q.setFromUnitVectors(zAxis, new THREE.Vector3(0, 1, 0));
        }
        m.compose(v, q, s.set(d, d, 1));
        im.setMatrixAt(i, m);
        const k = colour(l.kelvin);
        im.setColorAt(i, c.setRGB(k[0], k[1], k[2], THREE.LinearSRGBColorSpace));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      im.renderOrder = 2;
      this.group.add(im);
      return im;
    };
    mkPools(lampions, this.poolsMat);
    if (pots.length) mkPools(pots, this.potPoolsMat);
    this.group.visible = false;
  }

  /** Festival factor `on` (festivalOn), pre-exposure, and the drawing-buffer projection scale (px per m at 1 m). */
  update(on: number, pre: number): void {
    this.on = on;
    this.group.visible = on > 0.01;
    this.pointsMat.uniforms.uLevel.value = festCoreLevel('lampion', pre, on);
    this.potsMat.uniforms.uLevel.value = festCoreLevel('pot', pre, on);
    this.poolsMat.uniforms.uLevel.value = festPoolLevel('lampion', pre, on);
    this.potPoolsMat.uniforms.uLevel.value = festPoolLevel('pot', pre, on);
  }

  /** Per frame (cheap): the point size scale for the current drawing buffer and camera. */
  setView(bufferHeight: number, fovDeg: number): void {
    const scale = bufferHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.pointsMat.uniforms.uScale.value = scale;
    this.potsMat.uniforms.uScale.value = scale;
  }

  stats(): { lamps: number; visible: boolean; on: number } {
    return { lamps: this.count, visible: this.group.visible, on: this.on };
  }
}

/**
 * Terrain for the standalone viewer: the 1 m DTM crop from scripts/prepare-terrain.py (viewer/public/terrain/),
 * as chunked meshes (128 m) with distance LOD (1/2/4/8 m steps) and skirts against cracks, plus a ground-class
 * splat (lawn / meadow / gravel / sand / cobbles / water / forest) with world-scale CC0 textures.
 *
 * Grid: PixelIsArea, cell centre E = west + (col + 0.5), N = north − (row + 0.5) (meta.json).
 * Local frame: x = E − 381000, y = h, z = −(N − 5465000).
 */
import * as THREE from 'three';
import { E0, N0 } from '@model/frame.ts';

export interface TerrainMeta {
  grid: { west: number; north: number; east: number; south: number; cell: number; cols: number; rows: number };
  ground: { cell: number; cols: number; rows: number; classes: Record<string, { name: string; label_de: string }> };
  files: { dtm2025: string; dtm1789: string; ground: string };
  attribution: string;
  h_range: [number, number];
}

export type TerrainEpoch = '1789' | '2025';

export class TerrainData {
  constructor(
    public meta: TerrainMeta,
    public h1789: Float32Array,
    public h2025: Float32Array,
    public ground: Uint8Array,
  ) {}
  epoch: TerrainEpoch = '1789';
  get h(): Float32Array {
    return this.epoch === '1789' ? this.h1789 : this.h2025;
  }
  /** Bilinear height at local (x, z); NaN outside. */
  sample = (x: number, z: number): number => {
    const g = this.meta.grid;
    const E = x + E0;
    const N = N0 - z;
    const c = (E - g.west) / g.cell - 0.5;
    const r = (g.north - N) / g.cell - 0.5;
    if (c < 0 || r < 0 || c > g.cols - 1 || r > g.rows - 1) return NaN;
    const c0 = Math.min(g.cols - 2, Math.floor(c));
    const r0 = Math.min(g.rows - 2, Math.floor(r));
    const fc = c - c0;
    const fr = r - r0;
    const h = this.h;
    const i = r0 * g.cols + c0;
    const a = h[i] + (h[i + 1] - h[i]) * fc;
    const b = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * fc;
    return a + (b - a) * fr;
  };
  /** Grid cell value (row, col) clamped. */
  at(r: number, c: number): number {
    const g = this.meta.grid;
    r = Math.max(0, Math.min(g.rows - 1, r));
    c = Math.max(0, Math.min(g.cols - 1, c));
    return this.h[r * g.cols + c];
  }
  /** Local x/z of a cell centre. */
  cellX(c: number): number {
    return this.meta.grid.west + (c + 0.5) * this.meta.grid.cell - E0;
  }
  cellZ(r: number): number {
    return -(this.meta.grid.north - (r + 0.5) * this.meta.grid.cell - N0);
  }
}

export async function loadTerrain(base = './terrain/'): Promise<TerrainData> {
  const meta = (await (await fetch(`${base}meta.json`)).json()) as TerrainMeta;
  const [a, b, c] = await Promise.all([
    fetch(`${base}${meta.files.dtm1789}`).then((r) => r.arrayBuffer()),
    fetch(`${base}${meta.files.dtm2025}`).then((r) => r.arrayBuffer()),
    fetch(`${base}${meta.files.ground}`).then((r) => r.arrayBuffer()),
  ]);
  return new TerrainData(meta, new Float32Array(a), new Float32Array(b), new Uint8Array(c));
}

/** Ground class weights → RGBA texture (R lawn, G gravel/sand/cobbles/building, B forest, A water; meadow = rest). */
function groundWeightsTexture(t: TerrainData): THREE.DataTexture {
  const g = t.meta.ground;
  const n = g.cols * g.rows;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = t.ground[i];
    const o = i * 4;
    if (k === 1) data[o] = 255;
    else if (k === 2 || k === 3 || k === 4 || k === 7) data[o + 1] = k === 4 ? 200 : 255;
    else if (k === 6) data[o + 2] = 255;
    else if (k === 5) data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, g.cols, g.rows, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export interface TerrainMaterialOptions {
  textureBase?: string;
}

/** Terrain material: MeshStandardMaterial with a splat patch (world-UV textures, ground classes). */
export function terrainMaterial(t: TerrainData, opts: TerrainMaterialOptions = {}): THREE.MeshStandardMaterial {
  const loader = new THREE.TextureLoader();
  const load = (set: string, srgb = true) => {
    const x = loader.load(`${opts.textureBase ?? './textures/'}${set}/diff.jpg`);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    x.anisotropy = 8;
    return x;
  };
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  m.name = 'terrain';
  const g = t.meta.ground;
  const uniforms = {
    tWeights: { value: groundWeightsTexture(t) },
    tGrass: { value: load('grass') },
    tGravel: { value: load('gravel') },
    uGroundOrigin: { value: new THREE.Vector2(t.meta.grid.west - E0, -(t.meta.grid.north - N0)) },
    uGroundSize: { value: new THREE.Vector2(g.cols * g.cell, g.rows * g.cell) },
    uShowClasses: { value: 1 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosT;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPosT;
uniform sampler2D tWeights; uniform sampler2D tGrass; uniform sampler2D tGravel;
uniform vec2 uGroundOrigin; uniform vec2 uGroundSize; uniform float uShowClasses;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  vec2 xz = vWorldPosT.xz;
  vec2 guv = (vec2(xz.x, xz.y) - uGroundOrigin) / uGroundSize;
  vec4 w = texture2D(tWeights, guv) * uShowClasses;
  float meadow = clamp(1.0 - w.r - w.g - w.b - w.a, 0.0, 1.0);
  vec3 grass = texture2D(tGrass, xz / 2.0).rgb;
  vec3 grassFar = texture2D(tGrass, xz / 23.0).rgb;
  grass = mix(grass, grassFar, 0.35);
  vec3 gravel = texture2D(tGravel, xz / 2.0).rgb;
  float n = vnoise(xz / 9.0) * 0.6 + vnoise(xz / 41.0) * 0.4;
  // fix round 1: July meadows read green (HMS), with soft hay-green patches; ochre only on gravel / sand ways.
  // Gravel darkened to an albedo of ~0.45 (sRGB) - it read near-white from the air.
  vec3 lawn = grass * vec3(0.50, 1.06, 0.40);
  vec3 meadowC = grass * mix(vec3(0.50, 0.94, 0.36), vec3(0.64, 0.97, 0.40), n);
  vec3 gravelC = gravel * vec3(0.80, 0.76, 0.68);
  vec3 forest = mix(vec3(0.10, 0.13, 0.07), vec3(0.17, 0.19, 0.10), n) * (0.8 + 0.4 * grassFar.g);
  vec3 water = vec3(0.10, 0.15, 0.16);
  vec3 col = lawn * w.r + gravelC * w.g + forest * w.b + water * w.a + meadowC * meadow;
  diffuseColor.rgb *= col;
}`,
      );
  };
  m.customProgramCacheKey = () => 'terrain-splat';
  return m;
}

const CHUNK = 128;

/** Chunked LOD terrain. Call update(camera) every frame. */
export class TerrainMesh {
  group = new THREE.Group();
  private chunks: { r0: number; c0: number; mesh: THREE.Mesh | null; step: number; centre: THREE.Vector3; cache: Map<number, THREE.BufferGeometry> }[] = [];
  triangles = 0;
  constructor(
    public data: TerrainData,
    public material: THREE.Material,
  ) {
    this.group.name = 'terrain';
    const g = data.meta.grid;
    for (let r0 = 0; r0 < g.rows - 1; r0 += CHUNK) {
      for (let c0 = 0; c0 < g.cols - 1; c0 += CHUNK) {
        const cx = data.cellX(Math.min(g.cols - 1, c0 + CHUNK / 2));
        const cz = data.cellZ(Math.min(g.rows - 1, r0 + CHUNK / 2));
        const ch = data.at(Math.min(g.rows - 1, r0 + CHUNK / 2), Math.min(g.cols - 1, c0 + CHUNK / 2));
        this.chunks.push({ r0, c0, mesh: null, step: 0, centre: new THREE.Vector3(cx, ch, cz), cache: new Map() });
      }
    }
  }

  private geometry(r0: number, c0: number, step: number): THREE.BufferGeometry {
    const d = this.data;
    const g = d.meta.grid;
    const r1 = Math.min(g.rows - 1, r0 + CHUNK);
    const c1 = Math.min(g.cols - 1, c0 + CHUNK);
    const rowsIdx: number[] = [];
    for (let r = r0; r < r1; r += step) rowsIdx.push(r);
    rowsIdx.push(r1);
    const colsIdx: number[] = [];
    for (let c = c0; c < c1; c += step) colsIdx.push(c);
    colsIdx.push(c1);
    const nr = rowsIdx.length;
    const nc = colsIdx.length;
    const skirt = 2 * nr + 2 * nc;
    const pos = new Float32Array((nr * nc + skirt) * 3);
    let k = 0;
    for (const r of rowsIdx) for (const c of colsIdx) {
      pos[k++] = d.cellX(c);
      pos[k++] = d.at(r, c);
      pos[k++] = d.cellZ(r);
    }
    const idx: number[] = [];
    for (let i = 0; i < nr - 1; i++)
      for (let j = 0; j < nc - 1; j++) {
        const a = i * nc + j;
        const b = a + 1;
        const c = a + nc;
        const e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    // skirts: duplicate border vertices 4 m lower
    let v = nr * nc;
    const border = (list: number[]) => {
      const start = v;
      for (const bi of list) {
        pos[v * 3] = pos[bi * 3];
        pos[v * 3 + 1] = pos[bi * 3 + 1] - 4 * step;
        pos[v * 3 + 2] = pos[bi * 3 + 2];
        v++;
      }
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i];
        const b = list[i + 1];
        const a2 = start + i;
        const b2 = start + i + 1;
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both windings (cheap; skirts are tiny)
      }
    };
    border(Array.from({ length: nc }, (_, j) => j));
    border(Array.from({ length: nc }, (_, j) => (nr - 1) * nc + j));
    border(Array.from({ length: nr }, (_, i) => i * nc));
    border(Array.from({ length: nr }, (_, i) => i * nc + nc - 1));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  /** Pick the LOD step per chunk by distance from the camera. */
  update(camera: THREE.Camera, detail = 1): void {
    const p = camera.position;
    let tris = 0;
    for (const ch of this.chunks) {
      const dx = Math.max(0, Math.abs(p.x - ch.centre.x) - CHUNK / 2);
      const dz = Math.max(0, Math.abs(p.z - ch.centre.z) - CHUNK / 2);
      const dist = Math.hypot(dx, dz, (p.y - ch.centre.y) * 0.5) / detail;
      const step = dist < 180 ? 1 : dist < 450 ? 2 : dist < 1000 ? 4 : 8;
      if (step !== ch.step || !ch.mesh) {
        let geo = ch.cache.get(step);
        if (!geo) {
          geo = this.geometry(ch.r0, ch.c0, step);
          ch.cache.set(step, geo);
        }
        if (!ch.mesh) {
          ch.mesh = new THREE.Mesh(geo, this.material);
          ch.mesh.receiveShadow = true;
          ch.mesh.name = `terrain/${ch.r0}_${ch.c0}`;
          ch.mesh.userData = { part: 'terrain' };
          this.group.add(ch.mesh);
        } else ch.mesh.geometry = geo;
        ch.step = step;
      }
      tris += (ch.mesh.geometry.index?.count ?? 0) / 3;
    }
    this.triangles = tris;
  }

  /** Drop cached geometry (after switching epoch). */
  rebuild(): void {
    for (const ch of this.chunks) {
      for (const g of ch.cache.values()) g.dispose();
      ch.cache.clear();
      ch.step = 0;
    }
  }

  /** Full-resolution meshes around a point (for walk-mode collision). */
  colliderAround(x: number, z: number, radius = 192): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const ch of this.chunks) {
      if (Math.abs(ch.centre.x - x) > radius + CHUNK / 2 || Math.abs(ch.centre.z - z) > radius + CHUNK / 2) continue;
      let geo = ch.cache.get(1);
      if (!geo) {
        geo = this.geometry(ch.r0, ch.c0, 1);
        ch.cache.set(1, geo);
      }
      const m = new THREE.Mesh(geo);
      m.name = `terrain-collider/${ch.r0}_${ch.c0}`;
      out.push(m);
    }
    return out;
  }
}

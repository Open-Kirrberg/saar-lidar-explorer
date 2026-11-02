/**
 * Water detail (backlog KB-I37; research/11 G13, S12; materials-vegetation-water.md §7). Content only; the reflection
 * itself is the viewer's (post.ts screen-space reflection, the `water` material's ripples and alpha marker in
 * materials/index.ts `waterPatch`).
 *
 * - **Wet bank** (`wetBank`): ponds with a natural bank were flat planes cutting the terrain with a hard line. A 1.6 m
 *   band on the bank above the waterline darkens the ground multiplicatively (wet soil and trodden grass at the water,
 *   fading out up the bank) [I]. Formal basins with a stone coping have no bank and get none. No reeds: no source
 *   documents reeds at the 1789 ponds (research/11 lists grass to the water on the gentle side and boulders on the
 *   Schwanenweiher dams [D]); the boulders wait for located dams (no dam geometry for the Schwanenweiher in the
 *   catalogue; research/03 locates only the Karlsbergweiher W dam, which has no boulder evidence).
 * - **Jet spray** (`jetSpray`): droplets falling from a fountain jet's crown on ballistic paths, animated by the shared
 *   `waterTime` (seconds), so the static jet meshes (features.ts) get motion and a soft spray edge [I look; jet heights
 *   are catalogue facts, GARDEN.basin.jet N].
 * - `offsetRing` and `sprayPoint` are pure (tests: model/tests/water.test.ts).
 */
import * as THREE from 'three';
import { hashString, mulberry32 } from '../layout/geom.ts';
import { waterTime } from '../materials/index.ts';

/**
 * Wet bank: width (m) up the bank from the waterline, the darkening at the water / mid-band, the lift (m) above the
 * ground, how far (m) the ground may lie below the water level before a band vertex counts as under water, and the
 * longest band segment (m) along the shore; `dryAt` (m) above the water the bank is dry (wetShade) [I].
 */
export const WET_BANK = { width: 1.6, mid: 0.5, atWater: 0.62, atMid: 0.84, lift: 0.05, submerged: 0.03, step: 1.5, dryAt: 1 } as const;

/** Signed area of a closed ring (x, z) in the local frame (positive = counter-clockwise in x/z). */
export function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % r.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/**
 * Offset a ring (local x, z; closed or open) outward by `d` metres: each vertex moves along the mean of its two edge
 * normals, scaled so straight edges keep their distance (mitre, capped at 2·d on sharp corners). Returns an open ring
 * (no repeated last point) with the same vertex order.
 */
export function offsetRing(ring: [number, number][], d: number): [number, number][] {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  const n = r.length;
  if (n < 3) return r;
  // outward normal of an edge: for a CCW ring (positive area) the outside is on the right of the edge direction
  const s = ringArea(r) > 0 ? 1 : -1;
  const edgeN = (i: number): [number, number] => {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % n];
    const ex = x1 - x0;
    const ez = z1 - z0;
    const l = Math.hypot(ex, ez) || 1;
    return [(s * ez) / l, (-s * ex) / l];
  };
  return r.map((p, i) => {
    const a = edgeN((i - 1 + n) % n);
    const b = edgeN(i);
    let mx = a[0] + b[0];
    let mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = b[0];
      mz = b[1];
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = mx * b[0] + mz * b[1];
    const k = Math.min(2, 1 / Math.max(0.5, cos));
    return [p[0] + mx * d * k, p[1] + mz * d * k];
  });
}

/**
 * Insert points along every edge of a ring (closed or open) so that no edge is longer than `step` metres. Returns an
 * open ring. The wet bank follows the terrain only at its vertices, so long catalogue edges must be split.
 */
export function densifyRing(ring: [number, number][], step: number): [number, number][] {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  const out: [number, number][] = [];
  for (let i = 0; i < r.length; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % r.length];
    const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let j = 0; j < k; j++) out.push([x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k]);
  }
  return out;
}

/**
 * Darkening (multiplier) of a wet-bank vertex in band row `row` (0 at the water, 1 mid, 2 outer edge) that lies `rise`
 * metres above the water level: the wet look fades over the band's width and, on steep banks, over the first metre of
 * height (soil a metre above the water is dry whatever its distance) [I].
 */
export function wetShade(row: number, rise: number): number {
  const byRow = [WET_BANK.atWater, WET_BANK.atMid, 1][Math.min(2, Math.max(0, Math.round(row)))];
  const t = Math.min(1, Math.max(0, rise / WET_BANK.dryAt));
  const byRise = WET_BANK.atWater + (1 - WET_BANK.atWater) * t;
  return Math.max(byRow, byRise);
}

/**
 * Multiplicative wet band on the bank of a pond (local ring x, z; water level `level`; terrain sampler). Unlit vertex
 * colours from `wetShade`: `WET_BANK.atWater` at the waterline → `atMid` → 1 at the top of the band or a metre above
 * the water. Blending multiplies the colour and keeps the target's alpha (the post chain's water marker). Returns null
 * for degenerate rings and when no part of the band lies on dry ground.
 */
export function wetBank(ring: [number, number][], level: number, terrain: (x: number, z: number) => number, name: string): THREE.Mesh | null {
  const dense = densifyRing(ring, WET_BANK.step);
  const rows = [0.05, WET_BANK.mid, WET_BANK.width].map((d) => offsetRing(dense, d));
  const n = rows[0].length;
  if (n < 3) return null;
  const pos: number[] = [];
  const col: number[] = [];
  // the catalogue ring is only roughly the shoreline: where the band would lie on water (terrain below the level, or
  // no terrain) there is no bank, and quads touching such a vertex are dropped (a dark stripe floated on the
  // Karlsbergweiher where its ring runs inside the water)
  const dry: boolean[] = [];
  for (let k = 0; k < rows.length; k++)
    for (const [x, z] of rows[k]) {
      const g = terrain(x, z);
      const ok = Number.isFinite(g) && g >= level - WET_BANK.submerged;
      dry.push(ok);
      pos.push(x, (ok ? Math.max(g, level) : level) + WET_BANK.lift, z);
      const sh = wetShade(k, ok ? g - level : 0);
      col.push(sh, sh, sh * 0.98);
    }
  const idx: number[] = [];
  const front = ringArea(rows[0]) > 0;
  for (let k = 0; k < rows.length - 1; k++)
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      const c = (k + 1) * n + ((i + 1) % n);
      const e = (k + 1) * n + i;
      if (!(dry[a] && dry[b] && dry[c] && dry[e])) continue;
      // faces up (+y): counter-clockwise seen from above, whichever way the ring runs (tests: model/tests/water.test.ts)
      if (front) idx.push(a, b, e, b, c, e);
      else idx.push(a, e, b, b, e, c);
    }
  if (idx.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, wetBankMaterial());
  mesh.name = name;
  mesh.renderOrder = 1;
  mesh.userData = { part: 'water-edge', evidence: 'I', tag: 'I wet bank (look); research/11 S12 grass to the water [D]' };
  return mesh;
}

let wetMat: THREE.MeshBasicMaterial | null = null;
function wetBankMaterial(): THREE.MeshBasicMaterial {
  if (!wetMat) {
    wetMat = new THREE.MeshBasicMaterial({
      name: 'water.bank',
      vertexColors: true,
      fog: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
  }
  return wetMat;
}

// ---------------------------------------------------------------- jet spray

/** Droplet count per metre of jet height, droplet size (m) and the upward kick at the crown (m/s) [I]. */
export const JET_SPRAY = { perMetre: 90, size: 0.07, kick: 1.2, spread: [0.06, 0.24] as [number, number], opacity: 0.55 } as const;
const G = 9.81;

/**
 * Position (relative to the jet foot) of droplet `seed` (three numbers 0…1: phase, azimuth, spread) at time `t` (s) for
 * a jet of height `h`: it leaves the crown with an upward kick and an outward speed, and falls to the water (y = 0).
 * Pure twin of the vertex shader below.
 */
export function sprayPoint(seed: [number, number, number], h: number, t: number): [number, number, number] {
  const vu = JET_SPRAY.kick * (0.3 + 0.7 * seed[2]);
  const T = (vu + Math.sqrt(vu * vu + 2 * G * h)) / G;
  const u = (((seed[0] + t / T) % 1) + 1) % 1;
  const tt = u * T;
  const spread = JET_SPRAY.spread[0] + (JET_SPRAY.spread[1] - JET_SPRAY.spread[0]) * seed[2];
  const r = 0.1 + (spread * h * tt) / T;
  const a = seed[1] * Math.PI * 2;
  return [Math.cos(a) * r, Math.max(0, h - 0.3 + vu * tt - 0.5 * G * tt * tt), Math.sin(a) * r];
}

/** Light of the spray droplets (linear, pre-exposed): the viewer sets it per hour (atmosphere.ts); white by default. */
export const sprayColour = new THREE.Color(0.8, 0.8, 0.8);

let sprayMat: THREE.PointsMaterial | null = null;
function sprayMaterial(): THREE.PointsMaterial {
  if (sprayMat) return sprayMat;
  const m = new THREE.PointsMaterial({ name: 'water.spray', size: JET_SPRAY.size, sizeAttenuation: true, transparent: true, opacity: JET_SPRAY.opacity, depthWrite: false });
  m.color = sprayColour;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterTime = waterTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uWaterTime;\nattribute vec3 aSeed;\nattribute float aH;`)
      .replace(
        '#include <begin_vertex>',
        `float vu = ${JET_SPRAY.kick.toFixed(3)} * ( 0.3 + 0.7 * aSeed.z );
  float T = ( vu + sqrt( vu * vu + ${(2 * G).toFixed(3)} * aH ) ) / ${G.toFixed(3)};
  float u = fract( aSeed.x + uWaterTime / T );
  float tt = u * T;
  float spread = ${JET_SPRAY.spread[0].toFixed(3)} + ${(JET_SPRAY.spread[1] - JET_SPRAY.spread[0]).toFixed(3)} * aSeed.z;
  float rr = 0.1 + spread * aH * tt / T;
  float ang = aSeed.y * 6.2831853;
  vec3 transformed = vec3( cos( ang ) * rr, max( 0.0, aH - 0.3 + vu * tt - ${(0.5 * G).toFixed(4)} * tt * tt ), sin( ang ) * rr );`,
      );
    // round, soft droplets
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float rd = dot( pc, pc );
  if ( rd > 1.0 ) discard;`,
    ).replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.a *= 1.0 - rd * rd;');
  };
  m.customProgramCacheKey = () => 'water.spray';
  sprayMat = m;
  return m;
}

/** Animated droplet spray of a jet of height `h` (m) standing at the origin (place the returned object at the jet foot). */
export function jetSpray(h: number, id: string): THREE.Points {
  const n = Math.max(60, Math.round(JET_SPRAY.perMetre * h));
  const rnd = mulberry32(hashString(`${id}/spray`));
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = rnd();
  const geo = new THREE.BufferGeometry();
  // positions are computed in the shader; the attribute only sizes the draw and the bounds
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(new Float32Array(n).fill(h), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, h / 2, 0), h * 0.6 + 1);
  const p = new THREE.Points(geo, sprayMaterial());
  p.name = `feature/${id}/jet-spray`;
  p.renderOrder = 3;
  p.userData = { part: 'water' };
  return p;
}

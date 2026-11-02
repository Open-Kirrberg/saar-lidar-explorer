/**
 * Triangle soup builder that buckets geometry by material and emits one merged mesh per material.
 *
 * All input points are building-local [s, t, h] (plan metres + absolute height); output vertices are in the
 * building-group object space (X, Y, Z) = (s, h, −t) (docs/architecture.md §3.2).
 * UVs are world-scale metres, derived from the face plane (walls: u along the wall, v = height; roofs: u along
 * the eaves, v up the slope; horizontal faces: plan s/t) — materials set repeat = 1 / real texture size.
 */
import * as THREE from 'three';
import type { MaterialLibrary, MaterialName } from '../context.ts';
import { AO, SHADE_ATTRIBUTE, type Shade, encodeShade } from './shade.ts';

export type P3 = [number, number, number]; // [s, t, h]

/** A material key: a library name, optionally tinted ("render.lime|#ECE8DF"). */
export type MatKey = MaterialName | `${MaterialName}|${string}`;

export function matKey(name: MaterialName, colour?: string | null): MatKey {
  return colour ? (`${name}|${colour}` as MatKey) : name;
}

export function resolveMaterial(lib: MaterialLibrary, key: MatKey, baked = false): THREE.Material {
  const i = key.indexOf('|');
  const name = (i < 0 ? key : key.slice(0, i)) as MaterialName;
  const colour = i < 0 ? undefined : key.slice(i + 1);
  // KB-I19/I20: geometry with a baked vertex shade uses the library's shade-reading variant (if it has one)
  if (baked && lib.baked) return lib.baked(name, colour);
  return colour === undefined ? lib.get(name) : lib.tinted(name, colour);
}

class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  /** Raw per-vertex shade (rgb albedo multiplier + AO), 4 per vertex; only when the builder bakes. */
  shade: number[] = [];
}

/**
 * Per-vertex shade provider for the following primitives (KB-I19/I20): writes the vertex shade into `out` (already
 * filled with the default: white, AO = soffit rule). `ny` is the face normal's height component (object space).
 */
export type ShadeFn = (p: P3, ny: number, out: Shade) => void;

const _shade: Shade = [1, 1, 1, 1];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class GeoBuilder {
  buckets = new Map<MatKey, Bucket>();
  /** Write a per-vertex shade attribute (KB-I19/I20) and use the library's `baked()` materials. */
  readonly bake: boolean;
  /** Current per-vertex shade provider (null: default = AO soffit rule, no tint). */
  shadeFn: ShadeFn | null = null;
  /** Albedo multiplier per material name (per-building limewash / roof jitter), applied on top of `shadeFn`. */
  tints = new Map<string, [number, number, number]>();

  constructor(opts: { bake?: boolean } = {}) {
    this.bake = opts.bake ?? false;
  }

  /** Run `draw` with `fn` as the shade provider (restores the previous one). */
  withShade(fn: ShadeFn | null, draw: () => void): void {
    const prev = this.shadeFn;
    this.shadeFn = fn;
    try {
      draw();
    } finally {
      this.shadeFn = prev;
    }
  }

  private bucket(k: MatKey): Bucket {
    let b = this.buckets.get(k);
    if (!b) {
      b = new Bucket();
      this.buckets.set(k, b);
    }
    return b;
  }

  /**
   * Triangle in [s,t,h]; counter-clockwise seen from the front (outside). Optional smooth normals (object space) and
   * an explicit ambient occlusion per vertex (overrides the shade provider's AO).
   */
  tri(k: MatKey, p0: P3, p1: P3, p2: P3, normals?: [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null, ao?: readonly [number, number, number]): void {
    const q0 = [p0[0], p0[2], -p0[1]];
    const q1 = [p1[0], p1[2], -p1[1]];
    const q2 = [p2[0], p2[2], -p2[1]];
    _a.set(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]);
    _b.set(q2[0] - q0[0], q2[1] - q0[1], q2[2] - q0[2]);
    _n.crossVectors(_a, _b);
    const len = _n.length();
    if (len < 1e-10) return;
    _n.divideScalar(len);
    // face-plane UV axes
    if (Math.abs(_n.y) > 0.85) {
      _u.set(1, 0, 0);
      _v.set(0, 0, -1);
    } else {
      _u.crossVectors(UP, _n).normalize(); // horizontal, along the face
      _v.crossVectors(_n, _u).normalize(); // up the face (slope)
    }
    const b = this.bucket(k);
    for (let i = 0; i < 3; i++) {
      const q = i === 0 ? q0 : i === 1 ? q1 : q2;
      b.pos.push(q[0], q[1], q[2]);
      const nn = normals ? normals[i] : _n;
      b.nor.push(nn.x, nn.y, nn.z);
      // u, v in metres; v uses world height for walls so courses line up between pieces
      const u = q[0] * _u.x + q[1] * _u.y + q[2] * _u.z;
      const v = q[0] * _v.x + q[1] * _v.y + q[2] * _v.z;
      b.uv.push(u, v);
    }
    if (this.bake) {
      const ny = _n.y;
      const tint = this.tints.get(k.split('|')[0]);
      for (let i = 0; i < 3; i++) {
        _shade[0] = 1;
        _shade[1] = 1;
        _shade[2] = 1;
        _shade[3] = ny < -0.5 ? AO.soffit : 1;
        if (this.shadeFn) this.shadeFn(i === 0 ? p0 : i === 1 ? p1 : p2, ny, _shade);
        if (ao) _shade[3] = ao[i];
        if (tint) {
          _shade[0] *= tint[0];
          _shade[1] *= tint[1];
          _shade[2] *= tint[2];
        }
        b.shade.push(_shade[0], _shade[1], _shade[2], _shade[3]);
      }
    }
  }

  /** Quad p0 p1 p2 p3 (counter-clockwise from the front), optional AO per corner. */
  quad(k: MatKey, p0: P3, p1: P3, p2: P3, p3: P3, ao?: readonly [number, number, number, number]): void {
    this.tri(k, p0, p1, p2, null, ao ? [ao[0], ao[1], ao[2]] : undefined);
    this.tri(k, p0, p2, p3, null, ao ? [ao[0], ao[2], ao[3]] : undefined);
  }

  /** Quad whose front faces `dir` ([s, t, h]); the winding is flipped if needed (AO per corner follows the corners). */
  quadFacing(k: MatKey, p0: P3, p1: P3, p2: P3, p3: P3, dir: P3, ao?: readonly [number, number, number, number]): void {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) this.quad(k, p0, p1, p2, p3, ao);
    else this.quad(k, p3, p2, p1, p0, ao ? [ao[3], ao[2], ao[1], ao[0]] : undefined);
  }

  /** Planar polygon (any orientation), triangulated in its own plane; `flip` reverses the facing. */
  polygon(k: MatKey, pts: P3[], flip = false): void {
    if (pts.length < 3) return;
    if (pts.length === 3) {
      if (flip) this.tri(k, pts[0], pts[2], pts[1]);
      else this.tri(k, pts[0], pts[1], pts[2]);
      return;
    }
    // Newell normal
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      nx += (a[1] - c[1]) * (a[2] + c[2]);
      ny += (a[2] - c[2]) * (a[0] + c[0]);
      nz += (a[0] - c[0]) * (a[1] + c[1]);
    }
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const ax = new THREE.Vector3().crossVectors(ref, n).normalize();
    const ay = new THREE.Vector3().crossVectors(n, ax);
    const p2 = pts.map((p) => new THREE.Vector2(p[0] * ax.x + p[1] * ax.y + p[2] * ax.z, p[0] * ay.x + p[1] * ay.y + p[2] * ay.z));
    const ccw = !THREE.ShapeUtils.isClockWise(p2);
    const tris = THREE.ShapeUtils.triangulateShape(p2, []);
    for (const [i, j, l] of tris) {
      // triangulateShape returns triangles in the 2D orientation of the contour
      const a = pts[i];
      let b = pts[j];
      let c = pts[l];
      const t2 = THREE.ShapeUtils.area([p2[i], p2[j], p2[l]]);
      const triCcw = t2 > 0;
      if (triCcw !== ccw) [b, c] = [c, b];
      if (flip) [b, c] = [c, b];
      this.tri(k, a, b, c);
    }
  }

  /** Planar polygon whose front faces `dir` ([s, t, h] direction). */
  polygonFacing(k: MatKey, pts: P3[], dir: P3): void {
    let ns = 0;
    let nt = 0;
    let nh = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      ns += (a[1] - c[1]) * (a[2] + c[2]);
      nt += (a[2] - c[2]) * (a[0] + c[0]);
      nh += (a[0] - c[0]) * (a[1] + c[1]);
    }
    this.polygon(k, pts, ns * dir[0] + nt * dir[1] + nh * dir[2] < 0);
  }

  /** Axis-aligned box in building space: s0..s1, t0..t1, h0..h1 (all six faces unless `skip`). */
  box(k: MatKey, s0: number, s1: number, t0: number, t1: number, h0: number, h1: number, skipBottom = true): void {
    const c = (s: number, t: number, h: number): P3 => [s, t, h];
    // sides (outward normals: −t, +s, +t, −s)
    this.quad(k, c(s0, t0, h0), c(s1, t0, h0), c(s1, t0, h1), c(s0, t0, h1));
    this.quad(k, c(s1, t0, h0), c(s1, t1, h0), c(s1, t1, h1), c(s1, t0, h1));
    this.quad(k, c(s1, t1, h0), c(s0, t1, h0), c(s0, t1, h1), c(s1, t1, h1));
    this.quad(k, c(s0, t1, h0), c(s0, t0, h0), c(s0, t0, h1), c(s0, t1, h1));
    this.quad(k, c(s0, t0, h1), c(s1, t0, h1), c(s1, t1, h1), c(s0, t1, h1));
    if (!skipBottom) this.quad(k, c(s0, t1, h0), c(s1, t1, h0), c(s1, t0, h0), c(s0, t0, h0));
  }

  /**
   * Box oriented along a facade: `o` = point on the wall plane [s,t], `tan` = unit tangent, `nrm` = outward normal.
   * a0..a1 along tan, d0..d1 along nrm (outwards positive), h0..h1.
   */
  orientedBox(k: MatKey, o: [number, number], tan: [number, number], nrm: [number, number], a0: number, a1: number, d0: number, d1: number, h0: number, h1: number, skipBack = false, skip: 'none' | 'ends' | 'caps' = 'none'): void {
    const P = (a: number, d: number, h: number): P3 => [o[0] + tan[0] * a + nrm[0] * d, o[1] + tan[1] * a + nrm[1] * d, h];
    // front (outward)
    this.quad(k, P(a0, d1, h0), P(a1, d1, h0), P(a1, d1, h1), P(a0, d1, h1));
    if (!skipBack) this.quad(k, P(a1, d0, h0), P(a0, d0, h0), P(a0, d0, h1), P(a1, d0, h1));
    // ends (skip 'ends': hidden in a frame, e.g. horizontal glazing bars)
    if (skip !== 'ends') {
      this.quad(k, P(a1, d1, h0), P(a1, d0, h0), P(a1, d0, h1), P(a1, d1, h1));
      this.quad(k, P(a0, d0, h0), P(a0, d1, h0), P(a0, d1, h1), P(a0, d0, h1));
    }
    // top + bottom (skip 'caps': vertical glazing bars)
    if (skip !== 'caps') {
      this.quad(k, P(a0, d1, h1), P(a1, d1, h1), P(a1, d0, h1), P(a0, d0, h1));
      this.quad(k, P(a0, d0, h0), P(a1, d0, h0), P(a1, d1, h0), P(a0, d1, h0));
    }
  }

  triangleCount(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.pos.length / 9;
    return n;
  }

  /** One Mesh per material bucket, named `<prefix>/<material>`. */
  toMeshes(lib: MaterialLibrary, prefix: string, userData: Record<string, unknown>, shadows = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, b] of this.buckets) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if (this.bake && b.shade.length === b.pos.length / 3 * 4) {
        const sh = new Uint16Array(b.shade.length);
        encodeShade(b.shade, sh);
        g.setAttribute(SHADE_ATTRIBUTE, new THREE.BufferAttribute(sh, 4, true));
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const mat = resolveMaterial(lib, k, this.bake && !!g.attributes[SHADE_ATTRIBUTE]);
      const m = new THREE.Mesh(g, mat);
      const mname = k.split('|')[0];
      m.name = `${prefix}/${mname}`;
      m.userData = { ...userData, material: mname };
      const transparent = (mat as THREE.Material).transparent;
      m.castShadow = shadows && !transparent;
      m.receiveShadow = shadows;
      out.push(m);
    }
    return out;
  }
}

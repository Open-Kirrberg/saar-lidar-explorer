/**
 * Geometry accumulation for the interiors: everything is collected in buckets keyed by
 * (room, element, material) and merged into one mesh per bucket at the end, so a building has
 * a few hundred draw calls at most while every mesh still carries { roomId, name_de, evidence }.
 *
 * Coordinates: building group object space (X, Y, Z) = (s, h, −t), h absolute (m DHHN2016).
 * UVs are in metres (1 UV unit = 1 m); the material library scales textures by their real size.
 */
import * as THREE from 'three';
import type { ST } from '../spec.ts';

export type V3 = [number, number, number];

/** Building [s, t] + absolute height -> group object space. */
export const O = (s: number, t: number, h: number): V3 => [s, h, -t];

/** Translation matrix (furniture, fixtures, hearths). */
export const T = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z);
/** Closed cylinder from radius `rBottom` to `rTop` over height h, centred on the origin. */
export const cyl = (rBottom: number, rTop: number, h: number, seg = 8): THREE.CylinderGeometry => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

export interface PartInfo {
  buildingId: string;
  roomId?: string;
  /** German label for the info panel. */
  name_de: string;
  /** Evidence letters (D, D->, I, N, U, HMS), e.g. "N" or "I N". */
  evidence: string;
  /** Free-text evidence note. */
  tag: string;
  /** Element group: 'shell', 'boiserie', 'door', 'fixture', 'stair', ... */
  element: string;
}

export class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** Linear vertex colours (KB-I26 canvases, mirrors); written only once `ink` was used, white elsewhere. */
  col: number[] = [];
  private coloured = false;
  private ink: V3 = [1, 1, 1];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vert(p: V3, n: V3, u: number, v: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(this.ink[0], this.ink[1], this.ink[2]);
    return this.pos.length / 3 - 1;
  }

  /**
   * Planar grid over the quad a (u0 v0) - b (u1 v0) - c (u1 v1) - d (u0 v1) with `nx` × `ny` vertices and one LINEAR
   * colour per vertex (`colour(i, j)`, j from the a-b edge). The geometry then carries a `color` attribute (KB-I26).
   */
  colourGrid(a: V3, b: V3, c: V3, d: V3, normal: V3, nx: number, ny: number, colour: (i: number, j: number) => V3): void {
    this.coloured = true;
    const base = this.vertexCount;
    const flip = dot(cross(sub(b, a), sub(d, a)), normal) < 0;
    for (let j = 0; j < ny; j++) {
      const ty = j / (ny - 1);
      for (let i = 0; i < nx; i++) {
        const tx = i / (nx - 1);
        const p: V3 = [0, 1, 2].map((k) => (1 - ty) * ((1 - tx) * a[k] + tx * b[k]) + ty * ((1 - tx) * d[k] + tx * c[k])) as V3;
        this.ink = colour(i, j);
        this.vert(p, normal, tx, ty);
      }
    }
    this.ink = [1, 1, 1];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const q0 = base + j * nx + i;
        const q1 = q0 + 1;
        const q3 = q0 + nx;
        const q2 = q3 + 1;
        if (flip) this.idx.push(q0, q2, q1, q0, q3, q2);
        else this.idx.push(q0, q1, q2, q0, q2, q3);
      }
    }
  }

  /**
   * Planar quad a-b-c-d (any winding) facing `normal`. UVs: metres projected on the quad's
   * two dominant axes (or `uvs` when given).
   */
  quad(a: V3, b: V3, c: V3, d: V3, normal: V3, uvs?: [number, number][]): void {
    const e1 = sub(b, a);
    const e2 = sub(d, a);
    const n = cross(e1, e2);
    const flip = dot(n, normal) < 0;
    const pts = [a, b, c, d];
    const uv = uvs ?? pts.map((p) => planarUV(p, normal));
    const i = pts.map((p, k) => this.vert(p, normal, uv[k][0], uv[k][1]));
    if (flip) this.idx.push(i[0], i[2], i[1], i[0], i[3], i[2]);
    else this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }

  /** Triangle facing `normal`. */
  tri(a: V3, b: V3, c: V3, normal: V3): void {
    const n = cross(sub(b, a), sub(c, a));
    const i = [a, b, c].map((p) => {
      const uv = planarUV(p, normal);
      return this.vert(p, normal, uv[0], uv[1]);
    });
    if (dot(n, normal) < 0) this.idx.push(i[0], i[2], i[1]);
    else this.idx.push(i[0], i[1], i[2]);
  }

  /**
   * Box [min, max] in a local frame, transformed by `m` (rotation + translation only).
   * `skip`: faces to omit ('-y' bottom etc.) for pieces standing on a floor or against a wall.
   */
  box(min: V3, max: V3, m?: THREE.Matrix4, skip: string[] = []): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const faces: [string, V3, V3[]][] = [
      ['+x', [1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]],
      ['-x', [-1, 0, 0], [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]]],
      ['+y', [0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      ['-y', [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      ['+z', [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ['-z', [0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [name, n, ps] of faces) {
      if (skip.includes(name)) continue;
      const uvs = ps.map((p) => planarUV(p, n));
      const tp = m ? ps.map((p) => apply(m, p)) : ps;
      const tn = m ? applyDir(m, n) : n;
      this.quad(tp[0], tp[1], tp[2], tp[3], tn, uvs);
    }
  }

  /** Append a BufferGeometry transformed by `m` (normals transformed, UVs kept or planar). */
  geometry(g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const base = this.vertexCount;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const v = new THREE.Vector3();
    const w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (m) v.applyMatrix4(m);
      if (n) {
        w.fromBufferAttribute(n, i);
        if (nm) w.applyMatrix3(nm).normalize();
      } else w.set(0, 1, 0);
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(w.x, w.y, w.z);
      this.col.push(1, 1, 1);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i));
      else this.uv.push(v.x, v.z);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  /**
   * Extrude a 2D profile along a closed polygon loop (plan [s, t], CCW). Profile points are
   * [inset, h] (inset from the loop towards the polygon inside, absolute h), listed from the
   * wall foot around the room side to the wall top / ceiling. Mitred corners.
   */
  profileLoop(loop: ST[], profile: [number, number][]): void {
    const n = loop.length;
    const offsetPoint = (i: number, inset: number): ST => {
      const prev = loop[(i - 1 + n) % n];
      const cur = loop[i];
      const next = loop[(i + 1) % n];
      const n1 = inward(prev, cur);
      const n2 = inward(cur, next);
      const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      const mx = (n1[0] + n2[0]) / Math.max(k, 0.2);
      const my = (n1[1] + n2[1]) / Math.max(k, 0.2);
      return [cur[0] + mx * inset, cur[1] + my * inset];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const nIn = inward(loop[i], loop[j]);
      for (let k = 0; k < profile.length - 1; k++) {
        const [ia, ha] = profile[k];
        const [ib, hb] = profile[k + 1];
        const a0 = offsetPoint(i, ia);
        const a1 = offsetPoint(j, ia);
        const b0 = offsetPoint(i, ib);
        const b1 = offsetPoint(j, ib);
        // profile segment normal (in the [inward, up] plane), pointing into the room / down
        const dIn = ib - ia;
        const dH = hb - ha;
        // profiles run from the wall foot around the room side: the room is to the right
        const nx = dH;
        const ny = -dIn;
        const ln = Math.hypot(nx, ny) || 1;
        const nrm: V3 = [(nIn[0] * nx) / ln, ny / ln, (-nIn[1] * nx) / ln];
        const along = Math.hypot(loop[j][0] - loop[i][0], loop[j][1] - loop[i][1]);
        const vA = k * 0.1;
        this.quad(O(a0[0], a0[1], ha), O(a1[0], a1[1], ha), O(b1[0], b1[1], hb), O(b0[0], b0[1], hb), nrm, [
          [0, vA],
          [along, vA],
          [along, vA + 0.1],
          [0, vA + 0.1],
        ]);
      }
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.coloured) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function inward(a: ST, b: ST): ST {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function planarUV(p: V3, n: V3): [number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0], -p[2]];
  if (ax >= az) return [-p[2] * Math.sign(n[0] || 1), p[1]];
  return [p[0] * Math.sign(n[2] || 1), p[1]];
}

const _v = new THREE.Vector3();
function apply(m: THREE.Matrix4, p: V3): V3 {
  _v.set(p[0], p[1], p[2]).applyMatrix4(m);
  return [_v.x, _v.y, _v.z];
}
function applyDir(m: THREE.Matrix4, n: V3): V3 {
  _v.set(n[0], n[1], n[2]).transformDirection(m);
  return [_v.x, _v.y, _v.z];
}

/**
 * Matrix placing a local piece (X = width, Y = up, Z = depth, front +Z, origin at its floor
 * centre) at building [s, t], absolute height h, front facing the [s, t] direction `facing`.
 */
export function placeMatrix(pos: ST, h: number, facing: ST, scale: V3 = [1, 1, 1]): THREE.Matrix4 {
  const yaw = Math.atan2(facing[0], -facing[1]);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return new THREE.Matrix4().compose(new THREE.Vector3(pos[0], h, -pos[1]), q, new THREE.Vector3(...scale));
}

// ---------------------------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------------------------

interface Entry {
  bucket: Bucket;
  material: THREE.Material;
  info: PartInfo;
}

export class Accumulator {
  private entries = new Map<string, Entry>();

  /** Bucket for (room, element, material); `info` of the first call wins. */
  get(material: THREE.Material, info: PartInfo): Bucket {
    const key = `${info.roomId ?? '-'}|${info.element}|${material.uuid}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { bucket: new Bucket(), material, info };
      this.entries.set(key, e);
    }
    return e.bucket;
  }

  /** One mesh per non-empty bucket, with the PartUserData + info-panel fields. */
  meshes(lod: number): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const { bucket, material, info } of this.entries.values()) {
      if (!bucket.idx.length) continue;
      const mesh = new THREE.Mesh(bucket.toGeometry(), material);
      mesh.name = `${info.buildingId}/${info.roomId ?? 'interior'}/${info.element}/${material.name || 'material'}`;
      mesh.userData = {
        buildingId: info.buildingId,
        part: `interior/${info.element}`,
        lod,
        roomId: info.roomId,
        name_de: info.name_de,
        evidence: info.evidence,
        tag: info.tag,
        // walk mode uses the invisible collider mesh (ramps instead of steps, open doorways)
        collider: false,
      };
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.push(mesh);
    }
    return out;
  }
}

/** Collider geometry (positions only); one invisible mesh per building. */
export class ColliderBucket {
  readonly b = new Bucket();
  quad(a: V3, b: V3, c: V3, d: V3): void {
    const n = cross(sub(b, a), sub(d, a));
    this.b.quad(a, b, c, d, n);
  }
  box(min: V3, max: V3, m?: THREE.Matrix4): void {
    this.b.box(min, max, m);
  }
  mesh(buildingId: string, name: string, part: string): THREE.Mesh | null {
    if (!this.b.idx.length) return null;
    const m = new THREE.Mesh(this.b.toGeometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    m.name = `${buildingId}/interior/${name}`;
    m.visible = false;
    m.userData = { buildingId, part, lod: 2, collider: true };
    return m;
  }
}

// ---------------------------------------------------------------------------------------------
// Moulded frames (KB-I26: gilt mouldings with a profile, so burnished gilding catches highlights)
// ---------------------------------------------------------------------------------------------

/** Cross-section of a moulding: [inset from the outer edge, height above the wall] from the outer to the inner edge. */
export type MouldProfile = [number, number][];

/**
 * Gilt bead-and-fillet frame profile of width `w` and relief `z` [N Louis-seize "baguette"]: an outer fillet, a
 * half-round bead (4 facets) and an inner step, so the faces turn through ≈ 150° and reflect different parts of the room.
 */
export function beadProfile(w: number, z: number): MouldProfile {
  return [
    [0, 0],
    [0, z * 0.45],
    [w * 0.12, z * 0.5],
    [w * 0.22, z * 0.85],
    [w * 0.42, z],
    [w * 0.62, z * 0.88],
    [w * 0.74, z * 0.55],
    [w * 0.86, z * 0.45],
    [w * 0.9, z * 0.2],
    [w, z * 0.18],
    [w, 0],
  ];
}

/**
 * Sweep `prof` around the rectangle [x0, x1] × [y0, y1] of a plane with mitred corners. `F(x, y, z)` maps plane
 * coordinates (x along, y up, z towards the viewer) to object space and `N(x, y, z)` maps a plane direction to an
 * object-space normal. `open` leaves the bottom side out (door surrounds run down to the floor).
 */
export function mouldFrame(
  b: Bucket,
  F: (x: number, y: number, z: number) => V3,
  N: (x: number, y: number, z: number) => V3,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  prof: MouldProfile,
  open = false,
): void {
  const maxI = Math.max(...prof.map((p) => p[0]));
  if (x1 - x0 < 2 * maxI + 1e-3 || y1 - y0 < 2 * maxI + 1e-3) return;
  // each side: inward unit (ix, iy) in the plane, and the endpoints of its edge at inset i
  const sides: { ix: number; iy: number; ends: (i: number) => [number, number, number, number] }[] = [
    { ix: 0, iy: -1, ends: (i) => [x0 + i, y1 - i, x1 - i, y1 - i] }, // top
    { ix: 1, iy: 0, ends: (i) => [x0 + i, open ? y0 : y0 + i, x0 + i, y1 - i] }, // left
    { ix: -1, iy: 0, ends: (i) => [x1 - i, open ? y0 : y0 + i, x1 - i, y1 - i] }, // right
  ];
  if (!open) sides.push({ ix: 0, iy: 1, ends: (i) => [x0 + i, y0 + i, x1 - i, y0 + i] }); // bottom
  for (const sd of sides) {
    for (let k = 0; k < prof.length - 1; k++) {
      const [ia, za] = prof[k];
      const [ib, zb] = prof[k + 1];
      const di = ib - ia;
      const dz = zb - za;
      const l = Math.hypot(di, dz) || 1;
      // outward section normal (-dz, di): -dz along the inward direction, di towards the viewer
      const nIn = -dz / l;
      const nZ = di / l;
      const n = N(sd.ix * nIn, sd.iy * nIn, nZ);
      const [ax0, ay0, ax1, ay1] = sd.ends(ia);
      const [bx0, by0, bx1, by1] = sd.ends(ib);
      b.quad(F(ax0, ay0, za), F(ax1, ay1, za), F(bx1, by1, zb), F(bx0, by0, zb), n);
    }
  }
}

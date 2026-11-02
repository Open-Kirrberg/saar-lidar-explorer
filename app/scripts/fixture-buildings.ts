/**
 * Synthetic LoD2-like buildings for the fixture (F11): gabled houses on the fixture terrain,
 * written as glb per level-0 chunk per docs/data-contract.md "Models" (local frame, true heights,
 * POSITION + flat NORMAL + `_SURFACE` 0 ground / 1 wall / 2 roof, no textures). Pure (no I/O).
 */
import { FIXTURE, fixtureHeight } from './fixture-terrain.ts';

export interface BuildingMesh {
  positions: Float32Array;
  normals: Float32Array;
  surface: Uint8Array;
}

export interface House {
  /** Footprint centre, metres east / north of the AOI lower-left corner. */
  u: number;
  v: number;
  /** Size along the ridge / across it (m). */
  len: number;
  wid: number;
  rotDeg: number;
  eave: number;
  ridge: number;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Triangles (flat normals, CCW seen from outside) of one gabled house in the local frame. */
export function houseTriangles(h: House, heightAt: (u: number, v: number) => number = fixtureHeight): { tris: V3[][]; cls: number[] } {
  const r = (h.rotDeg * Math.PI) / 180;
  const ax: [number, number] = [Math.cos(r), Math.sin(r)]; // along the ridge (u, v)
  const ay: [number, number] = [-Math.sin(r), Math.cos(r)];
  const corner = (sx: number, sy: number): [number, number] => [
    h.u + ax[0] * sx * h.len / 2 + ay[0] * sy * h.wid / 2,
    h.v + ax[1] * sx * h.len / 2 + ay[1] * sy * h.wid / 2,
  ];
  const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const base = Math.min(...cs.map(([u, v]) => heightAt(u, v)));
  const P = (uv: [number, number], y: number): V3 => [uv[0], y, -uv[1]]; // x = E − E0, z = −(N − N0)
  const eave = base + h.eave;
  const ridgeY = base + h.ridge;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const r0 = mid(cs[0], cs[3]); // ridge ends (gable sides)
  const r1 = mid(cs[1], cs[2]);
  const centre: V3 = [h.u, base + h.eave / 2, -h.v];

  const polys: Array<[V3[], number]> = [
    // ground (class 0), walls (1), roof (2)
    [[P(cs[0], base), P(cs[1], base), P(cs[2], base), P(cs[3], base)], 0],
    [[P(cs[0], base), P(cs[1], base), P(cs[1], eave), P(cs[0], eave)], 1],
    [[P(cs[2], base), P(cs[3], base), P(cs[3], eave), P(cs[2], eave)], 1],
    [[P(cs[1], base), P(cs[2], base), P(cs[2], eave), P(r1, ridgeY), P(cs[1], eave)], 1],
    [[P(cs[3], base), P(cs[0], base), P(cs[0], eave), P(r0, ridgeY), P(cs[3], eave)], 1],
    [[P(cs[0], eave), P(cs[1], eave), P(r1, ridgeY), P(r0, ridgeY)], 2],
    [[P(cs[2], eave), P(cs[3], eave), P(r0, ridgeY), P(r1, ridgeY)], 2],
  ];
  const tris: V3[][] = [];
  const cls: number[] = [];
  for (const [poly, c] of polys) {
    const n = cross(sub(poly[1], poly[0]), sub(poly[2], poly[0]));
    const fc = poly.reduce<V3>((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length, s[2] + p[2] / poly.length], [0, 0, 0]);
    const outward = c === 0 ? [0, -1, 0] as V3 : sub(fc, centre);
    const pts = dot(n, outward) < 0 ? [...poly].reverse() : poly;
    for (let k = 1; k + 1 < pts.length; k++) {
      tris.push([pts[0], pts[k], pts[k + 1]]);
      cls.push(c);
    }
  }
  return { tris, cls };
}

/** Non-indexed mesh with flat normals from several houses. */
export function buildingMesh(houses: House[], heightAt?: (u: number, v: number) => number): BuildingMesh {
  const all = houses.map((h) => houseTriangles(h, heightAt));
  const nTri = all.reduce((s, a) => s + a.tris.length, 0);
  const positions = new Float32Array(nTri * 9);
  const normals = new Float32Array(nTri * 9);
  const surface = new Uint8Array(nTri * 3);
  let t = 0;
  for (const { tris, cls } of all) {
    tris.forEach((tri, k) => {
      const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
      const l = Math.hypot(...n) || 1;
      for (let v = 0; v < 3; v++) {
        const o = (t * 3 + v) * 3;
        positions.set(tri[v], o);
        normals.set([n[0] / l, n[1] / l, n[2] / l], o);
        surface[t * 3 + v] = cls[k];
      }
      t++;
    });
  }
  return { positions, normals, surface };
}

/**
 * glTF 2.0 binary with one mesh/primitive: POSITION, NORMAL (FLOAT VEC3) and `_SURFACE`
 * (UNSIGNED_BYTE SCALAR, bufferView byteStride 4 — vertex attributes must be 4-byte aligned).
 */
export function encodeGlb(m: BuildingMesh): Uint8Array {
  const n = m.surface.length;
  const posBytes = n * 12;
  const surfBytes = n * 4;
  const bin = new Uint8Array(posBytes * 2 + surfBytes);
  bin.set(new Uint8Array(m.positions.buffer, m.positions.byteOffset, posBytes), 0);
  bin.set(new Uint8Array(m.normals.buffer, m.normals.byteOffset, posBytes), posBytes);
  for (let k = 0; k < n; k++) bin[posBytes * 2 + k * 4] = m.surface[k];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    for (let a = 0; a < 3; a++) {
      const v = m.positions[k * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const json = {
    asset: { version: '2.0', generator: 'sle make-fixture.ts' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, _SURFACE: 2 }, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes * 2, byteLength: surfBytes, byteStride: 4, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, count: n, type: 'SCALAR' },
    ],
  };
  const pad4 = (x: number) => (x + 3) & ~3;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonBytes, 20);
  const b0 = 20 + jsonLen;
  dv.setUint32(b0, binLen, true);
  dv.setUint32(b0 + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, b0 + 8);
  return out;
}

/** Fixture houses: a hamlet in the south-west chunk (0, 1) and a farm in the north-east chunk (1, 0). */
export const FIXTURE_HOUSES: House[] = [
  ...Array.from({ length: 8 }, (_, k): House => ({
    u: 120 + (k % 4) * 38,
    v: 120 + Math.floor(k / 4) * 42 + (k % 2) * 6,
    len: 14 + (k % 3) * 3,
    wid: 9 + (k % 2) * 2,
    rotDeg: 12 + (k % 3) * 4,
    eave: 5.5 + (k % 2),
    ridge: 10 + (k % 3),
  })),
  { u: 820, v: 800, len: 32, wid: 14, rotDeg: -25, eave: 7, ridge: 13 }, // barn
  { u: 790, v: 830, len: 13, wid: 10, rotDeg: 65, eave: 6, ridge: 10.5 },
];

/** Level-0 chunk (i, j) of a footprint centre (row j counts south from the north edge). */
export function houseChunk(h: House): [number, number] {
  const { chunkSize, height } = FIXTURE;
  return [Math.floor(h.u / chunkSize), Math.floor((height - h.v) / chunkSize)];
}

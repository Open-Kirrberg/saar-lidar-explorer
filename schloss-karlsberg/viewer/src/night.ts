/**
 * Night lights in three.js (wave-1 review of KB-I06; P11 / KB-I43 window part pulled forward): seeded lit windows on
 * the exterior glass and a pair of candelabra on the chimneypiece of every candle-lit room. The choices and their
 * evidence live in the pure module nightlights.ts.
 */
import * as THREE from 'three';
import { CANDELABRUM_CD, type CandleKind, LANTERN_LEVEL, type P3, TABLE_CANDLES, chandelierAt, flameSpots, flamesLit, groupPanes, litShare, mantelCandelabra, portalLanterns, tableCandelabra, windowLevel, windowLight, windowShade } from './nightlights.ts';
import { ARTICULATION, FESTIVAL } from '@model/layout/grammar.ts';
import { sidePoint, stToLocal } from '@model/layout/footprint.ts';
import type { BuildingLayout } from '@model/layout/building.ts';
import { type RoomInfo, roomAttributes, windowRoomAt } from './windowRooms.ts';

/** (rgb = window colour × display level, a = 0…1 night factor) shared by every patched glass material. */
const winUniform = { value: new THREE.Vector4(0, 0, 0, 0) };
/**
 * KB-I48 Festbeleuchtung: level (0…1) of the windows that are dark on an ordinary night but candle-lit for the
 * illumination (every window of FESTIVAL.buildings; stored as a negative `aLit`).
 */
const winFestUniform = { value: 0 };

function patchGlass(m: THREE.Material): void {
  if (m.userData.litWindows) return;
  m.userData.litWindows = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uWin = winUniform;
    sh.uniforms.uWinFest = winFestUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nuniform float uWinFest;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit >= 0.0 ? aLit : -aLit * uWinFest;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uWin;\nvarying float vLit;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a = mix( diffuseColor.a, 0.92, clamp( vLit * 4.0, 0.0, 1.0 ) * uWin.a );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWin.rgb * vLit * skbRoomGlow;');
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|litwin2`;
  m.needsUpdate = true;
}

/** Connected components of a geometry (by index, positions welded at 1 mm) → centroid per component, component id per vertex. */
function components(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): { centroids: P3[]; vertexComp: Int32Array; local: Float32Array } {
  const pos = geo.attributes.position;
  const n = pos.count;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const weld = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    const j = weld.get(k);
    if (j === undefined) weld.set(k, i);
    else union(i, j);
  }
  const idx = geo.index;
  const tris = idx ? idx.count / 3 : n / 3;
  for (let t = 0; t < tris; t++) {
    const a = idx ? idx.getX(3 * t) : 3 * t;
    const b = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
    const c = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    union(a, b);
    union(b, c);
  }
  const compOf = new Map<number, number>();
  const sums: [number, number, number, number][] = [];
  const vertexComp = new Int32Array(n);
  const local = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = compOf.get(r);
    if (c === undefined) {
      c = sums.length;
      compOf.set(r, c);
      sums.push([0, 0, 0, 0]);
    }
    vertexComp[i] = c;
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    local[3 * i] = v.x;
    local[3 * i + 1] = v.y;
    local[3 * i + 2] = v.z;
    sums[c][0] += v.x;
    sums[c][1] += v.y;
    sums[c][2] += v.z;
    sums[c][3]++;
  }
  return { centroids: sums.map(([x, y, z, k]) => [x / k, y / k, z / k] as P3), vertexComp, local };
}

/**
 * Give the exterior glass of one built level an `aLit` attribute (0 dark, 0.55…1 lit) and patch its material. Returns
 * the number of lit windows. KB-I42: on LOD2 levels every vertical window also gets the interior-mapping attributes
 * `aWin` (x along the facade from the window axis, y from the window bottom, half width, height; metres), `aRoom` and
 * `aRoom2` (the catalogue room behind the window, windowRooms.ts `windowRoomAt` over `rooms`; roof glass = dormers and
 * oculi get the dark cavity); zeros elsewhere (flat room proxy). Box-shaped glass (both faces drawn, e.g. the rotunda
 * doors) and sloped glass (glasshouses) keep the proxy.
 */
export function prepareLitWindows(level: THREE.Object3D, buildingId: string, cls: string, rooms: readonly RoomInfo[] = []): number {
  const share = litShare(cls);
  // KB-I48: in the Festbeleuchtung every window of the illuminated buildings is candle-lit
  const festLit = FESTIVAL.buildings.includes(buildingId);
  let lit = 0;
  let windows = 0;
  level.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(level.matrixWorld).invert();
  level.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.name.includes('/interior')) return;
    const mat = mesh.material as THREE.Material;
    if (Array.isArray(mat) || mat?.name !== 'glass.crown' || mesh.geometry.attributes.aLit) return;
    patchGlass(mat);
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const { centroids, vertexComp, local } = components(mesh.geometry, m);
    const win = groupPanes(centroids);
    // window centre = mean of its panes
    const centres = new Map<number, [number, number, number, number]>();
    centroids.forEach((c, i) => {
      const s = centres.get(win[i]) ?? [0, 0, 0, 0];
      centres.set(win[i], [s[0] + c[0], s[1] + c[1], s[2] + c[2], s[3] + 1]);
    });
    const light = new Map<number, number>();
    for (const [w, [x, y, z, k]] of centres) {
      const l = windowLight(buildingId, [x / k, y / k, z / k], share);
      light.set(w, l);
      if (l > 0) lit++;
      windows++;
    }
    // KB-I43: extent of every window (height band, half width along the facade) for the in-window light falloff
    const ext = new Map<number, [number, number, number]>(); // minY, maxY, half width
    for (let i = 0; i < vertexComp.length; i++) {
      const w = win[vertexComp[i]];
      const c = centres.get(w)!;
      const e = ext.get(w) ?? [Infinity, -Infinity, 0];
      const y = local[3 * i + 1];
      e[0] = Math.min(e[0], y);
      e[1] = Math.max(e[1], y);
      e[2] = Math.max(e[2], Math.hypot(local[3 * i] - c[0] / c[3], local[3 * i + 2] - c[2] / c[3]));
      ext.set(w, e);
    }
    const a = new Float32Array(vertexComp.length);
    for (let i = 0; i < a.length; i++) {
      const w = win[vertexComp[i]];
      const l = light.get(w) ?? 0;
      if (l <= 0 && !festLit) continue;
      const c = centres.get(w)!;
      const e = ext.get(w)!;
      const v = e[1] > e[0] ? (local[3 * i + 1] - e[0]) / (e[1] - e[0]) : 0.5;
      const hd = e[2] > 0 ? Math.hypot(local[3 * i] - c[0] / c[3], local[3 * i + 2] - c[2] / c[3]) / e[2] : 0;
      // a dark window of a festival building: negative, lit only by uWinFest (KB-I48)
      a[i] = l > 0 ? l * windowShade(v, hd) : -FEST_WINDOW_LIT * windowShade(v, hd);
    }
    mesh.geometry.setAttribute('aLit', new THREE.BufferAttribute(a, 1));
    // KB-I42 interior mapping (LOD2 only)
    const aw = new Float32Array(vertexComp.length * 4);
    const ar = new Float32Array(vertexComp.length * 4);
    const ar2 = new Float32Array(vertexComp.length * 4);
    if (level.userData.lod === 2) {
      const roof = /\/roof(\/|$)/.test(mesh.name);
      const nor = mesh.geometry.attributes.normal;
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const nv = new THREE.Vector3();
      // per window: summed outward normal (local frame) and vertex count
      const ns = new Map<number, [number, number, number, number]>();
      for (let i = 0; i < vertexComp.length; i++) {
        const w = win[vertexComp[i]];
        nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        const x = ns.get(w) ?? [0, 0, 0, 0];
        ns.set(w, [x[0] + nv.x, x[1] + nv.y, x[2] + nv.z, x[3] + 1]);
      }
      // KB-I70 (wave-7 review): box-shaped glass (rotunda doors) has a face toward the room; the glass patch must not
      // treat it as seen from outside (a dark proxy pane from inside). aWin.z = −2 marks those faces (normal toward the
      // building origin, which is the frame centre), −1 the outer ones; both keep the flat proxy from outside.
      const boxes = new Set<number>();
      type Frame = { nx: number; nz: number; tx: number; tz: number; c: [number, number, number]; y0: number; h: number; hw: number; room: ReturnType<typeof roomAttributes> | null };
      const frames = new Map<number, Frame | null>();
      for (const [w, [x, y, z, k]] of ns) {
        const len = Math.hypot(x, y, z) / k;
        const hl = Math.hypot(x, z);
        // both faces of a box cancel (len ≪ 1); sloped or flat glass has a large vertical share
        if (len < 0.7 || Math.abs(y) / Math.max(1e-6, Math.hypot(x, y, z)) > 0.35 || hl < 1e-6) {
          frames.set(w, null);
          if (len < 0.7) boxes.add(w);
          continue;
        }
        // tangent T = up × N (horizontal), as in the shader
        const nx = x / hl;
        const nz = z / hl;
        const c = centres.get(w)!;
        const e = ext.get(w)!;
        frames.set(w, { nx, nz, tx: nz, tz: -nx, c: [c[0] / c[3], c[1] / c[3], c[2] / c[3]], y0: e[0], h: e[1] - e[0], hw: 0, room: null });
      }
      // half width along the facade, then the catalogue room behind the window (keyed like windowLight: building + centre)
      for (let i = 0; i < vertexComp.length; i++) {
        const f = frames.get(win[vertexComp[i]]);
        if (f) f.hw = Math.max(f.hw, Math.abs((local[3 * i] - f.c[0]) * f.tx + (local[3 * i + 2] - f.c[2]) * f.tz));
      }
      for (const f of frames.values()) {
        if (!f) continue;
        const key = `${buildingId}|${Math.round(f.c[0] * 2)}|${Math.round(f.c[1] * 2)}|${Math.round(f.c[2] * 2)}`;
        f.room = roomAttributes(windowRoomAt(rooms, f.c, [f.nx, f.nz], f.y0, f.h, f.hw, key, roof));
      }
      for (let i = 0; i < vertexComp.length; i++) {
        if (boxes.has(win[vertexComp[i]])) {
          nv.fromBufferAttribute(nor, i).applyMatrix3(nm);
          aw[4 * i + 2] = nv.x * local[3 * i] + nv.z * local[3 * i + 2] < 0 ? -2 : -1;
          continue;
        }
        const f = frames.get(win[vertexComp[i]]);
        if (!f || !f.room || f.hw <= 0.05 || f.h <= 0.1) continue;
        aw[4 * i] = (local[3 * i] - f.c[0]) * f.tx + (local[3 * i + 2] - f.c[2]) * f.tz;
        aw[4 * i + 1] = local[3 * i + 1] - f.y0;
        aw[4 * i + 2] = f.hw;
        aw[4 * i + 3] = f.h;
        ar.set(f.room.aRoom, 4 * i);
        ar2.set(f.room.aRoom2, 4 * i);
      }
    }
    mesh.geometry.setAttribute('aWin', new THREE.BufferAttribute(aw, 4));
    mesh.geometry.setAttribute('aRoom', new THREE.BufferAttribute(ar, 4));
    mesh.geometry.setAttribute('aRoom2', new THREE.BufferAttribute(ar2, 4));
  });
  level.userData.litWindows = lit;
  level.userData.windows = windows;
  return lit;
}

/**
 * Lit-window level for the current light: `glow` 0…1 (windowGlow(el), 0 while the visitor is inside), `pre` the
 * pre-exposure, `colour` the candle colour (linear, luminance 1).
 */
/** KB-I48: level of a festival-lit window relative to an ordinary lit one (aLit 0.55…1) [I]. */
export const FEST_WINDOW_LIT = 0.8;

/** KB-I48: light the festival windows (`on` = the festival factor 0…1, festivalMath.festivalOn). */
export function setWindowFest(on: number): void {
  winFestUniform.value = Math.max(0, Math.min(1, on));
}

export function setWindowGlow(glow: number, pre: number, colour: readonly [number, number, number]): void {
  const level = windowLevel(pre, Math.max(colour[0], colour[1], colour[2])) * glow;
  winUniform.value.set(colour[0] * level, colour[1] * level, colour[2] * level, glow);
  // KB-I43: the portal lanterns burn with the windows
  for (const l of lanternSets) l.update(glow, level, colour);
}

let candleMat: THREE.MeshStandardMaterial | null = null;
let waxMat: THREE.MeshStandardMaterial | null = null;
let flameGeo: THREE.BufferGeometry | null = null;
let sticksGeo: THREE.BufferGeometry | null = null;

/**
 * Two candelabra (three candles each, a night-only point light each) on the chimneypiece of every room that has a
 * model light (the candle-lit rooms). Adds the lights to `inner.userData.lights` (the interior budget switches them)
 * with `userData.nightOnly`. Returns the number of candelabra.
 */
export function addMantelCandelabra(inner: THREE.Object3D, buildingId: string, colour: THREE.Color): number {
  if (inner.userData.candelabra) return 0;
  inner.userData.candelabra = true;
  const lights = (inner.userData.lights ?? []) as THREE.Light[];
  const rooms = new Set(lights.map((l) => l.userData.roomId as string).filter(Boolean));
  candleMat ??= new THREE.MeshStandardMaterial({ name: 'interior.candle', color: '#fff4dc', emissive: '#ffcf80', emissiveIntensity: 2.2, roughness: 0.6 });
  // KB-I43: beeswax sticks with a small flame on top instead of a glowing stick (the flame carries the emissive)
  waxMat ??= new THREE.MeshStandardMaterial({ name: 'interior.wax', color: '#f4ecd9', roughness: 0.55 });
  // one merged mesh for the three sticks and one for the three flames of a candelabrum (2 draw calls, not 6)
  const ring = (g: THREE.BufferGeometry, y: number) =>
    mergeGeometries([0, 1, 2].map((k) => g.clone().toNonIndexed().translate(Math.cos((k * Math.PI * 2) / 3) * 0.07, y, Math.sin((k * Math.PI * 2) / 3) * 0.07)));
  sticksGeo ??= ring(new THREE.CylinderGeometry(0.011, 0.011, 0.14, 5), 0.07);
  flameGeo ??= ring(new THREE.ConeGeometry(0.008, 0.032, 5).translate(0, 0.016, 0), 0.145);
  let n = 0;
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const added: THREE.Light[] = [];
  for (const roomId of rooms) {
    const box = new THREE.Box3();
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !o.name.startsWith(`${buildingId}/${roomId}/fireplace/stone.`)) return;
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)));
    });
    if (box.isEmpty()) continue;
    for (const p of mantelCandelabra({ min: box.min.toArray() as P3, max: box.max.toArray() as P3 })) {
      const l = new THREE.PointLight(colour, CANDELABRUM_CD, 10, 2);
      l.position.set(p[0], p[1] + 0.12, p[2]);
      l.name = `${buildingId}/interior/${roomId}/candelabrum-${n}`;
      l.userData = { buildingId, part: 'interior/light', lod: 2, roomId, interiorLight: true, nightOnly: true, evidence: 'I', tag: 'N candelabra on the chimneypiece (look-and-period §5); place I' };
      inner.add(l);
      added.push(l);
      const c = new THREE.Mesh(sticksGeo, waxMat);
      c.position.set(p[0], p[1], p[2]);
      c.name = `${buildingId}/${roomId}/kaminleuchter/interior.wax`;
      c.userData = { buildingId, roomId, part: 'interior/kaminleuchter', evidence: 'I', tag: 'N candelabra on the chimneypiece; place I' };
      inner.add(c);
      const f = new THREE.Mesh(flameGeo, candleMat);
      f.position.copy(c.position);
      f.name = `${buildingId}/${roomId}/kaminleuchter/interior.candle`;
      f.userData = { ...c.userData };
      inner.add(f);
      registerFlames(f, 'candelabrum');
      n++;
    }
  }
  inner.userData.lights = [...lights, ...added];
  return n;
}

// ---------------------------------------------------------------- wave 10: candles in view

let tableGeo: { body: THREE.BufferGeometry; sticks: THREE.BufferGeometry; flames: THREE.BufferGeometry; stick1: THREE.BufferGeometry; flame1: THREE.BufferGeometry; body1: THREE.BufferGeometry } | null = null;
function tableCandleGeometry(): NonNullable<typeof tableGeo> {
  if (tableGeo) return tableGeo;
  const S = TABLE_CANDLES.stem;
  const g = TABLE_CANDLES.gueridonStem;
  const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map((p) => p.toNonIndexed()));
  // a three-light candelabrum: foot, baluster stem, two arms and three cups (Louis-seize, gilt) [N form]
  const body = merge([
    new THREE.CylinderGeometry(0.045, 0.065, 0.025, 10).translate(0, 0.0125, 0),
    new THREE.CylinderGeometry(0.012, 0.02, S - 0.02, 8).translate(0, (S - 0.02) / 2 + 0.02, 0),
    new THREE.SphereGeometry(0.024, 8, 6).translate(0, S * 0.45, 0),
    new THREE.BoxGeometry(0.2, 0.012, 0.012).translate(0, S - 0.04, 0),
    ...[-0.1, 0, 0.1].map((x) => new THREE.CylinderGeometry(0.018, 0.01, 0.03, 8).translate(x, S - 0.02 + (x === 0 ? 0.04 : 0), 0)),
  ]);
  const cups: P3[] = [-0.1, 0, 0.1].map((x) => [x, S + (x === 0 ? 0.04 : 0), 0]);
  const sticks = merge(cups.map((c) => new THREE.CylinderGeometry(0.01, 0.01, 0.16, 6).translate(c[0], c[1] + 0.08, c[2])));
  const flames = merge(cups.map((c) => new THREE.ConeGeometry(0.009, 0.035, 5).translate(c[0], c[1] + 0.16 + 0.0175, c[2])));
  // a single candlestick for a guéridon
  const body1 = merge([new THREE.CylinderGeometry(0.035, 0.05, 0.02, 10).translate(0, 0.01, 0), new THREE.CylinderGeometry(0.01, 0.016, g - 0.02, 8).translate(0, (g - 0.02) / 2 + 0.02, 0), new THREE.CylinderGeometry(0.018, 0.01, 0.03, 8).translate(0, g - 0.015, 0)]);
  const stick1 = new THREE.CylinderGeometry(0.01, 0.01, 0.18, 6).translate(0, g + 0.09, 0).toNonIndexed();
  const flame1 = new THREE.ConeGeometry(0.009, 0.035, 5).translate(0, g + 0.18 + 0.0175, 0).toNonIndexed();
  tableGeo = { body, sticks, flames, stick1, flame1, body1 };
  return tableGeo;
}

/**
 * Wave 10 (audit rank 5): candles where the candle-lit rooms' default views can see them: candelabra on the laid
 * dining table (`table` fixture named "Tafel…") and a candlestick on every guéridon, in each room that has a model
 * light. The flames burn with the other candles (`setCandles`, kind 'other'); their light comes from the room's candle
 * clusters (candleLight.ts, wave 11). Returns the number of candlesticks.
 */
export function addTableCandles(inner: THREE.Object3D, buildingId: string): number {
  if (inner.userData.tableCandles !== undefined) return inner.userData.tableCandles as number;
  const lights = (inner.userData.lights ?? []) as THREE.Light[];
  const rooms = new Set(lights.map((l) => l.userData.roomId as string).filter(Boolean));
  candleMat ??= new THREE.MeshStandardMaterial({ name: 'interior.candle', color: '#fff4dc', emissive: '#ffcf80', emissiveIntensity: 2.2, roughness: 0.6 });
  waxMat ??= new THREE.MeshStandardMaterial({ name: 'interior.wax', color: '#f4ecd9', roughness: 0.55 });
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const toInner = (o: THREE.Object3D) => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
  let gilt: THREE.Material | null = null;
  const tops: { roomId: string; p: P3; rotY: number; single: boolean }[] = [];
  const im4 = new THREE.Matrix4();
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = Array.isArray(mesh.material) ? null : mesh.material;
    if (!gilt && mat?.name === 'metal.gilt') gilt = mat;
    const ud = o.userData as { roomId?: string; name_de?: string; instances?: { roomId: string }[] };
    // the laid table: the cloth bucket of a "Tafel" in a candle-lit room
    if (ud.roomId && rooms.has(ud.roomId) && o.name.startsWith(`${buildingId}/${ud.roomId}/table/`) && /Tafel/.test(ud.name_de ?? '') && /ceiling\.stucco/.test(o.name)) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone().applyMatrix4(toInner(o));
      for (const p of tableCandelabra({ min: box.min.toArray() as P3, max: box.max.toArray() as P3 })) {
        const wx = box.max.x - box.min.x;
        const wz = box.max.z - box.min.z;
        // the arms run across the table
        tops.push({ roomId: ud.roomId, p, rotY: wx >= wz ? Math.PI / 2 : 0, single: false });
      }
    }
    // guéridons: the marble top of each instance in a candle-lit room
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && o.name === `${buildingId}/interior/furniture/gueridon/Platte`) {
      const M = toInner(o);
      for (let i = 0; i < im.count; i++) {
        const roomId = ud.instances?.[i]?.roomId ?? ud.roomId ?? '';
        if (!rooms.has(roomId)) continue;
        im.getMatrixAt(i, im4);
        const v = new THREE.Vector3(0, 0.76, 0).applyMatrix4(im4).applyMatrix4(M);
        tops.push({ roomId, p: [v.x, v.y, v.z], rotY: 0, single: true });
      }
    }
  });
  const geo = tableCandleGeometry();
  const body = gilt ?? waxMat;
  let n = 0;
  for (const t of tops) {
    const g = new THREE.Group();
    g.position.set(t.p[0], t.p[1], t.p[2]);
    g.rotation.y = t.rotY;
    g.name = `${buildingId}/${t.roomId}/tafelleuchter`;
    const ud = { buildingId, roomId: t.roomId, part: 'interior/tafelleuchter', name_de: t.single ? 'Leuchter (Guéridon)' : 'Tafelleuchter', evidence: 'N', tag: 'N candelabra on a laid table, candlestick on a guéridon; place I' };
    g.userData = ud;
    const parts: [THREE.BufferGeometry, THREE.Material, string][] = t.single
      ? [
          [geo.body1, body, 'metal.gilt'],
          [geo.stick1, waxMat, 'interior.wax'],
        ]
      : [
          [geo.body, body, 'metal.gilt'],
          [geo.sticks, waxMat, 'interior.wax'],
        ];
    for (const [gg, mm, nm] of parts) {
      const m = new THREE.Mesh(gg, mm);
      m.name = `${g.name}/${nm}`;
      m.userData = { ...ud };
      g.add(m);
    }
    const f = new THREE.Mesh(t.single ? geo.flame1 : geo.flames, candleMat);
    f.name = `${g.name}/flamme/interior.candle`;
    f.userData = { ...ud, part: 'interior/flame' };
    f.castShadow = false;
    f.receiveShadow = false;
    g.add(f);
    registerFlames(f, 'other');
    inner.add(g);
    n++;
  }
  inner.userData.tableCandles = n;
  return n;
}

// ---------------------------------------------------------------- wave-5 review fix: candle flames

/** Flame meshes and the kind of candle they belong to; shown by `setCandles`. */
const flameSets: { mesh: THREE.Object3D; kind: CandleKind }[] = [];
let candleState = { night: 0, fest: false };

/**
 * Wave 11 (candleLight.ts): every registered flame mesh with its candle kind; the room lights are built from them (one
 * candle per flame cone, `flameCentres`).
 */
export function flameMeshes(): readonly { mesh: THREE.Object3D; kind: CandleKind }[] {
  return flameSets;
}

const flameCentreCache = new WeakMap<THREE.BufferGeometry, P3[]>();
/** Centres of the flame cones of a flame geometry (its own space; one connected component per flame), cached. */
export function flameCentres(geo: THREE.BufferGeometry): P3[] {
  let c = flameCentreCache.get(geo);
  if (!c) {
    c = components(geo, new THREE.Matrix4()).centroids;
    flameCentreCache.set(geo, c);
  }
  return c;
}

function registerFlames(mesh: THREE.Object3D, kind: CandleKind): void {
  flameSets.push({ mesh, kind });
  mesh.visible = flamesLit(kind, candleState.night, candleState.fest);
}

/** Show the flames that burn at this night factor: candles at night, a chandelier's only for a celebration (`fest`). */
export function setCandles(night: number, fest: boolean): void {
  candleState = { night, fest };
  for (const f of flameSets) f.mesh.visible = flamesLit(f.kind, night, fest);
}

/** Merge one flame cone per spot (radius r, height h, base on the spot). */
function flamesAt(spots: P3[], r: number, h: number): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(r, h, 5).toNonIndexed().translate(0, h / 2, 0);
  return mergeGeometries(spots.map((p) => cone.clone().translate(p[0], p[1], p[2])));
}

/** Distance (m) of a chandelier's point light below the chandelier's lowest point (the finial) [I]. */
export const CHANDELIER_LIGHT_DROP = 0.15;

/**
 * The model's candles (`interior.candle`: chandeliers, wall sconces, the gallery candelabra, hall lanterns) were
 * glowing sticks, lit every night. Here they become wax sticks with a flame on top of each, lit only at night, a
 * chandelier's only with `fest` (look-and-period §5: chandeliers for celebrations [D-> SPSG]). The model light hanging
 * at a chandelier is marked `userData.chandelier`, so the interior look switches it with the chandelier
 * (atmosphere.ts `InteriorLook`). Call before `InteriorLook.adopt` (the flames take the pre-exposed emissive).
 * Returns the number of flames.
 */
export function addCandleFlames(inner: THREE.Object3D, buildingId: string): number {
  if (inner.userData.candleFlames !== undefined) return inner.userData.candleFlames as number;
  candleMat ??= new THREE.MeshStandardMaterial({ name: 'interior.candle', color: '#fff4dc', emissive: '#ffcf80', emissiveIntensity: 2.2, roughness: 0.6 });
  waxMat ??= new THREE.MeshStandardMaterial({ name: 'interior.wax', color: '#f4ecd9', roughness: 0.55 });
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  // chandelier centres (inner space) from the instanced frames
  const chandeliers: P3[] = [];
  const candles: THREE.Mesh[] = [];
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.name.includes('/kaminleuchter/')) return;
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && o.name.startsWith(`${buildingId}/interior/furniture/chandelier/`) && o.name.endsWith('/Kerzen')) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        v.setFromMatrixPosition(m).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, im.matrixWorld));
        chandeliers.push([v.x, v.y, v.z]);
      }
    }
    if (!Array.isArray(mesh.material) && mesh.material?.name === 'interior.candle') candles.push(mesh);
  });
  for (const l of (inner.userData.lights ?? []) as THREE.Light[]) {
    if (l.userData.nightOnly) continue;
    v.setFromMatrixPosition(l.matrixWorld).applyMatrix4(inv);
    const ci = chandelierAt([v.x, v.y, v.z], chandeliers);
    l.userData.chandelier = ci >= 0;
    // wave-6 review fix (Fest: the glass glowed brighter than the flames): the point light stands for a ring of flames
    // 0.3–0.5 m out from the stem; inside the crown it lit the stem glass from a few centimetres (≈ 60× the irradiance
    // of the real flames). It hangs just under the finial instead (CHANDELIER_LIGHT_DROP), so the glass sees it from
    // its own scale; the room, metres away, barely changes.
    if (ci >= 0 && !l.userData.lowered) {
      // the building groups only turn about the vertical, so a height change carries over to the light's own frame
      l.userData.lowered = true;
      l.position.y += chandeliers[ci][1] - CHANDELIER_LIGHT_DROP - v.y;
      l.updateMatrixWorld();
    }
  }
  let n = 0;
  for (const c of candles) {
    const chand = c.name.includes('/chandelier/');
    const { vertexComp, local } = components(c.geometry, new THREE.Matrix4());
    const spots = flameSpots(local, vertexComp);
    c.material = waxMat;
    if (!spots.length) continue;
    const geo = chand ? flamesAt(spots, 0.012, 0.045) : flamesAt(spots, 0.009, 0.035);
    const src = c as THREE.InstancedMesh;
    let f: THREE.Mesh;
    if (src.isInstancedMesh) {
      const fi = new THREE.InstancedMesh(geo, candleMat, src.count);
      fi.instanceMatrix = src.instanceMatrix; // same instances as the sticks
      fi.count = src.count;
      fi.computeBoundingSphere();
      f = fi;
      n += spots.length * src.count;
    } else {
      f = new THREE.Mesh(geo, candleMat);
      n += spots.length;
    }
    f.name = `${c.name.replace(/\/interior\.candle$/, '')}/flamme/interior.candle`;
    f.userData = { ...c.userData, part: 'interior/flame', evidence: 'N', tag: 'N candle flames; lit at night, chandeliers for celebrations (look-and-period §5, D-> SPSG)' };
    f.castShadow = false;
    f.receiveShadow = false;
    c.add(f);
    registerFlames(f, chand ? 'chandelier' : 'other');
  }
  inner.userData.candleFlames = n;
  return n;
}

// ---------------------------------------------------------------- KB-I43 portal lanterns

/**
 * Lanterns at the Ehrenhof portals and passages [N: lanterns at main portals (look-and-period §5); positions U,
 * hypothesis]: a glazed iron lantern with a candle on a wall bracket, a pair beside a door, one above a carriage arch
 * (`portalLanterns`). Viewer-only and drawn only after sunset, like the lit windows, so the day image and the light
 * layer are unchanged. No point lights (every light would cost every lit pixel): the panes glow, a soft additive halo
 * stands in for the glare and an additive pool on the wall for the light the lantern throws on the render.
 */
class LanternSet {
  readonly group = new THREE.Group();
  private readonly glass = new THREE.MeshBasicMaterial({ name: 'lantern.glass', color: '#000000', toneMapped: true });
  private readonly halo: THREE.SpriteMaterial;
  private readonly pool: THREE.MeshBasicMaterial;

  constructor(spots: { p: THREE.Vector3; n: THREE.Vector3; out: number }[], radial: THREE.Texture) {
    this.group.name = 'night/lanterns';
    this.group.userData = { part: 'night/lantern', evidence: 'N', tag: 'N lanterns at main portals (look-and-period §5); positions U (hypothesis)' };
    const iron = new THREE.MeshStandardMaterial({ name: 'lantern.iron', color: '#2E3439', roughness: 0.55, metalness: 0.6 });
    this.halo = new THREE.SpriteMaterial({ map: radial, color: '#000000', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.pool = new THREE.MeshBasicMaterial({ map: radial, color: '#000000', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const frames: THREE.BufferGeometry[] = [];
    const panes: THREE.BufferGeometry[] = [];
    const pools: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const { p, n, out } of spots) {
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, 0, n.z).normalize());
      const place = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
        m.compose(new THREE.Vector3(x, y, z).applyQuaternion(q).add(p), q, new THREE.Vector3(1, 1, 1));
        return g.applyMatrix4(m);
      };
      // body: four corner posts, top and bottom plates, a pyramid cap and a bracket arm back to the wall
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) frames.push(place(new THREE.BoxGeometry(0.024, 0.4, 0.024), sx * 0.12, 0, sz * 0.12));
      frames.push(place(new THREE.BoxGeometry(0.28, 0.03, 0.28), 0, -0.21, 0));
      frames.push(place(new THREE.BoxGeometry(0.28, 0.03, 0.28), 0, 0.21, 0));
      frames.push(place(new THREE.ConeGeometry(0.2, 0.16, 4).rotateY(Math.PI / 4), 0, 0.3, 0));
      frames.push(place(new THREE.BoxGeometry(0.03, 0.03, out + 0.05), 0, 0.42, -out / 2));
      frames.push(place(new THREE.BoxGeometry(0.02, 0.08, 0.02), 0, 0.4, 0));
      panes.push(place(new THREE.BoxGeometry(0.22, 0.38, 0.22), 0, 0, 0));
      // light pool on the wall behind (2.6 m wide, 2 cm in front of the wall plane)
      pools.push(place(new THREE.PlaneGeometry(2.6, 2.6), 0, -0.1, -out + 0.02));
      const h = new THREE.Sprite(this.halo);
      h.position.copy(p);
      h.scale.set(1.3, 1.3, 1);
      h.renderOrder = 2;
      this.group.add(h);
    }
    const merged = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.userData = { ...this.group.userData };
      this.group.add(mesh);
      return mesh;
    };
    add(merged(frames), iron, 'night/lanterns/metal.iron');
    add(merged(panes), this.glass, 'night/lanterns/lantern.glass');
    add(merged(pools), this.pool, 'night/lanterns/pool').renderOrder = 1;
    this.group.visible = false;
  }

  /** `level` = the window display level (luminance multiplier), `colour` the window candle colour (luminance 1). */
  update(glow: number, level: number, colour: readonly [number, number, number]): void {
    this.group.visible = glow > 0.01;
    const k = level * LANTERN_LEVEL;
    this.glass.color.setRGB(colour[0] * k, colour[1] * k, colour[2] * k, THREE.LinearSRGBColorSpace);
    this.halo.color.setRGB(colour[0] * k * 0.45, colour[1] * k * 0.45, colour[2] * k * 0.45, THREE.LinearSRGBColorSpace);
    this.pool.color.setRGB(colour[0] * k * 0.3, colour[1] * k * 0.3, colour[2] * k * 0.3, THREE.LinearSRGBColorSpace);
  }
}

const lanternSets: LanternSet[] = [];
const lanternSpots: { p: THREE.Vector3; n: THREE.Vector3; out: number }[] = [];

/**
 * Every portal lantern built so far (centre, outward wall normal, distance from the wall): the post chain lights their
 * surroundings in screen space (post.ts, wave-5 review: the lanterns cast no visible pool on reveals and gravel).
 */
export function lanternLights(): readonly { p: THREE.Vector3; n: THREE.Vector3; out: number }[] {
  return lanternSpots;
}

/** Merge non-indexed geometries with the same attributes (position, normal, uv). */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv'] as const;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const total = list.reduce((s, g) => s + g.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array as Float32Array, o);
      o += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/** Radial falloff texture (white, alpha in the colour: additive use) for halos and wall pools. */
function radialTexture(): THREE.Texture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      // inverse-square-like pool with a soft edge: 1 / (1 + (r / 0.18)²), faded to 0 at the rim
      const v = r >= 1 ? 0 : (1 / (1 + (r / 0.18) ** 2)) * (1 - r * r);
      const b = Math.round(255 * v);
      data.set([b, b, b, 255], 4 * (y * n + x));
    }
  const t = new THREE.DataTexture(data, n, n);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Build the portal lanterns of the given layouts whose opening opens onto a court ring (local [x, z] polygons, e.g.
 * the Ehrenhof TF-01) and add them to `root`. Returns the number of lanterns.
 */
export function addPortalLanterns(root: THREE.Object3D, layouts: BuildingLayout[], courts: [number, number][][], inside: (p: [number, number], ring: [number, number][]) => boolean): number {
  const spots: { p: THREE.Vector3; n: THREE.Vector3; out: number }[] = [];
  for (const L of layouts) {
    const cls = L.building.cls;
    if (cls !== 'CDL' && cls !== 'WING2') continue;
    for (const o of L.openings) {
      if (o.portico) continue;
      const sd = L.frame.sides[o.side];
      const ris = L.sides[o.side]?.risalits.find((r) => o.a >= r.a0 && o.a <= r.a1);
      const wallOut = ris ? (ris.risalit.projection ?? ARTICULATION.risalitProjection) : 0;
      const list = portalLanterns(o, wallOut);
      if (!list.length) continue;
      // in front of the opening, 4 m out: must lie on a court
      const [fs, ft] = sidePoint(L.frame, o.side, o.a, -(wallOut + 4));
      const f = stToLocal(L.frame, fs, ft, 0);
      if (!courts.some((ring) => inside([f.x, f.z], ring))) continue;
      const nST = sd.normal;
      const p0 = stToLocal(L.frame, 0, 0, 0);
      const p1 = stToLocal(L.frame, nST[0], nST[1], 0);
      const n = new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z).normalize();
      for (const sp of list) {
        const [s, t] = sidePoint(L.frame, o.side, sp.a, -sp.out);
        const w = stToLocal(L.frame, s, t, sp.h);
        spots.push({ p: new THREE.Vector3(w.x, w.y, w.z), n, out: sp.out });
      }
    }
  }
  if (!spots.length) return 0;
  const set = new LanternSet(spots, radialTexture());
  lanternSets.push(set);
  lanternSpots.push(...spots);
  root.add(set.group);
  return spots.length;
}

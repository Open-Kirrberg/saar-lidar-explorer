/**
 * Candle light in the visitor's room at night (wave-11 look; maths and evidence in candleMath.ts).
 *
 * The wave-10 review of pose 07: the Festsaal at night was lit by an even ambient, the guéridon candle's screen-space
 * pool was a grey wash, and the vestibule's light under the floor lit the parquet from below. Now, while the visitor
 * stands in a room after dusk:
 * - every lit flame of that room (night.ts `flameMeshes`: candelabra, table candles, guéridons, sconces; chandeliers
 *   on a Fest night) is one candle; they are clustered and the `CANDLE_POOL` clusters nearest the eye light the room as
 *   shadowless point lights (1850 K, inverse square with the cluster's sphere radius, `installCandleFalloff`);
 * - the room's ambient follows its candles (bounce + the far clusters, `roomAmbientLux`), so a Fest night is brighter;
 * - the model's own room lights and the mantel candelabra's lights are switched off meanwhile (`active`), so no light
 *   shines through a floor or a wall from another room.
 * - wave-11 review fix: one cluster (pool light 0: the brightest in view, `shadowClusterIndex`) casts a low-resolution
 *   cube shadow (CANDLE_SHADOW), and the furniture of that interior casts into it while the pool burns
 *   (`interiorCasters`), so the guéridon top, the chairs and the candlesticks throw candle shadows; the map is drawn
 *   again only when that cluster moves.
 * By day, outdoors and between rooms the pool is hidden: no cost, the earlier behaviour unchanged.
 * The pool always holds `CANDLE_POOL` lights while it is shown (unused ones at intensity 0), so walking from room to
 * room never changes the number of lights and recompiles nothing.
 */
import * as THREE from 'three';
import { CANDLE_CD, CANDLE_POOL, CANDLE_SHADOW, type Cluster, type Flame, type P3, POOL_FLOOR_LUX, clusterFlames, lightCutoff, patchAttenuation, pickClusters, roomArea, roomCandleLux, shadowClusterIndex, shadowKey, shadowRadius, sphereDecay } from './candleMath.ts';
import { inRoom, type RoomBox } from './mirrorsMath.ts';
import { CANDLES_LIT_AT, type CandleKind, flamesLit } from './nightlights.ts';
import { flameCentres, flameMeshes } from './night.ts';

/** Install the sphere-light falloff into three's shared `lights_pars_begin` (once, before the first compile). */
export function installCandleFalloff(): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.lights_pars_begin = patchAttenuation(chunks.lights_pars_begin);
}

interface RoomFlame {
  /** inner-local position */
  p: P3;
  kind: CandleKind;
  /** luminous intensity (cd): CANDLE_CD per flame; a model room light without flames keeps its own */
  cd: number;
}

/** A model room light with a flame mesh within this distance (m) is carried by the flames [I]. */
const MODEL_LIGHT_FLAME_M = 1.5;

interface Room {
  id: string;
  box: RoomBox;
  area: number;
  flames: RoomFlame[];
}

interface Interior {
  inner: THREE.Object3D;
  rooms: Room[];
  /** furniture that casts into the candle shadow while the pool burns (not into the day's sun map) */
  casters: THREE.Object3D[];
  /** the candlesticks among them (a flame's own candlestick does not cast into its light, `OWN_STICK_M`) */
  sticks: THREE.Object3D[];
}

/**
 * A candlestick within this horizontal distance (m) of the shadow-casting cluster is that cluster's own: its flame burns
 * above it, so its true shadow falls under its foot; cast into the cube map, the PCF filter only drew a hard ring
 * round the foot [I].
 */
const OWN_STICK_M = 0.6;

/**
 * Furniture of an interior that casts candle shadows: the instanced furniture (not the chandeliers and lanterns, whose
 * crystal and glass would only speckle the ceiling), the laid tables and the candlesticks (not their flames).
 */
function interiorCasters(inner: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  inner.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || o.castShadow) return;
    const part = o.userData?.part as string | undefined;
    const furniture = /\/interior\/furniture\//.test(o.name) && !/\/(chandelier|lantern)\//.test(o.name);
    const table = /^[^/]+\/[^/]+\/table\//.test(o.name);
    const stick = part === 'interior/tafelleuchter';
    if (!(furniture || table || stick)) return;
    // main.ts applyDisplay restores every mesh's own shadow flag (`origCast`): for these it is "no sun shadow"
    if (o.userData.origCast === undefined) o.userData.origCast = false;
    out.push(o);
  });
  return out;
}

/**
 * Rooms (inner-local boxes from the floor up to the wall tops) and the flames inside each, for one interior group.
 * Call after night.ts added its candles (`addMantelCandelabra`, `addCandleFlames`, `addTableCandles`). Exported for tests.
 */
export function indexInterior(inner: THREE.Object3D): Room[] {
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const floors = new Map<string, THREE.Box3>();
  const walls = new Map<string, number>();
  const m = new THREE.Matrix4();
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const id = mesh.userData?.roomId as string | undefined;
    if (!mesh.isMesh || !id || (o as THREE.InstancedMesh).isInstancedMesh) return;
    const part = mesh.userData.part as string | undefined;
    if (part !== 'interior/boden' && part !== 'interior/wand') return;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    if (part === 'interior/boden') (floors.get(id) ?? floors.set(id, new THREE.Box3()).get(id)!).union(b);
    else walls.set(id, Math.max(walls.get(id) ?? -Infinity, b.max.y));
  });
  const rooms: Room[] = [];
  for (const [id, f] of floors) {
    const top = walls.get(id) ?? f.max.y + 3;
    const box: RoomBox = { min: [f.min.x, f.max.y, f.min.z], max: [f.max.x, Math.max(top, f.max.y + 2), f.max.z] };
    const w = box.max[0] - box.min[0];
    const d = box.max[2] - box.min[2];
    const h = box.max[1] - box.min[1];
    rooms.push({ id, box, area: roomArea(w, d, h), flames: [] });
  }
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const roomFor = (p: P3, id: string | undefined): Room | undefined => {
    const r = id ? byId.get(id) : undefined;
    if (r && inRoom(p, r.box, 0.3)) return r;
    return rooms.find((x) => inRoom(p, x.box, 0.05));
  };
  const v = new THREE.Vector3();
  const im4 = new THREE.Matrix4();
  for (const { mesh, kind } of flameMeshes()) {
    let up: THREE.Object3D | null = mesh;
    while (up && up !== inner) up = up.parent;
    if (!up) continue;
    const geo = (mesh as THREE.Mesh).geometry;
    if (!geo) continue;
    const centres = flameCentres(geo);
    const toInner = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const ims = mesh as THREE.InstancedMesh;
    const instances = (mesh.userData.instances ?? []) as { roomId?: string }[];
    const count = ims.isInstancedMesh ? ims.count : 1;
    for (let i = 0; i < count; i++) {
      if (ims.isInstancedMesh) ims.getMatrixAt(i, im4);
      const id = (ims.isInstancedMesh ? instances[i]?.roomId : undefined) ?? (mesh.userData.roomId as string | undefined);
      for (const c of centres) {
        v.set(c[0], c[1], c[2]);
        if (ims.isInstancedMesh) v.applyMatrix4(im4);
        v.applyMatrix4(toInner);
        const p: P3 = [v.x, v.y, v.z];
        roomFor(p, id)?.flames.push({ p, kind, cd: CANDLE_CD });
      }
    }
  }
  // the model's own room lights (a hearth, a hall lantern) that have no flame meshes near them stay a source with their
  // own intensity; lights standing for flames (chandeliers, sconce groups) are carried by the flames
  for (const l of (inner.userData.lights ?? []) as THREE.Light[]) {
    if (l.userData.nightOnly) continue;
    v.setFromMatrixPosition(m.multiplyMatrices(inv, l.matrixWorld));
    const p: P3 = [v.x, v.y, v.z];
    const room = roomFor(p, l.userData.roomId as string | undefined);
    if (!room || room.flames.some((f) => f.cd === CANDLE_CD && Math.hypot(f.p[0] - p[0], f.p[1] - p[1], f.p[2] - p[2]) < MODEL_LIGHT_FLAME_M)) continue;
    room.flames.push({ p, kind: l.userData.chandelier ? 'chandelier' : 'other', cd: l.intensity });
  }
  return rooms;
}

/** The object and all its ancestors are visible and it hangs in a scene (a built LOD2 level that is shown). */
function shown(o: THREE.Object3D): boolean {
  let x: THREE.Object3D | null = o;
  while (x) {
    if (!x.visible) return false;
    if ((x as THREE.Scene).isScene) return true;
    x = x.parent;
  }
  return false;
}

/** Ambient candle illuminance (lux) of a room for its lit flames and the far clusters (candleMath.roomCandleLux). */
function roomAmbientLux(room: { area: number }, litCd: number, farLux: number, floor: number): number {
  return roomCandleLux(litCd, room.area, farLux, floor);
}

export interface CandleUpdate {
  /** camera position (world) */
  eye: THREE.Vector3;
  /** camera view direction (world, optional): picks the shadow-casting cluster */
  dir?: THREE.Vector3;
  /** night factor 0…1 (atmosphere) */
  night: number;
  /** chandeliers lit (Fest / Festbeleuchtung) */
  fest: boolean;
  /** pre-exposure (display value per cd/m²) */
  pre: number;
  /** candle colour (linear) */
  colour: THREE.Color;
  /** the visitor stands inside a building with its interior drawn */
  inside: boolean;
}

export class CandleLights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private readonly interiors: Interior[] = [];
  private readonly invTmp = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  /** the room the pool lights (null: hidden) */
  room: Room | null = null;
  /** ambient candle illuminance (lux) of that room, for the interior look */
  ambientLux = 0;
  /** clusters lit by the pool (inner-local → world at the last update), for tests and skb */
  clusters: Cluster[] = [];
  /** A/B switch (`skb.candles.enabled = false`: the former room lights) */
  enabled = true;
  private key = '';
  /** interior whose furniture casts now (null: none) */
  private casting: Interior | null = null;
  /** position key of the shadow-casting light at its last map */
  private shadowAt = '';

  constructor() {
    this.group.name = 'night/candle-pool';
    this.group.userData = { part: 'night/candle-pool', evidence: 'I', tag: 'I candle clusters as shadowless point lights (candleMath.ts); flames N' };
    for (let i = 0; i < CANDLE_POOL; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 10, 2);
      l.name = `night/candle-pool/${i}`;
      // light 0 carries the lead cluster and its cube shadow (wave-11 review fix); drawn on change only
      l.castShadow = i === 0;
      if (i === 0) {
        l.shadow.mapSize.set(CANDLE_SHADOW.mapSize, CANDLE_SHADOW.mapSize);
        l.shadow.camera.near = CANDLE_SHADOW.near;
        l.shadow.radius = CANDLE_SHADOW.radius;
        l.shadow.bias = CANDLE_SHADOW.bias;
        l.shadow.normalBias = CANDLE_SHADOW.normalBias;
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = false;
        l.shadow.camera.updateProjectionMatrix();
      }
      this.lights.push(l);
      this.group.add(l);
    }
    this.group.visible = false;
  }

  /** Index one built interior (after the night.ts candles were added). */
  register(inner: THREE.Object3D): void {
    if (this.interiors.some((x) => x.inner === inner)) return;
    const casters = interiorCasters(inner);
    this.interiors.push({ inner, rooms: indexInterior(inner), casters, sticks: casters.filter((o) => o.userData.part === 'interior/tafelleuchter') });
  }

  /** Let the furniture of `it` (or of none) cast; a change redraws the candle shadow. */
  private castFrom(it: Interior | null): void {
    if (it === this.casting) return;
    for (const o of this.casting?.casters ?? []) o.castShadow = false;
    for (const o of it?.casters ?? []) o.castShadow = true;
    this.casting = it;
    this.shadowAt = '';
    this.key = '';
  }

  /** The room (and its interior) whose box holds the world point, or null. */
  private roomAt(p: THREE.Vector3): { it: Interior; room: Room } | null {
    for (const it of this.interiors) {
      if (!shown(it.inner)) continue;
      this.invTmp.copy(it.inner.matrixWorld).invert();
      const l = this.tmp.copy(p).applyMatrix4(this.invTmp);
      const room = it.rooms.find((r) => inRoom([l.x, l.y, l.z], r.box));
      if (room) return { it, room };
    }
    return null;
  }

  /**
   * Place the pool for the current eye and light (call every few frames and after a light change). Returns whether
   * the pool lights the room (then the caller switches the room's own point lights off).
   */
  update(u: CandleUpdate, floorLux: number): boolean {
    const lit = this.enabled && u.inside && u.night >= CANDLES_LIT_AT;
    const hit = lit ? this.roomAt(u.eye) : null;
    if (!hit) {
      this.castFrom(null);
      this.group.visible = false;
      this.room = null;
      this.clusters = [];
      this.ambientLux = 0;
      this.key = '';
      return false;
    }
    const { it, room } = hit;
    // a display toggle (main.ts applyDisplay) resets the shadow flags: cast again and redraw
    const probe = it.casters.find((o) => o.userData.part !== 'interior/tafelleuchter');
    if (it === this.casting && probe && !probe.castShadow) this.casting = null;
    this.castFrom(it);
    const k = u.night;
    const dir = u.dir ? `${u.dir.x.toFixed(1)},${u.dir.y.toFixed(1)},${u.dir.z.toFixed(1)}` : '';
    const key = `${room.id}|${u.fest}|${k.toFixed(3)}|${u.pre.toPrecision(4)}|${u.eye.x.toFixed(1)},${u.eye.y.toFixed(1)},${u.eye.z.toFixed(1)}|${dir}`;
    if (key === this.key && this.group.visible) return true;
    this.key = key;
    const w = it.inner.matrixWorld;
    const flames: Flame[] = [];
    for (const f of room.flames) {
      if (!flamesLit(f.kind, u.night, u.fest)) continue;
      const p = this.tmp.set(f.p[0], f.p[1], f.p[2]).applyMatrix4(w);
      flames.push({ p: [p.x, p.y, p.z], cd: f.cd });
    }
    const all = clusterFlames(flames);
    const picked = pickClusters(all, [u.eye.x, u.eye.y, u.eye.z], CANDLE_POOL);
    const { farLux } = picked;
    // the shadow-casting cluster goes to light 0
    const si = shadowClusterIndex(picked.lights, [u.eye.x, u.eye.y, u.eye.z], u.dir ? [u.dir.x, u.dir.y, u.dir.z] : null);
    const lights = si > 0 ? [picked.lights[si], ...picked.lights.filter((_, i) => i !== si)] : picked.lights;
    const litCd = flames.reduce((s, f) => s + f.cd, 0);
    this.ambientLux = roomAmbientLux(room, litCd, farLux, Math.min(floorLux, POOL_FLOOR_LUX));
    this.clusters = lights;
    this.room = room;
    this.lights.forEach((l, i) => {
      const c = lights[i];
      if (!c) {
        l.intensity = 0;
        return;
      }
      l.position.set(c.p[0], c.p[1], c.p[2]);
      l.intensity = c.cd * u.pre * k;
      l.decay = sphereDecay(c.r);
      l.distance = lightCutoff(c.cd);
      l.color.copy(u.colour);
    });
    this.group.visible = true;
    this.group.updateMatrixWorld(true);
    const lead = this.lights[0];
    const at = lights[0] ? shadowKey(lights[0].p) : '';
    if (at && at !== this.shadowAt) {
      const lp = lights[0].p;
      for (const o of it.sticks) {
        o.getWorldPosition(this.tmp);
        o.castShadow = Math.hypot(this.tmp.x - lp[0], this.tmp.z - lp[2]) > OWN_STICK_M;
      }
      // three's PointLightShadow takes the camera's far plane from `distance` itself
      lead.shadow.radius = shadowRadius(lights[0]);
      lead.shadow.needsUpdate = true;
      this.shadowAt = at;
    }
    return true;
  }

  stats(): { room: string | null; clusters: { p: P3; cd: number; r: number; n: number }[]; ambientLux: number; flames: number } {
    return { room: this.room?.id ?? null, clusters: this.clusters.map((c) => ({ ...c })), ambientLux: this.ambientLux, flames: this.room?.flames.length ?? 0 };
  }
}

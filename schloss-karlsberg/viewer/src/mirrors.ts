/**
 * Real reflections in the pier glasses and trumeaux of the room the visitor stands in (backlog KB-I75, wave-8 visual
 * audit #5). The model draws every mirror glass (`interior.mirror`) as a soft vertex-colour image of its room
 * (finish.ts mirrorGrid), which read as a beige smear at 21, 23, 24, 27 and 29: no chandelier, no windows, no enfilade.
 *
 * - One static cube map (MIRROR_CUBE_SIZE², half float, mipmapped) per visited room, captured from inside the room
 *   (mirrorsMath.capturePoint) one face per frame after the visitor has stood MIRROR_SETTLE_FRAMES in the room, and
 *   again when the light changes (hour, look, celebration: mirrorsMath.mirrorKey) and has then held for
 *   MIRROR_SETTLE_FRAMES (mirrorsMath.SettleGate: a dragged hour slider does not recapture every 0.05 h). A steady room
 *   renders no cube and, with the camera standing still, skips the room lookup: O(1) per frame, nothing outdoors; a
 *   capture costs six scene renders at 512² spread over six frames (+1.5…3.5 ms CPU on each, wave-9 review fix).
 * - The room's mirror meshes then swap to one unlit material that reads the cube with a box projection (parallax-
 *   corrected, mirrorsMath.boxProject) in the room's own frame, at mip MIRROR_LOD (old wavy plate glass), times the
 *   amalgam's tint MIRROR_TINT. Mirrors of other rooms (seen through the enfilade) keep the model's image.
 * - The cube holds the scene's linear, pre-exposed radiance (render targets are not tone mapped), so the reflection is
 *   graded with the rest of the frame.
 */
import * as THREE from 'three';
import { MIRROR_CUBE_SIZE, MIRROR_LOD, MIRROR_TINT, type MirrorGlass, type RoomBox, SettleGate, type V3, capturePoint, glassFromBounds, inRoom, largestGlass } from './mirrorsMath.ts';

interface Room {
  id: string;
  /** floor mesh: its local frame is the room box frame */
  frame: THREE.Mesh;
  /** world → room frame (static matrices; computed on first use) */
  inv: THREE.Matrix4 | null;
  box: RoomBox;
  mirrors: THREE.Mesh[];
  /** capture point (room frame): in front of the largest glass */
  capture: V3;
}

const VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  vWorldNormal = normalize( mat3( modelMatrix ) * normal );
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform samplerCube tCube;
uniform mat4 uBoxInv;     // world → room box frame
uniform mat3 uBoxRot;     // room box frame → world (rotation)
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uCapture;    // capture point, room box frame
uniform vec3 uTint;
uniform float uLod;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 V = normalize( vWorldPos - cameraPosition );
  vec3 N = normalize( vWorldNormal );
  if ( dot( N, V ) > 0.0 ) N = -N;
  vec3 R = reflect( V, N );
  vec3 p = ( uBoxInv * vec4( vWorldPos, 1.0 ) ).xyz;
  vec3 r = mat3( uBoxInv ) * R;
  vec3 rs = vec3( abs( r.x ) < 1e-5 ? 1e-5 : r.x, abs( r.y ) < 1e-5 ? 1e-5 : r.y, abs( r.z ) < 1e-5 ? 1e-5 : r.z );
  vec3 tf = max( ( uBoxMax - p ) / rs, ( uBoxMin - p ) / rs );
  float t = max( 0.0, min( min( tf.x, tf.y ), tf.z ) );
  vec3 d = uBoxRot * ( p + r * t - uCapture );
  gl_FragColor = vec4( textureLod( tCube, d, uLod ).rgb * uTint, 1.0 );
}`;

export class RoomMirrors {
  /** A/B switch (`skb.mirrors.enabled = false`): every mirror keeps the model's image. */
  enabled = true;
  /** Cube face renders so far (bench / tests). */
  captures = 0;
  private readonly rooms: Room[] = [];
  private readonly registered = new WeakSet<THREE.Object3D>();
  private current: Room | null = null;
  private candidate: Room | null = null;
  /** room and light key must hold MIRROR_SETTLE_FRAMES frames before a capture (mirrorsMath.SettleGate) */
  private readonly gate = new SettleGate();
  /** eye of the last room lookup: a camera standing still skips the lookup (steady state O(1)) */
  private readonly lastEye = new THREE.Vector3(Infinity, 0, 0);
  private faces = 0;
  private key = '';
  private pendingKey = '';
  private shown: Room | null = null;
  private readonly original = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly rt: THREE.WebGLCubeRenderTarget;
  private readonly cubeCam: THREE.CubeCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
  ) {
    this.rt = new THREE.WebGLCubeRenderTarget(MIRROR_CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.cubeCam = new THREE.CubeCamera(0.05, 400, this.rt);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tCube: { value: this.rt.texture },
        uBoxInv: { value: new THREE.Matrix4() },
        uBoxRot: { value: new THREE.Matrix3() },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uCapture: { value: new THREE.Vector3() },
        uTint: { value: new THREE.Vector3(...MIRROR_TINT) },
        uLod: { value: MIRROR_LOD },
      },
      toneMapped: false,
      fog: false,
    });
    this.material.name = 'interior.mirror';
  }

  /** Index the rooms of an interior group (floor box, mirror meshes); called once per built interior. */
  register(inner: THREE.Object3D): void {
    if (this.registered.has(inner)) return;
    this.registered.add(inner);
    const floors = new Map<string, THREE.Mesh[]>();
    const walls = new Map<string, THREE.Mesh[]>();
    const mirrors = new Map<string, THREE.Mesh[]>();
    inner.traverse((o) => {
      const m = o as THREE.Mesh;
      const id = m.userData?.roomId as string | undefined;
      if (!m.isMesh || !id) return;
      const add = (map: Map<string, THREE.Mesh[]>) => (map.get(id) ?? map.set(id, []).get(id)!).push(m);
      if (m.userData.part === 'interior/boden') add(floors);
      else if (m.userData.part === 'interior/wand') add(walls);
      const mat = m.material as THREE.Material;
      if (!Array.isArray(m.material) && mat?.name === 'interior.mirror') add(mirrors);
    });
    for (const [id, ms] of mirrors) {
      const fl = floors.get(id);
      if (!fl?.length) continue;
      const b = new THREE.Box3();
      for (const f of fl) {
        f.geometry.computeBoundingBox();
        b.union(f.geometry.boundingBox!);
      }
      let top = b.max.y + 3;
      const wl = walls.get(id);
      if (wl?.length) {
        const w = new THREE.Box3();
        for (const x of wl) {
          x.geometry.computeBoundingBox();
          w.union(x.geometry.boundingBox!);
        }
        top = w.max.y;
      }
      const box: RoomBox = { min: [b.min.x, b.max.y, b.min.z], max: [b.max.x, top, b.max.z] };
      // the glasses share the floor's frame (one interior group per building, identity mesh transforms)
      const glasses: MirrorGlass[] = ms.map((m) => {
        m.geometry.computeBoundingBox();
        const g = m.geometry.boundingBox!;
        return glassFromBounds([g.min.x, g.min.y, g.min.z], [g.max.x, g.max.y, g.max.z], box);
      });
      this.rooms.push({ id, frame: fl[0], inv: null, box, mirrors: ms, capture: capturePoint(box, largestGlass(glasses)) });
    }
  }

  /** Room (with mirrors) whose box holds the world point, or null. */
  private roomAt(p: THREE.Vector3): Room | null {
    for (const r of this.rooms) {
      if (!r.frame.parent) continue;
      r.inv ??= r.frame.matrixWorld.clone().invert();
      const l = this.tmp.copy(p).applyMatrix4(r.inv);
      if (inRoom([l.x, l.y, l.z], r.box)) return r;
    }
    return null;
  }

  private restore(): void {
    for (const [m, mat] of this.original) m.material = mat;
    this.original.clear();
    this.shown = null;
  }

  private show(r: Room): void {
    this.restore();
    const u = this.material.uniforms;
    const w = r.frame.matrixWorld;
    (u.uBoxInv.value as THREE.Matrix4).copy(w).invert();
    (u.uBoxRot.value as THREE.Matrix3).setFromMatrix4(w);
    (u.uBoxMin.value as THREE.Vector3).set(...r.box.min);
    (u.uBoxMax.value as THREE.Vector3).set(...r.box.max);
    (u.uCapture.value as THREE.Vector3).set(...r.capture);
    for (const m of r.mirrors) {
      this.original.set(m, m.material);
      m.material = this.material;
    }
    this.shown = r;
  }

  /**
   * Per frame: `inside` = the visitor stands in a building with a drawn interior; `lightKey` describes the light
   * (mirrorsMath.mirrorKey without the room). Renders at most one cube face.
   */
  update(camera: THREE.Camera, inside: boolean, lightKey: string, frame: number): void {
    if (!this.enabled || !inside) {
      if (this.shown) this.restore();
      this.current = this.candidate = null;
      this.faces = 0;
      this.pendingKey = '';
      this.gate.reset();
      this.lastEye.set(Infinity, 0, 0);
      return;
    }
    if (frame % 4 === 0 || this.candidate === null) {
      camera.getWorldPosition(this.eye);
      // a room built (or rebuilt) after the visitor stopped is still found: no candidate or a detached one re-checks
      if (this.eye.distanceToSquared(this.lastEye) > 1e-4 || !this.candidate?.frame.parent) {
        this.lastEye.copy(this.eye);
        this.candidate = this.roomAt(this.eye);
      }
    }
    const r = this.candidate;
    if (!r) {
      if (this.shown) this.restore();
      this.current = null;
      this.gate.reset();
      return;
    }
    const key = `${r.id}|${lightKey}`;
    // the room's glasses keep their last cube while the key settles (a new room shows the model's image meanwhile)
    if (!this.gate.step(key)) return;
    if (key === this.key && this.current === r) {
      if (this.shown !== r) this.show(r);
      return;
    }
    if (key !== this.pendingKey) {
      this.pendingKey = key;
      this.faces = 0;
      // another room's glasses must not show the cube while it is overwritten
      if (this.shown && this.shown !== r) this.restore();
    }
    this.captureFace(r);
    if (this.faces < 6) return;
    this.key = key;
    this.pendingKey = '';
    this.faces = 0;
    this.current = r;
    this.show(r);
  }

  private captureFace(r: Room): void {
    const rr = this.renderer;
    const cc = this.cubeCam;
    if (cc.coordinateSystem !== rr.coordinateSystem) {
      cc.coordinateSystem = rr.coordinateSystem;
      cc.updateCoordinateSystem();
    }
    const c = r.capture;
    cc.position.set(c[0], c[1], c[2]).applyMatrix4(r.frame.matrixWorld);
    cc.updateMatrixWorld(true);
    // the room's own glasses would reflect the previous capture (or the model's image): hidden while capturing
    const hidden: THREE.Mesh[] = [];
    for (const m of r.mirrors) if (m.visible) { m.visible = false; hidden.push(m); }
    const target = rr.getRenderTarget();
    const face = this.faces;
    // three regenerates the cube's mipmaps after a render into it; only after the last face (as CubeCamera.update)
    this.rt.texture.generateMipmaps = face === 5;
    rr.setRenderTarget(this.rt, face);
    rr.render(this.scene, cc.children[face] as THREE.Camera);
    rr.setRenderTarget(target);
    for (const m of hidden) m.visible = true;
    this.faces++;
    this.captures++;
  }

  dispose(): void {
    this.restore();
    this.rt.dispose();
    this.material.dispose();
  }
}

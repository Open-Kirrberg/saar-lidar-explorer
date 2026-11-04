/**
 * Camera controls: "Fliegen" (free drone like the explorer) and "Gehen" (first person, gravity, capsule collision
 * against a BVH of colliders). Keyboard: WASD move, Q/E down/up (fly), Space jump (walk), Shift fast,
 * mouse look with pointer lock (click the canvas), G walk / F fly.
 */
import * as THREE from 'three';
import { type ColliderPiece, pushOutPieces, raycastPieces } from './colliders.ts';
import { WALK_STEP_MAX } from '@model/site/access.ts';

export type Mode = 'fly' | 'walk';

export const EYE = 1.65;
const RADIUS = 0.3;
/** Shared with the generator's entrance reachability test (model/src/site/access.ts). */
const STEP_MAX = WALK_STEP_MAX;
const GRAVITY = 9.81;

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export class Controls {
  mode: Mode = 'fly';
  yaw = 0;
  pitch = -0.3;
  keys = new Set<string>();
  velocityY = 0;
  onGround = false;
  /** Walk colliders around the camera (colliders.ts, KB-I106: cached pieces, owned by the caller's cache). */
  pieces: readonly ColliderPiece[] = [];
  /** Terrain sampler (local x, z) -> h for fly-mode ground clearance and speed scaling. */
  ground: (x: number, z: number) => number = () => NaN;
  onModeChange: (m: Mode) => void = () => {};
  private tmpBox = new THREE.Box3();
  private seg = new THREE.Line3();

  /**
   * V2.7 zone runtime: input is read only while enabled (the zone is entered); every listener is removed by dispose().
   * Disabling clears held keys and the touch drive and releases the pointer lock.
   */
  private on = false;
  get enabled(): boolean {
    return this.on;
  }
  set enabled(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.keys.clear();
    this.touchFwd = 0;
    this.drag = false;
    this.touches.clear();
    if (v) {
      this.prevTouchAction = this.dom.style.touchAction;
      this.dom.style.touchAction = 'none';
    } else {
      this.dom.style.touchAction = this.prevTouchAction;
      if (document.pointerLockElement === this.dom) document.exitPointerLock();
    }
  }
  /** Hold-to-move buttons on coarse pointers (hud.ts): +1 forward, −1 back. */
  touchFwd = 0;
  private drag = false;
  private touches = new Map<number, { x: number; y: number }>();
  private prevTouchAction = '';
  private removers: (() => void)[] = [];

  constructor(
    public camera: THREE.PerspectiveCamera,
    public dom: HTMLElement,
  ) {
    const listen = <K extends keyof HTMLElementEventMap>(t: Window | HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      const h = (e: Event) => {
        if (this.on) fn(e as HTMLElementEventMap[K]);
      };
      t.addEventListener(type, h, opts);
      this.removers.push(() => t.removeEventListener(type, h, opts));
    };
    listen(window, 'keydown', (e) => {
      if (isTyping()) return;
      this.keys.add(e.code);
      if (e.code === 'KeyG') this.setMode('walk');
      if (e.code === 'KeyF') this.setMode('fly');
    });
    listen(window, 'keyup', (e) => this.keys.delete(e.code));
    listen(window, 'blur', () => this.keys.clear());
    listen(dom, 'dblclick', () => {
      if (document.pointerLockElement !== dom) dom.requestPointerLock?.();
    });
    listen(window, 'mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0022));
    });
    // drag-look without pointer lock (left or right mouse)
    listen(dom, 'mousedown', (e) => {
      if (e.button === 2 || e.button === 0) this.drag = true;
    });
    listen(window, 'mouseup', () => (this.drag = false));
    listen(dom, 'contextmenu', (e) => e.preventDefault());
    listen(dom, 'mousemove', (e) => {
      if (!this.drag || document.pointerLockElement === dom) return;
      this.yaw -= e.movementX * 0.004;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.004));
    });
    // V2.7 phone: one-finger drag looks around (pointer events; mouse keeps the handlers above)
    listen(dom, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    listen(dom, 'pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      const t = this.touches.get(e.pointerId);
      if (!t || this.touches.size !== 1) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      this.yaw += dx * 0.005; // drag the view: the scene follows the finger
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy * 0.005));
    });
    const lift = (e: PointerEvent) => {
      if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
    };
    listen(dom, 'pointerup', lift);
    listen(dom, 'pointercancel', lift);
    listen(
      dom,
      'wheel',
      (e) => {
        if (this.mode !== 'fly') return;
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        const agl = this.agl();
        this.camera.position.addScaledVector(dir, -Math.sign(e.deltaY) * Math.max(2, agl * 0.15));
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Remove every listener (zone dispose). */
  dispose(): void {
    this.enabled = false;
    for (const r of this.removers) r();
    this.removers = [];
    this.pieces = [];
  }

  setMode(m: Mode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.velocityY = 0;
    if (m === 'walk') {
      // drop to the ground below the camera
      const h = this.groundBelow(this.camera.position, 2000);
      if (Number.isFinite(h)) this.camera.position.y = h + EYE;
      this.pitch = 0;
    }
    this.onModeChange(m);
  }

  /** Height above the terrain (fly speed scaling). */
  agl(): number {
    const p = this.camera.position;
    const g = this.ground(p.x, p.z);
    return Number.isFinite(g) ? Math.max(1, p.y - g) : 50;
  }

  lookAt(target: THREE.Vector3): void {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.applyRotation();
  }

  applyRotation(): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  /** The walk colliders around the camera (castle.ts refreshColliders; pieces stay owned by its cache). */
  setColliders(pieces: readonly ColliderPiece[]): void {
    this.pieces = pieces;
  }

  /** Highest collider surface below p (within `range`), NaN if none. */
  groundBelow(p: THREE.Vector3, range = 3): number {
    if (!this.pieces.length) return this.ground(p.x, p.z);
    // centre + 4 probes on the capsule rim: small gaps (thresholds, joints) are bridged
    let best = -Infinity;
    for (const [dx, dz] of [
      [0, 0],
      [RADIUS * 0.8, 0],
      [-RADIUS * 0.8, 0],
      [0, RADIUS * 0.8],
      [0, -RADIUS * 0.8],
    ]) {
      const ray = new THREE.Ray(new THREE.Vector3(p.x + dx, p.y + 0.6, p.z + dz), new THREE.Vector3(0, -1, 0));
      const hit = raycastPieces(this.pieces, ray, range + 0.6);
      if (hit && hit.distance < range + 0.6) best = Math.max(best, hit.point.y);
    }
    if (best > -Infinity) return best;
    return this.ground(p.x, p.z);
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    const k = this.keys;
    const fwd = Math.max(-1, Math.min(1, (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.touchFwd));
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up = (k.has('KeyE') || k.has('PageUp') ? 1 : 0) - (k.has('KeyQ') || k.has('PageDown') ? 1 : 0);
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.mode === 'fly') {
      const agl = this.agl();
      const speed = Math.max(4, Math.min(400, agl * 0.9)) * (fast ? 4 : 1);
      const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const p = this.camera.position;
      p.addScaledVector(f, fwd * speed * dt).addScaledVector(r, right * speed * dt);
      p.y += up * speed * dt;
      const g = this.ground(p.x, p.z);
      if (Number.isFinite(g) && p.y < g + 1.0) p.y = g + 1.0;
    } else {
      this.walk(dt, fwd, right, fast);
    }
    this.applyRotation();
  }

  private walk(dt: number, fwd: number, right: number, fast: boolean): void {
    const speed = fast ? 4.5 : 1.6;
    const p = this.camera.position;
    const move = new THREE.Vector3(-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * right, 0, -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    // sub-steps for robust collision
    const steps = Math.max(1, Math.ceil(move.length() / 0.1));
    move.divideScalar(steps);
    for (let s = 0; s < steps; s++) {
      p.add(move);
      this.collide(p);
    }
    // gravity + step-up onto ground
    if (this.keys.has('Space') && this.onGround) {
      this.velocityY = 3.2;
      this.onGround = false;
    }
    this.velocityY -= GRAVITY * dt;
    let feet = p.y - EYE + this.velocityY * dt;
    const gh = this.groundBelow(new THREE.Vector3(p.x, p.y - EYE + STEP_MAX, p.z), STEP_MAX + 2);
    if (Number.isFinite(gh) && feet <= gh + 0.001) {
      feet = gh;
      this.velocityY = 0;
      this.onGround = true;
    } else if (Number.isFinite(gh) && this.onGround && feet - gh < STEP_MAX && this.velocityY <= 0) {
      // stick to ramps / steps going down
      feet = gh;
      this.velocityY = 0;
    } else this.onGround = false;
    if (!Number.isFinite(gh) && feet < -1000) feet = 0;
    p.y = feet + EYE;
  }

  /** Push the capsule (feet + STEP_MAX … head) out of the colliders. */
  private collide(p: THREE.Vector3): void {
    if (!this.pieces.length) return;
    const r = RADIUS;
    const bottom = p.y - EYE + STEP_MAX + r;
    const top = p.y + 0.1;
    this.seg.start.set(p.x, bottom, p.z);
    this.seg.end.set(p.x, Math.max(bottom, top - r), p.z);
    this.tmpBox.makeEmpty();
    this.tmpBox.expandByPoint(this.seg.start).expandByPoint(this.seg.end);
    this.tmpBox.min.addScalar(-r);
    this.tmpBox.max.addScalar(r);
    const seg = this.seg;
    pushOutPieces(this.pieces, seg, this.tmpBox, r);
    p.x = seg.start.x;
    p.z = seg.start.z;
  }
}

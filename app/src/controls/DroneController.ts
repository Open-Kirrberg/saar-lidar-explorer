import { MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Origin } from '../geo';
import { utmToWorld } from '../geo';
import { isTyping } from '../ui/keys';

/** Supplies the displayed ground height (world y) under a world x/z; NaN = unknown. */
export interface GroundProvider {
  surfaceY(x: number, z: number): number;
}

export interface DroneOptions {
  /** Base horizontal speed (m/s) at 50 m AGL and multiplier 1. */
  baseSpeed: number;
  /** Minimum clearance above the displayed terrain (m). */
  minClearance: number;
  /** Mouse sensitivity (degrees per pixel). */
  lookSensitivity: number;
  /** Click (without drag) on the canvas engages pointer lock. */
  lockOnClick: boolean;
  /** Fallback ground height when the terrain is unknown at the camera position. */
  fallbackGround: number;
  /**
   * Touch pointers drag-look like the mouse (F20: false while the TouchController's map gestures
   * own touch input — see TouchController.setNavigationMode).
   */
  touchLook: boolean;
}

export interface FlyToOptions {
  /** Height above ground at the destination (display metres). Default 120. */
  agl?: number;
  /** Absolute camera y (display metres); overrides `agl`. */
  y?: number;
  /** Destination heading (deg clockwise from grid north). Default: keep current. */
  heading?: number;
  /** Destination pitch (deg, negative = down). Default −35. */
  pitch?: number;
  /** Place the camera so the target is centred on screen (default true); else hover directly above it. */
  lookAt?: boolean;
  /** Seconds; default depends on distance. */
  duration?: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

interface Tween {
  from: Pose;
  to: Pose;
  t: number;
  duration: number;
  arc: number;
  resolve: (completed: boolean) => void;
}

const DEFAULTS: DroneOptions = {
  baseSpeed: 12,
  minClearance: 2,
  lookSensitivity: 0.12,
  lockOnClick: true,
  fallbackGround: 0,
  touchLook: true,
};

const DEADZONE = 0.15;
const MIN_MULT = 0.05;
const MAX_MULT = 50;

/**
 * Drone-style free camera:
 * - mouse look via pointer lock (click canvas, Esc releases) or drag-look when not locked
 * - WASD / arrows: horizontal move in heading frame; Space/E up; Shift/Q down; wheel = speed
 * - speed scales with height above ground; minimum clearance (terrain following)
 * - gamepad (standard mapping): left stick move, right stick look, LT/RT down/up, LB/RB speed
 * - flyTo(E, N) tween for map clicks / POIs
 */
export class DroneController {
  readonly opts: DroneOptions;
  /** Degrees clockwise from grid north. */
  heading = 0;
  /** Degrees, negative = down. */
  pitch = -25;
  speedMultiplier = 1;
  enabled = true;
  readonly velocity = new Vector3();
  /** Current height above displayed ground (display metres). */
  agl = 0;
  locked = false;

  private readonly keys = new Set<string>();
  private drag: { x: number; y: number; moved: number; t: number; id: number } | null = null;
  private tween: Tween | null = null;
  private padButtons: boolean[] = [];
  private readonly listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];
  private readonly lockListeners = new Set<(locked: boolean) => void>();

  constructor(
    readonly camera: PerspectiveCamera,
    readonly dom: HTMLElement,
    private readonly ground: GroundProvider,
    private readonly origin: Origin,
    opts: Partial<DroneOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    camera.rotation.order = 'YXZ';
    this.bind();
    this.applyRotation();
  }

  // ---- public API ---------------------------------------------------------------------

  get position(): Vector3 {
    return this.camera.position;
  }

  setPose(p: Partial<Pose>): void {
    this.cancelTween();
    if (p.x !== undefined) this.camera.position.x = p.x;
    if (p.y !== undefined) this.camera.position.y = p.y;
    if (p.z !== undefined) this.camera.position.z = p.z;
    if (p.heading !== undefined) this.heading = normDeg(p.heading);
    if (p.pitch !== undefined) this.pitch = clampPitch(p.pitch);
    this.velocity.set(0, 0, 0);
    this.applyRotation();
  }

  getPose(): Pose {
    const { x, y, z } = this.camera.position;
    return { x, y, z, heading: this.heading, pitch: this.pitch };
  }

  /** Fly to UTM E/N. Resolves true when arrived, false if interrupted by user input. */
  flyTo(E: number, N: number, opts: FlyToOptions = {}): Promise<boolean> {
    const { x, z } = utmToWorld(E, N, this.origin);
    return this.flyToWorld(x, z, opts);
  }

  flyToWorld(tx: number, tz: number, opts: FlyToOptions = {}): Promise<boolean> {
    this.cancelTween();
    const heading = normDeg(opts.heading ?? this.heading);
    const lookAt = opts.lookAt ?? true;
    const pitch = clampPitch(opts.pitch ?? (lookAt ? -35 : this.pitch));
    const g = this.groundAt(tx, tz);
    let y = opts.y ?? g + (opts.agl ?? 120);
    let x = tx;
    let z = tz;
    if (lookAt && pitch < -5) {
      // Back off along the heading so the target ends up in the screen centre.
      const back = (y - g) / Math.tan(-pitch * MathUtils.DEG2RAD);
      const hr = heading * MathUtils.DEG2RAD;
      x -= Math.sin(hr) * back;
      z += Math.cos(hr) * back;
      y = Math.max(y, this.groundAt(x, z) + this.opts.minClearance + 5);
    }
    const from = this.getPose();
    const to: Pose = { x, y, z, heading, pitch };
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const duration = opts.duration ?? MathUtils.clamp(0.8 + dist / 1500, 1, 4);
    return new Promise((resolve) => {
      this.tween = { from, to, t: 0, duration, arc: Math.min(dist * 0.15, 300), resolve };
    });
  }

  cancelTween(): void {
    if (!this.tween) return;
    const r = this.tween.resolve;
    this.tween = null;
    r(false);
  }

  get flying(): boolean {
    return this.tween !== null;
  }

  /** Current ground speed (m/s). */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  onLockChange(fn: (locked: boolean) => void): () => void {
    this.lockListeners.add(fn);
    return () => this.lockListeners.delete(fn);
  }

  // ---- per-frame ----------------------------------------------------------------------

  update(dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1);
    const pos = this.camera.position;
    const pad = this.pollGamepad(dt);

    if (this.tween) {
      this.stepTween(dt);
    } else if (this.enabled) {
      // Input axes: forward, right, up ∈ [-1, 1].
      const k = this.keys;
      let fwd = axis(k.has('KeyW') || k.has('ArrowUp'), k.has('KeyS') || k.has('ArrowDown'));
      let right = axis(k.has('KeyD') || k.has('ArrowRight'), k.has('KeyA') || k.has('ArrowLeft'));
      let up = axis(k.has('Space') || k.has('KeyE'), k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ'));
      fwd += pad.fwd;
      right += pad.right;
      up += pad.up;

      const agl = Math.max(pos.y - this.groundAt(pos.x, pos.z), 0);
      const scale = MathUtils.clamp(agl / 50, 0.2, 20) * this.speedMultiplier;
      const vh = this.opts.baseSpeed * scale;
      const vv = vh * 0.6;
      const hr = this.heading * MathUtils.DEG2RAD;
      const fx = Math.sin(hr);
      const fz = -Math.cos(hr);
      // Right vector = forward rotated 90° clockwise (seen from above).
      const rx = Math.cos(hr);
      const rz = Math.sin(hr);
      const len = Math.max(1, Math.hypot(fwd, right));
      const tx = ((fwd * fx + right * rx) / len) * vh;
      const tz = ((fwd * fz + right * rz) / len) * vh;
      const ty = MathUtils.clamp(up, -1, 1) * vv;
      const active = fwd !== 0 || right !== 0 || up !== 0;
      const rate = active ? 5 : 3.5; // acceleration vs. damping (1/s)
      const a = 1 - Math.exp(-rate * dt);
      this.velocity.x += (tx - this.velocity.x) * a;
      this.velocity.y += (ty - this.velocity.y) * a;
      this.velocity.z += (tz - this.velocity.z) * a;
      pos.addScaledVector(this.velocity, dt);
    }

    // Terrain following / minimum clearance.
    const g = this.groundAt(pos.x, pos.z);
    const minY = g + this.opts.minClearance;
    if (pos.y < minY) {
      pos.y = minY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    this.agl = pos.y - g;

    // Keep near plane proportional to height above ground for depth precision.
    const near = MathUtils.clamp(this.agl * 0.05, 0.1, 20);
    if (Math.abs(near - this.camera.near) > 0.01 * this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.applyRotation();
  }

  private stepTween(dt: number): void {
    const tw = this.tween!;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const e = easeInOutCubic(tw.t);
    const { from: a, to: b } = tw;
    const p = this.camera.position;
    p.x = a.x + (b.x - a.x) * e;
    p.z = a.z + (b.z - a.z) * e;
    p.y = a.y + (b.y - a.y) * e + tw.arc * Math.sin(Math.PI * e);
    let dh = normDeg(b.heading - a.heading);
    if (dh > 180) dh -= 360;
    this.heading = normDeg(a.heading + dh * e);
    this.pitch = a.pitch + (b.pitch - a.pitch) * e;
    this.velocity.set(0, 0, 0);
    if (tw.t >= 1) {
      this.tween = null;
      tw.resolve(true);
    }
  }

  private groundAt(x: number, z: number): number {
    const g = this.ground.surfaceY(x, z);
    return Number.isNaN(g) ? this.opts.fallbackGround : g;
  }

  private applyRotation(): void {
    this.camera.rotation.set(this.pitch * MathUtils.DEG2RAD, -this.heading * MathUtils.DEG2RAD, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  private look(dxPx: number, dyPx: number, sensitivity = this.opts.lookSensitivity): void {
    this.heading = normDeg(this.heading + dxPx * sensitivity);
    this.pitch = clampPitch(this.pitch - dyPx * sensitivity);
  }

  // ---- gamepad ------------------------------------------------------------------------

  private pollGamepad(dt: number): { fwd: number; right: number; up: number } {
    const none = { fwd: 0, right: 0, up: 0 };
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad || !this.enabled) return none;
    const ax = (i: number) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
    };
    const btn = (i: number) => pad.buttons[i]?.value ?? 0;
    const pressedEdge = (i: number) => {
      const now = !!pad.buttons[i]?.pressed;
      const was = this.padButtons[i] ?? false;
      this.padButtons[i] = now;
      return now && !was;
    };
    if (pressedEdge(4)) this.speedMultiplier = clampMult(this.speedMultiplier / 1.5);
    if (pressedEdge(5)) this.speedMultiplier = clampMult(this.speedMultiplier * 1.5);
    const lookRate = 110; // deg/s at full deflection
    const lx = ax(2);
    const ly = ax(3);
    const out = { fwd: -ax(1), right: ax(0), up: btn(7) - btn(6) };
    if (lx || ly || out.fwd || out.right || out.up) {
      this.cancelTween();
      this.heading = normDeg(this.heading + lx * lookRate * dt);
      this.pitch = clampPitch(this.pitch - ly * lookRate * dt);
    }
    return out;
  }

  // ---- DOM events ---------------------------------------------------------------------

  private on(t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, o);
    this.listeners.push([t, type, fn, o]);
  }

  private bind(): void {
    const dom = this.dom;
    this.on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (!this.enabled || isTyping(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (MOVE_KEYS.has(ev.code)) {
        this.keys.add(ev.code);
        this.cancelTween();
        if (ev.code === 'Space' || ev.code.startsWith('Arrow')) ev.preventDefault();
      } else if (ev.code === 'Equal' || ev.code === 'NumpadAdd' || ev.code === 'BracketRight') {
        this.speedMultiplier = clampMult(this.speedMultiplier * 1.25);
      } else if (ev.code === 'Minus' || ev.code === 'NumpadSubtract' || ev.code === 'Slash') {
        this.speedMultiplier = clampMult(this.speedMultiplier / 1.25);
      }
    });
    this.on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.on(window, 'blur', () => this.keys.clear());

    this.on(
      dom,
      'wheel',
      (e) => {
        const ev = e as WheelEvent;
        ev.preventDefault();
        if (!this.enabled) return;
        this.speedMultiplier = clampMult(this.speedMultiplier * (ev.deltaY < 0 ? 1.2 : 1 / 1.2));
      },
      { passive: false },
    );

    this.on(dom, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      if (!this.enabled || this.locked) return;
      if (ev.pointerType === 'touch' && !this.opts.touchLook) return;
      this.drag = { x: ev.clientX, y: ev.clientY, moved: 0, t: performance.now(), id: ev.pointerId };
      try {
        dom.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic/stale pointer id */
      }
    });
    this.on(dom, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (!this.drag || this.locked || ev.pointerId !== this.drag.id) return;
      const dx = ev.clientX - this.drag.x;
      const dy = ev.clientY - this.drag.y;
      this.drag.x = ev.clientX;
      this.drag.y = ev.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.moved > 3) {
        this.cancelTween();
        this.look(dx, dy, this.opts.lookSensitivity * 2);
      }
    });
    const endDrag = (e: Event) => {
      const ev = e as PointerEvent;
      const d = this.drag;
      if (!d || ev.pointerId !== d.id) return;
      this.drag = null;
      if (dom.hasPointerCapture(ev.pointerId)) dom.releasePointerCapture(ev.pointerId);
      const isClick = e.type === 'pointerup' && d.moved <= 4 && performance.now() - d.t < 500;
      // No pointer lock from a finger tap (touch screens have nothing to lock).
      if (isClick && this.opts.lockOnClick && ev.button === 0 && ev.pointerType !== 'touch') this.requestLock();
    };
    this.on(dom, 'pointerup', endDrag);
    this.on(dom, 'pointercancel', endDrag);

    this.on(document, 'mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const ev = e as MouseEvent;
      this.cancelTween();
      this.look(ev.movementX, ev.movementY);
    });
    this.on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      for (const fn of this.lockListeners) fn(this.locked);
    });
    this.on(document, 'pointerlockerror', () => console.warn('[drone] pointer lock refused'));
  }

  requestLock(): void {
    const req = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
    req?.catch?.(() => console.warn('[drone] pointer lock refused'));
  }

  dispose(): void {
    this.cancelTween();
    for (const [t, type, fn, o] of this.listeners) t.removeEventListener(type, fn, o);
    this.listeners.length = 0;
    if (this.locked) document.exitPointerLock();
  }
}

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function axis(pos: boolean, neg: boolean): number {
  return (pos ? 1 : 0) - (neg ? 1 : 0);
}

function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

function clampPitch(p: number): number {
  return MathUtils.clamp(p, -89, 89);
}

function clampMult(m: number): number {
  return MathUtils.clamp(m, MIN_MULT, MAX_MULT);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

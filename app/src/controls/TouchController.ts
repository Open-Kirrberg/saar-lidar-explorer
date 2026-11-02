import { Raycaster, Vector2 } from 'three';
import type { DroneController, GroundProvider } from './DroneController';
import {
  capSpeed,
  classifyTwoFinger,
  easeOutCubic,
  inertiaStep,
  isDoubleTap,
  orbitPosition,
  orbitYaw,
  panOffset,
  panReach,
  pinchScale,
  rayPlaneHit,
  releaseVelocity,
  tiltPitch,
  twistDelta,
  zoomToward,
} from './touchGestures';
import type { Pt, Sample, Tap, TwoFingerKind, V3, XZ } from './touchGestures';

/**
 * 'touch' = Google-Earth-like map gestures for touch pointers (default);
 * 'drone' = touch pointers do the DroneController's drag-look as before (touch gestures off).
 * Mouse, keyboard and gamepad always stay with the DroneController.
 */
export type NavigationMode = 'touch' | 'drone';

export interface LongPressEvent {
  clientX: number;
  clientY: number;
  /** Displayed terrain point under the finger (world, exaggeration applied), or null (sky). */
  point: V3 | null;
}

export interface TouchOptions {
  /** Long-press duration (ms) for the context action. */
  longPressMs: number;
  /** Finger travel (px) that still counts as a tap / long-press. */
  tapSlopPx: number;
  /** Closest / farthest camera distance to the zoom pivot (display metres). */
  minZoomDist: number;
  maxZoomDist: number;
  /** Twist (deg) before two-finger rotation engages (avoids accidental rotation while pinching). */
  rotateThresholdDeg: number;
  /** Inertia damping rate (1/s); glide distance = v0 / rate. */
  inertiaRate: number;
  /** Double tap: zoom factor for the distance to the tapped point, and animation length (s). */
  doubleTapZoom: number;
  doubleTapDuration: number;
  /**
   * True while a click/tap tool owns single taps (Markieren, Messen): double-tap zoom is then off so
   * a second tap places a second point instead of zooming. Default: `#app.marker-mode/.measure-mode`.
   */
  tapToolActive: () => boolean;
}

const DEFAULTS: TouchOptions = {
  longPressMs: 600,
  tapSlopPx: 10,
  minZoomDist: 5,
  maxZoomDist: 30000,
  rotateThresholdDeg: 10,
  inertiaRate: 4,
  doubleTapZoom: 0.5,
  doubleTapDuration: 0.3,
  tapToolActive: () => {
    const app = document.querySelector('#app');
    return !!app && (app.classList.contains('marker-mode') || app.classList.contains('measure-mode'));
  },
};

interface Finger {
  id: number;
  start: Pt;
  prev: Pt;
  cur: Pt;
  t0: number;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; anchor: V3; moved: boolean; samples: Sample[] }
  | { kind: 'held' } // long-press fired: ignore the rest of this touch
  | {
      kind: 'two';
      mode: TwoFingerKind;
      anchor: V3;
      /** Screen-centre pivot for tilting (null = tilt in place). */
      tiltPivot: V3 | null;
      twist: number;
      rotating: boolean;
    };

/** Events dispatched by `synthesizeTap` (bridge for tap-driven tools); ignored by this controller. */
const synthetic = new WeakSet<Event>();

/**
 * F20 touch navigation (Pointer Events, `pointerType === 'touch'` only, on the canvas):
 * - one finger drag: pan — the grabbed terrain point stays under the finger (exaggeration-aware pick)
 * - two fingers: pinch = zoom toward the midpoint, twist = heading (orbit around the midpoint),
 *   move = pan; parallel vertical drag = tilt (pitch, orbit around the screen-centre ground point)
 * - double tap: zoom toward the tapped point (off while Markieren/Messen own taps)
 * - long press (≈600 ms): context action (`onLongPress`, window event `sle:longpress`)
 * - short damped inertia after a one-finger pan
 *
 * It drives the DroneController's pose (`setPose`), so terrain following/min clearance, the store
 * ('camera' writes in main.ts' frame), URL hash and minimap keep working unchanged. Call
 * `update(dt)` once per frame before `controller.update(dt)`.
 * Touches that start on UI (panel, minimap, buttons, labels) never reach the canvas listeners.
 */
export class TouchController {
  readonly opts: TouchOptions;
  private navMode: NavigationMode = 'touch';
  private readonly fingers = new Map<number, Finger>();
  private gesture: Gesture = { kind: 'none' };
  private inertia: XZ | null = null;
  private anim: { from: V3; to: V3; t: number; duration: number } | null = null;
  private lastTap: Tap | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTouchT = -Infinity;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];
  private readonly longPressFns = new Set<(e: LongPressEvent) => void>();
  private readonly modeFns = new Set<(m: NavigationMode) => void>();

  constructor(
    readonly drone: DroneController,
    readonly dom: HTMLElement,
    private readonly pick: (clientX: number, clientY: number) => V3 | null,
    private readonly ground: GroundProvider,
    opts: Partial<TouchOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    const st = dom.style;
    st.touchAction = 'none'; // no browser pan/zoom fighting the gestures
    st.userSelect = 'none';
    st.setProperty('-webkit-user-select', 'none');
    st.setProperty('-webkit-touch-callout', 'none');
    this.applyMode();
    this.bind();
  }

  // ---- public API ---------------------------------------------------------------------------

  get mode(): NavigationMode {
    return this.navMode;
  }

  /** Switch what touch pointers do on the canvas (see NavigationMode). */
  setNavigationMode(mode: NavigationMode): void {
    if (mode === this.navMode) return;
    this.navMode = mode;
    this.reset();
    this.applyMode();
    for (const fn of this.modeFns) fn(mode);
  }

  onModeChange(fn: (m: NavigationMode) => void): () => void {
    this.modeFns.add(fn);
    return () => this.modeFns.delete(fn);
  }

  /** Long-press context action (also dispatched as `window` CustomEvent `sle:longpress`). */
  onLongPress(fn: (e: LongPressEvent) => void): () => void {
    this.longPressFns.add(fn);
    return () => this.longPressFns.delete(fn);
  }

  /** A touch gesture, glide or double-tap zoom is in progress. */
  get busy(): boolean {
    return this.gesture.kind !== 'none' || this.inertia !== null || this.anim !== null;
  }

  /** Stop any gesture, glide and zoom animation. */
  reset(): void {
    this.clearLongPress();
    this.fingers.clear();
    this.gesture = { kind: 'none' };
    this.inertia = null;
    this.anim = null;
  }

  /** Per frame (before DroneController.update): inertia glide and double-tap zoom animation. */
  update(dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1);
    if (this.drone.flying) {
      // A flyTo (minimap click, POI, share link) takes over.
      this.inertia = null;
      this.anim = null;
      return;
    }
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.duration);
      const e = easeOutCubic(a.t);
      this.drone.setPose({
        x: a.from.x + (a.to.x - a.from.x) * e,
        y: a.from.y + (a.to.y - a.from.y) * e,
        z: a.from.z + (a.to.z - a.from.z) * e,
      });
      if (a.t >= 1) this.anim = null;
    }
    if (this.inertia) {
      const s = inertiaStep(this.inertia, dt, this.opts.inertiaRate);
      const p = this.drone.position;
      this.drone.setPose({ x: p.x + s.dx, z: p.z + s.dz });
      this.inertia = s.v;
      if (Math.hypot(s.v.x, s.v.z) < Math.max(0.3, this.agl() * 0.01)) this.inertia = null;
    }
  }

  /**
   * Fire a synthetic single tap (pointerdown + pointerup, pointerType 'touch') on the canvas, so
   * tap-driven tools (Fundmarker form, Messen vertex) act at this position. Ignored by this
   * controller and by the DroneController in 'touch' mode.
   */
  synthesizeTap(clientX: number, clientY: number): void {
    for (const type of ['pointerdown', 'pointerup']) {
      const ev = new PointerEvent(type, {
        clientX,
        clientY,
        pointerId: 9999,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
        bubbles: true,
        cancelable: true,
      });
      synthetic.add(ev);
      this.dom.dispatchEvent(ev);
    }
  }

  dispose(): void {
    this.reset();
    for (const [t, type, fn, o] of this.listeners) t.removeEventListener(type, fn, o);
    this.listeners.length = 0;
    this.drone.opts.touchLook = true;
  }

  // ---- internals ----------------------------------------------------------------------------

  private applyMode(): void {
    // In 'touch' mode the DroneController must not also drag-look with touch pointers.
    this.drone.opts.touchLook = this.navMode === 'drone';
  }

  private get enabled(): boolean {
    return this.navMode === 'touch' && this.drone.enabled;
  }

  private agl(): number {
    const p = this.drone.position;
    const g = this.ground.surfaceY(p.x, p.z);
    return Number.isNaN(g) ? Math.max(this.drone.agl, 10) : Math.max(p.y - g, 1);
  }

  /** View ray (world) through a client position. */
  private ray(c: Pt): { o: V3; d: V3 } {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((c.x - r.left) / r.width) * 2 - 1, -((c.y - r.top) / r.height) * 2 + 1);
    this.drone.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.drone.camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    return { o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z } };
  }

  /** Terrain pick with an up-to-date camera matrix (setPose between frames leaves it stale). */
  private pickFresh(clientX: number, clientY: number): V3 | null {
    this.drone.camera.updateMatrixWorld();
    return this.pick(clientX, clientY);
  }

  /** Ground point under a client position: terrain pick, else the ground plane under the camera. */
  private anchorAt(c: Pt): V3 | null {
    const hit = this.pickFresh(c.x, c.y);
    if (hit) return { x: hit.x, y: hit.y, z: hit.z };
    const { o, d } = this.ray(c);
    const p = this.drone.position;
    let gy = this.ground.surfaceY(p.x, p.z);
    if (Number.isNaN(gy)) gy = this.drone.opts.fallbackGround;
    const xz = rayPlaneHit(o, d, Math.min(gy, o.y - 1), panReach(this.agl()));
    if (!xz) return null;
    const y = this.ground.surfaceY(xz.x, xz.z);
    return { x: xz.x, y: Number.isNaN(y) ? gy : Math.min(y, o.y - 1), z: xz.z };
  }

  private on(t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, o);
    this.listeners.push([t, type, fn, o]);
  }

  private bind(): void {
    const dom = this.dom;
    const isOurs = (e: Event): e is PointerEvent => {
      const ev = e as PointerEvent;
      return ev.pointerType === 'touch' && !synthetic.has(ev) && this.enabled;
    };
    this.on(dom, 'pointerdown', (e) => {
      if (!isOurs(e)) return;
      // Only touches that start on the canvas itself (labels/pins over it are UI).
      if (e.target !== dom || this.fingers.size >= 2) return;
      e.preventDefault();
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic/stale pointer id */
      }
      const p = { x: e.clientX, y: e.clientY };
      this.fingers.set(e.pointerId, { id: e.pointerId, start: p, prev: p, cur: p, t0: e.timeStamp });
      this.lastTouchT = performance.now();
      this.drone.cancelTween();
      this.inertia = null;
      this.anim = null;
      this.startGesture();
    });
    this.on(dom, 'pointermove', (e) => {
      if (!isOurs(e)) return;
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      f.prev = f.cur;
      f.cur = { x: e.clientX, y: e.clientY };
      this.moveGesture(f, e.timeStamp);
    });
    const end = (e: Event) => {
      if (!isOurs(e)) return;
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      this.lastTouchT = performance.now();
      if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      this.fingers.delete(e.pointerId);
      this.endFinger(f, e.type === 'pointerup', e.timeStamp);
    };
    this.on(dom, 'pointerup', end);
    this.on(dom, 'pointercancel', end);
    // Android fires contextmenu on long-press; iOS Safari has its own pinch "gesture" events.
    this.on(dom, 'contextmenu', (e) => {
      if (this.fingers.size > 0 || performance.now() - this.lastTouchT < 800) e.preventDefault();
    });
    this.on(dom, 'gesturestart', (e) => e.preventDefault());
    this.on(dom, 'gesturechange', (e) => e.preventDefault());
  }

  private startGesture(): void {
    this.clearLongPress();
    const fs = [...this.fingers.values()];
    if (fs.length === 1) {
      const f = fs[0];
      const anchor = this.anchorAt(f.cur);
      this.gesture = anchor ? { kind: 'pan', anchor, moved: false, samples: [] } : { kind: 'none' };
      this.longTimer = setTimeout(() => this.fireLongPress(f), this.opts.longPressMs);
    } else if (fs.length === 2) {
      const [a, b] = fs;
      // Restart both fingers' reference points so the classification starts from here.
      for (const f of fs) f.start = f.prev = f.cur;
      const mid = midpoint(a.cur, b.cur);
      const anchor = this.anchorAt(mid);
      if (!anchor) {
        this.gesture = { kind: 'none' };
        return;
      }
      this.gesture = { kind: 'two', mode: 'undecided', anchor, tiltPivot: null, twist: 0, rotating: false };
    } else {
      this.gesture = { kind: 'none' };
    }
  }

  private moveGesture(f: Finger, tMs: number): void {
    const g = this.gesture;
    if (g.kind === 'pan') {
      if (!g.moved && Math.hypot(f.cur.x - f.start.x, f.cur.y - f.start.y) <= this.opts.tapSlopPx) return;
      if (!g.moved) {
        g.moved = true;
        this.clearLongPress();
      }
      const { o, d } = this.ray(f.cur);
      const off = panOffset(o, d, g.anchor, panReach(this.agl()));
      if (!off) return;
      const p = this.drone.position;
      this.drone.setPose({ x: p.x + off.x, z: p.z + off.z });
      g.samples.push({ t: tMs, x: p.x, z: p.z });
      if (g.samples.length > 12) g.samples.shift();
    } else if (g.kind === 'two') {
      const [a, b] = [...this.fingers.values()];
      if (!a || !b) return;
      if (g.mode === 'undecided') {
        g.mode = classifyTwoFinger(a.start, b.start, a.cur, b.cur);
        if (g.mode === 'undecided') return;
        if (g.mode === 'tilt') {
          const r = this.dom.getBoundingClientRect();
          g.tiltPivot = this.pickFresh(r.left + r.width / 2, r.top + r.height / 2);
        }
        // Apply everything since the gesture start in one step.
        a.prev = a.start;
        b.prev = b.start;
      }
      if (g.mode === 'tilt') this.applyTilt(g.tiltPivot, (a.cur.y - a.prev.y + (b.cur.y - b.prev.y)) / 2);
      else this.applyTransform(g, a, b);
      a.prev = a.cur;
      b.prev = b.cur;
    }
  }

  private applyTilt(pivot: V3 | null, dy: number): void {
    const d = this.drone;
    const pitch = tiltPitch(d.pitch, dy);
    if (pitch === d.pitch) return;
    if (!pivot) {
      d.setPose({ pitch });
      return;
    }
    const p = d.position;
    const r = Math.hypot(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z);
    const np = orbitPosition(pivot, r, d.heading, pitch);
    d.setPose({ ...np, pitch });
  }

  private applyTransform(g: Extract<Gesture, { kind: 'two' }>, a: Finger, b: Finger): void {
    const d = this.drone;
    // Twist → heading, orbiting the grabbed midpoint (engages after a small threshold).
    const tw = twistDelta(a.prev, b.prev, a.cur, b.cur);
    g.twist += tw;
    if (!g.rotating && Math.abs(g.twist) >= this.opts.rotateThresholdDeg) g.rotating = true;
    let pos: V3 = { x: d.position.x, y: d.position.y, z: d.position.z };
    let heading = d.heading;
    if (g.rotating && tw !== 0) {
      // Fingers twist clockwise → the ground turns clockwise with them → view heading turns back.
      pos = orbitYaw(pos, g.anchor, -tw);
      heading -= tw;
    }
    // Pinch → distance to the grabbed point.
    const s = pinchScale(dist(a.prev, b.prev), dist(a.cur, b.cur));
    pos = zoomToward(pos, g.anchor, s, this.opts.minZoomDist, this.opts.maxZoomDist);
    d.setPose({ ...pos, heading });
    // Pan → keep the grabbed point under the finger midpoint.
    const { o, d: dir } = this.ray(midpoint(a.cur, b.cur));
    const off = panOffset(o, dir, g.anchor, panReach(this.agl()));
    if (off) d.setPose({ x: d.position.x + off.x, z: d.position.z + off.z });
  }

  private endFinger(f: Finger, wasUp: boolean, tMs: number): void {
    const g = this.gesture;
    this.clearLongPress();
    if (this.fingers.size === 1) {
      // 2 → 1 finger: continue as a fresh one-finger pan (no tap, no inertia).
      const rest = [...this.fingers.values()][0];
      rest.start = rest.prev = rest.cur;
      const anchor = this.anchorAt(rest.cur);
      this.gesture = anchor ? { kind: 'pan', anchor, moved: true, samples: [] } : { kind: 'none' };
      return;
    }
    if (this.fingers.size > 0) return;
    this.gesture = { kind: 'none' };
    if (!wasUp || g.kind !== 'pan') return;
    if (g.moved) {
      const v = releaseVelocity(g.samples, tMs);
      const capped = capSpeed(v, Math.max(50, this.agl() * 4));
      if (Math.hypot(capped.x, capped.z) > 1) this.inertia = capped;
      return;
    }
    // A tap (no travel, before the long-press fired).
    const tap: Tap = { t: tMs, x: f.cur.x, y: f.cur.y };
    if (this.opts.tapToolActive()) {
      this.lastTap = null;
      return;
    }
    if (isDoubleTap(this.lastTap, tap)) {
      this.lastTap = null;
      this.zoomAt(f.cur);
    } else {
      this.lastTap = tap;
    }
  }

  private zoomAt(c: Pt): void {
    const target = this.pickFresh(c.x, c.y);
    if (!target) return;
    const p = this.drone.position;
    const from = { x: p.x, y: p.y, z: p.z };
    const to = zoomToward(from, target, this.opts.doubleTapZoom, this.opts.minZoomDist, this.opts.maxZoomDist);
    this.anim = { from, to, t: 0, duration: this.opts.doubleTapDuration };
  }

  private fireLongPress(f: Finger): void {
    this.longTimer = null;
    const g = this.gesture;
    if (this.fingers.size !== 1 || !this.fingers.has(f.id) || (g.kind === 'pan' && g.moved)) return;
    this.gesture = { kind: 'held' };
    this.lastTap = null;
    navigator.vibrate?.(15);
    const point = this.pickFresh(f.cur.x, f.cur.y);
    const ev: LongPressEvent = { clientX: f.cur.x, clientY: f.cur.y, point: point ? { x: point.x, y: point.y, z: point.z } : null };
    for (const fn of this.longPressFns) fn(ev);
    window.dispatchEvent(new CustomEvent('sle:longpress', { detail: ev }));
  }

  private clearLongPress(): void {
    if (this.longTimer !== null) clearTimeout(this.longTimer);
    this.longTimer = null;
  }
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

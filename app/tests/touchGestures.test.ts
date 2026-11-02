import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import {
  capSpeed,
  classifyTwoFinger,
  easeOutCubic,
  forward,
  inertiaStep,
  isDoubleTap,
  orbitPosition,
  orbitYaw,
  panOffset,
  panReach,
  pinchScale,
  rayPlaneHit,
  releaseVelocity,
  rotateCW,
  tiltPitch,
  twistDelta,
  wrapDeg180,
  zoomToward,
} from '../src/controls/touchGestures';
import { longPressAction } from '../src/controls/touchContext';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('touch gesture math', () => {
  it('wraps angles to (−180, 180]', () => {
    expect(wrapDeg180(190)).toBe(-170);
    expect(wrapDeg180(-190)).toBe(170);
    expect(wrapDeg180(180)).toBe(180);
    expect(wrapDeg180(-180)).toBe(180);
    expect(wrapDeg180(720 + 5)).toBe(5);
  });

  it('intersects a ray with a horizontal plane and bounds near-horizon hits', () => {
    const o = { x: 0, y: 100, z: 0 };
    const hit = rayPlaneHit(o, { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 }, 0, 1000)!;
    close(hit.x, 0);
    close(hit.z, -100);
    // Upward ray: clamped to maxDist along its horizontal direction.
    const up = rayPlaneHit(o, { x: 1, y: 0.1, z: 0 }, 0, 500)!;
    close(up.x, 500);
    close(up.z, 0);
    // Too far: clamped too.
    const far = rayPlaneHit(o, { x: 0, y: -0.001, z: -1 }, 0, 800)!;
    close(far.z, -800);
    expect(rayPlaneHit(o, { x: 0, y: 1, z: 0 }, 0, 100)).toBeNull();
  });

  it('pans so the grabbed point returns under the finger', () => {
    const anchor = { x: 10, y: 5, z: -50 };
    const o = { x: 0, y: 100, z: 0 };
    const d = { x: 0.2, y: -0.8, z: -0.3 };
    const off = panOffset(o, d, anchor, 10000)!;
    // After moving the camera by `off`, the same ray hits the anchor's plane at the anchor.
    const hit = rayPlaneHit({ x: o.x + off.x, y: o.y, z: o.z + off.z }, d, anchor.y, 10000)!;
    close(hit.x, anchor.x);
    close(hit.z, anchor.z);
  });

  it('keeps the pan plane below the camera when the anchor is higher', () => {
    const off = panOffset({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 3, y: 50, z: 4 }, 1000)!;
    close(off.x, 3);
    close(off.z, 4);
  });

  it('pinch scale: spreading zooms in, guards tiny distances', () => {
    expect(pinchScale(100, 200)).toBe(0.5);
    expect(pinchScale(200, 100)).toBe(2);
    expect(pinchScale(0.5, 100)).toBe(1);
  });

  it('zooms toward the pivot within limits without reversing direction', () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const p = zoomToward({ x: 0, y: 100, z: 0 }, pivot, 0.5, 5, 1000);
    expect(p).toEqual({ x: 0, y: 50, z: 0 });
    expect(zoomToward({ x: 0, y: 8, z: 0 }, pivot, 0.1, 5, 1000).y).toBe(5);
    expect(zoomToward({ x: 0, y: 900, z: 0 }, pivot, 2, 5, 1000).y).toBe(1000);
    // Already closer than minDist: zooming in doesn't push the camera back out.
    expect(zoomToward({ x: 0, y: 3, z: 0 }, pivot, 0.5, 5, 1000).y).toBe(3);
    // Already farther than maxDist: zooming out doesn't snap it in.
    expect(zoomToward({ x: 0, y: 2000, z: 0 }, pivot, 1.5, 5, 1000).y).toBe(2000);
    // Direction preserved.
    const q = zoomToward({ x: 30, y: 40, z: 0 }, pivot, 0.5, 1, 1000);
    close(q.x, 15);
    close(q.y, 20);
  });

  it('twist angle: clockwise on screen is positive, wraps across ±180°', () => {
    close(twistDelta({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }), 90);
    close(twistDelta({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 }), 2 * (Math.atan2(1, 100) * 180) / Math.PI);
  });

  it('rotates clockwise in the heading sense (north → east)', () => {
    const north = { x: 0, z: -1 };
    const east = rotateCW(north, 90);
    close(east.x, 1);
    close(east.z, 0);
    // Matches forward(): forward(h + 90) = rotateCW(forward(h), 90).
    const f0 = forward(30, 0);
    const f1 = forward(120, 0);
    const r = rotateCW({ x: f0.x, z: f0.z }, 90);
    close(r.x, f1.x);
    close(r.z, f1.z);
  });

  it('orbits around a pivot keeping distance and the pivot in view', () => {
    const pivot = { x: 10, y: 0, z: -10 };
    const pos = orbitPosition(pivot, 100, 0, -45);
    const o = orbitYaw(pos, pivot, 90);
    close(Math.hypot(o.x - pivot.x, o.z - pivot.z), Math.hypot(pos.x - pivot.x, pos.z - pivot.z));
    // After the yaw, the camera with heading 90 still looks at the pivot.
    const expected = orbitPosition(pivot, 100, 90, -45);
    close(o.x, expected.x);
    close(o.y, expected.y);
    close(o.z, expected.z);
  });

  it('forward() matches the camera view direction for heading/pitch (YXZ)', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    for (const [h, p] of [[0, -30], [90, -10], [225, -60], [300, 20]]) {
      cam.rotation.set((p * Math.PI) / 180, (-h * Math.PI) / 180, 0, 'YXZ');
      cam.updateMatrixWorld();
      const rc = new Raycaster();
      rc.setFromCamera(new Vector2(0, 0), cam);
      const f = forward(h, p);
      close(rc.ray.direction.x, f.x, 1e-9);
      close(rc.ray.direction.y, f.y, 1e-9);
      close(rc.ray.direction.z, f.z, 1e-9);
    }
  });

  it('tilt: drag up tilts towards the horizon, clamped', () => {
    expect(tiltPitch(-45, -40)).toBe(-35);
    expect(tiltPitch(-45, 40)).toBe(-55);
    expect(tiltPitch(-10, -1000)).toBe(-4);
    expect(tiltPitch(-80, 1000)).toBe(-89);
    // Already above the limit (e.g. from drone mode): may come down, never further up.
    expect(tiltPitch(10, -100)).toBe(10);
    expect(tiltPitch(10, 40)).toBe(0);
  });

  it('classifies two-finger gestures', () => {
    const a = { x: 100, y: 300 };
    const b = { x: 250, y: 310 };
    expect(classifyTwoFinger(a, b, { x: 101, y: 303 }, { x: 251, y: 312 })).toBe('undecided');
    // Parallel vertical drag, side by side → tilt.
    expect(classifyTwoFinger(a, b, { x: 102, y: 260 }, { x: 251, y: 268 })).toBe('tilt');
    // Spread → transform.
    expect(classifyTwoFinger(a, b, { x: 70, y: 300 }, { x: 290, y: 310 })).toBe('transform');
    // Opposite vertical motion (twist) → transform.
    expect(classifyTwoFinger(a, b, { x: 100, y: 330 }, { x: 250, y: 280 })).toBe('transform');
    // Fingers above each other moving down together → pan (transform), not tilt.
    expect(classifyTwoFinger({ x: 200, y: 100 }, { x: 210, y: 300 }, { x: 200, y: 140 }, { x: 210, y: 340 })).toBe('transform');
  });

  it('release velocity from recent samples; none after resting', () => {
    const s = [
      { t: 0, x: 0, z: 0 },
      { t: 50, x: 5, z: 0 },
      { t: 100, x: 10, z: -2 },
      { t: 150, x: 15, z: -4 },
    ];
    const v = releaseVelocity(s, 160);
    close(v.x, 100);
    close(v.z, -40);
    expect(releaseVelocity(s, 400)).toEqual({ x: 0, z: 0 });
    expect(releaseVelocity([], 0)).toEqual({ x: 0, z: 0 });
    expect(releaseVelocity([{ t: 10, x: 1, z: 1 }], 12)).toEqual({ x: 0, z: 0 });
  });

  it('caps speed', () => {
    const v = capSpeed({ x: 300, z: 400 }, 100);
    close(Math.hypot(v.x, v.z), 100);
    expect(capSpeed({ x: 3, z: 4 }, 100)).toEqual({ x: 3, z: 4 });
  });

  it('inertia decays exponentially; glide distance is frame-rate independent', () => {
    const glide = (dt: number) => {
      let v = { x: 40, z: 0 };
      let x = 0;
      for (let t = 0; t < 5; t += dt) {
        const s = inertiaStep(v, dt, 4);
        v = s.v;
        x += s.dx;
      }
      return x;
    };
    close(glide(1 / 60), glide(1 / 30), 1e-6);
    close(glide(1 / 60), 10, 0.05); // v0 / rate
    const s = inertiaStep({ x: 10, z: 0 }, 0.25, 4);
    close(s.v.x, 10 * Math.exp(-1));
  });

  it('double tap detection and easing', () => {
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 250, x: 10, y: 10 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 400, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 60, y: 0 })).toBe(false);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('pan reach scales with height and is bounded', () => {
    expect(panReach(0)).toBe(400);
    expect(panReach(100)).toBe(4000);
    expect(panReach(1e6)).toBe(20000);
  });

  it('long-press action: measure point while measuring, else marker, nothing on sky', () => {
    expect(longPressAction(true, true)).toBe('measure');
    expect(longPressAction(true, false)).toBe('marker');
    expect(longPressAction(false, true)).toBe('none');
  });
});

// ---- controller integration over a flat ground (fake DOM, real three.js camera) ----------------

class FakeDom {
  style = { touchAction: '', userSelect: '', setProperty: () => {} };
  private ls = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(t: string, fn: (e: unknown) => void) {
    if (!this.ls.has(t)) this.ls.set(t, new Set());
    this.ls.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: (e: unknown) => void) {
    this.ls.get(t)?.delete(fn);
  }
  dispatch(t: string, e: object) {
    for (const fn of this.ls.get(t) ?? []) fn({ type: t, target: this, preventDefault() {}, ...e });
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 400 };
  }
  setPointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  releasePointerCapture() {}
  requestPointerLock() {}
}

describe('TouchController over flat ground', () => {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  beforeEach(() => {
    for (const k of ['window', 'document']) saved[k] = g[k];
    g.window = new EventTarget();
    g.document = Object.assign(new EventTarget(), { pointerLockElement: null, querySelector: () => null });
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const k of ['window', 'document']) g[k] = saved[k];
    vi.useRealTimers();
  });

  async function setup() {
    const { DroneController } = await import('../src/controls/DroneController');
    const { TouchController } = await import('../src/controls/TouchController');
    const camera = new PerspectiveCamera(60, 1, 0.5, 40000);
    const dom = new FakeDom();
    const ground = { surfaceY: () => 0 };
    const drone = new DroneController(camera, dom as unknown as HTMLElement, ground, { E0: 0, N0: 0 } as never);
    drone.setPose({ x: 0, y: 200, z: 0, heading: 30, pitch: -50 });
    const rc = new Raycaster();
    const pick = (cx: number, cy: number) => {
      camera.updateMatrixWorld();
      rc.setFromCamera(new Vector2((cx / 400) * 2 - 1, -(cy / 400) * 2 + 1), camera);
      const { origin: o, direction: d } = rc.ray;
      if (d.y >= 0) return null;
      const t = -o.y / d.y;
      return { x: o.x + d.x * t, y: 0, z: o.z + d.z * t };
    };
    const touch = new TouchController(drone, dom as unknown as HTMLElement, pick, ground, { tapToolActive: () => false });
    let ts = 0;
    const ev = (type: string, id: number, x: number, y: number) => dom.dispatch(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, timeStamp: (ts += 16) });
    return { drone, touch, pick, ev, dom };
  }

  it('one-finger drag keeps the grabbed ground point under the finger', async () => {
    const { drone, pick, ev } = await setup();
    const anchor = pick(200, 220)!;
    ev('pointerdown', 1, 200, 220);
    for (let i = 1; i <= 10; i++) ev('pointermove', 1, 200 + i * 6, 220 + i * 9);
    const under = pick(260, 310)!;
    close(under.x, anchor.x, 1e-6);
    close(under.z, anchor.z, 1e-6);
    expect(drone.position.y).toBe(200); // altitude unchanged by a pan
    expect(drone.opts.touchLook).toBe(false);
  });

  it('pinch zooms toward the midpoint and keeps it in place; twist turns the heading', async () => {
    const { drone, pick, ev } = await setup();
    const mid0 = pick(200, 200)!;
    const d0 = drone.position.distanceTo({ ...mid0 } as never);
    ev('pointerdown', 1, 150, 200);
    ev('pointerdown', 2, 250, 200);
    for (let i = 1; i <= 10; i++) {
      ev('pointermove', 1, 150 - i * 5, 200);
      ev('pointermove', 2, 250 + i * 5, 200);
    }
    const d1 = drone.position.distanceTo({ ...mid0 } as never);
    close(d1 / d0, 0.5, 1e-3);
    const mid1 = pick(200, 200)!;
    close(mid1.x, mid0.x, 1e-3);
    close(mid1.z, mid0.z, 1e-3);
    expect(drone.heading).toBeCloseTo(30, 6);
    // Twist the fingers 30° clockwise on screen around the midpoint → heading −30°.
    const r = 100;
    for (let i = 1; i <= 30; i++) {
      const a = (i * Math.PI) / 180;
      ev('pointermove', 1, 200 - r * Math.cos(a), 200 - r * Math.sin(a));
      ev('pointermove', 2, 200 + r * Math.cos(a), 200 + r * Math.sin(a));
    }
    // The first ~10° (rotate threshold) are swallowed to avoid accidental rotation while pinching.
    expect(drone.heading).toBeGreaterThan(8);
    expect(drone.heading).toBeLessThan(12);
    const mid2 = pick(200, 200)!;
    close(mid2.x, mid0.x, 1e-3);
    close(mid2.z, mid0.z, 1e-3);
  });

  it('parallel vertical two-finger drag tilts around the screen centre', async () => {
    const { drone, pick, ev } = await setup();
    const c0 = pick(200, 200)!;
    ev('pointerdown', 1, 150, 300);
    ev('pointerdown', 2, 250, 300);
    for (let i = 1; i <= 8; i++) {
      ev('pointermove', 1, 150, 300 - i * 5);
      ev('pointermove', 2, 250, 300 - i * 5);
    }
    expect(drone.pitch).toBeCloseTo(-40, 6); // 40 px up × 0.25°/px
    const c1 = pick(200, 200)!;
    close(c1.x, c0.x, 1e-6);
    close(c1.z, c0.z, 1e-6);
  });

  it('double tap zooms toward the tapped point; release glides with inertia', async () => {
    const { drone, touch, pick, ev } = await setup();
    const p = pick(120, 160)!;
    const before = drone.position.distanceTo({ ...p } as never);
    ev('pointerdown', 1, 120, 160);
    ev('pointerup', 1, 120, 160);
    ev('pointerdown', 1, 120, 160);
    ev('pointerup', 1, 120, 160);
    for (let i = 0; i < 30; i++) touch.update(1 / 60);
    const after = drone.position.distanceTo({ ...p } as never);
    close(after / before, 0.5, 1e-6);

    // Fast flick → camera keeps gliding after release, then stops.
    ev('pointerdown', 3, 200, 200);
    for (let i = 1; i <= 6; i++) ev('pointermove', 3, 200, 200 + i * 15);
    const x0 = drone.position.clone();
    ev('pointerup', 3, 200, 290);
    expect(touch.busy).toBe(true);
    touch.update(1 / 60);
    expect(drone.position.distanceTo(x0)).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) touch.update(1 / 60);
    expect(touch.busy).toBe(false);
  });

  it('long press fires the context action once and suppresses the tap', async () => {
    const { touch, ev } = await setup();
    const got: Array<{ clientX: number; point: unknown }> = [];
    touch.onLongPress((e) => got.push(e));
    ev('pointerdown', 1, 210, 230);
    ev('pointermove', 1, 213, 231); // within the tap slop
    vi.advanceTimersByTime(650);
    ev('pointerup', 1, 213, 231);
    expect(got).toHaveLength(1);
    expect(got[0].clientX).toBe(213);
    expect(got[0].point).not.toBeNull();
    // A drag cancels the long press.
    ev('pointerdown', 2, 210, 230);
    ev('pointermove', 2, 260, 230);
    vi.advanceTimersByTime(650);
    ev('pointerup', 2, 260, 230);
    expect(got).toHaveLength(1);
  });

  it("'drone' mode hands touch back to the drag-look and ignores gestures; mouse is never handled", async () => {
    const { drone, touch, ev, dom } = await setup();
    touch.setNavigationMode('drone');
    expect(drone.opts.touchLook).toBe(true);
    const x = drone.position.x;
    const h = drone.heading;
    ev('pointerdown', 1, 200, 200);
    for (let i = 1; i <= 5; i++) ev('pointermove', 1, 200 + i * 10, 200);
    ev('pointerup', 1, 250, 200);
    expect(drone.position.x).toBe(x); // no pan
    expect(drone.heading).not.toBe(h); // drone drag-look turned the view
    touch.setNavigationMode('touch');
    const h2 = drone.heading;
    dom.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 7, clientX: 200, clientY: 200, button: 0, timeStamp: 1 });
    dom.dispatch('pointermove', { pointerType: 'mouse', pointerId: 7, clientX: 260, clientY: 200, timeStamp: 2 });
    expect(drone.position.x).toBe(x);
    expect(drone.heading).not.toBe(h2); // mouse still drag-looks
  });
});

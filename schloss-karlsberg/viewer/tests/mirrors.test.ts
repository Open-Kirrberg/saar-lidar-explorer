import { describe, expect, it } from 'vitest';
import { MIRROR_CAPTURE_OFFSET, MIRROR_SETTLE_FRAMES, MIRROR_TINT, type RoomBox, SettleGate, type V3, boxProject, capturePoint, glassFromBounds, inRoom, largestGlass, mirrorKey } from '../src/mirrorsMath.ts';

const box: RoomBox = { min: [0, 0, 0], max: [10, 5, 6] };
const norm = (v: V3) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('KB-I75 mirror box projection', () => {
  it('returns the ray itself (up to length) when read from its own origin', () => {
    const p: V3 = [3, 1.7, 2];
    for (const r of [[1, 0.2, 0.3], [-0.4, -0.1, 0.9], [0, 1, 0]] as V3[]) {
      const d = norm(boxProject(p, r, box, p));
      const n = norm(r);
      for (let i = 0; i < 3; i++) expect(d[i]).toBeCloseTo(n[i], 9);
    }
  });
  it('hits the opposite wall: the lookup goes from the capture point to that hit', () => {
    // from a glass on the x = 0 wall straight across the room to x = 10
    const d = boxProject([0, 2, 3], [1, 0, 0], box, [5, 1.7, 3]);
    expect(d[0]).toBeCloseTo(5, 9);
    expect(d[1]).toBeCloseTo(0.3, 9);
    expect(d[2]).toBeCloseTo(0, 9);
    // a ray toward a corner stops at the nearer wall
    const c = boxProject([5, 2, 3], [1, 0, 1], box, [5, 2, 3]);
    expect(c[2]).toBeCloseTo(3, 9);
    expect(c[0]).toBeCloseTo(3, 9);
  });
  it('falls back to the ray when it has no direction', () => {
    expect(boxProject([1, 1, 1], [0, 0, 0], box, [5, 2, 3])).toEqual([0, 0, 0]);
  });
});

describe('KB-I75 capture point and glasses', () => {
  it('stands at eye height in the plan centre without a glass', () => {
    expect(capturePoint(box)).toEqual([5, 1.7, 3]);
    expect(capturePoint({ min: [0, 0, 0], max: [4, 2.4, 4] })[1]).toBeCloseTo(1.2, 9);
  });
  it('stands just in front of the largest glass and inside the box', () => {
    const small = glassFromBounds([9.95, 1, 1], [10, 2, 1.5], box);
    const big = glassFromBounds([0, 0.5, 2], [0.04, 3.5, 4], box);
    expect(big.normal).toEqual([1, 0, 0]);
    expect(small.normal).toEqual([-1, 0, 0]);
    expect(big.area).toBeCloseTo(6, 9);
    expect(largestGlass([small, big])).toBe(big);
    expect(largestGlass([])).toBeNull();
    const c = capturePoint(box, big);
    expect(c[0]).toBeCloseTo(0.02 + MIRROR_CAPTURE_OFFSET, 9);
    expect(c[2]).toBeCloseTo(3, 9);
    expect(inRoom(c, box, 0)).toBe(true);
    // a glass on a z wall: normal along z, toward the centre
    const z = glassFromBounds([4, 1, 5.97], [6, 3, 6], box);
    expect(z.normal).toEqual([0, 0, -1]);
    const cz = capturePoint(box, z);
    expect(cz[2]).toBeLessThan(6);
    expect(inRoom(cz, box, 0)).toBe(true);
  });
  it('inRoom pads the plan and allows standing slightly below the floor', () => {
    expect(inRoom([10.04, 1, 3], box)).toBe(true);
    expect(inRoom([10.2, 1, 3], box)).toBe(false);
    expect(inRoom([5, -0.2, 3], box)).toBe(true);
    expect(inRoom([5, 5.1, 3], box)).toBe(false);
  });
});

describe('KB-I75 mirror key and tint', () => {
  it('rounds the hour to 0.05 h so small drifts do not recapture', () => {
    expect(mirrorKey('r', 14.01, 'doku', false)).toBe(mirrorKey('r', 13.99, 'doku', false));
    expect(mirrorKey('r', 14, 'doku', false)).not.toBe(mirrorKey('r', 14.1, 'doku', false));
    expect(mirrorKey('r', 14, 'doku', false)).not.toBe(mirrorKey('r', 14, 'kino', false));
    expect(mirrorKey('r', 14, 'doku', false)).not.toBe(mirrorKey('r', 14, 'doku', true));
  });
  it('the amalgam reflects about 70 %', () => {
    const l = 0.2126 * MIRROR_TINT[0] + 0.7152 * MIRROR_TINT[1] + 0.0722 * MIRROR_TINT[2];
    expect(l).toBeGreaterThan(0.6);
    expect(l).toBeLessThan(0.8);
  });
});

describe('KB-I75 review fix: capture debounce', () => {
  it('opens only after the key has held for the settle frames', () => {
    const g = new SettleGate(3);
    expect([g.step('a'), g.step('a'), g.step('a'), g.step('a')]).toEqual([false, false, false, true]);
  });
  it('a key that keeps changing (dragged hour slider) never opens it; it opens once the key settles', () => {
    const g = new SettleGate(3);
    for (let i = 0; i < 20; i++) expect(g.step(`room|${(10.5 + i * 0.05).toFixed(2)}`)).toBe(false);
    const last = 'room|11.50';
    expect([g.step(last), g.step(last), g.step(last), g.step(last)]).toEqual([false, false, false, true]);
  });
  it('reset closes it again', () => {
    const g = new SettleGate(1);
    g.step('a');
    expect(g.step('a')).toBe(true);
    g.reset();
    expect(g.step('a')).toBe(false);
  });
  it('defaults to MIRROR_SETTLE_FRAMES', () => {
    const g = new SettleGate();
    let n = 0;
    while (!g.step('k')) n++;
    expect(n).toBe(MIRROR_SETTLE_FRAMES);
  });
});

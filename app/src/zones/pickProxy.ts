/**
 * Built twins: invisible pick proxies for small products (docs/style.md „Readable on phones“: tap targets of at
 * least 44 px). Pure parts, no three.js: plain numbers in the zone frame.
 *
 * A small product (box ≤ `PROXY_SMALL_M`) gets a proxy box grown, per axis, to at least the pick radius at its
 * distance (`radius px` → an angle → metres), capped at `PROXY_MAX_HALF_M`. When the exact ray hits nothing, an
 * occluder or a larger target (the bread wall's frame), the proxy the ray passes through closest to its centre
 * wins, as long as it is not behind that first surface. Only when that surface is a clickable target itself (the
 * bread wall's frame, a shelf bar a loaf rests on) may the proxy lie up to `PROXY_DEPTH_SLACK_M` behind it; behind
 * an occluder (a wall, the floor, the facade) there is no slack, so a thin wall never lets a pick through.
 * An exact hit on a small product always wins.
 */

export type V3 = readonly [number, number, number];

/** Pick radius in CSS px: half of a 44 px finger target on touch, a little help for the mouse and the crosshair. */
export const PROXY_PX_TOUCH = 22;
export const PROXY_PX_MOUSE = 8;
/** Products whose box is at most this long (m) get a proxy; baskets, cakes and the like are big enough. */
export const PROXY_SMALL_M = 0.45;
/** A proxy never grows beyond this half size (m): neighbours on a shelf stay apart. */
export const PROXY_MAX_HALF_M = 0.16;
/** How far behind the first surface a proxy may still be hit (m) when that surface is a target: a product resting on or behind a shelf bar. */
export const PROXY_DEPTH_SLACK_M = 0.3;

/** Depth slack behind the first real surface: only a clickable target (index ≥ 0) gets any; an occluder (−1) or nothing gets none. */
export const proxySlack = (firstHitTarget: number): number => (firstHitTarget >= 0 ? PROXY_DEPTH_SLACK_M : 0);

export const isSmallBox = (size: V3): boolean => Math.max(size[0], size[1], size[2]) <= PROXY_SMALL_M;

/** Angle (rad) a pick radius of `px` CSS px spans near the screen centre: viewport `heightPx`, vertical fov `fovDeg`. */
export function pickAngle(px: number, heightPx: number, fovDeg: number): number {
  if (!(px > 0) || !(heightPx > 0)) return 0;
  return Math.atan(((2 * px) / heightPx) * Math.tan((fovDeg * Math.PI) / 360));
}

/** Proxy half extents: each axis at least `dist · tan(angle)`, capped (never smaller than the box itself). */
export function proxyHalf(half: V3, dist: number, angle: number, cap = PROXY_MAX_HALF_M): [number, number, number] {
  const r = Math.min(cap, Math.max(0, dist) * Math.tan(Math.max(0, angle)));
  return [Math.max(half[0], r), Math.max(half[1], r), Math.max(half[2], r)];
}

/** Entry distance of the ray `o + t·d` (t ≥ 0) into the box [min, max], or null. Slab method. */
export function rayBoxEnter(o: V3, d: V3, min: V3, max: V3): number | null {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) {
      if (o[k]! < min[k]! || o[k]! > max[k]!) return null;
      continue;
    }
    let a = (min[k]! - o[k]!) / d[k]!;
    let b = (max[k]! - o[k]!) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

export interface ProxyBox {
  /** Box centre and half extents (zone frame, m). */
  c: V3;
  h: V3;
}

/**
 * The proxy picked by the ray (origin `o`, unit direction `d`), or −1. `limit` = distance of the first real surface
 * (Infinity: none) — proxies entered farther than `limit + slack` or than `far` are ignored (`slack`: `proxySlack`,
 * 0 behind an occluder). Among the proxies hit, the one whose centre lies closest to the ray (by angle) wins.
 */
export function chooseProxy(
  o: V3,
  d: V3,
  boxes: readonly ProxyBox[],
  angle: number,
  limit: number,
  far: number,
  slack = PROXY_DEPTH_SLACK_M,
): { index: number; distance: number } {
  let best = -1;
  let bestScore = Infinity;
  let bestT = 0;
  if (!(angle > 0)) return { index: -1, distance: 0 };
  const maxT = Math.min(far, limit + Math.max(0, slack));
  for (let i = 0; i < boxes.length; i++) {
    const { c, h } = boxes[i]!;
    const vx = c[0] - o[0];
    const vy = c[1] - o[1];
    const vz = c[2] - o[2];
    const dist = Math.hypot(vx, vy, vz);
    if (dist < 1e-6) continue;
    const ph = proxyHalf(h, dist, angle);
    const t = rayBoxEnter(o, d, [c[0] - ph[0], c[1] - ph[1], c[2] - ph[2]], [c[0] + ph[0], c[1] + ph[1], c[2] + ph[2]]);
    if (t === null || t > maxT) continue;
    // angle between the ray and the direction to the centre (1 − cos: monotone, no acos)
    const score = 1 - (vx * d[0] + vy * d[1] + vz * d[2]) / dist;
    if (score < bestScore) {
      bestScore = score;
      best = i;
      bestT = t;
    }
  }
  return { index: best, distance: bestT };
}

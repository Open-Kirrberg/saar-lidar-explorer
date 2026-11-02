/**
 * View footprint on the ground: cast rays through points on the frustum's screen border and
 * intersect them with the terrain. Pure (no three.js), so it can be unit-tested.
 *
 * World frame as in docs/data-contract.md: x = east, y = up, z = −north.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface XZ {
  x: number;
  z: number;
}

/** Hit distance along a normalised direction, or null if the ray misses within `maxDist`. */
export type RayHit = (origin: V3, dir: V3, maxDist: number) => number | null;

/**
 * NDC points around the screen border, counter-clockwise starting bottom-left:
 * bottom edge (left → right), right edge (bottom → top), top edge (right → left), left edge (top → bottom).
 * `perEdge` = number of segments per edge (1 = just the 4 corners).
 */
export function borderNdc(perEdge = 2): Array<[number, number]> {
  const n = Math.max(1, Math.floor(perEdge));
  const out: Array<[number, number]> = [];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const edges: Array<[[number, number], [number, number]]> = [
    [[-1, -1], [1, -1]],
    [[1, -1], [1, 1]],
    [[1, 1], [-1, 1]],
    [[-1, 1], [-1, -1]],
  ];
  for (const [a, b] of edges) {
    for (let k = 0; k < n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  return out;
}

function normalize(v: V3): V3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * Ground point for one ray. Hits farther than `maxDist` (horizontal) and misses (sky, outside data)
 * are clamped to `maxDist` along the ray's horizontal direction, so the polygon stays bounded.
 */
export function groundPoint(origin: V3, dirRaw: V3, hit: RayHit, maxDist: number): XZ {
  const dir = normalize(dirRaw);
  const hLen = Math.hypot(dir.x, dir.z);
  // Straight down (or up): no horizontal component.
  if (hLen < 1e-9) {
    return { x: origin.x, z: origin.z };
  }
  // Ray length needed to cover maxDist horizontally (cap for nearly vertical rays).
  const rayMax = maxDist / hLen;
  const t = hit(origin, dir, rayMax);
  if (t !== null && Number.isFinite(t) && t >= 0) {
    const px = origin.x + dir.x * t;
    const pz = origin.z + dir.z * t;
    const d = Math.hypot(px - origin.x, pz - origin.z);
    if (d <= maxDist) return { x: px, z: pz };
  }
  return { x: origin.x + (dir.x / hLen) * maxDist, z: origin.z + (dir.z / hLen) * maxDist };
}

/** Footprint polygon (world x/z, counter-clockwise in NDC order) for a set of ray directions. */
export function footprintFromRays(origin: V3, dirs: V3[], hit: RayHit, maxDist: number): XZ[] {
  return dirs.map((d) => groundPoint(origin, d, hit, maxDist));
}

/** Analytic ray/plane hit for y = const (handy for tests and as a fallback). */
export function planeHit(groundY: number): RayHit {
  return (o, d, maxDist) => {
    if (d.y >= -1e-12) return o.y <= groundY ? 0 : null;
    const t = (groundY - o.y) / d.y;
    return t >= 0 && t <= maxDist ? t : null;
  };
}

/** Shoelace area (m²) of a polygon in x/z. */
export function polygonArea(pts: XZ[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

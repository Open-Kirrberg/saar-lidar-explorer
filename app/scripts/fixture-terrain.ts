/**
 * Procedural fixture terrain with deliberate archaeological micro-features.
 * Pure (no I/O) so tests can reuse it. Coordinates: u = metres east, v = metres north
 * from the AOI lower-left corner.
 */

export const FIXTURE = {
  E0: 382000,
  N0: 5466000,
  width: 1000,
  height: 1000,
  chunkSize: 500,
} as const;

/** Feature catalogue (also written to the manifest for verification). */
export const FEATURES = {
  foundation: { u: 430, v: 560, w: 30, h: 20, rotDeg: 20, wallHalf: 0.6, height: 0.4 },
  ring: { u: 600, v: 460, radius: 22, width: 3, depth: 1, moundHeight: 0.5 },
  pits: [
    { u: 520, v: 640, d: 4, depth: 1 },
    { u: 534, v: 646, d: 3, depth: 1 },
    { u: 548, v: 652, d: 5, depth: 1 },
    { u: 562, v: 658, d: 6, depth: 1 },
    { u: 470, v: 420, d: 3, depth: 1 },
  ],
  hollowWay: { u0: 250, v0: 300, u1: 760, v1: 380, width: 5, depth: 0.6 },
};

/** Deterministic hash-based value noise. */
function hash2(ix: number, iy: number, seed: number): number {
  // murmur3 fmix32 over a combined key — avoids axis-aligned correlation.
  let h = (Math.imul(ix, 0x27d4eb2d) + Math.imul(iy, 0x165667b1) + Math.imul(seed, 0x9e3779b1)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

export function fbm(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let k = 0; k < octaves; k++) {
    // Rotate each octave to hide the lattice directions.
    const a = 0.7 + k * 1.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    sum += amp * valueNoise((x * ca - y * sa) * f, (x * sa + y * ca) * f, seed + k * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Smooth bump: 1 at t ≤ 0, 0 at t ≥ 1 (cosine shoulder). */
function shoulder(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

function sdBox(lx: number, ly: number, hw: number, hh: number): number {
  const qx = Math.abs(lx) - hw;
  const qy = Math.abs(ly) - hh;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0);
}

function baseTerrain(u: number, v: number): number {
  return (
    300 +
    28 * Math.sin(u / 170 + 0.4) * Math.cos(v / 210 - 0.3) +
    14 * Math.sin((u + 0.6 * v) / 95 + 1.0) +
    0.012 * (u - 500) + // gentle regional tilt
    9 * fbm(u / 150, v / 150, 2, 7) +
    0.12 * fbm(u / 14, v / 14, 3, 11) + // micro-roughness (natural)
    0.03 * (hash2(Math.round(u * 2), Math.round(v * 2), 3) - 0.5) // DTM noise ±1.5 cm
  );
}

function features(u: number, v: number): number {
  let dh = 0;
  // Rectangular foundation: wall outline + one cross wall, 0.4 m high.
  const f = FEATURES.foundation;
  const a = (f.rotDeg * Math.PI) / 180;
  const du = u - f.u;
  const dv = v - f.v;
  const lx = du * Math.cos(a) + dv * Math.sin(a);
  const ly = -du * Math.sin(a) + dv * Math.cos(a);
  const sd = Math.abs(sdBox(lx, ly, f.w / 2, f.h / 2));
  let wall = shoulder((sd - f.wallHalf) / 1.0);
  const cross = lx + f.w / 2 - 11;
  if (Math.abs(ly) < f.h / 2) wall = Math.max(wall, shoulder((Math.abs(cross) - f.wallHalf) / 1.0));
  dh += f.height * wall;

  // Ring ditch (Burggraben) with a low inner platform.
  const r = FEATURES.ring;
  const dist = Math.hypot(u - r.u, v - r.v);
  dh -= r.depth * shoulder(Math.abs(dist - r.radius) / (r.width / 2));
  dh += r.moundHeight * shoulder((dist - (r.radius - 4)) / 3);

  // Pits (1 m deep) with a faint raised rim.
  for (const p of FEATURES.pits) {
    const d = Math.hypot(u - p.u, v - p.v);
    dh -= p.depth * shoulder(d / (p.d / 2));
    dh += 0.15 * shoulder(Math.abs(d - p.d / 2 - 0.8) / 1.0);
  }

  // Hollow way (Hohlweg): linear depression.
  const hw = FEATURES.hollowWay;
  const ex = hw.u1 - hw.u0;
  const ey = hw.v1 - hw.v0;
  const len2 = ex * ex + ey * ey;
  const t = Math.min(Math.max(((u - hw.u0) * ex + (v - hw.v0) * ey) / len2, 0), 1);
  const dl = Math.hypot(u - (hw.u0 + t * ex), v - (hw.v0 + t * ey));
  dh -= hw.depth * shoulder(dl / (hw.width / 2));
  return dh;
}

/** Height at metres (u east, v north) from the lower-left corner. */
export function fixtureHeight(u: number, v: number): number {
  return baseTerrain(u, v) + features(u, v);
}

/** Full AOI raster (row 0 = north edge), cell centres. */
export function fixtureRaster(width: number = FIXTURE.width, height: number = FIXTURE.height): Float32Array {
  const out = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const v = height - r - 0.5;
    for (let c = 0; c < width; c++) out[r * width + c] = fixtureHeight(c + 0.5, v);
  }
  return out;
}

/** Fake canopy height (m) for the CHM layer. */
export function fixtureCanopy(u: number, v: number): number {
  const forest = fbm(u / 160, v / 160, 3, 23);
  if (forest < -0.15) return 0;
  const crowns = 0.5 + 0.5 * fbm(u / 6, v / 6, 2, 29);
  return Math.min(40, (12 + 18 * crowns) * Math.min(1, (forest + 0.15) * 6));
}

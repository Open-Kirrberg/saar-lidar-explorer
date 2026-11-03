/**
 * Candle light in the visitor's room at night (wave-11 look, the wave-10 review of pose 07: "the candles light
 * nothing"). Pure: no three.js, no DOM (tests: viewer/tests/candleMath.test.ts); the three.js side is candleLight.ts.
 *
 * Model [I]:
 * - every lit flame of the room (table candelabra, guéridon candlesticks, mantel candelabra, sconces, the chandeliers
 *   on a Fest night) is a source of `CANDLE_CD` (≈ 13 lm / 4π, look-and-period §5: 1800–1930 K, ≈ 13 lm);
 * - flames closer than `CLUSTER_MERGE_M` form one cluster (a candelabrum, a chandelier crown); the `CANDLE_POOL`
 *   clusters that matter most at the eye (cd / (d² + r²)) become shadowless inverse-square point lights with a sphere
 *   radius r (the cluster's spread: no hot spot on the crystal or the table top under a flame, Karis 2013 "Real
 *   shading in Unreal Engine 4", sphere lights), the others add their light at the eye to the ambient;
 * - the room's ambient is the inter-reflected candle light: the flux Φ = 4π·Σcd spread over the room surface A with a
 *   mean reflectance ρ (integrating-sphere estimate, e.g. CIBSE / IES lumen method). Of all reflected light
 *   Φ ρ / (A (1 − ρ)) only the second and later bounces, Φ ρ² / (A (1 − ρ)), fill the room evenly; the first bounce
 *   leaves the table top, the parquet and the chimneypiece next to the flames and stays a pool round them, so it is not
 *   spread over the room (wave-11 review, pose 07: "the candle lights the whole Festsaal evenly"). Never below
 *   `POOL_FLOOR_LUX`. A Festsaal with eleven candles gets ≈ 0.15 lx, a Fest night with 50–60 flames ≈ 0.4 lx: the Fest
 *   room is brighter because more candles burn, not by a slider.
 */

export type P3 = [number, number, number];

/** Luminous intensity of one candle flame (cd) [I: ≈ 13 lm / 4π ≈ 1.0 cd]. */
export const CANDLE_CD = 1;
/** Point lights for the clusters nearest the eye (fixed, so the lit programs do not change from room to room) [I]. */
export const CANDLE_POOL = 4;
/** Flames closer than this (m) join one cluster (single linkage): a candelabrum's arms, a chandelier's crown [I]. */
export const CLUSTER_MERGE_M = 0.9;
/** Smallest sphere radius of a cluster (m): a single flame with its bright wax and cup [I]. */
export const CLUSTER_MIN_R = 0.08;
/** Mean reflectance of a state room's surfaces (lime-white boiserie, ceiling, darker parquet and silk) [I]. */
export const ROOM_REFLECTANCE = 0.45;
/** Illuminance (lux) below which a cluster's light is cut (three's distance window) [I: ≈ 1/15 of the ambient]. */
export const LIGHT_FLOOR_LUX = 0.01;
/** Share of a far cluster's illuminance at the eye that the ambient takes over (a hemisphere average) [I]. */
export const FAR_SHARE = 0.5;
/**
 * Lowest room ambient (lux) while the candle pool lights the room [I]. The former fixed CANDLE_AMBIENT_LUX (0.15 lx,
 * light.ts) stays for rooms without the pool; with it, a room lit by one or two candles may fall darker in its corners.
 */
export const POOL_FLOOR_LUX = 0.05;

/**
 * Strength of the scotopic night vision (grade.ts) while the visitor stands in a candle-lit room [I]. The eye adapted to
 * the candles (the indoor exposure is metered for ≈ 5 lx, light.ts evIndoor) sees mesopic-photopic colour near them;
 * at full strength the night grade turned the warm pools on the parquet grey-red (pose 07, wave-11 look).
 */
export const INDOOR_NIGHT_VISION = 0.35;

export interface Flame {
  p: P3;
  cd: number;
}

export interface Cluster {
  /** cd-weighted centre */
  p: P3;
  /** summed intensity (cd) */
  cd: number;
  /** sphere radius (m): rms distance of its flames from the centre, at least CLUSTER_MIN_R */
  r: number;
  /** number of flames */
  n: number;
}

/** Single-linkage clusters of the flames within `merge` m (hash grid + union-find; O(n) for spread-out flames). */
export function clusterFlames(flames: readonly Flame[], merge: number = CLUSTER_MERGE_M): Cluster[] {
  const n = flames.length;
  if (!n) return [];
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const cell = (v: number) => Math.floor(v / merge);
  const grid = new Map<string, number[]>();
  flames.forEach((f, i) => {
    const k = `${cell(f.p[0])},${cell(f.p[1])},${cell(f.p[2])}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const m2 = merge * merge;
  flames.forEach((f, i) => {
    const [cx, cy, cz] = [cell(f.p[0]), cell(f.p[1]), cell(f.p[2])];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (j <= i) continue;
            const g = flames[j].p;
            const d2 = (g[0] - f.p[0]) ** 2 + (g[1] - f.p[1]) ** 2 + (g[2] - f.p[2]) ** 2;
            if (d2 > m2) continue;
            const a = find(i);
            const b = find(j);
            if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
          }
        }
  });
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  }
  const out: Cluster[] = [];
  for (const idx of groups.values()) {
    let cd = 0;
    const c: P3 = [0, 0, 0];
    for (const i of idx) {
      const f = flames[i];
      cd += f.cd;
      for (let k = 0; k < 3; k++) c[k] += f.p[k] * f.cd;
    }
    if (cd <= 0) continue;
    for (let k = 0; k < 3; k++) c[k] /= cd;
    let s = 0;
    for (const i of idx) {
      const f = flames[i];
      s += f.cd * ((f.p[0] - c[0]) ** 2 + (f.p[1] - c[1]) ** 2 + (f.p[2] - c[2]) ** 2);
    }
    out.push({ p: c, cd, r: Math.max(CLUSTER_MIN_R, Math.sqrt(s / cd)), n: idx.length });
  }
  // deterministic order: brightest first, then by position
  out.sort((a, b) => b.cd - a.cd || a.p[0] - b.p[0] || a.p[2] - b.p[2] || a.p[1] - b.p[1]);
  return out;
}

/** Illuminance (lux) of a sphere source of `cd` and radius `r` at distance `d`, facing it: cd / (d² + r²). */
export function sphereIlluminance(cd: number, d: number, r: number): number {
  return cd / (d * d + r * r);
}

/** Relevance of a cluster at the eye: its illuminance there. */
function relevance(c: Cluster, eye: P3): number {
  const d = Math.hypot(c.p[0] - eye[0], c.p[1] - eye[1], c.p[2] - eye[2]);
  return sphereIlluminance(c.cd, d, c.r);
}

/**
 * The `k` clusters that light the eye's surroundings most become point lights; the rest add `FAR_SHARE` of their
 * illuminance at the eye (lux) to the ambient. Stable order (by relevance, ties by position).
 */
export function pickClusters(clusters: readonly Cluster[], eye: P3, k: number = CANDLE_POOL): { lights: Cluster[]; farLux: number } {
  const ranked = clusters.map((c) => ({ c, e: relevance(c, eye) })).sort((a, b) => b.e - a.e || a.c.p[0] - b.c.p[0] || a.c.p[2] - b.c.p[2]);
  const lights = ranked.slice(0, k).map((x) => x.c);
  const farLux = FAR_SHARE * ranked.slice(k).reduce((s, x) => s + x.e, 0);
  return { lights, farLux };
}

/**
 * Wave-11 review fix (pose 07, "nothing casts a shadow"): the pool's lead cluster (the one that lights the eye most)
 * casts a low-resolution cube shadow; the furniture of the lit rooms (guéridons, chairs, sofas, tables, candlesticks)
 * casts into it only while the pool burns, so day views and the sun map's casters stay as they were. The map is drawn
 * again only when the lead cluster moves (a new room, another cluster nearest the eye) or the casters change [I].
 */
export const CANDLE_SHADOW = {
  /** Cube face size (texels): 512² × 6, drawn on change only. */
  mapSize: 512,
  /** Near plane (m): the guéridon top lies 0.44 m below its flame. */
  near: 0.05,
  /**
   * PCF radius (texels of a face) for a cluster of several flames: soft, as a candelabrum's spread flames give. A single
   * flame (sphere radius CLUSTER_MIN_R) takes radius 0: one hardware-filtered tap (shadowTaps.ts), a near-hard shadow.
   */
  radius: 8,
  /**
   * Depth bias (perspective depth, near 0.05 m: −5e-5 ≈ 1 mm at 1 m, 5 cm at 7 m, so a chair's shadow still reaches the
   * wainscot 0.3 m behind it) and normal bias (m).
   */
  bias: -0.00005,
  normalBias: 0.006,
  /** Cosine of the half-angle round the view direction in which a cluster counts as seen (≈ 55°). */
  viewCos: 0.57,
} as const;

/**
 * Index (into `lights`) of the cluster that casts the shadow: the brightest at the eye among those in front of the
 * viewer (within `CANDLE_SHADOW.viewCos` of the view direction `dir`), else the brightest of all. A light behind the
 * viewer throws its shadows behind the objects as seen from the eye (a flash: pose 07's mantel candelabra 1 m beside
 * the camera); a flame in view throws them toward the eye, where they read [I].
 */
export function shadowClusterIndex(lights: readonly Cluster[], eye: P3, dir: P3 | null): number {
  if (!lights.length) return -1;
  if (!dir) return 0;
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  let best = -1;
  let bestE = -1;
  lights.forEach((c, i) => {
    const v = [c.p[0] - eye[0], c.p[1] - eye[1], c.p[2] - eye[2]];
    const d = Math.hypot(v[0], v[1], v[2]);
    const cos = d > 1e-6 ? (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / (d * dl) : 1;
    if (cos < CANDLE_SHADOW.viewCos) return;
    const e = sphereIlluminance(c.cd, d, c.r);
    if (e > bestE) {
      bestE = e;
      best = i;
    }
  });
  return best < 0 ? 0 : best;
}

/** PCF radius (texels) of the shadow for a cluster: 0 for a single flame, CANDLE_SHADOW.radius for a spread cluster. */
export function shadowRadius(c: Cluster): number {
  return c.n > 1 && c.r > CLUSTER_MIN_R ? CANDLE_SHADOW.radius : 0;
}

/** Key of the shadow-casting cluster's position (mm grid): the cube map is redrawn only when it changes. */
export function shadowKey(p: P3 | null): string {
  return p ? p.map((v) => Math.round(v * 1000)).join(',') : '';
}

/** Inner surface area (m²) of a box room w × d × h. */
export function roomArea(w: number, d: number, h: number): number {
  return 2 * (w * d + w * h + d * h);
}

/** Inter-reflected illuminance (lux) of a room of surface `area` lit by `cd` candela in all, every bounce: Φρ / (A(1−ρ)). */
export function bounceLux(cd: number, area: number, rho: number = ROOM_REFLECTANCE): number {
  if (!(area > 0) || !(cd > 0)) return 0;
  return (4 * Math.PI * cd * rho) / (area * (1 - rho));
}

/**
 * The even part of the inter-reflected light (lux): the second and later bounces, Φρ² / (A(1−ρ)) = ρ · bounceLux. The
 * first bounce stays near the flames (see the header) [I].
 */
export function diffuseBounceLux(cd: number, area: number, rho: number = ROOM_REFLECTANCE): number {
  return rho * bounceLux(cd, area, rho);
}

/** Ambient candle illuminance (lux) of the room: even bounce plus the far clusters, at least `floor`. */
export function roomCandleLux(totalCd: number, area: number, farLux: number, floor: number): number {
  return Math.max(floor, diffuseBounceLux(totalCd, area) + farLux);
}

/**
 * The cluster's sphere radius rides in the point light's `decay` (candleLight.ts patches three's distance attenuation:
 * decay > 2 means 1 / (d² + (decay − 2)) instead of 1 / max(d^decay, 0.01)); every other light keeps decay 2 exactly.
 */
export function sphereDecay(r: number): number {
  return 2 + Math.max(CLUSTER_MIN_R, r) ** 2;
}

/** Cut-off distance (m) of a cluster's light: where it falls below LIGHT_FLOOR_LUX, within [6, 40] m. */
export function lightCutoff(cd: number): number {
  return Math.min(40, Math.max(6, Math.sqrt(Math.max(0, cd) / LIGHT_FLOOR_LUX)));
}

/** GLSL replacement of three's `getDistanceAttenuation` first line (lights_pars_begin, r187); decay 2 stays as it was. */
export const ATTENUATION_FROM = 'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );';
export const ATTENUATION_TO =
  '// wave-11 look (candleMath.sphereDecay): decay > 2 carries a sphere radius² (candle clusters)\n\tfloat distanceFalloff = decayExponent > 2.0 ? 1.0 / ( lightDistance * lightDistance + decayExponent - 2.0 ) : 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );';

/** Patch the `lights_pars_begin` chunk text (pure string work; throws if three's source moved). */
export function patchAttenuation(chunk: string): string {
  if (chunk.includes('candleMath.sphereDecay')) return chunk;
  if (!chunk.includes(ATTENUATION_FROM)) throw new Error('[candleMath] lights_pars_begin: getDistanceAttenuation not found');
  return chunk.replace(ATTENUATION_FROM, ATTENUATION_TO);
}

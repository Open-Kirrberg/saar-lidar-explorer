/**
 * Night lights, pure logic (no three.js, no DOM): which windows burn after sunset and where the candelabra stand
 * (wave-1 review of KB-I06; look-and-period.md §5; visual-audit P11 / backlog KB-I43 window part).
 *
 * Evidence: candles 1800–1930 K, ≈ 1 cd each (hypertextbook, look-and-period §5) [D->]; on an ordinary evening only
 * a few candelabra burn, chandeliers are for celebrations (SPSG, look-and-period §5) [D->]; lit windows about 10–20 % in
 * the Corps de logis and fewer in the Nutzbauten [U, the 1789 room use per night is unknown]; candelabra on the
 * chimneypiece below the trumeau mirror are a period norm [N], their exact place is [I].
 */
import { hashString, mulberry32 } from '@model/layout/geom.ts';

export type P3 = [number, number, number];

/** Share of windows lit at night per building class [U, look-and-period §5: 10–20 % Corps de logis, fewer elsewhere]. */
export function litShare(cls: string): number {
  if (cls === 'CDL') return 0.16;
  if (cls === 'WING2' || cls === 'RANGE1' || cls === 'ORANG') return 0.1;
  if (cls === 'PAV' || cls === 'GARD' || cls === 'RIDE') return 0.06;
  if (cls === 'WALL') return 0;
  return 0.04; // farm, stable and other service buildings
}

/**
 * Group glass panes (centroids, building-local) into windows: an arched head or a transom pane sits above its window
 * in the same opening, so panes within `dxz` horizontally and `dy` vertically join one window (single linkage).
 * Returns a window index per pane.
 */
export function groupPanes(centroids: readonly P3[], dxz = 0.6, dy = 2.6): number[] {
  const parent = centroids.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < centroids.length; i++)
    for (let j = i + 1; j < centroids.length; j++) {
      const a = centroids[i];
      const b = centroids[j];
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) <= dxz && Math.abs(a[1] - b[1]) <= dy) parent[find(i)] = find(j);
    }
  const ids = new Map<number, number>();
  return centroids.map((_, i) => {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}

/**
 * Deterministic lit-window choice: 0 = dark, otherwise the window's brightness 0.55…1 (curtains, shutters half
 * closed, candles nearer or further from the glass). Keyed on the building id and the window's position rounded to
 * 0.5 m, so LOD1 and LOD2 light the same windows.
 */
export function windowLight(buildingId: string, centre: P3, share: number, seed = 1789): number {
  const key = `${buildingId}|${Math.round(centre[0] * 2)}|${Math.round(centre[1] * 2)}|${Math.round(centre[2] * 2)}`;
  const rnd = mulberry32(hashString(key) ^ seed);
  if (rnd() >= share) return 0;
  return 0.55 + 0.45 * rnd();
}

/** Night factor of the lit windows over sun elevation: off above −1°, full below −4° (smoothstep). */
export function windowGlow(elDeg: number): number {
  const t = Math.min(1, Math.max(0, (-1 - elDeg) / 3));
  return t * t * (3 - 2 * t);
}

/** Axis-aligned box (building-local) of a chimneypiece, and the point the room's light hangs at (room centre). */
export interface Box {
  min: P3;
  max: P3;
}

/**
 * Two candelabra on a chimneypiece [N]: at both ends of the mantel shelf (the box's long horizontal side), 0.3 m above
 * it, halfway into the shelf depth. Returns [] for a box that is not plausibly one chimneypiece (wider than 3 m or
 * deeper than 1.2 m).
 */
export function mantelCandelabra(b: Box): P3[] {
  const wx = b.max[0] - b.min[0];
  const wz = b.max[2] - b.min[2];
  const wide = Math.max(wx, wz);
  const deep = Math.min(wx, wz);
  if (wide > 3 || deep > 1.2 || wide < 0.6) return [];
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const y = b.max[1] + 0.3;
  const off = wide * 0.38;
  return wx >= wz
    ? [
        [cx - off, y, cz],
        [cx + off, y, cz],
      ]
    : [
        [cx, y, cz - off],
        [cx, y, cz + off],
      ];
}

/** Luminous intensity of one candelabrum (cd): three candles of ≈ 1 cd [D-> hypertextbook]. */
export const CANDELABRUM_CD = 3;
/** Luminance of a lit window seen from outside (cd/m²) [I, tuned on pose 10 so the windows read as warm points]. */
export const WINDOW_NITS = 6;
/** Display cap of a lit window (pre-exposed, before tone mapping): amber, not a white blob at full night [I]. */
export const WINDOW_DISPLAY_MAX = 1.2;
/**
 * KB-I43: cap of the brightest channel of a lit window before tone mapping [I]. Neutral tone mapping compresses and
 * whitens above ≈ 0.8, so a cap on the luminance (WINDOW_DISPLAY_MAX) let the red channel of the amber colour run
 * into the shoulder and the windows read cream; capping the peak keeps the candle hue.
 */
export const WINDOW_PEAK_MAX = 1.35;

/** Pre-exposed window level (luminance multiplier of a luminance-1 colour) for nits, pre-exposure and colour peak. */
export function windowLevel(pre: number, peak: number): number {
  return Math.min(WINDOW_NITS * pre, WINDOW_DISPLAY_MAX, WINDOW_PEAK_MAX / Math.max(peak, 1e-6));
}

// ---------------------------------------------------------------- KB-I43: window colour, window shading, lanterns

/**
 * Degree of chromatic adaptation for candle light seen from outside at night [I]: the eye is adapted to the dark
 * blue scene (adaptationDegree ≈ 0.1–0.15 at night), so a candle-lit window reads clearly orange-amber, not the pale
 * cream of the room-adapted candle colour (0.75, used inside). Wave-4 shot 10 sampled the lit panes at sRGB
 * ≈ (223, 195, 155), a cream that reads as electric light.
 */
export const WINDOW_ADAPT = 0.35;

/**
 * Linear-RGB colour (luminance 1) of a candle-lit window seen from outside: 1850 K [D-> candles 1800–1930 K,
 * look-and-period §5] with WINDOW_ADAPT adaptation. `kelvinLinear` / `whiteBalance` are passed in so this module
 * stays free of the light tables (light.ts).
 */
export function windowCandleColour(kelvinLinear: (k: number) => [number, number, number], whiteBalance: (c: [number, number, number], d: number) => [number, number, number], kelvin = 1850, adapt = WINDOW_ADAPT): [number, number, number] {
  const c = kelvinLinear(kelvin).map((v) => Math.max(v, 0.03)) as [number, number, number];
  const g = whiteBalance(c, adapt);
  return [c[0] * g[0], c[1] * g[1], c[2] * g[2]];
}

/**
 * Brightness of a point inside a lit window [I]: the candles stand low and deep in the room, so the light is
 * brightest in the lower middle of the opening and falls off toward the head and the reveals (a lamp-lit room seen
 * from outside, not an evenly glowing panel). `v` 0 = sill … 1 = head, `h` −1 … 1 across the opening.
 */
export function windowShade(v: number, h: number): number {
  const vv = Math.min(1, Math.max(0, v));
  const hh = Math.min(1, Math.abs(h));
  const vert = 1 - 0.55 * Math.pow(Math.max(0, vv - 0.25) / 0.75, 1.3);
  const horiz = 1 - 0.35 * hh * hh;
  return vert * horiz;
}

/**
 * Wall lanterns at a portal [N period norm: lanterns at main portals (look-and-period §5); positions U]: a pair on iron
 * brackets flanking a door, 0.6 m beside the opening, their centre 2.3 m above the threshold (but below the head);
 * one above the crown of a carriage arch. `a` of the opening is its centre (layout/facade.ts). Returns building-side coordinates: `a` along the side from p0, `out` in front
 * of the wall plane, `h` absolute.
 */
export interface LanternSpot {
  a: number;
  out: number;
  h: number;
}

export function portalLanterns(o: { kind: string; a: number; width: number; bottom_h: number; top_h: number }, wallOut = 0): LanternSpot[] {
  if (o.kind === 'portal' || o.kind === 'double_door') {
    const h = Math.min(o.bottom_h + 2.3, o.top_h - 0.2);
    return [
      { a: o.a - o.width / 2 - 0.6 - 0.18, out: wallOut + 0.42, h },
      { a: o.a + o.width / 2 + 0.6 + 0.18, out: wallOut + 0.42, h },
    ];
  }
  if (o.kind === 'durchfahrt' || o.kind === 'carriage_gate') return [{ a: o.a, out: wallOut + 0.5, h: o.top_h + 0.55 }];
  return [];
}

/** Display level of a lantern's panes relative to a window (a candle in a small lantern seen close) [I]. */
export const LANTERN_LEVEL = 1.15;

// ---------------------------------------------------------------- wave-5 review fix: which candles burn

/**
 * Kind of a room light or candle: the model's light at a chandelier, the mantel candelabra (night.ts), or any other
 * light (a hall lantern, a kitchen hearth, a room without a chandelier).
 */
export type CandleKind = 'chandelier' | 'candelabrum' | 'other';

/**
 * Night factor (0…1) above which the candles are lit; below it they stand as unlit wax (by day the flames are hidden,
 * not just dimmed) [I].
 */
export const CANDLES_LIT_AT = 0.3;

/**
 * Share (0…1) of a light's intensity: an ordinary evening lights the candelabra on the chimneypiece and the wall
 * sconces, the chandeliers burn only for a celebration (`fest`) [D-> SPSG, look-and-period §5: chandeliers were lit
 * for large celebrations]. By day the chandelier light stands in for the daylight it was tuned with (KB-I06) and
 * stays; the candelabra are night-only. Other lights (lanterns, hearths) burn day and night.
 */
export function roomLightShare(kind: CandleKind, night: number, fest: boolean): number {
  const n = Math.min(1, Math.max(0, night));
  if (kind === 'candelabrum') return n;
  if (kind === 'chandelier') return fest ? 1 : 1 - n;
  return 1;
}

/** Whether the flames of a candle kind show: candles are lit only at night, a chandelier's only with `fest`. */
export function flamesLit(kind: CandleKind, night: number, fest: boolean): boolean {
  if (night < CANDLES_LIT_AT) return false;
  return kind === 'chandelier' ? fest : true;
}

/**
 * Flame spots of candle sticks: per connected component (`comp[i]` = component of vertex i, `pos` xyz per vertex in
 * one space) the centre of its top face, i.e. the mean x / z of the vertices within 2 mm of its highest y. Components
 * lower than `minHeight` (a stub, not a candle) are skipped. Sorted by component id.
 */
export function flameSpots(pos: ArrayLike<number>, comp: ArrayLike<number>, minHeight = 0.05): P3[] {
  const top = new Map<number, number>();
  const bottom = new Map<number, number>();
  for (let i = 0; i < comp.length; i++) {
    const y = pos[3 * i + 1];
    top.set(comp[i], Math.max(top.get(comp[i]) ?? -Infinity, y));
    bottom.set(comp[i], Math.min(bottom.get(comp[i]) ?? Infinity, y));
  }
  const sum = new Map<number, [number, number, number]>();
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i];
    if (pos[3 * i + 1] < top.get(c)! - 0.002) continue;
    const s = sum.get(c) ?? [0, 0, 0];
    s[0] += pos[3 * i];
    s[1] += pos[3 * i + 2];
    s[2]++;
    sum.set(c, s);
  }
  return [...sum.entries()]
    .filter(([c]) => top.get(c)! - bottom.get(c)! >= minHeight)
    .sort((a, b) => a[0] - b[0])
    .map(([c, s]) => [s[0] / s[2], top.get(c)!, s[1] / s[2]] as P3);
}

/**
 * Index of the chandelier (plan positions x / z, same space as the light) a room light hangs at: within `tol` metres
 * horizontally, else −1. The model places a room's light at its first chandelier (model/src/interior/model.ts).
 */
export function chandelierAt(light: P3, chandeliers: readonly P3[], tol = 0.6): number {
  let best = -1;
  let bd = tol;
  chandeliers.forEach((c, i) => {
    const d = Math.hypot(c[0] - light[0], c[2] - light[2]);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
